-- DB1: Schema repair, dedupe foundation and safe backfill foundation for Gridex Ops Platform.
-- Purpose:
--   1) Bring the live database up to the canonical SaaS/operations schema expected by the app.
--   2) Add dedupe/backfill tracking before any data migration.
--   3) Add safety views that show gaps before DB2 performs real backfill.
-- Safety rules:
--   - No destructive deletes.
--   - No aggressive customer merge.
--   - All core DDL is idempotent.
--   - Unique indexes are attempted safely; if duplicates exist, the finding is logged and migration continues.

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. Schema repair bookkeeping
-- -----------------------------------------------------------------------------
create table if not exists public.gridex_schema_repair_runs (
  id uuid primary key default gen_random_uuid(),
  repair_key text not null unique,
  status text not null default 'started',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.gridex_schema_repair_findings (
  id uuid primary key default gen_random_uuid(),
  repair_key text not null,
  severity text not null default 'info',
  finding_area text not null,
  object_name text,
  message text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.backfill_runs (
  id uuid primary key default gen_random_uuid(),
  run_key text not null unique,
  source_scope text not null,
  status text not null default 'planned',
  started_at timestamptz,
  completed_at timestamptz,
  rows_seen integer not null default 0,
  rows_inserted integer not null default 0,
  rows_updated integer not null default 0,
  rows_skipped integer not null default 0,
  rows_failed integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid
);

create table if not exists public.backfill_run_items (
  id uuid primary key default gen_random_uuid(),
  backfill_run_id uuid references public.backfill_runs(id) on delete cascade,
  source_table text not null,
  source_id text,
  target_table text,
  target_id uuid,
  status text not null default 'pending',
  message text,
  source_hash text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.canonical_record_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  source_table text not null,
  source_id text not null,
  canonical_table text not null,
  canonical_id uuid not null,
  source_hash text,
  confidence text not null default 'system',
  status text not null default 'active',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid,
  unique (source_table, source_id, canonical_table)
);

create table if not exists public.duplicate_groups (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  entity_type text not null,
  dedupe_key text not null,
  canonical_record_id uuid,
  status text not null default 'open',
  confidence text not null default 'candidate',
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, entity_type, dedupe_key)
);

create table if not exists public.duplicate_group_members (
  id uuid primary key default gen_random_uuid(),
  duplicate_group_id uuid not null references public.duplicate_groups(id) on delete cascade,
  record_table text not null,
  record_id uuid not null,
  match_reason text,
  score numeric,
  is_canonical boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (duplicate_group_id, record_table, record_id)
);

insert into public.gridex_schema_repair_runs (repair_key, status, summary)
values ('db1_schema_repair_backfill_foundation_20260522', 'started', '{"phase":"db1"}'::jsonb)
on conflict (repair_key) do update
set status = 'started', started_at = now(), completed_at = null, summary = excluded.summary;

-- Helper used by this migration so duplicate dirty data does not abort DB1.
create or replace function public.gridex_db1_log_finding(
  p_severity text,
  p_area text,
  p_object text,
  p_message text,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  insert into public.gridex_schema_repair_findings(repair_key, severity, finding_area, object_name, message, details)
  values ('db1_schema_repair_backfill_foundation_20260522', p_severity, p_area, p_object, p_message, coalesce(p_details, '{}'::jsonb));
end;
$$;

create or replace function public.gridex_db1_try_exec(
  p_area text,
  p_object text,
  p_sql text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  execute p_sql;
exception when others then
  perform public.gridex_db1_log_finding(
    'warning',
    p_area,
    p_object,
    SQLERRM,
    jsonb_build_object('sqlstate', SQLSTATE, 'sql', p_sql)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Normalization helpers for safe dedupe/backfill
-- -----------------------------------------------------------------------------
create or replace function public.gridex_normalize_email(p_email text)
returns text
language sql
immutable
as $$
  select nullif(lower(btrim(coalesce(p_email, ''))), '')
$$;

create or replace function public.gridex_normalize_phone(p_phone text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '')
$$;

create or replace function public.gridex_normalize_personal_number(p_value text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(coalesce(p_value, ''), '[^0-9]', '', 'g'), '')
$$;

create or replace function public.gridex_normalize_org_number(p_value text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(coalesce(p_value, ''), '[^0-9]', '', 'g'), '')
$$;

create or replace function public.gridex_normalize_facility_id(p_value text)
returns text
language sql
immutable
as $$
  select nullif(upper(regexp_replace(coalesce(p_value, ''), '[^A-Za-z0-9]', '', 'g')), '')
$$;

create or replace function public.gridex_normalize_metering_point_id(p_value text)
returns text
language sql
immutable
as $$
  select nullif(upper(regexp_replace(coalesce(p_value, ''), '[^A-Za-z0-9]', '', 'g')), '')
$$;

create or replace function public.gridex_make_source_hash(p_payload jsonb)
returns text
language sql
immutable
as $$
  select encode(digest(coalesce(p_payload, '{}'::jsonb)::text, 'sha256'), 'hex')
$$;

-- Public helper wrappers requested by DB1. Keep the gridex_* names for app internals,
-- and expose the shorter canonical helper names for SQL/backfill usage.
create or replace function public.normalize_email(p_email text)
returns text
language sql
immutable
as $$
  select public.gridex_normalize_email(p_email)
$$;

create or replace function public.normalize_phone(p_phone text)
returns text
language sql
immutable
as $$
  select public.gridex_normalize_phone(p_phone)
$$;

create or replace function public.normalize_personal_number(p_value text)
returns text
language sql
immutable
as $$
  select public.gridex_normalize_personal_number(p_value)
$$;

create or replace function public.normalize_facility_id(p_value text)
returns text
language sql
immutable
as $$
  select public.gridex_normalize_facility_id(p_value)
$$;

create or replace function public.gridex_make_idempotency_key(variadic p_parts text[])
returns text
language sql
immutable
as $$
  select encode(
    digest(
      array_to_string(
        coalesce(
          (
            select array_agg(coalesce(nullif(btrim(part_value), ''), '<null>') order by part_order)
            from unnest(p_parts) with ordinality as parts(part_value, part_order)
          ),
          array[]::text[]
        ),
        '|'
      ),
      'sha256'
    ),
    'hex'
  )
$$;

create or replace function public.make_idempotency_key(variadic p_parts text[])
returns text
language sql
immutable
as $$
  select public.gridex_make_idempotency_key(variadic p_parts)
$$;

create or replace function public.make_idempotency_key(p_payload jsonb)
returns text
language sql
immutable
as $$
  select encode(digest(coalesce(p_payload, '{}'::jsonb)::text, 'sha256'), 'hex')
$$;

create or replace function public.gridex_db1_default_company_id()
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_company_id uuid;
  v_company_count integer := 0;
begin
  select count(*) into v_company_count from public.companies;

  if v_company_count = 0 then
    insert into public.companies (name, slug, company_slug, status, is_active, is_paused, metadata)
    values ('Div3rsa AB', 'div3rsa-ab', 'div3rsa-ab', 'active', true, false, '{"source":"db1_default_company"}'::jsonb)
    returning id into v_company_id;
    return v_company_id;
  end if;

  if v_company_count = 1 then
    select id
    into v_company_id
    from public.companies
    order by created_at nulls last, id::text
    limit 1;
    return v_company_id;
  end if;

  perform public.gridex_db1_log_finding(
    'warning',
    'default_company',
    'companies',
    'No default company selected because more than one company exists.',
    jsonb_build_object('company_count', v_company_count)
  );
  return null;
end;
$$;


-- -----------------------------------------------------------------------------
-- 3. Tenant, RBAC and company foundation
-- -----------------------------------------------------------------------------
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text,
  company_slug text,
  org_number text,
  normalized_org_number text generated always as (public.gridex_normalize_org_number(org_number)) stored,
  status text not null default 'active',
  is_active boolean not null default true,
  is_paused boolean not null default false,
  paused_at timestamptz,
  paused_by uuid,
  pause_reason text,
  ediel_id text,
  default_environment text not null default 'test',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

alter table public.companies add column if not exists slug text;
alter table public.companies add column if not exists company_slug text;
alter table public.companies add column if not exists org_number text;
alter table public.companies add column if not exists status text default 'active';
alter table public.companies add column if not exists is_active boolean default true;
alter table public.companies add column if not exists is_paused boolean default false;
alter table public.companies add column if not exists paused_at timestamptz;
alter table public.companies add column if not exists paused_by uuid;
alter table public.companies add column if not exists pause_reason text;
alter table public.companies add column if not exists ediel_id text;
alter table public.companies add column if not exists default_environment text default 'test';
alter table public.companies add column if not exists metadata jsonb default '{}'::jsonb;
alter table public.companies add column if not exists created_at timestamptz default now();
alter table public.companies add column if not exists updated_at timestamptz default now();
alter table public.companies add column if not exists created_by uuid;
alter table public.companies add column if not exists updated_by uuid;
do $$ begin
  if to_regclass('public.companies') is not null then
    begin
      alter table public.companies add column if not exists normalized_org_number text generated always as (public.gridex_normalize_org_number(org_number)) stored;
    exception when others then
      perform public.gridex_db1_log_finding('warning','compat_column','companies.normalized_org_number',SQLERRM,jsonb_build_object('sqlstate',SQLSTATE));
    end;
  end if;
end $$;

create table if not exists public.company_memberships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null,
  role text,
  role_id uuid,
  status text not null default 'active',
  is_active boolean not null default true,
  invited_email text,
  invited_by uuid,
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (company_id, user_id)
);

create table if not exists public.company_invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email text not null,
  role text,
  role_id uuid,
  status text not null default 'pending',
  invitation_token text,
  expires_at timestamptz,
  accepted_at timestamptz,
  cancelled_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  key text unique,
  name text not null,
  description text,
  scope text not null default 'company',
  is_system_role boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.permissions (
  id uuid primary key default gen_random_uuid(),
  key text unique,
  name text not null,
  description text,
  category text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.role_permissions (
  id uuid primary key default gen_random_uuid(),
  role_id uuid references public.roles(id) on delete cascade,
  role_key text,
  permission_id uuid references public.permissions(id) on delete cascade,
  permission_key text,
  effect text not null default 'allow',
  created_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  company_id uuid,
  role text,
  role_id uuid,
  status text not null default 'active',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  company_id uuid,
  permission_id uuid,
  permission_key text,
  effect text not null default 'allow',
  status text not null default 'active',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_permission_overrides (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  user_id uuid not null,
  permission_key text not null,
  effect text not null default 'allow',
  reason text,
  valid_from timestamptz,
  valid_to timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (company_id, user_id, permission_key)
);

alter table public.user_roles add column if not exists role text;
alter table public.user_roles add column if not exists role_id uuid;
alter table public.user_roles add column if not exists company_id uuid;
alter table public.user_roles add column if not exists status text default 'active';
alter table public.user_roles add column if not exists is_active boolean default true;
alter table public.roles add column if not exists key text;
alter table public.roles add column if not exists scope text default 'company';
alter table public.permissions add column if not exists key text;
alter table public.role_permissions add column if not exists role_key text;
alter table public.role_permissions add column if not exists permission_key text;
alter table public.user_permissions add column if not exists permission_key text;
alter table public.user_permissions add column if not exists company_id uuid;
alter table public.user_permissions add column if not exists effect text default 'allow';
alter table public.user_permissions add column if not exists status text default 'active';
alter table public.user_permissions add column if not exists is_active boolean default true;

insert into public.companies (name, slug, company_slug, status, is_active, is_paused, metadata)
select 'Div3rsa AB', 'div3rsa-ab', 'div3rsa-ab', 'active', true, false, '{"source":"db1_default_company"}'::jsonb
where not exists (select 1 from public.companies);

-- More tolerant RBAC helpers. Existing live DBs may use user_roles.role text or user_roles.role_id.
create or replace function public.gridex_user_has_role_key(p_role_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  has_role_id boolean := false;
  has_role_text boolean := false;
  has_role_key boolean := false;
  has_status boolean := false;
  has_is_active boolean := false;
  sql text;
  result boolean := false;
begin
  if p_role_key is null or auth.uid() is null then
    return false;
  end if;
  if to_regclass('public.user_roles') is null then
    return false;
  end if;

  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='user_roles' and column_name='role_id') into has_role_id;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='user_roles' and column_name='role') into has_role_text;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='user_roles' and column_name='role_key') into has_role_key;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='user_roles' and column_name='status') into has_status;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='user_roles' and column_name='is_active') into has_is_active;

  sql := 'select exists (select 1 from public.user_roles ur ';
  if has_role_id and to_regclass('public.roles') is not null then
    sql := sql || 'left join public.roles r on r.id = ur.role_id ';
  end if;
  sql := sql || 'where ur.user_id = $1 and (';

  if has_role_text then
    sql := sql || 'lower(coalesce(ur.role, '''')) = lower($2)';
  else
    sql := sql || 'false';
  end if;
  if has_role_key then
    sql := sql || ' or lower(coalesce(ur.role_key, '''')) = lower($2)';
  end if;
  if has_role_id and to_regclass('public.roles') is not null then
    sql := sql || ' or lower(coalesce(r.key, r.name, '''')) = lower($2)';
  end if;
  sql := sql || ')';

  if has_status then
    sql := sql || ' and coalesce(ur.status, ''active'') = ''active''';
  end if;
  if has_is_active then
    sql := sql || ' and coalesce(ur.is_active, true) = true';
  end if;

  sql := sql || ')';
  execute sql into result using auth.uid(), p_role_key;
  return coalesce(result, false);
exception when others then
  return false;
end;
$$;

create or replace function public.gridex_user_is_platform_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  return public.gridex_user_has_role_key('super_admin')
    or public.gridex_user_has_role_key('superadmin')
    or public.gridex_user_has_role_key('platform_admin')
    or exists (
      select 1 from public.admin_users au
      where au.user_id = auth.uid()
        and coalesce(au.is_active, true) = true
        and lower(coalesce(au.role, '')) in ('super_admin','superadmin','platform_admin','admin')
    );
exception when others then
  return false;
end;
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
    and coalesce(cm.status, 'active') = 'active'
    and coalesce(cm.is_active, true) = true
$$;

create or replace function public.gridex_can_read_company(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select p_company_id is not null and (
    public.gridex_user_is_platform_admin()
    or exists (select 1 from public.gridex_user_company_ids() as c(company_id) where c.company_id = p_company_id)
  )
$$;

create or replace function public.gridex_can_write_company(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select p_company_id is not null and (
    public.gridex_user_is_platform_admin()
    or exists (
      select 1 from public.company_memberships cm
      where cm.company_id = p_company_id
        and cm.user_id = auth.uid()
        and coalesce(cm.status, 'active') = 'active'
        and coalesce(cm.is_active, true) = true
        and lower(coalesce(cm.role, '')) in ('company_admin','admin','operations_manager','customer_service_manager')
    )
  )
$$;

create or replace function public.gridex_user_can_manage_company(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.gridex_can_write_company(p_company_id)
$$;

create or replace function public.gridex_can(p_permission text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  result boolean := false;
begin
  if p_permission is null or auth.uid() is null then
    return false;
  end if;
  if public.gridex_user_is_platform_admin() then
    return true;
  end if;

  if to_regclass('public.user_permission_overrides') is not null then
    select exists(
      select 1 from public.user_permission_overrides upo
      where upo.user_id = auth.uid()
        and upo.permission_key = p_permission
        and coalesce(upo.is_active, true) = true
        and coalesce(upo.effect, 'allow') = 'allow'
        and (upo.valid_from is null or upo.valid_from <= now())
        and (upo.valid_to is null or upo.valid_to >= now())
    ) into result;
    if result then return true; end if;
  end if;

  if to_regclass('public.user_permissions') is not null then
    select exists(
      select 1 from public.user_permissions up
      left join public.permissions p on p.id = up.permission_id
      where up.user_id = auth.uid()
        and coalesce(up.status, 'active') = 'active'
        and coalesce(up.is_active, true) = true
        and coalesce(up.effect, 'allow') = 'allow'
        and lower(coalesce(up.permission_key, p.key, '')) = lower(p_permission)
    ) into result;
    if result then return true; end if;
  end if;

  if to_regclass('public.role_permissions') is not null and to_regclass('public.user_roles') is not null then
    select exists(
      select 1
      from public.user_roles ur
      left join public.roles r on r.id = ur.role_id or lower(coalesce(r.key, '')) = lower(coalesce(ur.role, ''))
      left join public.role_permissions rp on rp.role_id = r.id or lower(coalesce(rp.role_key, '')) = lower(coalesce(ur.role, r.key, ''))
      left join public.permissions p on p.id = rp.permission_id
      where ur.user_id = auth.uid()
        and coalesce(ur.status, 'active') = 'active'
        and coalesce(ur.is_active, true) = true
        and coalesce(rp.effect, 'allow') = 'allow'
        and lower(coalesce(rp.permission_key, p.key, '')) = lower(p_permission)
    ) into result;
  end if;

  return coalesce(result, false);
exception when others then
  return false;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Customer, site, metering and contract canonical tables
-- -----------------------------------------------------------------------------
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  customer_type text not null default 'private',
  status text not null default 'draft',
  first_name text,
  last_name text,
  full_name text,
  company_name text,
  personal_number text,
  normalized_personal_number text generated always as (public.gridex_normalize_personal_number(personal_number)) stored,
  org_number text,
  normalized_org_number text generated always as (public.gridex_normalize_org_number(org_number)) stored,
  email text,
  normalized_email text generated always as (public.gridex_normalize_email(email)) stored,
  phone text,
  normalized_phone text generated always as (public.gridex_normalize_phone(phone)) stored,
  preferred_language text default 'sv',
  source text,
  customer_number text,
  apartment_number text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table if not exists public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  customer_id uuid references public.customers(id) on delete cascade,
  type text not null default 'registered',
  street_1 text,
  street_2 text,
  postal_code text,
  city text,
  country text not null default 'SE',
  municipality text,
  moved_in_at date,
  moved_out_at date,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table if not exists public.customer_contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  customer_id uuid references public.customers(id) on delete cascade,
  type text not null default 'primary',
  name text,
  email text,
  normalized_email text generated always as (public.gridex_normalize_email(email)) stored,
  phone text,
  normalized_phone text generated always as (public.gridex_normalize_phone(phone)) stored,
  title text,
  is_primary boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table if not exists public.customer_internal_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  customer_id uuid references public.customers(id) on delete cascade,
  body text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table if not exists public.grid_owners (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  name text not null,
  owner_code text,
  ediel_id text,
  org_number text,
  contact_name text,
  email text,
  phone text,
  address_line_1 text,
  address_line_2 text,
  postal_code text,
  city text,
  country text not null default 'SE',
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table if not exists public.electricity_suppliers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  name text not null,
  org_number text,
  market_actor_code text,
  ediel_id text,
  contact_name text,
  email text,
  phone text,
  notes text,
  is_active boolean not null default true,
  is_own_supplier boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table if not exists public.price_areas (
  code text primary key,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

insert into public.price_areas(code, name, sort_order)
values ('SE1','SE1',1), ('SE2','SE2',2), ('SE3','SE3',3), ('SE4','SE4',4)
on conflict (code) do nothing;

create table if not exists public.price_area_localities (
  id uuid primary key default gen_random_uuid(),
  price_area_code text references public.price_areas(code),
  locality_name text not null,
  municipality text,
  postal_code text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table if not exists public.customer_sites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  customer_id uuid references public.customers(id) on delete cascade,
  site_name text not null default 'Anläggning',
  facility_id text,
  normalized_facility_id text generated always as (public.gridex_normalize_facility_id(facility_id)) stored,
  site_type text not null default 'consumption',
  status text not null default 'draft',
  grid_owner_id uuid,
  price_area_code text,
  move_in_date date,
  move_out_date date,
  closed_at timestamptz,
  closed_reason text,
  annual_consumption_kwh numeric,
  annual_production_kwh numeric,
  current_supplier_name text,
  current_supplier_org_number text,
  street text,
  care_of text,
  postal_code text,
  city text,
  country text not null default 'SE',
  moved_from_street text,
  moved_from_postal_code text,
  moved_from_city text,
  moved_from_supplier_name text,
  internal_notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table if not exists public.metering_points (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  customer_id uuid references public.customers(id) on delete cascade,
  site_id uuid references public.customer_sites(id) on delete cascade,
  meter_point_id text,
  metering_point_id text,
  normalized_metering_point_id text generated always as (public.gridex_normalize_metering_point_id(coalesce(meter_point_id, metering_point_id))) stored,
  site_facility_id text,
  ediel_reference text,
  status text not null default 'draft',
  measurement_type text not null default 'consumption',
  reading_frequency text not null default 'hourly',
  grid_owner_id uuid,
  price_area_code text,
  start_date date,
  end_date date,
  closed_at timestamptz,
  closed_reason text,
  is_settlement_relevant boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table if not exists public.contract_offers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  name text not null,
  slug text,
  status text not null default 'draft',
  contract_type text not null default 'variable_monthly',
  campaign_name text,
  campaign_code text,
  campaign_version text,
  price_version text,
  terms_version text,
  offer_version text,
  terms_document_url text,
  version_snapshot jsonb default '{}'::jsonb,
  max_customers integer,
  discount_value numeric,
  discount_unit text,
  start_fee_sek numeric,
  admin_fee_sek numeric,
  break_fee_sek numeric,
  vat_rate numeric default 25,
  description text,
  fixed_price_ore_per_kwh numeric,
  spot_markup_ore_per_kwh numeric,
  variable_fee_ore_per_kwh numeric,
  monthly_fee_sek numeric,
  green_fee_mode text not null default 'none',
  green_fee_value numeric,
  default_binding_months integer,
  default_notice_months integer,
  optional_fee_lines jsonb not null default '[]'::jsonb,
  is_active boolean not null default false,
  valid_from date,
  valid_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table if not exists public.customer_contracts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  customer_id uuid references public.customers(id),
  site_id uuid,
  metering_point_id uuid,
  customer_site_id uuid,
  contract_offer_id uuid,
  source_type text not null default 'manual_override',
  status text not null default 'draft',
  contract_name text not null default 'Elavtal',
  contract_type text not null default 'variable_monthly',
  campaign_name text,
  campaign_code text,
  campaign_version text,
  price_version text,
  terms_version text,
  contract_version text,
  signed_version text,
  terms_signed_version text,
  version_snapshot jsonb default '{}'::jsonb,
  start_status text,
  old_supplier_start_at date,
  grid_owner_confirmed_start_at date,
  ediel_confirmed_start_at date,
  export_blocked boolean not null default false,
  export_block_reason text,
  price_snapshot jsonb default '{}'::jsonb,
  campaign_snapshot jsonb default '{}'::jsonb,
  billing_ready_status text,
  billing_blocker_reasons jsonb default '[]'::jsonb,
  withdrawal_requested_at timestamptz,
  rejected_reason text,
  fixed_price_ore_per_kwh numeric,
  spot_markup_ore_per_kwh numeric,
  variable_fee_ore_per_kwh numeric,
  monthly_fee_sek numeric,
  green_fee_mode text default 'none',
  green_fee_value numeric,
  binding_months integer,
  notice_months integer,
  optional_fee_lines jsonb default '[]'::jsonb,
  starts_at date,
  expected_start_at date,
  confirmed_start_at date,
  actual_start_at date,
  start_date_source text,
  ends_at date,
  signed_at timestamptz,
  termination_notice_date date,
  termination_reason text,
  auto_renew_enabled boolean not null default false,
  auto_renew_term_months integer,
  override_reason text,
  invoice_recipient text,
  invoice_email text,
  invoice_reference text,
  billing_street text,
  billing_postal_code text,
  billing_city text,
  billing_country text default 'SE',
  billing_address_same_as_site boolean default true,
  billing_level text,
  consolidated_invoice boolean default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table if not exists public.customer_contract_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  customer_contract_id uuid,
  customer_id uuid,
  event_type text not null,
  happened_at timestamptz not null default now(),
  note text,
  metadata jsonb default '{}'::jsonb,
  actor_user_id uuid,
  created_at timestamptz not null default now()
);


-- Add key compatibility columns when these tables already existed before DB1.
do $$
begin
  if to_regclass('public.customers') is not null then
    alter table public.customers add column if not exists company_id uuid;
    alter table public.customers add column if not exists customer_type text default 'private';
    alter table public.customers add column if not exists status text default 'draft';
    alter table public.customers add column if not exists first_name text;
    alter table public.customers add column if not exists last_name text;
    alter table public.customers add column if not exists full_name text;
    alter table public.customers add column if not exists company_name text;
    alter table public.customers add column if not exists personal_number text;
    alter table public.customers add column if not exists org_number text;
    alter table public.customers add column if not exists email text;
    alter table public.customers add column if not exists phone text;
    alter table public.customers add column if not exists customer_number text;
    begin
      alter table public.customers add column if not exists normalized_personal_number text generated always as (public.gridex_normalize_personal_number(personal_number)) stored;
      alter table public.customers add column if not exists normalized_org_number text generated always as (public.gridex_normalize_org_number(org_number)) stored;
      alter table public.customers add column if not exists normalized_email text generated always as (public.gridex_normalize_email(email)) stored;
      alter table public.customers add column if not exists normalized_phone text generated always as (public.gridex_normalize_phone(phone)) stored;
    exception when others then
      perform public.gridex_db1_log_finding('warning','compat_column','customers.normalized_columns',SQLERRM,jsonb_build_object('sqlstate',SQLSTATE));
    end;
  end if;
  if to_regclass('public.customer_contacts') is not null then
    alter table public.customer_contacts add column if not exists company_id uuid;
    alter table public.customer_contacts add column if not exists customer_id uuid;
    alter table public.customer_contacts add column if not exists email text;
    alter table public.customer_contacts add column if not exists phone text;
    begin
      alter table public.customer_contacts add column if not exists normalized_email text generated always as (public.gridex_normalize_email(email)) stored;
      alter table public.customer_contacts add column if not exists normalized_phone text generated always as (public.gridex_normalize_phone(phone)) stored;
    exception when others then
      perform public.gridex_db1_log_finding('warning','compat_column','customer_contacts.normalized_columns',SQLERRM,jsonb_build_object('sqlstate',SQLSTATE));
    end;
  end if;
  if to_regclass('public.customer_sites') is not null then
    alter table public.customer_sites add column if not exists company_id uuid;
    alter table public.customer_sites add column if not exists customer_id uuid;
    alter table public.customer_sites add column if not exists facility_id text;
    begin
      alter table public.customer_sites add column if not exists normalized_facility_id text generated always as (public.gridex_normalize_facility_id(facility_id)) stored;
    exception when others then
      perform public.gridex_db1_log_finding('warning','compat_column','customer_sites.normalized_facility_id',SQLERRM,jsonb_build_object('sqlstate',SQLSTATE));
    end;
  end if;
  if to_regclass('public.metering_points') is not null then
    alter table public.metering_points add column if not exists company_id uuid;
    alter table public.metering_points add column if not exists customer_id uuid;
    alter table public.metering_points add column if not exists site_id uuid;
    alter table public.metering_points add column if not exists meter_point_id text;
    alter table public.metering_points add column if not exists metering_point_id text;
    begin
      alter table public.metering_points add column if not exists normalized_metering_point_id text generated always as (public.gridex_normalize_metering_point_id(coalesce(meter_point_id, metering_point_id))) stored;
    exception when others then
      perform public.gridex_db1_log_finding('warning','compat_column','metering_points.normalized_metering_point_id',SQLERRM,jsonb_build_object('sqlstate',SQLSTATE));
    end;
  end if;
end $$;

-- Add key columns to existing legacy/portal tables so DB2 can map them without guessing.
do $$
declare
  t text;
begin
  foreach t in array array[
    'contract_agreements', 'customer_delivery_points', 'customer_contracts', 'customer_documents',
    'customer_invoices', 'document_ai_extractions', 'customer_readiness_snapshots',
    'customer_lifecycle_decisions', 'customer_duplicate_resolution_events', 'customer_merge_events'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I add column if not exists company_id uuid', t);
      execute format('alter table public.%I add column if not exists customer_id uuid', t);
    end if;
  end loop;
end $$;

do $$
begin
  if to_regclass('public.contract_agreements') is not null then
    alter table public.contract_agreements add column if not exists customer_site_id uuid;
    alter table public.contract_agreements add column if not exists metering_point_id uuid;
    alter table public.contract_agreements add column if not exists canonical_customer_id uuid;
  end if;
  if to_regclass('public.customer_delivery_points') is not null then
    alter table public.customer_delivery_points add column if not exists customer_site_id uuid;
    alter table public.customer_delivery_points add column if not exists metering_point_id uuid;
  end if;
  if to_regclass('public.document_ai_extractions') is not null then
    alter table public.document_ai_extractions add column if not exists customer_site_id uuid;
    alter table public.document_ai_extractions add column if not exists metering_point_id uuid;
  end if;
  if to_regclass('public.customer_readiness_snapshots') is not null then
    alter table public.customer_readiness_snapshots add column if not exists customer_site_id uuid;
    alter table public.customer_readiness_snapshots add column if not exists metering_point_id uuid;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 5. Authorization, switch, outbound and billing operational tables
-- -----------------------------------------------------------------------------
create table if not exists public.powers_of_attorney (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  customer_id uuid references public.customers(id),
  site_id uuid,
  metering_point_id uuid,
  scope text not null default 'supplier_switch',
  status text not null default 'draft',
  signed_at timestamptz,
  valid_from date,
  valid_to date,
  document_path text,
  document_hash text,
  reference text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table if not exists public.customer_authorization_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  customer_id uuid references public.customers(id),
  site_id uuid,
  metering_point_id uuid,
  power_of_attorney_id uuid,
  replaced_document_id uuid,
  document_type text not null default 'power_of_attorney',
  status text not null default 'uploaded',
  title text,
  file_name text,
  mime_type text,
  file_size_bytes bigint,
  storage_bucket text,
  file_path text,
  file_checksum text,
  upload_idempotency_key text,
  reference text,
  notes text,
  archived_reason text,
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);


create table if not exists public.power_of_attorney_scopes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  power_of_attorney_id uuid references public.powers_of_attorney(id) on delete cascade,
  customer_id uuid,
  site_id uuid,
  metering_point_id uuid,
  customer_contract_id uuid,
  scope_type text not null default 'supplier_switch',
  is_active boolean not null default true,
  valid_from date,
  valid_to date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);



-- Compatibility columns for authorization tables that may already exist in live Supabase.
do $$
begin
  if to_regclass('public.powers_of_attorney') is not null then
    alter table public.powers_of_attorney add column if not exists company_id uuid;
    alter table public.powers_of_attorney add column if not exists customer_id uuid;
    alter table public.powers_of_attorney add column if not exists site_id uuid;
    alter table public.powers_of_attorney add column if not exists metering_point_id uuid;
    alter table public.powers_of_attorney add column if not exists scope text default 'supplier_switch';
    alter table public.powers_of_attorney add column if not exists status text default 'draft';
    alter table public.powers_of_attorney add column if not exists signed_at timestamptz;
    alter table public.powers_of_attorney add column if not exists valid_from date;
    alter table public.powers_of_attorney add column if not exists valid_to date;
    alter table public.powers_of_attorney add column if not exists document_path text;
    alter table public.powers_of_attorney add column if not exists document_hash text;
    alter table public.powers_of_attorney add column if not exists reference text;
    alter table public.powers_of_attorney add column if not exists metadata jsonb default '{}'::jsonb;
    alter table public.powers_of_attorney add column if not exists created_at timestamptz default now();
    alter table public.powers_of_attorney add column if not exists updated_at timestamptz default now();
  end if;

  if to_regclass('public.power_of_attorney_scopes') is not null then
    alter table public.power_of_attorney_scopes add column if not exists company_id uuid;
    alter table public.power_of_attorney_scopes add column if not exists power_of_attorney_id uuid;
    alter table public.power_of_attorney_scopes add column if not exists customer_id uuid;
    alter table public.power_of_attorney_scopes add column if not exists site_id uuid;
    alter table public.power_of_attorney_scopes add column if not exists metering_point_id uuid;
    alter table public.power_of_attorney_scopes add column if not exists customer_contract_id uuid;
    alter table public.power_of_attorney_scopes add column if not exists scope_type text default 'supplier_switch';
    alter table public.power_of_attorney_scopes add column if not exists status text default 'active';
    alter table public.power_of_attorney_scopes add column if not exists is_active boolean default true;
    alter table public.power_of_attorney_scopes add column if not exists valid_from date;
    alter table public.power_of_attorney_scopes add column if not exists valid_to date;
    alter table public.power_of_attorney_scopes add column if not exists metadata jsonb default '{}'::jsonb;
    alter table public.power_of_attorney_scopes add column if not exists created_at timestamptz default now();
    alter table public.power_of_attorney_scopes add column if not exists updated_at timestamptz default now();
  end if;
end $$;

create table if not exists public.supplier_switch_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  customer_id uuid references public.customers(id),
  site_id uuid,
  metering_point_id uuid,
  power_of_attorney_id uuid,
  authorization_document_id uuid,
  request_type text not null default 'switch',
  status text not null default 'draft',
  requested_start_date date,
  current_supplier_name text,
  current_supplier_org_number text,
  incoming_supplier_name text,
  incoming_supplier_org_number text,
  grid_owner_id uuid,
  price_area_code text,
  validation_snapshot jsonb not null default '{}'::jsonb,
  external_reference text,
  submitted_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  paused_at timestamptz,
  paused_by uuid,
  pause_reason text,
  lifecycle_blocked boolean not null default false,
  lifecycle_block_source text,
  lifecycle_block_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  automation_origin text,
  automation_key text
);

create table if not exists public.supplier_switch_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  switch_request_id uuid references public.supplier_switch_requests(id) on delete cascade,
  event_type text not null,
  event_status text not null default 'info',
  message text,
  payload jsonb not null default '{}'::jsonb,
  archived_at timestamptz,
  archived_by uuid,
  archive_reason text,
  created_at timestamptz not null default now(),
  created_by uuid
);

create table if not exists public.customer_operation_tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  customer_id uuid,
  site_id uuid,
  metering_point_id uuid,
  task_type text not null,
  status text not null default 'open',
  priority text not null default 'normal',
  title text not null,
  description text,
  assigned_to uuid,
  due_at timestamptz,
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table if not exists public.communication_routes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  route_name text not null,
  is_active boolean not null default true,
  route_scope text not null default 'supplier_switch',
  route_type text not null default 'ediel_partner',
  grid_owner_id uuid,
  target_system text,
  endpoint text,
  target_email text,
  auth_config jsonb not null default '{}'::jsonb,
  supported_payload_version text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table if not exists public.grid_owner_data_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  customer_id uuid,
  site_id uuid,
  metering_point_id uuid,
  grid_owner_id uuid,
  authorization_document_id uuid,
  request_scope text not null default 'customer_masterdata',
  status text not null default 'pending',
  requested_period_start date,
  requested_period_end date,
  external_reference text,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  notes text,
  requested_at timestamptz not null default now(),
  sent_at timestamptz,
  received_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  readiness_status text default 'not_checked',
  readiness_issues jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  automation_origin text,
  automation_key text
);

create table if not exists public.outbound_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  customer_id uuid,
  site_id uuid,
  metering_point_id uuid,
  grid_owner_id uuid,
  communication_route_id uuid,
  authorization_document_id uuid,
  request_type text not null,
  source_type text,
  source_id uuid,
  status text not null default 'queued',
  channel_type text not null default 'unresolved',
  payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  period_start date,
  period_end date,
  external_reference text,
  dispatch_batch_key text,
  attempts_count integer not null default 0,
  queued_at timestamptz not null default now(),
  prepared_at timestamptz,
  sent_at timestamptz,
  acknowledged_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  automation_origin text,
  automation_key text
);

create table if not exists public.outbound_dispatch_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  outbound_request_id uuid references public.outbound_requests(id) on delete cascade,
  event_type text not null,
  event_status text not null default 'info',
  message text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid
);

create table if not exists public.metering_values (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  customer_id uuid,
  site_id uuid,
  metering_point_id uuid,
  source_request_id uuid,
  grid_owner_id uuid,
  reading_type text not null default 'consumption',
  value_kwh numeric,
  quality_code text,
  read_at timestamptz,
  period_start timestamptz,
  period_end timestamptz,
  source_system text not null default 'manual',
  raw_payload jsonb not null default '{}'::jsonb,
  source_ediel_message_id uuid,
  canonical_dedupe_key text,
  is_current boolean not null default true,
  previous_value_id uuid,
  replaced_by_value_id uuid,
  revision_number integer not null default 1,
  correction_reason text,
  value_status text default 'current',
  created_at timestamptz not null default now(),
  created_by uuid
);

create table if not exists public.billing_underlays (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  customer_id uuid,
  site_id uuid,
  metering_point_id uuid,
  source_request_id uuid,
  grid_owner_id uuid,
  underlay_month integer,
  underlay_year integer,
  status text not null default 'pending',
  total_kwh numeric,
  total_sek_ex_vat numeric,
  currency text not null default 'SEK',
  source_system text not null default 'manual',
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz,
  validated_at timestamptz,
  exported_at timestamptz,
  failure_reason text,
  readiness_status text default 'not_checked',
  readiness_issues jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table if not exists public.billing_export_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  period_month text,
  target_system text,
  export_format text,
  status text not null default 'draft',
  rows_total integer not null default 0,
  rows_ready integer not null default 0,
  rows_blocked integer not null default 0,
  rows_exported integer not null default 0,
  blocker_summary jsonb not null default '[]'::jsonb,
  partner_response_log jsonb not null default '[]'::jsonb,
  last_partner_response_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table if not exists public.billing_export_run_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  export_run_id uuid references public.billing_export_runs(id) on delete cascade,
  customer_id uuid,
  site_id uuid,
  metering_point_id uuid,
  billing_underlay_id uuid,
  source_type text,
  source_id uuid,
  period_start date,
  period_end date,
  status text not null default 'pending',
  blocker_reasons jsonb not null default '[]'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.partner_exports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  customer_id uuid,
  site_id uuid,
  metering_point_id uuid,
  billing_underlay_id uuid,
  export_kind text not null default 'billing_underlay',
  target_system text not null,
  status text not null default 'queued',
  payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  external_reference text,
  export_batch_key text,
  idempotency_key text,
  retry_count integer not null default 0,
  adapter_key text,
  payload_version text,
  partner_response_log jsonb not null default '[]'::jsonb,
  last_partner_response_at timestamptz,
  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  acknowledged_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

-- -----------------------------------------------------------------------------
-- 6. Ediel core tables and views
-- -----------------------------------------------------------------------------
create table if not exists public.ediel_actor_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  actor_name text not null,
  actor_ediel_id text not null,
  actor_role text not null default 'supplier',
  environment text not null default 'test',
  is_active boolean not null default true,
  sender_name text,
  sender_sub_address text,
  default_application_reference text,
  default_timezone integer not null default 1,
  default_charset text not null default 'UNOC:3',
  default_test_flag integer not null default 1,
  smtp_from_email text,
  smtp_reply_to_email text,
  mailbox text,
  brp_name text,
  brp_ediel_id text,
  brp_status text,
  esett_status text,
  valid_from date,
  valid_to date,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table if not exists public.ediel_route_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  communication_route_id uuid,
  is_enabled boolean not null default true,
  sender_ediel_id text,
  sender_sub_address text,
  sender_name text,
  receiver_ediel_id text,
  receiver_sub_address text,
  receiver_name text,
  application_reference text,
  smtp_host text,
  smtp_port integer,
  imap_host text,
  imap_port integer,
  mailbox text,
  encryption_mode text default 'none',
  payload_format text not null default 'edifact',
  default_message_version text,
  default_test_flag integer not null default 1,
  default_timezone integer not null default 1,
  environment text not null default 'test',
  message_standard text not null default 'edifact',
  ack_mode text not null default 'default',
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table if not exists public.ediel_message_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  message_family text not null,
  message_code text not null,
  message_standard text not null default 'edifact',
  version_code text not null,
  direction text not null default 'both',
  requires_contrl boolean not null default true,
  requires_aperak boolean not null default false,
  supports_negative_response boolean not null default true,
  is_active boolean not null default true,
  valid_from date,
  valid_to date,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ediel_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  direction text not null,
  message_standard text not null default 'edifact',
  message_family text not null,
  message_code text,
  message_version text,
  process_type text,
  environment text not null default 'test',
  test_flag integer not null default 1,
  status text not null default 'draft',
  transport_type text not null default 'email',
  mailbox text,
  mailbox_message_id text,
  sender_ediel_id text,
  sender_name text,
  sender_sub_address text,
  receiver_ediel_id text,
  receiver_name text,
  receiver_sub_address text,
  sender_email text,
  receiver_email text,
  subject text,
  file_name text,
  mime_type text,
  interchange_reference text,
  external_reference text,
  correlation_reference text,
  transaction_reference text,
  application_reference text,
  original_message_id text,
  original_transaction_id text,
  original_message_code text,
  related_message_id uuid,
  communication_route_id uuid,
  outbound_request_id uuid,
  switch_request_id uuid,
  grid_owner_data_request_id uuid,
  partner_export_id uuid,
  customer_id uuid,
  site_id uuid,
  metering_point_id uuid,
  grid_owner_id uuid,
  raw_payload text,
  parsed_payload jsonb not null default '{}'::jsonb,
  validation_report jsonb not null default '{}'::jsonb,
  requires_contrl boolean not null default true,
  requires_aperak boolean not null default false,
  contrl_status text,
  aperak_status text,
  utilts_err_status text,
  ack_outcome text,
  syntax_check_status text,
  functional_check_status text,
  failure_reason text,
  message_created_at timestamptz,
  message_received_at timestamptz,
  message_sent_at timestamptz,
  parsed_at timestamptz,
  validated_at timestamptz,
  acknowledged_at timestamptz,
  failed_at timestamptz,
  ack_due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table if not exists public.ediel_message_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  ediel_message_id uuid references public.ediel_messages(id) on delete cascade,
  event_type text not null,
  event_status text not null default 'info',
  message text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid
);

create table if not exists public.ediel_message_validation_issues (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  ediel_message_id uuid references public.ediel_messages(id) on delete cascade,
  issue_code text,
  severity text not null default 'warning',
  title text,
  description text,
  segment_ref text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ediel_aperak_error_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  message_family text,
  message_code text,
  error_key text not null,
  erc_code text,
  ftx_code text,
  ftx_text text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ediel_aperak_error_details (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  error_rule_id uuid references public.ediel_aperak_error_rules(id) on delete cascade,
  detail_key text,
  detail_value text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ediel_inbound_cases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  ediel_message_id uuid references public.ediel_messages(id) on delete cascade,
  case_type text not null default 'unresolved',
  status text not null default 'open',
  customer_id uuid,
  site_id uuid,
  metering_point_id uuid,
  switch_request_id uuid,
  assigned_to uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table if not exists public.ediel_tgt_test_data (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  test_suite text not null,
  role_code text,
  test_case_code text not null,
  data_key text not null,
  data_value text,
  payload jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, test_suite, test_case_code, data_key)
);

-- Ediel runtime/reporting views expected by the app.
create or replace view public.ediel_active_actor_settings_v as
select *
from public.ediel_actor_settings
where coalesce(is_active, true) = true
  and (valid_from is null or valid_from <= current_date)
  and (valid_to is null or valid_to >= current_date);

create or replace view public.ediel_route_runtime_v as
select
  rp.*,
  cr.route_name,
  cr.route_scope,
  cr.route_type,
  cr.grid_owner_id as route_grid_owner_id,
  cr.target_system,
  cr.endpoint,
  cr.target_email,
  cr.auth_config,
  cr.supported_payload_version
from public.ediel_route_profiles rp
left join public.communication_routes cr on cr.id = rp.communication_route_id
where coalesce(rp.is_enabled, true) = true;

create or replace view public.ediel_message_ack_state_v as
select
  m.id,
  m.company_id,
  m.direction,
  m.message_family,
  coalesce(m.message_code, '') as message_code,
  m.message_version,
  m.status,
  m.environment,
  coalesce(m.requires_contrl, false) as requires_contrl,
  coalesce(m.requires_aperak, false) as requires_aperak,
  m.contrl_status,
  m.aperak_status,
  m.utilts_err_status,
  m.ack_due_at,
  m.message_sent_at,
  m.message_received_at,
  m.acknowledged_at,
  m.failed_at,
  case
    when m.status = 'failed' then 'failed'
    when coalesce(m.requires_contrl,false) and coalesce(m.contrl_status,'pending') = 'pending' then 'awaiting_contrl'
    when coalesce(m.contrl_status,'') = 'failed' then 'contrl_failed'
    when coalesce(m.requires_aperak,false) and coalesce(m.aperak_status,'pending') = 'pending' then 'awaiting_aperak'
    when m.aperak_status = 'received' and m.ack_outcome = 'negative' then 'aperak_received_negative'
    when m.aperak_status = 'received' and m.ack_outcome = 'positive' then 'aperak_received_positive'
    when coalesce(m.utilts_err_status,'') = 'received' then 'utilts_err_received'
    when m.ack_due_at is not null and m.ack_due_at < now() and m.acknowledged_at is null then 'ack_overdue'
    when not coalesce(m.requires_contrl,false) and not coalesce(m.requires_aperak,false) then 'no_ack_required'
    else 'in_progress'
  end as canonical_ack_state
from public.ediel_messages m;

create or replace view public.ediel_overdue_message_acks_v as
select *
from public.ediel_message_ack_state_v
where canonical_ack_state = 'ack_overdue';

create or replace view public.ediel_duplicate_ack_candidates_v as
select
  company_id,
  related_message_id,
  message_family as ack_family,
  transaction_reference,
  count(*) as duplicate_count,
  array_agg(id order by created_at) as message_ids
from public.ediel_messages
where related_message_id is not null
  and message_family in ('APERAK','CONTRL','UTILTS_ERR')
group by company_id, related_message_id, message_family, transaction_reference
having count(*) > 1;

create or replace view public.ediel_rule_ambiguities_v as
select
  company_id,
  message_family,
  message_code,
  message_standard,
  version_code,
  direction,
  count(*) as rule_count
from public.ediel_message_rules
where coalesce(is_active,true) = true
group by company_id, message_family, message_code, message_standard, version_code, direction
having count(*) > 1;

-- -----------------------------------------------------------------------------
-- 7. Audit and customer portal companion tables
-- -----------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  actor_user_id uuid,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  old_values jsonb,
  new_values jsonb,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.customer_portal_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  user_id uuid,
  customer_id uuid,
  status text not null default 'active',
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_portal_claims (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  customer_id uuid,
  user_id uuid,
  claim_type text not null default 'customer_access',
  status text not null default 'pending',
  token_hash text,
  claimed_at timestamptz,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_portal_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  customer_id uuid,
  user_id uuid,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);


create table if not exists public.customer_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  user_id uuid,
  customer_id uuid,
  document_type text default 'customer_document',
  title text,
  file_name text,
  mime_type text,
  file_size_bytes bigint,
  storage_bucket text,
  file_path text,
  public_url text,
  source_system text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table if not exists public.customer_invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  user_id uuid,
  customer_id uuid,
  agreement_id uuid,
  billing_underlay_id uuid,
  partner_export_id uuid,
  partner_invoice_reference text,
  invoice_number text,
  period_start date,
  period_end date,
  total_kwh numeric,
  amount_ex_vat numeric,
  vat_amount numeric,
  amount_inc_vat numeric,
  currency text not null default 'SEK',
  due_date date,
  issued_at timestamptz,
  paid_at timestamptz,
  status text not null default 'draft',
  pdf_path text,
  pdf_url text,
  source_system text not null default 'manual',
  raw_payload jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table if not exists public.customer_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  invoice_id uuid,
  customer_id uuid,
  description text,
  quantity numeric,
  unit_price numeric,
  amount_ex_vat numeric,
  vat_amount numeric,
  amount_inc_vat numeric,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.customer_invoice_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  invoice_id uuid,
  customer_id uuid,
  storage_bucket text,
  file_path text,
  file_name text,
  mime_type text,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 8. Compatibility column hardening for existing tables
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'customers','customer_addresses','customer_contacts','customer_internal_notes','customer_sites','metering_points',
    'powers_of_attorney','customer_authorization_documents','supplier_switch_requests','supplier_switch_events',
    'customer_operation_tasks','communication_routes','grid_owner_data_requests','outbound_requests','outbound_dispatch_events',
    'metering_values','billing_underlays','billing_export_runs','billing_export_run_items','partner_exports',
    'ediel_actor_settings','ediel_route_profiles','ediel_message_rules','ediel_messages','ediel_message_events',
    'ediel_message_validation_issues','ediel_aperak_error_rules','ediel_aperak_error_details','ediel_inbound_cases','ediel_tgt_test_data',
    'audit_logs','customer_portal_accounts','customer_portal_claims','customer_portal_events','customer_invoice_lines','customer_invoice_documents'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I add column if not exists company_id uuid', t);
      execute format('alter table public.%I add column if not exists metadata jsonb default ''{}''::jsonb', t);
      execute format('alter table public.%I add column if not exists created_at timestamptz default now()', t);
      execute format('alter table public.%I add column if not exists updated_at timestamptz default now()', t);
    end if;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 9. Safe dedupe/index foundation
-- -----------------------------------------------------------------------------
select public.gridex_db1_try_exec('dedupe_index','companies_slug',
  'create unique index if not exists ux_companies_slug on public.companies (lower(coalesce(slug, company_slug))) where coalesce(slug, company_slug) is not null');
select public.gridex_db1_try_exec('dedupe_index','companies_org_number',
  'create unique index if not exists ux_companies_normalized_org on public.companies (normalized_org_number) where normalized_org_number is not null');
select public.gridex_db1_try_exec('dedupe_index','company_memberships_company_user',
  'create unique index if not exists ux_company_memberships_company_user on public.company_memberships (company_id, user_id)');
select public.gridex_db1_try_exec('dedupe_index','customers_customer_number',
  'create unique index if not exists ux_customers_company_customer_number on public.customers (company_id, customer_number) where customer_number is not null');
select public.gridex_db1_try_exec('dedupe_index','customers_personal_number',
  'create unique index if not exists ux_customers_company_personal_number on public.customers (company_id, normalized_personal_number) where normalized_personal_number is not null');
select public.gridex_db1_try_exec('dedupe_index','customers_email',
  'create unique index if not exists ux_customers_company_email on public.customers (company_id, normalized_email) where normalized_email is not null');
select public.gridex_db1_try_exec('dedupe_index','customer_sites_facility',
  'create unique index if not exists ux_customer_sites_company_facility on public.customer_sites (company_id, normalized_facility_id) where normalized_facility_id is not null');
select public.gridex_db1_try_exec('dedupe_index','metering_points_meter_id',
  'create unique index if not exists ux_metering_points_company_meter_id on public.metering_points (company_id, normalized_metering_point_id) where normalized_metering_point_id is not null');
select public.gridex_db1_try_exec('dedupe_index','powers_of_attorney_doc_hash',
  'create unique index if not exists ux_poa_company_customer_document_hash on public.powers_of_attorney (company_id, customer_id, document_hash) where document_hash is not null');
select public.gridex_db1_try_exec('dedupe_index','supplier_switch_requests_dedupe',
  'create unique index if not exists ux_switch_company_meter_start_contract on public.supplier_switch_requests (company_id, metering_point_id, requested_start_date, coalesce((metadata->>''customer_contract_id'')::text, '''')) where metering_point_id is not null and requested_start_date is not null');
select public.gridex_db1_try_exec('dedupe_index','ediel_messages_inbound_interchange',
  'create unique index if not exists ux_ediel_inbound_interchange on public.ediel_messages (company_id, direction, sender_ediel_id, receiver_ediel_id, interchange_reference) where direction = ''inbound'' and interchange_reference is not null');
select public.gridex_db1_try_exec('dedupe_index','ediel_messages_outbound_source',
  'create unique index if not exists ux_ediel_outbound_source on public.ediel_messages (company_id, direction, outbound_request_id, message_family, coalesce(message_code,''''), receiver_ediel_id, coalesce(message_version,'''')) where direction = ''outbound'' and outbound_request_id is not null');
select public.gridex_db1_try_exec('dedupe_index','ediel_ack_dedupe',
  'create unique index if not exists ux_ediel_ack_related on public.ediel_messages (company_id, related_message_id, message_family, coalesce(transaction_reference,'''')) where related_message_id is not null and message_family in (''APERAK'',''CONTRL'',''UTILTS_ERR'')');
select public.gridex_db1_try_exec('dedupe_index','billing_export_items_dedupe',
  'create unique index if not exists ux_billing_export_items_source_period on public.billing_export_run_items (company_id, export_run_id, source_type, source_id, period_start, period_end) where source_type is not null and source_id is not null');
select public.gridex_db1_try_exec('dedupe_index','outbound_request_active_dedupe',
  'create unique index if not exists ux_outbound_active_source_request on public.outbound_requests (company_id, source_type, source_id, request_type, coalesce(period_start, ''1900-01-01''::date), coalesce(period_end, ''1900-01-01''::date)) where status in (''queued'',''prepared'',''sent'',''acknowledged'') and source_type is not null and source_id is not null');

-- Supporting non-unique indexes
create index if not exists idx_customers_company on public.customers(company_id);
create index if not exists idx_customer_sites_company_customer on public.customer_sites(company_id, customer_id);
create index if not exists idx_metering_points_company_site on public.metering_points(company_id, site_id);
create index if not exists idx_ediel_messages_company_status on public.ediel_messages(company_id, status, created_at desc);
create index if not exists idx_ediel_messages_related on public.ediel_messages(related_message_id);
create index if not exists idx_outbound_requests_company_status on public.outbound_requests(company_id, status, created_at desc);
create index if not exists idx_supplier_switch_company_status on public.supplier_switch_requests(company_id, status, created_at desc);
create index if not exists idx_audit_logs_company_entity on public.audit_logs(company_id, entity_type, entity_id, created_at desc);

-- -----------------------------------------------------------------------------
-- 10. Storage bucket foundation. Policies stay in DB2 after app paths are verified.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('customer-documents', 'customer-documents', false, 52428800, array['application/pdf','image/png','image/jpeg','text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']::text[]),
  ('contract-pdfs', 'contract-pdfs', false, 52428800, array['application/pdf']::text[]),
  ('customer-intake', 'customer-intake', false, 52428800, array['application/pdf','text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']::text[]),
  ('billing-imports', 'billing-imports', false, 52428800, array['text/csv','application/json','application/xml','text/xml','application/pdf','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']::text[]),
  ('billing-exports', 'billing-exports', false, 52428800, array['text/csv','application/json','application/xml','text/xml','application/pdf']::text[]),
  ('ediel-files', 'ediel-files', false, 52428800, array['application/EDIFACT','text/plain','application/octet-stream','message/rfc822']::text[]),
  ('actor-test-evidence', 'actor-test-evidence', false, 52428800, array['application/pdf','image/png','image/jpeg','text/plain','application/json']::text[])
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- -----------------------------------------------------------------------------
-- 10B. DB1 backfill functions. These are explicit, safe and re-runnable.
-- They do not delete rows and do not merge ambiguous duplicates.
-- -----------------------------------------------------------------------------
create or replace function public.gridex_db1_start_backfill_run(
  p_run_key text,
  p_source_scope text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_run_id uuid;
begin
  insert into public.backfill_runs (run_key, source_scope, status, started_at, completed_at, summary)
  values (p_run_key, p_source_scope, 'running', now(), null, '{}'::jsonb)
  on conflict (run_key) do update
  set status = 'running',
      source_scope = excluded.source_scope,
      started_at = now(),
      completed_at = null,
      rows_seen = 0,
      rows_inserted = 0,
      rows_updated = 0,
      rows_skipped = 0,
      rows_failed = 0,
      summary = '{}'::jsonb
  returning id into v_run_id;

  return v_run_id;
end;
$$;

create or replace function public.gridex_db1_finish_backfill_run(
  p_run_id uuid,
  p_status text,
  p_summary jsonb default '{}'::jsonb,
  p_rows_seen integer default 0,
  p_rows_inserted integer default 0,
  p_rows_updated integer default 0,
  p_rows_skipped integer default 0,
  p_rows_failed integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  update public.backfill_runs
  set status = coalesce(p_status, 'completed'),
      completed_at = now(),
      rows_seen = coalesce(p_rows_seen, 0),
      rows_inserted = coalesce(p_rows_inserted, 0),
      rows_updated = coalesce(p_rows_updated, 0),
      rows_skipped = coalesce(p_rows_skipped, 0),
      rows_failed = coalesce(p_rows_failed, 0),
      summary = coalesce(p_summary, '{}'::jsonb)
  where id = p_run_id;

  return jsonb_build_object(
    'run_id', p_run_id,
    'status', coalesce(p_status, 'completed'),
    'rows_seen', coalesce(p_rows_seen, 0),
    'rows_inserted', coalesce(p_rows_inserted, 0),
    'rows_updated', coalesce(p_rows_updated, 0),
    'rows_skipped', coalesce(p_rows_skipped, 0),
    'rows_failed', coalesce(p_rows_failed, 0),
    'summary', coalesce(p_summary, '{}'::jsonb)
  );
end;
$$;

create or replace function public.backfill_companies()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_run_id uuid;
  v_before integer := 0;
  v_after integer := 0;
  v_company_id uuid;
  v_inserted integer := 0;
begin
  v_run_id := public.gridex_db1_start_backfill_run('db1_backfill_companies', 'companies');
  select count(*) into v_before from public.companies;
  v_company_id := public.gridex_db1_default_company_id();
  select count(*) into v_after from public.companies;
  v_inserted := greatest(v_after - v_before, 0);

  return public.gridex_db1_finish_backfill_run(
    v_run_id,
    'completed',
    jsonb_build_object('default_company_id', v_company_id, 'safe_default_only', true),
    v_after,
    v_inserted,
    0,
    0,
    0
  );
end;
$$;

create or replace function public.backfill_customers()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_run_id uuid;
  v_company_id uuid;
  r record;
  v_customer_id uuid;
  v_seen integer := 0;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
begin
  v_run_id := public.gridex_db1_start_backfill_run('db1_backfill_customers', 'customer_profiles');
  v_company_id := public.gridex_db1_default_company_id();

  if v_company_id is null then
    return public.gridex_db1_finish_backfill_run(v_run_id, 'skipped', jsonb_build_object('reason', 'ambiguous_company'), 0, 0, 0, 1, 0);
  end if;

  if to_regclass('public.customer_profiles') is null then
    return public.gridex_db1_finish_backfill_run(v_run_id, 'skipped', jsonb_build_object('reason', 'customer_profiles_missing'), 0, 0, 0, 1, 0);
  end if;

  for r in
    select * from public.customer_profiles
  loop
    v_seen := v_seen + 1;
    v_customer_id := null;
    begin
      select c.id
      into v_customer_id
      from public.customers c
      where c.company_id = v_company_id
        and (
          (r.email is not null and c.normalized_email = public.normalize_email(r.email))
          or (r.contract_customer_ref is not null and c.customer_number = r.contract_customer_ref)
        )
      order by c.created_at nulls last, c.id::text
      limit 1;

      if v_customer_id is null then
        insert into public.customers (
          company_id, customer_type, status, first_name, last_name, full_name, email, phone,
          preferred_language, source, customer_number, metadata, created_at, updated_at
        ) values (
          v_company_id, 'private', 'active', r.first_name, r.last_name,
          coalesce(nullif(r.full_name, ''), nullif(btrim(coalesce(r.first_name, '') || ' ' || coalesce(r.last_name, '')), '')),
          r.email, r.phone, coalesce(r.language_code, 'sv'), 'customer_profiles', r.contract_customer_ref,
          jsonb_build_object('source_table', 'customer_profiles', 'source_user_id', r.user_id, 'billing_customer_ref', r.billing_customer_ref, 'external_identity_ref', r.external_identity_ref),
          coalesce(r.created_at, now()), coalesce(r.updated_at, now())
        )
        returning id into v_customer_id;
        v_inserted := v_inserted + 1;
      else
        update public.customers c
        set first_name = coalesce(c.first_name, r.first_name),
            last_name = coalesce(c.last_name, r.last_name),
            full_name = coalesce(c.full_name, r.full_name),
            phone = coalesce(c.phone, r.phone),
            customer_number = coalesce(c.customer_number, r.contract_customer_ref),
            updated_at = now()
        where c.id = v_customer_id;
        v_updated := v_updated + 1;
      end if;

      insert into public.canonical_record_links (company_id, source_table, source_id, canonical_table, canonical_id, source_hash, confidence, status, details)
      values (
        v_company_id,
        'customer_profiles',
        r.user_id::text,
        'customers',
        v_customer_id,
        public.gridex_make_source_hash(to_jsonb(r)),
        'system',
        'active',
        jsonb_build_object('backfill', 'db1_backfill_customers')
      )
      on conflict (source_table, source_id, canonical_table) do update
      set company_id = excluded.company_id,
          canonical_id = excluded.canonical_id,
          source_hash = excluded.source_hash,
          status = 'active',
          details = excluded.details;
    exception when others then
      v_failed := v_failed + 1;
      insert into public.backfill_run_items(backfill_run_id, source_table, source_id, target_table, status, message, details)
      values (v_run_id, 'customer_profiles', coalesce(r.user_id::text, '<null>'), 'customers', 'failed', SQLERRM, jsonb_build_object('sqlstate', SQLSTATE));
    end;
  end loop;

  return public.gridex_db1_finish_backfill_run(v_run_id, 'completed', jsonb_build_object('source_table', 'customer_profiles'), v_seen, v_inserted, v_updated, v_skipped, v_failed);
end;
$$;

create or replace function public.backfill_customer_sites()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_run_id uuid;
  v_company_id uuid;
  r record;
  v_customer_id uuid;
  v_site_id uuid;
  v_seen integer := 0;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
begin
  v_run_id := public.gridex_db1_start_backfill_run('db1_backfill_customer_sites', 'customer_delivery_points');
  v_company_id := public.gridex_db1_default_company_id();

  if v_company_id is null then
    return public.gridex_db1_finish_backfill_run(v_run_id, 'skipped', jsonb_build_object('reason', 'ambiguous_company'), 0, 0, 0, 1, 0);
  end if;

  if to_regclass('public.customer_delivery_points') is null then
    return public.gridex_db1_finish_backfill_run(v_run_id, 'skipped', jsonb_build_object('reason', 'customer_delivery_points_missing'), 0, 0, 0, 1, 0);
  end if;

  perform public.backfill_customers();

  for r in select * from public.customer_delivery_points loop
    v_seen := v_seen + 1;
    v_customer_id := null;
    v_site_id := null;
    begin
      select l.canonical_id into v_customer_id
      from public.canonical_record_links l
      where l.source_table = 'customer_profiles'
        and l.canonical_table = 'customers'
        and l.source_id = r.user_id::text
      limit 1;

      if v_customer_id is null then
        v_skipped := v_skipped + 1;
        insert into public.backfill_run_items(backfill_run_id, source_table, source_id, target_table, status, message, details)
        values (v_run_id, 'customer_delivery_points', r.id::text, 'customer_sites', 'skipped', 'No canonical customer link for delivery point user_id.', jsonb_build_object('user_id', r.user_id));
        continue;
      end if;

      if r.facility_id is not null then
        select s.id into v_site_id
        from public.customer_sites s
        where s.company_id = v_company_id
          and s.normalized_facility_id = public.normalize_facility_id(r.facility_id)
        order by s.created_at nulls last, s.id::text
        limit 1;
      end if;

      if v_site_id is null then
        insert into public.customer_sites (
          company_id, customer_id, site_name, facility_id, status, price_area_code,
          move_in_date, move_out_date, street, postal_code, city, metadata, created_at, updated_at
        ) values (
          v_company_id, v_customer_id, coalesce(r.nickname, 'Anläggning'), r.facility_id, 'active', r.area_code,
          r.move_in_date, r.move_out_date, r.address, r.postal_code, r.city,
          jsonb_build_object('source_table', 'customer_delivery_points', 'source_id', r.id, 'network_area_ref', r.network_area_ref),
          coalesce(r.created_at, now()), coalesce(r.updated_at, now())
        ) returning id into v_site_id;
        v_inserted := v_inserted + 1;
      else
        update public.customer_sites s
        set customer_id = coalesce(s.customer_id, v_customer_id),
            street = coalesce(s.street, r.address),
            postal_code = coalesce(s.postal_code, r.postal_code),
            city = coalesce(s.city, r.city),
            price_area_code = coalesce(s.price_area_code, r.area_code),
            updated_at = now()
        where s.id = v_site_id;
        v_updated := v_updated + 1;
      end if;

      update public.customer_delivery_points
      set company_id = coalesce(company_id, v_company_id),
          customer_id = coalesce(customer_id, v_customer_id),
          customer_site_id = coalesce(customer_site_id, v_site_id)
      where id = r.id;

      insert into public.canonical_record_links (company_id, source_table, source_id, canonical_table, canonical_id, source_hash, confidence, status, details)
      values (v_company_id, 'customer_delivery_points', r.id::text, 'customer_sites', v_site_id, public.gridex_make_source_hash(to_jsonb(r)), 'system', 'active', jsonb_build_object('backfill', 'db1_backfill_customer_sites'))
      on conflict (source_table, source_id, canonical_table) do update
      set company_id = excluded.company_id,
          canonical_id = excluded.canonical_id,
          source_hash = excluded.source_hash,
          status = 'active',
          details = excluded.details;
    exception when others then
      v_failed := v_failed + 1;
      insert into public.backfill_run_items(backfill_run_id, source_table, source_id, target_table, status, message, details)
      values (v_run_id, 'customer_delivery_points', coalesce(r.id::text, '<null>'), 'customer_sites', 'failed', SQLERRM, jsonb_build_object('sqlstate', SQLSTATE));
    end;
  end loop;

  return public.gridex_db1_finish_backfill_run(v_run_id, 'completed', jsonb_build_object('source_table', 'customer_delivery_points'), v_seen, v_inserted, v_updated, v_skipped, v_failed);
end;
$$;

create or replace function public.backfill_metering_points()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_run_id uuid;
  v_company_id uuid;
  r record;
  v_customer_id uuid;
  v_site_id uuid;
  v_metering_point_id uuid;
  v_seen integer := 0;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
begin
  v_run_id := public.gridex_db1_start_backfill_run('db1_backfill_metering_points', 'customer_delivery_points');
  v_company_id := public.gridex_db1_default_company_id();

  if v_company_id is null then
    return public.gridex_db1_finish_backfill_run(v_run_id, 'skipped', jsonb_build_object('reason', 'ambiguous_company'), 0, 0, 0, 1, 0);
  end if;

  if to_regclass('public.customer_delivery_points') is null then
    return public.gridex_db1_finish_backfill_run(v_run_id, 'skipped', jsonb_build_object('reason', 'customer_delivery_points_missing'), 0, 0, 0, 1, 0);
  end if;

  perform public.backfill_customer_sites();

  for r in select * from public.customer_delivery_points loop
    v_seen := v_seen + 1;
    v_customer_id := null;
    v_site_id := null;
    v_metering_point_id := null;
    begin
      if nullif(btrim(coalesce(r.external_metering_ref, '')), '') is null then
        v_skipped := v_skipped + 1;
        insert into public.backfill_run_items(backfill_run_id, source_table, source_id, target_table, status, message, details)
        values (v_run_id, 'customer_delivery_points', r.id::text, 'metering_points', 'skipped', 'external_metering_ref is missing; facility_id is not treated as metering_point_id.', jsonb_build_object('facility_id', r.facility_id));
        continue;
      end if;

      select l.canonical_id into v_customer_id
      from public.canonical_record_links l
      where l.source_table = 'customer_profiles'
        and l.canonical_table = 'customers'
        and l.source_id = r.user_id::text
      limit 1;

      select l.canonical_id into v_site_id
      from public.canonical_record_links l
      where l.source_table = 'customer_delivery_points'
        and l.canonical_table = 'customer_sites'
        and l.source_id = r.id::text
      limit 1;

      if v_customer_id is null or v_site_id is null then
        v_skipped := v_skipped + 1;
        insert into public.backfill_run_items(backfill_run_id, source_table, source_id, target_table, status, message, details)
        values (v_run_id, 'customer_delivery_points', r.id::text, 'metering_points', 'skipped', 'Missing canonical customer/site link.', jsonb_build_object('customer_id', v_customer_id, 'site_id', v_site_id));
        continue;
      end if;

      select mp.id into v_metering_point_id
      from public.metering_points mp
      where mp.company_id = v_company_id
        and mp.normalized_metering_point_id = public.gridex_normalize_metering_point_id(r.external_metering_ref)
      order by mp.created_at nulls last, mp.id::text
      limit 1;

      if v_metering_point_id is null then
        insert into public.metering_points (
          company_id, customer_id, site_id, metering_point_id, site_facility_id,
          status, price_area_code, start_date, end_date, metadata, created_at, updated_at
        ) values (
          v_company_id, v_customer_id, v_site_id, r.external_metering_ref, r.facility_id,
          'active', r.area_code, r.move_in_date, r.move_out_date,
          jsonb_build_object('source_table', 'customer_delivery_points', 'source_id', r.id, 'network_area_ref', r.network_area_ref),
          coalesce(r.created_at, now()), coalesce(r.updated_at, now())
        ) returning id into v_metering_point_id;
        v_inserted := v_inserted + 1;
      else
        update public.metering_points mp
        set customer_id = coalesce(mp.customer_id, v_customer_id),
            site_id = coalesce(mp.site_id, v_site_id),
            site_facility_id = coalesce(mp.site_facility_id, r.facility_id),
            price_area_code = coalesce(mp.price_area_code, r.area_code),
            updated_at = now()
        where mp.id = v_metering_point_id;
        v_updated := v_updated + 1;
      end if;

      update public.customer_delivery_points
      set metering_point_id = coalesce(metering_point_id, v_metering_point_id)
      where id = r.id;

      insert into public.canonical_record_links (company_id, source_table, source_id, canonical_table, canonical_id, source_hash, confidence, status, details)
      values (v_company_id, 'customer_delivery_points', r.id::text || ':metering_point', 'metering_points', v_metering_point_id, public.gridex_make_source_hash(to_jsonb(r)), 'system', 'active', jsonb_build_object('backfill', 'db1_backfill_metering_points'))
      on conflict (source_table, source_id, canonical_table) do update
      set company_id = excluded.company_id,
          canonical_id = excluded.canonical_id,
          source_hash = excluded.source_hash,
          status = 'active',
          details = excluded.details;
    exception when others then
      v_failed := v_failed + 1;
      insert into public.backfill_run_items(backfill_run_id, source_table, source_id, target_table, status, message, details)
      values (v_run_id, 'customer_delivery_points', coalesce(r.id::text, '<null>'), 'metering_points', 'failed', SQLERRM, jsonb_build_object('sqlstate', SQLSTATE));
    end;
  end loop;

  return public.gridex_db1_finish_backfill_run(v_run_id, 'completed', jsonb_build_object('source_table', 'customer_delivery_points'), v_seen, v_inserted, v_updated, v_skipped, v_failed);
end;
$$;

create or replace function public.backfill_contracts()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_run_id uuid;
  v_company_id uuid;
  r record;
  v_customer_id uuid;
  v_site_id uuid;
  v_contract_id uuid;
  v_seen integer := 0;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
  v_row_count integer := 0;
begin
  v_run_id := public.gridex_db1_start_backfill_run('db1_backfill_contracts', 'customer_contracts_contract_agreements');
  v_company_id := public.gridex_db1_default_company_id();

  if v_company_id is null then
    return public.gridex_db1_finish_backfill_run(v_run_id, 'skipped', jsonb_build_object('reason', 'ambiguous_company'), 0, 0, 0, 1, 0);
  end if;

  perform public.backfill_customers();
  perform public.backfill_customer_sites();
  perform public.backfill_metering_points();

  update public.customer_contracts
  set company_id = v_company_id
  where company_id is null;
  get diagnostics v_row_count = row_count;
  v_updated := v_updated + v_row_count;

  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='customer_contracts' and column_name='user_id') then
    execute $sql$
      update public.customer_contracts cc
      set customer_id = l.canonical_id,
          company_id = coalesce(cc.company_id, l.company_id),
          updated_at = now()
      from public.canonical_record_links l
      where l.source_table = 'customer_profiles'
        and l.canonical_table = 'customers'
        and cc.user_id::text = l.source_id
        and cc.customer_id is null
    $sql$;
    get diagnostics v_row_count = row_count;
    v_updated := v_updated + v_row_count;
  end if;

  if to_regclass('public.contract_agreements') is null then
    return public.gridex_db1_finish_backfill_run(v_run_id, 'completed', jsonb_build_object('contract_agreements', 'missing', 'customer_contracts_updated', v_updated), v_seen, v_inserted, v_updated, v_skipped, v_failed);
  end if;

  for r in select * from public.contract_agreements loop
    v_seen := v_seen + 1;
    v_customer_id := null;
    v_site_id := null;
    v_contract_id := null;
    begin
      select l.canonical_id into v_contract_id
      from public.canonical_record_links l
      where l.source_table = 'contract_agreements'
        and l.source_id = r.id::text
        and l.canonical_table = 'customer_contracts'
      limit 1;

      if v_contract_id is not null then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      if r.canonical_customer_id is not null then
        v_customer_id := r.canonical_customer_id;
      end if;

      if v_customer_id is null and r.email is not null then
        select c.id into v_customer_id
        from public.customers c
        where c.company_id = v_company_id
          and c.normalized_email = public.normalize_email(r.email)
        order by c.created_at nulls last, c.id::text
        limit 1;
      end if;

      if v_customer_id is null and r.customer_number is not null then
        select c.id into v_customer_id
        from public.customers c
        where c.company_id = v_company_id
          and c.customer_number = r.customer_number
        order by c.created_at nulls last, c.id::text
        limit 1;
      end if;

      if v_customer_id is null then
        insert into public.customers (
          company_id, customer_type, status, first_name, last_name, personal_number, email, phone,
          source, customer_number, metadata, created_at, updated_at
        ) values (
          v_company_id, 'private', 'active', r.first_name, r.last_name, r.personal_number, r.email, r.phone,
          'contract_agreements', r.customer_number,
          jsonb_build_object('source_table', 'contract_agreements', 'source_id', r.id),
          coalesce(r.created_at, now()), coalesce(r.updated_at, now())
        ) returning id into v_customer_id;
        v_inserted := v_inserted + 1;
      end if;

      if nullif(btrim(coalesce(r.facility_id, '')), '') is not null then
        select s.id into v_site_id
        from public.customer_sites s
        where s.company_id = v_company_id
          and s.normalized_facility_id = public.normalize_facility_id(r.facility_id)
        order by s.created_at nulls last, s.id::text
        limit 1;

        if v_site_id is null then
          insert into public.customer_sites (
            company_id, customer_id, site_name, facility_id, status, street, postal_code, city, apartment_number, move_in_date, metadata, created_at, updated_at
          ) values (
            v_company_id, v_customer_id, 'Anläggning', r.facility_id, 'active', coalesce(r.street, r.address), r.postal_code, r.city, r.apartment, r.move_in_date,
            jsonb_build_object('source_table', 'contract_agreements', 'source_id', r.id),
            coalesce(r.created_at, now()), coalesce(r.updated_at, now())
          ) returning id into v_site_id;
          v_inserted := v_inserted + 1;
        end if;
      end if;

      insert into public.customer_contracts (
        company_id, customer_id, site_id, source_type, status, contract_name,
        campaign_code, contract_version, starts_at, expected_start_at, signed_at,
        invoice_email, billing_street, billing_postal_code, billing_city,
        metadata, created_at, updated_at
      ) values (
        v_company_id, v_customer_id, v_site_id, 'contract_agreement', coalesce(r.status::text, 'draft'), 'Elavtal',
        r.contract_slug, 'v1', r.move_in_date, r.move_in_date, coalesce(r.email_signed_at, r.bankid_completed_at, r.activated_at),
        r.email, coalesce(r.street, r.address), r.postal_code, r.city,
        jsonb_build_object('source_table', 'contract_agreements', 'source_id', r.id, 'agreement_reference', r.agreement_reference),
        coalesce(r.created_at, now()), coalesce(r.updated_at, now())
      ) returning id into v_contract_id;
      v_inserted := v_inserted + 1;

      update public.contract_agreements
      set company_id = coalesce(company_id, v_company_id),
          customer_id = coalesce(customer_id, v_customer_id),
          customer_site_id = coalesce(customer_site_id, v_site_id),
          canonical_customer_id = coalesce(canonical_customer_id, v_customer_id)
      where id = r.id;

      insert into public.canonical_record_links (company_id, source_table, source_id, canonical_table, canonical_id, source_hash, confidence, status, details)
      values (v_company_id, 'contract_agreements', r.id::text, 'customer_contracts', v_contract_id, public.gridex_make_source_hash(to_jsonb(r)), 'system', 'active', jsonb_build_object('backfill', 'db1_backfill_contracts'))
      on conflict (source_table, source_id, canonical_table) do update
      set company_id = excluded.company_id,
          canonical_id = excluded.canonical_id,
          source_hash = excluded.source_hash,
          status = 'active',
          details = excluded.details;
    exception when others then
      v_failed := v_failed + 1;
      insert into public.backfill_run_items(backfill_run_id, source_table, source_id, target_table, status, message, details)
      values (v_run_id, 'contract_agreements', coalesce(r.id::text, '<null>'), 'customer_contracts', 'failed', SQLERRM, jsonb_build_object('sqlstate', SQLSTATE));
    end;
  end loop;

  return public.gridex_db1_finish_backfill_run(v_run_id, 'completed', jsonb_build_object('source_tables', array['customer_contracts','contract_agreements']), v_seen, v_inserted, v_updated, v_skipped, v_failed);
end;
$$;

create or replace function public.backfill_poa_scopes()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_run_id uuid;
  v_company_id uuid;
  r record;
  v_seen integer := 0;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
  v_row_count integer := 0;
begin
  v_run_id := public.gridex_db1_start_backfill_run('db1_backfill_poa_scopes', 'powers_of_attorney');
  v_company_id := public.gridex_db1_default_company_id();

  if v_company_id is null then
    return public.gridex_db1_finish_backfill_run(v_run_id, 'skipped', jsonb_build_object('reason', 'ambiguous_company'), 0, 0, 0, 1, 0);
  end if;

  if to_regclass('public.powers_of_attorney') is null or to_regclass('public.power_of_attorney_scopes') is null then
    return public.gridex_db1_finish_backfill_run(v_run_id, 'skipped', jsonb_build_object('reason', 'poa_tables_missing'), 0, 0, 0, 1, 0);
  end if;

  update public.powers_of_attorney
  set company_id = v_company_id,
      updated_at = now()
  where company_id is null;
  get diagnostics v_row_count = row_count;
  v_updated := v_updated + v_row_count;

  for r in select * from public.powers_of_attorney loop
    v_seen := v_seen + 1;
    begin
      if exists(select 1 from public.power_of_attorney_scopes s where s.power_of_attorney_id = r.id) then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      insert into public.power_of_attorney_scopes (
        company_id, power_of_attorney_id, customer_id, site_id, metering_point_id,
        scope_type, status, is_active, valid_from, valid_to, metadata, created_at, updated_at
      ) values (
        coalesce(r.company_id, v_company_id), r.id, r.customer_id, r.site_id, r.metering_point_id,
        coalesce(r.scope, 'supplier_switch'), 'active', true, r.valid_from, r.valid_to,
        jsonb_build_object('source_table', 'powers_of_attorney', 'source_id', r.id, 'backfill', 'db1_backfill_poa_scopes'),
        now(), now()
      );
      v_inserted := v_inserted + 1;
    exception when others then
      v_failed := v_failed + 1;
      insert into public.backfill_run_items(backfill_run_id, source_table, source_id, target_table, status, message, details)
      values (v_run_id, 'powers_of_attorney', coalesce(r.id::text, '<null>'), 'power_of_attorney_scopes', 'failed', SQLERRM, jsonb_build_object('sqlstate', SQLSTATE));
    end;
  end loop;

  return public.gridex_db1_finish_backfill_run(v_run_id, 'completed', jsonb_build_object('source_table', 'powers_of_attorney'), v_seen, v_inserted, v_updated, v_skipped, v_failed);
end;
$$;


-- -----------------------------------------------------------------------------
-- 11. RLS foundation for canonical company-scoped tables
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
  select_policy text;
  insert_policy text;
  update_policy text;
  delete_policy text;
begin
  foreach t in array array[
    'companies','company_memberships','company_invitations','user_permission_overrides',
    'customers','customer_addresses','customer_contacts','customer_internal_notes','customer_sites','metering_points',
    'customer_contracts','customer_contract_events','powers_of_attorney','customer_authorization_documents',
    'supplier_switch_requests','supplier_switch_events','customer_operation_tasks','communication_routes','grid_owner_data_requests',
    'outbound_requests','outbound_dispatch_events','metering_values','billing_underlays','billing_export_runs','billing_export_run_items','partner_exports',
    'ediel_actor_settings','ediel_route_profiles','ediel_message_rules','ediel_messages','ediel_message_events','ediel_message_validation_issues',
    'ediel_aperak_error_rules','ediel_aperak_error_details','ediel_inbound_cases','ediel_tgt_test_data','audit_logs','customer_documents','customer_invoices',
    'customer_portal_accounts','customer_portal_claims','customer_portal_events','customer_invoice_lines','customer_invoice_documents',
    'backfill_runs','backfill_run_items','canonical_record_links','duplicate_groups','duplicate_group_members'
  ] loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);

    select_policy := 'gridex_db1_' || t || '_select';
    insert_policy := 'gridex_db1_' || t || '_insert';
    update_policy := 'gridex_db1_' || t || '_update';
    delete_policy := 'gridex_db1_' || t || '_delete';

    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=select_policy) then
      if exists (select 1 from information_schema.columns where table_schema='public' and table_name=t and column_name='company_id') then
        execute format('create policy %I on public.%I for select using (public.gridex_user_is_platform_admin() or (company_id is not null and public.gridex_can_read_company(company_id)))', select_policy, t);
      else
        execute format('create policy %I on public.%I for select using (public.gridex_user_is_platform_admin())', select_policy, t);
      end if;
    end if;

    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=insert_policy) then
      if exists (select 1 from information_schema.columns where table_schema='public' and table_name=t and column_name='company_id') then
        execute format('create policy %I on public.%I for insert with check (public.gridex_user_is_platform_admin() or (company_id is not null and public.gridex_can_write_company(company_id)))', insert_policy, t);
      else
        execute format('create policy %I on public.%I for insert with check (public.gridex_user_is_platform_admin())', insert_policy, t);
      end if;
    end if;

    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=update_policy) then
      if exists (select 1 from information_schema.columns where table_schema='public' and table_name=t and column_name='company_id') then
        execute format('create policy %I on public.%I for update using (public.gridex_user_is_platform_admin() or (company_id is not null and public.gridex_can_read_company(company_id))) with check (public.gridex_user_is_platform_admin() or (company_id is not null and public.gridex_can_write_company(company_id)))', update_policy, t);
      else
        execute format('create policy %I on public.%I for update using (public.gridex_user_is_platform_admin()) with check (public.gridex_user_is_platform_admin())', update_policy, t);
      end if;
    end if;

    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=delete_policy) then
      execute format('create policy %I on public.%I for delete using (public.gridex_user_is_platform_admin())', delete_policy, t);
    end if;
  end loop;
