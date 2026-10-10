-- OPS API review F31 (2026-10-07): remove two verified duplicate indexes.
--
-- Each pair has identical definitions, no constraint owner and 16 kB size.
-- The canonical index of each pair is kept; a duplicate is dropped only when
-- its twin still exists with the same column list and predicate, so
-- uniqueness and query plans are unchanged.

do $dedupe$
declare
  pair record;
begin
  for pair in
    select * from (values
      ('ux_customers_company_customer_number', 'customers_company_customer_number_uk'),
      ('idx_fk_customer_case_events_b634ce08bab5', 'customer_case_events_customer_idx')
    ) as p(duplicate_name, keep_name)
  loop
    if to_regclass('public.' || pair.duplicate_name) is null then
      continue;
    end if;
    if to_regclass('public.' || pair.keep_name) is null then
      raise notice 'keeping % because % is missing', pair.duplicate_name, pair.keep_name;
      continue;
    end if;
    if exists (
      select 1
        from pg_index d, pg_index k
       where d.indexrelid = ('public.' || pair.duplicate_name)::regclass
         and k.indexrelid = ('public.' || pair.keep_name)::regclass
         and d.indrelid = k.indrelid
         and d.indkey = k.indkey
         and d.indisunique = k.indisunique
         and d.indclass = k.indclass
         and coalesce(pg_get_expr(d.indpred, d.indrelid), '') = coalesce(pg_get_expr(k.indpred, k.indrelid), '')
         and coalesce(pg_get_expr(d.indexprs, d.indrelid), '') = coalesce(pg_get_expr(k.indexprs, k.indrelid), '')
         and not exists (select 1 from pg_constraint c where c.conindid = d.indexrelid)
    ) then
      execute format('drop index public.%I', pair.duplicate_name);
    else
      raise notice 'keeping % because it is not an exact duplicate of %', pair.duplicate_name, pair.keep_name;
    end if;
  end loop;
end
$dedupe$;
