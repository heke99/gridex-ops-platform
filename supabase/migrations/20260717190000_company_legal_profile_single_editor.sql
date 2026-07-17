-- Gridex OPS: companies is the only editable source for company identity and legal contacts.
-- tenant_legal_profiles is rebuilt as a deterministic projection. Historical legal bundles,
-- publication versions, signed agreements, PDFs and email evidence are intentionally untouched.

begin;

create extension if not exists pgcrypto with schema extensions;

alter table public.companies
  add column if not exists legal_name text,
  add column if not exists vat_number text,
  add column if not exists customer_service_hours text,
  add column if not exists complaints_contact_name text,
  add column if not exists complaints_email text,
  add column if not exists complaints_phone text,
  add column if not exists complaints_address_line_1 text,
  add column if not exists complaints_address_line_2 text,
  add column if not exists complaints_postal_code text,
  add column if not exists complaints_city text,
  add column if not exists complaints_country_code text,
  add column if not exists complaints_description text,
  add column if not exists data_protection_contact_name text,
  add column if not exists data_protection_email text,
  add column if not exists data_protection_phone text,
  add column if not exists data_protection_address_line_1 text,
  add column if not exists data_protection_address_line_2 text,
  add column if not exists data_protection_postal_code text,
  add column if not exists data_protection_city text,
  add column if not exists data_protection_country_code text,
  add column if not exists billing_contact_phone text,
  add column if not exists billing_address_line_1 text,
  add column if not exists billing_address_line_2 text,
  add column if not exists billing_postal_code text,
  add column if not exists billing_city text,
  add column if not exists billing_country_code text,
  add column if not exists billing_terms_summary text,
  add column if not exists dispute_resolution_override jsonb not null default '{}'::jsonb;

alter table public.tenant_legal_profiles
  add column if not exists customer_service_contact jsonb not null default '{}'::jsonb,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid,
  add column if not exists last_synced_at timestamptz,
  add column if not exists last_synced_by uuid;

create or replace function public.gridex_normalize_postal_code(p_value text)
returns text
language plpgsql
immutable
set search_path=public,pg_temp
as $$
declare
  v_digits text:=regexp_replace(coalesce(p_value,''),'[^0-9]','','g');
begin
  if v_digits='' then return null; end if;
  if length(v_digits)=5 then
    return substring(v_digits from 1 for 3)||' '||substring(v_digits from 4 for 2);
  end if;
  return nullif(btrim(p_value),'');
end $$;

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
set search_path=public,pg_temp
as $$
declare
  v_line1 text:=nullif(btrim(coalesce(p_address_line_1,'')),'');
  v_line2 text:=nullif(btrim(coalesce(p_address_line_2,'')),'');
  v_postal text:=public.gridex_normalize_postal_code(p_postal_code);
  v_city text:=nullif(btrim(coalesce(p_city,'')),'');
  v_country text:=upper(coalesce(nullif(btrim(coalesce(p_country_code,'')),''),'SE'));
  v_formatted text;
begin
  if v_line1 is null and v_line2 is null and v_postal is null and v_city is null then
    return '{}'::jsonb;
  end if;
  v_formatted:=concat_ws(', ',v_line1,v_line2,nullif(concat_ws(' ',v_postal,v_city),''),v_country);
  return jsonb_strip_nulls(jsonb_build_object(
    'address_line_1',v_line1,
    'address_line_2',v_line2,
    'postal_code',v_postal,
    'city',v_city,
    'country_code',v_country,
    'formatted',nullif(v_formatted,'')
  ));
end $$;

create or replace function public.gridex_address_complete(p_value jsonb)
returns boolean
language sql
immutable
set search_path=public,pg_temp
as $$
  select
    length(btrim(coalesce(p_value->>'address_line_1',''))) >= 3
    and length(regexp_replace(coalesce(p_value->>'postal_code',''),'[^0-9]','','g')) = 5
    and length(btrim(coalesce(p_value->>'city',''))) >= 2
    and coalesce(p_value->>'country_code','') ~ '^[A-Z]{2}$'
$$;

create or replace function public.gridex_postal_address_has_street(p_value jsonb)
returns boolean
language sql
immutable
set search_path=public,pg_temp
as $$ select public.gridex_address_complete(coalesce(p_value,'{}'::jsonb)) $$;

create or replace function public.gridex_jsonb_valid_email(p_value jsonb)
returns boolean
language sql
immutable
set search_path=public,pg_temp
as $$
  select coalesce(p_value->>'email','') ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
$$;

create or replace function public.gridex_jsonb_valid_phone(p_value jsonb)
returns boolean
language sql
immutable
set search_path=public,pg_temp
as $$
  select length(regexp_replace(coalesce(p_value->>'phone',''),'[^0-9]','','g')) >= 7
$$;

create or replace function public.gridex_contact_address(p_value jsonb)
returns jsonb
language sql
immutable
set search_path=public,pg_temp
as $$
  select case when jsonb_typeof(p_value->'address')='object' then p_value->'address' else '{}'::jsonb end
$$;

