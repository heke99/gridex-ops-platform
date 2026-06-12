-- Performance Batches 1-3 — DB/RLS acceleration without widening tenant access.
-- Scope:
--   Batch 1: rewrite direct auth.* calls in RLS policies to initplan-safe SELECT wrappers.
--   Batch 2: replace emergency RBAC helpers with data-driven, SECURITY DEFINER helpers.
--   Batch 3: expose DB-side RPCs/views for dashboard, customer list, intake queue,
--            work queue and customer-card read models.
--
-- Production safety:
--   - No data deletion.
--   - No broad USING (true) tenant policies.
--   - Existing policy semantics are preserved when policies are rewritten.
--   - RLS policy rewrite is best-effort and transactional per policy; failures are skipped with NOTICE.
--   - service_role behavior is not used to grant extra client access.

set statement_timeout = '120s';
set lock_timeout = '5s';

-- -----------------------------------------------------------------------------
-- 0) Safety/audit table for this batch.
-- -----------------------------------------------------------------------------
create table if not exists public.gridex_performance_hardening_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null,
  status text not null default 'completed',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists gridex_performance_hardening_events_key_created_idx
  on public.gridex_performance_hardening_events(event_key, created_at desc);

-- -----------------------------------------------------------------------------
-- 1) Batch 2 first: stable, data-driven auth/RBAC helpers used by policies.
--    These remove the emergency hardcoded superadmin logic from the function body.
--    The owner account remains a superadmin through admin_users/user_roles rows.
-- -----------------------------------------------------------------------------
create or replace function public.gridex_user_is_platform_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ok boolean := false;
begin
  if v_uid is null then
    return false;
  end if;

  select exists (
    select 1
    from public.admin_users au
    where au.user_id = v_uid
      and coalesce(au.is_active, true) = true
      and lower(coalesce(au.role, '')) in ('super_admin', 'superadmin', 'platform_admin')
  ) into v_ok;

  if coalesce(v_ok, false) then
    return true;
  end if;

  select exists (
    select 1
    from public.user_roles ur
    left join public.roles r on r.id = ur.role_id
    where ur.user_id = v_uid
      and coalesce(ur.status, 'active') = 'active'
      and coalesce(ur.is_active, true) = true
      and lower(coalesce(ur.role, r.key, r.name, '')) in ('super_admin', 'superadmin', 'platform_admin')
  ) into v_ok;

  return coalesce(v_ok, false);
exception when undefined_table or undefined_column then
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
  select distinct cm.company_id
  from public.company_memberships cm
  left join public.companies c on c.id = cm.company_id
  where cm.user_id = (select auth.uid())
    and cm.company_id is not null
    and coalesce(cm.status, 'active') = 'active'
    and coalesce(cm.is_active, true) = true
    and coalesce(c.is_active, true) = true
    and coalesce(c.status, 'active') not in ('archived', 'suspended', 'pending_deletion', 'deleted')
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
    or exists (
      select 1
      from public.gridex_user_company_ids() as c(company_id)
      where c.company_id = p_company_id
    )
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
      select 1
      from public.company_memberships cm
      left join public.companies c on c.id = cm.company_id
      where cm.company_id = p_company_id
        and cm.user_id = (select auth.uid())
        and coalesce(cm.status, 'active') = 'active'
        and coalesce(cm.is_active, true) = true
        and coalesce(c.is_active, true) = true
        and coalesce(c.status, 'active') in ('active', 'onboarding')
        and lower(coalesce(cm.role_key, cm.membership_role::text, cm.role, '')) in (
          'owner',
          'admin',
          'company_admin',
          'company_owner',
          'tenant_admin',
          'operations',
          'operations_manager',
          'customer_service_manager'
        )
    )
  )
$$;

grant execute on function public.gridex_user_is_platform_admin() to authenticated, service_role;
grant execute on function public.gridex_user_company_ids() to authenticated, service_role;
grant execute on function public.gridex_can_read_company(uuid) to authenticated, service_role;
grant execute on function public.gridex_can_write_company(uuid) to authenticated, service_role;

