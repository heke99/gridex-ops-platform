-- Customer portal external auth linking hardening.
-- Makes OPS ready to link Gridex website Supabase auth users to OPS customers.
-- Safe/idempotent: no customer deletes, no customer merges, no tenant moves.

create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.customer_portal_accounts') is not null then
    alter table public.customer_portal_accounts
      add column if not exists role text not null default 'owner',
      add column if not exists user_email text,
      add column if not exists is_active boolean not null default true,
      add column if not exists invited_at timestamptz,
      add column if not exists activated_at timestamptz,
      add column if not exists verified_at timestamptz,
      add column if not exists last_seen_at timestamptz,
      add column if not exists match_method text not null default 'manual',
      add column if not exists verified_identity_snapshot jsonb not null default '{}'::jsonb,
      add column if not exists metadata jsonb not null default '{}'::jsonb,
      add column if not exists status text,
      add column if not exists email text,
      add column if not exists company_id uuid;

    update public.customer_portal_accounts
       set role = 'owner'
     where role is null
        or btrim(role) = ''
        or lower(role) not in ('owner', 'billing', 'viewer');

    alter table public.customer_portal_accounts
      alter column role set default 'owner',
      alter column role set not null;

    alter table public.customer_portal_accounts
      drop constraint if exists customer_portal_accounts_role_check;

    alter table public.customer_portal_accounts
      add constraint customer_portal_accounts_role_check
      check (role in ('owner', 'billing', 'viewer'));

    execute 'create unique index if not exists customer_portal_accounts_user_customer_uidx on public.customer_portal_accounts(user_id, customer_id) where user_id is not null and customer_id is not null';
    execute 'create index if not exists customer_portal_accounts_company_user_idx on public.customer_portal_accounts(company_id, user_id) where user_id is not null';
    execute 'create index if not exists customer_portal_accounts_company_customer_idx on public.customer_portal_accounts(company_id, customer_id) where customer_id is not null';
    execute 'create index if not exists customer_portal_accounts_company_email_idx on public.customer_portal_accounts(company_id, lower(email)) where email is not null';
    execute 'create index if not exists customer_portal_accounts_company_user_email_idx on public.customer_portal_accounts(company_id, lower(user_email)) where user_email is not null';
  end if;
end $$;

do $$
begin
  if to_regclass('public.customer_portal_identities') is not null then
    alter table public.customer_portal_identities
      add column if not exists customer_number text,
      add column if not exists auth_user_id uuid,
      add column if not exists customer_portal_user_id uuid,
      add column if not exists last_resolved_at timestamptz;

    execute 'create index if not exists customer_portal_identities_company_customer_number_idx on public.customer_portal_identities(company_id, customer_number) where customer_number is not null';
    execute 'create index if not exists customer_portal_identities_company_auth_user_idx on public.customer_portal_identities(company_id, auth_user_id) where auth_user_id is not null';
    execute 'create index if not exists customer_portal_identities_company_portal_user_idx on public.customer_portal_identities(company_id, customer_portal_user_id) where customer_portal_user_id is not null';
    execute 'create index if not exists customer_portal_identities_company_external_account_idx on public.customer_portal_identities(company_id, external_account_id) where external_account_id is not null';
  end if;
end $$;

-- Normalize already-linked accounts into identities. This only uses existing customer_id links.
do $$
begin
  if to_regclass('public.customer_portal_accounts') is not null
     and to_regclass('public.customer_portal_identities') is not null
     and to_regclass('public.customers') is not null then

    update public.customer_portal_accounts a
       set company_id = coalesce(a.company_id, c.company_id),
           email = coalesce(nullif(btrim(a.email), ''), nullif(btrim(a.user_email), ''), c.email),
           user_email = coalesce(nullif(btrim(a.user_email), ''), nullif(btrim(a.email), ''), c.email),
           status = coalesce(nullif(btrim(a.status), ''), 'active'),
           is_active = coalesce(a.is_active, true),
           role = case when a.role in ('owner','billing','viewer') then a.role else 'owner' end,
           updated_at = now()
      from public.customers c
     where a.customer_id = c.id;

    update public.customer_portal_identities i
       set auth_user_id = coalesce(i.auth_user_id, a.user_id),
           customer_portal_user_id = coalesce(i.customer_portal_user_id, a.user_id),
           external_account_id = coalesce(nullif(btrim(i.external_account_id), ''), a.user_id::text),
           customer_number = coalesce(nullif(btrim(i.customer_number), ''), c.customer_number),
           email = coalesce(nullif(btrim(i.email), ''), nullif(btrim(a.email), ''), nullif(btrim(a.user_email), ''), c.email),
           status = case when i.status in ('pending_review','unmatched','needs_review') then 'active' else i.status end,
           match_strength = case when i.match_strength in ('none','weak') then 'strong' else i.match_strength end,
           match_method = coalesce(i.match_method, 'customer_portal_account_backfill'),
           linked_at = coalesce(i.linked_at, a.verified_at, a.activated_at, now()),
           last_resolved_at = now(),
           updated_at = now()
      from public.customer_portal_accounts a
      join public.customers c on c.id = a.customer_id
     where i.company_id = c.company_id
       and i.customer_id = c.id
       and a.user_id is not null;
  end if;
end $$;
