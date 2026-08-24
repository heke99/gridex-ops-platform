create or replace function private.gridex_select_provisional_grid_owner_from_unique_postal_city_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resolution jsonb;
  v_assurance jsonb;
  v_evidence jsonb;
  v_postal_code text;
  v_city text;
  v_evidence_city text;
  v_evidence_grid_area_code text;
  v_mapping_count integer := 0;
  v_distinct_grid_area_count integer := 0;
  v_distinct_price_area_count integer := 0;
  v_grid_area_code text;
  v_grid_area_name text;
  v_price_area text;
  v_ops_grid_owner_id uuid;
  v_grid_owner_name text;
  v_mapping_confidence numeric;
begin
  -- A verified canonical owner always wins. Never overwrite an explicit or
  -- previously selected owner.
  if new.grid_owner_id is not null
     or new.selected_grid_owner_id is not null
     or coalesce(new.is_active, true) is not true
     or nullif(btrim(coalesce(new.address_hash, '')), '') is null then
    return new;
  end if;

  v_resolution := coalesce(new.metadata, '{}'::jsonb) -> 'energy_resolution';
  if jsonb_typeof(v_resolution) <> 'object' then
    return new;
  end if;

  v_assurance := v_resolution -> 'priceAreaAssurance';
  v_evidence := v_assurance -> 'evidence';
  if jsonb_typeof(v_assurance) <> 'object'
     or jsonb_typeof(v_evidence) <> 'object'
     or v_assurance ->> 'source' <> 'postal_city_consensus'
     or v_evidence ->> 'city_scope' <> 'exact_city'
     or v_assurance ->> 'candidateCount' <> '1'
     or v_assurance ->> 'uniquePriceAreaCount' <> '1'
     or v_evidence ->> 'candidate_count' <> '1'
     or coalesce(v_evidence ->> 'mapping_conflict_count', '0') <> '0'
     or coalesce(v_evidence ->> 'unknown_candidate_count', '0') <> '0'
     or coalesce(v_evidence ->> 'candidate_limit_exceeded', 'false') <> 'false'
     or jsonb_typeof(v_evidence -> 'grid_area_codes') <> 'array'
     or jsonb_array_length(v_evidence -> 'grid_area_codes') <> 1 then
    return new;
  end if;

  if coalesce(v_assurance ->> 'confidence', '') !~ '^[0-9]+([.][0-9]+)?$'
     or (v_assurance ->> 'confidence')::numeric < 0.8 then
    return new;
  end if;

  v_postal_code := regexp_replace(coalesce(new.postal_code, ''), '[^0-9]', '', 'g');
  v_city := lower(regexp_replace(btrim(coalesce(new.city, '')), '\s+', ' ', 'g'));
  v_evidence_city := lower(regexp_replace(btrim(coalesce(v_evidence ->> 'requested_city', '')), '\s+', ' ', 'g'));
  v_evidence_grid_area_code := upper(regexp_replace(coalesce(v_evidence -> 'grid_area_codes' ->> 0, ''), '\s+', '', 'g'));

  if v_postal_code !~ '^[0-9]{5}$'
     or v_city = ''
     or regexp_replace(coalesce(v_evidence ->> 'postal_code', ''), '[^0-9]', '', 'g') <> v_postal_code
     or v_evidence_city <> v_city
     or v_evidence_grid_area_code = '' then
    return new;
  end if;

  -- Re-check live masterdata. Metadata is evidence, never authority. Exactly
  -- one active mapping for the exact postcode + city is required.
  select
    count(*)::integer,
    count(distinct upper(regexp_replace(coalesce(m.grid_area_code, ''), '\s+', '', 'g')))::integer,
    count(distinct upper(coalesce(m.price_area, '')))::integer
  into v_mapping_count, v_distinct_grid_area_count, v_distinct_price_area_count
  from public.platform_postal_code_grid_mappings m
  where m.is_active = true
    and regexp_replace(coalesce(m.postal_code, ''), '[^0-9]', '', 'g') = v_postal_code
    and lower(regexp_replace(btrim(coalesce(m.city, '')), '\s+', ' ', 'g')) = v_city;

  if v_mapping_count <> 1
     or v_distinct_grid_area_count <> 1
     or v_distinct_price_area_count <> 1 then
    return new;
  end if;

  select
    upper(regexp_replace(m.grid_area_code, '\s+', '', 'g')),
    ga.grid_area_name,
    upper(m.price_area),
    pgo.ops_grid_owner_id,
    pgo.name,
    m.confidence
  into
    v_grid_area_code,
    v_grid_area_name,
    v_price_area,
    v_ops_grid_owner_id,
    v_grid_owner_name,
    v_mapping_confidence
  from public.platform_postal_code_grid_mappings m
  join public.platform_grid_areas ga
    on upper(regexp_replace(ga.grid_area_code, '\s+', '', 'g')) = upper(regexp_replace(m.grid_area_code, '\s+', '', 'g'))
   and ga.is_active = true
  join public.platform_grid_owners pgo
    on pgo.id = ga.grid_owner_id
  where m.is_active = true
    and regexp_replace(coalesce(m.postal_code, ''), '[^0-9]', '', 'g') = v_postal_code
    and lower(regexp_replace(btrim(coalesce(m.city, '')), '\s+', ' ', 'g')) = v_city
  limit 1;

  if v_grid_area_code is null
     or v_ops_grid_owner_id is null
     or coalesce(v_mapping_confidence, 0) < 0.8
     or v_grid_area_code <> v_evidence_grid_area_code
     or upper(coalesce(v_price_area, '')) <> upper(coalesce(ga_price_area_from_resolution(v_resolution), v_price_area))
     or (new.price_area_code is not null and upper(new.price_area_code) <> upper(v_price_area)) then
    return new;
  end if;

  new.selected_grid_owner_id := v_ops_grid_owner_id;
  new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
    'provisional_grid_owner_selection',
    jsonb_build_object(
      'source', 'unique_postal_city_masterdata',
      'canonical', false,
      'postal_code', v_postal_code,
      'city', new.city,
      'grid_area_code_candidate', v_grid_area_code,
      'grid_area_name_candidate', v_grid_area_name,
      'grid_owner_id', v_ops_grid_owner_id,
      'grid_owner_name', v_grid_owner_name,
      'price_area', v_price_area,
      'confidence', v_mapping_confidence,
      'selected_at', now(),
      'purpose', 'facility_information_routing'
    )
  );

  return new;
