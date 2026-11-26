-- The Supabase CLI records this migration in the same transaction as this block.
SET lock_timeout = '5s';
SET statement_timeout = '60s';
DO $gridex_migration$
BEGIN

LOCK TABLE public.inbound_email_messages IN ACCESS EXCLUSIVE MODE;

DO $legacy_imap_indexes$
DECLARE
  expected RECORD;
BEGIN
  FOR expected IN
    SELECT * FROM (VALUES
    ('public.ux_inbound_email_messages_company_sender_interchange', $index$CREATE UNIQUE INDEX ux_inbound_email_messages_company_sender_interchange ON public.inbound_email_messages USING btree (company_id, environment, sender_ediel_id, interchange_reference) WHERE ((sender_ediel_id IS NOT NULL) AND (interchange_reference IS NOT NULL) AND (company_id IS NOT NULL))$index$),
    ('public.ux_inbound_email_messages_company_sender_tx_external', $index$CREATE UNIQUE INDEX ux_inbound_email_messages_company_sender_tx_external ON public.inbound_email_messages USING btree (company_id, environment, sender_ediel_id, transaction_reference, external_reference) WHERE ((sender_ediel_id IS NOT NULL) AND (transaction_reference IS NOT NULL) AND (external_reference IS NOT NULL) AND (company_id IS NOT NULL))$index$),
    ('public.ux_inbound_email_messages_mailbox_message', $index$CREATE UNIQUE INDEX ux_inbound_email_messages_mailbox_message ON public.inbound_email_messages USING btree (mailbox_id, internet_message_id) WHERE ((mailbox_id IS NOT NULL) AND (internet_message_id IS NOT NULL))$index$)
    ) AS definitions(qualified_name, sql)
  LOOP
    IF pg_catalog.pg_get_indexdef(pg_catalog.to_regclass(expected.qualified_name))
      IS DISTINCT FROM expected.sql THEN
      RAISE EXCEPTION 'verified_imap_legacy_index_shape_conflict: %', expected.qualified_name USING ERRCODE = '55000';
    END IF;
  END LOOP;
  FOR expected IN SELECT * FROM (VALUES
    ('idx_inbound_email_company_interchange_uidx','(environment, company_id, sender_ediel_id, interchange_reference)','((company_id IS NOT NULL) AND (sender_ediel_id IS NOT NULL) AND (interchange_reference IS NOT NULL))'),
    ('idx_inbound_email_company_transaction_external_uidx','(environment, company_id, sender_ediel_id, transaction_reference, external_reference)','((company_id IS NOT NULL) AND (sender_ediel_id IS NOT NULL) AND (transaction_reference IS NOT NULL) AND (external_reference IS NOT NULL))'),
    ('idx_inbound_email_mailbox_message_id_uidx','(mailbox_id, internet_message_id)','(internet_message_id IS NOT NULL)'),
    ('idx_inbound_email_mailbox_raw_hash_uidx','(mailbox_id, raw_message_sha256)','(raw_message_sha256 IS NOT NULL)')
  ) AS optional_indexes(name, keys, predicate)
  LOOP
    IF to_regclass('public.' || expected.name) IS NULL THEN CONTINUE; END IF;
    IF (
      SELECT pg_get_indexdef(i.indexrelid)
      FROM pg_index i
      WHERE i.indexrelid = to_regclass('public.' || expected.name)
        AND i.indrelid = 'public.inbound_email_messages'::regclass
        AND i.indisvalid AND i.indisready AND i.indislive
        AND NOT EXISTS (SELECT FROM pg_constraint WHERE conindid = i.indexrelid)
    ) IS DISTINCT FROM 'CREATE UNIQUE INDEX ' || expected.name
         || ' ON public.inbound_email_messages USING btree ' || expected.keys || ' WHERE ' || expected.predicate
    THEN
      RAISE EXCEPTION 'verified_imap_legacy_index_shape_conflict: public.%', expected.name USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$legacy_imap_indexes$;

