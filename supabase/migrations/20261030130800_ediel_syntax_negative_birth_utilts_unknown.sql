-- Retained-mail syntax negative birth for UTILTS without BGM (UTILTS_UNKNOWN).
-- The existing assigned PRODAT header-negative custody is generalised through an
-- EXPLICIT allowlist: PRODAT (unchanged) and UTILTS/UTILTS_UNKNOWN whose actual
-- wire lacks the mandatory BGM segment. No wildcard, no rule pack, no business
-- FK, no APERAK/common-header source and no business effect is granted. The born
-- original only lets the existing technical syntax path send its negative CONTRL.
BEGIN;

CREATE FUNCTION gridex_ediel_header_negative_birth.classify_utilts_missing_bgm_v1(raw text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE t jsonb:=gridex_utilts_binding.wire_tokens_v1(raw);u jsonb:=gridex_ediel_technical_ack.envelope(raw);h jsonb;trailer jsonb;end_interchange jsonb;
BEGIN
 IF raw IS NULL OR t IS NULL OR u IS NULL OR octet_length(raw)>262144
  OR EXISTS(SELECT FROM unnest(ARRAY['UNB','UNH','UNT','UNZ'])tag WHERE (SELECT count(*) FROM jsonb_array_elements(t)x WHERE x->>'tag'=tag)<>1)
  OR EXISTS(SELECT FROM jsonb_array_elements(t)x WHERE x->>'tag'='BGM') THEN RETURN NULL;END IF;
 SELECT x INTO h FROM jsonb_array_elements(t)x WHERE x->>'tag'='UNH';SELECT x INTO trailer FROM jsonb_array_elements(t)x WHERE x->>'tag'='UNT';SELECT x INTO end_interchange FROM jsonb_array_elements(t)x WHERE x->>'tag'='UNZ';
 IF (h->>'index')::int<>1 OR (trailer->>'index')::int<>jsonb_array_length(t)-2 OR (end_interchange->>'index')::int<>jsonb_array_length(t)-1
  OR h#>>'{elements,2,0}' IS DISTINCT FROM 'UTILTS'
  OR nullif(h#>>'{elements,1,0}','') IS NULL OR length(h#>>'{elements,1,0}')>14
  OR trailer#>>'{elements,2,0}' IS DISTINCT FROM h#>>'{elements,1,0}'
  OR nullif(u->>'interchangeReference','') IS NULL OR end_interchange#>>'{elements,2,0}' IS DISTINCT FROM u->>'interchangeReference' THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('syntaxError','mandatory_segment_missing','missingSegment','BGM','parsedFamily','UTILTS','parsedCode','UTILTS_UNKNOWN',
  'originalUNB',u,'messageReference',h#>>'{elements,1,0}','technicalType',h#>'{elements,2}');
END $$;

CREATE FUNCTION gridex_ediel_header_negative_birth.create_utilts_missing_bgm_v1(c uuid,env text,actor uuid,mail_id uuid,parse_id uuid,expected_raw text,expected_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE mail public.inbound_email_messages%rowtype;p public.inbound_ediel_parse_results%rowtype;box public.ediel_mailboxes%rowtype;m public.ediel_messages%rowtype;r gridex_ediel_header_negative_birth.receipts%rowtype;
 observed timestamptz;classification jsonb;e jsonb;facts jsonb;reception jsonb;
BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();PERFORM gridex_ediel_inbound_receptions.authorize_v1(c,actor,'communication.write');
 IF env IS NULL OR env NOT IN('test','production') OR mail_id IS NULL OR parse_id IS NULL OR expected_raw IS NULL OR expected_hash IS NULL OR expected_hash IS DISTINCT FROM encode(sha256(convert_to(expected_raw,'UTF8')),'hex') THEN RAISE EXCEPTION 'utilts_syntax_negative_expected_original_required' USING ERRCODE='23514';END IF;
 SELECT * INTO mail FROM public.inbound_email_messages WHERE id=mail_id FOR UPDATE;SELECT * INTO p FROM public.inbound_ediel_parse_results WHERE id=parse_id FOR SHARE;SELECT * INTO box FROM public.ediel_mailboxes WHERE id=mail.mailbox_id FOR SHARE;
 IF mail.id IS NULL OR mail.company_id IS DISTINCT FROM c OR mail.environment IS DISTINCT FROM env OR mail.received_at IS NULL OR p.id IS NULL OR p.company_id IS DISTINCT FROM c OR p.inbound_email_message_id IS DISTINCT FROM mail.id OR p.raw_payload IS DISTINCT FROM expected_raw
  OR box.id IS NULL OR box.environment IS DISTINCT FROM env OR box.is_active IS NOT TRUE OR (box.company_id IS DISTINCT FROM c AND box.is_shared_platform_mailbox IS NOT TRUE)
  OR box.email_address IS NULL OR btrim(box.email_address)!~'^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' THEN RAISE EXCEPTION 'utilts_syntax_negative_retained_ingress_required' USING ERRCODE='23514';END IF;
 PERFORM a.id FROM public.inbound_email_attachments a WHERE a.inbound_email_message_id=mail.id ORDER BY a.id FOR SHARE;
 IF NOT(coalesce(position(p.raw_payload IN mail.raw_edifact_payload),0)>0 OR coalesce(position(p.raw_payload IN mail.body_text),0)>0 OR coalesce(position(p.raw_payload IN mail.raw_email),0)>0 OR EXISTS(SELECT FROM public.inbound_email_attachments a WHERE a.inbound_email_message_id=mail.id AND(a.company_id IS NULL OR a.company_id=c) AND coalesce(position(p.raw_payload IN a.raw_text),0)>0)) THEN RAISE EXCEPTION 'utilts_syntax_negative_retained_bytes_required' USING ERRCODE='23514';END IF;
 classification:=gridex_ediel_header_negative_birth.classify_utilts_missing_bgm_v1(expected_raw);
 IF classification IS NULL OR classification#>>'{originalUNB,environment}' IS DISTINCT FROM env OR p.message_family IS DISTINCT FROM 'UTILTS' OR p.message_code IS DISTINCT FROM 'UTILTS_UNKNOWN'
  OR p.sender_sub_address IS DISTINCT FROM nullif(classification#>>'{originalUNB,sender,2}','') OR p.receiver_sub_address IS DISTINCT FROM nullif(classification#>>'{originalUNB,receiver,2}','')
  OR p.application_reference IS DISTINCT FROM nullif(classification#>>'{originalUNB,applicationReference}','') OR p.sender_ediel_id IS DISTINCT FROM classification#>>'{originalUNB,sender,0}' OR p.receiver_ediel_id IS DISTINCT FROM classification#>>'{originalUNB,receiver,0}' OR p.interchange_reference IS DISTINCT FROM classification#>>'{originalUNB,interchangeReference}' THEN RAISE EXCEPTION 'utilts_syntax_negative_exact_classification_required' USING ERRCODE='23514';END IF;
 SELECT * INTO r FROM gridex_ediel_header_negative_birth.receipts WHERE inbound_email_message_id=mail_id FOR SHARE;
 IF r.source_message_id IS NOT NULL THEN
  SELECT * INTO m FROM public.ediel_messages WHERE id=r.source_message_id FOR SHARE;
  IF r.company_id IS DISTINCT FROM c OR r.environment IS DISTINCT FROM env OR r.actor_user_id IS DISTINCT FROM actor OR r.parse_result_id IS DISTINCT FROM parse_id OR r.payload_sha256 IS DISTINCT FROM expected_hash OR r.source_received_at IS DISTINCT FROM mail.received_at
   OR r.evidence->>'kind' IS DISTINCT FROM 'utilts_syntax_missing_bgm' OR NOT gridex_ediel_header_negative_birth.is_bound_v1(m,false) THEN RAISE EXCEPTION 'utilts_syntax_negative_replay_conflict' USING ERRCODE='23514';END IF;
 ELSE
  observed:=clock_timestamp();m.id:=gen_random_uuid();
  e:=jsonb_build_object('kind','utilts_syntax_missing_bgm','version',1,'companyId',c,'environment',env,'sourceMessageId',m.id,'sourceHash',expected_hash,'sourceReceivedAt',mail.received_at,'observedAt',observed,
   'syntaxError',jsonb_build_object('kind','mandatory_segment_missing','segment','BGM'),'identities',jsonb_build_object('family','UTILTS','messageReference',classification->'messageReference','technicalType',classification->'technicalType',
    'transport',jsonb_build_object('interchangeReference',classification#>>'{originalUNB,interchangeReference}','uciReference',classification#>>'{originalUNB,uciReference}','senderComponents',classification#>'{originalUNB,sender}','receiverComponents',classification#>'{originalUNB,receiver}'),
    'applicationReference',nullif(classification#>>'{originalUNB,applicationReference}','')),'authorizesBusinessEffect',false,'authorizesApplicationAck',false,'permanentNegative',true);
  facts:=jsonb_build_object('messageCode',p.message_code,'applicationReference',p.application_reference,'senderEdielId',p.sender_ediel_id,'receiverEdielId',p.receiver_ediel_id,'interchangeReference',p.interchange_reference);
  INSERT INTO gridex_ediel_header_negative_birth.receipts VALUES(m.id,c,env,actor,mail.id,p.id,expected_hash,mail.received_at,observed,txid_current(),'pending',facts,e) RETURNING * INTO r;
  INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,created_by,resolved_company_id,
   sender_ediel_id,receiver_ediel_id,sender_sub_address,receiver_sub_address,parsed_unb_sender_ediel_id,parsed_unb_receiver_ediel_id,application_reference,interchange_reference,external_reference,raw_payload,parsed_payload,
   inbound_email_message_id,mailbox_message_id,message_received_at,processing_status,tenant_resolution_status,business_match_status)
  VALUES(m.id,c,env,'inbound','edifact','UTILTS','UTILTS_UNKNOWN','received',actor,c,p.sender_ediel_id,p.receiver_ediel_id,p.sender_sub_address,p.receiver_sub_address,p.sender_ediel_id,p.receiver_ediel_id,p.application_reference,p.interchange_reference,NULL,expected_raw,p.parsed_payload,
   mail.id,mail.id::text,mail.received_at,'manual_review','tenant_resolved','business_unresolved') RETURNING * INTO m;
  IF NOT gridex_ediel_header_negative_birth.is_bound_v1(m,true) THEN RAISE EXCEPTION 'utilts_syntax_negative_birth_scope_required' USING ERRCODE='23514';END IF;
  reception:=public.ediel_record_inbound_reception_v1(c,m.id,actor,mail.id,p.id);
  IF reception->>'classification' IS DISTINCT FROM 'first_reception' THEN RAISE EXCEPTION 'utilts_syntax_negative_first_reception_required' USING ERRCODE='23514';END IF;
  UPDATE gridex_ediel_header_negative_birth.receipts SET status='consumed' WHERE source_message_id=m.id RETURNING * INTO r;
 END IF;
 RETURN jsonb_build_object('version',1,'disposition','utilts_syntax_negative','sourceMessageId',r.source_message_id,'companyId',r.company_id,'environment',r.environment,'sourcePayloadHash',r.payload_sha256,
  'inboundEmailMessageId',r.inbound_email_message_id,'parseResultId',r.parse_result_id,'sourceReceivedAt',r.source_received_at,'missingSegment','BGM','authorizesBusinessEffect',false,'permanentNegative',true);
END $$;
CREATE FUNCTION public.ediel_create_utilts_syntax_negative_v1(p_company_id uuid,p_environment text,p_actor_user_id uuid,p_inbound_email_message_id uuid,p_parse_result_id uuid,p_expected_raw_payload text,p_expected_payload_hash text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT gridex_ediel_header_negative_birth.create_utilts_missing_bgm_v1(p_company_id,p_environment,p_actor_user_id,p_inbound_email_message_id,p_parse_result_id,p_expected_raw_payload,p_expected_payload_hash)$$;
REVOKE ALL ON FUNCTION gridex_ediel_header_negative_birth.classify_utilts_missing_bgm_v1(text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION gridex_ediel_header_negative_birth.create_utilts_missing_bgm_v1(uuid,text,uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.ediel_create_utilts_syntax_negative_v1(uuid,text,uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_create_utilts_syntax_negative_v1(uuid,text,uuid,uuid,uuid,text,text) TO service_role;

-- Exact pre-image -> exact post-image replacement. Attributes (owner, SECURITY,
-- volatility, search_path, ACL) are preserved by re-executing pg_get_functiondef.
CREATE FUNCTION pg_temp.replace_fragment(target regprocedure,pre text,post text,fragment text,replacement text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE body text;def text;acl_before aclitem[];owner_before oid;sec_before boolean;cfg_before text[];vol_before "char";
BEGIN
 SELECT prosrc,proacl,proowner,prosecdef,proconfig,provolatile INTO body,acl_before,owner_before,sec_before,cfg_before,vol_before FROM pg_proc WHERE oid=target;
 IF encode(sha256(convert_to(body,'UTF8')),'hex') IS DISTINCT FROM pre THEN RAISE EXCEPTION 'utilts_syntax_negative_unknown_preimage:%',target;END IF;
 IF (length(body)-length(replace(body,fragment,'')))/length(fragment)<>1 THEN RAISE EXCEPTION 'utilts_syntax_negative_unique_fragment_required:%',target;END IF;
 def:=pg_get_functiondef(target);
 IF (length(def)-length(replace(def,body,'')))/length(body)<>1 THEN RAISE EXCEPTION 'utilts_syntax_negative_unique_body_required:%',target;END IF;
 EXECUTE replace(def,body,replace(body,fragment,replacement));
 IF NOT EXISTS(SELECT FROM pg_proc WHERE oid=target AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')=post AND proacl IS NOT DISTINCT FROM acl_before AND proowner=owner_before
  AND prosecdef=sec_before AND proconfig IS NOT DISTINCT FROM cfg_before AND provolatile=vol_before) THEN RAISE EXCEPTION 'utilts_syntax_negative_unexpected_postimage:%',target;END IF;
END $$;

-- is_bound_v1: PRODAT branch keeps the exact previous predicate; UTILTS is
-- admitted only as UTILTS_UNKNOWN with its own receipt kind and an actual
-- BGM-less wire. No other family or code is bound.
SELECT pg_temp.replace_fragment('gridex_ediel_header_negative_birth.is_bound_v1(public.ediel_messages,boolean)'::regprocedure,
 '6c7da3256dc17fe810cdaa5885e85716ae7ffb50ab4829c6695cafc3adb3fe38','35e73c61413b4202f00a29048dcab7b3d25cf634545a1175d87918556fd2525d',
 $f$AND m.direction='inbound' AND m.message_standard='edifact' AND m.message_family='PRODAT' AND m.resolved_company_id=m.company_id$f$,
 $f$AND m.direction='inbound' AND m.message_standard='edifact' AND m.resolved_company_id=m.company_id
  AND ((m.message_family='PRODAT' AND r.evidence->>'kind' IS DISTINCT FROM 'utilts_syntax_missing_bgm')
   OR (m.message_family='UTILTS' AND m.message_code='UTILTS_UNKNOWN' AND r.evidence->>'kind'='utilts_syntax_missing_bgm' AND m.external_reference IS NULL
    AND gridex_ediel_header_negative_birth.classify_utilts_missing_bgm_v1(m.raw_payload) IS NOT NULL))$f$);

-- The common PRODAT header source is born only for PRODAT receipts. A bound
-- UTILTS syntax negative never acquires an APERAK/common-header basis.
SELECT pg_temp.replace_fragment('gridex_ediel_common_header.capture_source()'::regprocedure,
 '2122ea50ee16ba1b18f3fc50aca084ff59434fdb359dbf11974eead0c6d6fa5e','d22da2b224da423eeb1fae0c970c3e9cb78785192988a171478bbba3dbe17754',
 $f$IF TG_OP='INSERT' AND gridex_ediel_header_negative_birth.is_bound_v1(NEW,true) IS TRUE THEN$f$,
 $f$IF TG_OP='INSERT' AND NEW.message_family='PRODAT' AND gridex_ediel_header_negative_birth.is_bound_v1(NEW,true) IS TRUE THEN$f$);

COMMIT;
