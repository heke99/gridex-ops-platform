create or replace function public.gridex_ingest_metering_value_atomic(p_payload jsonb)
returns public.metering_values
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := nullif(p_payload->>'company_id','')::uuid;
  v_customer_id uuid := nullif(p_payload->>'customer_id','')::uuid;
  v_site_id uuid := nullif(p_payload->>'site_id','')::uuid;
  v_customer_site_id uuid := nullif(p_payload->>'customer_site_id','')::uuid;
  v_metering_point_id uuid := nullif(p_payload->>'metering_point_id','')::uuid;
  v_key text := nullif(p_payload->>'canonical_dedupe_key','');
  v_existing public.metering_values%rowtype;
  v_inserted public.metering_values%rowtype;
  v_revision integer := 1;
  v_direction text := coalesce(nullif(p_payload->>'direction',''),case when p_payload->>'reading_type'='production' then 'production' else 'consumption' end);
  v_unit text := coalesce(nullif(p_payload->>'unit',''),'kWh');
  v_raw jsonb := coalesce(p_payload->'raw_payload','{}'::jsonb);
  v_normalized_id uuid;
  v_source_message_id uuid := nullif(p_payload->>'source_ediel_message_id','')::uuid;
  v_source_tx text := nullif(p_payload->>'source_transaction_reference','');
  v_source_line text := nullif(p_payload->>'source_line_reference','');
