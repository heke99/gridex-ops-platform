-- Track 3 finding 016: a second inbound mail with the same business reference
-- (company/environment/sender/interchange or transaction+external reference)
-- but DIFFERENT raw content must be storable, so the reception kernel can
-- classify it as an identity conflict and hold it. Identical content (same
-- raw_message_sha256) remains a unique violation (dedupe).
--
-- raw_message_sha256 is nullable; coalesce(raw_message_sha256, '') keeps the
-- previous uniqueness for rows without a hash (all NULL-hash rows with the same
-- reference still collide). Company scope, environment and WHERE predicates are
-- unchanged. Message-ID uniqueness (ux_inbound_email_messages_mailbox_message)
-- and RLS/grants are not touched.
--
-- New indexes are created before the old ones are dropped, then renamed back to
-- the established names.

create unique index ux_inbound_email_messages_company_sender_interchange_sha
  on public.inbound_email_messages (
    company_id,
    environment,
    sender_ediel_id,
    interchange_reference,
    (coalesce(raw_message_sha256, ''))
  )
  where sender_ediel_id is not null
    and interchange_reference is not null
    and company_id is not null;

create unique index ux_inbound_email_messages_company_sender_tx_external_sha
  on public.inbound_email_messages (
    company_id,
    environment,
    sender_ediel_id,
    transaction_reference,
    external_reference,
    (coalesce(raw_message_sha256, ''))
  )
  where sender_ediel_id is not null
    and transaction_reference is not null
    and external_reference is not null
    and company_id is not null;

drop index if exists public.ux_inbound_email_messages_company_sender_interchange;
drop index if exists public.ux_inbound_email_messages_company_sender_tx_external;

alter index public.ux_inbound_email_messages_company_sender_interchange_sha
  rename to ux_inbound_email_messages_company_sender_interchange;
alter index public.ux_inbound_email_messages_company_sender_tx_external_sha
  rename to ux_inbound_email_messages_company_sender_tx_external;
