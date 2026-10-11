-- OPS API review F21 (quality/audits/2026-10-07-ops-api-review/STATE-FAILURE-FINDINGS.md).
-- Forward replacement of gridex_commit_customer_site_address with the same
-- signature and ACL. The verified-source conflict decision is repeated under
-- the locked customer_sites row, and a same-hash commit from a lower-ranked
-- source no longer downgrades the canonical source or verification.

create or replace function public.gridex_commit_customer_site_address(
  p_company_id uuid,
  p_customer_id uuid,
  p_site_id uuid,
  p_street text,
  p_postal_code text,
  p_city text,
  p_country text,
  p_care_of text,
  p_apartment_number text,
  p_address_normalized text,
  p_address_hash text,
  p_source text,
  p_source_reference text,
  p_metadata jsonb default '{}'::jsonb,
  p_actor_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous_hash text;
  v_address_id uuid;
  v_now timestamptz := now();
  v_address_changed boolean;
  v_previous_source text;
  v_previous_verified boolean;
  v_previous_rank integer;
  v_incoming_rank integer;
  v_keep_authority boolean;
begin
  select address_hash, address_source,
         (address_verified_at is not null or address_verification_method = 'grid_owner_response')
    into v_previous_hash, v_previous_source, v_previous_verified
    from public.customer_sites
   where id = p_site_id and company_id = p_company_id and customer_id = p_customer_id
   for update;
  if not found then raise exception 'customer_site_not_found' using errcode = 'P0002'; end if;
  if nullif(btrim(p_address_hash), '') is null then raise exception 'address_hash_required' using errcode = '22023'; end if;

  -- Source authority mirrors lib/customer-sites/addressIntake.ts sourceRank().
  -- Unknown stored/incoming values never trigger a conflict (rank NULL).
  v_previous_rank := case coalesce(v_previous_source, 'import')
    when 'grid_owner_response' then 70 when 'superadmin' then 60 when 'tenant_api' then 50
    when 'manual_intake' then 40 when 'website' then 30 when 'customer_portal' then 20 when 'import' then 10 end;
  v_incoming_rank := case p_source
    when 'grid_owner_response' then 70 when 'superadmin' then 60 when 'tenant_api' then 50
    when 'manual_intake' then 40 when 'website' then 30 when 'customer_portal' then 20 when 'import' then 10 end;

  -- NULL -> canonical hash is the first canonicalization of the address already
  -- present on the site. It is not a later customer address change and must not
  -- stale jobs, requests, grid context or metering context.
  v_address_changed := v_previous_hash is not null and v_previous_hash is distinct from p_address_hash;

  -- F21: repeat the verified-address conflict decision atomically under the
  -- locked row. A lower-ranked source may not replace a verified address.
  if v_address_changed and coalesce(v_previous_verified, false) and v_incoming_rank < v_previous_rank then
    raise exception 'verified_address_conflict' using errcode = 'P0001',
      detail = 'A lower-ranked address source cannot replace a verified facility address.';
  end if;
  -- Same physical address from a lower-ranked source keeps the canonical
  -- source, reference and verification; only receipt/informational fields move.
  v_keep_authority := not v_address_changed and v_previous_hash is not null and v_incoming_rank < v_previous_rank;

  if v_address_changed then
    update public.customer_operation_jobs
       set status = 'needs_review', stale_reason = 'site_address_changed_after_operation_started',
           last_error = 'Anläggningsadressen ändrades. Nätägar- och routinguppgifter har ogiltigförklarats.',
           completed_at = v_now, locked_at = null, locked_by = null, lock_token = null, updated_at = v_now
     where company_id = p_company_id and customer_site_id = p_site_id
       and status in ('queued','running','waiting_response');

    update public.customer_info_requests
       set status = 'manual_review_required', blocker_reason = 'Anläggningsadressen ändrades. Skapa en ny nätägarresolution och begäran.', updated_at = v_now
     where company_id = p_company_id and customer_id = p_customer_id and site_id = p_site_id
       and status in ('draft','ready_to_send','z01_prepared','waiting_for_z02','waiting_for_aperak','waiting_for_contrl');

    update public.grid_owner_information_requests
       set status = 'needs_review',
           last_error_code = 'site_address_changed',
           last_error_message = 'Begäran gäller en tidigare adress och får inte återanvändas.',
           metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('stale',true,'stale_at',v_now,'stale_reason','site_address_changed'),
           updated_at = v_now
     where company_id = p_company_id and customer_id = p_customer_id and customer_site_id = p_site_id
       and status in ('draft','ready_to_send','sent','waiting_response','blocked_missing_poa','blocked_missing_grid_owner_contact',
                      'blocked_missing_manual_mailbox','ready_to_send_manual_email','manual_email_queued','manual_email_sent','waiting_manual_response');

    update public.manual_email_outbox o
       set status = case when o.status in ('queued','sending') then 'failed' else o.status end,
           last_error = case when o.status in ('queued','sending') then 'Begäran ogiltigförklarades eftersom anläggningsadressen ändrades.' else o.last_error end,
           updated_at = v_now
      from public.grid_owner_information_requests r
     where o.request_id = r.id and r.company_id = p_company_id and r.customer_site_id = p_site_id
       and o.status in ('queued','sending');
  end if;

  update public.customer_sites
     set street = p_street, postal_code = p_postal_code, city = p_city, country = p_country,
         care_of = p_care_of, apartment_number = p_apartment_number,
         address_normalized = p_address_normalized, address_hash = p_address_hash,
         address_source = case when v_keep_authority then address_source else p_source end,
         address_source_reference = case when v_keep_authority then address_source_reference else p_source_reference end,
         address_received_at = v_now,
         address_verified_at = case when v_keep_authority then address_verified_at when p_source = 'grid_owner_response' then v_now else null end,
         address_verification_method = case when v_keep_authority then address_verification_method when p_source = 'grid_owner_response' then 'grid_owner_response' else null end,
         address_confidence = case when v_keep_authority then address_confidence when p_source = 'grid_owner_response' then 1 else null end,
         address_status = case when v_keep_authority then address_status when p_source = 'grid_owner_response' then 'verified' else 'candidate' end,
         address_quality_status = 'complete', address_quality_warnings = '[]'::jsonb,
         -- Canonical grid context is always derived by the resolver or a verified
         -- grid-owner response. Claimed values remain evidence in metadata only.
         grid_owner_id = case when v_address_changed then null else grid_owner_id end,
         selected_grid_owner_id = case when v_address_changed then null else selected_grid_owner_id end,
         grid_area_code = case when v_address_changed then null else grid_area_code end,
         price_area_code = case when v_address_changed then null else price_area_code end,
         bidding_zone_code = case when v_address_changed then null else bidding_zone_code end,
         resolution_id = case when v_address_changed then null else resolution_id end,
         resolution_status = case when v_address_changed then 'pending_resolution' else resolution_status end,
         resolution_confidence = case when v_address_changed then null else resolution_confidence end,
         facility_data_status = case when v_keep_authority then facility_data_status when p_source = 'grid_owner_response' then 'verified' when v_address_changed then 'unverified' else facility_data_status end,
         metadata = coalesce(metadata,'{}'::jsonb) || coalesce(p_metadata,'{}'::jsonb), updated_at = v_now
   where id = p_site_id and company_id = p_company_id and customer_id = p_customer_id;

  if v_address_changed then
    update public.metering_points
       set grid_owner_id = null, grid_area_code = null, price_area_code = null,
           verification_status = 'pending_verification', updated_at = v_now
     where company_id = p_company_id and (site_id = p_site_id or customer_site_id = p_site_id) and status <> 'closed';
  end if;

  select id into v_address_id from public.customer_addresses
   where company_id = p_company_id and customer_id = p_customer_id and type = 'facility'
     and metadata @> jsonb_build_object('customer_site_id', p_site_id)
   order by updated_at desc nulls last limit 1 for update;
  if v_address_id is null then
    insert into public.customer_addresses(company_id,customer_id,type,street_1,street_2,postal_code,city,country,is_active,metadata,created_at,updated_at)
    values(p_company_id,p_customer_id,'facility',p_street,p_care_of,p_postal_code,p_city,p_country,true,
      jsonb_build_object('customer_site_id',p_site_id,'address_hash',p_address_hash,'source',p_source),v_now,v_now);
  else
    update public.customer_addresses set street_1=p_street,street_2=p_care_of,postal_code=p_postal_code,city=p_city,country=p_country,
      is_active=true,metadata=jsonb_build_object('customer_site_id',p_site_id,'address_hash',p_address_hash,'source',p_source),updated_at=v_now
    where id=v_address_id;
  end if;

  insert into public.customer_site_address_history(company_id,customer_id,customer_site_id,address_hash,source,source_reference,actor_user_id,snapshot)
  values(p_company_id,p_customer_id,p_site_id,p_address_hash,p_source,p_source_reference,p_actor_user_id,
    jsonb_build_object('street',p_street,'postal_code',p_postal_code,'city',p_city,'country',p_country,'care_of',p_care_of,
      'apartment_number',p_apartment_number,'address_hash',p_address_hash,'source',p_source,'source_reference',p_source_reference,
      'claimed_grid_owner_id',p_metadata->>'claimed_grid_owner_id','claimed_grid_area_code',p_metadata->>'claimed_grid_area_code',
      'claimed_price_area_code',p_metadata->>'claimed_price_area_code','derived_context_invalidated',v_address_changed));
end;
$$;

revoke all on function public.gridex_commit_customer_site_address(uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.gridex_commit_customer_site_address(uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,jsonb,uuid) to service_role;
