-- Current Admin context: retain only existing role ALLOWs whose catalog entry
-- is active and which have no current global/selected-company explicit DENY.
-- The canonical actor oracle's DENY predicates are reused without its separate
-- operational-company gate, preserving paused/history reads and platform policy.
-- Forward-only; no grants, table changes or business writes.

begin;
set local lock_timeout = '10s';
set local statement_timeout = '120s';

-- Fail closed against an unknown source/signature; an exact replay is allowed.
-- CREATE OR REPLACE retains the existing OID, owner, ACL and dependencies.
do $guard$
declare
  target oid := to_regprocedure('public.canonical_authenticated_tenant_context_v1_scoped(uuid)');
begin
  if target is null or not exists(
    select 1 from pg_catalog.pg_proc p join pg_catalog.pg_language l on l.oid=p.prolang
    where p.oid=target and p.prokind='f' and l.lanname='plpgsql'
      and p.prorettype='jsonb'::regtype and p.pronargs=1
      and p.proargtypes::text=('uuid'::regtype::oid)::text
      and p.proargnames=array['p_selected_company_id']::text[]
      and p.pronargdefaults=1 and pg_get_expr(p.proargdefaults,0)='NULL::uuid'
      and p.provolatile='s' and p.prosecdef
      and not p.proisstrict and not p.proleakproof and p.proparallel='u'
      and p.procost=100 and p.prorows=0
      and p.proconfig=array['search_path=public, auth, pg_temp']::text[]
      and md5(p.prosrc) in ('b0dea96f47a97fd921850bcb8c39da89','20800ecdbc19c53dd48b5bd8f3376bc1')
  ) then
    raise exception 'admin_context_current_permission_source_unqualified' using errcode='55000';
  end if;
  -- The prior permission forward owns legacy column installation. Do not
  -- guess missing DENY storage or silently omit revocation in an older catalog.
  if exists(
    select 1 from (values
      ('public.permissions','id'),('public.permissions','key'),('public.permissions','is_active'),
      ('public.user_permissions','user_id'),('public.user_permissions','company_id'),
      ('public.user_permissions','permission_id'),('public.user_permissions','permission_key'),
      ('public.user_permissions','is_active'),('public.user_permissions','status'),('public.user_permissions','effect'),
      ('public.user_permission_overrides','user_id'),('public.user_permission_overrides','company_id'),
      ('public.user_permission_overrides','permission_key'),('public.user_permission_overrides','is_active'),
      ('public.user_permission_overrides','effect'),('public.user_permission_overrides','valid_from'),
      ('public.user_permission_overrides','valid_to')
    ) required(relation_name,column_name)
    where not exists(select 1 from pg_catalog.pg_attribute a
      where a.attrelid=to_regclass(required.relation_name) and a.attname=required.column_name
        and a.attnum>0 and not a.attisdropped)
  ) then
    raise exception 'admin_context_current_permission_dependency_unavailable' using errcode='55000';
  end if;
end
$guard$;