end $$;

-- Companies need an explicit member-select policy because they do not carry company_id.
do $$
begin
  if to_regclass('public.companies') is not null then
    if not exists (select 1 from pg_policies where schemaname='public' and tablename='companies' and policyname='gridex_db1_companies_member_select') then
      create policy gridex_db1_companies_member_select
        on public.companies
        for select
        using (public.gridex_user_is_platform_admin() or id in (select * from public.gridex_user_company_ids()));
    end if;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 12. DB1 reporting/safety views
-- -----------------------------------------------------------------------------
create or replace view public.gridex_db1_schema_gap_v as
with expected(object_type, object_name, required_for) as (
  values
    ('table','companies','tenant'),
    ('table','company_memberships','tenant'),
    ('table','company_invitations','tenant'),
    ('table','customers','customer_core'),
    ('table','customer_addresses','customer_core'),
    ('table','customer_contacts','customer_core'),
    ('table','customer_internal_notes','customer_core'),
    ('table','customer_sites','operations'),
    ('table','metering_points','operations'),
    ('table','powers_of_attorney','authorization'),
    ('table','customer_authorization_documents','authorization'),
    ('table','supplier_switch_requests','supplier_switch'),
    ('table','supplier_switch_events','supplier_switch'),
    ('table','grid_owners','masterdata'),
    ('table','electricity_suppliers','masterdata'),
    ('table','price_areas','masterdata'),
    ('table','price_area_localities','masterdata'),
    ('table','communication_routes','outbound'),
    ('table','grid_owner_data_requests','outbound'),
    ('table','outbound_requests','outbound'),
    ('table','outbound_dispatch_events','outbound'),
    ('table','ediel_actor_settings','ediel'),
    ('table','ediel_route_profiles','ediel'),
    ('table','ediel_message_rules','ediel'),
    ('table','ediel_messages','ediel'),
    ('table','ediel_message_events','ediel'),
    ('table','ediel_message_validation_issues','ediel'),
    ('table','billing_underlays','billing'),
    ('table','billing_export_runs','billing'),
    ('table','billing_export_run_items','billing'),
    ('table','partner_exports','billing'),
    ('table','audit_logs','audit'),
    ('table','backfill_runs','backfill'),
    ('table','canonical_record_links','backfill'),
    ('view','ediel_route_runtime_v','ediel'),
    ('view','ediel_message_ack_state_v','ediel'),
    ('view','ediel_overdue_message_acks_v','ediel'),
    ('view','ediel_duplicate_ack_candidates_v','ediel'),
    ('view','ediel_rule_ambiguities_v','ediel')
)
select
  object_type,
  object_name,
  required_for,
  to_regclass('public.' || object_name) is not null as exists_in_database,
  case when to_regclass('public.' || object_name) is null then 'missing' else 'ok' end as status
