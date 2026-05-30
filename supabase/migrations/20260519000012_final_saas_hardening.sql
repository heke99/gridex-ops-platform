-- Final SaaS Hardening Batch
-- Purpose: make company/tenant scope explicit, keep user_profiles optional, add import/version history,
-- and add guarded RLS helpers without touching approved Ediel message generation flows.

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- SaaS company foundation
-- -----------------------------------------------------------------------------
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  org_number text,
  status text not null default 'active',
  primary_contact_email text,
  primary_contact_name text,
  phone text,
  website text,
  industry text not null default 'electricity_supplier',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint companies_status_check check (status in ('active', 'inactive', 'suspended'))
);

create table if not exists public.company_memberships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  membership_role text not null default 'member',
  status text not null default 'active',
  invited_email text,
  invited_by uuid references auth.users(id) on delete set null,
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  suspended_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint company_memberships_role_check check (membership_role in ('owner', 'admin', 'member', 'viewer')),
  constraint company_memberships_status_check check (status in ('active', 'pending', 'suspended', 'revoked')),
  constraint company_memberships_company_user_key unique (company_id, user_id)
);

create table if not exists public.company_invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email text not null,
  full_name text,
  membership_role text not null default 'member',
  role_key text,
  status text not null default 'pending',
  token uuid not null default gen_random_uuid(),
  invited_by uuid references auth.users(id) on delete set null,
  invited_user_id uuid references auth.users(id) on delete set null,
  expires_at timestamptz,
  accepted_at timestamptz,
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint company_invitations_membership_role_check check (membership_role in ('owner', 'admin', 'member', 'viewer')),
  constraint company_invitations_status_check check (status in ('pending', 'accepted', 'revoked', 'expired'))
);

create unique index if not exists company_invitations_token_key on public.company_invitations(token);
create index if not exists companies_status_idx on public.companies(status);
create index if not exists company_memberships_user_status_idx on public.company_memberships(user_id, status);
create index if not exists company_memberships_company_status_idx on public.company_memberships(company_id, status);
create index if not exists company_invitations_company_status_idx on public.company_invitations(company_id, status);
create index if not exists company_invitations_email_idx on public.company_invitations(lower(email));

-- Add missing defaults if tables were created by an earlier partial migration.
alter table public.companies alter column id set default gen_random_uuid();
alter table public.company_memberships alter column id set default gen_random_uuid();
alter table public.company_invitations alter column id set default gen_random_uuid();
alter table public.company_invitations alter column token set default gen_random_uuid();

-- -----------------------------------------------------------------------------
-- Optional company_id columns. Guarded because older environments may lack tables.
-- -----------------------------------------------------------------------------
do $$
declare
  target_table text;
  target_tables text[] := array[
    'access_logs',
    'audit_logs',
    'customers',
    'customer_contacts',
    'customer_addresses',
    'customer_sites',
    'metering_points',
    'supplier_switch_requests',
    'supplier_switch_events',
    'outbound_requests',
    'customer_contracts',
    'customer_contract_events',
    'contract_offers',
    'billing_underlays',
    'communication_routes',
    'grid_owner_data_requests',
    'customer_operation_tasks',
    'customer_documents',
    'power_of_attorneys',
    'powers_of_attorney',
    'metering_values',
    'meter_readings'
  ];
begin
  foreach target_table in array target_tables loop
    if to_regclass('public.' || target_table) is not null then
      execute format(
        'alter table public.%I add column if not exists company_id uuid references public.companies(id) on delete set null',
        target_table
      );
      execute format('create index if not exists %I on public.%I(company_id)', target_table || '_company_id_idx', target_table);
    end if;
  end loop;
end $$;