-- RBAC helper indexes. These make the SECURITY DEFINER checks cheap and predictable.
do $$
begin
  if to_regclass('public.admin_users') is not null then
    execute 'create index if not exists gridex_perf_admin_users_user_active_role_idx on public.admin_users(user_id, is_active, role)';
  end if;

  if to_regclass('public.user_roles') is not null then
    execute 'create index if not exists gridex_perf_user_roles_user_status_active_idx on public.user_roles(user_id, status, is_active)';
    execute 'create index if not exists gridex_perf_user_roles_user_role_id_idx on public.user_roles(user_id, role_id)';
  end if;

  if to_regclass('public.company_memberships') is not null then
    execute 'create index if not exists gridex_perf_company_memberships_user_company_active_idx on public.company_memberships(user_id, company_id, status, is_active)';
    execute 'create index if not exists gridex_perf_company_memberships_company_user_active_idx on public.company_memberships(company_id, user_id, status, is_active)';
  end if;
end $$;

create or replace function public.gridex_current_user_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
  v_company_ids jsonb := '[]'::jsonb;
  v_default_company_id uuid;
  v_roles jsonb := '[]'::jsonb;
  v_is_platform_admin boolean := false;
begin
  if v_uid is null then
    return jsonb_build_object(
      'user_id', null,
      'email', null,
      'is_platform_admin', false,
      'company_ids', '[]'::jsonb,
      'default_company_id', null,
      'roles', '[]'::jsonb
    );
  end if;

  v_is_platform_admin := public.gridex_user_is_platform_admin();

  select coalesce(jsonb_agg(distinct company_id), '[]'::jsonb), min(company_id)
    into v_company_ids, v_default_company_id
  from public.gridex_user_company_ids() as c(company_id);

  select coalesce(jsonb_agg(distinct role_key order by role_key), '[]'::jsonb)
    into v_roles
  from (
    select lower(coalesce(au.role, '')) as role_key
    from public.admin_users au
    where au.user_id = v_uid
      and coalesce(au.is_active, true) = true
      and coalesce(au.role, '') <> ''
    union
    select lower(coalesce(ur.role, r.key, r.name, '')) as role_key
    from public.user_roles ur
    left join public.roles r on r.id = ur.role_id
    where ur.user_id = v_uid
      and coalesce(ur.status, 'active') = 'active'
      and coalesce(ur.is_active, true) = true
      and coalesce(ur.role, r.key, r.name, '') <> ''
    union
    select lower(coalesce(cm.role_key, cm.membership_role::text, cm.role, '')) as role_key
    from public.company_memberships cm
    where cm.user_id = v_uid
      and coalesce(cm.status, 'active') = 'active'
      and coalesce(cm.is_active, true) = true
      and coalesce(cm.role_key, cm.membership_role::text, cm.role, '') <> ''
  ) r;

  return jsonb_build_object(
    'user_id', v_uid,
    'email', nullif(v_email, ''),
    'is_platform_admin', v_is_platform_admin,
    'company_ids', v_company_ids,
    'default_company_id', v_default_company_id,
    'roles', v_roles
  );
exception when undefined_table or undefined_column then
  return jsonb_build_object(
    'user_id', v_uid,
    'email', nullif(v_email, ''),
    'is_platform_admin', public.gridex_user_is_platform_admin(),
    'company_ids', '[]'::jsonb,
    'default_company_id', null,
    'roles', '[]'::jsonb,
    'warning', 'context_partially_available'
  );
end;
$$;

