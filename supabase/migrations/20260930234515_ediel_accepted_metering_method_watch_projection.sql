-- Same accepted transaction registers TM-METHOD40 from its actual frozen
-- F/G original and attempt binding. Existing final ACK and source states survive.
BEGIN;
ALTER FUNCTION public.gridex_ediel_repair_accepted_transport_projection_v1(uuid,text,uuid,uuid) SET SCHEMA gridex_ediel_transport;
ALTER FUNCTION gridex_ediel_transport.gridex_ediel_repair_accepted_transport_projection_v1(uuid,text,uuid,uuid) RENAME TO repair_before_method_watch_v1;
REVOKE ALL ON FUNCTION gridex_ediel_transport.repair_before_method_watch_v1(uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.gridex_ediel_repair_accepted_transport_projection_v1(p_company_id uuid,p_environment text,p_actor_user_id uuid,p_message_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
DECLARE projection jsonb; m public.ediel_messages%rowtype;watch jsonb;
BEGIN
 projection:=gridex_ediel_transport.repair_before_method_watch_v1(p_company_id,p_environment,p_actor_user_id,p_message_id);
 IF projection IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id AND environment=p_environment AND direction='outbound' FOR UPDATE;
 IF m.message_standard='edifact' AND m.message_family='PRODAT' AND m.message_code='Z09' THEN
  watch:=gridex_method_expectations.mutate_v1(jsonb_build_object('action','register','companyId',p_company_id,'environment',p_environment,'actorUserId',p_actor_user_id,'messageId',p_message_id));
  IF jsonb_typeof(watch) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'ediel_method_expectation_projection_invalid';END IF;
 END IF;
 RETURN projection;
END $$;
REVOKE ALL ON FUNCTION public.gridex_ediel_repair_accepted_transport_projection_v1(uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_ediel_repair_accepted_transport_projection_v1(uuid,text,uuid,uuid) TO service_role;
COMMIT;
