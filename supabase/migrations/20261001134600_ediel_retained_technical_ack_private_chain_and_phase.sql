-- Bounded forward: retained technical replies reuse their private captured
-- source and complete native namespace, with explicit current execution phase.
-- Public relation/outcome caches never establish that binding. No backfill.
BEGIN;
CREATE FUNCTION gridex_ediel_technical_ack.retained_source_v1(m public.ediel_messages,complete_chain boolean DEFAULT true) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a jsonb;h jsonb;candidate uuid;ids uuid[]:='{}';source public.ediel_messages%rowtype;keys jsonb;payload_hash text;
BEGIN
 IF m.id IS NULL OR m.company_id IS NULL OR m.direction IS DISTINCT FROM 'outbound' OR m.message_family IS DISTINCT FROM 'CONTRL' OR nullif(m.raw_payload,'') IS NULL THEN RETURN NULL;END IF;
 payload_hash:=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex');
 PERFORM 1 FROM gridex_ediel_wire_namespace.coverage WHERE source_message_id=m.id AND company_id=m.company_id AND environment=m.environment AND payload_sha256=payload_hash FOR SHARE;
 IF NOT FOUND THEN RETURN NULL;END IF;
 a:=gridex_ack_authority.wire_v1(m.raw_payload);
 IF a IS NULL OR a->>'family' IS DISTINCT FROM 'CONTRL' THEN RETURN NULL;END IF;
 FOR source IN SELECT s.* FROM gridex_ediel_technical_ack.sources b JOIN gridex_ediel_technical_ack.replies r USING(source_message_id)
  JOIN public.ediel_messages s ON s.id=b.source_message_id
  WHERE b.status='ready' AND b.company_id=m.company_id AND r.company_id=b.company_id AND b.environment=m.environment AND r.environment=b.environment
   AND s.direction='inbound' AND s.environment=b.environment AND (s.company_id=b.company_id OR s.company_id IS NULL)
   AND b.payload_sha256=r.payload_sha256 AND b.payload_sha256=encode(sha256(convert_to(s.raw_payload,'UTF8')),'hex')
  ORDER BY s.id FOR SHARE OF b,r,s LOOP
  h:=gridex_ediel_technical_ack.envelope(source.raw_payload);
  IF h IS NOT NULL AND a->'sender'=h->'receiver' AND a->'receiver'=h->'sender' AND a->>'environment'=h->>'environment'
   AND a->>'app'=h->>'applicationReference' AND a->>'uciRef'=h->>'uciReference' AND a->'uciSender'=h->'sender' AND a->'uciReceiver'=h->'receiver'
   AND EXISTS(SELECT FROM gridex_ediel_technical_ack.replies r WHERE r.source_message_id=source.id AND r.evidence->'originalUNB'=h
    AND r.evidence->>'syntaxDecision' IN('accepted','rejected') AND a->>'uciAction'=CASE r.evidence->>'syntaxDecision' WHEN 'accepted' THEN '1' ELSE '4' END)
  THEN ids:=array_append(ids,source.id);END IF;
 END LOOP;
 IF cardinality(ids)>1 THEN RAISE EXCEPTION 'ediel_technical_ack_original_ambiguous';END IF;
 candidate:=ids[1];IF candidate IS NULL OR NOT complete_chain THEN RETURN candidate;END IF;
 IF m.immutable_rendered_at IS NULL OR m.immutable_payload_hash IS DISTINCT FROM payload_hash THEN RETURN NULL;END IF;
 keys:=gridex_ediel_wire_namespace.keys(m.raw_payload);
 PERFORM 1 FROM gridex_ediel_wire_namespace.reservations r WHERE r.source_message_id=m.id ORDER BY r.environment,r.sender_namespace,r.application_namespace,r.reference_kind,r.wire_reference FOR SHARE;
 IF EXISTS(SELECT FROM jsonb_array_elements(keys)k WHERE NOT EXISTS(SELECT FROM gridex_ediel_wire_namespace.reservations r
  WHERE r.environment=m.environment AND r.sender_namespace=k->>'sender' AND r.application_namespace=k->>'application' AND r.reference_kind=k->>'kind'
   AND r.wire_reference=k->>'value' AND r.source_message_id=m.id AND r.company_id=m.company_id AND r.first_payload_sha256=payload_hash)) THEN RETURN NULL;END IF;
 RETURN candidate;
