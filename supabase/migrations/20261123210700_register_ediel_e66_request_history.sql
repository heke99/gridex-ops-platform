-- Read network-owner request coverage from the exact sent E73 and bounded native E66 receipts.
SET lock_timeout = '5s';
SET statement_timeout = '60s';
DO $e66_history_migration$
BEGIN
ALTER TABLE public.inbound_email_messages ADD COLUMN received_at_source text;

ALTER TABLE public.inbound_email_messages ADD CONSTRAINT inbound_email_messages_received_at_source_check
CHECK (received_at_source IS NULL OR (
  received_at_source IN ('imap_internal_date','poll_observed_at')
  AND imap_uid IS NOT NULL AND raw_mailbox_bytes_sha256 IS NOT NULL
  AND received_at IS NOT NULL AND isfinite(received_at)
)) NOT VALID;

CREATE FUNCTION gridex_ediel_inbound_receptions.guard_mail_clock_v1()
RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog
AS $clock$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.received_at_source IS NOT NULL AND current_setting('role',true) IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='ediel_mail_clock_ingress_role_required';
    END IF;
  ELSIF NEW.received_at_source IS DISTINCT FROM OLD.received_at_source
     OR (OLD.received_at_source IS NOT NULL AND NEW.received_at IS DISTINCT FROM OLD.received_at) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='ediel_mail_clock_provenance_immutable';
  END IF;
  RETURN NEW;
END;
$clock$;

REVOKE ALL ON FUNCTION gridex_ediel_inbound_receptions.guard_mail_clock_v1() FROM PUBLIC,anon,authenticated,service_role;

CREATE TRIGGER ediel_mail_clock_provenance_immutable
BEFORE INSERT OR UPDATE ON public.inbound_email_messages
FOR EACH ROW EXECUTE FUNCTION gridex_ediel_inbound_receptions.guard_mail_clock_v1();

CREATE FUNCTION public.gridex_read_ediel_inbound_receipt_clock_v1(p_company_id uuid,p_source_message_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO pg_catalog SET TimeZone TO 'UTC'
AS $clock$
DECLARE result jsonb;
BEGIN
  IF current_setting('role',true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='ediel_clock_service_role_required';
  END IF;
  SELECT jsonb_build_object('receivedAt',r.received_at,'source',mail.received_at_source)
  INTO result
  FROM gridex_ediel_inbound_receptions.receptions r
  JOIN public.ediel_messages m ON (m.company_id,m.id,m.environment)=(r.company_id,r.source_message_id,r.environment)
  JOIN public.inbound_email_messages mail ON mail.id=r.inbound_email_message_id
  WHERE (r.company_id,r.source_message_id)=(p_company_id,p_source_message_id)
    AND r.classification='first_reception'
    AND m.direction='inbound' AND m.message_standard='edifact'
    AND m.inbound_email_message_id=mail.id AND m.mailbox_message_id=mail.id::text
    AND m.message_received_at=r.received_at AND mail.received_at=r.received_at
    AND (mail.company_id IS NULL OR mail.company_id=r.company_id)
    AND (mail.environment IS NULL OR mail.environment=r.environment)
    AND mail.received_at_source IN ('imap_internal_date','poll_observed_at')
    AND mail.imap_uid IS NOT NULL AND mail.raw_mailbox_bytes_sha256 ~ '^[0-9a-f]{64}$'
    AND r.transport_source_snapshot->>'mailboxId'=mail.mailbox_id::text
    AND mail.raw_message_sha256 ~ '^[0-9a-f]{64}$'
    AND r.transport_source_snapshot->>'rawMessageSha256'=mail.raw_message_sha256;
  RETURN result;
END;
$clock$;

REVOKE ALL ON FUNCTION public.gridex_read_ediel_inbound_receipt_clock_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_read_ediel_inbound_receipt_clock_v1(uuid,uuid) TO service_role;

DO $verified_imap_clock$
DECLARE
  original oid := to_regprocedure('public.gridex_store_verified_imap_intake_v1(jsonb,jsonb)');
  definition text;
  previous_metadata jsonb;
  insert_columns constant text := 'subject,received_at,raw_email,raw_edifact_payload,';
  insert_values constant text := 'proposed.subject,proposed.received_at,proposed.raw_email,proposed.raw_edifact_payload,';
BEGIN
  SELECT to_jsonb(p)-'prosrc' INTO previous_metadata FROM pg_proc p WHERE p.oid=original;
  IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=original)
      IS DISTINCT FROM '8a797ebdf47b92c460c3ea43c2b94555e70edf9e3fc8902239aca8c59b447908'
  THEN RAISE EXCEPTION 'ediel_clock_requires_verified_imap_intake_predecessor' USING ERRCODE='55000'; END IF;
  definition := pg_get_functiondef(original);
  IF length(definition)-length(replace(definition,insert_columns,'')) <> length(insert_columns)
    OR length(definition)-length(replace(definition,insert_values,'')) <> length(insert_values)
  THEN RAISE EXCEPTION 'ediel_clock_verified_imap_intake_insert_shape_changed' USING ERRCODE='55000'; END IF;
  definition := replace(definition,insert_columns,'subject,received_at,received_at_source,raw_email,raw_edifact_payload,');
  definition := replace(definition,insert_values,'proposed.subject,proposed.received_at,proposed.received_at_source,proposed.raw_email,proposed.raw_edifact_payload,');
  EXECUTE definition;
  IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=original) IS DISTINCT FROM previous_metadata
  THEN RAISE EXCEPTION 'ediel_clock_verified_imap_intake_authority_changed' USING ERRCODE='55000'; END IF;
