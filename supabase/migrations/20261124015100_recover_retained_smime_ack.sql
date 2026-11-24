-- Restore a retained company S/MIME ACK without changing the original delivery identity.

CREATE SCHEMA gridex_retained_smime_retention;
REVOKE ALL ON SCHEMA gridex_retained_smime_retention FROM PUBLIC, anon, authenticated, service_role;

-- Require the exact company IMAP source and its failed S/MIME receipt.
CREATE FUNCTION gridex_unattributed_intake.retained_smime_physical_source_v1(
  p_company_id uuid,
  p_environment text,
  p_mail_id uuid,
  p_failed_payload_id uuid,
  p_cipher_sha256 text
) RETURNS public.inbound_email_messages
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $function$
DECLARE
  v_mail public.inbound_email_messages%rowtype;
  v_mailbox public.ediel_mailboxes%rowtype;
  v_birth_sha256 text;
BEGIN
  SELECT * INTO v_mail FROM public.inbound_email_messages
  WHERE id = p_mail_id AND company_id = p_company_id AND environment = p_environment
  FOR UPDATE;

  SELECT * INTO v_mailbox FROM public.ediel_mailboxes
  WHERE id = v_mail.mailbox_id AND company_id = p_company_id AND environment = p_environment
  FOR SHARE;

  SELECT snapshot_hash INTO v_birth_sha256 FROM gridex_unattributed_intake.raw_births
  WHERE inbound_email_message_id = v_mail.id;

  IF v_mail.id IS NULL OR v_mailbox.id IS NULL OR v_mailbox.is_active IS NOT TRUE
     OR v_mailbox.is_shared_platform_mailbox IS TRUE
     OR p_environment NOT IN ('test','production')
     OR v_mail.received_at_source IS DISTINCT FROM 'imap_internal_date'
     OR v_mail.received_at IS NULL OR NOT isfinite(v_mail.received_at)
     OR v_mail.imap_uid IS NULL OR v_mail.raw_email IS NULL OR octet_length(v_mail.raw_email) > 8388608
     OR p_cipher_sha256 IS NULL
     OR p_cipher_sha256 IS DISTINCT FROM v_mail.raw_mailbox_bytes_sha256
     OR p_cipher_sha256 IS DISTINCT FROM v_mail.raw_message_sha256
     OR p_cipher_sha256 IS DISTINCT FROM gridex_unattributed_intake.sha_v1(v_mail.raw_email)
     OR v_birth_sha256 IS NULL OR v_birth_sha256 IS DISTINCT FROM gridex_unattributed_intake.raw_hash_v1(v_mail) THEN
    RAISE EXCEPTION 'retained_smime_physical_source_required' USING ERRCODE = '23514';
  END IF;

  PERFORM 1 FROM public.ediel_message_payloads AS failure
  WHERE failure.id = p_failed_payload_id
    AND failure.inbound_email_message_id = v_mail.id
    AND failure.company_id = p_company_id
    AND failure.payload_kind = 'inbound_smime'
    AND failure.encryption_mode = 'smime'
    AND failure.security_status = 'decrypt_failed'
    AND failure.raw_payload IS NULL
    AND failure.raw_payload_hash IS NULL
    AND failure.encrypted_payload_ref = 'inbound-smime://' || left(p_cipher_sha256, 32)
    AND failure.metadata @> jsonb_build_object('mailboxId', v_mailbox.id, 'environment', v_mail.environment)
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'retained_smime_failed_intake_receipt_required' USING ERRCODE = '23514';
  END IF;
  RETURN v_mail;
END
$function$;

REVOKE ALL ON FUNCTION gridex_unattributed_intake.retained_smime_physical_source_v1(
  uuid, text, uuid, uuid, text
) FROM PUBLIC, anon, authenticated, service_role;

-- Resolve the operator who authorized the currently held retry.
CREATE FUNCTION gridex_unattributed_intake.retained_smime_queue_actor_v1(
  p_company_id uuid,
  p_environment text,
  p_mail_id uuid,
  p_job_id uuid,
  p_claim_owner text,
  p_claimed_at timestamptz
) RETURNS uuid
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $function$
DECLARE
  v_job public.inbound_processing_jobs%rowtype;
  v_actors uuid[];
BEGIN
  SELECT job.* INTO v_job
  FROM public.inbound_processing_jobs AS job
  JOIN public.inbound_email_messages AS mail ON mail.id = job.inbound_email_message_id
  WHERE job.id = p_job_id
    AND job.inbound_email_message_id = p_mail_id
    AND job.company_id = p_company_id
    AND job.mailbox_id = mail.mailbox_id
    AND mail.company_id = p_company_id
    AND mail.environment = p_environment
    AND job.status = 'processing'
    AND job.locked_by = p_claim_owner
    AND job.locked_at = p_claimed_at
    AND job.review_resolved_at IS NOT NULL
    AND job.review_resolution IS NOT NULL
    AND job.review_resolved_at <= job.locked_at
  -- The caller acquires the original mail lock after locking any existing ACK.
  -- Holding the job already fences another claim or manual resolution.
  FOR SHARE OF job;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'retained_smime_requeue_claim_required' USING ERRCODE = '42501';
  END IF;

  SELECT array_agg(a.actor_user_id) INTO v_actors
  FROM public.audit_logs AS a
  WHERE a.company_id = p_company_id
    AND a.entity_type = 'inbound_processing_jobs'
    AND a.entity_id = v_job.id::text
    AND a.action = 'INBOUND_MANUAL_REVIEW_RESOLVED'
    AND a.actor_type = 'user'
    AND a.created_at = v_job.review_resolved_at
    AND a.new_values @> jsonb_build_object(
      'previous_status', 'manual_review',
      'next_status', 'queued',
      'inbound_email_message_id', v_job.inbound_email_message_id,
      'resolution', v_job.review_resolution
    );

  IF cardinality(v_actors) IS DISTINCT FROM 1
     OR v_actors[1] IS NULL
     OR public.canonical_actor_is_platform_admin(v_actors[1]) IS NOT TRUE THEN
    RAISE EXCEPTION 'retained_smime_requeue_operator_required' USING ERRCODE = '42501';
  END IF;
  RETURN v_actors[1];
END
$function$;

