-- Independently selected signed UD/IV inputs. No new execution authority,
-- private source seed, or modification of the existing source/queue/send owners.
BEGIN;
CREATE FUNCTION public.ediel_requested_customer_change_selected_facts_v1(p_company_id uuid,p_actor_user_id uuid,p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o gridex_requested_customer_changes.origins%rowtype;a gridex_requested_customer_changes.artifacts%rowtype;e gridex_customer_life_events.events%rowtype;current_source jsonb;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'requested_customer_change_service_required' USING ERRCODE='42501';END IF;
 IF gridex_requested_customer_changes.actor_v1(p_company_id,p_actor_user_id,'archive','method_contract') IS NOT TRUE THEN RAISE EXCEPTION 'requested_customer_change_selected_facts_actor_forbidden' USING ERRCODE='42501';END IF;
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 SELECT * INTO o FROM gridex_requested_customer_changes.origins WHERE company_id=p_company_id AND event_id=p_event_id;
 IF o.artifact_id IS NULL THEN
  IF gridex_requested_customer_changes.actor_v1(p_company_id,p_actor_user_id,'archive','method_contract') IS NOT TRUE THEN RAISE EXCEPTION 'requested_customer_change_post_wait_selected_facts_actor_forbidden' USING ERRCODE='42501';END IF;
  RETURN NULL;
 END IF;
 current_source:=gridex_requested_customer_changes.current_v1(o.artifact_id,p_company_id);
 SELECT * INTO a FROM gridex_requested_customer_changes.artifacts WHERE id=o.artifact_id AND company_id=p_company_id FOR SHARE;
 SELECT * INTO e FROM gridex_customer_life_events.events WHERE id=p_event_id AND company_id=p_company_id FOR SHARE;
 IF gridex_requested_customer_changes.actor_v1(p_company_id,p_actor_user_id,'archive','method_contract') IS NOT TRUE THEN RAISE EXCEPTION 'requested_customer_change_post_wait_selected_facts_actor_forbidden' USING ERRCODE='42501';END IF;
 IF current_source IS NULL OR current_source->>'eventId' IS DISTINCT FROM p_event_id::text OR a.id IS NULL OR e.id IS NULL OR a.environment IS DISTINCT FROM e.environment OR a.claims->>'customerId' IS DISTINCT FROM e.customer_id::text OR a.source_reference IS DISTINCT FROM e.source_reference OR a.source_version IS DISTINCT FROM e.source_version OR a.source_hash IS DISTINCT FROM e.source_sha256 OR a.raw_payload IS DISTINCT FROM e.approved_raw_payload OR a.claims->>'payloadHash' IS DISTINCT FROM e.approved_payload_hash OR a.claims->'scope' IS DISTINCT FROM e.approved_scope OR EXISTS(SELECT FROM gridex_customer_life_events.revocations WHERE event_id=e.id) THEN
  RETURN jsonb_build_object('status','held','missing',ARRAY['current_outgoing_customer_mandate_unavailable']);
 END IF;
 -- Recheck wall-clock authority after all source/event lock waits.
 current_source:=gridex_requested_customer_changes.current_v1(a.id,p_company_id);
 IF gridex_requested_customer_changes.actor_v1(p_company_id,p_actor_user_id,'archive','method_contract') IS NOT TRUE THEN RAISE EXCEPTION 'requested_customer_change_post_wait_selected_facts_actor_forbidden' USING ERRCODE='42501';END IF;
 IF current_source IS NULL THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_outgoing_customer_mandate_unavailable']);END IF;
 RETURN jsonb_build_object('status','authorized','companyId',a.company_id,'environment',a.environment,'eventId',e.id,'artifactId',a.id,'customerId',e.customer_id,'sourceReference',a.source_reference,'sourceVersion',a.source_version,'sourceHash',a.source_hash,'claimsHash',a.claims_hash,'payloadHash',a.claims->>'payloadHash','effectiveAt',a.claims->>'effectiveAt','scope',a.claims->'scope','customerTokens',a.claims->'customerTokens');
END$$;
REVOKE ALL ON FUNCTION public.ediel_requested_customer_change_selected_facts_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_requested_customer_change_selected_facts_v1(uuid,uuid,uuid) TO service_role;
COMMIT;
