-- Controlled synthetic TEST authority only. No market/legal trust or role grants.
-- Real clocks, protected independent review, fresh pgcrypto keys; old capture/read unchanged.
BEGIN;
CREATE SCHEMA gridex_utilts_issuer_intake;
REVOKE ALL ON SCHEMA gridex_utilts_issuer_intake FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO public.permissions(key,name,description,category) VALUES
 ('ediel.utilts_issuer_source.submit','Submit own UTILTS issuer TEST sources','Own scoped custody and closed TEST issuance, not market approval','Ediel'),
 ('ediel.utilts_issuer_source.review','Review own UTILTS issuer TEST sources','Explicit independent controlled TEST approval only','Ediel') ON CONFLICT(key) DO NOTHING;
CREATE TABLE gridex_utilts_issuer_intake.artifacts(
 id uuid PRIMARY KEY,command_id uuid NOT NULL UNIQUE,company_id uuid NOT NULL,environment text NOT NULL CHECK(environment IN('test','production')),
 kind text NOT NULL,scope jsonb NOT NULL,scope_sha256 text NOT NULL,originals jsonb NOT NULL,artifact_sha256 text NOT NULL,
 submitted_by uuid NOT NULL,archived_at timestamptz NOT NULL DEFAULT clock_timestamp(),result jsonb NOT NULL);
