-- CLI-created additive namespace bridge before the distinct full-object V5.
-- ALTER preserves incoming function OIDs, owner, ACL and configuration. The
-- PL/pgSQL calls resolve names at execution time and are rebound explicitly.
BEGIN;
ALTER FUNCTION gridex_received_sources.append_prodat_validation_v5(uuid,text,uuid,text,text,text,text,text,text) RENAME TO append_prodat_source_function_validation_v5;
ALTER FUNCTION public.gridex_record_prodat_source_validation_v5(uuid,text,uuid,text,text,text,text,text,text) RENAME TO gridex_record_prodat_source_function_validation_v5;
DO $forward$
DECLARE body text;old_call text;new_call text;
BEGIN
 SELECT pg_get_functiondef('gridex_received_sources.append_prodat_validation_v4(uuid,text,uuid,text,text,text,text,text)'::regprocedure) INTO body;
 old_call:='gridex_received_sources.append_prodat_validation_v3(c,env,source_id,source_hash,facts_text,ignored_text,response_text)';
 new_call:='gridex_received_sources.append_prodat_response_validation_v3(c,env,source_id,source_hash,facts_text,ignored_text,response_text)';
 IF strpos(body,old_call)=0 THEN RAISE EXCEPTION 'prodat_response_v4_namespace_contract_changed';END IF;
 EXECUTE replace(body,old_call,new_call);
 SELECT pg_get_functiondef('gridex_received_sources.append_prodat_source_function_validation_v5(uuid,text,uuid,text,text,text,text,text,text)'::regprocedure) INTO body;
 IF strpos(body,old_call)=0 THEN RAISE EXCEPTION 'prodat_source_function_v5_namespace_contract_changed';END IF;
 EXECUTE replace(body,old_call,new_call);
 SELECT pg_get_functiondef('public.gridex_record_prodat_source_function_validation_v5(uuid,text,uuid,text,text,text,text,text,text)'::regprocedure) INTO body;
 old_call:='gridex_received_sources.append_prodat_validation_v5(';new_call:='gridex_received_sources.append_prodat_source_function_validation_v5(';
 IF strpos(body,old_call)=0 THEN RAISE EXCEPTION 'prodat_source_function_public_v5_namespace_contract_changed';END IF;
 EXECUTE replace(body,old_call,new_call);
END $forward$;
COMMIT;
