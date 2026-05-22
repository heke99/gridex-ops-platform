-- Batch 4 — multi-anläggning, möjlig dubblett, fakturaadress och samlingsfaktura.
-- Migrationen är defensiv för att kunna köras mot äldre tenant-databaser.

create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.customers') is not null then
    alter table public.customers add column if not exists possible_duplicate boolean not null default false;
    alter table public.customers add column if not exists duplicate_review_status text not null default 'clear';
    alter table public.customers add column if not exists duplicate_match_payload jsonb not null default '[]'::jsonb;
    alter table public.customers add column if not exists invoice_recipient text;
    alter table public.customers add column if not exists invoice_email text;
    alter table public.customers add column if not exists invoice_reference text;
    alter table public.customers add column if not exists billing_street text;
    alter table public.customers add column if not exists billing_postal_code text;
    alter table public.customers add column if not exists billing_city text;
    alter table public.customers add column if not exists billing_country text not null default 'SE';
    alter table public.customers add column if not exists billing_address_same_as_site boolean not null default false;
    alter table public.customers add column if not exists billing_level text not null default 'customer';
    alter table public.customers add column if not exists consolidated_invoice boolean not null default false;
  end if;

  if to_regclass('public.customer_sites') is not null then
    alter table public.customer_sites add column if not exists invoice_recipient text;
    alter table public.customer_sites add column if not exists invoice_email text;
    alter table public.customer_sites add column if not exists invoice_reference text;
    alter table public.customer_sites add column if not exists billing_street text;
    alter table public.customer_sites add column if not exists billing_postal_code text;
    alter table public.customer_sites add column if not exists billing_city text;
    alter table public.customer_sites add column if not exists billing_country text not null default 'SE';
    alter table public.customer_sites add column if not exists billing_address_same_as_site boolean not null default false;
    alter table public.customer_sites add column if not exists billing_level text not null default 'customer';
    alter table public.customer_sites add column if not exists consolidated_invoice boolean not null default false;
  end if;

  if to_regclass('public.customer_addresses') is not null then
    alter table public.customer_addresses add column if not exists recipient_name text;
    alter table public.customer_addresses add column if not exists invoice_email text;
    alter table public.customer_addresses add column if not exists invoice_reference text;
    alter table public.customer_addresses add column if not exists is_default_billing boolean not null default false;
  end if;

  if to_regclass('public.customer_contracts') is not null then
    alter table public.customer_contracts add column if not exists invoice_recipient text;
    alter table public.customer_contracts add column if not exists invoice_email text;
    alter table public.customer_contracts add column if not exists invoice_reference text;
    alter table public.customer_contracts add column if not exists billing_street text;
    alter table public.customer_contracts add column if not exists billing_postal_code text;
    alter table public.customer_contracts add column if not exists billing_city text;
    alter table public.customer_contracts add column if not exists billing_country text not null default 'SE';
    alter table public.customer_contracts add column if not exists billing_address_same_as_site boolean not null default false;
    alter table public.customer_contracts add column if not exists billing_level text not null default 'customer';
    alter table public.customer_contracts add column if not exists consolidated_invoice boolean not null default false;
  end if;

  if to_regclass('public.customer_import_rows') is not null then
    alter table public.customer_import_rows add column if not exists resolution text;
    alter table public.customer_import_rows add column if not exists possible_existing_customer_id uuid;
    alter table public.customer_import_rows add column if not exists duplicate_match_payload jsonb not null default '[]'::jsonb;
  end if;

  if to_regclass('public.billing_export_run_items') is not null then
    alter table public.billing_export_run_items add column if not exists invoice_recipient text;
    alter table public.billing_export_run_items add column if not exists invoice_email text;
    alter table public.billing_export_run_items add column if not exists invoice_reference text;
    alter table public.billing_export_run_items add column if not exists billing_level text;
    alter table public.billing_export_run_items add column if not exists consolidated_invoice boolean not null default false;
    alter table public.billing_export_run_items add column if not exists consolidated_invoice_group_key text;
    alter table public.billing_export_run_items add column if not exists invoice_address_snapshot jsonb not null default '{}'::jsonb;
    alter table public.billing_export_run_items add column if not exists site_address_snapshot jsonb not null default '{}'::jsonb;
  end if;
