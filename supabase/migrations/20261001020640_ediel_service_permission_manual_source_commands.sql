-- The actual manual producers consume the same current service authority.
-- These receipts describe prospective internal requests, never legal approval.
BEGIN;
CREATE TABLE gridex_service_administration.permission_request_owners(
 company_id uuid NOT NULL,permission_id uuid PRIMARY KEY,assignment_id uuid NOT NULL,scope_basis_version bigint NOT NULL,scope jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,permission_id) REFERENCES public.metering_permissions(company_id,id),
 FOREIGN KEY(company_id,assignment_id) REFERENCES public.ediel_service_assignments(company_id,id)
);
CREATE TABLE gridex_service_administration.manual_permission_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,customer_id uuid NOT NULL,actor_user_id uuid NOT NULL REFERENCES auth.users(id),selection jsonb NOT NULL,selection_hash text NOT NULL,missing jsonb NOT NULL,task_id uuid UNIQUE NOT NULL REFERENCES public.customer_operation_tasks(id),recorded_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,customer_id) REFERENCES public.customers(company_id,id),UNIQUE(company_id,customer_id,actor_user_id,selection_hash)
);
ALTER TABLE gridex_service_administration.permission_request_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_service_administration.permission_request_owners FORCE ROW LEVEL SECURITY;
ALTER TABLE gridex_service_administration.manual_permission_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_service_administration.manual_permission_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_service_administration.permission_request_owners,gridex_service_administration.manual_permission_requests FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER service_permission_request_owner_immutable BEFORE UPDATE OR DELETE ON gridex_service_administration.permission_request_owners FOR EACH ROW EXECUTE FUNCTION gridex_service_administration.immutable_v1();
CREATE TRIGGER service_permission_request_owner_no_truncate BEFORE TRUNCATE ON gridex_service_administration.permission_request_owners FOR EACH STATEMENT EXECUTE FUNCTION gridex_service_administration.immutable_v1();
CREATE TRIGGER service_manual_request_immutable BEFORE UPDATE OR DELETE ON gridex_service_administration.manual_permission_requests FOR EACH ROW EXECUTE FUNCTION gridex_service_administration.immutable_v1();
CREATE TRIGGER service_manual_request_no_truncate BEFORE TRUNCATE ON gridex_service_administration.manual_permission_requests FOR EACH STATEMENT EXECUTE FUNCTION gridex_service_administration.immutable_v1();

CREATE FUNCTION gridex_service_administration.require_manual_actor_v1(c uuid,actor uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM u.id FROM public.user_profiles u WHERE u.id=actor FOR SHARE;
 PERFORM m.user_id FROM public.company_memberships m WHERE m.company_id=c AND m.user_id=actor FOR SHARE;
 IF c IS NULL OR actor IS NULL OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=actor AND u.user_status='active') OR NOT EXISTS(SELECT FROM public.company_memberships m WHERE m.company_id=c AND m.user_id=actor AND m.status='active' AND m.is_active AND m.accepted_at IS NOT NULL) OR public.gridex_actor_has_company_permission(actor,c,'metering.write') IS NOT TRUE THEN RAISE EXCEPTION 'ediel_service_manual_actor_forbidden' USING ERRCODE='42501';END IF;
END $$;
REVOKE ALL ON FUNCTION gridex_service_administration.require_manual_actor_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Discovery is a lock-order superset of the shared market tuple, never a
-- permission/compatibility decision. Immutable source rows precede the tuple
-- and assignment/permission locks also used by provider entry.
CREATE FUNCTION gridex_service_administration.permission_originals_for_tuple_v1(a public.ediel_service_assignments) RETURNS uuid[] LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(array_agg(DISTINCT o.message_id ORDER BY o.message_id),'{}'::uuid[]) FROM gridex_service_permission.origins o JOIN public.ediel_service_assignments b ON b.company_id=o.company_id AND b.id=o.assignment_id WHERE o.company_id=a.company_id AND o.message_code='Z13' AND o.message_id IS NOT NULL AND b.environment=a.environment AND b.provider_actor_id=a.provider_actor_id AND b.customer_id=a.customer_id AND b.dso_actor_id=a.dso_actor_id AND b.mode=a.mode
$$;
REVOKE ALL ON FUNCTION gridex_service_administration.permission_originals_for_tuple_v1(public.ediel_service_assignments) FROM PUBLIC,anon,authenticated,service_role;

