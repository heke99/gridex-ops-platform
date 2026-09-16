-- Restore the two inline REFERENCES clauses skipped by ADD COLUMN IF NOT EXISTS.
-- F138 creates customer_documents.contract_id before T64 declares its FK.
-- The residual before F100 creates ediel_route_profiles.actor_setting_id before T12.
-- Preserve the original single-column targets and ON DELETE SET NULL actions.
-- Reject orphaned data and unknown predecessor definitions; never rewrite rows.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local search_path = pg_catalog, public;
set local row_security = off;

do $repair$
declare
  relation_name text;
  spec record;
  child_oid oid;
  parent_oid oid;
  child_column smallint;
  parent_column smallint;
  existing pg_constraint%rowtype;
  has_orphans boolean;
  phase integer;
begin
  -- Lock all four relations before checking data, preventing races with inserts,
  -- FK-column updates, parent deletion and concurrent constraint replacement.
  foreach relation_name in array array[
    'customer_contracts', 'customer_documents',
    'ediel_actor_settings', 'ediel_route_profiles'
  ] loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                   where n.nspname='public' and c.relname=relation_name and c.relkind='r') then
      raise exception using errcode='55000', message='EXISTING_COLUMN_FK_RELATION_REQUIRED';
    end if;
    execute format('lock table public.%I in share row exclusive mode', relation_name);
  end loop;

  -- Phase 1 rejects every orphan before any constraint is added. Phase 2 adds or
  -- validates only the authored FKs and verifies their exact catalog semantics.
  for phase in 1..2 loop
    for spec in select * from (values
      ('customer_documents', 'contract_id', 'customer_contracts', 'customer_documents_contract_id_fkey'),
      ('ediel_route_profiles', 'actor_setting_id', 'ediel_actor_settings', 'ediel_route_profiles_actor_setting_id_fkey')
    ) as pairs(child_table, child_key, parent_table, constraint_name) loop
      child_oid := to_regclass(format('public.%I', spec.child_table));
      parent_oid := to_regclass(format('public.%I', spec.parent_table));
      select attnum into child_column from pg_attribute
       where attrelid=child_oid and attname=spec.child_key and not attisdropped
         and atttypid='uuid'::regtype and not attnotnull;
      select attnum into parent_column from pg_attribute
       where attrelid=parent_oid and attname='id' and not attisdropped and atttypid='uuid'::regtype;
      if child_column is null or parent_column is null then
        raise exception using errcode='55000', message='EXISTING_COLUMN_FK_COLUMN_SHAPE';
      end if;
      if phase=1 then
        execute format('select exists (select 1 from public.%I c where c.%I is not null '
                       'and not exists (select 1 from public.%I p where p.id=c.%I))',
                       spec.child_table, spec.child_key, spec.parent_table, spec.child_key)
          into has_orphans;
        if has_orphans then
          raise exception using errcode='23503', message='EXISTING_COLUMN_FK_ORPHANS';
        end if;
        continue;
      end if;

      select * into existing from pg_constraint
       where conrelid=child_oid and conname=spec.constraint_name;
      if not found then
        execute format('alter table public.%I add constraint %I foreign key (%I) '
                       'references public.%I(id) on update no action on delete set null',
                       spec.child_table, spec.constraint_name, spec.child_key, spec.parent_table);
        select * into existing from pg_constraint
         where conrelid=child_oid and conname=spec.constraint_name;
      end if;
      if existing.contype is distinct from 'f' or existing.confrelid is distinct from parent_oid
         or existing.conkey is distinct from array[child_column]::smallint[]
         or existing.confkey is distinct from array[parent_column]::smallint[]
         or existing.confmatchtype is distinct from 's'
         or existing.confupdtype is distinct from 'a' or existing.confdeltype is distinct from 'n'
         or existing.condeferrable or existing.condeferred or existing.confdelsetcols is not null
         or existing.conparentid<>0 or not existing.conislocal or existing.coninhcount<>0 then
        raise exception using errcode='55000', message='EXISTING_COLUMN_FK_UNKNOWN_CONSTRAINT';
      end if;
      if not existing.convalidated then
        execute format('alter table public.%I validate constraint %I', spec.child_table, spec.constraint_name);
      end if;
      if not exists (select 1 from pg_constraint where oid=existing.oid and convalidated) then
        raise exception using errcode='55000', message='EXISTING_COLUMN_FK_VALIDATION_REQUIRED';
      end if;
    end loop;
  end loop;
end $repair$;
commit;
