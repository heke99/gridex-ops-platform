-- A source-bound physical ACK projects its own accepted receipt, not the
-- ancestral business request. Keep all original source/actor/receipt guards.
-- Only the reviewed original or this exact postimage may be redefined;
-- owner, ACL, OID, signature and every other pg_proc property stay unchanged.
BEGIN;
DO $ack_projection_migration$
DECLARE before_metadata jsonb; after_metadata jsonb; before_source text; after_source text;
BEGIN
 SELECT pg_catalog.to_jsonb(p)-'prosrc',p.prosrc INTO before_metadata,before_source
 FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('public.ediel_project_accepted_source_state_v1(uuid,text,uuid,uuid,text)');
 IF before_metadata IS NULL OR before_source IS NULL OR
  (pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(before_source,'UTF8')),'hex')
   IN ('01a18718d1d55c93238f2f9a8cfcb44da7cd5b35dbee96af964066a1848b7379','66d86e98130ca6f5e64ae966d710f35bce86204452febe714684025943a81f17')) IS NOT TRUE THEN
  RAISE EXCEPTION 'ediel_source_bound_ack_projection_unreviewed_preimage';
 END IF;
 EXECUTE $ack_projection_definition$
CREATE OR REPLACE FUNCTION public.ediel_project_accepted_source_state_v1(p_company_id uuid, p_environment text, p_actor_user_id uuid, p_message_id uuid, p_expected_original_hash text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    SET "TimeZone" TO 'UTC'
    AS $_$
DECLARE m public.ediel_messages%rowtype;receipt jsonb;attempt_binding jsonb;technical_plan jsonb;technical_due timestamptz;technical_basis text:='current_final_or_not_required';expectations jsonb:='[]';e jsonb;observed timestamptz;business_due timestamptz;business_pending boolean:=false;
 r public.outbound_requests%rowtype;g public.grid_owner_data_requests%rowtype;c public.customer_info_requests%rowtype;
 terminal boolean;business_terminal boolean;business_watch_pending boolean;request_status text;data_status text;info_status text;source_bound_ack boolean:=false;
BEGIN
 IF p_company_id IS NULL OR p_actor_user_id IS NULL OR p_message_id IS NULL OR (p_environment IN('test','production')) IS NOT TRUE
  OR p_expected_original_hash IS NULL OR p_expected_original_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'ediel_source_projection_scope_required';END IF;
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 PERFORM cm.user_id FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id FOR SHARE;
 IF NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active')
  OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL)
  OR (public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'ediel.send') OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.send')) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_source_projection_actor_forbidden' USING ERRCODE='42501';END IF;
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id AND environment=p_environment AND direction='outbound' FOR UPDATE;
 IF m.immutable_payload_hash IS DISTINCT FROM p_expected_original_hash THEN RAISE EXCEPTION 'ediel_source_projection_original_changed';END IF;
 receipt:=gridex_ediel_transport.accepted_source_basis_v1(m);
 IF receipt IS NULL THEN RAISE EXCEPTION 'ediel_source_projection_accepted_receipt_required';END IF;
 observed:=(receipt->>'observedAt')::timestamptz;
 IF observed IS NULL OR receipt->>'originalHash' IS DISTINCT FROM p_expected_original_hash THEN RAISE EXCEPTION 'ediel_source_projection_frozen_clock_required';END IF;
 terminal:=(m.status IN('delivered','acknowledged','failed','cancelled','rejected','completed')) IS TRUE;
 business_terminal:=(m.status IN('failed','cancelled','rejected','completed')) IS TRUE;
 IF receipt->>'lane'='generic_journal' THEN SELECT a.binding INTO attempt_binding FROM gridex_ediel_transport.attempts a WHERE a.id=(receipt->>'attemptId')::uuid AND a.company_id=m.company_id AND a.environment=m.environment AND a.message_id=m.id;
 ELSIF receipt->>'lane'='sealed_z08' THEN SELECT a.binding INTO attempt_binding FROM gridex_outbound_dispatch.attempts a WHERE a.id=(receipt->>'attemptId')::uuid AND a.company_id=m.company_id AND a.environment=m.environment AND a.message_id=m.id;
 ELSE RAISE EXCEPTION 'ediel_source_projection_accepted_lane_required';END IF;
 IF attempt_binding IS NULL OR attempt_binding->>'originalHash' IS DISTINCT FROM m.immutable_payload_hash THEN RAISE EXCEPTION 'ediel_source_projection_accepted_binding_required';END IF;
 source_bound_ack:=CASE WHEN (m.message_standard='edifact' AND m.message_family IN('CONTRL','APERAK') AND m.related_message_id IS NOT NULL) IS TRUE THEN (gridex_ack_authority.wire_v1(m.raw_payload)->>'family'=m.message_family) IS TRUE ELSE false END;
 technical_plan:=attempt_binding->'technicalExpectationPlan';
 IF NOT terminal AND m.requires_contrl IS TRUE AND m.contrl_status IS DISTINCT FROM 'received' THEN
  IF technical_plan IS NULL OR technical_plan='null'::jsonb THEN
   IF m.contrl_due_at IS NULL OR m.ack_due_at IS NULL THEN RAISE EXCEPTION 'ediel_source_projection_frozen_technical_plan_required';END IF;
   technical_basis:='retained_legacy_projection_not_reverified';
  ELSE
   technical_plan:=gridex_ediel_transport.require_technical_expectation_plan_v1(m,technical_plan);
   IF jsonb_typeof(technical_plan) IS DISTINCT FROM 'object' OR technical_plan->>'version' IS DISTINCT FROM '1' OR technical_plan->>'ruleId' IS DISTINCT FROM 'TM-CONTRL'
    OR technical_plan->>'unit' IS DISTINCT FROM 'minutes' OR technical_plan->>'anchor' IS DISTINCT FROM 'actual_accepted_smtp_observed_at'
    OR technical_plan->>'timerKind' IS DISTINCT FROM 'internal_sender_watch' OR technical_plan->'remoteReceiptKnown' IS DISTINCT FROM 'false'::jsonb
    OR jsonb_typeof(technical_plan#>'{policy,sourceTrace}') IS DISTINCT FROM 'array' OR nullif(technical_plan#>>'{policy,guideRevision}','') IS NULL
    OR nullif(technical_plan#>>'{policy,referenceDate}','') IS NULL OR (technical_plan->>'offset')::integer IS NULL OR (technical_plan->>'offset')::integer<=0
    THEN RAISE EXCEPTION 'ediel_source_projection_technical_plan_invalid';END IF;
   technical_due:=observed+make_interval(mins=>(technical_plan->>'offset')::integer);technical_basis:='frozen_plan';
  END IF;
 END IF;
 IF m.message_standard='edifact' AND m.message_family='PRODAT' AND (m.message_code IN('Z01','Z13','Z18') OR m.message_code='Z08' AND gridex_supply_rescission.outbound_required_v1(m.raw_payload) IS TRUE) THEN
  expectations:=gridex_business_expectations.mutate_v1(jsonb_build_object('companyId',p_company_id,'environment',p_environment,'actorUserId',p_actor_user_id,'messageId',p_message_id,'action','register'));
  IF jsonb_typeof(expectations) IS DISTINCT FROM 'array' OR jsonb_array_length(expectations)<>1 THEN RAISE EXCEPTION 'ediel_source_projection_frozen_expectation_required';END IF;
  e:=expectations->0;
  IF e->>'source_message_id' IS DISTINCT FROM m.id::text OR (e#>>'{metadata,anchorAt}')::timestamptz IS DISTINCT FROM observed THEN RAISE EXCEPTION 'ediel_source_projection_expectation_clock_changed';END IF;
  IF m.message_code='Z01' THEN
   IF e->>'expected_code' IS DISTINCT FROM 'Z02' OR nullif(e->>'due_at','') IS NULL THEN RAISE EXCEPTION 'ediel_source_projection_frozen_z02_deadline_required';END IF;
   business_due:=(e->>'due_at')::timestamptz;business_pending:=e->>'status'='pending';
  END IF;
 END IF;
 -- Lock and qualify every actual consumer before the first source projection write. A bad final
 -- relation cannot leave half-repaired clocks/statuses in another source row.
 IF NOT source_bound_ack AND m.outbound_request_id IS NOT NULL THEN
  SELECT * INTO r FROM public.outbound_requests WHERE id=m.outbound_request_id AND company_id=m.company_id FOR UPDATE;
  IF r.id IS NULL OR r.customer_id IS DISTINCT FROM m.customer_id OR r.site_id IS DISTINCT FROM m.site_id OR r.metering_point_id IS DISTINCT FROM m.metering_point_id THEN RAISE EXCEPTION 'ediel_source_projection_owned_outbound_request_required';END IF;
 END IF;
 IF NOT source_bound_ack AND m.grid_owner_data_request_id IS NOT NULL THEN
  SELECT * INTO g FROM public.grid_owner_data_requests WHERE id=m.grid_owner_data_request_id AND company_id=m.company_id FOR UPDATE;
  IF g.id IS NULL OR g.customer_id IS DISTINCT FROM m.customer_id OR g.site_id IS DISTINCT FROM m.site_id OR g.metering_point_id IS DISTINCT FROM m.metering_point_id THEN RAISE EXCEPTION 'ediel_source_projection_owned_data_request_required';END IF;
 END IF;
 IF m.message_family='PRODAT' AND m.message_code='Z01' THEN
  PERFORM x.id FROM public.customer_info_requests x WHERE x.ediel_message_id=m.id ORDER BY x.id FOR UPDATE;
  IF (SELECT count(*) FROM public.customer_info_requests x WHERE x.ediel_message_id=m.id)>1 THEN RAISE EXCEPTION 'ediel_source_projection_info_request_not_unique';END IF;
  SELECT * INTO c FROM public.customer_info_requests WHERE ediel_message_id=m.id;
  IF c.id IS NOT NULL AND (c.company_id IS DISTINCT FROM m.company_id OR c.customer_id IS DISTINCT FROM m.customer_id OR c.site_id IS DISTINCT FROM m.site_id OR c.metering_point_id IS DISTINCT FROM m.metering_point_id
    OR c.outbound_request_id IS DISTINCT FROM m.outbound_request_id OR c.grid_owner_data_request_id IS DISTINCT FROM m.grid_owner_data_request_id) THEN RAISE EXCEPTION 'ediel_source_projection_owned_info_request_required';END IF;
 END IF;
 -- A positive technical/application ACK does not fulfill a pending Z02.
 -- Only current pre-business/waiting state may gain the business watch; a
 -- progressed business result and its cleared deadline remain established.
 business_watch_pending:=NOT business_terminal AND business_pending AND (c.id IS NULL OR c.status IN('ready_to_send','z01_prepared','sent_to_grid_owner','sent','waiting_response','waiting_for_z02'));
 -- Current row facts decide whether a watch is still pending. Received/final
 -- ACK state and cleared deadlines survive later receipt projection repair.
 UPDATE public.ediel_messages SET message_sent_at=observed,
  contrl_due_at=CASE WHEN technical_basis='frozen_plan' THEN technical_due ELSE contrl_due_at END,
  ack_due_at=CASE WHEN technical_basis='frozen_plan' THEN technical_due ELSE ack_due_at END,
  business_response_due_at=CASE WHEN NOT business_watch_pending THEN business_response_due_at ELSE business_due END,
  updated_by=p_actor_user_id,updated_at=now() WHERE id=m.id;
 IF NOT source_bound_ack AND r.id IS NOT NULL THEN
  UPDATE public.outbound_requests SET status=CASE WHEN status IN('draft','queued','prepared') THEN 'sent' ELSE status END,sent_at=observed,
   failure_reason=CASE WHEN status IN('draft','queued','prepared') THEN NULL ELSE failure_reason END,updated_by=p_actor_user_id,updated_at=now()
  WHERE id=r.id RETURNING status INTO request_status;
 END IF;
 IF NOT source_bound_ack AND g.id IS NOT NULL THEN
  UPDATE public.grid_owner_data_requests SET status=CASE WHEN status='pending' THEN 'sent' ELSE status END,sent_at=observed,
   failed_at=CASE WHEN status='pending' THEN NULL ELSE failed_at END,failure_reason=CASE WHEN status='pending' THEN NULL ELSE failure_reason END,updated_by=p_actor_user_id,updated_at=now()
  WHERE id=g.id RETURNING status INTO data_status;
 END IF;
 IF c.id IS NOT NULL THEN
  UPDATE public.customer_info_requests SET
   status=CASE WHEN NOT business_terminal AND business_pending AND status IN('ready_to_send','z01_prepared','sent_to_grid_owner','sent','waiting_response') THEN 'waiting_for_z02' ELSE status END,
   sent_at=observed,
   blocker_code=CASE WHEN NOT business_terminal AND business_pending AND status IN('ready_to_send','z01_prepared','sent_to_grid_owner','sent','waiting_response') THEN NULL ELSE blocker_code END,
   blocker_reason=CASE WHEN NOT business_terminal AND business_pending AND status IN('ready_to_send','z01_prepared','sent_to_grid_owner','sent','waiting_response') THEN NULL ELSE blocker_reason END,
   blocker_details=CASE WHEN NOT business_terminal AND business_pending AND status IN('ready_to_send','z01_prepared','sent_to_grid_owner','sent','waiting_response') THEN '{}'::jsonb ELSE blocker_details END,
   next_required_action=CASE WHEN NOT business_terminal AND business_pending AND status IN('ready_to_send','z01_prepared','sent_to_grid_owner','sent','waiting_response') THEN 'Invänta Z02 eller negativ APERAK från nätägaren. CONTRL bevakas parallellt från faktisk Z01-sändtid.' ELSE next_required_action END,
   updated_by=p_actor_user_id,updated_at=now() WHERE id=c.id RETURNING status INTO info_status;
 END IF;
 IF m.message_code='Z08' AND gridex_supply_rescission.outbound_required_v1(m.raw_payload) IS TRUE AND gridex_supply_rescission.sender_v1(p_company_id,p_actor_user_id) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_h_projection_terminal_sender_required' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('status','source_projection','companyId',m.company_id,'environment',m.environment,'messageId',m.id,'originalHash',receipt->>'originalHash','observedAt',observed,
  'technicalDeadlineBasis',technical_basis,'outboundRequestStatus',request_status,'dataRequestStatus',data_status,'infoRequestStatus',info_status,'authorizesProviderEntry',false);
END $_$;
$ack_projection_definition$;
 SELECT pg_catalog.to_jsonb(p)-'prosrc',p.prosrc INTO after_metadata,after_source
 FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('public.ediel_project_accepted_source_state_v1(uuid,text,uuid,uuid,text)');
 IF after_metadata IS DISTINCT FROM before_metadata OR after_source IS NULL
  OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(after_source,'UTF8')),'hex') IS DISTINCT FROM '66d86e98130ca6f5e64ae966d710f35bce86204452febe714684025943a81f17' THEN
  RAISE EXCEPTION 'ediel_source_bound_ack_projection_postimage_or_metadata_changed';
 END IF;
END $ack_projection_migration$;
COMMIT;
