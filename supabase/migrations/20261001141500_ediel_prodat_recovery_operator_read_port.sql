-- OPS/TR05: one current native catalog gate, explicit READ/WRITE/SEND phases.
-- Read-only operator discovery never authorizes a selected ID or raw claichosen.
BEGIN;
DO $phase$
DECLARE body text;
BEGIN
 body:=pg_get_functiondef('gridex_received_sources.require_recovery_execution_actor_v1(uuid,uuid,text)'::regprocedure);
 IF strpos(body,'phase IN(''prepare'',''send'')')=0 OR strpos(body,'wanted:=CASE phase WHEN ''prepare'' THEN ''communication.write'' ELSE ''communication.send'' END;')=0 OR strpos(body,'u.deleted_at IS NULL')=0 THEN RAISE EXCEPTION 'recovery_current_catalog_source_shape_changed';END IF;
 body:=replace(body,'phase IN(''prepare'',''send'')','phase IN(''read'',''prepare'',''send'')');
 body:=replace(body,'wanted:=CASE phase WHEN ''prepare'' THEN ''communication.write'' ELSE ''communication.send'' END;','wanted:=CASE phase WHEN ''read'' THEN ''communication.read'' WHEN ''prepare'' THEN ''communication.write'' ELSE ''communication.send'' END;');
 EXECUTE body;
END$phase$;
CREATE FUNCTION public.ediel_prodat_recovery_workspace_v1(p_company_id uuid,p_actor_user_id uuid,p_message_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE chosen public.ediel_messages%rowtype;record jsonb;result jsonb;current_content boolean;source_state text:='not_applicable';
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'prodat_recovery_workspace_service_required' USING ERRCODE='42501';END IF;
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 IF p_message_id IS NOT NULL THEN LOCK TABLE public.ediel_messages IN SHARE ROW EXCLUSIVE MODE;END IF;
 PERFORM gridex_received_sources.require_recovery_execution_actor_v1(p_company_id,p_actor_user_id,'read');
 IF p_message_id IS NOT NULL THEN
  SELECT * INTO chosen FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id AND direction='outbound' AND message_family='PRODAT' FOR SHARE;
  IF chosen.id IS NULL THEN RAISE EXCEPTION 'prodat_recovery_workspace_message_unavailable';END IF;
  PERFORM gridex_received_sources.require_recovery_execution_actor_v1(p_company_id,p_actor_user_id,'read');
  current_content:=chosen.raw_payload IS NOT NULL AND chosen.immutable_payload_hash IS NOT NULL AND chosen.immutable_payload_hash=encode(sha256(convert_to(chosen.raw_payload,'UTF8')),'hex');
  IF EXISTS(SELECT FROM gridex_received_sources.prodat_recovery_messages link JOIN gridex_received_sources.prodat_recovery_operations op ON op.id=link.operation_id WHERE link.message_id=chosen.id AND op.company_id=p_company_id) THEN
   BEGIN PERFORM public.ediel_require_prodat_recovery_current_v1(p_company_id,chosen.id);source_state:='qualified';EXCEPTION WHEN OTHERS THEN source_state:='held';END;
  END IF;
  record:=jsonb_build_object('messageId',chosen.id,'operationId',chosen.source_operation_id,'originalMessageId',chosen.original_message_id,'environment',chosen.environment,'status',chosen.status,'code',chosen.message_code,'rawPayload',CASE WHEN current_content THEN chosen.raw_payload END,'payloadHash',chosen.immutable_payload_hash,'contentCurrent',current_content,'sourceCurrent',source_state,'contrl',chosen.contrl_status,'aperak',chosen.aperak_status);
 END IF;
 SELECT jsonb_build_object('companyId',p_company_id,'actorUserId',p_actor_user_id,'record',record,
  'originals',coalesce((SELECT jsonb_agg(jsonb_build_object('id',x.id,'environment',x.environment,'label',concat(x.message_code,' · ',x.environment,' · ',coalesce(x.external_reference,x.id::text),' · ',x.created_at))) FROM(SELECT id,message_code,environment,external_reference,created_at FROM public.ediel_messages WHERE company_id=p_company_id AND direction='outbound' AND message_family='PRODAT' ORDER BY created_at DESC,id LIMIT 200)x),'[]'),
  'acks',coalesce((SELECT jsonb_agg(jsonb_build_object('id',x.id,'environment',x.environment,'label',concat(x.message_family,' · ',x.environment,' · ',coalesce(x.external_reference,x.id::text),' · ',x.created_at))) FROM(SELECT id,message_family,environment,external_reference,created_at FROM public.ediel_messages WHERE company_id=p_company_id AND direction='inbound' AND message_family IN('APERAK','CONTRL') ORDER BY created_at DESC,id LIMIT 200)x),'[]'),
  'corrections',coalesce((SELECT jsonb_agg(jsonb_build_object('id',x.id,'environment',x.environment,'status',x.status,'label',concat(x.message_code,' · ',x.status,' · ',x.environment,' · ',coalesce(x.external_reference,x.id::text),' · ',x.created_at))) FROM(SELECT m.id,m.message_code,m.environment,m.status,m.external_reference,m.created_at FROM public.ediel_messages m JOIN gridex_received_sources.prodat_recovery_messages link ON link.message_id=m.id JOIN gridex_received_sources.prodat_recovery_operations op ON op.id=link.operation_id AND op.company_id=m.company_id AND op.environment=m.environment WHERE m.company_id=p_company_id AND m.direction='outbound' AND m.message_family='PRODAT' ORDER BY m.created_at DESC,m.id LIMIT 200)x),'[]'),
  'attempts',coalesce((SELECT jsonb_agg(jsonb_build_object('id',x.id,'messageId',x.message_id,'label',concat(coalesce(x.classification,'unobserved'),' · ',x.created_at,' · ',x.id))) FROM(SELECT a.id,a.message_id,a.classification,a.created_at FROM gridex_ediel_transport.attempts a JOIN public.ediel_messages m ON m.id=a.message_id AND m.company_id=a.company_id AND m.environment=a.environment WHERE a.company_id=p_company_id AND m.direction='outbound' AND m.message_family='PRODAT' ORDER BY a.created_at DESC,a.id LIMIT 200)x),'[]')) INTO result;
 PERFORM gridex_received_sources.require_recovery_execution_actor_v1(p_company_id,p_actor_user_id,'read');
 RETURN result;
END$$;
REVOKE ALL ON FUNCTION public.ediel_prodat_recovery_workspace_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_prodat_recovery_workspace_v1(uuid,uuid,uuid) TO service_role;
COMMIT;
