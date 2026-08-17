create or replace function private.gridex_guard_site_resolution_materialization_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resolution public.customer_site_resolution%rowtype;
  v_price_safe boolean := false;
  v_coordinates jsonb;
begin
  if new.resolution_id is not distinct from old.resolution_id then
    return new;
  end if;

  if new.resolution_id is null then
    new.grid_owner_id := null;
    new.grid_area_code := null;
    new.price_area_code := null;
    new.latitude := null;
    new.longitude := null;
    new.sweref99_x := null;
    new.sweref99_y := null;
    return new;
  end if;

  select *
    into v_resolution
    from public.customer_site_resolution
   where id = new.resolution_id
     and company_id = new.company_id
     and customer_site_id = new.id;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'customer_site_resolution binding must match company and site';
  end if;

  v_price_safe :=
    v_resolution.price_area in ('SE1', 'SE2', 'SE3', 'SE4')
    and v_resolution.price_area_unique_count = 1
    and (
      v_resolution.price_area_assurance_status = 'verified'
      or (
        v_resolution.price_area_assurance_status = 'estimated'
        and v_resolution.price_area_assurance_confidence >= 0.8
      )
    );

  new.price_area_code := case
    when v_price_safe then v_resolution.price_area
    else null
  end;

  if lower(coalesce(v_resolution.resolution_status, '')) = 'postal_suggested' then
    new.grid_owner_id := null;
    new.grid_area_code := null;
  else
    new.grid_owner_id := v_resolution.grid_owner_id;
    new.grid_area_code := v_resolution.grid_area_code;
  end if;

  v_coordinates := coalesce(v_resolution.result_snapshot->'coordinates', '{}'::jsonb);
  new.latitude := nullif(v_coordinates->>'latitude', '')::numeric;
  new.longitude := nullif(v_coordinates->>'longitude', '')::numeric;
  new.sweref99_x := nullif(v_coordinates->>'sweref99X', '')::numeric;
  new.sweref99_y := nullif(v_coordinates->>'sweref99Y', '')::numeric;

  return new;
end;
$$;

revoke all on function private.gridex_guard_site_resolution_materialization_v1() from public;
revoke all on function private.gridex_guard_site_resolution_materialization_v1() from anon, authenticated;
grant execute on function private.gridex_guard_site_resolution_materialization_v1() to service_role;

drop trigger if exists trg_gridex_guard_site_resolution_materialization_v1 on public.customer_sites;
create trigger trg_gridex_guard_site_resolution_materialization_v1
before update of resolution_id, grid_owner_id, grid_area_code, price_area_code, latitude, longitude, sweref99_x, sweref99_y
on public.customer_sites
for each row
execute function private.gridex_guard_site_resolution_materialization_v1();

drop policy if exists gridex_mp_c67c044a47edb7cb85b8 on public.platform_postal_code_grid_mappings;
drop policy if exists platform_postal_code_grid_mappings_platform_admin_read on public.platform_postal_code_grid_mappings;
create policy platform_postal_code_grid_mappings_platform_admin_read
on public.platform_postal_code_grid_mappings
for select
to authenticated
using ((select public.gridex_user_is_platform_admin()));

comment on function private.gridex_guard_site_resolution_materialization_v1() is
'Fail-closed materialization guard: when a site binds a new canonical energy resolution, only sufficiently trusted price area and resolution-owned exact coordinates/grid context may be copied. Postal suggestions can never bind grid owner/grid area, and unsafe/stale derived site values are cleared.';

comment on policy platform_postal_code_grid_mappings_platform_admin_read on public.platform_postal_code_grid_mappings is
'Shared postcode/grid resolver cache is internal masterdata. Tenant sessions cannot enumerate it; service-role resolver access and platform-admin inspection remain allowed.';
