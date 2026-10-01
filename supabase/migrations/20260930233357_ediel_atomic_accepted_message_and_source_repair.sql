-- TR03/TR10: message, timers and owned request projections share one native
-- transaction. Move the current implementation intact; do not reconstruct
-- an earlier authorization contract or permit direct execution of the delegate.
BEGIN;
ALTER FUNCTION public.gridex_ediel_repair_accepted_transport_projection_v1(uuid,text,uuid,uuid)
 SET SCHEMA gridex_ediel_transport;
ALTER FUNCTION gridex_ediel_transport.gridex_ediel_repair_accepted_transport_projection_v1(uuid,text,uuid,uuid)
 RENAME TO repair_message_projection_v1;
REVOKE ALL ON FUNCTION gridex_ediel_transport.repair_message_projection_v1(uuid,text,uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.gridex_ediel_repair_accepted_transport_projection_v1(
 p_company_id uuid,p_environment text,p_actor_user_id uuid,p_message_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
DECLARE projection jsonb; source_projection jsonb;
BEGIN
 projection:=gridex_ediel_transport.repair_message_projection_v1(p_company_id,p_environment,p_actor_user_id,p_message_id);
 IF projection IS NULL THEN RETURN NULL;END IF;
 source_projection:=public.ediel_project_accepted_source_state_v1(p_company_id,p_environment,p_actor_user_id,p_message_id,projection->>'originalHash');
 IF source_projection->>'status' IS DISTINCT FROM 'source_projection'
  OR source_projection->>'companyId' IS DISTINCT FROM projection->>'companyId'
  OR source_projection->>'environment' IS DISTINCT FROM projection->>'environment'
  OR source_projection->>'messageId' IS DISTINCT FROM projection->>'messageId'
  OR source_projection->>'originalHash' IS DISTINCT FROM projection->>'originalHash'
  OR (source_projection->>'observedAt')::timestamptz IS DISTINCT FROM (projection->>'observedAt')::timestamptz
  THEN RAISE EXCEPTION 'ediel_accepted_projection_source_changed';END IF;
 RETURN projection;
END $$;
REVOKE ALL ON FUNCTION public.gridex_ediel_repair_accepted_transport_projection_v1(uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_ediel_repair_accepted_transport_projection_v1(uuid,text,uuid,uuid) TO service_role;
COMMIT;
