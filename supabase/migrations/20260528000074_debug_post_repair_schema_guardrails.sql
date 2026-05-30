-- Debug post-repair schema guardrails after live DB alignment
-- Safe additive migration.
-- Purpose: keep repo schema aligned with the live repairs applied during Debug 1B / Step 2 / Step 1+2C.
-- No destructive changes. No tenant assignment. No hardcoded customer/user data.

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Ediel APERAK rule compatibility
-- -----------------------------------------------------------------------------
do $$
begin
  create table if not exists public.ediel_aperak_error_rules (
    id uuid primary key default gen_random_uuid(),
    message_family text,
    message_code text,
    direction text,
    error_key text,
    rule_key text,
    erc_code text,
    ftx_code text,
    ftx_text text,
    application_error text,
    free_text_code text,
    free_text text,
    rule_description text,
    severity text default 'error',
    environment text default 'production',
    is_active boolean default true,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  );

  alter table public.ediel_aperak_error_rules add column if not exists message_family text;
  alter table public.ediel_aperak_error_rules add column if not exists message_code text;
  alter table public.ediel_aperak_error_rules add column if not exists direction text;
  alter table public.ediel_aperak_error_rules add column if not exists error_key text;
  alter table public.ediel_aperak_error_rules add column if not exists rule_key text;
  alter table public.ediel_aperak_error_rules add column if not exists erc_code text;
  alter table public.ediel_aperak_error_rules add column if not exists ftx_code text;
  alter table public.ediel_aperak_error_rules add column if not exists ftx_text text;
  alter table public.ediel_aperak_error_rules add column if not exists application_error text;
  alter table public.ediel_aperak_error_rules add column if not exists free_text_code text;
  alter table public.ediel_aperak_error_rules add column if not exists free_text text;
  alter table public.ediel_aperak_error_rules add column if not exists rule_description text;
  alter table public.ediel_aperak_error_rules add column if not exists severity text default 'error';
  alter table public.ediel_aperak_error_rules add column if not exists environment text default 'production';
  alter table public.ediel_aperak_error_rules add column if not exists is_active boolean default true;
  alter table public.ediel_aperak_error_rules add column if not exists created_at timestamptz default now();
  alter table public.ediel_aperak_error_rules add column if not exists updated_at timestamptz default now();

  update public.ediel_aperak_error_rules
     set rule_key = coalesce(nullif(rule_key, ''), nullif(error_key, '')),
         application_error = coalesce(nullif(application_error, ''), nullif(erc_code, '')),
         free_text_code = coalesce(nullif(free_text_code, ''), nullif(ftx_code, '')),
         free_text = coalesce(nullif(free_text, ''), nullif(ftx_text, '')),
         rule_description = coalesce(nullif(rule_description, ''), nullif(error_key, ''), nullif(rule_key, '')),
         severity = coalesce(nullif(severity, ''), 'error'),
         environment = coalesce(nullif(environment, ''), 'production'),
         is_active = coalesce(is_active, true),
         created_at = coalesce(created_at, now()),
         updated_at = coalesce(updated_at, now())
   where rule_key is null or rule_key = ''
      or application_error is null or application_error = ''
      or free_text_code is null or free_text_code = ''
      or free_text is null or free_text = ''
      or rule_description is null or rule_description = ''
      or severity is null or severity = ''
      or environment is null or environment = ''
      or is_active is null
      or created_at is null
      or updated_at is null;
end $$;

-- -----------------------------------------------------------------------------
-- Customer portal account compatibility
-- -----------------------------------------------------------------------------
do $$
begin
  create table if not exists public.customer_portal_accounts (
    id uuid primary key default gen_random_uuid(),
    company_id uuid,
    user_id uuid,
    customer_id uuid,
    email text,
    user_email text,
    role text default 'owner',
    status text default 'active',
    is_active boolean default true,
    metadata jsonb default '{}'::jsonb,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  );

  alter table public.customer_portal_accounts add column if not exists company_id uuid;
  alter table public.customer_portal_accounts add column if not exists user_id uuid;
  alter table public.customer_portal_accounts add column if not exists customer_id uuid;
  alter table public.customer_portal_accounts add column if not exists email text;
  alter table public.customer_portal_accounts add column if not exists user_email text;
  alter table public.customer_portal_accounts add column if not exists role text default 'owner';
  alter table public.customer_portal_accounts add column if not exists status text default 'active';
  alter table public.customer_portal_accounts add column if not exists is_active boolean default true;
  alter table public.customer_portal_accounts add column if not exists metadata jsonb default '{}'::jsonb;
  alter table public.customer_portal_accounts add column if not exists created_at timestamptz default now();
  alter table public.customer_portal_accounts add column if not exists updated_at timestamptz default now();

  update public.customer_portal_accounts
     set user_email = coalesce(nullif(user_email, ''), nullif(email, '')),
         email = coalesce(nullif(email, ''), nullif(user_email, '')),
         role = coalesce(nullif(role, ''), 'owner'),
         status = coalesce(nullif(status, ''), 'active'),
         is_active = coalesce(is_active, true),
         metadata = coalesce(metadata, '{}'::jsonb),
         created_at = coalesce(created_at, now()),
         updated_at = coalesce(updated_at, now())
   where user_email is null or user_email = ''
      or email is null or email = ''
      or role is null or role = ''
      or status is null or status = ''
      or is_active is null
      or metadata is null
      or created_at is null
      or updated_at is null;
