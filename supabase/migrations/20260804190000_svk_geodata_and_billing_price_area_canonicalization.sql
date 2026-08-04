-- Canonicalize Svenska kraftnät geodata import fields and lock billing price
-- area to the immutable customer-contract pricing snapshot.

create or replace function public.gridex_import_grid_area_geojson_feature(
  p_feature_id text,
  p_properties jsonb,
  p_geometry_geojson jsonb,
  p_source_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp, extensions
as $$
declare
  v_area_id uuid;
  v_code text;
  v_name text;
  v_owner_name text;
  v_price_area text;
  v_geometry_type text;
  v_property_keys text;
  v_geom extensions.geometry(MultiPolygon, 3006);
begin
  if p_properties is null or jsonb_typeof(p_properties) <> 'object' then
    raise exception 'svk_feature_properties_invalid'
      using errcode = '22023',
            detail = jsonb_build_object('feature_id', p_feature_id)::text;
  end if;

  select string_agg(key, ', ' order by key)
  into v_property_keys
  from jsonb_object_keys(p_properties) as keys(key);

  -- The official SVK FeatureServer uses Natomrade, Namn, Agare and Elomrade.
  -- Older aliases remain supported so an archived source can still be audited.
  v_code := upper(nullif(btrim(public.gridex_json_text(
    p_properties,
    'Natomrade','NATOMRADE','natomrade',
    'NATOMRADESKOD','NÄTOMRÅDESKOD','Nätområdeskod','natomradeskod',
    'grid_area_code','GRID_AREA_CODE','OMR_KOD','OMRKOD','OMRÅDESKOD',
    'omradeskod','ELNATSOMRADE','ELNÄTSOMRÅDE','kod','KOD'
  )), ''));
  v_name := nullif(btrim(public.gridex_json_text(
    p_properties,
    'Namn','NAMN','namn',
    'NATOMRADESNAMN','NÄTOMRÅDESNAMN','Nätområdets namn','natomradesnamn',
    'grid_area_name','OMR_NAMN'
  )), '');
  v_owner_name := nullif(btrim(public.gridex_json_text(
    p_properties,
    'Agare','AGARE','agare','Ägare','ägare',
    'ELNATSFORETAG','ELNÄTSFÖRETAG','Elnätsföretag','elnatsforetag',
    'grid_owner_name','NATAGARE','NÄTÄGARE','owner','FORETAG','FÖRETAG'
  )), '');
  v_price_area := upper(nullif(btrim(public.gridex_json_text(
    p_properties,
    'Elomrade','ELOMRADE','elomrade','Elområde','ELOMRÅDE',
    'price_area','PRICE_AREA','SE_OMRADE','elomr'
  )), ''));

  if v_code is null then
    raise exception 'svk_grid_area_code_missing'
      using errcode = '22023',
            detail = jsonb_build_object(
              'feature_id', p_feature_id,
              'required_source_field', 'Natomrade',
              'available_property_keys', v_property_keys
            )::text;
  end if;
  if v_name is null then
    raise exception 'svk_grid_area_name_missing'
      using errcode = '22023',
            detail = jsonb_build_object(
              'feature_id', p_feature_id,
              'grid_area_code', v_code,
              'required_source_field', 'Namn'
            )::text;
  end if;
  if v_owner_name is null then
    raise exception 'svk_grid_owner_name_missing'
      using errcode = '22023',
            detail = jsonb_build_object(
              'feature_id', p_feature_id,
              'grid_area_code', v_code,
              'required_source_field', 'Agare'
            )::text;
  end if;
  if v_price_area not in ('SE1','SE2','SE3','SE4') then
    raise exception 'svk_price_area_invalid'
      using errcode = '22023',
            detail = jsonb_build_object(
              'feature_id', p_feature_id,
              'grid_area_code', v_code,
              'required_source_field', 'Elomrade',
              'actual_value', v_price_area
            )::text;
  end if;

  v_area_id := public.gridex_import_grid_area_master_row(
    v_owner_name,
    v_name,
    v_code,
    v_price_area,
    'svk_arcgis',
    p_properties || jsonb_build_object(
      '_gridex_source_feature_id', p_feature_id,
      '_gridex_source_url', p_source_url
    )
  );

  if p_geometry_geojson is null or jsonb_typeof(p_geometry_geojson) <> 'object' then
    raise exception 'svk_geometry_missing'
      using errcode = '22023',
            detail = jsonb_build_object('feature_id', p_feature_id, 'grid_area_code', v_code)::text;
  end if;

  v_geometry_type := p_geometry_geojson ->> 'type';
  if v_geometry_type not in ('Polygon', 'MultiPolygon') then
    raise exception 'svk_geometry_type_invalid'
      using errcode = '22023',
            detail = jsonb_build_object(
              'feature_id', p_feature_id,
              'grid_area_code', v_code,
              'geometry_type', v_geometry_type
            )::text;
  end if;

  v_geom := extensions.ST_Multi(
    extensions.ST_Transform(
      extensions.ST_SetSRID(
        extensions.ST_GeomFromGeoJSON(p_geometry_geojson::text),
        4326
      ),
      3006
    )
  );

  if v_geom is null or extensions.ST_IsEmpty(v_geom) then
    raise exception 'svk_geometry_empty'
      using errcode = '22023',
            detail = jsonb_build_object('feature_id', p_feature_id, 'grid_area_code', v_code)::text;
  end if;

  insert into public.platform_grid_area_geometries (
    grid_area_id,
    grid_area_code,
    source_feature_id,
    source_url,
    source_properties,
    geometry,
    geometry_geojson,
    updated_at
  )
  values (
    v_area_id,
    v_code,
    p_feature_id,
    p_source_url,
    p_properties,
    v_geom,
    p_geometry_geojson,
    now()
  )
  on conflict (source, source_feature_id) where source_feature_id is not null
  do update set
    grid_area_id = excluded.grid_area_id,
    grid_area_code = excluded.grid_area_code,
    source_url = excluded.source_url,
    source_properties = excluded.source_properties,
    geometry = excluded.geometry,
    geometry_geojson = excluded.geometry_geojson,
    is_active = true,
    imported_at = now(),
    updated_at = now();

  return v_area_id;
end;
$$;

revoke all on function public.gridex_import_grid_area_geojson_feature(text,jsonb,jsonb,text)
  from public, anon, authenticated;
grant execute on function public.gridex_import_grid_area_geojson_feature(text,jsonb,jsonb,text)
  to service_role;

create or replace function public.gridex_promote_energy_geodata_version(
  p_geodata_version_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp, extensions
as $$
declare
  v_version public.energy_geodata_versions%rowtype;
  v_feature record;
  v_feature_count integer := 0;
  v_now timestamptz := now();
  v_error_detail text;
  v_error_hint text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'energy_geodata_promote_service_role_required' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('energy-geodata:' || p_geodata_version_id::text, 0));

  select *
  into v_version
  from public.energy_geodata_versions
  where id = p_geodata_version_id
  for update;

  if not found then
    raise exception 'energy_geodata_version_not_found' using errcode = 'P0002';
  end if;
  if v_version.status = 'verified' then
    return to_jsonb(v_version);
  end if;
  if v_version.status <> 'importing' or v_version.coverage_status <> 'complete' then
    raise exception 'energy_geodata_version_not_complete' using errcode = '23514';
  end if;

  select count(*)::integer
  into v_feature_count
  from public.energy_geodata_features_staging
  where geodata_version_id = p_geodata_version_id;

  if v_feature_count <= 0 or v_feature_count <> v_version.feature_count then
    raise exception 'energy_geodata_feature_count_mismatch'
      using errcode = '23514',
            detail = jsonb_build_object(
              'geodata_version_id', p_geodata_version_id,
              'staged_feature_count', v_feature_count,
              'declared_feature_count', v_version.feature_count
            )::text;
  end if;

  for v_feature in
    select feature_id, properties, geometry_geojson, source_url
    from public.energy_geodata_features_staging
    where geodata_version_id = p_geodata_version_id
    order by feature_id
  loop
    begin
      perform public.gridex_import_grid_area_geojson_feature(
        v_feature.feature_id,
        v_feature.properties,
        v_feature.geometry_geojson,
        v_feature.source_url
      );
    exception when others then
      get stacked diagnostics
        v_error_detail = PG_EXCEPTION_DETAIL,
        v_error_hint = PG_EXCEPTION_HINT;
      raise exception 'energy_geodata_feature_promotion_failed'
        using errcode = 'P0001',
              detail = jsonb_build_object(
                'geodata_version_id', p_geodata_version_id,
                'feature_id', v_feature.feature_id,
                'source_error_code', sqlstate,
                'source_error_message', sqlerrm,
                'source_error_detail', v_error_detail,
                'source_error_hint', v_error_hint
              )::text;
    end;

    update public.platform_grid_area_geometries
    set geodata_version_id = p_geodata_version_id,
        is_active = true,
        updated_at = v_now
    where source = 'svk_arcgis'
      and source_feature_id = v_feature.feature_id;
  end loop;

  update public.platform_grid_area_geometries
  set is_active = false,
      updated_at = v_now
  where source = 'svk_arcgis'
    and is_active = true
    and geodata_version_id is distinct from p_geodata_version_id;

  update public.energy_geodata_versions
  set status = 'superseded',
      updated_at = v_now
  where provider = v_version.provider
    and status = 'verified'
    and id <> p_geodata_version_id;

  update public.energy_geodata_versions
  set status = 'verified',
      coverage_status = 'complete',
      verified_at = v_now,
      completed_at = v_now,
      updated_at = v_now
  where id = p_geodata_version_id
  returning * into v_version;

  insert into public.canonical_energy_flow_events(event_type, source, payload, actor_type)
  values (
    'energy_geodata.version.verified',
    'svk_arcgis',
    jsonb_build_object(
      'geodata_version_id', v_version.id,
      'geodata_version', v_version.version_key,
      'feature_count', v_feature_count,
      'verified_at', v_version.verified_at,
      'source_url', v_version.source_url,
      'source_layer_id', v_version.metadata -> 'layer_id'
    ),
    'system'
  );

  return to_jsonb(v_version);
end;
$$;

revoke all on function public.gridex_promote_energy_geodata_version(uuid)
  from public, anon, authenticated;
grant execute on function public.gridex_promote_energy_geodata_version(uuid)
  to service_role;

create or replace function public.gridex_enforce_billing_underlay_price_area()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_contract_id uuid := coalesce(new.contract_id, new.customer_contract_id);
  v_contract_snapshot_id uuid;
  v_contract_area text;
  v_snapshot_area text;
  v_legacy_snapshot_area text;
  v_metadata_area text;
  v_canonical_area text;
begin
  if v_contract_id is null then
    return new;
  end if;

  select
    c.contract_price_snapshot_id,
    upper(nullif(btrim(c.price_area_used), '')),
    upper(nullif(btrim(c.price_snapshot #>> '{snapshot_json,price_area}'), '')),
    upper(nullif(btrim(c.metadata ->> 'selected_price_area'), ''))
  into
    v_contract_snapshot_id,
    v_contract_area,
    v_legacy_snapshot_area,
    v_metadata_area
  from public.customer_contracts c
  where c.id = v_contract_id
    and c.company_id = new.company_id;

  if not found then
    return new;
  end if;

  select upper(nullif(btrim(s.snapshot_json ->> 'price_area'), ''))
  into v_snapshot_area
  from public.contract_price_snapshots s
  where s.id = coalesce(new.contract_price_snapshot_id, v_contract_snapshot_id)
    and s.contract_id = v_contract_id
    and s.company_id = new.company_id;

  v_canonical_area := coalesce(
    case when v_snapshot_area in ('SE1','SE2','SE3','SE4') then v_snapshot_area end,
    case when v_contract_area in ('SE1','SE2','SE3','SE4') then v_contract_area end,
    case when v_legacy_snapshot_area in ('SE1','SE2','SE3','SE4') then v_legacy_snapshot_area end,
    case when v_metadata_area in ('SE1','SE2','SE3','SE4') then v_metadata_area end
  );

  if coalesce(new.contract_price_snapshot_id, v_contract_snapshot_id) is not null
     and v_canonical_area is null then
    raise exception 'billing_contract_price_area_missing'
      using errcode = '23514',
            detail = jsonb_build_object(
              'billing_underlay_id', new.id,
              'contract_id', v_contract_id,
              'contract_price_snapshot_id', coalesce(new.contract_price_snapshot_id, v_contract_snapshot_id)
            )::text;
  end if;

  if v_canonical_area is null then
    return new;
  end if;

  if new.price_area is null or nullif(btrim(new.price_area), '') is null then
    new.price_area := v_canonical_area;
  elsif upper(btrim(new.price_area)) <> v_canonical_area then
    raise exception 'billing_underlay_price_area_mismatch'
      using errcode = '23514',
            detail = jsonb_build_object(
              'billing_underlay_id', new.id,
              'contract_id', v_contract_id,
              'submitted_price_area', upper(btrim(new.price_area)),
              'canonical_price_area', v_canonical_area,
              'contract_price_snapshot_id', coalesce(new.contract_price_snapshot_id, v_contract_snapshot_id)
            )::text;
  else
    new.price_area := v_canonical_area;
  end if;

  return new;
end;
$$;

revoke all on function public.gridex_enforce_billing_underlay_price_area()
  from public, anon, authenticated;
grant execute on function public.gridex_enforce_billing_underlay_price_area()
  to service_role;

drop trigger if exists billing_underlays_price_area_snapshot_guard
  on public.billing_underlays;
create trigger billing_underlays_price_area_snapshot_guard
before insert or update of
  company_id,
  contract_id,
  customer_contract_id,
  contract_price_snapshot_id,
  price_area
on public.billing_underlays
for each row
execute function public.gridex_enforce_billing_underlay_price_area();

comment on function public.gridex_import_grid_area_geojson_feature(text,jsonb,jsonb,text)
is 'Imports one official SVK Nätområden GeoJSON feature. Canonical source fields: Natomrade, Namn, Agare, Elomrade.';

comment on function public.gridex_enforce_billing_underlay_price_area()
is 'Locks billing_underlays.price_area to the immutable contract_price_snapshots/customer_contracts price-area evidence.';
