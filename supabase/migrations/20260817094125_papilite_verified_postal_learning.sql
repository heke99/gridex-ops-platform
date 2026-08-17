create or replace function private.gridex_learn_verified_postal_mapping_from_site_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_postal_code text;
  v_city text;
  v_grid_area_code text;
  v_price_area text;
  v_now timestamptz := now();
begin
  if lower(coalesce(new.resolution_status, '')) not in ('facility_verified', 'manual_verified') then
    return new;
  end if;

  v_postal_code := regexp_replace(coalesce(new.postal_code, ''), '[^0-9]', '', 'g');
  v_city := nullif(btrim(new.city), '');
  v_grid_area_code := nullif(upper(regexp_replace(coalesce(new.grid_area_code, ''), '\s+', '', 'g')), '');
  v_price_area := nullif(upper(btrim(new.price_area_code)), '');

  if v_postal_code !~ '^[0-9]{5}$'
     or v_grid_area_code is null
     or v_price_area not in ('SE1', 'SE2', 'SE3', 'SE4') then
    return new;
  end if;

  update public.platform_postal_code_grid_mappings
     set price_area = v_price_area,
         confidence = 1.0,
         is_active = true,
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
           'learned_from', 'verified_customer_site',
           'verification_count', coalesce(nullif(metadata->>'verification_count', '')::integer, 0) + 1,
           'last_verified_at', v_now
         ),
         updated_at = v_now
   where postal_code = v_postal_code
     and coalesce(lower(city), '') = coalesce(lower(v_city), '')
     and coalesce(upper(grid_area_code), '') = v_grid_area_code
     and source = 'verified_customer_site';

  if not found then
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
    ) values (
      v_postal_code,
      v_city,
      v_grid_area_code,
      v_price_area,
      1.0,
      'verified_customer_site',
      true,
      jsonb_build_object(
        'learned_from', 'verified_customer_site',
        'verification_count', 1,
        'first_verified_at', v_now,
        'last_verified_at', v_now
      ),
      v_now,
      v_now
    )
    on conflict do nothing;
  end if;

  return new;
end;
$$;

revoke all on function private.gridex_learn_verified_postal_mapping_from_site_v1() from public;
revoke all on function private.gridex_learn_verified_postal_mapping_from_site_v1() from anon, authenticated;
grant execute on function private.gridex_learn_verified_postal_mapping_from_site_v1() to service_role;

drop trigger if exists trg_gridex_learn_verified_postal_mapping_v1 on public.customer_sites;
create trigger trg_gridex_learn_verified_postal_mapping_v1
after insert or update of resolution_status, postal_code, city, grid_area_code, price_area_code
on public.customer_sites
for each row
execute function private.gridex_learn_verified_postal_mapping_from_site_v1();

comment on function private.gridex_learn_verified_postal_mapping_from_site_v1() is
'Learns privacy-safe global postcode to grid/price-area mappings only from tenant site rows that have reached facility_verified or manual_verified. No tenant/customer identifiers are copied into the shared mapping.';
