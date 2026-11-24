-- Return a newly persisted metering-method watch expiry within the requested response limit.
DO $expiry_priority$
DECLARE
  owner_oid regprocedure := to_regprocedure('gridex_method_expectations.mutate_before_requested_method_original_v1(jsonb)');
  before_update pg_proc%ROWTYPE;
  after_update pg_proc%ROWTYPE;
BEGIN
  SELECT * INTO before_update FROM pg_proc WHERE oid=owner_oid;
  IF before_update.prosecdef IS DISTINCT FROM true
    OR encode(sha256(convert_to(before_update.prosrc,'UTF8')),'hex') IS DISTINCT FROM 'ab51167c1f1e907f0e4dff15d0c53d3ef161a7a9c43a8bf44749fa7f854a414f'
  THEN RAISE EXCEPTION 'ediel_method_expectation_expiry_predecessor_changed' USING ERRCODE='55000'; END IF;

CREATE OR REPLACE FUNCTION gridex_method_expectations.mutate_before_requested_method_original_v1(i jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE c uuid:=(i->>'companyId')::uuid;env text:=i->>'environment';actor uuid:=(i->>'actorUserId')::uuid;
 action text:=i->>'action';mid uuid:=(i->>'messageId')::uuid;lim integer:=greatest(1,least(coalesce((i->>'limit')::integer,100),500));
 m public.ediel_messages%rowtype;b gridex_method_expectations.bindings%rowtype;original jsonb;accepted jsonb;binding jsonb;plan jsonb;cfg jsonb;
 expected uuid;day date;due_day date;result jsonb;e uuid; changed_id uuid; changed_ids uuid[]:=ARRAY[]::uuid[]; BEGIN
 IF c IS NULL OR actor IS NULL OR env IS NULL OR env NOT IN('test','production') OR action IS NULL OR action NOT IN('register','read','observe','expire') THEN RAISE EXCEPTION 'ediel_method_expectation_scope_required';END IF;
 PERFORM u.id FROM public.user_profiles u WHERE u.id=actor FOR SHARE;
 PERFORM cm.id FROM public.company_memberships cm WHERE cm.company_id=c AND cm.user_id=actor FOR SHARE;
 IF NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=actor AND u.user_status='active') OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=c AND cm.user_id=actor AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL)
  OR (CASE WHEN action='read' THEN public.gridex_actor_has_company_permission(actor,c,'communication.read')
   WHEN action IN('register','expire') THEN (public.gridex_actor_has_company_permission(actor,c,'ediel.send') OR public.gridex_actor_has_company_permission(actor,c,'communication.send'))
   ELSE public.gridex_actor_has_company_permission(actor,c,'communication.write') END) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_method_expectation_actor_forbidden' USING ERRCODE='42501';END IF;
 IF action='register' THEN
  SELECT * INTO STRICT m FROM public.ediel_messages WHERE company_id=c AND environment=env AND id=mid AND direction='outbound' FOR UPDATE;
  SELECT * INTO b FROM gridex_method_expectations.bindings WHERE source_message_id=mid;
  IF FOUND THEN
   IF b.company_id IS DISTINCT FROM c OR b.environment IS DISTINCT FROM env OR b.source_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'ediel_method_expectation_original_changed';END IF;
   PERFORM gridex_method_expectations.reconcile_v1(b.expectation_id);
   RETURN jsonb_build_array((SELECT to_jsonb(x) FROM public.ediel_business_expectations x WHERE x.id=b.expectation_id));
  END IF;
  original:=gridex_metering_method_changes.frozen_original_basis_v1(c,mid);
  IF original IS NULL THEN RETURN '[]'::jsonb;END IF;
  accepted:=gridex_ediel_transport.accepted_source_basis_v1(m);
  IF accepted IS NULL THEN RAISE EXCEPTION 'ediel_method_expectation_actual_accepted_send_required';END IF;
  SELECT a.binding INTO STRICT binding FROM gridex_ediel_transport.attempts a WHERE a.id=(accepted->>'attemptId')::uuid AND a.company_id=c AND a.environment=env AND a.message_id=mid AND accepted->>'lane'='generic_journal';
  PERFORM gridex_method_expectations.require_binding_v1(m,binding);plan:=binding->'meteringMethodExpectationPlan';
  SELECT * INTO b FROM gridex_method_expectations.bindings WHERE company_id=c AND environment=env AND event_id=(original->>'eventId')::uuid FOR SHARE;
  IF b.expectation_id IS NOT NULL AND EXISTS(SELECT FROM gridex_metering_method_changes.recovery_receipts own WHERE own.company_id=c AND own.message_id=mid AND own.event_id=b.event_id) THEN
   IF b.original_basis->'basis' IS DISTINCT FROM original->'basis' OR b.validity_day IS DISTINCT FROM to_date(original->>'validityDay','YYYYMMDD') THEN RAISE EXCEPTION 'metering_method_recovery_watch_event_changed';END IF;
   INSERT INTO gridex_method_expectations.recovery_carriers(message_id,company_id,environment,expectation_id,operation_id,payload_hash,accepted_basis)
    VALUES(mid,c,env,b.expectation_id,(original->>'recoveryOperationId')::uuid,original->>'sourcePayloadHash',accepted) ON CONFLICT(message_id) DO NOTHING;
   IF NOT EXISTS(SELECT FROM gridex_method_expectations.recovery_carriers own WHERE own.company_id=c AND own.message_id=mid AND own.expectation_id=b.expectation_id AND own.operation_id=(original->>'recoveryOperationId')::uuid AND own.payload_hash=original->>'sourcePayloadHash' AND own.accepted_basis=accepted) THEN RAISE EXCEPTION 'metering_method_recovery_watch_carrier_changed';END IF;
   PERFORM gridex_method_expectations.reconcile_v1(b.expectation_id);
   RETURN jsonb_build_array((SELECT to_jsonb(x) FROM public.ediel_business_expectations x WHERE x.id=b.expectation_id));
  END IF;
  SELECT projection INTO STRICT cfg FROM gridex_method_expectations.editions WHERE source_version='2c97fad0987131bb221c6bafb4c7c21183f6d7168a57486199b228cf1e452f31';
  day:=to_date(original->>'validityDay','YYYYMMDD');due_day:=day+(cfg->>'offset')::integer;
  INSERT INTO public.ediel_business_expectations(company_id,environment,source_message_id,source_operation_id,expected_family,expected_code,expected_subtype,due_at,metadata)
   VALUES(c,env,mid,original->>'eventId',cfg->>'expectedFamily',cfg->>'expectedCode',NULL,((due_day+1)::timestamp AT TIME ZONE 'Europe/Stockholm'),
    jsonb_build_object('timerRuleId',cfg->>'ruleId','timerKind',cfg->>'timerKind','anchorType',cfg->>'anchor','validityDay',day,'dueDay',due_day,
     'actualAcceptedAt',accepted->>'observedAt','remoteReceiptKnown',false,'automaticResendAllowed',false,'authorizesMarketEffects',false,
     'observationCriterion','same_applied_own_Z06_explicit_method_customer_point_agency_parties_and_not_before_validity_day','preparedPolicy',plan->'policy')) RETURNING id INTO expected;
  INSERT INTO gridex_method_expectations.bindings(expectation_id,company_id,environment,source_message_id,event_id,source_payload_hash,source_version,original_basis,plan,accepted_basis,accepted_at,validity_day,due_day)
   VALUES(expected,c,env,mid,(original->>'eventId')::uuid,original->>'sourcePayloadHash','2c97fad0987131bb221c6bafb4c7c21183f6d7168a57486199b228cf1e452f31',original,plan,accepted,(accepted->>'observedAt')::timestamptz,day,due_day);
  PERFORM gridex_method_expectations.reconcile_v1(expected);
  RETURN jsonb_build_array((SELECT to_jsonb(x) FROM public.ediel_business_expectations x WHERE x.id=expected));
 END IF;
 IF action='observe' THEN
  PERFORM observed_source.id FROM public.ediel_messages observed_source WHERE observed_source.id=mid AND observed_source.company_id=c AND observed_source.environment=env AND observed_source.direction='inbound';
  IF NOT FOUND THEN RAISE EXCEPTION 'ediel_method_expectation_observed_source_scope_required';END IF;
 END IF;
 FOR e IN SELECT owned.expectation_id FROM gridex_method_expectations.bindings owned JOIN public.ediel_business_expectations x ON x.id=owned.expectation_id
  WHERE owned.company_id=c AND owned.environment=env AND (action='observe' OR mid IS NULL OR (owned.source_message_id=mid OR EXISTS(SELECT FROM gridex_method_expectations.recovery_carriers alias WHERE alias.company_id=c AND alias.environment=env AND alias.message_id=mid AND alias.expectation_id=owned.expectation_id)))
   AND (action IN('read','observe') OR x.status='pending' AND (clock_timestamp() AT TIME ZONE 'Europe/Stockholm')::date>owned.due_day)
  ORDER BY owned.expectation_id LIMIT lim LOOP
  IF action<>'read' THEN PERFORM gridex_method_expectations.reconcile_v1(e,CASE WHEN action='observe' THEN mid ELSE NULL END);END IF;
  IF action='expire' THEN UPDATE public.ediel_business_expectations x SET status='manual_review',updated_at=clock_timestamp(),
   metadata=metadata||jsonb_build_object('expiredAt',clock_timestamp(),'automaticResendAllowed',false,'authorizesMarketEffects',false)
   FROM gridex_method_expectations.bindings owned WHERE x.id=e AND owned.expectation_id=x.id AND x.status='pending' AND (clock_timestamp() AT TIME ZONE 'Europe/Stockholm')::date>owned.due_day RETURNING x.id INTO changed_id;
   IF FOUND THEN changed_ids:=array_append(changed_ids,changed_id); END IF;
  END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(to_jsonb(x)-'return_rank' ORDER BY x.return_rank,x.created_at,x.id),'[]') INTO result
 FROM (SELECT x.*, CASE
   WHEN action='expire' AND x.id=ANY(changed_ids) THEN 0
   WHEN action='expire' AND x.status='manual_review' AND x.metadata ? 'expiredAt' THEN 1
   ELSE 2 END AS return_rank
 FROM public.ediel_business_expectations x JOIN gridex_method_expectations.bindings owned ON owned.expectation_id=x.id
  WHERE owned.company_id=c AND owned.environment=env AND (action='observe' OR mid IS NULL OR (owned.source_message_id=mid OR EXISTS(SELECT FROM gridex_method_expectations.recovery_carriers alias WHERE alias.company_id=c AND alias.environment=env AND alias.message_id=mid AND alias.expectation_id=owned.expectation_id))) ORDER BY return_rank,x.created_at,x.id LIMIT lim)x;
 RETURN result;
END $$;

  SELECT * INTO STRICT after_update FROM pg_proc WHERE oid=owner_oid;
  IF encode(sha256(convert_to(after_update.prosrc,'UTF8')),'hex') IS DISTINCT FROM '1c7279dd03b185b126020e133533a11b7df902539573598bd324699667640a65'
    OR (to_jsonb(after_update)-'prosrc') IS DISTINCT FROM (to_jsonb(before_update)-'prosrc')
  THEN RAISE EXCEPTION 'ediel_method_expectation_expiry_authority_changed' USING ERRCODE='55000'; END IF;
END
$expiry_priority$;
