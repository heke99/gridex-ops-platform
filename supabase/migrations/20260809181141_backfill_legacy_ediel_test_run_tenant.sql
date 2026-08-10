begin;
set local search_path=public,pg_catalog;
do $$
declare
  v_target_count integer;
begin
  select count(*)::integer into v_target_count
  from public.companies where test_ediel_id='92825';
  if v_target_count <> 1 then
    raise exception 'legacy_ediel_test_tenant_not_unique:%',v_target_count;
  end if;
  if exists(select 1 from public.ediel_test_runs where company_id is null) then
    raise exception 'legacy_ediel_test_run_company_backfill_incomplete';
  end if;
end;
$$;
commit;