grant execute on function public.gridex_current_user_context() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2) Batch 1: RLS auth initplan rewrite.
-- -----------------------------------------------------------------------------
create or replace function public.gridex_rls_initplan_rewrite(p_expr text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v text := p_expr;
begin
  if v is null then
    return null;
  end if;

  -- Protect already-correct initplan calls from double wrapping.
  v := replace(v, '(select auth.uid())', '__GRIDEX_AUTH_UID_INITPLAN__');
  v := replace(v, '(SELECT auth.uid())', '__GRIDEX_AUTH_UID_INITPLAN__');
  v := replace(v, '(select auth.role())', '__GRIDEX_AUTH_ROLE_INITPLAN__');
  v := replace(v, '(SELECT auth.role())', '__GRIDEX_AUTH_ROLE_INITPLAN__');
  v := replace(v, '(select auth.jwt())', '__GRIDEX_AUTH_JWT_INITPLAN__');
  v := replace(v, '(SELECT auth.jwt())', '__GRIDEX_AUTH_JWT_INITPLAN__');
  v := replace(v, '(select public.gridex_user_is_platform_admin())', '__GRIDEX_PLATFORM_INITPLAN__');
  v := replace(v, '(SELECT public.gridex_user_is_platform_admin())', '__GRIDEX_PLATFORM_INITPLAN__');

  v := replace(v, 'auth.uid()', '(select auth.uid())');
  v := replace(v, 'auth.role()', '(select auth.role())');
  v := replace(v, 'auth.jwt()', '(select auth.jwt())');
  v := replace(v, 'public.gridex_user_is_platform_admin()', '(select public.gridex_user_is_platform_admin())');
  v := replace(v, 'gridex_user_is_platform_admin()', '(select public.gridex_user_is_platform_admin())');

  v := replace(v, '__GRIDEX_AUTH_UID_INITPLAN__', '(select auth.uid())');
  v := replace(v, '__GRIDEX_AUTH_ROLE_INITPLAN__', '(select auth.role())');
  v := replace(v, '__GRIDEX_AUTH_JWT_INITPLAN__', '(select auth.jwt())');
  v := replace(v, '__GRIDEX_PLATFORM_INITPLAN__', '(select public.gridex_user_is_platform_admin())');

  return v;
end;
$$;

create or replace function public.gridex_optimize_rls_auth_initplans()
returns table(table_name text, policy_name text, status text, old_using text, new_using text, old_check text, new_check text)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  p record;
  v_roles text;
  v_using text;
  v_check text;
  v_cmd text;
  v_permissive text;
  v_sql text;
begin
  for p in
    select *
    from pg_policies
    where schemaname = 'public'
      and (
        coalesce(qual, '') ilike '%auth.uid()%'
        or coalesce(qual, '') ilike '%auth.role()%'
        or coalesce(qual, '') ilike '%auth.jwt()%'
        or coalesce(qual, '') ilike '%gridex_user_is_platform_admin()%'
        or coalesce(with_check, '') ilike '%auth.uid()%'
        or coalesce(with_check, '') ilike '%auth.role()%'
        or coalesce(with_check, '') ilike '%auth.jwt()%'
        or coalesce(with_check, '') ilike '%gridex_user_is_platform_admin()%'
      )
  loop
    v_using := public.gridex_rls_initplan_rewrite(p.qual);
    v_check := public.gridex_rls_initplan_rewrite(p.with_check);

    if coalesce(v_using, '') = coalesce(p.qual, '') and coalesce(v_check, '') = coalesce(p.with_check, '') then
      table_name := p.tablename;
      policy_name := p.policyname;
      status := 'unchanged';
      old_using := p.qual;
      new_using := v_using;
      old_check := p.with_check;
      new_check := v_check;
      return next;
      continue;
    end if;

    select string_agg(format('%I', r::text), ', ' order by r::text)
      into v_roles
    from unnest(p.roles) as r;

    v_roles := coalesce(nullif(v_roles, ''), 'public');
    v_cmd := upper(p.cmd);
    -- ALTER POLICY preserves command, permissive/restrictive mode and roles.
    -- This is intentionally safer than drop/create because a failed rewrite cannot remove access.
    v_sql := format('alter policy %I on public.%I', p.policyname, p.tablename);

    if v_using is not null and v_cmd <> 'INSERT' then
      v_sql := v_sql || format(' using (%s)', v_using);
    end if;

    if v_check is not null and v_cmd <> 'SELECT' and v_cmd <> 'DELETE' then
      v_sql := v_sql || format(' with check (%s)', v_check);
    end if;

    begin
      execute v_sql;
      table_name := p.tablename;
      policy_name := p.policyname;
      status := 'rewritten';
      old_using := p.qual;
      new_using := v_using;
      old_check := p.with_check;
      new_check := v_check;
      return next;
    exception when others then
      raise notice 'RLS initplan rewrite skipped for %.%: %', p.tablename, p.policyname, sqlerrm;
      table_name := p.tablename;
      policy_name := p.policyname;
      status := 'skipped: ' || sqlerrm;
      old_using := p.qual;
      new_using := v_using;
      old_check := p.with_check;
      new_check := v_check;
      return next;
    end;
  end loop;
end;
$$;

create or replace view public.gridex_rls_policy_inventory_v
with (security_invoker = true)
as
select
  schemaname,
  tablename,
  count(*) as policy_count,
  count(*) filter (where cmd = 'SELECT') as select_policy_count,
  count(*) filter (where cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')) as write_policy_count,
  count(*) filter (where roles @> array['public']::name[]) as public_role_policy_count,
  count(*) filter (
    where coalesce(qual, '') ilike '%auth.%()%'
       or coalesce(with_check, '') ilike '%auth.%()%'
       or coalesce(qual, '') ilike '%gridex_user_is_platform_admin()%'
       or coalesce(with_check, '') ilike '%gridex_user_is_platform_admin()%'
  ) as possible_unoptimized_policy_count,
  array_agg(policyname order by policyname) as policy_names
from pg_policies
where schemaname = 'public'
group by schemaname, tablename;

create or replace view public.gridex_auth_rls_initplan_remaining_v
with (security_invoker = true)
as
select
  schemaname,
  tablename,
  policyname,
  cmd,
  roles,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and (
    coalesce(qual, '') ilike '%auth.uid()%'
    or coalesce(qual, '') ilike '%auth.role()%'
    or coalesce(qual, '') ilike '%auth.jwt()%'
    or coalesce(qual, '') ilike '%gridex_user_is_platform_admin()%'
    or coalesce(with_check, '') ilike '%auth.uid()%'
    or coalesce(with_check, '') ilike '%auth.role()%'
    or coalesce(with_check, '') ilike '%auth.jwt()%'
    or coalesce(with_check, '') ilike '%gridex_user_is_platform_admin()%'
  );

revoke all on public.gridex_rls_policy_inventory_v from anon;
revoke all on public.gridex_auth_rls_initplan_remaining_v from anon;
grant select on public.gridex_rls_policy_inventory_v to authenticated;
grant select on public.gridex_auth_rls_initplan_remaining_v to authenticated;

-- Execute policy rewrite now. It is idempotent; re-running leaves already-wrapped policies unchanged.
insert into public.gridex_performance_hardening_events(event_key, status, details)
select
  'batch_1_rls_auth_initplan_rewrite',
  case when count(*) filter (where status like 'skipped:%') > 0 then 'completed_with_skips' else 'completed' end,
  jsonb_build_object(
    'rewritten', count(*) filter (where status = 'rewritten'),
    'unchanged', count(*) filter (where status = 'unchanged'),
    'skipped', count(*) filter (where status like 'skipped:%')
  )
from public.gridex_optimize_rls_auth_initplans();

-- -----------------------------------------------------------------------------
-- 3) Batch 3: DB-side read models/RPCs for heavy pages.
--    These wrap already-existing read views and add a consolidated work queue.
-- -----------------------------------------------------------------------------
create or replace function public.gridex_admin_dashboard_summary(p_company_id uuid)
returns setof public.company_dashboard_summary_v
language sql
stable
security invoker
set search_path = public
as $$
  select *
  from public.company_dashboard_summary_v
  where company_id = p_company_id
$$;

grant execute on function public.gridex_admin_dashboard_summary(uuid) to authenticated, service_role;

create or replace function public.gridex_customer_intake_queue(p_company_id uuid, p_limit integer default 50)
returns setof public.company_customer_intake_queue_v
language sql
stable
security invoker
set search_path = public
as $$
  select *
  from public.company_customer_intake_queue_v
  where company_id = p_company_id
  order by created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 250))
