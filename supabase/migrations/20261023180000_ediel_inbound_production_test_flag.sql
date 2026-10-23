-- FINDINGS F102 (reality simulation 2026-10-23): ediel_messages.test_flag defaults to 1, and three inbound births
-- relied on that default: the batch inbound mail engine (lib/inbound-mail/inboundStatusUpdater.ts), the canonical
-- inbound ACK persister (lib/inbound-mail/canonicalInboundAckStatusUpdater.ts) and the assigned PRODAT
-- header-negative birth below. Every production inbound original was therefore stored as a test message
-- (environment='production', test_flag=1). Consumers that read the flag treated those production originals as test
-- traffic: the PRODAT decision engine skipped the production Z14/Z15/Z18 permission-link manual-review hold, the
-- processing pipeline recorded the run context as non-production, and the admin test-data cleanup selected them.
-- The application inserts now set the flag from the mailbox environment. The column default is kept: other inserts
-- (lib/ediel/db.ts createEdielMessage, environment default 'test') are consistent with it, and an outbound
-- production message that omits the flag stays blocked by the production send lock (production_test_flag).
--
-- 1. The assigned header-negative birth names test_flag from its environment instead of taking the default.
--    Only the INSERT column list changes; the body is otherwise identical to 20261010102349.
CREATE OR REPLACE FUNCTION gridex_ediel_header_negative_birth.create_v1(c uuid,env text,actor uuid,mail_id uuid,parse_id uuid,expected_raw text,expected_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE mail public.inbound_email_messages%rowtype;p public.inbound_ediel_parse_results%rowtype;box public.ediel_mailboxes%rowtype;m public.ediel_messages%rowtype;r gridex_ediel_header_negative_birth.receipts%rowtype;
 observed timestamptz;classification jsonb;e jsonb;facts jsonb;reception jsonb;tokens jsonb;bgm jsonb;
BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();PERFORM gridex_ediel_inbound_receptions.authorize_v1(c,actor,'communication.write');
 IF env IS NULL OR env NOT IN('test','production') OR mail_id IS NULL OR parse_id IS NULL OR expected_raw IS NULL OR expected_hash IS NULL OR expected_hash IS DISTINCT FROM encode(sha256(convert_to(expected_raw,'UTF8')),'hex') THEN RAISE EXCEPTION 'assigned_prodat_negative_expected_original_required';END IF;
 SELECT * INTO mail FROM public.inbound_email_messages WHERE id=mail_id FOR UPDATE;SELECT * INTO p FROM public.inbound_ediel_parse_results WHERE id=parse_id FOR SHARE;SELECT * INTO box FROM public.ediel_mailboxes WHERE id=mail.mailbox_id FOR SHARE;
 IF mail.id IS NULL OR mail.company_id IS DISTINCT FROM c OR mail.environment IS DISTINCT FROM env OR mail.received_at IS NULL OR p.id IS NULL OR p.company_id IS DISTINCT FROM c OR p.inbound_email_message_id IS DISTINCT FROM mail.id OR p.raw_payload IS DISTINCT FROM expected_raw
  OR box.id IS NULL OR box.environment IS DISTINCT FROM env OR box.is_active IS NOT TRUE OR (box.company_id IS DISTINCT FROM c AND box.is_shared_platform_mailbox IS NOT TRUE)
  OR box.email_address IS NULL OR btrim(box.email_address)!~'^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' THEN RAISE EXCEPTION 'assigned_prodat_negative_retained_ingress_required';END IF;
 PERFORM a.id FROM public.inbound_email_attachments a WHERE a.inbound_email_message_id=mail.id ORDER BY a.id FOR SHARE;
 IF NOT(coalesce(position(p.raw_payload IN mail.raw_edifact_payload),0)>0 OR coalesce(position(p.raw_payload IN mail.body_text),0)>0 OR coalesce(position(p.raw_payload IN mail.raw_email),0)>0 OR EXISTS(SELECT FROM public.inbound_email_attachments a WHERE a.inbound_email_message_id=mail.id AND(a.company_id IS NULL OR a.company_id=c) AND coalesce(position(p.raw_payload IN a.raw_text),0)>0)) THEN RAISE EXCEPTION 'assigned_prodat_negative_retained_bytes_required';END IF;
 classification:=gridex_ediel_header_negative_birth.classify_v1(expected_raw);
 IF classification IS NULL OR p.message_family IS DISTINCT FROM 'PRODAT' OR p.message_code IS DISTINCT FROM classification->>'parsedCode'
  OR p.sender_sub_address IS DISTINCT FROM nullif(classification#>>'{originalUNB,sender,2}','') OR p.receiver_sub_address IS DISTINCT FROM nullif(classification#>>'{originalUNB,receiver,2}','')
  OR p.application_reference IS DISTINCT FROM nullif(classification#>>'{originalUNB,applicationReference}','') OR p.sender_ediel_id IS DISTINCT FROM classification#>>'{originalUNB,sender,0}' OR p.receiver_ediel_id IS DISTINCT FROM classification#>>'{originalUNB,receiver,0}' OR p.interchange_reference IS DISTINCT FROM classification#>>'{originalUNB,interchangeReference}' THEN RAISE EXCEPTION 'assigned_prodat_negative_exact_classification_required';END IF;
 SELECT * INTO r FROM gridex_ediel_header_negative_birth.receipts WHERE inbound_email_message_id=mail_id FOR SHARE;
 IF r.source_message_id IS NOT NULL THEN
  SELECT * INTO m FROM public.ediel_messages WHERE id=r.source_message_id FOR SHARE;
  IF r.company_id IS DISTINCT FROM c OR r.environment IS DISTINCT FROM env OR r.actor_user_id IS DISTINCT FROM actor OR r.parse_result_id IS DISTINCT FROM parse_id OR r.payload_sha256 IS DISTINCT FROM expected_hash OR r.source_received_at IS DISTINCT FROM mail.received_at OR NOT gridex_ediel_header_negative_birth.is_bound_v1(m,false) THEN RAISE EXCEPTION 'assigned_prodat_negative_replay_conflict';END IF;
 ELSE
  observed:=clock_timestamp();e:=gridex_ediel_header_negative_birth.family_basis_v1(c,env,expected_raw,mail.received_at,observed,classification);m.id:=gen_random_uuid();
  e:=e||jsonb_build_object('sourceMessageId',m.id,'assignedNegativeBirthReceiptId',m.id);
  facts:=jsonb_build_object('messageCode',p.message_code,'applicationReference',p.application_reference,'senderEdielId',p.sender_ediel_id,'receiverEdielId',p.receiver_ediel_id,'interchangeReference',p.interchange_reference);
  INSERT INTO gridex_ediel_header_negative_birth.receipts VALUES(m.id,c,env,actor,mail.id,p.id,expected_hash,mail.received_at,observed,txid_current(),'pending',facts,e) RETURNING * INTO r;
  tokens:=gridex_utilts_binding.wire_tokens_v1(expected_raw);SELECT x INTO bgm FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='BGM';
  INSERT INTO public.ediel_messages(id,company_id,environment,test_flag,direction,message_standard,message_family,message_code,status,created_by,resolved_company_id,
   sender_ediel_id,receiver_ediel_id,sender_sub_address,receiver_sub_address,parsed_unb_sender_ediel_id,parsed_unb_receiver_ediel_id,application_reference,interchange_reference,external_reference,raw_payload,parsed_payload,
   inbound_email_message_id,mailbox_message_id,message_received_at,processing_status,tenant_resolution_status,business_match_status)
  VALUES(m.id,c,env,CASE env WHEN 'production' THEN 0 ELSE 1 END,'inbound','edifact','PRODAT',p.message_code,'validation_failed',actor,c,p.sender_ediel_id,p.receiver_ediel_id,p.sender_sub_address,p.receiver_sub_address,p.sender_ediel_id,p.receiver_ediel_id,p.application_reference,p.interchange_reference,bgm#>>'{elements,2,0}',expected_raw,p.parsed_payload,
   mail.id,mail.id::text,mail.received_at,'manual_review','tenant_resolved','business_unresolved') RETURNING * INTO m;
  IF NOT gridex_ediel_header_negative_birth.is_bound_v1(m,true) THEN RAISE EXCEPTION 'assigned_prodat_negative_birth_scope_required';END IF;
  reception:=public.ediel_record_inbound_reception_v1(c,m.id,actor,mail.id,p.id);
  IF reception->>'classification' IS DISTINCT FROM 'first_reception' THEN RAISE EXCEPTION 'assigned_prodat_negative_first_reception_required';END IF;
  UPDATE gridex_ediel_header_negative_birth.receipts SET status='consumed' WHERE source_message_id=m.id RETURNING * INTO r;
 END IF;
 RETURN jsonb_build_object('version',1,'disposition','assigned_header_negative','sourceMessageId',r.source_message_id,'companyId',r.company_id,'environment',r.environment,'sourcePayloadHash',r.payload_sha256,'inboundEmailMessageId',r.inbound_email_message_id,'parseResultId',r.parse_result_id,'sourceReceivedAt',r.source_received_at,
  'fieldCode',r.evidence#>>'{negativeField,fieldCode}','rejectionField',r.evidence->'negativeField','correctedApplicationReference',CASE WHEN r.evidence#>>'{negativeField,fieldCode}'='311' THEN r.evidence->'replyApplicationReference' ELSE 'null'::jsonb END,'authorizesBusinessEffect',false,'permanentNegative',true);
END $$;

-- 2. Existing production inbound EDIFACT originals stored with the default are realigned once. A row whose UNB
--    carries the test indicator (0035=1) is left alone; such an interchange is held as environment_mismatch before
--    storage (J3-05) and is never re-flagged as production here. Unattributed technical originals are born with the
--    correct flag and are immutable; they are excluded explicitly. No immutability guard on ediel_messages compares
--    test_flag or metadata. updated_at is not touched so no message list is reordered. Each changed row keeps
--    metadata.f102_test_flag_from=1 for audit and rollback.
UPDATE public.ediel_messages m
   SET test_flag = 0,
       metadata = coalesce(m.metadata, '{}'::jsonb) || jsonb_build_object('f102_test_flag_from', m.test_flag)
 WHERE m.environment = 'production'
   AND m.direction = 'inbound'
   AND m.message_standard = 'edifact'
   AND m.test_flag = 1
   AND (SELECT x#>>'{elements,11,0}'
          FROM jsonb_array_elements(gridex_utilts_binding.wire_tokens_v1(m.raw_payload)) x
         WHERE x->>'tag' = 'UNB'
         LIMIT 1) IS DISTINCT FROM '1'
   AND NOT EXISTS (SELECT FROM gridex_unattributed_intake.technical_births b WHERE b.source_message_id = m.id);
