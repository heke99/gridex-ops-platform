-- Preserve tenant ownership when detaching an Ediel intent from a deleted customer.
-- This physical relationship must not depend on Data API grants/classification.
-- Only an absent key or the exact historical SET NULL predecessor is admitted.
-- Existing orphan/cross-tenant rows block validation; no business row is erased.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local search_path = pg_catalog, public;

do $repair$
declare
  child oid := to_regclass('public.ediel_message_intents');
  parent oid := to_regclass('public.customers');
  child_customer smallint;
  child_company smallint;
  parent_id smallint;
  parent_company smallint;
  existing pg_constraint%rowtype;
  previous_comment text;
begin
  if child is null or parent is null then
    raise exception using errcode = '55000', message = 'EDIEL_CUSTOMER_RELATIONS_REQUIRED';
  end if;
  -- Same lock order for retries; all mutation stays in this transaction.
  lock table public.customers in share row exclusive mode;
  lock table public.ediel_message_intents in share row exclusive mode;

  select attnum into child_customer from pg_attribute
    where attrelid = child and attname = 'customer_id' and atttypid = 'uuid'::regtype
      and attnum > 0 and not attisdropped and not attnotnull;
  select attnum into child_company from pg_attribute
    where attrelid = child and attname = 'company_id' and atttypid = 'uuid'::regtype
      and attnum > 0 and not attisdropped and attnotnull;
  select attnum into parent_id from pg_attribute
    where attrelid = parent and attname = 'id' and atttypid = 'uuid'::regtype
      and attnum > 0 and not attisdropped and attnotnull;
  -- Historical customers.company_id is nullable. The child company stays NOT
  -- NULL; the composite key still rejects references to an unassigned customer.
  select attnum into parent_company from pg_attribute
    where attrelid = parent and attname = 'company_id' and atttypid = 'uuid'::regtype
      and attnum > 0 and not attisdropped;
  if child_customer is null or child_company is null or parent_id is null or parent_company is null then
    raise exception using errcode = '55000', message = 'EDIEL_CUSTOMER_COLUMN_CONTRACT_REQUIRED';
  end if;

  select * into existing from pg_constraint
    where conrelid = child and conname = 'ediel_message_intents_customer_company_fk';
  if found then
    if existing.contype <> 'f' or existing.confrelid <> parent
       or existing.conkey <> array[child_customer, child_company]
       or existing.confkey <> array[parent_id, parent_company]
       or existing.confmatchtype <> 's' or existing.confupdtype <> 'c'
       or existing.confdeltype <> 'n' or existing.condeferrable or existing.condeferred
       or (existing.confdelsetcols is not null and existing.confdelsetcols <> array[child_customer]) then
      raise exception using errcode = '55000', message = 'EDIEL_CUSTOMER_UNKNOWN_FK_PREDECESSOR';
    end if;
    if existing.confdelsetcols = array[child_customer] then
      if not existing.convalidated then
        alter table public.ediel_message_intents validate constraint ediel_message_intents_customer_company_fk;
      end if;
      return;
    end if;
    previous_comment := obj_description(existing.oid, 'pg_constraint');
    alter table public.ediel_message_intents drop constraint ediel_message_intents_customer_company_fk;
  end if;

  alter table public.ediel_message_intents
    add constraint ediel_message_intents_customer_company_fk
    foreign key (customer_id, company_id) references public.customers (id, company_id)
    on update cascade on delete set null (customer_id);
  if previous_comment is not null then
    execute format('comment on constraint ediel_message_intents_customer_company_fk on public.ediel_message_intents is %L', previous_comment);
  end if;
end
$repair$;
commit;
