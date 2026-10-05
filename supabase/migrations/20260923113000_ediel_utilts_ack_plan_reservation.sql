-- Reserve a non-held response in the same transaction that records its
-- disposition. This closes the gap before the separate ACK finalization call.
BEGIN;
create or replace function public.gridex_persist_utilts_transactions_v1(
  p_company_id uuid,
  p_environment text,
  p_source_message_id uuid,
  p_message_code text,
  p_transactions jsonb
) returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare
  v_source public.ediel_messages%rowtype;
  v_item jsonb;
  v_existing public.ediel_ack_transaction_results%rowtype;
  v_issue_codes text[];
  v_transaction_id text;
  v_disposition text;
  v_response_type text;
  v_dedupe_key text;
  v_series_identity text;
  v_series_id uuid;
  v_previous_id uuid;
  v_version integer;
  v_inserted boolean;
  v_quantity jsonb;
  v_order integer;
  v_results jsonb := '[]'::jsonb;
  v_error text;
begin
  if p_environment not in ('test','production') then raise exception 'utilts_environment_invalid'; end if;
  if jsonb_typeof(p_transactions) <> 'array' then raise exception 'utilts_transactions_must_be_array'; end if;

  select * into v_source from public.ediel_messages where id=p_source_message_id for share;
  if not found or v_source.message_family <> 'UTILTS' then raise exception 'utilts_source_message_missing'; end if;
  if v_source.company_id is distinct from p_company_id or v_source.environment is distinct from p_environment then
    raise exception 'utilts_source_tenant_or_environment_mismatch' using errcode='23514';
  end if;

  for v_item in select value from jsonb_array_elements(p_transactions)
  loop
    v_transaction_id := nullif(btrim(v_item->>'transactionId'),'');
    v_disposition := coalesce(nullif(v_item->>'disposition',''),'processability_rejected');
    v_response_type := coalesce(nullif(v_item->>'responseType',''),'utilts_err');
    if v_transaction_id is null then v_transaction_id := 'transaction-' || (jsonb_array_length(v_results)+1)::text; end if;
    v_issue_codes := coalesce(array(select jsonb_array_elements_text(coalesce(v_item->'issueCodes','[]'::jsonb))),array[]::text[]);
    -- The ACK and series are durable effects. A fresh structural assessment on
    -- retry may upgrade a held transaction, but may not silently revoke one
    -- that already produced a series or a finalized market response. Serialize
    -- retries for this source transaction before looking at the existing row.
    perform pg_advisory_xact_lock(hashtextextended(
      p_company_id::text || '|' || p_environment || '|' || p_source_message_id::text || '|' || v_transaction_id, 0));
    select * into v_existing from public.ediel_ack_transaction_results
      where company_id=p_company_id and environment=p_environment
        and source_message_id=p_source_message_id and source_transaction_id=v_transaction_id for update;
    -- Persistence is the durable response reservation, before any ACK draft
    -- can be created. Only a held, unfinalized row without side effects may
    -- change on later structural review. A planned ERR/APERAK/CONTRL remains
    -- fixed even if processing crashes between ACK creation and finalization.
    if found and not (v_existing.disposition='internal_review'
      and v_existing.planned_response_type='none' and v_existing.final_response_type is null
      and v_existing.persistence_status='not_applicable') then
      if v_existing.disposition is distinct from v_disposition
        or v_existing.planned_response_type is distinct from v_response_type
        or v_existing.issue_codes is distinct from v_issue_codes then
        raise exception 'utilts_committed_transaction_retry_conflict' using errcode='23514';
      end if;
      if v_existing.persistence_status='persisted' then
        if v_existing.persisted_series_id is null then
          raise exception 'utilts_committed_series_missing' using errcode='23514';
        end if;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'transactionId',v_transaction_id,'disposition',v_disposition,
          'responseType',v_response_type,'persistenceStatus','persisted',
          'seriesId',v_existing.persisted_series_id,'idempotentReplay',true));
      else
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'transactionId',v_transaction_id,'disposition',v_disposition,
          'responseType',v_response_type,'persistenceStatus',v_existing.persistence_status));
      end if;
      continue;
    end if;

    insert into public.ediel_ack_transaction_results(
      company_id,environment,source_message_id,source_transaction_id,
      syntax_result,guide_validation_result,processability_result,
      disposition,planned_response_type,issue_codes,persistence_status,updated_at
    ) values (
      p_company_id,p_environment,p_source_message_id,v_transaction_id,
      case when v_disposition='syntax_rejected' then 'negative' else 'positive' end,
      case when v_disposition='guide_rejected' then 'negative' when v_disposition='syntax_rejected' then 'pending' else 'positive' end,
      case when v_disposition='processability_rejected' then 'negative' when v_disposition='accepted' then 'positive' when v_disposition='internal_review' then 'pending' else 'not_applicable' end,
      v_disposition,v_response_type,
      v_issue_codes,
      case when v_disposition='accepted' then 'pending' else 'not_applicable' end,now()
    ) on conflict(company_id,environment,source_message_id,source_transaction_id)
    do update set
      syntax_result=excluded.syntax_result,
      guide_validation_result=excluded.guide_validation_result,
      processability_result=excluded.processability_result,
      disposition=excluded.disposition,
      planned_response_type=excluded.planned_response_type,
      issue_codes=excluded.issue_codes,
      persistence_status=excluded.persistence_status,
      persisted_series_id=null,
      persistence_error=null,
      updated_at=now();

    if v_disposition <> 'accepted' then
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'transactionId',v_transaction_id,'disposition',v_disposition,
        'responseType',v_response_type,'persistenceStatus','not_applicable'
      ));
      continue;
    end if;

    begin
      v_series_identity := concat_ws('|',p_company_id::text,coalesce(v_item->>'seriesKind','actual'),
        p_message_code,coalesce(v_item->>'externalMeteringPointId',''),coalesce(v_item->>'gridAreaId',''),
        coalesce(v_item->>'periodStart',''),coalesce(v_item->>'periodEnd',''),
        coalesce(v_item->>'resolution','UNKNOWN'),coalesce(v_item->>'productId',''));
      perform pg_advisory_xact_lock(hashtextextended(v_series_identity,0));
      v_dedupe_key := encode(digest(convert_to(v_series_identity || '|' || v_transaction_id,'UTF8'),'sha256'),'hex');
      v_previous_id := null;
      v_version := 1;
      select id,version_no into v_previous_id,v_version
      from public.meter_reading_series
      where company_id=p_company_id and is_current
        and series_kind=coalesce(v_item->>'seriesKind','actual')
        and coalesce(message_code,'')=coalesce(p_message_code,'')
        and coalesce(external_metering_point_id,'')=coalesce(v_item->>'externalMeteringPointId','')
        and coalesce(grid_area_id,'')=coalesce(v_item->>'gridAreaId','')
        and period_start is not distinct from nullif(v_item->>'periodStart','')::timestamptz
        and period_end is not distinct from nullif(v_item->>'periodEnd','')::timestamptz
        and resolution=coalesce(v_item->>'resolution','UNKNOWN')
        and coalesce(product_id,'')=coalesce(v_item->>'productId','')
        and dedupe_key<>v_dedupe_key
      order by version_no desc limit 1 for update;
      if v_previous_id is not null then v_version := v_version + 1; end if;

      insert into public.meter_reading_series(
        company_id,metering_point_id,source_ediel_message_id,external_metering_point_id,
        grid_area_id,period_start,period_end,resolution,unit,quality_status,dedupe_key,
        message_code,source_transaction_reference,series_kind,product_id,time_series_product,
        actor_context,registration_date,latest_update_date,version_no,supersedes_series_id,
        is_current,correction_reason,raw_transaction,immutable_hash
      ) values (
        p_company_id,nullif(v_item->>'meteringPointId','')::uuid,p_source_message_id,
        nullif(v_item->>'externalMeteringPointId',''),nullif(v_item->>'gridAreaId',''),
        nullif(v_item->>'periodStart','')::timestamptz,nullif(v_item->>'periodEnd','')::timestamptz,
        coalesce(nullif(v_item->>'resolution',''),'UNKNOWN'),coalesce(nullif(v_item->>'unit',''),'KWH'),
        'received',v_dedupe_key,p_message_code,v_transaction_id,coalesce(v_item->>'seriesKind','actual'),
        nullif(v_item->>'productId',''),v_item->'timeSeriesProduct',coalesce(v_item->'actorContext','{}'::jsonb),
        nullif(v_item->>'registrationDate','')::timestamptz,nullif(v_item->>'latestUpdateDate','')::timestamptz,
        v_version,v_previous_id,true,nullif(v_item->>'correctionReason',''),v_item,
        encode(digest(convert_to(v_item::text,'UTF8'),'sha256'),'hex')
      ) on conflict(company_id,dedupe_key) do nothing returning id into v_series_id;
      v_inserted := v_series_id is not null;
      if not v_inserted then
        select id into v_series_id from public.meter_reading_series
        where company_id=p_company_id and dedupe_key=v_dedupe_key;
      else
        if v_previous_id is not null then
          update public.meter_reading_series set is_current=false where id=v_previous_id;
        end if;
        v_order := 0;
        for v_quantity in select value from jsonb_array_elements(coalesce(v_item->'quantities','[]'::jsonb))
        loop
          v_order := v_order + 1;
          insert into public.meter_reading_values(
            company_id,series_id,reading_at,quantity,unit,quality,source_order,
            observation_id,qualifier,raw_value,metadata
          ) values (
            p_company_id,v_series_id,nullif(v_quantity->>'readingAt','')::timestamptz,
            nullif(v_quantity->>'value','')::numeric,coalesce(nullif(v_item->>'unit',''),'KWH'),
            coalesce(nullif(v_quantity->>'quality',''),'unknown'),v_order,
            coalesce(nullif(v_quantity->>'observationId',''),v_order::text),
            nullif(v_quantity->>'qualifier',''),v_quantity->>'raw',coalesce(v_quantity->'metadata','{}'::jsonb)
          );
        end loop;
      end if;

      update public.ediel_ack_transaction_results set
        persistence_status='persisted',persisted_series_id=v_series_id,persistence_error=null,updated_at=now()
      where company_id=p_company_id and environment=p_environment
        and source_message_id=p_source_message_id and source_transaction_id=v_transaction_id;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'transactionId',v_transaction_id,'disposition','accepted','responseType','positive_aperak',
        'persistenceStatus','persisted','seriesId',v_series_id,'idempotentReplay',not v_inserted
      ));
    exception when others then
      get stacked diagnostics v_error = message_text;
      update public.ediel_ack_transaction_results set
        disposition='processability_rejected',planned_response_type='utilts_err',
        processability_result='negative',persistence_status='failed',persistence_error=left(v_error,500),
        issue_codes=array_append(issue_codes,'UTILTS_PERSISTENCE_FAILED'),updated_at=now()
      where company_id=p_company_id and environment=p_environment
        and source_message_id=p_source_message_id and source_transaction_id=v_transaction_id;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'transactionId',v_transaction_id,'disposition','processability_rejected','responseType','utilts_err',
        'persistenceStatus','failed','issueCodes',jsonb_build_array('UTILTS_PERSISTENCE_FAILED')
      ));
    end;
  end loop;
  return v_results;
end $$;



revoke all on function public.gridex_persist_utilts_transactions_v1(uuid,text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.gridex_persist_utilts_transactions_v1(uuid,text,uuid,text,jsonb) to service_role;
COMMIT;
