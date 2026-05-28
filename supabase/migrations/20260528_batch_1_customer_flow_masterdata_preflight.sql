-- Batch 1: Kundflöde, nätägare, nuvarande leverantör och preflight-data.
-- Fix v2: idempotent även om live-DB saknar company_id i äldre masterdata-/operations-tabeller.
-- Ändrar inte godkända Ediel-generatorer.

create extension if not exists pgcrypto;

-- Säkerställ tenant-kolumner där äldre DB kan sakna dem.
alter table if exists public.electricity_suppliers
  add column if not exists company_id uuid references public.companies(id),
  add column if not exists org_number text,
  add column if not exists customer_service_email text,
  add column if not exists switching_email text,
  add column if not exists contract_email text,
  add column if not exists website text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table if exists public.customer_sites
  add column if not exists company_id uuid references public.companies(id),
  add column if not exists current_supplier_id uuid,
  add column if not exists current_supplier_unknown boolean not null default false,
  add column if not exists current_supplier_contract_status text,
  add column if not exists current_supplier_contract_end_date date,
  add column if not exists current_supplier_notice_period text,
  add column if not exists current_supplier_termination_fee numeric,
  add column if not exists current_supplier_response_status text;

alter table if exists public.customer_contracts
  add column if not exists company_id uuid references public.companies(id),
  add column if not exists current_supplier_id uuid,
  add column if not exists current_supplier_name text,
  add column if not exists current_supplier_org_number text,
  add column if not exists current_supplier_contract_status text,
  add column if not exists current_supplier_contract_end_date date,
  add column if not exists current_supplier_notice_period text,
  add column if not exists current_supplier_termination_fee numeric,
  add column if not exists current_supplier_response_status text;

alter table if exists public.supplier_switch_requests
  add column if not exists company_id uuid references public.companies(id),
  add column if not exists current_supplier_id uuid,
  add column if not exists current_supplier_unknown boolean not null default false,
  add column if not exists current_supplier_contract_status text,
  add column if not exists current_supplier_contract_end_date date,
  add column if not exists current_supplier_notice_period text,
  add column if not exists current_supplier_termination_fee numeric,
  add column if not exists current_supplier_response_status text;

-- Backfill company_id från kund där det går. Körs bara när nödvändiga tabeller/kolumner finns.
do $$
begin
  if to_regclass('public.customer_sites') is not null
     and to_regclass('public.customers') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_sites' and column_name = 'company_id')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_sites' and column_name = 'customer_id')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customers' and column_name = 'company_id') then
    update public.customer_sites cs
       set company_id = c.company_id
      from public.customers c
     where cs.customer_id = c.id
       and cs.company_id is null
       and c.company_id is not null;
  end if;

  if to_regclass('public.customer_contracts') is not null
     and to_regclass('public.customers') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_contracts' and column_name = 'company_id')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_contracts' and column_name = 'customer_id')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customers' and column_name = 'company_id') then
    update public.customer_contracts cc
       set company_id = c.company_id
      from public.customers c
     where cc.customer_id = c.id
       and cc.company_id is null
       and c.company_id is not null;
  end if;

  if to_regclass('public.supplier_switch_requests') is not null
     and to_regclass('public.customers') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier_switch_requests' and column_name = 'company_id')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier_switch_requests' and column_name = 'customer_id')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customers' and column_name = 'company_id') then
    update public.supplier_switch_requests ssr
       set company_id = c.company_id
      from public.customers c
     where ssr.customer_id = c.id
       and ssr.company_id is null
       and c.company_id is not null;
  end if;
end $$;

-- Index skapas endast när kolumnerna faktiskt finns.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'electricity_suppliers' and column_name = 'company_id')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'electricity_suppliers' and column_name = 'org_number') then
    execute 'create index if not exists electricity_suppliers_company_org_idx on public.electricity_suppliers(company_id, org_number)';
  end if;

  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'electricity_suppliers' and column_name = 'company_id')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'electricity_suppliers' and column_name = 'ediel_id') then
    execute 'create index if not exists electricity_suppliers_company_ediel_idx on public.electricity_suppliers(company_id, ediel_id)';
  end if;

  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_sites' and column_name = 'company_id')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_sites' and column_name = 'current_supplier_id') then
    execute 'create index if not exists customer_sites_current_supplier_idx on public.customer_sites(company_id, current_supplier_id)';
  end if;

  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier_switch_requests' and column_name = 'company_id')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier_switch_requests' and column_name = 'current_supplier_id') then
    execute 'create index if not exists supplier_switch_requests_current_supplier_idx on public.supplier_switch_requests(company_id, current_supplier_id)';
  end if;
end $$;

-- Kommentarer endast om kolumnerna finns.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_sites' and column_name = 'current_supplier_unknown') then
    comment on column public.customer_sites.current_supplier_unknown is
      'True when admin explicitly marks current supplier as unknown. This should warn but not block customer creation.';
  end if;

  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'electricity_suppliers' and column_name = 'switching_email') then
    comment on column public.electricity_suppliers.switching_email is
      'Preferred email for information requests before supplier switch. Must not be used to start the supplier switch itself.';
  end if;
end $$;
