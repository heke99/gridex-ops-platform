-- PRIVATE derived replay proposal only, NOT executed/native-qualified/applied.
-- Source060124 SHA105f32d496c611edb82764eabe43ad035ebadf5648d76db8779ee2a9c5b2598b stays immutable.
-- Native public-core original7ca→0e definition gate retained.
-- Canonical public retention wrapper1496 stays identical; only exact effective8bd gets samecee output.
BEGIN;
SET LOCAL search_path=pg_catalog;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $signing_prepare_canonical_postlock$
DECLARE
 public_target oid:=to_regprocedure('public.gridex_prepare_customer_contract_signature_request_v1(uuid,uuid,uuid,text,text,timestamptz,uuid,text)');
 effective_target oid; public_before pg_catalog.pg_proc%rowtype; public_after pg_catalog.pg_proc%rowtype;
 effective_before pg_catalog.pg_proc%rowtype; effective_after pg_catalog.pg_proc%rowtype;
 current_function pg_catalog.pg_proc%rowtype; scope_kind text; expected_acl aclitem[]; expected_config text[];
 native_path boolean; definition text;
 wrapper_body constant text:=$wrapper_body_literal$BEGIN
 PERFORM public.ediel_require_contract_records_available_v1(p_company_id,p_contract_id);
 RETURN public.gridex_prepare_signature_before_record_retention_v1(p_company_id,p_customer_id,p_contract_id,p_token_hash,p_recipient_email,p_expires_at,p_actor_user_id,p_channel);
END$wrapper_body_literal$;
 before_body constant text:=$before_body_literal$
declare
  v_contract public.customer_contracts%rowtype;
  v_company public.companies%rowtype;
  v_binding jsonb;
  v_snapshot_id uuid;
  v_snapshot jsonb;
  v_base_components jsonb;
  v_price_components jsonb;
  v_pricing_model text;
  v_request public.customer_contract_signature_requests%rowtype;
  v_event jsonb;
