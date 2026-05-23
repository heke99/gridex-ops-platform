-- Gridex DB2 v4 / 01 of 03
-- Full tenant/RBAC/customer-profile preflight + compatibility layer.
-- Built from latest zip + supplied live view after DB1:
--   companies=1 (Div3rsa AB), company_memberships=0, company_invitations=0,
--   customer_profiles=2, customers/sites/metering/contracts/POA=0.
-- Safety:
--   - no destructive cleanup
--   - no automatic creation of "Test bolaget" because it is not present in live data
--   - no blind customer creation from portal/login profiles
--   - membership writes only from explicit company_id sources, never from bare admin/profile rows

create extension if not exists pgcrypto;

insert into public.gridex_schema_repair_runs (repair_key, status, summary)
values (
  'db2_controlled_backfill_20260523_v4',
  'prepared',
  jsonb_build_object(
    'phase', 'db2',
    'revision', 'v4_safe_full_view',
    'safe', true,
    'delete_operations', false,
    'aggressive_merge', false,
    'blind_profile_to_customer_backfill', false,
    'auto_create_missing_company', false,
    'mode', 'prepare_full_view_and_dry_run'
  )
)
on conflict (repair_key) do update
set status = 'prepared',
    started_at = now(),
    completed_at = null,
    summary = excluded.summary;

create or replace function public.gridex_db2_v4_table_exists(p_table text)
returns boolean
language sql
stable
as $$
  select to_regclass('public.' || p_table) is not null
$$;

create or replace function public.gridex_db2_v4_col_exists(p_table text, p_column text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = p_table
      and c.column_name = p_column
  )
$$;

