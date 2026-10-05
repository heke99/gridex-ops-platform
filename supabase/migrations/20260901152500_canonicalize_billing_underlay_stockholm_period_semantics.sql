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
  v_start_instant timestamptz := (p_underlay->>'billing_period_start')::timestamptz;
  v_end_instant timestamptz := (p_underlay->>'billing_period_end')::timestamptz;
  v_start_date date := (v_start_instant at time zone 'Europe/Stockholm')::date;
  v_end_date date := (v_end_instant at time zone 'Europe/Stockholm')::date;
  v_energy_direction text := coalesce(nullif(p_underlay->>'energy_direction',''),nullif(p_underlay#>>'{payload,energy_direction}',''),'consumption');
  v_settlement_type text := coalesce(nullif(p_underlay->>'settlement_type',''),nullif(p_underlay#>>'{payload,settlement_type}',''));
begin
  if p_company_id is null or v_customer_id is null or v_metering_point_id is null then
    raise exception 'billing_underlay_tenant_customer_meter_required' using errcode='22023';
  end if;
  if v_end_instant <= v_start_instant or v_end_date <= v_start_date then
    raise exception 'billing_underlay_invalid_segment' using errcode='22023';
  end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb)) <> 'array' then raise exception 'billing_underlay_items_must_be_array' using errcode='22023'; end if;
  if v_energy_direction not in ('consumption','production','consumption_correction') then raise exception 'billing_underlay_invalid_energy_direction' using errcode='22023'; end if;
  if not exists(select 1 from public.customers where company_id=p_company_id and id=v_customer_id) then raise exception 'billing_underlay_customer_tenant_mismatch' using errcode='23503'; end if;
  if not exists(select 1 from public.metering_points where company_id=p_company_id and id=v_metering_point_id) then raise exception 'billing_underlay_meter_tenant_mismatch' using errcode='23503'; end if;

  insert into public.billing_underlays(
    company_id,customer_id,site_id,customer_site_id,metering_point_id,supply_period_id,contract_id,pricing_snapshot_id,
    price_plan_id,price_plan_version_id,price_book_id,contract_price_snapshot_id,billing_block_reason,campaign_id,price_area,
    energy_direction,settlement_type,underlay_month,underlay_year,billing_period_start,billing_period_end,status,readiness_status,
    readiness_issues,total_kwh,currency,source_system,source_meter_value_count,missing_values_count,payload,pricing_snapshot,
    received_at,validated_at,created_by,updated_by,updated_at
  ) values (
    p_company_id,v_customer_id,nullif(p_underlay->>'site_id','')::uuid,nullif(p_underlay->>'customer_site_id','')::uuid,v_metering_point_id,
    nullif(p_underlay->>'supply_period_id','')::uuid,nullif(p_underlay->>'contract_id','')::uuid,nullif(p_underlay->>'pricing_snapshot_id','')::uuid,
    nullif(p_underlay->>'price_plan_id','')::uuid,nullif(p_underlay->>'price_plan_version_id','')::uuid,nullif(p_underlay->>'price_book_id','')::uuid,
    nullif(p_underlay->>'contract_price_snapshot_id','')::uuid,nullif(p_underlay->>'billing_block_reason',''),nullif(p_underlay->>'campaign_id','')::uuid,
    nullif(p_underlay->>'price_area',''),v_energy_direction,v_settlement_type,v_month,v_year,v_start_date,v_end_date,
    coalesce(nullif(p_underlay->>'status',''),'pending'),coalesce(nullif(p_underlay->>'readiness_status',''),'blocked'),
    coalesce(p_underlay->'readiness_issues','[]'::jsonb),(p_underlay->>'total_kwh')::numeric,coalesce(nullif(p_underlay->>'currency',''),'SEK'),
    coalesce(nullif(p_underlay->>'source_system',''),'normalized_metering_values'),coalesce((p_underlay->>'source_meter_value_count')::integer,0),
    coalesce((p_underlay->>'missing_values_count')::integer,0),coalesce(p_underlay->'payload','{}'::jsonb)||jsonb_build_object(
      'billing_period_start_instant',v_start_instant,'billing_period_end_instant',v_end_instant,'billing_period_timezone','Europe/Stockholm','billing_period_end_exclusive',true
    ),coalesce(p_underlay->'pricing_snapshot','{}'::jsonb),coalesce((p_underlay->>'received_at')::timestamptz,now()),
    nullif(p_underlay->>'validated_at','')::timestamptz,p_actor_user_id,p_actor_user_id,now()
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
    item || jsonb_build_object('id',gen_random_uuid(),'company_id',p_company_id,'billing_underlay_id',v_id,'created_at',now(),'updated_at',now()))).*
  from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) item;

  insert into public.billing_underlay_events(company_id,billing_underlay_id,event_type,message,metadata,created_by)
  values(p_company_id,v_id,'underlay_generated',case when p_underlay->>'readiness_status'='ready' then 'Fakturaunderlag är redo för prisberäkning.' else 'Fakturaunderlag är blockerat.' end,
    jsonb_build_object('billing_period_start',v_start_date,'billing_period_end',v_end_date,'billing_period_start_instant',v_start_instant,'billing_period_end_instant',v_end_instant,'billing_period_timezone','Europe/Stockholm','billing_period_end_exclusive',true,'energy_direction',v_energy_direction,'source_rows',jsonb_array_length(coalesce(p_items,'[]'::jsonb))),p_actor_user_id);
  return v_id;