CREATE OR REPLACE FUNCTION public.canonical_authenticated_tenant_context_v1_scoped(p_selected_company_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'auth', 'pg_temp'
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_user_email text;
  v_platform boolean := false;
  v_profile_active boolean := false;
  v_selected_company_id uuid;
  v_memberships jsonb := '[]'::jsonb;
  v_roles jsonb := '[]'::jsonb;
  v_permissions jsonb := '[]'::jsonb;
  v_company jsonb;
  v_policy jsonb := '{}'::jsonb;
begin
  if v_user_id is null then
    return jsonb_build_object('authorized',false,'reason_code','authentication_required');
  end if;

  select exists(
    select 1 from auth.users u
    join public.user_profiles profile on profile.id=u.id
    where u.id=v_user_id and u.deleted_at is null
      and (u.banned_until is null or u.banned_until <= now())
      and u.email_confirmed_at is not null
      and profile.user_status='active'
  ) into v_profile_active;
  if not v_profile_active then
    return jsonb_build_object('authorized',false,'reason_code','identity_not_active');
  end if;

  v_platform := public.canonical_actor_is_platform_admin(v_user_id);
  select u.email into v_user_email from auth.users u where u.id=v_user_id;

  if v_platform then
    select coalesce(jsonb_agg(jsonb_build_object(
      'membership_id',null,
      'company_id',company.id,
      'company_name',company.name,
      'company_slug',company.slug,
      'org_number',company.org_number,
      'membership_role','platform_admin',
      'role_key','platform_admin',
      'status',company.status
    ) order by company.name),'[]'::jsonb)
    into v_memberships
    from public.companies company
    where company.status <> 'deleted_test_only';

    if p_selected_company_id is not null and exists(
      select 1 from public.companies where id=p_selected_company_id and status <> 'deleted_test_only'
    ) then
      v_selected_company_id := p_selected_company_id;
    end if;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
      'membership_id',membership.id,
      'company_id',company.id,
      'company_name',company.name,
      'company_slug',company.slug,
      'org_number',company.org_number,
      'membership_role',membership.membership_role,
      'role_key',role.key,
      'status',company.status
    ) order by (membership.membership_role='owner') desc, company.name),'[]'::jsonb)
    into v_memberships
    from public.company_memberships membership
    join public.companies company on company.id=membership.company_id
    join public.user_roles user_role
      on user_role.user_id=membership.user_id
     and user_role.company_id=membership.company_id
     and coalesce(user_role.status,'active')='active'
     and coalesce(user_role.is_active,true)
    join public.roles role on role.id=user_role.role_id and coalesce(role.is_active,true)
    where membership.user_id=v_user_id
      and membership.status='active'
      and coalesce(membership.is_active,true);

    select company_id into v_selected_company_id
    from public.company_memberships membership
    where membership.user_id=v_user_id
      and membership.status='active'
      and coalesce(membership.is_active,true)
      and (p_selected_company_id is null or membership.company_id=p_selected_company_id)
      and exists(
        select 1 from public.user_roles user_role
        where user_role.user_id=membership.user_id
          and user_role.company_id=membership.company_id
          and coalesce(user_role.status,'active')='active'
          and coalesce(user_role.is_active,true)
      )
    order by (membership.company_id=p_selected_company_id) desc,
             (membership.membership_role='owner') desc,
             membership.created_at
    limit 1;
  end if;

  select coalesce(jsonb_agg(distinct role.key),'[]'::jsonb)
  into v_roles
  from public.user_roles user_role
  join public.roles role on role.id=user_role.role_id and coalesce(role.is_active,true)
  where user_role.user_id=v_user_id
    and coalesce(user_role.status,'active')='active'
    and coalesce(user_role.is_active,true)
    and (user_role.company_id is null or user_role.company_id=v_selected_company_id);

  select coalesce(jsonb_agg(distinct permission.key),'[]'::jsonb)
  into v_permissions
  from public.user_roles user_role
  join public.roles role on role.id=user_role.role_id and coalesce(role.is_active,true)
  join public.role_permissions role_permission on role_permission.role_id=role.id
  join public.permissions permission on permission.id=role_permission.permission_id
  where user_role.user_id=v_user_id
    and coalesce(user_role.status,'active')='active'
    and coalesce(user_role.is_active,true)
    and (user_role.company_id is null or user_role.company_id=v_selected_company_id)
    and coalesce(role_permission.effect,'allow')='allow'
    -- Catalog and current DENY precedence match the canonical actor oracle.
    -- Keep this list's original grants and historical/lifecycle semantics;
    -- the operational actor oracle itself is not a history-read list filter.
    and permission.is_active
    and not exists(
      select 1 from public.user_permissions d left join public.permissions p on p.id=d.permission_id
      where d.user_id=v_user_id and (d.company_id is null or d.company_id=v_selected_company_id)
        and d.is_active and d.status='active' and d.effect='deny'
        and coalesce(nullif(d.permission_key,''),p.key)=permission.key
    )
    and not exists(
      select 1 from public.user_permission_overrides d
      where d.user_id=v_user_id and (d.company_id is null or d.company_id=v_selected_company_id)
        and d.is_active and d.effect='deny' and d.permission_key=permission.key
        and (d.valid_from is null or d.valid_from<=clock_timestamp())
        and (d.valid_to is null or clock_timestamp()<d.valid_to)
    );

  if v_selected_company_id is not null then
    select jsonb_build_object(
      'id',company.id,
      'name',company.name,
      'slug',company.slug,
      'org_number',company.org_number,
      'status',company.status,
      'lifecycle_status',company.lifecycle_status,
      'lifecycle_state_version',company.lifecycle_state_version
    ) into v_company
    from public.companies company where company.id=v_selected_company_id;

    select coalesce(jsonb_object_agg(operation.operation, to_jsonb(decision)),'{}'::jsonb)
    into v_policy
    from unnest(array[
      'tenant.provisioning.execute','email.send','webhook.deliver',
      'customer_automation.execute','facility_lookup.execute',
      'contract_channel.sell','api_client.execute'
    ]::text[]) operation(operation)
    cross join lateral public.canonical_tenant_operation_decision(
      v_selected_company_id, operation.operation
    ) decision;
  end if;

  return jsonb_build_object(
    'authorized',true,
    'user_id',v_user_id,
    'user_email',v_user_email,
    'is_platform_admin',v_platform,
    'selected_company_id',v_selected_company_id,
    'memberships',v_memberships,
    'roles',v_roles,
    'permissions',v_permissions,
    'company',v_company,
    'operation_policy',v_policy,
    'access_invariant_ok',v_platform or v_selected_company_id is not null
  );
end
$$;

commit;
