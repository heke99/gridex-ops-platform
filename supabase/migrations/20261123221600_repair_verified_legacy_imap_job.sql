DO $migration$
BEGIN
  CREATE TABLE gridex_ediel_transport.legacy_imap_job_recoveries (
    inbound_email_message_id uuid PRIMARY KEY REFERENCES public.inbound_email_messages(id) ON DELETE CASCADE,
    mailbox_id uuid NOT NULL,
    account_scope text NOT NULL,
    folder text NOT NULL,
    uid_validity bigint NOT NULL,
    uid bigint NOT NULL,
    physical_sha256 text NOT NULL,
    restores_initial_job boolean NOT NULL,
    UNIQUE (mailbox_id,account_scope,folder,uid_validity,uid)
  );
  REVOKE ALL ON TABLE gridex_ediel_transport.legacy_imap_job_recoveries FROM PUBLIC, anon, authenticated, service_role;

  -- The private repair owner must present the transaction's exact new source proof.
  -- Normal UPDATE statements retain all existing immutability guards.
  CREATE FUNCTION gridex_ediel_transport.is_proven_legacy_imap_recovery_v1(
    before_row public.inbound_email_messages, after_row public.inbound_email_messages
  ) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path TO pg_catalog
  AS $auth$
  BEGIN
    IF current_user IS DISTINCT FROM (
      SELECT pg_get_userbyid(p.proowner)
      FROM pg_catalog.pg_proc p
      WHERE p.oid='gridex_ediel_transport.recover_legacy_imap_job_v1(public.inbound_email_messages,jsonb)'::regprocedure
    ) OR current_setting('role',true) IS DISTINCT FROM 'service_role' THEN RETURN false; END IF;

    RETURN before_row.imap_uid IS NULL AND before_row.received_at_source IS NULL
      AND after_row.received_at_source='imap_internal_date'
      AND (before_row.raw_mailbox_bytes_sha256 IS NULL OR before_row.raw_mailbox_bytes_sha256=after_row.raw_mailbox_bytes_sha256)
      AND (to_jsonb(before_row) - ARRAY['imap_account_scope','imap_folder','imap_uid_validity','imap_uid','raw_mailbox_bytes_sha256','received_at_source','updated_at'])
        = (to_jsonb(after_row) - ARRAY['imap_account_scope','imap_folder','imap_uid_validity','imap_uid','raw_mailbox_bytes_sha256','received_at_source','updated_at'])
      AND EXISTS (
        SELECT FROM gridex_ediel_transport.legacy_imap_job_recoveries proof
        WHERE proof.restores_initial_job AND (proof.inbound_email_message_id,proof.mailbox_id,proof.account_scope,proof.folder,proof.uid_validity,proof.uid,proof.physical_sha256)
          = (after_row.id,after_row.mailbox_id,after_row.imap_account_scope,after_row.imap_folder,after_row.imap_uid_validity,after_row.imap_uid,after_row.raw_mailbox_bytes_sha256)
      );
  END;
  $auth$;
  REVOKE ALL ON FUNCTION gridex_ediel_transport.is_proven_legacy_imap_recovery_v1(public.inbound_email_messages,public.inbound_email_messages)
   FROM PUBLIC, anon, authenticated, service_role;

  CREATE FUNCTION gridex_ediel_transport.recover_legacy_imap_job_v1(
    proposed public.inbound_email_messages, attachments jsonb
  ) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog
  AS $repair$
  DECLARE
    original public.inbound_email_messages;
    existing_attachments boolean;
    prior_proof gridex_ediel_transport.legacy_imap_job_recoveries;
    existing_processing boolean;
  BEGIN
    IF current_setting('role',true) IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='legacy_imap_recovery_service_required';
    END IF;
    IF proposed.received_at_source IS DISTINCT FROM 'imap_internal_date'
       OR proposed.internet_message_id IS NULL
       OR proposed.internet_message_id !~ '^<[^<>[:space:]@]+@[^<>[:space:]@]+>$'
       OR proposed.raw_email IS NULL OR proposed.raw_message_sha256 IS NULL
       OR proposed.raw_mailbox_bytes_sha256 IS NULL OR proposed.imap_uid IS NULL
    THEN RETURN NULL; END IF;

    PERFORM FROM public.ediel_mailboxes m
    WHERE (m.id,m.environment)=(proposed.mailbox_id,proposed.environment)
      AND m.company_id IS NOT DISTINCT FROM proposed.company_id FOR SHARE;
    IF NOT FOUND THEN RETURN NULL; END IF;

    SELECT * INTO prior_proof FROM gridex_ediel_transport.legacy_imap_job_recoveries proof
    WHERE (proof.mailbox_id,proof.account_scope,proof.folder,proof.uid_validity,proof.uid)
      =(proposed.mailbox_id,proposed.imap_account_scope,proposed.imap_folder,proposed.imap_uid_validity,proposed.imap_uid);
    IF FOUND THEN
      IF prior_proof.physical_sha256 IS DISTINCT FROM proposed.raw_mailbox_bytes_sha256 THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='imap_transport_identity_bytes_conflict';
      END IF;
      RETURN prior_proof.inbound_email_message_id;
    END IF;

    -- The old mailbox/Message-ID uniqueness applies to rows without physical identity.
    -- Require equal source text, independently retained text digest and server clock.
    SELECT * INTO original FROM public.inbound_email_messages m
    WHERE (m.mailbox_id,m.environment,m.internet_message_id,m.received_at,m.raw_message_sha256)
        =(proposed.mailbox_id,proposed.environment,proposed.internet_message_id,proposed.received_at,proposed.raw_message_sha256)
      AND m.company_id IS NOT DISTINCT FROM proposed.company_id
      AND m.raw_email=proposed.raw_email AND m.imap_uid IS NULL
      AND m.received_at_source IS NULL FOR UPDATE;
    IF NOT FOUND THEN RETURN NULL; END IF;

    -- A competing receive may have bound the unchanged historical row while we waited.
    SELECT * INTO prior_proof FROM gridex_ediel_transport.legacy_imap_job_recoveries proof
    WHERE proof.inbound_email_message_id=original.id;
    IF FOUND THEN
      IF (prior_proof.mailbox_id,prior_proof.account_scope,prior_proof.folder,prior_proof.uid_validity,prior_proof.uid)
        IS DISTINCT FROM (proposed.mailbox_id,proposed.imap_account_scope,proposed.imap_folder,proposed.imap_uid_validity,proposed.imap_uid)
      THEN RETURN NULL; END IF;
      IF prior_proof.physical_sha256 IS DISTINCT FROM proposed.raw_mailbox_bytes_sha256 THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='imap_transport_identity_bytes_conflict';
      END IF;
      RETURN prior_proof.inbound_email_message_id;
    END IF;

    SELECT EXISTS (SELECT FROM public.inbound_processing_jobs j WHERE j.inbound_email_message_id=original.id
               AND j.mailbox_id=original.mailbox_id AND j.company_id IS NOT DISTINCT FROM original.company_id)
      OR EXISTS (SELECT FROM public.ediel_messages e WHERE e.inbound_email_message_id=original.id)
      OR EXISTS (SELECT FROM gridex_ediel_inbound_receptions.receptions r WHERE r.inbound_email_message_id=original.id)
      INTO existing_processing;

    IF NOT existing_processing AND (
      original.processing_status IS DISTINCT FROM 'received' OR original.match_status IS DISTINCT FROM 'not_checked'
      OR original.match_payload IS DISTINCT FROM '{}'::jsonb OR original.duplicate_of_id IS NOT NULL
      OR original.error_message IS NOT NULL
      OR EXISTS (SELECT FROM public.inbound_processing_jobs j WHERE j.inbound_email_message_id=original.id)
    ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='legacy_imap_recovery_requires_review'; END IF;

    IF original.raw_message_sha256 IS DISTINCT FROM encode(sha256(convert_to(original.raw_email,'UTF8')),'hex')
      OR (CASE WHEN original.raw_mailbox_bytes_sha256 IS NOT NULL THEN
           original.raw_mailbox_bytes_sha256 IS DISTINCT FROM proposed.raw_mailbox_bytes_sha256
         ELSE octet_length(original.raw_email) <> char_length(original.raw_email)
           OR original.raw_message_sha256 IS DISTINCT FROM proposed.raw_mailbox_bytes_sha256 END)
      OR (original.ai_processing_actor_user_id,original.ai_processing_decision_id) IS DISTINCT FROM
         (proposed.ai_processing_actor_user_id,proposed.ai_processing_decision_id)
      OR (original.raw_edifact_payload,original.body_text,original.body_html,original.has_attachments) IS DISTINCT FROM
         (proposed.raw_edifact_payload,proposed.body_text,proposed.body_html,proposed.has_attachments)
    THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='legacy_imap_recovery_original_unverified';
    END IF;

    SELECT EXISTS(SELECT FROM public.inbound_email_attachments a WHERE a.inbound_email_message_id=original.id)
      INTO existing_attachments;
    IF existing_attachments AND EXISTS (
      WITH retained AS (
        SELECT a.company_id,a.filename,a.mime_type,a.size_bytes,a.raw_text,a.is_edifact_candidate,a.metadata
        FROM public.inbound_email_attachments a WHERE a.inbound_email_message_id=original.id
      ), received AS (
        SELECT original.company_id,a.filename,a.mime_type,a.size_bytes,a.raw_text,
          coalesce(a.is_edifact_candidate,false),coalesce(a.metadata,'{}'::jsonb)
        FROM jsonb_populate_recordset(NULL::public.inbound_email_attachments,attachments) a
      )
      (SELECT * FROM retained EXCEPT ALL SELECT * FROM received)
      UNION ALL
      (SELECT * FROM received EXCEPT ALL SELECT * FROM retained)
    ) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='legacy_imap_recovery_attachment_conflict';
    END IF;

    INSERT INTO gridex_ediel_transport.legacy_imap_job_recoveries
    VALUES (original.id,original.mailbox_id,proposed.imap_account_scope,proposed.imap_folder,proposed.imap_uid_validity,
      proposed.imap_uid,proposed.raw_mailbox_bytes_sha256,NOT existing_processing);
    IF existing_processing THEN RETURN original.id; END IF;

    UPDATE public.inbound_email_messages SET
      imap_account_scope=proposed.imap_account_scope, imap_folder=proposed.imap_folder,
      imap_uid_validity=proposed.imap_uid_validity, imap_uid=proposed.imap_uid,
      raw_mailbox_bytes_sha256=proposed.raw_mailbox_bytes_sha256, received_at_source='imap_internal_date'
    WHERE id=original.id;

    IF NOT existing_attachments THEN
      INSERT INTO public.inbound_email_attachments (
        company_id,inbound_email_message_id,filename,mime_type,size_bytes,raw_text,is_edifact_candidate,metadata)
      SELECT original.company_id,original.id,a.filename,a.mime_type,a.size_bytes,a.raw_text,
        coalesce(a.is_edifact_candidate,false),coalesce(a.metadata,'{}'::jsonb)
      FROM jsonb_populate_recordset(NULL::public.inbound_email_attachments,attachments) a;
    END IF;
    INSERT INTO public.inbound_processing_jobs (company_id,mailbox_id,inbound_email_message_id,status,step,payload)
    VALUES (original.company_id,original.mailbox_id,original.id,'queued','received',jsonb_build_object(
      'dedupeKey',original.dedupe_key,'hasRawEdifactPayload',coalesce(original.raw_edifact_payload <> '',false),
      'attachmentCount',jsonb_array_length(attachments)));
    RETURN original.id;
  END;
  $repair$;
  REVOKE ALL ON FUNCTION gridex_ediel_transport.recover_legacy_imap_job_v1(public.inbound_email_messages,jsonb)
   FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION gridex_ediel_transport.recover_legacy_imap_job_v1(public.inbound_email_messages,jsonb) TO service_role;

  DO $splice$
  DECLARE
    target regprocedure;
    old_fragment text;
    new_fragment text;
    def text;
    original record;
    guard_test constant text := $guard$BEGIN
  IF TG_OP='UPDATE' AND current_user <> 'service_role'
    AND current_setting('role',true)='service_role' THEN
    IF current_user = (
      SELECT pg_get_userbyid(p.proowner) FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='gridex_ediel_transport' AND p.proname='recover_legacy_imap_job_v1'
    ) AND gridex_ediel_transport.is_proven_legacy_imap_recovery_v1(OLD,NEW) THEN RETURN NEW; END IF;
  END IF;
$guard$;
  BEGIN
    FOREACH target IN ARRAY ARRAY[
      'gridex_ediel_transport.preserve_inbound_imap_transport_identity_v1()'::regprocedure,
      'gridex_ediel_transport.guard_mailbox_bytes_digest_v1()'::regprocedure,
      'gridex_ediel_inbound_receptions.guard_mail_clock_v1()'::regprocedure,
      'public.gridex_store_verified_imap_intake_v1(jsonb,jsonb)'::regprocedure
    ] LOOP
      SELECT p.oid,p.prosrc,to_jsonb(p)-'prosrc' AS metadata,pg_get_functiondef(p.oid) AS body
      INTO STRICT original FROM pg_proc p WHERE p.oid=target;
      IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(original.prosrc,'UTF8')),'hex')
        IS DISTINCT FROM (CASE target::oid
          WHEN 'gridex_ediel_transport.preserve_inbound_imap_transport_identity_v1()'::regprocedure::oid THEN '5fe1724c80ccb71d732bce79889e794c7b42401f6a1f5aae8c660cb386b9a966'
          WHEN 'gridex_ediel_transport.guard_mailbox_bytes_digest_v1()'::regprocedure::oid THEN 'e4128d5d1f94bf27f3a7998e059ca4dabd6fd606ebb0aedcdecac66f51d0fdcf'
          WHEN 'gridex_ediel_inbound_receptions.guard_mail_clock_v1()'::regprocedure::oid THEN '8b5dd9b2334b5cb35562bb47ec21a8bacbd7a7f7427721f24d5c431cae6f3687'
          ELSE '2dffc81636e221a916cda39921fd5aa69f1a3c38f68877d9110c6a10f92247ea' END)
      THEN RAISE EXCEPTION 'legacy_imap_recovery_predecessor_changed:%',target USING ERRCODE='55000'; END IF;
      IF target='public.gridex_store_verified_imap_intake_v1(jsonb,jsonb)'::regprocedure THEN
        old_fragment:=$before$  INSERT INTO public.inbound_email_messages ($before$;
        new_fragment:=$after$  -- Physical identity already received always takes precedence over repair.
  IF NOT EXISTS (
    SELECT FROM public.inbound_email_messages m
    WHERE (m.mailbox_id,m.imap_account_scope,m.imap_folder,m.imap_uid_validity,m.imap_uid)
      =(proposed.mailbox_id,proposed.imap_account_scope,proposed.imap_folder,proposed.imap_uid_validity,proposed.imap_uid)
  ) THEN
    saved.id:=gridex_ediel_transport.recover_legacy_imap_job_v1(proposed,p_attachments);
    IF saved.id IS NOT NULL THEN RETURN jsonb_build_object('id',saved.id,'deduped',true); END IF;
  END IF;

  INSERT INTO public.inbound_email_messages ($after$;
      ELSE
        old_fragment:=$before$BEGIN
$before$;
        new_fragment:=guard_test;
      END IF;
      def:=replace(original.body,original.prosrc,replace(original.prosrc,old_fragment,new_fragment));
      IF (length(original.prosrc)-length(replace(original.prosrc,old_fragment,'')))/length(old_fragment)<>1
      THEN RAISE EXCEPTION 'legacy_imap_recovery_writer_shape_changed:%',target USING ERRCODE='55000'; END IF;
      EXECUTE def;
      IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=target) IS DISTINCT FROM original.metadata
      THEN RAISE EXCEPTION 'legacy_imap_recovery_writer_authority_changed:%',target USING ERRCODE='55000'; END IF;
    END LOOP;
  END;
  $splice$;
END;
$migration$;
