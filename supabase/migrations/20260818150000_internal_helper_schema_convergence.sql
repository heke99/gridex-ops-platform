-- Keep remediation-only helpers out of the exposed public RPC surface.
-- Trigger entrypoints stay in public because their table triggers depend on them;
-- reusable helpers move to the non-exposed private schema.

begin;

alter function public.gridex_recompute_spot_price_month_v1(text,text,text)
  set schema private;

revoke all on function private.gridex_recompute_spot_price_month_v1(text,text,text)
  from public, anon, authenticated, service_role;

create or replace function public.gridex_enforce_spot_price_month_server_aggregate_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','private','extensions','pg_catalog','pg_temp'
as $$
declare
  v_row public.spot_price_monthly_summaries%rowtype;
begin
  if tg_op='UPDATE' and old.locked_at is not null then
    return new;
  end if;

  select * into v_row
  from private.gridex_recompute_spot_price_month_v1(
    new.source,
    new.price_area,
    new.billing_month
  );

  return null;
end
$$;

revoke all on function public.gridex_enforce_spot_price_month_server_aggregate_v1()
  from public, anon, authenticated;

alter function public.gridex_normalize_fixed_area_snapshot_v1(jsonb)
  set schema private;

revoke all on function private.gridex_normalize_fixed_area_snapshot_v1(jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.gridex_normalize_customer_contract_pricing_snapshot_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','private','pg_catalog','pg_temp'
as $$
begin
  if new.price_snapshot is not null then
    new.price_snapshot := private.gridex_normalize_fixed_area_snapshot_v1(new.price_snapshot);
  end if;
  return new;
end
$$;

create or replace function public.gridex_normalize_contract_price_snapshot_row_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','private','pg_catalog','pg_temp'
as $$
declare
  v_normalized jsonb;
begin
  if new.snapshot_json is not null then
    v_normalized := private.gridex_normalize_fixed_area_snapshot_v1(new.snapshot_json);
    new.snapshot_json := v_normalized;
    if v_normalized ? 'base_price_components_snapshot' then
      new.base_price_components_snapshot := v_normalized->'base_price_components_snapshot';
    end if;
  end if;
  return new;
end
$$;

revoke all on function public.gridex_normalize_customer_contract_pricing_snapshot_v1()
  from public, anon, authenticated;
revoke all on function public.gridex_normalize_contract_price_snapshot_row_v1()
  from public, anon, authenticated;

comment on function private.gridex_recompute_spot_price_month_v1(text,text,text)
  is 'Internal server-side monthly spot aggregation helper; intentionally outside the exposed Data API schema.';
comment on function private.gridex_normalize_fixed_area_snapshot_v1(jsonb)
  is 'Internal fixed-area snapshot normalizer; intentionally outside the exposed Data API schema.';

commit;
