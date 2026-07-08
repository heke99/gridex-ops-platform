-- Website application POA/site canonical-field repair.
--
-- Fixes the production mismatch found in real payload testing:
--  * website-generated POA authorization documents require a non-null file_path
--    (fixed in application code; this migration only makes the backing columns explicit)
--  * address RPCs preserved LKA/SE4 only in metadata.claimed_* and reset canonical
--    customer_sites columns to null, which prevented missing-information requests
--    and switch readiness from seeing the submitted grid context.
--
-- Forward-only, idempotent. Keep metadata.claimed_* for audit, but promote valid
-- claimed values into canonical columns used by lifecycle/orchestrator logic.

alter table if exists public.customer_sites
  add column if not exists grid_area_code text,
  add column if not exists price_area_code text,
  add column if not exists bidding_zone_code text,
  add column if not exists grid_owner_id uuid,
  add column if not exists selected_grid_owner_id uuid,
  add column if not exists move_in_date date,
  add column if not exists annual_consumption_kwh numeric,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table if exists public.customer_authorization_documents
  add column if not exists storage_bucket text,
  add column if not exists file_path text,
  add column if not exists file_size_bytes bigint,
  add column if not exists upload_idempotency_key text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists customer_authorization_documents_upload_idempotency_idx
  on public.customer_authorization_documents(company_id, upload_idempotency_key)
  where upload_idempotency_key is not null;

