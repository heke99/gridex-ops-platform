-- AUD-003 deterministic bootstrap.
-- Source: supabase/migrations/20260618213000_ops_completion_workflows_health.sql
-- Restores only the durable website-application workflow relation required by
-- later continuation/event provenance. No workflows are seeded.

create extension if not exists pgcrypto;

create table if not exists public.customer_application_workflows (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_application_id uuid not null references public.website_customer_applications(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  customer_site_id uuid null references public.customer_sites(id) on delete set null,
  metering_point_id uuid null references public.metering_points(id) on delete set null,
  contract_id uuid null references public.customer_contracts(id) on delete set null,
  operation_id uuid not null default gen_random_uuid(),
  state text not null default 'received',
  snapshot jsonb not null default '{}'::jsonb,
  failure_code text null,
  failure_detail_internal text null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_application_workflows_state_check check (state in (
    'received','provisioning','provisioned','pending_customer_data','ready_for_switch','pending_review','failed','cancelled'
  ))
);

create unique index if not exists customer_application_workflows_application_uidx
  on public.customer_application_workflows(company_id, customer_application_id);
create index if not exists customer_application_workflows_company_state_idx
  on public.customer_application_workflows(company_id, state, updated_at desc);

alter table public.customer_application_workflows enable row level security;

do $$
begin
  if to_regprocedure('public.gridex_can_read_company(uuid)') is not null and not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='customer_application_workflows'
      and policyname='customer_application_workflows_tenant_read'
  ) then
    create policy customer_application_workflows_tenant_read on public.customer_application_workflows
      for select to authenticated using (public.gridex_can_read_company(company_id));
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='customer_application_workflows'
      and policyname='customer_application_workflows_service_role_all'
  ) then
    create policy customer_application_workflows_service_role_all on public.customer_application_workflows
      for all to service_role using (true) with check (true);
  end if;
end $$;
