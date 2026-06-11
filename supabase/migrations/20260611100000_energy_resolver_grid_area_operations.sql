-- Gridex Energy Resolver + nätområdes-/nätägarbegäran foundation
-- Produktionsprincip: platform/masterdata är gemensam och read-only för tenants;
-- kund-/processdata är alltid company_id-scopead.

create extension if not exists postgis with schema extensions;

create table if not exists public.platform_grid_owners (
  id uuid primary key default gen_random_uuid(),
  owner_code text,
  name text not null,
  org_number text,
  ediel_id text,
  communication_email text,
  contact_name text,
  phone text,
  is_active boolean not null default true,
  source text not null default 'svk_esett',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists platform_grid_owners_name_uidx on public.platform_grid_owners (lower(name));
create index if not exists platform_grid_owners_ediel_idx on public.platform_grid_owners (ediel_id) where ediel_id is not null;

create table if not exists public.platform_grid_areas (
  id uuid primary key default gen_random_uuid(),
  grid_area_code text not null,
  grid_area_name text,
  grid_owner_id uuid references public.platform_grid_owners(id) on delete set null,
  grid_owner_name text,
  price_area text check (price_area is null or price_area in ('SE1','SE2','SE3','SE4')),
  source text not null default 'svk_esett',
  source_version text,
  is_active boolean not null default true,
  valid_from date,
  valid_to date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_grid_areas_code_unique unique (grid_area_code)
);

create index if not exists platform_grid_areas_owner_idx on public.platform_grid_areas (grid_owner_id);
create index if not exists platform_grid_areas_price_area_idx on public.platform_grid_areas (price_area);
create index if not exists platform_grid_areas_active_idx on public.platform_grid_areas (is_active, grid_area_code);

create table if not exists public.platform_grid_area_geometries (
  id uuid primary key default gen_random_uuid(),
  grid_area_id uuid references public.platform_grid_areas(id) on delete cascade,
  grid_area_code text not null,
  source_feature_id text,
  source text not null default 'svk_arcgis',
  source_url text,
  source_properties jsonb not null default '{}'::jsonb,
  geometry extensions.geometry(MultiPolygon, 3006),
  geometry_geojson jsonb,
  is_active boolean not null default true,
  valid_from date,
  valid_to date,
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists platform_grid_area_geometries_code_idx on public.platform_grid_area_geometries (grid_area_code);
create index if not exists platform_grid_area_geometries_active_idx on public.platform_grid_area_geometries (is_active, grid_area_code);
create index if not exists platform_grid_area_geometries_geom_gix on public.platform_grid_area_geometries using gist (geometry);
create unique index if not exists platform_grid_area_geometries_feature_uidx on public.platform_grid_area_geometries (source, source_feature_id) where source_feature_id is not null;

create table if not exists public.platform_postal_code_grid_mappings (
  id uuid primary key default gen_random_uuid(),
  postal_code text not null,
  city text,
  grid_area_code text,
  price_area text check (price_area is null or price_area in ('SE1','SE2','SE3','SE4')),
  confidence numeric(5,4) not null default 0.35,
  source text not null default 'manual',
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists platform_postal_code_grid_mappings_uidx on public.platform_postal_code_grid_mappings (postal_code, coalesce(city, ''), coalesce(grid_area_code, ''), source);
create index if not exists platform_postal_code_grid_mappings_lookup_idx on public.platform_postal_code_grid_mappings (postal_code, is_active);

create table if not exists public.platform_address_lookup_cache (
  id uuid primary key default gen_random_uuid(),
  address_key text not null unique,
  street text,
  postal_code text,
  city text,
  country text not null default 'SE',
  latitude numeric,
  longitude numeric,
  sweref99_x numeric,
  sweref99_y numeric,
  provider text not null default 'papilite',
  confidence numeric(5,4) not null default 0,
  raw_payload jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists platform_address_lookup_cache_postal_idx on public.platform_address_lookup_cache (postal_code, city);

create table if not exists public.platform_energy_lookup_cache (
  id uuid primary key default gen_random_uuid(),
  lookup_key text not null unique,
  input jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  resolution_status text not null default 'postal_suggested',
  confidence numeric(5,4) not null default 0,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_data_import_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  import_type text not null,
  status text not null default 'running' check (status in ('running','completed','completed_with_warnings','failed','cancelled')),
  safe boolean not null default true,
  records_seen integer not null default 0,
  records_upserted integer not null default 0,
  records_failed integer not null default 0,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_by uuid,
  metadata jsonb not null default '{}'::jsonb,
  error_log jsonb not null default '[]'::jsonb
);

create index if not exists platform_data_import_runs_source_idx on public.platform_data_import_runs (source, import_type, started_at desc);

create table if not exists public.platform_data_quality_issues (
  id uuid primary key default gen_random_uuid(),
  issue_type text not null,
  severity text not null default 'warning' check (severity in ('info','warning','blocking')),
  status text not null default 'open' check (status in ('open','acknowledged','resolved','ignored')),
  entity_type text,
  entity_id uuid,
  company_id uuid references public.companies(id) on delete cascade,
  grid_area_code text,
  message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists platform_data_quality_issues_type_idx on public.platform_data_quality_issues (issue_type, status, severity);
create index if not exists platform_data_quality_issues_company_idx on public.platform_data_quality_issues (company_id) where company_id is not null;

create table if not exists public.grid_owner_contact_routes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  grid_owner_id uuid,
  grid_area_code text,
  request_type text not null default 'facility_lookup',
  channel text not null default 'email' check (channel in ('email','ediel','portal','manual')),
  target_email text,
  ediel_message_family text,
  ediel_message_code text,
  template_id text not null default 'facility_lookup.default',
  requires_poa boolean not null default true,
  auto_send_allowed boolean not null default false,
  status text not null default 'active' check (status in ('active','inactive','needs_review')),
  priority integer not null default 100,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists grid_owner_contact_routes_company_idx on public.grid_owner_contact_routes (company_id);
create index if not exists grid_owner_contact_routes_lookup_idx on public.grid_owner_contact_routes (coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), grid_owner_id, grid_area_code, request_type, status, priority);

create table if not exists public.customer_site_resolution (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete cascade,
  customer_site_id uuid references public.customer_sites(id) on delete set null,
  customer_application_id uuid,
  grid_owner_id uuid,
  grid_area_code text,
  grid_area_name text,
  grid_owner_name text,
  price_area text check (price_area is null or price_area in ('SE1','SE2','SE3','SE4')),
  resolution_status text not null default 'postal_suggested' check (resolution_status in (
    'postal_suggested','address_resolved','grid_area_resolved','grid_area_master_validated',
    'facility_data_requested','facility_data_received','facility_verified','needs_review','failed'
  )),
  confidence numeric(5,4) not null default 0,
  source_chain jsonb not null default '[]'::jsonb,
  input_snapshot jsonb not null default '{}'::jsonb,
  result_snapshot jsonb not null default '{}'::jsonb,
  automation_allowed boolean not null default false,
  next_required_action text,
  facility_data_verified_at timestamptz,
  verified_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customer_site_resolution_company_idx on public.customer_site_resolution (company_id, customer_id, customer_site_id, created_at desc);
create index if not exists customer_site_resolution_status_idx on public.customer_site_resolution (company_id, resolution_status, created_at desc);
create index if not exists customer_site_resolution_grid_idx on public.customer_site_resolution (grid_area_code, price_area);

create table if not exists public.grid_owner_information_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete cascade,
  customer_site_id uuid references public.customer_sites(id) on delete set null,
  customer_application_id uuid,
  resolution_id uuid references public.customer_site_resolution(id) on delete set null,
  grid_owner_id uuid,
  grid_area_code text,
  price_area text check (price_area is null or price_area in ('SE1','SE2','SE3','SE4')),
  request_type text not null default 'facility_lookup' check (request_type in ('facility_lookup','metering_point_lookup','grid_area_confirmation','metering_values_request','switch_prerequisite_check')),
  status text not null default 'draft' check (status in ('draft','ready_to_send','sent','waiting_response','received','completed','failed','needs_review')),
  channel text not null default 'manual' check (channel in ('email','ediel','portal','manual')),
  template_id text,
  contact_route_id uuid references public.grid_owner_contact_routes(id) on delete set null,
  requested_fields text[] not null default array['facility_id','metering_point_id','grid_area_code','price_area']::text[],
  facility_id text,
  metering_point_id text,
  received_payload jsonb not null default '{}'::jsonb,
  requires_poa boolean not null default true,
  poa_id uuid,
  sent_at timestamptz,
  received_at timestamptz,
  completed_at timestamptz,
  created_by uuid,
  assigned_to uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists grid_owner_information_requests_company_idx on public.grid_owner_information_requests (company_id, status, created_at desc);
create index if not exists grid_owner_information_requests_customer_idx on public.grid_owner_information_requests (company_id, customer_id, customer_site_id);
create unique index if not exists grid_owner_information_requests_open_uidx on public.grid_owner_information_requests (company_id, customer_site_id, request_type) where status in ('draft','ready_to_send','sent','waiting_response','needs_review');

alter table public.website_customer_applications add column if not exists resolution_id uuid;
alter table public.website_customer_applications add column if not exists grid_owner_information_request_id uuid;
alter table public.website_customer_applications add column if not exists grid_area_code text;
alter table public.website_customer_applications add column if not exists grid_owner_id uuid;
alter table public.website_customer_applications add column if not exists price_area_code text;
alter table public.website_customer_applications add column if not exists resolution_status text;
alter table public.website_customer_applications add column if not exists resolution_confidence numeric(5,4);
alter table public.website_customer_applications add column if not exists requested_start_mode text not null default 'earliest_possible' check (requested_start_mode in ('earliest_possible','specific_date'));
alter table public.website_customer_applications add column if not exists calculated_earliest_start_date date;
alter table public.website_customer_applications add column if not exists facility_data_verified_at timestamptz;

alter table public.customer_sites add column if not exists grid_area_code text;
alter table public.customer_sites add column if not exists resolution_id uuid;
alter table public.customer_sites add column if not exists resolution_status text;
alter table public.customer_sites add column if not exists resolution_confidence numeric(5,4);
alter table public.customer_sites add column if not exists latitude numeric;
alter table public.customer_sites add column if not exists longitude numeric;
alter table public.customer_sites add column if not exists sweref99_x numeric;
alter table public.customer_sites add column if not exists sweref99_y numeric;
alter table public.customer_sites add column if not exists facility_data_verified_at timestamptz;

alter table public.metering_points add column if not exists grid_area_code text;
alter table public.metering_points add column if not exists facility_data_verified_at timestamptz;

alter table public.customer_contracts add column if not exists requested_start_mode text not null default 'earliest_possible' check (requested_start_mode in ('earliest_possible','specific_date'));
alter table public.customer_contracts add column if not exists calculated_earliest_start_date date;
alter table public.customer_contracts add column if not exists price_area_used text;
alter table public.customer_contracts add column if not exists grid_area_code_used text;
alter table public.customer_contracts add column if not exists resolution_status text;

alter table public.website_customer_applications drop constraint if exists website_customer_applications_status_check;
alter table public.website_customer_applications
  add constraint website_customer_applications_status_check check (
    status in (
      'received','customer_created','customer_matched','contract_created','confirmation_pending','confirmation_sent',
      'cooling_off_sent','webhook_pending','completed','application_received','linked_existing_customer',
      'needs_address_resolution','address_resolved','grid_area_resolved','needs_facility_data',
      'information_request_ready','information_request_sent','waiting_grid_owner_response','facility_data_received',
      'needs_information','pending_validation','ready_for_switch','switch_requested','switch_confirmed','switch_rejected',
      'active','pending_review','manual_review','rejected','failed','cancelled'
    )
  );

create or replace function public.gridex_normalize_swedish_postal_code(p_postal_code text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(coalesce(p_postal_code, ''), '\\D', '', 'g'), '');
$$;

create or replace function public.gridex_json_text(p_payload jsonb, variadic p_keys text[])
returns text
language plpgsql
immutable
as $$
declare
  k text;
  v text;
begin
  foreach k in array p_keys loop
    v := nullif(trim(p_payload ->> k), '');
    if v is not null then
      return v;
    end if;
  end loop;
  return null;
end;
$$;

create or replace function public.gridex_point_to_grid_area(p_x numeric, p_y numeric)
returns table (
  grid_area_code text,
  grid_area_name text,
  grid_owner_id uuid,
  grid_owner_name text,
  price_area text,
  confidence numeric,
  source text
)
language sql
stable
as $$
  with point_input as (
    select extensions.ST_SetSRID(extensions.ST_MakePoint(p_x::double precision, p_y::double precision), 3006) as geom
  ), matched as (
    select
      g.grid_area_code,
      ga.grid_area_name,
      ga.grid_owner_id,
      coalesce(go.name, ga.grid_owner_name) as grid_owner_name,
      ga.price_area,
      case when ga.grid_area_code is not null then 0.92::numeric else 0.82::numeric end as confidence,
      'svk_arcgis_polygon'::text as source,
      extensions.ST_Area(extensions.ST_Intersection(g.geometry, point_input.geom)) as area_rank
    from public.platform_grid_area_geometries g
    join point_input on extensions.ST_Intersects(g.geometry, point_input.geom)
    left join public.platform_grid_areas ga on ga.grid_area_code = g.grid_area_code and ga.is_active = true
    left join public.platform_grid_owners go on go.id = ga.grid_owner_id
    where g.is_active = true and g.geometry is not null
    order by area_rank desc nulls last, g.imported_at desc
    limit 1
  )
  select grid_area_code, grid_area_name, grid_owner_id, grid_owner_name, price_area, confidence, source
  from matched;
$$;

create or replace function public.gridex_import_grid_area_master_row(
  p_grid_owner_name text,
  p_grid_area_name text,
  p_grid_area_code text,
  p_price_area text,
  p_source text default 'svk_esett',
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner_id uuid;
  v_area_id uuid;
  v_code text := upper(nullif(trim(p_grid_area_code), ''));
  v_price_area text := upper(nullif(trim(p_price_area), ''));
begin
  if v_code is null then
    raise exception 'grid_area_code is required';
  end if;
  if v_price_area not in ('SE1','SE2','SE3','SE4') then
    v_price_area := null;
  end if;

  insert into public.platform_grid_owners (name, source, metadata, updated_at)
  values (nullif(trim(coalesce(p_grid_owner_name, 'Okänd nätägare')), ''), p_source, p_metadata, now())
  on conflict (lower(name)) do update set updated_at = now(), metadata = public.platform_grid_owners.metadata || excluded.metadata
  returning id into v_owner_id;

  insert into public.platform_grid_areas (grid_area_code, grid_area_name, grid_owner_id, grid_owner_name, price_area, source, metadata, updated_at)
  values (v_code, nullif(trim(p_grid_area_name), ''), v_owner_id, nullif(trim(p_grid_owner_name), ''), v_price_area, p_source, p_metadata, now())
  on conflict (grid_area_code) do update set
    grid_area_name = coalesce(excluded.grid_area_name, public.platform_grid_areas.grid_area_name),
    grid_owner_id = coalesce(excluded.grid_owner_id, public.platform_grid_areas.grid_owner_id),
    grid_owner_name = coalesce(excluded.grid_owner_name, public.platform_grid_areas.grid_owner_name),
    price_area = coalesce(excluded.price_area, public.platform_grid_areas.price_area),
    source = excluded.source,
    metadata = public.platform_grid_areas.metadata || excluded.metadata,
    updated_at = now()
  returning id into v_area_id;

  return v_area_id;
end;
$$;

create or replace function public.gridex_import_grid_area_geojson_feature(
  p_feature_id text,
  p_properties jsonb,
  p_geometry_geojson jsonb,
  p_source_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_area_id uuid;
  v_code text;
  v_name text;
  v_owner_name text;
  v_price_area text;
  v_geom extensions.geometry(MultiPolygon, 3006);
begin
  v_code := upper(public.gridex_json_text(p_properties, 'NATOMRADESKOD','NÄTOMRÅDESKOD','Nätområdeskod','natomradeskod','grid_area_code','GRID_AREA_CODE','OMR_KOD','OMRKOD','OMRÅDESKOD','omradeskod','ELNATSOMRADE','ELNÄTSOMRÅDE','kod','KOD'));
  v_name := public.gridex_json_text(p_properties, 'NATOMRADESNAMN','NÄTOMRÅDESNAMN','Nätområdets namn','natomradesnamn','grid_area_name','NAMN','namn','OMR_NAMN');
  v_owner_name := public.gridex_json_text(p_properties, 'ELNATSFORETAG','ELNÄTSFÖRETAG','Elnätsföretag','elnatsforetag','grid_owner_name','NATAGARE','NÄTÄGARE','owner','FORETAG','FÖRETAG');
  v_price_area := upper(public.gridex_json_text(p_properties, 'ELOMRADE','ELOMRÅDE','Elområde','elomrade','price_area','PRICE_AREA','SE_OMRADE','elomr'));

  v_area_id := public.gridex_import_grid_area_master_row(v_owner_name, v_name, v_code, v_price_area, 'svk_arcgis', p_properties);

  if p_geometry_geojson is not null and p_geometry_geojson <> '{}'::jsonb then
    v_geom := extensions.ST_Multi(extensions.ST_Transform(extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON(p_geometry_geojson::text), 4326), 3006));

    insert into public.platform_grid_area_geometries (grid_area_id, grid_area_code, source_feature_id, source_url, source_properties, geometry, geometry_geojson, updated_at)
    values (v_area_id, v_code, p_feature_id, p_source_url, p_properties, v_geom, p_geometry_geojson, now())
    on conflict (source, source_feature_id) where source_feature_id is not null do update set
      grid_area_id = excluded.grid_area_id,
      grid_area_code = excluded.grid_area_code,
      source_url = excluded.source_url,
      source_properties = excluded.source_properties,
      geometry = excluded.geometry,
      geometry_geojson = excluded.geometry_geojson,
      is_active = true,
      imported_at = now(),
      updated_at = now();
  end if;

  return v_area_id;
end;
$$;

-- Platform/masterdata RLS: tenants may read, only platform admins may write in normal RLS context.
alter table public.platform_grid_owners enable row level security;
alter table public.platform_grid_areas enable row level security;
alter table public.platform_grid_area_geometries enable row level security;
alter table public.platform_postal_code_grid_mappings enable row level security;
alter table public.platform_address_lookup_cache enable row level security;
alter table public.platform_energy_lookup_cache enable row level security;
alter table public.platform_data_import_runs enable row level security;
alter table public.platform_data_quality_issues enable row level security;
alter table public.grid_owner_contact_routes enable row level security;
alter table public.customer_site_resolution enable row level security;
alter table public.grid_owner_information_requests enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'platform_grid_owners' and policyname = 'platform_grid_owners_read') then
    create policy platform_grid_owners_read on public.platform_grid_owners for select using (auth.role() = 'service_role' or auth.uid() is not null);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'platform_grid_owners' and policyname = 'platform_grid_owners_platform_write') then
    create policy platform_grid_owners_platform_write on public.platform_grid_owners for all using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin()) with check (auth.role() = 'service_role' or public.gridex_user_is_platform_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'platform_grid_areas' and policyname = 'platform_grid_areas_read') then
    create policy platform_grid_areas_read on public.platform_grid_areas for select using (auth.role() = 'service_role' or auth.uid() is not null);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'platform_grid_areas' and policyname = 'platform_grid_areas_platform_write') then
    create policy platform_grid_areas_platform_write on public.platform_grid_areas for all using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin()) with check (auth.role() = 'service_role' or public.gridex_user_is_platform_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'platform_grid_area_geometries' and policyname = 'platform_grid_area_geometries_read') then
    create policy platform_grid_area_geometries_read on public.platform_grid_area_geometries for select using (auth.role() = 'service_role' or auth.uid() is not null);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'platform_grid_area_geometries' and policyname = 'platform_grid_area_geometries_platform_write') then
    create policy platform_grid_area_geometries_platform_write on public.platform_grid_area_geometries for all using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin()) with check (auth.role() = 'service_role' or public.gridex_user_is_platform_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'platform_postal_code_grid_mappings' and policyname = 'platform_postal_code_grid_mappings_read') then
    create policy platform_postal_code_grid_mappings_read on public.platform_postal_code_grid_mappings for select using (auth.role() = 'service_role' or auth.uid() is not null);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'platform_postal_code_grid_mappings' and policyname = 'platform_postal_code_grid_mappings_platform_write') then
    create policy platform_postal_code_grid_mappings_platform_write on public.platform_postal_code_grid_mappings for all using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin()) with check (auth.role() = 'service_role' or public.gridex_user_is_platform_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'platform_address_lookup_cache' and policyname = 'platform_address_lookup_cache_read') then
    create policy platform_address_lookup_cache_read on public.platform_address_lookup_cache for select using (auth.role() = 'service_role' or auth.uid() is not null);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'platform_address_lookup_cache' and policyname = 'platform_address_lookup_cache_platform_write') then
    create policy platform_address_lookup_cache_platform_write on public.platform_address_lookup_cache for all using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin()) with check (auth.role() = 'service_role' or public.gridex_user_is_platform_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'platform_energy_lookup_cache' and policyname = 'platform_energy_lookup_cache_read') then
    create policy platform_energy_lookup_cache_read on public.platform_energy_lookup_cache for select using (auth.role() = 'service_role' or auth.uid() is not null);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'platform_energy_lookup_cache' and policyname = 'platform_energy_lookup_cache_platform_write') then
    create policy platform_energy_lookup_cache_platform_write on public.platform_energy_lookup_cache for all using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin()) with check (auth.role() = 'service_role' or public.gridex_user_is_platform_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'platform_data_import_runs' and policyname = 'platform_data_import_runs_read') then
    create policy platform_data_import_runs_read on public.platform_data_import_runs for select using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'platform_data_import_runs' and policyname = 'platform_data_import_runs_write') then
    create policy platform_data_import_runs_write on public.platform_data_import_runs for all using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin()) with check (auth.role() = 'service_role' or public.gridex_user_is_platform_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'platform_data_quality_issues' and policyname = 'platform_data_quality_issues_read') then
    create policy platform_data_quality_issues_read on public.platform_data_quality_issues for select using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin() or (company_id is not null and public.gridex_can_read_company(company_id)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'platform_data_quality_issues' and policyname = 'platform_data_quality_issues_write') then
    create policy platform_data_quality_issues_write on public.platform_data_quality_issues for all using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin()) with check (auth.role() = 'service_role' or public.gridex_user_is_platform_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'grid_owner_contact_routes' and policyname = 'grid_owner_contact_routes_read') then
    create policy grid_owner_contact_routes_read on public.grid_owner_contact_routes for select using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin() or company_id is null or public.gridex_can_read_company(company_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'grid_owner_contact_routes' and policyname = 'grid_owner_contact_routes_write') then
    create policy grid_owner_contact_routes_write on public.grid_owner_contact_routes for all using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin() or (company_id is not null and public.gridex_user_can_manage_company(company_id))) with check (auth.role() = 'service_role' or public.gridex_user_is_platform_admin() or (company_id is not null and public.gridex_user_can_manage_company(company_id)));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'customer_site_resolution' and policyname = 'customer_site_resolution_tenant_read') then
    create policy customer_site_resolution_tenant_read on public.customer_site_resolution for select using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'customer_site_resolution' and policyname = 'customer_site_resolution_tenant_write') then
    create policy customer_site_resolution_tenant_write on public.customer_site_resolution for all using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin() or public.gridex_user_can_manage_company(company_id)) with check (auth.role() = 'service_role' or public.gridex_user_is_platform_admin() or public.gridex_user_can_manage_company(company_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'grid_owner_information_requests' and policyname = 'grid_owner_information_requests_tenant_read') then
    create policy grid_owner_information_requests_tenant_read on public.grid_owner_information_requests for select using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'grid_owner_information_requests' and policyname = 'grid_owner_information_requests_tenant_write') then
    create policy grid_owner_information_requests_tenant_write on public.grid_owner_information_requests for all using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin() or public.gridex_user_can_manage_company(company_id)) with check (auth.role() = 'service_role' or public.gridex_user_is_platform_admin() or public.gridex_user_can_manage_company(company_id));
  end if;
end $$;
