-- Manual Batch 2 setup for current RBAC test tenants.
-- HOTFIX v2: onboarding-safe.
--
-- Why this version exists:
-- Afshin's provided user_id is not present in the users table referenced by public.user_roles yet.
-- Therefore this setup must NOT insert into user_roles until the auth/public users row exists.
-- It creates/keeps Nibela AB as an onboarding tenant and creates a pending invitation.
-- If the user exists later, re-running this same SQL will activate the company membership and user_roles row.

-- Div3rsa AB: keep as active tenant.
update public.companies
set status = 'active'
where id = '1c790a8e-5a3f-4bf2-a01c-3b67fc4327fa'::uuid;

-- Nibela AB: onboarding tenant.
insert into public.companies (id, name, status)
values ('aa121d1e-990b-40ed-8399-4442539fec62'::uuid, 'Nibela AB', 'onboarding')
on conflict (id) do update
set name = excluded.name,
    status = 'onboarding';

-- Type-aware Nibela invitation/membership seed.
-- This block is safe whether company_memberships.membership_role is text or an enum.
do $$
declare
  v_company_id uuid := 'aa121d1e-990b-40ed-8399-4442539fec62'::uuid;
  v_user_id uuid := '08bbafb2-dac7-44e1-ac0b-a72223a4975c'::uuid;
  v_email text := 'afshin.hemmati@nibela.se';
  v_superadmin_user_id uuid := 'f1fba10a-242d-455c-9ad7-18d7e2ffd2fc'::uuid;
  v_role_id uuid;
  v_user_ref_table regclass;
  v_user_exists boolean := false;
  v_sql text;

  v_membership_role_oid oid;
  v_membership_role_type_sql text := 'text';
  v_membership_role_value text := 'company_admin';
  v_membership_role_is_enum boolean := false;

  v_invitation_role_oid oid;
  v_invitation_role_type_sql text := 'text';
  v_invitation_role_value text := 'company_admin';
  v_invitation_role_is_enum boolean := false;
