BEGIN;
-- Field261 is a source-declared end-user agreement/PoA reference, never a
-- freshly invented protocol identifier or the evidence document filename.
ALTER TABLE public.ediel_service_evidence ADD COLUMN permission_agreement_reference text CHECK(permission_agreement_reference IS NULL OR (permission_agreement_reference=btrim(permission_agreement_reference) AND length(permission_agreement_reference) BETWEEN 1 AND 35));
ALTER FUNCTION gridex_service_permission.context_v1(uuid,uuid,uuid,bigint,text,uuid) RENAME TO context_before_agreement_reference_v1;
REVOKE ALL ON FUNCTION gridex_service_permission.context_before_agreement_reference_v1(uuid,uuid,uuid,bigint,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_service_permission.context_v1(c uuid,aid uuid,actor uuid,expected_version bigint,code text,pid uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE basis jsonb;e public.ediel_service_evidence%rowtype;
BEGIN
 basis:=gridex_service_permission.context_before_agreement_reference_v1(c,aid,actor,expected_version,code,pid);
 IF basis->>'status' IS DISTINCT FROM 'authorized' OR code IS DISTINCT FROM 'Z13' THEN RETURN basis;END IF;
 SELECT * INTO e FROM public.ediel_service_evidence WHERE company_id=c AND assignment_id=aid AND id=(basis->>'evidenceId')::uuid FOR SHARE;
 IF e.id IS NULL OR e.kind IS DISTINCT FROM 'end_user_contract' OR e.status IS DISTINCT FROM 'verified' OR nullif(e.permission_agreement_reference,'') IS NULL
  OR (SELECT count(DISTINCT (x.permission_purpose_code,x.permission_reporting_frequency,x.permission_request_grid_area,x.permission_reporting_term_kind,x.permission_customer_classification,x.permission_agreement_reference)) FROM public.ediel_service_evidence x WHERE x.company_id=c AND x.assignment_id=aid AND x.kind='end_user_contract' AND x.status='verified' AND x.approved_assignment_version=(basis->>'scopeBasisVersion')::bigint AND x.valid_from<=now() AND (x.valid_to IS NULL OR x.valid_to>now()) AND x.approved_at<=now())<>1 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['authentic_source_defined_end_user_agreement_reference']);END IF;
 RETURN basis||jsonb_build_object('agreementReference',e.permission_agreement_reference);
END $$;
REVOKE ALL ON FUNCTION gridex_service_permission.context_v1(uuid,uuid,uuid,bigint,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_service_permission.require_agreement_reference_v1(m public.ediel_messages,basis jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tokens jsonb;
BEGIN
 IF m.message_code IS DISTINCT FROM 'Z13' THEN RETURN;END IF;
 tokens:=gridex_received_sources.wire_tokens_bounded_v1(m.raw_payload,999999);
 IF tokens IS NULL OR nullif(basis->>'agreementReference','') IS NULL
  OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='ANJ')<>1
  OR NOT EXISTS(SELECT FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='ANJ' AND t#>>'{elements,1,1}'=basis->>'agreementReference') THEN RAISE EXCEPTION 'ediel_permission_authentic_agreement_reference_required';END IF;
END $$;
REVOKE ALL ON FUNCTION gridex_service_permission.require_agreement_reference_v1(public.ediel_messages,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_service_permission.bind_agreement_reference_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE origin gridex_service_permission.origins%rowtype;
BEGIN
 SELECT * INTO origin FROM gridex_service_permission.origins WHERE intent_id=NEW.intent_id AND company_id=NEW.company_id;
 IF origin.intent_id IS NOT NULL THEN PERFORM gridex_service_permission.require_agreement_reference_v1(NEW,origin.basis);END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION gridex_service_permission.bind_agreement_reference_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ediel_service_permission_agreement_source BEFORE INSERT ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_service_permission.bind_agreement_reference_v1();
ALTER FUNCTION public.ediel_require_service_permission_origin_current_v1(uuid,uuid) SET SCHEMA gridex_service_permission;
ALTER FUNCTION gridex_service_permission.ediel_require_service_permission_origin_current_v1(uuid,uuid) RENAME TO require_current_before_agreement_reference_v1;
REVOKE ALL ON FUNCTION gridex_service_permission.require_current_before_agreement_reference_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ediel_require_service_permission_origin_current_v1(p_company_id uuid,p_message_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;basis jsonb;
BEGIN
 PERFORM gridex_service_permission.require_current_before_agreement_reference_v1(p_company_id,p_message_id);
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id FOR SHARE;
 SELECT own.basis INTO basis FROM gridex_service_permission.origins own WHERE own.message_id=m.id AND own.company_id=p_company_id;
 IF basis IS NULL THEN
  -- The preceding existing current-source recovery authority independently
  -- qualified this same private operation/message/hash/original relation.
  SELECT own.basis INTO basis FROM gridex_received_sources.prodat_recovery_messages link JOIN gridex_received_sources.prodat_recovery_operations op ON op.id=link.operation_id JOIN gridex_service_permission.origins own ON own.message_id=op.original_message_id AND own.company_id=op.company_id WHERE link.message_id=m.id AND op.company_id=p_company_id;
 END IF;
 IF basis IS NOT NULL THEN PERFORM gridex_service_permission.require_agreement_reference_v1(m,basis);END IF;
END $$;
REVOKE ALL ON FUNCTION public.ediel_require_service_permission_origin_current_v1(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_require_service_permission_origin_current_v1(uuid,uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.ediel_service_administration_command_v1(p_company_id uuid,p_actor_user_id uuid,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE action text;v_command_id uuid;fields jsonb;allowed text[];a public.ediel_service_assignments%rowtype;g public.ediel_data_access_grants%rowtype;
 n_a public.ediel_service_assignments%rowtype;n_e public.ediel_service_evidence%rowtype;n_g public.ediel_data_access_grants%rowtype;
 prior gridex_service_administration.commands%rowtype;result jsonb;expected_version bigint;detail_text text;message_text text;l public.ediel_assignment_permission_links%rowtype;permission public.metering_permissions%rowtype;
BEGIN
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 PERFORM m.user_id FROM public.company_memberships m WHERE m.company_id=p_company_id AND m.user_id=p_actor_user_id FOR SHARE;
 IF p_company_id IS NULL OR p_actor_user_id IS NULL OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active') OR NOT EXISTS(SELECT FROM public.company_memberships m WHERE m.company_id=p_company_id AND m.user_id=p_actor_user_id AND m.status='active' AND m.is_active AND m.accepted_at IS NOT NULL) OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'metering.write') IS NOT TRUE THEN RAISE EXCEPTION 'ediel_service_administration_actor_forbidden' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR EXISTS(SELECT FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('action','commandId','assignmentId','expectedVersion','grantId','expectedGrantVersion','fields')) THEN RAISE EXCEPTION 'ediel_service_command_shape_required';END IF;
 action:=p_input->>'action';v_command_id:=(p_input->>'commandId')::uuid;fields:=coalesce(p_input->'fields','{}');
 IF v_command_id IS NULL OR (action IN ('create_assignment','stage_evidence','create_grant','revoke_grant','approve_assignment','publish_grant')) IS NOT TRUE OR jsonb_typeof(fields) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'ediel_service_command_shape_required';END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ediel_service_command:'||v_command_id::text,0));
 SELECT * INTO prior FROM gridex_service_administration.commands c WHERE c.command_id=v_command_id FOR SHARE;
 IF FOUND THEN IF prior.company_id IS DISTINCT FROM p_company_id OR prior.actor_user_id IS DISTINCT FROM p_actor_user_id OR prior.input IS DISTINCT FROM p_input THEN RAISE EXCEPTION 'ediel_service_command_scope_conflict';END IF;RETURN prior.result;END IF;
 IF action='create_assignment' THEN
  IF p_input ? 'assignmentId' OR p_input ? 'expectedVersion' OR p_input ? 'grantId' THEN RAISE EXCEPTION 'ediel_service_create_scope_invalid';END IF;
  allowed:=ARRAY['beneficiary_company_id','provider_actor_id','actor_profile_id','customer_id','dso_actor_id','environment','mode','purpose','object_ids','product_ids','field_sets','data_start','data_end','valid_from','valid_to'];
  IF EXISTS(SELECT FROM jsonb_object_keys(fields) k WHERE NOT(k=ANY(allowed))) THEN RAISE EXCEPTION 'ediel_service_assignment_field_forbidden';END IF;
  n_a:=jsonb_populate_record(NULL::public.ediel_service_assignments,fields);
  -- These are administrative draft ownership checks; they grant no market or
  -- beneficiary permission and do not certify the referenced external actor.
  PERFORM x.id FROM public.customers x WHERE x.id=n_a.customer_id AND x.company_id=p_company_id FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'ediel_service_customer_not_owned';END IF;
  PERFORM x.id FROM public.tenant_ediel_profiles x WHERE x.id=n_a.actor_profile_id AND x.company_id=p_company_id AND x.environment=n_a.environment FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'ediel_service_profile_not_owned';END IF;
  PERFORM x.id FROM public.tenant_actor_identifiers x WHERE x.company_id=p_company_id AND x.environment=n_a.environment AND x.actor_id=n_a.provider_actor_id AND x.identifier_type='EdielId' AND x.valid_from<=now() AND (x.valid_to IS NULL OR x.valid_to>now()) FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'ediel_service_legal_provider_not_owned';END IF;
  INSERT INTO public.ediel_service_assignments(company_id,beneficiary_company_id,provider_actor_id,actor_profile_id,customer_id,dso_actor_id,environment,mode,purpose,object_ids,product_ids,field_sets,data_start,data_end,valid_from,valid_to,status)
   VALUES(p_company_id,n_a.beneficiary_company_id,n_a.provider_actor_id,n_a.actor_profile_id,n_a.customer_id,n_a.dso_actor_id,n_a.environment,n_a.mode,n_a.purpose,n_a.object_ids,n_a.product_ids,n_a.field_sets,n_a.data_start,n_a.data_end,n_a.valid_from,n_a.valid_to,'held') RETURNING * INTO a;
  result:=jsonb_build_object('status','held','assignmentId',a.id,'assignmentVersion',a.version,'missing',jsonb_build_array('authentic_current_owner_approvals_and_scoped_readiness'));
 ELSE
  expected_version:=(p_input->>'expectedVersion')::bigint;
  IF p_input->>'assignmentId' IS NULL OR expected_version IS NULL OR expected_version<1 THEN RAISE EXCEPTION 'ediel_service_assignment_version_required';END IF;
  SELECT * INTO STRICT a FROM public.ediel_service_assignments WHERE company_id=p_company_id AND id=(p_input->>'assignmentId')::uuid;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(a.company_id::text||':'||a.environment||':'||a.provider_actor_id::text||':'||a.customer_id::text||':'||a.dso_actor_id::text||':'||a.mode,0));
  SELECT * INTO STRICT a FROM public.ediel_service_assignments WHERE company_id=p_company_id AND id=(p_input->>'assignmentId')::uuid FOR UPDATE;
  IF a.version IS DISTINCT FROM expected_version THEN RAISE EXCEPTION 'ediel_service_assignment_stale';END IF;
  IF action='approve_assignment' THEN
   IF fields<>'{}'::jsonb OR p_input ? 'grantId' OR a.status IS DISTINCT FROM 'held' THEN RAISE EXCEPTION 'ediel_service_approval_scope_invalid';END IF;
   -- Only actual preexisting verified owner evidence can approve this scope.
   -- A held assessment rolls this status/history write back atomically.
   BEGIN
    UPDATE public.ediel_service_assignments SET status='active' WHERE company_id=p_company_id AND id=a.id RETURNING * INTO a;
    result:=public.ediel_service_assignment_assessment_v1(p_company_id,a.id);
    IF result->>'status' IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION 'ediel_service_assignment_approval_held' USING DETAIL=result::text;END IF;
    result:=result||jsonb_build_object('status','approved_waiting_permission','accessGranted',false);
   EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS detail_text=PG_EXCEPTION_DETAIL,message_text=MESSAGE_TEXT;
    IF message_text IS DISTINCT FROM 'ediel_service_assignment_approval_held' THEN RAISE;END IF;
    result:=detail_text::jsonb;
   END;
  ELSIF action='stage_evidence' THEN
   IF p_input ? 'grantId' THEN RAISE EXCEPTION 'ediel_service_evidence_scope_invalid';END IF;
   allowed:=ARRAY['kind','source_reference','source_sha256','source_version','valid_from','valid_to','transport_relation_id','transport_actor_id','permission_agreement_reference','permission_purpose_code','permission_reporting_frequency','permission_request_grid_area','permission_reporting_term_kind','permission_customer_classification','permission_termination_reason','permission_termination_at'];
   IF EXISTS(SELECT FROM jsonb_object_keys(fields) k WHERE NOT(k=ANY(allowed))) THEN RAISE EXCEPTION 'ediel_service_evidence_approval_field_forbidden';END IF;
   n_e:=jsonb_populate_record(NULL::public.ediel_service_evidence,fields);
   IF n_e.kind='transport_mandate' THEN PERFORM r.id FROM public.tenant_counterparty_relations r WHERE r.company_id=p_company_id AND r.id=n_e.transport_relation_id AND r.counterparty_actor_id=n_e.transport_actor_id AND r.environment=a.environment AND r.relation_type='ediel_transport_agent' FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'ediel_service_transport_relation_not_owned';END IF;END IF;
   INSERT INTO public.ediel_service_evidence(company_id,assignment_id,kind,source_reference,source_sha256,source_version,valid_from,valid_to,status,transport_relation_id,transport_actor_id,permission_agreement_reference,permission_purpose_code,permission_reporting_frequency,permission_request_grid_area,permission_reporting_term_kind,permission_customer_classification,permission_termination_reason,permission_termination_at)
    VALUES(p_company_id,a.id,n_e.kind,n_e.source_reference,n_e.source_sha256,n_e.source_version,n_e.valid_from,n_e.valid_to,'pending',n_e.transport_relation_id,n_e.transport_actor_id,n_e.permission_agreement_reference,n_e.permission_purpose_code,n_e.permission_reporting_frequency,n_e.permission_request_grid_area,n_e.permission_reporting_term_kind,n_e.permission_customer_classification,n_e.permission_termination_reason,n_e.permission_termination_at) RETURNING * INTO n_e;
   result:=jsonb_build_object('status','pending','assignmentId',a.id,'assignmentVersion',a.version,'evidenceId',n_e.id,'approvalGranted',false);
  ELSIF action='create_grant' THEN
   IF p_input ? 'grantId' THEN RAISE EXCEPTION 'ediel_service_grant_scope_invalid';END IF;
   allowed:=ARRAY['permission_link_id','object_ids','product_ids','fields','data_start','data_end','valid_from','valid_to'];
   IF EXISTS(SELECT FROM jsonb_object_keys(fields) k WHERE NOT(k=ANY(allowed))) THEN RAISE EXCEPTION 'ediel_service_grant_field_forbidden';END IF;
   n_g:=jsonb_populate_record(NULL::public.ediel_data_access_grants,fields);
   INSERT INTO public.ediel_data_access_grants(company_id,beneficiary_company_id,assignment_id,permission_link_id,object_ids,product_ids,fields,purpose,data_start,data_end,valid_from,valid_to,status)
    VALUES(p_company_id,a.beneficiary_company_id,a.id,n_g.permission_link_id,n_g.object_ids,n_g.product_ids,n_g.fields,a.purpose,n_g.data_start,n_g.data_end,n_g.valid_from,n_g.valid_to,'held') RETURNING * INTO g;
   result:=jsonb_build_object('status','held','assignmentId',a.id,'assignmentVersion',a.version,'grantId',g.id,'grantVersion',g.version,'accessGranted',false);
  ELSE
   IF fields<>'{}'::jsonb OR p_input->>'grantId' IS NULL THEN RAISE EXCEPTION 'ediel_service_revoke_scope_invalid';END IF;
   IF (p_input->>'expectedGrantVersion')::bigint IS NULL OR (p_input->>'expectedGrantVersion')::bigint<1 THEN RAISE EXCEPTION 'ediel_grant_version_required';END IF;
   SELECT * INTO STRICT g FROM public.ediel_data_access_grants WHERE company_id=p_company_id AND assignment_id=a.id AND id=(p_input->>'grantId')::uuid FOR UPDATE;
   IF g.version IS DISTINCT FROM (p_input->>'expectedGrantVersion')::bigint THEN RAISE EXCEPTION 'ediel_grant_version_stale';END IF;
   IF action='publish_grant' THEN
    IF g.status IS DISTINCT FROM 'held' OR g.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'ediel_revoked_grant_requires_new_basis';END IF;
    result:=public.ediel_service_assignment_assessment_v1(p_company_id,a.id);
    IF result->>'status' IS DISTINCT FROM 'authorized' THEN RETURN result;END IF;
    SELECT * INTO STRICT l FROM public.ediel_assignment_permission_links WHERE company_id=p_company_id AND id=g.permission_link_id AND assignment_id=a.id FOR SHARE;
    SELECT * INTO STRICT permission FROM public.metering_permissions WHERE company_id=p_company_id AND id=l.permission_id FOR SHARE;
    PERFORM x.id FROM public.metering_permission_sites x WHERE x.company_id=p_company_id AND x.metering_permission_id=permission.id ORDER BY x.id FOR SHARE;
    IF (permission.status IN ('active','approved','partially_approved')) IS NOT TRUE OR permission.customer_id IS DISTINCT FROM a.customer_id OR gridex_service_administration.permission_matches_assignment_v1(a,permission) IS NOT TRUE THEN RETURN jsonb_build_object('status','held','missing',jsonb_build_array('current_source_approved_market_permission'));END IF;
    IF g.valid_from>now() OR (g.valid_to IS NOT NULL AND g.valid_to<=now()) OR g.beneficiary_company_id IS DISTINCT FROM a.beneficiary_company_id OR g.purpose IS DISTINCT FROM a.purpose OR NOT(g.object_ids<@a.object_ids AND g.product_ids<@a.product_ids AND g.fields<@a.field_sets) OR g.data_start<a.data_start OR (a.data_end IS NOT NULL AND (g.data_end IS NULL OR g.data_end>a.data_end)) THEN RAISE EXCEPTION 'ediel_grant_basis_changed';END IF;
    IF EXISTS(SELECT FROM unnest(g.object_ids) object_id CROSS JOIN unnest(g.product_ids) product_id WHERE NOT EXISTS(SELECT FROM public.metering_permission_sites x WHERE x.company_id=p_company_id AND x.metering_permission_id=permission.id AND x.customer_id=a.customer_id AND x.facility_id=object_id AND x.status IN ('approved','active') AND x.metadata->>'source'='inbound_prodat_z14' AND x.metadata->>'edielMessageId'=coalesce(permission.inbound_z14_message_id,permission.source_z14_message_id)::text AND x.metadata->>'mode'=CASE a.mode WHEN 'V' THEN 'S17' ELSE 'S18' END AND x.metadata->>'product'=product_id AND x.start_at IS NOT NULL AND g.data_start>=x.start_at AND (x.end_at IS NULL OR (g.data_end IS NOT NULL AND g.data_end<=x.end_at)))) THEN RETURN jsonb_build_object('status','held','missing',jsonb_build_array('explicit_approved_object_product_period'));END IF;
    UPDATE public.ediel_data_access_grants SET status='active' WHERE company_id=p_company_id AND id=g.id RETURNING * INTO g;
    result:=jsonb_build_object('status','active','assignmentId',a.id,'assignmentVersion',a.version,'grantId',g.id,'grantVersion',g.version,'accessGranted',true);
   ELSE
   IF g.status<>'revoked' THEN UPDATE public.ediel_data_access_grants SET status='revoked',revoked_at=now() WHERE id=g.id AND company_id=p_company_id RETURNING * INTO g;END IF;
   result:=jsonb_build_object('status','revoked','assignmentId',a.id,'assignmentVersion',a.version,'grantId',g.id,'grantVersion',g.version,'accessGranted',false);
   END IF;
  END IF;
 END IF;
 INSERT INTO gridex_service_administration.commands(command_id,company_id,actor_user_id,input,result) VALUES(v_command_id,p_company_id,p_actor_user_id,p_input,result);
 RETURN result;
END $$;
COMMIT;
