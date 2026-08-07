-- GRIDEX-AUD-003 derived bootstrap: restore only the historical ediel_outbox base relation.
-- Source: supabase/migrations/20260605160000_ediel_backend_automation_foundation.sql
-- The source migration is immutable and checksum-pinned in scripts/migration-history-manifest.json.
-- Keep this artifact narrower than its source so clean replay can satisfy later tracked migrations
-- without prematurely applying unrelated Ediel automation tables/functions.

create table if not exists public.ediel_outbox (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null references public.companies(id),
  ediel_message_id uuid not null references public.ediel_messages(id) on delete cascade,
  source_message_id uuid null references public.ediel_messages(id) on delete set null,
  status text not null default 'prepared',
  priority integer not null default 100,
  lock_key text not null,
  message_family text null,
  message_code text null,
  ack_outcome text null,
  environment text not null default 'test',
  route_profile_id uuid null,
  attempts integer not null default 0,
  last_error text null,
  payload jsonb not null default '{}'::jsonb,
  queued_at timestamptz null,
  sent_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null,
  updated_by uuid null,
  constraint ediel_outbox_status_check check (
    status in ('draft','prepared','queued','sending','sent','failed','superseded','blocked')
  )
);

create unique index if not exists ediel_outbox_lock_key_uidx
  on public.ediel_outbox(lock_key);
