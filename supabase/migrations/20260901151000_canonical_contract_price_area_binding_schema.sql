create or replace function public.gridex_fill_customer_contract_price_area_v1()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_site_area text; v_meter_area text; v_site_grid text; v_meter_grid text; v_area text; v_grid text;
begin
  if new.customer_site_id is not null or new.site_id is not null then
    select upper(nullif(btrim(s.price_area_code),'')), upper(nullif(btrim(s.grid_area_code),'')) into v_site_area,v_site_grid
    from public.customer_sites s where s.id=coalesce(new.customer_site_id,new.site_id) and s.company_id=new.company_id limit 1;
  end if;
  if new.metering_point_id is not null then
    select upper(nullif(btrim(coalesce(m.price_area_code,m.price_area)),'')), upper(nullif(btrim(m.grid_area_code),'')) into v_meter_area,v_meter_grid
    from public.metering_points m where m.id=new.metering_point_id and m.company_id=new.company_id limit 1;
  end if;
  if v_site_area in ('SE1','SE2','SE3','SE4') and v_meter_area in ('SE1','SE2','SE3','SE4') and v_site_area<>v_meter_area then
    raise exception using errcode='23514',message='contract_price_area_source_conflict';
  end if;
  v_area:=coalesce(case when v_meter_area in ('SE1','SE2','SE3','SE4') then v_meter_area end,case when v_site_area in ('SE1','SE2','SE3','SE4') then v_site_area end);
  v_grid:=coalesce(v_meter_grid,v_site_grid);
  if nullif(btrim(coalesce(new.price_area_used,'')),'') is null then new.price_area_used:=v_area;
  elsif v_area is not null and upper(btrim(new.price_area_used))<>v_area then raise exception using errcode='23514',message='contract_price_area_binding_mismatch';
  else new.price_area_used:=upper(btrim(new.price_area_used)); end if;
  if nullif(btrim(coalesce(new.grid_area_code_used,'')),'') is null then new.grid_area_code_used:=v_grid;
  elsif v_grid is not null and upper(btrim(new.grid_area_code_used))<>v_grid then raise exception using errcode='23514',message='contract_grid_area_binding_mismatch';
  else new.grid_area_code_used:=upper(btrim(new.grid_area_code_used)); end if;
  return new;
end; $$;

drop trigger if exists ac_customer_contracts_price_area_binding_v1 on public.customer_contracts;
create trigger ac_customer_contracts_price_area_binding_v1
before insert or update of customer_site_id,site_id,metering_point_id,price_area_used,grid_area_code_used on public.customer_contracts
for each row execute function public.gridex_fill_customer_contract_price_area_v1();

create or replace function public.gridex_fill_contract_price_snapshot_binding_v1()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_contract public.customer_contracts%rowtype; v_site_area text; v_meter_area text; v_area text; v_snapshot_area text; v_snapshot_ppv uuid;
begin
  select * into v_contract from public.customer_contracts c where c.id=new.contract_id and c.company_id=new.company_id;
  if not found then return new; end if;
  if v_contract.customer_site_id is not null or v_contract.site_id is not null then
    select upper(nullif(btrim(s.price_area_code),'')) into v_site_area from public.customer_sites s where s.id=coalesce(v_contract.customer_site_id,v_contract.site_id) and s.company_id=new.company_id limit 1;
  end if;
  if v_contract.metering_point_id is not null then
    select upper(nullif(btrim(coalesce(m.price_area_code,m.price_area)),'')) into v_meter_area from public.metering_points m where m.id=v_contract.metering_point_id and m.company_id=new.company_id limit 1;
  end if;
  if v_site_area in ('SE1','SE2','SE3','SE4') and v_meter_area in ('SE1','SE2','SE3','SE4') and v_site_area<>v_meter_area then raise exception using errcode='23514',message='contract_snapshot_price_area_source_conflict'; end if;
  v_area:=coalesce(case when upper(nullif(btrim(v_contract.price_area_used),'')) in ('SE1','SE2','SE3','SE4') then upper(btrim(v_contract.price_area_used)) end,case when v_meter_area in ('SE1','SE2','SE3','SE4') then v_meter_area end,case when v_site_area in ('SE1','SE2','SE3','SE4') then v_site_area end);
  v_snapshot_area:=upper(nullif(btrim(new.snapshot_json->>'price_area'),''));
  if v_snapshot_area is not null and v_snapshot_area not in ('SE1','SE2','SE3','SE4') then raise exception using errcode='23514',message='contract_snapshot_price_area_invalid'; end if;
  if v_snapshot_area is not null and v_area is not null and v_snapshot_area<>v_area then raise exception using errcode='23514',message='contract_snapshot_price_area_mismatch'; end if;
  v_snapshot_ppv:=nullif(new.snapshot_json->>'price_plan_version_id','')::uuid;
  if v_snapshot_ppv is not null and v_contract.price_plan_version_id is not null and v_snapshot_ppv<>v_contract.price_plan_version_id then raise exception using errcode='23514',message='contract_snapshot_price_plan_version_mismatch'; end if;
  new.price_plan_id:=coalesce(new.price_plan_id,v_contract.price_plan_id);
  new.price_plan_version_id:=coalesce(new.price_plan_version_id,v_contract.price_plan_version_id);
  new.price_book_id:=coalesce(new.price_book_id,v_contract.price_book_id);
  if coalesce(jsonb_array_length(new.base_price_components_snapshot),0)=0 then new.base_price_components_snapshot:=coalesce(v_contract.commercial_snapshot->'base_price_components_snapshot',v_contract.commercial_snapshot->'base_components','[]'::jsonb); end if;
  if coalesce(jsonb_array_length(new.price_components_snapshot),0)=0 then new.price_components_snapshot:=coalesce(v_contract.commercial_snapshot->'price_components_snapshot',v_contract.commercial_snapshot->'price_components','[]'::jsonb); end if;
  new.snapshot_json:=coalesce(new.snapshot_json,'{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object('price_area',coalesce(v_snapshot_area,v_area),'price_plan_id',new.price_plan_id,'price_plan_version_id',new.price_plan_version_id,'price_book_id',new.price_book_id,'contract_product_version_id',v_contract.contract_product_version_id,'contract_publication_version_id',v_contract.contract_publication_version_id,'legal_bundle_version_id',v_contract.legal_bundle_version_id,'base_price_components_snapshot',new.base_price_components_snapshot,'price_components_snapshot',new.price_components_snapshot));
  new.snapshot_schema_version:=coalesce(new.snapshot_schema_version,'gridex_contract_pricing_v8_area_bound');
  new.snapshot_hash:=null;
  return new;
end; $$;

drop trigger if exists aab_contract_price_snapshots_canonical_binding_v1 on public.contract_price_snapshots;
create trigger aab_contract_price_snapshots_canonical_binding_v1 before insert on public.contract_price_snapshots for each row execute function public.gridex_fill_contract_price_snapshot_binding_v1();