-- Backfill company_id where safe relations exist.
do $$
begin
  if to_regclass('public.customer_sites') is not null and to_regclass('public.customers') is not null then
    update public.customer_sites s
       set company_id = c.company_id
      from public.customers c
     where s.customer_id = c.id
       and s.company_id is null
       and c.company_id is not null;
  end if;

  if to_regclass('public.customer_contacts') is not null and to_regclass('public.customers') is not null then
    update public.customer_contacts cc
       set company_id = c.company_id
      from public.customers c
     where cc.customer_id = c.id
       and cc.company_id is null
       and c.company_id is not null;
  end if;

  if to_regclass('public.customer_addresses') is not null and to_regclass('public.customers') is not null then
    update public.customer_addresses ca
       set company_id = c.company_id
      from public.customers c
     where ca.customer_id = c.id
       and ca.company_id is null
       and c.company_id is not null;
  end if;

  if to_regclass('public.metering_points') is not null and to_regclass('public.customer_sites') is not null then
    update public.metering_points mp
       set company_id = s.company_id
      from public.customer_sites s
     where mp.site_id = s.id
       and mp.company_id is null
       and s.company_id is not null;
  end if;

  if to_regclass('public.supplier_switch_requests') is not null and to_regclass('public.customers') is not null then
    update public.supplier_switch_requests sr
       set company_id = c.company_id
      from public.customers c
     where sr.customer_id = c.id
       and sr.company_id is null
       and c.company_id is not null;
  end if;

  if to_regclass('public.supplier_switch_events') is not null and to_regclass('public.supplier_switch_requests') is not null then
    update public.supplier_switch_events se
       set company_id = sr.company_id
      from public.supplier_switch_requests sr
     where se.switch_request_id = sr.id
       and se.company_id is null
       and sr.company_id is not null;
  end if;

  if to_regclass('public.customer_contracts') is not null and to_regclass('public.customers') is not null then
    update public.customer_contracts cc
       set company_id = c.company_id
      from public.customers c
     where cc.customer_id = c.id
       and cc.company_id is null
       and c.company_id is not null;
  end if;

  if to_regclass('public.customer_contract_events') is not null and to_regclass('public.customer_contracts') is not null then
    update public.customer_contract_events ce
       set company_id = cc.company_id
      from public.customer_contracts cc
     where ce.customer_contract_id = cc.id
       and ce.company_id is null
       and cc.company_id is not null;
  end if;

  if to_regclass('public.billing_underlays') is not null and to_regclass('public.customers') is not null then
    update public.billing_underlays bu
       set company_id = c.company_id
      from public.customers c
     where bu.customer_id = c.id
       and bu.company_id is null
       and c.company_id is not null;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Customer import tracking and contract version history
-- -----------------------------------------------------------------------------
create table if not exists public.customer_import_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  source_kind text not null default 'text',
  file_name text,
  status text not null default 'completed',
  total_rows integer not null default 0,
  created_rows integer not null default 0,
  failed_rows integer not null default 0,
  warnings jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint customer_import_batches_status_check check (status in ('previewed', 'completed', 'failed'))
);

create table if not exists public.customer_import_rows (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references public.customer_import_batches(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  row_number integer not null,
  status text not null default 'created',
  normalized_payload jsonb not null default '{}'::jsonb,
  customer_id uuid,
  error_message text,
  warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint customer_import_rows_status_check check (status in ('created', 'skipped', 'failed', 'duplicate_warning'))
);

-- Earlier batch versions used either batch_id or import_batch_id. Normalize to import_batch_id
-- because the application code writes that column and older environments already have it.
do $$
begin
  if to_regclass('public.customer_import_rows') is not null then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'customer_import_rows' and column_name = 'batch_id'
    ) and not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'customer_import_rows' and column_name = 'import_batch_id'
    ) then
      alter table public.customer_import_rows rename column batch_id to import_batch_id;
    end if;

    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'customer_import_rows' and column_name = 'import_batch_id'
    ) then
      alter table public.customer_import_rows
        add column import_batch_id uuid references public.customer_import_batches(id) on delete cascade;
    end if;
  end if;
end $$;

create table if not exists public.contract_offer_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  contract_offer_id uuid not null,
  version_number integer not null default 1,
  snapshot jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists customer_import_batches_company_created_idx on public.customer_import_batches(company_id, created_at desc);
create index if not exists customer_import_rows_batch_idx on public.customer_import_rows(import_batch_id);
create index if not exists customer_import_rows_company_idx on public.customer_import_rows(company_id);
create index if not exists contract_offer_versions_company_offer_idx on public.contract_offer_versions(company_id, contract_offer_id, created_at desc);

-- Additional contract metadata used by the SaaS UI.
do $$
begin
  if to_regclass('public.contract_offers') is not null then
    alter table public.contract_offers add column if not exists company_id uuid references public.companies(id) on delete set null;
    alter table public.contract_offers add column if not exists last_versioned_at timestamptz;
    alter table public.contract_offers add column if not exists version_note text;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'contract_offers' and column_name = 'is_active'
    ) then
      create index if not exists contract_offers_company_status_idx on public.contract_offers(company_id, status, is_active);
    else
      create index if not exists contract_offers_company_status_idx on public.contract_offers(company_id, status);
    end if;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- RBAC seed without assuming is_system/status/is_active columns exist.
-- -----------------------------------------------------------------------------
do $$
declare
  has_roles boolean := to_regclass('public.roles') is not null;
  has_permissions boolean := to_regclass('public.permissions') is not null;
  has_role_permissions boolean := to_regclass('public.role_permissions') is not null;
  has_role_is_system boolean;
  role_company_admin uuid;
  role_super_admin uuid;
  permission_id uuid;
  permission_key text;
  role_id uuid;
  permission_keys text[] := array['tenants.read', 'tenants.write', 'tenants.invite'];
