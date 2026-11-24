DO $gridex_e66_calendar_migration$
BEGIN
-- Project accepted E66 observations into whole Swedish civil months at the
-- existing intake sink. Legacy underlay IDs and immutable contracts stay valid.
DO $precondition$
BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure(
  'gridex_e66_intake.consume_owned_utilts_billing_v1(uuid,uuid,uuid,jsonb)'))
  IS DISTINCT FROM '4b0d487ff93c0c287da776920764599c'
 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure(
  'gridex_e66_intake.bound_underlay_fingerprint_v1(uuid,uuid,uuid)'))
  IS DISTINCT FROM '31c63932bcdb20230c25e31a8761daff'
 THEN RAISE EXCEPTION 'e66_billing_calendar_predecessor_changed'; END IF;
END
$precondition$;

CREATE TABLE gridex_e66_intake.billing_calendar_receipts (
 company_id uuid NOT NULL,
 source_id uuid NOT NULL,
 environment text NOT NULL CHECK (environment IN ('test','production')),
 billing_year integer NOT NULL CHECK (billing_year BETWEEN 2000 AND 2100),
 billing_month integer NOT NULL CHECK (billing_month BETWEEN 1 AND 12),
 underlay_id uuid NOT NULL UNIQUE,
 row_fingerprint text NOT NULL CHECK (row_fingerprint ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY (company_id,source_id,environment,billing_year,billing_month)
);
ALTER TABLE gridex_e66_intake.billing_calendar_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_e66_intake.billing_calendar_receipts FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_e66_intake.billing_calendar_member_hash_v1(b public.billing_underlays)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $member$
 SELECT encode(sha256(convert_to(jsonb_build_array(
  b.id,b.company_id,b.customer_id,b.site_id,b.customer_site_id,b.metering_point_id,b.grid_owner_id,
  b.source_request_id,b.underlay_year,b.underlay_month,b.total_kwh,b.currency,b.source_system,
  b.source_meter_value_count,b.payload->'edielMessageId',b.payload->'consumptionContracts',
  b.payload->'e73BillingScope',b.payload->'billingCalendar'
 )::text,'UTF8')),'hex')
$member$;
REVOKE ALL ON FUNCTION gridex_e66_intake.billing_calendar_member_hash_v1(public.billing_underlays)
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_e66_intake.guard_billing_calendar_member_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $member_guard$
BEGIN
 IF EXISTS(
  SELECT FROM gridex_e66_intake.billing_calendar_receipts r
  WHERE r.underlay_id=OLD.id AND (
   NEW.company_id IS DISTINCT FROM OLD.company_id
   OR NEW.source_system IS DISTINCT FROM OLD.source_system
   OR NEW.underlay_year IS DISTINCT FROM OLD.underlay_year
   OR NEW.underlay_month IS DISTINCT FROM OLD.underlay_month
   OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
   OR NEW.site_id IS DISTINCT FROM OLD.site_id
   OR NEW.customer_site_id IS DISTINCT FROM OLD.customer_site_id
   OR NEW.metering_point_id IS DISTINCT FROM OLD.metering_point_id
   OR NEW.grid_owner_id IS DISTINCT FROM OLD.grid_owner_id
   OR NEW.source_request_id IS DISTINCT FROM OLD.source_request_id
   OR NEW.total_kwh IS DISTINCT FROM OLD.total_kwh
   OR NEW.source_meter_value_count IS DISTINCT FROM OLD.source_meter_value_count
   OR NEW.currency IS DISTINCT FROM OLD.currency
   OR NEW.id IS DISTINCT FROM OLD.id
   OR ((NEW.payload->'edielMessageId',NEW.payload->'consumptionContracts',
        NEW.payload->'e73BillingScope',NEW.payload->'billingCalendar')
       IS DISTINCT FROM (OLD.payload->'edielMessageId',OLD.payload->'consumptionContracts',
        OLD.payload->'e73BillingScope',OLD.payload->'billingCalendar')
       AND public.ediel_is_qualified_finance_retention_transition_v1(
         TG_TABLE_SCHEMA,TG_TABLE_NAME,to_jsonb(OLD),to_jsonb(NEW)) IS NOT TRUE)
  )
 ) THEN RAISE EXCEPTION 'e66_billing_calendar_member_immutable' USING ERRCODE='P0U01'; END IF;
 RETURN NEW;
END
$member_guard$;
REVOKE ALL ON FUNCTION gridex_e66_intake.guard_billing_calendar_member_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER e66_billing_calendar_member_guard
 BEFORE UPDATE OF id,company_id,customer_id,site_id,customer_site_id,metering_point_id,grid_owner_id,source_request_id,
 underlay_year,underlay_month,total_kwh,currency,source_system,source_meter_value_count,payload ON public.billing_underlays
 FOR EACH ROW EXECUTE FUNCTION gridex_e66_intake.guard_billing_calendar_member_v1();

-- The generic CIS export queue also accepts raw underlay IDs. Keep this
-- diagnostic projection separate from the normalized monthly export owner.
CREATE FUNCTION gridex_e66_intake.guard_billing_calendar_partner_export_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $export_guard$
BEGIN
 IF NEW.export_kind='billing_underlay' AND EXISTS(
  SELECT FROM gridex_e66_intake.billing_calendar_receipts r WHERE r.underlay_id=NEW.billing_underlay_id
 ) THEN RAISE EXCEPTION 'billing_qualified_month_underlay_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END
$export_guard$;
REVOKE ALL ON FUNCTION gridex_e66_intake.guard_billing_calendar_partner_export_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER e66_billing_calendar_partner_export_guard
 BEFORE INSERT OR UPDATE OF billing_underlay_id,export_kind ON public.partner_exports
 FOR EACH ROW EXECUTE FUNCTION gridex_e66_intake.guard_billing_calendar_partner_export_v1();

CREATE OR REPLACE FUNCTION gridex_e66_intake.bound_underlay_fingerprint_v1(p_company uuid,p_source uuid,p_underlay uuid)
RETURNS text LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE v_receipt gridex_e66_intake.billing_calendar_receipts%rowtype; v_member record; v_members jsonb:='[]'::jsonb;
BEGIN
 SELECT * INTO v_receipt FROM gridex_e66_intake.billing_calendar_receipts r
 WHERE r.underlay_id=p_underlay AND r.company_id=p_company AND r.source_id=p_source;
 IF FOUND THEN
  IF EXISTS(
   SELECT FROM gridex_e66_intake.billing_calendar_receipts r
   WHERE (r.company_id,r.source_id,r.environment)=(p_company,p_source,v_receipt.environment)
    AND (r.billing_year,r.billing_month)<(v_receipt.billing_year,v_receipt.billing_month)
  ) THEN RETURN NULL; END IF;
  FOR v_member IN
   SELECT r.underlay_id,r.billing_year,r.billing_month,r.row_fingerprint
   FROM gridex_e66_intake.billing_calendar_receipts r
   WHERE (r.company_id,r.source_id,r.environment)=(p_company,p_source,v_receipt.environment)
   ORDER BY r.billing_year,r.billing_month
  LOOP
   IF NOT EXISTS (
    SELECT FROM public.billing_underlays b
    WHERE b.id=v_member.underlay_id AND b.company_id=p_company
     AND gridex_e66_intake.billing_calendar_member_hash_v1(b)=v_member.row_fingerprint
    FOR SHARE OF b
   ) THEN RETURN NULL; END IF;
   v_members:=v_members||jsonb_build_array(jsonb_build_array(
    v_member.underlay_id,v_member.billing_year,v_member.billing_month,v_member.row_fingerprint));
  END LOOP;
  RETURN encode(sha256(convert_to(v_members::text,'UTF8')),'hex');
 END IF;
 RETURN (
 SELECT encode(sha256(convert_to((jsonb_build_array(
   b.id,b.company_id,b.customer_id,b.site_id,b.customer_site_id,b.metering_point_id,b.grid_owner_id,
   b.source_request_id,b.underlay_year,b.underlay_month,b.total_kwh,b.currency,b.source_system,
   b.payload->'edielMessageId',b.payload->'consumptionContracts'
 ) || CASE WHEN b.payload ? 'e73BillingScope'
   THEN jsonb_build_array(b.payload->'e73BillingScope')
   ELSE '[]'::jsonb END)::text,'UTF8')),'hex')
 FROM public.billing_underlays b
 WHERE b.id=p_underlay AND b.company_id=p_company AND b.source_system='ediel_utilts'
   AND b.payload->>'edielMessageId'=p_source::text
 FOR SHARE OF b
 );
END
$$;

CREATE OR REPLACE FUNCTION gridex_e66_intake.consume_owned_utilts_billing_v1(p_company_id uuid,p_source_message_id uuid,p_actor_id uuid,p_expected_contracts jsonb)
RETURNS public.billing_underlays LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions SET timezone='UTC' AS $$
DECLARE v_transaction text; v_contract jsonb; v_context jsonb; v_contracts jsonb:='[]'; v_total numeric:=0; v_ordinal jsonb;
 v_result public.billing_underlays%rowtype; v_source public.ediel_messages%rowtype;
 v_sent_range tstzrange; v_scoped_total numeric; v_start timestamptz; v_end timestamptz;
 v_contribution_count integer:=0; v_scoped_count integer; v_scope jsonb; v_ordinals jsonb;
 v_receipt_id uuid; v_found_id uuid; v_month record; v_primary public.billing_underlays%rowtype;
 v_calendar jsonb; v_contract_sha256 text; v_projected_count bigint:=0; v_projected_total numeric:=0;
BEGIN
 SELECT s.* INTO v_source FROM public.ediel_messages s WHERE s.id=p_source_message_id AND s.company_id=p_company_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'utilts_consumption_source_unavailable' USING ERRCODE='P0U01'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('utilts-billing|'||p_company_id::text||'|'||p_source_message_id::text,0));
 FOR v_transaction IN SELECT a.source_transaction_id FROM public.ediel_ack_transaction_results a
  WHERE a.source_message_id=p_source_message_id AND a.company_id=p_company_id AND a.environment=v_source.environment
  AND a.disposition='accepted' AND a.persistence_status='persisted' ORDER BY a.source_transaction_id LOOP
  v_contract:=gridex_utilts_binding.stored_contract_v1(p_company_id,p_source_message_id,v_transaction);
  IF v_contract#>>'{billing,capability}' IS DISTINCT FROM 'write' THEN RAISE EXCEPTION 'utilts_consumption_billing_context_mismatch' USING ERRCODE='P0U01'; END IF;
  IF v_context IS NULL THEN v_context:=v_contract->'billing';
  ELSIF v_context IS DISTINCT FROM v_contract->'billing' THEN RAISE EXCEPTION 'utilts_consumption_billing_context_mismatch' USING ERRCODE='P0U01'; END IF;
  v_contribution_count:=v_contribution_count+jsonb_array_length(v_contract->'billingContributionOrdinals');
  FOR v_ordinal IN SELECT value FROM jsonb_array_elements(v_contract->'billingContributionOrdinals') LOOP
   v_total:=v_total+(v_contract->'observations'->((v_ordinal#>>'{}')::integer)->>'quantity')::numeric;
  END LOOP;
  v_contracts:=v_contracts||jsonb_build_array(v_contract);
 END LOOP;
 IF v_context IS NULL THEN RAISE EXCEPTION 'utilts_consumption_billing_missing' USING ERRCODE='P0U01'; END IF;
 IF jsonb_typeof(p_expected_contracts) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'utilts_consumption_returned_contract_changed' USING ERRCODE='P0U01'; END IF;
 IF (SELECT jsonb_agg(e.value ORDER BY e.value->>'transactionId') FROM jsonb_array_elements(p_expected_contracts) e) IS DISTINCT FROM v_contracts THEN
  RAISE EXCEPTION 'utilts_consumption_returned_contract_changed' USING ERRCODE='P0U01'; END IF;
 -- Metering retains the entire physical source. A request's financial
 -- contribution may use only whole original observations inside its sent E73.
 IF v_source.message_code='E66' AND v_source.grid_owner_data_request_id::text=v_context->>'sourceRequestId' THEN
  v_sent_range:=gridex_utilts_binding.e73_sent_request_range_v1(
    p_company_id,v_source.grid_owner_data_request_id,v_source.environment);
 END IF;
 IF v_sent_range IS NOT NULL THEN
  WITH contributions AS (
   SELECT c.value->>'transactionId' AS transaction_id, i.value::text::integer AS ordinal,
    c.value->'observations'->(i.value::text::integer) AS observation
   FROM jsonb_array_elements(v_contracts) c
   CROSS JOIN LATERAL jsonb_array_elements(c.value->'billingContributionOrdinals') i
  ), scoped AS MATERIALIZED (
   SELECT transaction_id,ordinal,(observation->>'quantity')::numeric AS quantity,
    (observation->>'periodStart')::timestamptz AS period_start,
    (observation->>'periodEnd')::timestamptz AS period_end
   FROM contributions
   WHERE (observation->>'periodStart')::timestamptz>=lower(v_sent_range)
     AND (observation->>'periodEnd')::timestamptz<=upper(v_sent_range)
  )
  SELECT sum(quantity),count(*),min(period_start),max(period_end),
   jsonb_agg(jsonb_build_array(transaction_id,ordinal) ORDER BY transaction_id,ordinal)
  INTO v_scoped_total,v_scoped_count,v_start,v_end,v_ordinals FROM scoped;
  IF v_scoped_count=0 THEN
   RAISE EXCEPTION 'e66_billing_no_whole_requested_observation' USING ERRCODE='P0U01';
  END IF;
  IF v_scoped_count<>v_contribution_count OR v_start IS DISTINCT FROM (v_context->>'periodStart')::timestamptz
    OR v_end IS DISTINCT FROM (v_context->>'periodEnd')::timestamptz THEN
   v_scope:=jsonb_build_object('requestedFrom',lower(v_sent_range),'requestedUntil',upper(v_sent_range),
    'periodStart',v_start,'periodEnd',v_end,'contributors',v_ordinals);
   v_total:=v_scoped_total;
   v_context:=v_context||jsonb_build_object('month',extract(month FROM v_end)::integer,'year',extract(year FROM v_end)::integer);
  END IF;
 END IF;
 PERFORM gridex_utilts_binding.lock_attribution_v1(p_company_id,v_context,true);
 SELECT r.underlay_id INTO v_receipt_id
 FROM gridex_e66_intake.billing_calendar_receipts r
 WHERE r.company_id=p_company_id AND r.source_id=p_source_message_id AND r.environment=v_source.environment
 ORDER BY r.billing_year,r.billing_month LIMIT 1;
 IF FOUND THEN
  IF gridex_e66_intake.bound_underlay_fingerprint_v1(p_company_id,p_source_message_id,v_receipt_id) IS NULL THEN
   RAISE EXCEPTION 'utilts_consumption_existing_billing_conflict' USING ERRCODE='P0U01';
  END IF;
  SELECT b.* INTO STRICT v_result FROM public.billing_underlays b WHERE b.company_id=p_company_id AND b.id=v_receipt_id;
  IF v_result.payload->'consumptionContracts' IS DISTINCT FROM v_contracts THEN
   RAISE EXCEPTION 'utilts_consumption_existing_billing_conflict' USING ERRCODE='P0U01';
  END IF;
  RETURN v_result;
 END IF;
 SELECT b.* INTO v_result FROM public.billing_underlays b WHERE b.company_id=p_company_id AND b.source_system='ediel_utilts'
  AND b.payload->>'edielMessageId'=p_source_message_id::text ORDER BY b.created_at,b.id LIMIT 1 FOR UPDATE;
 IF FOUND THEN
  v_found_id:=v_result.id;
  IF v_result.payload ? 'billingCalendar' OR EXISTS (
   SELECT FROM public.billing_underlays b WHERE b.company_id=p_company_id AND b.source_system='ediel_utilts'
    AND b.payload->>'edielMessageId'=p_source_message_id::text AND b.id<>v_found_id
  ) THEN RAISE EXCEPTION 'utilts_consumption_existing_billing_conflict' USING ERRCODE='P0U01'; END IF;
  IF v_result.customer_id::text IS DISTINCT FROM v_context->>'customerId' OR v_result.site_id::text IS DISTINCT FROM v_context->>'siteId'
   OR v_result.customer_site_id::text IS DISTINCT FROM v_context->>'customerSiteId'
   OR v_result.metering_point_id::text IS DISTINCT FROM v_context->>'meteringPointId' OR v_result.grid_owner_id::text IS DISTINCT FROM v_context->>'gridOwnerId'
   OR v_result.source_request_id::text IS DISTINCT FROM v_context->>'sourceRequestId' OR v_result.total_kwh IS DISTINCT FROM v_total
   OR v_result.underlay_month IS DISTINCT FROM (v_context->>'month')::integer
   OR v_result.underlay_year IS DISTINCT FROM (v_context->>'year')::integer
   OR v_result.currency IS DISTINCT FROM v_context->>'currency'
   OR v_result.payload->'consumptionContracts' IS DISTINCT FROM v_contracts
   OR v_result.payload->'e73BillingScope' IS DISTINCT FROM v_scope THEN
   RAISE EXCEPTION 'utilts_consumption_existing_billing_conflict' USING ERRCODE='P0U01'; END IF;
  RETURN v_result;
 END IF;
 IF v_source.message_code='E66' THEN
  v_contract_sha256:=encode(sha256(convert_to(v_contracts::text,'UTF8')),'hex');
  -- Only whole, accepted observations that belong to the request are grouped.
  -- The civil month comes from each inclusive start. An observation ending
  -- exactly at the next local midnight still belongs to the previous month.
  FOR v_month IN
   WITH contributions AS (
    SELECT c.value->>'transactionId' AS transaction_id, i.value::text::integer AS ordinal,
     c.value->'observations'->(i.value::text::integer) AS observation
    FROM jsonb_array_elements(v_contracts) c
    CROSS JOIN LATERAL jsonb_array_elements(c.value->'billingContributionOrdinals') i
   ), intervals AS (
    SELECT transaction_id,ordinal,(observation->>'quantity')::numeric AS quantity,
     (observation->>'periodStart')::timestamptz AS starts_at,(observation->>'periodEnd')::timestamptz AS ends_at
    FROM contributions
   ), scoped AS (
    SELECT *, date_trunc('month',starts_at AT TIME ZONE 'Europe/Stockholm') AS local_month
    FROM intervals
    WHERE v_sent_range IS NULL OR (starts_at>=lower(v_sent_range) AND ends_at<=upper(v_sent_range))
   )
   SELECT local_month,extract(year FROM local_month)::integer AS year,
    extract(month FROM local_month)::integer AS month,min(starts_at) AS starts_at,max(ends_at) AS ends_at,
    count(*)::integer AS contribution_count,sum(quantity) AS total,
    bool_and((starts_at<ends_at AND ends_at<=((local_month+interval '1 month') AT TIME ZONE 'Europe/Stockholm')
      AND quantity IS NOT NULL) IS TRUE) AS whole_intervals,
    jsonb_agg(jsonb_build_array(transaction_id,ordinal) ORDER BY transaction_id,ordinal) AS contributors,
    jsonb_agg(jsonb_build_array(starts_at,ends_at) ORDER BY transaction_id,ordinal) AS observation_periods
   FROM scoped GROUP BY local_month ORDER BY local_month
  LOOP
   IF v_month.whole_intervals IS NOT TRUE OR v_month.total IS NULL THEN
    RAISE EXCEPTION 'utilts_consumption_billing_month_boundary_requires_finer_observation' USING ERRCODE='P0U01';
   END IF;
   v_calendar:=jsonb_build_object(
    'version','stockholm-observation-month-v1','timeZone','Europe/Stockholm',
    'periodStart',v_month.starts_at,'periodEnd',v_month.ends_at,
    'year',v_month.year,'month',v_month.month,'contractSha256',v_contract_sha256,
    'contributors',v_month.contributors,'observationPeriods',v_month.observation_periods);
   INSERT INTO public.billing_underlays(company_id,customer_id,site_id,customer_site_id,metering_point_id,source_request_id,
    grid_owner_id,underlay_month,underlay_year,status,total_kwh,currency,source_system,payload,readiness_status,
    readiness_issues,created_by,updated_by,received_at,source_meter_value_count)
   VALUES(p_company_id,(v_context->>'customerId')::uuid,(v_context->>'siteId')::uuid,(v_context->>'customerSiteId')::uuid,
    (v_context->>'meteringPointId')::uuid,(v_context->>'sourceRequestId')::uuid,(v_context->>'gridOwnerId')::uuid,
    v_month.month,v_month.year,v_context->>'status',v_month.total,v_context->>'currency',v_context->>'sourceSystem',
    jsonb_build_object('edielMessageId',p_source_message_id,'tenant',jsonb_build_object('company_id',p_company_id,'issues','[]'::jsonb),
      'billingCalendar',v_calendar)
     || CASE WHEN v_primary.id IS NULL THEN jsonb_build_object('consumptionContracts',v_contracts) ELSE '{}'::jsonb END
     || CASE WHEN v_scope IS NOT NULL THEN jsonb_build_object(
       'e73BillingScope',(v_scope-'contributors')||jsonb_build_object(
        'periodStart',v_month.starts_at,'periodEnd',v_month.ends_at,'contributors',v_month.contributors))
       ELSE '{}'::jsonb END,
    'not_checked','[]'::jsonb,p_actor_id,p_actor_id,now(),v_month.contribution_count)
   RETURNING * INTO v_result;
   INSERT INTO gridex_e66_intake.billing_calendar_receipts(company_id,source_id,environment,billing_year,billing_month,underlay_id,row_fingerprint)
   VALUES(p_company_id,p_source_message_id,v_source.environment,v_month.year,v_month.month,v_result.id,
    gridex_e66_intake.billing_calendar_member_hash_v1(v_result));
   IF v_primary.id IS NULL THEN v_primary:=v_result; END IF;
   v_projected_count:=v_projected_count+v_month.contribution_count;
   v_projected_total:=v_projected_total+v_month.total;
  END LOOP;
  IF v_primary.id IS NULL OR v_projected_count IS DISTINCT FROM coalesce(v_scoped_count,v_contribution_count)::bigint
    OR v_projected_total IS DISTINCT FROM v_total THEN
   RAISE EXCEPTION 'utilts_consumption_billing_calendar_projection_incomplete' USING ERRCODE='P0U01';
  END IF;
  RETURN v_primary;
 END IF;
 INSERT INTO public.billing_underlays(company_id,customer_id,site_id,customer_site_id,metering_point_id,source_request_id,grid_owner_id,underlay_month,underlay_year,
  status,total_kwh,currency,source_system,payload,readiness_status,readiness_issues,created_by,updated_by,received_at,
  source_meter_value_count)
 VALUES(p_company_id,(v_context->>'customerId')::uuid,(v_context->>'siteId')::uuid,(v_context->>'customerSiteId')::uuid,(v_context->>'meteringPointId')::uuid,(v_context->>'sourceRequestId')::uuid,
  (v_context->>'gridOwnerId')::uuid,(v_context->>'month')::integer,(v_context->>'year')::integer,v_context->>'status',v_total,v_context->>'currency',v_context->>'sourceSystem',
  jsonb_build_object('edielMessageId',p_source_message_id,'consumptionContracts',v_contracts,'tenant',jsonb_build_object('company_id',p_company_id,'issues','[]'::jsonb))
    || CASE WHEN v_scope IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('e73BillingScope',v_scope) END,
  'not_checked','[]'::jsonb,p_actor_id,p_actor_id,now(),
  CASE WHEN v_scope IS NOT NULL THEN v_scoped_count END) RETURNING * INTO v_result;
 RETURN v_result;
END $$;
END
$gridex_e66_calendar_migration$;
