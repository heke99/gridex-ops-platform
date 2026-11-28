-- Return a newly persisted business-watch expiry within the requested response limit.
DO $expiry_priority$
DECLARE
  owner_oid regprocedure := to_regprocedure('gridex_business_expectations.mutate_v1(jsonb)');
  before_update pg_proc%ROWTYPE;
  after_update pg_proc%ROWTYPE;
BEGIN
  SELECT * INTO before_update FROM pg_proc WHERE oid=owner_oid;
  IF before_update.prosecdef IS DISTINCT FROM true
    OR encode(sha256(convert_to(before_update.prosrc,'UTF8')),'hex') IS DISTINCT FROM 'c01f283fc49ddf59a8a395a0af89795ac4999230dfcfc5a9eb951fcf849c54d3'
  THEN RAISE EXCEPTION 'ediel_expectation_expiry_predecessor_changed' USING ERRCODE='55000'; END IF;

CREATE OR REPLACE FUNCTION gridex_business_expectations.mutate_v1(p_input jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE c uuid:=(p_input->>'companyId')::uuid; env text:=p_input->>'environment'; actor uuid:=(p_input->>'actorUserId')::uuid;
 action text:=p_input->>'action'; mid uuid:=(p_input->>'messageId')::uuid; lim integer:=greatest(1,least(coalesce((p_input->>'limit')::integer,100),500));
 m public.ediel_messages%rowtype; a gridex_ediel_transport.attempts%rowtype; b gridex_business_expectations.bindings%rowtype;
 tokens jsonb; plan jsonb; code text; due timestamptz; expected_id uuid; e uuid; offset_value integer; result jsonb;sealed jsonb;sealed_attempt uuid; changed_id uuid; changed_ids uuid[]:=ARRAY[]::uuid[];
BEGIN
 IF c IS NULL OR actor IS NULL OR env IS NULL OR env NOT IN ('test','production') OR action IS NULL OR action NOT IN ('register','read','expire') THEN RAISE EXCEPTION 'ediel_expectation_scope_required'; END IF;
 PERFORM u.id FROM public.user_profiles u WHERE u.id=actor FOR SHARE;
 PERFORM cm.user_id FROM public.company_memberships cm WHERE cm.company_id=c AND cm.user_id=actor FOR SHARE;
 IF NOT EXISTS(SELECT FROM public.company_memberships x WHERE x.company_id=c AND x.user_id=actor AND x.status='active' AND x.is_active AND x.accepted_at IS NOT NULL)
 OR NOT EXISTS(SELECT FROM public.user_profiles x WHERE x.id=actor AND x.user_status='active')
 OR (CASE WHEN action='read' THEN public.gridex_actor_has_company_permission(actor,c,'communication.read') ELSE public.gridex_actor_has_company_permission(actor,c,'ediel.send') OR public.gridex_actor_has_company_permission(actor,c,'communication.send') END) IS NOT TRUE
 THEN RAISE EXCEPTION 'ediel_expectation_actor_not_authorized' USING ERRCODE='42501'; END IF;
 IF action='register' THEN
  SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=mid AND company_id=c AND environment=env FOR UPDATE;
  IF m.direction IS DISTINCT FROM 'outbound' OR m.message_standard IS DISTINCT FROM 'edifact' OR m.immutable_rendered_at IS NULL
   OR m.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'ediel_expectation_sealed_source_required'; END IF;
  tokens:=gridex_received_sources.wire_tokens_bounded_v1(m.raw_payload,999999);
  IF tokens IS NULL OR (SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='UNH')<>1
   OR NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='UNH' AND t#>>'{elements,2,0}'='PRODAT')
   OR (SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='BGM')<>1 THEN RAISE EXCEPTION 'ediel_expectation_physical_source_required'; END IF;
  SELECT t#>>'{elements,1,0}' INTO code FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='BGM';
  IF code NOT IN ('Z01','Z13','Z18','Z08') THEN RETURN '[]'::jsonb; END IF;
  IF code='Z08' THEN
   IF gridex_supply_rescission.outbound_required_v1(m.raw_payload) IS NOT TRUE THEN RETURN '[]'::jsonb;END IF;
   PERFORM gridex_supply_rescission.require_recorded_outbound_source_current_v1(m);
   IF gridex_supply_rescission.sender_v1(c,actor) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_expectation_h_sender_required' USING ERRCODE='42501';END IF;
  END IF;
  SELECT * INTO b FROM gridex_business_expectations.bindings WHERE source_message_id=mid;
  IF FOUND THEN
   IF b.company_id<>c OR b.environment<>env OR b.source_payload_hash IS DISTINCT FROM m.immutable_payload_hash THEN RAISE EXCEPTION 'ediel_expectation_source_changed'; END IF;
   PERFORM gridex_business_expectations.reconcile_v1(b.expectation_id);
   IF code='Z08' AND gridex_supply_rescission.sender_v1(c,actor) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_expectation_h_terminal_sender_required' USING ERRCODE='42501';END IF;
   RETURN jsonb_build_array((SELECT to_jsonb(x) FROM public.ediel_business_expectations x WHERE x.id=b.expectation_id));
  END IF;
  SELECT * INTO a FROM gridex_ediel_transport.attempts WHERE message_id=mid AND company_id=c AND environment=env AND classification='accepted' AND observed_at IS NOT NULL AND entered_at IS NOT NULL ORDER BY observed_at,id LIMIT 1;
  IF NOT FOUND AND code='Z08' THEN
   -- The sealed Z08 lane: exactly one accepted, entered provider result.
   sealed:=gridex_ediel_transport.accepted_source_basis_v1(m);
   -- accepted_source_basis_v1 has already verified entry, provider receipt and plan.
   IF sealed->>'status'='accepted_projection' AND sealed->>'lane'='sealed_z08' AND sealed->>'messageId'=mid::text AND sealed->>'observedAt' IS NOT NULL THEN
    sealed_attempt:=(sealed->>'attemptId')::uuid;
    a.id:=NULL;a.observed_at:=(sealed->>'observedAt')::timestamptz;
    a.binding:=jsonb_build_object('originalHash',sealed->>'originalHash','businessExpectationPlan',sealed->'businessExpectationPlan');
   END IF;
  END IF;
  IF a.id IS NULL AND sealed_attempt IS NULL THEN RAISE EXCEPTION 'ediel_expectation_actual_smtp_acceptance_required'; END IF;
  plan:=a.binding->'businessExpectationPlan';
  IF a.binding->>'originalHash' IS DISTINCT FROM m.immutable_payload_hash OR jsonb_typeof(plan) IS DISTINCT FROM 'object'
   OR plan->>'sourceCode' IS DISTINCT FROM code OR plan->>'version' IS DISTINCT FROM '1' OR plan->>'expectedFamily' IS DISTINCT FROM 'PRODAT'
   OR plan->>'expectedCode' IS DISTINCT FROM (CASE code WHEN 'Z01' THEN 'Z02' WHEN 'Z13' THEN 'Z14' WHEN 'Z18' THEN 'Z15' WHEN 'Z08' THEN 'Z05' END)
   OR plan->>'anchor' IS DISTINCT FROM 'actual_accepted_smtp_observed_at' OR plan->'remoteReceiptKnown' IS DISTINCT FROM 'false'::jsonb
   OR jsonb_typeof(plan#>'{policy,sourceTrace}') IS DISTINCT FROM 'array' OR nullif(plan#>>'{policy,guideRevision}','') IS NULL
   OR nullif(plan#>>'{policy,referenceDate}','') IS NULL THEN RAISE EXCEPTION 'ediel_expectation_prepared_policy_missing'; END IF;
  IF code='Z08' AND plan->'expectedSubtypes' IS DISTINCT FROM '["L"]'::jsonb THEN RAISE EXCEPTION 'ediel_expectation_h_exact_response_required';END IF;
  due:=NULL;
  IF code IN('Z18','Z08') THEN
   IF plan->'offset' IS DISTINCT FROM 'null'::jsonb OR plan->'unit' IS DISTINCT FROM 'null'::jsonb OR plan->>'timerKind' IS DISTINCT FROM 'untimed_business_response' THEN RAISE EXCEPTION 'ediel_expectation_unsupported_timer'; END IF;
  ELSE
   offset_value:=(plan->>'offset')::integer;
   IF offset_value IS NULL OR offset_value<=0 OR plan->>'timerKind' IS DISTINCT FROM 'internal_sender_watch'
    OR jsonb_typeof(plan->'deadlineSource') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'ediel_expectation_deadline_authority_missing'; END IF;
   IF plan->>'unit'='minutes' THEN due:=a.observed_at+make_interval(mins=>offset_value);
   ELSIF plan->>'unit'='calendar_days' THEN due:=((a.observed_at AT TIME ZONE 'Europe/Stockholm')+make_interval(days=>offset_value)) AT TIME ZONE 'Europe/Stockholm';
   ELSE RAISE EXCEPTION 'ediel_expectation_timer_unit_invalid'; END IF;
  END IF;
  INSERT INTO public.ediel_business_expectations(company_id,environment,source_message_id,source_operation_id,expected_family,expected_code,expected_subtype,due_at,metadata)
   VALUES(c,env,mid,coalesce(nullif(m.source_operation_id,''),m.operation_id::text,'source_message:'||mid::text),'PRODAT',plan->>'expectedCode',CASE code WHEN 'Z08' THEN 'L' ELSE NULL END,due,
    jsonb_build_object('timerKind',plan->>'timerKind','timerRuleId',plan->'timerRuleId','anchorType','actual_accepted_smtp_observed_at','anchorAt',a.observed_at,
     'remoteReceiptKnown',false,'automaticResendAllowed',false,'preparedPolicy',plan->'policy','transportAttemptId',coalesce(a.id,sealed_attempt))) RETURNING id INTO expected_id;
  INSERT INTO gridex_business_expectations.bindings(expectation_id,company_id,environment,source_message_id,transport_attempt_id,dispatch_attempt_id,source_payload_hash,observed_at,plan)
   VALUES(expected_id,c,env,mid,a.id,sealed_attempt,m.immutable_payload_hash,a.observed_at,plan);
  -- Reconcile after insertion too: a genuine response may have won the race.
  PERFORM gridex_business_expectations.reconcile_v1(expected_id);
  IF code='Z08' AND gridex_supply_rescission.sender_v1(c,actor) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_expectation_h_terminal_sender_required' USING ERRCODE='42501';END IF;
   RETURN jsonb_build_array((SELECT to_jsonb(x) FROM public.ediel_business_expectations x WHERE x.id=expected_id));
 END IF;
 FOR e IN SELECT x.id FROM public.ediel_business_expectations x JOIN gridex_business_expectations.bindings owned ON owned.expectation_id=x.id
  WHERE x.company_id=c AND x.environment=env AND (mid IS NULL OR x.source_message_id=mid)
   AND (action='read' OR x.status='pending' AND x.due_at IS NOT NULL AND x.due_at<=now()) ORDER BY x.created_at,x.id LIMIT lim LOOP
  PERFORM gridex_business_expectations.reconcile_v1(e);
  IF action='expire' THEN UPDATE public.ediel_business_expectations SET status='manual_review',updated_at=now(),metadata=metadata||jsonb_build_object('expiredAt',now(),'remoteReceiptKnown',false,'automaticResendAllowed',false)
   WHERE id=e AND status='pending' AND due_at IS NOT NULL AND due_at<=now()
   RETURNING id INTO changed_id;
   IF FOUND THEN changed_ids:=array_append(changed_ids,changed_id); END IF;
  END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(to_jsonb(x)-'return_rank' ORDER BY x.return_rank,x.created_at,x.id),'[]') INTO result FROM
  (SELECT x.*, CASE
      WHEN action='expire' AND x.id=ANY(changed_ids) THEN 0
      WHEN action='expire' AND x.status='manual_review' AND x.metadata ? 'expiredAt' THEN 1
      ELSE 2 END AS return_rank
   FROM public.ediel_business_expectations x
   JOIN gridex_business_expectations.bindings owned ON owned.expectation_id=x.id
   WHERE x.company_id=c AND x.environment=env AND (mid IS NULL OR x.source_message_id=mid)
   ORDER BY return_rank,x.created_at,x.id LIMIT lim) x;
 RETURN result;
END $$;

  SELECT * INTO STRICT after_update FROM pg_proc WHERE oid=owner_oid;
  IF encode(sha256(convert_to(after_update.prosrc,'UTF8')),'hex') IS DISTINCT FROM '6b03842ef22c4e93eed3cc582173f58fb582bdaac1e4ed1ff0a364993abffd17'
    OR (to_jsonb(after_update)-'prosrc') IS DISTINCT FROM (to_jsonb(before_update)-'prosrc')
  THEN RAISE EXCEPTION 'ediel_expectation_expiry_authority_changed' USING ERRCODE='55000'; END IF;
END
$expiry_priority$;