create or replace function public.gridex_db2_v4_log_finding(
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
  values ('db2_controlled_backfill_20260523_v4', p_severity, p_area, p_object, p_message, coalesce(p_details, '{}'::jsonb));
end;
$$;

create or replace function public.gridex_db2_v4_text_has_value(p_value text)
returns boolean
language sql
immutable
as $$
  select nullif(btrim(coalesce(p_value, '')), '') is not null
$$;

create or replace function public.gridex_db2_v4_normalize_membership_role(p_value text)
returns text
language sql
immutable
as $$
  select case
    when lower(btrim(coalesce(p_value, ''))) in ('owner','ägare','agare','company_owner','tenant_owner') then 'owner'
    when lower(btrim(coalesce(p_value, ''))) in ('admin','company_admin','company-owner','company_owner','tenant_admin','bolagsansvarig','responsible') then 'company_admin'
    when lower(btrim(coalesce(p_value, ''))) in ('operations','operations_manager','operation_manager','drift','ops') then 'operations'
    when lower(btrim(coalesce(p_value, ''))) in ('support','customer_service','kundservice') then 'support'
    when lower(btrim(coalesce(p_value, ''))) in ('viewer','read_only','readonly','finance_readonly') then 'viewer'
    when lower(btrim(coalesce(p_value, ''))) in ('member','user','') then 'member'
    else 'member'
  end
$$;

create or replace function public.gridex_db2_v4_assert_ready()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_issue_count integer := 0;
  v_db1_completed boolean := false;
  v_required_tables text[] := array[
    'gridex_schema_repair_runs',
    'gridex_schema_repair_findings',
    'backfill_runs',
    'backfill_run_items',
    'canonical_record_links',
    'companies',
    'company_memberships',
    'company_invitations',
    'user_profiles',
    'admin_users',
    'user_roles',
    'customers',
    'customer_profiles',
    'customer_sites',
    'customer_delivery_points',
    'metering_points',
    'customer_contracts',
    'contract_agreements',
    'powers_of_attorney',
    'power_of_attorney_scopes',
    'audit_logs'
  ];
  v_table text;
begin
  select exists (
    select 1
    from public.gridex_schema_repair_runs r
    where r.repair_key = 'db1_schema_repair_backfill_foundation_20260522'
      and r.status = 'completed'
      and coalesce((r.summary->>'safe')::boolean, false) = true
  ) into v_db1_completed;

  if not v_db1_completed then
    raise exception 'DB2 v4 blocked: DB1 is not completed/safe. Run DB1 readiness first.';
  end if;

  if to_regclass('public.gridex_db1_backfill_readiness_v') is null then
    raise exception 'DB2 v4 blocked: DB1 readiness view public.gridex_db1_backfill_readiness_v is missing.';
  end if;

  select coalesce(sum(issue_count), 0)::integer
  into v_issue_count
  from public.gridex_db1_backfill_readiness_v;

  if coalesce(v_issue_count, 0) > 0 then
    raise exception 'DB2 v4 blocked: DB1 readiness still has % issue(s).', v_issue_count;
  end if;

  foreach v_table in array v_required_tables loop
    if not public.gridex_db2_v4_table_exists(v_table) then
      raise exception 'DB2 v4 blocked: required table public.% is missing.', v_table;
    end if;
  end loop;
end;
$$;

create or replace function public.gridex_db2_v4_default_company_id()
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_company_count integer := 0;
  v_company_id uuid;
begin
  select count(*) into v_company_count from public.companies;

  if v_company_count = 1 then
    select id
    into v_company_id
    from public.companies
    order by created_at nulls last, id::text
    limit 1;
    return v_company_id;
  end if;

  perform public.gridex_db2_v4_log_finding(
    'warning',
    'default_company',
    'companies',
    'DB2 v4 cannot pick default company automatically because company count is not exactly 1.',
    jsonb_build_object('company_count', v_company_count)
  );

  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- Tenant/RBAC schema compatibility based on latest code expectations.
-- -----------------------------------------------------------------------------
alter table public.companies add column if not exists primary_contact_email text;
alter table public.companies add column if not exists primary_contact_name text;
alter table public.companies add column if not exists phone text;
alter table public.companies add column if not exists website text;
alter table public.companies add column if not exists industry text;
alter table public.companies add column if not exists status_reason text;
alter table public.companies add column if not exists support_email text;
alter table public.companies add column if not exists billing_contact_email text;
alter table public.companies add column if not exists address_line_1 text;
alter table public.companies add column if not exists address_line_2 text;
alter table public.companies add column if not exists postal_code text;
alter table public.companies add column if not exists city text;
alter table public.companies add column if not exists country_code text default 'SE';
alter table public.companies add column if not exists actor_role text;
alter table public.companies add column if not exists market_role text;
alter table public.companies add column if not exists sender_sub_address text;
alter table public.companies add column if not exists ediel_mailbox text;
alter table public.companies add column if not exists operating_environment text default 'test';
alter table public.companies add column if not exists production_status text default 'not_ready';
alter table public.companies add column if not exists live_ediel_enabled boolean not null default false;
alter table public.companies add column if not exists live_approved_at timestamptz;
alter table public.companies add column if not exists live_blocked_reason text;
alter table public.companies add column if not exists test_ediel_id text;
alter table public.companies add column if not exists production_ediel_id text;
alter table public.companies add column if not exists test_sender_sub_address text;
alter table public.companies add column if not exists production_sender_sub_address text;
alter table public.companies add column if not exists test_mailbox text;
alter table public.companies add column if not exists production_mailbox text;
alter table public.companies add column if not exists test_application_reference text;
alter table public.companies add column if not exists production_application_reference text;
alter table public.companies add column if not exists test_counterparty_ediel_id text;
alter table public.companies add column if not exists production_counterparty_ediel_id text;
alter table public.companies add column if not exists white_label_platform_id uuid;
alter table public.companies add column if not exists brp_name text;
alter table public.companies add column if not exists brp_ediel_id text;
alter table public.companies add column if not exists brp_status text;
alter table public.companies add column if not exists esett_status text;
alter table public.companies add column if not exists technical_contact_name text;
alter table public.companies add column if not exists technical_contact_email text;
alter table public.companies add column if not exists branding jsonb not null default '{}'::jsonb;

update public.companies
set slug = coalesce(nullif(slug, ''), nullif(company_slug, '')),
    company_slug = coalesce(nullif(company_slug, ''), nullif(slug, '')),
    operating_environment = coalesce(nullif(operating_environment, ''), nullif(default_environment, ''), 'test'),
    default_environment = coalesce(nullif(default_environment, ''), nullif(operating_environment, ''), 'test'),
    country_code = coalesce(nullif(country_code, ''), 'SE'),
    industry = coalesce(nullif(industry, ''), 'electricity_supplier'),
    branding = coalesce(branding, '{}'::jsonb),
    metadata = coalesce(metadata, '{}'::jsonb),
    updated_at = now()
where slug is null
   or company_slug is null
   or operating_environment is null
   or default_environment is null
   or country_code is null
   or industry is null
   or branding is null
   or metadata is null;

alter table public.company_memberships add column if not exists membership_role text default 'member';
alter table public.company_memberships add column if not exists role_key text;
alter table public.company_memberships add column if not exists invited_at timestamptz;
alter table public.company_memberships add column if not exists accepted_at timestamptz;
alter table public.company_memberships add column if not exists disabled_at timestamptz;
alter table public.company_memberships add column if not exists disabled_by uuid;
alter table public.company_memberships add column if not exists removed_at timestamptz;
alter table public.company_memberships add column if not exists removed_by uuid;
alter table public.company_memberships add column if not exists status_reason text;
alter table public.company_memberships add column if not exists metadata jsonb default '{}'::jsonb;

update public.company_memberships
set membership_role = public.gridex_db2_v4_normalize_membership_role(coalesce(membership_role, role)),
    role = coalesce(nullif(role, ''), public.gridex_db2_v4_normalize_membership_role(coalesce(membership_role, role))),
    role_key = coalesce(nullif(role_key, ''), case when public.gridex_db2_v4_normalize_membership_role(coalesce(membership_role, role)) in ('owner','admin','company_admin') then 'company_admin' else public.gridex_db2_v4_normalize_membership_role(coalesce(membership_role, role)) end),
    status = case
      when lower(btrim(coalesce(status, ''))) in ('', 'active') then 'active'
      when lower(btrim(status)) in ('pending','invited','suspended','revoked','removed','disabled','removed_from_company','invitation_revoked','locked_security') then lower(btrim(status))
      else 'active'
    end,
    is_active = coalesce(is_active, true),
    metadata = coalesce(metadata, '{}'::jsonb),
    updated_at = now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.company_memberships'::regclass
      and conname = 'company_memberships_role_check'
  ) then
    alter table public.company_memberships
      add constraint company_memberships_role_check
      check (membership_role in ('owner', 'admin', 'company_admin', 'operations', 'support', 'member', 'viewer'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.company_memberships'::regclass
      and conname = 'company_memberships_status_check'
  ) then
    alter table public.company_memberships
      add constraint company_memberships_status_check
      check (status in ('active', 'pending', 'invited', 'suspended', 'revoked', 'removed', 'disabled', 'removed_from_company', 'invitation_revoked', 'locked_security'));
  end if;
end $$;

alter table public.company_invitations add column if not exists full_name text;
alter table public.company_invitations add column if not exists membership_role text default 'member';
alter table public.company_invitations add column if not exists role_key text;
alter table public.company_invitations add column if not exists invited_by uuid;
alter table public.company_invitations add column if not exists invited_user_id uuid;
alter table public.company_invitations add column if not exists revoked_at timestamptz;
alter table public.company_invitations add column if not exists accept_token_hash text;
alter table public.company_invitations add column if not exists temporary_password_issued_at timestamptz;
alter table public.company_invitations add column if not exists temporary_password_expires_at timestamptz;

update public.company_invitations
set membership_role = public.gridex_db2_v4_normalize_membership_role(coalesce(membership_role, role)),
    role = coalesce(nullif(role, ''), public.gridex_db2_v4_normalize_membership_role(coalesce(membership_role, role))),
    role_key = coalesce(nullif(role_key, ''), case when public.gridex_db2_v4_normalize_membership_role(coalesce(membership_role, role)) in ('owner','admin','company_admin') then 'company_admin' else public.gridex_db2_v4_normalize_membership_role(coalesce(membership_role, role)) end),
    status = case
      when lower(btrim(coalesce(status, ''))) in ('', 'pending') then 'pending'
      when lower(btrim(status)) in ('accepted','revoked','expired','invitation_revoked') then lower(btrim(status))
      when lower(btrim(status)) in ('cancelled','canceled') then 'revoked'
      else 'pending'
    end,
    metadata = coalesce(metadata, '{}'::jsonb),
    updated_at = now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.company_invitations'::regclass
      and conname = 'company_invitations_membership_role_check'
  ) then
    alter table public.company_invitations
      add constraint company_invitations_membership_role_check
      check (membership_role in ('owner', 'admin', 'company_admin', 'operations', 'support', 'member', 'viewer'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.company_invitations'::regclass
      and conname = 'company_invitations_status_check'
  ) then
    alter table public.company_invitations
      add constraint company_invitations_status_check
      check (status in ('pending', 'accepted', 'revoked', 'expired', 'invitation_revoked'));
  end if;
end $$;

alter table public.user_profiles add column if not exists active_company_id uuid;
alter table public.user_profiles add column if not exists user_status text default 'active';
alter table public.user_profiles add column if not exists must_change_password boolean not null default false;
alter table public.user_profiles add column if not exists last_auth_email_action text;
alter table public.user_profiles add column if not exists last_auth_email_action_at timestamptz;

select public.gridex_db1_try_exec('db2_v4_index','company_memberships_company_user_uidx',
  'create unique index if not exists company_memberships_company_user_uidx on public.company_memberships(company_id, user_id) where company_id is not null and user_id is not null');
select public.gridex_db1_try_exec('db2_v4_index','company_memberships_company_status_idx',
  'create index if not exists company_memberships_company_status_idx on public.company_memberships(company_id, status)');
select public.gridex_db1_try_exec('db2_v4_index','company_invitations_company_status_idx',
  'create index if not exists company_invitations_company_status_idx on public.company_invitations(company_id, status, created_at desc)');
select public.gridex_db1_try_exec('db2_v4_index','company_invitations_email_status_idx',
  'create index if not exists company_invitations_email_status_idx on public.company_invitations(lower(email), status, created_at desc)');

-- -----------------------------------------------------------------------------
-- Full-view reports.
-- -----------------------------------------------------------------------------
create or replace view public.gridex_db2_v4_source_inventory_v as
select 'companies'::text as table_name, count(*)::integer as row_count from public.companies
union all select 'company_memberships', count(*)::integer from public.company_memberships
union all select 'company_invitations', count(*)::integer from public.company_invitations
union all select 'customers', count(*)::integer from public.customers
union all select 'customer_profiles', count(*)::integer from public.customer_profiles
union all select 'customer_sites', count(*)::integer from public.customer_sites
union all select 'customer_delivery_points', count(*)::integer from public.customer_delivery_points
union all select 'metering_points', count(*)::integer from public.metering_points
union all select 'customer_contracts', count(*)::integer from public.customer_contracts
union all select 'contract_agreements', count(*)::integer from public.contract_agreements
union all select 'powers_of_attorney', count(*)::integer from public.powers_of_attorney
union all select 'power_of_attorney_scopes', count(*)::integer from public.power_of_attorney_scopes
union all select 'customer_documents', count(*)::integer from public.customer_documents
union all select 'document_ai_extractions', count(*)::integer from public.document_ai_extractions
union all select 'canonical_record_links', count(*)::integer from public.canonical_record_links
union all select 'backfill_runs', count(*)::integer from public.backfill_runs
union all select 'backfill_run_items', count(*)::integer from public.backfill_run_items
union all select 'duplicate_groups', count(*)::integer from public.duplicate_groups
union all select 'duplicate_group_members', count(*)::integer from public.duplicate_group_members;

create or replace view public.gridex_db2_v4_schema_contract_v as
with expected(table_name, column_name, importance) as (
  values
    ('companies','primary_contact_email','code_required'),
    ('companies','primary_contact_name','code_required'),
    ('companies','phone','code_required'),
    ('companies','website','code_required'),
    ('companies','billing_contact_email','code_required'),
    ('companies','support_email','code_required'),
    ('companies','technical_contact_email','code_required'),
    ('companies','technical_contact_name','code_required'),
    ('companies','operating_environment','code_required'),
    ('companies','production_status','code_required'),
    ('companies','live_ediel_enabled','code_required'),
    ('companies','branding','code_required'),
    ('company_memberships','membership_role','code_required'),
    ('company_memberships','role_key','code_required'),
    ('company_memberships','invited_at','code_required'),
    ('company_memberships','accepted_at','code_required'),
    ('company_memberships','status_reason','code_required'),
    ('company_memberships','metadata','code_required'),
    ('company_invitations','full_name','code_required'),
    ('company_invitations','membership_role','code_required'),
    ('company_invitations','role_key','code_required'),
    ('company_invitations','invited_user_id','code_required'),
    ('company_invitations','accept_token_hash','code_required'),
    ('user_profiles','active_company_id','code_required')
)
select
  e.table_name,
  e.column_name,
  e.importance,
  public.gridex_db2_v4_col_exists(e.table_name, e.column_name) as exists_in_db
from expected e;

create or replace view public.gridex_db2_v4_company_overview_v as
select
  c.id,
  c.name,
  c.slug,
  c.company_slug,
  c.org_number,
  c.status,
  c.is_active,
  c.is_paused,
  c.ediel_id,
  c.default_environment,
  c.operating_environment,
  c.primary_contact_email,
  c.primary_contact_name,
  c.support_email,
  c.billing_contact_email,
  c.technical_contact_email,
  c.production_status,
  c.live_ediel_enabled,
  c.metadata,
  c.created_at,
  (select count(*) from public.company_memberships cm where cm.company_id = c.id and cm.status = 'active')::integer as active_memberships,
  (select count(*) from public.company_invitations ci where ci.company_id = c.id and ci.status = 'pending')::integer as pending_invitations,
  (select count(*) from public.customers cu where cu.company_id = c.id)::integer as customers,
  (select count(*) from public.ediel_messages em where em.company_id = c.id)::integer as ediel_messages,
  (select count(*) from public.billing_underlays bu where bu.company_id = c.id)::integer as billing_underlays
from public.companies c;

create or replace view public.gridex_db2_v4_company_reconciliation_v as
select
  'canonical_companies'::text as check_key,
  count(*)::integer as value_count,
  case when count(*) = 1 then 'ok_single_company' when count(*) = 0 then 'missing_company' else 'multiple_companies' end as status,
  'Canonical company count in public.companies.'::text as description
from public.companies
union all
select
  'div3rsa_ab_present',
  count(*)::integer,
  case when count(*) = 1 then 'present' when count(*) = 0 then 'missing' else 'duplicate' end,
  'Div3rsa AB found by name/slug.'
from public.companies c
where lower(coalesce(c.name,'')) = 'div3rsa ab'
   or lower(coalesce(c.slug,'')) = 'div3rsa-ab'
   or lower(coalesce(c.company_slug,'')) = 'div3rsa-ab'
union all
select
  'test_bolaget_present',
  count(*)::integer,
  case when count(*) = 0 then 'not_found_in_live_data' when count(*) = 1 then 'present' else 'duplicate' end,
  'The user expected Test bolaget, but DB2 will not create it unless it exists in live data or is explicitly created through the app/admin flow.'
from public.companies c
where lower(coalesce(c.name,'')) like '%test%'
   or lower(coalesce(c.slug,'')) like '%test%'
   or lower(coalesce(c.company_slug,'')) like '%test%'
   or coalesce(c.metadata,'{}'::jsonb)::text ilike '%test%';

create or replace view public.gridex_db2_v4_membership_candidates_v as
select
  'existing_membership'::text as source_table,
  cm.id::text as source_id,
  cm.company_id,
  cm.user_id,
  coalesce(cm.membership_role, public.gridex_db2_v4_normalize_membership_role(cm.role)) as membership_role,
  coalesce(cm.role_key, case when coalesce(cm.membership_role, cm.role) in ('owner','admin','company_admin') then 'company_admin' else coalesce(cm.membership_role, cm.role, 'member') end) as role_key,
  cm.status,
  true as has_explicit_company_id,
  false as should_insert,
  'already_exists'::text as decision,
  jsonb_build_object('source', 'company_memberships') as details
from public.company_memberships cm
union all
select
  'user_profiles.active_company_id'::text,
  up.id::text,
  up.active_company_id,
  coalesce(up.user_id, up.id),
  'admin'::text,
  'company_admin'::text,
  coalesce(up.user_status, 'active'),
  true,
  true,
  'insert_from_explicit_active_company_id',
  jsonb_build_object('email', up.email, 'full_name', up.full_name)
from public.user_profiles up
where up.active_company_id is not null
  and exists (select 1 from public.companies c where c.id = up.active_company_id)
  and not exists (select 1 from public.company_memberships cm where cm.company_id = up.active_company_id and cm.user_id = coalesce(up.user_id, up.id))
union all
select
  'company_invitations.accepted'::text,
  ci.id::text,
  ci.company_id,
  ci.invited_user_id,
  coalesce(ci.membership_role, 'member'),
  coalesce(ci.role_key, case when ci.membership_role in ('owner','admin','company_admin') then 'company_admin' else ci.membership_role end),
  'active'::text,
  true,
  true,
  'insert_from_accepted_invitation',
  jsonb_build_object('email', ci.email, 'full_name', ci.full_name)
from public.company_invitations ci
where ci.company_id is not null
  and ci.invited_user_id is not null
  and ci.status = 'accepted'
  and exists (select 1 from public.companies c where c.id = ci.company_id)
  and not exists (select 1 from public.company_memberships cm where cm.company_id = ci.company_id and cm.user_id = ci.invited_user_id)
union all
select
  'user_roles.company_id'::text,
  ur.id::text,
  ur.company_id,
  ur.user_id,
  public.gridex_db2_v4_normalize_membership_role(coalesce(ur.role, 'member')),
  case when public.gridex_db2_v4_normalize_membership_role(coalesce(ur.role, 'member')) in ('owner','admin','company_admin') then 'company_admin' else public.gridex_db2_v4_normalize_membership_role(coalesce(ur.role, 'member')) end,
  coalesce(ur.status, case when coalesce(ur.is_active, true) then 'active' else 'disabled' end),
  true,
  true,
  'insert_from_user_role_explicit_company_id',
  jsonb_build_object('role', ur.role, 'role_id', ur.role_id)
from public.user_roles ur
where ur.company_id is not null
  and exists (select 1 from public.companies c where c.id = ur.company_id)
  and coalesce(ur.status, 'active') = 'active'
  and coalesce(ur.is_active, true) = true
  and not exists (select 1 from public.company_memberships cm where cm.company_id = ur.company_id and cm.user_id = ur.user_id)
union all
select
  'admin_users'::text,
  au.user_id::text,
  public.gridex_db2_v4_default_company_id(),
  au.user_id,
  'owner'::text,
  'company_admin'::text,
  case when coalesce(au.is_active, true) then 'active' else 'disabled' end,
  false,
  false,
  'needs_review_platform_admin_not_auto_tenant_member',
  jsonb_build_object('legacy_admin_role', au.role, 'reason', 'admin_users may be platform admins; DB2 will not auto-bind them to Div3rsa without explicit company source')
from public.admin_users au
where not exists (select 1 from public.company_memberships cm where cm.user_id = au.user_id)
union all
select
  'customer_profiles'::text,
  cp.user_id::text,
  public.gridex_db2_v4_default_company_id(),
  cp.user_id,
  'member'::text,
  'customer_service_agent'::text,
  'pending'::text,
  false,
  false,
  'profile_only_not_membership_source',
  jsonb_build_object('email', cp.email, 'onboarding_state', cp.onboarding_state, 'reason', 'customer_profiles are login/customer portal profiles, not admin tenant memberships')
from public.customer_profiles cp
where not exists (select 1 from public.company_memberships cm where cm.user_id = cp.user_id);

create or replace function public.gridex_db2_v4_customer_signal(p_profile jsonb)
returns boolean
language sql
immutable
as $$
  select
       public.gridex_db2_v4_text_has_value(p_profile->>'contract_customer_ref')
    or public.gridex_db2_v4_text_has_value(p_profile->>'billing_customer_ref')
    or public.gridex_db2_v4_text_has_value(p_profile->>'external_identity_ref')
    or public.gridex_db2_v4_text_has_value(p_profile #>> '{metadata,customer_number}')
    or public.gridex_db2_v4_text_has_value(p_profile #>> '{metadata,customer_id}')
    or public.gridex_db2_v4_text_has_value(p_profile #>> '{metadata,facility_id}')
    or public.gridex_db2_v4_text_has_value(p_profile #>> '{metadata,metering_point_id}')
    or lower(coalesce(p_profile #>> '{metadata,account_type}', '')) in ('customer','end_customer','electricity_customer')
    or lower(coalesce(p_profile #>> '{metadata,role}', '')) in ('customer','end_customer','electricity_customer')
$$;

create or replace function public.gridex_db2_v4_profile_decision(p_profile jsonb)
returns text
language sql
immutable
as $$
  select case
    when not public.gridex_db2_v4_text_has_value(p_profile->>'user_id') then 'needs_review_missing_user_id'
    when not public.gridex_db2_v4_text_has_value(p_profile->>'email')
      and not public.gridex_db2_v4_text_has_value(p_profile->>'phone')
      and not public.gridex_db2_v4_text_has_value(p_profile->>'full_name')
      and not public.gridex_db2_v4_text_has_value(p_profile->>'first_name')
      and not public.gridex_db2_v4_text_has_value(p_profile->>'last_name') then 'needs_review_empty_profile'
    when public.gridex_db2_v4_customer_signal(p_profile) then 'eligible_customer_candidate'
    else 'profile_only_no_customer_signal'
  end
$$;

create or replace view public.gridex_db2_v4_customer_profile_candidates_v as
select
  cp.user_id::text as source_id,
  cp.email,
  cp.first_name,
  cp.last_name,
  cp.full_name,
  cp.phone,
  cp.onboarding_state,
  cp.billing_customer_ref,
  cp.contract_customer_ref,
  cp.external_identity_ref,
  public.gridex_db2_v4_customer_signal(to_jsonb(cp)) as has_customer_signal,
  public.gridex_db2_v4_profile_decision(to_jsonb(cp)) as db2_decision,
  public.gridex_make_source_hash(to_jsonb(cp)) as source_hash,
  cp.created_at,
  cp.updated_at
from public.customer_profiles cp;

create or replace function public.gridex_db2_v4_log_backfill_item(
  p_backfill_run_id uuid,
  p_source_table text,
  p_source_id text,
  p_target_table text,
  p_target_id uuid,
  p_status text,
  p_message text,
  p_source_hash text default null,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  insert into public.backfill_run_items(
    backfill_run_id, source_table, source_id, target_table, target_id, status, message, source_hash, details
  )
  values (
    p_backfill_run_id,
    p_source_table,
    p_source_id,
    p_target_table,
    p_target_id,
    coalesce(p_status, 'pending'),
    p_message,
    p_source_hash,
    coalesce(p_details, '{}'::jsonb)
  );
end;
$$;

create or replace function public.gridex_db2_v4_run_membership_reconciliation(p_apply boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_run_id uuid;
  v_run_key text;
  r record;
  v_seen integer := 0;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
  v_existing_id uuid;
begin
  perform public.gridex_db2_v4_assert_ready();
  v_run_key := case when p_apply then 'db2_v4_membership_reconciliation_execute' else 'db2_v4_membership_reconciliation_dry_run' end;
  v_run_id := public.gridex_db1_start_backfill_run(v_run_key, 'tenant_memberships_full_view');

  for r in select * from public.gridex_db2_v4_membership_candidates_v order by should_insert desc, source_table, source_id loop
    v_seen := v_seen + 1;
    v_existing_id := null;
    begin
      if r.company_id is null or r.user_id is null then
        v_skipped := v_skipped + 1;
        perform public.gridex_db2_v4_log_backfill_item(v_run_id, r.source_table, r.source_id, 'company_memberships', null, 'needs_review', 'Candidate missing company_id or user_id; DB2 did not create membership.', null, r.details || jsonb_build_object('decision', r.decision, 'apply', p_apply));
        continue;
      end if;

      select cm.id into v_existing_id
      from public.company_memberships cm
      where cm.company_id = r.company_id and cm.user_id = r.user_id
      order by cm.created_at nulls last, cm.id::text
      limit 1;

      if v_existing_id is not null then
        v_updated := v_updated + 1;
        if p_apply and r.should_insert then
          update public.company_memberships cm
          set membership_role = coalesce(nullif(cm.membership_role, ''), r.membership_role),
              role_key = coalesce(nullif(cm.role_key, ''), r.role_key),
              status = coalesce(nullif(cm.status, ''), r.status, 'active'),
              is_active = coalesce(cm.is_active, true),
              metadata = coalesce(cm.metadata, '{}'::jsonb) || jsonb_build_object('db2_v4_reconciled', true, 'source_table', r.source_table, 'source_id', r.source_id),
              updated_at = now()
          where cm.id = v_existing_id;
        end if;
        perform public.gridex_db2_v4_log_backfill_item(v_run_id, r.source_table, r.source_id, 'company_memberships', v_existing_id, case when p_apply then 'updated_or_confirmed' else 'would_update_or_confirm' end, 'Company membership already exists or can be confirmed.', null, r.details || jsonb_build_object('decision', r.decision, 'apply', p_apply));
        continue;
      end if;

      if not r.should_insert then
        v_skipped := v_skipped + 1;
        perform public.gridex_db2_v4_log_backfill_item(v_run_id, r.source_table, r.source_id, 'company_memberships', null, case when r.decision like 'needs_review%' then 'needs_review' else 'skipped_no_explicit_company_source' end, 'DB2 did not create membership because the candidate does not have an explicit tenant membership source.', null, r.details || jsonb_build_object('decision', r.decision, 'apply', p_apply));
        continue;
      end if;

      if not p_apply then
        v_inserted := v_inserted + 1;
        perform public.gridex_db2_v4_log_backfill_item(v_run_id, r.source_table, r.source_id, 'company_memberships', null, 'would_insert_membership', 'Dry-run only. Explicit company membership candidate detected.', null, r.details || jsonb_build_object('decision', r.decision, 'company_id', r.company_id, 'user_id', r.user_id, 'membership_role', r.membership_role));
        continue;
      end if;

      insert into public.company_memberships(
        company_id, user_id, membership_role, role, role_key, status, is_active, invited_email, invited_at, accepted_at, metadata
      ) values (
        r.company_id,
        r.user_id,
        public.gridex_db2_v4_normalize_membership_role(r.membership_role),
        public.gridex_db2_v4_normalize_membership_role(r.membership_role),
        coalesce(r.role_key, case when public.gridex_db2_v4_normalize_membership_role(r.membership_role) in ('owner','admin','company_admin') then 'company_admin' else public.gridex_db2_v4_normalize_membership_role(r.membership_role) end),
        coalesce(r.status, 'active'),
        coalesce(r.status, 'active') = 'active',
        coalesce(r.details->>'email', null),
        now(),
        case when coalesce(r.status, 'active') = 'active' then now() else null end,
        coalesce(r.details, '{}'::jsonb) || jsonb_build_object('db2_v4_reconciled', true, 'source_table', r.source_table, 'source_id', r.source_id)
      )
      on conflict (company_id, user_id) do update
      set membership_role = excluded.membership_role,
          role = excluded.role,
          role_key = excluded.role_key,
          status = excluded.status,
          is_active = excluded.is_active,
          metadata = coalesce(public.company_memberships.metadata, '{}'::jsonb) || excluded.metadata,
          updated_at = now()
      returning id into v_existing_id;

      update public.user_profiles up
      set active_company_id = coalesce(up.active_company_id, r.company_id),
          updated_at = now()
      where (up.id = r.user_id or up.user_id = r.user_id)
        and up.active_company_id is null;

      v_inserted := v_inserted + 1;
      perform public.gridex_db2_v4_log_backfill_item(v_run_id, r.source_table, r.source_id, 'company_memberships', v_existing_id, 'inserted', 'Explicit company membership safely inserted.', null, r.details || jsonb_build_object('decision', r.decision, 'company_id', r.company_id, 'user_id', r.user_id, 'membership_role', r.membership_role));
    exception when others then
      v_failed := v_failed + 1;
      perform public.gridex_db2_v4_log_backfill_item(v_run_id, r.source_table, coalesce(r.source_id, '<null>'), 'company_memberships', null, 'failed', SQLERRM, null, coalesce(r.details, '{}'::jsonb) || jsonb_build_object('sqlstate', SQLSTATE, 'apply', p_apply));
    end;
  end loop;

  return public.gridex_db1_finish_backfill_run(
    v_run_id,
    case when v_failed > 0 then 'completed_with_warnings' else 'completed' end,
    jsonb_build_object(
      'phase', 'db2',
      'revision', 'v4_safe_full_view',
      'apply', p_apply,
      'safe_policy', 'only explicit company_id sources write company_memberships; admin_users/customer_profiles are review-only',
      'auto_create_missing_company', false
    ),
    v_seen, v_inserted, v_updated, v_skipped, v_failed
  );
end;
$$;

create or replace function public.gridex_db2_v4_run_customer_profile_backfill(p_apply boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_run_id uuid;
  v_company_id uuid;
  v_run_key text;
  r record;
  v_customer_id uuid;
  v_linked_id uuid;
  v_match_count integer := 0;
  v_seen integer := 0;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
  v_status text;
  v_decision text;
  v_full_name text;
  v_source_hash text;
begin
  perform public.gridex_db2_v4_assert_ready();

  v_run_key := case when p_apply then 'db2_v4_customer_profile_execute' else 'db2_v4_customer_profile_dry_run' end;
  v_run_id := public.gridex_db1_start_backfill_run(v_run_key, 'customer_profiles_to_customers_signal_only');
  v_company_id := public.gridex_db2_v4_default_company_id();

  if v_company_id is null then
    return public.gridex_db1_finish_backfill_run(v_run_id, 'blocked', jsonb_build_object('reason', 'default_company_ambiguous', 'apply', p_apply), 0, 0, 0, 1, 0);
  end if;

  for r in select * from public.customer_profiles cp order by cp.created_at nulls last, cp.user_id::text loop
    v_seen := v_seen + 1;
    v_customer_id := null;
    v_linked_id := null;
    v_match_count := 0;
    v_status := null;
    v_decision := public.gridex_db2_v4_profile_decision(to_jsonb(r));
    v_full_name := coalesce(nullif(btrim(coalesce(r.full_name, '')), ''), nullif(btrim(coalesce(r.first_name, '') || ' ' || coalesce(r.last_name, '')), ''));
    v_source_hash := public.gridex_make_source_hash(to_jsonb(r));

    begin
      select crl.canonical_id into v_linked_id
      from public.canonical_record_links crl
      where crl.source_table = 'customer_profiles'
        and crl.source_id = r.user_id::text
        and crl.canonical_table = 'customers'
        and crl.status = 'active'
      order by crl.created_at nulls last, crl.id::text
      limit 1;

      if v_linked_id is not null and exists (select 1 from public.customers c where c.id = v_linked_id) then
        v_customer_id := v_linked_id;
        v_status := 'linked_existing';
      end if;

      if v_customer_id is null and v_decision <> 'eligible_customer_candidate' then
        v_skipped := v_skipped + 1;
        perform public.gridex_db2_v4_log_backfill_item(
          v_run_id,
          'customer_profiles',
          coalesce(r.user_id::text, '<null>'),
          'customers',
          null,
          case when v_decision like 'needs_review%' then 'needs_review' else 'skipped_no_customer_signal' end,
          'DB2 v4 did not create a customer because this row looks like a login/portal profile, not a confirmed electricity customer.',
          v_source_hash,
          jsonb_build_object('decision', v_decision, 'email', r.email, 'full_name', v_full_name, 'billing_customer_ref', r.billing_customer_ref, 'contract_customer_ref', r.contract_customer_ref, 'external_identity_ref', r.external_identity_ref, 'apply', p_apply)
        );
        continue;
      end if;

      if v_customer_id is null and public.normalize_email(r.email) is not null then
        select count(*) into v_match_count
        from public.customers c
        where c.company_id = v_company_id
          and c.normalized_email = public.normalize_email(r.email);

        if v_match_count = 1 then
          select c.id into v_customer_id
          from public.customers c
          where c.company_id = v_company_id
            and c.normalized_email = public.normalize_email(r.email)
          order by c.created_at nulls last, c.id::text
          limit 1;
          v_status := 'matched_by_email';
        elsif v_match_count > 1 then
          v_skipped := v_skipped + 1;
          perform public.gridex_db2_v4_log_backfill_item(v_run_id, 'customer_profiles', r.user_id::text, 'customers', null, 'needs_review', 'Ambiguous customer match by normalized email. DB2 v4 did not merge automatically.', v_source_hash, jsonb_build_object('email', r.email, 'match_count', v_match_count, 'apply', p_apply));
          continue;
        end if;
      end if;

      if v_customer_id is null and public.gridex_db2_v4_text_has_value(r.contract_customer_ref) then
        select count(*) into v_match_count
        from public.customers c
        where c.company_id = v_company_id
          and c.customer_number = r.contract_customer_ref;

        if v_match_count = 1 then
          select c.id into v_customer_id
          from public.customers c
          where c.company_id = v_company_id
            and c.customer_number = r.contract_customer_ref
          order by c.created_at nulls last, c.id::text
          limit 1;
          v_status := 'matched_by_customer_number';
        elsif v_match_count > 1 then
          v_skipped := v_skipped + 1;
          perform public.gridex_db2_v4_log_backfill_item(v_run_id, 'customer_profiles', r.user_id::text, 'customers', null, 'needs_review', 'Ambiguous customer match by customer_number. DB2 v4 did not merge automatically.', v_source_hash, jsonb_build_object('contract_customer_ref', r.contract_customer_ref, 'match_count', v_match_count, 'apply', p_apply));
          continue;
        end if;
      end if;

      if not p_apply then
        if v_customer_id is null then
          v_inserted := v_inserted + 1;
          v_status := 'would_insert_customer_candidate';
        else
          v_updated := v_updated + 1;
          v_status := 'would_link_or_update_customer_candidate';
        end if;
        perform public.gridex_db2_v4_log_backfill_item(v_run_id, 'customer_profiles', r.user_id::text, 'customers', v_customer_id, v_status, 'Dry-run only. Eligible customer candidate detected, but no canonical row changed.', v_source_hash, jsonb_build_object('decision', v_decision, 'email', r.email, 'full_name', v_full_name, 'company_id', v_company_id, 'apply', false));
        continue;
      end if;

      if v_customer_id is null then
        insert into public.customers(
          company_id, customer_type, status, first_name, last_name, full_name, email, phone,
          preferred_language, source, customer_number, metadata, created_at, updated_at
        ) values (
          v_company_id,
          'private',
          case when r.email_verified_at is not null or coalesce(r.onboarding_state, '') = 'verified' then 'active' else 'pending' end,
          r.first_name,
          r.last_name,
          v_full_name,
          r.email,
          r.phone,
          coalesce(nullif(r.language_code, ''), 'sv'),
          'customer_profiles',
          coalesce(nullif(r.contract_customer_ref, ''), nullif(r.billing_customer_ref, ''), nullif(r.external_identity_ref, '')),
          jsonb_build_object('source_table', 'customer_profiles', 'source_user_id', r.user_id, 'billing_customer_ref', r.billing_customer_ref, 'contract_customer_ref', r.contract_customer_ref, 'external_identity_ref', r.external_identity_ref, 'onboarding_state', r.onboarding_state, 'email_verified_at', r.email_verified_at, 'marketing_opt_in', r.marketing_opt_in, 'db2_backfill', true, 'db2_decision', v_decision) || coalesce(r.metadata, '{}'::jsonb),
          coalesce(r.created_at, now()),
          coalesce(r.updated_at, now())
        ) returning id into v_customer_id;
        v_inserted := v_inserted + 1;
        v_status := 'inserted';
      else
        update public.customers c
        set first_name = coalesce(nullif(c.first_name, ''), r.first_name),
            last_name = coalesce(nullif(c.last_name, ''), r.last_name),
            full_name = coalesce(nullif(c.full_name, ''), v_full_name),
            email = coalesce(nullif(c.email, ''), r.email),
            phone = coalesce(nullif(c.phone, ''), r.phone),
            preferred_language = coalesce(nullif(c.preferred_language, ''), nullif(r.language_code, ''), 'sv'),
            customer_number = coalesce(nullif(c.customer_number, ''), nullif(r.contract_customer_ref, ''), nullif(r.billing_customer_ref, ''), nullif(r.external_identity_ref, '')),
            source = coalesce(nullif(c.source, ''), 'customer_profiles'),
            metadata = coalesce(c.metadata, '{}'::jsonb) || jsonb_build_object('db2_profile_linked', true, 'source_user_id', r.user_id, 'profile_email', r.email, 'profile_onboarding_state', r.onboarding_state, 'db2_decision', v_decision),
            updated_at = now()
        where c.id = v_customer_id;
        v_updated := v_updated + 1;
        v_status := coalesce(v_status, 'updated');
      end if;

      insert into public.canonical_record_links(company_id, source_table, source_id, canonical_table, canonical_id, source_hash, confidence, status, details)
      values (v_company_id, 'customer_profiles', r.user_id::text, 'customers', v_customer_id, v_source_hash, 'system_high_signal', 'active', jsonb_build_object('backfill', 'db2_controlled_backfill_v3', 'match_status', v_status, 'decision', v_decision))
      on conflict (source_table, source_id, canonical_table) do update
      set company_id = excluded.company_id,
          canonical_id = excluded.canonical_id,
          source_hash = excluded.source_hash,
          confidence = excluded.confidence,
          status = excluded.status,
          details = excluded.details;

      perform public.gridex_db2_v4_log_backfill_item(v_run_id, 'customer_profiles', r.user_id::text, 'customers', v_customer_id, v_status, 'Eligible customer profile safely linked to canonical customer.', v_source_hash, jsonb_build_object('decision', v_decision, 'email', r.email, 'full_name', v_full_name, 'company_id', v_company_id, 'apply', true));

      insert into public.audit_logs(company_id, actor_user_id, entity_type, entity_id, action, old_values, new_values, metadata)
      values (v_company_id, null, 'customer', v_customer_id::text, 'db2.customer_profile_backfilled', null, jsonb_build_object('source_table', 'customer_profiles', 'source_id', r.user_id::text, 'status', v_status, 'decision', v_decision), jsonb_build_object('backfill_run_id', v_run_id, 'source_hash', v_source_hash, 'db2_revision', 'v3'));
    exception when others then
      v_failed := v_failed + 1;
      perform public.gridex_db2_v4_log_backfill_item(v_run_id, 'customer_profiles', coalesce(r.user_id::text, '<null>'), 'customers', null, 'failed', SQLERRM, v_source_hash, jsonb_build_object('sqlstate', SQLSTATE, 'apply', p_apply, 'decision', v_decision));
    end;
  end loop;

  return public.gridex_db1_finish_backfill_run(
    v_run_id,
    case when v_failed > 0 then 'completed_with_warnings' else 'completed' end,
    jsonb_build_object(
      'phase', 'db2',
      'revision', 'v4_safe_full_view',
      'apply', p_apply,
      'source', 'customer_profiles',
      'target', 'customers',
      'default_company_id', v_company_id,
      'safe_merge_policy', 'existing canonical link wins; otherwise only profiles with customer signal can be inserted/matched; bare login profiles are skipped for review'
    ),
    v_seen, v_inserted, v_updated, v_skipped, v_failed
  );
end;
$$;

create or replace view public.gridex_db2_v4_customer_profile_mapping_v as
select
  cp.user_id::text as source_id,
  cp.email,
  cp.first_name,
  cp.last_name,
  cp.full_name,
  cp.phone,
  cp.onboarding_state,
  cp.billing_customer_ref,
  cp.contract_customer_ref,
  cp.external_identity_ref,
  public.gridex_db2_v4_customer_signal(to_jsonb(cp)) as has_customer_signal,
  public.gridex_db2_v4_profile_decision(to_jsonb(cp)) as db2_decision,
  crl.canonical_id as customer_id,
  c.company_id,
  c.status as customer_status,
  c.normalized_email as customer_normalized_email,
  case
    when public.gridex_db2_v4_profile_decision(to_jsonb(cp)) <> 'eligible_customer_candidate' and crl.id is null then 'not_migrated_profile_only'
    when crl.id is null then 'eligible_missing_link'
    when c.id is null then 'link_target_missing'
    else 'linked'
  end as mapping_status,
  crl.source_hash,
  crl.created_at
from public.customer_profiles cp
left join public.canonical_record_links crl
  on crl.source_table = 'customer_profiles'
 and crl.source_id = cp.user_id::text
 and crl.canonical_table = 'customers'
left join public.customers c
  on c.id = crl.canonical_id;

create or replace view public.gridex_db2_v4_current_backfill_items_v as
select
  br.run_key,
  br.status as run_status,
  br.started_at,
  br.completed_at,
  bri.*
from public.backfill_runs br
join public.backfill_run_items bri on bri.backfill_run_id = br.id
where br.run_key in (
  'db2_v4_membership_reconciliation_dry_run',
  'db2_v4_membership_reconciliation_execute',
  'db2_v4_customer_profile_dry_run',
  'db2_v4_customer_profile_execute'
)
  and bri.created_at >= coalesce(br.started_at, '-infinity'::timestamptz);

create or replace view public.gridex_db2_v4_profile_review_v as
select
  m.source_id,
  m.email,
  m.full_name,
  m.phone,
  m.onboarding_state,
  m.has_customer_signal,
  m.db2_decision,
  m.mapping_status,
  case
    when m.db2_decision = 'profile_only_no_customer_signal' then 'No contract/customer/facility signal. Keep as user/profile only until customer intake creates real customer data.'
    when m.db2_decision like 'needs_review%' then 'Profile data is incomplete or malformed and needs manual review.'
    when m.mapping_status = 'eligible_missing_link' then 'Customer signal exists but no canonical link was created.'
    else 'OK'
  end as review_note
from public.gridex_db2_v4_customer_profile_mapping_v m;

-- Dry-run only in SQL 01. No business/customer rows are inserted here.
select public.gridex_db2_v4_assert_ready();
select public.gridex_db2_v4_run_membership_reconciliation(false) as db2_v4_membership_dry_run;
select public.gridex_db2_v4_run_customer_profile_backfill(false) as db2_v4_customer_profile_dry_run;
select * from public.gridex_db2_v4_company_reconciliation_v order by check_key;
select * from public.gridex_db2_v4_schema_contract_v order by table_name, column_name;
select * from public.gridex_db2_v4_membership_candidates_v order by should_insert desc, source_table, source_id;
select * from public.gridex_db2_v4_profile_review_v order by email nulls last, source_id;