end $$;

-- -----------------------------------------------------------------------------
-- TGT dynamic test data compatibility
-- -----------------------------------------------------------------------------
do $$
begin
  create table if not exists public.ediel_tgt_test_data (
    id uuid primary key default gen_random_uuid(),
    company_id uuid,
    test_suite text,
    role_code text,
    test_case_code text,
    data_key text default 'portal_payload',
    data_value text,
    payload jsonb default '{}'::jsonb,
    title text,
    source_note text,
    raw_text text default '',
    parsed_payload jsonb default '{}'::jsonb,
    is_active boolean default true,
    metadata jsonb default '{}'::jsonb,
    created_at timestamptz default now(),
    updated_at timestamptz default now(),
    created_by uuid,
    updated_by uuid
  );

  alter table public.ediel_tgt_test_data add column if not exists company_id uuid;
  alter table public.ediel_tgt_test_data add column if not exists test_suite text;
  alter table public.ediel_tgt_test_data add column if not exists role_code text;
  alter table public.ediel_tgt_test_data add column if not exists test_case_code text;
  alter table public.ediel_tgt_test_data add column if not exists data_key text default 'portal_payload';
  alter table public.ediel_tgt_test_data add column if not exists data_value text;
  alter table public.ediel_tgt_test_data add column if not exists payload jsonb default '{}'::jsonb;
  alter table public.ediel_tgt_test_data add column if not exists title text;
  alter table public.ediel_tgt_test_data add column if not exists source_note text;
  alter table public.ediel_tgt_test_data add column if not exists raw_text text default '';
  alter table public.ediel_tgt_test_data add column if not exists parsed_payload jsonb default '{}'::jsonb;
  alter table public.ediel_tgt_test_data add column if not exists is_active boolean default true;
  alter table public.ediel_tgt_test_data add column if not exists metadata jsonb default '{}'::jsonb;
  alter table public.ediel_tgt_test_data add column if not exists created_at timestamptz default now();
  alter table public.ediel_tgt_test_data add column if not exists updated_at timestamptz default now();
  alter table public.ediel_tgt_test_data add column if not exists created_by uuid;
  alter table public.ediel_tgt_test_data add column if not exists updated_by uuid;

  alter table public.ediel_tgt_test_data alter column data_key set default 'portal_payload';
  begin
    alter table public.ediel_tgt_test_data alter column data_key drop not null;
  exception when others then
    null;
  end;

  update public.ediel_tgt_test_data
     set data_key = coalesce(nullif(data_key, ''), 'portal_payload'),
         payload = coalesce(payload, '{}'::jsonb),
         raw_text = coalesce(raw_text, ''),
         parsed_payload = case
           when coalesce(parsed_payload, '{}'::jsonb) = '{}'::jsonb and coalesce(payload, '{}'::jsonb) <> '{}'::jsonb then payload
           else coalesce(parsed_payload, '{}'::jsonb)
         end,
         is_active = coalesce(is_active, true),
         metadata = coalesce(metadata, '{}'::jsonb),
         created_at = coalesce(created_at, now()),
         updated_at = coalesce(updated_at, now())
   where data_key is null or data_key = ''
      or payload is null
      or raw_text is null
      or parsed_payload is null
      or is_active is null
      or metadata is null
      or created_at is null
      or updated_at is null;
end $$;