from expected
order by required_for, object_type, object_name;

create or replace view public.gridex_db1_tenant_gap_v as
select 'customer_contracts' as table_name, count(*)::bigint as rows_without_company_id from public.customer_contracts where company_id is null
union all select 'customers', count(*) from public.customers where company_id is null
union all select 'customer_sites', count(*) from public.customer_sites where company_id is null
union all select 'metering_points', count(*) from public.metering_points where company_id is null
union all select 'powers_of_attorney', count(*) from public.powers_of_attorney where company_id is null
union all select 'supplier_switch_requests', count(*) from public.supplier_switch_requests where company_id is null
union all select 'ediel_messages', count(*) from public.ediel_messages where company_id is null
union all select 'billing_underlays', count(*) from public.billing_underlays where company_id is null
union all select 'billing_export_runs', count(*) from public.billing_export_runs where company_id is null
union all select 'outbound_requests', count(*) from public.outbound_requests where company_id is null;

create or replace view public.gridex_db1_duplicate_customer_candidates_v as
select company_id, 'email' as match_type, normalized_email as match_key, count(*) as duplicate_count, array_agg(id order by created_at) as customer_ids
from public.customers
where normalized_email is not null
group by company_id, normalized_email
having count(*) > 1
union all
select company_id, 'personal_number', normalized_personal_number, count(*), array_agg(id order by created_at)
from public.customers
where normalized_personal_number is not null
group by company_id, normalized_personal_number
having count(*) > 1
union all
select company_id, 'customer_number', customer_number, count(*), array_agg(id order by created_at)
from public.customers
where customer_number is not null
group by company_id, customer_number
having count(*) > 1;

