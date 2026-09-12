-- Task 11a; genuine CLI 2.101.0 scaffold identity from receipt job 103504560679.
-- Forward candidate only; not yet registered in the migration replay inputs.
-- Ordinary E = (active role allows UNION filtered direct allows UNION applicable
-- override allows) EXCEPT applicable override denies, inside canonical identity,
-- membership AND active role-definition admission. Catalog activity is unchanged.
-- Shared ordinary permissions union each company's independently evaluated E.
-- Authoritative platform admission/bypass and the canonical context contract stay
-- separate. No data backfill, global actor-predicate rewrite or role-name shortcut.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
create schema if not exists gridex_private;
revoke all on schema gridex_private from public, anon;
grant usage on schema gridex_private to authenticated, service_role;

create or replace function gridex_private.effective_company_permissions(
  p_user_id uuid,
  p_company_id uuid,
  p_evaluated_at timestamptz
)
returns text[]
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $function$
  with eligible as (
    select 1
    where p_company_id is not null
      and exists (
        select 1 from auth.users u
        join public.user_profiles profile on profile.id=u.id
        where u.id=p_user_id and u.deleted_at is null
          and (u.banned_until is null or u.banned_until <= p_evaluated_at)
          and u.email_confirmed_at is not null
          and profile.user_status='active'
      )
      and exists (
        select 1 from public.company_memberships membership
        where membership.user_id=p_user_id and membership.company_id=p_company_id
          and membership.status='active' and coalesce(membership.is_active,true)
      )
      and exists (
        select 1 from public.user_roles ur
        join public.roles r on r.id=ur.role_id and coalesce(r.is_active,true)
        where ur.user_id=p_user_id and ur.company_id=p_company_id
          and coalesce(ur.status,'active')='active' and coalesce(ur.is_active,true)
      )
  ), applicable_overrides as (
    select o.permission_key, o.effect
    from public.user_permission_overrides o
    where o.user_id=p_user_id
      and (o.company_id is null or o.company_id=p_company_id)
      and coalesce(o.is_active,true)
      and (o.valid_from is null or o.valid_from <= p_evaluated_at)
      and (o.valid_to is null or o.valid_to >= p_evaluated_at)
  ), grants as (
    select coalesce(p.key,p.name) as permission_key
    from public.user_roles ur
    join public.roles r on r.id=ur.role_id and coalesce(r.is_active,true)
    join public.role_permissions rp on rp.role_id=r.id and coalesce(rp.effect,'allow')='allow'
    join public.permissions p on p.id=rp.permission_id
    where ur.user_id=p_user_id and ur.company_id=p_company_id
      and coalesce(ur.status,'active')='active' and coalesce(ur.is_active,true)
    union
    select coalesce(p.key,p.name)
    from public.user_permissions d
    join public.permissions p on p.id=d.permission_id
    where d.user_id=p_user_id and (d.company_id is null or d.company_id=p_company_id)
      and coalesce(d.status,'active')='active' and coalesce(d.is_active,true)
      and coalesce(d.effect,'allow')='allow'
    union
    select o.permission_key
    from applicable_overrides o
    join public.permissions p on p.key=o.permission_key
    where o.effect='allow'
  )
  select coalesce(array_agg(distinct g.permission_key order by g.permission_key),'{}'::text[])
  from grants g
  where exists (select 1 from eligible)
    and g.permission_key is not null
    and not exists (
      select 1 from applicable_overrides o
      where o.permission_key=g.permission_key and o.effect='deny'
    );
$function$;
revoke all on function gridex_private.effective_company_permissions(uuid,uuid,timestamptz)
  from public, anon, authenticated, service_role;