-- -----------------------------------------------------------------------------
-- Customer workspace relation compatibility for runtime indexes/backfills
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.customers') is not null then
    alter table public.customers add column if not exists company_id uuid;
    alter table public.customers add column if not exists updated_at timestamptz default now();
  end if;

  if to_regclass('public.customer_sites') is not null then
    alter table public.customer_sites add column if not exists company_id uuid;
    alter table public.customer_sites add column if not exists customer_id uuid;
    alter table public.customer_sites add column if not exists updated_at timestamptz default now();
  end if;

  if to_regclass('public.metering_points') is not null then
    alter table public.metering_points add column if not exists company_id uuid;
    alter table public.metering_points add column if not exists customer_id uuid;
    alter table public.metering_points add column if not exists site_id uuid;
    alter table public.metering_points add column if not exists updated_at timestamptz default now();
  end if;

  if to_regclass('public.customer_contracts') is not null then
    alter table public.customer_contracts add column if not exists company_id uuid;
    alter table public.customer_contracts add column if not exists customer_id uuid;
    alter table public.customer_contracts add column if not exists site_id uuid;
    alter table public.customer_contracts add column if not exists customer_site_id uuid;
    alter table public.customer_contracts add column if not exists metering_point_id uuid;
    alter table public.customer_contracts add column if not exists updated_at timestamptz default now();

    update public.customer_contracts
       set customer_site_id = coalesce(customer_site_id, site_id),
           updated_at = coalesce(updated_at, now())
     where customer_site_id is null or updated_at is null;
  end if;

  if to_regclass('public.powers_of_attorney') is not null then
    alter table public.powers_of_attorney add column if not exists company_id uuid;
    alter table public.powers_of_attorney add column if not exists customer_id uuid;
    alter table public.powers_of_attorney add column if not exists site_id uuid;
    alter table public.powers_of_attorney add column if not exists customer_site_id uuid;
    alter table public.powers_of_attorney add column if not exists metering_point_id uuid;
    alter table public.powers_of_attorney add column if not exists contract_id uuid;
    alter table public.powers_of_attorney add column if not exists customer_contract_id uuid;
    alter table public.powers_of_attorney add column if not exists updated_at timestamptz default now();
  end if;

  if to_regclass('public.supplier_switch_requests') is not null then
    alter table public.supplier_switch_requests add column if not exists company_id uuid;
    alter table public.supplier_switch_requests add column if not exists customer_id uuid;
    alter table public.supplier_switch_requests add column if not exists site_id uuid;
    alter table public.supplier_switch_requests add column if not exists customer_site_id uuid;
    alter table public.supplier_switch_requests add column if not exists metering_point_id uuid;
    alter table public.supplier_switch_requests add column if not exists contract_id uuid;
    alter table public.supplier_switch_requests add column if not exists customer_contract_id uuid;
    alter table public.supplier_switch_requests add column if not exists power_of_attorney_id uuid;
    alter table public.supplier_switch_requests add column if not exists poa_id uuid;
    alter table public.supplier_switch_requests add column if not exists updated_at timestamptz default now();
  end if;

  if to_regclass('public.outbound_requests') is not null then
    alter table public.outbound_requests add column if not exists company_id uuid;
    alter table public.outbound_requests add column if not exists customer_id uuid;
    alter table public.outbound_requests add column if not exists site_id uuid;
    alter table public.outbound_requests add column if not exists customer_site_id uuid;
    alter table public.outbound_requests add column if not exists metering_point_id uuid;
    alter table public.outbound_requests add column if not exists contract_id uuid;
    alter table public.outbound_requests add column if not exists customer_contract_id uuid;
    alter table public.outbound_requests add column if not exists supplier_switch_request_id uuid;
    alter table public.outbound_requests add column if not exists switch_request_id uuid;
    alter table public.outbound_requests add column if not exists power_of_attorney_id uuid;
    alter table public.outbound_requests add column if not exists poa_id uuid;
    alter table public.outbound_requests add column if not exists source_type text;
    alter table public.outbound_requests add column if not exists source_id uuid;
    alter table public.outbound_requests add column if not exists entity_type text;
    alter table public.outbound_requests add column if not exists entity_id uuid;
    alter table public.outbound_requests add column if not exists payload jsonb default '{}'::jsonb;
    alter table public.outbound_requests add column if not exists metadata jsonb default '{}'::jsonb;
    alter table public.outbound_requests add column if not exists updated_at timestamptz default now();
  end if;
end $$;

-- Non-blocking runtime indexes guarded after compatibility columns exist.
do $$
begin
  if to_regclass('public.customer_contracts') is not null then
    create index if not exists idx_customer_contracts_company_customer_site
      on public.customer_contracts(company_id, customer_id, coalesce(customer_site_id, site_id));
  end if;

  if to_regclass('public.ediel_tgt_test_data') is not null then
    create unique index if not exists ediel_tgt_test_data_suite_role_case_uidx
      on public.ediel_tgt_test_data(test_suite, role_code, test_case_code)
      where test_suite is not null and test_case_code is not null;
  end if;
end $$;
