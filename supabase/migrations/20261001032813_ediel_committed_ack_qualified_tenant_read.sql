-- Created with the actual Supabase CLI. Read a retained incoming ACK before
-- contemporary tenant resolution, using only its immutable own correlation.
-- A source without that proof returns NULL and remains a fresh source; this
-- reader never assigns a tenant or writes a replay, outcome, or public row.
BEGIN;
CREATE FUNCTION gridex_ack_authority.read_committed_by_source_v2(
 p_company uuid,p_environment text,p_ack uuid,p_actor uuid,p_ack_payload_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c gridex_ack_authority.source_correlations%rowtype;
BEGIN
 IF p_environment IS NULL OR p_environment NOT IN('test','production') OR p_ack IS NULL OR p_actor IS NULL
  OR p_ack_payload_hash IS NULL OR (p_ack_payload_hash~'^[a-f0-9]{64}$') IS NOT TRUE
 THEN RAISE EXCEPTION 'ack_execution_scope_required' USING ERRCODE='22023';END IF;
 -- An absent proof discloses no tenant/source facts, but still requires a
 -- genuine current active actor. A present proof additionally requires its
 -- own accepted membership and communication READ/WRITE in the frozen reader.
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor AND u.user_status='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ack_execution_actor_unqualified' USING ERRCODE='42501';END IF;
 SELECT * INTO c FROM gridex_ack_authority.source_correlations WHERE ack_message_id=p_ack;
 IF c.ack_message_id IS NULL THEN RETURN NULL;END IF;
 IF c.company_id IS NULL OR c.environment IS DISTINCT FROM p_environment
  OR c.ack_payload_hash IS DISTINCT FROM p_ack_payload_hash
  OR (p_company IS NOT NULL AND c.company_id IS DISTINCT FROM p_company)
 THEN RAISE EXCEPTION 'ack_immutable_correlation_conflict' USING ERRCODE='23514';END IF;
 -- This existing source->ACK reader independently validates the immutable
 -- received raw/context/canonical leaf, exact sealed sent original, and any
 -- stored partial result. No current guide or public status is reselected.
 RETURN gridex_ack_authority.read_committed_v1(c.company_id,p_environment,p_ack,p_actor);
END$$;
CREATE FUNCTION public.gridex_read_committed_inbound_ack_v2(
 p_company_id uuid,p_environment text,p_ack_message_id uuid,p_actor_user_id uuid,p_ack_payload_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'ack_source_service_required' USING ERRCODE='42501';END IF;
 RETURN gridex_ack_authority.read_committed_by_source_v2(p_company_id,p_environment,p_ack_message_id,p_actor_user_id,p_ack_payload_hash);
END$$;
REVOKE ALL ON FUNCTION gridex_ack_authority.read_committed_by_source_v2(uuid,text,uuid,uuid,text),
 public.gridex_read_committed_inbound_ack_v2(uuid,text,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_ack_authority.read_committed_by_source_v2(uuid,text,uuid,uuid,text),
 public.gridex_read_committed_inbound_ack_v2(uuid,text,uuid,uuid,text) TO service_role;
COMMIT;
