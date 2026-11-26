DO $pin$
BEGIN
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc
   WHERE oid='gridex_e66_intake.consume_owned_utilts_billing_v1(uuid,uuid,uuid,jsonb)'::regprocedure) IS DISTINCT FROM '5e93a20ee93e6c20ae0c519b6f7c308ced23af98977d70edfe3629dbd633a581'
 THEN RAISE EXCEPTION 'mixed_e66_finance_owner_preimage_changed'; END IF;
END
$pin$;
DO $pin$
BEGIN
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE
   oid='public.gridex_step_mixed_e66_worker_v1(uuid,text,uuid,uuid,text,uuid,text,uuid,uuid,jsonb)'::regprocedure) IS DISTINCT FROM '08ef4ee408c64aac46fd762e63f298276ce44ebbee2c98cd1ae073e00d4dc5a0'
 THEN RAISE EXCEPTION 'mixed_e66_finance_scheduler_preimage_changed'; END IF;
END
$pin$;
-- The existing Stockholm writer owns all inserts. This function only selects
-- current, complete, non-overlapping observations for an exact TEST E73.
CREATE FUNCTION gridex_e66_intake.mixed_billing_admission_v1(
  p_company uuid,p_source uuid,p_actor uuid
) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog SET timezone='UTC' AS $admit$
DECLARE
  request_row public.grid_owner_data_requests;
  child record;
  current_basis jsonb;
  reference_basis jsonb;
  exact_contract jsonb;
  finance_contract jsonb;
  basis_hashes jsonb:='[]'::jsonb;
  finance_contracts jsonb:='[]'::jsonb;
  expected_range tstzrange;
  actual_range tstzmultirange;
  contributed_seconds numeric;
