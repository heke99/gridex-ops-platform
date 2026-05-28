-- Final schema-safe user access repair.
-- Purpose:
-- - Do not require legacy user_roles.role, company_memberships.role or company_memberships.is_active.
-- - Preserve Auth users, passwords and existing active roles.
-- - Backfill only missing tenant links/role rows when the source role is explicit.

create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.roles') is not null then
    alter table public.roles add column if not exists id uuid default gen_random_uuid();
    alter table public.roles add column if not exists key text;
    alter table public.roles add column if not exists name text;
    alter table public.roles add column if not exists description text;
    alter table public.roles add column if not exists scope text default 'company';
    alter table public.roles add column if not exists is_active boolean default true;
  end if;

  if to_regclass('public.user_roles') is not null then
    alter table public.user_roles add column if not exists id uuid default gen_random_uuid();
    alter table public.user_roles add column if not exists user_id uuid;
    alter table public.user_roles add column if not exists role_id uuid;
    alter table public.user_roles add column if not exists company_id uuid;
    alter table public.user_roles add column if not exists status text default 'active';
    alter table public.user_roles add column if not exists is_active boolean default true;
    alter table public.user_roles add column if not exists created_at timestamptz default now();
    alter table public.user_roles add column if not exists updated_at timestamptz default now();
    alter table public.user_roles add column if not exists disabled_at timestamptz;
    alter table public.user_roles add column if not exists disabled_by uuid;
    alter table public.user_roles add column if not exists status_reason text;

    update public.user_roles
       set status = coalesce(nullif(status, ''), 'active'),
           is_active = coalesce(is_active, true),
           created_at = coalesce(created_at, now()),
           updated_at = coalesce(updated_at, created_at, now())
     where status is null
        or status = ''
        or is_active is null
        or created_at is null
        or updated_at is null;

    create index if not exists user_roles_user_active_idx
      on public.user_roles(user_id, status, is_active);

    create index if not exists user_roles_company_user_active_idx
      on public.user_roles(company_id, user_id, status, is_active)
      where company_id is not null and user_id is not null;

    create unique index if not exists user_roles_company_user_role_active_uidx
      on public.user_roles(company_id, user_id, role_id)
      where company_id is not null
        and user_id is not null
        and role_id is not null
        and coalesce(status, 'active') = 'active'
        and coalesce(is_active, true) = true;
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
           accepted_at = case
             when coalesce(status, 'active') = 'active' then coalesce(accepted_at, invited_at, created_at, now())
             else accepted_at
           end,
           metadata = coalesce(metadata, '{}'::jsonb),
           created_at = coalesce(created_at, now()),
           updated_at = coalesce(updated_at, now())
     where membership_role is null
        or membership_role = ''
        or status is null
        or status = ''
        or invited_at is null
        or (coalesce(status, 'active') = 'active' and accepted_at is null)
        or metadata is null
        or created_at is null
        or updated_at is null;

    alter table public.company_memberships drop constraint if exists company_memberships_role_check;
    alter table public.company_memberships
      add constraint company_memberships_role_check
      check (membership_role in ('company_admin', 'member', 'viewer', 'owner', 'admin', 'operations', 'support'));

    alter table public.company_memberships drop constraint if exists company_memberships_status_check;
    alter table public.company_memberships
      add constraint company_memberships_status_check
      check (status in ('active', 'invited', 'pending', 'suspended', 'disabled', 'removed', 'removed_from_company', 'invitation_revoked', 'locked_security', 'revoked'));

    create unique index if not exists company_memberships_company_user_uidx
      on public.company_memberships(company_id, user_id)
      where company_id is not null and user_id is not null;

    create index if not exists company_memberships_company_status_idx
      on public.company_memberships(company_id, status);
  end if;
end $$;

-- Make sure the company role catalog exists without touching existing role IDs.
do $$
declare
  r record;
begin
  if to_regclass('public.roles') is null then
    return;
  end if;

  for r in
    select * from (values
      ('company_admin', 'Bolagsansvarig', 'Kan administrera bolaget, användare och dagliga flöden.'),
      ('operations_manager', 'Operationsansvarig', 'Kan leda switch, mätvärden, utskick och operationsflöden.'),
      ('operations_agent', 'Operationshandläggare', 'Kan arbeta med daglig operationshandläggning.'),
      ('customer_service_agent', 'Kundtjänst', 'Kan hantera kundärenden och läsa kundbilden.'),
      ('finance_readonly', 'Ekonomi läs', 'Kan läsa fakturering, export och ekonomirelaterade vyer.'),
      ('executive_readonly', 'Ledning läs', 'Kan se lednings- och rapportöverblick.')
    ) as v(key, name, description)
  loop
    update public.roles
       set name = coalesce(nullif(public.roles.name, ''), r.name),
           description = coalesce(public.roles.description, r.description),
           scope = coalesce(public.roles.scope, 'company'),
           is_active = coalesce(public.roles.is_active, true)
     where key = r.key;

    if not found then
      insert into public.roles (key, name, description, scope, is_active)
      values (r.key, r.name, r.description, 'company', true);
    end if;
  end loop;
