-- Prospective component custody only. Never attest previously mutable mail,
-- borrow legal tenant attribution, or mint a national received-source context.
CREATE SCHEMA gridex_unattributed_intake;
REVOKE ALL ON SCHEMA gridex_unattributed_intake FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE gridex_unattributed_intake.raw_births (
 inbound_email_message_id uuid PRIMARY KEY,
 snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^[a-f0-9]{64}$'),
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE gridex_unattributed_intake.attachment_births (
 attachment_id uuid PRIMARY KEY,
 inbound_email_message_id uuid NOT NULL REFERENCES gridex_unattributed_intake.raw_births,
 snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^[a-f0-9]{64}$')
);
CREATE TABLE gridex_unattributed_intake.parse_births (
 parse_result_id uuid PRIMARY KEY,
 inbound_email_message_id uuid NOT NULL REFERENCES gridex_unattributed_intake.raw_births,
 snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^[a-f0-9]{64}$'),
 attachment_set_hash text NOT NULL,
 selection_qualified boolean NOT NULL
);
CREATE TABLE gridex_unattributed_intake.technical_births (
 source_message_id uuid PRIMARY KEY REFERENCES public.ediel_messages(id) DEFERRABLE INITIALLY DEFERRED,
 inbound_email_message_id uuid NOT NULL UNIQUE REFERENCES public.inbound_email_messages(id),
 parse_result_id uuid NOT NULL UNIQUE REFERENCES public.inbound_ediel_parse_results(id),
 payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
 environment text NOT NULL CHECK (environment IN ('test','production')),
 received_at timestamptz NOT NULL,
 physical_envelope jsonb NOT NULL,
 message_family text NOT NULL CHECK (message_family IN ('PRODAT','UTILTS')),
 message_code text NOT NULL,
 actor_user_id uuid NOT NULL,
 birth_transaction bigint NOT NULL
);
-- Only protected births keep a durable reservation. Ordinary inserts probe
-- the unique index and delete their own transient row within the same trigger.
CREATE TABLE gridex_unattributed_intake.physical_claims (
 physical_key text PRIMARY KEY,
 protected_source_id uuid UNIQUE REFERENCES gridex_unattributed_intake.technical_births(source_message_id),
 claim_transaction bigint NOT NULL
);

-- SECURITY DEFINER changes current_user, not the actual session role. A JWT
-- claim alone is insufficient; PostgREST must have selected the service role.
CREATE FUNCTION gridex_unattributed_intake.service_session_v1() RETURNS boolean
 LANGUAGE sql STABLE SET search_path TO pg_catalog AS $$
 SELECT (current_setting('role',true)='service_role' OR session_user='service_role')
  AND coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'service_role')='service_role'
  AND CASE WHEN nullif(current_setting('request.jwt.claims',true),'') IS NULL THEN true ELSE
   jsonb_typeof(current_setting('request.jwt.claims',true)::jsonb)='object'
   AND (NOT current_setting('request.jwt.claims',true)::jsonb ? 'role'
    OR current_setting('request.jwt.claims',true)::jsonb->>'role'='service_role') END
$$;
CREATE FUNCTION gridex_unattributed_intake.require_service_v1() RETURNS void
 LANGUAGE plpgsql SET search_path TO pg_catalog AS $$ BEGIN
 IF gridex_unattributed_intake.service_session_v1() IS NOT TRUE THEN
  RAISE EXCEPTION 'ediel_technical_intake_service_required' USING ERRCODE='42501';
 END IF;
END $$;
CREATE FUNCTION gridex_unattributed_intake.sha_v1(s text) RETURNS text
 LANGUAGE sql IMMUTABLE SET search_path TO pg_catalog AS $$
 SELECT encode(sha256(convert_to(s,'UTF8')),'hex')
$$;
CREATE FUNCTION gridex_unattributed_intake.raw_hash_v1(m public.inbound_email_messages) RETURNS text
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO pg_catalog SET "TimeZone" TO UTC AS $$
 SELECT gridex_unattributed_intake.sha_v1(jsonb_build_object(
  'id',m.id,'mailbox',m.mailbox_id,'environment',m.environment,'receivedAt',m.received_at,
  'raw',gridex_unattributed_intake.sha_v1(m.raw_email),
  'projection',gridex_unattributed_intake.sha_v1(m.raw_edifact_payload),
  'body',gridex_unattributed_intake.sha_v1(m.body_text),'html',gridex_unattributed_intake.sha_v1(m.body_html),
  'hasAttachments',m.has_attachments,'mailboxScope',
   (SELECT jsonb_build_object('id',b.id,'company',b.company_id,'environment',b.environment,
    'shared',b.is_shared_platform_mailbox,'type',b.mailbox_type) FROM public.ediel_mailboxes b WHERE b.id=m.mailbox_id))::text)
$$;
CREATE FUNCTION gridex_unattributed_intake.attachment_hash_v1(a public.inbound_email_attachments) RETURNS text
 LANGUAGE sql IMMUTABLE SET search_path TO pg_catalog AS $$
 SELECT gridex_unattributed_intake.sha_v1(jsonb_build_object('id',a.id,'mail',a.inbound_email_message_id,
  'raw',gridex_unattributed_intake.sha_v1(a.raw_text),'filename',a.filename,'mime',a.mime_type,
  'candidate',a.is_edifact_candidate,'size',a.size_bytes,'storage',a.storage_path)::text)