begin
  select id
    into v_role_id
  from public.roles
  where coalesce(key, name) = 'company_admin'
     or name = 'company_admin'
     or key = 'admin'
     or name = 'admin'
  order by case when coalesce(key, name) = 'company_admin' then 0 else 1 end
  limit 1;

  if v_role_id is null then
    raise exception 'company_admin role is missing. Run 20260525_debug_batch_2_rbac_tenant_alignment.sql first.';
  end if;

  -- Detect which users table public.user_roles.user_id actually references, then check it.
  select con.confrelid::regclass
    into v_user_ref_table
  from pg_constraint con
  join pg_class src on src.oid = con.conrelid
  join pg_namespace srcn on srcn.oid = src.relnamespace
  join pg_attribute a on a.attrelid = con.conrelid and a.attnum = any(con.conkey)
  where con.contype = 'f'
    and srcn.nspname = 'public'
    and src.relname = 'user_roles'
    and a.attname = 'user_id'
  limit 1;

  if v_user_ref_table is not null then
    begin
      execute format('select exists (select 1 from %s where id = $1)', v_user_ref_table)
        into v_user_exists
        using v_user_id;
    exception when undefined_table or undefined_column or insufficient_privilege then
      v_user_exists := false;
    end;
  elsif to_regclass('auth.users') is not null then
    begin
      execute 'select exists (select 1 from auth.users where id = $1)'
        into v_user_exists
        using v_user_id;
    exception when undefined_table or undefined_column or insufficient_privilege then
      v_user_exists := false;
    end;
  end if;

  -- Resolve company_memberships.membership_role type/value.
  select a.atttypid,
         quote_ident(n.nspname) || '.' || quote_ident(t.typname),
         t.typtype = 'e'
    into v_membership_role_oid, v_membership_role_type_sql, v_membership_role_is_enum
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace cn on cn.oid = c.relnamespace
  join pg_type t on t.oid = a.atttypid
  join pg_namespace n on n.oid = t.typnamespace
  where cn.nspname = 'public'
    and c.relname = 'company_memberships'
    and a.attname = 'membership_role'
    and not a.attisdropped;

  if v_membership_role_is_enum then
    select coalesce(
      (select enumlabel from pg_enum where enumtypid = v_membership_role_oid and enumlabel = 'company_admin' limit 1),
      (select enumlabel from pg_enum where enumtypid = v_membership_role_oid and enumlabel = 'admin' limit 1),
      (select enumlabel from pg_enum where enumtypid = v_membership_role_oid and enumlabel = 'owner' limit 1),
      (select enumlabel from pg_enum where enumtypid = v_membership_role_oid and enumlabel = 'member' limit 1),
      (select enumlabel from pg_enum where enumtypid = v_membership_role_oid order by enumsortorder limit 1)
    ) into v_membership_role_value;
  else
    v_membership_role_type_sql := 'text';
    v_membership_role_value := 'company_admin';
  end if;

  -- Resolve company_invitations.membership_role type/value.
  select a.atttypid,
         quote_ident(n.nspname) || '.' || quote_ident(t.typname),
         t.typtype = 'e'
    into v_invitation_role_oid, v_invitation_role_type_sql, v_invitation_role_is_enum
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace cn on cn.oid = c.relnamespace
  join pg_type t on t.oid = a.atttypid
  join pg_namespace n on n.oid = t.typnamespace
  where cn.nspname = 'public'
    and c.relname = 'company_invitations'
    and a.attname = 'membership_role'
    and not a.attisdropped;

  if v_invitation_role_is_enum then
    select coalesce(
      (select enumlabel from pg_enum where enumtypid = v_invitation_role_oid and enumlabel = 'company_admin' limit 1),
      (select enumlabel from pg_enum where enumtypid = v_invitation_role_oid and enumlabel = 'admin' limit 1),
      (select enumlabel from pg_enum where enumtypid = v_invitation_role_oid and enumlabel = 'owner' limit 1),
      (select enumlabel from pg_enum where enumtypid = v_invitation_role_oid and enumlabel = 'member' limit 1),
      (select enumlabel from pg_enum where enumtypid = v_invitation_role_oid order by enumsortorder limit 1)
    ) into v_invitation_role_value;
  else
    v_invitation_role_type_sql := 'text';
    v_invitation_role_value := 'company_admin';
  end if;

  -- Always create/update a pending invitation for Afshin while Nibela is onboarding.
  if exists (
    select 1
    from public.company_invitations
    where company_id = v_company_id
      and lower(email) = lower(v_email)
      and status in ('pending', 'invited', 'sent')
  ) then
    v_sql := format($fmt$
      update public.company_invitations
         set membership_role = %L::%s,
             role_key = 'company_admin',
             status = 'pending',
             invited_user_id = case when $4 then $2 else null end,
             expires_at = coalesce(expires_at, now() + interval '14 days'),
             metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
               'debug_batch_2_setup', true,
               'tenant_state', 'onboarding',
               'auth_user_exists_at_setup', $4,
               'setup_mode', case when $4 then 'active_user' else 'pending_invitation' end
             ),
             updated_at = now()
       where company_id = $1
         and lower(email) = lower($3)
         and status in ('pending', 'invited', 'sent')
    $fmt$, v_invitation_role_value, v_invitation_role_type_sql);

    execute v_sql using v_company_id, v_user_id, v_email, v_user_exists;
  else
    v_sql := format($fmt$
      insert into public.company_invitations (
        company_id,
        email,
        membership_role,
        role_key,
        status,
        invited_user_id,
        expires_at,
        metadata
      ) values (
        $1,
        $3,
        %L::%s,
        'company_admin',
        'pending',
        case when $4 then $2 else null end,
        now() + interval '14 days',
        jsonb_build_object(
          'debug_batch_2_setup', true,
          'tenant_state', 'onboarding',
          'auth_user_exists_at_setup', $4,
          'setup_mode', case when $4 then 'active_user' else 'pending_invitation' end
        )
      )
    $fmt$, v_invitation_role_value, v_invitation_role_type_sql);

    execute v_sql using v_company_id, v_user_id, v_email, v_user_exists;
  end if;

  if v_user_exists then
    -- The user exists in the table referenced by user_roles.user_id. It is safe to activate membership and role.
    if exists (
      select 1 from public.company_memberships
      where company_id = v_company_id and user_id = v_user_id
    ) then
      v_sql := format($fmt$
        update public.company_memberships
           set role = 'company_admin',
               role_id = $3,
               status = 'active',
               is_active = true,
               invited_email = $4,
               membership_role = %L::%s,
               role_key = 'company_admin',
               accepted_at = coalesce(accepted_at, now()),
               metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
                 'debug_batch_2_setup', true,
                 'tenant_state', 'onboarding',
                 'auth_user_exists_at_setup', true,
                 'setup_mode', 'active_user'
               ),
               updated_at = now()
         where company_id = $1 and user_id = $2
      $fmt$, v_membership_role_value, v_membership_role_type_sql);

      execute v_sql using v_company_id, v_user_id, v_role_id, v_email;
    else
      v_sql := format($fmt$
        insert into public.company_memberships (
          company_id,
          user_id,
          role,
          role_id,
          status,
          is_active,
          invited_email,
          membership_role,
          role_key,
          invited_at,
          accepted_at,
          metadata
        ) values (
          $1,
          $2,
          'company_admin',
          $3,
          'active',
          true,
          $4,
          %L::%s,
          'company_admin',
          now(),
          now(),
          jsonb_build_object(
            'debug_batch_2_setup', true,
            'tenant_state', 'onboarding',
            'auth_user_exists_at_setup', true,
            'setup_mode', 'active_user'
          )
        )
      $fmt$, v_membership_role_value, v_membership_role_type_sql);

      execute v_sql using v_company_id, v_user_id, v_role_id, v_email;
    end if;

    insert into public.user_roles (user_id, role, role_id, company_id, status, is_active)
    select
      v_user_id,
      'company_admin',
      v_role_id,
      v_company_id,
      'active',
      true
    where not exists (
      select 1
      from public.user_roles ur
      where ur.user_id = v_user_id
        and ur.company_id = v_company_id
        and lower(coalesce(ur.role, '')) = 'company_admin'
    );
  else
    -- User does not exist yet. Keep Afshin as pending invitation only.
    -- If a partial prior run inserted a membership row, prevent it from acting as active access.
    if exists (
      select 1 from public.company_memberships
      where company_id = v_company_id
        and (user_id = v_user_id or lower(coalesce(invited_email, '')) = lower(v_email))
    ) then
      v_sql := format($fmt$
        update public.company_memberships
           set role = 'company_admin',
               role_id = $3,
               status = 'invited',
               is_active = false,
               invited_email = $4,
               membership_role = %L::%s,
               role_key = 'company_admin',
               accepted_at = null,
               metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
                 'debug_batch_2_setup', true,
                 'tenant_state', 'onboarding',
                 'auth_user_exists_at_setup', false,
                 'setup_mode', 'pending_invitation_only'
               ),
               updated_at = now()
         where company_id = $1
           and (user_id = $2 or lower(coalesce(invited_email, '')) = lower($4))
      $fmt$, v_membership_role_value, v_membership_role_type_sql);

      execute v_sql using v_company_id, v_user_id, v_role_id, v_email;
    end if;
  end if;

  -- Keep Hekmat as explicit superadmin only if the referenced users row exists.
  -- If it does not exist, do not create a broken FK row.
  declare
    v_super_role_id uuid;
    v_super_user_exists boolean := false;
  begin
    select id into v_super_role_id from public.roles where coalesce(key, name) = 'super_admin' limit 1;

    if v_user_ref_table is not null then
      begin
        execute format('select exists (select 1 from %s where id = $1)', v_user_ref_table)
          into v_super_user_exists
          using v_superadmin_user_id;
      exception when undefined_table or undefined_column or insufficient_privilege then
        v_super_user_exists := false;
      end;
    end if;

    if v_super_role_id is not null and v_super_user_exists then
      insert into public.user_roles (user_id, role, role_id, status, is_active)
      select
        v_superadmin_user_id,
        'super_admin',
        v_super_role_id,
        'active',
        true
      where not exists (
        select 1 from public.user_roles ur
        where ur.user_id = v_superadmin_user_id
          and lower(coalesce(ur.role, '')) in ('super_admin', 'superadmin', 'platform_admin')
      );
    end if;
  end;

  raise notice 'Nibela onboarding setup complete. Afshin user exists in referenced users table: %', v_user_exists;