end;
$$;

create or replace function public.gridex_billing_underlay_item_gate_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n public.normalized_metering_values%rowtype;
  u public.billing_underlays%rowtype;
  v_value_start_date date;
  v_value_end_date date;
begin
  if new.source_normalized_metering_value_id is null then raise exception 'billing_underlay_source_normalized_value_required' using errcode='23514'; end if;
  select * into n from public.normalized_metering_values where id=new.source_normalized_metering_value_id;
  select * into u from public.billing_underlays where id=new.billing_underlay_id;
  if not found or u.id is null then raise exception 'billing_underlay_missing' using errcode='23503'; end if;
  if n.id is null then raise exception 'billing_underlay_normalized_value_missing' using errcode='23503'; end if;
  if n.company_id<>new.company_id or u.company_id<>new.company_id then raise exception 'billing_underlay_lineage_tenant_mismatch' using errcode='23514'; end if;
  if n.revision_status<>'current' or n.billing_status<>'billable' or n.billing_gate_status<>'eligible' then raise exception 'billing_underlay_value_not_gate_eligible' using errcode='23514'; end if;
  if n.source_message_id is null or n.source_metering_value_id is null or n.supply_period_id is null then raise exception 'billing_underlay_lineage_incomplete' using errcode='23514'; end if;
  if u.supply_period_id is null or u.supply_period_id<>n.supply_period_id then raise exception 'billing_underlay_supply_period_mismatch' using errcode='23514'; end if;

  v_value_start_date := (n.period_start at time zone 'Europe/Stockholm')::date;
  v_value_end_date := (n.period_end at time zone 'Europe/Stockholm')::date;
  if v_value_start_date < u.billing_period_start or v_value_end_date > u.billing_period_end then
    raise exception 'billing_underlay_period_outside_segment'
      using errcode='23514', detail=jsonb_build_object(
        'normalized_metering_value_id',n.id,
        'value_start_date',v_value_start_date,
        'value_end_date',v_value_end_date,
        'billing_period_start',u.billing_period_start,
        'billing_period_end',u.billing_period_end,
        'timezone','Europe/Stockholm',
        'billing_period_end_exclusive',true
      )::text;
  end if;
  return new;
end;
$$;

revoke all on function public.gridex_store_billing_underlay(uuid,jsonb,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.gridex_store_billing_underlay(uuid,jsonb,jsonb,uuid) to service_role;
