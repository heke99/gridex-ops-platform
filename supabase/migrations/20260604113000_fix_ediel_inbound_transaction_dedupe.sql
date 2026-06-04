-- 2026-06-04
-- Fix inbound Ediel duplicate handling after Batch 7A.
--
-- The old unique index ux_ediel_batch7a_inbound_transaction used only
-- (company_id, sender_ediel_id, transaction_reference, message_code).
-- That is too broad for real Ediel/IMAP flows because a new inbound message can
-- legitimately reuse a transaction/reference while having a new UNB interchange
-- reference or BGM reference. The canonical unique identity for inbound imports
-- should be the UNB interchange reference when it exists.

begin;

-- Remove the unsafe transaction-level uniqueness. It can turn a legitimate new
-- inbound message into a hard 23505 and block IMAP sync/test processing.
drop index if exists public.ux_ediel_batch7a_inbound_transaction;

-- Keep a non-unique lookup index for transaction-based troubleshooting and
-- fallback matching. Uniqueness is already enforced by
-- ux_ediel_batch7a_inbound_interchange when interchange_reference exists.
create index if not exists ix_ediel_inbound_transaction_lookup
  on public.ediel_messages (
    company_id,
    sender_ediel_id,
    receiver_ediel_id,
    transaction_reference,
    coalesce(message_code, ''),
    coalesce(external_reference, ''),
    created_at
  )
  where direction = 'inbound' and transaction_reference is not null;

commit;
