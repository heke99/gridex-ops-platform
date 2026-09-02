begin;

-- The website-application admin page still reads the historical expires_at name.
-- Keep valid_to/valid_until canonical, but expose a synchronized compatibility
-- projection so a missing legacy column can never make a real signed POA look absent.
alter table public.powers_of_attorney
  add column if not exists expires_at timestamptz null;

create or replace function public.gridex_sync_poa_expires_at()
returns trigger
language plpgsql
set search_path = public, pg_catalog, pg_temp
as $$
begin
  new.expires_at := coalesce(
    new.valid_to,
    case when new.valid_until is null then null
         else new.valid_until::timestamp at time zone 'UTC'
    end
  );
  return new;
end;
$$;

drop trigger if exists powers_of_attorney_sync_expires_at_tg
  on public.powers_of_attorney;
create trigger powers_of_attorney_sync_expires_at_tg
before insert or update of valid_to, valid_until
on public.powers_of_attorney
for each row execute function public.gridex_sync_poa_expires_at();

update public.powers_of_attorney
   set expires_at = coalesce(
         valid_to,
         case when valid_until is null then null
              else valid_until::timestamp at time zone 'UTC'
         end
       )
 where expires_at is distinct from coalesce(
         valid_to,
         case when valid_until is null then null
              else valid_until::timestamp at time zone 'UTC'
         end
       );

-- Canonical website POAs already contain an immutable signed_scope_snapshot.
-- Persist exactly those scopes relationally; never invent or widen consent.
create unique index if not exists power_of_attorney_scopes_poa_scope_uidx
  on public.power_of_attorney_scopes(company_id, power_of_attorney_id, scope_type);

create or replace function public.gridex_materialize_poa_scopes()
returns trigger
language plpgsql
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_scope text;
  v_valid_from date;
  v_valid_to date;
begin
  if lower(coalesce(new.status, '')) <> 'signed' then
    update public.power_of_attorney_scopes s
       set status = coalesce(nullif(lower(new.status), ''), 'inactive'),
           is_active = false,
           valid_to = coalesce(s.valid_to, current_date),
           updated_at = now()
     where s.company_id = new.company_id
       and s.power_of_attorney_id = new.id
       and coalesce(s.is_active, true) = true;
    return new;
  end if;

  if lower(coalesce(new.source, '')) <> 'website_api'
     or jsonb_typeof(new.signed_scope_snapshot) <> 'array'
     or coalesce(jsonb_array_length(new.signed_scope_snapshot), 0) = 0 then
    return new;
  end if;

  v_valid_from := coalesce(new.accepted_at, new.signed_at, new.valid_from, now())::date;
  v_valid_to := coalesce(new.valid_to::date, new.valid_until);

  for v_scope in
    select distinct nullif(btrim(value), '')
      from jsonb_array_elements_text(new.signed_scope_snapshot) as scopes(value)
     where nullif(btrim(value), '') is not null
  loop
    insert into public.power_of_attorney_scopes(
      company_id,
      power_of_attorney_id,
      customer_id,
      site_id,
      metering_point_id,
      customer_contract_id,
      scope_type,
      status,
      is_active,
      valid_from,
      valid_to,
      metadata,
      created_at,
      updated_at
    ) values (
      new.company_id,
      new.id,
      new.customer_id,
      coalesce(new.customer_site_id, new.site_id),
      new.metering_point_id,
      coalesce(new.customer_contract_id, new.contract_id),
      v_scope,
      'active',
      true,
      v_valid_from,
      v_valid_to,
      jsonb_build_object(
        'source', 'powers_of_attorney.signed_scope_snapshot',
        'power_of_attorney_source', new.source,
        'materialization_version', 'signed_scope_v1'
      ),
      now(),
      now()
    )
    on conflict (company_id, power_of_attorney_id, scope_type)
    do update set
      customer_id = excluded.customer_id,
      site_id = excluded.site_id,
      metering_point_id = excluded.metering_point_id,
      customer_contract_id = excluded.customer_contract_id,
      status = 'active',
      is_active = true,
      valid_from = excluded.valid_from,
      valid_to = excluded.valid_to,
      metadata = coalesce(public.power_of_attorney_scopes.metadata, '{}'::jsonb) || excluded.metadata,
      updated_at = now();
  end loop;

  -- If an immutable signed snapshot is ever narrowed by a corrective migration,
  -- stale relational scopes must not remain externally usable.
  update public.power_of_attorney_scopes s
     set status = 'inactive',
         is_active = false,
         valid_to = coalesce(s.valid_to, current_date),
         updated_at = now()
   where s.company_id = new.company_id
     and s.power_of_attorney_id = new.id
     and coalesce(s.is_active, true) = true
     and not exists (
       select 1
         from jsonb_array_elements_text(new.signed_scope_snapshot) x(value)
        where nullif(btrim(x.value), '') = s.scope_type
     );

  return new;