create or replace view public.gridex_db1_duplicate_site_candidates_v as
select company_id, normalized_facility_id as match_key, count(*) as duplicate_count, array_agg(id order by created_at) as site_ids
from public.customer_sites
where normalized_facility_id is not null
group by company_id, normalized_facility_id
having count(*) > 1;

create or replace view public.gridex_db1_duplicate_metering_point_candidates_v as
select company_id, normalized_metering_point_id as match_key, count(*) as duplicate_count, array_agg(id order by created_at) as metering_point_ids
from public.metering_points
where normalized_metering_point_id is not null
group by company_id, normalized_metering_point_id
having count(*) > 1;

create or replace view public.gridex_db1_rbac_health_v as
select 'user_roles_table' as check_key, (to_regclass('public.user_roles') is not null)::text as result, null::text as details
union all select 'roles_table', (to_regclass('public.roles') is not null)::text, null
union all select 'user_roles_has_role_id', exists(select 1 from information_schema.columns where table_schema='public' and table_name='user_roles' and column_name='role_id')::text, null
union all select 'user_roles_has_role_text', exists(select 1 from information_schema.columns where table_schema='public' and table_name='user_roles' and column_name='role')::text, null
union all select 'company_memberships_table', (to_regclass('public.company_memberships') is not null)::text, null
union all select 'rbac_helper_platform_admin_callable', 'true', 'function recreated in DB1';