create or replace function gridex_private.platform_permissions(
  p_user_id uuid,
  p_evaluated_at timestamptz
)
returns text[]
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $function$
  with original_platform_sources(permission_keys) as (
  with role_based as (
    select distinct coalesce(p.key, p.name) as permission_name
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id and coalesce(r.is_active, true)
    join public.role_permissions rp on rp.role_id = r.id and coalesce(rp.effect, 'allow') = 'allow'
    join public.permissions p on p.id = rp.permission_id
    where ur.user_id = p_user_id
      and coalesce(ur.is_active, true)
      and coalesce(ur.status, 'active') = 'active'
      and (
        (
          ur.company_id is null
          and public.gridex_normalize_platform_role(coalesce(r.key, r.name))
            in ('super_admin', 'platform_admin')
        )
        or exists (
          select 1 from public.company_memberships m
          where m.user_id = p_user_id
            and m.company_id = ur.company_id
            and m.status = 'active'
            and coalesce(m.is_active, true)
        )
      )
      and coalesce(p.key, p.name) is not null
  ),
  direct_permissions as (
    select distinct coalesce(p.key, p.name) as permission_name
    from public.user_permissions up
    join public.permissions p on p.id = up.permission_id
    where up.user_id = p_user_id and coalesce(p.key, p.name) is not null
  ),
  explicit_platform_admin_fallback as (
    select 'admin.access'::text as permission_name
    where exists (
      select 1 from public.admin_users au
      where au.user_id = p_user_id
        and coalesce(au.is_active, true)
        and public.gridex_normalize_platform_role(au.role) in ('super_admin', 'platform_admin')
    )
  )
  select coalesce(array_agg(distinct permission_name order by permission_name), '{}'::text[])
  from (
    select permission_name from role_based
    union select permission_name from direct_permissions
    union select permission_name from explicit_platform_admin_fallback
  ) q
  where permission_name is not null
  ), applicable_overrides as (
    select o.permission_key,o.effect
    from public.user_permission_overrides o
    where o.user_id=p_user_id and o.company_id is null
      and coalesce(o.is_active,true)
      and (o.valid_from is null or o.valid_from <= p_evaluated_at)
      and (o.valid_to is null or o.valid_to >= p_evaluated_at)
  ), grants as (
    select unnest(permission_keys) as permission_key from original_platform_sources
    union
    select o.permission_key from applicable_overrides o
    join public.permissions p on p.key=o.permission_key
    where o.effect='allow'
  )
  select coalesce(array_agg(distinct g.permission_key order by g.permission_key),'{}'::text[])
  from grants g
  where public.canonical_actor_is_platform_admin(p_user_id)
    and g.permission_key is not null
    and not exists (
      select 1 from applicable_overrides o
      where o.permission_key=g.permission_key and o.effect='deny'
    );
$function$;
revoke all on function gridex_private.platform_permissions(uuid,timestamptz)
  from public, anon, authenticated, service_role;

create or replace function public.gridex_get_user_permissions_in_company(
  p_user_id uuid,
  p_company_id uuid
)
returns text[]
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $function$
  select case when public.canonical_actor_is_platform_admin(p_user_id)
    then gridex_private.platform_permissions(p_user_id,now())
    else gridex_private.effective_company_permissions(p_user_id,p_company_id,now())
  end;
$function$;

create or replace function public.gridex_get_user_permissions(p_user_id uuid)
returns text[]
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $function$
  select case when public.canonical_actor_is_platform_admin(p_user_id)
    then gridex_private.platform_permissions(p_user_id,now())
    else (
      select coalesce(array_agg(distinct permission_key order by permission_key),'{}'::text[])
      from public.company_memberships membership
      cross join lateral unnest(gridex_private.effective_company_permissions(
        p_user_id,membership.company_id,now()
      )) permission_key
      where membership.user_id=p_user_id
        and membership.status='active' and coalesce(membership.is_active,true)
    )
  end;
$function$;
revoke execute on function public.gridex_get_user_permissions(uuid) from public, anon, authenticated;
revoke execute on function public.gridex_get_user_permissions_in_company(uuid,uuid) from public, anon, authenticated;

