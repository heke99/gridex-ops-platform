-- Repair the current canonical table for the existing, explicitly invoked
-- customer-case lifecycle producer. Historical NULL-source decisions are not
-- backfilled or rewritten. Existing RLS, grants and caller authority stay intact.
alter table public.customer_lifecycle_decisions
  add column if not exists source_customer_case_id uuid null,
  add column if not exists received_at timestamptz null,
  add column if not exists received_channel text null,
  add column if not exists notes text null;

do $migration$
declare
  v_column text;
  v_type text;
begin
  for v_column, v_type in
    select * from (values
      ('source_customer_case_id', 'uuid'),
      ('received_at', 'timestamp with time zone'),
      ('received_channel', 'text'),
      ('notes', 'text')
    ) as expected(column_name, type_name)
  loop
    if not exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = 'public.customer_lifecycle_decisions'::regclass
        and a.attname = v_column and not a.attisdropped and not a.attnotnull
        and pg_catalog.format_type(a.atttypid, a.atttypmod) = v_type
    ) then
      raise exception using errcode = 'P0001', message = 'lifecycle_source_schema_incompatible';
    end if;
  end loop;
end
$migration$;

alter table public.customer_lifecycle_decisions
  drop constraint customer_lifecycle_decisions_decision_type_check;
alter table public.customer_lifecycle_decisions
  add constraint customer_lifecycle_decisions_decision_type_check
  check (decision_type in ('withdrawal', 'cancelled', 'rejected'));

-- Abort, rather than rewrite, any incompatible pre-existing sourced duplicates.
create unique index customer_lifecycle_decisions_case_type_unique_v1
  on public.customer_lifecycle_decisions(source_customer_case_id, decision_type)
  where source_customer_case_id is not null;

create function private.gridex_lifecycle_case_binding_v1()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
declare
  v_case public.customer_cases%rowtype;
  v_site public.customer_sites%rowtype;
  v_point public.metering_points%rowtype;
  v_contract public.customer_contracts%rowtype;
  v_decision_type text;
  v_scope_type text;
  v_scope_id uuid;
begin
  if tg_op = 'UPDATE' and old.source_customer_case_id is not null and (
    new.source_customer_case_id is distinct from old.source_customer_case_id or
    new.company_id is distinct from old.company_id or
    new.customer_id is distinct from old.customer_id or
    new.decision_type is distinct from old.decision_type or
    new.scope_type is distinct from old.scope_type or
    new.scope_id is distinct from old.scope_id
  ) then
    raise exception using errcode = '23514', message = 'lifecycle_case_source_binding_immutable';
  end if;
  if new.source_customer_case_id is null then return new; end if;

  -- Case and related resource locks last for this INSERT/UPDATE transaction.
  -- They do not make the surrounding legacy operational-stop graph atomic.
  select c.* into v_case from public.customer_cases c
  where c.id = new.source_customer_case_id for share;
  if not found then
    raise exception using errcode = '23503', message = 'lifecycle_source_case_missing';
  end if;

  v_decision_type := case
    when v_case.case_type = 'withdrawal' then 'withdrawal'
    when v_case.case_type in ('onboarding_aborted', 'supplier_switch_aborted') then 'cancelled'
    when v_case.case_type in (
      'rejected_customer', 'binding_period_too_long', 'incorrect_identity',
      'incorrect_site_data', 'missing_authorization', 'credit_risk', 'technical_blocker'
    ) then 'rejected'
    else null
  end;
  v_scope_type := case
    when v_case.metering_point_id is not null then 'metering_point'
    when v_case.site_id is not null then 'site'
    when v_case.customer_contract_id is not null then 'contract'
    else 'customer'
  end;
  v_scope_id := coalesce(v_case.metering_point_id, v_case.site_id, v_case.customer_contract_id);
  if v_decision_type is null or
    new.company_id is distinct from v_case.company_id or
    new.customer_id is distinct from v_case.customer_id or
    new.decision_type is distinct from v_decision_type or
    new.scope_type is distinct from v_scope_type or
    new.scope_id is distinct from v_scope_id or not new.billing_blocked
  then
    raise exception using errcode = '23514', message = 'lifecycle_case_source_binding_mismatch';
  end if;

  perform 1 from public.customers c
  where c.id = v_case.customer_id and c.company_id = v_case.company_id for share;
  if not found then
    raise exception using errcode = '23514', message = 'lifecycle_case_customer_mismatch';
  end if;

  if v_case.site_id is not null then
    select s.* into v_site from public.customer_sites s where s.id = v_case.site_id for share;
    if not found or v_site.company_id is distinct from v_case.company_id or
      v_site.customer_id is distinct from v_case.customer_id then
      raise exception using errcode = '23514', message = 'lifecycle_case_site_mismatch';
    end if;
  end if;
  if v_case.metering_point_id is not null then
    select p.* into v_point from public.metering_points p where p.id = v_case.metering_point_id for share;
    if not found or v_point.company_id is distinct from v_case.company_id or
      v_point.customer_id is distinct from v_case.customer_id or (
        v_case.site_id is not null and
        coalesce(v_point.site_id, v_point.customer_site_id) is distinct from v_case.site_id
      ) then
      raise exception using errcode = '23514', message = 'lifecycle_case_point_mismatch';
    end if;
  end if;
  if v_case.customer_contract_id is not null then
    select c.* into v_contract from public.customer_contracts c where c.id = v_case.customer_contract_id for share;
    if not found or v_contract.company_id is distinct from v_case.company_id or
      v_contract.customer_id is distinct from v_case.customer_id or (
        v_case.site_id is not null and coalesce(v_contract.site_id, v_contract.customer_site_id) is not null and
        coalesce(v_contract.site_id, v_contract.customer_site_id) is distinct from v_case.site_id
      ) or (
        v_case.metering_point_id is not null and v_contract.metering_point_id is not null and
        v_contract.metering_point_id is distinct from v_case.metering_point_id
      ) then
      raise exception using errcode = '23514', message = 'lifecycle_case_contract_mismatch';
    end if;
  end if;
  return new;
end
$function$;

revoke all on function private.gridex_lifecycle_case_binding_v1() from public;
create trigger gridex_lifecycle_case_binding_v1
  before insert or update on public.customer_lifecycle_decisions
  for each row execute function private.gridex_lifecycle_case_binding_v1();