ALTER TABLE public.inbound_email_messages
  ADD COLUMN imap_account_scope text,
  ADD COLUMN imap_folder text,
  ADD COLUMN imap_uid_validity bigint,
  ADD COLUMN imap_uid bigint,
  ADD CONSTRAINT inbound_email_imap_transport_identity_shape CHECK (
    (imap_account_scope IS NULL AND imap_folder IS NULL AND imap_uid_validity IS NULL AND imap_uid IS NULL)
    OR (mailbox_id IS NOT NULL AND imap_account_scope IS NOT NULL AND imap_account_scope ~ '^[a-f0-9]{64}$' AND nullif(btrim(imap_folder),'') IS NOT NULL
      AND octet_length(imap_folder) <= 1024
      AND imap_uid_validity IS NOT NULL AND imap_uid_validity BETWEEN 1 AND 4294967295
      AND imap_uid IS NOT NULL AND imap_uid BETWEEN 1 AND 4294967295)) NOT VALID;
CREATE UNIQUE INDEX ux_inbound_email_messages_imap_transport
  ON public.inbound_email_messages(mailbox_id,imap_account_scope,imap_folder,imap_uid_validity,imap_uid)
  WHERE imap_uid IS NOT NULL;

DROP INDEX public.ux_inbound_email_messages_company_sender_interchange;
DROP INDEX public.ux_inbound_email_messages_company_sender_tx_external;
DROP INDEX public.ux_inbound_email_messages_mailbox_message;
CREATE UNIQUE INDEX ux_inbound_email_messages_company_sender_interchange
  ON public.inbound_email_messages(company_id,environment,sender_ediel_id,interchange_reference)
  WHERE sender_ediel_id IS NOT NULL AND interchange_reference IS NOT NULL AND company_id IS NOT NULL AND imap_uid IS NULL;
CREATE UNIQUE INDEX ux_inbound_email_messages_company_sender_tx_external
  ON public.inbound_email_messages(company_id,environment,sender_ediel_id,transaction_reference,external_reference)
  WHERE sender_ediel_id IS NOT NULL AND transaction_reference IS NOT NULL AND external_reference IS NOT NULL AND company_id IS NOT NULL AND imap_uid IS NULL;
CREATE UNIQUE INDEX ux_inbound_email_messages_mailbox_message
  ON public.inbound_email_messages(mailbox_id,internet_message_id)
  WHERE mailbox_id IS NOT NULL AND internet_message_id IS NOT NULL AND imap_uid IS NULL;

DO $compat$
BEGIN
  IF to_regclass('public.idx_inbound_email_company_interchange_uidx') IS NOT NULL THEN
    DROP INDEX public.idx_inbound_email_company_interchange_uidx;
    CREATE UNIQUE INDEX idx_inbound_email_company_interchange_uidx ON public.inbound_email_messages USING btree (environment, company_id, sender_ediel_id, interchange_reference) WHERE ((company_id IS NOT NULL) AND (sender_ediel_id IS NOT NULL) AND (interchange_reference IS NOT NULL)) AND imap_uid IS NULL;
  END IF;
  IF to_regclass('public.idx_inbound_email_company_transaction_external_uidx') IS NOT NULL THEN
    DROP INDEX public.idx_inbound_email_company_transaction_external_uidx;
    CREATE UNIQUE INDEX idx_inbound_email_company_transaction_external_uidx ON public.inbound_email_messages USING btree (environment, company_id, sender_ediel_id, transaction_reference, external_reference) WHERE ((company_id IS NOT NULL) AND (sender_ediel_id IS NOT NULL) AND (transaction_reference IS NOT NULL) AND (external_reference IS NOT NULL)) AND imap_uid IS NULL;
  END IF;
  IF to_regclass('public.idx_inbound_email_mailbox_message_id_uidx') IS NOT NULL THEN
    DROP INDEX public.idx_inbound_email_mailbox_message_id_uidx;
    CREATE UNIQUE INDEX idx_inbound_email_mailbox_message_id_uidx ON public.inbound_email_messages USING btree (mailbox_id, internet_message_id) WHERE (internet_message_id IS NOT NULL) AND imap_uid IS NULL;
  END IF;
  IF to_regclass('public.idx_inbound_email_mailbox_raw_hash_uidx') IS NOT NULL THEN
    DROP INDEX public.idx_inbound_email_mailbox_raw_hash_uidx;
    CREATE UNIQUE INDEX idx_inbound_email_mailbox_raw_hash_uidx ON public.inbound_email_messages USING btree (mailbox_id, raw_message_sha256) WHERE (raw_message_sha256 IS NOT NULL) AND imap_uid IS NULL;
  END IF;
