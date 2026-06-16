-- Customer portal API hardening for current live schema.
-- Safe/idempotent. Does not delete, merge or guess customer links.
-- Adapted for schema where:
-- - public.customer_profiles does not exist
-- - public.customers.external_customer_id does not exist
-- - public.customers.customer_number exists

create extension if not exists pgcrypto;

-- 1) Add stable resolver columns to customer_portal_identities.
do $$
begin
  alter table public.customer_portal_identities
    add column if not exists customer_number text,
    add column if not exists auth_user_id uuid,
    add column if not exists customer_portal_user_id uuid,
    add column if not exists last_resolved_at timestamptz;

  execute 'create index if not exists customer_portal_identities_company_customer_number_idx on public.customer_portal_identities(company_id, customer_number) where customer_number is not null';
  execute 'create index if not exists customer_portal_identities_company_email_idx on public.customer_portal_identities(company_id, lower(email)) where email is not null';
  execute 'create index if not exists customer_portal_identities_company_auth_user_idx on public.customer_portal_identities(company_id, auth_user_id) where auth_user_id is not null';
  execute 'create index if not exists customer_portal_identities_company_portal_user_idx on public.customer_portal_identities(company_id, customer_portal_user_id) where customer_portal_user_id is not null';
end $$;

-- 2) Make customer_portal_accounts easier to resolve by company/user/email.
-- Your schema already has these columns, but this keeps the migration idempotent.
do $$
begin
  alter table public.customer_portal_accounts
    add column if not exists company_id uuid,
    add column if not exists email text,
    add column if not exists status text,
    add column if not exists metadata jsonb;

  execute 'create index if not exists customer_portal_accounts_company_user_idx on public.customer_portal_accounts(company_id, user_id) where user_id is not null';
  execute 'create index if not exists customer_portal_accounts_company_customer_idx on public.customer_portal_accounts(company_id, customer_id) where customer_id is not null';
  execute 'create index if not exists customer_portal_accounts_company_email_idx on public.customer_portal_accounts(company_id, lower(email)) where email is not null';
  execute 'create index if not exists customer_portal_accounts_company_user_email_idx on public.customer_portal_accounts(company_id, lower(user_email)) where user_email is not null';
end $$;

-- 3) Create tenant-scoped customer notifications.
-- Empty table is valid: Mina sidor returns [] instead of failing.
create table if not exists public.customer_notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  type text not null default 'info',
  title text not null,
  message text,
  status text not null default 'unread',
  read_at timestamptz,
  action_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customer_notifications_customer_idx
  on public.customer_notifications(company_id, customer_id, created_at desc);

create index if not exists customer_notifications_unread_idx
  on public.customer_notifications(company_id, customer_id, created_at desc)
  where status = 'unread';

alter table public.customer_notifications enable row level security;

do $$
declare
  has_platform_admin_fn boolean;
  has_company_read_fn boolean;
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'customer_notifications'
      and policyname = 'customer_notifications_service_role_all'
  ) then
    create policy customer_notifications_service_role_all
      on public.customer_notifications
      for all to service_role
      using (true)
      with check (true);
  end if;

  select to_regprocedure('public.gridex_user_is_platform_admin()') is not null
    into has_platform_admin_fn;

  select to_regprocedure('public.gridex_can_read_company(uuid)') is not null
    into has_company_read_fn;

  if has_platform_admin_fn and has_company_read_fn then
    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'customer_notifications'
        and policyname = 'customer_notifications_tenant_read'
    ) then
      execute $policy$
        create policy customer_notifications_tenant_read
          on public.customer_notifications
          for select
          using (
            public.gridex_user_is_platform_admin()
            or public.gridex_can_read_company(company_id)
          )
      $policy$;
    end if;
  end if;
end $$;

-- 4) Normalize missing customer display name from existing customers.name.
-- This does not use customer_profiles, because that table does not exist in your live DB.
update public.customers c
set
  full_name = coalesce(
    nullif(btrim(c.full_name), ''),
    nullif(btrim(c.name), ''),
    nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '')
  ),
  first_name = coalesce(
    nullif(btrim(c.first_name), ''),
    case
      when c.customer_type = 'private'
       and nullif(btrim(c.name), '') is not null
       and position(' ' in btrim(c.name)) > 0
      then split_part(btrim(c.name), ' ', 1)
      else c.first_name
    end
  ),
  last_name = coalesce(
    nullif(btrim(c.last_name), ''),
    case
      when c.customer_type = 'private'
       and nullif(btrim(c.name), '') is not null
       and position(' ' in btrim(c.name)) > 0
      then regexp_replace(btrim(c.name), '^\S+\s*', '')
      else c.last_name
    end
  ),
  updated_at = now()