create or replace function public.gridex_legal_contact_complete(p_value jsonb)
returns boolean
language sql
immutable
set search_path=public,pg_temp
as $$
  select public.gridex_jsonb_valid_email(coalesce(p_value,'{}'::jsonb))
      or public.gridex_jsonb_valid_phone(coalesce(p_value,'{}'::jsonb))
      or public.gridex_address_complete(public.gridex_contact_address(coalesce(p_value,'{}'::jsonb)))
$$;

create or replace function public.gridex_billing_information_complete(p_value jsonb)
returns boolean
language sql
immutable
set search_path=public,pg_temp
as $$
  select public.gridex_legal_contact_complete(coalesce(p_value->'contact','{}'::jsonb))
      or public.gridex_jsonb_valid_email(coalesce(p_value,'{}'::jsonb))
      or public.gridex_jsonb_valid_phone(coalesce(p_value,'{}'::jsonb))
      or public.gridex_address_complete(public.gridex_contact_address(coalesce(p_value,'{}'::jsonb)))
$$;

create or replace function public.gridex_dispute_information_complete(p_value jsonb)
returns boolean
language sql
immutable
set search_path=public,pg_temp
as $$
  select length(btrim(coalesce(p_value->>'authority',''))) >= 3
     and (coalesce(p_value->>'url','') ~* '^https?://' or length(btrim(coalesce(p_value->>'description',''))) >= 20)
$$;

create or replace function public.gridex_tenant_legal_profile_missing_fields(p_profile public.tenant_legal_profiles)
returns text[]
language plpgsql
immutable
set search_path=public,pg_temp
as $$
declare
  v_missing text[]:='{}';
begin
  if length(btrim(coalesce(p_profile.legal_name,''))) < 2 then v_missing:=array_append(v_missing,'legal_name'); end if;
  if length(regexp_replace(coalesce(p_profile.organization_number,''),'[^0-9]','','g')) <> 10 then v_missing:=array_append(v_missing,'organization_number'); end if;
  if not public.gridex_address_complete(p_profile.postal_address) then v_missing:=array_append(v_missing,'postal_address'); end if;
  if coalesce(p_profile.customer_service_email,'') !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then v_missing:=array_append(v_missing,'customer_service_email'); end if;
  if length(regexp_replace(coalesce(p_profile.phone,''),'[^0-9]','','g')) < 7 then v_missing:=array_append(v_missing,'phone'); end if;
  if coalesce(p_profile.website,'') !~* '^https?://([a-z0-9-]+\.)+[a-z]{2,}([/:?#].*)?$' then v_missing:=array_append(v_missing,'website'); end if;
  if not public.gridex_legal_contact_complete(p_profile.complaints_contact) then v_missing:=array_append(v_missing,'complaints_contact'); end if;
  if not public.gridex_legal_contact_complete(p_profile.data_protection_contact) then v_missing:=array_append(v_missing,'data_protection_contact'); end if;
  if not public.gridex_billing_information_complete(p_profile.billing_information) then v_missing:=array_append(v_missing,'billing_information'); end if;
  if not public.gridex_dispute_information_complete(p_profile.dispute_resolution_information) then v_missing:=array_append(v_missing,'dispute_resolution_information'); end if;
  return v_missing;
end $$;

create or replace function public.gridex_refresh_legal_profile_completeness()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  new.missing_fields:=public.gridex_tenant_legal_profile_missing_fields(new);
  new.completeness_status:=case
    when coalesce(array_length(new.missing_fields,1),0)>0 then 'incomplete'
    when coalesce(new.review_required,false) then 'complete'
    when coalesce(new.reviewed_at,new.verified_at) is not null then 'verified'
    else 'complete'
  end;
  new.updated_at:=now();
  return new;
end $$;

drop trigger if exists tenant_legal_profiles_completeness on public.tenant_legal_profiles;
create trigger tenant_legal_profiles_completeness
before insert or update on public.tenant_legal_profiles
for each row execute function public.gridex_refresh_legal_profile_completeness();

create or replace function public.gridex_company_legal_profile_defaults(p_company jsonb)
returns jsonb
language plpgsql
stable
set search_path=public,extensions,pg_temp
as $$
declare
  j jsonb:=coalesce(p_company,'{}'::jsonb);
  v_postal jsonb;
  v_complaints_address jsonb;
  v_privacy_address jsonb;
  v_billing_address jsonb;
  v_service_email text;
  v_phone text;
  v_complaints_email text;
  v_privacy_email text;
  v_billing_email text;
  v_dispute_default jsonb;
  v_dispute jsonb;
  v_snapshot jsonb;
  v_complaints_explicit boolean;
  v_privacy_explicit boolean;
  v_billing_explicit boolean;
