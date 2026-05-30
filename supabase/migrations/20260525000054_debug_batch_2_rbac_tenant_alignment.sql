-- Debug Batch 2: RBAC + tenant alignment hardening
-- Purpose: normalize role keys, make DB-side role resolution tolerant of legacy rows,
-- and keep platform access tied to explicit platform roles only.

-- 1) Normalize roles so code can resolve by key even when live rows were created with key=null.
do $$
begin
  if to_regclass('public.roles') is not null then
    alter table public.roles add column if not exists key text;
    alter table public.roles add column if not exists scope text default 'company';
    alter table public.roles add column if not exists is_system boolean not null default false;

    update public.roles
      set key = regexp_replace(lower(trim(coalesce(name, key))), '[^a-z0-9]+', '_', 'g')
    where nullif(trim(coalesce(key, '')), '') is null
      and nullif(trim(coalesce(name, '')), '') is not null;

    update public.roles
      set key = 'super_admin'
    where key in ('superadmin', 'platform_super_admin')
      and not exists (select 1 from public.roles existing where existing.key = 'super_admin');

    update public.roles
      set key = 'company_admin'
    where key in ('companyadmin', 'tenant_admin', 'company_owner', 'bolagsansvarig')
      and not exists (select 1 from public.roles existing where existing.key = 'company_admin');

    update public.roles
      set key = 'customer_service_agent'
    where key in ('support', 'customer_service', 'kundservice')
      and not exists (select 1 from public.roles existing where existing.key = 'customer_service_agent');

    update public.roles
      set key = 'finance_readonly'
    where key in ('finance', 'ekonomi')
      and not exists (select 1 from public.roles existing where existing.key = 'finance_readonly');

    update public.roles
      set key = 'compliance_manager'
    where key = 'compliance_officer'
      and not exists (select 1 from public.roles existing where existing.key = 'compliance_manager');
  end if;
end $$;

-- 2) Ensure the standard internal role rows exist. No permission backfill here;
-- application fallback profiles remain source of truth until role_permissions is fully governed.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('super_admin', 'super_admin', 'Full platform access.', 'platform'),
      ('company_admin', 'company_admin', 'Company admin access scoped to own tenant.', 'company'),
      ('admin', 'admin', 'Broad company admin access scoped to own tenant.', 'company'),
      ('operations_manager', 'operations_manager', 'Operations manager scoped to own tenant.', 'company'),
      ('operations_agent', 'operations_agent', 'Operations agent scoped to own tenant.', 'company'),
      ('customer_service_manager', 'customer_service_manager', 'Customer service manager scoped to own tenant.', 'company'),
      ('customer_service_agent', 'customer_service_agent', 'Customer service access scoped to own tenant.', 'company'),
      ('pricing_manager', 'pricing_manager', 'Pricing draft access scoped to own tenant.', 'company'),
      ('pricing_approver', 'pricing_approver', 'Pricing approval access scoped to own tenant.', 'company'),
      ('compliance_manager', 'compliance_manager', 'Compliance and audit access scoped to own tenant.', 'company'),
      ('sales_manager', 'sales_manager', 'Sales and customer intake access scoped to own tenant.', 'company'),
      ('partner_manager', 'partner_manager', 'Partner/export access scoped to own tenant.', 'company'),
      ('finance_readonly', 'finance_readonly', 'Finance read-only access scoped to own tenant.', 'company'),
      ('executive_readonly', 'executive_readonly', 'Executive read-only access scoped to own tenant.', 'company'),
      ('partner_api_user', 'partner_api_user', 'Technical partner/API access.', 'company'),
      ('customer', 'customer', 'End customer classification; not internal admin.', 'company')
    ) as v(key, name, description, scope)
  loop
    update public.roles
       set name = r.name,
           description = coalesce(public.roles.description, r.description),
           scope = coalesce(public.roles.scope, r.scope),
           is_system = true
     where key = r.key;

    if not found then
      insert into public.roles (key, name, description, scope, is_system)
      values (r.key, r.name, r.description, r.scope, true);
    end if;
  end loop;
end $$;