$$;

grant execute on function public.gridex_customer_intake_queue(uuid, integer) to authenticated, service_role;

create or replace function public.gridex_customer_list_summary(p_company_id uuid, p_limit integer default 100)
returns setof public.company_customer_list_summary_v
language sql
stable
security invoker
set search_path = public
as $$
  select *
  from public.company_customer_list_summary_v
  where company_id = p_company_id
  order by latest_activity_at desc nulls last
  limit greatest(1, least(coalesce(p_limit, 100), 500))
$$;

grant execute on function public.gridex_customer_list_summary(uuid, integer) to authenticated, service_role;

create or replace view public.gridex_work_queue_v
with (security_invoker = true)
as
select
  cb.id,
  cb.company_id,
  cb.customer_id,
  'Blockerare'::text as source,
  coalesce(c.customer_number, cb.customer_id::text) as customer_number,
  coalesce(nullif(c.company_name, ''), nullif(c.full_name, ''), nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), c.email, 'Kund utan namn') as customer_label,
  coalesce(nullif(cb.title, ''), replace(coalesce(cb.blocker_type, 'blocker'), '_', ' ')) as title,
  coalesce(nullif(cb.description, ''), replace(coalesce(cb.blocker_type, 'blocker'), '_', ' ')) as description,
  coalesce(cb.status, 'open') as status,
  case when cb.severity = 'critical' then 'critical' when cb.severity = 'warning' then 'high' else 'normal' end as priority,
  cb.created_at,
  '/admin/customers/' || cb.customer_id::text as href,
  'Öppna kundkort'::text as action_label
