-- F-12: lock the customer chain in the schema.
--
-- The composite pattern already covered 22 of the 99 tables carrying customer_id
-- -- the money and legal path: contracts, invoices, sites, metering points, powers
-- of attorney, supplier switches, billing underlays. On the other 77 a document, a
-- contact, an address, an internal note or a notification could be attached to the
-- wrong customer, or to the right customer under the wrong company, with nothing
-- in the schema objecting. Nothing was wrong in the data; nothing prevented it
-- either, and because the application runs on service_role the only protection was
-- code discipline.
--
-- A composite (customer_id, company_id) -> customers(id, company_id) key closes
-- both axes at once: same customer AND same tenant. MATCH SIMPLE means rows where
-- either column is NULL are not checked, so mixed-scope tables keep working.
--
-- Preflight before applying: zero violating rows across all 51 tables that already
-- had a single-column customer FK.
--
-- Forward-only.

begin;

alter table public.customers
  drop constraint if exists customers_id_company_uk;

alter table public.customers
  add constraint customers_id_company_uk unique (id, company_id);

-- Step 1: tables that already reference customers get the composite key.
do $$
declare
  v_table record;
  v_added integer := 0;
  v_constraint text;
begin
  for v_table in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where c.relkind = 'r'
      and c.relname <> 'customers'
      and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'customer_id' and not a.attisdropped)
      and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped)
      and exists (
        select 1 from pg_constraint k
        where k.conrelid = c.oid and k.contype = 'f' and k.confrelid = 'public.customers'::regclass
      )
      and not exists (
        select 1 from pg_constraint k
        where k.conrelid = c.oid and k.contype = 'f'
          and k.confrelid = 'public.customers'::regclass and array_length(k.conkey, 1) > 1
      )
    order by c.relname
  loop
    v_constraint := left(v_table.relname || '_customer_company_fk', 63);
    execute format(
      'alter table public.%I add constraint %I
         foreign key (customer_id, company_id) references public.customers(id, company_id)
         on update cascade on delete cascade',
      v_table.relname, v_constraint
    );
    v_added := v_added + 1;
  end loop;

  raise notice 'F-12: added % composite customer/company foreign keys', v_added;
end
$$;

-- Step 2: 26 tenant tables carried customer_id with no foreign key to customers at
-- all, so a customer id could dangle -- and two already do. ediel_message_intents
-- (3 rows) and route_decision_logs (29 rows) reference customers that no longer
-- exist. Verified: none is a cross-tenant mis-attribution; every orphan points at
-- a deleted customer.
--
-- Clean tables get a validated key. The two with orphans get the same key NOT
-- VALID, so every new row is checked while the historical rows are preserved for
-- audit rather than deleted here. The invariant gate reports them until whoever
-- owns that data decides.
do $$
declare
  v_table record;
  v_constraint text;
  v_valid integer := 0;
  v_not_valid integer := 0;
begin
  for v_table in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    join public.platform_table_classification t on t.table_name = c.relname and t.kind = 'tenant'
    where c.relkind = 'r'
      and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'customer_id' and not a.attisdropped)
      and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped)
      and not exists (
        select 1 from pg_constraint k
        where k.conrelid = c.oid and k.contype = 'f' and k.confrelid = 'public.customers'::regclass
      )
    order by c.relname
  loop
    v_constraint := left(v_table.relname || '_customer_company_fk', 63);

    begin
      execute format(
        'alter table public.%I add constraint %I
           foreign key (customer_id, company_id) references public.customers(id, company_id)
           on update cascade on delete set null',
        v_table.relname, v_constraint
      );
      v_valid := v_valid + 1;
    exception when foreign_key_violation then
      execute format(
        'alter table public.%I add constraint %I
           foreign key (customer_id, company_id) references public.customers(id, company_id)
           on update cascade on delete set null
           not valid',
        v_table.relname, v_constraint
      );
      v_not_valid := v_not_valid + 1;
      raise notice 'F-12: % has pre-existing orphan customer ids; key added NOT VALID', v_table.relname;
    end;
  end loop;

  raise notice 'F-12: % validated and % not-valid composite customer keys added', v_valid, v_not_valid;
end
$$;

commit;
