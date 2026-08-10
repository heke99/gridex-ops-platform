-- GRIDEX-AUD-003 derived interleaved bootstrap prerequisite.
-- Source: supabase/migrations/20260521_actor_testing_go_live_module.sql
-- Restore the source-defined test/production Ediel identity family required by
-- the canonical legacy-run tenant assertion. Existing actor identity is copied
-- only into missing compatibility fields, exactly as in the source migration.

alter table public.companies
  add column if not exists test_ediel_id text null,
  add column if not exists production_ediel_id text null,
  add column if not exists test_sender_sub_address text null,
  add column if not exists production_sender_sub_address text null,
  add column if not exists test_mailbox text null,
  add column if not exists production_mailbox text null,
  add column if not exists test_application_reference text null,
  add column if not exists production_application_reference text null,
  add column if not exists test_counterparty_ediel_id text null,
  add column if not exists production_counterparty_ediel_id text null;

update public.companies
set test_ediel_id = coalesce(test_ediel_id, ediel_id),
    production_ediel_id = coalesce(production_ediel_id, ediel_id),
    test_sender_sub_address = coalesce(test_sender_sub_address, sender_sub_address),
    test_mailbox = coalesce(test_mailbox, ediel_mailbox),
    production_mailbox = coalesce(production_mailbox, ediel_mailbox)
where test_ediel_id is null
   or production_ediel_id is null
   or test_sender_sub_address is null
   or test_mailbox is null
   or production_mailbox is null;
