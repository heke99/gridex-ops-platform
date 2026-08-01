-- Canonical multi-tenant platform hardening.
--
-- Forward-only migration. It does not rewrite historical migrations or infer a
-- default tenant. Existing inconsistent rows remain visible to the preflight /
-- backfill scripts, while all newly written tenant-owned relations are guarded.

begin;

create extension if not exists pgcrypto;

-- Neutral public name for the canonical intake transaction. The legacy Gridex-
-- prefixed function remains as a compatibility implementation until every
-- deployed client has moved to this alias.
create or replace function public.canonical_onboard_customer_graph(p_command jsonb)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.gridex_onboard_customer_graph(p_command);
$$;

comment on function public.canonical_onboard_customer_graph(jsonb) is
  'Canonical tenant-neutral customer intake transaction. company_id must be supplied by verified server tenant context.';
comment on function public.gridex_onboard_customer_graph(jsonb) is
  'Deprecated compatibility implementation. New runtime code must call canonical_onboard_customer_graph(jsonb).';

revoke all on function public.canonical_onboard_customer_graph(jsonb) from public, anon, authenticated;
grant execute on function public.canonical_onboard_customer_graph(jsonb) to service_role;

-- Tenant-neutral sequence API. Number format remains owned by company
-- configuration inside the existing implementation; missing schema fails closed.
create or replace function public.canonical_next_customer_number(p_company_id uuid)
returns text
language sql
security definer
set search_path = public, pg_temp
as $$ select public.gridex_next_customer_number(p_company_id); $$;

create or replace function public.canonical_next_contract_number(
  p_company_id uuid,
  p_customer_number text default null
)
returns text
language sql
security definer
set search_path = public, pg_temp
as $$ select public.gridex_next_contract_number(p_company_id, p_customer_number); $$;

create or replace function public.canonical_next_application_number(p_company_id uuid)
returns text
language sql
security definer
set search_path = public, pg_temp
as $$ select public.gridex_next_application_number(p_company_id); $$;

revoke all on function public.canonical_next_customer_number(uuid) from public, anon, authenticated;
revoke all on function public.canonical_next_contract_number(uuid, text) from public, anon, authenticated;
revoke all on function public.canonical_next_application_number(uuid) from public, anon, authenticated;
grant execute on function public.canonical_next_customer_number(uuid) to service_role;
grant execute on function public.canonical_next_contract_number(uuid, text) to service_role;
grant execute on function public.canonical_next_application_number(uuid) to service_role;

-- Neutral alias for the effective legal-source projection. The source view is a
-- legacy database identifier, not a tenant-specific branch.
create or replace view public.canonical_tenant_effective_legal_sources_v
with (security_invoker = true)
as select * from public.gridex_tenant_effective_legal_sources_v;

grant select on public.canonical_tenant_effective_legal_sources_v to authenticated, service_role;

-- Capabilities describe legitimate tenant variation. They never replace RBAC,
-- RLS or relational tenant constraints and default to disabled/fail-closed.
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

comment on function public.canonical_company_capability_enabled(uuid, text) is
  'Fail-closed tenant capability lookup. Security and tenant ownership must be verified separately.';

grant execute on function public.canonical_company_capability_enabled(uuid, text) to authenticated, service_role;

-- Every canonical parent receives a tenant-qualified candidate key so composite
-- foreign keys can reject child.company_id/parent.id mismatches in PostgreSQL.
do $$
declare
  r record;
  index_name text;
begin
  for r in
    select * from (values
      ('customers'),
      ('customer_sites'),
      ('metering_points'),
      ('customer_contracts'),
      ('powers_of_attorney'),
      ('customer_authorization_documents'),
      ('customer_legal_acceptances'),
      ('customer_info_requests'),
      ('supplier_switch_requests'),
      ('customer_invoices'),
      ('customer_onboarding_operations'),
      ('customer_onboarding_applications'),
      ('customer_onboarding_legal_snapshots'),
      ('customer_match_review_cases'),
      ('domain_events'),
      ('event_outbox')
    ) as relations(table_name)
  loop
    if to_regclass(format('public.%I', r.table_name)) is not null
       and exists (
         select 1 from pg_attribute
          where attrelid = to_regclass(format('public.%I', r.table_name))
            and attname = 'company_id' and not attisdropped
       )
       and exists (
         select 1 from pg_attribute
          where attrelid = to_regclass(format('public.%I', r.table_name))
            and attname = 'id' and not attisdropped
       ) then
      index_name := left('mt_' || r.table_name || '_company_id_id_uidx', 63);
      execute format(
        'create unique index if not exists %I on public.%I(company_id, id)',
        index_name,
        r.table_name
      );
    end if;
  end loop;
end;
$$;

-- NOT VALID check constraints protect all new writes immediately without
-- guessing how legacy null tenant rows should be repaired.
do $$
declare
  r record;
  constraint_name text;
begin
  for r in
    select * from (values
      ('customers'),
      ('customer_sites'),
      ('metering_points'),
      ('customer_contracts'),
      ('powers_of_attorney'),
      ('customer_authorization_documents'),
      ('customer_legal_acceptances'),
      ('customer_info_requests'),
      ('supplier_switch_requests'),
      ('customer_invoices'),
      ('customer_onboarding_operations'),
      ('customer_onboarding_applications'),
      ('customer_onboarding_legal_snapshots'),
      ('customer_match_review_cases'),
      ('domain_events'),
      ('event_outbox')
    ) as relations(table_name)
  loop
    if to_regclass(format('public.%I', r.table_name)) is not null
       and exists (
         select 1 from pg_attribute
          where attrelid = to_regclass(format('public.%I', r.table_name))
            and attname = 'company_id' and not attisdropped
       ) then
      constraint_name := left('mt_' || r.table_name || '_company_id_required', 63);
      if not exists (
        select 1 from pg_constraint
         where conrelid = to_regclass(format('public.%I', r.table_name))
           and conname = constraint_name
      ) then
        execute format(
          'alter table public.%I add constraint %I check (company_id is not null) not valid',
          r.table_name,
          constraint_name
        );
      end if;
    end if;
  end loop;
