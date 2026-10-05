-- Actual Supabase CLI generated forward. Read only technical transport scope.
-- This response never attributes a legal party/market role or grants business.
CREATE FUNCTION gridex_ediel_technical_ack.read_route_v1(c uuid,actor uuid,msg uuid,current_smtp_from text,current_smtp_host text,current_smtp_port integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e jsonb;u jsonb;route public.communication_routes%rowtype;profile public.ediel_route_profiles%rowtype;runtime jsonb;candidate_ids uuid[];candidate_profile_ids uuid[];env text;
BEGIN
 PERFORM cm.user_id FROM public.company_memberships cm WHERE cm.company_id=c AND cm.user_id=actor FOR SHARE;
 PERFORM p.id FROM public.user_profiles p WHERE p.id=actor FOR SHARE;
 IF NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=c AND cm.user_id=actor AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL)
  OR NOT EXISTS(SELECT FROM public.user_profiles p WHERE p.id=actor AND p.user_status='active')
  OR NOT coalesce(public.gridex_actor_has_company_permission(actor,c,'communication.send'),false) THEN RAISE EXCEPTION 'ediel_tenant_actor_forbidden' USING ERRCODE='42501';END IF;
 e:=gridex_ediel_technical_ack.require_source_v1(c,msg);PERFORM gridex_ediel_technical_ack.require_current_endpoint_v1(e);u:=e->'originalUNB';env:=e->>'environment';
 IF current_smtp_from IS NULL OR current_smtp_from!~'^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' OR nullif(current_smtp_host,'') IS NULL OR current_smtp_port NOT BETWEEN 1 AND 65535 THEN RAISE EXCEPTION 'ediel_technical_ack_smtp_account_unqualified';END IF;
 -- Hold the configured candidate universe stable; duplicate matches are held,
 -- never chosen by age, preference, old email or a local role/default APP.
 LOCK TABLE public.communication_routes,public.ediel_route_profiles,public.ediel_transport_profiles IN SHARE MODE;
 SELECT array_agg(r.id),array_agg(p.id) INTO candidate_ids,candidate_profile_ids FROM public.communication_routes r JOIN public.ediel_route_profiles p ON p.communication_route_id=r.id AND p.company_id=r.company_id
 LEFT JOIN public.ediel_transport_profiles tp ON tp.id=p.transport_profile_id AND tp.company_id=c AND tp.environment=env
 WHERE r.company_id=c AND r.is_active AND r.route_scope='ediel_ack'
  AND ((env='production' AND r.environment_type::text='production') OR(env='test' AND r.environment_type::text IN('tgt_test','agt_test','bilateral_test')))
  AND p.environment=env AND p.is_enabled AND p.is_active AND p.message_standard='edifact' AND p.payload_format='edifact'
  AND (p.message_family IS NULL OR p.message_family='CONTRL') AND (p.business_code IS NULL OR p.business_code='CONTRL')
  AND p.sender_ediel_id=u#>>'{receiver,0}' AND p.receiver_ediel_id=u#>>'{sender,0}'
  AND coalesce(p.sender_subaddress,p.sender_sub_address,'')=coalesce(u#>>'{receiver,2}','')
  AND coalesce(p.receiver_subaddress,p.receiver_sub_address,'')=coalesce(u#>>'{sender,2}','')
  AND (p.sender_subaddress IS NULL OR p.sender_sub_address IS NULL OR p.sender_subaddress=p.sender_sub_address)
  AND (p.receiver_subaddress IS NULL OR p.receiver_sub_address IS NULL OR p.receiver_subaddress=p.receiver_sub_address)
  AND p.application_reference IS NOT DISTINCT FROM u->>'applicationReference' AND p.mailbox=current_smtp_from
  AND r.target_email~'^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'
  AND ((p.transport_profile_id IS NULL AND p.smtp_host=current_smtp_host AND p.smtp_port=current_smtp_port)
    OR(tp.id IS NOT NULL AND tp.is_active AND tp.transport_channel='smtp' AND tp.direction IN('outbound','both') AND tp.sender_email=current_smtp_from AND tp.host=current_smtp_host AND tp.port=current_smtp_port
      AND(p.smtp_host IS NULL OR p.smtp_host=current_smtp_host) AND(p.smtp_port IS NULL OR p.smtp_port=current_smtp_port)));
 IF coalesce(cardinality(candidate_ids),0)<>1 THEN RAISE EXCEPTION 'ediel_technical_ack_route_count:%',coalesce(cardinality(candidate_ids),0);END IF;
 -- Read precisely the one named pair selected by that complete locked predicate.
 SELECT * INTO STRICT route FROM public.communication_routes r WHERE r.id=candidate_ids[1] AND r.company_id=c FOR SHARE;
 SELECT * INTO STRICT profile FROM public.ediel_route_profiles p WHERE p.id=candidate_profile_ids[1] AND p.company_id=c FOR SHARE;
 runtime:=to_jsonb(profile)||jsonb_build_object('route_profile_id',profile.id,'communication_route_id',route.id,'route_name',route.route_name,'communication_route_active',route.is_active,'route_scope',route.route_scope,'route_type',route.route_type,'grid_owner_id',route.grid_owner_id,'target_system',route.target_system,'endpoint',route.endpoint,'target_email',route.target_email,'supported_payload_version',route.supported_payload_version,'communication_route_notes',route.notes,'route_profile_notes',profile.notes);
 RETURN jsonb_build_object('kind','technical_syntax_ack_route','companyId',c,'environment',env,'sourceMessageId',msg,'sourceHash',e->>'sourceHash',
  'route',to_jsonb(route)||jsonb_build_object('auth_config','{}'::jsonb),'routeRuntime',runtime,'senderEdielId',u#>>'{receiver,0}','senderQualifier',nullif(u#>>'{receiver,1}',''),'senderSubAddress',nullif(u#>>'{receiver,2}',''),
  'receiverEdielId',u#>>'{sender,0}','receiverQualifier',nullif(u#>>'{sender,1}',''),'receiverSubAddress',nullif(u#>>'{sender,2}',''),'receiverMessageSubAddress',nullif(u#>>'{sender,2}',''),
  'applicationReference',u->>'applicationReference','senderEmail',current_smtp_from,'receiverEmail',route.target_email,'mailbox',current_smtp_from,
  'routeKey',concat('technical_syntax_ack|',route.id,'|',profile.id,'|',env,'|',u->>'applicationReference'),'authorizesBusinessEffect',false);
END $$;
CREATE FUNCTION public.ediel_read_technical_syntax_ack_route_v1(p_company_id uuid,p_actor_user_id uuid,p_source_message_id uuid,p_smtp_from text,p_smtp_host text,p_smtp_port integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501';END IF;
 RETURN gridex_ediel_technical_ack.read_route_v1(p_company_id,p_actor_user_id,p_source_message_id,p_smtp_from,p_smtp_host,p_smtp_port);END $$;
REVOKE ALL ON FUNCTION gridex_ediel_technical_ack.read_route_v1(uuid,uuid,uuid,text,text,integer),public.ediel_read_technical_syntax_ack_route_v1(uuid,uuid,uuid,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION gridex_ediel_technical_ack.read_route_v1(uuid,uuid,uuid,text,text,integer),public.ediel_read_technical_syntax_ack_route_v1(uuid,uuid,uuid,text,text,integer) TO service_role;
