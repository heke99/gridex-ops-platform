-- Tenant lifecycle RLS hardening.
-- Defense in depth for direct PostgREST/Supabase access:
-- * active/onboarding tenants are readable + writable (subject to existing role policies)
-- * paused tenants are read-only to their own members
-- * suspended/archived/pending_deletion/closed/deleted_test_only tenants are hidden from normal tenant users
-- * platform admins retain read visibility, while operational writes still go through canonical service-role commands
-- * lifecycle/access source-of-truth tables cannot be mutated directly through the authenticated Data API

begin;

set local lock_timeout = '10s';
set local statement_timeout = '180s';
set local search_path = public, auth, pg_catalog;

-- A disabled/removed user must not retain Data API access through an old JWT/session.
create or replace function public.gridex_user_company_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $function$
  select membership.company_id
  from public.company_memberships membership
  join public.companies company on company.id = membership.company_id
  where public.gridex_is_current_session_allowed()
    and membership.user_id = (select auth.uid())
    and coalesce(membership.status, 'active') = 'active'
    and coalesce(membership.is_active, true)
    and company.status in ('active', 'onboarding', 'paused')
$function$;

create or replace function public.gridex_can_read_company(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $function$
  select public.gridex_is_current_session_allowed()
    and (
      public.gridex_user_is_platform_admin()
      or exists (
        select 1
        from public.company_memberships membership
        join public.companies company on company.id = membership.company_id
        where membership.company_id = p_company_id
          and membership.user_id = (select auth.uid())
          and coalesce(membership.status, 'active') = 'active'
          and coalesce(membership.is_active, true)
          and company.status in ('active', 'onboarding', 'paused')
      )
    )
$function$;

create or replace function public.gridex_can_write_company(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $function$
  select public.gridex_is_current_session_allowed()
    and public.gridex_company_status_is_writable(p_company_id)
    and (
      public.gridex_user_is_platform_admin()
      or exists (
        select 1
        from public.company_memberships membership
        where membership.company_id = p_company_id
          and membership.user_id = (select auth.uid())
          and coalesce(membership.status, 'active') = 'active'
          and coalesce(membership.is_active, true)
          and coalesce(membership.membership_role, 'member')
            in ('owner', 'admin', 'company_admin', 'operations')
      )
    )
$function$;

create or replace function public.gridex_user_can_manage_company(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $function$
  select public.gridex_is_current_session_allowed()
    and (
      public.gridex_user_is_platform_admin()
      or (
        public.gridex_company_status_is_writable(p_company_id)
        and exists (
          select 1
          from public.company_memberships membership
          where membership.company_id = p_company_id
            and membership.user_id = (select auth.uid())
            and coalesce(membership.status, 'active') = 'active'
            and coalesce(membership.is_active, true)
            and coalesce(membership.membership_role, 'member')
              in ('owner', 'admin', 'company_admin')
        )
      )
    )
$function$;

-- SECURITY DEFINER helpers in public must not inherit EXECUTE through PUBLIC/anon.
revoke all on function public.gridex_user_company_ids() from public, anon;
revoke all on function public.gridex_can_read_company(uuid) from public, anon;
revoke all on function public.gridex_can_write_company(uuid) from public, anon;
revoke all on function public.gridex_user_can_manage_company(uuid) from public, anon;
revoke all on function public.gridex_is_current_session_allowed() from public, anon;

grant execute on function public.gridex_user_company_ids() to authenticated, service_role;
grant execute on function public.gridex_can_read_company(uuid) to authenticated, service_role;
grant execute on function public.gridex_can_write_company(uuid) to authenticated, service_role;
grant execute on function public.gridex_user_can_manage_company(uuid) to authenticated, service_role;
grant execute on function public.gridex_is_current_session_allowed() to authenticated, service_role;

-- Add restrictive lifecycle guards to every UUID company-scoped base/partitioned table.
-- Existing business/RBAC policies remain permissive policies; these guards can only narrow access.
do $rls$
declare
  target record;
begin
  for target in
    select distinct cls.relname as table_name
    from pg_class cls
    join pg_namespace ns on ns.oid = cls.relnamespace
    join pg_attribute attribute on attribute.attrelid = cls.oid
    where ns.nspname = 'public'
      and cls.relkind in ('r', 'p')
      and attribute.attname = 'company_id'
      and attribute.atttypid = 'uuid'::regtype
      and attribute.attnum > 0
      and not attribute.attisdropped
    order by cls.relname
  loop
    execute format('alter table public.%I enable row level security', target.table_name);

    execute format('drop policy if exists tenant_lifecycle_select_guard on public.%I', target.table_name);
    execute format(
      'create policy tenant_lifecycle_select_guard on public.%I as restrictive for select to authenticated using (public.gridex_can_read_company(company_id))',
      target.table_name
    );

    execute format('drop policy if exists tenant_lifecycle_insert_guard on public.%I', target.table_name);
    execute format(
      'create policy tenant_lifecycle_insert_guard on public.%I as restrictive for insert to authenticated with check (public.gridex_can_write_company(company_id))',
      target.table_name
    );

    execute format('drop policy if exists tenant_lifecycle_update_guard on public.%I', target.table_name);
    execute format(
      'create policy tenant_lifecycle_update_guard on public.%I as restrictive for update to authenticated using (public.gridex_can_write_company(company_id)) with check (public.gridex_can_write_company(company_id))',
      target.table_name
    );

    execute format('drop policy if exists tenant_lifecycle_delete_guard on public.%I', target.table_name);
    execute format(
      'create policy tenant_lifecycle_delete_guard on public.%I as restrictive for delete to authenticated using (public.gridex_can_write_company(company_id))',
      target.table_name
    );
  end loop;
end
$rls$;

-- companies uses its own id as the tenant key.
alter table public.companies enable row level security;
drop policy if exists companies_lifecycle_select_guard on public.companies;
create policy companies_lifecycle_select_guard
  on public.companies
  as restrictive
  for select
  to authenticated
  using (
    public.gridex_is_current_session_allowed()
    and (
      public.gridex_user_is_platform_admin()
      or id in (select public.gridex_user_company_ids())
    )
  );

-- Lifecycle and access source-of-truth writes must use canonical commands/RPCs.
-- This prevents a browser/Data API caller, including a platform-admin JWT, from
-- bypassing lifecycle versioning, audit, side effects, role synchronization, or invitation state.
revoke insert, update, delete on public.companies from anon, authenticated;
revoke insert, update, delete on public.company_memberships from anon, authenticated;
revoke insert, update, delete on public.user_roles from anon, authenticated;
revoke insert, update, delete on public.company_invitations from anon, authenticated;
revoke all on public.companies from anon;

-- Verification: every UUID company-scoped table is RLS-enabled and has all four lifecycle guards.
do $verify$
declare
  missing_rls text[];
  missing_guard text[];
begin
  select array_agg(table_name order by table_name)
  into missing_rls
  from (
    select distinct cls.relname as table_name
    from pg_class cls
    join pg_namespace ns on ns.oid = cls.relnamespace
    join pg_attribute attribute on attribute.attrelid = cls.oid
    where ns.nspname = 'public'
      and cls.relkind in ('r', 'p')
      and attribute.attname = 'company_id'
      and attribute.atttypid = 'uuid'::regtype
      and attribute.attnum > 0
      and not attribute.attisdropped
      and not cls.relrowsecurity
  ) rows_without_rls;

  if coalesce(array_length(missing_rls, 1), 0) > 0 then
    raise exception 'tenant_rls_missing:%', array_to_string(missing_rls, ',');
  end if;

  select array_agg(table_name order by table_name)
  into missing_guard
  from (
    select scoped.table_name
    from (
      select distinct cls.relname as table_name, cls.oid as table_oid
      from pg_class cls
      join pg_namespace ns on ns.oid = cls.relnamespace
      join pg_attribute attribute on attribute.attrelid = cls.oid
      where ns.nspname = 'public'
        and cls.relkind in ('r', 'p')
        and attribute.attname = 'company_id'
        and attribute.atttypid = 'uuid'::regtype
        and attribute.attnum > 0
        and not attribute.attisdropped
    ) scoped
    where (
      select count(*)
      from pg_policy policy
      where policy.polrelid = scoped.table_oid
        and policy.polname in (
          'tenant_lifecycle_select_guard',
          'tenant_lifecycle_insert_guard',
          'tenant_lifecycle_update_guard',
          'tenant_lifecycle_delete_guard'
        )
    ) <> 4
  ) rows_without_guards;

  if coalesce(array_length(missing_guard, 1), 0) > 0 then
    raise exception 'tenant_lifecycle_rls_guard_missing:%', array_to_string(missing_guard, ',');
  end if;

  if has_table_privilege('authenticated', 'public.companies', 'INSERT')
     or has_table_privilege('authenticated', 'public.companies', 'UPDATE')
     or has_table_privilege('authenticated', 'public.companies', 'DELETE') then
    raise exception 'companies_authenticated_direct_write_still_granted';
  end if;

  if has_table_privilege('authenticated', 'public.company_memberships', 'INSERT')
     or has_table_privilege('authenticated', 'public.company_memberships', 'UPDATE')
     or has_table_privilege('authenticated', 'public.company_memberships', 'DELETE') then
    raise exception 'company_memberships_authenticated_direct_write_still_granted';
  end if;

  if has_table_privilege('anon', 'public.companies', 'SELECT') then
    raise exception 'companies_anon_select_still_granted';
  end if;

  if has_function_privilege('anon', 'public.gridex_can_read_company(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.gridex_can_write_company(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.gridex_user_can_manage_company(uuid)', 'EXECUTE') then
    raise exception 'tenant_security_definer_helper_exposed_to_anon';
  end if;
end
$verify$;

commit;
