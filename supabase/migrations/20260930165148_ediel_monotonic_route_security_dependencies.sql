-- Created by Supabase CLI2.118.0. Prospective route/security dependency history.
-- No return-path validation is invented and no readiness evidence is activated.
BEGIN;
CREATE FUNCTION public.gridex_version_ediel_route_profile_v2() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN RAISE EXCEPTION 'ediel_route_history_tenant_immutable'; END IF;
 IF (to_jsonb(NEW)-ARRAY['route_version','updated_at','updated_by']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['route_version','updated_at','updated_by']) THEN
  INSERT INTO public.ediel_route_history(route_profile_id,company_id,route_version,snapshot,change_reason,created_by)
   VALUES(OLD.id,OLD.company_id,coalesce(OLD.route_version,1),to_jsonb(OLD),'observed_before_update',coalesce(OLD.updated_by,OLD.created_by)) ON CONFLICT(route_profile_id,route_version) DO NOTHING;
  NEW.route_version:=coalesce(OLD.route_version,1)+1;
 ELSE NEW.route_version:=OLD.route_version;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.gridex_version_ediel_route_profile_v2() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ediel_route_profile_monotonic_version_v2 BEFORE UPDATE ON public.ediel_route_profiles FOR EACH ROW EXECUTE FUNCTION public.gridex_version_ediel_route_profile_v2();

-- Preserve the original private implementation and extend the same authority;
-- no public alternate gate or rule selection is introduced.
ALTER FUNCTION gridex_ediel_readiness.capture(uuid,uuid,uuid,text,text,text,text,uuid,text,text) RENAME TO capture_before_route_dependencies_v1;
CREATE FUNCTION gridex_ediel_readiness.capture(p_company_id uuid,p_message_id uuid,p_legal_actor_id uuid,p_actor_role text,p_family text,p_code text,p_subtype text,p_assignment_id uuid,p_release_sha text,p_rulepack_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE current_scope jsonb; deps jsonb; m public.ediel_messages%rowtype; r public.ediel_route_profiles%rowtype; communication public.communication_routes%rowtype; registry_route public.platform_actor_routes%rowtype; registry_id uuid; route_dependency jsonb;
BEGIN
 current_scope:=gridex_ediel_readiness.capture_before_route_dependencies_v1(p_company_id,p_message_id,p_legal_actor_id,p_actor_role,p_family,p_code,p_subtype,p_assignment_id,p_release_sha,p_rulepack_hash);
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id FOR SHARE;
 SELECT * INTO r FROM public.ediel_route_profiles WHERE id=m.route_profile_id AND company_id=p_company_id FOR SHARE;
 SELECT * INTO communication FROM public.communication_routes WHERE id=r.communication_route_id AND company_id=p_company_id FOR SHARE;
 IF NOT FOUND OR communication.is_active IS DISTINCT FROM true OR to_jsonb(communication)->>'environment_type' IS DISTINCT FROM 'production' THEN RAISE EXCEPTION 'ediel_scoped_capability_evidence_required'; END IF;
 BEGIN registry_id:=nullif(r.metadata->>'platform_actor_route_id','')::uuid; EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'ediel_scoped_capability_evidence_required'; END;
 IF registry_id IS NOT NULL THEN
  SELECT * INTO registry_route FROM public.platform_actor_routes WHERE id=registry_id AND environment='production' FOR SHARE;
  IF NOT FOUND OR registry_route.is_verified IS DISTINCT FROM true OR registry_route.status IS DISTINCT FROM 'active' OR to_jsonb(registry_route)->'auto_send_allowed'='false'::jsonb THEN RAISE EXCEPTION 'ediel_scoped_capability_evidence_required'; END IF;
  IF nullif(btrim(registry_route.communication_address),'') IS NULL OR lower(btrim(registry_route.communication_address)) IS DISTINCT FROM lower(btrim(communication.target_email)) THEN RAISE EXCEPTION 'ediel_scoped_capability_evidence_required'; END IF;
  IF coalesce(nullif(btrim(registry_route.party_id),''),nullif(btrim(registry_route.interchange_party_id),'')) IS DISTINCT FROM nullif(btrim(r.receiver_ediel_id),'')
   OR upper(registry_route.message_family) IS DISTINCT FROM upper(m.message_family) THEN RAISE EXCEPTION 'ediel_scoped_capability_evidence_required'; END IF;
 END IF;
 -- Only selected actual fields. No global routes hash or secret auth_config.
 route_dependency:=jsonb_build_object('communicationRoute',jsonb_build_object('id',communication.id,'companyId',communication.company_id,'active',communication.is_active,'environment',to_jsonb(communication)->'environment_type','targetEmail',communication.target_email,'endpoint',to_jsonb(communication)->'endpoint','counterpartyEdielId',to_jsonb(communication)->'counterparty_ediel_id','payloadVersion',to_jsonb(communication)->'supported_payload_version','messageFamilies',to_jsonb(communication)->'supported_message_families','messageCodes',to_jsonb(communication)->'supported_message_codes'),
  'registryRoute',CASE WHEN registry_id IS NULL THEN NULL ELSE jsonb_build_object('id',registry_route.id,'actorId',registry_route.actor_id,'environment',registry_route.environment,'messageFamily',registry_route.message_family,'applicationReference',registry_route.application_reference,'subaddress',registry_route.subaddress,'communicationType',registry_route.communication_type,'communicationAddress',registry_route.communication_address,'partyId',registry_route.party_id,'interchangePartyId',registry_route.interchange_party_id,'verified',registry_route.is_verified,'status',registry_route.status,'source',registry_route.source,'sourceVersion',registry_route.metadata->'source_version') END);
 deps:=(current_scope->'dependencies')||jsonb_build_object('selectedRouteSecurity',route_dependency);
 RETURN current_scope||jsonb_build_object('dependencies',deps,'dependencyHash',encode(digest(convert_to(jsonb_build_object('scope',current_scope->'scope','dependencies',deps)::text,'UTF8'),'sha256'),'hex'));
END $$;
REVOKE ALL ON FUNCTION gridex_ediel_readiness.capture(uuid,uuid,uuid,text,text,text,text,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