END
$verified_imap_clock$;

CREATE FUNCTION gridex_utilts_binding.e73_request_wire_range_v1(raw text, environment text, expected_point text)
RETURNS tstzrange
LANGUAGE plpgsql IMMUTABLE SET search_path TO pg_catalog
AS $request$
DECLARE
  tokens jsonb:=gridex_utilts_binding.wire_tokens_v1(raw);
  wire jsonb;
  period_segments jsonb;
  compact text;
  lower_bound timestamptz;
  upper_bound timestamptz;
  ide_index integer;
  unt_index integer;
BEGIN
  IF tokens IS NULL OR expected_point IS NULL OR environment IS NULL
     OR environment NOT IN ('test','production') THEN RETURN NULL; END IF;
  wire:=gridex_ack_authority.wire_v1(raw);
  IF wire->>'code' IS DISTINCT FROM 'E73' OR wire->>'family' IS DISTINCT FROM 'UTILTS'
     OR wire->>'environment' IS DISTINCT FROM environment
     OR NOT coalesce(wire->>'app' IN (
        '23-DDQ-E66-'||CASE environment WHEN 'test' THEN 'T' ELSE 'S' END,
        '23-DGI-E66-'||CASE environment WHEN 'test' THEN 'T' ELSE 'S' END),false)
     OR jsonb_array_length(wire->'ide') IS DISTINCT FROM 1
     OR wire->'ideQualifierInvalid'='true'::jsonb
     OR jsonb_array_length(wire#>'{refs,E66}') IS DISTINCT FROM 1
     OR gridex_utilts_binding.supported_point_v1(tokens,wire#>>'{ide,0}') IS DISTINCT FROM expected_point
    THEN RETURN NULL; END IF;
  SELECT (t->>'index')::integer INTO STRICT ide_index
  FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='IDE';
  unt_index:=(wire->>'untIndex')::integer;
  SELECT jsonb_agg(t) INTO period_segments FROM jsonb_array_elements(tokens) t
  WHERE t->>'tag'='DTM' AND t#>>'{elements,1,0}'='324';
  IF NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) t
      WHERE t->>'tag'='RFF' AND t#>'{elements,1}'='["E66"]'::jsonb
        AND (t->>'index')::integer BETWEEN ide_index+1 AND unt_index-1)
    OR (SELECT count(*) FROM jsonb_array_elements(tokens) t
        WHERE t->>'tag'='DTM' AND t#>>'{elements,1,0}'='735')<>1
    OR NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='DTM'
         AND t#>'{elements,1}'='["735","+0100","406"]'::jsonb
         AND (t->>'index')::integer BETWEEN (wire->>'unhIndex')::integer+1 AND ide_index-1)
    THEN RETURN NULL; END IF;
  IF jsonb_array_length(period_segments) IS DISTINCT FROM 1
     OR (period_segments#>>'{0,index}')::integer NOT BETWEEN ide_index+1 AND unt_index-1
     OR jsonb_array_length(period_segments#>'{0,elements,1}') IS DISTINCT FROM 3
     OR period_segments#>>'{0,elements,1,2}' IS DISTINCT FROM '719' THEN RETURN NULL; END IF;
  compact:=period_segments#>>'{0,elements,1,1}';
  IF NOT coalesce(compact ~ '^[0-9]{24}$',false) THEN RETURN NULL; END IF;
  lower_bound:=make_timestamp(substr(compact,1,4)::integer,substr(compact,5,2)::integer,
      substr(compact,7,2)::integer,substr(compact,9,2)::integer,substr(compact,11,2)::integer,0)
      AT TIME ZONE interval '+01:00';
  upper_bound:=make_timestamp(substr(compact,13,4)::integer,substr(compact,17,2)::integer,
      substr(compact,19,2)::integer,substr(compact,21,2)::integer,substr(compact,23,2)::integer,0)
      AT TIME ZONE interval '+01:00';
  IF lower_bound>=upper_bound OR
      to_char(lower_bound AT TIME ZONE interval '+01:00','YYYYMMDDHH24MI')||
      to_char(upper_bound AT TIME ZONE interval '+01:00','YYYYMMDDHH24MI') IS DISTINCT FROM compact
    THEN RETURN NULL; END IF;
  RETURN tstzrange(lower_bound,upper_bound,'[)');
EXCEPTION WHEN datetime_field_overflow THEN RETURN NULL;
END
$request$;
REVOKE ALL ON FUNCTION gridex_utilts_binding.e73_request_wire_range_v1(text,text,text)
FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_utilts_binding.e73_request_candidate_ids_v1(
 p_company_id uuid,p_request_id uuid,p_environment text
) RETURNS uuid[]
LANGUAGE sql STABLE SET search_path TO pg_catalog
AS $scope$
  SELECT array_agg(candidate.id)
  FROM (
    SELECT m.id
    FROM public.grid_owner_data_requests q JOIN public.ediel_messages m
      ON (m.company_id,m.grid_owner_data_request_id,m.metering_point_id)=(q.company_id,q.id,q.metering_point_id)
     AND m.customer_id IS NOT DISTINCT FROM q.customer_id
    WHERE (q.company_id,q.id,m.environment)=(p_company_id,p_request_id,p_environment)
      AND q.request_scope IN ('meter_values','billing_underlay')
      AND m.direction='outbound' AND m.message_family='UTILTS' AND m.message_standard='edifact'
      AND m.message_code='E73' AND m.status IN ('sent','acknowledged') AND m.message_sent_at IS NOT NULL
    LIMIT 2
  ) candidate;
$scope$;
REVOKE ALL ON FUNCTION gridex_utilts_binding.e73_request_candidate_ids_v1(uuid,uuid,text)
FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_utilts_binding.e73_sent_request_range_v1(
  p_company_id uuid,p_request_id uuid,p_environment text
) RETURNS tstzrange
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog
AS $request$
DECLARE
  original public.ediel_messages%rowtype;
  scoped_ids uuid[];
  latest_ids uuid[];
  point text;
BEGIN
  IF current_setting('role',true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='e73_request_range_service_required';
  END IF;
  scoped_ids:=gridex_utilts_binding.e73_request_candidate_ids_v1(p_company_id,p_request_id,p_environment);
  IF cardinality(scoped_ids) IS DISTINCT FROM 1 THEN RETURN NULL; END IF;
  SELECT m.* INTO original FROM public.ediel_messages m JOIN public.grid_owner_data_requests q
    ON (m.company_id,m.grid_owner_data_request_id,m.metering_point_id)=(q.company_id,q.id,q.metering_point_id)
   AND m.customer_id IS NOT DISTINCT FROM q.customer_id
  WHERE (q.company_id,q.id,m.environment,m.id)=(p_company_id,p_request_id,p_environment,scoped_ids[1])
    AND q.request_scope IN ('meter_values','billing_underlay')
    AND m.direction='outbound' AND m.message_family='UTILTS' AND m.message_standard='edifact' AND m.message_code='E73'
  FOR SHARE OF m,q;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT mp.normalized_metering_point_id INTO point
  FROM public.metering_points mp
  WHERE (mp.company_id,mp.id)=(original.company_id,original.metering_point_id)
    AND mp.customer_id IS NOT DISTINCT FROM original.customer_id FOR SHARE;
  IF NOT FOUND OR point IS NULL THEN RETURN NULL; END IF;
  BEGIN
    PERFORM gridex_ediel_outbound_owner.require_v1(original.company_id,original.id);
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT IN ('ediel_historical_outbound_owner_witness_unavailable','ediel_outbound_owner_witness_scope_invalid') THEN RAISE; END IF;
    RETURN NULL;
  END;
  BEGIN
    IF gridex_received_sources.sent_source_is_current_v1(original) IS NOT TRUE THEN RETURN NULL; END IF;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ediel_accepted_projection_ambiguous' THEN RAISE; END IF;
    RETURN NULL;
  END;
  latest_ids:=gridex_utilts_binding.e73_request_candidate_ids_v1(p_company_id,p_request_id,p_environment);
  IF latest_ids IS DISTINCT FROM scoped_ids THEN RETURN NULL; END IF;
  RETURN gridex_utilts_binding.e73_request_wire_range_v1(original.raw_payload,p_environment,point);
END
$request$;
REVOKE ALL ON FUNCTION gridex_utilts_binding.e73_sent_request_range_v1(uuid,uuid,text)
FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.gridex_read_e66_request_response_history_v1(
  p_company_id uuid,p_request_id uuid,p_environment text,p_limit integer DEFAULT 100
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO pg_catalog SET TimeZone TO 'UTC'
AS $history$
DECLARE result jsonb;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='e66_request_history_service_required';
 END IF;
 IF p_company_id IS NULL OR p_request_id IS NULL OR p_environment IS NULL
   OR p_environment NOT IN ('test','production') OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='e66_request_history_invalid_scope';
 END IF;

 WITH request AS MATERIALIZED (
   SELECT q.id,q.company_id,q.customer_id,q.metering_point_id,q.external_reference,
      gridex_utilts_binding.e73_sent_request_range_v1(p_company_id,p_request_id,p_environment) AS requested_range
   FROM public.grid_owner_data_requests q
   WHERE (q.company_id,q.id)=(p_company_id,p_request_id) AND q.metering_point_id IS NOT NULL
     AND q.request_scope IN ('meter_values','billing_underlay')
 ), observed_sources AS MATERIALIZED (
   SELECT m.id,m.external_reference,
      (SELECT public.gridex_read_ediel_inbound_receipt_clock_v1(m.company_id,m.id)) AS receipt,
      links.value_count,links.current_count
   FROM request q JOIN public.ediel_messages m
       ON (m.company_id,m.grid_owner_data_request_id,m.environment)=(q.company_id,q.id,p_environment)
   CROSS JOIN LATERAL (
      SELECT count(DISTINCT v.id) AS value_count,count(DISTINCT v.id) FILTER(WHERE v.is_current) AS current_count
      FROM public.metering_value_sources l JOIN public.metering_values v
        ON (v.company_id,v.id)=(l.company_id,l.metering_value_id)
      WHERE (l.company_id,l.source_ediel_message_id,l.source_type)=(m.company_id,m.id,'ediel_utilts')
        AND (v.source_request_id,v.metering_point_id)=(q.id,q.metering_point_id)
        AND v.customer_id IS NOT DISTINCT FROM q.customer_id
   ) links
   WHERE m.direction='inbound' AND m.message_standard='edifact'
      AND m.message_family='UTILTS' AND m.message_code='E66'
      AND m.metering_point_id=q.metering_point_id AND m.customer_id IS NOT DISTINCT FROM q.customer_id
      AND links.value_count>0
   LIMIT p_limit+1
 ), coverage AS (
   SELECT q.requested_range,
     coalesce((
       SELECT range_agg(q.requested_range *
          CASE WHEN v.period_end>v.period_start THEN tstzrange(v.period_start,v.period_end,'[)') END)
       FROM public.metering_values v
       WHERE (v.company_id,v.source_request_id,v.metering_point_id)=(q.company_id,q.id,q.metering_point_id)
         AND v.customer_id IS NOT DISTINCT FROM q.customer_id AND v.is_current
         AND v.revision_status='current' AND v.source_system='ediel_utilts'
         AND v.reading_type='consumption' AND v.direction='consumption'
         AND isfinite(v.period_start) AND isfinite(v.period_end)
         AND v.period_end>lower(q.requested_range) AND v.period_start<upper(q.requested_range)
         AND EXISTS (SELECT FROM public.metering_value_sources l
             JOIN observed_sources own ON own.id=l.source_ediel_message_id
             WHERE (l.company_id,l.metering_value_id,l.source_type)=(v.company_id,v.id,'ediel_utilts')
               AND l.source_ediel_message_id=v.source_ediel_message_id
               AND l.source_transaction_reference=v.source_transaction_reference)
     ),'{}'::tstzmultirange) AS covered
   FROM request q
   WHERE q.requested_range IS NOT NULL
     AND (SELECT count(*) FROM observed_sources)<=p_limit
 ), gaps AS (
   SELECT c.requested_range,c.covered,tstzmultirange(c.requested_range)-c.covered AS remaining
   FROM coverage c
 ), facts AS (
   SELECT id,external_reference,value_count,current_count,
       CASE WHEN receipt->>'source'='imap_internal_date' THEN (receipt->>'receivedAt')::timestamptz END AS observed_at
   FROM observed_sources
 )
 SELECT jsonb_build_object('requestId',q.id,'requestReference',q.external_reference,
   'responseCount',(SELECT count(*) FROM facts),
   'coverage',(SELECT jsonb_build_object('requestedFrom',lower(g.requested_range),
     'requestedUntil',upper(g.requested_range),
     'coveredSeconds',(SELECT coalesce(sum(extract(epoch FROM upper(r)-lower(r))),0) FROM unnest(g.covered) r),
     'remainingSeconds',(SELECT coalesce(sum(extract(epoch FROM upper(r)-lower(r))),0) FROM unnest(g.remaining) r),
     'remainingGapCount',(SELECT count(*) FROM unnest(g.remaining)),
     'remainingGaps',(SELECT coalesce(jsonb_agg(jsonb_build_object('from',lower(r),'until',upper(r))
                                ORDER BY lower(r)),'[]'::jsonb) FROM unnest(g.remaining) r)) FROM gaps g),
   'firstObservedAt',(SELECT min(f.observed_at) FROM facts f),
   'latestObservedAt',(SELECT max(f.observed_at) FROM facts f),
   'responses',(SELECT coalesce(jsonb_agg(jsonb_build_object('sourceMessageId',f.id,
       'responseReference',f.external_reference,'observedAt',f.observed_at,
       'storedValueCount',f.value_count,'currentValueCount',f.current_count)
       ORDER BY f.observed_at NULLS LAST,f.id),'[]'::jsonb) FROM facts f))
 INTO result FROM request q;
 IF coalesce((result->>'responseCount')::integer,0)>p_limit THEN
   RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='e66_request_history_capacity';
 END IF;
 RETURN result;
END
$history$;
REVOKE ALL ON FUNCTION public.gridex_read_e66_request_response_history_v1(uuid,uuid,text,integer)
FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_read_e66_request_response_history_v1(uuid,uuid,text,integer) TO service_role;

END
$e66_history_migration$;
RESET statement_timeout;
RESET lock_timeout;
