-- AUD-003 deterministic bootstrap.
-- Source: supabase/migrations/20260724210000_customer_application_continuation_orchestrator.sql
-- Restores only the continuation schema additions and workflow-event ledger
-- required by later canonical event projection. No workflows, jobs or events are seeded.

create extension if not exists pgcrypto;

alter table if exists public.customer_application_workflows
  add column if not exists next_action text null,
  add column if not exists last_transition_at timestamptz not null default now(),
  add column if not exists workflow_version integer not null default 1,
  add column if not exists last_job_id uuid null;

alter table if exists public.customer_application_workflows
  drop constraint if exists customer_application_workflows_state_check;

alter table if exists public.customer_application_workflows
  add constraint customer_application_workflows_state_check check (state in (
    'received','provisioning','provisioned','pending_customer_data','ready_for_switch','pending_review','failed','cancelled',
    'application_received','validation_failed','canonical_data_committed',
    'initial_notifications_pending','initial_notifications_queued',
    'facility_information_check','facility_information_required',
    'facility_request_pending','facility_request_sent','waiting_for_facility_response',
    'facility_response_received','facility_response_needs_review','facility_information_completed',
    'switch_readiness_check','waiting_for_customer_data_response','switch_blocked','switch_request_pending',
    'switch_request_queued','switch_dispatched','waiting_for_switch_response',
    'switch_confirmed','switch_rejected','supply_activation_pending',
    'supply_active','completed','manual_review'
  ));

create table if not exists public.customer_application_workflow_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  workflow_id uuid not null references public.customer_application_workflows(id) on delete cascade,
  customer_application_id uuid not null references public.website_customer_applications(id) on delete cascade,
  operation_id uuid not null,
  from_state text null,
  to_state text not null,
  event_code text not null,
  reason_code text null,
  actor_user_id uuid null references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists customer_application_workflow_events_idempotency_uidx
  on public.customer_application_workflow_events(company_id, idempotency_key);
create index if not exists customer_application_workflow_events_workflow_idx
  on public.customer_application_workflow_events(company_id, workflow_id, occurred_at desc);

alter table public.customer_application_workflow_events enable row level security;

do $$
begin
  if to_regprocedure('public.gridex_can_read_company(uuid)') is not null
     and not exists (
       select 1 from pg_policies
       where schemaname='public' and tablename='customer_application_workflow_events'
         and policyname='customer_application_workflow_events_tenant_read'
     ) then
    create policy customer_application_workflow_events_tenant_read
      on public.customer_application_workflow_events
      for select to authenticated
      using (public.gridex_can_read_company(company_id));
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='customer_application_workflow_events'
      and policyname='customer_application_workflow_events_service_role_all'
  ) then
    create policy customer_application_workflow_events_service_role_all
      on public.customer_application_workflow_events
      for all to service_role using (true) with check (true);
  end if;
end $$;

alter table if exists public.customer_operation_jobs
  add column if not exists workflow_id uuid null references public.customer_application_workflows(id) on delete cascade,
  add column if not exists payload_version integer not null default 1,
  add column if not exists last_error_code text null,
  add column if not exists last_error_message text null;

create index if not exists customer_operation_jobs_workflow_idx
  on public.customer_operation_jobs(company_id, workflow_id, created_at desc)
  where workflow_id is not null;

create unique index if not exists customer_operation_jobs_application_continuation_uidx
  on public.customer_operation_jobs(company_id, workflow_id, job_type)
  where workflow_id is not null and job_type = 'customer_application_continuation';

create unique index if not exists customer_operation_jobs_lifecycle_notification_uidx
  on public.customer_operation_jobs(company_id, job_type, idempotency_key)
  where job_type = 'dispatch_lifecycle_notification';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.customer_application_workflows'::regclass
      and conname='customer_application_workflows_last_job_fk'
  ) then
    alter table public.customer_application_workflows
      add constraint customer_application_workflows_last_job_fk
      foreign key (last_job_id) references public.customer_operation_jobs(id) on delete set null;
  end if;
end $$;
