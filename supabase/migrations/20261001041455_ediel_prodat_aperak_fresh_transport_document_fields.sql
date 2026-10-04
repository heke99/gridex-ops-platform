-- Actual CLI-created forward. ACK-10 unused columns remain prohibited when an
-- older consumed original enters its first transport attempt. The complete
-- existing journal returns fixed prepare/entry/accepted results first; a new
-- guard failure rolls back its fresh reservation/entry in the SAME transaction.
-- Historical ACK reads, bytes, source editions and outcomes are not rewritten.
BEGIN;
ALTER FUNCTION gridex_ediel_transport.mutate_v1(jsonb) RENAME TO mutate_before_prodat_unused_document_v1;
CREATE FUNCTION gridex_ediel_transport.mutate_v1(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;m public.ediel_messages%rowtype;
BEGIN
 result:=gridex_ediel_transport.mutate_before_prodat_unused_document_v1(p_input);
 IF (p_input->>'action' IN('prepare','enter')) IS TRUE AND result->>'proceed'='true' THEN
  SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=(p_input->>'messageId')::uuid
   AND company_id=(p_input->>'companyId')::uuid AND environment=p_input->>'environment' AND direction='outbound' FOR SHARE;
  PERFORM gridex_ediel_ack_guide.require_prodat_unused_document_v1(m.raw_payload);
 END IF;
 RETURN result;
END$$;
ALTER FUNCTION gridex_outbound_dispatch.mutate_v1(jsonb) RENAME TO mutate_before_prodat_unused_document_v1;
CREATE FUNCTION gridex_outbound_dispatch.mutate_v1(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;m public.ediel_messages%rowtype;
BEGIN
 result:=gridex_outbound_dispatch.mutate_before_prodat_unused_document_v1(p_input);
 IF (p_input->>'action' IN('prepare','enter')) IS TRUE AND result->>'scoped'='true' AND result->>'proceed'='true' THEN
  SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=(p_input->>'messageId')::uuid
   AND company_id=(p_input->>'companyId')::uuid AND environment=p_input->>'environment' AND direction='outbound' FOR SHARE;
  PERFORM gridex_ediel_ack_guide.require_prodat_unused_document_v1(m.raw_payload);
 END IF;
 RETURN result;
END$$;
REVOKE ALL ON FUNCTION gridex_ediel_transport.mutate_before_prodat_unused_document_v1(jsonb),gridex_ediel_transport.mutate_v1(jsonb),
 gridex_outbound_dispatch.mutate_before_prodat_unused_document_v1(jsonb),gridex_outbound_dispatch.mutate_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_ediel_transport.mutate_v1(jsonb),gridex_outbound_dispatch.mutate_v1(jsonb) TO service_role;
COMMIT;
