\set ON_ERROR_STOP on
\pset pager off

-- Re-run preflight first, then validate only constraints whose legacy data is clean.
\i scripts/canonical-multitenant-preflight.sql

select conrelid::regclass as table_name,
       conname as constraint_name,
       contype,
       convalidated
  from pg_constraint
 where connamespace = 'public'::regnamespace
   and left(conname, 3) = 'mt_'
 order by convalidated, table_name::text, constraint_name;

-- Generate explicit validation commands for operator review. Run only after the
-- preflight reports zero conflicts for the relevant relation.
select format('alter table %s validate constraint %I;', conrelid::regclass, conname) as validation_sql
  from pg_constraint
 where connamespace = 'public'::regnamespace
   and left(conname, 3) = 'mt_'
   and not convalidated
 order by conrelid::regclass::text, conname;