end $$;

-- Verify company/invitation/membership state.
select
  c.id,
  c.name,
  c.status,
  c.created_at
from public.companies c
where c.id in (
  '1c790a8e-5a3f-4bf2-a01c-3b67fc4327fa'::uuid,
  'aa121d1e-990b-40ed-8399-4442539fec62'::uuid
)
order by c.name;

select
  ci.company_id,
  c.name as company_name,
  ci.email,
  ci.membership_role::text as membership_role,
  ci.role_key,
  ci.status,
  ci.invited_user_id,
  ci.expires_at,
  ci.metadata
from public.company_invitations ci
left join public.companies c on c.id = ci.company_id
where ci.company_id = 'aa121d1e-990b-40ed-8399-4442539fec62'::uuid
  and lower(ci.email) = lower('afshin.hemmati@nibela.se')
order by ci.created_at desc;

select
  cm.company_id,
  c.name as company_name,
  cm.user_id,
  cm.invited_email,
  cm.role,
  cm.role_key,
  cm.membership_role::text as membership_role,
  cm.status,
  cm.is_active,
  cm.accepted_at,
  cm.metadata
from public.company_memberships cm
left join public.companies c on c.id = cm.company_id
where cm.company_id = 'aa121d1e-990b-40ed-8399-4442539fec62'::uuid
  and (cm.user_id = '08bbafb2-dac7-44e1-ac0b-a72223a4975c'::uuid or lower(coalesce(cm.invited_email, '')) = lower('afshin.hemmati@nibela.se'))
order by cm.created_at desc;
