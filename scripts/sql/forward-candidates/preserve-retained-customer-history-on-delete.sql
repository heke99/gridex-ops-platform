-- Retain optional customer history and its known tenant when a customer is deleted.
-- The four original single-column SET NULL FKs remain untouched. Make their
-- overlapping composite actions agree; the sync journal must not lose company_id.
-- Admit only the five exact validated predecessor shapes or this final shape.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local search_path = pg_catalog, public;

do $repair$
declare
  table_name text;
  child oid;
  parent oid := to_regclass('public.customers');
  customer_column smallint;
  company_column smallint;
  parent_id smallint;
  parent_company smallint;
  existing pg_constraint%rowtype;
  previous_comment text;
  names constant text[] := array['billing_disputes', 'customer_import_rows',
    'customer_sync_events', 'data_quality_findings', 'document_parse_jobs'];
begin
  if parent is null or not exists(select 1 from pg_class where oid=parent and relkind='r')
     or exists(select 1 from pg_inherits where inhrelid=parent or inhparent=parent) then
    raise exception using errcode='55000', message='RETAINED_HISTORY_ORDINARY_PARENT_REQUIRED';
  end if;
  lock table public.customers in share row exclusive mode;
  -- Acquire every target lock before checking or replacing any constraint.
  foreach table_name in array names loop
    child := to_regclass(format('public.%I', table_name));
    if child is null or not exists(select 1 from pg_class where oid=child and relkind='r')
       or exists(select 1 from pg_inherits where inhrelid=child or inhparent=child) then
      raise exception using errcode='55000', message='RETAINED_HISTORY_ORDINARY_CHILD_REQUIRED';
    end if;
    execute format('lock table public.%I in share row exclusive mode', table_name);
  end loop;
  -- Recheck relation shape under all acquired locks, including a waiter that
  -- observed concurrent DDL between initial admission and lock acquisition.
  if parent is distinct from to_regclass('public.customers')
     or not exists(select 1 from pg_class where oid=parent and relkind='r')
     or exists(select 1 from pg_inherits where inhrelid=parent or inhparent=parent) then
    raise exception using errcode='55000', message='RETAINED_HISTORY_ORDINARY_PARENT_REQUIRED';
  end if;
  select attnum into parent_id from pg_attribute where attrelid=parent and attname='id'
    and atttypid='uuid'::regtype and attnum>0 and not attisdropped and attnotnull;
  select attnum into parent_company from pg_attribute where attrelid=parent and attname='company_id'
    and atttypid='uuid'::regtype and attnum>0 and not attisdropped and not attnotnull;
  if parent_id is null or parent_company is null then
    raise exception using errcode='55000', message='RETAINED_HISTORY_PARENT_COLUMNS_REQUIRED';
  end if;
  foreach table_name in array names loop
    child := to_regclass(format('public.%I', table_name));
    if not exists(select 1 from pg_class where oid=child and relkind='r')
       or exists(select 1 from pg_inherits where inhrelid=child or inhparent=child) then
      raise exception using errcode='55000', message='RETAINED_HISTORY_ORDINARY_CHILD_REQUIRED';
    end if;
    select attnum into customer_column from pg_attribute where attrelid=child and attname='customer_id'
      and atttypid='uuid'::regtype and attnum>0 and not attisdropped and not attnotnull;
    select attnum into company_column from pg_attribute where attrelid=child and attname='company_id'
      and atttypid='uuid'::regtype and attnum>0 and not attisdropped
      and attnotnull=(table_name not in ('customer_sync_events','data_quality_findings'));
    if customer_column is null or company_column is null then
      raise exception using errcode='55000', message='RETAINED_HISTORY_CHILD_COLUMNS_REQUIRED';
    end if;
    select * into existing from pg_constraint where conrelid=child and conname=table_name||'_customer_company_fk';
    if not found then
      raise exception using errcode='55000', message='RETAINED_HISTORY_EXACT_FK_REQUIRED';
    end if;
    if existing.contype<>'f' or existing.confrelid<>parent
       or existing.conkey<>array[customer_column,company_column]
       or existing.confkey<>array[parent_id,parent_company]
       or existing.confmatchtype<>'s' or existing.confupdtype<>'c'
       or not existing.convalidated or existing.condeferrable or existing.condeferred
       or existing.conparentid<>0 or existing.coninhcount<>0 or not existing.conislocal
       or not ((existing.confdeltype=case when table_name='customer_sync_events' then 'n'::"char" else 'c'::"char" end
                 and existing.confdelsetcols is null)
               or (existing.confdeltype='n' and existing.confdelsetcols=array[customer_column])) then
      raise exception using errcode='55000', message='RETAINED_HISTORY_UNKNOWN_FK_PREDECESSOR';
    end if;
  end loop;
  foreach table_name in array names loop
    child := to_regclass(format('public.%I', table_name));
    select * into existing from pg_constraint where conrelid=child and conname=table_name||'_customer_company_fk';
    if existing.confdelsetcols is not null then
      continue;
    end if;
    previous_comment := obj_description(existing.oid,'pg_constraint');
    execute format('alter table public.%I drop constraint %I', table_name, existing.conname);
    execute format('alter table public.%I add constraint %I foreign key (customer_id, company_id) '
      'references public.customers(id, company_id) on update cascade on delete set null (customer_id)',
      table_name, existing.conname);
    if previous_comment is not null then
      execute format('comment on constraint %I on public.%I is %L', existing.conname, table_name, previous_comment);
    end if;
  end loop;
end
$repair$;
commit;
