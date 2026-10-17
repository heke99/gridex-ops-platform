-- Close the Admin API/context ABI gap in the clean migration prefix.
-- Only the private scoped context is replaced: exact already-deployed d205 body,
-- current catalog/DENY projections and wall-clock identity checks. The public
-- wrapper, grants, owner, tables and earlier migrations remain unchanged.
-- Body donor: d899ac6b36d754aa784333ed4da07702e47619e0, scoped-context entry only.
-- Atomic forward; known 208/STABLE predecessor or exact d205/VOLATILE replay.
do $migration$
declare
  target oid := to_regprocedure('public.canonical_authenticated_tenant_context_v1_scoped(uuid)');
  wrapper oid := to_regprocedure('public.canonical_authenticated_tenant_context(uuid)');
  before_private jsonb; after_private jsonb;
  before_wrapper jsonb; after_wrapper jsonb;
  before_dependencies jsonb; after_dependencies jsonb;
  source_md5 text;
  replacement constant text := $definition$
CREATE OR REPLACE FUNCTION public.canonical_authenticated_tenant_context_v1_scoped(p_selected_company_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER
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
  v_active_permission_keys jsonb := '[]'::jsonb;
  v_denied_permissions jsonb := '[]'::jsonb;
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
      and (u.banned_until is null or u.banned_until <= clock_timestamp())
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

  -- Platform authority remains implicit; explicit current DENY and catalog
  -- availability are projected separately for actual API requirement evaluation.
  select coalesce(jsonb_agg(permission.key order by permission.key),'[]'::jsonb)
  into v_active_permission_keys from public.permissions permission where permission.is_active;
  select coalesce(jsonb_agg(denied.permission_key order by denied.permission_key),'[]'::jsonb)
  into v_denied_permissions from (
    select coalesce(nullif(d.permission_key,''),p.key) as permission_key
    from public.user_permissions d left join public.permissions p on p.id=d.permission_id
    where d.user_id=v_user_id and (d.company_id is null or d.company_id=v_selected_company_id)
      and d.is_active and d.status='active' and d.effect='deny'
    union
    select d.permission_key from public.user_permission_overrides d
    where d.user_id=v_user_id and (d.company_id is null or d.company_id=v_selected_company_id)
      and d.is_active and d.effect='deny'
      and (d.valid_from is null or d.valid_from<=clock_timestamp())
      and (d.valid_to is null or clock_timestamp()<d.valid_to)
  ) denied where denied.permission_key is not null;

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
    'active_permission_keys',v_active_permission_keys,
    'denied_permissions',v_denied_permissions,
    'company',v_company,
    'operation_policy',v_policy,
    'access_invariant_ok',v_platform or v_selected_company_id is not null
  );
