-- Radera alla testkunder (12 st) och de 8 syntetiska testföretagen i produktion.
-- Kör hela filen i Supabase SQL editor. Allt sker i en transaktion.
-- Förutsätter att ops_purge_20261010.tgt redan är fylld (gjordes 2026-10-10:
-- 12 kunder, 8 företag "Synthetic staff API ...", ~2 400 beroende rader, kontrollerat
-- att inget utanför testdatan ingår).

begin;
set local session_replication_role = replica;

do $$
declare r record; n int; cids uuid[]; coids uuid[];
begin
  select array_agg(id) into cids from ops_purge_20261010.tgt where tbl = 'customers';
  select array_agg(id) into coids from ops_purge_20261010.tgt where tbl = 'companies';

  -- Tabeller utan id-kolumn som pekar på raderade rader
  for r in
    select con.conrelid::regclass::text rel, con.confrelid::regclass::text ref,
      (select string_agg(format('c.%I = p.%I', a1.attname, a2.attname), ' and ')
         from unnest(con.conkey, con.confkey) k(c1, c2)
         join pg_attribute a1 on a1.attrelid = con.conrelid and a1.attnum = k.c1
         join pg_attribute a2 on a2.attrelid = con.confrelid and a2.attnum = k.c2) cond
    from pg_constraint con
    where con.contype = 'f' and con.connamespace = 'public'::regnamespace
      and con.confrelid::regclass::text in (select distinct tbl from ops_purge_20261010.tgt)
      and not exists (select 1 from pg_attribute a where a.attrelid = con.conrelid and a.attname = 'id' and not a.attisdropped)
  loop
    execute format('delete from %s c using %s p where %s and p.id in (select id from ops_purge_20261010.tgt where tbl = %L)', r.rel, r.ref, r.cond, r.ref);
    get diagnostics n = row_count;
    raise notice 'nofk % : %', r.rel, n;
  end loop;

  -- Hela beroendegrafen, djupast först
  for r in select tbl from ops_purge_20261010.tgt group by tbl order by max(depth) desc loop
    execute format('delete from public.%I where id in (select id from ops_purge_20261010.tgt where tbl = %L)', r.tbl, r.tbl);
    get diagnostics n = row_count;
    raise notice '% : %', r.tbl, n;
  end loop;

  -- Rester utan foreign key (customer_id / company_id)
  for r in
    select c.table_name, c.column_name
    from information_schema.columns c
    join information_schema.tables t using (table_schema, table_name)
    where c.table_schema = 'public' and t.table_type = 'BASE TABLE' and c.data_type = 'uuid'
      and c.column_name in ('customer_id', 'company_id')
  loop
    execute format('delete from public.%I where %I = any(%L::uuid[])', r.table_name, r.column_name,
      case when r.column_name = 'customer_id' then cids else coids end);
    get diagnostics n = row_count;
    if n > 0 then raise notice 'rest %.% : %', r.table_name, r.column_name, n; end if;
  end loop;
end $$;

-- Kontroll: ska visa 0 kunder och 3 företag kvar
select (select count(*) from public.customers) kunder,
       (select count(*) from public.companies) foretag;

commit;

drop schema ops_purge_20261010 cascade;