begin
  perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.create');

  if p_company_id is null or p_customer_id is null or p_contract_id is null then
    raise exception using errcode='22023',message='signature_request_company_customer_contract_required';
  end if;
  if coalesce(p_token_hash,'') !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023',message='signature_request_token_hash_invalid';
  end if;
  if nullif(btrim(coalesce(p_recipient_email,'')),'') is null or position('@' in p_recipient_email)=0 then
    raise exception using errcode='22023',message='signature_request_recipient_email_required';
  end if;
  if p_channel not in ('internal','website','partner_api','customer_portal') then
    raise exception using errcode='22023',message='signature_request_channel_invalid';
  end if;
  if p_expires_at is null or p_expires_at <= clock_timestamp() or p_expires_at > clock_timestamp()+interval '14 days' then
    raise exception using errcode='22023',message='signature_request_expiry_invalid';
  end if;

  select * into v_company from public.companies where id=p_company_id for share;
  if not found or not coalesce(v_company.is_active,false) or coalesce(v_company.lifecycle_status,'')<>'active' or v_company.suspended_at is not null then
    raise exception using errcode='55000',message='signature_request_tenant_not_operational';
  end if;

  select * into v_contract
  from public.customer_contracts
  where id=p_contract_id and company_id=p_company_id and customer_id=p_customer_id
  for update;
  if not found then
    raise exception using errcode='P0002',message='signature_request_contract_not_found_for_tenant';
  end if;
  if v_contract.status in ('signed','active','terminated','cancelled','expired') or v_contract.signed_at is not null then
    raise exception using errcode='23514',message='signature_request_contract_already_finalized';
  end if;
  if v_contract.status not in ('draft','pending_signature','signature_failed') then
    raise exception using errcode='23514',message='signature_request_contract_state_invalid';
  end if;

  if v_contract.contract_publication_version_id is null
     or v_contract.contract_product_version_id is null
     or v_contract.price_plan_version_id is null
     or v_contract.legal_bundle_version_id is null then
    if v_contract.contract_offer_id is not null then
      perform public.gridex_ensure_internal_contract_publication(p_company_id,v_contract.contract_offer_id,p_actor_user_id);
      update public.customer_contracts
      set contract_offer_id=v_contract.contract_offer_id,updated_by=p_actor_user_id,updated_at=now()
      where id=v_contract.id and company_id=p_company_id
      returning * into v_contract;
    else
      v_binding:=public.gridex_prepare_manual_contract_binding(
        p_company_id,
        jsonb_strip_nulls(jsonb_build_object(
          'name',v_contract.contract_name,
          'customer_type',(select c.customer_type from public.customers c where c.id=v_contract.customer_id and c.company_id=p_company_id),
          'contract_type',v_contract.contract_type,
          'energy_direction',v_contract.energy_direction,
          'campaign_code',v_contract.campaign_code,
          'campaign_version',v_contract.campaign_version,
          'terms_version',v_contract.terms_version,
          'binding_months',v_contract.binding_months,
          'notice_months',v_contract.notice_months,
          'valid_from',coalesce(v_contract.starts_at::date,current_date),
          'valid_to',v_contract.ends_at::date
        )),
        coalesce(v_contract.price_snapshot,'{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
          'contract_type',v_contract.contract_type,
          'energy_direction',v_contract.energy_direction,
          'price_area',v_contract.price_area_used,
          'fixed_price_ore_per_kwh',v_contract.fixed_price_ore_per_kwh,
          'spot_markup_ore_per_kwh',v_contract.spot_markup_ore_per_kwh,
          'variable_fee_ore_per_kwh',v_contract.variable_fee_ore_per_kwh,
          'monthly_fee_sek',v_contract.monthly_fee_sek,
          'invoice_fee_sek',v_contract.invoice_fee_sek,
          'green_fee_mode',v_contract.green_fee_mode,
          'green_fee_value',v_contract.green_fee_value,
          'discount_value',v_contract.discount_value,
          'discount_unit',v_contract.discount_unit,
          'start_fee_sek',v_contract.start_fee_sek,
          'admin_fee_sek',v_contract.admin_fee_sek,
          'break_fee_sek',v_contract.break_fee_sek,
          'vat_rate',v_contract.vat_rate
        )),
        p_actor_user_id
      );
      update public.customer_contracts set
        contract_offer_id=nullif(v_binding->>'contract_offer_id','')::uuid,
        contract_product_id=nullif(v_binding->>'contract_product_id','')::uuid,
        contract_product_version_id=nullif(v_binding->>'contract_product_version_id','')::uuid,
        contract_publication_version_id=nullif(v_binding->>'contract_publication_version_id','')::uuid,
        price_plan_id=nullif(v_binding->>'price_plan_id','')::uuid,
        price_plan_version_id=nullif(v_binding->>'price_plan_version_id','')::uuid,
        price_book_id=nullif(v_binding->>'price_book_id','')::uuid,
        legal_bundle_version_id=nullif(v_binding->>'legal_bundle_version_id','')::uuid,
        offer_reference=v_binding->>'offer_reference',
        commercial_snapshot=coalesce(v_binding->'commercial_snapshot','{}'::jsonb),
        legal_snapshot=coalesce(v_binding->'legal_snapshot','{}'::jsonb),
        updated_by=p_actor_user_id,updated_at=now()
      where id=v_contract.id and company_id=p_company_id
      returning * into v_contract;
    end if;
  end if;

  if v_contract.contract_publication_version_id is null
     or v_contract.contract_product_version_id is null
     or v_contract.price_plan_version_id is null
     or v_contract.legal_bundle_version_id is null then
    raise exception using errcode='23514',message='signature_request_exact_contract_chain_missing';
  end if;

  if v_contract.contract_price_snapshot_id is null then
    select coalesce(cpv.pricing_model,'spot') into v_pricing_model
    from public.contract_product_versions cpv where cpv.id=v_contract.contract_product_version_id;
    v_base_components:=coalesce(
      v_contract.price_snapshot->'base_price_components_snapshot',
      v_contract.commercial_snapshot->'base_price_components_snapshot',
      v_contract.commercial_snapshot->'base_components',
      '[]'::jsonb
    );
    v_price_components:=coalesce(
      v_contract.price_snapshot->'price_components_snapshot',
      v_contract.commercial_snapshot->'price_components_snapshot',
      v_contract.commercial_snapshot->'price_components',
      '[]'::jsonb
    );
    if jsonb_typeof(v_base_components)<>'array' then v_base_components:='[]'::jsonb; end if;
    if jsonb_typeof(v_price_components)<>'array' then v_price_components:='[]'::jsonb; end if;
    v_snapshot:=jsonb_strip_nulls(coalesce(v_contract.price_snapshot,'{}'::jsonb) || jsonb_build_object(
      'snapshot_schema','gridex_contract_pricing_v7_signed_receipt',
      'source','signature_prepare',
      'company_id',v_contract.company_id,
      'contract_id',v_contract.id,
      'contract_number',v_contract.contract_number,
      'customer_number',v_contract.customer_number,
      'contract_type',v_contract.contract_type,
      'energy_direction',v_contract.energy_direction,
      'price_area',v_contract.price_area_used,
      'fixed_price_ore_per_kwh',v_contract.fixed_price_ore_per_kwh,
      'spot_markup_ore_per_kwh',v_contract.spot_markup_ore_per_kwh,
      'variable_fee_ore_per_kwh',v_contract.variable_fee_ore_per_kwh,
      'monthly_fee_sek',v_contract.monthly_fee_sek,
      'invoice_fee_sek',v_contract.invoice_fee_sek,
      'green_fee_mode',v_contract.green_fee_mode,
      'green_fee_value',v_contract.green_fee_value,
      'discount_value',v_contract.discount_value,
      'discount_unit',v_contract.discount_unit,
      'start_fee_sek',v_contract.start_fee_sek,
      'admin_fee_sek',v_contract.admin_fee_sek,
      'break_fee_sek',v_contract.break_fee_sek,
      'vat_rate',v_contract.vat_rate,
      'binding_months',v_contract.binding_months,
      'notice_months',v_contract.notice_months,
      'starts_at',v_contract.starts_at,
      'ends_at',v_contract.ends_at,
      'offer_reference',v_contract.offer_reference,
      'contract_publication_version_id',v_contract.contract_publication_version_id,
      'contract_product_version_id',v_contract.contract_product_version_id,
      'price_plan_version_id',v_contract.price_plan_version_id,
      'legal_bundle_version_id',v_contract.legal_bundle_version_id,
      'base_price_components_snapshot',v_base_components,
      'price_components_snapshot',v_price_components
    ));
    v_snapshot:=private.gridex_normalize_fixed_area_snapshot_v1(v_snapshot);
    insert into public.contract_price_snapshots(
      company_id,contract_id,customer_id,price_plan_version_id,pricing_model,
      base_price_components_snapshot,price_components_snapshot,snapshot_json,
      valid_from,valid_to,source,contract_number,customer_number,snapshot_hash,
      snapshot_quality,snapshot_schema_version
    ) values(
      p_company_id,v_contract.id,v_contract.customer_id,v_contract.price_plan_version_id,
      coalesce(v_pricing_model,'spot'),v_snapshot->'base_price_components_snapshot',
      coalesce(v_snapshot->'price_components_snapshot','[]'::jsonb),v_snapshot,
      coalesce(v_contract.starts_at::date,current_date),v_contract.ends_at::date,
      'signature_prepare',v_contract.contract_number,v_contract.customer_number,
      encode(extensions.digest(convert_to(v_snapshot::text,'UTF8'),'sha256'),'hex'),
      'canonical','gridex_contract_pricing_v7_signed_receipt'
    ) returning id into v_snapshot_id;
    update public.customer_contracts
    set contract_price_snapshot_id=v_snapshot_id,price_snapshot=v_snapshot,updated_by=p_actor_user_id,updated_at=now()
    where id=v_contract.id and company_id=p_company_id
    returning * into v_contract;
  end if;

  if not exists(
    select 1
    from public.contract_publication_versions cpv
    join public.contract_publications cp on cp.id=cpv.contract_publication_id
    join public.tenant_contract_assignments ta on ta.id=cp.assignment_id and ta.company_id=p_company_id
    join public.contract_product_versions ctv on ctv.id=cpv.contract_product_version_id
    join public.price_plan_versions ppv on ppv.id=cpv.price_plan_version_id
    join public.legal_bundle_versions lbv on lbv.id=cpv.legal_bundle_version_id
    join public.contract_price_snapshots cps on cps.id=v_contract.contract_price_snapshot_id and cps.contract_id=v_contract.id and cps.company_id=p_company_id
    where cpv.id=v_contract.contract_publication_version_id
      and cpv.contract_product_version_id=v_contract.contract_product_version_id
      and cpv.price_plan_version_id=v_contract.price_plan_version_id
      and cpv.legal_bundle_version_id=v_contract.legal_bundle_version_id
      and cpv.status='published' and cpv.locked_at is not null
      and ctv.status='approved' and ctv.locked_at is not null
      and ppv.status in ('published','approved','active') and ppv.locked_at is not null
      and lbv.status='published' and lbv.locked_at is not null and cardinality(lbv.unresolved_variables)=0
      and nullif(cps.snapshot_hash,'') is not null
  ) then
    raise exception using errcode='23514',message='signature_request_exact_locked_chain_invalid';
  end if;
  if not exists(select 1 from public.legal_bundle_version_documents d where d.legal_bundle_version_id=v_contract.legal_bundle_version_id) then
    raise exception using errcode='23514',message='signature_request_legal_document_set_missing';
  end if;

  if v_contract.status in ('draft','signature_failed') then
    update public.customer_contracts
    set status='pending_signature',lifecycle_stage='agreement_ready',updated_by=p_actor_user_id,updated_at=now()
    where id=v_contract.id and company_id=p_company_id
    returning * into v_contract;
  end if;

  -- Revalidate freshness after the company/contract/publication/snapshot locks.
  -- A failed recheck rolls back all preparation; no prior link is revoked.
  if p_expires_at is null or p_expires_at <= clock_timestamp() or p_expires_at > clock_timestamp()+interval '14 days' then
    raise exception using errcode='22023',message='signature_request_expiry_invalid';
  end if;

  update public.customer_contract_signature_requests
  set revoked_at=now()
  where company_id=p_company_id and customer_contract_id=p_contract_id
    and used_at is null and revoked_at is null;

  insert into public.customer_contract_signature_requests(
    company_id,customer_id,customer_contract_id,token_hash,recipient_email,
    channel,expires_at,created_by,metadata
  ) values(
    p_company_id,p_customer_id,p_contract_id,p_token_hash,lower(btrim(p_recipient_email)),
    p_channel,p_expires_at,p_actor_user_id,
    jsonb_build_object(
      'customer_full_name',(select coalesce(nullif(btrim(c.full_name),''),nullif(btrim(c.company_name),''),
        nullif(btrim(concat_ws(' ',c.first_name,c.last_name)),''))
        from public.customers c where c.id=p_customer_id and c.company_id=p_company_id),
      'contract_number',v_contract.contract_number,
      'offer_reference',v_contract.offer_reference,
      'contract_publication_version_id',v_contract.contract_publication_version_id,
      'price_plan_version_id',v_contract.price_plan_version_id,
      'legal_bundle_version_id',v_contract.legal_bundle_version_id,
      'contract_price_snapshot_id',v_contract.contract_price_snapshot_id
    )
  ) returning * into v_request;

  v_event:=public.gridex_record_customer_contract_event_v1(
    p_company_id,v_contract.id,v_contract.customer_id,'signature_requested',now(),
    'Online-signering begärd',
    jsonb_build_object('signature_request_id',v_request.id,'channel',p_channel,'expires_at',p_expires_at),
    p_actor_user_id,null,
    encode(extensions.digest(convert_to((v_request.id::text||':signature_requested'),'UTF8'),'sha256'),'hex')
  );

  return jsonb_build_object(
    'ok',true,
    'request_id',v_request.id,
    'company_id',p_company_id,
    'customer_id',v_contract.customer_id,
    'contract_id',v_contract.id,
    'contract_number',v_contract.contract_number,
    'contract_name',v_contract.contract_name,
    'status',v_contract.status,
    'recipient_email',v_request.recipient_email,
    'expires_at',v_request.expires_at,
    'channel',v_request.channel,
    'offer_reference',v_contract.offer_reference,
    'contract_publication_version_id',v_contract.contract_publication_version_id,
    'price_plan_version_id',v_contract.price_plan_version_id,
    'legal_bundle_version_id',v_contract.legal_bundle_version_id,
    'contract_price_snapshot_id',v_contract.contract_price_snapshot_id
  );