$$;
CREATE FUNCTION gridex_unattributed_intake.parse_hash_v1(p public.inbound_ediel_parse_results) RETURNS text
 LANGUAGE sql STABLE SET search_path TO pg_catalog SET "TimeZone" TO UTC AS $$
 SELECT gridex_unattributed_intake.sha_v1((to_jsonb(p)-ARRAY['parse_status','validation_report'])::text)
$$;
CREATE FUNCTION gridex_unattributed_intake.attachment_set_v1(mail_id uuid) RETURNS text
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO pg_catalog AS $$
 SELECT gridex_unattributed_intake.sha_v1(coalesce(jsonb_agg(jsonb_build_object('id',a.id,
  'hash',gridex_unattributed_intake.attachment_hash_v1(a)) ORDER BY a.id),'[]')::text)
 FROM public.inbound_email_attachments a WHERE a.inbound_email_message_id=mail_id
$$;
CREATE FUNCTION gridex_unattributed_intake.wire_view_v1(s text) RETURNS text
 LANGUAGE sql IMMUTABLE SET search_path TO pg_catalog AS $$
 SELECT btrim(replace(replace(s,E'\r\n',''),E'\n',''),E' \t')
$$;
CREATE FUNCTION gridex_unattributed_intake.physical_key_v1(e jsonb) RETURNS text
 LANGUAGE sql IMMUTABLE SET search_path TO pg_catalog AS $$
 SELECT CASE WHEN e IS NOT NULL THEN gridex_unattributed_intake.sha_v1(jsonb_build_array(
  e->'environment',e->'sender',e->'receiver',e->'applicationReference',e->'uciReference')::text) END
$$;

-- The existing service parser owns selection, while these receipts bind its
-- real INSERT to the born raw/projection/attachment bytes. No MIME decoder or
-- parsed JSON verdict is introduced. Transformed/ambiguous custody stays held.
CREATE FUNCTION gridex_unattributed_intake.selection_v1(p public.inbound_ediel_parse_results) RETURNS boolean
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE m public.inbound_email_messages%rowtype;env jsonb;tokens jsonb;family text;code text;
 wire text;raw_view text;prefix text;candidate text;n integer;choices text[]:='{}';