begin
  if not has_roles or not has_permissions then
    return;
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'roles' and column_name = 'is_system'
  ) into has_role_is_system;

  if has_role_is_system then
    insert into public.roles (key, name, description, is_system)
    values ('company_admin', 'Bolagsansvarig', 'Administrerar användare och dagliga flöden inom sitt eget elhandelsbolag.', true)
    on conflict (key) do update
      set name = excluded.name,
          description = excluded.description,
          is_system = true;
  else
    insert into public.roles (key, name, description)
    values ('company_admin', 'Bolagsansvarig', 'Administrerar användare och dagliga flöden inom sitt eget elhandelsbolag.')
    on conflict (key) do update
      set name = excluded.name,
          description = excluded.description;
  end if;

  foreach permission_key in array permission_keys loop
    insert into public.permissions (key, name, description)
    values (
      permission_key,
      case permission_key
        when 'tenants.read' then 'Läsa bolag'
        when 'tenants.write' then 'Skapa och ändra bolag'
        else 'Bjuda in till bolag'
      end,
      case permission_key
        when 'tenants.read' then 'Kan se elhandelsbolag på plattformen.'
        when 'tenants.write' then 'Kan skapa och uppdatera elhandelsbolag.'
        else 'Kan bjuda in användare till ett elhandelsbolag.'
      end
    )
    on conflict (key) do update
      set name = excluded.name,
          description = excluded.description;
  end loop;

  if not has_role_permissions then
    return;
  end if;

  select id into role_company_admin from public.roles where key = 'company_admin' limit 1;
  select id into role_super_admin from public.roles where key = 'super_admin' limit 1;

  foreach permission_key in array permission_keys loop
    select id into permission_id from public.permissions where key = permission_key limit 1;
    if permission_id is null then
      continue;
    end if;

    foreach role_id in array array[role_company_admin, role_super_admin] loop
      if role_id is not null then
        insert into public.role_permissions (role_id, permission_id)
        values (role_id, permission_id)
        on conflict do nothing;
      end if;
    end loop;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- RLS helpers. These make tenant policies reusable and tolerate older user_roles shapes.
-- -----------------------------------------------------------------------------
create or replace function public.gridex_auth_has_role(p_role_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  has_status boolean;
  has_is_active boolean;
  sql text;
  result boolean := false;
begin
  if auth.uid() is null then
    return false;
  end if;

  if to_regclass('public.user_roles') is null or to_regclass('public.roles') is null then
    return false;
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'user_roles' and column_name = 'status'
  ) into has_status;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'user_roles' and column_name = 'is_active'
  ) into has_is_active;

  sql := 'select exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = $1 and r.key = $2';

  if has_status then
    sql := sql || ' and coalesce(ur.status, ''active'') = ''active''';
  elsif has_is_active then
    sql := sql || ' and coalesce(ur.is_active, true) = true';
  end if;

  sql := sql || ')';

  execute sql into result using auth.uid(), p_role_key;
  return coalesce(result, false);
end;
$$;

create or replace function public.gridex_user_is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.gridex_auth_has_role('super_admin');
$$;

create or replace function public.gridex_user_company_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select cm.company_id
  from public.company_memberships cm
  where cm.user_id = auth.uid()
    and cm.status = 'active';
$$;

create or replace function public.gridex_user_can_manage_company(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.gridex_user_is_super_admin()
    or exists (
      select 1
      from public.company_memberships cm
      where cm.company_id = p_company_id
        and cm.user_id = auth.uid()
        and cm.status = 'active'
        and cm.membership_role in ('owner', 'admin')
    );
$$;

-- Enable RLS and add company policies for tables that carry company_id.
do $$
declare
  target_table text;
  target_tables text[] := array[
    'companies',
    'company_memberships',
    'company_invitations',
    'customer_import_batches',
    'customer_import_rows',
    'contract_offer_versions',
    'customers',
    'customer_contacts',
    'customer_addresses',
    'customer_sites',
    'metering_points',
    'supplier_switch_requests',
    'supplier_switch_events',
    'outbound_requests',
    'customer_contracts',
    'customer_contract_events',
    'contract_offers',
    'billing_underlays',
    'communication_routes'
  ];
  has_company_id boolean;
begin
  foreach target_table in array target_tables loop
    if to_regclass('public.' || target_table) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', target_table);

    if target_table in ('companies', 'company_memberships', 'company_invitations') then
      continue;
    end if;

    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = target_table and column_name = 'company_id'
    ) into has_company_id;

    if has_company_id then
      execute format('drop policy if exists %I on public.%I', target_table || '_tenant_select', target_table);
      execute format('drop policy if exists %I on public.%I', target_table || '_tenant_insert', target_table);
      execute format('drop policy if exists %I on public.%I', target_table || '_tenant_update', target_table);
      execute format('drop policy if exists %I on public.%I', target_table || '_tenant_delete', target_table);

      execute format('create policy %I on public.%I for select using (public.gridex_user_is_super_admin() or company_id in (select * from public.gridex_user_company_ids()))', target_table || '_tenant_select', target_table);
      execute format('create policy %I on public.%I for insert with check (public.gridex_user_is_super_admin() or company_id in (select * from public.gridex_user_company_ids()))', target_table || '_tenant_insert', target_table);
      execute format('create policy %I on public.%I for update using (public.gridex_user_is_super_admin() or company_id in (select * from public.gridex_user_company_ids())) with check (public.gridex_user_is_super_admin() or company_id in (select * from public.gridex_user_company_ids()))', target_table || '_tenant_update', target_table);
      execute format('create policy %I on public.%I for delete using (public.gridex_user_is_super_admin() or company_id in (select * from public.gridex_user_company_ids()))', target_table || '_tenant_delete', target_table);
    end if;
  end loop;