end $$;

create table if not exists public.customer_duplicate_resolution_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  customer_id uuid,
  existing_customer_id uuid,
  import_row_id uuid,
  resolution text not null,
  severity text,
  match_payload jsonb not null default '[]'::jsonb,
  note text,
  reason text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.power_of_attorney_scopes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  power_of_attorney_id uuid not null,
  customer_id uuid,
  site_id uuid,
  metering_point_id uuid,
  customer_contract_id uuid,
  scope_type text not null default 'customer',
  created_by uuid,
  created_at timestamptz not null default now()
);

do $$
begin
  if to_regclass('public.customers') is not null then
    create index if not exists customers_company_possible_duplicate_idx
      on public.customers(company_id, possible_duplicate, duplicate_review_status);
    create index if not exists customers_company_billing_flags_idx
      on public.customers(company_id, consolidated_invoice, billing_level);
    create index if not exists customers_company_lower_email_idx
      on public.customers(company_id, lower(email)) where email is not null;
    create index if not exists customers_company_phone_idx
      on public.customers(company_id, phone) where phone is not null;
  end if;

  if to_regclass('public.customer_sites') is not null then
    create index if not exists customer_sites_company_customer_idx
      on public.customer_sites(company_id, customer_id);
    create index if not exists customer_sites_company_facility_idx
      on public.customer_sites(company_id, facility_id) where facility_id is not null;
    create index if not exists customer_sites_company_billing_idx
      on public.customer_sites(company_id, consolidated_invoice, billing_level);
  end if;

  if to_regclass('public.metering_points') is not null then
    create index if not exists metering_points_company_meter_point_idx
      on public.metering_points(company_id, meter_point_id) where meter_point_id is not null;
  end if;

  if to_regclass('public.customer_contracts') is not null then
    create index if not exists customer_contracts_company_billing_idx
      on public.customer_contracts(company_id, consolidated_invoice, billing_level);
  end if;

  create index if not exists customer_duplicate_resolution_events_company_created_idx
    on public.customer_duplicate_resolution_events(company_id, created_at desc);
  create index if not exists customer_duplicate_resolution_events_customer_idx
    on public.customer_duplicate_resolution_events(company_id, customer_id);

  create index if not exists power_of_attorney_scopes_company_poa_idx
    on public.power_of_attorney_scopes(company_id, power_of_attorney_id);
  create index if not exists power_of_attorney_scopes_company_site_idx
    on public.power_of_attorney_scopes(company_id, site_id) where site_id is not null;
  create index if not exists power_of_attorney_scopes_company_metering_idx
    on public.power_of_attorney_scopes(company_id, metering_point_id) where metering_point_id is not null;
end $$;

alter table public.customer_duplicate_resolution_events enable row level security;
alter table public.power_of_attorney_scopes enable row level security;

-- Policies skapas endast om samma helper-tabeller som resten av plattformen använder finns.
do $$
begin
  if to_regclass('public.company_memberships') is not null then
    drop policy if exists customer_duplicate_resolution_events_company_members on public.customer_duplicate_resolution_events;
    create policy customer_duplicate_resolution_events_company_members
      on public.customer_duplicate_resolution_events
      for all
      using (
        exists (
          select 1 from public.company_memberships cm
          where cm.company_id = customer_duplicate_resolution_events.company_id
            and cm.user_id = auth.uid()
        )
      )
      with check (
        exists (
          select 1 from public.company_memberships cm
          where cm.company_id = customer_duplicate_resolution_events.company_id
            and cm.user_id = auth.uid()
        )
      );

    drop policy if exists power_of_attorney_scopes_company_members on public.power_of_attorney_scopes;
    create policy power_of_attorney_scopes_company_members
      on public.power_of_attorney_scopes
      for all
      using (
        exists (
          select 1 from public.company_memberships cm
          where cm.company_id = power_of_attorney_scopes.company_id
            and cm.user_id = auth.uid()
        )
      )
      with check (
        exists (
          select 1 from public.company_memberships cm
          where cm.company_id = power_of_attorney_scopes.company_id
            and cm.user_id = auth.uid()
        )
      );
  end if;
end $$;
