-- New CLI-created ordered bridge, immediately before the already frozen 00148.
-- Rename preserves incoming 234111 function OIDs, owner, ACL and search_path.
-- No previously applied migration or canonical assessment is rewritten.
BEGIN;
ALTER FUNCTION gridex_received_sources.append_prodat_validation_v3(uuid,text,uuid,text,text,text,text) RENAME TO append_prodat_response_validation_v3;
ALTER FUNCTION public.gridex_record_prodat_source_validation_v3(uuid,text,uuid,text,text,text,text) RENAME TO gridex_record_prodat_response_source_validation_v3;
CREATE OR REPLACE FUNCTION public.gridex_record_prodat_response_source_validation_v3(p_company_id uuid,p_environment text,p_source_message_id uuid,p_source_payload_hash text,p_facts_text text,p_ignored_fields_text text,p_response_facts_text text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'received_evidence_service_required' USING ERRCODE='42501';END IF;
 RETURN gridex_received_sources.append_prodat_response_validation_v3(p_company_id,p_environment,p_source_message_id,p_source_payload_hash,p_facts_text,p_ignored_fields_text,p_response_facts_text);
END$$;
COMMIT;
