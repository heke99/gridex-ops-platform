-- Read-only; suitable for the fully replayed canonical database and live catalog.
do $$
declare
  guard_table text;
begin
  if to_regprocedure('public.gridex_assert_same_company(uuid,uuid,text,text)') is null then
    raise exception 'Missing canonical same-company assertion helper';
  end if;
  if not exists (select 1 from pg_proc p
    where p.oid = 'public.gridex_assert_same_company(uuid,uuid,text,text)'::regprocedure
      and not p.prosecdef and p.proconfig @> array['search_path=public, pg_temp']
      and has_function_privilege('authenticated',p.oid,'EXECUTE')
      and has_function_privilege('service_role',p.oid,'EXECUTE')) then
    raise exception 'Unsafe or inaccessible canonical same-company assertion helper';
  end if;
  foreach guard_table in array array[
    'customer_sites', 'metering_points', 'customer_contracts',
    'customer_legal_acceptances', 'powers_of_attorney', 'billing_underlays',
    'contract_price_snapshots'
  ] loop
    if not exists (
      select 1 from pg_trigger t
      join pg_proc p on p.oid = t.tgfoid
      join pg_namespace n on n.oid = p.pronamespace
      where t.tgrelid = to_regclass('public.' || guard_table)
        and t.tgname = 'gridex_' || guard_table || '_company_guard_tg'
        and p.proname = 'gridex_' || guard_table || '_company_guard'
        and n.nspname = 'public' and not p.prosecdef
        and p.proconfig @> array['search_path=public, pg_temp']
        and t.tgtype = 23 and t.tgenabled = 'O' and not t.tgisinternal
    ) then
      raise exception 'Missing or unsafe canonical tenant guard: %', guard_table;
    end if;
  end loop;
end;
$$;