create or replace function public.canonical_authenticated_tenant_context_v1_scoped(
  p_selected_company_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $function$
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

  if v_platform then
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
    and coalesce(role_permission.effect,'allow')='allow';
  else
    v_permissions := to_jsonb(gridex_private.effective_company_permissions(
      v_user_id,v_selected_company_id,now()
    ));
  end if;

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
$function$;
revoke all on function public.canonical_authenticated_tenant_context_v1_scoped(uuid)
  from public, anon, authenticated, service_role;

create or replace function gridex_private.customer_document_path_allows(
  p_object_name text,
  p_access text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, storage, auth, gridex_private, pg_temp
as $function$
declare
  v_parts text[];
  v_company_id uuid;
  v_customer_id uuid;
  v_site_id uuid;
  v_scope text;
  v_document_type text;
  v_file_name text;
  v_has_permission boolean;
begin
  if p_object_name is null
     or p_access not in ('read', 'write')
     or p_object_name <> btrim(p_object_name, '/')
     or p_object_name like '%//%'
  then
    return false;
  end if;

  v_parts := string_to_array(p_object_name, '/');

  if coalesce(array_length(v_parts, 1), 0) <> 7
     or v_parts[1] <> 'companies'
     or v_parts[3] <> 'customers'
  then
    return false;
  end if;

  if v_parts[2] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or v_parts[4] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    return false;
  end if;

  v_company_id := v_parts[2]::uuid;
  v_customer_id := v_parts[4]::uuid;
  v_scope := v_parts[5];
  v_document_type := v_parts[6];
  v_file_name := v_parts[7];

  if v_document_type not in (
    'power_of_attorney',
    'complete_agreement',
    'grid_invoice_suggested'
  ) then
    return false;
  end if;

  if v_file_name in ('', '.', '..')
     or char_length(v_file_name) > 255
     or v_file_name !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  then
    return false;
  end if;

  if not exists (
    select 1
    from public.customers c
    where c.id = v_customer_id
      and c.company_id = v_company_id
  ) then
    return false;
  end if;

  if v_scope = 'customer' then
    null;
  elsif v_scope ~* '^site-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_site_id := substring(v_scope from 6)::uuid;

    if not exists (
      select 1
      from public.customer_sites cs
      where cs.id = v_site_id
        and cs.customer_id = v_customer_id
        and cs.company_id = v_company_id
    ) then
      return false;
    end if;
  else
    return false;
  end if;

  if p_access = 'read' then
    v_has_permission :=
      public.gridex_actor_has_company_permission(
        auth.uid(),
        v_company_id,
        'masterdata.read'
      )
      or public.gridex_actor_has_company_permission(
        auth.uid(),
        v_company_id,
        'switching.read'
      );
  else
    v_has_permission :=
      public.gridex_actor_has_company_permission(
        auth.uid(),
        v_company_id,
        'masterdata.write'
      )
      or public.gridex_actor_has_company_permission(
        auth.uid(),
        v_company_id,
        'switching.write'
      );
  end if;

  return coalesce(v_has_permission, false)
    and case p_access
      when 'read' then public.gridex_can_read_company(v_company_id)
      when 'write' then public.gridex_can_write_company(v_company_id)
      else false
    end;
exception
  when others then
    return false;
end;
$function$;
revoke all on function gridex_private.customer_document_path_allows(text,text) from public, anon;
grant execute on function gridex_private.customer_document_path_allows(text,text) to authenticated, service_role;

-- CREATE OR REPLACE preserves prior grants. These arbitrary-user internals are
-- owner-private even if a prior installation granted a custom role execution.
-- Keep the separately granted authenticated Storage policy helper unchanged.
do $private_acl$
declare
  signature regprocedure;
  target record;
begin
  foreach signature in array array[
    'gridex_private.effective_company_permissions(uuid,uuid,timestamptz)'::regprocedure,
    'gridex_private.platform_permissions(uuid,timestamptz)'::regprocedure,
    'public.gridex_get_user_permissions(uuid)'::regprocedure,
    'public.gridex_get_user_permissions_in_company(uuid,uuid)'::regprocedure,
    'public.canonical_authenticated_tenant_context_v1_scoped(uuid)'::regprocedure
  ] loop
    for target in
      select distinct acl.grantee
      from pg_proc proc
      cross join lateral aclexplode(coalesce(proc.proacl,acldefault('f',proc.proowner))) acl
      where proc.oid=signature and acl.grantee <> proc.proowner
    loop
      execute format('revoke all on function %s from %s cascade',
        signature,
        case when target.grantee=0 then 'public'
             else quote_ident(pg_get_userbyid(target.grantee)) end);
    end loop;
  end loop;
end
$private_acl$;

commit;
