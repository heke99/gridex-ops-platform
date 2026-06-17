-- Customer Portal external-auth account repair.
-- Purpose: tenant websites use their own Supabase Auth. Their user ids must not be
-- written into customer_portal_accounts.user_id when that column is tied to OPS users.
-- Safe/idempotent: no deletes, no tenant moves, no blind customer merges.

create extension if not exists pgcrypto;

-- 1) Customer identity columns used by the public API contract.
do $$
begin
  if to_regclass('public.customers') is not null then
    alter table public.customers
      add column if not exists external_customer_id text;

    execute 'create index if not exists customers_company_external_customer_id_idx on public.customers(company_id, external_customer_id) where external_customer_id is not null';
    execute 'create index if not exists customers_company_customer_number_idx on public.customers(company_id, customer_number) where customer_number is not null';
    execute 'create index if not exists customers_company_email_idx on public.customers(company_id, lower(email)) where email is not null';
  end if;
end $$;

-- 2) Portal accounts keep OPS user_id for native OPS users, and portal_user_id for
-- external website auth users. This avoids customer_portal_accounts_user_id_fkey.
do $$
begin
  if to_regclass('public.customer_portal_accounts') is not null then
    begin
      alter table public.customer_portal_accounts alter column user_id drop not null;
    exception when others then
      null;
    end;

    alter table public.customer_portal_accounts
      add column if not exists company_id uuid,
      add column if not exists portal_user_id uuid,
      add column if not exists external_account_id text,
      add column if not exists customer_number text,
      add column if not exists external_customer_id text,
      add column if not exists role text not null default 'owner',
      add column if not exists email text,
      add column if not exists user_email text,
      add column if not exists status text,
      add column if not exists is_active boolean not null default true,
      add column if not exists invited_at timestamptz,
      add column if not exists activated_at timestamptz,
      add column if not exists verified_at timestamptz,
      add column if not exists last_seen_at timestamptz,
      add column if not exists match_method text not null default 'manual',
      add column if not exists verified_identity_snapshot jsonb not null default '{}'::jsonb,
      add column if not exists metadata jsonb not null default '{}'::jsonb;

    update public.customer_portal_accounts
       set role = 'owner'
     where role is null
        or btrim(role) = ''
        or lower(role) not in ('owner', 'billing', 'viewer');

    alter table public.customer_portal_accounts
      drop constraint if exists customer_portal_accounts_role_check;

    alter table public.customer_portal_accounts
      add constraint customer_portal_accounts_role_check
      check (role in ('owner', 'billing', 'viewer'));

    execute 'create unique index if not exists customer_portal_accounts_company_portal_user_customer_uidx on public.customer_portal_accounts(company_id, portal_user_id, customer_id) where portal_user_id is not null and customer_id is not null';
    execute 'create index if not exists customer_portal_accounts_company_portal_user_idx on public.customer_portal_accounts(company_id, portal_user_id) where portal_user_id is not null';
    execute 'create index if not exists customer_portal_accounts_company_external_account_idx on public.customer_portal_accounts(company_id, external_account_id) where external_account_id is not null';
    execute 'create index if not exists customer_portal_accounts_company_customer_number_idx on public.customer_portal_accounts(company_id, customer_number) where customer_number is not null';
    execute 'create index if not exists customer_portal_accounts_company_external_customer_idx on public.customer_portal_accounts(company_id, external_customer_id) where external_customer_id is not null';
    execute 'create index if not exists customer_portal_accounts_company_customer_idx on public.customer_portal_accounts(company_id, customer_id) where customer_id is not null';
  end if;
end $$;

-- 3) Portal identities: keep external account fields first-class and indexed.
do $$
begin
  if to_regclass('public.customer_portal_identities') is not null then
    alter table public.customer_portal_identities
      add column if not exists customer_number text,
      add column if not exists auth_user_id uuid,
      add column if not exists customer_portal_user_id uuid,
      add column if not exists last_resolved_at timestamptz;

    begin
      alter table public.customer_portal_identities alter column external_customer_id drop not null;
    exception when others then
      null;
    end;

    execute 'create index if not exists customer_portal_identities_company_customer_number_idx on public.customer_portal_identities(company_id, customer_number) where customer_number is not null';
    execute 'create index if not exists customer_portal_identities_company_auth_user_idx on public.customer_portal_identities(company_id, auth_user_id) where auth_user_id is not null';
    execute 'create index if not exists customer_portal_identities_company_portal_user_idx on public.customer_portal_identities(company_id, customer_portal_user_id) where customer_portal_user_id is not null';
    execute 'create index if not exists customer_portal_identities_company_external_account_idx on public.customer_portal_identities(company_id, external_account_id) where external_account_id is not null';
    execute 'create index if not exists customer_portal_identities_company_provider_customer_idx on public.customer_portal_identities(company_id, provider, customer_id) where customer_id is not null';
  end if;