end;
$$;

-- Helper kept private so the trigger can compare the resolver price area
-- without trusting a caller-controlled site field.
create or replace function private.ga_price_area_from_resolution(p_resolution jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select upper(nullif(btrim(coalesce(p_resolution ->> 'priceArea', '')), ''));
$$;

-- Recreate the trigger function after the helper exists with a schema-qualified
-- helper call. PostgreSQL resolves this at execution time.
create or replace function private.gridex_select_provisional_grid_owner_from_unique_postal_city_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resolution jsonb;
  v_assurance jsonb;
  v_evidence jsonb;
  v_postal_code text;
  v_city text;
  v_evidence_city text;
  v_evidence_grid_area_code text;
  v_mapping_count integer := 0;
  v_distinct_grid_area_count integer := 0;
  v_distinct_price_area_count integer := 0;
  v_grid_area_code text;
  v_grid_area_name text;
  v_price_area text;
  v_ops_grid_owner_id uuid;
  v_grid_owner_name text;
  v_mapping_confidence numeric;
begin
  if new.grid_owner_id is not null
     or new.selected_grid_owner_id is not null
     or coalesce(new.is_active, true) is not true
     or nullif(btrim(coalesce(new.address_hash, '')), '') is null then
    return new;
  end if;

  v_resolution := coalesce(new.metadata, '{}'::jsonb) -> 'energy_resolution';
  if jsonb_typeof(v_resolution) <> 'object' then return new; end if;

  v_assurance := v_resolution -> 'priceAreaAssurance';
  v_evidence := v_assurance -> 'evidence';
  if jsonb_typeof(v_assurance) <> 'object'
     or jsonb_typeof(v_evidence) <> 'object'
     or v_assurance ->> 'source' <> 'postal_city_consensus'
     or v_evidence ->> 'city_scope' <> 'exact_city'
     or v_assurance ->> 'candidateCount' <> '1'
     or v_assurance ->> 'uniquePriceAreaCount' <> '1'
     or v_evidence ->> 'candidate_count' <> '1'
     or coalesce(v_evidence ->> 'mapping_conflict_count', '0') <> '0'
     or coalesce(v_evidence ->> 'unknown_candidate_count', '0') <> '0'
     or coalesce(v_evidence ->> 'candidate_limit_exceeded', 'false') <> 'false'
     or jsonb_typeof(v_evidence -> 'grid_area_codes') <> 'array'
     or jsonb_array_length(v_evidence -> 'grid_area_codes') <> 1 then
    return new;
  end if;

  if coalesce(v_assurance ->> 'confidence', '') !~ '^[0-9]+([.][0-9]+)?$'
     or (v_assurance ->> 'confidence')::numeric < 0.8 then
    return new;
  end if;

  v_postal_code := regexp_replace(coalesce(new.postal_code, ''), '[^0-9]', '', 'g');
  v_city := lower(regexp_replace(btrim(coalesce(new.city, '')), '\s+', ' ', 'g'));
  v_evidence_city := lower(regexp_replace(btrim(coalesce(v_evidence ->> 'requested_city', '')), '\s+', ' ', 'g'));
  v_evidence_grid_area_code := upper(regexp_replace(coalesce(v_evidence -> 'grid_area_codes' ->> 0, ''), '\s+', '', 'g'));
  if v_postal_code !~ '^[0-9]{5}$'
     or v_city = ''
     or regexp_replace(coalesce(v_evidence ->> 'postal_code', ''), '[^0-9]', '', 'g') <> v_postal_code
     or v_evidence_city <> v_city
     or v_evidence_grid_area_code = '' then
    return new;
  end if;

  select count(*)::integer,
         count(distinct upper(regexp_replace(coalesce(m.grid_area_code, ''), '\s+', '', 'g')))::integer,
         count(distinct upper(coalesce(m.price_area, '')))::integer
    into v_mapping_count, v_distinct_grid_area_count, v_distinct_price_area_count
  from public.platform_postal_code_grid_mappings m
  where m.is_active = true
    and regexp_replace(coalesce(m.postal_code, ''), '[^0-9]', '', 'g') = v_postal_code
    and lower(regexp_replace(btrim(coalesce(m.city, '')), '\s+', ' ', 'g')) = v_city;

  if v_mapping_count <> 1 or v_distinct_grid_area_count <> 1 or v_distinct_price_area_count <> 1 then
    return new;
  end if;

  select upper(regexp_replace(m.grid_area_code, '\s+', '', 'g')),
         ga.grid_area_name,
         upper(m.price_area),
         pgo.ops_grid_owner_id,
         pgo.name,
         m.confidence
    into v_grid_area_code, v_grid_area_name, v_price_area, v_ops_grid_owner_id, v_grid_owner_name, v_mapping_confidence
  from public.platform_postal_code_grid_mappings m
  join public.platform_grid_areas ga
    on upper(regexp_replace(ga.grid_area_code, '\s+', '', 'g')) = upper(regexp_replace(m.grid_area_code, '\s+', '', 'g'))
   and ga.is_active = true
  join public.platform_grid_owners pgo on pgo.id = ga.grid_owner_id
  where m.is_active = true
    and regexp_replace(coalesce(m.postal_code, ''), '[^0-9]', '', 'g') = v_postal_code
    and lower(regexp_replace(btrim(coalesce(m.city, '')), '\s+', ' ', 'g')) = v_city
  limit 1;

  if v_grid_area_code is null
     or v_ops_grid_owner_id is null
     or coalesce(v_mapping_confidence, 0) < 0.8
     or v_grid_area_code <> v_evidence_grid_area_code
     or upper(coalesce(v_price_area, '')) <> upper(coalesce(private.ga_price_area_from_resolution(v_resolution), v_price_area))
     or (new.price_area_code is not null and upper(new.price_area_code) <> upper(v_price_area)) then
    return new;
  end if;

  new.selected_grid_owner_id := v_ops_grid_owner_id;
  new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
    'provisional_grid_owner_selection',
    jsonb_build_object(
      'source', 'unique_postal_city_masterdata',
      'canonical', false,
      'postal_code', v_postal_code,
      'city', new.city,
      'grid_area_code_candidate', v_grid_area_code,
      'grid_area_name_candidate', v_grid_area_name,
      'grid_owner_id', v_ops_grid_owner_id,
      'grid_owner_name', v_grid_owner_name,
      'price_area', v_price_area,
      'confidence', v_mapping_confidence,
      'selected_at', now(),
      'purpose', 'facility_information_routing'
    )
  );
  return new;
