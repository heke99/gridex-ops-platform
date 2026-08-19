create or replace function public.gridex_create_internal_customer_contract_v1(p_company_id uuid, p_customer_id uuid, p_contract_offer_id uuid, p_site_id uuid, p_metering_point_id uuid, p_selection jsonb, p_contract jsonb, p_actor_user_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $function$
declare
  v_offer public.contract_offers%rowtype;
  v_option public.contract_price_options%rowtype;
  v_area public.contract_price_option_area_prices%rowtype;
  v_contract public.customer_contracts%rowtype;
  v_snapshot_id uuid;
  v_publication_version_id uuid;
  v_selected_refs text[];
  v_resolved_count integer;
  v_pricing_model text;
  v_snapshot jsonb;
begin
  perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.create');
  if p_selection->>'snapshot_schema'<>'gridex_contract_pricing_v6_selection'
    or jsonb_typeof(p_selection->'base_price_components_snapshot')<>'array'
    or jsonb_typeof(p_selection->'price_components_snapshot')<>'array'
    or nullif(p_selection->>'price_option_reference','') is null
    or nullif(p_selection->>'invoice_delivery_method','') is null then
    raise exception using errcode='22023',message='internal_contract_commercial_selection_incomplete';
  end if;
  if nullif(p_contract->>'signed_at','') is not null or coalesce(nullif(p_contract->>'status',''),'draft') in ('signed','active') then
    raise exception using errcode='23514',message='internal_contract_raw_signature_state_forbidden';
  end if;

  select offer.* into v_offer from public.contract_offers offer
  where offer.id=p_contract_offer_id and offer.company_id=p_company_id and offer.lifecycle_status='published' and offer.is_active for share;
  if not found then raise exception using errcode='P0002',message='internal_contract_offer_not_sellable'; end if;
  if not exists(select 1 from public.customers customer where customer.id=p_customer_id and customer.company_id=p_company_id) then
    raise exception using errcode='23514',message='internal_contract_customer_tenant_mismatch';
  end if;
  if p_site_id is not null and not exists(select 1 from public.customer_sites site where site.id=p_site_id and site.company_id=p_company_id and site.customer_id=p_customer_id) then
    raise exception using errcode='23514',message='internal_contract_site_tenant_mismatch';
  end if;
  if p_metering_point_id is not null and not exists(select 1 from public.metering_points point where point.id=p_metering_point_id and point.company_id=p_company_id and (p_site_id is null or point.site_id=p_site_id)) then
    raise exception using errcode='23514',message='internal_contract_metering_point_tenant_mismatch';
  end if;

  select option_row.* into v_option from public.contract_price_options option_row
  where option_row.company_id=p_company_id and option_row.contract_product_version_id=v_offer.contract_product_version_id
    and option_row.price_plan_version_id=v_offer.price_plan_version_id and option_row.option_reference=p_selection->>'price_option_reference' and option_row.status='active'
  order by option_row.created_at desc limit 1;
  if not found then raise exception using errcode='23514',message='internal_contract_price_option_not_available'; end if;
  if v_offer.contract_type='fixed' then
    select area_row.* into v_area from public.contract_price_option_area_prices area_row
    where area_row.company_id=p_company_id and area_row.contract_price_option_id=v_option.id
      and area_row.price_row_reference=p_selection->>'area_price_reference' and area_row.price_area=p_selection->>'price_area';
    if not found then raise exception using errcode='23514',message='internal_contract_area_price_not_available'; end if;
  end if;

  v_selected_refs:=array(select value from jsonb_array_elements_text(coalesce(p_selection->'selected_component_references','[]'::jsonb)));
  select count(*) into v_resolved_count from jsonb_array_elements(p_selection->'price_components_snapshot') component
  where coalesce(component->>'componentReference',component->>'component_reference',component#>>'{metadata,component_reference}')=any(v_selected_refs);
  if v_resolved_count<>coalesce(array_length(v_selected_refs,1),0) or exists(
    select 1 from unnest(v_selected_refs) reference where not exists(
      select 1 from public.price_components component where component.company_id=p_company_id
        and component.price_plan_version_id=v_offer.price_plan_version_id and component.component_reference=reference and component.status='active'
    )
  ) then raise exception using errcode='23514',message='internal_contract_component_selection_mismatch'; end if;

  v_publication_version_id:=public.gridex_ensure_internal_contract_publication(p_company_id,v_offer.id,p_actor_user_id);
  if v_publication_version_id is null then raise exception using errcode='23514',message='internal_contract_publication_version_missing'; end if;
  select pricing_model into v_pricing_model from public.contract_product_versions where id=v_offer.contract_product_version_id;
  v_snapshot:=private.gridex_normalize_fixed_area_snapshot_v1(p_selection);

  insert into public.customer_contracts(
    company_id,customer_id,site_id,customer_site_id,metering_point_id,contract_offer_id,contract_product_id,contract_product_version_id,
    contract_publication_version_id,price_plan_id,price_plan_version_id,price_book_id,legal_bundle_version_id,source_type,status,contract_name,contract_type,
    energy_direction,offer_reference,commercial_snapshot,price_snapshot,monthly_fee_sek,invoice_fee_sek,fixed_price_ore_per_kwh,
    binding_months,notice_months,optional_fee_lines,agreement_channel,starts_at,ends_at,signed_at,auto_renew_enabled,auto_renew_term_months,
    override_reason,metadata,created_by,updated_by
  ) values(
    p_company_id,p_customer_id,p_site_id,p_site_id,p_metering_point_id,v_offer.id,v_offer.contract_product_id,v_offer.contract_product_version_id,
    v_publication_version_id,v_offer.price_plan_id,v_offer.price_plan_version_id,v_offer.price_book_id,v_offer.legal_bundle_version_id,'catalog','draft',
    coalesce(nullif(p_contract->>'contract_name',''),v_offer.name),v_offer.contract_type,v_offer.energy_direction,
    (select cpv.offer_reference from public.contract_publication_versions cpv where cpv.id=v_publication_version_id),v_snapshot,v_snapshot,
    (select (component->>'amount')::numeric from jsonb_array_elements(v_snapshot->'price_components_snapshot') component where coalesce(component->>'componentCode',component->>'component_code',component#>>'{metadata,component_code}')='monthly_fee' limit 1),
    (select (component->>'amount')::numeric from jsonb_array_elements(v_snapshot->'price_components_snapshot') component where coalesce(component->>'componentCode',component->>'component_code',component#>>'{metadata,component_code}') in ('invoice_administration_fee','invoice_fee') limit 1),
    case when v_offer.contract_type='fixed' then case when v_area.unit='sek_per_kwh' then v_area.amount*100 else v_area.amount end else null end,
    v_option.binding_months,v_option.notice_months,v_snapshot->'price_components_snapshot','internal',nullif(p_contract->>'starts_at','')::date,
    nullif(p_contract->>'ends_at','')::date,null,v_option.auto_renew_enabled,v_option.renewal_term_months,nullif(p_contract->>'override_reason',''),
    jsonb_build_object('source_of_truth','contract_price_options','price_option_reference',v_option.option_reference,'area_price_reference',v_area.price_row_reference,
      'invoice_delivery_method',p_selection->>'invoice_delivery_method','selected_component_references',to_jsonb(v_selected_refs)),p_actor_user_id,p_actor_user_id
  ) returning * into v_contract;

  insert into public.contract_price_snapshots(
    company_id,contract_id,customer_id,source,price_plan_version_id,pricing_model,base_price_components_snapshot,price_components_snapshot,
    snapshot_json,valid_from,valid_to,snapshot_schema_version,price_option_reference,area_price_reference,invoice_delivery_method,
    selected_component_references,snapshot_hash,snapshot_quality
  ) values(
    p_company_id,v_contract.id,p_customer_id,'internal_customer_contract_selection',v_offer.price_plan_version_id,coalesce(v_pricing_model,'spot'),
    v_snapshot->'base_price_components_snapshot',v_snapshot->'price_components_snapshot',v_snapshot,
    coalesce(nullif(p_contract->>'starts_at','')::date,current_date),nullif(p_contract->>'ends_at','')::date,
    'gridex_contract_pricing_v6_selection',v_option.option_reference,v_area.price_row_reference,p_selection->>'invoice_delivery_method',v_selected_refs,
    encode(extensions.digest(convert_to(v_snapshot::text,'UTF8'),'sha256'),'hex'),'canonical'
  ) returning id into v_snapshot_id;

  update public.customer_contracts set contract_price_snapshot_id=v_snapshot_id,updated_at=now() where id=v_contract.id and company_id=p_company_id returning * into v_contract;
  return jsonb_build_object('ok',true,'contract',to_jsonb(v_contract),'contract_price_snapshot_id',v_snapshot_id,
    'price_option_reference',v_option.option_reference,'area_price_reference',v_area.price_row_reference,'selected_component_references',to_jsonb(v_selected_refs));
end
$function$;

revoke all on function public.gridex_create_internal_customer_contract_v1(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.gridex_create_internal_customer_contract_v1(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,uuid) to service_role;
