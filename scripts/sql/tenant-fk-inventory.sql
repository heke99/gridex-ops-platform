-- DB-02 tenant FK inventory (read-only). Returns one JSON document.
-- Used by scripts/tenant-fk-inventory.mjs against PGlite (schema snapshot) or a
-- native replay/live database via DATABASE_URL. Never writes.
with tenant_tables as (
  select a.attrelid as relid
  from pg_attribute a
  join pg_class r on r.oid = a.attrelid and r.relkind in ('r', 'p')
  join pg_namespace n on n.oid = r.relnamespace
  where a.attname = 'company_id' and a.attnum > 0 and not a.attisdropped
    and n.nspname not in ('pg_catalog', 'information_schema', 'auth', 'storage', 'extensions')
),
single_fks as (
  select c.conrelid::regclass::text as child, a.attname::text as col,
         c.confrelid::regclass::text as parent, c.conname::text as conname
  from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
  where c.contype = 'f' and array_length(c.conkey, 1) = 1
    and c.conrelid in (select relid from tenant_tables)
    and c.confrelid in (select relid from tenant_tables)
    and a.attname <> 'company_id'
),
composite_fks as (
  select c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent,
         c.conname::text as conname,
         (select array_agg(att.attname::text order by k.ord)
            from unnest(c.conkey) with ordinality k(attnum, ord)
            join pg_attribute att on att.attrelid = c.conrelid and att.attnum = k.attnum) as cols
  from pg_constraint c
  where c.contype = 'f' and array_length(c.conkey, 1) > 1
    and c.conrelid in (select relid from tenant_tables)
    and exists (select 1 from pg_attribute att where att.attrelid = c.conrelid
                and att.attnum = any (c.conkey) and att.attname = 'company_id')
),
company_id_unique as (
  select i.indrelid::regclass::text as tbl, ic.relname::text as index_name
  from pg_index i
  join pg_class ic on ic.oid = i.indexrelid
  where i.indisunique and i.indnatts = 2 and i.indpred is null
    and i.indrelid in (select relid from tenant_tables)
    and (select array_agg(att.attname::text order by att.attname)
           from pg_attribute att where att.attrelid = i.indrelid and att.attnum = any (i.indkey::int2[]))
        = array['company_id', 'id']
),
period_tables as (
  select r.oid::regclass::text as tbl, p.pair
  from pg_class r
  join pg_namespace n on n.oid = r.relnamespace
  cross join (values ('valid_from/valid_to', 'valid_from', 'valid_to'),
                     ('starts_on/ends_on', 'starts_on', 'ends_on'),
                     ('start_date/end_date', 'start_date', 'end_date')) p(pair, lo, hi)
  where r.relkind in ('r', 'p')
    and n.nspname not in ('pg_catalog', 'information_schema', 'auth', 'storage', 'extensions')
    and exists (select 1 from pg_attribute a where a.attrelid = r.oid and a.attname = p.lo and not a.attisdropped)
    and exists (select 1 from pg_attribute a where a.attrelid = r.oid and a.attname = p.hi and not a.attisdropped)
    and not exists (select 1 from pg_constraint x where x.conrelid = r.oid and x.contype = 'x')
)
select json_build_object(
  'tenant_table_count', (select count(*) from tenant_tables),
  'single_tenant_fks', coalesce((select json_agg(json_build_object('child', child, 'col', col, 'parent', parent, 'conname', conname)
                                   order by child, col, conname) from single_fks), '[]'::json),
  'composite_tenant_fks', coalesce((select json_agg(json_build_object('child', child, 'cols', cols, 'parent', parent, 'conname', conname)
                                   order by child, conname) from composite_fks), '[]'::json),
  'company_id_id_unique', coalesce((select json_agg(json_build_object('table', tbl, 'index', index_name)
                                   order by tbl, index_name) from company_id_unique), '[]'::json),
  'period_tables_without_exclude', coalesce((select json_agg(json_build_object('table', tbl, 'columns', pair)
                                   order by tbl, pair) from period_tables), '[]'::json)
) as inventory;
