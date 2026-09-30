-- Prospective source-backed Z13/Z18 support. No legal decisions or readiness
-- proofs are seeded; internal assignment purpose is never a wire legal basis.
BEGIN;
ALTER TABLE public.ediel_service_evidence
 ADD COLUMN permission_purpose_code text CHECK(permission_purpose_code IN ('B71','B72','B73','B74','B75','B76')),
 ADD COLUMN permission_reporting_frequency text,
 ADD COLUMN permission_request_grid_area text,
 ADD COLUMN permission_reporting_term_kind text CHECK(permission_reporting_term_kind IN ('bounded','indefinite')),
 ADD COLUMN permission_customer_classification text CHECK(permission_customer_classification IN ('private','nonprivate')),
 ADD COLUMN permission_termination_reason text CHECK(permission_termination_reason IN ('B77','B78','B79','B80','E37')),
 ADD COLUMN permission_termination_at timestamptz;
CREATE FUNCTION public.ediel_service_evidence_immutable_basis_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' OR TG_OP='TRUNCATE' THEN RAISE EXCEPTION 'ediel_evidence_source_removal_forbidden'; END IF;
 IF OLD.status IN ('verified','revoked') AND
  (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN
  RAISE EXCEPTION 'ediel_verified_evidence_requires_new_source_record';
 END IF;
 IF OLD.status='revoked' AND NEW.status IS DISTINCT FROM 'revoked' THEN RAISE EXCEPTION 'ediel_revoked_evidence_requires_new_source_record'; END IF;
 IF OLD.status='verified' AND (NEW.status IN ('verified','revoked')) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_verified_evidence_cannot_be_unapproved'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.ediel_service_evidence_immutable_basis_v1() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER ediel_service_evidence_immutable_basis BEFORE UPDATE ON public.ediel_service_evidence FOR EACH ROW EXECUTE FUNCTION public.ediel_service_evidence_immutable_basis_v1();
CREATE TRIGGER ediel_service_evidence_no_delete BEFORE DELETE ON public.ediel_service_evidence FOR EACH ROW EXECUTE FUNCTION public.ediel_service_evidence_immutable_basis_v1();
CREATE TRIGGER ediel_service_evidence_no_truncate BEFORE TRUNCATE ON public.ediel_service_evidence FOR EACH STATEMENT EXECUTE FUNCTION public.ediel_service_evidence_immutable_basis_v1();

CREATE SCHEMA gridex_service_permission;
REVOKE ALL ON SCHEMA gridex_service_permission FROM PUBLIC,anon,authenticated;
CREATE TABLE gridex_service_permission.origins (
 intent_id uuid PRIMARY KEY REFERENCES public.ediel_message_intents(id) ON DELETE RESTRICT,
 company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
 assignment_id uuid NOT NULL REFERENCES public.ediel_service_assignments(id) ON DELETE RESTRICT,
 permission_id uuid NOT NULL REFERENCES public.metering_permissions(id) ON DELETE RESTRICT,
 actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 message_code text NOT NULL CHECK(message_code IN ('Z13','Z18')),
 command_key text NOT NULL,
 basis jsonb NOT NULL, message_id uuid UNIQUE REFERENCES public.ediel_messages(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,permission_id,message_code,command_key)
);
ALTER TABLE gridex_service_permission.origins ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_service_permission.origins FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_service_permission.origins FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_service_permission.origin_immutable_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF TG_OP='UPDATE' AND OLD.message_id IS NULL AND NEW.message_id IS NOT NULL AND (to_jsonb(OLD)-'message_id')=(to_jsonb(NEW)-'message_id') THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'ediel_permission_origin_immutable';
END $$;
REVOKE ALL ON FUNCTION gridex_service_permission.origin_immutable_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER service_permission_origin_immutable BEFORE UPDATE OR DELETE ON gridex_service_permission.origins FOR EACH ROW EXECUTE FUNCTION gridex_service_permission.origin_immutable_v1();
CREATE TRIGGER service_permission_origin_no_truncate BEFORE TRUNCATE ON gridex_service_permission.origins FOR EACH STATEMENT EXECUTE FUNCTION gridex_service_permission.origin_immutable_v1();

CREATE FUNCTION gridex_service_permission.context_v1(c uuid, aid uuid, actor uuid, expected_version bigint, code text, pid uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
DECLARE a public.ediel_service_assignments%rowtype; p public.metering_permissions%rowtype; e public.ediel_service_evidence%rowtype;
 assessment jsonb; objects jsonb; legal_id text; dso_id text; customer_record jsonb; previous_origin gridex_service_permission.origins%rowtype;
BEGIN
 IF c IS NULL OR aid IS NULL OR actor IS NULL OR pid IS NULL OR expected_version IS NULL OR expected_version<1 OR (code IN ('Z13','Z18')) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_permission_origin_scope_required'; END IF;
 IF NOT EXISTS(SELECT FROM public.company_memberships m WHERE m.company_id=c AND m.user_id=actor AND m.status='active' AND m.is_active AND m.accepted_at IS NOT NULL)
 OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=actor AND u.user_status='active')
 OR NOT coalesce(public.gridex_actor_has_company_permission(actor,c,'metering.write'),false) THEN RAISE EXCEPTION 'ediel_permission_origin_actor_forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT a FROM public.ediel_service_assignments WHERE company_id=c AND id=aid;
 -- Same tuple order as the coordinator. The permission cannot be terminated
 -- concurrently with another assignment acquiring/reusing that permission.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(a.company_id::text||':'||a.environment||':'||a.provider_actor_id::text||':'||a.customer_id::text||':'||a.dso_actor_id::text||':'||a.mode,0));
 SELECT * INTO STRICT a FROM public.ediel_service_assignments WHERE company_id=c AND id=aid FOR SHARE;
 IF a.version IS DISTINCT FROM expected_version THEN RAISE EXCEPTION 'ediel_permission_origin_assignment_stale'; END IF;
 SELECT * INTO STRICT p FROM public.metering_permissions WHERE company_id=c AND id=pid FOR UPDATE;
 IF p.customer_id IS DISTINCT FROM a.customer_id OR NOT EXISTS(SELECT FROM public.ediel_assignment_permission_links l WHERE l.company_id=c AND l.assignment_id=aid AND l.permission_id=pid) THEN RAISE EXCEPTION 'ediel_permission_origin_link_mismatch'; END IF;
 PERFORM i.id FROM public.tenant_actor_identifiers i WHERE i.company_id=c AND i.environment=a.environment FOR SHARE;
 SELECT min(i.identifier_value) INTO legal_id FROM public.tenant_actor_identifiers i WHERE i.company_id=c AND i.environment=a.environment AND i.actor_id=a.provider_actor_id AND i.identifier_type='EdielId' AND i.valid_from<=now() AND (i.valid_to IS NULL OR i.valid_to>now());
 PERFORM i.id FROM public.platform_actor_identifiers i WHERE i.actor_id=a.dso_actor_id FOR SHARE;
 SELECT min(i.identifier_value) INTO dso_id FROM public.platform_actor_identifiers i WHERE i.actor_id=a.dso_actor_id AND lower(i.identifier_type) IN ('edielid','ediel_id') AND i.is_verified AND (i.valid_from IS NULL OR i.valid_from<=current_date) AND (i.valid_to IS NULL OR i.valid_to>=current_date);
 IF nullif(legal_id,'') IS NULL OR nullif(dso_id,'') IS NULL OR (SELECT count(DISTINCT i.identifier_value) FROM public.tenant_actor_identifiers i WHERE i.company_id=c AND i.environment=a.environment AND i.actor_id=a.provider_actor_id AND i.identifier_type='EdielId' AND i.valid_from<=now() AND (i.valid_to IS NULL OR i.valid_to>now()))<>1 OR (SELECT count(DISTINCT i.identifier_value) FROM public.platform_actor_identifiers i WHERE i.actor_id=a.dso_actor_id AND lower(i.identifier_type) IN ('edielid','ediel_id') AND i.is_verified AND (i.valid_from IS NULL OR i.valid_from<=current_date) AND (i.valid_to IS NULL OR i.valid_to>=current_date))<>1 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_unique_legal_sender_and_dso_identity']); END IF;
 SELECT to_jsonb(x) INTO customer_record FROM public.customers x WHERE x.id=a.customer_id AND x.company_id=c FOR SHARE;
 PERFORM x.id FROM public.ediel_service_evidence x WHERE x.company_id=c AND x.assignment_id=aid FOR SHARE;
 IF code='Z13' THEN
  assessment:=public.ediel_service_assignment_assessment_v1(c,aid);
  IF assessment->>'status' IS DISTINCT FROM 'authorized' THEN RETURN assessment; END IF;
  IF (p.status IN ('draft','z13_ready','z13_sent','waiting_for_customer_approval')) IS NOT TRUE OR (p.status IN ('z13_sent','waiting_for_customer_approval') AND p.outbound_z13_message_id IS NULL) OR (p.source_z13_message_id IS NOT NULL AND p.source_z13_message_id IS DISTINCT FROM p.outbound_z13_message_id) THEN RETURN jsonb_build_object('status','held','missing',ARRAY['request_permission_state']); END IF;
  SELECT * INTO e FROM public.ediel_service_evidence x WHERE x.company_id=c AND x.assignment_id=aid AND x.kind='end_user_contract' AND x.status='verified' AND x.approved_assignment_version=a.version AND x.valid_from<=now() AND (x.valid_to IS NULL OR x.valid_to>now()) AND x.approved_at<=now() AND x.permission_purpose_code IS NOT NULL AND nullif(x.permission_reporting_frequency,'') IS NOT NULL ORDER BY x.id LIMIT 1;
  IF NOT FOUND OR (SELECT count(DISTINCT (x.permission_purpose_code,x.permission_reporting_frequency)) FROM public.ediel_service_evidence x WHERE x.company_id=c AND x.assignment_id=aid AND x.kind='end_user_contract' AND x.status='verified' AND x.approved_assignment_version=a.version AND x.valid_from<=now() AND (x.valid_to IS NULL OR x.valid_to>now()) AND x.approved_at<=now())<>1 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['source_assessed_permission_purpose_and_frequency']); END IF;
  IF cardinality(a.product_ids)<>1 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['single_source_defined_request_product']); END IF;
  IF nullif(e.permission_request_grid_area,'') IS NULL THEN RETURN jsonb_build_object('status','held','missing',ARRAY['source_defined_request_grid_area']); END IF;
  IF e.permission_reporting_term_kind IS NULL OR e.permission_customer_classification IS NULL OR (e.permission_reporting_term_kind='bounded' AND a.data_end IS NULL) OR (e.permission_reporting_term_kind='indefinite' AND (a.data_end IS NOT NULL OR a.mode='VH')) THEN RETURN jsonb_build_object('status','held','missing',ARRAY['source_declared_reporting_term_and_customer_classification']); END IF;
  IF date_trunc('minute',a.data_start) IS DISTINCT FROM a.data_start OR date_trunc('minute',a.data_end) IS DISTINCT FROM a.data_end THEN RETURN jsonb_build_object('status','held','missing',ARRAY['source_minute_precision_reporting_dates']); END IF;
  objects:=jsonb_build_array(jsonb_build_object('point',NULL,'permissionId',NULL,'product',a.product_ids[1],'gridArea',e.permission_request_grid_area,'reportStart',a.data_start,'reportEnd',a.data_end));
 ELSE
  IF a.status IS DISTINCT FROM 'ended' OR a.mode IS DISTINCT FROM 'V' THEN RETURN jsonb_build_object('status','held','missing',ARRAY['ended_fortlopande_assignment']); END IF;
  IF EXISTS(SELECT FROM public.ediel_assignment_permission_links l JOIN public.ediel_service_assignments other ON other.company_id=l.company_id AND other.id=l.assignment_id WHERE l.company_id=c AND l.permission_id=pid AND other.status='active' AND other.valid_from<=now() AND (other.valid_to IS NULL OR other.valid_to>now())) THEN RETURN jsonb_build_object('status','held','missing',ARRAY['permission_still_required_by_active_assignment']); END IF;
  IF (p.status IN ('active','approved','partially_approved')) IS NOT TRUE OR public.ediel_permission_source_is_current_v1(c,pid,coalesce(p.inbound_z14_message_id,p.source_z14_message_id)) IS NOT TRUE OR p.grid_owner_ediel_id IS DISTINCT FROM dso_id OR p.metadata#>>'{marketPermission,legalActor}' IS DISTINCT FROM legal_id THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_source_approved_permission']); END IF;
  SELECT * INTO e FROM public.ediel_service_evidence x WHERE x.company_id=c AND x.assignment_id=aid AND x.kind='service_contract' AND x.status='verified' AND x.approved_assignment_version=a.version AND x.valid_from<=now() AND (x.valid_to IS NULL OR x.valid_to>now()) AND x.approved_at<=now() AND x.permission_termination_reason IS NOT NULL AND x.permission_termination_at IS NOT NULL ORDER BY x.id LIMIT 1;
  IF NOT FOUND OR (SELECT count(DISTINCT (x.permission_termination_reason,x.permission_termination_at)) FROM public.ediel_service_evidence x WHERE x.company_id=c AND x.assignment_id=aid AND x.kind='service_contract' AND x.status='verified' AND x.approved_assignment_version=a.version AND x.valid_from<=now() AND (x.valid_to IS NULL OR x.valid_to>now()) AND x.approved_at<=now())<>1 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['source_assessed_permission_termination']); END IF;
  IF p.outbound_z18_message_id IS NOT NULL THEN
   SELECT * INTO previous_origin FROM gridex_service_permission.origins prior WHERE prior.company_id=c AND prior.permission_id=pid AND prior.message_id=p.outbound_z18_message_id AND prior.message_code='Z18';
   IF NOT FOUND OR (NOT(previous_origin.basis->>'evidenceId'=e.id::text AND (previous_origin.basis->>'permissionStateVersion')::bigint=p.market_state_version) AND (p.metadata#>>'{z15,reason}' IS DISTINCT FROM 'Z24' OR p.market_state_version<=(previous_origin.basis->>'permissionStateVersion')::bigint)) THEN RETURN jsonb_build_object('status','held','missing',ARRAY['prior_termination_cycle_not_source_cancelled']); END IF;
  END IF;
  SELECT jsonb_agg(jsonb_build_object('point',s.facility_id,'permissionId',s.metadata->>'permissionId','product',s.metadata->>'product','gridArea',s.grid_area_code,'permissionEnd',e.permission_termination_at) ORDER BY s.facility_id,s.id) INTO objects FROM public.metering_permission_sites s WHERE s.company_id=c AND s.metering_permission_id=pid AND s.status IN ('approved','active');
  IF objects IS NULL THEN RETURN jsonb_build_object('status','held','missing',ARRAY['approved_permission_objects']); END IF;
  IF date_trunc('minute',e.permission_termination_at) IS DISTINCT FROM e.permission_termination_at THEN RETURN jsonb_build_object('status','held','missing',ARRAY['source_minute_precision_termination_date']); END IF;
 END IF;
 RETURN jsonb_build_object('status','authorized','companyId',c,'assignmentId',aid,'assignmentVersion',a.version,'permissionId',pid,'permissionStateVersion',p.market_state_version,'code',code,'environment',a.environment,'providerActorId',a.provider_actor_id,'dsoActorId',a.dso_actor_id,'legalSenderId',legal_id,'legalReceiverId',dso_id,'customerId',a.customer_id,'customer',customer_record,'mode',a.mode,'purposeCode',e.permission_purpose_code,'frequency',e.permission_reporting_frequency,'reportingTerm',e.permission_reporting_term_kind,'customerClassification',e.permission_customer_classification,'terminationReason',e.permission_termination_reason,'evidenceId',e.id,'evidenceSha256',e.source_sha256,'evidenceVersion',e.source_version,'objects',objects,'li',CASE WHEN code='Z18' THEN p.rff_li_reference ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION gridex_service_permission.context_v1(uuid,uuid,uuid,bigint,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ediel_service_permission_origin_v1(p_company_id uuid,p_assignment_id uuid,p_actor_user_id uuid,p_expected_version bigint,p_code text,p_permission_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$ BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'ediel_permission_origin_service_required' USING ERRCODE='42501'; END IF;
 RETURN gridex_service_permission.context_v1(p_company_id,p_assignment_id,p_actor_user_id,p_expected_version,p_code,p_permission_id);
END $$;
GRANT USAGE ON SCHEMA gridex_service_permission TO service_role;
GRANT EXECUTE ON FUNCTION gridex_service_permission.context_v1(uuid,uuid,uuid,bigint,text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.ediel_service_permission_origin_v1(uuid,uuid,uuid,bigint,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_service_permission_origin_v1(uuid,uuid,uuid,bigint,text,uuid) TO service_role;

CREATE FUNCTION gridex_service_permission.reserve_v1(c uuid,aid uuid,actor uuid,expected_version bigint,code text,pid uuid,iid uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b jsonb; i public.ediel_message_intents%rowtype; saved gridex_service_permission.origins%rowtype; v_command_key text;
BEGIN
 b:=gridex_service_permission.context_v1(c,aid,actor,expected_version,code,pid);
 IF b->>'status' IS DISTINCT FROM 'authorized' THEN RETURN b; END IF;
 SELECT * INTO STRICT i FROM public.ediel_message_intents WHERE id=iid AND company_id=c FOR SHARE;
 IF i.business_process IS DISTINCT FROM 'metering_permission' OR i.environment IS DISTINCT FROM b->>'environment' OR i.message_family IS DISTINCT FROM 'PRODAT' OR i.message_code IS DISTINCT FROM code OR i.customer_id IS DISTINCT FROM (b->>'customerId')::uuid OR i.payload->'sourcePermissionBasis' IS DISTINCT FROM b THEN RAISE EXCEPTION 'ediel_permission_origin_intent_mismatch'; END IF;
 v_command_key:=CASE WHEN code='Z13' THEN 'original' ELSE (b->>'evidenceId')||':'||(b->>'permissionStateVersion') END;
 INSERT INTO gridex_service_permission.origins(intent_id,company_id,assignment_id,permission_id,actor_user_id,message_code,command_key,basis) VALUES(iid,c,aid,pid,actor,code,v_command_key,b) ON CONFLICT(company_id,permission_id,message_code,command_key) DO NOTHING;
 SELECT * INTO STRICT saved FROM gridex_service_permission.origins WHERE company_id=c AND permission_id=pid AND message_code=code AND origins.command_key=v_command_key FOR UPDATE;
 IF saved.intent_id IS DISTINCT FROM iid OR saved.basis IS DISTINCT FROM b THEN RAISE EXCEPTION 'ediel_permission_origin_frozen_basis_conflict'; END IF;
 RETURN jsonb_build_object('status','reserved','messageId',saved.message_id);
END $$;
REVOKE ALL ON FUNCTION gridex_service_permission.reserve_v1(uuid,uuid,uuid,bigint,text,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_service_permission.reserve_v1(uuid,uuid,uuid,bigint,text,uuid,uuid) TO service_role;
CREATE FUNCTION public.ediel_reserve_service_permission_origin_v1(p_company_id uuid,p_assignment_id uuid,p_actor_user_id uuid,p_expected_version bigint,p_code text,p_permission_id uuid,p_intent_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$ BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'ediel_permission_origin_service_required' USING ERRCODE='42501'; END IF;
 RETURN gridex_service_permission.reserve_v1(p_company_id,p_assignment_id,p_actor_user_id,p_expected_version,p_code,p_permission_id,p_intent_id);
END $$;
REVOKE ALL ON FUNCTION public.ediel_reserve_service_permission_origin_v1(uuid,uuid,uuid,bigint,text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_reserve_service_permission_origin_v1(uuid,uuid,uuid,bigint,text,uuid,uuid) TO service_role;

CREATE FUNCTION gridex_service_permission.bind_message_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s gridex_service_permission.origins%rowtype; b jsonb; wire jsonb; o jsonb; p public.metering_permissions%rowtype;
BEGIN
 SELECT * INTO s FROM gridex_service_permission.origins WHERE intent_id=NEW.intent_id;
 IF NOT FOUND THEN RETURN NEW; END IF;
 b:=gridex_service_permission.context_v1(s.company_id,s.assignment_id,s.actor_user_id,(s.basis->>'assignmentVersion')::bigint,s.message_code,s.permission_id);
 SELECT * INTO STRICT s FROM gridex_service_permission.origins WHERE intent_id=NEW.intent_id FOR UPDATE;
 IF s.message_id IS NOT NULL THEN RAISE EXCEPTION 'ediel_permission_origin_already_bound' USING ERRCODE='23505'; END IF;
 IF b IS DISTINCT FROM s.basis OR b->>'status' IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION 'ediel_permission_origin_basis_stale'; END IF;
 wire:=gridex_received_sources.permission_wire_v1(NEW.raw_payload);
 IF NEW.company_id IS DISTINCT FROM s.company_id OR NEW.direction IS DISTINCT FROM 'outbound' OR NEW.message_family IS DISTINCT FROM 'PRODAT' OR NEW.message_code IS DISTINCT FROM s.message_code OR NEW.environment IS DISTINCT FROM b->>'environment' OR NEW.customer_id IS DISTINCT FROM (b->>'customerId')::uuid OR wire->>'sender' IS DISTINCT FROM b->>'legalSenderId' OR wire->>'receiver' IS DISTINCT FROM b->>'legalReceiverId' OR wire->>'code' IS DISTINCT FROM s.message_code OR wire IS NULL OR jsonb_array_length(wire->'objects')<>jsonb_array_length(b->'objects') OR (s.message_code='Z18' AND (SELECT count(DISTINCT (v->>'point',v->>'permissionId')) FROM jsonb_array_elements(wire->'objects') v)<>jsonb_array_length(b->'objects')) THEN RAISE EXCEPTION 'ediel_permission_origin_wire_scope_mismatch'; END IF;
 FOR o IN SELECT v FROM jsonb_array_elements(wire->'objects') v LOOP
  IF o->>'reason' IS DISTINCT FROM (CASE b->>'mode' WHEN 'V' THEN 'S17' ELSE 'S18' END) OR o->>'li' IS DISTINCT FROM (SELECT transaction_reference FROM public.ediel_message_intents WHERE id=s.intent_id) OR nullif(o->>'li','') IS NULL THEN RAISE EXCEPTION 'ediel_permission_origin_wire_mode_mismatch'; END IF;
  IF s.message_code='Z13' THEN
   IF nullif(o->>'point','') IS NOT NULL OR o->>'gridArea' IS DISTINCT FROM b#>>'{objects,0,gridArea}' OR o->>'purpose' IS DISTINCT FROM b->>'purposeCode' OR o->>'frequency' IS DISTINCT FROM b->>'frequency' OR o->>'product' IS DISTINCT FROM b#>>'{objects,0,product}' OR gridex_received_sources.permission_time_v1(o->>'reportStart') IS DISTINCT FROM (b#>>'{objects,0,reportStart}')::timestamptz OR gridex_received_sources.permission_time_v1(o->>'reportEnd') IS DISTINCT FROM (b#>>'{objects,0,reportEnd}')::timestamptz OR nullif(o->>'customerIdentity','') IS NULL OR o->>'customerIdentity' IS DISTINCT FROM coalesce(nullif(btrim(b#>>'{customer,org_number}'),''),nullif(btrim(b#>>'{customer,personal_number}'),'')) THEN RAISE EXCEPTION 'ediel_permission_origin_wire_request_mismatch'; END IF;
  ELSE
   IF o->>'li' IS DISTINCT FROM b->>'li' OR o->>'endReason' IS DISTINCT FROM b->>'terminationReason' OR NOT EXISTS(SELECT FROM jsonb_array_elements(b->'objects') expected WHERE expected->>'point'=o->>'point' AND expected->>'permissionId'=o->>'permissionId' AND (expected->>'permissionEnd')::timestamptz=gridex_received_sources.permission_time_v1(o->>'permissionEnd')) THEN RAISE EXCEPTION 'ediel_permission_origin_wire_termination_mismatch'; END IF;
  END IF;
 END LOOP;
 SELECT * INTO STRICT p FROM public.metering_permissions WHERE company_id=s.company_id AND id=s.permission_id FOR UPDATE;
 IF s.message_code='Z13' THEN
  UPDATE public.metering_permissions SET source_z13_message_id=NEW.id,outbound_z13_message_id=NEW.id,rff_li_reference=wire#>>'{objects,0,li}',grid_owner_ediel_id=b->>'legalReceiverId',status='z13_ready',updated_by=s.actor_user_id,updated_at=now() WHERE id=p.id AND company_id=s.company_id AND source_z13_message_id IS NULL AND outbound_z13_message_id IS NULL;
 ELSE
  UPDATE public.metering_permissions SET outbound_z18_message_id=NEW.id,updated_by=s.actor_user_id,updated_at=now() WHERE id=p.id AND company_id=s.company_id;
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'ediel_permission_origin_existing_message_conflict'; END IF;
 UPDATE gridex_service_permission.origins SET message_id=NEW.id WHERE intent_id=s.intent_id;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION gridex_service_permission.bind_message_v1() FROM PUBLIC,anon,authenticated,service_role;
-- AFTER INSERT permits FK-safe atomically binding the original and avoids
-- imposing any change on historical/non-service permission messages.
CREATE TRIGGER ediel_service_permission_message_bind AFTER INSERT ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_service_permission.bind_message_v1();

CREATE FUNCTION public.ediel_require_service_permission_origin_current_v1(p_company_id uuid,p_message_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s gridex_service_permission.origins%rowtype; b jsonb;
BEGIN
 SELECT * INTO s FROM gridex_service_permission.origins WHERE company_id=p_company_id AND message_id=p_message_id;
 IF NOT FOUND THEN RETURN; END IF;
 b:=gridex_service_permission.context_v1(s.company_id,s.assignment_id,s.actor_user_id,(s.basis->>'assignmentVersion')::bigint,s.message_code,s.permission_id);
 PERFORM 1 FROM gridex_service_permission.origins WHERE intent_id=s.intent_id AND message_id=p_message_id FOR SHARE;
 IF b IS DISTINCT FROM s.basis OR b->>'status' IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION 'ediel_permission_origin_basis_stale'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.ediel_require_service_permission_origin_current_v1(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_require_service_permission_origin_current_v1(uuid,uuid) TO service_role;
CREATE FUNCTION public.ediel_service_permission_message_basis_v1(p_company_id uuid,p_message_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s gridex_service_permission.origins%rowtype;
BEGIN
 IF NOT EXISTS(SELECT FROM public.company_memberships m WHERE m.company_id=p_company_id AND m.user_id=p_actor_user_id AND m.status='active' AND m.is_active AND m.accepted_at IS NOT NULL) OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active') OR NOT coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.send'),false) THEN RAISE EXCEPTION 'ediel_permission_origin_message_forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM gridex_service_permission.origins WHERE company_id=p_company_id AND message_id=p_message_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'ediel_permission_origin_message_unbound'; END IF;
 PERFORM public.ediel_require_service_permission_origin_current_v1(p_company_id,p_message_id);
 RETURN jsonb_build_object('basis',s.basis,'actorUserId',s.actor_user_id,'intentId',s.intent_id);
END $$;
REVOKE ALL ON FUNCTION public.ediel_service_permission_message_basis_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_service_permission_message_basis_v1(uuid,uuid,uuid) TO service_role;

-- Preserve the existing journal owner, including Z08 delegation and immutable
-- observation/release semantics; add only the current business-origin fence.
ALTER FUNCTION gridex_ediel_transport.mutate_v1(jsonb) RENAME TO mutate_before_service_origin_v1;
CREATE FUNCTION gridex_ediel_transport.mutate_v1(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF p_input->>'action' IN ('prepare','enter') THEN PERFORM public.ediel_require_service_permission_origin_current_v1((p_input->>'companyId')::uuid,(p_input->>'messageId')::uuid); END IF;
 IF p_input->>'action' IN ('prepare','enter') THEN PERFORM public.ediel_reserve_wire_reference_namespace_v1((p_input->>'companyId')::uuid,(p_input->>'messageId')::uuid); END IF;
 RETURN gridex_ediel_transport.mutate_before_service_origin_v1(p_input);
END $$;
REVOKE ALL ON FUNCTION gridex_ediel_transport.mutate_before_service_origin_v1(jsonb),gridex_ediel_transport.mutate_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_ediel_transport.mutate_v1(jsonb) TO service_role;
COMMIT;