end;
$$;

revoke all on function private.ga_price_area_from_resolution(jsonb) from public, anon, authenticated;
grant execute on function private.ga_price_area_from_resolution(jsonb) to service_role;
revoke all on function private.gridex_select_provisional_grid_owner_from_unique_postal_city_v1() from public, anon, authenticated;
grant execute on function private.gridex_select_provisional_grid_owner_from_unique_postal_city_v1() to service_role;

drop trigger if exists trg_gridex_select_provisional_grid_owner_from_unique_postal_city_v1 on public.customer_sites;
create trigger trg_gridex_select_provisional_grid_owner_from_unique_postal_city_v1
before insert or update of postal_code, city, address_hash, metadata, price_area_code, grid_owner_id, selected_grid_owner_id
on public.customer_sites
for each row
execute function private.gridex_select_provisional_grid_owner_from_unique_postal_city_v1();

-- Repair only active unresolved sites. The trigger independently revalidates
-- all exact-city masterdata predicates before selecting an owner.
update public.customer_sites
set selected_grid_owner_id = selected_grid_owner_id,
    updated_at = now()
where is_active = true
  and grid_owner_id is null
  and selected_grid_owner_id is null
  and nullif(btrim(coalesce(address_hash, '')), '') is not null
  and coalesce(metadata -> 'energy_resolution' -> 'priceAreaAssurance' ->> 'source', '') = 'postal_city_consensus';

comment on function private.gridex_select_provisional_grid_owner_from_unique_postal_city_v1() is
'Safely selects a provisional OPS grid owner for facility-information routing only when exact postcode+city masterdata and resolver evidence both contain one conflict-free candidate. It never materializes canonical grid_owner_id or grid_area_code.';
