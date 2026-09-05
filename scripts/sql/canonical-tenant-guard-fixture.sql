-- ISOLATED EMPTY DATABASE ONLY. Never execute this fixture in production.
-- Minimal real table shapes for guard behavior; not canonical replay evidence.
do $$ begin
  if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
             where n.nspname='public' and c.relkind in ('r','p','v','m')) then
    raise exception 'Tenant guard fixture requires an empty public schema';
  end if;
end $$;
create role anon;
create role authenticated;
create role service_role;
create table public.customers (id uuid primary key, company_id uuid);
create table public.customer_sites (id uuid primary key, company_id uuid, customer_id uuid);
create table public.metering_points (id uuid primary key, company_id uuid, customer_id uuid, site_id uuid);
create table public.customer_contracts (id uuid primary key, company_id uuid, customer_id uuid, site_id uuid, customer_site_id uuid, metering_point_id uuid);
create table public.customer_legal_acceptances (id uuid primary key, company_id uuid, customer_id uuid, contract_id uuid);
create table public.powers_of_attorney (id uuid primary key, company_id uuid, customer_id uuid, site_id uuid, metering_point_id uuid);
create table public.billing_underlays (id uuid primary key, company_id uuid, customer_id uuid, customer_contract_id uuid, contract_id uuid, site_id uuid, metering_point_id uuid);
-- Deliberately no obsolete customer_contract_id field on price snapshots.
create table public.contract_price_snapshots (id uuid primary key, company_id uuid, contract_id uuid);
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
do $$ declare parent_table text; begin
  foreach parent_table in array array['customers','customer_sites','metering_points','customer_contracts'] loop
    execute format('insert into public.%I(id,company_id) values
      (''00000000-0000-0000-0000-000000000001'',''10000000-0000-0000-0000-000000000001''),
      (''00000000-0000-0000-0000-000000000002'',''10000000-0000-0000-0000-000000000002'')',parent_table);
  end loop;
end $$;