END
$compat$;

CREATE FUNCTION gridex_ediel_transport.preserve_inbound_imap_transport_identity_v1() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF TG_OP='INSERT' THEN
    IF new.imap_uid IS NOT NULL AND (current_user <> 'service_role' OR new.raw_mailbox_bytes_sha256 IS NULL) THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='verified_imap_transport_context_required';
    END IF;
  ELSIF (new.imap_account_scope,new.imap_folder,new.imap_uid_validity,new.imap_uid) IS DISTINCT FROM (old.imap_account_scope,old.imap_folder,old.imap_uid_validity,old.imap_uid)
    OR (old.imap_uid IS NOT NULL AND new.mailbox_id IS DISTINCT FROM old.mailbox_id) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='verified_imap_transport_identity_immutable';
  END IF;
  RETURN new;
END
$function$;
REVOKE ALL ON FUNCTION gridex_ediel_transport.preserve_inbound_imap_transport_identity_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER inbound_email_imap_transport_identity_guard
  BEFORE INSERT OR UPDATE ON public.inbound_email_messages FOR EACH ROW
  EXECUTE FUNCTION gridex_ediel_transport.preserve_inbound_imap_transport_identity_v1();

CREATE FUNCTION public.gridex_store_verified_imap_intake_v1(p_message jsonb,p_attachments jsonb)
RETURNS jsonb LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $body$
DECLARE
  proposed public.inbound_email_messages;
  saved public.inbound_email_messages;
  current_company_id uuid;
  current_environment text;