end $$;

-- Company-level policies.
drop policy if exists companies_tenant_select on public.companies;
create policy companies_tenant_select on public.companies
  for select
  using (
    public.gridex_user_is_super_admin()
    or id in (select * from public.gridex_user_company_ids())
  );

drop policy if exists companies_super_admin_write on public.companies;
create policy companies_super_admin_write on public.companies
  for all
  using (public.gridex_user_is_super_admin())
  with check (public.gridex_user_is_super_admin());

drop policy if exists company_memberships_tenant_select on public.company_memberships;
create policy company_memberships_tenant_select on public.company_memberships
  for select
  using (
    public.gridex_user_is_super_admin()
    or user_id = auth.uid()
    or company_id in (select * from public.gridex_user_company_ids())
  );

drop policy if exists company_memberships_tenant_write on public.company_memberships;
create policy company_memberships_tenant_write on public.company_memberships
  for all
  using (public.gridex_user_can_manage_company(company_id))
  with check (public.gridex_user_can_manage_company(company_id));

drop policy if exists company_invitations_tenant_select on public.company_invitations;
create policy company_invitations_tenant_select on public.company_invitations
  for select
  using (
    public.gridex_user_is_super_admin()
    or company_id in (select * from public.gridex_user_company_ids())
  );

drop policy if exists company_invitations_tenant_write on public.company_invitations;
create policy company_invitations_tenant_write on public.company_invitations
  for all
  using (public.gridex_user_can_manage_company(company_id))
  with check (public.gridex_user_can_manage_company(company_id));

-- -----------------------------------------------------------------------------
-- Tenant-aware contract filter RPC used by the customer register.
-- -----------------------------------------------------------------------------
create or replace function public.admin_customer_ids_by_latest_contract(
  search_text text default null,
  customer_status text default null,
  contract_bucket text default 'all',
  page_num integer default 1,
  page_size integer default 25,
  company_id uuid default null
)
returns table(customer_id uuid, total_count bigint)
language sql
stable
as $$
  with scoped_customers as (
    select c.id,
           c.customer_number,
           c.full_name,
           c.company_name,
           c.email,
           c.phone,
           c.status,
           c.company_id
    from public.customers c
    where ($6 is null or c.company_id = $6)
      and (customer_status is null or customer_status = 'all' or c.status = customer_status)
      and (
        search_text is null
        or search_text = ''
        or coalesce(c.customer_number, '') ilike '%' || search_text || '%'
        or coalesce(c.full_name, '') ilike '%' || search_text || '%'
        or coalesce(c.company_name, '') ilike '%' || search_text || '%'
        or coalesce(c.email, '') ilike '%' || search_text || '%'
        or coalesce(c.phone, '') ilike '%' || search_text || '%'
      )
  ), latest_contract as (
    select distinct on (cc.customer_id)
           cc.customer_id,
           cc.status
    from public.customer_contracts cc
    join scoped_customers sc on sc.id = cc.customer_id
    order by cc.customer_id, cc.created_at desc
  ), filtered as (
    select sc.id
    from scoped_customers sc
    left join latest_contract lc on lc.customer_id = sc.id
    where contract_bucket = 'all'
       or (contract_bucket = 'none' and lc.customer_id is null)
       or (contract_bucket = 'pending_signature' and lc.status = 'pending_signature')
       or (contract_bucket = 'signed' and lc.status = 'signed')
       or (contract_bucket = 'active' and lc.status = 'active')
       or (contract_bucket = 'closed' and lc.status in ('terminated', 'cancelled', 'expired'))
  ), counted as (
    select filtered.id, count(*) over () as total_count
    from filtered
    order by filtered.id desc
    limit greatest(page_size, 1)
    offset greatest(page_num - 1, 0) * greatest(page_size, 1)
  )
  select counted.id, counted.total_count
  from counted;
$$;

-- Keep Ediel approved generators untouched. This migration only changes operational/SaaS scope.