create or replace view public.gridex_db1_rls_policy_gap_v as
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  exists(select 1 from pg_policies p where p.schemaname = n.nspname and p.tablename = c.relname) as has_policy
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in (
    'companies','company_memberships','customers','customer_sites','metering_points','powers_of_attorney','supplier_switch_requests',
    'ediel_messages','billing_export_runs','billing_underlays','outbound_requests','audit_logs'
  )
order by c.relname;

create or replace view public.gridex_db1_storage_gap_v as
with expected(bucket_id) as (
  values ('customer-documents'),('contract-pdfs'),('customer-intake'),('billing-imports'),('billing-exports'),('ediel-files'),('actor-test-evidence')
)
select
  e.bucket_id,
  b.id is not null as exists_in_storage,
  coalesce(b.public, false) as is_public,
  b.file_size_limit,
  b.allowed_mime_types
from expected e
left join storage.buckets b on b.id = e.bucket_id
order by e.bucket_id;

create or replace view public.gridex_db1_backfill_readiness_v as
select 'schema_gap' as check_key, count(*)::bigint as issue_count, 'missing expected tables/views' as description
from public.gridex_db1_schema_gap_v where exists_in_database = false
union all
select 'tenant_gap', coalesce(sum(rows_without_company_id),0)::bigint, 'rows missing company_id'
from public.gridex_db1_tenant_gap_v
union all
select 'duplicate_customers', count(*)::bigint, 'duplicate customer candidates'
from public.gridex_db1_duplicate_customer_candidates_v
union all
select 'duplicate_sites', count(*)::bigint, 'duplicate site candidates'
from public.gridex_db1_duplicate_site_candidates_v
union all
select 'duplicate_metering_points', count(*)::bigint, 'duplicate metering point candidates'
from public.gridex_db1_duplicate_metering_point_candidates_v
union all
select 'storage_gap', count(*)::bigint, 'missing storage buckets'
from public.gridex_db1_storage_gap_v where exists_in_storage = false
union all
select 'rls_policy_gap', count(*)::bigint, 'important tables without RLS/policies'
from public.gridex_db1_rls_policy_gap_v where rls_enabled = false or has_policy = false;

