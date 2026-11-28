-- The Supabase CLI records this migration in the same transaction as this block.
SET lock_timeout = '5s';
SET statement_timeout = '60s';
DO $gridex_migration$
BEGIN

ALTER TABLE public.inbound_email_messages
  VALIDATE CONSTRAINT inbound_email_mailbox_bytes_sha256_format;
ALTER TABLE public.inbound_email_messages
  VALIDATE CONSTRAINT inbound_email_imap_transport_identity_shape;

END
$gridex_migration$;
RESET statement_timeout;
RESET lock_timeout;