BEGIN
 SELECT * INTO m FROM public.inbound_email_messages WHERE id=p.inbound_email_message_id;
 IF m.id IS NULL OR p.company_id IS NOT NULL OR p.message_family NOT IN('PRODAT','UTILTS')
  OR m.received_at IS NULL OR m.environment NOT IN('test','production')
  OR nullif(m.raw_email,'') IS NULL OR nullif(p.raw_payload,'') IS NULL
  OR NOT EXISTS(SELECT FROM public.ediel_mailboxes box WHERE box.id=m.mailbox_id
    AND box.is_active AND box.environment=m.environment)
  OR octet_length(m.raw_email)>8388608 OR octet_length(p.raw_payload)>8388608
  OR m.raw_email ~* '(content-transfer-encoding:[ \t]*(base64|quoted-printable)|application/(x-)?pkcs7|multipart/(encrypted|signed))'
 THEN RETURN false;END IF;
 env:=gridex_ediel_technical_ack.envelope(p.raw_payload);
 tokens:=gridex_utilts_binding.wire_tokens_v1(p.raw_payload);
 IF env IS NULL OR tokens IS NULL OR env->>'environment' IS DISTINCT FROM m.environment
  OR (SELECT count(*) FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='UNH')<>1 THEN RETURN false;END IF;
 SELECT x#>>'{elements,2,0}' INTO family FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='UNH';
 SELECT x#>>'{elements,1,0}' INTO code FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='BGM';
 IF family IS DISTINCT FROM p.message_family OR code IS DISTINCT FROM p.message_code
  OR p.sender_ediel_id IS DISTINCT FROM env#>>'{sender,0}' OR p.receiver_ediel_id IS DISTINCT FROM env#>>'{receiver,0}'
  OR coalesce(p.sender_sub_address,'') IS DISTINCT FROM coalesce(env#>>'{sender,2}','')
  OR coalesce(p.receiver_sub_address,'') IS DISTINCT FROM coalesce(env#>>'{receiver,2}','')
  OR p.interchange_reference IS DISTINCT FROM env->>'interchangeReference'
  OR coalesce(p.application_reference,'') IS DISTINCT FROM env->>'applicationReference'
  OR p.parsed_payload->>'rawPayload' IS DISTINCT FROM p.raw_payload THEN RETURN false;END IF;
 SELECT count(*) INTO n FROM public.inbound_email_attachments WHERE inbound_email_message_id=m.id;
 IF n>128 OR (m.has_attachments AND n=0) OR EXISTS(
  SELECT FROM public.inbound_email_attachments a LEFT JOIN gridex_unattributed_intake.attachment_births b ON b.attachment_id=a.id
  WHERE a.inbound_email_message_id=m.id AND (b.attachment_id IS NULL OR b.inbound_email_message_id IS DISTINCT FROM m.id
   OR b.snapshot_hash IS DISTINCT FROM gridex_unattributed_intake.attachment_hash_v1(a))) THEN RETURN false;END IF;
 wire:=gridex_unattributed_intake.wire_view_v1(p.raw_payload);
 raw_view:=gridex_unattributed_intake.wire_view_v1(m.raw_email);
 prefix:=CASE WHEN left(wire,3)='UNA' THEN substr(wire,10,4) ELSE left(wire,4) END;
 IF strpos(raw_view,wire)=0 OR length(prefix)<>4 OR left(prefix,3)<>'UNB'
  OR (length(raw_view)-length(replace(raw_view,prefix,'')))/4<>1 THEN RETURN false;END IF;
 FOR candidate IN SELECT unnest(ARRAY[m.raw_edifact_payload,m.body_text]) UNION ALL
  SELECT a.raw_text FROM public.inbound_email_attachments a WHERE a.inbound_email_message_id=m.id LOOP
  candidate:=gridex_unattributed_intake.wire_view_v1(candidate);
  IF left(candidate,3) IN('UNA','UNB') THEN
   IF gridex_ediel_technical_ack.envelope(candidate) IS NULL THEN RETURN false;END IF;
   IF NOT candidate=ANY(choices) THEN choices:=array_append(choices,candidate);END IF;
  END IF;
 END LOOP;
 -- Raw-only plaintext selection is still bound to the exact retained MIME.
 RETURN (cardinality(choices)=0 OR choices=ARRAY[wire]) AND nullif(m.body_html,'') IS NULL;
END $$;

CREATE FUNCTION gridex_unattributed_intake.capture_custody_v1() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE r gridex_unattributed_intake.raw_births%rowtype;m public.inbound_email_messages%rowtype;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'ediel_technical_custody_birth_only';END IF;
 IF gridex_unattributed_intake.service_session_v1() IS NOT TRUE THEN RETURN NEW;END IF;
 IF TG_TABLE_NAME='inbound_email_messages' THEN
  INSERT INTO gridex_unattributed_intake.raw_births(inbound_email_message_id,snapshot_hash)
   VALUES(NEW.id,gridex_unattributed_intake.raw_hash_v1(NEW));
 ELSE
  SELECT * INTO m FROM public.inbound_email_messages WHERE id=NEW.inbound_email_message_id FOR SHARE;
  SELECT * INTO r FROM gridex_unattributed_intake.raw_births WHERE inbound_email_message_id=m.id;
  IF r.inbound_email_message_id IS NULL OR r.snapshot_hash IS DISTINCT FROM gridex_unattributed_intake.raw_hash_v1(m) THEN RETURN NEW;END IF;
  IF TG_TABLE_NAME='inbound_email_attachments' THEN
   INSERT INTO gridex_unattributed_intake.attachment_births VALUES(NEW.id,m.id,gridex_unattributed_intake.attachment_hash_v1(NEW));
  ELSIF TG_TABLE_NAME='inbound_ediel_parse_results' THEN
   INSERT INTO gridex_unattributed_intake.parse_births VALUES(NEW.id,m.id,gridex_unattributed_intake.parse_hash_v1(NEW),
    gridex_unattributed_intake.attachment_set_v1(m.id),gridex_unattributed_intake.selection_v1(NEW));
  ELSE RAISE EXCEPTION 'ediel_technical_custody_owner_required';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER gridex_technical_raw_birth AFTER INSERT ON public.inbound_email_messages
 FOR EACH ROW EXECUTE FUNCTION gridex_unattributed_intake.capture_custody_v1();
CREATE TRIGGER gridex_technical_attachment_birth AFTER INSERT ON public.inbound_email_attachments
 FOR EACH ROW EXECUTE FUNCTION gridex_unattributed_intake.capture_custody_v1();
CREATE TRIGGER gridex_technical_parse_birth AFTER INSERT ON public.inbound_ediel_parse_results
 FOR EACH ROW EXECUTE FUNCTION gridex_unattributed_intake.capture_custody_v1();

CREATE FUNCTION gridex_unattributed_intake.require_custody_v1(mail_id uuid, parse_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE m public.inbound_email_messages%rowtype;p public.inbound_ediel_parse_results%rowtype;
 r gridex_unattributed_intake.raw_births%rowtype;b gridex_unattributed_intake.parse_births%rowtype;
BEGIN
 SELECT * INTO m FROM public.inbound_email_messages WHERE id=mail_id FOR SHARE;
 SELECT * INTO p FROM public.inbound_ediel_parse_results WHERE id=parse_id AND inbound_email_message_id=mail_id FOR SHARE;
 SELECT * INTO r FROM gridex_unattributed_intake.raw_births WHERE inbound_email_message_id=mail_id;
 SELECT * INTO b FROM gridex_unattributed_intake.parse_births WHERE parse_result_id=parse_id;
 PERFORM id FROM public.inbound_email_attachments WHERE inbound_email_message_id=mail_id ORDER BY id FOR SHARE;
 IF m.id IS NULL OR p.id IS NULL OR r.inbound_email_message_id IS NULL OR b.parse_result_id IS NULL
  OR b.inbound_email_message_id IS DISTINCT FROM mail_id OR b.selection_qualified IS NOT TRUE
  OR r.snapshot_hash IS DISTINCT FROM gridex_unattributed_intake.raw_hash_v1(m)
  OR b.snapshot_hash IS DISTINCT FROM gridex_unattributed_intake.parse_hash_v1(p)
  OR b.attachment_set_hash IS DISTINCT FROM gridex_unattributed_intake.attachment_set_v1(mail_id)
  OR gridex_unattributed_intake.selection_v1(p) IS NOT TRUE THEN
  RAISE EXCEPTION 'ediel_technical_intake_original_custody_required' USING ERRCODE='23514';
 END IF;
END $$;

CREATE FUNCTION gridex_unattributed_intake.is_birth_v1(m public.ediel_messages, pending boolean DEFAULT false) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO pg_catalog AS $$
 SELECT EXISTS(SELECT FROM gridex_unattributed_intake.technical_births b WHERE b.source_message_id=m.id
  AND (NOT pending OR b.birth_transaction=txid_current()) AND m.company_id IS NULL AND m.resolved_company_id IS NULL
  AND m.direction='inbound' AND m.message_standard='edifact' AND m.message_family=b.message_family AND m.message_code=b.message_code
  AND m.environment=b.environment AND m.message_received_at=b.received_at AND m.inbound_email_message_id=b.inbound_email_message_id
  AND m.mailbox_message_id=b.inbound_email_message_id::text
  AND gridex_unattributed_intake.sha_v1(m.raw_payload)=b.payload_hash
  AND gridex_ediel_technical_ack.envelope(m.raw_payload)=b.physical_envelope
  AND m.customer_id IS NULL AND m.site_id IS NULL AND m.metering_point_id IS NULL AND m.grid_owner_id IS NULL
  AND m.party_id IS NULL AND m.party_address_id IS NULL AND m.resolved_grid_owner_id IS NULL AND m.resolved_counterparty_id IS NULL
  AND m.operation_id IS NULL AND m.intent_id IS NULL AND m.source_operation_id IS NULL AND m.outbound_request_id IS NULL
  AND m.switch_request_id IS NULL AND m.grid_owner_data_request_id IS NULL AND m.grid_owner_information_request_id IS NULL
  AND m.partner_export_id IS NULL AND m.related_message_id IS NULL AND m.communication_route_id IS NULL
  AND m.canonical_rule_pack_id IS NULL AND m.execution_context_snapshot='{}'::jsonb)
$$;

CREATE FUNCTION gridex_unattributed_intake.receipt_v1(source_id uuid, actor uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE b gridex_unattributed_intake.technical_births%rowtype;m public.ediel_messages%rowtype;
 endpoint gridex_ediel_technical_ack.sources%rowtype;
BEGIN
 SELECT * INTO b FROM gridex_unattributed_intake.technical_births WHERE source_message_id=source_id;
 IF b.source_message_id IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO m FROM public.ediel_messages WHERE id=source_id FOR SHARE;
 SELECT * INTO endpoint FROM gridex_ediel_technical_ack.sources WHERE source_message_id=source_id;
 PERFORM gridex_unattributed_intake.require_custody_v1(b.inbound_email_message_id,b.parse_result_id);
 IF m.id IS NULL OR gridex_unattributed_intake.is_birth_v1(m) IS NOT TRUE OR m.immutable_payload_hash IS DISTINCT FROM b.payload_hash
  OR endpoint.source_message_id IS NULL OR endpoint.status<>'ready' OR endpoint.source_company_id IS NOT NULL
  OR endpoint.environment IS DISTINCT FROM b.environment OR endpoint.payload_sha256 IS DISTINCT FROM b.payload_hash
  OR endpoint.source_received_at IS DISTINCT FROM b.received_at
  OR NOT EXISTS(SELECT FROM gridex_unattributed_intake.physical_claims claim
    WHERE claim.physical_key=gridex_unattributed_intake.physical_key_v1(b.physical_envelope)
      AND claim.protected_source_id=b.source_message_id)
  OR EXISTS(SELECT FROM public.inbound_email_messages mail JOIN public.ediel_mailboxes box ON box.id=mail.mailbox_id
    WHERE mail.id=b.inbound_email_message_id AND box.company_id IS NOT NULL AND box.company_id IS DISTINCT FROM endpoint.company_id) THEN
  RAISE EXCEPTION 'ediel_technical_intake_birth_required' USING ERRCODE='23514';
 END IF;
 PERFORM gridex_ediel_technical_ack.require_actor_v1(endpoint.company_id,b.environment,actor,'prepare');
 RETURN jsonb_build_object('kind','unattributed_technical_intake','version',1,'disposition','technical_only_unattributed',
  'sourceMessageId',source_id,'inboundEmailMessageId',b.inbound_email_message_id,'parseResultId',b.parse_result_id,
  'companyId',NULL,'resolvedCompanyId',NULL,'technicalCompanyId',endpoint.company_id,'environment',b.environment,
  'sourcePayloadHash',b.payload_hash,'receivedAt',b.received_at,'executionActorUserId',actor,'authorizesBusinessEffect',false);
END $$;

CREATE FUNCTION public.ediel_read_unattributed_technical_intake_v1(p_inbound_email_message_id uuid,p_source_message_id uuid,p_actor_user_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE source_id uuid;
BEGIN
 PERFORM gridex_unattributed_intake.require_service_v1();
 IF (p_inbound_email_message_id IS NULL)=(p_source_message_id IS NULL) THEN
  RAISE EXCEPTION 'ediel_technical_intake_exact_selector_required' USING ERRCODE='22023';END IF;
 SELECT source_message_id INTO source_id FROM gridex_unattributed_intake.technical_births
  WHERE (p_inbound_email_message_id IS NOT NULL AND inbound_email_message_id=p_inbound_email_message_id)
   OR (p_source_message_id IS NOT NULL AND source_message_id=p_source_message_id);
 RETURN gridex_unattributed_intake.receipt_v1(source_id,p_actor_user_id);
END $$;

CREATE FUNCTION public.ediel_admit_unattributed_technical_source_v1(p_inbound_email_message_id uuid,p_parse_result_id uuid,
 p_actor_user_id uuid,p_expected_payload_hash text,p_expected_environment text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE m public.inbound_email_messages%rowtype;p public.inbound_ediel_parse_results%rowtype;
 old_source uuid;source_id uuid;env jsonb;born public.ediel_messages%rowtype;result jsonb;
BEGIN
 PERFORM gridex_unattributed_intake.require_service_v1();
 -- The current production/PostgREST birth path is READ COMMITTED. A lock
 -- cannot refresh an older RR snapshot of ordinary originals; hold instead.
 IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
  RAISE EXCEPTION 'ediel_technical_intake_read_committed_required' USING ERRCODE='25000';END IF;
 -- Serialize the actual physical-original universe, including ordinary writers,
 -- not just this RPC. Use existing authority locks for endpoint/actor changes.
 LOCK TABLE public.ediel_messages IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE public.inbound_email_attachments IN SHARE MODE;
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 SELECT * INTO m FROM public.inbound_email_messages WHERE id=p_inbound_email_message_id FOR UPDATE;
 SELECT source_message_id INTO old_source FROM gridex_unattributed_intake.technical_births WHERE inbound_email_message_id=m.id;
 IF old_source IS NOT NULL THEN
  result:=gridex_unattributed_intake.receipt_v1(old_source,p_actor_user_id);
  IF result->>'sourcePayloadHash' IS DISTINCT FROM p_expected_payload_hash OR result->>'environment' IS DISTINCT FROM p_expected_environment THEN
   RAISE EXCEPTION 'ediel_technical_intake_replay_scope_conflict' USING ERRCODE='23514';END IF;
  RETURN result;
 END IF;
 SELECT * INTO p FROM public.inbound_ediel_parse_results WHERE id=p_parse_result_id AND inbound_email_message_id=m.id FOR UPDATE;
 PERFORM gridex_unattributed_intake.require_custody_v1(m.id,p.id);
 env:=gridex_ediel_technical_ack.envelope(p.raw_payload);
 IF p_actor_user_id IS NULL OR p.company_id IS NOT NULL OR m.environment IS DISTINCT FROM p_expected_environment
  OR gridex_unattributed_intake.sha_v1(p.raw_payload) IS DISTINCT FROM p_expected_payload_hash THEN
  RAISE EXCEPTION 'ediel_technical_intake_scope_required' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT FROM public.ediel_messages o CROSS JOIN LATERAL(
  SELECT gridex_ediel_technical_ack.envelope(o.raw_payload)e)x WHERE o.direction='inbound'
  AND x.e->>'environment'=env->>'environment' AND x.e->'sender'=env->'sender' AND x.e->'receiver'=env->'receiver'
  AND x.e->>'applicationReference'=env->>'applicationReference' AND x.e->>'uciReference'=env->>'uciReference') THEN
  RAISE EXCEPTION 'ediel_technical_intake_physical_original_exists' USING ERRCODE='23505';END IF;
 source_id:=gen_random_uuid();
 INSERT INTO gridex_unattributed_intake.technical_births VALUES(source_id,m.id,p.id,p_expected_payload_hash,m.environment,
  m.received_at,env,p.message_family,p.message_code,p_actor_user_id,txid_current());
 INSERT INTO gridex_unattributed_intake.physical_claims VALUES(
  gridex_unattributed_intake.physical_key_v1(env),source_id,txid_current());
 -- NULL here is unresolved legal staging, not the mailbox's technical owner.
 UPDATE public.inbound_email_messages SET company_id=NULL WHERE id=m.id;
 INSERT INTO public.ediel_messages(id,company_id,resolved_company_id,direction,message_standard,message_family,message_code,
  environment,test_flag,status,transport_type,inbound_email_message_id,mailbox_message_id,message_received_at,raw_payload,
  immutable_payload_hash,sender_ediel_id,sender_sub_address,receiver_ediel_id,receiver_sub_address,
  parsed_unb_sender_ediel_id,parsed_unb_receiver_ediel_id,interchange_reference,transaction_reference,application_reference,
  parsed_payload,validation_report,tenant_resolution_status,business_match_status,processing_status,created_by)
 VALUES(source_id,NULL,NULL,'inbound','edifact',p.message_family,p.message_code,m.environment,
  CASE WHEN m.environment='test' THEN 1 ELSE 0 END,'received','imap',m.id,m.id::text,m.received_at,p.raw_payload,
  p_expected_payload_hash,p.sender_ediel_id,p.sender_sub_address,p.receiver_ediel_id,p.receiver_sub_address,
  p.sender_ediel_id,p.receiver_ediel_id,p.interchange_reference,p.transaction_reference,p.application_reference,
  p.parsed_payload,jsonb_build_object('status','routing_unresolved_manual_review','authorizesBusinessEffect',false),
  'tenant_unresolved','blocked','tenant_unresolved',p_actor_user_id) RETURNING * INTO born;
 result:=gridex_unattributed_intake.receipt_v1(born.id,p_actor_user_id);
 IF result IS NULL THEN RAISE EXCEPTION 'ediel_technical_intake_birth_required';END IF;
 RETURN result;
END $$;

CREATE FUNCTION gridex_unattributed_intake.complete_birth_v1() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$ BEGIN
 PERFORM gridex_unattributed_intake.receipt_v1(NEW.source_message_id,NEW.actor_user_id);
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER gridex_complete_technical_birth AFTER INSERT ON gridex_unattributed_intake.technical_births
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gridex_unattributed_intake.complete_birth_v1();

CREATE FUNCTION gridex_unattributed_intake.immutable_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path TO pg_catalog AS $$ BEGIN
 RAISE EXCEPTION 'ediel_technical_intake_receipt_immutable' USING ERRCODE='23514';END $$;
CREATE FUNCTION gridex_unattributed_intake.guard_physical_claim_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path TO pg_catalog AS $$ BEGIN
 IF TG_OP='DELETE' AND OLD.protected_source_id IS NULL AND OLD.claim_transaction=txid_current() THEN RETURN OLD;END IF;
 RAISE EXCEPTION 'ediel_technical_intake_physical_reservation_immutable' USING ERRCODE='23514';END $$;
CREATE FUNCTION gridex_unattributed_intake.complete_claim_v1() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$ BEGIN
 IF NEW.protected_source_id IS NULL AND EXISTS(SELECT FROM gridex_unattributed_intake.physical_claims
  WHERE physical_key=NEW.physical_key AND protected_source_id IS NULL AND claim_transaction=NEW.claim_transaction) THEN
  RAISE EXCEPTION 'ediel_technical_intake_transient_probe_not_deleted' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER gridex_complete_physical_claim AFTER INSERT ON gridex_unattributed_intake.physical_claims
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gridex_unattributed_intake.complete_claim_v1();
CREATE FUNCTION gridex_unattributed_intake.guard_physical_original_v1() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE key text;
BEGIN
 IF NEW.direction IS DISTINCT FROM 'inbound' OR NEW.raw_payload IS NULL THEN RETURN NEW;END IF;
 key:=gridex_unattributed_intake.physical_key_v1(gridex_ediel_technical_ack.envelope(NEW.raw_payload));
 IF key IS NULL THEN RETURN NEW;END IF;
 IF gridex_unattributed_intake.is_birth_v1(NEW,true) IS TRUE THEN
  IF NOT EXISTS(SELECT FROM gridex_unattributed_intake.physical_claims
    WHERE physical_key=key AND protected_source_id=NEW.id) THEN
   RAISE EXCEPTION 'ediel_technical_intake_physical_reservation_required' USING ERRCODE='23514';END IF;
 ELSE
  -- A unique-index probe observes an existing protected reservation even if a
  -- REPEATABLE READ caller's ordinary SELECT snapshot cannot see that birth.
  BEGIN
   INSERT INTO gridex_unattributed_intake.physical_claims VALUES(key,NULL,txid_current());
  EXCEPTION WHEN unique_violation THEN
   RAISE EXCEPTION 'ediel_technical_intake_physical_original_exists' USING ERRCODE='23505';
  END;
  DELETE FROM gridex_unattributed_intake.physical_claims WHERE physical_key=key
   AND protected_source_id IS NULL AND claim_transaction=txid_current();
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER gridex_technical_protected_physical_original BEFORE INSERT ON public.ediel_messages
 FOR EACH ROW EXECUTE FUNCTION gridex_unattributed_intake.guard_physical_original_v1();
CREATE FUNCTION gridex_unattributed_intake.guard_original_v1() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE mail_id uuid;old_mail_id uuid;old_json jsonb;new_json jsonb;
BEGIN
 IF TG_TABLE_NAME='ediel_messages' THEN
  IF NOT EXISTS(SELECT FROM gridex_unattributed_intake.technical_births WHERE source_message_id=OLD.id) THEN
   IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'ediel_technical_intake_original_immutable';END IF;
  IF OLD.raw_payload IS NOT NULL AND NEW.raw_payload IS NULL AND public.ediel_is_qualified_retention_transition_v1(OLD,NEW) THEN RETURN NEW;END IF;
  old_json:=to_jsonb(OLD)-ARRAY['status','validation_report','contrl_status','aperak_status','utilts_err_status','ack_outcome',
   'syntax_check_status','functional_check_status','failure_reason','parsed_at','validated_at','acknowledged_at','failed_at',
   'ack_due_at','updated_at','updated_by','tenant_resolution_status','business_match_status','ack_status','processing_status',
   'backend_automation_status','backend_automation_reason','contrl_due_at','business_response_due_at','response_overdue_at'];
  new_json:=to_jsonb(NEW)-ARRAY['status','validation_report','contrl_status','aperak_status','utilts_err_status','ack_outcome',
   'syntax_check_status','functional_check_status','failure_reason','parsed_at','validated_at','acknowledged_at','failed_at',
   'ack_due_at','updated_at','updated_by','tenant_resolution_status','business_match_status','ack_status','processing_status',
   'backend_automation_status','backend_automation_reason','contrl_due_at','business_response_due_at','response_overdue_at'];
  IF old_json IS DISTINCT FROM new_json OR gridex_unattributed_intake.is_birth_v1(NEW) IS NOT TRUE THEN
   RAISE EXCEPTION 'ediel_technical_intake_original_immutable' USING ERRCODE='23514';END IF;
 ELSE
  IF TG_TABLE_NAME='inbound_email_messages' THEN mail_id:=OLD.id;
  ELSE
   IF TG_OP<>'DELETE' THEN mail_id:=NEW.inbound_email_message_id;END IF;
   IF TG_OP<>'INSERT' THEN old_mail_id:=OLD.inbound_email_message_id;END IF;
  END IF;
  IF EXISTS(SELECT FROM gridex_unattributed_intake.technical_births WHERE inbound_email_message_id IN(mail_id,old_mail_id)) THEN
   IF TG_TABLE_NAME='inbound_email_messages' AND TG_OP='UPDATE' AND NEW.company_id IS NULL
    AND gridex_unattributed_intake.raw_hash_v1(NEW)=gridex_unattributed_intake.raw_hash_v1(OLD) THEN RETURN NEW;END IF;
   IF TG_TABLE_NAME='inbound_ediel_parse_results' AND TG_OP='UPDATE'
    AND gridex_unattributed_intake.parse_hash_v1(NEW)=gridex_unattributed_intake.parse_hash_v1(OLD) THEN RETURN NEW;END IF;
   RAISE EXCEPTION 'ediel_technical_intake_custody_immutable' USING ERRCODE='23514';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;
CREATE TRIGGER gridex_technical_original_immutable BEFORE UPDATE OR DELETE ON public.ediel_messages
 FOR EACH ROW EXECUTE FUNCTION gridex_unattributed_intake.guard_original_v1();
CREATE TRIGGER gridex_technical_raw_immutable BEFORE UPDATE OR DELETE ON public.inbound_email_messages
 FOR EACH ROW EXECUTE FUNCTION gridex_unattributed_intake.guard_original_v1();
CREATE TRIGGER gridex_technical_parse_immutable BEFORE UPDATE OR DELETE ON public.inbound_ediel_parse_results
 FOR EACH ROW EXECUTE FUNCTION gridex_unattributed_intake.guard_original_v1();
CREATE TRIGGER gridex_technical_attachment_immutable BEFORE INSERT OR UPDATE OR DELETE ON public.inbound_email_attachments
 FOR EACH ROW EXECUTE FUNCTION gridex_unattributed_intake.guard_original_v1();

DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['raw_births','attachment_births','parse_births','technical_births','physical_claims'] LOOP
  EXECUTE format('ALTER TABLE gridex_unattributed_intake.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE gridex_unattributed_intake.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON gridex_unattributed_intake.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('CREATE TRIGGER immutable_receipt BEFORE UPDATE OR DELETE ON gridex_unattributed_intake.%I FOR EACH ROW EXECUTE FUNCTION gridex_unattributed_intake.%I()',t,
    CASE WHEN t='physical_claims' THEN 'guard_physical_claim_v1' ELSE 'immutable_v1' END);
  EXECUTE format('CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_unattributed_intake.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_unattributed_intake.immutable_v1()',t);
 END LOOP;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_unattributed_intake FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA gridex_unattributed_intake TO service_role;
GRANT EXECUTE ON FUNCTION gridex_unattributed_intake.is_birth_v1(public.ediel_messages,boolean) TO service_role;
REVOKE ALL ON FUNCTION public.ediel_admit_unattributed_technical_source_v1(uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.ediel_read_unattributed_technical_intake_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_admit_unattributed_technical_source_v1(uuid,uuid,uuid,text,text),
 public.ediel_read_unattributed_technical_intake_v1(uuid,uuid,uuid) TO service_role;

-- Preserve the actual current owner body; only the witness-bound NULL birth
-- and its national-capture exclusion differ. No business context is minted.
CREATE OR REPLACE FUNCTION public.gridex_validate_ediel_message_contract() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
declare v_canonical boolean;
BEGIN IF TG_OP='UPDATE' AND OLD.raw_payload IS NOT NULL AND NEW.raw_payload IS NULL AND public.ediel_is_qualified_retention_transition_v1(OLD,NEW) THEN RETURN NEW;END IF;
  if tg_op='UPDATE' then
    if coalesce(old.execution_context_snapshot ? 'receivedProdatContext',false) then
      if new.raw_payload is distinct from old.raw_payload or new.immutable_payload_hash is distinct from old.immutable_payload_hash then
        raise exception 'immutable_ediel_payload_cannot_change' using errcode='23514';
      end if;
      if (new.execution_context_snapshot->'receivedProdatContext') is distinct from (old.execution_context_snapshot->'receivedProdatContext') then
        raise exception 'immutable_ediel_received_context_cannot_change' using errcode='23514';
      end if;
      if new.message_received_at is distinct from old.message_received_at then
        raise exception 'immutable_ediel_receipt_time_cannot_change' using errcode='23514';
      end if;
      if new.id is distinct from old.id or new.direction is distinct from old.direction
         or new.message_standard is distinct from old.message_standard or new.message_family is distinct from old.message_family
         or new.message_code is distinct from old.message_code then
        raise exception 'immutable_ediel_received_context_cannot_change' using errcode='23514';
      end if;
    elsif coalesce(new.execution_context_snapshot ? 'receivedProdatContext',false) then
      raise exception 'received_ediel_context_cannot_be_backfilled' using errcode='23514';
    end if;
  end if;
  v_canonical := upper(coalesce(new.message_family,'')) in ('PRODAT','UTILTS','CONTRL','APERAK','UTILTS_ERR');
  if v_canonical then
    if new.company_id is null then
      if gridex_unattributed_intake.is_birth_v1(new,tg_op='INSERT') is not true then
        raise exception 'canonical_ediel_company_required' using errcode='23502';
      end if;
    end if;
    if nullif(btrim(coalesce(new.environment,'')),'') is null then raise exception 'canonical_ediel_environment_required' using errcode='23502'; end if;
    if new.direction='outbound' then
      if new.canonical_rule_pack_id is null then
        perform public.gridex_require_outbound_reply_basis_v1(new);
      end if;
      if new.communication_route_id is null then raise exception 'canonical_ediel_route_required' using errcode='23502'; end if;
      if new.route_profile_id is null and nullif(new.execution_context_snapshot->>'routeProfileId','') is null then raise exception 'canonical_ediel_route_profile_required' using errcode='23502'; end if;
      if nullif(btrim(coalesce(new.application_reference,'')),'') is null then raise exception 'canonical_ediel_application_reference_required' using errcode='23502'; end if;
      if nullif(btrim(coalesce(new.source_operation_id,new.execution_context_snapshot->>'sourceOperationId','')),'') is null then raise exception 'canonical_ediel_source_operation_required' using errcode='23502'; end if;
      if new.raw_payload is not null and nullif(btrim(new.raw_payload),'') is not null then
        new.immutable_payload_hash := encode(digest(convert_to(new.raw_payload,'UTF8'),'sha256'),'hex');
        new.immutable_rendered_at := coalesce(new.immutable_rendered_at,now());
      end if;
    end if;
  end if;
  -- Seal only newly received EDIFACT PRODAT source bytes; never backfill UPDATEs.
  -- Null is no source. Empty text is a source. Ignore a caller-supplied hash.
  if tg_op='INSERT' and new.direction='inbound'
     and upper(coalesce(new.message_family,''))='PRODAT'
     and new.message_standard='edifact' then
    new.immutable_payload_hash := case when new.raw_payload is null then null
      else encode(digest(convert_to(new.raw_payload,'UTF8'),'sha256'),'hex') end;
  end if;
  if tg_op='UPDATE' and old.immutable_payload_hash is not null then
    if new.raw_payload is distinct from old.raw_payload or new.immutable_payload_hash is distinct from old.immutable_payload_hash then
      raise exception 'immutable_ediel_payload_cannot_change' using errcode='23514';
    end if;
  end if;
  if tg_op='INSERT' then
    -- Client data never owns this reserved namespace, including ineligible rows.
    if jsonb_typeof(new.execution_context_snapshot) in ('object','array') then
      new.execution_context_snapshot := new.execution_context_snapshot - 'receivedProdatContext';
    end if;
    if new.direction='inbound' and upper(coalesce(new.message_family,''))='PRODAT'
       and new.message_standard='edifact' and new.raw_payload is not null
       and new.id is not null and new.company_id is not null
       and nullif(btrim(new.environment),'') is not null and nullif(btrim(new.message_code),'') is not null
       and new.message_received_at is not null and new.immutable_payload_hash is not null then
      new.execution_context_snapshot := (case when jsonb_typeof(new.execution_context_snapshot)='object'
        then new.execution_context_snapshot else '{}'::jsonb end) || jsonb_build_object('receivedProdatContext',jsonb_build_object(
          'version',1,'contextOrigin','database_insert','sourceMessageId',new.id,'companyId',new.company_id,
          'environment',new.environment,'messageCode',new.message_code,'payloadHash',new.immutable_payload_hash,
          'sourceReceivedAt',new.message_received_at,'capturedAt',clock_timestamp()));
    end if;
  end if;
  return new;
end $$;

-- Preserve the actual current owner body; only the witness-bound NULL birth
-- and its national-capture exclusion differ. No business context is minted.
CREATE OR REPLACE FUNCTION gridex_received_sources.capture_insert() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
BEGIN
  IF TG_OP <> 'INSERT' OR TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'ediel_messages' THEN
    RAISE EXCEPTION 'received_source_capture_invalid_owner' USING ERRCODE = '23514';
  END IF;
  IF gridex_unattributed_intake.is_birth_v1(NEW,true) IS TRUE THEN RETURN NEW; END IF;
  IF NEW.direction = 'inbound' AND upper(coalesce(NEW.message_family, '')) = 'PRODAT'
     AND NEW.message_standard = 'edifact' THEN
    -- AFTER INSERT observes the final row after PR369's BEFORE trigger sealed
    -- the source. Only database-owned original columns are copied; no status,
    -- mutable metering link, parsed_payload or validation_report is authority.
    INSERT INTO gridex_received_sources.sources (
      source_message_id, company_id, environment, origin, message_code,
      source_received_at, captured_at, raw_payload, payload_hash, received_context
    ) VALUES (
      NEW.id, NEW.company_id, NEW.environment, 'database_insert', NEW.message_code,
      NEW.message_received_at, clock_timestamp(), NEW.raw_payload,
      NEW.immutable_payload_hash,
      NEW.execution_context_snapshot -> 'receivedProdatContext'
    );
    -- No ON CONFLICT DO NOTHING. Reusing a deleted source ID must not silently
    -- attach a different receipt to old history. Normal retries are UPDATEs.
  END IF;
  RETURN NEW;
END
$$;