end $$;

-- Auth users with access rows should have a visible profile row. This does not change Auth login.
insert into public.user_profiles (id, email, full_name, created_at, updated_at)
select au.id,
       lower(au.email),
       coalesce(au.raw_user_meta_data->>'full_name', au.raw_user_meta_data->>'name'),
       coalesce(au.created_at, now()),
       now()
from auth.users au
where to_regclass('public.user_profiles') is not null
  and not exists (select 1 from public.user_profiles up where up.id = au.id)
  and (
    exists (select 1 from public.company_memberships cm where cm.user_id = au.id)
    or exists (select 1 from public.user_roles ur where ur.user_id = au.id)
  );

-- Backfill missing memberships from existing tenant-scoped user_roles.
-- Only fills empty membership fields; it does not overwrite an existing active role.
insert into public.company_memberships (
  company_id,
  user_id,
  membership_role,
  role_key,
  status,
  invited_email,
  invited_at,
  accepted_at,
  metadata,
  created_at,
  updated_at
)
select distinct on (ur.company_id, ur.user_id)
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
       lower(au.email),
       coalesce(ur.created_at, now()),
       coalesce(ur.created_at, now()),
       jsonb_build_object('schema_safe_backfill', true, 'source', 'user_roles', 'migration', '20260528_final_user_access_schema_safe_repair'),
       coalesce(ur.created_at, now()),
       now()
from public.user_roles ur
left join public.roles r on r.id = ur.role_id
left join auth.users au on au.id = ur.user_id
where to_regclass('public.user_roles') is not null
  and to_regclass('public.company_memberships') is not null
  and ur.company_id is not null
  and ur.user_id is not null
  and coalesce(ur.status, 'active') = 'active'
  and coalesce(ur.is_active, true) = true
  and not exists (
    select 1
    from public.company_memberships cm
    where cm.company_id = ur.company_id
      and cm.user_id = ur.user_id
  )
order by ur.company_id, ur.user_id, coalesce(ur.updated_at, ur.created_at, now()) desc;

-- Fill missing role_key/membership_role on existing memberships from explicit active user_roles.
update public.company_memberships cm
   set role_key = coalesce(nullif(cm.role_key, ''), resolved.role_key),
       membership_role = coalesce(nullif(cm.membership_role, ''), resolved.membership_role, 'member'),
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
    where to_regclass('public.user_roles') is not null
      and ur.company_id is not null
      and ur.user_id is not null
      and coalesce(ur.status, 'active') = 'active'
      and coalesce(ur.is_active, true) = true
    order by ur.company_id, ur.user_id, coalesce(ur.updated_at, ur.created_at, now()) desc
  ) resolved
 where to_regclass('public.company_memberships') is not null
   and cm.company_id = resolved.company_id
   and cm.user_id = resolved.user_id
   and (cm.role_key is null or cm.role_key = '' or cm.membership_role is null or cm.membership_role = '');

-- Backfill missing user_roles only when membership has an explicit mappable role.
-- No blind default to company_admin.
insert into public.user_roles (
  user_id,
  company_id,
  role_id,
  status,
  is_active,
  created_at,
  updated_at
)
select cm.user_id,
       cm.company_id,
       r.id,
       'active',
       true,
       coalesce(cm.accepted_at, cm.created_at, now()),
       now()
from public.company_memberships cm
join lateral (
  select coalesce(
    nullif(cm.role_key, ''),
    case
      when cm.membership_role in ('company_admin', 'owner', 'admin') then 'company_admin'
      when cm.membership_role = 'operations' then 'operations_manager'
      when cm.membership_role = 'support' then 'customer_service_agent'
      when cm.membership_role = 'viewer' then 'executive_readonly'
      else null
    end
  ) as resolved_role_key
) resolved on resolved.resolved_role_key is not null
join public.roles r on coalesce(r.key, r.name) = resolved.resolved_role_key
where to_regclass('public.user_roles') is not null
  and to_regclass('public.company_memberships') is not null
  and cm.company_id is not null
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

notify pgrst, 'reload schema';