BEGIN
  PERFORM gridex_utilts_binding.lock_storage_graph_v1();
  IF current_setting('role',true) IS DISTINCT FROM 'service_role'
    OR public.gridex_actor_has_company_permission(p_actor,p_company,'metering.write') IS NOT TRUE
    OR public.gridex_actor_has_company_permission(p_actor,p_company,'billing_underlay.write') IS NOT TRUE
  THEN RETURN NULL; END IF;
  PERFORM gridex_utilts_binding.require_execution_actor_v1(p_company,p_actor);
  FOR child IN
    SELECT t.transaction_id,b.evidence,b.evidence_sha256,b.request_id
    FROM gridex_e66_intake.work w
    JOIN gridex_e66_intake.mixed_qualification_receipts q ON q.source_id=w.source_id AND q.actor_id=p_actor
    JOIN gridex_e66_intake.mixed_accepted_transactions t ON t.source_id=w.source_id
    LEFT JOIN gridex_e66_intake.mixed_e73_request_basis b
      ON (b.source_id,b.transaction_id,b.company_id,b.environment,b.actor_id)
        =(t.source_id,t.transaction_id,w.company_id,w.environment,p_actor)
    WHERE (w.source_id,w.company_id,w.environment,w.phase)=(p_source,p_company,'test','mixed_qualified')
    ORDER BY t.transaction_id
  LOOP
    IF child.evidence IS NULL OR child.evidence->>'requestScope' IS DISTINCT FROM 'billing_underlay' THEN RETURN NULL; END IF;
    current_basis:=gridex_e66_intake.read_mixed_e73_evidence_v1(p_company,'test',p_source,p_actor,child.transaction_id);
    IF current_basis IS DISTINCT FROM child.evidence
      OR encode(sha256(convert_to(current_basis::text,'UTF8')),'hex') IS DISTINCT FROM child.evidence_sha256
    THEN RETURN NULL; END IF;
    IF reference_basis IS NULL THEN
      reference_basis:=current_basis;
      expected_range:=tstzrange((current_basis->>'requestedFrom')::timestamptz,
        (current_basis->>'requestedUntil')::timestamptz,'[)');
    ELSIF (current_basis->>'requestId',current_basis->>'sentSourceId',current_basis->>'sentHash',
           current_basis->>'requestedFrom',current_basis->>'requestedUntil')
          IS DISTINCT FROM
          (reference_basis->>'requestId',reference_basis->>'sentSourceId',reference_basis->>'sentHash',
           reference_basis->>'requestedFrom',reference_basis->>'requestedUntil')
    THEN RETURN NULL; END IF;
    exact_contract:=gridex_utilts_binding.stored_contract_v1(p_company,p_source,child.transaction_id);
    IF exact_contract#>>'{billing,capability}' IS DISTINCT FROM 'skip'
      OR exact_contract#>>'{billing,sourceRequestId}' IS NOT NULL
      OR encode(sha256(convert_to(exact_contract::text,'UTF8')),'hex') IS DISTINCT FROM current_basis->>'contractHash'
    THEN RETURN NULL; END IF;
    SELECT exact_contract||jsonb_build_object('billingContributionOrdinals',jsonb_agg((o->>'ordinal')::integer ORDER BY (o->>'ordinal')::integer))
    INTO finance_contract
    FROM jsonb_array_elements(exact_contract->'observations') o
    WHERE (o->>'periodStart')::timestamptz >= lower(expected_range)
      AND (o->>'periodEnd')::timestamptz <= upper(expected_range)
    HAVING count(*)>0;
    IF finance_contract IS NULL THEN RETURN NULL; END IF;
    finance_contracts:=finance_contracts||jsonb_build_array(finance_contract);
    basis_hashes:=basis_hashes||jsonb_build_array(jsonb_build_array(child.transaction_id,child.evidence_sha256));
  END LOOP;
  IF reference_basis IS NULL THEN RETURN NULL; END IF;
  SELECT range_agg(tstzrange(starts_at,ends_at,'[)')),sum(extract(epoch FROM ends_at-starts_at))
  INTO actual_range,contributed_seconds
  FROM (
    SELECT (o->>'periodStart')::timestamptz AS starts_at,(o->>'periodEnd')::timestamptz AS ends_at
    FROM jsonb_array_elements(finance_contracts) c
    CROSS JOIN LATERAL jsonb_array_elements(c->'billingContributionOrdinals') i
    CROSS JOIN LATERAL (SELECT c->'observations'->(i::text::integer) AS o) entry
  ) intervals;
  IF actual_range IS DISTINCT FROM tstzmultirange(expected_range)
    OR contributed_seconds IS DISTINCT FROM extract(epoch FROM upper(expected_range)-lower(expected_range))
  THEN RETURN NULL; END IF;

  SELECT q.* INTO request_row FROM public.grid_owner_data_requests q
  WHERE (q.company_id,q.id,q.request_scope)=(p_company,(reference_basis->>'requestId')::uuid,'billing_underlay')
    AND q.status IN ('sent','received') AND q.customer_id IS NOT NULL AND q.site_id IS NOT NULL
  FOR NO KEY UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- A previous underlay for the request keeps corrected sources out of finance.
  -- The original may replay through the native immutable calendar receipts.
  IF EXISTS (SELECT FROM public.billing_underlays b
    WHERE (b.company_id,b.source_request_id)=(p_company,request_row.id)
      AND (b.payload->>'edielMessageId') IS DISTINCT FROM p_source::text)
  THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('contracts',finance_contracts,'basisHashes',basis_hashes,
    'sentSourceId',reference_basis->>'sentSourceId','sentHash',reference_basis->>'sentHash',
    'requestedFrom',lower(expected_range),'requestedUntil',upper(expected_range),
    'context',jsonb_build_object(
      'requestScope','billing_underlay','capability','write','sourceRequestId',request_row.id,
      'customerId',request_row.customer_id,'siteId',request_row.site_id,'customerSiteId',request_row.site_id,
      'meteringPointId',request_row.metering_point_id,'gridOwnerId',request_row.grid_owner_id,
      'periodStart',lower(expected_range),'periodEnd',upper(expected_range),'currency','SEK','status','received','sourceSystem','ediel_utilts'));