from public.customer_blockers cb
join public.customers c on c.id = cb.customer_id and c.company_id = cb.company_id
where cb.status in ('open', 'pending_review', 'action_required')
  and coalesce(c.source, '') <> 'ediel_portal_test'
  and coalesce(c.status, '') not in ('archived','deleted','deleted_test_only','pending_deletion')
union all
select
  cir.id,
  cir.company_id,
  cir.customer_id,
  'Uppgiftsbegäran'::text as source,
  coalesce(c.customer_number, cir.customer_id::text) as customer_number,
  coalesce(nullif(c.company_name, ''), nullif(c.full_name, ''), nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), c.email, 'Kund utan namn') as customer_label,
  'Väntar på ' || case when cir.target_party_type = 'current_supplier' then 'nuvarande leverantör' when cir.target_party_type = 'grid_owner' then 'nätägare' else 'kund' end as title,
  coalesce(nullif(cir.blocker_reason, ''), nullif(cir.notes, ''), replace(coalesce(cir.request_type, 'uppgiftsbegäran'), '_', ' ')) as description,
  coalesce(cir.status, 'pending') as status,
  case when cir.status in ('missing_authorization', 'blocked', 'negative_aperak', 'route_missing') then 'high' else 'normal' end as priority,
  cir.created_at,
  '/admin/customers/' || cir.customer_id::text || '?tab=data-requests' as href,
  'Öppna uppgiftsbegäran'::text as action_label
from public.customer_info_requests cir
join public.customers c on c.id = cir.customer_id and c.company_id = cir.company_id
where cir.status in ('open', 'new', 'pending', 'pending_review', 'action_required', 'missing_authorization', 'blocked', 'route_missing', 'manual_review_required', 'failed', 'sent', 'waiting_for_z02', 'waiting_response')
  and coalesce(c.source, '') <> 'ediel_portal_test'
  and coalesce(c.status, '') not in ('archived','deleted','deleted_test_only','pending_deletion')
union all
select
  gor.id,
  gor.company_id,
  gor.customer_id,
  'Nätägare'::text as source,
  coalesce(c.customer_number, gor.customer_id::text) as customer_number,
  coalesce(nullif(c.company_name, ''), nullif(c.full_name, ''), nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), c.email, 'Kund utan namn') as customer_label,
  'Begäran till nätägare'::text as title,
  coalesce(nullif(gor.failure_reason, ''), nullif(gor.notes, ''), replace(coalesce(gor.request_scope, 'uppgiftsbegäran'), '_', ' ')) as description,
  coalesce(gor.status, 'pending') as status,
  case when gor.status = 'failed' then 'high' else 'normal' end as priority,
  gor.created_at,
  '/admin/customers/' || gor.customer_id::text || '?tab=data-requests' as href,
  'Öppna kundkort'::text as action_label
from public.grid_owner_data_requests gor
join public.customers c on c.id = gor.customer_id and c.company_id = gor.company_id
where gor.status in ('pending', 'sent', 'failed')
  and coalesce(c.source, '') <> 'ediel_portal_test'
  and coalesce(c.status, '') not in ('archived','deleted','deleted_test_only','pending_deletion')
union all
select
  cot.id,
  cot.company_id,
  cot.customer_id,
  'Ärende'::text as source,
  coalesce(c.customer_number, cot.customer_id::text) as customer_number,
  coalesce(nullif(c.company_name, ''), nullif(c.full_name, ''), nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), c.email, 'Kund utan namn') as customer_label,
  coalesce(nullif(cot.title, ''), replace(coalesce(cot.task_type, 'åtgärd'), '_', ' ')) as title,
  coalesce(nullif(cot.description, ''), replace(coalesce(cot.task_type, 'åtgärd'), '_', ' ')) as description,
  coalesce(cot.status, 'open') as status,
  case when cot.priority in ('critical', 'high', 'low') then cot.priority else 'normal' end as priority,
  cot.created_at,
  '/admin/customers/' || cot.customer_id::text as href,
  'Öppna kundkort'::text as action_label
from public.customer_operation_tasks cot
join public.customers c on c.id = cot.customer_id and c.company_id = cot.company_id
where cot.status in ('open', 'new', 'pending', 'action_required')
  and coalesce(c.source, '') <> 'ediel_portal_test'
  and coalesce(c.status, '') not in ('archived','deleted','deleted_test_only','pending_deletion')