begin
  v_postal:=public.gridex_build_canonical_address(
    coalesce(nullif(j->>'address_line_1',''),nullif(j->>'address','')),
    nullif(j->>'address_line_2',''),j->>'postal_code',j->>'city',coalesce(j->>'country_code','SE')
  );
  v_complaints_address:=public.gridex_build_canonical_address(
    j->>'complaints_address_line_1',j->>'complaints_address_line_2',j->>'complaints_postal_code',j->>'complaints_city',coalesce(j->>'complaints_country_code',j->>'country_code','SE')
  );
  if v_complaints_address='{}'::jsonb then v_complaints_address:=v_postal; end if;
  v_privacy_address:=public.gridex_build_canonical_address(
    j->>'data_protection_address_line_1',j->>'data_protection_address_line_2',j->>'data_protection_postal_code',j->>'data_protection_city',coalesce(j->>'data_protection_country_code',j->>'country_code','SE')
  );
  if v_privacy_address='{}'::jsonb then v_privacy_address:=v_postal; end if;
  v_billing_address:=public.gridex_build_canonical_address(
    j->>'billing_address_line_1',j->>'billing_address_line_2',j->>'billing_postal_code',j->>'billing_city',coalesce(j->>'billing_country_code',j->>'country_code','SE')
  );
  if v_billing_address='{}'::jsonb then v_billing_address:=v_postal; end if;

  v_service_email:=lower(coalesce(nullif(j->>'support_email',''),nullif(j->>'primary_contact_email',''),nullif(j->>'email','')));
  v_phone:=coalesce(nullif(j->>'phone',''),nullif(j->>'primary_contact_phone',''));
  v_complaints_email:=lower(coalesce(nullif(j->>'complaints_email',''),v_service_email));
  v_privacy_email:=lower(coalesce(nullif(j->>'data_protection_email',''),v_service_email));
  v_billing_email:=lower(coalesce(nullif(j->>'billing_contact_email',''),v_service_email));
  v_complaints_explicit:=nullif(j->>'complaints_email','') is not null or nullif(j->>'complaints_phone','') is not null or nullif(j->>'complaints_address_line_1','') is not null;
  v_privacy_explicit:=nullif(j->>'data_protection_email','') is not null or nullif(j->>'data_protection_phone','') is not null or nullif(j->>'data_protection_address_line_1','') is not null;
  v_billing_explicit:=nullif(j->>'billing_contact_email','') is not null or nullif(j->>'billing_contact_phone','') is not null or nullif(j->>'billing_address_line_1','') is not null;

  v_dispute_default:=jsonb_build_object(
    'authority','Allmänna reklamationsnämnden för behöriga konsumenttvister',
    'url','https://www.arn.se/',
    'description','Klagomål lämnas först till bolagets klagomålskontakt. Privatkund kan, när ARN:s regler är uppfyllda, vända sig till Allmänna reklamationsnämnden. Tvist avgörs i övrigt enligt svensk rätt och behörig svensk domstol om inget annat avtalats för företagskund.',
    'source','platform_default'
  );
  v_dispute:=case
    when coalesce(j->'dispute_resolution_override','{}'::jsonb) in ('{}'::jsonb,'null'::jsonb) then v_dispute_default
    else v_dispute_default || (j->'dispute_resolution_override') || jsonb_build_object('source','tenant_explicit')
  end;

  v_snapshot:=jsonb_strip_nulls(jsonb_build_object(
    'legal_name',coalesce(nullif(j->>'legal_name',''),nullif(j->>'name','')),
    'trade_name',j->>'name','organization_number',j->>'org_number','vat_number',j->>'vat_number',
    'postal_address',v_postal,'customer_service_email',v_service_email,'phone',v_phone,'website',j->>'website',
    'customer_service_hours',j->>'customer_service_hours','complaints_email',v_complaints_email,
    'data_protection_email',v_privacy_email,'billing_email',v_billing_email,'company_updated_at',j->>'updated_at'
  ));

  return jsonb_build_object(
    'legal_name',coalesce(nullif(j->>'legal_name',''),nullif(j->>'name','')),
    'organization_number',nullif(j->>'org_number',''),
    'postal_address',v_postal,
    'customer_service_address',v_postal,
    'customer_service_email',v_service_email,
    'phone',v_phone,
    'website',nullif(j->>'website',''),
    'customer_service_contact',jsonb_strip_nulls(jsonb_build_object(
      'name',coalesce(nullif(j->>'primary_contact_name',''),'Kundservice'),
      'email',v_service_email,'phone',v_phone,'address',v_postal,
      'hours',nullif(j->>'customer_service_hours',''),'source','company_fallback'
    )),
    'complaints_contact',jsonb_strip_nulls(jsonb_build_object(
      'name',coalesce(nullif(j->>'complaints_contact_name',''),'Klagomålsansvarig'),
      'email',v_complaints_email,'phone',coalesce(nullif(j->>'complaints_phone',''),v_phone),
      'address',v_complaints_address,'description',nullif(j->>'complaints_description',''),
      'source',case when v_complaints_explicit then 'tenant_explicit' else 'company_fallback' end
    )),
    'data_protection_contact',jsonb_strip_nulls(jsonb_build_object(
      'name',coalesce(nullif(j->>'data_protection_contact_name',''),'Dataskyddsansvarig'),
      'email',v_privacy_email,'phone',coalesce(nullif(j->>'data_protection_phone',''),v_phone),
      'address',v_privacy_address,
      'description','Dataskyddsfrågor och rättighetsbegäran hanteras via angiven kontaktkanal.',
      'source',case when v_privacy_explicit then 'tenant_explicit' else 'company_fallback' end
    )),
    'billing_information',jsonb_strip_nulls(jsonb_build_object(
      'contact',jsonb_strip_nulls(jsonb_build_object(
        'name','Fakturering','email',v_billing_email,'phone',coalesce(nullif(j->>'billing_contact_phone',''),v_phone),
        'address',v_billing_address,'source',case when v_billing_explicit then 'tenant_explicit' else 'company_fallback' end
      )),
      'email',v_billing_email,'phone',coalesce(nullif(j->>'billing_contact_phone',''),v_phone),'address',v_billing_address,
      'terms_summary',coalesce(nullif(j->>'billing_terms_summary',''),'Fakturering sker enligt avtalad period och den låsta prisversionen. Preliminära mätvärden får rättas när validerade värden erhålls.'),
      'source',case when v_billing_explicit then 'tenant_explicit' else 'platform_default' end
    )),
    'dispute_resolution_information',v_dispute,
    'source_company_snapshot',v_snapshot,
    'source_company_snapshot_sha256',encode(digest(convert_to(v_snapshot::text,'UTF8'),'sha256'::text),'hex')
  );
