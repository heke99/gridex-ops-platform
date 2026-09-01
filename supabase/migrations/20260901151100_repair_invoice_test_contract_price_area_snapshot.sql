alter table public.contract_price_snapshots disable trigger gridex_contract_price_snapshots_immutable_tg;

do $$
declare
  r record;
  v_old_hash text;
  v_new_hash text;
  v_new_json jsonb;
  v_count integer;
begin
  select count(*)::integer into v_count
  from public.customer_contracts c
  join public.contract_price_snapshots cps on cps.id=c.contract_price_snapshot_id and cps.contract_id=c.id and cps.company_id=c.company_id
  join public.customer_sites s on s.id=coalesce(c.customer_site_id,c.site_id) and s.company_id=c.company_id
  join public.metering_points m on m.id=c.metering_point_id and m.company_id=c.company_id
  where c.metadata #>> '{test_center,kind}'='invoice_test_customer'
    and c.status in ('signed','active')
    and upper(nullif(btrim(cps.snapshot_json->>'price_area'),'')) is null
    and upper(nullif(btrim(s.price_area_code),'')) in ('SE1','SE2','SE3','SE4')
    and upper(nullif(btrim(coalesce(m.price_area_code,m.price_area)),''))=upper(nullif(btrim(s.price_area_code),''));

  if v_count=0 then
    alter table public.contract_price_snapshots enable trigger gridex_contract_price_snapshots_immutable_tg;
    return;
  end if;
  if v_count<>1 then
    raise exception using errcode='23514',message='invoice_test_price_area_repair_precondition_failed',detail=jsonb_build_object('count',v_count)::text;
  end if;

  select c.id as contract_id,c.company_id,c.customer_id,c.contract_price_snapshot_id,c.price_plan_id,c.price_plan_version_id,c.price_book_id,c.contract_product_version_id,c.contract_publication_version_id,c.legal_bundle_version_id,c.commercial_snapshot,upper(btrim(s.price_area_code)) as price_area
  into r
  from public.customer_contracts c
  join public.contract_price_snapshots cps on cps.id=c.contract_price_snapshot_id and cps.contract_id=c.id and cps.company_id=c.company_id
  join public.customer_sites s on s.id=coalesce(c.customer_site_id,c.site_id) and s.company_id=c.company_id
  join public.metering_points m on m.id=c.metering_point_id and m.company_id=c.company_id
  where c.metadata #>> '{test_center,kind}'='invoice_test_customer'
    and c.status in ('signed','active')
    and upper(nullif(btrim(cps.snapshot_json->>'price_area'),'')) is null
    and upper(nullif(btrim(s.price_area_code),'')) in ('SE1','SE2','SE3','SE4')
    and upper(nullif(btrim(coalesce(m.price_area_code,m.price_area)),''))=upper(nullif(btrim(s.price_area_code),''))
  limit 1;

  select snapshot_hash,
         snapshot_json || jsonb_strip_nulls(jsonb_build_object(
           'price_area',r.price_area,
           'price_plan_id',r.price_plan_id,
           'price_plan_version_id',r.price_plan_version_id,
           'price_book_id',r.price_book_id,
           'contract_product_version_id',r.contract_product_version_id,
           'contract_publication_version_id',r.contract_publication_version_id,
           'legal_bundle_version_id',r.legal_bundle_version_id,
           'base_price_components_snapshot',coalesce(r.commercial_snapshot->'base_price_components_snapshot',r.commercial_snapshot->'base_components','[]'::jsonb),
           'price_components_snapshot',coalesce(r.commercial_snapshot->'price_components_snapshot',r.commercial_snapshot->'price_components','[]'::jsonb),
           'repair_source','invoice_test_canonical_price_area_repair'
         ))
    into v_old_hash,v_new_json
  from public.contract_price_snapshots where id=r.contract_price_snapshot_id;

  v_new_hash:=encode(extensions.digest(convert_to(v_new_json::text,'UTF8'),'sha256'),'hex');

  update public.contract_price_snapshots cps
     set price_plan_id=coalesce(cps.price_plan_id,r.price_plan_id),
         price_plan_version_id=coalesce(cps.price_plan_version_id,r.price_plan_version_id),
         price_book_id=coalesce(cps.price_book_id,r.price_book_id),
         base_price_components_snapshot=case when coalesce(jsonb_array_length(cps.base_price_components_snapshot),0)=0 then coalesce(r.commercial_snapshot->'base_price_components_snapshot',r.commercial_snapshot->'base_components','[]'::jsonb) else cps.base_price_components_snapshot end,
         price_components_snapshot=case when coalesce(jsonb_array_length(cps.price_components_snapshot),0)=0 then coalesce(r.commercial_snapshot->'price_components_snapshot',r.commercial_snapshot->'price_components','[]'::jsonb) else cps.price_components_snapshot end,
         snapshot_json=v_new_json,
         snapshot_hash=v_new_hash,
         snapshot_quality='canonical_repair',
         snapshot_schema_version='gridex_contract_pricing_v8_area_bound',
         source='canonical_snapshot_area_repair'
   where cps.id=r.contract_price_snapshot_id and cps.contract_id=r.contract_id and cps.company_id=r.company_id;

  insert into public.customer_contract_events(company_id,customer_contract_id,customer_id,event_type,note,metadata)
  values(r.company_id,r.contract_id,r.customer_id,'note','Canonical price-area binding repaired for isolated invoice test snapshot.',jsonb_build_object('contract_price_snapshot_id',r.contract_price_snapshot_id,'price_area',r.price_area,'old_snapshot_hash',v_old_hash,'new_snapshot_hash',v_new_hash,'repair_reason','legacy_onboarding_snapshot_missing_price_area'));
end;
$$;

alter table public.contract_price_snapshots enable trigger gridex_contract_price_snapshots_immutable_tg;