end
$before_body_literal$;
 after_body constant text:=$after_body_literal$
declare
  v_contract public.customer_contracts%rowtype;
  v_company public.companies%rowtype;
  v_binding jsonb;
  v_snapshot_id uuid;
  v_snapshot jsonb;
  v_base_components jsonb;
  v_price_components jsonb;
  v_pricing_model text;
  v_request public.customer_contract_signature_requests%rowtype;
  v_event jsonb;
begin
  perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.create');

  if p_company_id is null or p_customer_id is null or p_contract_id is null then
    raise exception using errcode='22023',message='signature_request_company_customer_contract_required';
  end if;
  if coalesce(p_token_hash,'') !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023',message='signature_request_token_hash_invalid';
  end if;
  if nullif(btrim(coalesce(p_recipient_email,'')),'') is null or position('@' in p_recipient_email)=0 then
    raise exception using errcode='22023',message='signature_request_recipient_email_required';
  end if;
  if p_channel not in ('internal','website','partner_api','customer_portal') then
    raise exception using errcode='22023',message='signature_request_channel_invalid';
  end if;
  if p_expires_at is null or p_expires_at <= clock_timestamp() or p_expires_at > clock_timestamp()+interval '14 days' then
    raise exception using errcode='22023',message='signature_request_expiry_invalid';
  end if;

  select * into v_company from public.companies where id=p_company_id for share;
  if not found or not coalesce(v_company.is_active,false) or coalesce(v_company.lifecycle_status,'')<>'active' or v_company.suspended_at is not null then
    raise exception using errcode='55000',message='signature_request_tenant_not_operational';
  end if;

  select * into v_contract
  from public.customer_contracts
  where id=p_contract_id and company_id=p_company_id and customer_id=p_customer_id
  for update;
  if not found then
    raise exception using errcode='P0002',message='signature_request_contract_not_found_for_tenant';
  end if;
  if v_contract.status in ('signed','active','terminated','cancelled','expired') or v_contract.signed_at is not null then
    raise exception using errcode='23514',message='signature_request_contract_already_finalized';
  end if;
  if v_contract.status not in ('draft','pending_signature','signature_failed') then
    raise exception using errcode='23514',message='signature_request_contract_state_invalid';
  end if;

  if v_contract.contract_publication_version_id is null
     or v_contract.contract_product_version_id is null
     or v_contract.price_plan_version_id is null
     or v_contract.legal_bundle_version_id is null then
    if v_contract.contract_offer_id is not null then
      perform public.gridex_ensure_internal_contract_publication(p_company_id,v_contract.contract_offer_id,p_actor_user_id);
      update public.customer_contracts
      set contract_offer_id=v_contract.contract_offer_id,updated_by=p_actor_user_id,updated_at=now()
      where id=v_contract.id and company_id=p_company_id
      returning * into v_contract;
    else
      v_binding:=public.gridex_prepare_manual_contract_binding(
        p_company_id,
        jsonb_strip_nulls(jsonb_build_object(
          'name',v_contract.contract_name,
          'customer_type',(select c.customer_type from public.customers c where c.id=v_contract.customer_id and c.company_id=p_company_id),
          'contract_type',v_contract.contract_type,
          'energy_direction',v_contract.energy_direction,
          'campaign_code',v_contract.campaign_code,
          'campaign_version',v_contract.campaign_version,
          'terms_version',v_contract.terms_version,
          'binding_months',v_contract.binding_months,
          'notice_months',v_contract.notice_months,
          'valid_from',coalesce(v_contract.starts_at::date,current_date),
          'valid_to',v_contract.ends_at::date
        )),
        coalesce(v_contract.price_snapshot,'{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
          'contract_type',v_contract.contract_type,
          'energy_direction',v_contract.energy_direction,
          'price_area',v_contract.price_area_used,
          'fixed_price_ore_per_kwh',v_contract.fixed_price_ore_per_kwh,
          'spot_markup_ore_per_kwh',v_contract.spot_markup_ore_per_kwh,
          'variable_fee_ore_per_kwh',v_contract.variable_fee_ore_per_kwh,
          'monthly_fee_sek',v_contract.monthly_fee_sek,
          'invoice_fee_sek',v_contract.invoice_fee_sek,
          'green_fee_mode',v_contract.green_fee_mode,
          'green_fee_value',v_contract.green_fee_value,
          'discount_value',v_contract.discount_value,
          'discount_unit',v_contract.discount_unit,
          'start_fee_sek',v_contract.start_fee_sek,
          'admin_fee_sek',v_contract.admin_fee_sek,
          'break_fee_sek',v_contract.break_fee_sek,
          'vat_rate',v_contract.vat_rate
        )),
        p_actor_user_id
      );
      update public.customer_contracts set
        contract_offer_id=nullif(v_binding->>'contract_offer_id','')::uuid,
        contract_product_id=nullif(v_binding->>'contract_product_id','')::uuid,
        contract_product_version_id=nullif(v_binding->>'contract_product_version_id','')::uuid,
        contract_publication_version_id=nullif(v_binding->>'contract_publication_version_id','')::uuid,
        price_plan_id=nullif(v_binding->>'price_plan_id','')::uuid,
        price_plan_version_id=nullif(v_binding->>'price_plan_version_id','')::uuid,
        price_book_id=nullif(v_binding->>'price_book_id','')::uuid,
        legal_bundle_version_id=nullif(v_binding->>'legal_bundle_version_id','')::uuid,
        offer_reference=v_binding->>'offer_reference',
        commercial_snapshot=coalesce(v_binding->'commercial_snapshot','{}'::jsonb),
        legal_snapshot=coalesce(v_binding->'legal_snapshot','{}'::jsonb),
        updated_by=p_actor_user_id,updated_at=now()
      where id=v_contract.id and company_id=p_company_id
      returning * into v_contract;
    end if;
  end if;

  if v_contract.contract_publication_version_id is null
     or v_contract.contract_product_version_id is null
     or v_contract.price_plan_version_id is null
     or v_contract.legal_bundle_version_id is null then
    raise exception using errcode='23514',message='signature_request_exact_contract_chain_missing';
  end if;

  if v_contract.contract_price_snapshot_id is null then
    select coalesce(cpv.pricing_model,'spot') into v_pricing_model
    from public.contract_product_versions cpv where cpv.id=v_contract.contract_product_version_id;
    v_base_components:=coalesce(
      v_contract.price_snapshot->'base_price_components_snapshot',
      v_contract.commercial_snapshot->'base_price_components_snapshot',
      v_contract.commercial_snapshot->'base_components',
      '[]'::jsonb
    );
    v_price_components:=coalesce(
      v_contract.price_snapshot->'price_components_snapshot',
      v_contract.commercial_snapshot->'price_components_snapshot',
      v_contract.commercial_snapshot->'price_components',
      '[]'::jsonb
    );
    if jsonb_typeof(v_base_components)<>'array' then v_base_components:='[]'::jsonb; end if;
    if jsonb_typeof(v_price_components)<>'array' then v_price_components:='[]'::jsonb; end if;
    v_snapshot:=jsonb_strip_nulls(coalesce(v_contract.price_snapshot,'{}'::jsonb) || jsonb_build_object(
      'snapshot_schema','gridex_contract_pricing_v7_signed_receipt',
      'source','signature_prepare',
      'company_id',v_contract.company_id,
      'contract_id',v_contract.id,
      'contract_number',v_contract.contract_number,
      'customer_number',v_contract.customer_number,
      'contract_type',v_contract.contract_type,
      'energy_direction',v_contract.energy_direction,
      'price_area',v_contract.price_area_used,
      'fixed_price_ore_per_kwh',v_contract.fixed_price_ore_per_kwh,
      'spot_markup_ore_per_kwh',v_contract.spot_markup_ore_per_kwh,
      'variable_fee_ore_per_kwh',v_contract.variable_fee_ore_per_kwh,
      'monthly_fee_sek',v_contract.monthly_fee_sek,
      'invoice_fee_sek',v_contract.invoice_fee_sek,
      'green_fee_mode',v_contract.green_fee_mode,
      'green_fee_value',v_contract.green_fee_value,
      'discount_value',v_contract.discount_value,
      'discount_unit',v_contract.discount_unit,
      'start_fee_sek',v_contract.start_fee_sek,
      'admin_fee_sek',v_contract.admin_fee_sek,
      'break_fee_sek',v_contract.break_fee_sek,
      'vat_rate',v_contract.vat_rate,
      'binding_months',v_contract.binding_months,
      'notice_months',v_contract.notice_months,
      'starts_at',v_contract.starts_at,
      'ends_at',v_contract.ends_at,
      'offer_reference',v_contract.offer_reference,
      'contract_publication_version_id',v_contract.contract_publication_version_id,
      'contract_product_version_id',v_contract.contract_product_version_id,
      'price_plan_version_id',v_contract.price_plan_version_id,
      'legal_bundle_version_id',v_contract.legal_bundle_version_id,
      'base_price_components_snapshot',v_base_components,
      'price_components_snapshot',v_price_components
    ));
    v_snapshot:=private.gridex_normalize_fixed_area_snapshot_v1(v_snapshot);
    insert into public.contract_price_snapshots(
      company_id,contract_id,customer_id,price_plan_version_id,pricing_model,
      base_price_components_snapshot,price_components_snapshot,snapshot_json,
      valid_from,valid_to,source,contract_number,customer_number,snapshot_hash,
      snapshot_quality,snapshot_schema_version
    ) values(
      p_company_id,v_contract.id,v_contract.customer_id,v_contract.price_plan_version_id,
      coalesce(v_pricing_model,'spot'),v_snapshot->'base_price_components_snapshot',
      coalesce(v_snapshot->'price_components_snapshot','[]'::jsonb),v_snapshot,
      coalesce(v_contract.starts_at::date,current_date),v_contract.ends_at::date,
      'signature_prepare',v_contract.contract_number,v_contract.customer_number,
      encode(extensions.digest(convert_to(v_snapshot::text,'UTF8'),'sha256'),'hex'),
      'canonical','gridex_contract_pricing_v7_signed_receipt'
    ) returning id into v_snapshot_id;
    update public.customer_contracts
    set contract_price_snapshot_id=v_snapshot_id,price_snapshot=v_snapshot,updated_by=p_actor_user_id,updated_at=now()
    where id=v_contract.id and company_id=p_company_id
    returning * into v_contract;
  end if;

  if not exists(
    select 1
    from public.contract_publication_versions cpv
    join public.contract_publications cp on cp.id=cpv.contract_publication_id
    join public.tenant_contract_assignments ta on ta.id=cp.assignment_id and ta.company_id=p_company_id
    join public.contract_product_versions ctv on ctv.id=cpv.contract_product_version_id
    join public.price_plan_versions ppv on ppv.id=cpv.price_plan_version_id
    join public.legal_bundle_versions lbv on lbv.id=cpv.legal_bundle_version_id
    join public.contract_price_snapshots cps on cps.id=v_contract.contract_price_snapshot_id and cps.contract_id=v_contract.id and cps.company_id=p_company_id
    where cpv.id=v_contract.contract_publication_version_id
      and cpv.contract_product_version_id=v_contract.contract_product_version_id
      and cpv.price_plan_version_id=v_contract.price_plan_version_id
      and cpv.legal_bundle_version_id=v_contract.legal_bundle_version_id
      and cpv.status='published' and cpv.locked_at is not null
      and ctv.status='approved' and ctv.locked_at is not null
      and ppv.status in ('published','approved','active') and ppv.locked_at is not null
      and lbv.status='published' and lbv.locked_at is not null and cardinality(lbv.unresolved_variables)=0
      and nullif(cps.snapshot_hash,'') is not null
  ) then
    raise exception using errcode='23514',message='signature_request_exact_locked_chain_invalid';
  end if;
  if not exists(select 1 from public.legal_bundle_version_documents d where d.legal_bundle_version_id=v_contract.legal_bundle_version_id) then
    raise exception using errcode='23514',message='signature_request_legal_document_set_missing';
  end if;

  if v_contract.status in ('draft','signature_failed') then
    update public.customer_contracts
    set status='pending_signature',lifecycle_stage='agreement_ready',updated_by=p_actor_user_id,updated_at=now()
    where id=v_contract.id and company_id=p_company_id
    returning * into v_contract;
  end if;

  -- Wait for current pending request writers before checking wall-clock expiry.
  -- The contract lock serializes preparation; mark-sent locks these rows directly.
  perform id
  from public.customer_contract_signature_requests
  where company_id=p_company_id and customer_contract_id=p_contract_id
    and used_at is null and revoked_at is null
  order by id for update;

  -- Revalidate freshness after the company/contract/publication/snapshot locks.
  -- A failed recheck rolls back all preparation; no prior link is revoked.
  if p_expires_at is null or p_expires_at <= clock_timestamp() or p_expires_at > clock_timestamp()+interval '14 days' then
    raise exception using errcode='22023',message='signature_request_expiry_invalid';
  end if;

  update public.customer_contract_signature_requests
  set revoked_at=now()
  where company_id=p_company_id and customer_contract_id=p_contract_id
    and used_at is null and revoked_at is null;

  insert into public.customer_contract_signature_requests(
    company_id,customer_id,customer_contract_id,token_hash,recipient_email,
    channel,expires_at,created_by,metadata
  ) values(
    p_company_id,p_customer_id,p_contract_id,p_token_hash,lower(btrim(p_recipient_email)),
    p_channel,p_expires_at,p_actor_user_id,
    jsonb_build_object(
      'customer_full_name',(select coalesce(nullif(btrim(c.full_name),''),nullif(btrim(c.company_name),''),
        nullif(btrim(concat_ws(' ',c.first_name,c.last_name)),''))
        from public.customers c where c.id=p_customer_id and c.company_id=p_company_id),
      'contract_number',v_contract.contract_number,
      'offer_reference',v_contract.offer_reference,
      'contract_publication_version_id',v_contract.contract_publication_version_id,
      'price_plan_version_id',v_contract.price_plan_version_id,
      'legal_bundle_version_id',v_contract.legal_bundle_version_id,
      'contract_price_snapshot_id',v_contract.contract_price_snapshot_id
    )
  ) returning * into v_request;

  v_event:=public.gridex_record_customer_contract_event_v1(
    p_company_id,v_contract.id,v_contract.customer_id,'signature_requested',now(),
    'Online-signering begärd',
    jsonb_build_object('signature_request_id',v_request.id,'channel',p_channel,'expires_at',p_expires_at),
    p_actor_user_id,null,
    encode(extensions.digest(convert_to((v_request.id::text||':signature_requested'),'UTF8'),'sha256'),'hex')
  );

  return jsonb_build_object(
    'ok',true,
    'request_id',v_request.id,
    'company_id',p_company_id,
    'customer_id',v_contract.customer_id,
    'contract_id',v_contract.id,
    'contract_number',v_contract.contract_number,
    'contract_name',v_contract.contract_name,
    'status',v_contract.status,
    'recipient_email',v_request.recipient_email,
    'expires_at',v_request.expires_at,
    'channel',v_request.channel,
    'offer_reference',v_contract.offer_reference,
    'contract_publication_version_id',v_contract.contract_publication_version_id,
    'price_plan_version_id',v_contract.price_plan_version_id,
    'legal_bundle_version_id',v_contract.legal_bundle_version_id,
    'contract_price_snapshot_id',v_contract.contract_price_snapshot_id
  );
