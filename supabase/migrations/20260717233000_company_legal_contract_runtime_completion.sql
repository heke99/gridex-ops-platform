-- Gridex OPS: forward-only completion for company/legal canonical data and contract runtime.
-- This migration intentionally does not mutate published legal text, contract, pricing, PDF or email history.

begin;

create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if not exists (
    select 1
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pgcrypto' and n.nspname = 'extensions'
  ) then
    raise exception using errcode = 'GX100', message = 'pgcrypto_extension_missing_from_extensions_schema';
  end if;
end
$$;

create or replace function public.gridex_normalize_country_code(
  p_value text,
  p_default text default 'SE'
)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_country text := upper(coalesce(nullif(btrim(coalesce(p_value, '')), ''), nullif(btrim(coalesce(p_default, '')), ''), 'SE'));
begin
  if v_country !~ '^[A-Z]{2}$' then
    raise exception using errcode = '23514', message = 'invalid_country_code';
  end if;
  return v_country;
end
$$;

create or replace function public.gridex_normalize_postal_code(
  p_value text,
  p_country_code text
)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_value text := nullif(btrim(coalesce(p_value, '')), '');
  v_country text := public.gridex_normalize_country_code(p_country_code, 'SE');
  v_digits text;
begin
  if v_value is null then return null; end if;

  if v_country = 'SE' then
    if v_value !~ '^[0-9]{3}[ ]?[0-9]{2}$' then
      raise exception using errcode = '23514', message = 'invalid_swedish_postal_code';
    end if;
    v_digits := regexp_replace(v_value, '[^0-9]', '', 'g');
    return substring(v_digits from 1 for 3) || ' ' || substring(v_digits from 4 for 2);
  end if;

  if length(v_value) < 2 or length(v_value) > 16 or v_value !~ '^[[:alnum:]][[:alnum:] -]*$' then
    raise exception using errcode = '23514', message = 'invalid_postal_code';
  end if;
  return upper(v_value);
end
$$;