end
$$;
$definition$;
begin
  perform set_config('lock_timeout','10s',true);
  perform set_config('statement_timeout','120s',true);
  if target is null or not exists (
    select 1 from pg_catalog.pg_proc p join pg_catalog.pg_language l on l.oid=p.prolang
    where p.oid=target and p.prokind='f' and l.lanname='plpgsql'
      and p.proowner='postgres'::regrole and p.proacl=array['postgres=X/postgres']::aclitem[]
      and p.prorettype='jsonb'::regtype and p.pronargs=1 and p.provariadic=0
      and p.proargtypes::text=('uuid'::regtype::oid)::text
      and p.proargnames=array['p_selected_company_id']::text[]
      and p.proallargtypes is null and p.proargmodes is null
      and p.pronargdefaults=1 and pg_get_expr(p.proargdefaults,0)='NULL::uuid'
      and p.prosecdef and not p.proisstrict and not p.proleakproof and p.proparallel='u'
      and p.procost=100 and p.prorows=0 and p.prosupport=0 and p.probin is null
      and p.proconfig=array['search_path=public, auth, pg_temp']::text[]
      and ((md5(p.prosrc)='20800ecdbc19c53dd48b5bd8f3376bc1' and p.provolatile='s')
        or (md5(p.prosrc)='d205c4e8ba1989b27b4df6b1b76af631' and p.provolatile='v'))
  ) then
    raise exception 'admin_api_context_projection_source_unqualified' using errcode='55000';
  end if;
  -- Both immutable clean-prefix and read-qualified live wrapper bodies delegate
  -- to this same private resolver. Never replace or infer a different wrapper.
  if wrapper is null or not exists (
    select 1 from pg_catalog.pg_proc p join pg_catalog.pg_language l on l.oid=p.prolang
    where p.oid=wrapper and p.prokind='f' and l.lanname='plpgsql'
      and p.proowner='postgres'::regrole and p.prorettype='jsonb'::regtype
      and p.pronargs=1 and p.provariadic=0
      and p.proargtypes::text=('uuid'::regtype::oid)::text
      and p.proargnames=array['p_selected_company_id']::text[]
      and p.proallargtypes is null and p.proargmodes is null
      and p.pronargdefaults=1 and pg_get_expr(p.proargdefaults,0)='NULL::uuid'
      and p.provolatile='s' and p.prosecdef and not p.proisstrict and not p.proleakproof
      and p.proparallel='u' and p.procost=100 and p.prorows=0
      and p.proconfig=array['search_path=public, auth, pg_temp']::text[]
      and md5(p.prosrc) in ('1f42d1310db6b6faf5b81775c71d8720','a41e40cb3385fbaac24675d2a0d264f6')
      and not exists (select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        where a.privilege_type<>'EXECUTE' or a.is_grantable
          or a.grantor<>p.proowner or a.grantee not in ('postgres'::regrole,'authenticated'::regrole,'service_role'::regrole))
      and has_function_privilege('authenticated',p.oid,'EXECUTE')
      and has_function_privilege('service_role',p.oid,'EXECUTE')
      and not has_function_privilege('anon',p.oid,'EXECUTE')
  ) then
    raise exception 'admin_api_context_projection_wrapper_unqualified' using errcode='55000';
  end if;
  -- Qualify every directly referenced column, including the negative-permission
  -- sources. Missing or mistyped storage never means ALLOW.
  if exists (
    select 1 from (values
      ('auth.users','id','uuid'),('auth.users','email','text'),
      ('auth.users','deleted_at','timestamptz'),('auth.users','banned_until','timestamptz'),
      ('auth.users','email_confirmed_at','timestamptz'),
      ('public.user_profiles','id','uuid'),('public.user_profiles','user_status','text'),
      ('public.companies','id','uuid'),('public.companies','name','text'),
      ('public.companies','slug','text'),('public.companies','org_number','text'),
      ('public.companies','status','text'),('public.companies','lifecycle_status','text'),
      ('public.companies','lifecycle_state_version','bigint'),
      ('public.company_memberships','id','uuid'),('public.company_memberships','user_id','uuid'),
      ('public.company_memberships','company_id','uuid'),('public.company_memberships','membership_role','text'),
      ('public.company_memberships','status','text'),('public.company_memberships','is_active','boolean'),
      ('public.company_memberships','created_at','timestamptz'),
      ('public.roles','id','uuid'),('public.roles','key','text'),('public.roles','is_active','boolean'),
      ('public.user_roles','user_id','uuid'),('public.user_roles','company_id','uuid'),
      ('public.user_roles','role_id','uuid'),('public.user_roles','status','text'),('public.user_roles','is_active','boolean'),
      ('public.role_permissions','role_id','uuid'),('public.role_permissions','permission_id','uuid'),
      ('public.role_permissions','effect','text'),('public.permissions','id','uuid'),
      ('public.permissions','key','text'),('public.permissions','is_active','boolean'),
      ('public.user_permissions','user_id','uuid'),('public.user_permissions','company_id','uuid'),
      ('public.user_permissions','permission_id','uuid'),('public.user_permissions','permission_key','text'),
      ('public.user_permissions','is_active','boolean'),('public.user_permissions','status','text'),
      ('public.user_permissions','effect','text'),
      ('public.user_permission_overrides','user_id','uuid'),('public.user_permission_overrides','company_id','uuid'),
      ('public.user_permission_overrides','permission_key','text'),('public.user_permission_overrides','is_active','boolean'),
      ('public.user_permission_overrides','effect','text'),('public.user_permission_overrides','valid_from','timestamptz'),
      ('public.user_permission_overrides','valid_to','timestamptz')
    ) required(relation_name,column_name,type_name)
    where not exists (select 1 from pg_catalog.pg_attribute a
      where a.attrelid=to_regclass(required.relation_name) and a.attname=required.column_name
        and a.attnum>0 and not a.attisdropped
        and (a.atttypid=to_regtype(required.type_name)
          -- GoTrue uses varchar(255); finite SQL models may use text. Both
          -- assign to v_user_email text without altering the context policy.
          or (required.relation_name='auth.users' and required.column_name='email'
            and a.atttypid='character varying'::regtype)))
  ) or not exists (select 1 from pg_catalog.pg_proc p where p.oid=to_regprocedure('auth.uid()') and p.prorettype='uuid'::regtype)
    or not exists (select 1 from pg_catalog.pg_proc p where p.oid=to_regprocedure('public.canonical_actor_is_platform_admin(uuid)') and p.prorettype='boolean'::regtype)
    or not exists (select 1 from pg_catalog.pg_proc p where p.oid=to_regprocedure('public.canonical_tenant_operation_decision(uuid,text)') and p.prorettype='record'::regtype)
  then
    raise exception 'admin_api_context_projection_dependency_unavailable' using errcode='55000';
  end if;

  select to_jsonb(p)-'prosrc'-'provolatile' || jsonb_build_object('comment',obj_description(p.oid,'pg_proc')),
    md5(p.prosrc) into before_private,source_md5 from pg_catalog.pg_proc p where p.oid=target;
  select to_jsonb(p) || jsonb_build_object('comment',obj_description(p.oid,'pg_proc'))
    into before_wrapper from pg_catalog.pg_proc p where p.oid=wrapper;
  select coalesce(jsonb_agg(to_jsonb(d) order by d.objid,d.refclassid,d.refobjid,d.refobjsubid,d.deptype),'[]'::jsonb)
    into before_dependencies from pg_catalog.pg_depend d
    where d.classid='pg_proc'::regclass and d.objid in (target,wrapper);

  if source_md5='20800ecdbc19c53dd48b5bd8f3376bc1' then execute replacement; end if;

  select to_jsonb(p)-'prosrc'-'provolatile' || jsonb_build_object('comment',obj_description(p.oid,'pg_proc'))
    into after_private from pg_catalog.pg_proc p where p.oid=target;
  select to_jsonb(p) || jsonb_build_object('comment',obj_description(p.oid,'pg_proc'))
    into after_wrapper from pg_catalog.pg_proc p where p.oid=wrapper;
  select coalesce(jsonb_agg(to_jsonb(d) order by d.objid,d.refclassid,d.refobjid,d.refobjsubid,d.deptype),'[]'::jsonb)
    into after_dependencies from pg_catalog.pg_depend d
    where d.classid='pg_proc'::regclass and d.objid in (target,wrapper);
  if before_private is distinct from after_private
    or before_wrapper is distinct from after_wrapper
    or before_dependencies is distinct from after_dependencies
    or not exists (select 1 from pg_catalog.pg_proc p where p.oid=target
      and md5(p.prosrc)='d205c4e8ba1989b27b4df6b1b76af631' and p.provolatile='v')
  then
    raise exception 'admin_api_context_projection_postcondition_failed' using errcode='55000';
  end if;
end
$migration$;