end;
$$;

-- Add tenant-qualified parent/child guards where both columns exist and have
-- compatible types. NOT VALID preserves deployment safety while enforcing the
-- invariant for every new insert/update.
do $$
declare
  r record;
  constraint_name text;
  child_type oid;
  parent_type oid;
begin
  for r in
    select * from (values
      ('customer_sites', 'customer_id', 'customers'),
      ('metering_points', 'customer_id', 'customers'),
      ('metering_points', 'site_id', 'customer_sites'),
      ('metering_points', 'customer_site_id', 'customer_sites'),
      ('customer_contracts', 'customer_id', 'customers'),
      ('customer_contracts', 'site_id', 'customer_sites'),
      ('customer_contracts', 'customer_site_id', 'customer_sites'),
      ('customer_contracts', 'metering_point_id', 'metering_points'),
      ('powers_of_attorney', 'customer_id', 'customers'),
      ('powers_of_attorney', 'site_id', 'customer_sites'),
      ('powers_of_attorney', 'customer_site_id', 'customer_sites'),
      ('powers_of_attorney', 'contract_id', 'customer_contracts'),
      ('powers_of_attorney', 'metering_point_id', 'metering_points'),
      ('customer_authorization_documents', 'customer_id', 'customers'),
      ('customer_authorization_documents', 'site_id', 'customer_sites'),
      ('customer_authorization_documents', 'metering_point_id', 'metering_points'),
      ('customer_authorization_documents', 'power_of_attorney_id', 'powers_of_attorney'),
      ('customer_legal_acceptances', 'customer_id', 'customers'),
      ('customer_legal_acceptances', 'contract_id', 'customer_contracts'),
      ('customer_info_requests', 'customer_id', 'customers'),
      ('customer_info_requests', 'site_id', 'customer_sites'),
      ('customer_info_requests', 'customer_site_id', 'customer_sites'),
      ('customer_info_requests', 'metering_point_id', 'metering_points'),
      ('supplier_switch_requests', 'customer_id', 'customers'),
      ('supplier_switch_requests', 'site_id', 'customer_sites'),
      ('supplier_switch_requests', 'customer_site_id', 'customer_sites'),
      ('supplier_switch_requests', 'contract_id', 'customer_contracts'),
      ('supplier_switch_requests', 'metering_point_id', 'metering_points'),
      ('customer_invoices', 'customer_id', 'customers'),
      ('customer_invoices', 'contract_id', 'customer_contracts'),
      ('customer_onboarding_applications', 'onboarding_operation_id', 'customer_onboarding_operations'),
      ('customer_onboarding_applications', 'customer_id', 'customers'),
      ('customer_onboarding_applications', 'customer_site_id', 'customer_sites'),
      ('customer_onboarding_applications', 'metering_point_id', 'metering_points'),
      ('customer_onboarding_applications', 'contract_id', 'customer_contracts'),
      ('customer_onboarding_legal_snapshots', 'onboarding_operation_id', 'customer_onboarding_operations'),
      ('customer_onboarding_legal_snapshots', 'customer_id', 'customers'),
      ('customer_onboarding_legal_snapshots', 'contract_id', 'customer_contracts'),
      ('customer_onboarding_legal_snapshots', 'power_of_attorney_id', 'powers_of_attorney'),
      ('customer_match_review_cases', 'onboarding_operation_id', 'customer_onboarding_operations'),
      ('customer_match_review_cases', 'resolved_customer_id', 'customers'),
      ('domain_events', 'subject_customer_id', 'customers'),
      ('event_outbox', 'domain_event_id', 'domain_events')
    ) as relations(child_table, child_column, parent_table)
  loop
    if to_regclass(format('public.%I', r.child_table)) is null
       or to_regclass(format('public.%I', r.parent_table)) is null
       or not exists (
         select 1 from pg_attribute
          where attrelid = to_regclass(format('public.%I', r.child_table))
            and attname = 'company_id' and not attisdropped
       )
       or not exists (
         select 1 from pg_attribute
          where attrelid = to_regclass(format('public.%I', r.parent_table))
            and attname = 'company_id' and not attisdropped
       ) then
      continue;
    end if;

    select atttypid into child_type
      from pg_attribute
     where attrelid = to_regclass(format('public.%I', r.child_table))
       and attname = r.child_column
       and not attisdropped;
    select atttypid into parent_type
      from pg_attribute
     where attrelid = to_regclass(format('public.%I', r.parent_table))
       and attname = 'id'
       and not attisdropped;

    if child_type is null or parent_type is null or child_type <> parent_type then
      continue;
    end if;

    constraint_name := left(
      'mt_' || r.child_table || '_' || r.child_column || '_tenant_fk',
      63
    );
    if not exists (
      select 1 from pg_constraint
       where conrelid = to_regclass(format('public.%I', r.child_table))
         and conname = constraint_name
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (company_id, %I) references public.%I(company_id, id) not valid',
        r.child_table,
        constraint_name,
        r.child_column,
        r.parent_table
      );
    end if;
  end loop;
end;
$$;

commit;