-- Reuse is an explicit result, separate from originating the first market
-- request. A declined/expired/narrower Z14 never becomes a reuse authority.
CREATE FUNCTION public.ediel_resolve_service_permission_command_v1(p_company_id uuid,p_assignment_id uuid,p_actor_user_id uuid,p_expected_version bigint,p_permission_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public.ediel_service_assignments%rowtype;p public.metering_permissions%rowtype;owner public.ediel_service_assignments%rowtype;owner_id uuid;owner_scope bigint;owner_snapshot jsonb;assessment jsonb;original uuid;original_row public.ediel_messages%rowtype;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'ediel_service_manual_service_required' USING ERRCODE='42501';END IF;
 PERFORM gridex_service_administration.require_manual_actor_v1(p_company_id,p_actor_user_id);
 IF p_assignment_id IS NULL OR p_permission_id IS NULL OR p_expected_version IS NULL OR p_expected_version<1 THEN RAISE EXCEPTION 'ediel_service_permission_command_scope_required';END IF;
 SELECT * INTO STRICT a FROM public.ediel_service_assignments WHERE company_id=p_company_id AND id=p_assignment_id;
 -- Discover only an immutable origin; lock its actual source before assignments
 -- and permission rows, matching the provider's source-before-projection order.
 SELECT o.message_id INTO original FROM gridex_service_permission.origins o WHERE o.company_id=p_company_id AND o.permission_id=p_permission_id AND o.message_code='Z13';
 IF original IS NOT NULL THEN SELECT * INTO original_row FROM public.ediel_messages WHERE company_id=p_company_id AND id=original FOR SHARE;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(a.company_id::text||':'||a.environment||':'||a.provider_actor_id::text||':'||a.customer_id::text||':'||a.dso_actor_id::text||':'||a.mode,0));
 IF (SELECT o.message_id FROM gridex_service_permission.origins o WHERE o.company_id=p_company_id AND o.permission_id=p_permission_id AND o.message_code='Z13') IS DISTINCT FROM original THEN RETURN jsonb_build_object('status','held','missing',ARRAY['permission_original_changed_retry_required']);END IF;
 SELECT * INTO STRICT a FROM public.ediel_service_assignments WHERE company_id=p_company_id AND id=p_assignment_id FOR SHARE;
 IF a.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'ediel_assignment_version_stale';END IF;
 assessment:=public.ediel_service_assignment_assessment_v1(a.company_id,a.id);
 IF assessment->>'status' IS DISTINCT FROM 'authorized' THEN RETURN assessment;END IF;
 SELECT * INTO STRICT p FROM public.metering_permissions WHERE company_id=p_company_id AND id=p_permission_id FOR SHARE;
 IF p.customer_id IS DISTINCT FROM a.customer_id OR NOT EXISTS(SELECT FROM public.ediel_assignment_permission_links l WHERE l.company_id=a.company_id AND l.assignment_id=a.id AND l.permission_id=p.id) THEN RAISE EXCEPTION 'ediel_service_manual_permission_not_linked';END IF;
 PERFORM s.id FROM public.metering_permission_sites s WHERE s.company_id=a.company_id AND s.metering_permission_id=p.id ORDER BY s.id FOR SHARE;
 IF p.status IN ('active','approved','partially_approved','z14_received') THEN
  IF gridex_service_administration.permission_matches_assignment_v1(a,p) IS NOT TRUE
   OR EXISTS(SELECT FROM unnest(a.object_ids) object_id CROSS JOIN unnest(a.product_ids) product_id WHERE NOT EXISTS(SELECT FROM public.metering_permission_sites s WHERE s.company_id=a.company_id AND s.metering_permission_id=p.id AND s.customer_id=a.customer_id AND s.facility_id=object_id AND s.status IN('approved','active') AND s.metadata->>'source'='inbound_prodat_z14' AND s.metadata->>'edielMessageId'=coalesce(p.inbound_z14_message_id,p.source_z14_message_id)::text AND s.metadata->>'mode'=CASE a.mode WHEN 'V' THEN 'S17' ELSE 'S18' END AND s.metadata->>'product'=product_id AND s.start_at IS NOT NULL AND a.data_start>=s.start_at AND (s.end_at IS NULL OR (a.data_end IS NOT NULL AND a.data_end<=s.end_at)) AND (s.permission_end_at IS NULL OR s.permission_end_at>now())))
   THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_source_approved_compatible_permission']);END IF;
  RETURN jsonb_build_object('status','reuse_permission','permissionId',p.id,'marketPermissionState','approved','accessGranted',false);
 END IF;
 IF (p.status IN('draft','z13_ready','z13_sent','waiting_for_customer_approval')) IS NOT TRUE THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_permission_request_state']);END IF;
 SELECT r.assignment_id,r.scope_basis_version,r.scope INTO owner_id,owner_scope,owner_snapshot FROM gridex_service_administration.permission_request_owners r WHERE r.company_id=a.company_id AND r.permission_id=p.id;
 IF owner_id IS NULL THEN
  -- An existing genuinely reserved/bound source origin is a retained owner.
  -- A parsed metadata assignment_id or today's sole link is not historical proof.
  SELECT o.assignment_id,(o.basis->>'scopeBasisVersion')::bigint,o.message_id INTO owner_id,owner_scope,original FROM gridex_service_permission.origins o WHERE o.company_id=a.company_id AND o.permission_id=p.id AND o.message_code='Z13';
 ELSE
  SELECT o.message_id INTO original FROM gridex_service_permission.origins o WHERE o.company_id=a.company_id AND o.permission_id=p.id AND o.message_code='Z13';
 END IF;
 IF owner_id IS NULL THEN RETURN jsonb_build_object('status','held','missing',ARRAY['prospective_or_original_permission_request_owner']);END IF;
 SELECT * INTO owner FROM public.ediel_service_assignments WHERE company_id=a.company_id AND id=owner_id FOR SHARE;
 IF NOT FOUND OR owner.scope_basis_version IS DISTINCT FROM owner_scope OR (owner_snapshot IS NOT NULL AND gridex_service_administration.scope_v1(owner) IS DISTINCT FROM owner_snapshot)
  OR owner.environment IS DISTINCT FROM a.environment OR owner.provider_actor_id IS DISTINCT FROM a.provider_actor_id OR owner.customer_id IS DISTINCT FROM a.customer_id OR owner.dso_actor_id IS DISTINCT FROM a.dso_actor_id OR owner.mode IS DISTINCT FROM a.mode OR owner.purpose IS DISTINCT FROM a.purpose
  OR NOT(a.object_ids<@owner.object_ids AND a.product_ids<@owner.product_ids AND a.field_sets<@owner.field_sets) OR a.data_start<owner.data_start OR (owner.data_end IS NOT NULL AND (a.data_end IS NULL OR a.data_end>owner.data_end)) OR public.ediel_service_assignment_assessment_v1(a.company_id,owner.id)->>'status' IS DISTINCT FROM 'authorized'
  THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_compatible_permission_request_owner']);END IF;
 IF p.outbound_z13_message_id IS NOT NULL OR p.source_z13_message_id IS NOT NULL THEN
  IF original IS NULL OR p.outbound_z13_message_id IS DISTINCT FROM original OR p.source_z13_message_id IS DISTINCT FROM original OR original_row.id IS DISTINCT FROM original OR original_row.company_id IS DISTINCT FROM a.company_id OR original_row.environment IS DISTINCT FROM a.environment OR original_row.direction IS DISTINCT FROM 'outbound' OR original_row.message_family IS DISTINCT FROM 'PRODAT' OR original_row.message_code IS DISTINCT FROM 'Z13' OR original_row.customer_id IS DISTINCT FROM a.customer_id OR NOT EXISTS(SELECT FROM gridex_service_permission.origins o WHERE o.company_id=a.company_id AND o.permission_id=p.id AND o.assignment_id=owner.id AND o.message_id=original_row.id AND o.intent_id=original_row.intent_id AND o.message_code='Z13') THEN RETURN jsonb_build_object('status','held','missing',ARRAY['immutable_owned_pending_permission_original']);END IF;
  -- This sole canonical owner compares the saved bytes to the prospective
  -- immutable witness. It does not select a new rule or alter the old original.
  PERFORM gridex_ediel_outbound_owner.require_v1(a.company_id,original);
  IF original_row.status='draft' AND owner.id=a.id THEN
   -- Only the exact first owner's bound draft can resume the canonical gateway
   -- after a pre-queue crash. A different beneficiary never queues that request.
   PERFORM r.id FROM public.outbound_requests r WHERE r.company_id=a.company_id AND r.id=original_row.outbound_request_id FOR SHARE;
   IF original_row.outbound_request_id IS NULL OR NOT EXISTS(SELECT FROM public.outbound_requests r WHERE r.company_id=a.company_id AND r.id=original_row.outbound_request_id AND r.customer_id=a.customer_id AND r.source_type='manual' AND r.source_id=original_row.intent_id AND r.request_type='metering_access' AND r.operation_id=p.id AND r.payload->>'servicePermissionCommandKey'=original_row.intent_id::text AND r.payload->>'environment'=a.environment) THEN RETURN jsonb_build_object('status','held','missing',ARRAY['owned_bound_first_draft_request']);END IF;
   RETURN jsonb_build_object('status','permission_required','permissionId',p.id,'messageId',original,'intentId',original_row.intent_id,'outboundRequestId',original_row.outbound_request_id);
  END IF;
  RETURN jsonb_build_object('status','reuse_permission','permissionId',p.id,'marketPermissionState','pending','messageId',original,'accessGranted',false);
 END IF;
 IF owner.id IS DISTINCT FROM a.id THEN RETURN jsonb_build_object('status','reuse_permission','permissionId',p.id,'marketPermissionState','pending','accessGranted',false);END IF;
 RETURN jsonb_build_object('status','permission_required','permissionId',p.id);