END$$;
REVOKE ALL ON FUNCTION gridex_ediel_technical_ack.retained_source_v1(public.ediel_messages,boolean) FROM PUBLIC,anon,authenticated,service_role;

DO $technical_source_projection$ DECLARE definition text;body text;needle text;BEGIN
 definition:=pg_get_functiondef('gridex_ediel_technical_ack.require_contrl_v1(public.ediel_messages)'::regprocedure);
 SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid='gridex_ediel_technical_ack.require_contrl_v1(public.ediel_messages)'::regprocedure;
 needle:=' IF m.direction IS DISTINCT FROM ''outbound'' OR m.message_family IS DISTINCT FROM ''CONTRL'' OR m.related_message_id IS NULL THEN';
 IF position(needle IN body)=0 OR position('ediel_technical_ack_original_ambiguous' IN body)=0 THEN RAISE EXCEPTION 'ediel_retained_contrl_validator_shape_changed';END IF;
 body:=replace(body,needle,$projection$ IF EXISTS(SELECT FROM public.ediel_messages own WHERE own.id=m.id AND own.company_id=m.company_id AND own.environment=m.environment AND own.direction='outbound' AND own.message_family='CONTRL' AND own.raw_payload=m.raw_payload) THEN
  m.related_message_id:=gridex_ediel_technical_ack.retained_source_v1(m,true);
  IF m.related_message_id IS NULL THEN RAISE EXCEPTION 'ediel_historical_technical_ack_private_chain_unavailable';END IF;
 END IF;
$projection$||needle);
 EXECUTE replace(definition,(SELECT prosrc FROM pg_proc WHERE oid='gridex_ediel_technical_ack.require_contrl_v1(public.ediel_messages)'::regprocedure),body);
END $technical_source_projection$;
DO $technical_candidates$ DECLARE definition text;body text;needle text;BEGIN
 definition:=pg_get_functiondef('gridex_ack_authority.read_outbound_originals_v1(uuid,text)'::regprocedure);
 SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid='gridex_ack_authority.read_outbound_originals_v1(uuid,text)'::regprocedure;
 needle:='ORDER BY m.created_at,m.id LOOP';
 IF position('gridex_ediel_ack_replay.creation_receipts' IN body)=0 OR position(needle IN body)=0 THEN RAISE EXCEPTION 'ediel_retained_contrl_discovery_shape_changed';END IF;
 body:=replace(body,') '||needle,' OR (p_family=''CONTRL'' AND gridex_ediel_technical_ack.retained_source_v1(m,false)=source.id)) '||needle);
 needle:='qualified:=technical.company_id IS NOT DISTINCT FROM company';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'ediel_retained_contrl_qualification_shape_changed';END IF;
 body:=replace(body,needle,'qualified:=gridex_ediel_technical_ack.retained_source_v1(ack,true)=source.id AND technical.company_id IS NOT DISTINCT FROM company');
 EXECUTE replace(definition,(SELECT prosrc FROM pg_proc WHERE oid='gridex_ack_authority.read_outbound_originals_v1(uuid,text)'::regprocedure),body);
