-- CLI-created with pinned Supabase 2.101.0 at 20260923135706.
-- No historical receipt/projection backfill. Native replay is required.
BEGIN;
CREATE SCHEMA gridex_utilts_binding;
REVOKE ALL ON SCHEMA gridex_utilts_binding FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_utilts_binding.wire_tokens_v1(p_raw text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE
 component_sep text:=':'; data_sep text:='+'; release_char text:='?'; terminator text:='''';
 decimal_mark text:='.'; reserved text:=' '; body text; ch text; chars text[];
 released boolean:=false; current_component text:=''; current_element jsonb:='[]'; elements jsonb:='[]';
 result jsonb:='[]'; tag text; segment_count integer:=0; line_count integer:=0;
 component_size integer:=0; component_count integer:=0; element_count integer:=0;
BEGIN
 IF p_raw IS NULL OR octet_length(p_raw)>8388608 THEN RETURN NULL; END IF;
 -- Read advice before CRLF/LF normalization. No inferred repetition grammar.
 body:=p_raw;
 IF upper(left(body,3))='UNA' THEN
  IF left(body,3)<>'UNA' OR char_length(body)<9 THEN RETURN NULL; END IF;
  component_sep:=substr(body,4,1);data_sep:=substr(body,5,1);decimal_mark:=substr(body,6,1);
  release_char:=substr(body,7,1);reserved:=substr(body,8,1);terminator:=substr(body,9,1);body:=substr(body,10);
 END IF;
 IF reserved<>' ' OR decimal_mark NOT IN ('.',',')
 OR decimal_mark=ANY(ARRAY[component_sep,data_sep,release_char,terminator])
 OR (SELECT count(DISTINCT value) FROM unnest(ARRAY[component_sep,data_sep,release_char,terminator]) value)<>4
 OR EXISTS(SELECT FROM unnest(ARRAY[component_sep,data_sep,release_char,terminator]) value
   WHERE ascii(value)<33 OR ascii(value)>126 OR value ~ '[A-Za-z0-9]') THEN RETURN NULL; END IF;
 body:=replace(replace(body,E'\r\n',''),E'\n','');
 IF strpos(body,E'\r')>0 OR right(body,1)<>terminator THEN RETURN NULL; END IF;
 -- NULL delimiter enumerates code points, NOT segments/elements. Exactly one
 -- state machine consumes these; decoded literals are never split again.
 chars:=string_to_array(body,NULL);
 FOREACH ch IN ARRAY chars LOOP
  IF released THEN
   current_component:=current_component||ch;component_size:=component_size+1;released:=false;
  ELSIF ch=release_char THEN released:=true;
  ELSIF ch=component_sep OR ch=data_sep OR ch=terminator THEN
   -- Match canonical leading segment trim. Other whitespace forms are held
   -- explicitly; in particular a released trailing space must not be trimmed.
   IF elements='[]'::jsonb AND current_element='[]'::jsonb THEN current_component:=ltrim(current_component,E' \t'); END IF;
   IF ch=terminator AND current_component<>rtrim(current_component,E' \t') THEN RETURN NULL; END IF;
   IF ch=terminator AND elements='[]'::jsonb AND current_element='[]'::jsonb AND current_component='' THEN CONTINUE; END IF;
   current_element:=current_element||jsonb_build_array(current_component);component_count:=component_count+1;
   current_component:='';component_size:=0;
   IF component_count>128 THEN RETURN NULL; END IF;
   IF ch<>component_sep THEN
    elements:=elements||jsonb_build_array(current_element);element_count:=element_count+1;
    current_element:='[]';component_count:=0;
    IF element_count>128 THEN RETURN NULL; END IF;
   END IF;
   IF ch=terminator THEN
    tag:=elements#>>'{0,0}';
    IF jsonb_array_length(elements->0)<>1 OR tag !~ '^[A-Z]{3}$' OR tag='UNA' THEN RETURN NULL; END IF;
    IF tag='LIN' THEN line_count:=line_count+1; END IF;
    IF segment_count>=100000 OR line_count>4096 THEN RETURN NULL; END IF;
    result:=result||jsonb_build_array(jsonb_build_object('index',segment_count,'tag',tag,'elements',elements));
    segment_count:=segment_count+1;elements:='[]';element_count:=0;
   END IF;
  ELSE current_component:=current_component||ch;component_size:=component_size+1;
  END IF;
  IF component_size>4096 THEN RETURN NULL; END IF;
 END LOOP;
 IF released OR current_component<>'' OR elements<>'[]'::jsonb OR current_element<>'[]'::jsonb THEN RETURN NULL; END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION gridex_utilts_binding.wire_tokens_v1(text) FROM PUBLIC,anon,authenticated,service_role;


-- Private existing insertion/ACK reservation semantics, now environment-scoped.
create or replace function gridex_utilts_binding.persist_series_v1(
  p_company_id uuid,
  p_environment text,
  p_source_message_id uuid,
  p_message_code text,
  p_transactions jsonb
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,extensions set timezone='UTC' as $$
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
REVOKE ALL ON FUNCTION gridex_utilts_binding.persist_series_v1(uuid,text,uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE gridex_utilts_binding.receipts (
 source_message_id uuid PRIMARY KEY REFERENCES public.ediel_messages(id),
 company_id uuid NOT NULL REFERENCES public.companies(id),
 environment text NOT NULL CHECK(environment IN ('test','production')),
 message_code text NOT NULL,
 raw_hash text NOT NULL CHECK(raw_hash ~ '^[0-9a-f]{64}$'),
 source_context jsonb NOT NULL,
 membership jsonb NOT NULL CHECK(jsonb_typeof(membership)='array'),
 contract_version integer NOT NULL CHECK(contract_version=1),
 bound_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(company_id,environment,source_message_id)
);
CREATE TABLE gridex_utilts_binding.contracts (
 series_id uuid PRIMARY KEY REFERENCES public.meter_reading_series(id),
 company_id uuid NOT NULL REFERENCES public.companies(id),
 environment text NOT NULL CHECK(environment IN ('test','production')),
 source_message_id uuid NOT NULL REFERENCES gridex_utilts_binding.receipts(source_message_id),
 transaction_id text NOT NULL,
 contract_version integer NOT NULL CHECK(contract_version=1),
 contract jsonb NOT NULL CHECK(jsonb_typeof(contract)='object'),
 contract_hash text NOT NULL CHECK(contract_hash ~ '^[0-9a-f]{64}$'),
 UNIQUE(company_id,environment,source_message_id,transaction_id),
 FOREIGN KEY(company_id,environment,source_message_id) REFERENCES gridex_utilts_binding.receipts(company_id,environment,source_message_id)
);
CREATE INDEX ON gridex_utilts_binding.contracts(company_id,environment);
ALTER TABLE gridex_utilts_binding.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_utilts_binding.contracts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA gridex_utilts_binding FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_utilts_binding.immutable_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 RAISE EXCEPTION 'utilts_consumption_binding_immutable' USING ERRCODE='P0U01';
END $$;
CREATE TRIGGER utilts_receipt_immutable BEFORE UPDATE OR DELETE ON gridex_utilts_binding.receipts FOR EACH ROW EXECUTE FUNCTION gridex_utilts_binding.immutable_v1();
CREATE TRIGGER utilts_contract_immutable BEFORE UPDATE OR DELETE ON gridex_utilts_binding.contracts FOR EACH ROW EXECUTE FUNCTION gridex_utilts_binding.immutable_v1();

CREATE FUNCTION gridex_utilts_binding.source_context_v1(s public.ediel_messages) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',s.id,'company',s.company_id,'environment',s.environment,'direction',s.direction,
 'family',s.message_family,'code',s.message_code,'sender',s.sender_ediel_id,'receiver',s.receiver_ediel_id,
 'senderSubAddress',s.sender_sub_address,'receiverSubAddress',s.receiver_sub_address,
 'interchange',s.interchange_reference,'transaction',s.transaction_reference,'application',s.application_reference,
 'originalMessage',s.original_message_id,'externalReference',s.external_reference)
$$;
CREATE FUNCTION gridex_utilts_binding.guard_source_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE receipt gridex_utilts_binding.receipts%rowtype;
BEGIN
 SELECT * INTO receipt FROM gridex_utilts_binding.receipts WHERE source_message_id=OLD.id;
 IF FOUND AND (NEW.raw_payload IS DISTINCT FROM OLD.raw_payload OR
   gridex_utilts_binding.source_context_v1(NEW) IS DISTINCT FROM receipt.source_context) THEN
  RAISE EXCEPTION 'utilts_source_binding_conflict' USING ERRCODE='P0U01';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER utilts_bound_source_guard BEFORE UPDATE ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_utilts_binding.guard_source_v1();

CREATE FUNCTION gridex_utilts_binding.exact_keys_v1(v jsonb,k text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN jsonb_typeof(v)='object' THEN
  (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(v) key) =
  (SELECT array_agg(key ORDER BY key) FROM unnest(string_to_array(k,' ')) key)
 ELSE false END
$$;
CREATE FUNCTION gridex_utilts_binding.absolute_v1(v jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE s text:=v#>>'{}';
BEGIN
 RETURN jsonb_typeof(v)='string' AND s ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
   AND to_char(s::timestamptz,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')=s;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE FUNCTION gridex_utilts_binding.validate_contract_v1(c jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE a jsonb; o jsonb; i jsonb; field text; n integer:=0; seen jsonb:='[]'; contribution jsonb;
BEGIN
 IF NOT coalesce(gridex_utilts_binding.exact_keys_v1(c,'version projectionVersion attributionVersion companyId environment messageCode transactionId seriesKind profileKey profileVersion rulePackHash guideRevision interpretation observations metering billing billingContributionOrdinals sourceType'),false)
 OR c->'version' IS DISTINCT FROM '1'::jsonb OR c->>'projectionVersion' IS DISTINCT FROM 'utilts-consumption-v1' OR c->>'attributionVersion' IS DISTINCT FROM 'tenant-match-v1'
 OR c->>'sourceType' IS DISTINCT FROM 'ediel_utilts' OR c->>'environment' NOT IN ('test','production')
 OR jsonb_typeof(c->'observations')<>'array' OR jsonb_typeof(c->'billingContributionOrdinals')<>'array' THEN RETURN false; END IF;
 FOREACH field IN ARRAY ARRAY['environment','companyId','messageCode','transactionId','seriesKind','guideRevision'] LOOP
  IF jsonb_typeof(c->field)<>'string' OR nullif(btrim(c->>field),'') IS NULL THEN RETURN false; END IF;
 END LOOP;
 PERFORM (c->>'companyId')::uuid;
 IF EXISTS(SELECT FROM jsonb_each(c) e WHERE e.key IN ('profileKey','profileVersion','rulePackHash') AND jsonb_typeof(e.value) NOT IN ('string','null')) THEN RETURN false; END IF;
 i:=c->'interpretation';
 IF NOT coalesce(gridex_utilts_binding.exact_keys_v1(i,'localPeriodStart localPeriodEnd localRegistration resolutionValue resolutionFormat timezoneRaw timezoneFormat offsetMinutes timestampPolicy'),false)
 OR jsonb_typeof(i->'timestampPolicy')<>'string' OR i->>'timestampPolicy' NOT IN ('explicit-offset-v1','no-consumption-v1')
 OR (i->'timezoneFormat'<>'null'::jsonb AND i->>'timezoneFormat'<>'406')
 OR (i->'offsetMinutes'<>'null'::jsonb AND (jsonb_typeof(i->'offsetMinutes')<>'number' OR (i->>'offsetMinutes')::numeric<>trunc((i->>'offsetMinutes')::numeric) OR abs((i->>'offsetMinutes')::numeric)>840)) THEN RETURN false; END IF;
 FOREACH field IN ARRAY ARRAY['localPeriodStart','localPeriodEnd','localRegistration','resolutionValue','resolutionFormat','timezoneRaw'] LOOP
  IF jsonb_typeof(i->field) NOT IN ('string','null') THEN RETURN false; END IF;
 END LOOP;
 FOREACH field IN ARRAY ARRAY['metering','billing'] LOOP
  a:=c->field;
  IF NOT coalesce(gridex_utilts_binding.exact_keys_v1(a,'capability reason customerId siteId customerSiteId meteringPointId gridOwnerId sourceRequestId'||CASE WHEN field='billing' THEN ' requestScope periodStart periodEnd month year status sourceSystem currency' ELSE '' END),false)
  OR jsonb_typeof(a->'capability')<>'string' OR a->>'capability' NOT IN ('write','skip') OR (a->>'capability'='skip' AND nullif(a->>'reason','') IS NULL)
  OR (a->>'capability'='write' AND (a->>'customerId' IS NULL OR a->'reason'<>'null'::jsonb OR (field='metering' AND a->>'meteringPointId' IS NULL))) THEN RETURN false; END IF;
  IF EXISTS(SELECT FROM jsonb_each(a) e WHERE e.key IN ('customerId','siteId','customerSiteId','meteringPointId','gridOwnerId','sourceRequestId','reason') AND jsonb_typeof(e.value) NOT IN ('string','null')) THEN RETURN false; END IF;
  IF field='billing' THEN
   IF a->>'status' IS DISTINCT FROM 'received' OR a->>'sourceSystem' IS DISTINCT FROM 'ediel_utilts' OR a->>'currency' IS DISTINCT FROM 'SEK'
   OR (a->'periodStart'<>'null'::jsonb AND NOT gridex_utilts_binding.absolute_v1(a->'periodStart'))
   OR (a->'periodEnd'<>'null'::jsonb AND NOT gridex_utilts_binding.absolute_v1(a->'periodEnd'))
   OR (a->>'capability'='write' AND (a->>'sourceRequestId' IS NULL OR a->>'requestScope'<>'billing_underlay' OR a->>'periodEnd' IS NULL OR a->>'month' IS NULL OR a->>'year' IS NULL)) THEN RETURN false; END IF;
   IF coalesce(a->>'periodEnd',a->>'periodStart') IS NOT NULL AND
    ((a->>'month')::integer IS DISTINCT FROM extract(month FROM coalesce(a->>'periodEnd',a->>'periodStart')::timestamptz)::integer OR
     (a->>'year')::integer IS DISTINCT FROM extract(year FROM coalesce(a->>'periodEnd',a->>'periodStart')::timestamptz)::integer) THEN RETURN false; END IF;
  END IF;
 END LOOP;
 FOR o IN SELECT value FROM jsonb_array_elements(c->'observations') LOOP
  IF NOT coalesce(gridex_utilts_binding.exact_keys_v1(o,'ordinal sourceOrdinal quantity periodStart periodEnd readAt resolution unit quality readingType direction registerCode productCode sourceLineReference externalPoint gridArea'),false)
  OR o->'ordinal' IS DISTINCT FROM to_jsonb(n) OR jsonb_typeof(o->'sourceOrdinal')<>'number' OR (o->>'sourceOrdinal')::numeric<>trunc((o->>'sourceOrdinal')::numeric)
  OR (o->>'sourceOrdinal')::numeric<0 OR seen @> jsonb_build_array(o->'sourceOrdinal')
  OR jsonb_typeof(o->'quantity')<>'number' OR NOT gridex_utilts_binding.absolute_v1(o->'periodStart') OR NOT gridex_utilts_binding.absolute_v1(o->'periodEnd') OR NOT gridex_utilts_binding.absolute_v1(o->'readAt')
  OR o->>'periodStart'>=o->>'periodEnd' OR o->>'unit' IS DISTINCT FROM 'kWh' OR jsonb_typeof(o->'readingType')<>'string' OR o->>'readingType' NOT IN ('consumption','production','estimated','adjustment')
  OR o->>'direction' IS DISTINCT FROM CASE WHEN o->>'readingType'='production' THEN 'production' ELSE 'consumption' END THEN RETURN false; END IF;
  IF EXISTS(SELECT FROM jsonb_each(o) e WHERE e.key IN ('resolution','quality','registerCode','productCode','sourceLineReference','externalPoint','gridArea') AND jsonb_typeof(e.value) NOT IN ('string','null')) THEN RETURN false; END IF;
  seen:=seen||jsonb_build_array(o->'sourceOrdinal'); n:=n+1;
 END LOOP;
 SELECT coalesce(jsonb_agg(x ORDER BY x),'[]') INTO contribution FROM generate_series(0,n-1) x WHERE c#>>'{billing,capability}'='write';
 IF c->'billingContributionOrdinals' IS DISTINCT FROM contribution THEN RETURN false; END IF;
 IF i->>'timestampPolicy'='no-consumption-v1' AND (n<>0 OR c#>>'{metering,capability}'<>'skip' OR c#>>'{billing,capability}'<>'skip') THEN RETURN false; END IF;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE FUNCTION public.gridex_persist_utilts_consumption_v1(p_company_id uuid,p_environment text,p_source_message_id uuid,p_message_code text,p_raw_payload text,p_transactions jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions SET timezone='UTC' AS $$
DECLARE
 source public.ediel_messages%rowtype; receipt gridex_utilts_binding.receipts%rowtype;
 stored gridex_utilts_binding.contracts%rowtype; series public.meter_reading_series%rowtype;
 tokens jsonb; membership jsonb; expected jsonb; raw_hash text; item jsonb; c jsonb; r jsonb; results jsonb; answer jsonb:='[]';
 v_series_id uuid; identity text; contract_hash text; origin gridex_utilts_binding.receipts%rowtype;
BEGIN
 IF p_company_id IS NULL OR p_environment NOT IN ('test','production') OR p_message_code IS NULL OR jsonb_typeof(p_transactions) IS DISTINCT FROM 'array' OR jsonb_array_length(p_transactions)=0 THEN
  RAISE EXCEPTION 'utilts_consumption_input_invalid' USING ERRCODE='P0U01';
 END IF;
 SELECT * INTO source FROM public.ediel_messages WHERE id=p_source_message_id FOR UPDATE;
 IF NOT FOUND OR source.company_id IS DISTINCT FROM p_company_id OR source.environment IS DISTINCT FROM p_environment OR source.direction<>'inbound' OR source.message_family<>'UTILTS' OR source.message_code IS DISTINCT FROM p_message_code
 OR p_raw_payload IS NULL OR source.raw_payload IS DISTINCT FROM p_raw_payload THEN RAISE EXCEPTION 'utilts_source_binding_conflict' USING ERRCODE='P0U01'; END IF;
 raw_hash:=encode(digest(convert_to(source.raw_payload,'UTF8'),'sha256'),'hex');
 tokens:=gridex_utilts_binding.wire_tokens_v1(source.raw_payload);
 IF tokens IS NULL THEN RAISE EXCEPTION 'utilts_physical_membership_unavailable' USING ERRCODE='P0U01'; END IF;
 -- This owner deliberately does not reinterpret multiple physical messages.
 IF (SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='UNH')<>1
 OR NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='UNH' AND t#>>'{elements,2,0}'='UTILTS')
 OR (SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='BGM')<>1
 OR NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='BGM' AND t#>>'{elements,1,0}'=p_message_code) THEN
  RAISE EXCEPTION 'utilts_physical_membership_unavailable' USING ERRCODE='P0U01'; END IF;
 SELECT coalesce(jsonb_agg(coalesce(nullif(t#>>'{elements,2,0}',''),'transaction-'||ordinal::text) ORDER BY ordinal),'["transaction-1"]') INTO membership
 FROM (SELECT t,row_number() OVER(ORDER BY (t->>'index')::integer) ordinal FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='IDE' AND t#>>'{elements,1,0}'='24') physical;
 SELECT jsonb_agg(t->'transactionId' ORDER BY ordinal) INTO expected FROM jsonb_array_elements(p_transactions) WITH ORDINALITY x(t,ordinal);
 IF membership IS DISTINCT FROM expected OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(membership))<>jsonb_array_length(membership) THEN
  RAISE EXCEPTION 'utilts_physical_membership_conflict' USING ERRCODE='P0U01'; END IF;
 SELECT * INTO receipt FROM gridex_utilts_binding.receipts WHERE source_message_id=p_source_message_id;
 IF NOT FOUND THEN
  IF EXISTS(SELECT FROM public.ediel_ack_transaction_results WHERE source_message_id=p_source_message_id)
  OR EXISTS(SELECT FROM public.meter_reading_series WHERE source_ediel_message_id=p_source_message_id) THEN
   RAISE EXCEPTION 'utilts_historical_binding_unavailable' USING ERRCODE='P0U01'; END IF;
  INSERT INTO gridex_utilts_binding.receipts(source_message_id,company_id,environment,message_code,raw_hash,source_context,membership,contract_version)
   VALUES(p_source_message_id,p_company_id,p_environment,p_message_code,raw_hash,gridex_utilts_binding.source_context_v1(source),membership,1) RETURNING * INTO receipt;
 ELSIF receipt.raw_hash IS DISTINCT FROM raw_hash OR receipt.source_context IS DISTINCT FROM gridex_utilts_binding.source_context_v1(source) OR receipt.membership IS DISTINCT FROM membership THEN
  RAISE EXCEPTION 'utilts_source_binding_conflict' USING ERRCODE='P0U01';
 END IF;
 -- Acquire all locks before insertion, in stable order (including the private
 -- insertion core's logical-series lock) to avoid opposite-order batch deadlocks.
 FOR item IN SELECT value FROM jsonb_array_elements(p_transactions) ORDER BY value->>'transactionId' LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended(p_company_id::text||'|'||p_environment||'|'||p_source_message_id::text||'|'||(item->>'transactionId'),0));
 END LOOP;
 FOR identity IN SELECT DISTINCT concat_ws('|',p_company_id::text,p_environment,coalesce(t->>'seriesKind','actual'),p_message_code,coalesce(t->>'externalMeteringPointId',''),coalesce(t->>'gridAreaId',''),coalesce(t->>'periodStart',''),coalesce(t->>'periodEnd',''),coalesce(t->>'resolution','UNKNOWN'),coalesce(t->>'productId','')) FROM jsonb_array_elements(p_transactions) t ORDER BY 1 LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended(identity,0));
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(p_transactions) LOOP
  c:=item->'consumptionContract';
  IF NOT coalesce(gridex_utilts_binding.validate_contract_v1(c),false) OR c->>'companyId' IS DISTINCT FROM p_company_id::text OR c->>'environment' IS DISTINCT FROM p_environment
   OR c->>'messageCode' IS DISTINCT FROM p_message_code OR c->>'transactionId' IS DISTINCT FROM item->>'transactionId' OR c->>'seriesKind' IS DISTINCT FROM item->>'seriesKind' THEN
   RAISE EXCEPTION 'utilts_consumption_contract_invalid' USING ERRCODE='P0U01'; END IF;
 END LOOP;
 results:=gridex_utilts_binding.persist_series_v1(p_company_id,p_environment,p_source_message_id,p_message_code,p_transactions);
 FOR r IN SELECT value FROM jsonb_array_elements(results) LOOP
  SELECT value INTO STRICT item FROM jsonb_array_elements(p_transactions) WHERE value->>'transactionId'=r->>'transactionId';
  c:=item->'consumptionContract';
  IF r->>'persistenceStatus'='persisted' THEN
   v_series_id:=(r->>'seriesId')::uuid;
   SELECT * INTO series FROM public.meter_reading_series WHERE id=v_series_id AND company_id=p_company_id FOR SHARE;
   IF NOT FOUND OR series.message_code IS DISTINCT FROM p_message_code OR series.source_transaction_reference IS DISTINCT FROM item->>'transactionId'
    OR jsonb_typeof(series.raw_transaction) IS DISTINCT FROM 'object' OR series.immutable_hash IS DISTINCT FROM encode(digest(convert_to(series.raw_transaction::text,'UTF8'),'sha256'),'hex')
    OR series.raw_transaction IS DISTINCT FROM item THEN RAISE EXCEPTION 'utilts_consumption_raw_conflict' USING ERRCODE='P0U01'; END IF;
   SELECT * INTO origin FROM gridex_utilts_binding.receipts WHERE source_message_id=series.source_ediel_message_id;
   IF NOT FOUND OR origin.company_id<>p_company_id OR origin.environment<>p_environment OR origin.message_code<>p_message_code THEN RAISE EXCEPTION 'utilts_consumption_origin_conflict' USING ERRCODE='P0U01'; END IF;
   SELECT * INTO stored FROM gridex_utilts_binding.contracts WHERE contracts.series_id=v_series_id;
   IF NOT FOUND THEN
    IF coalesce((r->>'idempotentReplay')::boolean,true) THEN RAISE EXCEPTION 'utilts_historical_contract_unavailable' USING ERRCODE='P0U01'; END IF;
    INSERT INTO gridex_utilts_binding.contracts(series_id,company_id,environment,source_message_id,transaction_id,contract_version,contract,contract_hash)
     VALUES(v_series_id,p_company_id,p_environment,p_source_message_id,item->>'transactionId',1,c,encode(digest(convert_to(c::text,'UTF8'),'sha256'),'hex')) RETURNING * INTO stored;
   END IF;
   contract_hash:=encode(digest(convert_to(stored.contract::text,'UTF8'),'sha256'),'hex');
   IF stored.company_id<>p_company_id OR stored.environment<>p_environment OR stored.transaction_id<>item->>'transactionId' OR stored.contract_version<>1
    OR NOT coalesce(gridex_utilts_binding.validate_contract_v1(stored.contract),false) OR stored.contract_hash IS DISTINCT FROM contract_hash OR stored.contract IS DISTINCT FROM c THEN
    RAISE EXCEPTION 'utilts_consumption_contract_conflict' USING ERRCODE='P0U01'; END IF;
   r:=r||jsonb_build_object('contractVersion',stored.contract_version,'contractHash',stored.contract_hash,'consumptionContract',stored.contract);
  END IF;
  answer:=answer||jsonb_build_array(r||jsonb_build_object('sourceBinding',jsonb_build_object('sourceMessageId',receipt.source_message_id,'rawHash',receipt.raw_hash,'boundAt',receipt.bound_at)));
 END LOOP;
 RETURN answer;
END $$;

-- No successful unbound alternative remains, even for an old service caller.
CREATE OR REPLACE FUNCTION public.gridex_persist_utilts_transactions_v1(p_company_id uuid,p_environment text,p_source_message_id uuid,p_message_code text,p_transactions jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 RAISE EXCEPTION 'utilts_consumption_contract_required' USING ERRCODE='P0U01';
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_utilts_binding FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.gridex_persist_utilts_transactions_v1(uuid,text,uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.gridex_persist_utilts_consumption_v1(uuid,text,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_persist_utilts_consumption_v1(uuid,text,uuid,text,text,jsonb) TO service_role;
COMMIT;
