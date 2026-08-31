-- Canonicalize admin imports of already-signed agreements.
-- Never insert customer_contracts directly as signed/active. The contract is
-- first created in a mutable pre-signature state, then the uploaded PDF is
-- verified and converted into immutable contract/signature evidence.

create or replace function public.canonical_onboard_customer_graph(p_command jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_command jsonb := coalesce(p_command, '{}'::jsonb);
  v_status text;
  v_has_signed_document boolean;
  v_has_catalog_offer boolean;
begin
  if v_command->>'channel' = 'admin' and jsonb_typeof(v_command->'contract') = 'object' then
    v_status := nullif(v_command#>>'{contract,status}', '');
    v_has_signed_document := coalesce((v_command#>>'{legal,acceptance_snapshot,signedAgreementUploaded}')::boolean, false);
    v_has_catalog_offer := nullif(v_command#>>'{contract,contract_offer_id}', '') is not null;

    -- A real signed document must be imported as evidence after the base graph
    -- exists. Direct signed/active INSERT is deliberately forbidden by the
    -- customer_contract state machine.
    if v_has_signed_document and v_status in ('signed', 'active') then
      v_command := jsonb_set(
        v_command,
        '{contract,status}',
        to_jsonb(case when v_has_catalog_offer then 'pending_signature' else 'draft' end),
        true
      );
      v_command := jsonb_set(v_command, '{contract,signed_at}', 'null'::jsonb, true);
    elsif not v_has_catalog_offer and v_status = 'pending_signature' then
      -- One-off/manual contracts need their exact canonical publication chain
      -- materialized before they can enter pending_signature.
      v_command := jsonb_set(v_command, '{contract,status}', '"draft"'::jsonb, true);
      v_command := jsonb_set(v_command, '{contract,signed_at}', 'null'::jsonb, true);
    end if;
  end if;

  return public.gridex_onboard_customer_graph(v_command);
end
$function$;

create or replace function public.gridex_finalize_admin_imported_signed_agreement_v1()
returns trigger
language plpgsql
security definer
set search_path = public, private, extensions, pg_catalog, pg_temp
as $function$
declare
  v_contract public.customer_contracts%rowtype;
  v_customer public.customers%rowtype;
  v_price public.contract_price_snapshots%rowtype;
  v_binding jsonb;
  v_snapshot jsonb;
  v_base_components jsonb;
  v_price_components jsonb;
  v_pricing_model text;
  v_snapshot_id uuid;
  v_contract_document_id uuid;
  v_accepted_at timestamptz;
  v_legal_versions jsonb;
  v_signature jsonb;
  v_signature_hash text;
  v_acceptance jsonb;
  v_acceptance_hash text;
  v_event jsonb;
begin
  if new.document_type <> 'complete_agreement'
     or new.status <> 'active'
     or coalesce(new.metadata->>'source', '') <> 'customer_intake'
     or coalesce(new.metadata->>'documentRole', '') <> 'signed_agreement' then
    return new;
  end if;

  if new.company_id is null
     or new.customer_id is null
     or new.customer_contract_id is null then
    raise exception using
      errcode = '23514',
      message = 'admin_signed_contract_import_identity_incomplete';
  end if;
  if new.created_by is null then
    raise exception using
      errcode = '23514',
      message = 'admin_signed_contract_import_actor_required';
  end if;
  perform public.gridex_assert_contract_permission(new.created_by, 'contracts.create');

  if nullif(btrim(coalesce(new.storage_bucket, '')), '') is null
     or nullif(btrim(coalesce(new.file_path, '')), '') is null
     or coalesce(new.file_checksum, '') !~ '^[0-9a-f]{64}$' then
    raise exception using
      errcode = '23514',
      message = 'admin_signed_contract_import_document_evidence_incomplete';
  end if;
  if lower(coalesce(new.mime_type, '')) <> 'application/pdf'
     and lower(new.file_path) not like '%.pdf' then
    raise exception using
      errcode = '23514',
      message = 'admin_signed_contract_import_pdf_required';
  end if;

  select * into v_contract
  from public.customer_contracts
  where id = new.customer_contract_id
    and company_id = new.company_id
    and customer_id = new.customer_id
  for update;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'admin_signed_contract_import_contract_not_found_for_tenant';
  end if;

  if v_contract.status in ('signed', 'active', 'terminated', 'cancelled', 'expired')
     or v_contract.signed_at is not null then
    if v_contract.document_sha256 = new.file_checksum
       and exists (
         select 1
         from public.customer_contract_documents d
         where d.company_id = new.company_id
           and d.customer_contract_id = new.customer_contract_id
           and d.document_type = 'signed_contract_pdf'
           and d.document_sha256 = new.file_checksum
           and d.verified_at is not null
       ) then
      return new;
    end if;
    raise exception using
      errcode = '23514',
      message = 'admin_signed_contract_import_contract_already_finalized';
  end if;

  if v_contract.status not in ('draft', 'pending_signature', 'signature_failed') then
    raise exception using
      errcode = '23514',
      message = 'admin_signed_contract_import_state_invalid';
  end if;

  -- Materialize the exact canonical contract publication chain before any
  -- signature evidence is recorded. Catalog offers reuse their locked internal
  -- publication; one-off contracts create a dedicated immutable publication.
  if v_contract.contract_publication_version_id is null
     or v_contract.contract_product_version_id is null
     or v_contract.price_plan_version_id is null
     or v_contract.legal_bundle_version_id is null then
    if v_contract.contract_offer_id is not null then
      perform public.gridex_ensure_internal_contract_publication(
        v_contract.company_id,
        v_contract.contract_offer_id,
        new.created_by
      );
      update public.customer_contracts
      set contract_offer_id = v_contract.contract_offer_id,
          updated_by = new.created_by,
          updated_at = now()
      where id = v_contract.id and company_id = v_contract.company_id
      returning * into v_contract;
    else
      v_binding := public.gridex_prepare_manual_contract_binding(
        v_contract.company_id,
        jsonb_strip_nulls(jsonb_build_object(
          'name', v_contract.contract_name,
          'customer_type', (
            select c.customer_type
            from public.customers c
            where c.id = v_contract.customer_id
              and c.company_id = v_contract.company_id
          ),
          'contract_type', v_contract.contract_type,
          'energy_direction', v_contract.energy_direction,
          'campaign_code', v_contract.campaign_code,
          'campaign_version', v_contract.campaign_version,
          'terms_version', v_contract.terms_version,
          'binding_months', v_contract.binding_months,
          'notice_months', v_contract.notice_months,
          'valid_from', coalesce(v_contract.starts_at::date, current_date),
          'valid_to', v_contract.ends_at::date
        )),
        coalesce(v_contract.price_snapshot, '{}'::jsonb) ||
        jsonb_strip_nulls(jsonb_build_object(
          'contract_type', v_contract.contract_type,
          'energy_direction', v_contract.energy_direction,
          'price_area', v_contract.price_area_used,
          'fixed_price_ore_per_kwh', v_contract.fixed_price_ore_per_kwh,
          'spot_markup_ore_per_kwh', v_contract.spot_markup_ore_per_kwh,
          'variable_fee_ore_per_kwh', v_contract.variable_fee_ore_per_kwh,
          'monthly_fee_sek', v_contract.monthly_fee_sek,
          'invoice_fee_sek', v_contract.invoice_fee_sek,
          'green_fee_mode', v_contract.green_fee_mode,
          'green_fee_value', v_contract.green_fee_value,
          'discount_value', v_contract.discount_value,
          'discount_unit', v_contract.discount_unit,
          'start_fee_sek', v_contract.start_fee_sek,
          'admin_fee_sek', v_contract.admin_fee_sek,
          'break_fee_sek', v_contract.break_fee_sek,
          'vat_rate', v_contract.vat_rate
        )),
        new.created_by
      );

      update public.customer_contracts
      set contract_offer_id = nullif(v_binding->>'contract_offer_id', '')::uuid,
          contract_product_id = nullif(v_binding->>'contract_product_id', '')::uuid,
          contract_product_version_id = nullif(v_binding->>'contract_product_version_id', '')::uuid,
          contract_publication_version_id = nullif(v_binding->>'contract_publication_version_id', '')::uuid,
          price_plan_id = nullif(v_binding->>'price_plan_id', '')::uuid,
          price_plan_version_id = nullif(v_binding->>'price_plan_version_id', '')::uuid,
          price_book_id = nullif(v_binding->>'price_book_id', '')::uuid,
          legal_bundle_version_id = nullif(v_binding->>'legal_bundle_version_id', '')::uuid,
          offer_reference = v_binding->>'offer_reference',
          commercial_snapshot = coalesce(v_binding->'commercial_snapshot', '{}'::jsonb),
          legal_snapshot = coalesce(v_binding->'legal_snapshot', '{}'::jsonb),
          updated_by = new.created_by,
          updated_at = now()
      where id = v_contract.id and company_id = v_contract.company_id
      returning * into v_contract;
    end if;
  end if;

  if v_contract.contract_publication_version_id is null
     or v_contract.contract_product_version_id is null
     or v_contract.price_plan_version_id is null
     or v_contract.legal_bundle_version_id is null
     or coalesce(v_contract.commercial_snapshot, '{}'::jsonb) = '{}'::jsonb
     or coalesce(v_contract.legal_snapshot, '{}'::jsonb) = '{}'::jsonb then
    raise exception using
      errcode = '23514',
      message = 'admin_signed_contract_import_exact_contract_chain_missing';
  end if;

  if not exists (
    select 1
    from public.contract_publication_versions cpv
    join public.contract_publications cp
      on cp.id = cpv.contract_publication_id
    join public.tenant_contract_assignments ta
      on ta.id = cp.assignment_id
     and ta.company_id = v_contract.company_id
    join public.contract_product_versions ctv
      on ctv.id = cpv.contract_product_version_id
    join public.price_plan_versions ppv
      on ppv.id = cpv.price_plan_version_id
    join public.legal_bundle_versions lbv
      on lbv.id = cpv.legal_bundle_version_id
    where cpv.id = v_contract.contract_publication_version_id
      and cpv.contract_product_version_id = v_contract.contract_product_version_id
      and cpv.price_plan_version_id = v_contract.price_plan_version_id
      and cpv.legal_bundle_version_id = v_contract.legal_bundle_version_id
      and cpv.status = 'published'
      and cpv.locked_at is not null
      and ctv.status = 'approved'
      and ctv.locked_at is not null
      and ppv.status in ('published', 'approved', 'active')
      and ppv.locked_at is not null
      and lbv.status = 'published'
      and lbv.locked_at is not null
      and cardinality(lbv.unresolved_variables) = 0
  ) then
    raise exception using
      errcode = '23514',
      message = 'admin_signed_contract_import_versions_not_locked';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'legal_bundle_version_document_id', d.id,
    'module_key', d.module_key,
    'title', d.title,
    'legal_document_version', coalesce(d.template_version, left(d.content_sha256, 12)),
    'document_sha256', d.content_sha256,
    'body_sha256', d.content_sha256
  ) order by d.sort_order, d.id), '[]'::jsonb)
  into v_legal_versions
  from public.legal_bundle_version_documents d
  where d.legal_bundle_version_id = v_contract.legal_bundle_version_id;
  if jsonb_array_length(v_legal_versions) = 0 then
    raise exception using
      errcode = '23514',
      message = 'admin_signed_contract_import_legal_document_set_missing';
  end if;

  -- Create a fresh canonical receipt snapshot bound to the exact versions and
  -- the signed document. The thin intake snapshot remains immutable history but
  -- is not used as the signed contract's authoritative pricing receipt.
  select coalesce(cpv.pricing_model, 'spot') into v_pricing_model
  from public.contract_product_versions cpv
  where cpv.id = v_contract.contract_product_version_id;

  v_base_components := coalesce(
    v_contract.commercial_snapshot->'base_price_components_snapshot',
    v_contract.commercial_snapshot->'base_components',
    v_contract.price_snapshot->'base_price_components_snapshot',
    '[]'::jsonb
  );
  v_price_components := coalesce(
    v_contract.commercial_snapshot->'price_components_snapshot',
    v_contract.commercial_snapshot->'price_components',
    v_contract.price_snapshot->'price_components_snapshot',
    '[]'::jsonb
  );
  if jsonb_typeof(v_base_components) <> 'array' then v_base_components := '[]'::jsonb; end if;
  if jsonb_typeof(v_price_components) <> 'array' then v_price_components := '[]'::jsonb; end if;

  v_snapshot := jsonb_strip_nulls(
    coalesce(v_contract.commercial_snapshot, '{}'::jsonb)
    || coalesce(v_contract.price_snapshot, '{}'::jsonb)
    || jsonb_build_object(
      'snapshot_schema', 'gridex_contract_pricing_v7_signed_receipt',
      'schema_version', 'gridex_contract_pricing_v7_signed_receipt',
      'source', 'admin_signed_document_import',
      'company_id', v_contract.company_id,
      'customer_id', v_contract.customer_id,
      'contract_id', v_contract.id,
      'contract_number', v_contract.contract_number,
      'customer_number', v_contract.customer_number,
      'contract_type', v_contract.contract_type,
      'energy_direction', v_contract.energy_direction,
      'price_area', v_contract.price_area_used,
      'fixed_price_ore_per_kwh', v_contract.fixed_price_ore_per_kwh,
      'spot_markup_ore_per_kwh', v_contract.spot_markup_ore_per_kwh,
      'variable_fee_ore_per_kwh', v_contract.variable_fee_ore_per_kwh,
      'monthly_fee_sek', v_contract.monthly_fee_sek,
      'invoice_fee_sek', v_contract.invoice_fee_sek,
      'green_fee_mode', v_contract.green_fee_mode,
      'green_fee_value', v_contract.green_fee_value,
      'discount_value', v_contract.discount_value,
      'discount_unit', v_contract.discount_unit,
      'start_fee_sek', v_contract.start_fee_sek,
      'admin_fee_sek', v_contract.admin_fee_sek,
      'break_fee_sek', v_contract.break_fee_sek,
      'vat_rate', v_contract.vat_rate,
      'binding_months', v_contract.binding_months,
      'notice_months', v_contract.notice_months,
      'starts_at', v_contract.starts_at,
      'ends_at', v_contract.ends_at,
      'offer_reference', v_contract.offer_reference,
      'contract_publication_version_id', v_contract.contract_publication_version_id,
      'contract_product_version_id', v_contract.contract_product_version_id,
      'price_plan_id', v_contract.price_plan_id,
      'price_plan_version_id', v_contract.price_plan_version_id,
      'price_book_id', v_contract.price_book_id,
      'legal_bundle_version_id', v_contract.legal_bundle_version_id,
      'signed_document_sha256', new.file_checksum,
      'base_price_components_snapshot', v_base_components,
      'price_components_snapshot', v_price_components
    )
  );
  v_snapshot := private.gridex_normalize_fixed_area_snapshot_v1(v_snapshot);

  insert into public.contract_price_snapshots(
    company_id,
    contract_id,
    customer_id,
    price_plan_id,
    price_plan_version_id,
    price_book_id,
    pricing_model,
    base_price_components_snapshot,
    price_components_snapshot,
    snapshot_json,
    valid_from,
    valid_to,
    source,
    contract_number,
    customer_number,
    snapshot_hash,
    snapshot_quality,
    snapshot_schema_version
  ) values (
    v_contract.company_id,
    v_contract.id,
    v_contract.customer_id,
    v_contract.price_plan_id,
    v_contract.price_plan_version_id,
    v_contract.price_book_id,
    coalesce(v_pricing_model, 'spot'),
    coalesce(v_snapshot->'base_price_components_snapshot', '[]'::jsonb),
    coalesce(v_snapshot->'price_components_snapshot', '[]'::jsonb),
    v_snapshot,
    coalesce(v_contract.starts_at::date, current_date),
    v_contract.ends_at::date,
    'admin_signed_document_import',
    v_contract.contract_number,
    v_contract.customer_number,
    encode(extensions.digest(convert_to(v_snapshot::text, 'UTF8'), 'sha256'), 'hex'),
    'canonical',
    'gridex_contract_pricing_v7_signed_receipt'
  ) returning * into v_price;
  v_snapshot_id := v_price.id;

  update public.customer_contracts
  set contract_price_snapshot_id = v_snapshot_id,
      price_snapshot = v_snapshot,
      updated_by = new.created_by,
      updated_at = now()
  where id = v_contract.id and company_id = v_contract.company_id
  returning * into v_contract;

  if v_contract.status in ('draft', 'signature_failed') then
    update public.customer_contracts
    set status = 'pending_signature',
        lifecycle_stage = 'agreement_ready',
        updated_by = new.created_by,
        updated_at = now()
    where id = v_contract.id and company_id = v_contract.company_id
    returning * into v_contract;
  end if;
  if v_contract.status <> 'pending_signature' then
    raise exception using
      errcode = '23514',
      message = 'admin_signed_contract_import_pending_signature_required';
  end if;

  insert into public.customer_contract_documents(
    company_id,
    customer_contract_id,
    document_type,
    storage_bucket,
    storage_path,
    mime_type,
    document_sha256,
    generated_at,
    generation_snapshot,
    verified_at
  ) values (
    new.company_id,
    new.customer_contract_id,
    'signed_contract_pdf',
    new.storage_bucket,
    new.file_path,
    coalesce(nullif(new.mime_type, ''), 'application/pdf'),
    new.file_checksum,
    coalesce(new.uploaded_at, now()),
    jsonb_build_object(
      'schema', 'gridex_imported_signed_contract_document_v1',
      'source', 'admin_customer_intake',
      'authorization_document_id', new.id,
      'customer_id', new.customer_id,
      'contract_id', new.customer_contract_id,
      'imported_by', new.created_by,
      'document_sha256', new.file_checksum
    ),
    now()
  )
  on conflict (customer_contract_id, document_type, document_sha256)
  do nothing;

  select d.id into v_contract_document_id
  from public.customer_contract_documents d
  where d.company_id = new.company_id
    and d.customer_contract_id = new.customer_contract_id
    and d.document_type = 'signed_contract_pdf'
    and d.document_sha256 = new.file_checksum
    and d.storage_bucket = new.storage_bucket
    and d.storage_path = new.file_path
    and d.verified_at is not null;
  if v_contract_document_id is null then
    raise exception using
      errcode = '23514',
      message = 'admin_signed_contract_import_document_binding_failed';
  end if;

  select * into v_customer
  from public.customers
  where id = v_contract.customer_id
    and company_id = v_contract.company_id;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'admin_signed_contract_import_customer_not_found';
  end if;

  v_accepted_at := coalesce(new.uploaded_at, now());
  v_signature := jsonb_build_object(
    'schema', 'gridex_imported_signed_contract_v1',
    'company_id', v_contract.company_id,
    'customer_id', v_contract.customer_id,
    'contract_id', v_contract.id,
    'channel', 'admin',
    'signing_method', 'imported_signed_document',
    'recorded_at', v_accepted_at,
    'original_signature_timestamp', null,
    'timestamp_semantics', 'administrative_import_time_original_signature_time_not_supplied',
    'contract_number', v_contract.contract_number,
    'offer_reference', v_contract.offer_reference,
    'contract_publication_version_id', v_contract.contract_publication_version_id,
    'contract_product_version_id', v_contract.contract_product_version_id,
    'price_plan_version_id', v_contract.price_plan_version_id,
    'legal_bundle_version_id', v_contract.legal_bundle_version_id,
    'contract_price_snapshot_id', v_snapshot_id,
    'pricing_snapshot_sha256', v_price.snapshot_hash,
    'signed_contract_document_id', v_contract_document_id,
    'signed_document_sha256', new.file_checksum,
    'source_authorization_document_id', new.id,
    'imported_by', new.created_by,
    'legal_versions', v_legal_versions
  );
  v_signature_hash := encode(
    extensions.digest(convert_to(v_signature::text, 'UTF8'), 'sha256'),
    'hex'
  );
  v_acceptance := jsonb_build_object(
    'schema', 'gridex_contract_acceptance_v1',
    'contract_id', v_contract.id,
    'accepted_at', v_accepted_at,
    'channel', 'admin',
    'signing_method', 'imported_signed_document',
    'signature_snapshot_sha256', v_signature_hash,
    'pricing_snapshot_sha256', v_price.snapshot_hash,
    'signed_document_sha256', new.file_checksum,
    'source_authorization_document_id', new.id,
    'legal_versions', v_legal_versions
  );
  v_acceptance_hash := encode(
    extensions.digest(convert_to(v_acceptance::text, 'UTF8'), 'sha256'),
    'hex'
  );

  insert into public.customer_contract_acceptances(
    company_id,
    customer_contract_id,
    contract_publication_version_id,
    accepted_at,
    channel,
    signing_method,
    customer_identity_snapshot,
    power_of_attorney_snapshot,
    acceptance_snapshot,
    acceptance_sha256
  ) values (
    v_contract.company_id,
    v_contract.id,
    v_contract.contract_publication_version_id,
    v_accepted_at,
    'admin',
    'imported_signed_document',
    jsonb_strip_nulls(jsonb_build_object(
      'customer_id', v_customer.id,
      'customer_number', coalesce(v_contract.customer_number, v_customer.customer_number),
      'email', v_customer.email,
      'customer_type', v_customer.customer_type
    )),
    '{}'::jsonb,
    v_acceptance,
    v_acceptance_hash
  )
  on conflict (customer_contract_id, acceptance_sha256) do nothing;

  insert into public.customer_contract_evidence(
    company_id,
    customer_contract_id,
    evidence_type,
    evidence_snapshot,
    evidence_sha256,
    captured_at
  ) values (
    v_contract.company_id,
    v_contract.id,
    'imported_signed_contract',
    v_signature,
    v_signature_hash,
    v_accepted_at
  )
  on conflict (customer_contract_id, evidence_type, evidence_sha256) do nothing;

  insert into public.customer_legal_acceptances(
    company_id,
    customer_id,
    contract_id,
    acceptance_type,
    legal_text_version_id,
    legal_bundle_id,
    legal_bundle_version_document_id,
    legal_module_key,
    legal_document_version,
    legal_document_sha256,
    accepted_at,
    source,
    snapshot,
    metadata,
    created_by,
    reason
  )
  select
    v_contract.company_id,
    v_contract.customer_id,
    v_contract.id,
    case public.gridex_legacy_legal_type_for_module(d.module_key)
      when 'privacy_policy' then 'privacy_policy'
      when 'withdrawal' then 'withdrawal_info'
      when 'power_of_attorney' then 'power_of_attorney'
      when 'price_terms' then 'price_snapshot'
      else 'terms'
    end,
    null,
    lbv.legal_bundle_id,
    d.id,
    d.module_key,
    coalesce(d.template_version, left(d.content_sha256, 12)),
    d.content_sha256,
    v_accepted_at,
    'admin_manual',
    jsonb_build_object(
      'source_authorization_document_id', new.id,
      'signed_document_sha256', new.file_checksum,
      'signature_snapshot_sha256', v_signature_hash
    ),
    jsonb_build_object(
      'signing_method', 'imported_signed_document',
      'pricing_snapshot_sha256', v_price.snapshot_hash,
      'original_signature_timestamp', null,
      'timestamp_semantics', 'administrative_import_time_original_signature_time_not_supplied'
    ),
    new.created_by,
    'Importerat signerat avtal verifierat mot uppladdat PDF-dokument och SHA-256.'
  from public.legal_bundle_version_documents d
  join public.legal_bundle_versions lbv
    on lbv.id = d.legal_bundle_version_id
  where d.legal_bundle_version_id = v_contract.legal_bundle_version_id
  on conflict do nothing;

  -- Any previously prepared online link is no longer valid after an imported
  -- signed document becomes authoritative.
  update public.customer_contract_signature_requests
  set revoked_at = coalesce(revoked_at, now())
  where company_id = v_contract.company_id
    and customer_contract_id = v_contract.id
    and used_at is null
    and revoked_at is null;

  update public.customer_contracts
  set status = 'signed',
      signed_at = v_accepted_at,
      legal_versions_snapshot = v_legal_versions,
      signature_snapshot = v_signature,
      signature_snapshot_sha256 = v_signature_hash,
      locked_at = v_accepted_at,
      lifecycle_stage = 'agreement_signed',
      signed_version = coalesce(terms_version, contract_version, 'v1'),
      terms_signed_version = coalesce(terms_version, 'v1'),
      document_sha256 = new.file_checksum,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'signature_status', 'signed',
        'signature_method', 'imported_signed_document',
        'source_authorization_document_id', new.id,
        'signed_contract_document_id', v_contract_document_id,
        'signature_snapshot_sha256', v_signature_hash,
        'pricing_snapshot_sha256', v_price.snapshot_hash,
        'original_signature_timestamp', null,
        'timestamp_semantics', 'administrative_import_time_original_signature_time_not_supplied'
      ),
      updated_by = new.created_by,
      updated_at = now()
  where id = v_contract.id and company_id = v_contract.company_id
  returning * into v_contract;

  v_event := public.gridex_record_customer_contract_event_v1(
    v_contract.company_id,
    v_contract.id,
    v_contract.customer_id,
    'signed',
    v_accepted_at,
    'Signerat avtal importerat och verifierat av administratör',
    jsonb_build_object(
      'source_authorization_document_id', new.id,
      'signed_contract_document_id', v_contract_document_id,
      'signed_document_sha256', new.file_checksum,
      'signature_snapshot_sha256', v_signature_hash,
      'pricing_snapshot_sha256', v_price.snapshot_hash,
      'channel', 'admin',
      'signing_method', 'imported_signed_document'
    ),
    new.created_by,
    null,
    encode(
      extensions.digest(
        convert_to((new.id::text || ':imported_signed_contract'), 'UTF8'),
        'sha256'
      ),
      'hex'
    )
  );

  return new;
end
$function$;

revoke all on function public.gridex_finalize_admin_imported_signed_agreement_v1() from public;
revoke all on function public.gridex_finalize_admin_imported_signed_agreement_v1() from anon;
revoke all on function public.gridex_finalize_admin_imported_signed_agreement_v1() from authenticated;

drop trigger if exists zz_customer_authorization_documents_finalize_signed_agreement_v1
  on public.customer_authorization_documents;
create trigger zz_customer_authorization_documents_finalize_signed_agreement_v1
after insert or update of status, customer_contract_id, file_checksum, metadata
on public.customer_authorization_documents
for each row
execute function public.gridex_finalize_admin_imported_signed_agreement_v1();
