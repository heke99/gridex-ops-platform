-- Repair gridex_store_billing_underlay after the energy-direction split.
--
-- 20260716090000_production_settlement_export_completion.sql recreated the
-- billing_underlays segment unique index WITH energy_direction:
--   (company_id, customer_id, metering_point_id, underlay_year, underlay_month,
--    billing_period_start, billing_period_end, energy_direction)
-- but gridex_store_billing_underlay (defined in
-- 20260712100000_gridex_end_to_end_integrity_hardening.sql) still targets the
-- old 7-column arbiter:
--   on conflict(company_id,customer_id,metering_point_id,underlay_year,
--               underlay_month,billing_period_start,billing_period_end)
-- Postgres ON CONFLICT inference requires an exact unique-index match, so every
-- underlay store now fails with "there is no unique or exclusion constraint
-- matching the ON CONFLICT specification". This blocks underlay generation and
-- therefore the whole billing chain.
--
-- Fix: recreate the function with energy_direction (and settlement_type) as
-- explicit insert columns taken from the command payload, and use the current
-- 8-column arbiter. The gridex_normalize_billing_energy_flow trigger still
-- normalizes/validates direction and settlement type before the arbiter check,
-- so consumption/production/correction segments upsert independently and
-- re-running a month's generation stays idempotent per segment+direction.