-- -----------------------------------------------------------------------------
-- 13. Minimal safe tenant backfill only when unambiguous
-- -----------------------------------------------------------------------------
do $$
declare
  default_company uuid;
  company_count integer;
  t text;
begin
  select count(*) into company_count from public.companies;

  if company_count = 1 then
    select id
    into default_company
    from public.companies
    order by created_at nulls last, id::text
    limit 1;
  end if;

  if company_count = 1 and default_company is not null then
    foreach t in array array[
      'customer_contracts','contract_agreements','customer_delivery_points','document_ai_extractions',
      'customer_readiness_snapshots','customer_lifecycle_decisions','customer_duplicate_resolution_events','customer_merge_events'
    ] loop
      if to_regclass('public.' || t) is not null
         and exists(select 1 from information_schema.columns where table_schema='public' and table_name=t and column_name='company_id') then
        execute format('update public.%I set company_id = $1 where company_id is null', t) using default_company;
      end if;
    end loop;
  else
    perform public.gridex_db1_log_finding(
      'info',
      'minimal_backfill',
      'company_id',
      'Skipped minimal company_id backfill because company count is not exactly one.',
      jsonb_build_object('company_count', company_count)
    );
  end if;
end $$;

update public.gridex_schema_repair_runs
set status = 'completed',
    completed_at = now(),
    summary = jsonb_build_object(
      'phase', 'db1',
      'safe', true,
      'delete_operations', false,
      'aggressive_merge', false,
      'next_step', 'Run DB1 report views, then DB2 controlled backfill.'
    )
where repair_key = 'db1_schema_repair_backfill_foundation_20260522';
