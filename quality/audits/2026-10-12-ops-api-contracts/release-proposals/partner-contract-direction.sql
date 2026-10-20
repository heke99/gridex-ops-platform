-- REVIEW PROPOSAL ONLY. Not applied and not registered as a production migration.
-- Reconcile against the final native/source head, create a forward migration with the CLI,
-- register its checksum with the sole migration/GEN owner, and verify native behavior before release.
-- Gridex Partner API v1: canonical contract registration and secure webhook delivery.
-- Additive/replacement functions only. External callers never receive or choose company_id.

create or replace function public.gridex_create_partner_contract_v1(
  p_company_id uuid,
  p_api_client_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'extensions', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_offer jsonb;
  v_customer jsonb := coalesce(p_payload->'customer', '{}'::jsonb);
  v_site jsonb := coalesce(p_payload->'site', '{}'::jsonb);
  v_agreement jsonb := coalesce(p_payload->'agreement', '{}'::jsonb);
  v_poa jsonb := coalesce(p_payload->'power_of_attorney', '{}'::jsonb);
  v_customer_type text := lower(coalesce(nullif(btrim(v_customer->>'type'), ''), nullif(btrim(v_customer->>'customer_type'), ''), 'private'));
  v_site_type text := lower(coalesce(nullif(btrim(v_site->>'electricity_type'), ''), nullif(btrim(v_site->>'site_electricity_type'), ''), 'consumption'));
  v_offer_reference text := nullif(btrim(p_payload->>'offer_reference'), '');
  v_external_customer_id text := nullif(btrim(coalesce(v_customer->>'external_customer_id', p_payload->>'external_customer_id')), '');
  v_identity_number text := regexp_replace(coalesce(v_customer->>'identity_number', v_customer->>'soc_id', ''), '[^0-9]', '', 'g');
  v_org_number text := regexp_replace(coalesce(v_customer->>'organization_number', v_customer->>'org_number', ''), '[^0-9]', '', 'g');
  v_email text := lower(nullif(btrim(v_customer->>'email'), ''));
  v_customer_id uuid;
  v_site_id uuid;
  v_contract_id uuid;
  v_poa_id uuid;
  v_customer_reference text;
  v_site_reference text;
  v_contract_reference text;
  v_poa_reference text;
  v_customer_number text;
  v_contract_name text;
  v_contract_type text;
  v_energy_direction text;
  v_publication_version_id uuid;
  v_contract_product_version_id uuid;
  v_contract_product_id uuid;
  v_price_plan_id uuid;
  v_price_plan_version_id uuid;
  v_price_book_id uuid;
  v_legal_bundle_version_id uuid;
  v_agreement_accepted_at timestamptz;
  v_signed boolean := false;
  v_now timestamptz := now();
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode='42501', message='partner_api_service_role_required';
  end if;
  if p_company_id is null or p_api_client_id is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode='22023', message='partner_api_contract_payload_invalid';
  end if;
  if not exists (
    select 1
    from public.integration_api_clients c
    where c.id = p_api_client_id
      and c.company_id = p_company_id
      and c.status = 'active'
  ) then
    raise exception using errcode='42501', message='partner_api_client_not_active_for_company';
  end if;

  if v_customer_type = 'company' then
    v_customer_type := 'business';
  end if;
  if v_customer_type not in ('private', 'business', 'association') then
    raise exception using errcode='22023', message='partner_api_customer_type_invalid';
  end if;
  if v_site_type = 'production' then
    v_energy_direction := 'production';
  elsif v_site_type = 'consumption' then
    v_energy_direction := 'consumption';
  else
    raise exception using errcode='22023', message='partner_api_site_electricity_type_invalid';
  end if;
  if v_offer_reference is null then
    raise exception using errcode='22023', message='partner_api_offer_reference_required';
  end if;
  if v_email is null or position('@' in v_email) <= 1 then
    raise exception using errcode='22023', message='partner_api_customer_email_required';
  end if;
  if v_external_customer_id is null then
    raise exception using errcode='22023', message='partner_api_external_customer_id_required';
  end if;
  if v_customer_type = 'private' and length(v_identity_number) < 10 then
    raise exception using errcode='22023', message='partner_api_customer_identity_number_required';
  end if;
  if v_customer_type in ('business','association') and length(v_org_number) < 10 then
    raise exception using errcode='22023', message='partner_api_customer_organization_number_required';
  end if;
  if nullif(btrim(coalesce(v_site->>'street', v_site->>'address', '')), '') is null
     or nullif(btrim(coalesce(v_site->>'postal_code', v_site->>'zip_code', '')), '') is null
     or nullif(btrim(v_site->>'city'), '') is null then
    raise exception using errcode='22023', message='partner_api_site_address_required';
  end if;

  v_offer := public.gridex_resolve_partner_api_offer_v1(
    p_company_id,
    v_offer_reference,
    case when v_customer_type = 'association' then null else v_customer_type end
  );
  -- Bind the requested site direction to the exact offer selected inside this transaction.
  -- The application preflight alone cannot cover a publication change between RPC calls.
  if not coalesce(v_offer->>'energy_direction' in ('consumption', 'production'), false) then
    raise exception using errcode='22023', message='partner_api_offer_direction_unavailable';
  end if;
  if v_offer->>'energy_direction' is distinct from v_site_type then
    raise exception using errcode='22023', message='partner_api_site_offer_direction_mismatch';
  end if;

  v_publication_version_id := (v_offer->>'publication_version_id')::uuid;
  v_contract_product_version_id := (v_offer->>'contract_product_version_id')::uuid;
  v_contract_product_id := (v_offer->>'contract_product_id')::uuid;
  v_price_plan_id := nullif(v_offer->>'price_plan_id','')::uuid;
  v_price_plan_version_id := nullif(v_offer->>'price_plan_version_id','')::uuid;
  v_price_book_id := nullif(v_offer->>'price_book_id','')::uuid;
  v_legal_bundle_version_id := nullif(v_offer->>'legal_bundle_version_id','')::uuid;
  v_contract_type := coalesce(nullif(v_offer->>'contract_type',''), 'variable');
  v_energy_direction := coalesce(nullif(v_offer->>'energy_direction',''), v_energy_direction);

  select coalesce(nullif(btrim(cp.name), ''), 'API contract')
  into v_contract_name
  from public.contract_product_versions cpv
  join public.contract_products cp on cp.id = cpv.contract_product_id
  where cpv.id = v_contract_product_version_id
    and (cp.company_id = p_company_id or cp.company_id is null)
  limit 1;
  v_contract_name := coalesce(v_contract_name, 'API contract');

  if nullif(btrim(v_agreement->>'accepted_at'),'') is not null then
    begin
      v_agreement_accepted_at := (v_agreement->>'accepted_at')::timestamptz;
    exception when others then
      raise exception using errcode='22023', message='partner_api_agreement_accepted_at_invalid';
    end;
    v_signed :=
      nullif(btrim(v_agreement->>'signer_name'),'') is not null
      and nullif(btrim(v_agreement->>'evidence_reference'),'') is not null;
    if not v_signed then
      raise exception using errcode='22023', message='partner_api_agreement_evidence_required';
    end if;
  end if;

  insert into public.customers(
    company_id,
    customer_type,
    status,
    first_name,
    last_name,
    full_name,
    company_name,
    personal_number,
    identity_number,
    org_number,
    organization_number,
    email,
    phone,
    source,
    acquisition_channel,
    external_customer_id,
    billing_street,
    billing_postal_code,
    billing_city,
    billing_country,
    metadata
  ) values (
    p_company_id,
    v_customer_type,
    'active',
    nullif(btrim(v_customer->>'first_name'),''),
    nullif(btrim(v_customer->>'last_name'),''),
    nullif(btrim(concat_ws(' ', v_customer->>'first_name', v_customer->>'last_name')),''),
    nullif(btrim(v_customer->>'company_name'),''),
    case when v_customer_type = 'private' then v_identity_number else null end,
    case when v_customer_type = 'private' then v_identity_number else null end,
    case when v_customer_type <> 'private' then v_org_number else null end,
    case when v_customer_type <> 'private' then v_org_number else null end,
    v_email,
    nullif(btrim(coalesce(v_customer->>'phone', v_customer->>'cell_phone')),''),
    'api',
    'partner_api',
    v_external_customer_id,
    nullif(btrim(coalesce(v_customer#>>'{invoice_address,street}', v_customer->>'invoice_address')),''),
    nullif(btrim(coalesce(v_customer#>>'{invoice_address,postal_code}', v_customer->>'zip_code')),''),
    nullif(btrim(coalesce(v_customer#>>'{invoice_address,city}', v_customer->>'city')),''),
    upper(coalesce(nullif(btrim(coalesce(v_customer#>>'{invoice_address,country}', v_customer->>'country')),''), 'SE')),
    jsonb_build_object(
      'source_channel','partner_api',
      'api_client_id',p_api_client_id,
      'external_payload_metadata',coalesce(p_payload->'metadata','{}'::jsonb)
    )
  )
  returning id, customer_reference, customer_number
  into v_customer_id, v_customer_reference, v_customer_number;

  insert into public.customer_sites(
    company_id,
    customer_id,
    site_name,
    site_type,
    status,
    facility_id,
    street,
    address,
    postal_code,
    city,
    country,
    move_in_date,
    annual_consumption_kwh,
    metadata
  ) values (
    p_company_id,
    v_customer_id,
    coalesce(nullif(btrim(v_site->>'name'),''), concat_ws(', ', coalesce(v_site->>'street', v_site->>'address'), v_site->>'city')),
    v_site_type,
    'draft',
    nullif(regexp_replace(coalesce(v_site->>'facility_id',''), '[^0-9]', '', 'g'),''),
    nullif(btrim(coalesce(v_site->>'street', v_site->>'address')),''),
    nullif(btrim(coalesce(v_site->>'address', v_site->>'street')),''),
    nullif(btrim(coalesce(v_site->>'postal_code', v_site->>'zip_code')),''),
    nullif(btrim(v_site->>'city'),''),
    upper(coalesce(nullif(btrim(v_site->>'country'),''), 'SE')),
    case when nullif(btrim(v_site->>'move_in_date'),'') is null then null else (v_site->>'move_in_date')::date end,
    case when nullif(btrim(v_site->>'annual_consumption_kwh'),'') is null then null else (v_site->>'annual_consumption_kwh')::numeric end,
    jsonb_build_object('source_channel','partner_api','api_client_id',p_api_client_id)
  )
  returning id, facility_reference
  into v_site_id, v_site_reference;

  insert into public.customer_contracts(
    company_id,
    customer_id,
    site_id,
    customer_site_id,
    source_type,
    status,
    contract_name,
    contract_type,
    signed_at,
    agreement_channel,
    is_distance_agreement,
    requested_start_date,
    requested_start_mode,
    offer_reference,
    contract_product_id,
    contract_product_version_id,
    contract_publication_version_id,
    legal_bundle_version_id,
    price_plan_id,
    price_plan_version_id,
    price_book_id,
    energy_direction,
    customer_number,
    external_customer_id,
    metadata
  ) values (
    p_company_id,
    v_customer_id,
    v_site_id,
    v_site_id,
    'api',
    case when v_signed then 'signed' else 'pending_signature' end,
    v_contract_name,
    v_contract_type,
    case when v_signed then v_agreement_accepted_at else null end,
    'api',
    coalesce((v_agreement->>'distance_agreement')::boolean, true),
    case when nullif(btrim(p_payload->>'requested_start_date'),'') is null then null else (p_payload->>'requested_start_date')::date end,
    coalesce(nullif(btrim(p_payload->>'requested_start_mode'),''), 'earliest_possible'),
    v_offer_reference,
    v_contract_product_id,
    v_contract_product_version_id,
    v_publication_version_id,
    v_legal_bundle_version_id,
    v_price_plan_id,
    v_price_plan_version_id,
    v_price_book_id,
    v_energy_direction,
    v_customer_number,
    v_external_customer_id,
    jsonb_build_object(
      'source_channel','partner_api',
      'api_client_id',p_api_client_id,
      'agreement_evidence_reference',nullif(btrim(v_agreement->>'evidence_reference'),''),
      'agreement_signer_name',nullif(btrim(v_agreement->>'signer_name'),'')
    )
  )
  returning id, customer_contract_reference
  into v_contract_id, v_contract_reference;

  if jsonb_typeof(p_payload->'power_of_attorney') = 'object'
     and coalesce((v_poa->>'accepted')::boolean, false) then
    insert into public.powers_of_attorney(
      company_id,
      customer_id,
      site_id,
      customer_site_id,
      contract_id,
      customer_contract_id,
      scope,
      status,
      signed_at,
      accepted_at,
      signer_name,
      signer_identity_number,
      method,
      accepted_source,
      source,
      document_path,
      document_hash,
      evidence_payload,
      metadata,
      customer_number,
      external_customer_id
    ) values (
      p_company_id,
      v_customer_id,
      v_site_id,
      v_site_id,
      v_contract_id,
      v_contract_id,
      case
        when lower(coalesce(v_poa->>'transaction_type','switch')) = 'switch' then 'supplier_switch'
        else 'supplier_switch'
      end,
      'signed',
      coalesce(nullif(v_poa->>'accepted_at','')::timestamptz, v_now),
      coalesce(nullif(v_poa->>'accepted_at','')::timestamptz, v_now),
      nullif(btrim(v_poa->>'signer_name'),''),
      nullif(regexp_replace(coalesce(v_poa->>'signer_identity_number',''), '[^0-9]', '', 'g'),''),
      lower(coalesce(nullif(btrim(v_poa->>'poa_type'),''), 'web')),
      'partner_api',
      'partner_api',
      nullif(btrim(v_poa->>'document_path'),''),
      nullif(btrim(v_poa->>'document_sha256'),''),
      jsonb_build_object(
        'evidence_reference', nullif(btrim(v_poa->>'evidence_reference'),''),
        'transaction_type', upper(coalesce(nullif(btrim(v_poa->>'transaction_type'),''), 'SWITCH'))
      ),
      jsonb_build_object('source_channel','partner_api','api_client_id',p_api_client_id),
      v_customer_number,
      v_external_customer_id
    )
    returning id, power_of_attorney_reference
    into v_poa_id, v_poa_reference;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'contract_reference', v_contract_reference,
    'status', case when v_signed then 'signed' else 'pending_signature' end,
    'customer', jsonb_build_object(
      'customer_reference', v_customer_reference,
      'customer_number', v_customer_number
    ),
    'site', jsonb_build_object('site_reference', v_site_reference),
    'power_of_attorney',
      case when v_poa_reference is null then null
           else jsonb_build_object('power_of_attorney_reference', v_poa_reference)
      end
  ));
end
$function$;

revoke all on function public.gridex_create_partner_contract_v1(uuid,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.gridex_create_partner_contract_v1(uuid,uuid,jsonb)
  to service_role;
