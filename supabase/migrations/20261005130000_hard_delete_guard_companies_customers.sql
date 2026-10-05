-- DB-05 / F-DB-05-01: a raw DELETE of a company or customer must not silently
-- cascade away audit, journal and billing history (265 ON DELETE CASCADE
-- foreign keys hang off companies/customers).
--
-- Guard, not an FK rewrite (owner decision 2026-10-05): the cascade stays for
-- the two sanctioned paths and everything else is refused.
--   companies : only a disposable tenant (status = 'deleted_test_only') or the
--               database owner roles (migrations / maintenance).
--   customers : only the database owner roles (this is what the
--               SECURITY DEFINER command gridex_delete_test_customer_v1 runs
--               as). customers.company_id is NO ACTION, so no company delete
--               ever cascades into customers.
-- service_role / authenticated / anon directly are refused with 23001.
-- Independent review (2026-10-05) closed two bypasses:
--   * status shortcut: only owner roles (incl. SECURITY DEFINER lifecycle
--     commands) may move a company into 'deleted_test_only';
--   * TRUNCATE skips row triggers: a statement guard refuses TRUNCATE by
--     non-owner roles on companies, customers and every table referencing them.
-- Forward-only; retention-class purge workflows remain separate.

create or replace function public.gridex_guard_company_hard_delete_v1()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if current_user in ('postgres', 'supabase_admin') or old.status = 'deleted_test_only' then
    return old;
  end if;
  raise exception using
    errcode = '23001',
    message = 'company_hard_delete_blocked',
    detail = 'Retained audit, journal and billing history would be cascaded away; close the tenant through canonical_transition_tenant_lifecycle.';
end
$function$;

create or replace function public.gridex_guard_customer_hard_delete_v1()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if current_user in ('postgres', 'supabase_admin') then
    return old;
  end if;
  raise exception using
    errcode = '23001',
    message = 'customer_hard_delete_blocked',
    detail = 'Use gridex_delete_test_customer_v1 for test customers; real customers keep their history.';
end
$function$;

revoke all on function public.gridex_guard_company_hard_delete_v1() from public, anon, authenticated, service_role;
revoke all on function public.gridex_guard_customer_hard_delete_v1() from public, anon, authenticated, service_role;

drop trigger if exists gridex_companies_hard_delete_guard on public.companies;
create trigger gridex_companies_hard_delete_guard
  before delete on public.companies
  for each row execute function public.gridex_guard_company_hard_delete_v1();

drop trigger if exists gridex_customers_hard_delete_guard on public.customers;
create trigger gridex_customers_hard_delete_guard
  before delete on public.customers
  for each row execute function public.gridex_guard_customer_hard_delete_v1();

create or replace function public.gridex_guard_company_disposable_status_v1()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.status = 'deleted_test_only'
     and old.status is distinct from 'deleted_test_only'
     and current_user not in ('postgres', 'supabase_admin') then
    raise exception using
      errcode = '23001',
      message = 'company_disposable_status_blocked',
      detail = 'Only the canonical lifecycle command may mark a tenant disposable.';
  end if;
  return new;
end
$function$;

create or replace function public.gridex_guard_history_truncate_v1()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if current_user in ('postgres', 'supabase_admin') then
    return null;
  end if;
  raise exception using
    errcode = '23001',
    message = 'history_truncate_blocked',
    detail = format('TRUNCATE of %I.%I would remove retained history.', tg_table_schema, tg_table_name);
end
$function$;

revoke all on function public.gridex_guard_company_disposable_status_v1() from public, anon, authenticated, service_role;
revoke all on function public.gridex_guard_history_truncate_v1() from public, anon, authenticated, service_role;

drop trigger if exists gridex_companies_disposable_status_guard on public.companies;
create trigger gridex_companies_disposable_status_guard
  before update of status on public.companies
  for each row execute function public.gridex_guard_company_disposable_status_v1();

do $guard$
declare
  t regclass;
begin
  for t in
    select distinct c.oid::regclass
    from pg_class c
    where c.oid in ('public.companies'::regclass, 'public.customers'::regclass)
       or c.oid in (
         select con.conrelid from pg_constraint con
         where con.contype = 'f'
           and con.confrelid in ('public.companies'::regclass, 'public.customers'::regclass))
  loop
    execute format('drop trigger if exists gridex_history_truncate_guard on %s', t);
    execute format('create trigger gridex_history_truncate_guard before truncate on %s for each statement execute function public.gridex_guard_history_truncate_v1()', t);
  end loop;
end
$guard$;