where
  nullif(btrim(coalesce(c.full_name, '')), '') is null
  or nullif(btrim(coalesce(c.first_name, '')), '') is null
  or nullif(btrim(coalesce(c.last_name, '')), '') is null;

-- 5) Backfill identity metadata from already-linked customers.
-- No new customer links are guessed.
-- Since customers.external_customer_id does not exist in your DB,
-- identity.external_customer_id falls back to customers.customer_number.
update public.customer_portal_identities i
set
  customer_number = coalesce(nullif(btrim(i.customer_number), ''), c.customer_number),
  email = coalesce(nullif(btrim(i.email), ''), c.email),
  external_customer_id = coalesce(
    nullif(btrim(i.external_customer_id), ''),
    c.customer_number
  ),
  status = case
    when i.customer_id is not null
      and i.status in ('pending_review', 'unmatched', 'needs_review')
      then 'active'
    else i.status
  end,
  match_strength = case
    when i.customer_id is not null
      and i.match_strength in ('none', 'weak')
      then 'strong'
    else i.match_strength
  end,
  match_method = coalesce(i.match_method, 'customer_portal_backfill'),
  linked_at = coalesce(i.linked_at, now()),
  last_resolved_at = coalesce(i.last_resolved_at, now()),
  updated_at = now()
from public.customers c
where i.company_id = c.company_id
  and i.customer_id = c.id;

-- 6) Backfill account metadata from already-linked customers.
-- No new account/customer links are guessed.
update public.customer_portal_accounts a
set
  company_id = coalesce(a.company_id, c.company_id),
  email = coalesce(
    nullif(btrim(a.email), ''),
    nullif(btrim(a.user_email), ''),
    c.email
  ),
  status = coalesce(nullif(btrim(a.status), ''), 'active'),
  is_active = coalesce(a.is_active, true),
  updated_at = now()
from public.customers c
where a.customer_id = c.id;

-- 7) Create missing identity rows from verified portal accounts that already point to a customer.
-- This is safe because customer_portal_accounts.customer_id is already a concrete link.
insert into public.customer_portal_identities (
  company_id,
  customer_id,
  provider,
  external_customer_id,
  external_account_id,
  email,
  status,
  match_strength,
  match_method,
  linked_at,
  metadata,
  customer_number,
  auth_user_id,
  customer_portal_user_id,
  last_resolved_at,
  created_at,
  updated_at
)
select
  c.company_id,
  c.id,
  'gridex_customer_portal',
  c.customer_number,
  a.user_id::text,
  coalesce(nullif(btrim(a.email), ''), nullif(btrim(a.user_email), ''), c.email),
  'active',
  'strong',
  coalesce(nullif(btrim(a.match_method), ''), 'customer_portal_account_backfill'),
  coalesce(a.verified_at, a.activated_at, now()),
  jsonb_build_object(
    'source', 'customer_portal_accounts',
    'account_id', a.id,
    'backfilled_at', now()
  ),
  c.customer_number,
  a.user_id,
  a.user_id,
  now(),
  now(),
  now()
from public.customer_portal_accounts a
join public.customers c
  on c.id = a.customer_id
where a.user_id is not null
  and a.customer_id is not null
  and c.company_id is not null
  and not exists (
    select 1
    from public.customer_portal_identities i
    where i.company_id = c.company_id
      and i.customer_id = c.id
      and (
        i.auth_user_id = a.user_id
        or i.customer_portal_user_id = a.user_id
        or i.external_account_id = a.user_id::text
      )
  );

-- 8) Final sync from customer_portal_accounts to identities where both already refer to same customer.
update public.customer_portal_identities i
set
  auth_user_id = coalesce(i.auth_user_id, a.user_id),
  customer_portal_user_id = coalesce(i.customer_portal_user_id, a.user_id),
  external_account_id = coalesce(i.external_account_id, a.user_id::text),
  email = coalesce(nullif(btrim(i.email), ''), nullif(btrim(a.email), ''), nullif(btrim(a.user_email), '')),
  last_resolved_at = now(),
  updated_at = now()
from public.customer_portal_accounts a
where i.customer_id = a.customer_id
  and i.company_id = a.company_id
  and a.user_id is not null;