CREATE TABLE gridex_utilts_issuer_intake.commands(
 id uuid PRIMARY KEY,company_id uuid NOT NULL,actor_id uuid NOT NULL,operation text NOT NULL,input_sha256 text NOT NULL,result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE gridex_utilts_issuer_intake.reviews(
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,artifact_id uuid NOT NULL REFERENCES gridex_utilts_issuer_intake.artifacts(id),
 actor_id uuid NOT NULL,decision text NOT NULL,reason text NOT NULL,effect jsonb NOT NULL,reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE gridex_utilts_issuer_intake.epochs(
 id uuid PRIMARY KEY,root_id uuid NOT NULL UNIQUE,company_id uuid NOT NULL,birth_artifact_id uuid NOT NULL UNIQUE REFERENCES gridex_utilts_issuer_intake.artifacts(id),
 namespace_id uuid NOT NULL UNIQUE REFERENCES gridex_utilts_issuer.namespaces(id),issuer_id uuid NOT NULL REFERENCES gridex_utilts_issuer.issuer_versions(id),
 mandate_id uuid NOT NULL REFERENCES gridex_utilts_issuer.transport_mandate_versions(id),mailbox_id uuid NOT NULL,legal_identity jsonb NOT NULL,transport_sender jsonb NOT NULL,
 inventory_sha256 text NOT NULL,usage_from timestamptz NOT NULL,usage_until timestamptz NOT NULL,valid_until timestamptz NOT NULL,
 submitted_by uuid NOT NULL,approved_by uuid NOT NULL,born_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE gridex_utilts_issuer_intake.applications(
 id uuid PRIMARY KEY,epoch_id uuid NOT NULL REFERENCES gridex_utilts_issuer_intake.epochs(id),actor_id uuid NOT NULL,binding jsonb NOT NULL,
 UNIQUE(epoch_id,actor_id));
CREATE TABLE gridex_utilts_issuer_intake.keys(
 id uuid PRIMARY KEY,epoch_id uuid NOT NULL REFERENCES gridex_utilts_issuer_intake.epochs(id),actor_id uuid NOT NULL,
 purpose text NOT NULL CHECK(purpose IN('root','application','reviewer')),application_id uuid REFERENCES gridex_utilts_issuer_intake.applications(id),
 secret bytea NOT NULL CHECK(octet_length(secret)=32),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(epoch_id,actor_id,purpose));
CREATE TABLE gridex_utilts_issuer_intake.journal(
 epoch_id uuid NOT NULL REFERENCES gridex_utilts_issuer_intake.epochs(id),sequence bigint NOT NULL,event_id uuid NOT NULL UNIQUE,
 artifact_id uuid NOT NULL REFERENCES gridex_utilts_issuer_intake.artifacts(id),actor_id uuid NOT NULL,kind text NOT NULL,event jsonb NOT NULL,
 previous_sha256 text NOT NULL,head_sha256 text NOT NULL,key_id uuid NOT NULL REFERENCES gridex_utilts_issuer_intake.keys(id),
 mac_hex text NOT NULL,event_bytes bytea NOT NULL,observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(epoch_id,sequence));
CREATE TABLE gridex_utilts_issuer_intake.issuances(
 id uuid PRIMARY KEY,epoch_id uuid NOT NULL REFERENCES gridex_utilts_issuer_intake.epochs(id),application_id uuid NOT NULL REFERENCES gridex_utilts_issuer_intake.applications(id),
 artifact_id uuid NOT NULL UNIQUE REFERENCES gridex_utilts_issuer_intake.artifacts(id),internet_message_id text NOT NULL UNIQUE,
 mime_bytes bytea NOT NULL,mime_sha256 text NOT NULL,payload text NOT NULL,payload_sha256 text NOT NULL,
 identifiers jsonb NOT NULL,prior_issuance_id uuid REFERENCES gridex_utilts_issuer_intake.issuances(id),issued_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE gridex_utilts_issuer_intake.source_links(
 source_id uuid PRIMARY KEY REFERENCES gridex_utilts_issuer.source_admissions(source_message_id),issuance_id uuid NOT NULL UNIQUE REFERENCES gridex_utilts_issuer_intake.issuances(id),
 email_id uuid NOT NULL,source_sha256 text NOT NULL,linked_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE gridex_utilts_issuer_intake.checkpoints(
 artifact_id uuid PRIMARY KEY REFERENCES gridex_utilts_issuer_intake.artifacts(id),epoch_id uuid NOT NULL REFERENCES gridex_utilts_issuer_intake.epochs(id),
 cutoff_sequence bigint NOT NULL,cutoff_head text NOT NULL,inventory_sha256 text NOT NULL,actor_id uuid NOT NULL,
 key_id uuid NOT NULL REFERENCES gridex_utilts_issuer_intake.keys(id),seal_bytes bytea NOT NULL,mac_hex text NOT NULL,
 manifest_bytes bytea NOT NULL,deletion_bytes bytea NOT NULL,sealed_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE gridex_utilts_issuer_intake.revocations(
 id uuid PRIMARY KEY,epoch_id uuid NOT NULL REFERENCES gridex_utilts_issuer_intake.epochs(id),target_kind text NOT NULL,target_id uuid NOT NULL,
 actor_id uuid NOT NULL,artifact_id uuid NOT NULL REFERENCES gridex_utilts_issuer_intake.artifacts(id),decision jsonb NOT NULL,revoked_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE FUNCTION gridex_utilts_issuer_intake.need_v1(ok boolean,code text) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%',code USING ERRCODE='23514';END IF;END$$;
CREATE FUNCTION gridex_utilts_issuer_intake.sha_v1(value jsonb) RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$SELECT encode(sha256(convert_to(value::text,'UTF8')),'hex')$$;
CREATE FUNCTION gridex_utilts_issuer_intake.shape_v1(value jsonb,keys text[]) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN
 PERFORM gridex_utilts_issuer_intake.need_v1(jsonb_typeof(value)='object' AND (SELECT array_agg(x ORDER BY x) FROM jsonb_object_keys(value) x)=(SELECT array_agg(x ORDER BY x) FROM unnest(keys) x),'issuer_intake_shape_invalid');END$$;
CREATE FUNCTION gridex_utilts_issuer_intake.strings_v1(value jsonb,keys text[]) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$DECLARE k text;BEGIN FOREACH k IN ARRAY keys LOOP PERFORM gridex_utilts_issuer_intake.need_v1(jsonb_typeof(value->k)='string','issuer_intake_string_required');END LOOP;END$$;
CREATE FUNCTION gridex_utilts_issuer_intake.actor_v1(c uuid,a uuid,review boolean) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$DECLARE k text:=CASE WHEN review THEN 'ediel.utilts_issuer_source.review' ELSE 'ediel.utilts_issuer_source.submit' END;BEGIN
 PERFORM gridex_utilts_issuer_intake.need_v1(current_user='service_role' OR session_user='service_role' OR current_setting('role',true)='service_role','issuer_intake_service_role_required');
 PERFORM gridex_utilts_issuer_intake.need_v1(EXISTS(SELECT FROM public.companies WHERE id=c AND status='active') AND EXISTS(SELECT FROM public.user_profiles WHERE id=a AND user_status='active') AND EXISTS(SELECT FROM public.company_memberships WHERE company_id=c AND user_id=a AND status='active' AND is_active AND accepted_at IS NOT NULL)
 AND public.gridex_actor_has_company_permission(a,c,k) IS TRUE AND (
 EXISTS(SELECT FROM public.user_permissions u JOIN public.permissions p ON p.id=u.permission_id OR u.permission_id IS NULL AND p.key=u.permission_key WHERE u.user_id=a AND u.company_id=c AND u.is_active AND u.status='active' AND u.effect='allow' AND p.is_active AND p.key=k)
 OR EXISTS(SELECT FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id JOIN public.role_permissions rp ON rp.role_id=r.id JOIN public.permissions p ON p.id=rp.permission_id OR rp.permission_id IS NULL AND p.key=rp.permission_key WHERE u.user_id=a AND u.company_id=c AND u.is_active AND u.status='active' AND r.is_active AND rp.effect='allow' AND p.is_active AND p.key=k)), 'issuer_intake_actor_forbidden');END$$;
CREATE FUNCTION gridex_utilts_issuer_intake.entropy_v1() RETURNS bytea LANGUAGE plpgsql SET search_path=pg_catalog AS $$DECLARE ns text;value bytea;BEGIN
 SELECT n.nspname INTO ns FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace JOIN pg_proc p ON p.pronamespace=n.oid JOIN pg_depend d ON d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.refclassid='pg_extension'::regclass AND d.refobjid=e.oid AND d.deptype='e'
 WHERE e.extname='pgcrypto' AND p.proname='gen_random_bytes' AND oidvectortypes(p.proargtypes)='integer' AND p.prorettype='bytea'::regtype;
 IF ns IS NULL THEN RETURN NULL;END IF;
 EXECUTE format('SELECT %I.gen_random_bytes(32)',ns) INTO value;
 PERFORM gridex_utilts_issuer_intake.need_v1(octet_length(value)=32,'issuer_intake_crypto_invalid');RETURN value;END$$;
CREATE FUNCTION gridex_utilts_issuer_intake.mac_v1(bytes bytea,key_id uuid) RETURNS text LANGUAGE plpgsql SET search_path=pg_catalog AS $$DECLARE k bytea;BEGIN
 SELECT secret INTO k FROM gridex_utilts_issuer_intake.keys WHERE id=key_id;
 PERFORM gridex_utilts_issuer_intake.need_v1(octet_length(k)=32,'issuer_intake_key_required');
 RETURN encode(gridex_ediel_services.receipt_hmac_sha256_v1(bytes,k),'hex');END$$;
CREATE FUNCTION gridex_utilts_issuer_intake.originals_v1(items jsonb,kind text) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$DECLARE item jsonb;bytes bytea;roles text[];expected text[];total bigint:=0;BEGIN
 expected:=CASE kind WHEN 'prospective' THEN ARRAY['registry','legal_decision','transport_mandate'] WHEN 'test_birth' THEN ARRAY['test_policy','test_mandate','test_retention_decision','test_application_inventory'] WHEN 'test_issue' THEN ARRAY['payload'] WHEN 'test_correction' THEN ARRAY['payload'] WHEN 'test_retention' THEN ARRAY['test_retention_decision'] WHEN 'test_checkpoint' THEN ARRAY['checkpoint_approval'] ELSE ARRAY[]::text[] END;
 PERFORM gridex_utilts_issuer_intake.need_v1(jsonb_typeof(items)='array' AND jsonb_array_length(items)<=16,'issuer_intake_originals_required');
 FOR item IN SELECT value FROM jsonb_array_elements(items) LOOP
  PERFORM gridex_utilts_issuer_intake.shape_v1(item,ARRAY['role','reference','version','uri','mimeType','bytesBase64','sha256']);
  PERFORM gridex_utilts_issuer_intake.need_v1(item->>'role' ~ '^[a-z][a-z0-9_]{0,63}$' AND length(item->>'reference') BETWEEN 1 AND 2000 AND length(item->>'uri') BETWEEN 1 AND 2000 AND length(item->>'version') BETWEEN 1 AND 200 AND item->>'sha256' ~ '^[a-f0-9]{64}$','issuer_intake_original_metadata_invalid');
  PERFORM gridex_utilts_issuer_intake.strings_v1(item,ARRAY['role','reference','version','uri','mimeType','bytesBase64','sha256']);
  bytes:=decode(item->>'bytesBase64','base64');total:=total+octet_length(bytes);
  PERFORM gridex_utilts_issuer_intake.need_v1(octet_length(bytes)>0 AND total<=8388608 AND replace(encode(bytes,'base64'),E'\n','')=item->>'bytesBase64' AND encode(sha256(bytes),'hex')=item->>'sha256','issuer_intake_original_hash_invalid');
  PERFORM gridex_utilts_issuer_intake.need_v1(CASE WHEN item->>'role'='payload' THEN item->>'mimeType'='application/edifact' ELSE item->>'mimeType' IN('application/json','text/plain','application/pdf') END,'issuer_intake_mime_invalid');
 END LOOP;
 SELECT coalesce(array_agg(value->>'role' ORDER BY value->>'role'),ARRAY[]::text[]) INTO roles FROM jsonb_array_elements(items);
 PERFORM gridex_utilts_issuer_intake.need_v1(roles=(SELECT coalesce(array_agg(x ORDER BY x),ARRAY[]::text[]) FROM unnest(expected) x),'issuer_intake_original_roles_invalid');END$$;
CREATE FUNCTION gridex_utilts_issuer_intake.original_v1(items jsonb,role text) RETURNS jsonb LANGUAGE sql SET search_path=pg_catalog AS $$SELECT value FROM jsonb_array_elements(items) WHERE value->>'role'=role$$;
CREATE FUNCTION gridex_utilts_issuer_intake.epoch_v1(c uuid,e uuid) RETURNS gridex_utilts_issuer_intake.epochs LANGUAGE plpgsql SET search_path=pg_catalog AS $$DECLARE row gridex_utilts_issuer_intake.epochs%rowtype;BEGIN
 SELECT * INTO row FROM gridex_utilts_issuer_intake.epochs WHERE id=e AND company_id=c;
 PERFORM gridex_utilts_issuer_intake.need_v1(row.id IS NOT NULL,'issuer_intake_epoch_unavailable');
 -- Eligibility must be observed after both serialization locks: a revocation
 -- may commit, or validity expire, while this invocation waits for either one.
 PERFORM pg_advisory_xact_lock(hashtextextended('utilts-intake-epoch:'||e::text,0));
 PERFORM gridex_utilts_issuer.lock_namespace_v1(row.namespace_id);
 SELECT * INTO row FROM gridex_utilts_issuer_intake.epochs WHERE id=e AND company_id=c;
 PERFORM gridex_utilts_issuer_intake.need_v1(row.id IS NOT NULL AND row.valid_until>clock_timestamp()
  AND NOT EXISTS(SELECT FROM gridex_utilts_issuer_intake.revocations WHERE epoch_id=e AND target_kind IN('epoch','issuer','mandate'))
  AND NOT EXISTS(SELECT FROM gridex_utilts_issuer.revocations r WHERE r.namespace_id=row.namespace_id
   AND (r.issuer_version_id=row.issuer_id OR r.mandate_version_id=row.mandate_id)
   AND r.approved_at<=clock_timestamp() AND r.effective_at<=clock_timestamp()),'issuer_intake_epoch_unavailable');
 RETURN row;END$$;
CREATE FUNCTION gridex_utilts_issuer_intake.effect_v1(e gridex_utilts_issuer_intake.epochs) RETURNS jsonb LANGUAGE sql SET search_path=pg_catalog AS $$SELECT jsonb_build_object('epochId',e.id,'namespaceId',e.namespace_id,'issuerVersionId',e.issuer_id,'mandateVersionId',e.mandate_id,'testEpochBornAt',e.born_at,'measurementUsageFrom',e.usage_from,'measurementUsageUntil',e.usage_until,'legalIdentity',e.legal_identity,'transportSender',e.transport_sender,'retentionArtifactId',coalesce((SELECT ar.id FROM gridex_utilts_issuer_intake.artifacts ar JOIN gridex_utilts_issuer_intake.reviews rv ON rv.artifact_id=ar.id WHERE ar.kind='test_retention' AND ar.scope->>'epochId'=e.id::text AND rv.effect->>'status'='approved' ORDER BY rv.sequence DESC LIMIT 1),e.birth_artifact_id),'applicationInventorySha256',e.inventory_sha256,'applicationBindings',coalesce((SELECT jsonb_agg(jsonb_build_object('applicationReference',binding->>'applicationReference','applicationId',id,'actorUserId',actor_id,'entrySha256',binding->>'entrySha256') ORDER BY binding->>'applicationReference') FROM gridex_utilts_issuer_intake.applications WHERE epoch_id=e.id),'[]'::jsonb))$$;
CREATE FUNCTION gridex_utilts_issuer_intake.append_v1(e uuid,a uuid,artifact uuid,kind text,event jsonb,key uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$DECLARE seq bigint;previous text;bytes bytea;head text;now_at timestamptz:=clock_timestamp();BEGIN
 SELECT sequence,head_sha256 INTO seq,previous FROM gridex_utilts_issuer_intake.journal WHERE epoch_id=e ORDER BY sequence DESC LIMIT 1;
 seq:=coalesce(seq,0)+1;previous:=coalesce(previous,repeat('0',64));
 bytes:=convert_to(jsonb_build_object('version',1,'epochId',e,'sequence',seq::text,'previous',previous,'actorId',a,'artifactId',artifact,'kind',kind,'event',event,'keyId',key,'observedAt',to_char(now_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text,'UTF8');head:=encode(sha256(bytes),'hex');
 INSERT INTO gridex_utilts_issuer_intake.journal VALUES(e,seq,gen_random_uuid(),artifact,a,kind,event,previous,head,key,gridex_utilts_issuer_intake.mac_v1(bytes,key),bytes,now_at);
 RETURN jsonb_build_object('journalSequence',seq::text,'journalHeadSha256',head);END$$;
CREATE FUNCTION gridex_utilts_issuer_intake.verify_v1(e uuid) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$DECLARE row gridex_utilts_issuer_intake.journal%rowtype;seq bigint:=0;previous text:=repeat('0',64);key gridex_utilts_issuer_intake.keys%rowtype;issued gridex_utilts_issuer_intake.issuances%rowtype;a gridex_utilts_issuer_intake.artifacts%rowtype;BEGIN
 FOR row IN SELECT * FROM gridex_utilts_issuer_intake.journal WHERE epoch_id=e ORDER BY sequence LOOP
  SELECT * INTO key FROM gridex_utilts_issuer_intake.keys WHERE id=row.key_id;
  seq:=seq+1;PERFORM gridex_utilts_issuer_intake.need_v1(row.sequence=seq AND row.previous_sha256=previous AND row.head_sha256=encode(sha256(row.event_bytes),'hex') AND row.mac_hex=gridex_utilts_issuer_intake.mac_v1(row.event_bytes,row.key_id) AND key.epoch_id=e AND key.actor_id=row.actor_id AND row.event_bytes=convert_to(jsonb_build_object('version',1,'epochId',e,'sequence',row.sequence::text,'previous',row.previous_sha256,'actorId',row.actor_id,'artifactId',row.artifact_id,'kind',row.kind,'event',row.event,'keyId',row.key_id,'observedAt',to_char(row.observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text,'UTF8') AND ((row.kind='test_birth' AND key.purpose='root') OR (row.kind IN('test_issue','test_correction','test_replay') AND key.purpose='application') OR (row.kind IN('test_checkpoint','test_retention','test_delete','revoke') AND key.purpose='reviewer')),'issuer_intake_journal_mac_invalid');previous:=row.head_sha256;
 END LOOP;
 PERFORM gridex_utilts_issuer_intake.need_v1(seq>0,'issuer_intake_journal_missing');
 FOR issued IN SELECT * FROM gridex_utilts_issuer_intake.issuances WHERE epoch_id=e LOOP
  SELECT * INTO a FROM gridex_utilts_issuer_intake.artifacts WHERE id=issued.artifact_id;
  PERFORM gridex_utilts_issuer_intake.originals_v1(a.originals,a.kind);
  PERFORM gridex_utilts_issuer_intake.need_v1(issued.payload_sha256=encode(sha256(convert_to(issued.payload,'UTF8')),'hex') AND issued.mime_sha256=encode(sha256(issued.mime_bytes),'hex') AND split_part(convert_from(issued.mime_bytes,'UTF8'),E'\r\n',1)='Message-ID: '||issued.internet_message_id AND issued.payload=convert_from(decode(gridex_utilts_issuer_intake.original_v1(a.originals,'payload')->>'bytesBase64','base64'),'UTF8') AND EXISTS(SELECT FROM gridex_utilts_issuer_intake.journal j WHERE j.epoch_id=e AND j.artifact_id=issued.artifact_id AND j.event->>'issuanceId'=issued.id::text AND j.event->>'payloadSha256'=issued.payload_sha256 AND j.event->>'mimeSha256'=issued.mime_sha256),'issuer_intake_issuance_original_unavailable');
 END LOOP;END$$;
CREATE FUNCTION gridex_utilts_issuer_intake.bind_sources_v1(e gridex_utilts_issuer_intake.epochs) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$DECLARE src record;issued gridex_utilts_issuer_intake.issuances%rowtype;BEGIN
 PERFORM gridex_utilts_issuer_intake.verify_v1(e.id);
 FOR src IN SELECT a.*,s.raw_payload,s.inbound_email_message_id,m.company_id email_company,m.environment email_environment,m.mailbox_id,m.internet_message_id,m.raw_message_sha256,m.raw_email
 FROM public.ediel_messages s LEFT JOIN gridex_utilts_issuer.source_admissions a ON s.id=a.source_message_id LEFT JOIN public.inbound_email_messages m ON m.id=s.inbound_email_message_id WHERE s.direction='inbound' AND s.message_family='UTILTS' AND (a.namespace_id=e.namespace_id OR EXISTS(SELECT FROM jsonb_array_elements(gridex_utilts_binding.wire_tokens_v1(s.raw_payload)) t WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}'='MS' AND t#>'{elements,2}'=e.legal_identity)) LOOP
  SELECT * INTO issued FROM gridex_utilts_issuer_intake.issuances i WHERE i.epoch_id=e.id AND i.internet_message_id=src.internet_message_id;
  PERFORM gridex_utilts_issuer_intake.need_v1(issued.id IS NOT NULL AND src.namespace_id=e.namespace_id AND src.company_id=e.company_id AND src.environment='test' AND src.email_company=e.company_id AND src.email_environment='test' AND src.mailbox_id=e.mailbox_id AND src.issuer_version_id=e.issuer_id AND src.mandate_version_id=e.mandate_id
   AND issued.mime_sha256=src.raw_message_sha256 AND issued.mime_sha256=encode(sha256(convert_to(src.raw_email,'UTF8')),'hex') AND issued.payload=src.raw_payload AND issued.payload_sha256=src.source_payload_hash AND issued.issued_at<=src.observed_at AND EXISTS(SELECT FROM gridex_received_sources.sources protected WHERE protected.source_message_id=src.source_message_id AND protected.company_id=e.company_id AND protected.environment='test' AND protected.origin='database_insert' AND protected.raw_payload=issued.payload AND protected.payload_hash=issued.payload_sha256),'issuer_intake_unmanaged_source');
  IF EXISTS(SELECT FROM gridex_utilts_issuer_intake.source_links WHERE source_id=src.source_message_id) THEN
   PERFORM gridex_utilts_issuer_intake.need_v1(EXISTS(SELECT FROM gridex_utilts_issuer_intake.source_links WHERE source_id=src.source_message_id AND issuance_id=issued.id AND email_id=src.inbound_email_message_id AND source_sha256=src.source_payload_hash),'issuer_intake_source_link_changed');
  ELSE INSERT INTO gridex_utilts_issuer_intake.source_links VALUES(src.source_message_id,issued.id,src.inbound_email_message_id,src.source_payload_hash,clock_timestamp());END IF;
 END LOOP;
 PERFORM gridex_utilts_issuer_intake.need_v1(NOT EXISTS(SELECT FROM gridex_utilts_issuer.observed_identifiers o LEFT JOIN gridex_utilts_issuer_intake.source_links l ON l.source_id=o.source_message_id LEFT JOIN gridex_utilts_issuer_intake.issuances i ON i.id=l.issuance_id WHERE o.namespace_id=e.namespace_id AND (l.source_id IS NULL OR NOT EXISTS(SELECT FROM jsonb_array_elements(i.identifiers) x WHERE x->>'field'=o.field_number AND x->>'reference'=o.physical_reference))),'issuer_intake_unmanaged_observation');END$$;
CREATE FUNCTION gridex_utilts_issuer_intake.result_v1(id uuid,command uuid,bytes boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$DECLARE a gridex_utilts_issuer_intake.artifacts%rowtype;r gridex_utilts_issuer_intake.reviews%rowtype;out jsonb;metadata jsonb;stored jsonb;BEGIN
 SELECT * INTO a FROM gridex_utilts_issuer_intake.artifacts WHERE artifacts.id=result_v1.id;
 SELECT * INTO r FROM gridex_utilts_issuer_intake.reviews WHERE artifact_id=a.id ORDER BY sequence DESC LIMIT 1;
 out:=jsonb_build_object('version',1,'commandId',command,'companyId',a.company_id,'environment',a.environment,'kind',a.kind,'artifactId',a.id,'artifactSha256',a.artifact_sha256,'scopeSha256',a.scope_sha256,'status','archived','assurance','custody_only','reasonCodes','[]'::jsonb,'reviewId',NULL,'reviewedAt',NULL,'epochId',NULL,'namespaceId',NULL,'issuerVersionId',NULL,'mandateVersionId',NULL,'sourceMessageId',NULL,'sourcePayloadSha256',NULL,'namespaceEpoch',NULL,'issuanceId',NULL,'internetMessageId',NULL,'mimeSha256',NULL,'journalSequence',NULL,'journalHeadSha256',NULL,'marketActivationGranted',false,'productionAuthorityGranted',false,'applicationInventorySha256',NULL,'applicationBindings','[]'::jsonb,'testEpochBornAt',NULL,'measurementUsageFrom',NULL,'measurementUsageUntil',NULL,'legalIdentity','[]'::jsonb,'transportSender','[]'::jsonb,'retentionArtifactId',NULL)||a.result;
 SELECT result INTO stored FROM gridex_utilts_issuer_intake.commands WHERE commands.id=a.command_id;
 IF stored IS NOT NULL THEN out:=out||(stored-'originals');END IF;
 IF r.sequence IS NOT NULL THEN out:=out||r.effect||jsonb_build_object('reviewId',r.id,'reviewedAt',r.reviewed_at);END IF;
 out:=out||jsonb_build_object('commandId',command);
 SELECT coalesce(jsonb_agg((value-'bytesBase64')||jsonb_build_object('byteLength',octet_length(decode(value->>'bytesBase64','base64')))||CASE WHEN bytes THEN jsonb_build_object('bytesBase64',value->>'bytesBase64') ELSE '{}'::jsonb END),'[]') INTO metadata FROM jsonb_array_elements(CASE WHEN stored IS NOT NULL AND a.kind IN('test_issue','test_correction','test_replay') THEN stored->'originals' ELSE a.originals END);
 RETURN out||jsonb_build_object('originals',metadata);END$$;
CREATE FUNCTION gridex_utilts_issuer_intake.birth_shape_v1(body jsonb) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$DECLARE app jsonb;part jsonb;BEGIN
 PERFORM gridex_utilts_issuer_intake.shape_v1(body,ARRAY['legalIdentity','transportSender','validUntil','measurementUsageFrom','measurementUsageUntil','applications','mailboxId']);
 PERFORM gridex_utilts_issuer_intake.need_v1(jsonb_typeof(body->'legalIdentity')='array' AND jsonb_array_length(body->'legalIdentity') BETWEEN 3 AND 8 AND jsonb_typeof(body->'transportSender')='array' AND jsonb_array_length(body->'transportSender') BETWEEN 1 AND 8,'issuer_intake_identity_invalid');
 FOR part IN SELECT value FROM jsonb_array_elements((body->'legalIdentity')||(body->'transportSender')) LOOP PERFORM gridex_utilts_issuer_intake.need_v1(jsonb_typeof(part)='string' AND length(part#>>'{}') BETWEEN 1 AND 200,'issuer_intake_identity_invalid');END LOOP;
 PERFORM gridex_utilts_issuer_intake.strings_v1(body,ARRAY['validUntil','measurementUsageFrom','measurementUsageUntil','mailboxId']);
 PERFORM gridex_utilts_issuer_intake.need_v1((body->>'validUntil')::timestamptz>clock_timestamp() AND (body->>'validUntil')::timestamptz<=clock_timestamp()+interval '366 days' AND isfinite((body->>'validUntil')::timestamptz) AND (body->>'measurementUsageFrom')::timestamptz<(body->>'measurementUsageUntil')::timestamptz AND isfinite((body->>'measurementUsageFrom')::timestamptz) AND isfinite((body->>'measurementUsageUntil')::timestamptz),'issuer_intake_period_invalid');
 PERFORM gridex_utilts_issuer_intake.need_v1(jsonb_typeof(body->'applications')='array' AND jsonb_array_length(body->'applications') BETWEEN 1 AND 16,'issuer_intake_inventory_invalid');
 FOR app IN SELECT value FROM jsonb_array_elements(body->'applications') LOOP
  PERFORM gridex_utilts_issuer_intake.shape_v1(app,ARRAY['applicationReference','actorUserId','repository','commit','tree','entryPath','entrySha256','producerReference']);
  PERFORM gridex_utilts_issuer_intake.strings_v1(app,ARRAY['applicationReference','actorUserId','repository','commit','tree','entryPath','entrySha256','producerReference']);
  PERFORM gridex_utilts_issuer_intake.need_v1(length(app->>'applicationReference') BETWEEN 1 AND 200 AND length(app->>'repository') BETWEEN 1 AND 2000 AND app->>'commit'~'^[a-f0-9]{40}$' AND app->>'tree'~'^[a-f0-9]{40}$' AND length(app->>'entryPath') BETWEEN 1 AND 1024 AND app->>'entryPath'!~'(^/|(^|/)\.\.(/|$)|\\)' AND app->>'entrySha256'~'^[a-f0-9]{64}$' AND length(app->>'producerReference') BETWEEN 1 AND 2000 AND (app->>'actorUserId')::uuid IS NOT NULL,'issuer_intake_inventory_invalid');
 END LOOP;
 PERFORM gridex_utilts_issuer_intake.need_v1((SELECT count(DISTINCT value->>'actorUserId')=count(*) AND count(DISTINCT value->>'applicationReference')=count(*) FROM jsonb_array_elements(body->'applications')),'issuer_intake_inventory_duplicate');END$$;
CREATE FUNCTION gridex_utilts_issuer_intake.body_v1(body jsonb,kind text) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$DECLARE k text;BEGIN
 IF kind IN('test_birth','prospective') THEN PERFORM gridex_utilts_issuer_intake.birth_shape_v1(body);RETURN;
 ELSIF kind='history' THEN PERFORM gridex_utilts_issuer_intake.shape_v1(body,ARRAY['epochId','sourceMessageId','currentIssuanceId','checkpointArtifactId']);
 ELSIF kind='test_checkpoint' THEN PERFORM gridex_utilts_issuer_intake.shape_v1(body,ARRAY['epochId','expectedSequence','expectedHeadSha256','applicationInventorySha256']);
 ELSIF kind='test_retention' THEN PERFORM gridex_utilts_issuer_intake.shape_v1(body,ARRAY['epochId','retentionArtifactId','reason']);
 ELSIF kind='test_delete' THEN PERFORM gridex_utilts_issuer_intake.shape_v1(body,ARRAY['epochId','applicationId','issuanceId','reason','retentionArtifactId']);
 ELSIF kind='test_replay' THEN PERFORM gridex_utilts_issuer_intake.shape_v1(body,ARRAY['epochId','applicationId','issuanceId']);
 ELSIF kind='test_correction' THEN PERFORM gridex_utilts_issuer_intake.shape_v1(body,ARRAY['epochId','applicationId','mailboxId','fromAddress','toAddress','payloadOriginalRole','priorIssuanceId']);
 ELSE PERFORM gridex_utilts_issuer_intake.shape_v1(body,ARRAY['epochId','applicationId','mailboxId','fromAddress','toAddress','payloadOriginalRole']);END IF;
 FOR k IN SELECT jsonb_object_keys(body) LOOP
  PERFORM gridex_utilts_issuer_intake.strings_v1(body,ARRAY[k]);
  IF k LIKE '%Id' THEN PERFORM gridex_utilts_issuer_intake.need_v1((body->>k)::uuid IS NOT NULL,'issuer_intake_uuid_required');END IF;
 END LOOP;
 IF kind='test_checkpoint' THEN PERFORM gridex_utilts_issuer_intake.need_v1(body->>'expectedSequence'~'^[1-9][0-9]{0,18}$' AND body->>'expectedHeadSha256'~'^[a-f0-9]{64}$' AND body->>'applicationInventorySha256'~'^[a-f0-9]{64}$','issuer_intake_checkpoint_invalid');END IF;
 IF kind IN('test_delete','test_retention') THEN PERFORM gridex_utilts_issuer_intake.need_v1(length(btrim(body->>'reason')) BETWEEN 1 AND 2000,'issuer_intake_reason_invalid');END IF;END$$;
CREATE FUNCTION gridex_utilts_issuer_intake.instant_v1(value text,format text,utc_offset text DEFAULT '+0000') RETURNS timestamptz LANGUAGE plpgsql SET search_path=pg_catalog AS $$DECLARE stamp text;zone text;hours integer;minutes integer;sign integer;local_stamp timestamptz;BEGIN
 IF format='102' THEN PERFORM gridex_utilts_issuer_intake.need_v1(value~'^[0-9]{8}$','issuer_intake_usage_format_unverified');stamp:=value||'0000';zone:=utc_offset;
 ELSIF format='203' THEN PERFORM gridex_utilts_issuer_intake.need_v1(value~'^[0-9]{12}$','issuer_intake_usage_format_unverified');stamp:=value;zone:=utc_offset;
 ELSIF format='303' THEN PERFORM gridex_utilts_issuer_intake.need_v1(value~'^[0-9]{12}[+-][0-9]{4}$','issuer_intake_usage_format_unverified');stamp:=left(value,12);zone:=right(value,5);
 ELSE PERFORM gridex_utilts_issuer_intake.need_v1(false,'issuer_intake_usage_format_unverified');END IF;
 PERFORM gridex_utilts_issuer_intake.need_v1(zone~'^[+-][0-9]{4}$','issuer_intake_usage_offset_invalid');hours:=substring(zone FROM 2 FOR 2)::integer;minutes:=substring(zone FROM 4 FOR 2)::integer;sign:=CASE left(zone,1) WHEN '-' THEN -1 ELSE 1 END;
 PERFORM gridex_utilts_issuer_intake.need_v1(hours<=14 AND minutes<60 AND (hours<14 OR minutes=0),'issuer_intake_usage_offset_invalid');
 -- make_timestamptz rejects invalid calendars/hours; unlike to_timestamp it cannot silently normalize dates.
 local_stamp:=make_timestamptz(substring(stamp FROM 1 FOR 4)::integer,substring(stamp FROM 5 FOR 2)::integer,substring(stamp FROM 7 FOR 2)::integer,substring(stamp FROM 9 FOR 2)::integer,substring(stamp FROM 11 FOR 2)::integer,0,'UTC');
 PERFORM gridex_utilts_issuer_intake.need_v1(to_char(local_stamp AT TIME ZONE 'UTC','YYYYMMDDHH24MI')=stamp,'issuer_intake_usage_calendar_invalid');RETURN local_stamp-make_interval(mins=>sign*(hours*60+minutes));END$$;
CREATE FUNCTION gridex_utilts_issuer_intake.issue_v1(a gridex_utilts_issuer_intake.artifacts) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$DECLARE e gridex_utilts_issuer_intake.epochs%rowtype;app gridex_utilts_issuer_intake.applications%rowtype;key uuid;payload text;tokens jsonb;wire jsonb;legal jsonb;identifiers jsonb;mime bytea;issuance uuid:=gen_random_uuid();mid text;effect jsonb;prior uuid;token jsonb;dt text;instant timestamptz;period_end timestamptz;format text;utc_offset text;BEGIN
 IF a.kind='test_correction' THEN PERFORM gridex_utilts_issuer_intake.shape_v1(a.scope,ARRAY['epochId','applicationId','mailboxId','fromAddress','toAddress','payloadOriginalRole','priorIssuanceId']);prior:=(a.scope->>'priorIssuanceId')::uuid;
 ELSE PERFORM gridex_utilts_issuer_intake.shape_v1(a.scope,ARRAY['epochId','applicationId','mailboxId','fromAddress','toAddress','payloadOriginalRole']);END IF;
 PERFORM gridex_utilts_issuer_intake.strings_v1(a.scope,ARRAY['epochId','applicationId','mailboxId','fromAddress','toAddress','payloadOriginalRole']);
 e:=gridex_utilts_issuer_intake.epoch_v1(a.company_id,(a.scope->>'epochId')::uuid);
 SELECT * INTO app FROM gridex_utilts_issuer_intake.applications WHERE id=(a.scope->>'applicationId')::uuid AND epoch_id=e.id AND actor_id=a.submitted_by;
 PERFORM gridex_utilts_issuer_intake.need_v1(app.id IS NOT NULL AND NOT EXISTS(SELECT FROM gridex_utilts_issuer_intake.revocations WHERE epoch_id=e.id AND target_kind='application' AND target_id=app.id),'issuer_intake_application_required');
 PERFORM gridex_utilts_issuer_intake.need_v1((a.scope->>'mailboxId')::uuid=e.mailbox_id AND a.scope->>'payloadOriginalRole'='payload' AND length(a.scope->>'fromAddress') BETWEEN 1 AND 320 AND a.scope->>'fromAddress'~'^[!-~]+$' AND length(a.scope->>'toAddress') BETWEEN 1 AND 320 AND a.scope->>'toAddress'~'^[!-~]+$' AND EXISTS(SELECT FROM public.ediel_mailboxes WHERE id=e.mailbox_id AND company_id=e.company_id AND environment='test' AND is_active AND email_address=a.scope->>'toAddress'),'issuer_intake_mailbox_scope_invalid');
 IF prior IS NOT NULL THEN PERFORM gridex_utilts_issuer_intake.need_v1(EXISTS(SELECT FROM gridex_utilts_issuer_intake.issuances WHERE id=prior AND epoch_id=e.id),'issuer_intake_prior_issuance_invalid');END IF;
 payload:=convert_from(decode(gridex_utilts_issuer_intake.original_v1(a.originals,'payload')->>'bytesBase64','base64'),'UTF8');tokens:=gridex_utilts_binding.wire_tokens_v1(payload);wire:=gridex_ack_authority.wire_v1(payload);
 SELECT x#>'{elements,2}' INTO legal FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='NAD' AND x#>>'{elements,1,0}'='MS';
 PERFORM gridex_utilts_issuer_intake.need_v1(wire->>'family'='UTILTS' AND wire->>'environment'='test' AND wire->'sender'=e.transport_sender AND legal=e.legal_identity AND (SELECT count(*) FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='NAD' AND x#>>'{elements,1,0}'='MS')=1 AND nullif(wire->>'document','') IS NOT NULL,'issuer_intake_physical_issuer_invalid');
 -- Usage dates are test observations, never issuer/approval/issue birth times.
 PERFORM gridex_utilts_issuer_intake.need_v1((SELECT count(*) FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='DTM' AND x#>>'{elements,1,0}'='735')<=1,'issuer_intake_usage_offset_invalid');
 SELECT x#>>'{elements,1,1}' INTO utc_offset FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='DTM' AND x#>>'{elements,1,0}'='735';
 IF utc_offset IS NOT NULL THEN PERFORM gridex_utilts_issuer_intake.need_v1(EXISTS(SELECT FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='DTM' AND x#>>'{elements,1,0}'='735' AND x#>>'{elements,1,2}'='406'),'issuer_intake_usage_format_unverified');END IF;
 utc_offset:=coalesce(utc_offset,'+0000');
 FOR token IN SELECT value FROM jsonb_array_elements(tokens) WHERE value->>'tag'='DTM' AND value#>>'{elements,1,0}' IN('163','164','324','597') LOOP
  dt:=token#>>'{elements,1,1}';format:=token#>>'{elements,1,2}';
  IF format='719' THEN
   PERFORM gridex_utilts_issuer_intake.need_v1(token#>>'{elements,1,0}'='324' AND dt~'^[0-9]{24}$','issuer_intake_usage_format_unverified');
   instant:=gridex_utilts_issuer_intake.instant_v1(left(dt,12),'203',utc_offset);period_end:=gridex_utilts_issuer_intake.instant_v1(right(dt,12),'203',utc_offset);
   PERFORM gridex_utilts_issuer_intake.need_v1(instant<period_end,'issuer_intake_usage_period_invalid');
  ELSE instant:=gridex_utilts_issuer_intake.instant_v1(dt,format,utc_offset);period_end:=instant;END IF;
  PERFORM gridex_utilts_issuer_intake.need_v1(instant>=e.usage_from AND period_end<=e.usage_until,'issuer_intake_usage_out_of_scope');
 END LOOP;
 SELECT jsonb_build_array(jsonb_build_object('field','203','reference',wire->>'document'))||coalesce(jsonb_agg(jsonb_build_object('field','505','reference',x#>>'{elements,2,0}')) FILTER(WHERE x->>'tag'='IDE'),'[]') INTO identifiers FROM jsonb_array_elements(tokens) x;
 mid:='<'||issuance::text||'@test.gridex.invalid>';
 mime:=convert_to('Message-ID: '||mid||E'\r\nDate: '||to_char(clock_timestamp() AT TIME ZONE 'UTC','Dy, DD Mon YYYY HH24:MI:SS')||E' +0000\r\nFrom: '||(a.scope->>'fromAddress')||E'\r\nTo: '||(a.scope->>'toAddress')||E'\r\nMIME-Version: 1.0\r\nContent-Type: application/edifact; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n'||payload,'UTF8');
 INSERT INTO gridex_utilts_issuer_intake.issuances VALUES(issuance,e.id,app.id,a.id,mid,mime,encode(sha256(mime),'hex'),payload,encode(sha256(convert_to(payload,'UTF8')),'hex'),identifiers,prior,clock_timestamp());
 SELECT id INTO key FROM gridex_utilts_issuer_intake.keys WHERE epoch_id=e.id AND application_id=app.id AND purpose='application';
 effect:=gridex_utilts_issuer_intake.effect_v1(e)||jsonb_build_object('status','issued','assurance','controlled_test_only','issuanceId',issuance,'internetMessageId',mid,'mimeSha256',encode(sha256(mime),'hex'))||gridex_utilts_issuer_intake.append_v1(e.id,a.submitted_by,a.id,a.kind,jsonb_build_object('issuanceId',issuance,'payloadSha256',encode(sha256(convert_to(payload,'UTF8')),'hex'),'mimeSha256',encode(sha256(mime),'hex'),'priorIssuanceId',prior),key);
 RETURN effect||jsonb_build_object('originals',jsonb_build_array(jsonb_build_object('role','issued_mime','reference',issuance::text,'version','1','uri','test:issuance:'||issuance::text,'mimeType','message/rfc822','bytesBase64',replace(encode(mime,'base64'),E'\n',''),'sha256',encode(sha256(mime),'hex'),'byteLength',octet_length(mime))));END$$;
CREATE FUNCTION public.archive_utilts_issuer_source_v1(p_company_id uuid,p_actor_user_id uuid,p_submission jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$DECLARE a gridex_utilts_issuer_intake.artifacts%rowtype;command uuid;input_hash text;prior gridex_utilts_issuer_intake.commands%rowtype;result jsonb;e gridex_utilts_issuer_intake.epochs%rowtype;issued gridex_utilts_issuer_intake.issuances%rowtype;key uuid;BEGIN
 PERFORM gridex_utilts_issuer_intake.actor_v1(p_company_id,p_actor_user_id,false);
 PERFORM gridex_utilts_issuer_intake.shape_v1(p_submission,ARRAY['version','commandId','environment','kind','body','originals']);
 PERFORM gridex_utilts_issuer_intake.need_v1(p_submission->'version'='1'::jsonb AND p_submission->>'environment' IN('test','production') AND p_submission->>'kind' IN('prospective','history','test_birth','test_issue','test_replay','test_correction','test_delete','test_retention','test_checkpoint'),'issuer_intake_submission_invalid');
 PERFORM gridex_utilts_issuer_intake.need_v1(p_submission->>'environment'='test' OR p_submission->>'kind'='prospective','issuer_intake_test_only');
 command:=(p_submission->>'commandId')::uuid;input_hash:=gridex_utilts_issuer_intake.sha_v1(p_submission);PERFORM pg_advisory_xact_lock(hashtextextended('utilts-intake-command:'||command::text,0));
 SELECT * INTO prior FROM gridex_utilts_issuer_intake.commands WHERE id=command;
 IF prior.id IS NOT NULL THEN PERFORM gridex_utilts_issuer_intake.need_v1(prior.company_id=p_company_id AND prior.actor_id=p_actor_user_id AND prior.operation='archive' AND prior.input_sha256=input_hash,'issuer_intake_command_conflict');RETURN prior.result;END IF;
 PERFORM gridex_utilts_issuer_intake.originals_v1(p_submission->'originals',p_submission->>'kind');
 PERFORM gridex_utilts_issuer_intake.body_v1(p_submission->'body',p_submission->>'kind');
 a.id:=gen_random_uuid();a.command_id:=command;a.company_id:=p_company_id;a.environment:=p_submission->>'environment';a.kind:=p_submission->>'kind';a.scope:=p_submission->'body';a.scope_sha256:=gridex_utilts_issuer_intake.sha_v1(a.scope);a.originals:=p_submission->'originals';a.artifact_sha256:=input_hash;a.submitted_by:=p_actor_user_id;a.archived_at:=clock_timestamp();a.result:='{}';
 INSERT INTO gridex_utilts_issuer_intake.artifacts VALUES(a.*);
 IF a.kind IN('test_issue','test_correction') THEN result:=gridex_utilts_issuer_intake.issue_v1(a);
 ELSIF a.kind='test_replay' THEN
  PERFORM gridex_utilts_issuer_intake.shape_v1(a.scope,ARRAY['epochId','applicationId','issuanceId']);e:=gridex_utilts_issuer_intake.epoch_v1(p_company_id,(a.scope->>'epochId')::uuid);
  SELECT * INTO issued FROM gridex_utilts_issuer_intake.issuances WHERE id=(a.scope->>'issuanceId')::uuid AND epoch_id=e.id AND application_id=(a.scope->>'applicationId')::uuid;
  PERFORM gridex_utilts_issuer_intake.need_v1(EXISTS(SELECT FROM gridex_utilts_issuer_intake.applications WHERE id=issued.application_id AND actor_id=p_actor_user_id) AND NOT EXISTS(SELECT FROM gridex_utilts_issuer_intake.revocations WHERE epoch_id=e.id AND target_kind='application' AND target_id=issued.application_id),'issuer_intake_application_required');
  SELECT id INTO key FROM gridex_utilts_issuer_intake.keys WHERE application_id=issued.application_id AND purpose='application';
  result:=gridex_utilts_issuer_intake.effect_v1(e)||jsonb_build_object('status','issued','assurance','controlled_test_only','issuanceId',issued.id,'internetMessageId',issued.internet_message_id,'mimeSha256',issued.mime_sha256)||gridex_utilts_issuer_intake.append_v1(e.id,p_actor_user_id,a.id,'test_replay',jsonb_build_object('issuanceId',issued.id),key)||jsonb_build_object('originals',jsonb_build_array(jsonb_build_object('role','issued_mime','reference',issued.id::text,'version','1','uri','test:issuance:'||issued.id::text,'mimeType','message/rfc822','bytesBase64',replace(encode(issued.mime_bytes,'base64'),E'\n',''),'sha256',issued.mime_sha256,'byteLength',octet_length(issued.mime_bytes))));
 ELSE result:='{}';END IF;
 result:=gridex_utilts_issuer_intake.result_v1(a.id,command,false)||result;
 INSERT INTO gridex_utilts_issuer_intake.commands VALUES(command,p_company_id,p_actor_user_id,'archive',input_hash,result,clock_timestamp());RETURN result;END$$;
CREATE FUNCTION gridex_utilts_issuer_intake.birth_v1(a gridex_utilts_issuer_intake.artifacts,actor uuid,review jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$DECLARE epoch uuid:=gen_random_uuid();root uuid:=gen_random_uuid();ns uuid:=gen_random_uuid();issuer uuid:=gen_random_uuid();mandate uuid:=gen_random_uuid();root_key uuid:=gen_random_uuid();review_key uuid:=gen_random_uuid();root_secret bytea;review_secret bytea;app_secret bytea;app jsonb;app_id uuid;key_id uuid;now_at timestamptz:=clock_timestamp();legal_original jsonb;mandate_original jsonb;registry_bytes bytea;decision_bytes bytea;mandate_bytes bytea;e gridex_utilts_issuer_intake.epochs%rowtype;BEGIN
 PERFORM gridex_utilts_issuer_intake.birth_shape_v1(a.scope);
 PERFORM gridex_utilts_issuer_intake.need_v1(gridex_utilts_issuer_intake.original_v1(a.originals,'test_application_inventory')->>'mimeType'='application/json' AND convert_from(decode(gridex_utilts_issuer_intake.original_v1(a.originals,'test_application_inventory')->>'bytesBase64','base64'),'UTF8')::jsonb=a.scope->'applications','issuer_intake_inventory_original_mismatch');
 PERFORM gridex_utilts_issuer_intake.need_v1(actor<>a.submitted_by AND NOT EXISTS(SELECT FROM jsonb_array_elements(a.scope->'applications') x WHERE (x->>'actorUserId')::uuid=actor),'issuer_intake_separate_reviewer_required');
 PERFORM gridex_utilts_issuer_intake.need_v1(EXISTS(SELECT FROM public.ediel_mailboxes WHERE id=(a.scope->>'mailboxId')::uuid AND company_id=a.company_id AND environment='test' AND is_active),'issuer_intake_mailbox_scope_invalid');
 PERFORM gridex_utilts_issuer.lock_legal_identity_v1('test',a.scope->'legalIdentity');
 PERFORM gridex_utilts_issuer_intake.need_v1(NOT EXISTS(SELECT FROM gridex_utilts_issuer.issuer_versions WHERE legal_identity=a.scope->'legalIdentity') AND NOT EXISTS(SELECT FROM public.tenant_actor_identifiers WHERE identifier_value=a.scope#>>'{legalIdentity,0}') AND NOT EXISTS(SELECT FROM public.platform_actor_identifiers WHERE identifier_value=a.scope#>>'{legalIdentity,0}') AND NOT EXISTS(
  SELECT FROM public.ediel_messages s CROSS JOIN LATERAL jsonb_array_elements(gridex_utilts_binding.wire_tokens_v1(s.raw_payload)) t WHERE s.direction='inbound' AND t->>'tag'='NAD' AND t#>>'{elements,1,0}'='MS' AND t#>'{elements,2}'=a.scope->'legalIdentity'),'issuer_intake_identity_already_existed');
 root_secret:=gridex_utilts_issuer_intake.entropy_v1();review_secret:=gridex_utilts_issuer_intake.entropy_v1();
 IF root_secret IS NULL OR review_secret IS NULL THEN RETURN jsonb_build_object('status','held','reasonCodes',jsonb_build_array('crypto_unavailable'));END IF;
 legal_original:=gridex_utilts_issuer_intake.original_v1(a.originals,'test_policy');mandate_original:=gridex_utilts_issuer_intake.original_v1(a.originals,'test_mandate');registry_bytes:=decode(legal_original->>'bytesBase64','base64');mandate_bytes:=decode(mandate_original->>'bytesBase64','base64');
 decision_bytes:=convert_to(jsonb_build_object('assurance','CONTROLLED_SYNTHETIC_TEST_ONLY','review',review,'actorId',actor,'observedAt',now_at,'artifactSha256',a.artifact_sha256)::text,'UTF8');
 INSERT INTO gridex_utilts_issuer.namespaces VALUES(ns,'test','CONTROLLED-TEST:'||root::text,now_at);
 INSERT INTO gridex_utilts_issuer.issuer_versions VALUES(issuer,ns,a.scope->'legalIdentity',legal_original->>'version',legal_original->>'uri',registry_bytes,encode(sha256(registry_bytes),'hex'),'test:review:'||a.id::text,'1',decision_bytes,encode(sha256(decision_bytes),'hex'),now_at,(a.scope->>'validUntil')::timestamptz,now_at,actor);
 INSERT INTO gridex_utilts_issuer.transport_mandate_versions VALUES(mandate,issuer,a.scope->'transportSender',mandate_original->>'reference',mandate_original->>'version',mandate_original->>'uri',mandate_bytes,encode(sha256(mandate_bytes),'hex'),now_at,(a.scope->>'validUntil')::timestamptz,now_at,actor);
 INSERT INTO gridex_utilts_issuer_intake.epochs VALUES(epoch,root,a.company_id,a.id,ns,issuer,mandate,(a.scope->>'mailboxId')::uuid,a.scope->'legalIdentity',a.scope->'transportSender',(SELECT gridex_utilts_issuer_intake.sha_v1(jsonb_agg(value ORDER BY value->>'applicationReference')) FROM jsonb_array_elements(a.scope->'applications')),(a.scope->>'measurementUsageFrom')::timestamptz,(a.scope->>'measurementUsageUntil')::timestamptz,(a.scope->>'validUntil')::timestamptz,a.submitted_by,actor,now_at);
 INSERT INTO gridex_utilts_issuer_intake.keys VALUES(root_key,epoch,a.submitted_by,'root',NULL,root_secret,now_at),(review_key,epoch,actor,'reviewer',NULL,review_secret,now_at);
 FOR app IN SELECT value FROM jsonb_array_elements(a.scope->'applications') LOOP
  PERFORM gridex_utilts_issuer_intake.actor_v1(a.company_id,(app->>'actorUserId')::uuid,false);app_secret:=gridex_utilts_issuer_intake.entropy_v1();
  PERFORM gridex_utilts_issuer_intake.need_v1(octet_length(app_secret)=32,'issuer_intake_crypto_unavailable');app_id:=gen_random_uuid();key_id:=gen_random_uuid();
  INSERT INTO gridex_utilts_issuer_intake.applications VALUES(app_id,epoch,(app->>'actorUserId')::uuid,app);
  INSERT INTO gridex_utilts_issuer_intake.keys VALUES(key_id,epoch,(app->>'actorUserId')::uuid,'application',app_id,app_secret,clock_timestamp());
 END LOOP;
 SELECT * INTO e FROM gridex_utilts_issuer_intake.epochs WHERE id=epoch;
 RETURN gridex_utilts_issuer_intake.effect_v1(e)||jsonb_build_object('status','approved','assurance','controlled_test_only')||gridex_utilts_issuer_intake.append_v1(epoch,a.submitted_by,a.id,'test_birth',jsonb_build_object('rootId',root,'inventorySha256',e.inventory_sha256,'reviewActorId',actor,'reviewKeyId',review_key,'observedAt',now_at),root_key);END$$;
CREATE FUNCTION gridex_utilts_issuer_intake.checkpoint_v1(a gridex_utilts_issuer_intake.artifacts,actor uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$DECLARE e gridex_utilts_issuer_intake.epochs%rowtype;seq bigint;head text;manifest bytea;deletions bytea;seal bytea;key uuid;secret bytea;BEGIN
 PERFORM gridex_utilts_issuer_intake.shape_v1(a.scope,ARRAY['epochId','expectedSequence','expectedHeadSha256','applicationInventorySha256']);e:=gridex_utilts_issuer_intake.epoch_v1(a.company_id,(a.scope->>'epochId')::uuid);
 PERFORM gridex_utilts_issuer_intake.need_v1(actor<>a.submitted_by AND actor<>e.submitted_by AND NOT EXISTS(SELECT FROM gridex_utilts_issuer_intake.applications WHERE epoch_id=e.id AND actor_id=actor),'issuer_intake_separate_reviewer_required');
 PERFORM gridex_utilts_issuer_intake.bind_sources_v1(e);
 SELECT sequence,head_sha256 INTO seq,head FROM gridex_utilts_issuer_intake.journal WHERE epoch_id=e.id ORDER BY sequence DESC LIMIT 1;
 PERFORM gridex_utilts_issuer_intake.need_v1(jsonb_typeof(a.scope->'expectedSequence')='string' AND a.scope->>'expectedSequence'=seq::text AND a.scope->>'expectedHeadSha256'=head AND a.scope->>'applicationInventorySha256'=e.inventory_sha256,'issuer_intake_checkpoint_cutoff_changed');
 PERFORM gridex_utilts_issuer_intake.need_v1(e.inventory_sha256=(SELECT gridex_utilts_issuer_intake.sha_v1(jsonb_agg(binding ORDER BY (binding->>'applicationReference'))) FROM gridex_utilts_issuer_intake.applications WHERE epoch_id=e.id),'issuer_intake_inventory_changed');
 SELECT id INTO key FROM gridex_utilts_issuer_intake.keys WHERE epoch_id=e.id AND actor_id=actor AND purpose='reviewer';
 IF key IS NULL THEN secret:=gridex_utilts_issuer_intake.entropy_v1();IF secret IS NULL THEN RETURN jsonb_build_object('status','held','reasonCodes',jsonb_build_array('crypto_unavailable'));END IF;key:=gen_random_uuid();INSERT INTO gridex_utilts_issuer_intake.keys VALUES(key,e.id,actor,'reviewer',NULL,secret,clock_timestamp());END IF;
 SELECT convert_to(coalesce(jsonb_agg(jsonb_build_object('sequence',sequence::text,'head',head_sha256,'event',event,'kind',kind) ORDER BY sequence),'[]')::text,'UTF8') INTO manifest FROM gridex_utilts_issuer_intake.journal WHERE epoch_id=e.id AND sequence<=seq;
 SELECT convert_to(coalesce(jsonb_agg(jsonb_build_object('sequence',sequence::text,'event',event) ORDER BY sequence),'[]')::text,'UTF8') INTO deletions FROM gridex_utilts_issuer_intake.journal WHERE epoch_id=e.id AND sequence<=seq AND kind IN('test_delete','test_retention');
 seal:=convert_to(jsonb_build_object('version',1,'epochId',e.id,'artifactId',a.id,'cutoffSequence',seq::text,'cutoffHead',head,'inventorySha256',e.inventory_sha256,'reviewActorId',actor,'keyId',key,'manifestSha256',encode(sha256(manifest),'hex'),'deletionSha256',encode(sha256(deletions),'hex'),'approvalSha256',a.artifact_sha256)::text,'UTF8');
 INSERT INTO gridex_utilts_issuer_intake.checkpoints VALUES(a.id,e.id,seq,head,e.inventory_sha256,actor,key,seal,gridex_utilts_issuer_intake.mac_v1(seal,key),manifest,deletions,clock_timestamp());
 PERFORM gridex_utilts_issuer_intake.append_v1(e.id,actor,a.id,'test_checkpoint',jsonb_build_object('cutoffSequence',seq::text,'cutoffHead',head,'checkpointMac',gridex_utilts_issuer_intake.mac_v1(seal,key)),key);
 RETURN gridex_utilts_issuer_intake.effect_v1(e)||jsonb_build_object('status','approved','assurance','controlled_test_only','journalSequence',seq::text,'journalHeadSha256',head);END$$;
CREATE FUNCTION gridex_utilts_issuer_intake.history_v1(a gridex_utilts_issuer_intake.artifacts,actor uuid,review jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$DECLARE e gridex_utilts_issuer_intake.epochs%rowtype;cp gridex_utilts_issuer_intake.checkpoints%rowtype;admission gridex_utilts_issuer.source_admissions%rowtype;current_issue gridex_utilts_issuer_intake.issuances%rowtype;normalized jsonb;retention jsonb;retention_bytes bytea;approval bytea;BEGIN
 PERFORM gridex_utilts_issuer_intake.shape_v1(a.scope,ARRAY['epochId','sourceMessageId','currentIssuanceId','checkpointArtifactId']);e:=gridex_utilts_issuer_intake.epoch_v1(a.company_id,(a.scope->>'epochId')::uuid);
 PERFORM gridex_utilts_issuer_intake.need_v1(actor<>a.submitted_by AND actor<>e.submitted_by AND NOT EXISTS(SELECT FROM gridex_utilts_issuer_intake.applications WHERE epoch_id=e.id AND actor_id=actor),'issuer_intake_separate_reviewer_required');
 PERFORM gridex_utilts_issuer_intake.bind_sources_v1(e);
 SELECT * INTO admission FROM gridex_utilts_issuer.source_admissions WHERE source_message_id=(a.scope->>'sourceMessageId')::uuid AND company_id=a.company_id AND environment='test';
 SELECT * INTO current_issue FROM gridex_utilts_issuer_intake.issuances WHERE id=(a.scope->>'currentIssuanceId')::uuid AND epoch_id=e.id;
 PERFORM gridex_utilts_issuer_intake.need_v1(admission.namespace_id=e.namespace_id AND admission.issuer_version_id=e.issuer_id AND admission.mandate_version_id=e.mandate_id AND EXISTS(SELECT FROM gridex_utilts_issuer_intake.source_links WHERE source_id=admission.source_message_id AND issuance_id=current_issue.id AND source_sha256=admission.source_payload_hash),'issuer_intake_source_scope_invalid');
 SELECT * INTO cp FROM gridex_utilts_issuer_intake.checkpoints WHERE artifact_id=(a.scope->>'checkpointArtifactId')::uuid AND epoch_id=e.id;
 PERFORM gridex_utilts_issuer_intake.need_v1(cp.artifact_id IS NOT NULL AND cp.actor_id<>a.submitted_by AND cp.inventory_sha256=e.inventory_sha256 AND cp.mac_hex=gridex_utilts_issuer_intake.mac_v1(cp.seal_bytes,cp.key_id) AND cp.sealed_at>=admission.observed_at AND NOT EXISTS(SELECT FROM gridex_utilts_issuer_intake.journal WHERE epoch_id=e.id AND observed_at<=admission.observed_at AND sequence>cp.cutoff_sequence),'issuer_intake_history_checkpoint_required');
 PERFORM gridex_utilts_issuer_intake.need_v1(NOT EXISTS(SELECT FROM gridex_utilts_issuer.source_absence_grounds WHERE source_message_id=admission.source_message_id),'issuer_intake_source_already_grounded');
 SELECT coalesce(jsonb_agg(jsonb_build_object('field',identity->>'field','reference',identity->>'reference','originalIssuanceReference',i.id::text,'originalSourceSha256',i.payload_sha256,'originEvidenceSha256',j.head_sha256) ORDER BY i.issued_at,i.id,identity->>'field',identity->>'reference'),'[]') INTO normalized FROM gridex_utilts_issuer_intake.issuances i JOIN gridex_utilts_issuer_intake.journal j ON j.artifact_id=i.artifact_id CROSS JOIN LATERAL jsonb_array_elements(i.identifiers) identity WHERE i.epoch_id=e.id AND i.id<>current_issue.id AND i.issued_at<=admission.observed_at AND j.sequence<=cp.cutoff_sequence;
 SELECT gridex_utilts_issuer_intake.original_v1(ar.originals,'test_retention_decision') INTO retention FROM gridex_utilts_issuer_intake.artifacts ar JOIN gridex_utilts_issuer_intake.reviews r ON r.artifact_id=ar.id WHERE ar.kind='test_retention' AND ar.company_id=a.company_id AND ar.scope->>'epochId'=e.id::text AND r.effect->>'status'='approved' AND r.reviewed_at<=admission.observed_at ORDER BY r.sequence DESC LIMIT 1;
 IF retention IS NULL THEN SELECT gridex_utilts_issuer_intake.original_v1(originals,'test_retention_decision') INTO retention FROM gridex_utilts_issuer_intake.artifacts WHERE id=e.birth_artifact_id;END IF;retention_bytes:=decode(retention->>'bytesBase64','base64');
 approval:=convert_to(jsonb_build_object('assurance','CONTROLLED_SYNTHETIC_TEST_ONLY','actorId',actor,'review',review,'observedAt',clock_timestamp(),'sourceMessageId',admission.source_message_id,'sourceSha256',admission.source_payload_hash,'checkpointArtifactId',cp.artifact_id,'checkpointMac',cp.mac_hex)::text,'UTF8');
 INSERT INTO gridex_utilts_issuer.source_absence_grounds VALUES(admission.source_message_id,admission.source_payload_hash,e.namespace_id,e.issuer_id,e.mandate_id,admission.namespace_epoch,'over_time_all_issuer_applications','other_prior_issued_originals','controlled-test-journal-v1','test:checkpoint:'||cp.artifact_id::text,cp.manifest_bytes,encode(sha256(cp.manifest_bytes),'hex'),'controlled-test-deletions-v1','test:checkpoint:'||cp.artifact_id::text,cp.deletion_bytes,encode(sha256(cp.deletion_bytes),'hex'),retention->>'reference',retention->>'version',retention_bytes,encode(sha256(retention_bytes),'hex'),normalized,'test:review:'||a.id::text,'1',approval,encode(sha256(approval),'hex'),clock_timestamp(),actor);
 RETURN gridex_utilts_issuer_intake.effect_v1(e)||jsonb_build_object('status','approved','assurance','controlled_test_only','sourceMessageId',admission.source_message_id,'sourcePayloadSha256',admission.source_payload_hash,'namespaceEpoch',admission.namespace_epoch::text,'journalSequence',cp.cutoff_sequence::text,'journalHeadSha256',cp.cutoff_head);END$$;
CREATE FUNCTION gridex_utilts_issuer_intake.lifecycle_v1(a gridex_utilts_issuer_intake.artifacts,actor uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$DECLARE e gridex_utilts_issuer_intake.epochs%rowtype;key uuid;secret bytea;retention uuid;issued gridex_utilts_issuer_intake.issuances%rowtype;BEGIN
 IF a.kind='test_retention' THEN PERFORM gridex_utilts_issuer_intake.shape_v1(a.scope,ARRAY['epochId','retentionArtifactId','reason']);
 ELSE PERFORM gridex_utilts_issuer_intake.shape_v1(a.scope,ARRAY['epochId','applicationId','issuanceId','reason','retentionArtifactId']);END IF;
 e:=gridex_utilts_issuer_intake.epoch_v1(a.company_id,(a.scope->>'epochId')::uuid);
 PERFORM gridex_utilts_issuer_intake.need_v1(length(btrim(a.scope->>'reason')) BETWEEN 1 AND 2000 AND actor<>a.submitted_by AND actor<>e.submitted_by AND NOT EXISTS(SELECT FROM gridex_utilts_issuer_intake.applications WHERE epoch_id=e.id AND actor_id=actor),'issuer_intake_separate_reviewer_required');
 retention:=(a.scope->>'retentionArtifactId')::uuid;
 PERFORM gridex_utilts_issuer_intake.need_v1(retention=e.birth_artifact_id OR EXISTS(SELECT FROM gridex_utilts_issuer_intake.artifacts ar JOIN gridex_utilts_issuer_intake.reviews r ON r.artifact_id=ar.id WHERE ar.id=retention AND ar.company_id=a.company_id AND ar.kind='test_retention' AND ar.scope->>'epochId'=e.id::text AND r.effect->>'status'='approved'),'issuer_intake_retention_approval_required');
 IF a.kind='test_delete' THEN
  SELECT * INTO issued FROM gridex_utilts_issuer_intake.issuances WHERE id=(a.scope->>'issuanceId')::uuid AND epoch_id=e.id AND application_id=(a.scope->>'applicationId')::uuid;
  PERFORM gridex_utilts_issuer_intake.need_v1(issued.id IS NOT NULL AND EXISTS(SELECT FROM gridex_utilts_issuer_intake.applications WHERE id=issued.application_id AND actor_id=a.submitted_by),'issuer_intake_application_required');
 END IF;
 SELECT id INTO key FROM gridex_utilts_issuer_intake.keys WHERE epoch_id=e.id AND actor_id=actor AND purpose='reviewer';
 IF key IS NULL THEN secret:=gridex_utilts_issuer_intake.entropy_v1();IF secret IS NULL THEN RETURN jsonb_build_object('status','held','reasonCodes',jsonb_build_array('crypto_unavailable'));END IF;key:=gen_random_uuid();INSERT INTO gridex_utilts_issuer_intake.keys VALUES(key,e.id,actor,'reviewer',NULL,secret,clock_timestamp());END IF;
 RETURN gridex_utilts_issuer_intake.effect_v1(e)||CASE WHEN a.kind='test_retention' THEN jsonb_build_object('retentionArtifactId',a.id) ELSE '{}'::jsonb END||jsonb_build_object('status','approved','assurance','controlled_test_only')||gridex_utilts_issuer_intake.append_v1(e.id,actor,a.id,a.kind,jsonb_build_object('request',a.scope,'artifactSha256',a.artifact_sha256,'physicalBytesErased',false),key);END$$;
CREATE FUNCTION public.review_utilts_issuer_source_v1(p_company_id uuid,p_actor_user_id uuid,p_artifact_id uuid,p_review jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$DECLARE a gridex_utilts_issuer_intake.artifacts%rowtype;command uuid;input_hash text;prior gridex_utilts_issuer_intake.commands%rowtype;effect jsonb;result jsonb;BEGIN
 PERFORM gridex_utilts_issuer_intake.actor_v1(p_company_id,p_actor_user_id,true);PERFORM gridex_utilts_issuer_intake.shape_v1(p_review,ARRAY['version','commandId','decision','reason','artifactSha256','scopeSha256']);
 PERFORM gridex_utilts_issuer_intake.strings_v1(p_review,ARRAY['commandId','decision','reason','artifactSha256','scopeSha256']);
 PERFORM gridex_utilts_issuer_intake.need_v1(p_review->'version'='1'::jsonb AND p_review->>'decision' IN('approve','hold','reject') AND length(btrim(p_review->>'reason')) BETWEEN 1 AND 2000,'issuer_intake_review_invalid');
 command:=(p_review->>'commandId')::uuid;input_hash:=gridex_utilts_issuer_intake.sha_v1(jsonb_build_object('artifactId',p_artifact_id,'review',p_review));PERFORM pg_advisory_xact_lock(hashtextextended('utilts-intake-command:'||command::text,0));
 SELECT * INTO prior FROM gridex_utilts_issuer_intake.commands WHERE id=command;
 IF prior.id IS NOT NULL THEN PERFORM gridex_utilts_issuer_intake.need_v1(prior.company_id=p_company_id AND prior.actor_id=p_actor_user_id AND prior.operation='review' AND prior.input_sha256=input_hash,'issuer_intake_command_conflict');RETURN prior.result;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('utilts-intake-review:'||p_artifact_id::text,0));
 SELECT * INTO a FROM gridex_utilts_issuer_intake.artifacts WHERE id=p_artifact_id AND company_id=p_company_id;
 PERFORM gridex_utilts_issuer_intake.need_v1(a.id IS NOT NULL AND a.artifact_sha256=p_review->>'artifactSha256' AND a.scope_sha256=p_review->>'scopeSha256','issuer_intake_review_scope_invalid');
 PERFORM gridex_utilts_issuer_intake.need_v1(a.submitted_by<>p_actor_user_id,'issuer_intake_separate_reviewer_required');
 PERFORM gridex_utilts_issuer_intake.need_v1(NOT EXISTS(SELECT FROM gridex_utilts_issuer_intake.reviews rv WHERE rv.artifact_id=a.id AND rv.effect->>'status' IN('approved','rejected','revoked')),'issuer_intake_terminal_review');
 IF p_review->>'decision'<>'approve' THEN effect:=jsonb_build_object('status',CASE p_review->>'decision' WHEN 'hold' THEN 'held' ELSE 'rejected' END,'reasonCodes',jsonb_build_array('review_'||(p_review->>'decision')));
 ELSIF a.environment<>'test' OR a.kind='prospective' THEN effect:=jsonb_build_object('status','held','reasonCodes',jsonb_build_array('unsupported_trust_policy'));
 ELSIF a.kind='test_birth' THEN effect:=gridex_utilts_issuer_intake.birth_v1(a,p_actor_user_id,p_review);
 ELSIF a.kind='test_checkpoint' THEN effect:=gridex_utilts_issuer_intake.checkpoint_v1(a,p_actor_user_id);
 ELSIF a.kind IN('test_retention','test_delete') THEN effect:=gridex_utilts_issuer_intake.lifecycle_v1(a,p_actor_user_id);
 ELSIF a.kind='history' THEN effect:=gridex_utilts_issuer_intake.history_v1(a,p_actor_user_id,p_review);
 ELSE effect:=jsonb_build_object('status','held','reasonCodes',jsonb_build_array('operation_review_not_supported'));END IF;
 INSERT INTO gridex_utilts_issuer_intake.reviews(artifact_id,actor_id,decision,reason,effect) VALUES(a.id,p_actor_user_id,p_review->>'decision',p_review->>'reason',effect);
 result:=gridex_utilts_issuer_intake.result_v1(a.id,command,false);
 INSERT INTO gridex_utilts_issuer_intake.commands VALUES(command,p_company_id,p_actor_user_id,'review',input_hash,result,clock_timestamp());RETURN result;END$$;
CREATE FUNCTION public.read_utilts_issuer_source_v1(p_company_id uuid,p_actor_user_id uuid,p_artifact_id uuid,p_include_bytes boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE a gridex_utilts_issuer_intake.artifacts%rowtype;result jsonb;e uuid;cp gridex_utilts_issuer_intake.checkpoints%rowtype;BEGIN
 PERFORM gridex_utilts_issuer_intake.actor_v1(p_company_id,p_actor_user_id,false);
 SELECT * INTO a FROM gridex_utilts_issuer_intake.artifacts WHERE id=p_artifact_id AND company_id=p_company_id;PERFORM gridex_utilts_issuer_intake.need_v1(a.id IS NOT NULL,'issuer_intake_owned_artifact_required');
 result:=gridex_utilts_issuer_intake.result_v1(a.id,a.command_id,p_include_bytes);
 e:=(result->>'epochId')::uuid;IF e IS NOT NULL THEN PERFORM gridex_utilts_issuer_intake.verify_v1(e);END IF;
 SELECT * INTO cp FROM gridex_utilts_issuer_intake.checkpoints WHERE artifact_id=CASE WHEN a.kind='history' THEN (a.scope->>'checkpointArtifactId')::uuid ELSE a.id END;
 IF cp.artifact_id IS NOT NULL THEN PERFORM gridex_utilts_issuer_intake.need_v1(cp.mac_hex=gridex_utilts_issuer_intake.mac_v1(cp.seal_bytes,cp.key_id),'issuer_intake_checkpoint_mac_invalid');END IF;
 RETURN result;END$$;
CREATE FUNCTION public.revoke_utilts_issuer_source_v1(p_company_id uuid,p_actor_user_id uuid,p_submission jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$DECLARE a gridex_utilts_issuer_intake.artifacts%rowtype;e gridex_utilts_issuer_intake.epochs%rowtype;command uuid;input_hash text;prior gridex_utilts_issuer_intake.commands%rowtype;target uuid;kind text;original jsonb;bytes bytea;effect jsonb;result jsonb;key uuid;secret bytea;BEGIN
 PERFORM gridex_utilts_issuer_intake.actor_v1(p_company_id,p_actor_user_id,true);
 PERFORM gridex_utilts_issuer_intake.shape_v1(p_submission,ARRAY['version','commandId','environment','artifactId','targetKind','targetId','decisionOriginal','reason']);
 PERFORM gridex_utilts_issuer_intake.strings_v1(p_submission,ARRAY['commandId','environment','artifactId','targetKind','targetId','reason']);
 PERFORM gridex_utilts_issuer_intake.need_v1(p_submission->'version'='1'::jsonb AND p_submission->>'environment' IN('test','production') AND p_submission->>'targetKind' IN('issuer','mandate','epoch','application') AND length(btrim(p_submission->>'reason')) BETWEEN 1 AND 2000,'issuer_intake_revoke_invalid');
 command:=(p_submission->>'commandId')::uuid;input_hash:=gridex_utilts_issuer_intake.sha_v1(p_submission);PERFORM pg_advisory_xact_lock(hashtextextended('utilts-intake-command:'||command::text,0));
 SELECT * INTO prior FROM gridex_utilts_issuer_intake.commands WHERE id=command;
 IF prior.id IS NOT NULL THEN PERFORM gridex_utilts_issuer_intake.need_v1(prior.company_id=p_company_id AND prior.actor_id=p_actor_user_id AND prior.operation='revoke' AND prior.input_sha256=input_hash,'issuer_intake_command_conflict');RETURN prior.result;END IF;
 SELECT * INTO a FROM gridex_utilts_issuer_intake.artifacts WHERE id=(p_submission->>'artifactId')::uuid AND company_id=p_company_id AND environment=p_submission->>'environment';
 PERFORM gridex_utilts_issuer_intake.need_v1(a.id IS NOT NULL AND a.submitted_by<>p_actor_user_id,'issuer_intake_separate_owned_revoke_required');
 original:=p_submission->'decisionOriginal';PERFORM gridex_utilts_issuer_intake.shape_v1(original,ARRAY['reference','version','uri','mimeType','bytesBase64','sha256']);
 PERFORM gridex_utilts_issuer_intake.originals_v1(jsonb_build_array(original||jsonb_build_object('role','test_retention_decision')),'test_retention');bytes:=decode(original->>'bytesBase64','base64');
 IF a.environment<>'test' THEN effect:=jsonb_build_object('status','held','reasonCodes',jsonb_build_array('unsupported_trust_policy'));
 ELSE
  SELECT * INTO e FROM gridex_utilts_issuer_intake.epochs WHERE company_id=p_company_id AND (birth_artifact_id=a.id OR id=(a.scope->>'epochId')::uuid);
  PERFORM gridex_utilts_issuer_intake.need_v1(e.id IS NOT NULL AND e.submitted_by<>p_actor_user_id AND NOT EXISTS(SELECT FROM gridex_utilts_issuer_intake.applications WHERE epoch_id=e.id AND actor_id=p_actor_user_id),'issuer_intake_separate_reviewer_required');
  PERFORM pg_advisory_xact_lock(hashtextextended('utilts-intake-epoch:'||e.id::text,0));PERFORM gridex_utilts_issuer.lock_namespace_v1(e.namespace_id);target:=(p_submission->>'targetId')::uuid;kind:=p_submission->>'targetKind';
  PERFORM gridex_utilts_issuer_intake.need_v1((kind='issuer' AND target=e.issuer_id) OR (kind='mandate' AND target=e.mandate_id) OR (kind='epoch' AND target=e.id) OR (kind='application' AND EXISTS(SELECT FROM gridex_utilts_issuer_intake.applications WHERE id=target AND epoch_id=e.id)),'issuer_intake_revocation_scope_invalid');
  INSERT INTO gridex_utilts_issuer_intake.revocations VALUES(gen_random_uuid(),e.id,kind,target,p_actor_user_id,a.id,p_submission,clock_timestamp());
  IF kind IN('issuer','mandate','epoch') THEN INSERT INTO gridex_utilts_issuer.revocations VALUES(gen_random_uuid(),e.namespace_id,CASE WHEN kind IN('issuer','epoch') THEN e.issuer_id ELSE NULL END,CASE WHEN kind='mandate' THEN e.mandate_id ELSE NULL END,clock_timestamp(),original->>'reference',original->>'version',bytes,encode(sha256(bytes),'hex'),clock_timestamp(),p_actor_user_id);END IF;
  SELECT id INTO key FROM gridex_utilts_issuer_intake.keys WHERE epoch_id=e.id AND actor_id=p_actor_user_id AND purpose='reviewer';
  IF key IS NULL THEN secret:=gridex_utilts_issuer_intake.entropy_v1();PERFORM gridex_utilts_issuer_intake.need_v1(secret IS NOT NULL,'issuer_intake_crypto_unavailable');key:=gen_random_uuid();INSERT INTO gridex_utilts_issuer_intake.keys VALUES(key,e.id,p_actor_user_id,'reviewer',NULL,secret,clock_timestamp());END IF;
  effect:=gridex_utilts_issuer_intake.append_v1(e.id,p_actor_user_id,a.id,'revoke',jsonb_build_object('targetKind',kind,'targetId',target,'decisionSha256',encode(sha256(bytes),'hex')),key)||gridex_utilts_issuer_intake.effect_v1(e)||jsonb_build_object('status','revoked','assurance','controlled_test_only');
 END IF;
 INSERT INTO gridex_utilts_issuer_intake.reviews(artifact_id,actor_id,decision,reason,effect) VALUES(a.id,p_actor_user_id,'revoke',p_submission->>'reason',effect);
 result:=gridex_utilts_issuer_intake.result_v1(a.id,command,false);INSERT INTO gridex_utilts_issuer_intake.commands VALUES(command,p_company_id,p_actor_user_id,'revoke',input_hash,result,clock_timestamp());RETURN result;END$$;
DO $$DECLARE rel text;BEGIN
 FOREACH rel IN ARRAY ARRAY['artifacts','commands','reviews','epochs','applications','keys','journal','issuances','source_links','checkpoints','revocations'] LOOP
 EXECUTE format('ALTER TABLE gridex_utilts_issuer_intake.%I ENABLE ROW LEVEL SECURITY',rel);EXECUTE format('ALTER TABLE gridex_utilts_issuer_intake.%I FORCE ROW LEVEL SECURITY',rel);EXECUTE format('REVOKE ALL ON TABLE gridex_utilts_issuer_intake.%I FROM PUBLIC,anon,authenticated,service_role',rel);
 EXECUTE format('CREATE TRIGGER immutable_update_delete BEFORE UPDATE OR DELETE ON gridex_utilts_issuer_intake.%I FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation()',rel);EXECUTE format('CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_utilts_issuer_intake.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation()',rel);
 END LOOP;END$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_utilts_issuer_intake FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.archive_utilts_issuer_source_v1(uuid,uuid,jsonb),public.read_utilts_issuer_source_v1(uuid,uuid,uuid,boolean),public.review_utilts_issuer_source_v1(uuid,uuid,uuid,jsonb),public.revoke_utilts_issuer_source_v1(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.archive_utilts_issuer_source_v1(uuid,uuid,jsonb),public.read_utilts_issuer_source_v1(uuid,uuid,uuid,boolean),public.review_utilts_issuer_source_v1(uuid,uuid,uuid,jsonb),public.revoke_utilts_issuer_source_v1(uuid,uuid,jsonb) TO service_role;
COMMIT;
