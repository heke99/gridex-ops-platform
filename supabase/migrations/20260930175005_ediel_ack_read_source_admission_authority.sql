BEGIN;
-- Admission may inherit an original's sealed execution context only after the
-- same physical/global source qualification used by the atomic ACK writer.
CREATE FUNCTION public.gridex_read_inbound_ack_source_v1(p_company_id uuid,p_environment text,p_ack_message_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE ack public.ediel_messages%rowtype; captured gridex_received_sources.sources%rowtype;
 source public.ediel_messages%rowtype; a jsonb; ids uuid[];
BEGIN
 IF current_user<>'service_role' AND session_user<>'service_role' AND coalesce(current_setting('role',true),'')<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 IF p_company_id IS NULL OR p_environment IS NULL OR p_environment NOT IN ('test','production') OR p_ack_message_id IS NULL THEN RAISE EXCEPTION 'ack_execution_scope_required' USING ERRCODE='22023'; END IF;
 SELECT * INTO ack FROM public.ediel_messages WHERE id=p_ack_message_id AND company_id=p_company_id AND environment=p_environment AND direction='inbound';
 SELECT * INTO captured FROM gridex_received_sources.sources WHERE source_message_id=ack.id AND company_id=p_company_id AND environment=p_environment;
 IF ack.id IS NULL OR captured.source_message_id IS NULL OR captured.received_context IS NULL OR captured.source_received_at IS NULL
  OR captured.raw_payload IS DISTINCT FROM ack.raw_payload OR captured.payload_hash IS DISTINCT FROM ack.immutable_payload_hash
  OR captured.payload_hash IS DISTINCT FROM encode(sha256(convert_to(ack.raw_payload,'UTF8')),'hex') THEN RETURN NULL; END IF;
 a:=gridex_ack_authority.wire_v1(ack.raw_payload);
 IF a IS NULL OR a->>'environment' IS DISTINCT FROM p_environment THEN RETURN NULL; END IF;
 -- Include every actual historical sent wire; metadata indexes are hints only.
 SELECT array_agg(m.id ORDER BY m.id) INTO ids FROM public.ediel_messages m WHERE m.direction='outbound' AND m.message_sent_at IS NOT NULL AND m.immutable_rendered_at IS NOT NULL
  AND m.immutable_payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') AND gridex_ack_authority.source_match_v1(a,gridex_ack_authority.wire_v1(m.raw_payload));
 IF cardinality(ids) IS DISTINCT FROM 1 THEN RETURN NULL; END IF;
 SELECT * INTO source FROM public.ediel_messages WHERE id=ids[1] AND company_id=p_company_id AND environment=p_environment;
 IF source.id IS NULL OR source.message_sent_at>captured.source_received_at THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('version',1,'sourceMessage',to_jsonb(source));
END $$;
REVOKE ALL ON FUNCTION public.gridex_read_inbound_ack_source_v1(uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_read_inbound_ack_source_v1(uuid,text,uuid) TO service_role;
COMMIT;