END $technical_candidates$;
DO $explicit_send$ DECLARE definition text;body text;needle text;BEGIN
 definition:=pg_get_functiondef('gridex_ediel_duplicate_responses.require_business_read_actor_v1(uuid,uuid,text)'::regprocedure);
 SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid='gridex_ediel_duplicate_responses.require_business_read_actor_v1(uuid,uuid,text)'::regprocedure;
 needle:='public.gridex_actor_has_company_permission(actor,c,CASE phase WHEN ''prepare'' THEN ''communication.write'' ELSE ''communication.read'' END) IS NOT TRUE';
 IF position(needle IN body)=0 OR position('phase NOT IN(''prepare'',''read'')' IN body)=0 THEN RAISE EXCEPTION 'ediel_ack_current_phase_shape_changed';END IF;
 body:=replace(body,'phase NOT IN(''prepare'',''read'')','phase NOT IN(''prepare'',''read'',''send'')');
 body:=replace(body,needle,$phase$(CASE phase WHEN 'prepare' THEN public.gridex_actor_has_company_permission(actor,c,'communication.write') IS TRUE
 WHEN 'read' THEN public.gridex_actor_has_company_permission(actor,c,'communication.read') IS TRUE
 WHEN 'send' THEN public.gridex_actor_has_company_permission(actor,c,'communication.send') IS TRUE OR public.gridex_actor_has_company_permission(actor,c,'ediel.send') IS TRUE ELSE false END) IS NOT TRUE$phase$);
 EXECUTE replace(definition,(SELECT prosrc FROM pg_proc WHERE oid='gridex_ediel_duplicate_responses.require_business_read_actor_v1(uuid,uuid,text)'::regprocedure),body);
 definition:=pg_get_functiondef('gridex_ediel_duplicate_responses.read_business_original_v1(uuid,text,uuid,uuid,text,uuid,text)'::regprocedure);
 SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid='gridex_ediel_duplicate_responses.read_business_original_v1(uuid,text,uuid,uuid,text,uuid,text)'::regprocedure;
 needle:=$guard$IF public.gridex_actor_has_company_permission(actor,c,CASE phase WHEN 'prepare' THEN 'communication.write' WHEN 'read' THEN 'communication.read' END) IS NOT TRUE THEN
  RAISE EXCEPTION 'ediel_ack_replay_actor_not_authorized' USING ERRCODE='42501';END IF;$guard$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'ediel_ack_common_phase_shape_changed';END IF;
 body:=replace(body,needle,'PERFORM gridex_ediel_duplicate_responses.require_business_read_actor_v1(c,actor,phase);');
 EXECUTE replace(definition,(SELECT prosrc FROM pg_proc WHERE oid='gridex_ediel_duplicate_responses.read_business_original_v1(uuid,text,uuid,uuid,text,uuid,text)'::regprocedure),body);
END $explicit_send$;
-- V1 remains a source-provenance compatibility read. It carries no current
-- actor/phase authority. Every executing TS consumer uses V2 below.
DO $compatibility_projection$ DECLARE definition text;body text;needle text;BEGIN
 definition:=pg_get_functiondef('gridex_ediel_technical_ack.read_persisted_contrl_v1(uuid,text,uuid)'::regprocedure);
 SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid='gridex_ediel_technical_ack.read_persisted_contrl_v1(uuid,text,uuid)'::regprocedure;
 needle:='e:=gridex_ediel_technical_ack.require_contrl_v1(m);';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'ediel_persisted_contrl_compatibility_shape_changed';END IF;
 body:=replace(body,needle,'m.related_message_id:=gridex_ediel_technical_ack.retained_source_v1(m,true);'||chr(10)||' '||needle);
 body:=replace(body,'''version'',1,''ackMessage''','''version'',1,''authorizesExecution'',false,''ackMessage''');
 EXECUTE replace(definition,(SELECT prosrc FROM pg_proc WHERE oid='gridex_ediel_technical_ack.read_persisted_contrl_v1(uuid,text,uuid)'::regprocedure),body);
