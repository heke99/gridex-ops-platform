-- Restore the tenant guards omitted by the historical replay input plan.
-- Source: 20260615_multitenant_integrity_and_claim_locks.sql (immutable).
-- Definitions/columns checked against canonical schema and live catalog 2026-09-05.
-- Preserve existing behavior: nullable/missing parents remain FK/RLS concerns;
-- billing's customer_contract_id takes precedence over contract_id as in live.
-- Do NOT replace the newer contract_price_snapshots guard: it correctly uses
-- contract_id only and rejects missing/unknown contracts. Only attach its trigger.
-- No data backfill, SECURITY DEFINER, new RLS bypass, or historical ledger repair.

begin;

create or replace function public.gridex_assert_same_company(
  p_child_company_id uuid,
  p_parent_company_id uuid,
  p_child_table text,
  p_reference_column text
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_child_company_id is not null
     and p_parent_company_id is not null
     and p_child_company_id <> p_parent_company_id then
    raise exception 'Cross-tenant reference blocked: %.% does not belong to company_id %',
      p_child_table, p_reference_column, p_child_company_id
      using errcode = '23514';
  end if;
end;
$$;

create or replace function public.gridex_customer_sites_company_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  parent_company_id uuid;
begin
  if new.customer_id is not null and to_regclass('public.customers') is not null then
    select company_id into parent_company_id from public.customers where id = new.customer_id;
    perform public.gridex_assert_same_company(new.company_id, parent_company_id, TG_TABLE_NAME, 'customer_id');
  end if;
  return new;
end;
$$;

create or replace function public.gridex_metering_points_company_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  parent_company_id uuid;
begin
  if new.customer_id is not null and to_regclass('public.customers') is not null then
    select company_id into parent_company_id from public.customers where id = new.customer_id;
    perform public.gridex_assert_same_company(new.company_id, parent_company_id, TG_TABLE_NAME, 'customer_id');
  end if;

  if new.site_id is not null and to_regclass('public.customer_sites') is not null then
    select company_id into parent_company_id from public.customer_sites where id = new.site_id;
    perform public.gridex_assert_same_company(new.company_id, parent_company_id, TG_TABLE_NAME, 'site_id');
  end if;

  return new;
end;
$$;

create or replace function public.gridex_customer_contracts_company_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  parent_company_id uuid;
begin
  if new.customer_id is not null and to_regclass('public.customers') is not null then
    select company_id into parent_company_id from public.customers where id = new.customer_id;
    perform public.gridex_assert_same_company(new.company_id, parent_company_id, TG_TABLE_NAME, 'customer_id');
  end if;

  if new.site_id is not null and to_regclass('public.customer_sites') is not null then
    select company_id into parent_company_id from public.customer_sites where id = new.site_id;
    perform public.gridex_assert_same_company(new.company_id, parent_company_id, TG_TABLE_NAME, 'site_id');
  end if;

  if new.customer_site_id is not null and to_regclass('public.customer_sites') is not null then
    select company_id into parent_company_id from public.customer_sites where id = new.customer_site_id;
    perform public.gridex_assert_same_company(new.company_id, parent_company_id, TG_TABLE_NAME, 'customer_site_id');
  end if;

  if new.metering_point_id is not null and to_regclass('public.metering_points') is not null then
    select company_id into parent_company_id from public.metering_points where id = new.metering_point_id;
    perform public.gridex_assert_same_company(new.company_id, parent_company_id, TG_TABLE_NAME, 'metering_point_id');
  end if;

  return new;
end;
$$;

create or replace function public.gridex_customer_legal_acceptances_company_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  parent_company_id uuid;
begin
  if new.customer_id is not null and to_regclass('public.customers') is not null then
    select company_id into parent_company_id from public.customers where id = new.customer_id;
    perform public.gridex_assert_same_company(new.company_id, parent_company_id, TG_TABLE_NAME, 'customer_id');
  end if;
  if new.contract_id is not null and to_regclass('public.customer_contracts') is not null then
    select company_id into parent_company_id from public.customer_contracts where id = new.contract_id;
    perform public.gridex_assert_same_company(new.company_id, parent_company_id, TG_TABLE_NAME, 'contract_id');
  end if;
  return new;
end;
$$;

create or replace function public.gridex_powers_of_attorney_company_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  parent_company_id uuid;
begin
  if new.customer_id is not null and to_regclass('public.customers') is not null then
    select company_id into parent_company_id from public.customers where id = new.customer_id;
    perform public.gridex_assert_same_company(new.company_id, parent_company_id, TG_TABLE_NAME, 'customer_id');
  end if;
  if new.site_id is not null and to_regclass('public.customer_sites') is not null then
    select company_id into parent_company_id from public.customer_sites where id = new.site_id;
    perform public.gridex_assert_same_company(new.company_id, parent_company_id, TG_TABLE_NAME, 'site_id');
  end if;
  if new.metering_point_id is not null and to_regclass('public.metering_points') is not null then
    select company_id into parent_company_id from public.metering_points where id = new.metering_point_id;
    perform public.gridex_assert_same_company(new.company_id, parent_company_id, TG_TABLE_NAME, 'metering_point_id');
  end if;
  return new;
end;
$$;

create or replace function public.gridex_billing_underlays_company_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  parent_company_id uuid;
begin
  if new.customer_id is not null and to_regclass('public.customers') is not null then
    select company_id into parent_company_id from public.customers where id = new.customer_id;
    perform public.gridex_assert_same_company(new.company_id, parent_company_id, TG_TABLE_NAME, 'customer_id');
  end if;
  if new.customer_contract_id is not null and to_regclass('public.customer_contracts') is not null then
    select company_id into parent_company_id from public.customer_contracts where id = new.customer_contract_id;
    perform public.gridex_assert_same_company(new.company_id, parent_company_id, TG_TABLE_NAME, 'customer_contract_id');
  elsif new.contract_id is not null and to_regclass('public.customer_contracts') is not null then
    select company_id into parent_company_id from public.customer_contracts where id = new.contract_id;
    perform public.gridex_assert_same_company(new.company_id, parent_company_id, TG_TABLE_NAME, 'contract_id');
  end if;
  if new.site_id is not null and to_regclass('public.customer_sites') is not null then
    select company_id into parent_company_id from public.customer_sites where id = new.site_id;
    perform public.gridex_assert_same_company(new.company_id, parent_company_id, TG_TABLE_NAME, 'site_id');
  end if;
  if new.metering_point_id is not null and to_regclass('public.metering_points') is not null then
    select company_id into parent_company_id from public.metering_points where id = new.metering_point_id;
    perform public.gridex_assert_same_company(new.company_id, parent_company_id, TG_TABLE_NAME, 'metering_point_id');
  end if;
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.customer_sites') is not null then
    drop trigger if exists gridex_customer_sites_company_guard_tg on public.customer_sites;
    create trigger gridex_customer_sites_company_guard_tg before insert or update on public.customer_sites
      for each row execute function public.gridex_customer_sites_company_guard();
  end if;

  if to_regclass('public.metering_points') is not null then
    drop trigger if exists gridex_metering_points_company_guard_tg on public.metering_points;
    create trigger gridex_metering_points_company_guard_tg before insert or update on public.metering_points
      for each row execute function public.gridex_metering_points_company_guard();
  end if;

  if to_regclass('public.customer_contracts') is not null then
    drop trigger if exists gridex_customer_contracts_company_guard_tg on public.customer_contracts;
    create trigger gridex_customer_contracts_company_guard_tg before insert or update on public.customer_contracts
      for each row execute function public.gridex_customer_contracts_company_guard();
  end if;

  if to_regclass('public.contract_price_snapshots') is not null then
    drop trigger if exists gridex_contract_price_snapshots_company_guard_tg on public.contract_price_snapshots;
    create trigger gridex_contract_price_snapshots_company_guard_tg before insert or update on public.contract_price_snapshots
      for each row execute function public.gridex_contract_price_snapshots_company_guard();
  end if;

  if to_regclass('public.customer_legal_acceptances') is not null then
    drop trigger if exists gridex_customer_legal_acceptances_company_guard_tg on public.customer_legal_acceptances;
    create trigger gridex_customer_legal_acceptances_company_guard_tg before insert or update on public.customer_legal_acceptances
      for each row execute function public.gridex_customer_legal_acceptances_company_guard();
  end if;

  if to_regclass('public.powers_of_attorney') is not null then
    drop trigger if exists gridex_powers_of_attorney_company_guard_tg on public.powers_of_attorney;
    create trigger gridex_powers_of_attorney_company_guard_tg before insert or update on public.powers_of_attorney
      for each row execute function public.gridex_powers_of_attorney_company_guard();
  end if;

  if to_regclass('public.billing_underlays') is not null then
    drop trigger if exists gridex_billing_underlays_company_guard_tg on public.billing_underlays;
    create trigger gridex_billing_underlays_company_guard_tg before insert or update on public.billing_underlays
      for each row execute function public.gridex_billing_underlays_company_guard();
  end if;
end $$;



-- Trigger functions cannot be called as ordinary RPC functions. Preserve the
-- live invoker ACLs explicitly for deterministic replay. The assertion helper
-- is side-effect-free and must remain callable from authenticated invoker guards.
-- Do not alter the newer snapshot guard's separately hardened ACL.
do $$
declare function_name text;
begin
  foreach function_name in array array[
    'gridex_customer_sites_company_guard', 'gridex_metering_points_company_guard',
    'gridex_customer_contracts_company_guard', 'gridex_customer_legal_acceptances_company_guard',
    'gridex_powers_of_attorney_company_guard', 'gridex_billing_underlays_company_guard'
  ] loop
    execute format('grant execute on function public.%I() to public, anon, authenticated, service_role', function_name);
  end loop;
end $$;
grant execute on function public.gridex_assert_same_company(uuid,uuid,text,text)
  to public, anon, authenticated, service_role;

commit;
