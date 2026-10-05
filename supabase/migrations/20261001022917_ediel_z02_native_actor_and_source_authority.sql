-- Forward native first-effect fence. The original Z02 decoder/correlation and
-- atomic writer remain the sole implementation; genuine frozen replay returns
-- before present-day WRITE, source-context or assessment selection; current
-- tenant READ authorization still protects disclosure of that fixed history.
BEGIN;
ALTER FUNCTION public.gridex_apply_exact_z02_core(uuid,uuid,uuid,uuid,uuid,uuid,uuid)
 RENAME TO gridex_apply_exact_z02_core_before_current_source_v1;
ALTER FUNCTION public.gridex_apply_exact_z02_core_before_current_source_v1(uuid,uuid,uuid,uuid,uuid,uuid,uuid)
 SET SCHEMA gridex_received_sources;
CREATE FUNCTION public.gridex_apply_exact_z02_core(
 p_company_id uuid,p_customer_id uuid,p_site_id uuid,p_request_id uuid,p_message_id uuid,
 p_operation_id uuid DEFAULT NULL,p_actor_user_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;s gridex_received_sources.sources%rowtype;
 prior gridex_received_sources.z02_core_applications%rowtype;application jsonb;obj jsonb;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN
  RAISE EXCEPTION 'z02_source_service_required' USING ERRCODE='42501';END IF;
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id FOR UPDATE;
 IF m.id IS NULL OR m.direction IS DISTINCT FROM 'inbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.message_code IS DISTINCT FROM 'Z02' THEN
  RETURN jsonb_build_object('ok',false,'code','z02_inbound_message_not_found');END IF;
 SELECT * INTO s FROM gridex_received_sources.sources WHERE source_message_id=m.id AND company_id=p_company_id AND environment=m.environment AND message_code='Z02';
 IF s.source_message_id IS NULL OR s.raw_payload IS NULL OR s.raw_payload IS DISTINCT FROM m.raw_payload
  OR s.payload_hash IS DISTINCT FROM m.immutable_payload_hash OR s.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN
  RETURN jsonb_build_object('ok',false,'code','z02_frozen_source_unavailable');END IF;
 SELECT * INTO prior FROM gridex_received_sources.z02_core_applications WHERE source_message_id=m.id AND request_id=p_request_id;
 IF prior.source_message_id IS NOT NULL AND (prior.company_id IS DISTINCT FROM p_company_id OR prior.environment IS DISTINCT FROM m.environment
   OR prior.customer_id IS DISTINCT FROM p_customer_id OR prior.site_id IS DISTINCT FROM p_site_id OR prior.source_payload_hash IS DISTINCT FROM s.payload_hash) THEN
  RETURN jsonb_build_object('ok',false,'code','z02_applied_source_scope_mismatch');END IF;
 -- Fixed history remains confidential. Current READ authorization does not
 -- relabel, replay or apply the old result and does not reselect its rulepack.
 PERFORM cm.user_id FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id
  AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'z02_execution_actor_required' USING ERRCODE='42501';END IF;
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'z02_execution_actor_required' USING ERRCODE='42501';END IF;
 IF prior.source_message_id IS NOT NULL THEN
  IF NOT(coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.read'),false)
   OR coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'metering.read'),false)) THEN
   RAISE EXCEPTION 'z02_history_actor_read_required' USING ERRCODE='42501';END IF;
  RETURN prior.result;
 END IF;
 IF public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'metering.write') IS NOT TRUE THEN
  RAISE EXCEPTION 'z02_execution_actor_required' USING ERRCODE='42501';END IF;
 PERFORM gridex_ediel_inbound_context.require_v1(p_company_id,m.id);
 PERFORM gridex_ediel_source_rules.require_v1(p_company_id,m.id);
 application:=gridex_received_sources.require_prodat_application_objects_v1(p_company_id,m.id);
 IF application->>'headerDecision' IS DISTINCT FROM 'accepted' OR jsonb_typeof(application->'objects') IS DISTINCT FROM 'array'
  OR jsonb_array_length(application->'objects')=0 THEN RETURN jsonb_build_object('ok',false,'code','z02_own_application_scope_unavailable');END IF;
 -- The legacy whole-source Z02 operation still requires global acceptance.
 -- Its exact own LIN/register correlation is unchanged in the delegate. Full
 -- canonical field-owner acceptance is additionally required, never inferred
 -- from a register-only or ACK-planning facet.
 FOR obj IN SELECT e FROM jsonb_array_elements(application->'objects') e LOOP
  IF gridex_received_sources.prodat_application_object_accepted_v1(p_company_id,m.id,(application->>'assessmentId')::uuid,obj-'applicationDecision'-'reasonCodes') IS DISTINCT FROM true THEN
   RETURN jsonb_build_object('ok',false,'code','z02_own_application_scope_unavailable');END IF;
 END LOOP;
 RETURN gridex_received_sources.gridex_apply_exact_z02_core_before_current_source_v1(p_company_id,p_customer_id,p_site_id,p_request_id,m.id,p_operation_id,p_actor_user_id);
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.gridex_apply_exact_z02_core_before_current_source_v1(uuid,uuid,uuid,uuid,uuid,uuid,uuid),public.gridex_apply_exact_z02_core(uuid,uuid,uuid,uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_apply_exact_z02_core(uuid,uuid,uuid,uuid,uuid,uuid,uuid) TO service_role;
COMMIT;
