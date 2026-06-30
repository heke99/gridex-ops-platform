-- Repairs the website signup site-provisioning RPC used by
-- POST /api/v1/website/customer-applications.
--
-- The original function name/signature is preserved so deployed API code and
-- existing Supabase grants keep working. The replacement body fixes the broken
-- customer_sites insert column list and keeps site + address + history writes in
-- one PostgreSQL transaction.

alter table if exists public.customer_sites
  add column if not exists apartment_number text,
  add column if not exists address_normalized text,
  add column if not exists address_hash text,
  add column if not exists address_source text,
  add column if not exists address_source_reference text,
  add column if not exists address_received_at timestamptz,
  add column if not exists address_status text not null default 'incomplete',
  add column if not exists address_quality_status text null,
  add column if not exists address_quality_warnings jsonb not null default '[]'::jsonb,
  add column if not exists facility_data_status text not null default 'unverified',
  add column if not exists resolution_status text null;

create table if not exists public.customer_site_address_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  customer_site_id uuid not null references public.customer_sites(id) on delete cascade,
  address_hash text,
  source text not null,
  source_reference text,
  actor_user_id uuid references auth.users(id) on delete set null,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists customer_sites_address_hash_idx
  on public.customer_sites(company_id, customer_id, address_hash)
  where address_hash is not null;

create index if not exists customer_site_address_history_lookup_idx
  on public.customer_site_address_history(company_id, customer_site_id, created_at desc);

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
           address_source = coalesce(nullif(btrim(address_source), ''), p_source),
           address_received_at = coalesce(address_received_at, v_now),
           address_status = case when p_source = 'grid_owner_response' then 'verified' else coalesce(address_status, 'candidate') end,
           address_quality_status = coalesce(address_quality_status, 'complete'),
           facility_data_status = coalesce(facility_data_status, case when p_source = 'grid_owner_response' then 'verified' else 'unverified' end),
           resolution_status = coalesce(resolution_status, 'needs_review'),
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
    coalesce(p_metadata, '{}'::jsonb),
    v_now,
    v_now
  ) returning id into v_site_id;

  insert into public.customer_addresses (
    company_id,
    customer_id,
    type,
    street_1,
    postal_code,
    city,
    country,
    is_active,
    metadata,
    created_at,
    updated_at
  ) values (
    p_company_id,
    p_customer_id,
    'facility',
    p_street,
    p_postal_code,
    p_city,
    v_country,
    true,
    jsonb_build_object('customer_site_id', v_site_id, 'address_hash', p_address_hash, 'source', p_source),
    v_now,
    v_now
  );

  insert into public.customer_site_address_history (
    company_id,
    customer_id,
    customer_site_id,
    address_hash,
    source,
    source_reference,
    actor_user_id,
    snapshot
  ) values (
    p_company_id,
    p_customer_id,
    v_site_id,
    p_address_hash,
    coalesce(nullif(btrim(p_source), ''), 'website'),
    null,
    null,
    jsonb_build_object(
      'street', p_street,
      'postal_code', p_postal_code,
      'city', p_city,
      'country', v_country,
      'address_hash', p_address_hash,
      'source', p_source
    )
  );

  return v_site_id;
end;
$$;

revoke all on function public.gridex_create_customer_site_with_address(uuid,uuid,text,text,text,text,text,text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.gridex_create_customer_site_with_address(uuid,uuid,text,text,text,text,text,text,text,text,text,jsonb) to service_role;

do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception when others then
  null;
end $$;