end
$after_body_literal$;
 anchor constant text:=$anchor_literal$  -- Revalidate freshness after the company/contract/publication/snapshot locks.
$anchor_literal$;
 addition constant text:=$addition_literal$  -- Wait for current pending request writers before checking wall-clock expiry.
  -- The contract lock serializes preparation; mark-sent locks these rows directly.
  perform id
  from public.customer_contract_signature_requests
  where company_id=p_company_id and customer_contract_id=p_contract_id
    and used_at is null and revoked_at is null
  order by id for update;

$addition_literal$;
BEGIN
 SELECT * INTO STRICT public_before FROM pg_catalog.pg_proc WHERE oid=public_target;
 IF md5(wrapper_body)<>'1496a94629cf9f43d9fbd5d7d0f3f8e5'
 OR md5(before_body)<>'8bd61eb144c72df71c050350a6ed0e57'
 OR encode(sha256(convert_to(before_body,'UTF8')),'hex')<>'ebb75e6ccc22be4daabd5e9979f75c58c76464193fc97e3ca17732ea2ca965ef'
 OR md5(after_body)<>'cee1222f070383e440a9fd4f71cdf591'
 OR encode(sha256(convert_to(after_body,'UTF8')),'hex')<>'5d4607c3e181b97856cc8e8ddcce13adc27234baf76f3f8a418fe03be58dbbb7'
 OR replace(before_body,anchor,addition||anchor) IS DISTINCT FROM after_body
 THEN RAISE EXCEPTION 'signing_prepare_source_literal_changed'; END IF;
 IF public_before.prosrc=wrapper_body AND md5(public_before.prosrc)='1496a94629cf9f43d9fbd5d7d0f3f8e5' THEN
  native_path:=false;
  effective_target:=to_regprocedure('public.gridex_prepare_signature_before_record_retention_v1(uuid,uuid,uuid,text,text,timestamptz,uuid,text)');
 ELSE
  native_path:=true; effective_target:=public_target;
  definition:=pg_get_functiondef(public_target);
  IF md5(definition) NOT IN('7cae537fc5619cf82cbfcca78a2b5344','0e6cbec5c3c542330d33e88be75ed060')
  OR NOT((public_before.prosrc=before_body AND md5(public_before.prosrc)='8bd61eb144c72df71c050350a6ed0e57')
   OR(public_before.prosrc=after_body AND md5(public_before.prosrc)='cee1222f070383e440a9fd4f71cdf591'))
  THEN RAISE EXCEPTION 'signing_prepare_unknown_native_pair'; END IF;
 END IF;
 SELECT * INTO STRICT effective_before FROM pg_catalog.pg_proc WHERE oid=effective_target;
 IF NOT((effective_before.prosrc=before_body AND md5(effective_before.prosrc)='8bd61eb144c72df71c050350a6ed0e57')
  OR(effective_before.prosrc=after_body AND md5(effective_before.prosrc)='cee1222f070383e440a9fd4f71cdf591'))
 THEN RAISE EXCEPTION 'signing_prepare_unknown_effective_pair'; END IF;
 FOREACH scope_kind IN ARRAY ARRAY['public','effective']::text[] LOOP
  IF scope_kind='public' THEN
   current_function:=public_before;
   expected_acl:=ARRAY['postgres=X/postgres','service_role=X/postgres']::aclitem[];
   expected_config:=CASE WHEN native_path THEN ARRAY['search_path=public, private, extensions, pg_temp']::text[] ELSE ARRAY['search_path=pg_catalog']::text[] END;
  ELSE
   current_function:=effective_before;
   expected_acl:=CASE WHEN native_path THEN ARRAY['postgres=X/postgres','service_role=X/postgres']::aclitem[] ELSE ARRAY['postgres=X/postgres']::aclitem[] END;
   expected_config:=ARRAY['search_path=public, private, extensions, pg_temp']::text[];
  END IF;
  IF pg_get_userbyid(current_function.proowner) IS DISTINCT FROM 'postgres'
  OR current_function.pronamespace IS DISTINCT FROM 'public'::regnamespace OR current_function.prokind IS DISTINCT FROM 'f'::"char"
  OR current_function.proacl IS DISTINCT FROM expected_acl
  OR current_function.proargtypes IS DISTINCT FROM ARRAY['uuid'::regtype::oid,'uuid'::regtype::oid,'uuid'::regtype::oid,'text'::regtype::oid,'text'::regtype::oid,'timestamptz'::regtype::oid,'uuid'::regtype::oid,'text'::regtype::oid]::oidvector
  OR current_function.pronargs IS DISTINCT FROM 8::smallint OR current_function.proallargtypes IS NOT NULL OR current_function.proargmodes IS NOT NULL
  OR current_function.proargnames IS DISTINCT FROM ARRAY['p_company_id','p_customer_id','p_contract_id','p_token_hash','p_recipient_email','p_expires_at','p_actor_user_id','p_channel']::text[]
  OR current_function.prorettype IS DISTINCT FROM 'jsonb'::regtype OR current_function.proretset
  OR current_function.pronargdefaults IS DISTINCT FROM 1::smallint OR pg_get_expr(current_function.proargdefaults,0) IS DISTINCT FROM $default_literal$'internal'::text$default_literal$
  OR NOT current_function.prosecdef OR current_function.proisstrict OR current_function.proleakproof
  OR current_function.provolatile IS DISTINCT FROM 'v'::"char" OR current_function.proparallel IS DISTINCT FROM 'u'::"char"
  OR current_function.proconfig IS DISTINCT FROM expected_config
  OR(SELECT lanname FROM pg_language WHERE oid=current_function.prolang) IS DISTINCT FROM 'plpgsql'
  OR current_function.procost IS DISTINCT FROM 100::real OR current_function.prorows IS DISTINCT FROM 0::real
  OR current_function.provariadic IS DISTINCT FROM 0::oid OR current_function.prosupport IS DISTINCT FROM 0::oid
  OR current_function.protrftypes IS NOT NULL OR current_function.probin IS NOT NULL OR current_function.prosqlbody IS NOT NULL
  THEN RAISE EXCEPTION 'signing_prepare_unknown_full_metadata: %',scope_kind; END IF;
 END LOOP;
 IF effective_before.prosrc=before_body THEN
  definition:=pg_get_functiondef(effective_target);
  IF(length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1
  OR strpos(definition,before_body)=0 THEN RAISE EXCEPTION 'signing_prepare_source_anchor_invalid'; END IF;
  definition:=replace(definition,before_body,after_body);
  IF native_path AND md5(definition)<>'0e6cbec5c3c542330d33e88be75ed060' THEN RAISE EXCEPTION 'signing_prepare_native_transformation_unknown'; END IF;
  EXECUTE definition;
 END IF;
 SELECT * INTO STRICT effective_after FROM pg_catalog.pg_proc WHERE oid=effective_target;
 SELECT * INTO STRICT public_after FROM pg_catalog.pg_proc WHERE oid=public_target;
 IF(to_jsonb(effective_after)-'prosrc') IS DISTINCT FROM(to_jsonb(effective_before)-'prosrc')
 OR effective_after.prosrc IS DISTINCT FROM after_body OR md5(effective_after.prosrc)<>'cee1222f070383e440a9fd4f71cdf591'
 THEN RAISE EXCEPTION 'signing_prepare_effective_full_preservation_required'; END IF;
 IF native_path THEN
  IF md5(pg_get_functiondef(public_target))<>'0e6cbec5c3c542330d33e88be75ed060' THEN RAISE EXCEPTION 'signing_prepare_native_full_definition_required'; END IF;
 ELSE
  IF to_jsonb(public_after) IS DISTINCT FROM to_jsonb(public_before) THEN RAISE EXCEPTION 'signing_prepare_retention_wrapper_changed'; END IF;
 END IF;
END $signing_prepare_canonical_postlock$;
COMMIT;