end $$;

-- 4) Backfill customers.external_customer_id from accepted website applications.
do $$
begin
  if to_regclass('public.customers') is not null
     and to_regclass('public.website_customer_applications') is not null then
    update public.customers c
       set external_customer_id = a.external_customer_id,
           updated_at = now()
      from (
        select distinct on (company_id, customer_id)
               company_id,
               customer_id,
               nullif(btrim(external_customer_id), '') as external_customer_id,
               created_at
          from public.website_customer_applications
         where customer_id is not null
           and nullif(btrim(external_customer_id), '') is not null
         order by company_id, customer_id, created_at desc
      ) a
     where a.company_id = c.company_id
       and a.customer_id = c.id
       and nullif(btrim(coalesce(c.external_customer_id, '')), '') is null
       and a.external_customer_id is not null
       and a.external_customer_id <> coalesce(c.customer_number, '');
  end if;
end $$;

-- 5) Backfill identity rows from website applications that already point to a concrete customer.
do $$
begin
  if to_regclass('public.customer_portal_identities') is not null
     and to_regclass('public.website_customer_applications') is not null
     and to_regclass('public.customers') is not null then

    update public.customer_portal_identities i
       set customer_number = coalesce(nullif(btrim(i.customer_number), ''), c.customer_number),
           email = coalesce(nullif(btrim(i.email), ''), c.email),
           external_customer_id = coalesce(nullif(btrim(i.external_customer_id), ''), nullif(btrim(c.external_customer_id), '')),
           status = case when i.customer_id is not null and i.status in ('pending_review', 'unmatched', 'needs_review', 'rejected') then 'active' else i.status end,
           match_strength = case when i.customer_id is not null and i.match_strength in ('none', 'weak', 'manual') then 'strong' else i.match_strength end,
           match_method = coalesce(i.match_method, 'customer_portal_identity_repair'),
           linked_at = coalesce(i.linked_at, now()),
           last_resolved_at = coalesce(i.last_resolved_at, now()),
           updated_at = now()
      from public.customers c
     where i.company_id = c.company_id
       and i.customer_id = c.id;

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
      a.company_id,
      a.customer_id,
      'gridex_website',
      nullif(btrim(a.external_customer_id), ''),
      nullif(btrim(coalesce(a.external_account_id, a.payload->>'auth_user_id', a.payload->>'authUserId', a.payload->>'customer_portal_user_id', a.payload->>'customerPortalUserId', a.payload->>'portal_user_id', a.payload->>'portalUserId')), ''),
      c.email,
      'active',
      'strong',
      'website_customer_applications_backfill',
      now(),
      jsonb_build_object('source', 'website_customer_applications_backfill', 'application_id', a.id, 'api_client_id', a.api_client_id),
      c.customer_number,
      case
        when nullif(btrim(coalesce(a.external_account_id, a.payload->>'auth_user_id', a.payload->>'authUserId', a.payload->>'customer_portal_user_id', a.payload->>'customerPortalUserId', a.payload->>'portal_user_id', a.payload->>'portalUserId')), '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then nullif(btrim(coalesce(a.external_account_id, a.payload->>'auth_user_id', a.payload->>'authUserId', a.payload->>'customer_portal_user_id', a.payload->>'customerPortalUserId', a.payload->>'portal_user_id', a.payload->>'portalUserId')), '')::uuid
        else null
      end,
      case
        when nullif(btrim(coalesce(a.external_account_id, a.payload->>'customer_portal_user_id', a.payload->>'customerPortalUserId', a.payload->>'portal_user_id', a.payload->>'portalUserId', a.payload->>'auth_user_id', a.payload->>'authUserId')), '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then nullif(btrim(coalesce(a.external_account_id, a.payload->>'customer_portal_user_id', a.payload->>'customerPortalUserId', a.payload->>'portal_user_id', a.payload->>'portalUserId', a.payload->>'auth_user_id', a.payload->>'authUserId')), '')::uuid
        else null
      end,
      now(),
      now(),
      now()
    from public.website_customer_applications a
    join public.customers c
      on c.company_id = a.company_id
     and c.id = a.customer_id
    where a.customer_id is not null
      and nullif(btrim(a.external_customer_id), '') is not null
      and not exists (
        select 1
          from public.customer_portal_identities i
         where i.company_id = a.company_id
           and i.provider = 'gridex_website'
           and i.external_customer_id = nullif(btrim(a.external_customer_id), '')
      );
  end if;
end $$;

-- 6) Backfill portal accounts without touching customer_portal_accounts.user_id.
do $$
begin
  if to_regclass('public.customer_portal_accounts') is not null
     and to_regclass('public.customers') is not null then
    update public.customer_portal_accounts a
       set company_id = coalesce(a.company_id, c.company_id),
           customer_number = coalesce(nullif(btrim(a.customer_number), ''), c.customer_number),
           external_customer_id = coalesce(nullif(btrim(a.external_customer_id), ''), nullif(btrim(c.external_customer_id), '')),
           email = coalesce(nullif(btrim(a.email), ''), nullif(btrim(a.user_email), ''), c.email),
           user_email = coalesce(nullif(btrim(a.user_email), ''), nullif(btrim(a.email), ''), c.email),
           role = case when a.role in ('owner','billing','viewer') then a.role else 'owner' end,
           status = coalesce(nullif(btrim(a.status), ''), 'active'),
           is_active = coalesce(a.is_active, true),
           updated_at = now()
      from public.customers c
     where a.customer_id = c.id;
  end if;

  if to_regclass('public.customer_portal_accounts') is not null
     and to_regclass('public.customer_portal_identities') is not null
     and to_regclass('public.customers') is not null then
    insert into public.customer_portal_accounts (
      company_id,
      user_id,
      portal_user_id,
      external_account_id,
      customer_id,
      role,
      is_active,
      invited_at,
      activated_at,
      verified_at,
      match_method,
      verified_identity_snapshot,
      status,
      email,
      user_email,
      customer_number,
      external_customer_id,
      metadata,
      created_at,
      updated_at
    )
    select
      i.company_id,
      null::uuid,
      coalesce(i.customer_portal_user_id, i.auth_user_id),
      nullif(btrim(i.external_account_id), ''),
      i.customer_id,
      'owner',
      true,
      now(),
      now(),
      now(),
      coalesce(i.match_method, 'customer_portal_identity_backfill'),
      jsonb_build_object(
        'source', 'customer_portal_identity_backfill',
        'identity_id', i.id,
        'portal_user_id', coalesce(i.customer_portal_user_id, i.auth_user_id),
        'external_account_id', i.external_account_id,
        'external_customer_id', i.external_customer_id,
        'customer_number', coalesce(i.customer_number, c.customer_number),
        'email', coalesce(i.email, c.email)
      ),
      'active',
      coalesce(i.email, c.email),
      coalesce(i.email, c.email),
      coalesce(i.customer_number, c.customer_number),
      coalesce(i.external_customer_id, c.external_customer_id),
      jsonb_build_object('source', 'customer_portal_identity_backfill', 'identity_id', i.id),
      now(),
      now()
    from public.customer_portal_identities i
    join public.customers c
      on c.company_id = i.company_id
     and c.id = i.customer_id
    where i.customer_id is not null
      and (i.customer_portal_user_id is not null or i.auth_user_id is not null or nullif(btrim(i.external_account_id), '') is not null)
      and not exists (
        select 1
          from public.customer_portal_accounts a
         where a.company_id = i.company_id
           and a.customer_id = i.customer_id
           and (
             (coalesce(i.customer_portal_user_id, i.auth_user_id) is not null and a.portal_user_id = coalesce(i.customer_portal_user_id, i.auth_user_id))
             or (nullif(btrim(i.external_account_id), '') is not null and a.external_account_id = nullif(btrim(i.external_account_id), ''))
           )
      );
  end if;
end $$;

-- 7) Add/backfill customer identity columns on common portal child tables for fast lookup and audit.
-- Existing customer_legal_acceptances rows are immutable by trigger, so that table gets
-- schema/index additions only. New acceptance rows must carry the identity snapshot.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'customer_sites',
    'metering_points',
    'customer_contracts',
    'powers_of_attorney',
    'customer_documents',
    'customer_legal_acceptances',
    'customer_notifications',
    'customer_events',
    'website_customer_applications'
  ] loop
    if to_regclass('public.' || v_table) is not null then
      execute format('alter table public.%I add column if not exists customer_number text', v_table);
      execute format('alter table public.%I add column if not exists external_customer_id text', v_table);

      if exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = v_table and column_name = 'company_id'
      ) then
        execute format('create index if not exists %I on public.%I(company_id, customer_number) where customer_number is not null', v_table || '_company_customer_number_idx', v_table);
        execute format('create index if not exists %I on public.%I(company_id, external_customer_id) where external_customer_id is not null', v_table || '_company_external_customer_id_idx', v_table);

        if v_table <> 'customer_legal_acceptances' and exists (
          select 1 from information_schema.columns
           where table_schema = 'public' and table_name = v_table and column_name = 'customer_id'
        ) then
          execute format(
            'update public.%I t set customer_number = coalesce(nullif(btrim(t.customer_number), ''''), c.customer_number), external_customer_id = coalesce(nullif(btrim(t.external_customer_id), ''''), nullif(btrim(c.external_customer_id), '''')) from public.customers c where t.company_id = c.company_id and t.customer_id = c.id and (nullif(btrim(coalesce(t.customer_number, '''')), '''') is null or nullif(btrim(coalesce(t.external_customer_id, '''')), '''') is null)',
            v_table
          );
        end if;
      end if;
    end if;
  end loop;
end $$;