END $$;
REVOKE ALL ON FUNCTION public.ediel_resolve_service_permission_command_v1(uuid,uuid,uuid,bigint,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_resolve_service_permission_command_v1(uuid,uuid,uuid,bigint,uuid) TO service_role;

ALTER FUNCTION public.ediel_coordinate_service_permission_v1(uuid,uuid,uuid,bigint,text) SET SCHEMA gridex_service_administration;
ALTER FUNCTION gridex_service_administration.ediel_coordinate_service_permission_v1(uuid,uuid,uuid,bigint,text) RENAME TO coordinate_before_manual_resolution_v1;
REVOKE ALL ON FUNCTION gridex_service_administration.coordinate_before_manual_resolution_v1(uuid,uuid,uuid,bigint,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ediel_coordinate_service_permission_v1(p_provider_company_id uuid,p_assignment_id uuid,p_actor_user_id uuid,p_expected_version bigint,p_command text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE result jsonb;a public.ediel_service_assignments%rowtype;sources uuid[];BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'ediel_service_manual_service_required' USING ERRCODE='42501';END IF;
 IF p_command='request_access' THEN
  PERFORM gridex_service_administration.require_manual_actor_v1(p_provider_company_id,p_actor_user_id);
  SELECT * INTO STRICT a FROM public.ediel_service_assignments WHERE company_id=p_provider_company_id AND id=p_assignment_id;
  IF p_expected_version IS NULL OR p_expected_version<1 OR a.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'ediel_assignment_version_stale';END IF;
  sources:=gridex_service_administration.permission_originals_for_tuple_v1(a);
  PERFORM m.id FROM public.ediel_messages m WHERE m.company_id=a.company_id AND m.id=ANY(sources) ORDER BY m.id FOR SHARE;
  PERFORM pg_advisory_xact_lock(hashtextextended(a.company_id::text||':'||a.environment||':'||a.provider_actor_id::text||':'||a.customer_id::text||':'||a.dso_actor_id::text||':'||a.mode,0));
  IF gridex_service_administration.permission_originals_for_tuple_v1(a) IS DISTINCT FROM sources THEN RETURN jsonb_build_object('status','held','missing',ARRAY['permission_original_changed_retry_required']);END IF;
 END IF;
 result:=gridex_service_administration.coordinate_before_manual_resolution_v1(p_provider_company_id,p_assignment_id,p_actor_user_id,p_expected_version,p_command);
 IF p_command IS DISTINCT FROM 'request_access' OR (result->>'status' IN('permission_required','reuse_permission')) IS NOT TRUE THEN RETURN result;END IF;
 IF result->>'status'='permission_required' THEN
  SELECT * INTO STRICT a FROM public.ediel_service_assignments WHERE company_id=p_provider_company_id AND id=p_assignment_id FOR SHARE;
  -- Only this newly created, unbound draft receives its date projection. The
  -- actual source instants keep the Ediel fixed UTC+1 market calendar; no prior
  -- original/status/ACK is rewritten by this prospective coordinator.
  UPDATE public.metering_permissions SET requested_start_date=(a.data_start AT TIME ZONE INTERVAL '01:00')::date,requested_end_date=(a.data_end AT TIME ZONE INTERVAL '01:00')::date WHERE company_id=a.company_id AND id=(result->>'permissionId')::uuid AND status='draft' AND source_z13_message_id IS NULL AND outbound_z13_message_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'ediel_service_new_permission_draft_required';END IF;
  INSERT INTO gridex_service_administration.permission_request_owners(company_id,permission_id,assignment_id,scope_basis_version,scope) VALUES(a.company_id,(result->>'permissionId')::uuid,a.id,a.scope_basis_version,gridex_service_administration.scope_v1(a));
 END IF;
 RETURN public.ediel_resolve_service_permission_command_v1(p_provider_company_id,p_assignment_id,p_actor_user_id,p_expected_version,(result->>'permissionId')::uuid);
END $$;
REVOKE ALL ON FUNCTION public.ediel_coordinate_service_permission_v1(uuid,uuid,uuid,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_coordinate_service_permission_v1(uuid,uuid,uuid,bigint,text) TO service_role;

CREATE FUNCTION gridex_service_administration.manual_hold_v1(c uuid,customer uuid,actor uuid,selection jsonb,missing jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE request_id uuid;task uuid;fingerprint text;BEGIN
 fingerprint:=encode(sha256(convert_to(selection::text||':'||missing::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('ediel_manual_permission:'||c::text||':'||customer::text||':'||actor::text||':'||fingerprint,0));
 SELECT r.id INTO request_id FROM gridex_service_administration.manual_permission_requests r WHERE r.company_id=c AND r.customer_id=customer AND r.actor_user_id=actor AND r.selection_hash=fingerprint;
 IF request_id IS NULL THEN
  request_id:=gen_random_uuid();
  INSERT INTO public.customer_operation_tasks(company_id,customer_id,task_type,status,priority,title,description,assigned_to,metadata,created_by,updated_by)
   VALUES(c,customer,'ediel_service_permission_source_held','open','high','Mätvärdestillstånd behöver källunderlag','Välj ett entydigt aktuellt tjänsteuppdrag och styrkt behörighetsunderlag innan marknadsbegäran skapas.',actor,jsonb_build_object('serviceCommandRequestId',request_id,'selection',selection,'missing',missing,'marketActivationGranted',false),actor,actor) RETURNING id INTO task;
  INSERT INTO gridex_service_administration.manual_permission_requests(id,company_id,customer_id,actor_user_id,selection,selection_hash,missing,task_id) VALUES(request_id,c,customer,actor,selection,fingerprint,missing,task);
 END IF;
 RETURN jsonb_build_object('status','held','requestId',request_id,'missing',missing);
END $$;
REVOKE ALL ON FUNCTION gridex_service_administration.manual_hold_v1(uuid,uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.ediel_service_permission_manual_context_v1(p_company_id uuid,p_actor_user_id uuid,p_customer_id uuid,p_selection jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE aid uuid;pid uuid;expected bigint;code text;mode text;link_count integer;a public.ediel_service_assignments%rowtype;p public.metering_permissions%rowtype;result jsonb;basis jsonb;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'ediel_service_manual_service_required' USING ERRCODE='42501';END IF;
 PERFORM gridex_service_administration.require_manual_actor_v1(p_company_id,p_actor_user_id);
 PERFORM x.id FROM public.customers x WHERE x.company_id=p_company_id AND x.id=p_customer_id FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'ediel_service_manual_customer_not_owned';END IF;
 IF jsonb_typeof(p_selection) IS DISTINCT FROM 'object' OR EXISTS(SELECT FROM jsonb_object_keys(p_selection) k WHERE k NOT IN('permissionId','assignmentId','expectedVersion','code','mode','fromDate','toDate')) OR (p_selection->>'code' IN('Z13','Z18')) IS NOT TRUE OR (p_selection->>'mode' IS NOT NULL AND (p_selection->>'mode' IN('V','VH')) IS NOT TRUE) THEN RAISE EXCEPTION 'ediel_service_manual_selection_invalid';END IF;
 aid:=(p_selection->>'assignmentId')::uuid;pid:=(p_selection->>'permissionId')::uuid;expected:=(p_selection->>'expectedVersion')::bigint;code:=p_selection->>'code';mode:=p_selection->>'mode';
 IF pid IS NOT NULL THEN
  SELECT * INTO p FROM public.metering_permissions WHERE company_id=p_company_id AND id=pid;
  IF NOT FOUND OR p.customer_id IS DISTINCT FROM p_customer_id THEN RAISE EXCEPTION 'ediel_service_manual_permission_not_owned';END IF;
  IF aid IS NULL THEN
   SELECT count(*),min(l.assignment_id::text)::uuid INTO link_count,aid FROM public.ediel_assignment_permission_links l WHERE l.company_id=p_company_id AND l.permission_id=pid;
   IF link_count<>1 THEN RETURN gridex_service_administration.manual_hold_v1(p_company_id,p_customer_id,p_actor_user_id,p_selection,jsonb_build_array('explicit_or_unique_source_assignment_permission_link'));END IF;
  END IF;
 END IF;
 IF aid IS NULL THEN RETURN gridex_service_administration.manual_hold_v1(p_company_id,p_customer_id,p_actor_user_id,p_selection,jsonb_build_array('explicit_source_assignment_required'));END IF;
 SELECT * INTO a FROM public.ediel_service_assignments WHERE company_id=p_company_id AND id=aid;
 IF NOT FOUND OR a.customer_id IS DISTINCT FROM p_customer_id THEN RAISE EXCEPTION 'ediel_service_manual_assignment_not_owned';END IF;
 IF (expected IS NULL OR expected<1) AND p_selection->>'assignmentId' IS NOT NULL THEN RETURN gridex_service_administration.manual_hold_v1(p_company_id,p_customer_id,p_actor_user_id,p_selection,jsonb_build_array('explicit_assignment_version_required'));END IF;
 expected:=coalesce(expected,a.version);
 IF pid IS NOT NULL AND NOT EXISTS(SELECT FROM public.ediel_assignment_permission_links l WHERE l.company_id=p_company_id AND l.assignment_id=aid AND l.permission_id=pid) THEN RETURN gridex_service_administration.manual_hold_v1(p_company_id,p_customer_id,p_actor_user_id,p_selection,jsonb_build_array('source_assignment_permission_link_required'));END IF;
 IF mode IS NOT NULL AND mode IS DISTINCT FROM a.mode OR p_selection->>'fromDate' IS NOT NULL AND (p_selection->>'fromDate')::date IS DISTINCT FROM (a.data_start AT TIME ZONE INTERVAL '01:00')::date OR p_selection->>'toDate' IS NOT NULL AND (p_selection->>'toDate')::date IS DISTINCT FROM (a.data_end AT TIME ZONE INTERVAL '01:00')::date THEN RETURN gridex_service_administration.manual_hold_v1(p_company_id,p_customer_id,p_actor_user_id,p_selection,jsonb_build_array('selected_request_scope_differs_from_source_assignment'));END IF;
 IF pid IS NULL THEN
  IF code='Z18' THEN RETURN gridex_service_administration.manual_hold_v1(p_company_id,p_customer_id,p_actor_user_id,p_selection,jsonb_build_array('explicit_termination_permission_required'));END IF;
  result:=public.ediel_coordinate_service_permission_v1(p_company_id,aid,p_actor_user_id,expected,'request_access');pid:=(result->>'permissionId')::uuid;
 ELSIF code='Z13' THEN result:=public.ediel_resolve_service_permission_command_v1(p_company_id,aid,p_actor_user_id,expected,pid);
 END IF;
 IF result->>'status'='held' THEN RETURN gridex_service_administration.manual_hold_v1(p_company_id,p_customer_id,p_actor_user_id,p_selection,result->'missing');END IF;
 IF result->>'status'='reuse_permission' THEN RETURN result||jsonb_build_object('companyId',p_company_id,'customerId',p_customer_id,'assignmentId',aid,'assignmentVersion',expected,'code',code);END IF;
 basis:=gridex_service_permission.context_v1(p_company_id,aid,p_actor_user_id,expected,code,pid);
 IF basis->>'status' IS DISTINCT FROM 'authorized' THEN RETURN gridex_service_administration.manual_hold_v1(p_company_id,p_customer_id,p_actor_user_id,p_selection,coalesce(basis->'missing',jsonb_build_array('current_source_permission_context')));END IF;
 RETURN jsonb_build_object('status','authorized','companyId',p_company_id,'customerId',p_customer_id,'assignmentId',aid,'assignmentVersion',expected,'permissionId',pid,'code',code);
END $$;
REVOKE ALL ON FUNCTION public.ediel_service_permission_manual_context_v1(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_service_permission_manual_context_v1(uuid,uuid,uuid,jsonb) TO service_role;
-- Bounded, current selectors for the existing manual permission form. These
-- IDs/versions are not an authorization decision and are rechecked on submit.
CREATE FUNCTION public.ediel_service_permission_manual_options_v1(p_company_id uuid,p_actor_user_id uuid,p_permission_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE options jsonb;BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'ediel_service_manual_service_required' USING ERRCODE='42501';END IF;
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 PERFORM m.user_id FROM public.company_memberships m WHERE m.company_id=p_company_id AND m.user_id=p_actor_user_id FOR SHARE;
 IF p_company_id IS NULL OR p_actor_user_id IS NULL OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active') OR NOT EXISTS(SELECT FROM public.company_memberships m WHERE m.company_id=p_company_id AND m.user_id=p_actor_user_id AND m.status='active' AND m.is_active AND m.accepted_at IS NOT NULL) OR (public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'metering.read') OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'metering.write')) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_service_manual_read_forbidden' USING ERRCODE='42501';END IF;
 IF p_permission_ids IS NULL OR cardinality(p_permission_ids)>100 OR array_position(p_permission_ids,NULL) IS NOT NULL OR cardinality(p_permission_ids)<>(SELECT count(DISTINCT id) FROM unnest(p_permission_ids) id) THEN RAISE EXCEPTION 'ediel_service_manual_option_selection_invalid';END IF;
 IF (SELECT count(*) FROM public.metering_permissions p WHERE p.company_id=p_company_id AND p.id=ANY(p_permission_ids))<>cardinality(p_permission_ids) THEN RAISE EXCEPTION 'ediel_service_manual_permission_not_owned';END IF;
 PERFORM a.id FROM public.ediel_service_assignments a JOIN public.ediel_assignment_permission_links l ON l.company_id=a.company_id AND l.assignment_id=a.id JOIN public.metering_permissions p ON p.company_id=l.company_id AND p.id=l.permission_id WHERE l.company_id=p_company_id AND l.permission_id=ANY(p_permission_ids) AND a.customer_id=p.customer_id ORDER BY a.id FOR SHARE OF a;
 PERFORM p.id FROM public.metering_permissions p WHERE p.company_id=p_company_id AND p.id=ANY(p_permission_ids) ORDER BY p.id FOR SHARE;
 SELECT coalesce(jsonb_agg(jsonb_build_object('permissionId',p.id,'assignmentId',a.id,'assignmentVersion',a.version,'beneficiaryCompanyId',a.beneficiary_company_id,'beneficiaryLabel',beneficiary.name,'purpose',a.purpose,'mode',a.mode,'status',a.status) ORDER BY p.id,a.id),'[]') INTO options FROM public.ediel_assignment_permission_links l JOIN public.ediel_service_assignments a ON a.company_id=l.company_id AND a.id=l.assignment_id JOIN public.metering_permissions p ON p.company_id=l.company_id AND p.id=l.permission_id JOIN public.companies beneficiary ON beneficiary.id=a.beneficiary_company_id WHERE l.company_id=p_company_id AND l.permission_id=ANY(p_permission_ids) AND a.customer_id=p.customer_id;
 RETURN jsonb_build_object('companyId',p_company_id,'options',options);
END $$;
REVOKE ALL ON FUNCTION public.ediel_service_permission_manual_options_v1(uuid,uuid,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_service_permission_manual_options_v1(uuid,uuid,uuid[]) TO service_role;
COMMIT;