end $$;

create or replace function public.gridex_legal_missing_field_details(p_company_id uuid,p_fields text[])
returns jsonb
language sql
stable
set search_path=public,pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'code',code,
    'label',case code
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
      else replace(code,'_',' ') end,
    'message',case code
      when 'postal_address' then 'Fyll i gatuadress, postnummer, ort och land under Postadress.'
      when 'complaints_contact' then 'Fyll i minst e-post, telefon eller komplett postadress under Klagomål.'
      when 'data_protection_contact' then 'Fyll i minst e-post, telefon eller komplett postadress under Dataskydd.'
      when 'billing_information' then 'Fyll i minst e-post, telefon eller komplett faktureringsadress under Fakturering.'
      else 'Komplettera uppgiften under Redigera bolagsuppgifter.' end,
    'edit_path','/admin/companies/'||p_company_id::text||'#company-profile'
  ) order by ordinality),'[]'::jsonb)
  from unnest(coalesce(p_fields,'{}'::text[])) with ordinality as f(code,ordinality)
$$;

create or replace function public.gridex_rebuild_company_legal_profile(
  p_company_id uuid,
  p_actor_user_id uuid default null,
  p_mark_reviewed boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_company jsonb;
  v_defaults jsonb;
  v_existing public.tenant_legal_profiles%rowtype;
  v_profile public.tenant_legal_profiles%rowtype;
  v_changed boolean:=true;
  v_now timestamptz:=now();
begin
  select to_jsonb(c) into v_company from public.companies c where c.id=p_company_id for update;
  if v_company is null then raise exception using errcode='P0002',message='company_not_found'; end if;
  v_defaults:=public.gridex_company_legal_profile_defaults(v_company);
  select * into v_existing from public.tenant_legal_profiles where company_id=p_company_id;
  if found then v_changed:=v_existing.source_company_snapshot_sha256 is distinct from v_defaults->>'source_company_snapshot_sha256'; end if;

  insert into public.tenant_legal_profiles(
    company_id,legal_name,organization_number,postal_address,customer_service_address,
    customer_service_email,phone,website,customer_service_contact,complaints_contact,
    data_protection_contact,billing_information,dispute_resolution_information,
    source_company_snapshot,source_company_snapshot_sha256,source_company_updated_at,
    review_required,last_synced_at,last_synced_by
  ) values(
    p_company_id,v_defaults->>'legal_name',v_defaults->>'organization_number',v_defaults->'postal_address',v_defaults->'customer_service_address',
    v_defaults->>'customer_service_email',v_defaults->>'phone',v_defaults->>'website',v_defaults->'customer_service_contact',v_defaults->'complaints_contact',
    v_defaults->'data_protection_contact',v_defaults->'billing_information',v_defaults->'dispute_resolution_information',
    v_defaults->'source_company_snapshot',v_defaults->>'source_company_snapshot_sha256',v_now,false,v_now,p_actor_user_id
  )
  on conflict(company_id) do update set
    legal_name=excluded.legal_name,
    organization_number=excluded.organization_number,
    postal_address=excluded.postal_address,
    customer_service_address=excluded.customer_service_address,
    customer_service_email=excluded.customer_service_email,
    phone=excluded.phone,
    website=excluded.website,
    customer_service_contact=excluded.customer_service_contact,
    complaints_contact=excluded.complaints_contact,
    data_protection_contact=excluded.data_protection_contact,
    billing_information=excluded.billing_information,
    dispute_resolution_information=excluded.dispute_resolution_information,
    source_company_snapshot=excluded.source_company_snapshot,
    source_company_snapshot_sha256=excluded.source_company_snapshot_sha256,
    source_company_updated_at=v_now,
    last_synced_at=v_now,
    last_synced_by=p_actor_user_id;

  select * into v_profile from public.tenant_legal_profiles where company_id=p_company_id;
  if coalesce(array_length(v_profile.missing_fields,1),0)>0 then
    update public.tenant_legal_profiles
    set review_required=false,reviewed_at=null,reviewed_by=null,verified_at=null,verified_by=null
    where company_id=p_company_id;
  elsif p_mark_reviewed then
    update public.tenant_legal_profiles
    set review_required=false,reviewed_at=v_now,reviewed_by=p_actor_user_id,verified_at=v_now,verified_by=p_actor_user_id
    where company_id=p_company_id;
  elsif v_changed then
    update public.tenant_legal_profiles
    set review_required=true,reviewed_at=null,reviewed_by=null,verified_at=null,verified_by=null
    where company_id=p_company_id;
  end if;

  select * into v_profile from public.tenant_legal_profiles where company_id=p_company_id;
  if p_actor_user_id is not null and to_regclass('public.audit_logs') is not null then
    insert into public.audit_logs(actor_user_id,company_id,entity_type,entity_id,action,new_values,metadata)
    values(p_actor_user_id,p_company_id,'tenant_legal_profile',p_company_id,'COMPANY_LEGAL_PROFILE_REBUILT',
      jsonb_build_object('completeness_status',v_profile.completeness_status,'missing_fields',v_profile.missing_fields,'review_required',v_profile.review_required,'source_sha256',v_profile.source_company_snapshot_sha256),
      jsonb_build_object('canonical_source','companies','atomic',true));
  end if;

  return jsonb_build_object(
    'company_id',p_company_id,
    'company_name',v_company->>'name',
    'completeness_status',v_profile.completeness_status,
    'missing_fields',v_profile.missing_fields,
    'missing_field_details',public.gridex_legal_missing_field_details(p_company_id,v_profile.missing_fields),
    'review_required',v_profile.review_required,
    'reviewed_at',coalesce(v_profile.reviewed_at,v_profile.verified_at),
    'updated_at',v_profile.updated_at
  );
end $$;

create or replace function public.gridex_update_company_and_rebuild_legal_profile(
  p_company_id uuid,
  p_actor_user_id uuid,
  p_input jsonb,
  p_mark_reviewed boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  c public.companies%rowtype;
  v_name text;
  v_country text;
  v_result jsonb;
  v_skip_previous text:=current_setting('gridex.skip_legal_profile_sync',true);
begin
  select * into c from public.companies where id=p_company_id for update;
  if not found then raise exception using errcode='P0002',message='company_not_found'; end if;
  v_name:=case when p_input ? 'name' then nullif(btrim(coalesce(p_input->>'name','')),'') else c.name end;
  if v_name is null then raise exception using errcode='23514',message='company_name_required'; end if;
  v_country:=upper(coalesce(nullif(btrim(coalesce(p_input->>'country_code','')),''),c.country_code,'SE'));
  if v_country !~ '^[A-Z]{2}$' then raise exception using errcode='23514',message='invalid_country_code'; end if;

  perform set_config('gridex.skip_legal_profile_sync','on',true);
  update public.companies set
    name=v_name,
    legal_name=case when p_input ? 'legal_name' then nullif(btrim(p_input->>'legal_name'),'') else legal_name end,
    org_number=case when p_input ? 'org_number' then nullif(btrim(p_input->>'org_number'),'') else org_number end,
    vat_number=case when p_input ? 'vat_number' then nullif(btrim(p_input->>'vat_number'),'') else vat_number end,
    customer_number_prefix=case when p_input ? 'customer_number_prefix' then nullif(upper(regexp_replace(coalesce(p_input->>'customer_number_prefix',''),'[^A-Za-z0-9]','','g')),'') else customer_number_prefix end,
    primary_contact_name=case when p_input ? 'primary_contact_name' then nullif(btrim(p_input->>'primary_contact_name'),'') else primary_contact_name end,
    primary_contact_email=case when p_input ? 'primary_contact_email' then nullif(lower(btrim(p_input->>'primary_contact_email')),'') else primary_contact_email end,
    support_email=case when p_input ? 'support_email' then nullif(lower(btrim(p_input->>'support_email')),'') else support_email end,
    phone=case when p_input ? 'phone' then nullif(btrim(p_input->>'phone'),'') else phone end,
    website=case when p_input ? 'website' then nullif(btrim(p_input->>'website'),'') else website end,
    customer_service_hours=case when p_input ? 'customer_service_hours' then nullif(btrim(p_input->>'customer_service_hours'),'') else customer_service_hours end,
    address_line_1=case when p_input ? 'address_line_1' then nullif(btrim(p_input->>'address_line_1'),'') else address_line_1 end,
    address_line_2=case when p_input ? 'address_line_2' then nullif(btrim(p_input->>'address_line_2'),'') else address_line_2 end,
    postal_code=case when p_input ? 'postal_code' then public.gridex_normalize_postal_code(p_input->>'postal_code') else postal_code end,
    city=case when p_input ? 'city' then nullif(btrim(p_input->>'city'),'') else city end,
    country_code=v_country,
    complaints_contact_name=case when p_input ? 'complaints_contact_name' then nullif(btrim(p_input->>'complaints_contact_name'),'') else complaints_contact_name end,
    complaints_email=case when p_input ? 'complaints_email' then nullif(lower(btrim(p_input->>'complaints_email')),'') else complaints_email end,
    complaints_phone=case when p_input ? 'complaints_phone' then nullif(btrim(p_input->>'complaints_phone'),'') else complaints_phone end,
    complaints_address_line_1=case when p_input ? 'complaints_address_line_1' then nullif(btrim(p_input->>'complaints_address_line_1'),'') else complaints_address_line_1 end,
    complaints_address_line_2=case when p_input ? 'complaints_address_line_2' then nullif(btrim(p_input->>'complaints_address_line_2'),'') else complaints_address_line_2 end,
    complaints_postal_code=case when p_input ? 'complaints_postal_code' then public.gridex_normalize_postal_code(p_input->>'complaints_postal_code') else complaints_postal_code end,
    complaints_city=case when p_input ? 'complaints_city' then nullif(btrim(p_input->>'complaints_city'),'') else complaints_city end,
    complaints_country_code=case when p_input ? 'complaints_country_code' then upper(coalesce(nullif(btrim(p_input->>'complaints_country_code'),''),v_country)) else complaints_country_code end,
    complaints_description=case when p_input ? 'complaints_description' then nullif(btrim(p_input->>'complaints_description'),'') else complaints_description end,
    data_protection_contact_name=case when p_input ? 'data_protection_contact_name' then nullif(btrim(p_input->>'data_protection_contact_name'),'') else data_protection_contact_name end,
    data_protection_email=case when p_input ? 'data_protection_email' then nullif(lower(btrim(p_input->>'data_protection_email')),'') else data_protection_email end,
    data_protection_phone=case when p_input ? 'data_protection_phone' then nullif(btrim(p_input->>'data_protection_phone'),'') else data_protection_phone end,
    data_protection_address_line_1=case when p_input ? 'data_protection_address_line_1' then nullif(btrim(p_input->>'data_protection_address_line_1'),'') else data_protection_address_line_1 end,
    data_protection_address_line_2=case when p_input ? 'data_protection_address_line_2' then nullif(btrim(p_input->>'data_protection_address_line_2'),'') else data_protection_address_line_2 end,
    data_protection_postal_code=case when p_input ? 'data_protection_postal_code' then public.gridex_normalize_postal_code(p_input->>'data_protection_postal_code') else data_protection_postal_code end,
    data_protection_city=case when p_input ? 'data_protection_city' then nullif(btrim(p_input->>'data_protection_city'),'') else data_protection_city end,
    data_protection_country_code=case when p_input ? 'data_protection_country_code' then upper(coalesce(nullif(btrim(p_input->>'data_protection_country_code'),''),v_country)) else data_protection_country_code end,
    billing_contact_email=case when p_input ? 'billing_contact_email' then nullif(lower(btrim(p_input->>'billing_contact_email')),'') else billing_contact_email end,
    billing_contact_phone=case when p_input ? 'billing_contact_phone' then nullif(btrim(p_input->>'billing_contact_phone'),'') else billing_contact_phone end,
    billing_address_line_1=case when p_input ? 'billing_address_line_1' then nullif(btrim(p_input->>'billing_address_line_1'),'') else billing_address_line_1 end,
    billing_address_line_2=case when p_input ? 'billing_address_line_2' then nullif(btrim(p_input->>'billing_address_line_2'),'') else billing_address_line_2 end,
    billing_postal_code=case when p_input ? 'billing_postal_code' then public.gridex_normalize_postal_code(p_input->>'billing_postal_code') else billing_postal_code end,
    billing_city=case when p_input ? 'billing_city' then nullif(btrim(p_input->>'billing_city'),'') else billing_city end,
    billing_country_code=case when p_input ? 'billing_country_code' then upper(coalesce(nullif(btrim(p_input->>'billing_country_code'),''),v_country)) else billing_country_code end,
    billing_terms_summary=case when p_input ? 'billing_terms_summary' then nullif(btrim(p_input->>'billing_terms_summary'),'') else billing_terms_summary end,
    dispute_resolution_override=case when p_input ? 'dispute_resolution_override' then coalesce(p_input->'dispute_resolution_override','{}'::jsonb) else dispute_resolution_override end,
    status=case when p_input ? 'status' then coalesce(nullif(btrim(p_input->>'status'),''),status) else status end,
    status_reason=case when p_input ? 'status_reason' then nullif(btrim(p_input->>'status_reason'),'') else status_reason end,
    ediel_id=case when p_input ? 'ediel_id' then nullif(upper(btrim(p_input->>'ediel_id')),'') else ediel_id end,
    actor_role=case when p_input ? 'actor_role' then nullif(upper(btrim(p_input->>'actor_role')),'') else actor_role end,
    sender_sub_address=case when p_input ? 'sender_sub_address' then nullif(upper(btrim(p_input->>'sender_sub_address')),'') else sender_sub_address end,
    ediel_mailbox=case when p_input ? 'ediel_mailbox' then nullif(btrim(p_input->>'ediel_mailbox'),'') else ediel_mailbox end,
    operating_environment=case when p_input ? 'operating_environment' then coalesce(nullif(btrim(p_input->>'operating_environment'),''),operating_environment) else operating_environment end,
    branding=case when p_input ? 'branding' then coalesce(branding,'{}'::jsonb)||coalesce(p_input->'branding','{}'::jsonb) else branding end,
    updated_at=now(),
    updated_by=p_actor_user_id
  where id=p_company_id;
  perform set_config('gridex.skip_legal_profile_sync',coalesce(v_skip_previous,''),true);

  v_result:=public.gridex_rebuild_company_legal_profile(p_company_id,p_actor_user_id,p_mark_reviewed);
  if p_actor_user_id is not null and to_regclass('public.audit_logs') is not null then
    insert into public.audit_logs(actor_user_id,company_id,entity_type,entity_id,action,new_values,metadata)
    values(p_actor_user_id,p_company_id,'company',p_company_id,'COMPANY_PROFILE_AND_LEGAL_PROFILE_UPDATED',p_input,
      jsonb_build_object('atomic',true,'legal_profile_result',v_result));
  end if;
  return v_result;
end $$;

-- Preserve previously tenant-authored values by moving them into companies once.
update public.companies c set
  legal_name=coalesce(nullif(c.legal_name,''),nullif(p.legal_name,''),c.name),
  complaints_contact_name=coalesce(nullif(c.complaints_contact_name,''),nullif(p.complaints_contact->>'name','')),
  complaints_email=coalesce(nullif(c.complaints_email,''),nullif(p.complaints_contact->>'email','')),
  complaints_phone=coalesce(nullif(c.complaints_phone,''),nullif(p.complaints_contact->>'phone','')),
  complaints_address_line_1=coalesce(nullif(c.complaints_address_line_1,''),nullif(p.complaints_contact#>>'{address,address_line_1}',''),nullif(p.complaints_contact->>'address','')),
  complaints_address_line_2=coalesce(nullif(c.complaints_address_line_2,''),nullif(p.complaints_contact#>>'{address,address_line_2}','')),
  complaints_postal_code=coalesce(nullif(c.complaints_postal_code,''),nullif(p.complaints_contact#>>'{address,postal_code}','')),
  complaints_city=coalesce(nullif(c.complaints_city,''),nullif(p.complaints_contact#>>'{address,city}','')),
  complaints_country_code=coalesce(nullif(c.complaints_country_code,''),nullif(p.complaints_contact#>>'{address,country_code}','')),
  complaints_description=coalesce(nullif(c.complaints_description,''),nullif(p.complaints_contact->>'description','')),
  data_protection_contact_name=coalesce(nullif(c.data_protection_contact_name,''),nullif(p.data_protection_contact->>'name','')),
  data_protection_email=coalesce(nullif(c.data_protection_email,''),nullif(p.data_protection_contact->>'email','')),
  data_protection_phone=coalesce(nullif(c.data_protection_phone,''),nullif(p.data_protection_contact->>'phone','')),
  data_protection_address_line_1=coalesce(nullif(c.data_protection_address_line_1,''),nullif(p.data_protection_contact#>>'{address,address_line_1}',''),nullif(p.data_protection_contact->>'address','')),
  data_protection_address_line_2=coalesce(nullif(c.data_protection_address_line_2,''),nullif(p.data_protection_contact#>>'{address,address_line_2}','')),
  data_protection_postal_code=coalesce(nullif(c.data_protection_postal_code,''),nullif(p.data_protection_contact#>>'{address,postal_code}','')),
  data_protection_city=coalesce(nullif(c.data_protection_city,''),nullif(p.data_protection_contact#>>'{address,city}','')),
  data_protection_country_code=coalesce(nullif(c.data_protection_country_code,''),nullif(p.data_protection_contact#>>'{address,country_code}','')),
  billing_contact_email=coalesce(nullif(c.billing_contact_email,''),nullif(p.billing_information#>>'{contact,email}',''),nullif(p.billing_information->>'email','')),
  billing_contact_phone=coalesce(nullif(c.billing_contact_phone,''),nullif(p.billing_information#>>'{contact,phone}',''),nullif(p.billing_information->>'phone','')),
  billing_address_line_1=coalesce(nullif(c.billing_address_line_1,''),nullif(p.billing_information#>>'{contact,address,address_line_1}',''),nullif(p.billing_information#>>'{address,address_line_1}',''),nullif(p.billing_information->>'address','')),
  billing_address_line_2=coalesce(nullif(c.billing_address_line_2,''),nullif(p.billing_information#>>'{contact,address,address_line_2}',''),nullif(p.billing_information#>>'{address,address_line_2}','')),
  billing_postal_code=coalesce(nullif(c.billing_postal_code,''),nullif(p.billing_information#>>'{contact,address,postal_code}',''),nullif(p.billing_information#>>'{address,postal_code}','')),
  billing_city=coalesce(nullif(c.billing_city,''),nullif(p.billing_information#>>'{contact,address,city}',''),nullif(p.billing_information#>>'{address,city}','')),
  billing_country_code=coalesce(nullif(c.billing_country_code,''),nullif(p.billing_information#>>'{contact,address,country_code}',''),nullif(p.billing_information#>>'{address,country_code}','')),
  billing_terms_summary=coalesce(nullif(c.billing_terms_summary,''),nullif(p.billing_information->>'terms_summary',''),nullif(p.billing_information->>'description','')),
  dispute_resolution_override=case when c.dispute_resolution_override='{}'::jsonb and p.dispute_resolution_information<>'{}'::jsonb then p.dispute_resolution_information else c.dispute_resolution_override end
from public.tenant_legal_profiles p
where p.company_id=c.id;

create or replace function public.gridex_upsert_company_legal_profile_defaults(p_company_id uuid)
returns jsonb
language sql
security definer
set search_path=public,pg_temp
as $$ select public.gridex_rebuild_company_legal_profile(p_company_id,null,false) $$;

create or replace function public.gridex_sync_company_legal_profile_trigger()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if current_setting('gridex.skip_legal_profile_sync',true)='on' then return new; end if;
  perform public.gridex_rebuild_company_legal_profile(new.id,new.updated_by,false);
  return new;
end $$;

drop trigger if exists gridex_companies_legal_profile_sync on public.companies;
create trigger gridex_companies_legal_profile_sync
after insert or update of
  name,legal_name,org_number,vat_number,address_line_1,address_line_2,postal_code,city,country_code,
  primary_contact_name,primary_contact_email,support_email,phone,website,customer_service_hours,
  complaints_contact_name,complaints_email,complaints_phone,complaints_address_line_1,complaints_address_line_2,complaints_postal_code,complaints_city,complaints_country_code,complaints_description,
  data_protection_contact_name,data_protection_email,data_protection_phone,data_protection_address_line_1,data_protection_address_line_2,data_protection_postal_code,data_protection_city,data_protection_country_code,
  billing_contact_email,billing_contact_phone,billing_address_line_1,billing_address_line_2,billing_postal_code,billing_city,billing_country_code,billing_terms_summary,dispute_resolution_override
on public.companies
for each row execute function public.gridex_sync_company_legal_profile_trigger();

do $gridex_rebuild_all_profiles$
declare r record;
begin
  for r in
    select c.id,(coalesce(p.reviewed_at,p.verified_at) is not null and coalesce(array_length(p.missing_fields,1),0)=0) as keep_reviewed
    from public.companies c left join public.tenant_legal_profiles p on p.company_id=c.id
  loop
    perform public.gridex_rebuild_company_legal_profile(r.id,null,coalesce(r.keep_reviewed,false));
  end loop;
end
$gridex_rebuild_all_profiles$;

-- Real PostgreSQL regression runs inside a nested subtransaction.
-- The successful test is deliberately rolled back with a private SQLSTATE so that
-- generated immutable legal_text_versions and other trigger side effects are never
-- deleted by cleanup code. Any real assertion error still aborts the migration.
do $gridex_company_legal_profile_e2e$
declare
  v_company_id uuid:=gen_random_uuid();
  v_org text:='9'||lpad((floor(random()*1000000000))::bigint::text,9,'0');
  v_result jsonb;
  v_missing text[];
begin
  begin
    insert into public.companies(
      id,name,legal_name,org_number,address_line_1,postal_code,city,country_code,
      primary_contact_email,support_email,phone,website,billing_contact_email,updated_at
    ) values(
      v_company_id,'Gridex migrationstest','Gridex migrationstest AB',v_org,null,null,null,'SE',
      'test@example.se','support@example.se','+46401234567','https://example.se','billing@example.se',now()
    );

    select missing_fields into v_missing from public.tenant_legal_profiles where company_id=v_company_id;
    if not ('postal_address'=any(coalesce(v_missing,'{}'::text[]))) then
      raise exception 'gridex_company_legal_profile_e2e: expected postal_address blocker before edit';
    end if;

    v_result:=public.gridex_update_company_and_rebuild_legal_profile(
      v_company_id,null,
      jsonb_build_object('address_line_1','Storgatan 1','postal_code','21120','city','Malmö','country_code','SE'),
      true
    );
    if 'postal_address'=any(coalesce(array(select jsonb_array_elements_text(v_result->'missing_fields')),'{}'::text[])) then
      raise exception 'gridex_company_legal_profile_e2e: postal_address blocker remained after canonical company edit';
    end if;
    if coalesce(v_result->>'completeness_status','') not in ('complete','verified') then
      raise exception 'gridex_company_legal_profile_e2e: profile did not become complete';
    end if;

    raise exception using
      errcode='GX001',
      message='gridex_company_legal_profile_e2e_rollback';
  exception
    when sqlstate 'GX001' then
      null;
  end;
end
$gridex_company_legal_profile_e2e$;

grant execute on function public.gridex_normalize_postal_code(text) to authenticated,service_role;
grant execute on function public.gridex_build_canonical_address(text,text,text,text,text) to authenticated,service_role;
grant execute on function public.gridex_address_complete(jsonb) to authenticated,service_role;
grant execute on function public.gridex_legal_missing_field_details(uuid,text[]) to authenticated,service_role;
revoke all on function public.gridex_rebuild_company_legal_profile(uuid,uuid,boolean) from public,anon,authenticated;
revoke all on function public.gridex_update_company_and_rebuild_legal_profile(uuid,uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.gridex_rebuild_company_legal_profile(uuid,uuid,boolean) to service_role;
grant execute on function public.gridex_update_company_and_rebuild_legal_profile(uuid,uuid,jsonb,boolean) to service_role;
grant execute on function public.gridex_upsert_company_legal_profile_defaults(uuid) to service_role;

comment on function public.gridex_update_company_and_rebuild_legal_profile(uuid,uuid,jsonb,boolean) is
  'Canonical atomic write path for company data and generated tenant legal profile. All company editors must call this function.';
comment on table public.tenant_legal_profiles is
  'Generated legal projection of companies plus platform defaults. Not an independently editable source.';

commit;
