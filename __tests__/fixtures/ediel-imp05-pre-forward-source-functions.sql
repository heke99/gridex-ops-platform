-- Exact pre-forward component inputs; both definitions match admitted main53b3.
-- Retained from authentic Staffcff raw schema as imported at source11975e05,
-- schema SHA256 98e11a05acb6a2e0e879a3400981916a5d0aeaf29bedcd947be947d454cb17bd.
-- Current post-forward definitions remain authoritative in supabase/schema.sql.

CREATE FUNCTION gridex_ediel_technical_ack.select_configured_reply_route_v2(c uuid, e jsonb, reply_family text, current_smtp_from text, current_smtp_host text, current_smtp_port integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $_$
DECLARE u jsonb;msg uuid:=(e->>'sourceMessageId')::uuid;route public.communication_routes%rowtype;profile public.ediel_route_profiles%rowtype;runtime jsonb;candidate_ids uuid[];candidate_profile_ids uuid[];env text;
BEGIN
 IF reply_family IS NULL OR reply_family NOT IN('CONTRL','APERAK') OR e->>'companyId' IS DISTINCT FROM c::text THEN RAISE EXCEPTION 'ediel_prescribed_reply_route_basis_required';END IF;
 PERFORM gridex_ediel_technical_ack.require_current_endpoint_v1(e);u:=e->'originalUNB';env:=e->>'environment';
 IF current_smtp_from IS NULL OR current_smtp_from!~'^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' OR nullif(current_smtp_host,'') IS NULL OR current_smtp_port NOT BETWEEN 1 AND 65535 THEN RAISE EXCEPTION 'ediel_technical_ack_smtp_account_unqualified';END IF;
 -- Hold the configured candidate universe stable; duplicate matches are held,
 -- never chosen by age, preference, old email or a local role/default APP.
 LOCK TABLE public.communication_routes,public.ediel_route_profiles,public.ediel_transport_profiles IN SHARE MODE;
 SELECT array_agg(r.id),array_agg(p.id) INTO candidate_ids,candidate_profile_ids FROM public.communication_routes r JOIN public.ediel_route_profiles p ON p.communication_route_id=r.id AND p.company_id=r.company_id
 LEFT JOIN public.ediel_transport_profiles tp ON tp.id=p.transport_profile_id AND tp.company_id=c AND tp.environment=env
 WHERE r.company_id=c AND r.is_active AND r.route_scope='ediel_ack'
  AND ((env='production' AND r.environment_type::text='production') OR(env='test' AND r.environment_type::text IN('tgt_test','agt_test','bilateral_test')))
  AND p.environment=env AND p.is_enabled AND p.is_active AND p.message_standard='edifact' AND p.payload_format='edifact'
  AND (p.message_family IS NULL OR p.message_family=reply_family) AND (p.business_code IS NULL OR p.business_code=reply_family)
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
 RETURN jsonb_build_object('kind',CASE WHEN reply_family='CONTRL' THEN 'technical_syntax_ack_route' ELSE 'prodat_common_header_negative_ack_route' END,'smtpHost',current_smtp_host,'smtpPort',current_smtp_port,'companyId',c,'environment',env,'sourceMessageId',msg,'sourceHash',e->>'sourceHash',
  'route',to_jsonb(route)||jsonb_build_object('auth_config','{}'::jsonb),'routeRuntime',runtime,'senderEdielId',u#>>'{receiver,0}','senderQualifier',nullif(u#>>'{receiver,1}',''),'senderSubAddress',nullif(u#>>'{receiver,2}',''),
  'receiverEdielId',u#>>'{sender,0}','receiverQualifier',nullif(u#>>'{sender,1}',''),'receiverSubAddress',nullif(u#>>'{sender,2}',''),'receiverMessageSubAddress',nullif(u#>>'{sender,2}',''),
  'applicationReference',u->>'applicationReference','senderEmail',current_smtp_from,'receiverEmail',route.target_email,'mailbox',current_smtp_from,
  'routeKey',concat(lower(reply_family),'_source_reply|',route.id,'|',profile.id,'|',env,'|',u->>'applicationReference'),'authorizesBusinessEffect',false);
END $_$;

CREATE FUNCTION public.ediel_record_inbound_reception_v1(p_company_id uuid, p_message_id uuid, p_actor_user_id uuid, p_inbound_email_message_id uuid, p_parse_result_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE m public.ediel_messages%rowtype;mail public.inbound_email_messages%rowtype;p public.inbound_ediel_parse_results%rowtype;
 box public.ediel_mailboxes%rowtype;prior gridex_ediel_inbound_receptions.receptions%rowtype;r gridex_ediel_inbound_receptions.receptions%rowtype;canonical_hash text;incoming_hash text;kind text;
BEGIN
 PERFORM gridex_ediel_inbound_receptions.authorize_v1(p_company_id,p_actor_user_id,'communication.write');
 IF p_message_id IS NULL OR p_inbound_email_message_id IS NULL OR p_parse_result_id IS NULL THEN RAISE EXCEPTION 'ediel_real_reception_source_required';END IF;
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id FOR UPDATE;
 IF m.id IS NULL OR m.direction IS DISTINCT FROM 'inbound' OR m.message_standard IS DISTINCT FROM 'edifact' OR (m.environment IN('test','production')) IS NOT TRUE OR nullif(m.raw_payload,'') IS NULL THEN RAISE EXCEPTION 'ediel_reception_original_not_owned';END IF;
 -- Serialize the exact retained receipt before its possible held projection;
 -- two different canonical selectors must not both upgrade a shared mail lock.
 SELECT * INTO mail FROM public.inbound_email_messages WHERE id=p_inbound_email_message_id FOR UPDATE;
 SELECT * INTO p FROM public.inbound_ediel_parse_results WHERE id=p_parse_result_id FOR SHARE;
 SELECT * INTO box FROM public.ediel_mailboxes WHERE id=mail.mailbox_id FOR SHARE;
 IF mail.id IS NULL OR p.id IS NULL OR p.inbound_email_message_id IS DISTINCT FROM mail.id OR p.company_id IS DISTINCT FROM p_company_id
  OR (mail.company_id IS NOT NULL AND mail.company_id IS DISTINCT FROM p_company_id)
  OR (mail.environment IS NOT NULL AND mail.environment IS DISTINCT FROM m.environment)
  OR box.id IS NULL OR box.environment IS DISTINCT FROM m.environment
  OR (box.company_id IS NOT NULL AND box.company_id IS DISTINCT FROM p_company_id AND box.is_shared_platform_mailbox IS NOT TRUE)
  OR mail.received_at IS NULL OR nullif(p.raw_payload,'') IS NULL
  OR p.sender_ediel_id IS DISTINCT FROM m.sender_ediel_id OR p.receiver_ediel_id IS DISTINCT FROM m.receiver_ediel_id
  OR p.application_reference IS DISTINCT FROM m.application_reference OR p.interchange_reference IS DISTINCT FROM m.interchange_reference
  OR p.message_family IS DISTINCT FROM m.message_family OR p.message_code IS DISTINCT FROM m.message_code
 THEN RAISE EXCEPTION 'ediel_real_reception_source_scope_required';END IF;
 PERFORM a.id FROM public.inbound_email_attachments a WHERE a.inbound_email_message_id=mail.id ORDER BY a.id FOR SHARE;
 -- The parse must come from the retained actual transport source. An editable
 -- parse projection alone cannot manufacture a new mailbox reception.
 IF NOT(coalesce(position(p.raw_payload IN mail.raw_edifact_payload),0)>0 OR coalesce(position(p.raw_payload IN mail.body_text),0)>0
  OR coalesce(position(p.raw_payload IN mail.raw_email),0)>0 OR EXISTS(SELECT FROM public.inbound_email_attachments a WHERE a.inbound_email_message_id=mail.id AND (a.company_id IS NULL OR a.company_id=p_company_id) AND coalesce(position(p.raw_payload IN a.raw_text),0)>0)) THEN RAISE EXCEPTION 'ediel_reception_retained_transport_bytes_required';END IF;
 canonical_hash:=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex');incoming_hash:=encode(sha256(convert_to(p.raw_payload,'UTF8')),'hex');
 SELECT * INTO prior FROM gridex_ediel_inbound_receptions.receptions WHERE inbound_email_message_id=mail.id FOR SHARE;
 IF prior.id IS NOT NULL THEN
  IF prior.company_id IS DISTINCT FROM p_company_id OR prior.source_message_id IS DISTINCT FROM m.id OR prior.environment IS DISTINCT FROM m.environment
   OR prior.canonical_payload_hash IS DISTINCT FROM canonical_hash OR prior.received_payload_hash IS DISTINCT FROM incoming_hash THEN RAISE EXCEPTION 'ediel_reception_frozen_source_conflict';END IF;
  RETURN gridex_ediel_inbound_receptions.result_v1(prior,true);
 END IF;
 kind:=CASE WHEN incoming_hash IS DISTINCT FROM canonical_hash THEN 'identity_conflict'
  WHEN (m.mailbox_message_id=mail.id::text)
   AND NOT EXISTS(SELECT FROM gridex_ediel_inbound_receptions.receptions old WHERE old.source_message_id=m.id AND old.classification='first_reception') THEN 'first_reception'
  ELSE 'protocol_duplicate' END;
 INSERT INTO gridex_ediel_inbound_receptions.receptions(company_id,source_message_id,inbound_email_message_id,parse_result_id,actor_user_id,environment,canonical_payload_hash,received_payload_hash,received_at,classification,scope,transport_source_snapshot)
 VALUES(p_company_id,m.id,mail.id,p.id,p_actor_user_id,m.environment,canonical_hash,incoming_hash,mail.received_at,kind,jsonb_build_object('sender',p.sender_ediel_id,'receiver',p.receiver_ediel_id,'applicationReference',p.application_reference,'interchangeReference',p.interchange_reference,'family',p.message_family,'code',p.message_code),jsonb_build_object('mailboxId',mail.mailbox_id,'internetMessageId',mail.internet_message_id,'rawMessageSha256',mail.raw_message_sha256,'parsePayloadHash',incoming_hash,'sourceKind','retained_mail_observation','deliveryAuthenticated',false)) RETURNING * INTO r;
 IF kind<>'first_reception' THEN
  INSERT INTO gridex_ediel_inbound_receptions.response_requests(reception_id,company_id,source_message_id,reason) VALUES(r.id,p_company_id,m.id,CASE kind WHEN 'identity_conflict' THEN 'same_identity_different_original_requires_review' ELSE 'authentic_duplicate_transport_response_policy_required' END);
  UPDATE public.inbound_email_messages SET company_id=p_company_id,processing_status='manual_review',match_status='protocol_response_held',error_message='Ny Ediel-mottagning kräver källbelagt protokollsvar.',match_payload=coalesce(match_payload,'{}')||jsonb_build_object('protocolReception',gridex_ediel_inbound_receptions.result_v1(r,false)),updated_at=clock_timestamp() WHERE id=mail.id AND (company_id IS NULL OR company_id=p_company_id);
 END IF;
 RETURN gridex_ediel_inbound_receptions.result_v1(r,false);
END $$;
