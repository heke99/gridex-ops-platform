-- Gridex DB1 / 01 of 03
-- Kör först. Skapar DB1 bookkeeping, helper-functions, tenant/RBAC, kund/anläggning/mätpunkt/kontraktsgrund.
-- Ingen destruktiv dataoperation. Idempotent.

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
  backfill_run_id uuid references public.backfill_runs(id) on delete restrict,
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
  duplicate_group_id uuid not null references public.duplicate_groups(id) on delete restrict,
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
  company_id uuid not null references public.companies(id) on delete restrict,
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
  company_id uuid not null references public.companies(id) on delete restrict,
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
  role_id uuid references public.roles(id) on delete restrict,
  role_key text,
  permission_id uuid references public.permissions(id) on delete restrict,
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
  company_id uuid references public.companies(id) on delete restrict,
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
  customer_id uuid references public.customers(id) on delete restrict,
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
  customer_id uuid references public.customers(id) on delete restrict,
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
  customer_id uuid references public.customers(id) on delete restrict,
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
  customer_id uuid references public.customers(id) on delete restrict,
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
  customer_id uuid references public.customers(id) on delete restrict,
  site_id uuid references public.customer_sites(id) on delete restrict,
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


-- Complete existing customer_contracts table when it already existed before canonical DB1.
do $$
begin
  if to_regclass('public.customer_contracts') is not null then
    alter table public.customer_contracts add column if not exists site_id uuid;
    alter table public.customer_contracts add column if not exists metering_point_id uuid;
    alter table public.customer_contracts add column if not exists customer_site_id uuid;
    alter table public.customer_contracts add column if not exists contract_offer_id uuid;
    alter table public.customer_contracts add column if not exists source_type text default 'manual_override';
    alter table public.customer_contracts add column if not exists contract_name text default 'Elavtal';
    alter table public.customer_contracts add column if not exists contract_type text default 'variable_monthly';
    alter table public.customer_contracts add column if not exists starts_at date;
    alter table public.customer_contracts add column if not exists ends_at date;
    alter table public.customer_contracts add column if not exists termination_notice_date date;
    alter table public.customer_contracts add column if not exists termination_reason text;
    alter table public.customer_contracts add column if not exists auto_renew_enabled boolean default false;
    alter table public.customer_contracts add column if not exists auto_renew_term_months integer;
    alter table public.customer_contracts add column if not exists override_reason text;
    alter table public.customer_contracts add column if not exists fixed_price_ore_per_kwh numeric;
    alter table public.customer_contracts add column if not exists spot_markup_ore_per_kwh numeric;
    alter table public.customer_contracts add column if not exists variable_fee_ore_per_kwh numeric;
    alter table public.customer_contracts add column if not exists monthly_fee_sek numeric;
    alter table public.customer_contracts add column if not exists green_fee_mode text default 'none';
    alter table public.customer_contracts add column if not exists green_fee_value numeric;
    alter table public.customer_contracts add column if not exists binding_months integer;
    alter table public.customer_contracts add column if not exists notice_months integer;
    alter table public.customer_contracts add column if not exists optional_fee_lines jsonb default '[]'::jsonb;
    alter table public.customer_contracts add column if not exists metadata jsonb default '{}'::jsonb;
    alter table public.customer_contracts add column if not exists created_at timestamptz default now();
    alter table public.customer_contracts add column if not exists updated_at timestamptz default now();
    alter table public.customer_contracts add column if not exists created_by uuid;
    alter table public.customer_contracts add column if not exists updated_by uuid;
  end if;
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
