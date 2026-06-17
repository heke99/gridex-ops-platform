-- Website API / Customer Portal hardening.
-- Safe/idempotent: no deletes, no tenant moves, no blind customer merges.
-- Fixes: real POA rows from website acceptances, external/customer-number separation,
-- canonical Gridex website identity provider, richer portal bundle backing data,
-- and signed-only webhook delivery readiness.

create extension if not exists pgcrypto;

-- 1) Customer portal identities: allow customer_number and external ids to be separate.
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

    update public.customer_portal_identities i
       set customer_number = coalesce(nullif(btrim(i.customer_number), ''), c.customer_number),
           email = coalesce(nullif(btrim(i.email), ''), c.email),
           external_customer_id = case
             when nullif(btrim(i.external_customer_id), '') = c.customer_number then null
             else nullif(btrim(i.external_customer_id), '')
           end,
           updated_at = now()
      from public.customers c
     where i.company_id = c.company_id
       and i.customer_id = c.id;

    update public.customer_portal_identities i
       set provider = 'gridex_website',
           updated_at = now()
     where i.provider in ('external_website', 'gridex_customer_portal', 'customer_portal_accounts')
       and not exists (
         select 1
           from public.customer_portal_identities x
          where x.company_id = i.company_id
            and x.provider = 'gridex_website'
            and coalesce(x.external_customer_id, '') = coalesce(i.external_customer_id, '')
            and coalesce(x.customer_id::text, '') = coalesce(i.customer_id::text, '')
       );

    create index if not exists customer_portal_identities_company_customer_number_idx
      on public.customer_portal_identities(company_id, customer_number)
      where customer_number is not null;
    create index if not exists customer_portal_identities_company_auth_user_idx
      on public.customer_portal_identities(company_id, auth_user_id)
      where auth_user_id is not null;
    create index if not exists customer_portal_identities_company_portal_user_idx
      on public.customer_portal_identities(company_id, customer_portal_user_id)
      where customer_portal_user_id is not null;
    create index if not exists customer_portal_identities_company_provider_customer_idx
      on public.customer_portal_identities(company_id, provider, customer_id)
      where customer_id is not null;
  end if;
end $$;

-- 2) If customers has external_customer_id, do not mirror customer_number into it.
do $$
begin
  if to_regclass('public.customers') is not null
     and exists (
       select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'customers'
          and column_name = 'external_customer_id'
     ) then
    begin
      alter table public.customers alter column external_customer_id drop not null;
    exception when others then
      null;
    end;

    update public.customers
       set external_customer_id = null,
           updated_at = now()
     where nullif(btrim(external_customer_id), '') = nullif(btrim(customer_number), '');
  end if;
end $$;

-- 3) Backfill portal accounts safely from already-linked identities and customers.
do $$
begin
  if to_regclass('public.customer_portal_accounts') is not null
     and to_regclass('public.customer_portal_identities') is not null
     and to_regclass('public.customers') is not null then
    alter table public.customer_portal_accounts
      add column if not exists company_id uuid,
      add column if not exists role text not null default 'owner',
      add column if not exists email text,
      add column if not exists user_email text,
      add column if not exists status text,
      add column if not exists is_active boolean not null default true,
      add column if not exists activated_at timestamptz,
      add column if not exists verified_at timestamptz,
      add column if not exists match_method text not null default 'manual',
      add column if not exists verified_identity_snapshot jsonb not null default '{}'::jsonb,
      add column if not exists metadata jsonb not null default '{}'::jsonb;

    update public.customer_portal_accounts a
       set company_id = coalesce(a.company_id, c.company_id),
           role = case when a.role in ('owner','billing','viewer') then a.role else 'owner' end,
           email = coalesce(nullif(btrim(a.email), ''), nullif(btrim(a.user_email), ''), c.email),
           user_email = coalesce(nullif(btrim(a.user_email), ''), nullif(btrim(a.email), ''), c.email),
           status = coalesce(nullif(btrim(a.status), ''), 'active'),
           is_active = coalesce(a.is_active, true)
      from public.customers c
     where a.customer_id = c.id;
  end if;
