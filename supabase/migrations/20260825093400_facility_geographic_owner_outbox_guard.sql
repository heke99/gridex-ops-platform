create or replace function public.gridex_assert_verified_site_owner_for_manual_outbox()
returns trigger
language plpgsql
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_request_type text;
  v_request_grid_owner_id uuid;
  v_site_grid_owner_id uuid;
  v_site_grid_area_code text;
  v_site_resolution_status text;
  v_owner_verified boolean;
  v_owner_technical_only boolean;
  v_owner_verification_status text;
  v_site_specific_verified boolean;
begin
  if coalesce(new.external_delivery, false) is not true
     or new.status not in ('queued','sending')
     or new.request_id is null then
    return new;
  end if;

  select r.request_type,
         r.grid_owner_id,
         s.grid_owner_id,
         s.grid_area_code,
         s.resolution_status,
         g.verified_for_customer_flow,
         g.technical_owner_only,
         g.verification_status,
         coalesce(
           csr.id is not null
           and csr.company_id = s.company_id
           and csr.customer_id = s.customer_id
           and csr.customer_site_id = s.id
           and csr.grid_owner_id = s.grid_owner_id
           and csr.resolution_status = 'grid_area_master_validated'
           and csr.automation_allowed is true
           and lower(coalesce(csr.source_claims->>'manual_grid_owner_confirmation','false')) in ('true','1','yes'),
           false
         )
    into v_request_type,
         v_request_grid_owner_id,
         v_site_grid_owner_id,
         v_site_grid_area_code,
         v_site_resolution_status,
         v_owner_verified,
         v_owner_technical_only,
         v_owner_verification_status,
         v_site_specific_verified
    from public.grid_owner_information_requests r
    join public.customer_sites s
      on s.id = r.customer_site_id
     and s.company_id = r.company_id
     and s.customer_id = r.customer_id
    left join public.grid_owners g on g.id = r.grid_owner_id
    left join public.customer_site_resolution csr on csr.id = s.resolution_id
   where r.id = new.request_id
     and r.company_id = new.company_id;

  if not found then
    return new;
  end if;

  if v_request_type in ('facility_lookup', 'facility_identifier_lookup') then
    if v_site_grid_owner_id is null
       or v_request_grid_owner_id is null
       or v_request_grid_owner_id is distinct from v_site_grid_owner_id
       or nullif(btrim(coalesce(v_site_grid_area_code, '')), '') is null
       or coalesce(v_site_resolution_status, '') not in (
         'grid_area_master_validated',
         'facility_data_requested',
         'facility_data_received',
         'facility_verified'
       ) then
      raise exception using
        errcode = '23514',
        message = 'manual_facility_outbox_requires_canonical_geographic_site_owner',
        detail = 'External facility-information mail requires customer_sites.grid_owner_id and grid_area_code from canonical site geography. selected_grid_owner_id and Ediel/PRODAT readiness are not geographical authority.';
    end if;
    return new;
  end if;

  if v_site_grid_owner_id is null
     or v_request_grid_owner_id is null
     or v_request_grid_owner_id is distinct from v_site_grid_owner_id
     or v_owner_verified is distinct from true
     or coalesce(v_owner_verification_status, '') <> 'verified'
     or (coalesce(v_owner_technical_only, false) is true and not coalesce(v_site_specific_verified, false)) then
    raise exception using
      errcode = '23514',
      message = 'manual_grid_owner_outbox_requires_verified_site_owner',
      detail = 'External non-facility grid-owner mail requires exact site ownership and customer-flow verified operational routing.';
  end if;

  return new;
end;
$$;
