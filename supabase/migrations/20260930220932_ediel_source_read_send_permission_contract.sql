-- Match the actual external-send action contract on current executors.
-- The private immutable accepted_source_basis_v1 remains untouched and has
-- no dependency on any historical preparer's current account or permissions.
BEGIN;
CREATE OR REPLACE FUNCTION public.gridex_ediel_accepted_transport_projection_v1(p_company_id uuid,p_environment text,p_actor_user_id uuid,p_message_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
DECLARE m public.ediel_messages%rowtype; candidates jsonb; candidate jsonb; binding jsonb; provider jsonb; plan jsonb; recipient text; original_hash text;
BEGIN
 IF p_company_id IS NULL OR p_actor_user_id IS NULL OR p_message_id IS NULL OR (p_environment IN ('test','production')) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_accepted_projection_scope_required';END IF;
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 PERFORM cm.id FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id FOR SHARE;
 IF NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active') OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL) OR (public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'ediel.send') OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.send')) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_accepted_projection_actor_forbidden' USING ERRCODE='42501';END IF;
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE company_id=p_company_id AND environment=p_environment AND id=p_message_id AND direction='outbound' FOR SHARE;
 RETURN gridex_ediel_transport.accepted_source_basis_v1(m);
END $$;

CREATE OR REPLACE FUNCTION public.gridex_ediel_repair_accepted_transport_projection_v1(p_company_id uuid,p_environment text,p_actor_user_id uuid,p_message_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
DECLARE m public.ediel_messages%rowtype; projection jsonb; resulting_status text;
BEGIN
 IF p_company_id IS NULL OR p_actor_user_id IS NULL OR p_message_id IS NULL OR (p_environment IN ('test','production')) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_accepted_projection_scope_required';END IF;
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 PERFORM cm.user_id FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id FOR SHARE;
 IF NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active') OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL) OR (public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'ediel.send') OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.send')) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_accepted_projection_actor_forbidden' USING ERRCODE='42501';END IF;
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE company_id=p_company_id AND environment=p_environment AND id=p_message_id AND direction='outbound' FOR UPDATE;
 projection:=public.gridex_ediel_accepted_transport_projection_v1(p_company_id,p_environment,p_actor_user_id,p_message_id);
 IF projection IS NULL THEN RETURN NULL;END IF;
 UPDATE public.ediel_messages SET
  status=CASE WHEN status IN ('draft','prepared','queued','dispatching','provider_accepted','sent') THEN 'sent' ELSE status END,
  processing_status=CASE WHEN processing_status IS NULL OR processing_status IN ('draft','prepared','queued','dispatching','provider_accepted','sent') THEN 'sent' ELSE processing_status END,
  message_sent_at=(projection->>'observedAt')::timestamptz,updated_by=p_actor_user_id,updated_at=now()
 WHERE id=p_message_id AND company_id=p_company_id AND environment=p_environment RETURNING status INTO resulting_status;
 RETURN projection||jsonb_build_object('projectionStatus',resulting_status);
END $$;

CREATE OR REPLACE FUNCTION public.ediel_brp_change_message_basis_v1(p_company_id uuid,p_message_id uuid,p_actor_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o gridex_brp_changes.origins%rowtype;
b jsonb;

BEGIN PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
PERFORM m.user_id FROM public.company_memberships m WHERE m.company_id=p_company_id
  AND m.user_id=p_actor_user_id FOR SHARE;
IF p_company_id IS NULL
  OR p_actor_user_id IS NULL
  OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id
  AND u.user_status='active')
  OR NOT EXISTS(SELECT FROM public.company_memberships m WHERE m.company_id=p_company_id
  AND m.user_id=p_actor_user_id
  AND m.status='active'
  AND m.is_active
  AND m.accepted_at IS NOT NULL)
  OR (public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'ediel.send') OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.send')) IS NOT TRUE THEN RAISE EXCEPTION 'brp_message_actor_forbidden' USING ERRCODE='42501';
END IF;
SELECT * INTO o FROM gridex_brp_changes.origins WHERE company_id=p_company_id
  AND message_id=p_message_id;
IF NOT FOUND THEN RETURN NULL;
END IF;
b:=gridex_brp_changes.context_v1(o.company_id,o.event_id,o.actor_user_id);
IF b IS DISTINCT FROM o.basis THEN RETURN jsonb_build_object('status','held','missing',ARRAY['brp_change_current_source_changed']);
END IF;
PERFORM public.ediel_require_brp_change_source_current_v1(p_company_id,p_message_id);
RETURN jsonb_build_object('basis',b,'intentId',o.intent_id,'actorUserId',o.actor_user_id);
END$$;

CREATE OR REPLACE FUNCTION public.ediel_service_permission_message_basis_v1(p_company_id uuid,p_message_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s gridex_service_permission.origins%rowtype;
BEGIN
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 PERFORM m.user_id FROM public.company_memberships m WHERE m.company_id=p_company_id AND m.user_id=p_actor_user_id FOR SHARE;
 IF NOT EXISTS(SELECT FROM public.company_memberships m WHERE m.company_id=p_company_id AND m.user_id=p_actor_user_id AND m.status='active' AND m.is_active AND m.accepted_at IS NOT NULL) OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active') OR (public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'ediel.send') OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.send')) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_permission_origin_message_forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM gridex_service_permission.origins WHERE company_id=p_company_id AND message_id=p_message_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'ediel_permission_origin_message_unbound'; END IF;
 PERFORM public.ediel_require_service_permission_origin_current_v1(p_company_id,p_message_id);
 RETURN jsonb_build_object('basis',s.basis,'actorUserId',s.actor_user_id,'intentId',s.intent_id);
END $$;

REVOKE ALL ON FUNCTION public.gridex_ediel_accepted_transport_projection_v1(uuid,text,uuid,uuid),public.gridex_ediel_repair_accepted_transport_projection_v1(uuid,text,uuid,uuid),public.ediel_brp_change_message_basis_v1(uuid,uuid,uuid),public.ediel_service_permission_message_basis_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_ediel_accepted_transport_projection_v1(uuid,text,uuid,uuid),public.gridex_ediel_repair_accepted_transport_projection_v1(uuid,text,uuid,uuid),public.ediel_brp_change_message_basis_v1(uuid,uuid,uuid),public.ediel_service_permission_message_basis_v1(uuid,uuid,uuid) TO service_role;
COMMIT;
