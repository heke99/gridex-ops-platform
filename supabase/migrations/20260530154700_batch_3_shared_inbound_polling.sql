-- Batch 3 — shared Ediel inbound mailbox polling, dedupe and poll-run diagnostics.
-- Idempotent/additive. Physical mailbox is transport; tenant routing must use EDIFACT actor identifiers.

begin;

alter table if exists public.inbound_email_messages
  add column if not exists environment text,
  add column if not exists sender_ediel_id text,
  add column if not exists receiver_ediel_id text,
  add column if not exists interchange_reference text,
  add column if not exists transaction_reference text,
  add column if not exists external_reference text,
  add column if not exists message_family text,
  add column if not exists message_code text;

update public.inbound_email_messages iem
set environment = coalesce(iem.environment, mb.environment)
from public.ediel_mailboxes mb
where iem.mailbox_id = mb.id
  and iem.environment is null;

alter table if exists public.inbound_email_messages
  alter column environment set default 'test';

create index if not exists idx_inbound_email_messages_environment_status
  on public.inbound_email_messages(environment, processing_status, created_at desc);

do $$
begin
  if not exists (
    select 1
    from public.inbound_email_messages
    where sender_ediel_id is not null and interchange_reference is not null
    group by sender_ediel_id, interchange_reference
    having count(*) > 1
  ) then
    create unique index if not exists ux_inbound_email_messages_sender_interchange
      on public.inbound_email_messages(sender_ediel_id, interchange_reference)
      where sender_ediel_id is not null and interchange_reference is not null;
  end if;

  if not exists (
    select 1
    from public.inbound_email_messages
    where sender_ediel_id is not null and transaction_reference is not null and external_reference is not null
    group by sender_ediel_id, transaction_reference, external_reference
    having count(*) > 1
  ) then
    create unique index if not exists ux_inbound_email_messages_sender_tx_external
      on public.inbound_email_messages(sender_ediel_id, transaction_reference, external_reference)
      where sender_ediel_id is not null and transaction_reference is not null and external_reference is not null;
  end if;
end $$;

alter table if exists public.ediel_mailboxes
  add column if not exists secret_reference text,
  add column if not exists poll_interval_minutes integer not null default 5,
  add column if not exists last_polled_at timestamptz,
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by text,
  add column if not exists last_error text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.ediel_mailboxes
  alter column poll_interval_minutes set default 5;

update public.ediel_mailboxes
set poll_interval_minutes = 5,
    updated_at = now()
where company_id is null
  and environment in ('test', 'production')
  and coalesce(metadata->>'scope', 'platform_shared') = 'platform_shared'
  and poll_interval_minutes <> 5;

create index if not exists idx_ediel_mailboxes_shared_polling
  on public.ediel_mailboxes(environment, is_active, last_polled_at, locked_at)
  where company_id is null
    and coalesce(metadata->>'scope', 'platform_shared') = 'platform_shared';

create table if not exists public.ediel_inbound_poll_runs (
  id uuid primary key default gen_random_uuid(),
  worker_id text not null,
  environment text,
  started_at timestamptz not null,
  finished_at timestamptz,
  status text not null default 'success',
  configured_mailboxes integer not null default 0,
  due_mailboxes integer not null default 0,
  skipped_locked integer not null default 0,
  skipped_not_due integer not null default 0,
  fetched_messages integer not null default 0,
  stored_emails integer not null default 0,
  deduped_emails integer not null default 0,
  processed_jobs integer not null default 0,
  failed_jobs integer not null default 0,
  errors_by_mailbox jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_ediel_inbound_poll_runs_env_started
  on public.ediel_inbound_poll_runs(environment, started_at desc);

create index if not exists idx_ediel_inbound_poll_runs_status_started
  on public.ediel_inbound_poll_runs(status, started_at desc);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ediel_inbound_poll_runs_environment_check'
  ) then
    alter table public.ediel_inbound_poll_runs
      add constraint ediel_inbound_poll_runs_environment_check check (environment is null or environment in ('test', 'production'));
  end if;
end $$;

comment on table public.ediel_inbound_poll_runs is 'Diagnostics for automatic shared Ediel inbound mailbox polling.';
comment on column public.ediel_mailboxes.company_id is 'Null means platform shared transport mailbox. Do not route tenant ownership from mailbox email alone.';
comment on column public.ediel_mailboxes.secret_reference is 'Reference to env/secret manager value, for example env:GRIDEX_SHARED_EDIEL_IMAP_PASS. Never store passwords directly.';

commit;
