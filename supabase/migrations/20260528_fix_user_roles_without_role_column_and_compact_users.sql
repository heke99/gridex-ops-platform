-- Fix user provisioning against live DBs where user_roles.role and company_memberships.role/is_active do not exist.
-- This migration does not touch auth.users, does not reset passwords, and does not overwrite existing active roles.

create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.user_roles') is not null then
    alter table public.user_roles add column if not exists id uuid default gen_random_uuid();
    alter table public.user_roles add column if not exists user_id uuid;
    alter table public.user_roles add column if not exists role_id uuid;
    alter table public.user_roles add column if not exists company_id uuid;
    alter table public.user_roles add column if not exists status text default 'active';
    alter table public.user_roles add column if not exists is_active boolean default true;
    alter table public.user_roles add column if not exists created_at timestamptz default now();
    alter table public.user_roles add column if not exists disabled_at timestamptz;
    alter table public.user_roles add column if not exists disabled_by uuid;
    alter table public.user_roles add column if not exists status_reason text;

    update public.user_roles
       set status = coalesce(nullif(status, ''), 'active'),
           is_active = coalesce(is_active, true),
           created_at = coalesce(created_at, now())
     where status is null
        or status = ''
        or is_active is null
        or created_at is null;
  end if;

  if to_regclass('public.company_memberships') is not null then
    alter table public.company_memberships add column if not exists id uuid default gen_random_uuid();
    alter table public.company_memberships add column if not exists company_id uuid;
    alter table public.company_memberships add column if not exists user_id uuid;
    alter table public.company_memberships add column if not exists membership_role text default 'member';
    alter table public.company_memberships add column if not exists role_key text;
    alter table public.company_memberships add column if not exists status text default 'active';
    alter table public.company_memberships add column if not exists invited_email text;
    alter table public.company_memberships add column if not exists invited_by uuid;
    alter table public.company_memberships add column if not exists invited_at timestamptz;
    alter table public.company_memberships add column if not exists accepted_at timestamptz;
    alter table public.company_memberships add column if not exists removed_at timestamptz;
    alter table public.company_memberships add column if not exists removed_by uuid;
    alter table public.company_memberships add column if not exists disabled_at timestamptz;
    alter table public.company_memberships add column if not exists disabled_by uuid;
    alter table public.company_memberships add column if not exists status_reason text;
    alter table public.company_memberships add column if not exists metadata jsonb default '{}'::jsonb;
    alter table public.company_memberships add column if not exists created_at timestamptz default now();
    alter table public.company_memberships add column if not exists updated_at timestamptz default now();

    update public.company_memberships
       set membership_role = coalesce(nullif(membership_role, ''), 'member'),
           status = coalesce(nullif(status, ''), 'active'),
           invited_at = coalesce(invited_at, created_at, now()),
           accepted_at = case when coalesce(status, 'active') = 'active' then coalesce(accepted_at, created_at, now()) else accepted_at end,
           metadata = coalesce(metadata, '{}'::jsonb),
           created_at = coalesce(created_at, now()),
           updated_at = coalesce(updated_at, now())
     where membership_role is null
        or membership_role = ''
        or status is null
        or status = ''
        or invited_at is null
        or metadata is null
        or created_at is null
        or updated_at is null;
  end if;
end $$;

-- Complete missing memberships from existing tenant-scoped user_roles.
do $$
begin
  if to_regclass('public.user_roles') is not null
     and to_regclass('public.company_memberships') is not null
     and to_regclass('public.roles') is not null then

    insert into public.company_memberships (
      company_id,
      user_id,
      membership_role,
      role_key,
      status,
      invited_at,
      accepted_at,
      metadata,
      created_at,
      updated_at
    )
    select
      ur.company_id,
      ur.user_id,
      case
        when coalesce(r.key, r.name) in ('company_admin', 'admin', 'owner') then 'admin'
        when coalesce(r.key, r.name) in ('operations_manager', 'operations_agent') then 'operations'
        when coalesce(r.key, r.name) in ('customer_service_manager', 'customer_service_agent', 'support') then 'support'
        when coalesce(r.key, r.name) in ('finance_readonly', 'executive_readonly') then 'viewer'
        else 'member'
      end,
      coalesce(r.key, r.name),
      'active',
      coalesce(ur.created_at, now()),
      coalesce(ur.created_at, now()),
      jsonb_build_object('schema_safe_backfill', true, 'source', 'user_roles'),
      coalesce(ur.created_at, now()),
      now()
    from public.user_roles ur
    left join public.roles r on r.id = ur.role_id
    where ur.company_id is not null
      and ur.user_id is not null
      and coalesce(ur.status, 'active') = 'active'
      and coalesce(ur.is_active, true) = true
      and not exists (
        select 1
        from public.company_memberships cm
        where cm.company_id = ur.company_id
          and cm.user_id = ur.user_id
      );

    update public.company_memberships cm
       set role_key = coalesce(nullif(cm.role_key, ''), resolved.role_key),
           membership_role = coalesce(nullif(cm.membership_role, ''), resolved.membership_role, 'member'),
           status = coalesce(nullif(cm.status, ''), 'active'),
           accepted_at = case when coalesce(cm.status, 'active') = 'active' then coalesce(cm.accepted_at, cm.created_at, now()) else cm.accepted_at end,
           updated_at = now()
      from (
        select distinct on (ur.company_id, ur.user_id)
          ur.company_id,
          ur.user_id,
          coalesce(r.key, r.name) as role_key,
          case
            when coalesce(r.key, r.name) in ('company_admin', 'admin', 'owner') then 'admin'
            when coalesce(r.key, r.name) in ('operations_manager', 'operations_agent') then 'operations'
            when coalesce(r.key, r.name) in ('customer_service_manager', 'customer_service_agent', 'support') then 'support'
            when coalesce(r.key, r.name) in ('finance_readonly', 'executive_readonly') then 'viewer'
            else 'member'
          end as membership_role
        from public.user_roles ur
        left join public.roles r on r.id = ur.role_id
        where ur.company_id is not null
          and ur.user_id is not null
          and coalesce(ur.status, 'active') = 'active'
          and coalesce(ur.is_active, true) = true
        order by ur.company_id, ur.user_id, ur.created_at desc nulls last
      ) resolved
     where cm.company_id = resolved.company_id
       and cm.user_id = resolved.user_id
       and (cm.role_key is null or cm.role_key = '' or cm.membership_role is null or cm.membership_role = '');
  end if;
end $$;

-- Complete missing user_roles from active memberships that already have a resolvable role_key.
do $$
begin
  if to_regclass('public.user_roles') is not null
     and to_regclass('public.company_memberships') is not null
     and to_regclass('public.roles') is not null then

    insert into public.user_roles (
      user_id,
      role_id,
      company_id,
      status,
      is_active,
      created_at
    )
    select
      cm.user_id,
      r.id,
      cm.company_id,
      'active',
      true,
      coalesce(cm.accepted_at, cm.created_at, now())
    from public.company_memberships cm
    join public.roles r on coalesce(r.key, r.name) = coalesce(nullif(cm.role_key, ''), 'company_admin')
    where cm.company_id is not null
      and cm.user_id is not null
      and coalesce(cm.status, 'active') = 'active'
      and not exists (
        select 1
        from public.user_roles ur
        where ur.company_id = cm.company_id
          and ur.user_id = cm.user_id
          and ur.role_id = r.id
          and coalesce(ur.status, 'active') = 'active'
          and coalesce(ur.is_active, true) = true
      );
  end if;
end $$;

-- Ask PostgREST/Supabase to refresh the schema cache after the migration.
notify pgrst, 'reload schema';
