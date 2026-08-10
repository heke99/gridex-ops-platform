-- GRIDEX-AUD-003 derived bootstrap artifact.
-- Source evidence: supabase/migrations/20260521_batch_2c_end_to_end_operations.sql
-- Purpose: restore only the source-defined customer_portal_completions relation,
-- base indexes and source RLS policies required by the canonical portal API.
-- No completion rows or tenant/customer data are seeded.
-- The immutable source migration remains checksum-pinned by migration-history-manifest.json.

create table if not exists public.customer_portal_completions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  site_id uuid null,
  metering_point_id uuid null,
  completion_type text not null default 'missing_information',
  status text not null default 'submitted',
  submitted_payload jsonb not null default '{}'::jsonb,
  linked_case_id uuid null,
  linked_info_request_id uuid null,
  created_by_user_id uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_portal_completions_status_check
    check (status in ('submitted', 'in_review', 'accepted', 'rejected', 'cancelled'))
);

create index if not exists customer_portal_completions_company_status_idx
  on public.customer_portal_completions(company_id, status, created_at desc);

create index if not exists customer_portal_completions_customer_idx
  on public.customer_portal_completions(customer_id, created_at desc);

alter table public.customer_portal_completions enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'customer_portal_completions'
      and policyname = 'customer_portal_completions_service_role_all'
  ) then
    create policy customer_portal_completions_service_role_all
      on public.customer_portal_completions
      for all to service_role
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'customer_portal_completions'
      and policyname = 'customer_portal_completions_tenant_select'
  ) then
    create policy customer_portal_completions_tenant_select
      on public.customer_portal_completions
      for select
      using (
        public.gridex_user_is_platform_admin()
        or public.gridex_can_read_company(company_id)
      );
  end if;
end $$;
