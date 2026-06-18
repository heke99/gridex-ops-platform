-- Kundkortet använder customer_sites som operativ anläggningsadress.
-- Denna migration speglar befintliga kompletta sites till customer_addresses
-- för historik/kompatibilitet, utan att ändra resolverns sanningskälla.

do $$
begin
  if to_regclass('public.customer_sites') is null
     or to_regclass('public.customer_addresses') is null then
    return;
  end if;

  -- Uppdatera redan länkade facility-adresser.
  update public.customer_addresses ca
  set
    street_1 = cs.street,
    street_2 = cs.care_of,
    postal_code = regexp_replace(coalesce(cs.postal_code, ''), '\\D', '', 'g'),
    city = cs.city,
    country = coalesce(nullif(trim(cs.country), ''), 'SE'),
    is_active = cs.status not in ('closed', 'inactive'),
    metadata = coalesce(ca.metadata, '{}'::jsonb) || jsonb_build_object(
      'customer_site_id', cs.id,
      'address_hash', cs.address_hash,
      'source', coalesce(cs.address_source, 'import')
    ),
    updated_at = now()
  from public.customer_sites cs
  where ca.company_id = cs.company_id
    and ca.customer_id = cs.customer_id
    and ca.type = 'facility'
    and ca.metadata ->> 'customer_site_id' = cs.id::text
    and coalesce(trim(cs.street), '') <> ''
    and regexp_replace(coalesce(cs.postal_code, ''), '\\D', '', 'g') ~ '^\\d{5}$'
    and coalesce(trim(cs.city), '') <> '';

  -- Skapa saknade spegelrader för befintliga kompletta anläggningar.
  insert into public.customer_addresses (
    company_id, customer_id, type, street_1, street_2, postal_code, city,
    country, is_active, metadata, created_at, updated_at
  )
  select
    cs.company_id,
    cs.customer_id,
    'facility',
    cs.street,
    cs.care_of,
    regexp_replace(coalesce(cs.postal_code, ''), '\\D', '', 'g'),
    cs.city,
    coalesce(nullif(trim(cs.country), ''), 'SE'),
    cs.status not in ('closed', 'inactive'),
    jsonb_build_object(
      'customer_site_id', cs.id,
      'address_hash', cs.address_hash,
      'source', coalesce(cs.address_source, 'import')
    ),
    now(),
    now()
  from public.customer_sites cs
  where coalesce(trim(cs.street), '') <> ''
    and regexp_replace(coalesce(cs.postal_code, ''), '\\D', '', 'g') ~ '^\\d{5}$'
    and coalesce(trim(cs.city), '') <> ''
    and not exists (
      select 1
      from public.customer_addresses ca
      where ca.company_id = cs.company_id
        and ca.customer_id = cs.customer_id
        and ca.type = 'facility'
        and ca.metadata ->> 'customer_site_id' = cs.id::text
    );
end $$;

create index if not exists customer_addresses_facility_site_lookup_idx
  on public.customer_addresses(company_id, customer_id, type, is_active, updated_at desc)
  where type = 'facility';
