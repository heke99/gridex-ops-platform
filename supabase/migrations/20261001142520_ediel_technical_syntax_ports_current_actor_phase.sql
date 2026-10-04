-- The four public technical CONTRL source ports were service_role-only but
-- actorless: the native call trusted the TS actor gate in front of it. V2
-- ports take the actual executing actor and phase, check them natively before
-- the private owner runs and again as the final step (no wait follows), and
-- return the executing actor/phase echo. Private owners are unchanged. The V1
-- actorless ports lose service_role EXECUTE; every TS caller uses V2.
-- Phase rule mirrors the installed CONTRL creation gate (20261001021918):
-- prepare = communication.write, or ediel_testing.write in the test
-- environment; read = communication.read; send = communication.send/ediel.send.
BEGIN;
CREATE FUNCTION gridex_ediel_technical_ack.require_actor_v1(c uuid,env text,actor uuid,phase text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 PERFORM id FROM public.user_profiles WHERE id=actor FOR SHARE;
 PERFORM user_id FROM public.company_memberships WHERE company_id=c AND user_id=actor FOR SHARE;
 IF c IS NULL OR actor IS NULL OR env IS NULL OR phase IS NULL OR phase NOT IN('prepare','read','send')
  OR NOT EXISTS(SELECT FROM public.companies WHERE id=c AND status='active' AND is_active)
  OR NOT EXISTS(SELECT FROM public.user_profiles WHERE id=actor AND user_status='active')
  OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=c AND user_id=actor AND status='active' AND is_active AND accepted_at IS NOT NULL)
  OR (CASE phase
   WHEN 'prepare' THEN public.gridex_actor_has_company_permission(actor,c,'communication.write') IS TRUE
    OR env='test' AND public.gridex_actor_has_company_permission(actor,c,'ediel_testing.write') IS TRUE
   WHEN 'read' THEN public.gridex_actor_has_company_permission(actor,c,'communication.read') IS TRUE
   WHEN 'send' THEN public.gridex_actor_has_company_permission(actor,c,'communication.send') IS TRUE
    OR public.gridex_actor_has_company_permission(actor,c,'ediel.send') IS TRUE
   ELSE false END) IS NOT TRUE
 THEN RAISE EXCEPTION 'ediel_technical_ack_current_actor_required' USING ERRCODE='42501';END IF;
END$$;
CREATE FUNCTION public.ediel_read_technical_source_endpoint_v2(p_source_message_id uuid,p_actor_user_id uuid,p_phase text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$DECLARE e jsonb;BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501';END IF;
 e:=gridex_ediel_technical_ack.read_endpoint_v1(p_source_message_id);
 IF e IS NULL THEN RETURN NULL;END IF;
 PERFORM gridex_ediel_technical_ack.require_actor_v1((e->>'companyId')::uuid,e->>'environment',p_actor_user_id,p_phase);
 RETURN e||jsonb_build_object('executionActorUserId',p_actor_user_id,'executionPhase',p_phase);
END$$;
CREATE FUNCTION public.ediel_record_technical_syntax_facet_v2(p_company_id uuid,p_source_message_id uuid,p_source_payload_hash text,p_facts_text text,p_actor_user_id uuid,p_phase text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$DECLARE env text;r jsonb;BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501';END IF;
 SELECT environment INTO env FROM public.ediel_messages WHERE id=p_source_message_id;
 PERFORM gridex_ediel_technical_ack.require_actor_v1(p_company_id,env,p_actor_user_id,p_phase);
 r:=gridex_ediel_technical_ack.record_syntax_v1(p_company_id,p_source_message_id,p_source_payload_hash,p_facts_text);
 PERFORM gridex_ediel_technical_ack.require_actor_v1(p_company_id,env,p_actor_user_id,p_phase);
 RETURN r;
END$$;
CREATE FUNCTION public.ediel_capture_technical_syntax_ack_basis_v2(p_company_id uuid,p_message_id uuid,p_actor_user_id uuid,p_phase text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$DECLARE env text;r jsonb;BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501';END IF;
 SELECT environment INTO env FROM public.ediel_messages WHERE id=p_message_id;
 PERFORM gridex_ediel_technical_ack.require_actor_v1(p_company_id,env,p_actor_user_id,p_phase);
 r:=gridex_ediel_technical_ack.capture_reply_v1(p_company_id,p_message_id);
 PERFORM gridex_ediel_technical_ack.require_actor_v1(p_company_id,env,p_actor_user_id,p_phase);
 RETURN r;
END$$;
CREATE FUNCTION public.ediel_require_technical_syntax_ack_basis_v2(p_company_id uuid,p_message_id uuid,p_actor_user_id uuid,p_phase text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$DECLARE env text;r jsonb;BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501';END IF;
 SELECT environment INTO env FROM public.ediel_messages WHERE id=p_message_id;
 PERFORM gridex_ediel_technical_ack.require_actor_v1(p_company_id,env,p_actor_user_id,p_phase);
 r:=gridex_ediel_technical_ack.require_source_v1(p_company_id,p_message_id);
 PERFORM gridex_ediel_technical_ack.require_actor_v1(p_company_id,env,p_actor_user_id,p_phase);
 RETURN r;
END$$;
REVOKE ALL ON FUNCTION gridex_ediel_technical_ack.require_actor_v1(uuid,text,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_ediel_technical_ack.require_actor_v1(uuid,text,uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.ediel_read_technical_source_endpoint_v2(uuid,uuid,text),public.ediel_record_technical_syntax_facet_v2(uuid,uuid,text,text,uuid,text),
 public.ediel_capture_technical_syntax_ack_basis_v2(uuid,uuid,uuid,text),public.ediel_require_technical_syntax_ack_basis_v2(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_read_technical_source_endpoint_v2(uuid,uuid,text),public.ediel_record_technical_syntax_facet_v2(uuid,uuid,text,text,uuid,text),
 public.ediel_capture_technical_syntax_ack_basis_v2(uuid,uuid,uuid,text),public.ediel_require_technical_syntax_ack_basis_v2(uuid,uuid,uuid,text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.ediel_read_technical_source_endpoint_v1(uuid),public.ediel_record_technical_syntax_facet_v1(uuid,uuid,text,text),
 public.ediel_capture_technical_syntax_ack_basis_v1(uuid,uuid),public.ediel_require_technical_syntax_ack_basis_v1(uuid,uuid) FROM service_role;
COMMIT;
