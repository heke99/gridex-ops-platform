-- Repair the tenant guard for contract_price_snapshots. The table has contract_id,
-- not customer_contract_id. The previous trigger function referenced a field that
-- does not exist on NEW and therefore aborted every insert before snapshot binding.

create or replace function public.gridex_contract_price_snapshots_company_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_parent_company_id uuid;
begin
  if new.contract_id is null then
    raise exception 'contract_price_snapshot_contract_id_required'
      using errcode = '23502';
  end if;

  select c.company_id
  into v_parent_company_id
  from public.customer_contracts c
  where c.id = new.contract_id;

  if not found then
    raise exception 'contract_price_snapshot_contract_not_found'
      using errcode = '23503',
            detail = jsonb_build_object(
              'contract_price_snapshot_id', new.id,
              'contract_id', new.contract_id
            )::text;
  end if;

  perform public.gridex_assert_same_company(
    new.company_id,
    v_parent_company_id,
    TG_TABLE_NAME,
    'contract_id'
  );

  return new;
end;
$$;

revoke all on function public.gridex_contract_price_snapshots_company_guard()
  from public, anon, authenticated;
grant execute on function public.gridex_contract_price_snapshots_company_guard()
  to service_role;

comment on function public.gridex_contract_price_snapshots_company_guard()
is 'Validates contract_price_snapshots.contract_id ownership without referencing nonexistent NEW.customer_contract_id.';
