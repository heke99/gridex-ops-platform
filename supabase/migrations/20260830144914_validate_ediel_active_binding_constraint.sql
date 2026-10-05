do $migration$
begin
  if to_regclass('public.ediel_active_test_configurations') is null then
    raise notice 'ediel_active_test_configurations is absent; skipping constraint validation';
    return;
  end if;

  if exists (
    select 1
    from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    join pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'public'
      and r.relname = 'ediel_active_test_configurations'
      and c.conname = 'ediel_active_test_configurations_active_binding_required'
      and not c.convalidated
  ) then
    execute 'alter table public.ediel_active_test_configurations validate constraint ediel_active_test_configurations_active_binding_required';
  end if;
end
$migration$;