end $$;

-- 4) Harden POA schema and create missing POA rows from previous website acceptances.
-- Important: never assume the live powers_of_attorney.status enum/check value.
-- The current OPS workflow uses 'signed', but this block reads the live check constraint
-- and chooses the first valid production-safe status instead of blindly inserting 'active'.
do $$
declare
  v_status_constraint text;
  v_poa_status text := 'signed';
begin
  if to_regclass('public.powers_of_attorney') is null
     or to_regclass('public.customer_legal_acceptances') is null then
    return;
  end if;

  alter table public.powers_of_attorney
    add column if not exists contract_id uuid,
    add column if not exists customer_site_id uuid,
    add column if not exists accepted_at timestamptz,
    add column if not exists valid_until date,
    add column if not exists legal_text_version_id uuid,
    add column if not exists fullmakt_snapshot jsonb not null default '{}'::jsonb,
    add column if not exists accepted_ip text,
    add column if not exists accepted_ip_hash text,
    add column if not exists accepted_user_agent text,
    add column if not exists accepted_source text default 'admin_manual',
    add column if not exists scope_summary jsonb not null default '{}'::jsonb;

  create index if not exists powers_of_attorney_company_customer_contract_idx
    on public.powers_of_attorney(company_id, customer_id, contract_id, scope, status)
    where contract_id is not null;

  select string_agg(pg_get_constraintdef(c.oid), ' ')
    into v_status_constraint
    from pg_constraint c
   where c.conrelid = 'public.powers_of_attorney'::regclass
     and c.contype = 'c'
     and (
       c.conname = 'powers_of_attorney_status_check'
       or pg_get_constraintdef(c.oid) ilike '%status%'
     );

  if v_status_constraint is null then
    v_poa_status := 'signed';
  elsif v_status_constraint ilike '%''signed''%' then
    v_poa_status := 'signed';
  elsif v_status_constraint ilike '%''accepted''%' then
    v_poa_status := 'accepted';
  elsif v_status_constraint ilike '%''completed''%' then
    v_poa_status := 'completed';
  elsif v_status_constraint ilike '%''approved''%' then
    v_poa_status := 'approved';
  elsif v_status_constraint ilike '%''valid''%' then
    v_poa_status := 'valid';
  elsif v_status_constraint ilike '%''draft''%' then
    -- Last safe fallback. This keeps migration green without widening production constraints.
    -- If live DB only allows draft/revoked/expired, the POA workflow constraint must be fixed separately.
    v_poa_status := 'draft';
  else
    raise exception 'Could not determine allowed powers_of_attorney.status from constraint: %', v_status_constraint;
  end if;

  insert into public.powers_of_attorney (
    company_id,
    customer_id,
    contract_id,
    customer_site_id,
    site_id,
    metering_point_id,
    scope,
    status,
    signed_at,
    accepted_at,
    valid_from,
    legal_text_version_id,
    fullmakt_snapshot,
    accepted_ip,
    accepted_ip_hash,
    accepted_user_agent,
    accepted_source,
    reference,
    scope_summary,
    metadata,
    created_at,
    updated_at
  )
  select
    a.company_id,
    a.customer_id,
    a.contract_id,
    coalesce(c.customer_site_id, c.site_id),
    coalesce(c.customer_site_id, c.site_id),
    c.metering_point_id,
    'supplier_switch',
    v_poa_status,
    a.accepted_at,
    a.accepted_at,
    a.accepted_at::date,
    a.legal_text_version_id,
    coalesce(a.snapshot, '{}'::jsonb),
    a.accepted_ip,
    a.accepted_ip_hash,
    a.accepted_user_agent,
    'website',
    'POA-' || coalesce(a.contract_application_id::text, a.id::text),
    jsonb_build_object(
      'supplier_switch', true,
      'contract_id', a.contract_id,
      'customer_site_id', coalesce(c.customer_site_id, c.site_id),
      'metering_point_id', c.metering_point_id,
      'status_chosen_from_live_constraint', v_poa_status
    ),
    jsonb_build_object(
      'source', 'website_customer_applications_backfill',
      'customer_legal_acceptance_id', a.id,
      'contract_application_id', a.contract_application_id,
      'backfilled_at', now(),
      'status_chosen_from_live_constraint', v_poa_status
    ),
    coalesce(a.accepted_at, now()),
    now()
  from public.customer_legal_acceptances a
  left join public.customer_contracts c
    on c.id = a.contract_id
  where a.acceptance_type = 'power_of_attorney'
    and a.source = 'website'
    and not exists (
      select 1
        from public.powers_of_attorney p
       where p.company_id = a.company_id
         and p.customer_id = a.customer_id
         and p.scope = 'supplier_switch'
         and coalesce(p.contract_id::text, '') = coalesce(a.contract_id::text, '')
         and p.status = v_poa_status
    );

  if to_regclass('public.power_of_attorney_scopes') is not null then
    alter table public.power_of_attorney_scopes
      add column if not exists status text default 'active';

    insert into public.power_of_attorney_scopes (
      company_id,
      power_of_attorney_id,
      customer_id,
      site_id,
      metering_point_id,
      customer_contract_id,
      scope_type,
      status,
      is_active,
      valid_from,
      metadata,
      created_at,
      updated_at
    )
    select
      p.company_id,
      p.id,
      p.customer_id,
      coalesce(p.customer_site_id, p.site_id),
      p.metering_point_id,
      p.contract_id,
      'supplier_switch',
      'active',
      true,
      coalesce(p.valid_from, p.accepted_at::date, now()::date),
      jsonb_build_object(
        'source', 'website_customer_applications_backfill',
        'power_of_attorney_id', p.id,
        'poa_status', p.status
      ),
      now(),
      now()
    from public.powers_of_attorney p
    where p.accepted_source = 'website'
      and p.status = v_poa_status
      and not exists (
        select 1 from public.power_of_attorney_scopes s
         where s.power_of_attorney_id = p.id
           and s.scope_type = 'supplier_switch'
      );
  end if;
