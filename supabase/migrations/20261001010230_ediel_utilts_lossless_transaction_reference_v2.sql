-- Created with Supabase CLI 2.118.0: migration new ediel_utilts_lossless_transaction_reference_v2.
-- U505 / U529 / APERAK ACW: variable-length an retains leading/embedded spaces
-- (UNECE R1157 9.1/9.3; authentic UTILTS p77). Trailing spaces remain held.
-- Prospective V2 only. Frozen V1 validation/store and immutable retries remain.
BEGIN;
CREATE FUNCTION gridex_utilts_binding.valid_transaction_reference_v2(value text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT value IS NOT NULL AND char_length(value) BETWEEN 1 AND 35
  AND value !~ '^ *$' AND right(value,1)<>' '
  AND NOT EXISTS(SELECT FROM generate_series(1,char_length(value)) n
   WHERE ascii(substr(value,n,1))<32 OR ascii(substr(value,n,1)) BETWEEN 127 AND 159 OR ascii(substr(value,n,1))>255)
$$;

CREATE OR REPLACE FUNCTION gridex_utilts_binding.validate_contract_v1(c jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE o jsonb; observations jsonb:='[]'; projected jsonb;
BEGIN
 IF c->'version'='1'::jsonb THEN RETURN gridex_utilts_binding.validate_legacy_contract_v1(c); END IF;
 IF c->'version' IS DISTINCT FROM '2'::jsonb OR c->>'projectionVersion' IS DISTINCT FROM 'utilts-consumption-v2'
  OR jsonb_typeof(c->'observations') IS DISTINCT FROM 'array'
  OR jsonb_typeof(c->'transactionId') IS DISTINCT FROM 'string'
  OR NOT coalesce(gridex_utilts_binding.valid_transaction_reference_v2(c->>'transactionId'),false) THEN RETURN false; END IF;
 FOR o IN SELECT value FROM jsonb_array_elements(c->'observations') LOOP
  IF jsonb_typeof(o->'quantity') IS DISTINCT FROM 'string'
   OR gridex_utilts_binding.canonical_decimal_v2(o->>'quantity') IS DISTINCT FROM o->>'quantity' THEN RETURN false; END IF;
  -- Reuse the strict frozen V1 shape/time/attribution predicates with an exact
  -- numeric JSON projection. This is validation only, never stored V2 content.
  observations:=observations||jsonb_build_array(o||jsonb_build_object('quantity',(o->>'quantity')::numeric));
 END LOOP;
 projected:=c||jsonb_build_object('version',1,'projectionVersion','utilts-consumption-v1','observations',observations,'transactionId',btrim(c->>'transactionId'));
 -- The frozen validator checks padded text generically. This shape-only copy
 -- uses its nonempty canonical form AFTER exact physical U505 validation.
 -- No stored contract, hash, original or consumer reference is normalized.
 RETURN gridex_utilts_binding.validate_legacy_contract_v1(projected);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;


-- Retain the precise historical V1 owner. All extant core callsites resolve the
-- dispatcher by name; only a bound prospective V2 receipt reaches the new port.
ALTER FUNCTION gridex_utilts_binding.persist_series_v1(uuid,text,uuid,text,jsonb) RENAME TO persist_series_legacy_v1;

-- V2 copies the complete 20260928181500 atomic owner; only physical identity
-- preservation and its accepted U505 shape guard differ. All retry/outcome,
-- locking, unowned object, dedupe and rollback clauses are retained.
CREATE FUNCTION gridex_utilts_binding.persist_series_v2(
  p_company_id uuid,
  p_environment text,
  p_source_message_id uuid,
  p_message_code text,
  p_transactions jsonb
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,extensions set timezone='UTC' as $$
declare
  v_source public.ediel_messages%rowtype;
  v_tokens jsonb;
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
begin
  if p_environment not in ('test','production') then raise exception 'utilts_environment_invalid'; end if;
  if jsonb_typeof(p_transactions) <> 'array' then raise exception 'utilts_transactions_must_be_array'; end if;

  select * into v_source from public.ediel_messages where id=p_source_message_id for share;
  if not found or v_source.message_family <> 'UTILTS' then raise exception 'utilts_source_message_missing'; end if;
  if v_source.company_id is distinct from p_company_id or v_source.environment is distinct from p_environment then
    raise exception 'utilts_source_tenant_or_environment_mismatch' using errcode='23514';
  end if;
  v_tokens := gridex_utilts_binding.wire_tokens_v1(v_source.raw_payload);
  if v_tokens is null then raise exception 'utilts_physical_membership_unavailable' using errcode='P0U01'; end if;

  for v_item in select value from jsonb_array_elements(p_transactions)
  loop
    v_transaction_id := nullif(v_item->>'transactionId','');
    v_disposition := coalesce(nullif(v_item->>'disposition',''),'processability_rejected');
    v_response_type := coalesce(nullif(v_item->>'responseType',''),'utilts_err');
    if v_transaction_id is null then v_transaction_id := 'transaction-' || (jsonb_array_length(v_results)+1)::text; end if;
    IF v_disposition='accepted' AND NOT coalesce(gridex_utilts_binding.valid_transaction_reference_v2(v_transaction_id),false) THEN
      RAISE EXCEPTION 'utilts_consumption_identity_unsupported' USING ERRCODE='P0U01';
    END IF;
    -- An accepted LOC+175 has no approved object owner or separate sink.
    -- Fail before the ACK/series write; the outer RPC also rolls its receipt back.
    if v_disposition='accepted' and gridex_utilts_binding.unowned_regulating_object_v1(v_tokens,v_transaction_id) then
      raise exception 'utilts_regulating_object_owner_unavailable' using errcode='P0U01';
    end if;
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
    -- An identical held original has already reserved its no-response result.
    -- Keep its row and timestamp immutable; a changed assessment may still
    -- upgrade this unfinalized hold through the existing path below.
    if found and v_disposition='internal_review' and v_response_type='none'
      and v_existing.disposition='internal_review' and v_existing.planned_response_type='none'
      and v_existing.final_response_type is null and v_existing.persistence_status='not_applicable'
      and v_existing.persisted_series_id is null and v_existing.issue_codes is not distinct from v_issue_codes then
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'transactionId',v_transaction_id,'disposition','internal_review',
        'responseType','none','persistenceStatus','not_applicable'));
      continue;
    end if;
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
      v_series_identity := concat_ws('|',p_company_id::text,p_environment,coalesce(v_item->>'seriesKind','actual'),
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
        and exists(select from public.ediel_messages origin where origin.id=meter_reading_series.source_ediel_message_id and origin.company_id=p_company_id and origin.environment=p_environment)
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
      -- A local write error has no national ERR meaning. Propagate it so the
      -- enclosing RPC rolls back this receipt, every sibling and every ACK
      -- reservation together. The original SQLSTATE stays available to ops.
      raise;
    end;
  end loop;
  return v_results;
end $$;

CREATE FUNCTION gridex_utilts_binding.persist_series_v1(
 p_company_id uuid,p_environment text,p_source_message_id uuid,p_message_code text,p_transactions jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt gridex_utilts_binding.receipts%rowtype;
BEGIN
 SELECT * INTO receipt FROM gridex_utilts_binding.receipts WHERE source_message_id=p_source_message_id FOR SHARE;
 IF NOT FOUND OR receipt.company_id IS DISTINCT FROM p_company_id OR receipt.environment IS DISTINCT FROM p_environment
  OR receipt.message_code IS DISTINCT FROM p_message_code THEN
  RAISE EXCEPTION 'utilts_consumption_receipt_missing' USING ERRCODE='P0U01';
 END IF;
 IF receipt.contract_version=1 THEN
  RETURN gridex_utilts_binding.persist_series_legacy_v1(p_company_id,p_environment,p_source_message_id,p_message_code,p_transactions);
 ELSIF receipt.contract_version=2 THEN
  RETURN gridex_utilts_binding.persist_series_v2(p_company_id,p_environment,p_source_message_id,p_message_code,p_transactions);
 END IF;
 RAISE EXCEPTION 'utilts_consumption_contract_invalid' USING ERRCODE='P0U01';
END $$;
REVOKE ALL ON FUNCTION gridex_utilts_binding.valid_transaction_reference_v2(text),gridex_utilts_binding.validate_contract_v1(jsonb),
 gridex_utilts_binding.persist_series_legacy_v1(uuid,text,uuid,text,jsonb),gridex_utilts_binding.persist_series_v2(uuid,text,uuid,text,jsonb),
 gridex_utilts_binding.persist_series_v1(uuid,text,uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