BEGIN
  IF current_user <> 'service_role'
     OR jsonb_typeof(p_message) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_attachments) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='verified_imap_intake_context_required';
  END IF;
  proposed:=jsonb_populate_record(NULL::public.inbound_email_messages,p_message);
  IF proposed.imap_uid IS NULL OR proposed.raw_mailbox_bytes_sha256 IS NULL
     OR NOT (p_message ? 'observed_mailbox_company_id')
     OR jsonb_typeof(p_message->'observed_mailbox_company_id') NOT IN ('string','null') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='verified_imap_transport_context_required';
  END IF;

  SELECT mailbox.company_id, mailbox.environment
    INTO current_company_id, current_environment
    FROM public.ediel_mailboxes mailbox
    WHERE mailbox.id = proposed.mailbox_id
    FOR SHARE NOWAIT;
  IF NOT FOUND OR current_environment IS DISTINCT FROM proposed.environment
     OR current_company_id::text IS DISTINCT FROM (p_message->>'observed_mailbox_company_id')
     OR (current_company_id IS NOT NULL AND current_company_id IS DISTINCT FROM proposed.company_id) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='verified_imap_mailbox_scope_changed';
  END IF;

  INSERT INTO public.inbound_email_messages (
    mailbox_id,company_id,ai_processing_actor_user_id,ai_processing_decision_id,environment,
    internet_message_id,from_address,to_address,subject,received_at,raw_email,raw_edifact_payload,
    body_text,body_html,has_attachments,processing_status,dedupe_key,raw_message_sha256,
    imap_account_scope,imap_folder,imap_uid_validity,imap_uid,raw_mailbox_bytes_sha256,dedupe_scope,
    dedupe_reason,match_status,sender_ediel_id,receiver_ediel_id,interchange_reference,
    transaction_reference,external_reference,message_family,message_code)
  VALUES (
    proposed.mailbox_id,proposed.company_id,proposed.ai_processing_actor_user_id,proposed.ai_processing_decision_id,proposed.environment,
    proposed.internet_message_id,proposed.from_address,proposed.to_address,proposed.subject,proposed.received_at,proposed.raw_email,proposed.raw_edifact_payload,
    proposed.body_text,proposed.body_html,coalesce(proposed.has_attachments,false),'received',proposed.dedupe_key,proposed.raw_message_sha256,
    proposed.imap_account_scope,proposed.imap_folder,proposed.imap_uid_validity,proposed.imap_uid,proposed.raw_mailbox_bytes_sha256,
    CASE WHEN proposed.company_id IS NULL THEN 'mailbox_only' ELSE 'tenant_environment' END,
    'initial_store','not_checked',proposed.sender_ediel_id,proposed.receiver_ediel_id,proposed.interchange_reference,
    proposed.transaction_reference,proposed.external_reference,proposed.message_family,proposed.message_code)
  ON CONFLICT (mailbox_id,imap_account_scope,imap_folder,imap_uid_validity,imap_uid) WHERE imap_uid IS NOT NULL
  DO NOTHING RETURNING * INTO saved;

  IF NOT FOUND THEN
    SELECT * INTO STRICT saved FROM public.inbound_email_messages
    WHERE mailbox_id=proposed.mailbox_id AND imap_account_scope=proposed.imap_account_scope
      AND imap_folder=proposed.imap_folder AND imap_uid_validity=proposed.imap_uid_validity AND imap_uid=proposed.imap_uid;
    IF saved.raw_mailbox_bytes_sha256 IS DISTINCT FROM proposed.raw_mailbox_bytes_sha256 THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='imap_transport_identity_bytes_conflict';
    END IF;
    RETURN jsonb_build_object('id',saved.id,'deduped',true);
  END IF;

  INSERT INTO public.inbound_email_attachments (
    company_id,inbound_email_message_id,filename,mime_type,size_bytes,raw_text,is_edifact_candidate,metadata)
  SELECT saved.company_id,saved.id,a.filename,a.mime_type,a.size_bytes,a.raw_text,
    coalesce(a.is_edifact_candidate,false),coalesce(a.metadata,'{}'::jsonb)
  FROM jsonb_populate_recordset(NULL::public.inbound_email_attachments,p_attachments) a;

  INSERT INTO public.inbound_processing_jobs (company_id,mailbox_id,inbound_email_message_id,status,step,payload)
  VALUES (saved.company_id,saved.mailbox_id,saved.id,'queued','received',jsonb_build_object(
    'dedupeKey',saved.dedupe_key,'hasRawEdifactPayload',coalesce(saved.raw_edifact_payload <> '',false),
    'attachmentCount',jsonb_array_length(p_attachments)));
  RETURN jsonb_build_object('id',saved.id,'deduped',false);
END
$body$;

REVOKE ALL ON FUNCTION public.gridex_store_verified_imap_intake_v1(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_store_verified_imap_intake_v1(jsonb,jsonb) TO service_role;

CREATE FUNCTION gridex_ediel_transport.require_verified_imap_intake_job_v1()
RETURNS trigger LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $guard$
BEGIN
  IF NOT EXISTS (
    SELECT FROM public.inbound_processing_jobs j
    WHERE j.inbound_email_message_id=new.id AND j.mailbox_id=new.mailbox_id
      AND j.company_id IS NOT DISTINCT FROM new.company_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='verified_imap_intake_job_required';
  END IF;
  RETURN NULL;
END
$guard$;
REVOKE ALL ON FUNCTION gridex_ediel_transport.require_verified_imap_intake_job_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE CONSTRAINT TRIGGER inbound_email_verified_imap_intake_job_guard
  AFTER INSERT ON public.inbound_email_messages DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (new.imap_uid IS NOT NULL)
  EXECUTE FUNCTION gridex_ediel_transport.require_verified_imap_intake_job_v1();

END
$gridex_migration$;
RESET statement_timeout;
RESET lock_timeout;
