-- Actual CLI forward: one configured transport predicate, distinct source caps.
BEGIN;
CREATE FUNCTION gridex_ediel_technical_ack.select_configured_reply_route_v2(c uuid,e jsonb,reply_family text,current_smtp_from text,current_smtp_host text,current_smtp_port integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
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
END $$;

CREATE OR REPLACE FUNCTION gridex_ediel_technical_ack.read_route_v1(c uuid,actor uuid,msg uuid,current_smtp_from text,current_smtp_host text,current_smtp_port integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE e jsonb;BEGIN
 e:=gridex_ediel_technical_ack.require_source_v1(c,msg);
 IF e->>'environment'='test' THEN PERFORM gridex_negative_fixtures.assert_prepare_actor_v1(actor,c);ELSE PERFORM gridex_negative_fixtures.assert_actor_v1(actor,c,'communication.write');END IF;
 RETURN gridex_ediel_technical_ack.select_configured_reply_route_v2(c,e,'CONTRL',current_smtp_from,current_smtp_host,current_smtp_port);END $$;
CREATE FUNCTION gridex_ediel_common_header.read_negative_route_v1(c uuid,actor uuid,msg uuid,current_smtp_from text,current_smtp_host text,current_smtp_port integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE e jsonb;t jsonb;BEGIN
 t:=gridex_ediel_technical_ack.require_source_v1(c,msg);e:=gridex_ediel_common_header.require_v1(c,t->>'environment',msg);
 IF e->>'environment'='test' THEN PERFORM gridex_negative_fixtures.assert_prepare_actor_v1(actor,c);ELSE PERFORM gridex_negative_fixtures.assert_actor_v1(actor,c,'communication.write');END IF;
 PERFORM gridex_ediel_common_header.require_current_scope_v1(e);
 IF t->>'sourceHash' IS DISTINCT FROM e->>'sourceHash' OR t->>'syntaxAssessmentId' IS DISTINCT FROM e->>'syntaxAssessmentId' THEN RAISE EXCEPTION 'ediel_common_header_route_basis_mismatch';END IF;
 RETURN gridex_ediel_technical_ack.select_configured_reply_route_v2(c,t,'APERAK',current_smtp_from,current_smtp_host,current_smtp_port);END $$;
CREATE FUNCTION public.ediel_read_common_header_negative_ack_route_v1(p_company_id uuid,p_actor_user_id uuid,p_source_message_id uuid,p_smtp_from text,p_smtp_host text,p_smtp_port integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$BEGIN IF current_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required';END IF;
 RETURN gridex_ediel_common_header.read_negative_route_v1(p_company_id,p_actor_user_id,p_source_message_id,p_smtp_from,p_smtp_host,p_smtp_port);END $$;
CREATE TABLE gridex_ediel_common_header.negative_route_bindings(
 witness_id uuid PRIMARY KEY REFERENCES gridex_ediel_common_header.negative_witnesses(id),route jsonb NOT NULL
);
ALTER TABLE gridex_ediel_common_header.negative_route_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_ediel_common_header.negative_route_bindings FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE gridex_ediel_common_header.negative_route_bindings FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_route BEFORE UPDATE OR DELETE ON gridex_ediel_common_header.negative_route_bindings FOR EACH ROW EXECUTE FUNCTION gridex_ediel_common_header.immutable();
CREATE TRIGGER immutable_route_truncate BEFORE TRUNCATE ON gridex_ediel_common_header.negative_route_bindings FOR EACH STATEMENT EXECUTE FUNCTION gridex_ediel_common_header.immutable();
CREATE FUNCTION gridex_ediel_common_header.prepare_with_route_v2(c uuid,env text,msg uuid,actor uuid,raw text,smtp_from text,smtp_host text,smtp_port integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE e jsonb;r jsonb;m public.ediel_messages%rowtype;token uuid;BEGIN
 e:=gridex_ediel_common_header.require_v1(c,env,msg);r:=gridex_ediel_common_header.read_negative_route_v1(c,actor,msg,smtp_from,smtp_host,smtp_port);
 m.company_id:=c;m.environment:=env;m.related_message_id:=msg;m.direction:='outbound';m.message_family:='APERAK';m.message_code:='APERAK';m.raw_payload:=raw;
 PERFORM gridex_ediel_common_header.assert_ack_v1(m,e);PERFORM gridex_ediel_ack_guide.bind_source_v1(source,'common',e) FROM public.ediel_messages source WHERE source.id=msg;
 INSERT INTO gridex_ediel_common_header.negative_witnesses(company_id,environment,source_message_id,actor_user_id,payload_sha256,evidence) VALUES(c,env,msg,actor,encode(sha256(convert_to(raw,'UTF8')),'hex'),e) RETURNING id INTO token;
 INSERT INTO gridex_ediel_common_header.negative_route_bindings VALUES(token,r);
 RETURN jsonb_build_object('witnessId',token,'evidence',e);END $$;
CREATE FUNCTION public.ediel_prepare_common_header_negative_ack_v2(p_company_id uuid,p_environment text,p_source_message_id uuid,p_actor_user_id uuid,p_raw_payload text,p_smtp_from text,p_smtp_host text,p_smtp_port integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$BEGIN IF current_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required';END IF;
 RETURN gridex_ediel_common_header.prepare_with_route_v2(p_company_id,p_environment,p_source_message_id,p_actor_user_id,p_raw_payload,p_smtp_from,p_smtp_host,p_smtp_port);END $$;
ALTER FUNCTION gridex_ediel_common_header.witness_v1(public.ediel_messages) RENAME TO witness_before_route_v1;
CREATE FUNCTION gridex_ediel_common_header.witness_v1(m public.ediel_messages) RETURNS gridex_ediel_common_header.negative_witnesses
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE w gridex_ediel_common_header.negative_witnesses%rowtype;r jsonb;current_route jsonb;t jsonb;BEGIN
 w:=gridex_ediel_common_header.witness_before_route_v1(m);
 SELECT route INTO r FROM gridex_ediel_common_header.negative_route_bindings WHERE witness_id=w.id;
 IF r IS NULL OR m.communication_route_id::text IS DISTINCT FROM r#>>'{route,id}' OR m.route_profile_id::text IS DISTINCT FROM r#>>'{routeRuntime,route_profile_id}'
  OR m.sender_email IS DISTINCT FROM r->>'senderEmail' OR m.receiver_email IS DISTINCT FROM r->>'receiverEmail' OR m.mailbox IS DISTINCT FROM r->>'mailbox'
  OR m.sender_ediel_id IS DISTINCT FROM r->>'senderEdielId' OR m.receiver_ediel_id IS DISTINCT FROM r->>'receiverEdielId'
  OR coalesce(m.sender_sub_address,'') IS DISTINCT FROM coalesce(r->>'senderSubAddress','') OR coalesce(m.receiver_sub_address,'') IS DISTINCT FROM coalesce(r->>'receiverSubAddress','')
  OR m.application_reference IS DISTINCT FROM r->>'applicationReference' THEN RAISE EXCEPTION 'ediel_common_header_negative_route_binding_required';END IF;
 t:=gridex_ediel_technical_ack.require_source_v1(w.company_id,w.source_message_id);PERFORM gridex_ediel_common_header.require_current_scope_v1(w.evidence);
 current_route:=gridex_ediel_technical_ack.select_configured_reply_route_v2(w.company_id,t,'APERAK',r->>'senderEmail',r->>'smtpHost',(r->>'smtpPort')::integer);
 IF current_route IS DISTINCT FROM r THEN RAISE EXCEPTION 'ediel_common_header_negative_current_route_required';END IF;
 RETURN w;END $$;
REVOKE ALL ON FUNCTION gridex_ediel_technical_ack.select_configured_reply_route_v2(uuid,jsonb,text,text,text,integer),gridex_ediel_common_header.read_negative_route_v1(uuid,uuid,uuid,text,text,integer),gridex_ediel_common_header.prepare_with_route_v2(uuid,text,uuid,uuid,text,text,text,integer),gridex_ediel_common_header.witness_before_route_v1(public.ediel_messages),gridex_ediel_common_header.witness_v1(public.ediel_messages),public.ediel_read_common_header_negative_ack_route_v1(uuid,uuid,uuid,text,text,integer),public.ediel_prepare_common_header_negative_ack_v2(uuid,text,uuid,uuid,text,text,text,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_ediel_common_header.read_negative_route_v1(uuid,uuid,uuid,text,text,integer),gridex_ediel_common_header.prepare_with_route_v2(uuid,text,uuid,uuid,text,text,text,integer),public.ediel_read_common_header_negative_ack_route_v1(uuid,uuid,uuid,text,text,integer),public.ediel_prepare_common_header_negative_ack_v2(uuid,text,uuid,uuid,text,text,text,integer) TO service_role;
COMMIT;