REVOKE ALL ON FUNCTION gridex_unattributed_intake.retained_smime_queue_actor_v1(
  uuid, text, uuid, uuid, text, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;

-- Bind the unmodified ciphertext to one retained plaintext attachment.
CREATE TABLE gridex_unattributed_intake.retained_smime_recoveries (
  inbound_email_message_id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  environment text NOT NULL CHECK (environment IN ('test','production')),
  mailbox_id uuid NOT NULL,
  failed_payload_id uuid NOT NULL UNIQUE,
  attachment_id uuid NOT NULL UNIQUE,
  ciphertext_hash text NOT NULL CHECK (ciphertext_hash ~ '^[a-f0-9]{64}$'),
  cleartext_hash text NOT NULL CHECK (cleartext_hash ~ '^[a-f0-9]{64}$'),
  certificate_id uuid NOT NULL,
  received_at timestamptz NOT NULL
);
REVOKE ALL ON TABLE gridex_unattributed_intake.retained_smime_recoveries
FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER retained_smime_recovery_immutable
BEFORE UPDATE OR DELETE ON gridex_unattributed_intake.retained_smime_recoveries
FOR EACH ROW EXECUTE FUNCTION gridex_unattributed_intake.immutable_v1();

CREATE TRIGGER retained_smime_recovery_no_truncate
BEFORE TRUNCATE ON gridex_unattributed_intake.retained_smime_recoveries
FOR EACH STATEMENT EXECUTE FUNCTION gridex_unattributed_intake.immutable_v1();

CREATE FUNCTION gridex_unattributed_intake.store_retained_smime_projection_v1(
  p_mail public.inbound_email_messages,
  p_failed_payload_id uuid,
  p_certificate_id uuid,
  p_cleartext text,
  p_clear_sha256 text
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $function$
DECLARE
  v_link gridex_unattributed_intake.retained_smime_recoveries%rowtype;
  v_attachment public.inbound_email_attachments%rowtype;
  v_snapshot text;
  v_replayed boolean;
BEGIN
  IF gridex_retained_smime_retention.has_tombstone_v1(p_mail.company_id,p_mail.environment,p_mail.id,NULL,false) THEN
    RAISE EXCEPTION 'retained_smime_source_tombstoned' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_link FROM gridex_unattributed_intake.retained_smime_recoveries
  WHERE inbound_email_message_id = p_mail.id;
  v_replayed := FOUND;

  IF v_replayed THEN
    IF ROW(v_link.company_id,v_link.environment,v_link.mailbox_id,v_link.failed_payload_id,
           v_link.ciphertext_hash,v_link.received_at) IS DISTINCT FROM
       ROW(p_mail.company_id,p_mail.environment,p_mail.mailbox_id,p_failed_payload_id,
           p_mail.raw_mailbox_bytes_sha256,p_mail.received_at)
       OR (p_cleartext IS NOT NULL AND (
         p_certificate_id IS DISTINCT FROM v_link.certificate_id
         OR p_clear_sha256 IS DISTINCT FROM v_link.cleartext_hash
         OR gridex_unattributed_intake.sha_v1(p_cleartext) IS DISTINCT FROM v_link.cleartext_hash
       )) OR (p_cleartext IS NULL AND (p_certificate_id IS NOT NULL OR p_clear_sha256 IS NOT NULL)) THEN
      RAISE EXCEPTION 'retained_smime_projection_conflict' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF p_cleartext IS NULL AND p_certificate_id IS NULL AND p_clear_sha256 IS NULL THEN
      RETURN jsonb_build_object('status', 'needs_recovery');
    END IF;
    IF p_mail.processing_status IS DISTINCT FROM 'manual_review'
       OR p_mail.match_status IS DISTINCT FROM 'missing_payload'
       OR nullif(p_mail.raw_edifact_payload, '') IS NOT NULL
       OR p_certificate_id IS NULL OR nullif(p_cleartext, '') IS NULL OR octet_length(p_cleartext) > 8388608
       OR p_clear_sha256 IS NULL OR p_clear_sha256 IS DISTINCT FROM gridex_unattributed_intake.sha_v1(p_cleartext) THEN
      RAISE EXCEPTION 'retained_smime_clear_original_required' USING ERRCODE = '23514';
    END IF;

    -- The existing application decrypts the exact source CMS. Lock the
    -- current company certificate so a retired or foreign key cannot attest it.
    PERFORM 1 FROM public.ediel_certificates
    WHERE id = p_certificate_id AND company_id = p_mail.company_id AND environment = p_mail.environment
      AND status = 'active' AND usage = 'inbound_private'
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'retained_smime_current_certificate_required' USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.inbound_email_attachments(
      inbound_email_message_id, company_id, filename, mime_type, raw_text, size_bytes, is_edifact_candidate, metadata
    ) VALUES(
      p_mail.id, p_mail.company_id, 'retained-smime-recovery.edi', 'application/edifact', p_cleartext,
      octet_length(p_cleartext), true, jsonb_build_object('retainedSmimeRecovery', true)
    ) RETURNING * INTO v_attachment;

    INSERT INTO gridex_unattributed_intake.retained_smime_recoveries(
      inbound_email_message_id, company_id, environment, mailbox_id, failed_payload_id, attachment_id,
      ciphertext_hash, cleartext_hash, certificate_id, received_at
    ) VALUES(
      p_mail.id,p_mail.company_id,p_mail.environment,p_mail.mailbox_id,p_failed_payload_id,v_attachment.id,
      p_mail.raw_mailbox_bytes_sha256,p_clear_sha256,p_certificate_id,p_mail.received_at
    ) RETURNING * INTO v_link;
  END IF;

  SELECT * INTO v_attachment FROM public.inbound_email_attachments
  WHERE id = v_link.attachment_id AND company_id = v_link.company_id
    AND inbound_email_message_id = v_link.inbound_email_message_id FOR SHARE;
  SELECT snapshot_hash INTO v_snapshot FROM gridex_unattributed_intake.attachment_births
  WHERE attachment_id = v_attachment.id AND inbound_email_message_id = p_mail.id;
  IF v_attachment.id IS NULL OR v_snapshot IS NULL
     OR gridex_unattributed_intake.attachment_hash_v1(v_attachment) IS DISTINCT FROM v_snapshot
     OR v_link.cleartext_hash IS DISTINCT FROM gridex_unattributed_intake.sha_v1(v_attachment.raw_text) THEN
    RAISE EXCEPTION 'retained_smime_projection_custody_required' USING ERRCODE = '23514';
  END IF;
  RETURN jsonb_build_object(
    'status','recovered', 'sourceMailId',p_mail.id, 'companyId',p_mail.company_id, 'environment',p_mail.environment,
    'cipherHash',v_link.ciphertext_hash, 'clearHash',v_link.cleartext_hash, 'cleartext',v_attachment.raw_text,
    'attachmentId',v_attachment.id, 'receivedAt',v_link.received_at, 'replayed',v_replayed
  );
END
$function$;

REVOKE ALL ON FUNCTION gridex_unattributed_intake.store_retained_smime_projection_v1(
  public.inbound_email_messages, uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION gridex_unattributed_intake.protect_retained_smime_projection_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO pg_catalog
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM gridex_unattributed_intake.retained_smime_recoveries
    WHERE attachment_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'retained_smime_projection_immutable' USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$function$;
REVOKE ALL ON FUNCTION gridex_unattributed_intake.protect_retained_smime_projection_v1()
FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER retained_smime_projection_immutable
BEFORE UPDATE OR DELETE ON public.inbound_email_attachments
FOR EACH ROW EXECUTE FUNCTION gridex_unattributed_intake.protect_retained_smime_projection_v1();

-- Recheck the current operator under the ACK write transaction.
CREATE TABLE gridex_unattributed_intake.retained_smime_ack_write_permits (
  backend integer NOT NULL,
  xid xid8 NOT NULL,
  actor uuid NOT NULL,
  company_id uuid NOT NULL,
  target_id uuid NOT NULL,
  inbound_email_message_id uuid NOT NULL,
  environment text NOT NULL,
  operation text NOT NULL,
  raw_hash text NOT NULL,
  PRIMARY KEY (backend,xid,target_id)
);
REVOKE ALL ON TABLE gridex_unattributed_intake.retained_smime_ack_write_permits FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_unattributed_intake.retained_smime_current_operator_v1(c uuid, actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $$
BEGIN
 IF current_setting('transaction_isolation') NOT IN ('read committed','read uncommitted')
 THEN RAISE EXCEPTION 'retained_smime_ack_read_committed_required' USING ERRCODE='25001'; END IF;
 -- The same registry prefix and row order as retention's registered authority.
 -- Inbound reception also recognizes platform administrator grants.
 LOCK TABLE public.permissions,public.roles,public.user_roles,public.role_permissions,
   public.user_permissions,public.user_permission_overrides,public.admin_users IN SHARE MODE;
 IF NOT public.ediel_retention_lock_auth_actor_v1(actor) THEN
   RAISE EXCEPTION 'retained_smime_ack_actor_forbidden' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT FROM auth.users u WHERE u.id=actor AND u.email_confirmed_at IS NOT NULL)
   OR public.canonical_actor_is_platform_admin(actor) IS NOT TRUE
 THEN RAISE EXCEPTION 'retained_smime_ack_current_platform_operator_required' USING ERRCODE='42501'; END IF;
 PERFORM id FROM public.companies WHERE id=c FOR SHARE;
 PERFORM gridex_ediel_inbound_receptions.authorize_v1(c,actor,'communication.write');
END $$;
REVOKE ALL ON FUNCTION gridex_unattributed_intake.retained_smime_current_operator_v1(uuid,uuid) FROM PUBLIC;

CREATE FUNCTION gridex_unattributed_intake.consume_retained_smime_ack_write_permit_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $$
DECLARE writer uuid;
BEGIN
 IF NOT EXISTS(SELECT FROM gridex_unattributed_intake.retained_smime_recoveries r WHERE
    r.inbound_email_message_id=NEW.inbound_email_message_id) THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND OLD.raw_payload IS NOT NULL AND NEW.raw_payload IS NULL
   AND public.ediel_is_qualified_retention_transition_v1(OLD,NEW) THEN RETURN NEW; END IF;
 DELETE FROM gridex_unattributed_intake.retained_smime_ack_write_permits p
 WHERE p.backend=pg_backend_pid() AND p.xid=pg_current_xact_id()
   AND p.target_id=NEW.id AND p.company_id=NEW.company_id AND p.environment=NEW.environment
   AND p.inbound_email_message_id=NEW.inbound_email_message_id AND p.operation=TG_OP
   AND p.raw_hash=gridex_unattributed_intake.sha_v1(NEW.raw_payload)
 RETURNING p.actor INTO writer;
 IF writer IS NULL THEN RAISE EXCEPTION 'retained_smime_ack_transaction_authority_required' USING ERRCODE='42501'; END IF;
 -- Final tuple waits have already happened. Recheck time-based denies after
 -- the preceding scope/tombstone guard has locked exact source mail.
 PERFORM gridex_unattributed_intake.retained_smime_current_operator_v1(NEW.company_id,writer);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION gridex_unattributed_intake.consume_retained_smime_ack_write_permit_v1() FROM PUBLIC;
CREATE TRIGGER b_retained_smime_ack_actor BEFORE INSERT OR UPDATE OF raw_payload,parsed_payload,validation_report,metadata ON public.ediel_messages
 FOR EACH ROW EXECUTE FUNCTION gridex_unattributed_intake.consume_retained_smime_ack_write_permit_v1();

-- Resolve the local recovery or read its protected projection.
CREATE FUNCTION gridex_unattributed_intake.retained_smime_scoped_operator_v1(
  p_company_id uuid,p_environment text,p_mail_id uuid,p_actor_user_id uuid,
  p_job_id uuid,p_claim_owner text,p_claimed_at timestamptz
) RETURNS uuid
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $function$
DECLARE v_actor uuid;
BEGIN
  PERFORM gridex_unattributed_intake.require_service_v1();

  IF p_actor_user_id IS NOT NULL AND p_job_id IS NULL AND p_claim_owner IS NULL AND p_claimed_at IS NULL THEN
    v_actor := p_actor_user_id;
  ELSIF p_actor_user_id IS NULL AND p_job_id IS NOT NULL AND p_claim_owner IS NOT NULL AND p_claimed_at IS NOT NULL THEN
    -- Start with the same registry prefix as the retained ACK write fence.
    LOCK TABLE public.permissions,public.roles,public.user_roles,public.role_permissions,
      public.user_permissions,public.user_permission_overrides,public.admin_users IN SHARE MODE;
    v_actor := gridex_unattributed_intake.retained_smime_queue_actor_v1(
      p_company_id,p_environment,p_mail_id,p_job_id,p_claim_owner,p_claimed_at
    );
  ELSE
    RAISE EXCEPTION 'retained_smime_current_operator_required' USING ERRCODE = '42501';
  END IF;

  PERFORM gridex_unattributed_intake.retained_smime_current_operator_v1(p_company_id,v_actor);
  RETURN v_actor;
END
$function$;
REVOKE ALL ON FUNCTION gridex_unattributed_intake.retained_smime_scoped_operator_v1(
  uuid,text,uuid,uuid,uuid,text,timestamptz
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.gridex_resolve_retained_smime_ack_v1(
  p_company_id uuid,
  p_environment text,
  p_mail_id uuid,
  p_failed_payload_id uuid,
  p_cipher_sha256 text,
  p_actor_user_id uuid,
  p_job_id uuid,
  p_claim_owner text,
  p_claimed_at timestamptz,
  p_certificate_id uuid,
  p_cleartext text,
  p_clear_sha256 text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO pg_catalog
AS $function$
DECLARE v_actor uuid; v_mail public.inbound_email_messages%rowtype; v_receipt jsonb;
BEGIN
  v_actor := gridex_unattributed_intake.retained_smime_scoped_operator_v1(
    p_company_id,p_environment,p_mail_id,p_actor_user_id,p_job_id,p_claim_owner,p_claimed_at
  );
  v_mail := gridex_unattributed_intake.retained_smime_physical_source_v1(
    p_company_id,p_environment,p_mail_id,p_failed_payload_id,p_cipher_sha256
  );
  v_receipt := gridex_unattributed_intake.store_retained_smime_projection_v1(
    v_mail,p_failed_payload_id,p_certificate_id,p_cleartext,p_clear_sha256
  );
  PERFORM gridex_unattributed_intake.retained_smime_current_operator_v1(p_company_id,v_actor);
  RETURN v_receipt || jsonb_build_object('actorUserId',v_actor);
END
$function$;
REVOKE ALL ON FUNCTION public.gridex_resolve_retained_smime_ack_v1(
  uuid,text,uuid,uuid,text,uuid,uuid,text,timestamptz,uuid,text,text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gridex_resolve_retained_smime_ack_v1(
  uuid,text,uuid,uuid,text,uuid,uuid,text,timestamptz,uuid,text,text
) TO service_role;

-- Prevent ordinary projections from creating unmanaged plaintext copies.
CREATE FUNCTION gridex_unattributed_intake.guard_retained_smime_ack_content_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $$
DECLARE
  recovery gridex_unattributed_intake.retained_smime_recoveries%ROWTYPE;
  source_mail public.inbound_email_messages%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF OLD.inbound_email_message_id IS DISTINCT FROM NEW.inbound_email_message_id
      AND EXISTS (SELECT FROM gridex_unattributed_intake.retained_smime_recoveries r WHERE r.inbound_email_message_id=OLD.inbound_email_message_id)
    THEN RAISE EXCEPTION 'retained_smime_ack_original_mail_immutable' USING ERRCODE='23514'; END IF;
    IF OLD.raw_payload IS NOT NULL AND NEW.raw_payload IS NULL
      AND public.ediel_is_qualified_retention_transition_v1(OLD,NEW)
    THEN RETURN NEW; END IF;
    IF ROW(NEW.inbound_email_message_id,NEW.company_id,NEW.environment,NEW.direction,NEW.message_family,
           NEW.raw_payload,NEW.parsed_payload,NEW.message_received_at)
       IS NOT DISTINCT FROM ROW(OLD.inbound_email_message_id,OLD.company_id,OLD.environment,OLD.direction,OLD.message_family,
           OLD.raw_payload,OLD.parsed_payload,OLD.message_received_at)
    THEN RETURN NEW; END IF;
  END IF;
  SELECT * INTO recovery FROM gridex_unattributed_intake.retained_smime_recoveries r
  WHERE r.inbound_email_message_id=NEW.inbound_email_message_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  -- UPDATE already owns the ACK tuple. INSERT checks for an existing ACK without
  -- waiting on its tuple or interchange key while it holds the next mail lock.
  SELECT * INTO source_mail FROM public.inbound_email_messages m WHERE m.id=recovery.inbound_email_message_id FOR UPDATE;
  IF gridex_retained_smime_retention.has_tombstone_v1(recovery.company_id,recovery.environment,
    recovery.inbound_email_message_id,recovery.cleartext_hash,false) THEN RAISE EXCEPTION 'retained_smime_ack_original_tombstoned' USING ERRCODE='23514'; END IF;
  IF NEW.raw_payload IS NULL OR NEW.company_id IS DISTINCT FROM recovery.company_id
     OR NEW.environment IS DISTINCT FROM recovery.environment OR NEW.direction IS DISTINCT FROM 'inbound'
     OR NEW.message_family IS NULL OR NEW.message_family NOT IN ('CONTRL','APERAK')
     OR NEW.message_received_at IS DISTINCT FROM recovery.received_at
     OR gridex_unattributed_intake.sha_v1(NEW.raw_payload) IS DISTINCT FROM recovery.cleartext_hash
     OR source_mail.company_id IS DISTINCT FROM recovery.company_id
     OR source_mail.environment IS DISTINCT FROM recovery.environment
     OR source_mail.mailbox_id IS DISTINCT FROM recovery.mailbox_id
     OR source_mail.received_at IS DISTINCT FROM recovery.received_at
     OR source_mail.raw_message_sha256 IS DISTINCT FROM recovery.ciphertext_hash
  THEN RAISE EXCEPTION 'retained_smime_ack_original_scope_required' USING ERRCODE='23514'; END IF;
  IF EXISTS (
    SELECT FROM public.ediel_messages a
    WHERE a.inbound_email_message_id=recovery.inbound_email_message_id AND a.id<>NEW.id
      AND a.company_id=recovery.company_id AND a.environment=recovery.environment
      AND a.direction='inbound' AND a.message_family IN ('CONTRL','APERAK')
  ) THEN RAISE EXCEPTION 'retained_smime_ack_original_already_exists' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION gridex_unattributed_intake.guard_retained_smime_ack_content_v1() FROM PUBLIC;
CREATE TRIGGER a_retained_smime_ack_content BEFORE INSERT OR UPDATE ON public.ediel_messages
  FOR EACH ROW EXECUTE FUNCTION gridex_unattributed_intake.guard_retained_smime_ack_content_v1();

CREATE INDEX retained_smime_recovery_company_cleartext_hash ON gridex_unattributed_intake.retained_smime_recoveries(company_id,cleartext_hash);

CREATE FUNCTION gridex_unattributed_intake.guard_retained_smime_consumer_copies_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $$
BEGIN
  IF TG_TABLE_NAME='inbound_ediel_parse_results' THEN
    IF EXISTS (
      SELECT FROM gridex_unattributed_intake.retained_smime_recoveries r WHERE r.inbound_email_message_id=NEW.inbound_email_message_id
    ) AND (NEW.raw_payload IS NOT NULL OR NEW.parsed_payload IS DISTINCT FROM '{"retainedSmimeRecovery":true}'::jsonb)
    THEN RAISE EXCEPTION 'retained_smime_parse_requires_receipt_only' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='inbound_email_messages' THEN
    IF NEW.match_payload IS DISTINCT FROM OLD.match_payload AND NEW.match_payload ? 'parsed'
      AND EXISTS (
        SELECT FROM gridex_unattributed_intake.retained_smime_recoveries r WHERE r.inbound_email_message_id=NEW.id
      )
    THEN RAISE EXCEPTION 'retained_smime_match_requires_receipt_only' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='outbound_requests' THEN
    IF NEW.response_payload IS DISTINCT FROM OLD.response_payload AND NEW.response_payload ? 'rawPayload'
      AND EXISTS (
        SELECT FROM public.ediel_messages a JOIN gridex_unattributed_intake.retained_smime_recoveries r
          ON r.inbound_email_message_id=a.inbound_email_message_id AND r.company_id=a.company_id AND r.environment=a.environment
        WHERE a.company_id=NEW.company_id AND a.outbound_request_id=NEW.id
          AND a.direction='inbound' AND a.message_family IN ('CONTRL','APERAK')
          AND r.cleartext_hash=gridex_unattributed_intake.sha_v1(NEW.response_payload->>'rawPayload')
      )
    THEN RAISE EXCEPTION 'retained_smime_request_requires_receipt_only' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='ediel_message_events' THEN
    IF NEW.event_type IN ('inbound_mail_processed','manual_note') AND NEW.payload ? 'inboundFamily'
      AND NEW.payload ? 'freeText' AND EXISTS (
        SELECT FROM public.ediel_messages a JOIN gridex_unattributed_intake.retained_smime_recoveries r
          ON r.inbound_email_message_id=a.inbound_email_message_id AND r.company_id=a.company_id AND r.environment=a.environment
        WHERE a.id=NEW.ediel_message_id AND a.company_id=NEW.company_id AND a.direction='inbound'
          AND a.message_family IN ('CONTRL','APERAK')
      )
    THEN RAISE EXCEPTION 'retained_smime_event_requires_receipt_only' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION gridex_unattributed_intake.guard_retained_smime_consumer_copies_v1() FROM PUBLIC;
CREATE TRIGGER retained_smime_parse_content BEFORE INSERT OR UPDATE ON public.inbound_ediel_parse_results
  FOR EACH ROW EXECUTE FUNCTION gridex_unattributed_intake.guard_retained_smime_consumer_copies_v1();
CREATE TRIGGER retained_smime_match_content BEFORE UPDATE OF match_payload ON public.inbound_email_messages
  FOR EACH ROW EXECUTE FUNCTION gridex_unattributed_intake.guard_retained_smime_consumer_copies_v1();
CREATE TRIGGER retained_smime_request_content BEFORE UPDATE OF response_payload ON public.outbound_requests
  FOR EACH ROW EXECUTE FUNCTION gridex_unattributed_intake.guard_retained_smime_consumer_copies_v1();
CREATE TRIGGER retained_smime_event_content BEFORE INSERT OR UPDATE ON public.ediel_message_events
  FOR EACH ROW EXECUTE FUNCTION gridex_unattributed_intake.guard_retained_smime_consumer_copies_v1();

-- Prior ordinary copies are outside this new write projection. The signed owner
-- cannot report that a recovered original has been purged while a known prior
-- plaintext copy remains tied to that same source.
CREATE FUNCTION gridex_retained_smime_retention.hold_unmanaged_copies_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $$
DECLARE
  source public.ediel_messages%ROWTYPE;
  recovery gridex_unattributed_intake.retained_smime_recoveries%ROWTYPE;
BEGIN
  IF NEW.retention_class IS DISTINCT FROM 'received_ediel_message_content' THEN RETURN NEW; END IF;
  SELECT * INTO source FROM public.ediel_messages a
  WHERE a.id=NEW.target_id AND a.company_id=NEW.company_id AND a.direction='inbound'
    AND a.message_family IN ('CONTRL','APERAK');
  SELECT * INTO recovery FROM gridex_unattributed_intake.retained_smime_recoveries r
  WHERE r.inbound_email_message_id=source.inbound_email_message_id AND r.company_id=source.company_id
    AND r.environment=source.environment AND r.cleartext_hash=NEW.source_hash;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF EXISTS(
    SELECT FROM public.inbound_ediel_parse_results p
    WHERE p.inbound_email_message_id=recovery.inbound_email_message_id AND (p.company_id=recovery.company_id OR p.company_id IS NULL)
      AND recovery.cleartext_hash IN (gridex_unattributed_intake.sha_v1(p.raw_payload),gridex_unattributed_intake.sha_v1(p.parsed_payload->>'rawPayload'))
  ) OR EXISTS (
    SELECT FROM public.inbound_email_messages m WHERE m.id=recovery.inbound_email_message_id AND m.company_id=recovery.company_id
      AND gridex_unattributed_intake.sha_v1(m.match_payload#>>'{parsed,rawPayload}')=recovery.cleartext_hash
  ) OR EXISTS (
    SELECT FROM public.outbound_requests o WHERE o.id=source.outbound_request_id AND o.company_id=recovery.company_id
      AND gridex_unattributed_intake.sha_v1(o.response_payload->>'rawPayload')=recovery.cleartext_hash
  ) OR EXISTS (
    SELECT FROM public.ediel_message_events e WHERE e.ediel_message_id=source.id AND e.company_id=recovery.company_id
      AND e.event_type IN ('inbound_mail_processed','manual_note') AND e.payload ? 'inboundFamily' AND e.payload ? 'freeText'
  ) THEN RAISE EXCEPTION 'retained_smime_existing_consumer_copy_disposition_required' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION gridex_retained_smime_retention.hold_unmanaged_copies_v1() FROM PUBLIC;

-- Write the recovered ACK through the existing original-capture triggers.
CREATE FUNCTION public.gridex_commit_retained_smime_ack_v1(
 p_company_id uuid,p_environment text,p_mail_id uuid,p_failed_payload_id uuid,p_cipher_sha256 text,
 p_actor_user_id uuid,p_job_id uuid,p_claim_owner text,p_claimed_at timestamptz,
 p_clear_sha256 text,p_current_ack_id uuid,p_projection jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog
AS $$
DECLARE
 c ALIAS FOR p_company_id;
 env ALIAS FOR p_environment;
 mail_id ALIAS FOR p_mail_id;
 expected_clear_hash ALIAS FOR p_clear_sha256;
 current_id ALIAS FOR p_current_ack_id;
 projection ALIAS FOR p_projection;
 actor uuid;
 mail public.inbound_email_messages%rowtype;
 receipt jsonb;
 v public.ediel_messages%rowtype;
 previous public.ediel_messages%rowtype;
 actual uuid;
 target uuid;
BEGIN
 actor := gridex_unattributed_intake.retained_smime_scoped_operator_v1(
   c,env,mail_id,p_actor_user_id,p_job_id,p_claim_owner,p_claimed_at
 );
 IF current_id IS NOT NULL THEN
  SELECT a.* INTO previous FROM public.ediel_messages a WHERE a.id=current_id
    AND a.company_id=c AND a.environment=env AND a.inbound_email_message_id=mail_id AND a.direction='inbound' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'retained_smime_exact_write_missing_or_unconsumed' USING ERRCODE='42501'; END IF;
 END IF;
 mail := gridex_unattributed_intake.retained_smime_physical_source_v1(
   c,env,mail_id,p_failed_payload_id,p_cipher_sha256
 );
 receipt := gridex_unattributed_intake.store_retained_smime_projection_v1(
   mail,p_failed_payload_id,NULL,NULL,NULL
 );
 IF receipt->>'status' IS DISTINCT FROM 'recovered'
    OR receipt->>'clearHash' IS DISTINCT FROM expected_clear_hash THEN
   RAISE EXCEPTION 'retained_smime_ack_receipt_required' USING ERRCODE='23514';
 END IF;
 IF jsonb_typeof(projection) IS DISTINCT FROM 'object' OR projection-ARRAY['company_id','environment','direction','message_standard','message_family','message_code','status','processing_status','sender_ediel_id','sender_sub_address','receiver_ediel_id','receiver_sub_address','parsed_unb_sender_ediel_id','parsed_unb_receiver_ediel_id','resolved_company_id','interchange_reference','transaction_reference','application_reference','external_reference','original_message_id','raw_payload','parsed_payload','validation_report','tenant_resolution_status','business_match_status','inbound_email_message_id','related_message_id','outbound_request_id','metering_point_id','customer_id','site_id','grid_owner_id','message_received_at','parsed_at','failure_reason','contrl_status','syntax_check_status','aperak_status','functional_check_status','ack_outcome','failed_at','acknowledged_at','updated_at']<>'{}'::jsonb
 THEN RAISE EXCEPTION 'retained_smime_ack_projection_shape_required' USING ERRCODE='23514'; END IF;
 v:=jsonb_populate_record(NULL::public.ediel_messages,projection);
 IF v.company_id IS DISTINCT FROM c OR v.inbound_email_message_id IS DISTINCT FROM mail_id
   OR v.environment IS DISTINCT FROM env OR v.direction IS DISTINCT FROM 'inbound'
   OR v.message_family IS NULL OR v.message_family NOT IN ('CONTRL','APERAK')
   OR v.message_standard IS DISTINCT FROM 'edifact' OR v.parsed_payload IS NULL OR v.raw_payload IS NULL
   OR expected_clear_hash IS DISTINCT FROM gridex_unattributed_intake.sha_v1(v.raw_payload)
   OR NOT EXISTS(SELECT FROM gridex_unattributed_intake.retained_smime_recoveries r
      WHERE r.inbound_email_message_id=mail_id AND r.company_id=c AND r.environment=env
       AND r.cleartext_hash=expected_clear_hash AND r.received_at=v.message_received_at)
 THEN RAISE EXCEPTION 'retained_smime_exact_write_projection_required' USING ERRCODE='23514'; END IF;
 IF current_id IS NOT NULL THEN v:=jsonb_populate_record(previous,projection); END IF;
 v.updated_at:=clock_timestamp();
 target:=coalesce(current_id,gen_random_uuid());
 INSERT INTO gridex_unattributed_intake.retained_smime_ack_write_permits VALUES
  (pg_backend_pid(),pg_current_xact_id(),actor,c,target,mail_id,env,CASE WHEN current_id IS NULL THEN 'INSERT' ELSE 'UPDATE' END,expected_clear_hash);
 IF current_id IS NULL THEN
  INSERT INTO public.ediel_messages (id,company_id, environment, direction, message_standard, message_family,
   message_code, status, processing_status, sender_ediel_id, sender_sub_address,
   receiver_ediel_id, receiver_sub_address, parsed_unb_sender_ediel_id, parsed_unb_receiver_ediel_id, resolved_company_id,
   interchange_reference, transaction_reference, application_reference, external_reference, original_message_id,
   raw_payload, parsed_payload, validation_report, tenant_resolution_status, business_match_status,
   inbound_email_message_id, related_message_id, outbound_request_id, metering_point_id, customer_id,
   site_id, grid_owner_id, message_received_at, parsed_at, failure_reason,
   contrl_status, syntax_check_status, aperak_status, functional_check_status, ack_outcome,
   failed_at, acknowledged_at, updated_at) VALUES(target,v.company_id, v.environment, v.direction, v.message_standard, v.message_family,
   v.message_code, v.status, v.processing_status, v.sender_ediel_id, v.sender_sub_address,
   v.receiver_ediel_id, v.receiver_sub_address, v.parsed_unb_sender_ediel_id, v.parsed_unb_receiver_ediel_id, v.resolved_company_id,
   v.interchange_reference, v.transaction_reference, v.application_reference, v.external_reference, v.original_message_id,
   v.raw_payload, v.parsed_payload, v.validation_report, v.tenant_resolution_status, v.business_match_status,
   v.inbound_email_message_id, v.related_message_id, v.outbound_request_id, v.metering_point_id, v.customer_id,
   v.site_id, v.grid_owner_id, v.message_received_at, v.parsed_at, v.failure_reason,
   v.contrl_status, v.syntax_check_status, v.aperak_status, v.functional_check_status, v.ack_outcome,
   v.failed_at, v.acknowledged_at, v.updated_at) RETURNING id INTO actual;
 ELSE
  UPDATE public.ediel_messages SET company_id=v.company_id, environment=v.environment, direction=v.direction, message_standard=v.message_standard,
   message_family=v.message_family, message_code=v.message_code, status=v.status, processing_status=v.processing_status,
   sender_ediel_id=v.sender_ediel_id, sender_sub_address=v.sender_sub_address, receiver_ediel_id=v.receiver_ediel_id, receiver_sub_address=v.receiver_sub_address,
   parsed_unb_sender_ediel_id=v.parsed_unb_sender_ediel_id, parsed_unb_receiver_ediel_id=v.parsed_unb_receiver_ediel_id, resolved_company_id=v.resolved_company_id, interchange_reference=v.interchange_reference,
   transaction_reference=v.transaction_reference, application_reference=v.application_reference, external_reference=v.external_reference, original_message_id=v.original_message_id,
   raw_payload=v.raw_payload, parsed_payload=v.parsed_payload, validation_report=v.validation_report, tenant_resolution_status=v.tenant_resolution_status,
   business_match_status=v.business_match_status, inbound_email_message_id=v.inbound_email_message_id, related_message_id=v.related_message_id, outbound_request_id=v.outbound_request_id,
   metering_point_id=v.metering_point_id, customer_id=v.customer_id, site_id=v.site_id, grid_owner_id=v.grid_owner_id,
   message_received_at=v.message_received_at, parsed_at=v.parsed_at, failure_reason=v.failure_reason, contrl_status=v.contrl_status,
   syntax_check_status=v.syntax_check_status, aperak_status=v.aperak_status, functional_check_status=v.functional_check_status, ack_outcome=v.ack_outcome,
   failed_at=v.failed_at, acknowledged_at=v.acknowledged_at, updated_at=v.updated_at
   WHERE id=target AND company_id=c AND direction='inbound' AND environment=env
    AND inbound_email_message_id=mail_id RETURNING id INTO actual;
 END IF;
 IF actual IS DISTINCT FROM target
   OR EXISTS(SELECT FROM gridex_unattributed_intake.retained_smime_ack_write_permits
             WHERE backend=pg_backend_pid() AND xid=pg_current_xact_id())
 THEN RAISE EXCEPTION 'retained_smime_exact_write_missing_or_unconsumed' USING ERRCODE='42501'; END IF;
 PERFORM gridex_unattributed_intake.retained_smime_current_operator_v1(c,actor);
 RETURN actual;
END $$;
REVOKE ALL ON FUNCTION public.gridex_commit_retained_smime_ack_v1(uuid,text,uuid,uuid,text,uuid,uuid,text,timestamptz,text,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_commit_retained_smime_ack_v1(uuid,text,uuid,uuid,text,uuid,uuid,text,timestamptz,text,uuid,jsonb) TO service_role;

-- Include the recovery projection in the signed retention target.
CREATE FUNCTION gridex_retained_smime_retention.projection_basis_v1(c uuid, m public.ediel_messages)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $$
DECLARE
  r gridex_unattributed_intake.retained_smime_recoveries%rowtype;
  a public.inbound_email_attachments%rowtype;
  b public.inbound_email_messages%rowtype;
  snapshot_hash text;
BEGIN
  IF m.id IS NULL OR m.company_id IS DISTINCT FROM c OR m.direction IS DISTINCT FROM 'inbound'
    OR m.inbound_email_message_id IS NULL OR m.message_family IS NULL OR m.message_family NOT IN ('CONTRL','APERAK') THEN RETURN NULL; END IF;
  -- The retention owner locks the ACK before this mail lock.
  SELECT * INTO b FROM public.inbound_email_messages WHERE id=m.inbound_email_message_id FOR SHARE;
  SELECT * INTO r FROM gridex_unattributed_intake.retained_smime_recoveries WHERE inbound_email_message_id=m.inbound_email_message_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT * INTO a FROM public.inbound_email_attachments WHERE id=r.attachment_id FOR SHARE;
  SELECT birth.snapshot_hash INTO snapshot_hash FROM gridex_unattributed_intake.attachment_births birth
  WHERE birth.attachment_id=a.id AND birth.inbound_email_message_id=r.inbound_email_message_id;
  IF b.id IS NULL OR r.company_id IS DISTINCT FROM c OR r.environment IS DISTINCT FROM m.environment
    OR b.company_id IS DISTINCT FROM c OR b.environment IS DISTINCT FROM m.environment OR b.mailbox_id IS DISTINCT FROM r.mailbox_id
    OR b.received_at IS DISTINCT FROM r.received_at OR m.message_received_at IS DISTINCT FROM r.received_at
    OR b.raw_message_sha256 IS DISTINCT FROM r.ciphertext_hash
    OR a.id IS NULL OR a.company_id IS DISTINCT FROM c OR a.inbound_email_message_id IS DISTINCT FROM b.id
    OR a.raw_text IS DISTINCT FROM m.raw_payload
    OR r.cleartext_hash IS DISTINCT FROM gridex_unattributed_intake.sha_v1(a.raw_text)
    OR snapshot_hash IS NULL OR snapshot_hash IS DISTINCT FROM gridex_unattributed_intake.attachment_hash_v1(a)
  THEN RAISE EXCEPTION 'retained_smime_exact_retention_projection_required' USING ERRCODE='23514'; END IF;
  RETURN jsonb_build_object('attachmentId',a.id,'inboundEmailMessageId',b.id,'cleartextHash',r.cleartext_hash,
    'ciphertextHash',r.ciphertext_hash,'attachmentSnapshotHash',snapshot_hash);
END $$;
REVOKE ALL ON FUNCTION gridex_retained_smime_retention.projection_basis_v1(uuid,public.ediel_messages) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_retained_smime_retention.projection_basis_v1(uuid,public.ediel_messages) TO gridex_ediel_retention_owner;

CREATE OR REPLACE FUNCTION gridex_unattributed_intake.protect_retained_smime_projection_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $$
DECLARE r gridex_unattributed_intake.retained_smime_recoveries%rowtype;
BEGIN
  SELECT * INTO r FROM gridex_unattributed_intake.retained_smime_recoveries WHERE attachment_id=OLD.id;
  IF NOT FOUND THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
  IF TG_OP='DELETE' AND gridex_retained_smime_retention.has_tombstone_v1(
    r.company_id,r.environment,r.inbound_email_message_id,r.cleartext_hash,true
  ) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'retained_smime_clear_projection_immutable' USING ERRCODE='23514';
END $$;

CREATE FUNCTION gridex_retained_smime_retention.erase_attachment_v1(p_company_id uuid, p_mail_id uuid, p_attachment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $$
BEGIN
  DELETE FROM public.inbound_email_attachments a
  USING gridex_unattributed_intake.retained_smime_recoveries recovery
  WHERE a.id=p_attachment_id AND a.company_id=p_company_id AND a.inbound_email_message_id=p_mail_id
    AND (recovery.attachment_id,recovery.company_id,recovery.inbound_email_message_id)
        =(a.id,a.company_id,a.inbound_email_message_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'retained_smime_clear_projection_deletion_required'; END IF;
END $$;
REVOKE ALL ON FUNCTION gridex_retained_smime_retention.erase_attachment_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_retained_smime_retention.erase_attachment_v1(uuid,uuid,uuid) TO gridex_ediel_retention_owner;

-- Retention owns the tombstone, current signer authorization and binding.
-- Grant only the temporary installation authority and these private data-free calls.
DO $retention_bridge$
DECLARE migration_role name := current_user;
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_class target JOIN pg_namespace scope ON scope.oid=target.relnamespace
    JOIN pg_roles retention_owner ON retention_owner.oid=target.relowner
    WHERE scope.nspname='gridex_ediel_retention' AND target.relname='blob_tombstones'
      AND retention_owner.rolname='gridex_ediel_retention_owner' AND NOT retention_owner.rolcanlogin
      AND pg_has_role(migration_role,retention_owner.oid,'SET')
  ) THEN RAISE EXCEPTION 'retained_smime_retention_owner_required' USING ERRCODE='42501'; END IF;
  GRANT USAGE, CREATE ON SCHEMA gridex_retained_smime_retention TO gridex_ediel_retention_owner;
  GRANT EXECUTE ON FUNCTION gridex_retained_smime_retention.hold_unmanaged_copies_v1() TO gridex_ediel_retention_owner;
  SET LOCAL ROLE gridex_ediel_retention_owner;

  CREATE FUNCTION gridex_retained_smime_retention.has_tombstone_v1(
    c uuid, env text, mail_id uuid, clear_hash text, require_purge_actor boolean
  ) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
  AS $tombstone$
  DECLARE t gridex_ediel_retention.blob_tombstones%rowtype;
  BEGIN
    SELECT tombstone.* INTO t
    FROM gridex_ediel_retention.blob_tombstones tombstone
    JOIN public.ediel_messages message ON message.id=tombstone.message_id AND message.company_id=tombstone.company_id
    WHERE tombstone.retention_class='received_ediel_message_content' AND tombstone.target_id=message.id
      AND tombstone.company_id=c AND message.environment=env AND message.inbound_email_message_id=mail_id
      AND message.direction='inbound' AND message.message_family IN ('CONTRL','APERAK')
      AND (clear_hash IS NULL OR tombstone.source_hash=clear_hash);
    IF t.target_id IS NULL THEN RETURN false; END IF;
    IF require_purge_actor IS TRUE THEN
      PERFORM gridex_ediel_retention.actor_v1(t.company_id,t.actor_user_id,'ediel.retention.purge');
      IF gridex_ediel_retention.class_permission_v1(t.company_id,t.actor_user_id,t.retention_class) IS NOT TRUE
      THEN RETURN false; END IF;
    END IF;
    RETURN true;
  END
  $tombstone$;
  REVOKE ALL ON FUNCTION gridex_retained_smime_retention.has_tombstone_v1(uuid,text,uuid,text,boolean)
    FROM PUBLIC,anon,authenticated,service_role;
  EXECUTE format('GRANT EXECUTE ON FUNCTION gridex_retained_smime_retention.has_tombstone_v1(uuid,text,uuid,text,boolean) TO %I',migration_role);

  CREATE FUNCTION gridex_retained_smime_retention.erase_attested_projection_v1() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
  AS $erase$
  DECLARE m public.ediel_messages%rowtype; projection jsonb; signed_basis jsonb;
  BEGIN
    IF NEW.retention_class IS DISTINCT FROM 'received_ediel_message_content' THEN RETURN NEW; END IF;
    IF NEW.message_id IS DISTINCT FROM NEW.target_id
    THEN RAISE EXCEPTION 'retained_smime_retention_target_mismatch'; END IF;
    SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=NEW.target_id AND company_id=NEW.company_id FOR UPDATE;
    projection:=gridex_retained_smime_retention.projection_basis_v1(NEW.company_id,m);
    IF projection IS NULL THEN RETURN NEW; END IF;
    PERFORM gridex_ediel_retention.actor_v1(NEW.company_id,NEW.actor_user_id,'ediel.retention.purge');
    IF gridex_ediel_retention.class_permission_v1(NEW.company_id,NEW.actor_user_id,NEW.retention_class) IS NOT TRUE
    THEN RAISE EXCEPTION 'retained_smime_retention_current_class_required'; END IF;
    signed_basis:=gridex_ediel_retention.blob_basis_v1(NEW.company_id,NEW.retention_class,NEW.target_id);
    IF signed_basis->>'targetHash' IS DISTINCT FROM NEW.target_hash
      OR signed_basis->>'sourceHash' IS DISTINCT FROM NEW.source_hash
      OR projection->>'cleartextHash' IS DISTINCT FROM NEW.source_hash
    THEN RAISE EXCEPTION 'retained_smime_exact_retention_target_required'; END IF;
    PERFORM gridex_retained_smime_retention.erase_attachment_v1(NEW.company_id,m.inbound_email_message_id,(projection->>'attachmentId')::uuid);
    RETURN NEW;
  END
  $erase$;
  REVOKE ALL ON FUNCTION gridex_retained_smime_retention.erase_attested_projection_v1() FROM PUBLIC,anon,authenticated,service_role;

  CREATE TRIGGER retained_smime_known_copy_purge_hold BEFORE INSERT ON gridex_ediel_retention.blob_tombstones
    FOR EACH ROW EXECUTE FUNCTION gridex_retained_smime_retention.hold_unmanaged_copies_v1();
  CREATE TRIGGER erase_retained_smime_projection_on_purge_v1 AFTER INSERT ON gridex_ediel_retention.blob_tombstones
    FOR EACH ROW EXECUTE FUNCTION gridex_retained_smime_retention.erase_attested_projection_v1();

  EXECUTE format('SET LOCAL ROLE %I',migration_role);
  REVOKE EXECUTE ON FUNCTION gridex_retained_smime_retention.hold_unmanaged_copies_v1() FROM gridex_ediel_retention_owner;
  REVOKE CREATE ON SCHEMA gridex_retained_smime_retention FROM gridex_ediel_retention_owner;
END
$retention_bridge$;

-- Extend exactly the current retention basis, preserving owner and grants.
DO $migration$
DECLARE
  migration_role name := current_user;
  v_oid oid;
  v_before record;
  v_sql text;
  v_old_declaration constant text := 'payloads jsonb;';
  v_old_branch constant text := ' ELSIF k=''transport_raw_mime_bytes'' THEN';
BEGIN
  SET LOCAL ROLE gridex_ediel_retention_owner;
  v_oid := 'gridex_ediel_retention.blob_basis_v1(uuid,text,uuid)'::regprocedure;
  SELECT p.prosrc, to_jsonb(p)-'prosrc' AS metadata, pg_get_functiondef(p.oid) AS definition
    INTO STRICT v_before FROM pg_proc p WHERE p.oid=v_oid;
  IF encode(sha256(convert_to(v_before.prosrc,'UTF8')),'hex') IS DISTINCT FROM '55e5c91036ea23f79637292f2d318b6392cae00841c16d00b22c61d220563c1c'
     OR (length(v_before.prosrc)-length(replace(v_before.prosrc,v_old_declaration,''))) <> length(v_old_declaration)
     OR (length(v_before.prosrc)-length(replace(v_before.prosrc,v_old_branch,''))) <> length(v_old_branch) THEN
    RAISE EXCEPTION 'retained_smime_retention_basis_predecessor_changed' USING ERRCODE='55000';
  END IF;
  v_sql := replace(v_before.prosrc,v_old_declaration,'payloads jsonb; retained_projection jsonb;');
  v_sql := replace(v_sql,v_old_branch,$branch$
  retained_projection := gridex_retained_smime_retention.projection_basis_v1(c,m);
  IF retained_projection IS NOT NULL THEN
    facts := facts || jsonb_build_object('retainedSmimeRecoveryProjection',retained_projection);
  END IF;
 ELSIF k='transport_raw_mime_bytes' THEN$branch$);
  EXECUTE replace(v_before.definition,v_before.prosrc,v_sql);
  IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=v_oid) IS DISTINCT FROM v_before.metadata THEN
    RAISE EXCEPTION 'retained_smime_retention_basis_authority_changed' USING ERRCODE='55000';
  END IF;
  EXECUTE format('SET LOCAL ROLE %I',migration_role);
END
$migration$;