END $compatibility_projection$;
CREATE FUNCTION gridex_ediel_technical_ack.read_persisted_contrl_v2(c uuid,env text,ack_id uuid,actor uuid,phase text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;source_id uuid;owned jsonb;e jsonb;BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();PERFORM gridex_bilateral_prodat.lock_source_receipts_v1();
 PERFORM gridex_ediel_duplicate_responses.require_business_read_actor_v1(c,actor,phase);
 SELECT * INTO m FROM public.ediel_messages WHERE id=ack_id AND company_id=c AND environment=env AND direction='outbound' AND message_family='CONTRL' FOR SHARE;
 IF m.id IS NULL THEN RAISE EXCEPTION 'ediel_technical_ack_basis_required';END IF;
 source_id:=gridex_ediel_technical_ack.retained_source_v1(m,true);
 IF source_id IS NULL THEN RAISE EXCEPTION 'ediel_historical_technical_ack_private_chain_unavailable';END IF;
 owned:=gridex_ediel_duplicate_responses.read_business_original_v1(c,env,source_id,actor,'CONTRL',m.id,phase);
 m:=jsonb_populate_record(NULL::public.ediel_messages,owned->'ackMessage');e:=gridex_ediel_technical_ack.require_contrl_v1(m);
 PERFORM gridex_ediel_duplicate_responses.read_business_original_v1(c,env,source_id,actor,'CONTRL',m.id,phase);
 PERFORM gridex_ediel_duplicate_responses.require_business_read_actor_v1(c,actor,phase);
 RETURN jsonb_build_object('version',2,'executionActorUserId',actor,'executionPhase',phase,'ackMessage',to_jsonb(m),'technicalSyntaxAckEvidence',e);
END$$;
CREATE FUNCTION public.ediel_read_persisted_technical_contrl_basis_v2(p_company_id uuid,p_environment text,p_ack_message_id uuid,p_actor_user_id uuid,p_phase text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501';END IF;
 RETURN gridex_ediel_technical_ack.read_persisted_contrl_v2(p_company_id,p_environment,p_ack_message_id,p_actor_user_id,p_phase);END$$;
CREATE FUNCTION public.gridex_read_outbound_acks_for_source_v2(p_source_message_id uuid,p_ack_family text,p_actor_user_id uuid,p_phase text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s public.ediel_messages%rowtype;basis jsonb;entry jsonb;owned jsonb;items jsonb:='[]';c uuid;BEGIN
 PERFORM gridex_prodat_object_batch.require_service_v1();PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();PERFORM gridex_bilateral_prodat.lock_source_receipts_v1();
 SELECT * INTO s FROM public.ediel_messages WHERE id=p_source_message_id AND direction='inbound' FOR SHARE;
 IF s.id IS NULL THEN RAISE EXCEPTION 'ack_original_inbound_source_required';END IF;
 basis:=gridex_ack_authority.read_outbound_originals_v1(s.id,p_ack_family);c:=(basis->>'companyId')::uuid;
 PERFORM gridex_ediel_duplicate_responses.read_business_original_v1(c,s.environment,s.id,p_actor_user_id,p_ack_family,NULL,p_phase);
 FOR entry IN SELECT x FROM jsonb_array_elements(basis->'originals')x LOOP
  IF entry->>'status' IS DISTINCT FROM 'qualified' THEN RAISE EXCEPTION 'ediel_historical_ack_scope_basis_unavailable';END IF;
  owned:=gridex_ediel_duplicate_responses.read_business_original_v1(c,s.environment,s.id,p_actor_user_id,p_ack_family,(entry#>>'{message,id}')::uuid,p_phase);
  IF owned IS NULL THEN RAISE EXCEPTION 'ediel_historical_ack_scope_basis_unavailable';END IF;
  items:=items||jsonb_build_array(entry||jsonb_build_object('message',owned->'ackMessage'));
 END LOOP;
 -- Recheck every returned own original after the last possible inner wait.
 FOR entry IN SELECT x FROM jsonb_array_elements(items)x LOOP
  PERFORM gridex_ediel_duplicate_responses.read_business_original_v1(c,s.environment,s.id,p_actor_user_id,p_ack_family,(entry#>>'{message,id}')::uuid,p_phase);
 END LOOP;
 PERFORM gridex_ediel_duplicate_responses.read_business_original_v1(c,s.environment,s.id,p_actor_user_id,p_ack_family,NULL,p_phase);
 RETURN basis||jsonb_build_object('version',2,'executionActorUserId',p_actor_user_id,'executionPhase',p_phase,'originals',items);
END$$;
REVOKE ALL ON FUNCTION gridex_ediel_technical_ack.read_persisted_contrl_v2(uuid,text,uuid,uuid,text),public.ediel_read_persisted_technical_contrl_basis_v2(uuid,text,uuid,uuid,text),public.gridex_read_outbound_acks_for_source_v2(uuid,text,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_ediel_technical_ack.read_persisted_contrl_v2(uuid,text,uuid,uuid,text),public.ediel_read_persisted_technical_contrl_basis_v2(uuid,text,uuid,uuid,text),public.gridex_read_outbound_acks_for_source_v2(uuid,text,uuid,text) TO service_role;
COMMIT;
