-- Derived clean-replay prerequisite from checksum-pinned Batch 7A source.
-- Restores only inbound_processing_jobs, its base index and source RLS policies
-- before the canonical 20260618200000 claim-lock hardening references its row type.
create table if not exists public.inbound_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  mailbox_id uuid references public.ediel_mailboxes(id) on delete set null,
  inbound_email_message_id uuid references public.inbound_email_messages(id) on delete cascade,
  status text not null default 'queued',
  step text,
  attempts_count integer not null default 0,
  locked_at timestamptz,
  locked_by text,
  started_at timestamptz,
  finished_at timestamptz,
  error_message text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_inbound_processing_jobs_status
  on public.inbound_processing_jobs(status, created_at);

alter table public.inbound_processing_jobs enable row level security;

drop policy if exists inbound_processing_jobs_service_role_all on public.inbound_processing_jobs;
create policy inbound_processing_jobs_service_role_all
  on public.inbound_processing_jobs for all to service_role
  using (true) with check (true);

drop policy if exists inbound_processing_jobs_platform_select on public.inbound_processing_jobs;
create policy inbound_processing_jobs_platform_select
  on public.inbound_processing_jobs for select
  using (public.gridex_user_is_platform_admin());

drop policy if exists inbound_processing_jobs_platform_write on public.inbound_processing_jobs;
create policy inbound_processing_jobs_platform_write
  on public.inbound_processing_jobs for all
  using (public.gridex_user_is_platform_admin())
  with check (public.gridex_user_is_platform_admin());