-- 3) Keep legacy user_roles.role populated for rows that only have role_id.
do $$
begin
  if to_regclass('public.user_roles') is not null and to_regclass('public.roles') is not null then
    update public.user_roles ur
      set role = coalesce(ur.role, r.key, r.name),
          status = coalesce(ur.status, 'active'),
          is_active = coalesce(ur.is_active, true)
    from public.roles r
    where ur.role_id = r.id
      and (ur.role is null or ur.status is null or ur.is_active is null);

    create index if not exists user_roles_user_active_idx
      on public.user_roles(user_id, status, is_active);
  end if;
end $$;

-- 4) DB-side platform role detection must support both legacy user_roles.role and role_id joins.
create or replace function public.gridex_user_is_platform_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_result boolean := false;
begin
  if auth.uid() is null then
    return false;
  end if;

  if to_regclass('public.admin_users') is not null then
    begin
      select exists (
        select 1
        from public.admin_users au
        where au.user_id = auth.uid()
          and coalesce(au.is_active, true) = true
          and lower(coalesce(au.role, '')) in ('super_admin','superadmin','platform_admin')
      ) into v_result;
      if coalesce(v_result, false) then return true; end if;
    exception when undefined_table or undefined_column then
      null;
    end;
  end if;

  if to_regclass('public.user_roles') is not null then
    begin
      select exists (
        select 1
        from public.user_roles ur
        left join public.roles r on r.id = ur.role_id
        where ur.user_id = auth.uid()
          and coalesce(ur.is_active, true) = true
          and coalesce(ur.status, 'active') = 'active'
          and lower(coalesce(r.key, r.name, ur.role, '')) in ('super_admin','superadmin','platform_admin')
      ) into v_result;
      if coalesce(v_result, false) then return true; end if;
    exception when undefined_table or undefined_column then
      null;
    end;
  end if;

  return false;
exception when others then
  return false;
end;
$$;

-- 5) RPC used by middleware/guards must return role keys even when roles.key was null historically.
create or replace function public.gridex_get_user_roles(p_user_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_roles text[] := '{}'::text[];
  v_more text[] := '{}'::text[];
begin
  if p_user_id is null then
    return '{}'::text[];
  end if;

  if to_regclass('public.user_roles') is not null then
    begin
      select coalesce(array_agg(distinct role_name order by role_name), '{}'::text[])
      into v_more
      from (
        select lower(coalesce(r.key, r.name, ur.role))::text as role_name
        from public.user_roles ur
        left join public.roles r on r.id = ur.role_id
        where ur.user_id = p_user_id
          and coalesce(ur.is_active, true) = true
          and coalesce(ur.status, 'active') = 'active'
          and coalesce(r.key, r.name, ur.role) is not null
      ) x;

      select coalesce(array_agg(distinct role_name order by role_name), '{}'::text[])
        into v_roles
      from unnest(coalesce(v_roles, '{}'::text[]) || coalesce(v_more, '{}'::text[])) as u(role_name);
    exception
      when undefined_table or undefined_column then null;
    end;
  end if;

  if to_regclass('public.admin_users') is not null then
    begin
      select coalesce(array_agg(distinct role_name order by role_name), '{}'::text[])
      into v_more
      from (
        select lower(au.role)::text as role_name
        from public.admin_users au
        where au.user_id = p_user_id
          and coalesce(au.is_active, true) = true
          and au.role is not null
      ) x;

      select coalesce(array_agg(distinct role_name order by role_name), '{}'::text[])
        into v_roles
      from unnest(coalesce(v_roles, '{}'::text[]) || coalesce(v_more, '{}'::text[])) as u(role_name);
    exception
      when undefined_table or undefined_column then null;
    end;
  end if;

  return coalesce(v_roles, '{}'::text[]);
end;
$$;

-- 6) Useful manual RBAC verification view. This does not expose tenant data; it summarizes access rows.
create or replace view public.gridex_debug_batch2_rbac_v as
select
  cm.company_id,
  c.name as company_name,
  c.status as company_status,
  cm.user_id,
  cm.invited_email,
  coalesce(cm.membership_role::text, cm.role::text, 'member') as membership_role,
  cm.status as membership_status,
  coalesce(cm.is_active, true) as membership_active,
  public.gridex_get_user_roles(cm.user_id) as resolved_roles
from public.company_memberships cm
left join public.companies c on c.id = cm.company_id;
