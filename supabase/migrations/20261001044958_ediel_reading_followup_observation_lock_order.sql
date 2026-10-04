-- CLI forward. Observational accepted history takes no late global graph SHARE
-- lock after structural/storage writes. Never wait for another source writer
-- while holding the follow-up namespace lock; the genuine persist/read owner
-- rechecks retained accepted bindings in its next committed invocation.
BEGIN;
DO $$DECLARE body text;needle text;BEGIN
 SELECT pg_get_functiondef('gridex_received_reading_expectations.consider_utilts_source_v1(uuid,text,uuid)'::regprocedure) INTO body;
 needle:=$old$ PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();$old$;
 IF strpos(body,needle)=0 THEN RAISE EXCEPTION 'z06f_observation_lock_prefix_contract_changed';END IF;body:=replace(body,needle,'');
 needle:=$old$SELECT * INTO m FROM public.ediel_messages WHERE id=msg AND company_id=c AND environment=env FOR SHARE;$old$;
 IF strpos(body,needle)=0 THEN RAISE EXCEPTION 'z06f_observation_source_lock_contract_changed';END IF;
 EXECUTE replace(body,needle,$new$SELECT * INTO m FROM public.ediel_messages WHERE id=msg AND company_id=c AND environment=env FOR SHARE SKIP LOCKED;$new$);
 SELECT pg_get_functiondef('public.ediel_read_z06f_reading_followup_v1(uuid,text,uuid,uuid)'::regprocedure) INTO body;
 body:=replace(body,'AS $function$BEGIN','AS $function$DECLARE prior_source uuid;BEGIN');
 needle:=$old$ RETURN jsonb_build_object('version',1,'criterion','AT-Z06F-SUPPLIER'$old$;
 IF strpos(body,needle)=0 THEN RAISE EXCEPTION 'z06f_observation_read_contract_changed';END IF;
 body:=replace(body,needle,$new$ FOR prior_source IN SELECT r.source_message_id FROM gridex_utilts_binding.receipts r WHERE r.company_id=p_company_id AND r.environment=p_environment ORDER BY r.source_message_id LOOP
  PERFORM gridex_received_reading_expectations.consider_utilts_source_v1(p_company_id,p_environment,prior_source);
 END LOOP;
 RETURN jsonb_build_object('version',1,'criterion','AT-Z06F-SUPPLIER'$new$);EXECUTE body;
END$$;
CREATE FUNCTION gridex_received_reading_expectations.current_status_v1(c uuid,env text,msg uuid,line_index integer) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('owner','applied-z06f-reading-followup-v1','criterion','AT-Z06F-SUPPLIER','sourceMessageId',msg,'firstLineIndex',line_index,'deadline',NULL,'automaticRequestAllowed',false,
 'status',CASE WHEN count(*)=0 THEN 'source_scope_unavailable' WHEN bool_and(observed) THEN CASE WHEN bool_and(mode='meter_reading') THEN 'reading_observed' ELSE 'initial_values_observed' END ELSE 'pending' END,
 'fulfilled',coalesce(bool_and(observed AND mode='meter_reading'),false),'expectationIds',coalesce(jsonb_agg(id),'[]'))
 FROM(SELECT e.id,e.contract->>'mode' mode,EXISTS(SELECT FROM gridex_received_reading_expectations.observations o WHERE o.expectation_id=e.id) observed FROM gridex_received_reading_expectations.expectations e WHERE e.company_id=c AND e.environment=env AND e.source_message_id=msg AND e.first_line_index=line_index) own;
$$;
-- Preserve latest native source/actor/atomic apply implementation and OID/ACL.
-- Only its returned live diagnostics change; retained immutable receipts/result
-- bytes remain the original historical proof, with no fabricated observation.
DO $$DECLARE body text;BEGIN
 SELECT pg_get_functiondef('public.ediel_apply_reviewed_structure_objects_v2(uuid,uuid,uuid,integer[])'::regprocedure) INTO body;
 IF strpos(body,'structural_object_apply_receipts')=0 THEN RAISE EXCEPTION 'z06f_actual_apply_owner_contract_changed';END IF;
 body:=replace(body,'public.ediel_apply_reviewed_structure_objects_v2(','gridex_received_reading_expectations.apply_before_live_followup_v1(');
 EXECUTE body;
END$$;
CREATE OR REPLACE FUNCTION public.ediel_apply_reviewed_structure_objects_v2(p_company_id uuid,p_source_message_id uuid,p_actor_user_id uuid,p_object_line_indices integer[] DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;env text;objects jsonb;BEGIN
 result:=gridex_received_reading_expectations.apply_before_live_followup_v1(p_company_id,p_source_message_id,p_actor_user_id,p_object_line_indices);
 IF result->>'applied' IS DISTINCT FROM 'true' THEN RETURN result;END IF;
 SELECT environment INTO env FROM public.ediel_messages WHERE id=p_source_message_id AND company_id=p_company_id;
 SELECT jsonb_agg(CASE WHEN own#>>'{wire,businessCase}'='change_with_reading' AND own#>>'{wire,messageCode}'='Z06' THEN own||jsonb_build_object('readingFollowUp',gridex_received_reading_expectations.current_status_v1(p_company_id,env,p_source_message_id,(own#>>'{object,registers,0,segmentIndex}')::integer)) ELSE own END ORDER BY ordinal) INTO objects
 FROM jsonb_array_elements(result->'objects') WITH ORDINALITY x(own,ordinal);
 RETURN CASE WHEN objects IS NULL THEN result ELSE result||jsonb_build_object('objects',objects) END;
END$$;
REVOKE ALL ON FUNCTION gridex_received_reading_expectations.current_status_v1(uuid,text,uuid,integer),gridex_received_reading_expectations.apply_before_live_followup_v1(uuid,uuid,uuid,integer[]) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