end;
$$;

drop trigger if exists powers_of_attorney_materialize_scopes_tg
  on public.powers_of_attorney;
create trigger powers_of_attorney_materialize_scopes_tg
after insert or update of status, source, signed_scope_snapshot, customer_id,
  customer_site_id, site_id, metering_point_id, customer_contract_id, contract_id,
  accepted_at, signed_at, valid_from, valid_to, valid_until
on public.powers_of_attorney
for each row execute function public.gridex_materialize_poa_scopes();

-- Forward repair existing signed website POAs strictly from their captured scopes.
insert into public.power_of_attorney_scopes(
  company_id,
  power_of_attorney_id,
  customer_id,
  site_id,
  metering_point_id,
  customer_contract_id,
  scope_type,
  status,
  is_active,
  valid_from,
  valid_to,
  metadata,
  created_at,
  updated_at
)
select
  p.company_id,
  p.id,
  p.customer_id,
  coalesce(p.customer_site_id, p.site_id),
  p.metering_point_id,
  coalesce(p.customer_contract_id, p.contract_id),
  scope.value,
  'active',
  true,
  coalesce(p.accepted_at, p.signed_at, p.valid_from, p.created_at)::date,
  coalesce(p.valid_to::date, p.valid_until),
  jsonb_build_object(
    'source', 'powers_of_attorney.signed_scope_snapshot',
    'power_of_attorney_source', p.source,
    'materialization_version', 'signed_scope_v1',
    'backfilled', true
  ),
  now(),
  now()
from public.powers_of_attorney p
cross join lateral (
  select distinct nullif(btrim(value), '') as value
  from jsonb_array_elements_text(p.signed_scope_snapshot) x(value)
  where nullif(btrim(value), '') is not null
) scope
where lower(coalesce(p.status, '')) = 'signed'
  and lower(coalesce(p.source, '')) = 'website_api'
  and jsonb_typeof(p.signed_scope_snapshot) = 'array'
on conflict (company_id, power_of_attorney_id, scope_type)
do update set
  customer_id = excluded.customer_id,
  site_id = excluded.site_id,
  metering_point_id = excluded.metering_point_id,
  customer_contract_id = excluded.customer_contract_id,
  status = 'active',
  is_active = true,
  valid_from = excluded.valid_from,
  valid_to = excluded.valid_to,
  metadata = coalesce(public.power_of_attorney_scopes.metadata, '{}'::jsonb) || excluded.metadata,
  updated_at = now();

-- SVK geodata often publishes a trading name (for example "Ellevio") while
-- the actor registry has the legal name ("Ellevio AB"). Resolve only a unique,
-- production-usable canonical owner; ambiguous names remain untouched.
create or replace function public.gridex_grid_owner_name_key(p_name text)
returns text
language sql
immutable
parallel safe
as $$
  select regexp_replace(
    regexp_replace(
      regexp_replace(lower(btrim(coalesce(p_name, ''))), '[^a-z0-9åäö]+', ' ', 'g'),
      '\\s+(ab|aktiebolag)$',
      '',
      'g'
    ),
    '\\s+',
    '',
    'g'
  );
$$;