end $$;

-- 5) Backfill site/contract linkage where website application stored richer context.
do $$
begin
  if to_regclass('public.website_customer_applications') is not null
     and to_regclass('public.customer_contracts') is not null then
    alter table public.customer_contracts
      add column if not exists website_application_id uuid,
      add column if not exists application_snapshot jsonb not null default '{}'::jsonb,
      add column if not exists legal_acceptance_snapshot jsonb not null default '{}'::jsonb;

    update public.customer_contracts c
       set website_application_id = coalesce(c.website_application_id, a.id),
           application_snapshot = case
             when c.application_snapshot = '{}'::jsonb then coalesce(a.payload, '{}'::jsonb)
             else c.application_snapshot
           end,
           updated_at = now()
      from public.website_customer_applications a
     where a.contract_id = c.id
       and c.company_id = a.company_id;
  end if;
end $$;

-- 6) Webhook subscriptions must be signable before active dispatch.
do $$
begin
  if to_regclass('public.webhook_subscriptions') is not null then
    alter table public.webhook_subscriptions
      add column if not exists signing_secret_ref text,
      add column if not exists signing_secret_hash text,
      add column if not exists status_reason text;

    update public.webhook_subscriptions
       set status_reason = coalesce(status_reason, 'signing_secret_missing'),
           updated_at = now()
     where status = 'active'
       and nullif(btrim(coalesce(signing_secret_ref, '')), '') is null
       and nullif(btrim(coalesce(signing_secret_hash, '')), '') is null;

    create index if not exists webhook_subscriptions_company_status_secret_idx
      on public.webhook_subscriptions(company_id, status, signing_secret_ref, created_at desc);
  end if;
end $$;
