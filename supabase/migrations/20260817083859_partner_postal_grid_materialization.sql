create table if not exists private.partner_postal_code_geometries_staging (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_version text not null,
  postal_code text not null check (postal_code ~ '^\d{5}$'),
  city text null,
  geometry extensions.geometry(MultiPolygon, 3006) not null,
  metadata jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists partner_postal_code_geometries_staging_source_key
  on private.partner_postal_code_geometries_staging (
    source,
    source_version,
    postal_code,
    lower(coalesce(city, ''))
  );

create index if not exists partner_postal_code_geometries_staging_postal_idx
  on private.partner_postal_code_geometries_staging (postal_code);

create index if not exists partner_postal_code_geometries_staging_geometry_gist
  on private.partner_postal_code_geometries_staging using gist (geometry);

revoke all on private.partner_postal_code_geometries_staging from public, anon, authenticated;
grant usage on schema private to service_role;
grant select, insert, update, delete on private.partner_postal_code_geometries_staging to service_role;

create or replace function private.gridex_materialize_postal_grid_mappings_v1(
  p_source text,
  p_source_version text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_catalog, pg_temp
as $$
declare
  v_source text := nullif(btrim(p_source), '');
  v_source_version text := nullif(btrim(p_source_version), '');
  v_staging_count integer;
  v_candidate_count integer;
  v_postal_count integer;
begin
  if v_source is null or v_source_version is null then
    raise exception using errcode = '22023', message = 'postal_source_and_version_required';
  end if;

  select count(*)::integer
    into v_staging_count
  from private.partner_postal_code_geometries_staging
  where source = v_source
    and source_version = v_source_version;

  if v_staging_count = 0 then
    raise exception using errcode = '22023', message = 'postal_staging_dataset_empty';
  end if;

  update public.platform_postal_code_grid_mappings
  set is_active = false,
      updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'superseded_at', now(),
        'superseded_by_source_version', v_source_version
      )
  where source = v_source
    and is_active = true;

  with postal as (
    select
      s.postal_code,
      nullif(btrim(s.city), '') as city,
      s.geometry,
      s.metadata,
      greatest(st_area(s.geometry), 0.000001) as postal_area
    from private.partner_postal_code_geometries_staging s
    where s.source = v_source
      and s.source_version = v_source_version
  ),
  spatial_matches as (
    select
      p.postal_code,
      p.city,
      ga.grid_area_code,
      ga.price_area,
      greatest(
        0::double precision,
        least(
          1::double precision,
          st_area(st_intersection(p.geometry, g.geometry)) / p.postal_area
        )
      ) as overlap_share,
      p.metadata as source_metadata
    from postal p
    join public.platform_grid_area_geometries g
      on g.is_active = true
     and g.geometry is not null
     and st_intersects(p.geometry, g.geometry)
    join public.platform_grid_areas ga
      on ga.id = g.grid_area_id
     and ga.is_active = true
    where st_area(st_intersection(p.geometry, g.geometry)) > 0
  ),
  candidates as (
    select
      postal_code,
      city,
      grid_area_code,
      price_area,
      max(overlap_share) as overlap_share,
      jsonb_agg(source_metadata) as source_metadata
    from spatial_matches
    group by postal_code, city, grid_area_code, price_area
  ),
  inserted as (
    insert into public.platform_postal_code_grid_mappings (
      postal_code,
      city,
      grid_area_code,
      price_area,
      confidence,
      source,
      is_active,
      metadata,
      created_at,
      updated_at
    )
    select
      c.postal_code,
      c.city,
      c.grid_area_code,
      c.price_area,
      round(c.overlap_share::numeric, 6),
      v_source,
      true,
      jsonb_build_object(
        'source_version', v_source_version,
        'overlap_share', round(c.overlap_share::numeric, 6),
        'materialization_method', 'postal_polygon_grid_area_intersection',
        'materialized_at', now(),
        'source_metadata', c.source_metadata
      ),
      now(),
      now()
    from candidates c
    where c.grid_area_code is not null
    returning postal_code
  )
  select count(*)::integer, count(distinct postal_code)::integer
    into v_candidate_count, v_postal_count
  from inserted;

  return jsonb_build_object(
    'source', v_source,
    'source_version', v_source_version,
    'staging_features', v_staging_count,
    'materialized_candidates', coalesce(v_candidate_count, 0),
    'materialized_postal_codes', coalesce(v_postal_count, 0)
  );
end;
$$;

revoke all on function private.gridex_materialize_postal_grid_mappings_v1(text, text) from public, anon, authenticated;
grant execute on function private.gridex_materialize_postal_grid_mappings_v1(text, text) to service_role;

comment on table private.partner_postal_code_geometries_staging is
  'Private staging for licensed/versioned Swedish postal-code polygons. Materialize all spatial grid-area candidates; never guess ambiguous postcodes.';

comment on function private.gridex_materialize_postal_grid_mappings_v1(text, text) is
  'Rebuilds active postcode-to-grid-area candidates for one source/version by spatial intersection with canonical Gridex grid-area geometry. Multiple candidates are intentionally preserved.';