with canonical_by_key as materialized (
  select
    public.gridex_grid_owner_name_key(name) as name_key,
    min(id::text)::uuid as canonical_id,
    count(*)::integer as candidate_count
  from public.platform_grid_owners
  where coalesce(is_active, true) = true
    and nullif(btrim(ediel_id), '') is not null
    and ops_grid_owner_id is not null
  group by public.gridex_grid_owner_name_key(name)
),
aliases as materialized (
  select
    pgo.id as alias_id,
    c.canonical_id
  from public.platform_grid_owners pgo
  join canonical_by_key c
    on c.name_key = public.gridex_grid_owner_name_key(pgo.name)
   and c.candidate_count = 1
  where coalesce(pgo.is_active, true) = true
    and pgo.id <> c.canonical_id
    and nullif(btrim(pgo.ediel_id), '') is null
)
update public.platform_grid_areas ga
   set grid_owner_id = a.canonical_id,
       grid_owner_name = canonical.name,
       metadata = coalesce(ga.metadata, '{}'::jsonb) || jsonb_build_object(
         'canonical_grid_owner_rebound_at', now(),
         'canonical_grid_owner_id', a.canonical_id,
         'previous_platform_grid_owner_id', a.alias_id
       ),
       updated_at = now()
  from aliases a
  join public.platform_grid_owners canonical on canonical.id = a.canonical_id
 where ga.grid_owner_id = a.alias_id;

with canonical_by_key as materialized (
  select
    public.gridex_grid_owner_name_key(name) as name_key,
    min(id::text)::uuid as canonical_id,
    count(*)::integer as candidate_count
  from public.platform_grid_owners
  where coalesce(is_active, true) = true
    and nullif(btrim(ediel_id), '') is not null
    and ops_grid_owner_id is not null
  group by public.gridex_grid_owner_name_key(name)
),
aliases as materialized (
  select pgo.id as alias_id, c.canonical_id
  from public.platform_grid_owners pgo
  join canonical_by_key c
    on c.name_key = public.gridex_grid_owner_name_key(pgo.name)
   and c.candidate_count = 1
  where coalesce(pgo.is_active, true) = true
    and pgo.id <> c.canonical_id
    and nullif(btrim(pgo.ediel_id), '') is null
)
update public.platform_grid_owners pgo
   set metadata = coalesce(pgo.metadata, '{}'::jsonb) || jsonb_build_object(
         'canonical_platform_grid_owner_id', a.canonical_id,
         'canonical_alias_bound_at', now()
       ),
       updated_at = now()
  from aliases a
 where pgo.id = a.alias_id;

create or replace function public.gridex_import_grid_area_master_row(
  p_grid_owner_name text,
  p_grid_area_name text,
  p_grid_area_code text,
  p_price_area text,
  p_source text default 'svk_esett'::text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'auth', 'extensions'
as $function$
declare
  v_owner_id uuid;
  v_area_id uuid;
  v_code text := upper(nullif(trim(p_grid_area_code), ''));
  v_price_area text := upper(nullif(trim(p_price_area), ''));
  v_owner_key text := public.gridex_grid_owner_name_key(p_grid_owner_name);
  v_canonical_count integer := 0;
begin
  if v_code is null then
    raise exception 'grid_area_code is required';
  end if;
  if v_price_area not in ('SE1','SE2','SE3','SE4') then
    v_price_area := null;
  end if;

  select min(pgo.id::text)::uuid, count(*)::integer
    into v_owner_id, v_canonical_count
    from public.platform_grid_owners pgo
   where coalesce(pgo.is_active, true) = true
     and public.gridex_grid_owner_name_key(pgo.name) = v_owner_key
     and nullif(btrim(pgo.ediel_id), '') is not null
     and pgo.ops_grid_owner_id is not null;

  if v_canonical_count <> 1 then
    v_owner_id := null;
  end if;

  if v_owner_id is null then
    insert into public.platform_grid_owners(name, source, metadata, updated_at)
    values (
      nullif(trim(coalesce(p_grid_owner_name, 'Okänd nätägare')), ''),
      p_source,
      p_metadata,
      now()
    )
    on conflict (lower(name)) do update
      set updated_at = now(),
          metadata = public.platform_grid_owners.metadata || excluded.metadata
    returning id into v_owner_id;
  end if;

  insert into public.platform_grid_areas(
    grid_area_code,
    grid_area_name,
    grid_owner_id,
    grid_owner_name,
    price_area,
    source,
    metadata,
    updated_at
  )
  values (
    v_code,
    nullif(trim(p_grid_area_name), ''),
    v_owner_id,
    nullif(trim(p_grid_owner_name), ''),
    v_price_area,
    p_source,
    p_metadata,
    now()
  )
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
$function$;

commit;
