-- GRIDEX-AUD-003 derived bootstrap: restore the historical tenant capability registry.
-- Source: supabase/migrations/20260801143000_canonical_multitenant_platform_hardening.sql
-- The source migration is immutable and checksum-pinned in scripts/migration-history-manifest.json.
-- Keep this artifact limited to the capability registry contract required by the later tracked
-- tenant-operation lifecycle migration.

create table if not exists public.company_capabilities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  capability_code text not null,
  enabled boolean not null default false,
  readiness_status text not null default 'not_configured',
  configuration jsonb not null default '{}'::jsonb,
  blockers text[] not null default '{}'::text[],
  last_verified_at timestamptz,
  last_verified_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  constraint company_capabilities_code_check
    check (capability_code ~ '^[a-z][a-z0-9_]{2,79}$'),
  constraint company_capabilities_readiness_check
    check (readiness_status in ('not_configured', 'blocked', 'ready', 'disabled')),
  constraint company_capabilities_ready_when_enabled_check
    check (not enabled or readiness_status = 'ready'),
  constraint company_capabilities_company_code_key unique (company_id, capability_code)
);

create index if not exists company_capabilities_company_enabled_idx
  on public.company_capabilities(company_id, enabled, capability_code);

alter table public.company_capabilities enable row level security;

drop policy if exists company_capabilities_read on public.company_capabilities;
create policy company_capabilities_read on public.company_capabilities
for select to authenticated
using (
  public.gridex_user_is_platform_admin()
  or public.gridex_can_read_company(company_id)
);

drop policy if exists company_capabilities_platform_write on public.company_capabilities;
create policy company_capabilities_platform_write on public.company_capabilities
for all to authenticated
using (public.gridex_user_is_platform_admin())
with check (public.gridex_user_is_platform_admin());

grant select on public.company_capabilities to authenticated;
grant all on public.company_capabilities to service_role;

insert into public.company_capabilities(company_id, capability_code, enabled, readiness_status)
select c.id, capability_code, false, 'not_configured'
from public.companies c
cross join unnest(array[
  'customer_intake_enabled',
  'manual_intake_enabled',
  'website_intake_enabled',
  'partner_api_enabled',
  'customer_portal_enabled',
  'power_of_attorney_required',
  'facility_lookup_enabled',
  'ediel_enabled',
  'supplier_switch_enabled',
  'invoice_enabled',
  'webhook_delivery_enabled'
]::text[]) capability_code
on conflict (company_id, capability_code) do nothing;

create or replace function public.canonical_company_capability_enabled(
  p_company_id uuid,
  p_capability_code text
)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.company_capabilities cc
     where cc.company_id = p_company_id
       and cc.capability_code = p_capability_code
       and cc.enabled
       and cc.readiness_status = 'ready'
  );
$$;

grant execute on function public.canonical_company_capability_enabled(uuid, text)
  to authenticated, service_role;
