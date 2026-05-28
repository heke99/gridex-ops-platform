-- Fixar användarskapande och äldre användarkopplingar utan att röra Auth-konton,
-- lösenord eller befintliga aktiva roller.
-- Princip:
-- 1) company_memberships används bara som tenant-koppling med stabila/canoniska kolumner.
-- 2) faktisk behörighet ligger i user_roles.
-- 3) backfill skapar endast saknade länkar/roller; den skriver inte över befintliga aktiva roller.

create extension if not exists pgcrypto;

-- Canonical tenant membership columns used by the runtime. Intentionally do not require
-- legacy company_memberships.role or company_memberships.is_active.
do $$
begin
  if to_regclass('public.company_memberships') is not null then
    alter table public.company_memberships add column if not exists membership_role text default 'member';
    alter table public.company_memberships add column if not exists role_key text;
    alter table public.company_memberships add column if not exists status text default 'active';
    alter table public.company_memberships add column if not exists invited_email text;
    alter table public.company_memberships add column if not exists invited_by uuid;
    alter table public.company_memberships add column if not exists invited_at timestamptz default now();
    alter table public.company_memberships add column if not exists accepted_at timestamptz;
    alter table public.company_memberships add column if not exists metadata jsonb default '{}'::jsonb;
    alter table public.company_memberships add column if not exists created_at timestamptz default now();
    alter table public.company_memberships add column if not exists updated_at timestamptz default now();

    update public.company_memberships
       set membership_role = coalesce(nullif(membership_role, ''), 'member'),
           status = coalesce(nullif(status, ''), 'active'),
           invited_at = coalesce(invited_at, created_at, now()),
           accepted_at = case when coalesce(status, 'active') = 'active' then coalesce(accepted_at, invited_at, created_at, now()) else accepted_at end,
           metadata = coalesce(metadata, '{}'::jsonb),
           updated_at = coalesce(updated_at, now())
     where membership_role is null
        or status is null
        or invited_at is null
        or (coalesce(status, 'active') = 'active' and accepted_at is null)
        or metadata is null
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

-- Ensure role/user role foundation exists for direct login access.
do $$
begin
  if to_regclass('public.roles') is not null then
    alter table public.roles add column if not exists key text;
    alter table public.roles add column if not exists name text;
    alter table public.roles add column if not exists description text;
    alter table public.roles add column if not exists scope text default 'company';
    alter table public.roles add column if not exists is_active boolean default true;
  end if;

  if to_regclass('public.user_roles') is not null then
    alter table public.user_roles add column if not exists user_id uuid;
    alter table public.user_roles add column if not exists company_id uuid;
    alter table public.user_roles add column if not exists role text;
    alter table public.user_roles add column if not exists role_id uuid;
    alter table public.user_roles add column if not exists status text default 'active';
    alter table public.user_roles add column if not exists is_active boolean default true;
    alter table public.user_roles add column if not exists created_at timestamptz default now();
    alter table public.user_roles add column if not exists updated_at timestamptz default now();
  end if;
end $$;

-- Role catalog required by the company user UI. Uses update-then-insert to avoid depending
-- on a unique constraint in older installs.
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
      ('admin', 'Admin', 'Bred daglig adminåtkomst inom bolaget.'),
      ('operations_manager', 'Operationsansvarig', 'Kan leda switch, mätvärden, utskick och operationsflöden.'),
      ('operations_agent', 'Operationshandläggare', 'Kan arbeta med daglig operationshandläggning.'),
      ('customer_service_manager', 'Kundtjänstansvarig', 'Kan leda kundtjänst och kundärenden.'),
      ('customer_service_agent', 'Kundtjänst', 'Kan hantera kundärenden och läsa kundbilden.'),
      ('sales_manager', 'Säljansvarig', 'Kan arbeta med kundintag och kommersiell uppföljning.'),
      ('pricing_manager', 'Prisansvarig', 'Kan arbeta med kampanjer och prisversioner.'),
      ('pricing_approver', 'Prisgodkännare', 'Kan granska och godkänna pricing.'),
      ('finance_readonly', 'Ekonomi läs', 'Kan läsa fakturering, export och ekonomirelaterade vyer.'),
      ('executive_readonly', 'Ledning läs', 'Kan se lednings- och rapportöverblick.'),
      ('compliance_manager', 'Compliance', 'Kan granska audit, kontrollspår och efterlevnad.'),
      ('partner_manager', 'Partneransvarig', 'Kan följa partnerexporter och integrationsflöden.'),
      ('partner_api_user', 'API-/partneranvändare', 'Teknisk integrationsidentitet med begränsad adminanvändning.')
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

-- Make Auth users visible in UI when they already have membership/user_roles but no profile row.
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

-- Existing active user_roles without tenant membership should get a tenant link.
insert into public.company_memberships (
  company_id,
  user_id,
  membership_role,
  role_key,
  status,
  invited_email,
  invited_at,
  accepted_at,
  metadata
)
select distinct on (ur.company_id, ur.user_id)
       ur.company_id,
       ur.user_id,
       case
         when coalesce(r.key, ur.role, '') in ('company_admin', 'admin') then 'company_admin'
         when coalesce(r.key, ur.role, '') in ('finance_readonly', 'executive_readonly') then 'viewer'
         else 'member'
       end as membership_role,
       coalesce(r.key, ur.role) as role_key,
       'active' as status,
       lower(au.email) as invited_email,
       coalesce(ur.created_at, now()) as invited_at,
       coalesce(ur.created_at, now()) as accepted_at,
       jsonb_build_object('backfilled_by', '20260527_fix_company_user_creation_schema_safe_backfill', 'source', 'user_roles') as metadata
from public.user_roles ur
left join public.roles r on r.id = ur.role_id
left join auth.users au on au.id = ur.user_id
where ur.company_id is not null
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

-- Existing active memberships without a tenant-scoped user_role should get one.
-- This does not overwrite any existing role; it only inserts when no active role exists for that user/company.
insert into public.user_roles (
  user_id,
  company_id,
  role_id,
  role,
  status,
  is_active,
  created_at,
  updated_at
)
select cm.user_id,
       cm.company_id,
       r.id,
       r.key,
       'active',
       true,
       now(),
       now()
from public.company_memberships cm
join public.roles r on r.key = coalesce(
  nullif(cm.role_key, ''),
  case
    when cm.membership_role in ('company_admin', 'owner', 'admin') then 'company_admin'
    when cm.membership_role = 'viewer' then 'executive_readonly'
    else 'company_admin'
  end
)
where cm.company_id is not null
  and cm.user_id is not null
  and coalesce(cm.status, 'active') = 'active'
  and not exists (
    select 1
    from public.user_roles ur
    where ur.company_id = cm.company_id
      and ur.user_id = cm.user_id
      and coalesce(ur.status, 'active') = 'active'
      and coalesce(ur.is_active, true) = true
  );

-- Best-effort schema cache reload for Supabase/PostgREST.
notify pgrst, 'reload schema';