create or replace function public.gridex_normalize_postal_code(p_value text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select public.gridex_normalize_postal_code(p_value, 'SE')
$$;

create or replace function public.gridex_luhn_valid(p_value text)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_digits text := regexp_replace(coalesce(p_value, ''), '[^0-9]', '', 'g');
  v_sum integer := 0;
  v_digit integer;
  i integer;
begin
  if v_digits !~ '^[0-9]{10}$' then return false; end if;
  for i in 1..10 loop
    v_digit := substring(v_digits from i for 1)::integer;
    if mod(i, 2) = 1 then
      v_digit := v_digit * 2;
      if v_digit > 9 then v_digit := v_digit - 9; end if;
    end if;
    v_sum := v_sum + v_digit;
  end loop;
  return mod(v_sum, 10) = 0;
end
$$;

create or replace function public.gridex_normalize_swedish_organization_number(p_value text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_digits text := regexp_replace(coalesce(p_value, ''), '[^0-9]', '', 'g');
begin
  if v_digits = '' then return null; end if;
  if not public.gridex_luhn_valid(v_digits) then
    raise exception using errcode = '23514', message = 'invalid_swedish_organization_number';
  end if;
  return substring(v_digits from 1 for 6) || '-' || substring(v_digits from 7 for 4);
end
$$;

create or replace function public.gridex_jsonb_has_text(p_value jsonb, p_path text[])
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select length(btrim(coalesce(p_value #>> p_path, ''))) > 0
$$;

create or replace function public.gridex_address_is_complete(p_value jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select public.gridex_address_complete(coalesce(p_value, '{}'::jsonb))
$$;

create or replace function public.gridex_contact_has_channel(p_value jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select public.gridex_legal_contact_complete(coalesce(p_value, '{}'::jsonb))
$$;

create or replace function public.gridex_build_canonical_address(
  p_address_line_1 text,
  p_address_line_2 text,
  p_postal_code text,
  p_city text,
  p_country_code text default 'SE'
)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_line1 text := nullif(btrim(coalesce(p_address_line_1, '')), '');
  v_line2 text := nullif(btrim(coalesce(p_address_line_2, '')), '');
  v_city text := nullif(btrim(coalesce(p_city, '')), '');
  v_country text := upper(coalesce(nullif(btrim(coalesce(p_country_code, '')), ''), 'SE'));
  v_postal text;
  v_formatted text;
begin
  if v_country !~ '^[A-Z]{2}$' then v_country := null; end if;
  begin
    v_postal := public.gridex_normalize_postal_code(p_postal_code, coalesce(v_country, 'SE'));
  exception when check_violation then
    v_postal := null;
  end;
  if v_line1 is null and v_line2 is null and v_postal is null and v_city is null then
    return '{}'::jsonb;
  end if;
  v_formatted := concat_ws(', ', v_line1, v_line2, nullif(concat_ws(' ', v_postal, v_city), ''), v_country);
  return jsonb_strip_nulls(jsonb_build_object(
    'address_line_1', v_line1,
    'address_line_2', v_line2,
    'postal_code', v_postal,
    'city', v_city,
    'country_code', v_country,
    'formatted', nullif(v_formatted, '')
  ));
end
$$;

create or replace function public.gridex_address_complete(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_country text := coalesce(p_value->>'country_code', '');
  v_postal text := coalesce(p_value->>'postal_code', '');
begin
  if length(btrim(coalesce(p_value->>'address_line_1', ''))) < 3
     or length(btrim(coalesce(p_value->>'city', ''))) < 2
     or v_country !~ '^[A-Z]{2}$' then
    return false;
  end if;
  if v_country = 'SE' then
    return v_postal ~ '^[0-9]{3} [0-9]{2}$';
  end if;
  return length(btrim(v_postal)) between 2 and 16;
end
$$;

create or replace function public.gridex_tenant_legal_profile_missing_fields(p_profile public.tenant_legal_profiles)
returns text[]
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_missing text[] := '{}';
begin
  if length(btrim(coalesce(p_profile.legal_name, ''))) < 2
     or coalesce(p_profile.source_company_snapshot->>'legal_name_source', 'legacy_fallback') <> 'tenant_explicit'
  then
    v_missing := array_append(v_missing, 'legal_name');
  end if;
  if not public.gridex_luhn_valid(p_profile.organization_number) then v_missing := array_append(v_missing, 'organization_number'); end if;
  if not public.gridex_address_complete(p_profile.postal_address) then v_missing := array_append(v_missing, 'postal_address'); end if;
  if coalesce(p_profile.customer_service_email, '') !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then v_missing := array_append(v_missing, 'customer_service_email'); end if;
  if length(regexp_replace(coalesce(p_profile.phone, ''), '[^0-9]', '', 'g')) < 7 then v_missing := array_append(v_missing, 'phone'); end if;
  if coalesce(p_profile.website, '') !~* '^https?://([a-z0-9-]+\.)+[a-z]{2,}([/:?#].*)?$' then v_missing := array_append(v_missing, 'website'); end if;
  if not public.gridex_legal_contact_complete(p_profile.complaints_contact) then v_missing := array_append(v_missing, 'complaints_contact'); end if;
  if not public.gridex_legal_contact_complete(p_profile.data_protection_contact) then v_missing := array_append(v_missing, 'data_protection_contact'); end if;
  if not public.gridex_billing_information_complete(p_profile.billing_information) then v_missing := array_append(v_missing, 'billing_information'); end if;
  if not public.gridex_dispute_information_complete(p_profile.dispute_resolution_information) then v_missing := array_append(v_missing, 'dispute_resolution_information'); end if;
  return v_missing;
end
$$;

create or replace function public.gridex_refresh_legal_profile_completeness()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.missing_fields := public.gridex_tenant_legal_profile_missing_fields(new);
  -- Keep the persisted value compatible with the existing table constraint and
  -- publication functions. The semantic API status is calculated separately as
  -- complete_unreviewed when review is still required.
  new.completeness_status := case
    when coalesce(array_length(new.missing_fields, 1), 0) > 0 then 'incomplete'
    when coalesce(new.review_required, false) then 'complete'
    when coalesce(new.reviewed_at, new.verified_at) is not null then 'verified'
    else 'complete'
  end;
  new.updated_at := now();
  return new;
end
$$;

create or replace function public.gridex_tenant_legal_profile_readiness_status(
  p_profile public.tenant_legal_profiles
)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when coalesce(array_length(p_profile.missing_fields, 1), 0) > 0 then 'incomplete'
    when coalesce(p_profile.review_required, false) then 'complete_unreviewed'
    when coalesce(p_profile.reviewed_at, p_profile.verified_at) is not null then 'verified'
    else 'complete_unreviewed'
  end
$$;

create or replace function public.gridex_company_legal_profile_defaults(p_company jsonb)
returns jsonb
language plpgsql
stable
set search_path = public, extensions, pg_temp
as $$
declare
  j jsonb := coalesce(p_company, '{}'::jsonb);
  v_postal jsonb;
  v_complaints_address jsonb;
  v_privacy_address jsonb;
  v_billing_address jsonb;
  v_legal_name text;
  v_legal_name_source text;
  v_service_email text;
  v_service_phone text;
  v_complaints_email text;
  v_complaints_phone text;
  v_privacy_email text;
  v_privacy_phone text;
  v_billing_email text;
  v_billing_phone text;
  v_dispute_default jsonb;
  v_dispute jsonb;
  v_snapshot jsonb;
  v_complaints_explicit boolean;
  v_privacy_explicit boolean;
  v_billing_explicit boolean;
begin
  v_legal_name := coalesce(nullif(btrim(j->>'legal_name'), ''), nullif(btrim(j->>'name'), ''));
  v_legal_name_source := case when nullif(btrim(j->>'legal_name'), '') is not null then 'tenant_explicit' else 'legacy_fallback' end;

  v_postal := public.gridex_build_canonical_address(
    coalesce(nullif(j->>'address_line_1', ''), nullif(j->>'address', '')),
    nullif(j->>'address_line_2', ''), j->>'postal_code', j->>'city', coalesce(j->>'country_code', 'SE')
  );
  v_complaints_address := public.gridex_build_canonical_address(
    j->>'complaints_address_line_1', j->>'complaints_address_line_2', j->>'complaints_postal_code', j->>'complaints_city', coalesce(j->>'complaints_country_code', j->>'country_code', 'SE')
  );
  if v_complaints_address = '{}'::jsonb then v_complaints_address := v_postal; end if;
  v_privacy_address := public.gridex_build_canonical_address(
    j->>'data_protection_address_line_1', j->>'data_protection_address_line_2', j->>'data_protection_postal_code', j->>'data_protection_city', coalesce(j->>'data_protection_country_code', j->>'country_code', 'SE')
  );
  if v_privacy_address = '{}'::jsonb then v_privacy_address := v_postal; end if;
  v_billing_address := public.gridex_build_canonical_address(
    j->>'billing_address_line_1', j->>'billing_address_line_2', j->>'billing_postal_code', j->>'billing_city', coalesce(j->>'billing_country_code', j->>'country_code', 'SE')
  );
  if v_billing_address = '{}'::jsonb then v_billing_address := v_postal; end if;

  v_service_email := lower(coalesce(nullif(j->>'support_email', ''), nullif(j->>'primary_contact_email', ''), nullif(j->>'email', '')));
  v_service_phone := coalesce(nullif(j->>'phone', ''), nullif(j->>'primary_contact_phone', ''));
  v_complaints_email := lower(coalesce(nullif(j->>'complaints_email', ''), v_service_email));
  v_complaints_phone := coalesce(nullif(j->>'complaints_phone', ''), v_service_phone);
  v_privacy_email := lower(coalesce(nullif(j->>'data_protection_email', ''), v_service_email));
  v_privacy_phone := coalesce(nullif(j->>'data_protection_phone', ''), v_service_phone);
  v_billing_email := lower(coalesce(nullif(j->>'billing_contact_email', ''), v_service_email));
  v_billing_phone := coalesce(nullif(j->>'billing_contact_phone', ''), v_service_phone);

  v_complaints_explicit := nullif(j->>'complaints_email', '') is not null or nullif(j->>'complaints_phone', '') is not null or nullif(j->>'complaints_address_line_1', '') is not null;
  v_privacy_explicit := nullif(j->>'data_protection_email', '') is not null or nullif(j->>'data_protection_phone', '') is not null or nullif(j->>'data_protection_address_line_1', '') is not null;
  v_billing_explicit := nullif(j->>'billing_contact_email', '') is not null or nullif(j->>'billing_contact_phone', '') is not null or nullif(j->>'billing_address_line_1', '') is not null;

  v_dispute_default := jsonb_build_object(
    'authority', 'Allmänna reklamationsnämnden för behöriga konsumenttvister',
    'address', 'Box 174, 101 23 Stockholm',
    'url', 'https://www.arn.se/',
    'description', 'Klagomål lämnas först till bolagets klagomålskontakt. Privatkund kan, när ARN:s regler är uppfyllda, vända sig till Allmänna reklamationsnämnden. Tvist avgörs i övrigt enligt svensk rätt och behörig svensk domstol om inget annat avtalats för företagskund.',
    'source', 'platform_default'
  );
  v_dispute := case
    when coalesce(j->'dispute_resolution_override', '{}'::jsonb) in ('{}'::jsonb, 'null'::jsonb) then v_dispute_default
    else v_dispute_default || (j->'dispute_resolution_override') || jsonb_build_object('source', 'tenant_explicit')
  end;

  v_snapshot := jsonb_strip_nulls(jsonb_build_object(
    'legal_name', v_legal_name,
    'legal_name_source', v_legal_name_source,
    'trade_name', j->>'name',
    'organization_number', j->>'org_number',
    'vat_number', j->>'vat_number',
    'website', j->>'website',
    'postal_address', v_postal,
    'customer_service', jsonb_build_object(
      'name', j->>'primary_contact_name', 'email', v_service_email, 'phone', v_service_phone,
      'hours', j->>'customer_service_hours', 'address', v_postal
    ),
    'complaints', jsonb_build_object(
      'name', j->>'complaints_contact_name', 'email', v_complaints_email, 'phone', v_complaints_phone,
      'address', v_complaints_address, 'description', j->>'complaints_description',
      'source', case when v_complaints_explicit then 'tenant_explicit' else 'company_fallback' end
    ),
    'data_protection', jsonb_build_object(
      'name', j->>'data_protection_contact_name', 'email', v_privacy_email, 'phone', v_privacy_phone,
      'address', v_privacy_address,
      'source', case when v_privacy_explicit then 'tenant_explicit' else 'company_fallback' end
    ),
    'billing', jsonb_build_object(
      'email', v_billing_email, 'phone', v_billing_phone, 'address', v_billing_address,
      'terms_summary', j->>'billing_terms_summary',
      'source', case when v_billing_explicit then 'tenant_explicit' else 'company_fallback' end
    ),
    'dispute_resolution', v_dispute
  ));

  return jsonb_build_object(
    'legal_name', v_legal_name,
    'legal_name_source', v_legal_name_source,
    'organization_number', nullif(j->>'org_number', ''),
    'postal_address', v_postal,
    'customer_service_address', v_postal,
    'customer_service_email', v_service_email,
    'phone', v_service_phone,
    'website', nullif(j->>'website', ''),
    'customer_service_contact', jsonb_strip_nulls(jsonb_build_object(
      'name', coalesce(nullif(j->>'primary_contact_name', ''), 'Kundservice'),
      'email', v_service_email, 'phone', v_service_phone, 'address', v_postal,
      'hours', nullif(j->>'customer_service_hours', ''), 'source', 'company_fallback'
    )),
    'complaints_contact', jsonb_strip_nulls(jsonb_build_object(
      'name', coalesce(nullif(j->>'complaints_contact_name', ''), 'Klagomålsansvarig'),
      'email', v_complaints_email, 'phone', v_complaints_phone, 'address', v_complaints_address,
      'description', nullif(j->>'complaints_description', ''),
      'source', case when v_complaints_explicit then 'tenant_explicit' else 'company_fallback' end
    )),
    'data_protection_contact', jsonb_strip_nulls(jsonb_build_object(
      'name', coalesce(nullif(j->>'data_protection_contact_name', ''), 'Dataskyddsansvarig'),
      'email', v_privacy_email, 'phone', v_privacy_phone, 'address', v_privacy_address,
      'description', 'Dataskyddsfrågor och rättighetsbegäran hanteras via angiven kontaktkanal.',
      'source', case when v_privacy_explicit then 'tenant_explicit' else 'company_fallback' end
    )),
    'billing_information', jsonb_strip_nulls(jsonb_build_object(
      'contact', jsonb_strip_nulls(jsonb_build_object(
        'name', 'Fakturering', 'email', v_billing_email, 'phone', v_billing_phone,
        'address', v_billing_address,
        'source', case when v_billing_explicit then 'tenant_explicit' else 'company_fallback' end
      )),
      'email', v_billing_email, 'phone', v_billing_phone, 'address', v_billing_address,
      'terms_summary', coalesce(nullif(j->>'billing_terms_summary', ''), 'Fakturering sker enligt avtalad period och den låsta prisversionen. Preliminära mätvärden får rättas när validerade värden erhålls.'),
      'source', case when v_billing_explicit then 'tenant_explicit' else 'company_fallback' end
    )),
    'dispute_resolution_information', v_dispute,
    'source_company_snapshot', v_snapshot,
    'source_company_snapshot_sha256', encode(extensions.digest(convert_to(v_snapshot::text, 'UTF8'), 'sha256'::text), 'hex')
  );
end
$$;

create or replace function public.gridex_legal_missing_field_details(p_company_id uuid, p_fields text[])
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'code', code,
    'label', case code
      when 'legal_name' then 'Juridiskt bolagsnamn'
      when 'organization_number' then 'Organisationsnummer'
      when 'postal_address' then 'Postadress'
      when 'customer_service_email' then 'Kundservice'
      when 'phone' then 'Telefon'
      when 'website' then 'Webbplats'
      when 'complaints_contact' then 'Klagomålskontakt'
      when 'data_protection_contact' then 'Dataskyddskontakt'
      when 'billing_information' then 'Faktureringskontakt'
      when 'dispute_resolution_information' then 'Tvistlösning'
      else replace(code, '_', ' ') end,
    'message', case code
      when 'organization_number' then 'Fyll i ett giltigt svenskt organisationsnummer med korrekt kontrollsiffra.'
      when 'postal_address' then 'Fyll i gatuadress, postnummer, ort och land under Postadress.'
      when 'complaints_contact' then 'Fyll i minst e-post, telefon eller komplett postadress under Klagomål.'
      when 'data_protection_contact' then 'Fyll i minst e-post, telefon eller komplett postadress under Dataskydd.'
      when 'billing_information' then 'Fyll i minst e-post, telefon eller komplett faktureringsadress under Fakturering.'
      else 'Komplettera uppgiften under Redigera bolagsuppgifter.' end,
    'edit_section', case code
      when 'postal_address' then 'company_address'
      when 'complaints_contact' then 'company_complaints'
      when 'data_protection_contact' then 'company_data_protection'
      when 'billing_information' then 'company_billing'
      else 'company_profile' end
  ) order by ordinality), '[]'::jsonb)
  from unnest(coalesce(p_fields, '{}'::text[])) with ordinality as f(code, ordinality)
$$;

create or replace function public.gridex_render_address(p_value jsonb)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(
    nullif(btrim(p_value->>'formatted'), ''),
    nullif(concat_ws(', ',
      nullif(btrim(p_value->>'address_line_1'), ''),
      nullif(btrim(p_value->>'address_line_2'), ''),
      nullif(btrim(concat_ws(' ', nullif(btrim(p_value->>'postal_code'), ''), nullif(btrim(p_value->>'city'), ''))), ''),
      nullif(btrim(p_value->>'country_code'), '')
    ), ''),
    ''
  )
$$;

create or replace function public.gridex_render_billing_information(p_value jsonb)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_contact jsonb := case when jsonb_typeof(p_value->'contact') = 'object' then p_value->'contact' else p_value end;
  v_channels text;
  v_address text;
  v_terms text;
  v_result text;
begin
  v_channels := concat_ws(' eller ', nullif(btrim(coalesce(v_contact->>'email', p_value->>'email', '')), ''), nullif(btrim(coalesce(v_contact->>'phone', p_value->>'phone', '')), ''));
  v_address := public.gridex_render_address(coalesce(v_contact->'address', p_value->'address', '{}'::jsonb));
  v_terms := nullif(btrim(coalesce(p_value->>'terms_summary', p_value->>'description', '')), '');
  v_result := concat_ws(' ',
    case when v_channels <> '' then 'Faktureringsfrågor skickas till ' || v_channels || '.' end,
    case when v_address <> '' then 'Faktureringsadress: ' || v_address || '.' end,
    case when v_terms is not null then 'Betalningsvillkor: ' || rtrim(v_terms, '.') || '.' end
  );
  return btrim(v_result);
end
$$;

create or replace function public.gridex_render_dispute_resolution(p_value jsonb)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_authority text := nullif(btrim(p_value->>'authority'), '');
  v_address text := nullif(btrim(coalesce(p_value->>'address', public.gridex_render_address(coalesce(p_value->'address_object', '{}'::jsonb)))), '');
  v_url text := nullif(btrim(p_value->>'url'), '');
  v_description text := nullif(btrim(p_value->>'description'), '');
  v_result text;
begin
  v_result := concat_ws(' ',
    case when v_description is not null then rtrim(v_description, '.') || '.' end,
    case when v_authority is not null then 'Tvistlösningsorgan: ' || v_authority || '.' end,
    case when v_address is not null then 'Adress: ' || v_address || '.' end,
    case when v_url is not null then 'Webbplats: ' || v_url || '.' end
  );
  return btrim(v_result);
end
$$;

create or replace function public.gridex_render_legal_document(p_body text, p_profile jsonb, p_company jsonb)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v text := coalesce(p_body, '');
  v_address text := public.gridex_render_address(coalesce(p_profile->'postal_address', '{}'::jsonb));
begin
  v := replace(v, '{{company_name}}', coalesce(p_profile->>'legal_name', p_company->>'name', ''));
  v := replace(v, '{{legal_name}}', coalesce(p_profile->>'legal_name', p_company->>'name', ''));
  v := replace(v, '{{brand_name}}', coalesce(p_company#>>'{branding,brand_name}', p_company#>>'{branding,display_name}', p_company->>'name', ''));
  v := replace(v, '{{organization_number}}', coalesce(p_profile->>'organization_number', p_company->>'org_number', ''));
  v := replace(v, '{{org_number}}', coalesce(p_profile->>'organization_number', p_company->>'org_number', ''));
  v := replace(v, '{{company_address}}', v_address);
  v := replace(v, '{{customer_service_email}}', coalesce(p_profile->>'customer_service_email', p_company->>'support_email', p_company->>'primary_contact_email', ''));
  v := replace(v, '{{support_email}}', coalesce(p_profile->>'customer_service_email', p_company->>'support_email', p_company->>'primary_contact_email', ''));
  v := replace(v, '{{phone}}', coalesce(p_profile->>'phone', p_company->>'phone', ''));
  v := replace(v, '{{website}}', coalesce(p_profile->>'website', p_company->>'website', ''));
  v := replace(v, '{{complaints_email}}', coalesce(p_profile#>>'{complaints_contact,email}', p_profile->>'customer_service_email', ''));
  v := replace(v, '{{data_protection_email}}', coalesce(p_profile#>>'{data_protection_contact,email}', p_profile->>'customer_service_email', ''));
  v := replace(v, '{{billing_information}}', public.gridex_render_billing_information(coalesce(p_profile->'billing_information', '{}'::jsonb)));
  v := replace(v, '{{dispute_resolution_information}}', public.gridex_render_dispute_resolution(coalesce(p_profile->'dispute_resolution_information', '{}'::jsonb)));
  return v;
end
$$;

create or replace function public.gridex_rebuild_company_legal_profile(
  p_company_id uuid,
  p_actor_user_id uuid default null,
  p_mark_reviewed boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_company jsonb;
  v_defaults jsonb;
  v_existing public.tenant_legal_profiles%rowtype;
  v_profile public.tenant_legal_profiles%rowtype;
  v_changed boolean := true;
  v_now timestamptz := now();
begin
  if coalesce(p_mark_reviewed, false) then
    raise exception using errcode = '42501', message = 'direct_legal_review_not_allowed_use_gridex_review_company_legal_profile';
  end if;

  select to_jsonb(c) into v_company
  from public.companies c
  where c.id = p_company_id
  for update;
  if v_company is null then
    raise exception using errcode = 'P0002', message = 'company_not_found';
  end if;

  v_defaults := public.gridex_company_legal_profile_defaults(v_company);
  select * into v_existing
  from public.tenant_legal_profiles
  where company_id = p_company_id;
  if found then
    v_changed := v_existing.source_company_snapshot_sha256 is distinct from v_defaults->>'source_company_snapshot_sha256';
  end if;

  insert into public.tenant_legal_profiles(
    company_id, legal_name, organization_number, postal_address, customer_service_address,
    customer_service_email, phone, website, customer_service_contact, complaints_contact,
    data_protection_contact, billing_information, dispute_resolution_information,
    source_company_snapshot, source_company_snapshot_sha256, source_company_updated_at,
    review_required, last_synced_at, last_synced_by
  ) values (
    p_company_id, v_defaults->>'legal_name', v_defaults->>'organization_number', v_defaults->'postal_address', v_defaults->'customer_service_address',
    v_defaults->>'customer_service_email', v_defaults->>'phone', v_defaults->>'website', v_defaults->'customer_service_contact', v_defaults->'complaints_contact',
    v_defaults->'data_protection_contact', v_defaults->'billing_information', v_defaults->'dispute_resolution_information',
    v_defaults->'source_company_snapshot', v_defaults->>'source_company_snapshot_sha256', v_now,
    false, v_now, p_actor_user_id
  )
  on conflict (company_id) do update set
    legal_name = excluded.legal_name,
    organization_number = excluded.organization_number,
    postal_address = excluded.postal_address,
    customer_service_address = excluded.customer_service_address,
    customer_service_email = excluded.customer_service_email,
    phone = excluded.phone,
    website = excluded.website,
    customer_service_contact = excluded.customer_service_contact,
    complaints_contact = excluded.complaints_contact,
    data_protection_contact = excluded.data_protection_contact,
    billing_information = excluded.billing_information,
    dispute_resolution_information = excluded.dispute_resolution_information,
    source_company_snapshot = excluded.source_company_snapshot,
    source_company_snapshot_sha256 = excluded.source_company_snapshot_sha256,
    source_company_updated_at = v_now,
    last_synced_at = v_now,
    last_synced_by = p_actor_user_id;

  select * into v_profile
  from public.tenant_legal_profiles
  where company_id = p_company_id;

  if coalesce(array_length(v_profile.missing_fields, 1), 0) > 0 then
    update public.tenant_legal_profiles
    set review_required = false,
        reviewed_at = null,
        reviewed_by = null,
        verified_at = null,
        verified_by = null
    where company_id = p_company_id;
  elsif v_changed then
    update public.tenant_legal_profiles
    set review_required = true,
        reviewed_at = null,
        reviewed_by = null,
        verified_at = null,
        verified_by = null
    where company_id = p_company_id;
  end if;

  select * into v_profile
  from public.tenant_legal_profiles
  where company_id = p_company_id;

  if p_actor_user_id is not null and to_regclass('public.audit_logs') is not null then
    insert into public.audit_logs(
      actor_user_id, company_id, entity_type, entity_id, action, new_values, metadata
    ) values (
      p_actor_user_id,
      p_company_id,
      'tenant_legal_profile',
      p_company_id,
      'COMPANY_LEGAL_PROFILE_REBUILT',
      jsonb_build_object(
        'completeness_status', public.gridex_tenant_legal_profile_readiness_status(v_profile),
        'missing_fields', v_profile.missing_fields,
        'review_required', v_profile.review_required,
        'source_sha256', v_profile.source_company_snapshot_sha256
      ),
      jsonb_build_object('canonical_source', 'companies', 'atomic', true, 'review_operation', false)
    );
  end if;

  return jsonb_build_object(
    'company_id', p_company_id,
    'company_name', v_company->>'name',
    'completeness_status', public.gridex_tenant_legal_profile_readiness_status(v_profile),
    'missing_fields', v_profile.missing_fields,
    'missing_field_details', public.gridex_legal_missing_field_details(p_company_id, v_profile.missing_fields),
    'review_required', v_profile.review_required,
    'reviewed_at', coalesce(v_profile.reviewed_at, v_profile.verified_at),
    'updated_at', v_profile.updated_at
  );
end
$$;

create or replace function public.gridex_update_company_and_rebuild_legal_profile(
  p_company_id uuid,
  p_actor_user_id uuid,
  p_input jsonb,
  p_mark_reviewed boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  c public.companies%rowtype;
  v_input jsonb := coalesce(p_input, '{}'::jsonb);
  v_name text;
  v_country text;
  v_complaints_country text;
  v_privacy_country text;
  v_billing_country text;
  v_result jsonb;
  v_skip_previous text := current_setting('gridex.skip_legal_profile_sync', true);
begin
  if coalesce(p_mark_reviewed, false) then
    raise exception using errcode = '42501', message = 'direct_legal_review_not_allowed_use_gridex_review_company_legal_profile';
  end if;

  select * into c
  from public.companies
  where id = p_company_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'company_not_found';
  end if;

  v_name := case
    when v_input ? 'name' then nullif(btrim(coalesce(v_input->>'name', '')), '')
    else c.name
  end;
  if v_name is null then
    raise exception using errcode = '23514', message = 'company_name_required';
  end if;

  v_country := case
    when v_input ? 'country_code' then public.gridex_normalize_country_code(v_input->>'country_code', 'SE')
    else public.gridex_normalize_country_code(c.country_code, 'SE')
  end;
  v_complaints_country := case
    when v_input ? 'complaints_country_code' then
      case when nullif(btrim(coalesce(v_input->>'complaints_country_code', '')), '') is null
        then null
        else public.gridex_normalize_country_code(v_input->>'complaints_country_code', v_country)
      end
    else c.complaints_country_code
  end;
  v_privacy_country := case
    when v_input ? 'data_protection_country_code' then
      case when nullif(btrim(coalesce(v_input->>'data_protection_country_code', '')), '') is null
        then null
        else public.gridex_normalize_country_code(v_input->>'data_protection_country_code', v_country)
      end
    else c.data_protection_country_code
  end;
  v_billing_country := case
    when v_input ? 'billing_country_code' then
      case when nullif(btrim(coalesce(v_input->>'billing_country_code', '')), '') is null
        then null
        else public.gridex_normalize_country_code(v_input->>'billing_country_code', v_country)
      end
    else c.billing_country_code
  end;

  perform set_config('gridex.skip_legal_profile_sync', 'on', true);
  update public.companies set
    name = v_name,
    legal_name = case when v_input ? 'legal_name' then nullif(btrim(v_input->>'legal_name'), '') else legal_name end,
    org_number = case when v_input ? 'org_number' then public.gridex_normalize_swedish_organization_number(v_input->>'org_number') else org_number end,
    vat_number = case when v_input ? 'vat_number' then nullif(btrim(v_input->>'vat_number'), '') else vat_number end,
    customer_number_prefix = case when v_input ? 'customer_number_prefix' then nullif(upper(regexp_replace(coalesce(v_input->>'customer_number_prefix', ''), '[^A-Za-z0-9]', '', 'g')), '') else customer_number_prefix end,
    primary_contact_name = case when v_input ? 'primary_contact_name' then nullif(btrim(v_input->>'primary_contact_name'), '') else primary_contact_name end,
    primary_contact_email = case when v_input ? 'primary_contact_email' then nullif(lower(btrim(v_input->>'primary_contact_email')), '') else primary_contact_email end,
    support_email = case when v_input ? 'support_email' then nullif(lower(btrim(v_input->>'support_email')), '') else support_email end,
    phone = case when v_input ? 'phone' then nullif(btrim(v_input->>'phone'), '') else phone end,
    website = case when v_input ? 'website' then nullif(btrim(v_input->>'website'), '') else website end,
    customer_service_hours = case when v_input ? 'customer_service_hours' then nullif(btrim(v_input->>'customer_service_hours'), '') else customer_service_hours end,
    address_line_1 = case when v_input ? 'address_line_1' then nullif(btrim(v_input->>'address_line_1'), '') else address_line_1 end,
    address_line_2 = case when v_input ? 'address_line_2' then nullif(btrim(v_input->>'address_line_2'), '') else address_line_2 end,
    postal_code = case when v_input ? 'postal_code' then public.gridex_normalize_postal_code(v_input->>'postal_code', v_country) else postal_code end,
    city = case when v_input ? 'city' then nullif(btrim(v_input->>'city'), '') else city end,
    country_code = v_country,
    complaints_contact_name = case when v_input ? 'complaints_contact_name' then nullif(btrim(v_input->>'complaints_contact_name'), '') else complaints_contact_name end,
    complaints_email = case when v_input ? 'complaints_email' then nullif(lower(btrim(v_input->>'complaints_email')), '') else complaints_email end,
    complaints_phone = case when v_input ? 'complaints_phone' then nullif(btrim(v_input->>'complaints_phone'), '') else complaints_phone end,
    complaints_address_line_1 = case when v_input ? 'complaints_address_line_1' then nullif(btrim(v_input->>'complaints_address_line_1'), '') else complaints_address_line_1 end,
    complaints_address_line_2 = case when v_input ? 'complaints_address_line_2' then nullif(btrim(v_input->>'complaints_address_line_2'), '') else complaints_address_line_2 end,
    complaints_postal_code = case when v_input ? 'complaints_postal_code' then public.gridex_normalize_postal_code(v_input->>'complaints_postal_code', coalesce(v_complaints_country, v_country)) else complaints_postal_code end,
    complaints_city = case when v_input ? 'complaints_city' then nullif(btrim(v_input->>'complaints_city'), '') else complaints_city end,
    complaints_country_code = v_complaints_country,
    complaints_description = case when v_input ? 'complaints_description' then nullif(btrim(v_input->>'complaints_description'), '') else complaints_description end,
    data_protection_contact_name = case when v_input ? 'data_protection_contact_name' then nullif(btrim(v_input->>'data_protection_contact_name'), '') else data_protection_contact_name end,
    data_protection_email = case when v_input ? 'data_protection_email' then nullif(lower(btrim(v_input->>'data_protection_email')), '') else data_protection_email end,
    data_protection_phone = case when v_input ? 'data_protection_phone' then nullif(btrim(v_input->>'data_protection_phone'), '') else data_protection_phone end,
    data_protection_address_line_1 = case when v_input ? 'data_protection_address_line_1' then nullif(btrim(v_input->>'data_protection_address_line_1'), '') else data_protection_address_line_1 end,
    data_protection_address_line_2 = case when v_input ? 'data_protection_address_line_2' then nullif(btrim(v_input->>'data_protection_address_line_2'), '') else data_protection_address_line_2 end,
    data_protection_postal_code = case when v_input ? 'data_protection_postal_code' then public.gridex_normalize_postal_code(v_input->>'data_protection_postal_code', coalesce(v_privacy_country, v_country)) else data_protection_postal_code end,
    data_protection_city = case when v_input ? 'data_protection_city' then nullif(btrim(v_input->>'data_protection_city'), '') else data_protection_city end,
    data_protection_country_code = v_privacy_country,
    billing_contact_email = case when v_input ? 'billing_contact_email' then nullif(lower(btrim(v_input->>'billing_contact_email')), '') else billing_contact_email end,
    billing_contact_phone = case when v_input ? 'billing_contact_phone' then nullif(btrim(v_input->>'billing_contact_phone'), '') else billing_contact_phone end,
    billing_address_line_1 = case when v_input ? 'billing_address_line_1' then nullif(btrim(v_input->>'billing_address_line_1'), '') else billing_address_line_1 end,
    billing_address_line_2 = case when v_input ? 'billing_address_line_2' then nullif(btrim(v_input->>'billing_address_line_2'), '') else billing_address_line_2 end,
    billing_postal_code = case when v_input ? 'billing_postal_code' then public.gridex_normalize_postal_code(v_input->>'billing_postal_code', coalesce(v_billing_country, v_country)) else billing_postal_code end,
    billing_city = case when v_input ? 'billing_city' then nullif(btrim(v_input->>'billing_city'), '') else billing_city end,
    billing_country_code = v_billing_country,
    billing_terms_summary = case when v_input ? 'billing_terms_summary' then nullif(btrim(v_input->>'billing_terms_summary'), '') else billing_terms_summary end,
    dispute_resolution_override = case
      when not (v_input ? 'dispute_resolution_override') then dispute_resolution_override
      when coalesce(v_input->'dispute_resolution_override', 'null'::jsonb) in ('null'::jsonb, '{}'::jsonb) then '{}'::jsonb
      else v_input->'dispute_resolution_override'
    end,
    status = case when v_input ? 'status' then coalesce(nullif(btrim(v_input->>'status'), ''), status) else status end,
    status_reason = case when v_input ? 'status_reason' then nullif(btrim(v_input->>'status_reason'), '') else status_reason end,
    ediel_id = case when v_input ? 'ediel_id' then nullif(upper(btrim(v_input->>'ediel_id')), '') else ediel_id end,
    actor_role = case when v_input ? 'actor_role' then nullif(upper(btrim(v_input->>'actor_role')), '') else actor_role end,
    sender_sub_address = case when v_input ? 'sender_sub_address' then nullif(upper(btrim(v_input->>'sender_sub_address')), '') else sender_sub_address end,
    ediel_mailbox = case when v_input ? 'ediel_mailbox' then nullif(btrim(v_input->>'ediel_mailbox'), '') else ediel_mailbox end,
    operating_environment = case when v_input ? 'operating_environment' then coalesce(nullif(btrim(v_input->>'operating_environment'), ''), operating_environment) else operating_environment end,
    branding = case when v_input ? 'branding' then coalesce(branding, '{}'::jsonb) || coalesce(v_input->'branding', '{}'::jsonb) else branding end,
    updated_at = now(),
    updated_by = p_actor_user_id
  where id = p_company_id;
  perform set_config('gridex.skip_legal_profile_sync', coalesce(v_skip_previous, ''), true);

  v_result := public.gridex_rebuild_company_legal_profile(p_company_id, p_actor_user_id, false);
  if p_actor_user_id is not null and to_regclass('public.audit_logs') is not null then
    insert into public.audit_logs(
      actor_user_id, company_id, entity_type, entity_id, action, new_values, metadata
    ) values (
      p_actor_user_id,
      p_company_id,
      'company',
      p_company_id,
      'COMPANY_PROFILE_AND_LEGAL_PROFILE_UPDATED',
      v_input,
      jsonb_build_object('atomic', true, 'legal_profile_result', v_result, 'review_operation', false)
    );
  end if;
  return v_result;
end
$$;


create or replace function public.gridex_validate_company_legal_fields_trigger()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.country_code := public.gridex_normalize_country_code(new.country_code, 'SE');
  if new.complaints_country_code is not null then
    new.complaints_country_code := public.gridex_normalize_country_code(new.complaints_country_code, new.country_code);
  end if;
  if new.data_protection_country_code is not null then
    new.data_protection_country_code := public.gridex_normalize_country_code(new.data_protection_country_code, new.country_code);
  end if;
  if new.billing_country_code is not null then
    new.billing_country_code := public.gridex_normalize_country_code(new.billing_country_code, new.country_code);
  end if;

  new.postal_code := public.gridex_normalize_postal_code(new.postal_code, new.country_code);
  new.complaints_postal_code := public.gridex_normalize_postal_code(new.complaints_postal_code, coalesce(new.complaints_country_code, new.country_code));
  new.data_protection_postal_code := public.gridex_normalize_postal_code(new.data_protection_postal_code, coalesce(new.data_protection_country_code, new.country_code));
  new.billing_postal_code := public.gridex_normalize_postal_code(new.billing_postal_code, coalesce(new.billing_country_code, new.country_code));

  if new.org_number is not null then
    new.org_number := public.gridex_normalize_swedish_organization_number(new.org_number);
  end if;
  return new;
end
$$;

drop trigger if exists gridex_companies_legal_field_validation on public.companies;
create trigger gridex_companies_legal_field_validation
before insert or update of
  org_number, postal_code, country_code,
  complaints_postal_code, complaints_country_code,
  data_protection_postal_code, data_protection_country_code,
  billing_postal_code, billing_country_code
on public.companies
for each row execute function public.gridex_validate_company_legal_fields_trigger();

-- Remove the legacy parallel profile-sync trigger and keep one canonical rebuild path.
drop trigger if exists companies_sync_legal_profile_review on public.companies;
drop trigger if exists gridex_companies_legal_profile_sync on public.companies;
create trigger gridex_companies_legal_profile_sync
after insert or update of
  name, legal_name, org_number, vat_number, address_line_1, address_line_2, postal_code, city, country_code,
  primary_contact_name, primary_contact_email, support_email, phone, website, customer_service_hours,
  complaints_contact_name, complaints_email, complaints_phone, complaints_address_line_1, complaints_address_line_2, complaints_postal_code, complaints_city, complaints_country_code, complaints_description,
  data_protection_contact_name, data_protection_email, data_protection_phone, data_protection_address_line_1, data_protection_address_line_2, data_protection_postal_code, data_protection_city, data_protection_country_code,
  billing_contact_email, billing_contact_phone, billing_address_line_1, billing_address_line_2, billing_postal_code, billing_city, billing_country_code, billing_terms_summary, dispute_resolution_override
on public.companies
for each row execute function public.gridex_sync_company_legal_profile_trigger();

create or replace function public.gridex_review_company_legal_profile(
  p_company_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_result jsonb;
  v_profile public.tenant_legal_profiles%rowtype;
begin
  v_result := public.gridex_rebuild_company_legal_profile(p_company_id, p_actor_user_id, false);
  select * into v_profile from public.tenant_legal_profiles where company_id = p_company_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'tenant_legal_profile_missing';
  end if;
  if coalesce(array_length(v_profile.missing_fields, 1), 0) > 0 then
    raise exception using errcode = '23514', message = 'tenant_legal_profile_incomplete:' || array_to_string(v_profile.missing_fields, ',');
  end if;

  update public.tenant_legal_profiles
  set review_required = false,
      reviewed_at = now(),
      reviewed_by = p_actor_user_id,
      verified_at = now(),
      verified_by = p_actor_user_id
  where company_id = p_company_id;

  select * into v_profile from public.tenant_legal_profiles where company_id = p_company_id;
  if p_actor_user_id is not null and to_regclass('public.audit_logs') is not null then
    insert into public.audit_logs(actor_user_id, company_id, entity_type, entity_id, action, new_values, metadata)
    values(
      p_actor_user_id, p_company_id, 'tenant_legal_profile', p_company_id,
      'COMPANY_LEGAL_PROFILE_REVIEWED',
      jsonb_build_object('completeness_status', v_profile.completeness_status, 'source_sha256', v_profile.source_company_snapshot_sha256),
      jsonb_build_object('canonical_source', 'companies', 'review_operation', true)
    );
  end if;

  return jsonb_build_object(
    'company_id', p_company_id,
    'company_name', (select name from public.companies where id = p_company_id),
    'completeness_status', public.gridex_tenant_legal_profile_readiness_status(v_profile),
    'missing_fields', v_profile.missing_fields,
    'missing_field_details', public.gridex_legal_missing_field_details(p_company_id, v_profile.missing_fields),
    'review_required', v_profile.review_required,
    'reviewed_at', coalesce(v_profile.reviewed_at, v_profile.verified_at),
    'updated_at', v_profile.updated_at
  );
end
$$;

-- pgcrypto in Supabase is installed in extensions. Repair every effective public
-- function that calls pgcrypto, including later CREATE OR REPLACE definitions.
do $gridex_crypto_search_path$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as function_signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and pg_get_functiondef(p.oid) ~* '\m(digest|hmac|gen_random_bytes|crypt|gen_salt)\s*\('
  loop
    execute format('alter function %s set search_path = public, extensions, pg_temp', r.function_signature);
  end loop;
end
$gridex_crypto_search_path$;

-- Recalculate generated profiles from companies. Changed source hashes deliberately
-- return complete profiles to complete_unreviewed rather than silently preserving approval.
do $gridex_rebuild_profiles$
declare
  r record;
begin
  for r in select id from public.companies loop
    perform public.gridex_rebuild_company_legal_profile(r.id, null, false);
  end loop;
end
$gridex_rebuild_profiles$;

-- Runtime assertions: fail the migration instead of shipping an incomplete hotfix.
do $gridex_runtime_assertions$
declare
  v_missing text[];
  v_trigger_count integer;
begin
  select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text)
  into v_missing
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind = 'f'
    and pg_get_functiondef(p.oid) ~* '\m(digest|hmac|gen_random_bytes|crypt|gen_salt)\s*\('
    and coalesce(array_to_string(p.proconfig, ','), '') !~* 'search_path=.*extensions';

  if coalesce(array_length(v_missing, 1), 0) > 0 then
    raise exception using errcode = 'GX101', message = 'pgcrypto_search_path_incomplete:' || array_to_string(v_missing, ',');
  end if;

  select count(*) into v_trigger_count
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_proc p on p.oid = t.tgfoid
  where n.nspname = 'public'
    and c.relname = 'companies'
    and not t.tgisinternal
    and (t.tgname ilike '%legal_profile%' or p.proname ilike '%legal_profile%sync%');

  if v_trigger_count <> 1 then
    raise exception using errcode = 'GX102', message = 'expected_exactly_one_company_legal_profile_sync_trigger:' || v_trigger_count::text;
  end if;
end
$gridex_runtime_assertions$;

-- Rendering regression: legal output must never fall back to raw JSON.
do $gridex_render_regression$
declare
  v_rendered text;
begin
  v_rendered := public.gridex_render_legal_document(
    '{{billing_information}} ' || '{{dispute_resolution_information}}',
    jsonb_build_object(
      'billing_information', jsonb_build_object(
        'email', 'faktura@example.se',
        'phone', '+46401234567',
        'address', jsonb_build_object('address_line_1', 'Storgatan 1', 'postal_code', '211 20', 'city', 'Malmö', 'country_code', 'SE', 'formatted', 'Storgatan 1, 211 20 Malmö, SE'),
        'terms_summary', '30 dagar'
      ),
      'dispute_resolution_information', jsonb_build_object('authority', 'Allmänna reklamationsnämnden', 'url', 'https://www.arn.se/', 'description', 'Klagomål hanteras först av bolaget.')
    ),
    '{}'::jsonb
  );
  if v_rendered ~ '\{"(email|authority|source)"' or v_rendered like '%[object Object]%' or v_rendered like '%{{%' then
    raise exception using errcode = 'GX103', message = 'legal_renderer_emitted_raw_json_or_placeholder';
  end if;
end
$gridex_render_regression$;

create or replace function public.gridex_company_legal_contract_runtime_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_missing_crypto text[];
  v_trigger_count integer;
  v_rendered text;
begin
  select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text)
  into v_missing_crypto
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind = 'f'
    and pg_get_functiondef(p.oid) ~* '\m(digest|hmac|gen_random_bytes|crypt|gen_salt)\s*\('
    and coalesce(array_to_string(p.proconfig, ','), '') !~* 'search_path=.*extensions';

  select count(*) into v_trigger_count
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_proc p on p.oid = t.tgfoid
  where n.nspname = 'public'
    and c.relname = 'companies'
    and not t.tgisinternal
    and (t.tgname ilike '%legal_profile%' or p.proname ilike '%legal_profile%sync%');

  v_rendered := public.gridex_render_legal_document(
    '{{billing_information}} {{dispute_resolution_information}}',
    jsonb_build_object(
      'billing_information', jsonb_build_object('email', 'health@example.se'),
      'dispute_resolution_information', jsonb_build_object('authority', 'ARN', 'url', 'https://www.arn.se/')
    ),
    '{}'::jsonb
  );

  return jsonb_build_object(
    'ok', coalesce(array_length(v_missing_crypto, 1), 0) = 0
      and v_trigger_count = 1
      and v_rendered !~ '\{"(email|authority|source)"'
      and v_rendered not like '%{{%',
    'pgcrypto_search_path_ready', coalesce(array_length(v_missing_crypto, 1), 0) = 0,
    'functions_missing_extensions', coalesce(to_jsonb(v_missing_crypto), '[]'::jsonb),
    'company_legal_profile_sync_trigger_count', v_trigger_count,
    'legal_renderer_readable', v_rendered !~ '\{"(email|authority|source)"' and v_rendered not like '%{{%'
  );
end
$$;

revoke all on function public.gridex_rebuild_company_legal_profile(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.gridex_update_company_and_rebuild_legal_profile(uuid, uuid, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.gridex_review_company_legal_profile(uuid, uuid) from public, anon, authenticated;
revoke all on function public.gridex_company_legal_contract_runtime_health() from public, anon, authenticated;
grant execute on function public.gridex_rebuild_company_legal_profile(uuid, uuid, boolean) to service_role;
grant execute on function public.gridex_update_company_and_rebuild_legal_profile(uuid, uuid, jsonb, boolean) to service_role;
grant execute on function public.gridex_review_company_legal_profile(uuid, uuid) to service_role;
grant execute on function public.gridex_company_legal_contract_runtime_health() to service_role;
grant execute on function public.gridex_normalize_country_code(text, text) to authenticated, service_role;
grant execute on function public.gridex_normalize_postal_code(text, text) to authenticated, service_role;
grant execute on function public.gridex_luhn_valid(text) to authenticated, service_role;
grant execute on function public.gridex_tenant_legal_profile_readiness_status(public.tenant_legal_profiles) to authenticated, service_role;
grant execute on function public.gridex_render_billing_information(jsonb) to authenticated, service_role;
grant execute on function public.gridex_render_dispute_resolution(jsonb) to authenticated, service_role;

comment on function public.gridex_company_legal_contract_runtime_health() is
  'Live preflight for canonical company/legal runtime, pgcrypto search_path, trigger count and readable rendering.';
comment on function public.gridex_review_company_legal_profile(uuid, uuid) is
  'Dedicated legal review operation. Normal company saves rebuild the profile but never approve it.';
comment on function public.gridex_company_legal_profile_defaults(jsonb) is
  'Deterministic canonical projection from companies. Hash includes every legal field and excludes unrelated updated_at timestamps.';

commit;