create or replace function public.gridex_store_billing_underlay(
  p_company_id uuid,
  p_underlay jsonb,
  p_items jsonb,
  p_actor_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_id uuid;
  v_customer_id uuid := nullif(p_underlay->>'customer_id','')::uuid;
  v_metering_point_id uuid := nullif(p_underlay->>'metering_point_id','')::uuid;
  v_year integer := (p_underlay->>'underlay_year')::integer;
  v_month integer := (p_underlay->>'underlay_month')::integer;
  v_start timestamptz := (p_underlay->>'billing_period_start')::timestamptz;
  v_end timestamptz := (p_underlay->>'billing_period_end')::timestamptz;
  v_energy_direction text := coalesce(
    nullif(p_underlay->>'energy_direction',''),
    nullif(p_underlay#>>'{payload,energy_direction}',''),
    'consumption'
  );
  v_settlement_type text := coalesce(
    nullif(p_underlay->>'settlement_type',''),
    nullif(p_underlay#>>'{payload,settlement_type}','')
  );
begin
  if p_company_id is null or v_customer_id is null or v_metering_point_id is null then
    raise exception 'billing_underlay_tenant_customer_meter_required' using errcode='22023';
  end if;
  if v_end <= v_start then raise exception 'billing_underlay_invalid_segment' using errcode='22023'; end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb)) <> 'array' then raise exception 'billing_underlay_items_must_be_array' using errcode='22023'; end if;
  if v_energy_direction not in ('consumption','production','consumption_correction') then
    raise exception 'billing_underlay_invalid_energy_direction' using errcode='22023';
  end if;
  if not exists(select 1 from public.customers where company_id=p_company_id and id=v_customer_id) then
    raise exception 'billing_underlay_customer_tenant_mismatch' using errcode='23503';
  end if;
  if not exists(select 1 from public.metering_points where company_id=p_company_id and id=v_metering_point_id) then
    raise exception 'billing_underlay_meter_tenant_mismatch' using errcode='23503';
  end if;

  insert into public.billing_underlays(
    company_id,customer_id,site_id,customer_site_id,metering_point_id,supply_period_id,contract_id,pricing_snapshot_id,
    price_plan_id,price_plan_version_id,price_book_id,contract_price_snapshot_id,billing_block_reason,campaign_id,price_area,
    energy_direction,settlement_type,
    underlay_month,underlay_year,billing_period_start,billing_period_end,status,readiness_status,readiness_issues,total_kwh,currency,
    source_system,source_meter_value_count,missing_values_count,payload,pricing_snapshot,received_at,validated_at,created_by,updated_by,updated_at
  ) values (
    p_company_id,v_customer_id,nullif(p_underlay->>'site_id','')::uuid,nullif(p_underlay->>'customer_site_id','')::uuid,v_metering_point_id,
    nullif(p_underlay->>'supply_period_id','')::uuid,nullif(p_underlay->>'contract_id','')::uuid,nullif(p_underlay->>'pricing_snapshot_id','')::uuid,
    nullif(p_underlay->>'price_plan_id','')::uuid,nullif(p_underlay->>'price_plan_version_id','')::uuid,nullif(p_underlay->>'price_book_id','')::uuid,
    nullif(p_underlay->>'contract_price_snapshot_id','')::uuid,nullif(p_underlay->>'billing_block_reason',''),nullif(p_underlay->>'campaign_id','')::uuid,
    nullif(p_underlay->>'price_area',''),
    v_energy_direction,v_settlement_type,
    v_month,v_year,v_start,v_end,coalesce(nullif(p_underlay->>'status',''),'pending'),
    coalesce(nullif(p_underlay->>'readiness_status',''),'blocked'),coalesce(p_underlay->'readiness_issues','[]'::jsonb),
    (p_underlay->>'total_kwh')::numeric,coalesce(nullif(p_underlay->>'currency',''),'SEK'),
    coalesce(nullif(p_underlay->>'source_system',''),'normalized_metering_values'),coalesce((p_underlay->>'source_meter_value_count')::integer,0),
    coalesce((p_underlay->>'missing_values_count')::integer,0),coalesce(p_underlay->'payload','{}'::jsonb),coalesce(p_underlay->'pricing_snapshot','{}'::jsonb),
    coalesce((p_underlay->>'received_at')::timestamptz,now()),nullif(p_underlay->>'validated_at','')::timestamptz,p_actor_user_id,p_actor_user_id,now()
  )
  on conflict(company_id,customer_id,metering_point_id,underlay_year,underlay_month,billing_period_start,billing_period_end,energy_direction)
  do update set
    site_id=excluded.site_id,customer_site_id=excluded.customer_site_id,supply_period_id=excluded.supply_period_id,contract_id=excluded.contract_id,
    pricing_snapshot_id=excluded.pricing_snapshot_id,price_plan_id=excluded.price_plan_id,price_plan_version_id=excluded.price_plan_version_id,
    price_book_id=excluded.price_book_id,contract_price_snapshot_id=excluded.contract_price_snapshot_id,billing_block_reason=excluded.billing_block_reason,
    campaign_id=excluded.campaign_id,price_area=excluded.price_area,status=excluded.status,readiness_status=excluded.readiness_status,
    readiness_issues=excluded.readiness_issues,total_kwh=excluded.total_kwh,currency=excluded.currency,source_system=excluded.source_system,
    source_meter_value_count=excluded.source_meter_value_count,missing_values_count=excluded.missing_values_count,payload=excluded.payload,
    pricing_snapshot=excluded.pricing_snapshot,received_at=excluded.received_at,validated_at=excluded.validated_at,updated_by=p_actor_user_id,updated_at=now()
  returning id into v_id;

  delete from public.billing_underlay_items where company_id=p_company_id and billing_underlay_id=v_id;
  insert into public.billing_underlay_items
  select (jsonb_populate_record(null::public.billing_underlay_items,
    item || jsonb_build_object('id',gen_random_uuid(),'company_id',p_company_id,'billing_underlay_id',v_id,
      'created_at',now(),'updated_at',now()))).*
  from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) item;

  insert into public.billing_underlay_events(company_id,billing_underlay_id,event_type,message,metadata,created_by)
  values(p_company_id,v_id,'underlay_generated',case when p_underlay->>'readiness_status'='ready' then 'Fakturaunderlag är redo för prisberäkning.' else 'Fakturaunderlag är blockerat.' end,
    jsonb_build_object('billing_period_start',v_start,'billing_period_end',v_end,'energy_direction',v_energy_direction,'source_rows',jsonb_array_length(coalesce(p_items,'[]'::jsonb))),p_actor_user_id);
  return v_id;
end;
$$;

revoke all on function public.gridex_store_billing_underlay(uuid,jsonb,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.gridex_store_billing_underlay(uuid,jsonb,jsonb,uuid) to service_role;