-- Keep the original function signature used by deployed application code.
create or replace function public.gridex_create_customer_site_with_address(
  p_company_id uuid,
  p_customer_id uuid,
  p_site_name text,
  p_facility_id text,
  p_street text,
  p_postal_code text,
  p_city text,
  p_country text,
  p_address_normalized text,
  p_address_hash text,
  p_source text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id uuid;
  v_now timestamptz := now();
  v_country text := coalesce(nullif(btrim(p_country), ''), 'SE');
  v_site_name text := coalesce(nullif(btrim(p_site_name), ''), 'Anläggning');
  v_claimed_grid_area_code text := nullif(btrim(p_metadata ->> 'claimed_grid_area_code'), '');
  v_claimed_price_area_code text := upper(nullif(btrim(p_metadata ->> 'claimed_price_area_code'), ''));
  v_claimed_grid_owner_id uuid := null;
begin
  if p_company_id is null then
    raise exception 'company_id_required' using errcode = '22023';
  end if;
  if p_customer_id is null then
    raise exception 'customer_id_required' using errcode = '22023';
  end if;
  if p_address_hash is null or btrim(p_address_hash) = '' then
    raise exception 'address_hash_required' using errcode = '22023';
  end if;

  if (p_metadata ->> 'claimed_grid_owner_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_claimed_grid_owner_id := (p_metadata ->> 'claimed_grid_owner_id')::uuid;
  end if;

  select id
    into v_site_id
    from public.customer_sites
   where company_id = p_company_id
     and customer_id = p_customer_id
     and address_hash = p_address_hash
     and coalesce(is_active, true) = true
   order by created_at asc
   limit 1
   for update;

  if v_site_id is not null then
    update public.customer_sites
       set site_name = coalesce(nullif(btrim(site_name), ''), v_site_name),
           facility_id = coalesce(nullif(btrim(facility_id), ''), nullif(btrim(p_facility_id), '')),
           street = coalesce(nullif(btrim(street), ''), p_street),
           postal_code = coalesce(nullif(btrim(postal_code), ''), p_postal_code),
           city = coalesce(nullif(btrim(city), ''), p_city),
           country = coalesce(nullif(btrim(country), ''), v_country),
           address_normalized = coalesce(nullif(btrim(address_normalized), ''), p_address_normalized),
           address_hash = coalesce(nullif(btrim(address_hash), ''), p_address_hash),
           address_source = coalesce(nullif(btrim(address_source), ''), coalesce(nullif(btrim(p_source), ''), 'website')),
           address_received_at = coalesce(address_received_at, v_now),
           address_status = case when p_source = 'grid_owner_response' then 'verified' else coalesce(address_status, 'candidate') end,
           address_quality_status = coalesce(address_quality_status, 'complete'),
           facility_data_status = coalesce(facility_data_status, case when p_source = 'grid_owner_response' then 'verified' else 'unverified' end),
           resolution_status = coalesce(resolution_status, 'needs_review'),
           grid_owner_id = coalesce(grid_owner_id, v_claimed_grid_owner_id),
           selected_grid_owner_id = coalesce(selected_grid_owner_id, v_claimed_grid_owner_id),
           grid_area_code = coalesce(nullif(btrim(grid_area_code), ''), v_claimed_grid_area_code),
           price_area_code = coalesce(nullif(btrim(price_area_code), ''), v_claimed_price_area_code),
           bidding_zone_code = coalesce(nullif(btrim(bidding_zone_code), ''), v_claimed_price_area_code),
           metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
           updated_at = v_now
     where id = v_site_id
       and company_id = p_company_id
       and customer_id = p_customer_id;
    return v_site_id;
  end if;

  insert into public.customer_sites (
    company_id,
    customer_id,
    site_name,
    facility_id,
    site_type,
    status,
    is_active,
    street,
    postal_code,
    city,
    country,
    address_normalized,
    address_hash,
    address_source,
    address_received_at,
    address_status,
    address_quality_status,
    address_quality_warnings,
    facility_data_status,
    resolution_status,
    grid_owner_id,
    selected_grid_owner_id,
    grid_area_code,
    price_area_code,
    bidding_zone_code,
    metadata,
    created_at,
    updated_at
  ) values (
    p_company_id,
    p_customer_id,
    v_site_name,
    nullif(btrim(p_facility_id), ''),
    'consumption',
    'draft',
    true,
    p_street,
    p_postal_code,
    p_city,
    v_country,
    p_address_normalized,
    p_address_hash,
    coalesce(nullif(btrim(p_source), ''), 'website'),
    v_now,
    case when p_source = 'grid_owner_response' then 'verified' else 'candidate' end,
    'complete',
    '[]'::jsonb,
    case when p_source = 'grid_owner_response' then 'verified' else 'unverified' end,
    'needs_review',
    v_claimed_grid_owner_id,
    v_claimed_grid_owner_id,
    v_claimed_grid_area_code,
    v_claimed_price_area_code,
    v_claimed_price_area_code,
    coalesce(p_metadata, '{}'::jsonb),
    v_now,
    v_now
  ) returning id into v_site_id;

  insert into public.customer_addresses (
    company_id, customer_id, type, street_1, postal_code, city, country,
    is_active, metadata, created_at, updated_at
  ) values (
    p_company_id, p_customer_id, 'facility', p_street, p_postal_code, p_city,
    v_country, true,
    jsonb_build_object('customer_site_id', v_site_id, 'address_hash', p_address_hash, 'source', p_source),
    v_now, v_now
  );

  insert into public.customer_site_address_history (
    company_id, customer_id, customer_site_id, address_hash, source,
    source_reference, actor_user_id, snapshot
  ) values (
    p_company_id, p_customer_id, v_site_id, p_address_hash,
    coalesce(nullif(btrim(p_source), ''), 'website'), null, null,
    jsonb_build_object(
      'street', p_street,
      'postal_code', p_postal_code,
      'city', p_city,
      'country', v_country,
      'address_hash', p_address_hash,
      'source', p_source,
      'claimed_grid_owner_id', v_claimed_grid_owner_id,
      'claimed_grid_area_code', v_claimed_grid_area_code,
      'claimed_price_area_code', v_claimed_price_area_code
    )
  );

  return v_site_id;
end;
$$;

revoke all on function public.gridex_create_customer_site_with_address(uuid,uuid,text,text,text,text,text,text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.gridex_create_customer_site_with_address(uuid,uuid,text,text,text,text,text,text,text,text,text,jsonb) to service_role;

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
  v_claimed_grid_area_code text := nullif(btrim(p_metadata ->> 'claimed_grid_area_code'), '');
  v_claimed_price_area_code text := upper(nullif(btrim(p_metadata ->> 'claimed_price_area_code'), ''));
  v_claimed_grid_owner_id uuid := null;
begin
  select address_hash
    into v_previous_hash
    from public.customer_sites
   where id = p_site_id
     and company_id = p_company_id
     and customer_id = p_customer_id
   for update;

  if not found then
    raise exception 'customer_site_not_found' using errcode = 'P0002';
  end if;

  if p_address_hash is null or btrim(p_address_hash) = '' then
    raise exception 'address_hash_required' using errcode = '22023';
  end if;

  if (p_metadata ->> 'claimed_grid_owner_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_claimed_grid_owner_id := (p_metadata ->> 'claimed_grid_owner_id')::uuid;
  end if;

  if v_previous_hash is distinct from p_address_hash then
    update public.customer_operation_jobs
       set status = 'needs_review',
           stale_reason = 'site_address_changed_after_operation_started',
           last_error = 'Anläggningsadressen ändrades efter att automationen startades. Begäran måste granskas och startas om.',
           completed_at = v_now,
           locked_at = null,
           locked_by = null,
           lock_token = null,
           updated_at = v_now
     where company_id = p_company_id
       and customer_site_id = p_site_id
       and status in ('queued', 'running', 'waiting_response');

    update public.customer_info_requests
       set status = 'manual_review_required',
           blocker_reason = 'Anläggningsadressen har ändrats efter att begäran skapades. Kontrollera adress och starta om automatiken.',
           updated_at = v_now
     where company_id = p_company_id
       and customer_id = p_customer_id
       and site_id = p_site_id
       and status in ('draft', 'ready_to_send', 'z01_prepared', 'waiting_for_z02', 'waiting_for_aperak', 'waiting_for_contrl');
  end if;

  update public.customer_sites
     set street = p_street,
         postal_code = p_postal_code,
         city = p_city,
         country = p_country,
         care_of = p_care_of,
         apartment_number = p_apartment_number,
         address_normalized = p_address_normalized,
         address_hash = p_address_hash,
         address_source = p_source,
         address_source_reference = p_source_reference,
         address_received_at = v_now,
         address_verified_at = case when p_source = 'grid_owner_response' then v_now else null end,
         address_verification_method = case when p_source = 'grid_owner_response' then 'grid_owner_response' else null end,
         address_confidence = case when p_source = 'grid_owner_response' then 1 else null end,
         address_status = case when p_source = 'grid_owner_response' then 'verified' else 'candidate' end,
         address_quality_status = 'complete',
         address_quality_warnings = '[]'::jsonb,
         grid_owner_id = case when p_source = 'grid_owner_response' then null else coalesce(v_claimed_grid_owner_id, grid_owner_id) end,
         selected_grid_owner_id = case when p_source = 'grid_owner_response' then null else coalesce(v_claimed_grid_owner_id, selected_grid_owner_id) end,
         grid_area_code = case when p_source = 'grid_owner_response' then null else coalesce(v_claimed_grid_area_code, grid_area_code) end,
         price_area_code = case when p_source = 'grid_owner_response' then null else coalesce(v_claimed_price_area_code, price_area_code) end,
         bidding_zone_code = case when p_source = 'grid_owner_response' then null else coalesce(v_claimed_price_area_code, bidding_zone_code) end,
         resolution_id = null,
         resolution_status = 'needs_review',
         resolution_confidence = null,
         facility_data_status = case when p_source = 'grid_owner_response' then 'verified' else 'unverified' end,
         metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
         updated_at = v_now
   where id = p_site_id
     and company_id = p_company_id
     and customer_id = p_customer_id;

  update public.metering_points
     set grid_owner_id = case when p_source = 'grid_owner_response' then null else coalesce(v_claimed_grid_owner_id, grid_owner_id) end,
         grid_area_code = case when p_source = 'grid_owner_response' then null else coalesce(v_claimed_grid_area_code, grid_area_code) end,
         price_area_code = case when p_source = 'grid_owner_response' then null else coalesce(v_claimed_price_area_code, price_area_code) end,
         verification_status = 'pending_verification',
         updated_at = v_now
   where company_id = p_company_id
     and site_id = p_site_id
     and status <> 'closed';

  select id into v_address_id
    from public.customer_addresses
   where company_id = p_company_id
     and customer_id = p_customer_id
     and type = 'facility'
     and metadata @> jsonb_build_object('customer_site_id', p_site_id)
   order by updated_at desc nulls last
   limit 1
   for update;

  if v_address_id is null then
    insert into public.customer_addresses (
      company_id, customer_id, type, street_1, street_2, postal_code, city,
      country, is_active, metadata, created_at, updated_at
    ) values (
      p_company_id, p_customer_id, 'facility', p_street, p_care_of, p_postal_code,
      p_city, p_country, true,
      jsonb_build_object('customer_site_id', p_site_id, 'address_hash', p_address_hash, 'source', p_source),
      v_now, v_now
    );
  else
    update public.customer_addresses
       set street_1 = p_street,
           street_2 = p_care_of,
           postal_code = p_postal_code,
           city = p_city,
           country = p_country,
           is_active = true,
           metadata = jsonb_build_object('customer_site_id', p_site_id, 'address_hash', p_address_hash, 'source', p_source),
           updated_at = v_now
     where id = v_address_id;
  end if;

  insert into public.customer_site_address_history (
    company_id, customer_id, customer_site_id, address_hash, source,
    source_reference, actor_user_id, snapshot
  ) values (
    p_company_id, p_customer_id, p_site_id, p_address_hash, p_source,
    p_source_reference, p_actor_user_id,
    jsonb_build_object(
      'street', p_street,
      'postal_code', p_postal_code,
      'city', p_city,
      'country', p_country,
      'care_of', p_care_of,
      'apartment_number', p_apartment_number,
      'address_hash', p_address_hash,
      'source', p_source,
      'source_reference', p_source_reference,
      'claimed_grid_owner_id', v_claimed_grid_owner_id,
      'claimed_grid_area_code', v_claimed_grid_area_code,
      'claimed_price_area_code', v_claimed_price_area_code
    )
  );
end;
$$;

revoke all on function public.gridex_commit_customer_site_address(uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, text, jsonb, uuid) from public;
revoke all on function public.gridex_commit_customer_site_address(uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, text, jsonb, uuid) from anon;
revoke all on function public.gridex_commit_customer_site_address(uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, text, jsonb, uuid) from authenticated;
grant execute on function public.gridex_commit_customer_site_address(uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, text, jsonb, uuid) to service_role;



-- Defensive DB hardening: every authorization document must have a non-null
-- file_path. This protects production even if an older/parallel application
-- path inserts a website-generated POA snapshot without file_path.
create or replace function public.gridex_fill_customer_authorization_document_file_path()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_company text;
  v_customer text;
  v_poa_or_doc text;
begin
  if new.file_path is null or btrim(new.file_path) = '' then
    v_company := coalesce(new.company_id::text, 'unknown-company');
    v_customer := coalesce(new.customer_id::text, 'unknown-customer');
    v_poa_or_doc := coalesce(
      new.power_of_attorney_id::text,
      nullif(regexp_replace(coalesce(new.reference, ''), '^POA-', ''), ''),
      new.id::text
    );

    new.storage_bucket := coalesce(nullif(btrim(new.storage_bucket), ''), 'customer-documents');
    new.file_path := concat('companies/', v_company, '/customers/', v_customer, '/authorizations/', v_poa_or_doc, '.json');
  end if;

  if (new.file_name is null or btrim(new.file_name) = '') and new.document_type = 'power_of_attorney' then
    new.file_name := concat('fullmakt-', coalesce(nullif(new.reference, ''), new.power_of_attorney_id::text, new.id::text), '.json');
  end if;

  return new;
end;
$$;

do $$
begin
  if to_regclass('public.customer_authorization_documents') is not null then
    drop trigger if exists gridex_customer_authorization_documents_file_path_biut
      on public.customer_authorization_documents;

    create trigger gridex_customer_authorization_documents_file_path_biut
      before insert or update on public.customer_authorization_documents
      for each row
      execute function public.gridex_fill_customer_authorization_document_file_path();
  end if;
end $$;

do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception when others then
  null;
end $$;