begin
  if v_company_id is null or v_customer_id is null or v_metering_point_id is null or v_key is null then
    raise exception 'metering_company_customer_point_key_required' using errcode='22023';
  end if;
  if not exists(select 1 from public.customers where company_id=v_company_id and id=v_customer_id) then
    raise exception 'metering_customer_tenant_mismatch' using errcode='23503';
  end if;
  if not exists(select 1 from public.metering_points where company_id=v_company_id and id=v_metering_point_id and customer_id=v_customer_id) then
    raise exception 'metering_point_tenant_or_customer_mismatch' using errcode='23503';
  end if;
  if (p_payload->>'period_start')::timestamptz >= (p_payload->>'period_end')::timestamptz then
    raise exception 'metering_period_invalid' using errcode='22023';
  end if;
  if v_direction not in ('consumption','production','net_consumption','net_production') then
    raise exception 'metering_direction_invalid' using errcode='22023';
  end if;
  if v_unit not in ('Wh','kWh','MWh') then raise exception 'metering_unit_invalid' using errcode='22023'; end if;

  select * into v_existing
    from public.metering_values
   where company_id=v_company_id and canonical_dedupe_key=v_key and is_current=true
   order by created_at desc,id desc limit 1 for update;

  if found and v_existing.value_kwh is not distinct from (p_payload->>'value_kwh')::numeric
           and v_existing.quality_code is not distinct from nullif(p_payload->>'quality_code','') then
    if v_source_message_id is not null then
      select id into v_normalized_id
        from public.normalized_metering_values
       where company_id=v_company_id
         and source_metering_value_id=v_existing.id
         and revision_status='current'
       order by created_at desc,id desc
       limit 1;
      if v_normalized_id is null then
        raise exception 'atomic_metering_projection_missing_for_existing_value' using errcode='23503';
      end if;
      insert into public.metering_value_sources(
        company_id,metering_value_id,normalized_metering_value_id,source_ediel_message_id,
        source_transaction_reference,source_line_reference,source_type
      ) values (
        v_company_id,v_existing.id,v_normalized_id,v_source_message_id,
        v_source_tx,v_source_line,coalesce(nullif(p_payload->>'source_system',''),'grid_owner')
      ) on conflict do nothing;
    end if;
    return v_existing;
  end if;

  if v_existing.id is not null then
    v_revision := coalesce(v_existing.revision_number,1)+1;
    update public.metering_values
       set is_current=false,value_status='replaced',revision_status='replaced',
           correction_reason=coalesce(nullif(p_payload->>'correction_reason',''),'Nytt mätvärde ersatte tidigare revision.')
     where id=v_existing.id and company_id=v_company_id;
    update public.normalized_metering_values
       set revision_status='replaced',status='replaced',updated_at=now()
     where company_id=v_company_id and source_metering_value_id=v_existing.id and revision_status='current';
  end if;

  insert into public.metering_values(
    company_id,customer_id,site_id,customer_site_id,metering_point_id,source_request_id,grid_owner_id,reading_type,
    value_kwh,quality_code,read_at,period_start,period_end,source_system,raw_payload,source_ediel_message_id,
    source_transaction_reference,source_line_reference,price_area,resolution,canonical_dedupe_key,is_current,previous_value_id,
    revision_number,correction_reason,value_status,revision_status,billing_status,register_code,product_code,direction,unit,created_by
  ) values (
    v_company_id,v_customer_id,v_site_id,v_customer_site_id,v_metering_point_id,nullif(p_payload->>'source_request_id','')::uuid,
    nullif(p_payload->>'grid_owner_id','')::uuid,coalesce(nullif(p_payload->>'reading_type',''),'consumption'),
    (p_payload->>'value_kwh')::numeric,nullif(p_payload->>'quality_code',''),(p_payload->>'read_at')::timestamptz,
    (p_payload->>'period_start')::timestamptz,(p_payload->>'period_end')::timestamptz,coalesce(nullif(p_payload->>'source_system',''),'grid_owner'),
    v_raw,v_source_message_id,v_source_tx,
    v_source_line,nullif(p_payload->>'price_area',''),nullif(p_payload->>'resolution',''),v_key,true,
    v_existing.id,v_revision,case when v_existing.id is null then null else coalesce(nullif(p_payload->>'correction_reason',''),'Korrigerat mätvärde.') end,
    'current','current','pending_match',nullif(p_payload->>'register_code',''),nullif(p_payload->>'product_code',''),v_direction,v_unit,
    nullif(p_payload->>'created_by','')::uuid
  ) returning * into v_inserted;

  if v_existing.id is not null then
    update public.metering_values set replaced_by_value_id=v_inserted.id where company_id=v_company_id and id=v_existing.id;
    update public.normalized_metering_values set replaced_by_value_id=v_inserted.id where company_id=v_company_id and source_metering_value_id=v_existing.id;
  end if;

  insert into public.normalized_metering_values(
    company_id,customer_id,customer_site_id,site_id,metering_point_id,facility_id,price_area,grid_area,period_start,period_end,
    resolution,quantity_kwh,quality_status,source_type,source_message_id,source_transaction_reference,source_line_reference,
    source_metering_value_id,raw_payload,status,revision_status,billing_status,register_code,product_code,direction,unit,
    canonical_dedupe_key,previous_value_id,revision_number,created_by
  ) values (
    v_company_id,v_customer_id,v_customer_site_id,v_site_id,v_metering_point_id,nullif(p_payload->>'facility_id',''),
    nullif(p_payload->>'price_area',''),nullif(p_payload->>'grid_area',''),(p_payload->>'period_start')::timestamptz,
    (p_payload->>'period_end')::timestamptz,nullif(p_payload->>'resolution',''),(p_payload->>'value_kwh')::numeric,
    nullif(p_payload->>'quality_code',''),coalesce(nullif(p_payload->>'source_system',''),'grid_owner'),
    v_source_message_id,v_source_tx,
    v_source_line,v_inserted.id,v_raw,'stored','current','pending_match',
    nullif(p_payload->>'register_code',''),nullif(p_payload->>'product_code',''),v_direction,v_unit,v_key,v_existing.id,v_revision,
    nullif(p_payload->>'created_by','')::uuid
  ) returning id into v_normalized_id;

  if v_source_message_id is not null then
    insert into public.metering_value_sources(
      company_id,metering_value_id,normalized_metering_value_id,source_ediel_message_id,
      source_transaction_reference,source_line_reference,source_type
    ) values (
      v_company_id,v_inserted.id,v_normalized_id,v_source_message_id,
      v_source_tx,v_source_line,coalesce(nullif(p_payload->>'source_system',''),'grid_owner')
    ) on conflict do nothing;
  end if;

  return v_inserted;
end;
$$;
