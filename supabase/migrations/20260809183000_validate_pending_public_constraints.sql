-- Validate the historical public constraints that were introduced NOT VALID.
--
-- `NOT VALID` is useful for online constraint introduction, but it must not be
-- the permanent integrity state. This forward-only migration validates every
-- pending public FK/CHECK constraint that exists at this point in the migration
-- history. Any historical violation aborts the migration so the offending data
-- is repaired explicitly rather than silently accepted.

begin;
set local search_path = public, pg_catalog;

do $$
declare
  v_constraint record;
  v_before integer;
begin
  select count(*)::integer
    into v_before
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and not c.convalidated
    and c.contype in ('f', 'c');

  for v_constraint in
    select
      n.nspname as schema_name,
      t.relname as table_name,
      c.conname as constraint_name
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and not c.convalidated
      and c.contype in ('f', 'c')
    order by t.relname, c.conname
  loop
    execute format(
      'alter table %I.%I validate constraint %I',
      v_constraint.schema_name,
      v_constraint.table_name,
      v_constraint.constraint_name
    );
  end loop;

  if exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and not c.convalidated
      and c.contype in ('f', 'c')
  ) then
    raise exception 'public_constraint_validation_incomplete';
  end if;

  raise notice 'validated % pending public FK/CHECK constraints', v_before;
end;
$$;

commit;