union all
select
  ssr.id,
  ssr.company_id,
  ssr.customer_id,
  'Leverantörsbyte'::text as source,
  coalesce(c.customer_number, ssr.customer_id::text) as customer_number,
  coalesce(nullif(c.company_name, ''), nullif(c.full_name, ''), nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), c.email, 'Kund utan namn') as customer_label,
  'Leverantörsbyte behöver uppföljning'::text as title,
  replace(coalesce(ssr.request_type, 'supplier_switch'), '_', ' ') as description,
  coalesce(ssr.status, 'pending') as status,
  case when ssr.status in ('accepted', 'ready') then 'high' else 'normal' end as priority,
  ssr.created_at,
  '/admin/customers/' || ssr.customer_id::text || '?tab=supplier-switch' as href,
  'Öppna leverantörsbyte'::text as action_label
from public.supplier_switch_requests ssr
join public.customers c on c.id = ssr.customer_id and c.company_id = ssr.company_id
where ssr.status in ('draft', 'ready', 'queued', 'submitted', 'accepted', 'pending', 'open')
  and coalesce(c.source, '') <> 'ediel_portal_test'
  and coalesce(c.status, '') not in ('archived','deleted','deleted_test_only','pending_deletion');

revoke all on public.gridex_work_queue_v from anon;
grant select on public.gridex_work_queue_v to authenticated;

create or replace function public.gridex_get_work_queue(p_company_id uuid, p_limit integer default 200)
returns setof public.gridex_work_queue_v
language sql
stable
security invoker
set search_path = public
as $$
  select *
  from public.gridex_work_queue_v
  where p_company_id is null or company_id = p_company_id
  order by
    case priority when 'critical' then 4 when 'high' then 3 when 'normal' then 2 else 1 end desc,
    created_at desc nulls last
  limit greatest(1, least(coalesce(p_limit, 200), 500))
$$;

grant execute on function public.gridex_get_work_queue(uuid, integer) to authenticated, service_role;

create or replace function public.gridex_get_customer_card(p_customer_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'customer', to_jsonb(c),
    'sites', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.created_at desc)
      from public.customer_sites s
      where s.customer_id = c.id and s.company_id = c.company_id
    ), '[]'::jsonb),
    'metering_points', coalesce((
      select jsonb_agg(to_jsonb(mp) order by mp.created_at desc)
      from public.metering_points mp
      where mp.customer_id = c.id and mp.company_id = c.company_id
    ), '[]'::jsonb),
    'contracts', coalesce((
      select jsonb_agg(to_jsonb(cc) order by cc.created_at desc)
      from public.customer_contracts cc
      where cc.customer_id = c.id and cc.company_id = c.company_id
    ), '[]'::jsonb),
    'powers_of_attorney', coalesce((
      select jsonb_agg(to_jsonb(poa) order by poa.created_at desc)
      from public.powers_of_attorney poa
      where poa.customer_id = c.id and poa.company_id = c.company_id
    ), '[]'::jsonb),
    'switch_requests', coalesce((
      select jsonb_agg(to_jsonb(ssr) order by ssr.created_at desc)
      from public.supplier_switch_requests ssr
      where ssr.customer_id = c.id and ssr.company_id = c.company_id
    ), '[]'::jsonb),
    'communication_logs', coalesce((
      select jsonb_agg(to_jsonb(cl) order by cl.created_at desc)
      from (
        select *
        from public.communication_logs cl
        where cl.customer_id = c.id and cl.company_id = c.company_id
        order by cl.created_at desc
        limit 50
      ) cl
    ), '[]'::jsonb),
    'open_work_items', coalesce((
      select jsonb_agg(to_jsonb(wq) order by wq.created_at desc)
      from public.gridex_work_queue_v wq
      where wq.customer_id = c.id and wq.company_id = c.company_id
    ), '[]'::jsonb)
  )
  from public.customers c
  where c.id = p_customer_id
    and public.gridex_can_read_company(c.company_id)
  limit 1
$$;

grant execute on function public.gridex_get_customer_card(uuid) to authenticated, service_role;

insert into public.gridex_performance_hardening_events(event_key, status, details)
values (
  'batch_2_3_context_and_read_models',
  'completed',
  jsonb_build_object(
    'rbac_helpers', array['gridex_user_is_platform_admin', 'gridex_can_read_company', 'gridex_can_write_company', 'gridex_current_user_context'],
    'read_models', array['gridex_admin_dashboard_summary', 'gridex_customer_intake_queue', 'gridex_customer_list_summary', 'gridex_get_work_queue', 'gridex_get_customer_card']
  )
);
