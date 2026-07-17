-- Gridex structured tenant legal profile and superadmin synchronization.
-- Adds strict structured validation, normalizes existing profiles without
-- overwriting tenant-authored values, and keeps future company changes aligned.

begin;

create or replace function public.gridex_jsonb_valid_email(p_value jsonb)
returns boolean
language sql
immutable
set search_path=public,pg_temp
as $$
  select coalesce(p_value->>'email','') ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
      or coalesce(p_value->>'text','') ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
$$;

create or replace function public.gridex_jsonb_valid_phone(p_value jsonb)
returns boolean
language sql
immutable
set search_path=public,pg_temp
as $$
  select length(regexp_replace(coalesce(p_value->>'phone',''),'[^0-9]','','g')) >= 7
$$;

create or replace function public.gridex_postal_address_has_street(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path=public,pg_temp
as $$
declare
  v_line1 text:=nullif(btrim(coalesce(
    p_value->>'address_line_1',
    p_value->>'street',
    p_value->>'address',
    ''
  )), '');
  v_postal text:=nullif(btrim(coalesce(p_value->>'postal_code','')), '');
  v_city text:=nullif(btrim(coalesce(p_value->>'city','')), '');
  v_text text:=nullif(btrim(coalesce(p_value->>'text','')), '');
begin
  return (
    v_line1 is not null
    and length(v_line1) >= 3
    and v_line1 ~ '[0-9]'
    and length(regexp_replace(coalesce(v_postal,''),'[^0-9]','','g')) >= 5
    and v_city is not null
    and length(v_city) >= 2
  ) or (
    v_text is not null
    and length(v_text) >= 12
    and v_text ~ '[0-9]'
    and length(regexp_replace(v_text,'[^0-9]','','g')) >= 6
  );
end $$;

create or replace function public.gridex_legal_contact_complete(p_value jsonb)
returns boolean
language sql
immutable
set search_path=public,pg_temp
as $$
  select public.gridex_jsonb_valid_email(coalesce(p_value,'{}'::jsonb))
      or public.gridex_jsonb_valid_phone(coalesce(p_value,'{}'::jsonb))
      or length(btrim(coalesce(p_value->>'address',''))) >= 6
$$;

create or replace function public.gridex_billing_information_complete(p_value jsonb)
returns boolean
language sql
immutable
set search_path=public,pg_temp
as $$
  select public.gridex_jsonb_valid_email(coalesce(p_value,'{}'::jsonb))
      or public.gridex_jsonb_valid_phone(coalesce(p_value,'{}'::jsonb))
      or length(btrim(coalesce(p_value->>'address',''))) >= 6
      or length(regexp_replace(coalesce(p_value->>'bankgiro',''),'[^0-9]','','g')) >= 7
$$;

create or replace function public.gridex_dispute_information_complete(p_value jsonb)
returns boolean
language sql
immutable
set search_path=public,pg_temp
as $$
  select length(btrim(coalesce(p_value->>'authority',''))) >= 3
     and (
       coalesce(p_value->>'url','') ~* '^https?://'
       or length(btrim(coalesce(p_value->>'text',''))) >= 20
       or length(btrim(coalesce(p_value->>'description',''))) >= 20
       or public.gridex_jsonb_valid_email(coalesce(p_value,'{}'::jsonb))
       or length(btrim(coalesce(p_value->>'address',''))) >= 6
     )
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
  if length(btrim(coalesce(p_profile.legal_name,''))) < 2 then
    v_missing:=array_append(v_missing,'legal_name');
  end if;
  if length(regexp_replace(coalesce(p_profile.organization_number,''),'[^0-9]','','g')) <> 10 then
    v_missing:=array_append(v_missing,'organization_number');
  end if;
  if not public.gridex_postal_address_has_street(p_profile.postal_address) then
    v_missing:=array_append(v_missing,'postal_address');
  end if;
  if nullif(btrim(coalesce(p_profile.customer_service_email,'')),'') is null
     or p_profile.customer_service_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    v_missing:=array_append(v_missing,'customer_service_email');
  end if;
  if length(regexp_replace(coalesce(p_profile.phone,''),'[^0-9]','','g')) < 7 then
    v_missing:=array_append(v_missing,'phone');
  end if;
  if nullif(btrim(coalesce(p_profile.website,'')),'') is null
     or p_profile.website !~* '^(https?://)?([a-z0-9-]+\.)+[a-z]{2,}([/:?#].*)?$' then
    v_missing:=array_append(v_missing,'website');
  end if;
  if not public.gridex_legal_contact_complete(p_profile.complaints_contact) then
    v_missing:=array_append(v_missing,'complaints_contact');
  end if;
  if not public.gridex_legal_contact_complete(p_profile.data_protection_contact) then
    v_missing:=array_append(v_missing,'data_protection_contact');
  end if;
  if not public.gridex_billing_information_complete(p_profile.billing_information) then
    v_missing:=array_append(v_missing,'billing_information');
  end if;
  if not public.gridex_dispute_information_complete(p_profile.dispute_resolution_information) then
    v_missing:=array_append(v_missing,'dispute_resolution_information');
  end if;
  return v_missing;
end $$;

create or replace function public.gridex_upsert_company_legal_profile_defaults(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_company jsonb;
  v_defaults jsonb;
  v_profile public.tenant_legal_profiles%rowtype;
begin
  select to_jsonb(c) into v_company from public.companies c where c.id=p_company_id;
  if v_company is null then
    raise exception using errcode='P0002',message='company_not_found';
  end if;
  v_defaults:=public.gridex_company_legal_profile_defaults(v_company);

  insert into public.tenant_legal_profiles(
    company_id,legal_name,organization_number,postal_address,customer_service_address,
    customer_service_email,phone,website,complaints_contact,data_protection_contact,
    billing_information,dispute_resolution_information,source_company_snapshot,
    source_company_snapshot_sha256,source_company_updated_at,review_required
  ) values(
    p_company_id,v_defaults->>'legal_name',v_defaults->>'organization_number',
    v_defaults->'postal_address',v_defaults->'customer_service_address',v_defaults->>'customer_service_email',
    v_defaults->>'phone',v_defaults->>'website',v_defaults->'complaints_contact',v_defaults->'data_protection_contact',
    v_defaults->'billing_information',v_defaults->'dispute_resolution_information',v_defaults->'source_company_snapshot',
    v_defaults->>'source_company_snapshot_sha256',now(),false
  )
  on conflict(company_id) do update set
    legal_name=coalesce(nullif(public.tenant_legal_profiles.legal_name,''),excluded.legal_name),
    organization_number=coalesce(nullif(public.tenant_legal_profiles.organization_number,''),excluded.organization_number),
    postal_address=case
      when not public.gridex_postal_address_has_street(public.tenant_legal_profiles.postal_address)
        then coalesce(excluded.postal_address,'{}'::jsonb) || coalesce(public.tenant_legal_profiles.postal_address,'{}'::jsonb)
      else public.tenant_legal_profiles.postal_address
    end,
    customer_service_address=case
      when not public.gridex_postal_address_has_street(public.tenant_legal_profiles.customer_service_address)
        then coalesce(excluded.customer_service_address,'{}'::jsonb) || coalesce(public.tenant_legal_profiles.customer_service_address,'{}'::jsonb)
      else public.tenant_legal_profiles.customer_service_address
    end,
    customer_service_email=coalesce(nullif(public.tenant_legal_profiles.customer_service_email,''),excluded.customer_service_email),
    phone=coalesce(nullif(public.tenant_legal_profiles.phone,''),excluded.phone),
    website=coalesce(nullif(public.tenant_legal_profiles.website,''),excluded.website),
    complaints_contact=case
      when not public.gridex_legal_contact_complete(public.tenant_legal_profiles.complaints_contact)
        then coalesce(excluded.complaints_contact,'{}'::jsonb) || coalesce(public.tenant_legal_profiles.complaints_contact,'{}'::jsonb)
      else public.tenant_legal_profiles.complaints_contact
    end,
    data_protection_contact=case
      when not public.gridex_legal_contact_complete(public.tenant_legal_profiles.data_protection_contact)
        then coalesce(excluded.data_protection_contact,'{}'::jsonb) || coalesce(public.tenant_legal_profiles.data_protection_contact,'{}'::jsonb)
      else public.tenant_legal_profiles.data_protection_contact
    end,
    billing_information=case
      when not public.gridex_billing_information_complete(public.tenant_legal_profiles.billing_information)
        then coalesce(excluded.billing_information,'{}'::jsonb) || coalesce(public.tenant_legal_profiles.billing_information,'{}'::jsonb)
      else public.tenant_legal_profiles.billing_information
    end,
    dispute_resolution_information=case
      when not public.gridex_dispute_information_complete(public.tenant_legal_profiles.dispute_resolution_information)
        then coalesce(excluded.dispute_resolution_information,'{}'::jsonb) || coalesce(public.tenant_legal_profiles.dispute_resolution_information,'{}'::jsonb)
      else public.tenant_legal_profiles.dispute_resolution_information
    end,
    review_required=public.tenant_legal_profiles.review_required or (
      public.tenant_legal_profiles.source_company_snapshot_sha256 is not null and
      public.tenant_legal_profiles.source_company_snapshot_sha256 is distinct from excluded.source_company_snapshot_sha256
    ),
    verified_at=case
      when public.tenant_legal_profiles.verified_at is not null
       and public.tenant_legal_profiles.source_company_snapshot_sha256 is distinct from excluded.source_company_snapshot_sha256
        then null
      else public.tenant_legal_profiles.verified_at
    end,
    verified_by=case
      when public.tenant_legal_profiles.verified_at is not null
       and public.tenant_legal_profiles.source_company_snapshot_sha256 is distinct from excluded.source_company_snapshot_sha256
        then null
      else public.tenant_legal_profiles.verified_by
    end,
    source_company_snapshot=excluded.source_company_snapshot,
    source_company_snapshot_sha256=excluded.source_company_snapshot_sha256,
    source_company_updated_at=now();

  select * into v_profile from public.tenant_legal_profiles where company_id=p_company_id;
  return jsonb_build_object(
    'company_id',p_company_id,
    'completeness_status',v_profile.completeness_status,
    'missing_fields',v_profile.missing_fields,
    'review_required',v_profile.review_required
  );
end $$;

do $gridex_structured_profile_repair$
declare
  r record;
  v_defaults jsonb;
begin
  for r in select c.id,to_jsonb(c) as company_json from public.companies c loop
    perform public.gridex_upsert_company_legal_profile_defaults(r.id);
    v_defaults:=public.gridex_company_legal_profile_defaults(r.company_json);

    update public.tenant_legal_profiles p
    set
      postal_address=coalesce(v_defaults->'postal_address','{}'::jsonb) || coalesce(p.postal_address,'{}'::jsonb),
      customer_service_address=coalesce(v_defaults->'customer_service_address','{}'::jsonb) || coalesce(p.customer_service_address,'{}'::jsonb),
      complaints_contact=coalesce(v_defaults->'complaints_contact','{}'::jsonb) || coalesce(p.complaints_contact,'{}'::jsonb),
      data_protection_contact=coalesce(v_defaults->'data_protection_contact','{}'::jsonb) || coalesce(p.data_protection_contact,'{}'::jsonb),
      billing_information=coalesce(v_defaults->'billing_information','{}'::jsonb) || coalesce(p.billing_information,'{}'::jsonb),
      dispute_resolution_information=coalesce(v_defaults->'dispute_resolution_information','{}'::jsonb) || coalesce(p.dispute_resolution_information,'{}'::jsonb),
      updated_at=now()
    where p.company_id=r.id;
  end loop;
end
$gridex_structured_profile_repair$;

update public.tenant_legal_profiles set updated_at=updated_at;

grant execute on function public.gridex_jsonb_valid_email(jsonb) to authenticated,service_role;
grant execute on function public.gridex_jsonb_valid_phone(jsonb) to authenticated,service_role;
grant execute on function public.gridex_legal_contact_complete(jsonb) to authenticated,service_role;
grant execute on function public.gridex_billing_information_complete(jsonb) to authenticated,service_role;
grant execute on function public.gridex_dispute_information_complete(jsonb) to authenticated,service_role;
grant execute on function public.gridex_upsert_company_legal_profile_defaults(uuid) to service_role;

commit;