END
$admit$;
REVOKE ALL ON FUNCTION gridex_e66_intake.mixed_billing_admission_v1(uuid,uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION gridex_e66_intake.consume_owned_utilts_billing_v1(p_company_id uuid,p_source_message_id uuid,p_actor_id uuid,p_expected_contracts jsonb)
RETURNS public.billing_underlays LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions SET timezone='UTC' AS $$
DECLARE v_transaction text; v_contract jsonb; v_context jsonb; v_contracts jsonb:='[]'; v_total numeric:=0; v_ordinal jsonb;
 v_result public.billing_underlays%rowtype; v_source public.ediel_messages%rowtype;
 v_sent_range tstzrange; v_scoped_total numeric; v_start timestamptz; v_end timestamptz;
 v_contribution_count integer:=0; v_scoped_count integer; v_scope jsonb; v_ordinals jsonb;
 v_receipt_id uuid; v_found_id uuid; v_month record; v_primary public.billing_underlays%rowtype;
 mixed_admission jsonb; v_finance_contracts jsonb; v_calendar jsonb; v_contract_sha256 text; v_projected_count bigint:=0; v_projected_total numeric:=0;
BEGIN
 SELECT s.* INTO v_source FROM public.ediel_messages s WHERE s.id=p_source_message_id AND s.company_id=p_company_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'utilts_consumption_source_unavailable' USING ERRCODE='P0U01'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('utilts-billing|'||p_company_id::text||'|'||p_source_message_id::text,0));
 IF v_source.message_code='E66' AND EXISTS (
   SELECT FROM gridex_e66_intake.work w
   WHERE (w.source_id,w.company_id,w.environment,w.phase)=(v_source.id,p_company_id,v_source.environment,'mixed_qualified')
 ) THEN
  IF v_source.environment IS DISTINCT FROM 'test' OR v_source.grid_owner_data_request_id IS NOT NULL THEN RETURN NULL; END IF;
  mixed_admission:=gridex_e66_intake.mixed_billing_admission_v1(p_company_id,p_source_message_id,p_actor_id);
  IF mixed_admission IS NULL THEN RETURN NULL; END IF;
 END IF;
 FOR v_transaction IN SELECT a.source_transaction_id FROM public.ediel_ack_transaction_results a
  WHERE a.source_message_id=p_source_message_id AND a.company_id=p_company_id AND a.environment=v_source.environment
  AND a.disposition='accepted' AND a.persistence_status='persisted' ORDER BY a.source_transaction_id LOOP
  v_contract:=gridex_utilts_binding.stored_contract_v1(p_company_id,p_source_message_id,v_transaction);
  IF mixed_admission IS NOT NULL THEN
   v_contracts:=v_contracts||jsonb_build_array(v_contract);
   CONTINUE;
  END IF;
  IF v_contract#>>'{billing,capability}' IS DISTINCT FROM 'write' THEN RAISE EXCEPTION 'utilts_consumption_billing_context_mismatch' USING ERRCODE='P0U01'; END IF;
  IF v_context IS NULL THEN v_context:=v_contract->'billing';
  ELSIF v_context IS DISTINCT FROM v_contract->'billing' THEN RAISE EXCEPTION 'utilts_consumption_billing_context_mismatch' USING ERRCODE='P0U01'; END IF;
  v_contribution_count:=v_contribution_count+jsonb_array_length(v_contract->'billingContributionOrdinals');
  FOR v_ordinal IN SELECT value FROM jsonb_array_elements(v_contract->'billingContributionOrdinals') LOOP
   v_total:=v_total+(v_contract->'observations'->((v_ordinal#>>'{}')::integer)->>'quantity')::numeric;
  END LOOP;
  v_contracts:=v_contracts||jsonb_build_array(v_contract);
 END LOOP;
 IF v_context IS NULL AND mixed_admission IS NULL THEN RAISE EXCEPTION 'utilts_consumption_billing_missing' USING ERRCODE='P0U01'; END IF;
 IF jsonb_typeof(p_expected_contracts) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'utilts_consumption_returned_contract_changed' USING ERRCODE='P0U01'; END IF;
 IF (SELECT jsonb_agg(e.value ORDER BY e.value->>'transactionId') FROM jsonb_array_elements(p_expected_contracts) e) IS DISTINCT FROM v_contracts THEN
  RAISE EXCEPTION 'utilts_consumption_returned_contract_changed' USING ERRCODE='P0U01'; END IF;
 -- Mixed E66 uses only the accepted physical IDE evidence selected by the
 -- private admission function. Keep the original immutable contracts for audit.
 v_finance_contracts:=v_contracts;
 IF mixed_admission IS NOT NULL THEN
  v_context:=mixed_admission->'context';
  v_finance_contracts:=mixed_admission->'contracts';
  v_sent_range:=tstzrange((mixed_admission->>'requestedFrom')::timestamptz,
    (mixed_admission->>'requestedUntil')::timestamptz,'[)');
  IF (SELECT jsonb_agg(c->>'transactionId' ORDER BY c->>'transactionId') FROM jsonb_array_elements(v_finance_contracts) c)
     IS DISTINCT FROM
     (SELECT jsonb_agg(c->>'transactionId' ORDER BY c->>'transactionId') FROM jsonb_array_elements(v_contracts) c)
  THEN RAISE EXCEPTION 'mixed_e66_finance_membership_changed' USING ERRCODE='P0U01'; END IF;
 END IF;
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
   FROM jsonb_array_elements(v_finance_contracts) c
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
  IF mixed_admission IS NOT NULL OR v_scoped_count<>v_contribution_count OR v_start IS DISTINCT FROM (v_context->>'periodStart')::timestamptz
    OR v_end IS DISTINCT FROM (v_context->>'periodEnd')::timestamptz THEN
   v_scope:=jsonb_build_object('requestedFrom',lower(v_sent_range),'requestedUntil',upper(v_sent_range),
    'periodStart',v_start,'periodEnd',v_end,'contributors',v_ordinals);
   IF mixed_admission IS NOT NULL THEN
    v_scope:=v_scope||jsonb_build_object('basisVersion','mixed-e73-ide-finance-v1',
      'sentSourceId',mixed_admission->'sentSourceId','sentHash',mixed_admission->'sentHash',
      'ideBasisHashes',mixed_admission->'basisHashes');
   END IF;
   v_total:=v_scoped_total;
   v_context:=v_context||jsonb_build_object('month',extract(month FROM v_end)::integer,'year',extract(year FROM v_end)::integer);
  END IF;
 END IF;
 PERFORM gridex_utilts_binding.lock_attribution_v1(p_company_id,v_context,true);
 -- A legacy scalar E66 writer takes a share lock on the same request row.
 -- Prevent it from creating a second raw financial projection after a mixed one.
 IF mixed_admission IS NULL AND v_source.message_code='E66' AND v_source.environment='test'
  AND EXISTS (SELECT FROM public.billing_underlays b
    JOIN gridex_e66_intake.billing_calendar_receipts receipt ON (receipt.company_id,receipt.underlay_id)=(b.company_id,b.id)
    WHERE (b.company_id,b.source_request_id,receipt.environment)=(p_company_id,(v_context->>'sourceRequestId')::uuid,'test')
      AND b.payload#>>'{e73BillingScope,basisVersion}'='mixed-e73-ide-finance-v1')
 THEN RAISE EXCEPTION 'e66_billing_mixed_request_already_prepared' USING ERRCODE='P0U01'; END IF;
 SELECT r.underlay_id INTO v_receipt_id
 FROM gridex_e66_intake.billing_calendar_receipts r
 WHERE r.company_id=p_company_id AND r.source_id=p_source_message_id AND r.environment=v_source.environment
 ORDER BY r.billing_year,r.billing_month LIMIT 1;
 IF FOUND THEN
  IF gridex_e66_intake.bound_underlay_fingerprint_v1(p_company_id,p_source_message_id,v_receipt_id) IS NULL THEN
   RAISE EXCEPTION 'utilts_consumption_existing_billing_conflict' USING ERRCODE='P0U01';
  END IF;
  SELECT b.* INTO STRICT v_result FROM public.billing_underlays b WHERE b.company_id=p_company_id AND b.id=v_receipt_id;
  IF v_result.payload->'consumptionContracts' IS DISTINCT FROM v_contracts
    OR (mixed_admission IS NOT NULL AND jsonb_build_object(
      'sentSourceId',v_result.payload#>'{e73BillingScope,sentSourceId}',
      'sentHash',v_result.payload#>'{e73BillingScope,sentHash}',
      'basisHashes',v_result.payload#>'{e73BillingScope,ideBasisHashes}')
      IS DISTINCT FROM (mixed_admission-ARRAY['contracts','context','requestedFrom','requestedUntil']))
  THEN
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
    FROM jsonb_array_elements(v_finance_contracts) c
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

CREATE OR REPLACE FUNCTION public.gridex_step_mixed_e66_worker_v1(
  p_company uuid,p_environment text,p_mailbox uuid,p_actor uuid,p_action text,
  p_source uuid DEFAULT NULL,p_ide text DEFAULT NULL,p_worker_lease uuid DEFAULT NULL,
  p_draft_lease uuid DEFAULT NULL,p_draft jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE
  candidate record;
  worker_lease uuid;
  cursor_now integer;
  observation_total integer;
  checkpoint jsonb;
  ready jsonb;
  draft_proof jsonb;
  stored jsonb;
  did_progress boolean:=false;
BEGIN
  IF p_environment IS DISTINCT FROM 'test' OR (p_action IN ('claim','advance','store','finish','defer')) IS NOT TRUE THEN
    RAISE EXCEPTION 'mixed_worker_invalid_scope' USING ERRCODE='22023';
  END IF;
  PERFORM gridex_e66_intake.require_dispatch_scope(p_company,p_environment,p_mailbox,p_actor);
  IF p_action='claim' THEN
    SELECT w.source_id,c.transaction_id INTO candidate
    FROM gridex_e66_intake.work w
    CROSS JOIN LATERAL gridex_e66_intake.due_mixed_worker_members_v1(w,p_actor,statement_timestamp()) c
    WHERE (w.company_id,w.environment,w.mailbox_id)=(p_company,p_environment,p_mailbox)
    ORDER BY c.due_at,w.source_id,c.transaction_index LIMIT 1
    FOR UPDATE OF w SKIP LOCKED;
    IF NOT FOUND THEN RETURN jsonb_build_object('kind','idle'); END IF;
    worker_lease:=gen_random_uuid();
    INSERT INTO gridex_e66_intake.mixed_worker_attempts AS prior
      (source_id,transaction_id,lease_token,lease_expires_at,next_attempt_at)
    VALUES(candidate.source_id,candidate.transaction_id,worker_lease,clock_timestamp()+interval '75 seconds',clock_timestamp())
    ON CONFLICT(source_id,transaction_id) DO UPDATE SET
      lease_token=excluded.lease_token,lease_expires_at=excluded.lease_expires_at,next_attempt_at=excluded.next_attempt_at
      WHERE (prior.lease_expires_at IS NULL OR prior.lease_expires_at<=clock_timestamp())
        AND prior.next_attempt_at<=clock_timestamp();
    IF NOT FOUND THEN RETURN jsonb_build_object('kind','idle'); END IF;
    RETURN jsonb_build_object('kind','claimed','sourceId',candidate.source_id,'transactionId',candidate.transaction_id,'lease',worker_lease);
  END IF;

  PERFORM gridex_utilts_binding.lock_storage_graph_v1();
  PERFORM 1 FROM gridex_e66_intake.work w
  JOIN gridex_e66_intake.mixed_qualification_receipts q ON q.source_id=w.source_id AND q.actor_id=p_actor
  JOIN gridex_e66_intake.mixed_worker_attempts x ON x.source_id=w.source_id
  WHERE (w.source_id,w.company_id,w.environment,w.mailbox_id,x.transaction_id,x.lease_token)
    =(p_source,p_company,p_environment,p_mailbox,p_ide,p_worker_lease)
    AND w.phase='mixed_qualified' AND w.lease_token IS NULL AND x.lease_expires_at>clock_timestamp()
  FOR UPDATE OF w,x;
  IF NOT FOUND THEN RETURN jsonb_build_object('kind','held','reason','mixed_worker_lease_unavailable'); END IF;

  IF p_action IN ('finish','defer') THEN
    PERFORM gridex_e66_intake.yield_mixed_worker_attempt_v1(p_source,p_ide,p_worker_lease,p_action='defer');
    RETURN jsonb_build_object('kind','yielded');
  END IF;
  IF p_action='store' THEN
    checkpoint:=gridex_e66_intake.seal_mixed_e73_ide_completion_v1(
      p_company,p_environment,p_mailbox,p_source,p_actor,p_ide,p_draft_lease,p_draft->>'rawPayload');
    IF checkpoint->>'status' IS DISTINCT FROM 'ide_preparation_recorded' THEN RETURN checkpoint||'{"kind":"held"}'::jsonb; END IF;
    stored:=gridex_e66_intake.persist_mixed_positive_draft_v1(
      p_company,p_environment,p_mailbox,p_source,p_actor,p_ide,p_draft_lease,p_draft);
    IF stored#>>'{ackMessage,id}' IS NULL THEN
      RAISE EXCEPTION 'mixed_worker_native_draft_unavailable' USING ERRCODE='55000';
    END IF;
    RETURN jsonb_build_object('kind','finalize','responseId',stored#>>'{ackMessage,id}');
  END IF;

  IF NOT EXISTS (
    SELECT FROM gridex_e66_metering_stage.mixed_normalization_receipts n
    WHERE (n.source_id,n.transaction_id)=(p_source,p_ide)
  ) THEN
    SELECT n.next_ordinal,n.observation_count INTO cursor_now,observation_total
    FROM gridex_e66_metering_stage.mixed_jobs n WHERE (n.source_id,n.transaction_id)=(p_source,p_ide);
    IF observation_total IS NULL OR cursor_now<observation_total THEN
      checkpoint:=gridex_e66_metering_stage.consume_mixed_chunk_v1(
        p_company,p_environment,p_mailbox,p_source,p_actor,p_ide,coalesce(cursor_now,0),8);
      did_progress:=true;
    END IF;
    IF EXISTS (SELECT FROM gridex_e66_metering_stage.mixed_jobs n WHERE (n.source_id,n.transaction_id)=(p_source,p_ide)
      AND n.next_ordinal<n.observation_count) THEN
      PERFORM gridex_e66_intake.yield_mixed_worker_attempt_v1(p_source,p_ide,p_worker_lease,false);
      RETURN jsonb_build_object('kind','progress');
    END IF;
    PERFORM gridex_e66_metering_stage.seal_mixed_normalization_v1(p_company,p_environment,p_mailbox,p_source,p_actor,p_ide);
  END IF;

  IF NOT EXISTS (SELECT FROM gridex_e66_intake.mixed_e73_request_basis b WHERE (b.source_id,b.transaction_id)=(p_source,p_ide)) THEN
    IF gridex_e66_intake.read_mixed_e73_evidence_v1(p_company,p_environment,p_source,p_actor,p_ide) IS NULL THEN
      PERFORM gridex_e66_intake.yield_mixed_worker_attempt_v1(p_source,p_ide,p_worker_lease,true);
      RETURN jsonb_build_object('kind','held','reason','mixed_worker_e73_basis_unavailable','progress',did_progress);
    END IF;
    PERFORM gridex_e66_intake.seal_mixed_e73_request_basis_v1(p_company,p_environment,p_mailbox,p_source,p_actor,p_ide);
  END IF;
  IF EXISTS (SELECT FROM gridex_e66_intake.mixed_e73_request_basis b
    WHERE (b.source_id,b.transaction_id)=(p_source,p_ide) AND b.evidence->>'requestScope'='billing_underlay') THEN
    PERFORM gridex_e66_intake.consume_owned_utilts_billing_v1(p_company,p_source,p_actor,(
      SELECT jsonb_agg(gridex_utilts_binding.stored_contract_v1(p_company,p_source,t.transaction_id) ORDER BY t.transaction_id)
      FROM gridex_e66_intake.mixed_accepted_transactions t WHERE t.source_id=p_source
    ));
  END IF;
  ready:=gridex_e66_intake.read_mixed_e73_ide_readiness_v1(p_company,p_environment,p_source,p_actor,p_ide);
  IF ready->>'status' IS DISTINCT FROM 'ready_for_reply_evaluation' THEN
    PERFORM gridex_e66_intake.yield_mixed_worker_attempt_v1(p_source,p_ide,p_worker_lease,true);
    RETURN jsonb_build_object('kind','held','reason',ready->>'status','progress',did_progress);
  END IF;
  IF EXISTS (SELECT FROM gridex_e66_intake.mixed_e73_ide_completions c WHERE (c.source_id,c.transaction_id)=(p_source,p_ide)) THEN
    stored:=gridex_e66_intake.read_mixed_positive_recovery_v1(p_company,p_environment,p_mailbox,p_source,p_actor,p_ide);
    IF stored->>'status'='recovered_draft' THEN
      RETURN jsonb_build_object('kind','finalize','responseId',stored->>'ackId');
    END IF;
    PERFORM gridex_e66_intake.yield_mixed_worker_attempt_v1(p_source,p_ide,p_worker_lease,true);
    RETURN jsonb_build_object('kind','held','reason',stored->>'reason');
  END IF;
  draft_proof:=gridex_e66_intake.mixed_e73_draft_precondition_v1(
    p_company,p_environment,p_mailbox,p_source,p_actor,p_ide,'claim',NULL);
  IF draft_proof->>'status' IS DISTINCT FROM 'claimed' THEN
    PERFORM gridex_e66_intake.yield_mixed_worker_attempt_v1(p_source,p_ide,p_worker_lease,true);
    RETURN draft_proof||'{"kind":"held"}'::jsonb;
  END IF;
  RETURN jsonb_build_object('kind','render','draftLease',draft_proof->>'leaseToken','sourceHash',draft_proof->>'sourceSha256');
END
$$;
