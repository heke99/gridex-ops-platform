-- TR05 / TEN01 / CALL03: service authority stays at the genuine private origin;
-- creation and provider execution require their own current tenant actor.
-- The three-argument SEND port remains unchanged. This explicit overload is
-- read-only and cannot reserve, bind, queue or authorize a recovery operation.
BEGIN;
-- Factor the SAME current source predicates into private read-only functions.
-- Only the historic editor's preparation-permission block is excluded. Every
-- source/profile/role/mandate/scope/evidence/permission/date predicate stays in
-- the original owner's body; public creation still calls the unchanged chain.
DO $source_context$
DECLARE definition text;old_gate text:=$gate$ PERFORM u.id FROM public.user_profiles u WHERE u.id=actor FOR SHARE;
 PERFORM m.user_id FROM public.company_memberships m WHERE m.company_id=c AND m.user_id=actor FOR SHARE;
 IF NOT EXISTS(SELECT FROM public.company_memberships m WHERE m.company_id=c AND m.user_id=actor AND m.status='active' AND m.is_active AND m.accepted_at IS NOT NULL)
 OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=actor AND u.user_status='active')
 OR NOT coalesce(public.gridex_actor_has_company_permission(actor,c,'metering.write'),false) THEN RAISE EXCEPTION 'ediel_permission_origin_actor_forbidden' USING ERRCODE='42501'; END IF;
$gate$;
BEGIN
 definition:=pg_get_functiondef('gridex_service_permission.context_before_agreement_reference_v1(uuid,uuid,uuid,bigint,text,uuid)'::regprocedure);
 IF strpos(definition,old_gate)=0 OR strpos(definition,'gridex_service_administration.scope_v1(a)')=0 THEN RAISE EXCEPTION 'ediel_service_source_context_owner_shape_changed';END IF;
 definition:=replace(definition,'gridex_service_permission.context_before_agreement_reference_v1(','gridex_service_permission.context_source_base_v1(');
 definition:=replace(definition,old_gate,'');EXECUTE definition;
 definition:=pg_get_functiondef('gridex_service_permission.context_before_requested_method_v1(uuid,uuid,uuid,bigint,text,uuid)'::regprocedure);
 IF strpos(definition,'gridex_service_permission.context_before_agreement_reference_v1(')=0 OR strpos(definition,'authentic_source_defined_end_user_agreement_reference')=0 THEN RAISE EXCEPTION 'ediel_service_source_agreement_owner_shape_changed';END IF;
 definition:=replace(definition,'gridex_service_permission.context_before_requested_method_v1(','gridex_service_permission.context_source_agreement_v1(');
 definition:=replace(definition,'gridex_service_permission.context_before_agreement_reference_v1(','gridex_service_permission.context_source_base_v1(');EXECUTE definition;
 definition:=pg_get_functiondef('gridex_service_permission.context_v1(uuid,uuid,uuid,bigint,text,uuid)'::regprocedure);
 IF strpos(definition,'gridex_service_permission.context_before_requested_method_v1(')=0 OR strpos(definition,'authentic_source_defined_requested_reporting_method')=0 THEN RAISE EXCEPTION 'ediel_service_source_requested_method_owner_shape_changed';END IF;
 definition:=replace(definition,'gridex_service_permission.context_v1(','gridex_service_permission.context_source_v1(');
 definition:=replace(definition,'gridex_service_permission.context_before_requested_method_v1(','gridex_service_permission.context_source_agreement_v1(');EXECUTE definition;
