-- Resend webhook event tracking
-- Idempotent, additive, non-destructive.

create table if not exists public.communication_log_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  communication_log_id uuid references public.communication_logs(id) on delete set null,
  provider text not null default 'resend',
  provider_message_id text,
  provider_event_id text,
  event_type text not null,
  event_payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists idx_communication_log_events_provider_event_id
on public.communication_log_events(provider, provider_event_id)
where provider_event_id is not null;

create index if not exists idx_communication_log_events_company_id
on public.communication_log_events(company_id, occurred_at desc);

create index if not exists idx_communication_log_events_log_id
on public.communication_log_events(communication_log_id, occurred_at desc);

create index if not exists idx_communication_log_events_provider_message_id
on public.communication_log_events(provider, provider_message_id);

create index if not exists idx_communication_log_events_event_type
on public.communication_log_events(event_type, occurred_at desc);

alter table public.communication_log_events enable row level security;

drop policy if exists communication_log_events_service_role_all on public.communication_log_events;
drop policy if exists communication_log_events_select_tenant on public.communication_log_events;
drop policy if exists communication_log_events_platform_write on public.communication_log_events;

create policy communication_log_events_service_role_all
  on public.communication_log_events
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy communication_log_events_select_tenant
  on public.communication_log_events
  for select
  using (
    public.gridex_user_is_platform_admin()
    or (company_id is not null and public.gridex_can_read_company(company_id))
  );

create policy communication_log_events_platform_write
  on public.communication_log_events
  for all
  using (public.gridex_user_is_platform_admin())
  with check (public.gridex_user_is_platform_admin());
