-- The Supabase CLI records this migration in the same transaction as this block.
SET lock_timeout = '5s';
SET statement_timeout = '60s';
DO $gridex_migration$
BEGIN

ALTER TABLE public.inbound_email_messages
  ADD COLUMN raw_mailbox_bytes_sha256 text,
  ADD CONSTRAINT inbound_email_mailbox_bytes_sha256_format
    CHECK (raw_mailbox_bytes_sha256 ~ '^[0-9a-f]{64}$') NOT VALID;

COMMENT ON COLUMN public.inbound_email_messages.raw_mailbox_bytes_sha256 IS
  'SHA-256 of physical IMAP source bytes recorded on initial capture. NULL when physical source bytes were not captured.';

CREATE FUNCTION gridex_ediel_transport.guard_mailbox_bytes_digest_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.raw_mailbox_bytes_sha256 IS NOT NULL AND current_user <> 'service_role' THEN
      RAISE EXCEPTION 'physical_mailbox_digest_requires_ingress_role' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.raw_mailbox_bytes_sha256 IS DISTINCT FROM OLD.raw_mailbox_bytes_sha256 THEN
    RAISE EXCEPTION 'physical_mailbox_digest_is_immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$guard$;

REVOKE ALL ON FUNCTION gridex_ediel_transport.guard_mailbox_bytes_digest_v1() FROM PUBLIC;
CREATE TRIGGER gridex_mailbox_bytes_digest_guard
  BEFORE INSERT OR UPDATE OF raw_mailbox_bytes_sha256 ON public.inbound_email_messages
  FOR EACH ROW EXECUTE FUNCTION gridex_ediel_transport.guard_mailbox_bytes_digest_v1();

END
$gridex_migration$;
RESET statement_timeout;
RESET lock_timeout;