END$source_context$;
REVOKE ALL ON FUNCTION gridex_service_permission.context_source_base_v1(uuid,uuid,uuid,bigint,text,uuid),gridex_service_permission.context_source_agreement_v1(uuid,uuid,uuid,bigint,text,uuid),gridex_service_permission.context_source_v1(uuid,uuid,uuid,bigint,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
-- One active source policy: creation retains its original preparation gate,
-- then delegates the same factored source chain as current source read/send.
CREATE OR REPLACE FUNCTION gridex_service_permission.context_v1(c uuid,aid uuid,actor uuid,expected_version bigint,code text,pid uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
BEGIN
 IF c IS NULL OR aid IS NULL OR actor IS NULL OR pid IS NULL OR expected_version IS NULL OR expected_version<1 OR (code IN('Z13','Z18')) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_permission_origin_scope_required';END IF;
 PERFORM u.id FROM public.user_profiles u WHERE u.id=actor FOR SHARE;
 PERFORM m.user_id FROM public.company_memberships m WHERE m.company_id=c AND m.user_id=actor FOR SHARE;
 IF NOT EXISTS(SELECT FROM public.company_memberships m WHERE m.company_id=c AND m.user_id=actor AND m.status='active' AND m.is_active AND m.accepted_at IS NOT NULL)
  OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=actor AND u.user_status='active')
  OR NOT coalesce(public.gridex_actor_has_company_permission(actor,c,'metering.write'),false) THEN RAISE EXCEPTION 'ediel_permission_origin_actor_forbidden' USING ERRCODE='42501';END IF;
 RETURN gridex_service_permission.context_source_v1(c,aid,actor,expected_version,code,pid);
END$$;
REVOKE ALL ON FUNCTION gridex_service_permission.context_v1(uuid,uuid,uuid,bigint,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_service_permission.require_original_source_current_v1(c uuid,message uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s gridex_service_permission.origins%rowtype;current_source gridex_service_permission.origins%rowtype;b jsonb;m public.ediel_messages%rowtype;
BEGIN
 IF c IS NULL OR message IS NULL THEN RAISE EXCEPTION 'ediel_service_permission_scope_required';END IF;
 SELECT * INTO s FROM gridex_service_permission.origins WHERE company_id=c AND message_id=message;
 IF s.message_id IS NULL THEN RETURN;END IF;
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE company_id=c AND id=message FOR UPDATE;
 IF m.direction IS DISTINCT FROM 'outbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.message_code IS DISTINCT FROM s.message_code OR m.intent_id IS DISTINCT FROM s.intent_id OR m.environment IS DISTINCT FROM s.basis->>'environment'
  OR m.raw_payload IS NULL OR m.immutable_rendered_at IS NULL OR m.immutable_payload_hash IS NULL OR m.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'ediel_permission_origin_source_message_changed';END IF;
 b:=gridex_service_permission.context_source_v1(s.company_id,s.assignment_id,s.actor_user_id,(s.basis->>'assignmentVersion')::bigint,s.message_code,s.permission_id);
 SELECT * INTO current_source FROM gridex_service_permission.origins WHERE company_id=c AND message_id=message FOR SHARE;
 IF current_source IS DISTINCT FROM s OR b IS DISTINCT FROM s.basis OR b->>'status' IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION 'ediel_permission_origin_basis_stale';END IF;
 PERFORM gridex_service_permission.require_agreement_reference_v1(m,b);
 PERFORM gridex_service_permission.require_requested_method_v1(m,b);
END$$;
REVOKE ALL ON FUNCTION gridex_service_permission.require_original_source_current_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ediel_service_permission_message_basis_v1(p_company_id uuid,p_message_id uuid,p_actor_user_id uuid,p_phase text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s gridex_service_permission.origins%rowtype;current_source gridex_service_permission.origins%rowtype;m public.ediel_messages%rowtype;
BEGIN
 IF p_company_id IS NULL OR p_message_id IS NULL OR p_actor_user_id IS NULL OR (p_phase IN('prepare','send')) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_permission_origin_message_phase_required';END IF;
 -- Recovery qualification prelocks its complete source/ACK cohort first. The
 -- selected terminal source is already held there; ordinary originals use the
 -- same source-before-current-actor order here.
 SELECT * INTO m FROM public.ediel_messages WHERE company_id=p_company_id AND id=p_message_id FOR UPDATE;
 PERFORM 1 FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 PERFORM 1 FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id FOR SHARE;
 IF NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active')
  OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL)
  OR (CASE p_phase WHEN 'prepare' THEN coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.write'),false)
   WHEN 'send' THEN coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'ediel.send'),false) OR coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.send'),false) END) IS NOT TRUE
 THEN RAISE EXCEPTION 'ediel_permission_origin_message_forbidden' USING ERRCODE='42501';END IF;
 IF m.id IS NULL OR m.direction IS DISTINCT FROM 'outbound' OR m.message_family IS DISTINCT FROM 'PRODAT' THEN RAISE EXCEPTION 'ediel_permission_origin_message_not_owned';END IF;
 SELECT * INTO s FROM gridex_service_permission.origins WHERE company_id=p_company_id AND message_id=p_message_id;
 IF s.message_id IS NULL THEN RETURN NULL;END IF;
 IF s.intent_id IS DISTINCT FROM m.intent_id OR s.basis->>'companyId' IS DISTINCT FROM p_company_id::text OR s.basis->>'code' IS DISTINCT FROM m.message_code OR s.basis->>'environment' IS DISTINCT FROM m.environment THEN RAISE EXCEPTION 'ediel_permission_origin_message_basis_changed';END IF;
 -- Full current service source, legal tuple, immutable wire/evidence and bounds
 -- remain mandatory. The historic source actor is provenance, not this caller.
 PERFORM gridex_service_permission.require_original_source_current_v1(p_company_id,p_message_id);
 -- The sole source owner locks permission/evidence before its immutable origin.
 -- Do not invert that order by locking this origin before current qualification.
 SELECT * INTO current_source FROM gridex_service_permission.origins WHERE company_id=p_company_id AND message_id=p_message_id FOR SHARE;
 IF current_source IS DISTINCT FROM s THEN RAISE EXCEPTION 'ediel_permission_origin_message_basis_changed' USING ERRCODE='40001';END IF;
 RETURN jsonb_build_object('basis',s.basis,'actorUserId',s.actor_user_id,'intentId',s.intent_id);
END$$;
REVOKE ALL ON FUNCTION public.ediel_service_permission_message_basis_v1(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_service_permission_message_basis_v1(uuid,uuid,uuid,text) TO service_role;
COMMIT;
