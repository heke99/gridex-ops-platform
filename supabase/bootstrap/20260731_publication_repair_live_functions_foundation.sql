-- GRIDEX-AUD-003 verified live-schema bootstrap artifact.
-- Evidence: pg_get_functiondef from gridex-ops-dev (piidsfebjqjmnepdpnas),
-- captured 2026-08-10 and 2026-08-15 for the prerequisite functions required by
-- 20260731210000_public_contract_materialization_integrity_repair.sql.
-- The artifact contains schema code only; no tenant or customer data.

CREATE OR REPLACE FUNCTION public.gridex_republish_active_public_contract_v1(p_publication_version_id uuid, p_actor_user_id uuid DEFAULT NULL::uuid, p_explicit_invoice_fee_sek numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_catalog', 'pg_temp'
AS $function$
declare
  v_old public.contract_publication_versions%rowtype;
  v_publication public.contract_publications%rowtype;
  v_assignment public.tenant_contract_assignments%rowtype;
  v_channel_row public.tenant_contract_channels%rowtype;
  v_offer public.contract_offers%rowtype;
  v_public_offer public.public_contract_offers%rowtype;
  v_company public.companies%rowtype;
  v_product_snapshot jsonb;
  v_price_plan_snapshot jsonb;
  v_evidence jsonb;
  v_amount numeric;
  v_visible boolean := true;
  v_base_snapshot jsonb;
  v_commercial_snapshot jsonb;
  v_new_snapshot jsonb;
  v_new_hash text;
  v_new_offer_reference text;
  v_new_version_number integer;
  v_new_publication_version_id uuid;
  v_actor uuid;
  v_commercial_amount_changed boolean := false;
  v_blockers text[];
begin
  if p_explicit_invoice_fee_sek is not null
     and p_explicit_invoice_fee_sek < 0 then
    raise exception using errcode = '22023',
      message = 'INVALID_INVOICE_FEE';
  end if;

  select * into v_old
  from public.contract_publication_versions
  where id = p_publication_version_id
  for update;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'PUBLICATION_VERSION_NOT_FOUND';
  end if;

  select * into v_publication
  from public.contract_publications
  where id = v_old.contract_publication_id
  for update;

  select * into v_assignment
  from public.tenant_contract_assignments
  where id = v_publication.assignment_id
  for update;

  select * into v_company
  from public.companies
  where id = v_assignment.company_id;

  select * into v_channel_row
  from public.tenant_contract_channels
  where assignment_id = v_assignment.id
    and channel = v_publication.channel
  for update;

  select * into v_offer
  from public.contract_offers
  where company_id = v_assignment.company_id
    and id::text = v_old.publication_snapshot->>'source_contract_offer_id'
  for update;
  if not found then
    raise exception using errcode = '23514',
      message = 'PUBLICATION_SOURCE_OFFER_MISMATCH';
  end if;

  v_actor := coalesce(
    p_actor_user_id,
    v_old.created_by,
    v_offer.updated_by,
    v_offer.created_by
  );

  if v_company.status <> 'active'
     or nullif(btrim(v_company.external_tenant_reference), '') is null then
    raise exception using errcode = '23514',
      message = 'PUBLICATION_TENANT_NOT_READY';
  end if;
  if v_old.status <> 'published' or v_old.locked_at is null
     or v_publication.status <> 'published'
     or v_assignment.status <> 'active'
     or v_channel_row.id is null
     or v_channel_row.status <> 'active' then
    raise exception using errcode = '23514',
      message = 'PUBLICATION_NOT_CURRENTLY_ACTIVE';
  end if;
  if v_publication.channel not in ('website', 'api') then
    raise exception using errcode = '22023',
      message = 'INVALID_PUBLICATION_CHANNEL';
  end if;
  if v_publication.channel = 'website'
     and not v_assignment.website_publication_allowed then
    raise exception using errcode = '23514',
      message = 'PUBLICATION_WEBSITE_PERMISSION_MISSING';
  end if;
  if v_publication.channel = 'api'
     and not v_assignment.api_publication_allowed then
    raise exception using errcode = '23514',
      message = 'PUBLICATION_API_PERMISSION_MISSING';
  end if;
  if v_old.valid_from is not null and v_old.valid_from > now() then
    raise exception using errcode = '23514',
      message = 'PUBLICATION_NOT_YET_VALID';
  end if;
  if v_old.valid_to is not null and v_old.valid_to <= now() then
    raise exception using errcode = '23514',
      message = 'PUBLICATION_EXPIRED';
  end if;

  if v_publication.channel = 'website' then
    select * into v_public_offer
    from public.public_contract_offers
    where company_id = v_assignment.company_id
      and source_contract_offer_id = v_offer.id
      and contract_publication_version_id = v_old.id
    order by created_at desc
    limit 1
    for update;
    if not found
       or not coalesce(v_public_offer.is_public, false)
       or not coalesce(v_public_offer.website_enabled, false)
       or not coalesce(v_public_offer.website_cta_enabled, false)
       or coalesce(v_public_offer.publication_status, '') <> 'published' then
      raise exception using errcode = '23514',
        message = 'WEBSITE_PUBLICATION_INTENT_NOT_ACTIVE';
    end if;
  end if;

  v_evidence := public.gridex_publication_invoice_fee_evidence_v1(v_old.id);
  if p_explicit_invoice_fee_sek is null then
    if coalesce(v_evidence->>'status', 'blocked') <> 'ready' then
      raise exception using errcode = '23514',
        message = coalesce(
          v_evidence->>'code',
          'INVOICE_FEE_AMOUNT_REQUIRED'
        ),
        detail = v_evidence::text;
    end if;
    v_amount := (v_evidence->>'amount')::numeric;
    v_visible := coalesce(
      (v_evidence->>'website_card_visible')::boolean,
      true
    );
  else
    if coalesce(v_evidence->>'status', 'blocked') = 'ready'
       and (v_evidence->>'amount')::numeric
         <> p_explicit_invoice_fee_sek then
      raise exception using errcode = '23514',
        message = 'INVOICE_FEE_EXPLICIT_VALUE_CONFLICT',
        detail = v_evidence::text;
    end if;
    if coalesce(v_evidence->>'code', '') in (
      'INVOICE_FEE_AMBIGUOUS', 'INVOICE_FEE_CONFLICT'
    ) then
      raise exception using errcode = '23514',
        message = v_evidence->>'code',
        detail = v_evidence::text;
    end if;
    v_amount := p_explicit_invoice_fee_sek;
    v_commercial_amount_changed :=
      coalesce(v_evidence->>'status', 'blocked') <> 'ready';
  end if;

  select commercial_snapshot into v_product_snapshot
  from public.contract_product_versions
  where id = v_old.contract_product_version_id;
  select snapshot_json into v_price_plan_snapshot
  from public.price_plan_versions
  where id = v_old.price_plan_version_id
    and company_id = v_assignment.company_id;

  v_base_snapshot := case
    when jsonb_typeof(v_offer.commercial_snapshot) = 'object'
      and v_offer.commercial_snapshot <> '{}'::jsonb
      then v_offer.commercial_snapshot
    when jsonb_typeof(v_product_snapshot) = 'object'
      and v_product_snapshot <> '{}'::jsonb
      then v_product_snapshot
    when jsonb_typeof(v_price_plan_snapshot) = 'object'
      and v_price_plan_snapshot <> '{}'::jsonb
      then v_price_plan_snapshot
    else coalesce(
      v_old.publication_snapshot->'commercial_snapshot',
      '{}'::jsonb
    )
  end;

  v_commercial_snapshot := public.gridex_snapshot_with_invoice_fee(
    v_base_snapshot,
    v_amount,
    v_visible
  ) || jsonb_build_object('invoice_fee_sek', v_amount);

  if coalesce(
    public.gridex_invoice_fee_readiness(
      v_commercial_snapshot,
      v_amount
    )->>'status',
    'blocked'
  ) <> 'ready' then
    raise exception using errcode = '23514',
      message = 'INVOICE_FEE_CONFIGURATION_MISSING';
  end if;

  -- Idempotency: return the already-created successor when it is complete.
  select candidate.id
  into v_new_publication_version_id
  from public.contract_publication_versions candidate
  where candidate.contract_publication_id = v_publication.id
    and candidate.id <> v_old.id
    and candidate.channel = v_publication.channel
    and candidate.status = 'published'
    and candidate.locked_at is not null
    and candidate.publication_snapshot->>'source_contract_offer_id'
      = v_offer.id::text
    and candidate.publication_snapshot->'commercial_snapshot'
      = v_commercial_snapshot
    and cardinality(
      public.gridex_validate_publication_graph_v1(candidate.id)
    ) = 0
  order by candidate.version_number desc
  limit 1;

  if v_new_publication_version_id is not null then
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'code', 'PUBLICATION_SUCCESSOR_ALREADY_EXISTS',
      'old_publication_version_id', v_old.id,
      'publication_version_id', v_new_publication_version_id,
      'channel', v_publication.channel,
      'invoice_fee_sek', v_amount
    );
  end if;

  select coalesce(max(version_number), 0) + 1
  into v_new_version_number
  from public.contract_publication_versions
  where contract_publication_id = v_publication.id;

  v_new_offer_reference := public.gridex_new_offer_reference(
    concat_ws(
      '|',
      v_assignment.company_id::text,
      v_offer.id::text,
      v_publication.channel,
      v_new_version_number::text,
      clock_timestamp()::text
    )
  );

  v_new_snapshot := jsonb_build_object(
    'schema', 'gridex_contract_publication_v6',
    'company_id', v_assignment.company_id,
    'contract_product_id', v_offer.contract_product_id,
    'contract_product_version_id', v_old.contract_product_version_id,
    'source_contract_offer_id', v_offer.id,
    'channel', v_publication.channel,
    'offer_reference', v_new_offer_reference,
    'commercial_snapshot', v_commercial_snapshot,
    'legal_bundle_version_id', v_old.legal_bundle_version_id,
    'price_options', '[]'::jsonb,
    'valid_from', v_offer.valid_from,
    'valid_to', v_offer.valid_to,
    'repair_metadata', jsonb_build_object(
      'reason', 'canonical_invoice_fee_and_price_option_successor',
      'supersedes_publication_version_id', v_old.id,
      'invoice_fee_evidence', v_evidence,
      'commercial_amount_changed', v_commercial_amount_changed
    )
  );
  v_new_hash := encode(
    extensions.digest(v_new_snapshot::text, 'sha256'),
    'hex'
  );

  insert into public.contract_publication_versions(
    contract_publication_id,
    version_number,
    contract_product_version_id,
    price_plan_id,
    price_plan_version_id,
    price_book_id,
    legal_bundle_version_id,
    customer_type,
    channel,
    valid_from,
    valid_to,
    publication_snapshot,
    offer_reference,
    content_sha256,
    status,
    published_at,
    locked_at,
    created_by
  ) values (
    v_publication.id,
    v_new_version_number,
    v_old.contract_product_version_id,
    v_old.price_plan_id,
    v_old.price_plan_version_id,
    v_old.price_book_id,
    v_old.legal_bundle_version_id,
    v_old.customer_type,
    v_publication.channel,
    v_offer.valid_from::timestamp at time zone 'Europe/Stockholm',
    case
      when v_offer.valid_to is null then null
      else (v_offer.valid_to + 1)::timestamp at time zone 'Europe/Stockholm'
    end,
    v_new_snapshot,
    v_new_offer_reference,
    v_new_hash,
    'draft',
    null,
    null,
    v_actor
  ) returning id into v_new_publication_version_id;

  perform public.gridex_finalize_contract_publication_v1(
    v_new_publication_version_id,
    v_actor,
    false
  );

  v_blockers := public.gridex_validate_publication_graph_v1(
    v_new_publication_version_id
  );
  if cardinality(v_blockers) > 0 then
    raise exception using errcode = '23514',
      message = coalesce(v_blockers[1], 'PUBLICATION_GRAPH_INCOMPLETE'),
      detail = to_jsonb(v_blockers)::text;
  end if;

  if v_publication.channel = 'website' then
    perform set_config('gridex.public_offer_write', 'on', true);
    update public.public_contract_offers
    set contract_publication_version_id = v_new_publication_version_id,
        legal_bundle_version_id = v_old.legal_bundle_version_id,
        price_plan_id = v_old.price_plan_id,
        price_plan_version_id = v_old.price_plan_version_id,
        price_book_id = v_old.price_book_id,
        invoice_fee_sek = v_amount,
        publication_status = 'published',
        lifecycle_status = 'published',
        is_public = true,
        is_archived = false,
        website_enabled = true,
        website_cta_enabled = true,
        metadata = coalesce(metadata, '{}'::jsonb)
          || jsonb_build_object(
            'source_of_truth', 'contract_product_versions',
            'offer_reference', v_new_offer_reference,
            'repaired_from_publication_version_id', v_old.id
          ),
        updated_by = v_actor,
        updated_at = now()
    where id = v_public_offer.id;

    update public.contract_publication_versions
    set legacy_public_contract_offer_id = v_public_offer.id
    where id = v_new_publication_version_id;
  end if;

  perform set_config('gridex.version_transition', 'on', true);
  update public.contract_publication_versions
  set status = 'ended',
      valid_to = least(coalesce(valid_to, now()), now())
  where id = v_old.id;

  update public.contract_publications
  set status = 'published', updated_at = now()
  where id = v_publication.id;

  perform public.gridex_bump_contract_publication_revision(
    v_assignment.company_id,
    v_publication.channel,
    'publication.successor.repair',
    v_new_publication_version_id::text
  );

  insert into public.audit_logs(
    company_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    old_values,
    new_values,
    metadata
  ) values (
    v_assignment.company_id,
    v_actor,
    'contract_publication_version',
    v_new_publication_version_id::text,
    'contract_publication_successor_repaired',
    to_jsonb(v_old),
    (
      select to_jsonb(current_row)
      from public.contract_publication_versions current_row
      where current_row.id = v_new_publication_version_id
    ),
    jsonb_build_object(
      'channel', v_publication.channel,
      'source_contract_offer_id', v_offer.id,
      'supersedes_publication_version_id', v_old.id,
      'invoice_fee_sek', v_amount,
      'invoice_fee_evidence', v_evidence,
      'commercial_amount_changed', v_commercial_amount_changed
    )
  );

  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'code', 'PUBLICATION_SUCCESSOR_CREATED',
    'company_id', v_assignment.company_id,
    'offer_id', v_offer.id,
    'channel', v_publication.channel,
    'old_publication_version_id', v_old.id,
    'publication_version_id', v_new_publication_version_id,
    'offer_reference', v_new_offer_reference,
    'invoice_fee_sek', v_amount,
    'price_options',
      public.gridex_publication_price_options_json_v1(
        v_new_publication_version_id
      )
  );
end;
$function$;

revoke all on function public.gridex_republish_active_public_contract_v1(uuid,uuid,numeric) from public, anon, authenticated;
grant execute on function public.gridex_republish_active_public_contract_v1(uuid,uuid,numeric) to service_role;

CREATE OR REPLACE FUNCTION public.gridex_republish_active_public_contract_v2(p_publication_version_id uuid, p_actor_user_id uuid DEFAULT NULL::uuid, p_explicit_invoice_fee_sek numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_catalog', 'pg_temp'
AS $function$
declare
  v_old public.contract_publication_versions%rowtype;
  v_successor public.contract_publication_versions%rowtype;
  v_channel text;
begin
  select * into v_old
  from public.contract_publication_versions
  where id = p_publication_version_id;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'PUBLICATION_VERSION_NOT_FOUND';
  end if;

  select publication.channel
  into v_channel
  from public.contract_publications publication
  where publication.id = v_old.contract_publication_id;

  select candidate.* into v_successor
  from public.contract_publication_versions candidate
  where candidate.contract_publication_id = v_old.contract_publication_id
    and candidate.id <> v_old.id
    and candidate.status = 'published'
    and candidate.locked_at is not null
    and candidate.publication_snapshot
      ->'repair_metadata'->>'supersedes_publication_version_id'
        = v_old.id::text
    and cardinality(
      public.gridex_validate_publication_graph_v1(candidate.id)
    ) = 0
  order by candidate.version_number desc, candidate.created_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'code', 'PUBLICATION_SUCCESSOR_ALREADY_EXISTS',
      'old_publication_version_id', v_old.id,
      'publication_version_id', v_successor.id,
      'channel', coalesce(v_successor.channel, v_channel),
      'offer_reference', v_successor.offer_reference,
      'price_options',
        public.gridex_publication_price_options_json_v1(v_successor.id)
    );
  end if;

  return public.gridex_republish_active_public_contract_v1(
    p_publication_version_id,
    p_actor_user_id,
    p_explicit_invoice_fee_sek
  );
end;
$function$;

revoke all on function public.gridex_republish_active_public_contract_v2(uuid,uuid,numeric) from public, anon, authenticated;
grant execute on function public.gridex_republish_active_public_contract_v2(uuid,uuid,numeric) to service_role;

CREATE OR REPLACE FUNCTION public.gridex_seed_publication_price_option_template_v2(p_publication_version_id uuid, p_actor_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_catalog', 'pg_temp'
AS $function$
declare
  v_version public.contract_publication_versions%rowtype;
  v_publication public.contract_publications%rowtype;
  v_assignment public.tenant_contract_assignments%rowtype;
  v_product_version public.contract_product_versions%rowtype;
  v_product public.contract_products%rowtype;
  v_offer public.contract_offers%rowtype;
  v_price_plan_snapshot jsonb := '{}'::jsonb;
  v_actor uuid;
  v_supported_areas text[] := '{}'::text[];
  v_template_count integer := 0;
  v_prior_snapshot_count integer := 0;
  v_option_id uuid;
  v_option_reference text;
  v_resolution text;
  v_fixed_price_ore numeric;
  v_markup_ore numeric;
  v_monthly_fee_sek numeric;
  v_auto_renew boolean;
  v_renewal_term_months integer;
  v_base_row_count integer := 0;
  v_common_base_row_count integer := 0;
  v_common_base_distinct_count integer := 0;
  v_common_base_fixed_ore numeric;
  v_missing_areas text[] := '{}'::text[];
  v_conflicting_areas text[] := '{}'::text[];
  v_area_source text;
  v_metadata jsonb;
begin
  select * into v_version
  from public.contract_publication_versions
  where id = p_publication_version_id
  for update;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'PUBLICATION_VERSION_NOT_FOUND';
  end if;

  select * into v_publication
  from public.contract_publications
  where id = v_version.contract_publication_id;
  if not found then
    raise exception using errcode = '23514',
      message = 'PUBLICATION_ROOT_MISSING';
  end if;

  select * into v_assignment
  from public.tenant_contract_assignments
  where id = v_publication.assignment_id;
  if not found then
    raise exception using errcode = '23514',
      message = 'PUBLICATION_TENANT_NOT_READY';
  end if;

  select * into v_product_version
  from public.contract_product_versions
  where id = v_version.contract_product_version_id;
  if not found then
    raise exception using errcode = '23514',
      message = 'PUBLICATION_PRODUCT_VERSION_MISSING';
  end if;

  select * into v_product
  from public.contract_products
  where id = v_product_version.contract_product_id;
  if not found then
    raise exception using errcode = '23514',
      message = 'PUBLICATION_PRODUCT_MISSING';
  end if;

  if v_version.price_plan_version_id is null then
    raise exception using errcode = '23514',
      message = 'PUBLICATION_PRICE_PLAN_VERSION_MISSING';
  end if;

  select coalesce(snapshot_json, '{}'::jsonb)
  into v_price_plan_snapshot
  from public.price_plan_versions
  where id = v_version.price_plan_version_id
    and company_id = v_assignment.company_id;
  if not found then
    raise exception using errcode = '23514',
      message = 'PUBLICATION_PRICE_PLAN_VERSION_MISSING';
  end if;

  select * into v_offer
  from public.contract_offers
  where company_id = v_assignment.company_id
    and id::text = v_version.publication_snapshot->>'source_contract_offer_id'
    and contract_product_version_id = v_version.contract_product_version_id
    and price_plan_version_id = v_version.price_plan_version_id;
  if not found then
    raise exception using errcode = '23514',
      message = 'PUBLICATION_SOURCE_OFFER_MISMATCH';
  end if;

  if v_product_version.contract_type not in (
    'fixed',
    'variable_monthly',
    'variable_hourly',
    'variable_quarterly',
    'portfolio',
    'mixed'
  ) then
    raise exception using errcode = '23514',
      message = 'PUBLICATION_PRICE_OPTION_CONTRACT_TYPE_INVALID',
      detail = coalesce(v_product_version.contract_type, 'null');
  end if;

  v_actor := coalesce(
    p_actor_user_id,
    v_version.created_by,
    v_offer.updated_by,
    v_offer.created_by,
    v_product_version.created_by
  );

  -- Serialize template creation for this exact immutable commercial graph.
  perform pg_advisory_xact_lock(
    hashtextextended(
      concat_ws(
        ':',
        'gridex-price-option-template-v2',
        v_version.contract_product_version_id::text,
        v_version.price_plan_version_id::text
      ),
      0
    )
  );

  -- No work is needed when finalize already has any valid canonical source.
  if exists (
    select 1
    from public.contract_price_options current_snapshot
    where current_snapshot.contract_publication_version_id = v_version.id
  ) then
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'source_kind', 'existing_snapshot',
      'publication_version_id', v_version.id
    );
  end if;

  select count(*)
  into v_template_count
  from public.contract_price_options template
  where template.company_id = v_assignment.company_id
    and template.contract_product_version_id =
      v_version.contract_product_version_id
    and template.price_plan_version_id = v_version.price_plan_version_id
    and template.contract_publication_version_id is null
    and template.status = 'active';

  if v_template_count > 0 then
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'source_kind', 'template',
      'template_count', v_template_count,
      'publication_version_id', v_version.id
    );
  end if;

  select count(distinct source.contract_publication_version_id)
  into v_prior_snapshot_count
  from public.contract_price_options source
  join public.contract_publication_versions source_version
    on source_version.id = source.contract_publication_version_id
  join public.contract_publications source_publication
    on source_publication.id = source_version.contract_publication_id
  join public.tenant_contract_assignments source_assignment
    on source_assignment.id = source_publication.assignment_id
  where source_assignment.company_id = v_assignment.company_id
    and source.contract_product_version_id =
      v_version.contract_product_version_id
    and source.price_plan_version_id = v_version.price_plan_version_id
    and source.contract_publication_version_id <> v_version.id
    and source.status = 'active';

  if v_prior_snapshot_count > 0 then
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'source_kind', 'prior_snapshot',
      'prior_snapshot_count', v_prior_snapshot_count,
      'publication_version_id', v_version.id
    );
  end if;

  v_supported_areas := coalesce(
    public.gridex_supported_price_areas_v1(
      v_version.contract_product_version_id
    ),
    '{}'::text[]
  );

  if v_product_version.contract_type = 'fixed'
     and cardinality(v_supported_areas) = 0 then
    raise exception using errcode = '23514',
      message = 'PUBLICATION_SUPPORTED_PRICE_AREA_INVALID';
  end if;

  v_resolution := case v_product_version.contract_type
    when 'variable_hourly' then 'hourly'
    when 'variable_quarterly' then 'quarterly'
    else 'monthly'
  end;

  -- Commercial scalar metadata follows immutable-publication precedence:
  -- locked publication snapshot -> locked product snapshot -> locked price-plan
  -- snapshot -> source offer row. Generic, unit-less "fixed_price" is not used.
  v_fixed_price_ore := coalesce(
    public.gridex_safe_nonnegative_numeric(
      v_version.publication_snapshot
        ->'commercial_snapshot'->>'fixed_price_ore_per_kwh'
    ),
    case
      when public.gridex_safe_nonnegative_numeric(
        v_version.publication_snapshot
          ->'commercial_snapshot'->>'fixed_price_sek_per_kwh'
      ) is null then null
      else public.gridex_safe_nonnegative_numeric(
        v_version.publication_snapshot
          ->'commercial_snapshot'->>'fixed_price_sek_per_kwh'
      ) * 100
    end,
    public.gridex_safe_nonnegative_numeric(
      v_product_version.commercial_snapshot->>'fixed_price_ore_per_kwh'
    ),
    case
      when public.gridex_safe_nonnegative_numeric(
        v_product_version.commercial_snapshot->>'fixed_price_sek_per_kwh'
      ) is null then null
      else public.gridex_safe_nonnegative_numeric(
        v_product_version.commercial_snapshot->>'fixed_price_sek_per_kwh'
      ) * 100
    end,
    public.gridex_safe_nonnegative_numeric(
      v_price_plan_snapshot->>'fixed_price_ore_per_kwh'
    ),
    case
      when public.gridex_safe_nonnegative_numeric(
        v_price_plan_snapshot->>'fixed_price_sek_per_kwh'
      ) is null then null
      else public.gridex_safe_nonnegative_numeric(
        v_price_plan_snapshot->>'fixed_price_sek_per_kwh'
      ) * 100
    end,
    v_offer.fixed_price_ore_per_kwh
  );

  v_markup_ore := coalesce(
    public.gridex_safe_nonnegative_numeric(
      v_version.publication_snapshot
        ->'commercial_snapshot'->>'markup_ore_per_kwh'
    ),
    public.gridex_safe_nonnegative_numeric(
      v_version.publication_snapshot
        ->'commercial_snapshot'->>'spot_markup_ore_per_kwh'
    ),
    public.gridex_safe_nonnegative_numeric(
      v_version.publication_snapshot
        ->'commercial_snapshot'->>'variable_fee_ore_per_kwh'
    ),
    public.gridex_safe_nonnegative_numeric(
      v_product_version.commercial_snapshot->>'markup_ore_per_kwh'
    ),
    public.gridex_safe_nonnegative_numeric(
      v_product_version.commercial_snapshot->>'spot_markup_ore_per_kwh'
    ),
    public.gridex_safe_nonnegative_numeric(
      v_product_version.commercial_snapshot->>'variable_fee_ore_per_kwh'
    ),
    public.gridex_safe_nonnegative_numeric(
      v_price_plan_snapshot->>'markup_ore_per_kwh'
    ),
    public.gridex_safe_nonnegative_numeric(
      v_price_plan_snapshot->>'spot_markup_ore_per_kwh'
    ),
    public.gridex_safe_nonnegative_numeric(
      v_price_plan_snapshot->>'variable_fee_ore_per_kwh'
    ),
    v_offer.spot_markup_ore_per_kwh,
    v_offer.variable_fee_ore_per_kwh
  );

  v_monthly_fee_sek := coalesce(
    public.gridex_safe_nonnegative_numeric(
      v_version.publication_snapshot
        ->'commercial_snapshot'->>'monthly_fee_sek'
    ),
    public.gridex_safe_nonnegative_numeric(
      v_product_version.commercial_snapshot->>'monthly_fee_sek'
    ),
    public.gridex_safe_nonnegative_numeric(
      v_price_plan_snapshot->>'monthly_fee_sek'
    ),
    v_offer.monthly_fee_sek
  );

  v_auto_renew := coalesce(
    v_product_version.automatic_renewal,
    v_offer.automatic_renewal,
    false
  );
  v_renewal_term_months := case
    when v_auto_renew then coalesce(
      v_offer.automatic_renewal_term_months,
      12
    )
    else null
  end;

  if v_auto_renew
     and v_renewal_term_months not between 1 and 120 then
    raise exception using errcode = '23514',
      message = 'PUBLICATION_PRICE_OPTION_RENEWAL_INVALID';
  end if;

  v_option_reference := 'canonical_' || replace(
    v_version.contract_product_version_id::text,
    '-',
    ''
  );

  v_metadata := jsonb_strip_nulls(jsonb_build_object(
    'resolution', v_resolution,
    'currency', 'SEK',
    'unit', 'ore_per_kwh',
    'fixed_price', case
      when v_product_version.contract_type = 'fixed'
        then v_fixed_price_ore
      else null
    end,
    'markup', case
      when v_product_version.contract_type <> 'fixed'
        then v_markup_ore
      else null
    end,
    'monthly_fee', v_monthly_fee_sek,
    'materialized_source_kind', 'deterministic_legacy_graph',
    'source_contract_offer_id', v_offer.id,
    'source_contract_product_version_id',
      v_version.contract_product_version_id,
    'source_price_plan_version_id', v_version.price_plan_version_id,
    'seeded_by', 'gridex_seed_publication_price_option_template_v2'
  ));

  insert into public.contract_price_options(
    company_id,
    contract_product_version_id,
    price_plan_version_id,
    contract_publication_version_id,
    option_reference,
    option_code,
    customer_name,
    internal_description,
    contract_type,
    binding_months,
    notice_months,
    auto_renew_enabled,
    renewal_term_months,
    valid_from,
    valid_to,
    earliest_start_date,
    latest_start_date,
    status,
    sort_order,
    version_number,
    metadata,
    created_by,
    customer_type,
    is_default,
    selection_required
  ) values (
    v_assignment.company_id,
    v_version.contract_product_version_id,
    v_version.price_plan_version_id,
    null,
    v_option_reference,
    v_option_reference,
    coalesce(nullif(v_offer.name, ''), nullif(v_product.name, ''), 'Elavtal'),
    'Canonical template restored from immutable legacy publication graph',
    v_product_version.contract_type,
    coalesce(v_product_version.binding_months,
      v_offer.default_binding_months, 0),
    coalesce(v_product_version.notice_months,
      v_offer.default_notice_months, 0),
    v_auto_renew,
    v_renewal_term_months,
    v_offer.valid_from,
    v_offer.valid_to,
    null,
    null,
    'active',
    0,
    1,
    v_metadata,
    v_actor,
    v_product_version.customer_type,
    true,
    false
  )
  returning id into v_option_id;

  if v_product_version.contract_type = 'fixed' then
    select count(*)
    into v_base_row_count
    from public.base_price_components base
    where base.company_id = v_assignment.company_id
      and base.price_plan_version_id = v_version.price_plan_version_id
      and base.source_type = 'fixed'
      and base.status = 'active'
      and upper(btrim(base.price_area)) = any(v_supported_areas)
      and base.fixed_price_sek_per_kwh is not null
      and base.fixed_price_sek_per_kwh >= 0;

    select
      count(*),
      count(distinct base.fixed_price_sek_per_kwh),
      min(base.fixed_price_sek_per_kwh) * 100
    into
      v_common_base_row_count,
      v_common_base_distinct_count,
      v_common_base_fixed_ore
    from public.base_price_components base
    where base.company_id = v_assignment.company_id
      and base.price_plan_version_id = v_version.price_plan_version_id
      and base.source_type = 'fixed'
      and base.status = 'active'
      and base.price_area is null
      and base.fixed_price_sek_per_kwh is not null
      and base.fixed_price_sek_per_kwh >= 0;

    if v_base_row_count > 0 then
      select coalesce(array_agg(grouped.price_area order by grouped.price_area),
        '{}'::text[])
      into v_conflicting_areas
      from (
        select upper(btrim(base.price_area)) price_area
        from public.base_price_components base
        where base.company_id = v_assignment.company_id
          and base.price_plan_version_id = v_version.price_plan_version_id
          and base.source_type = 'fixed'
          and base.status = 'active'
          and upper(btrim(base.price_area)) = any(v_supported_areas)
          and base.fixed_price_sek_per_kwh is not null
          and base.fixed_price_sek_per_kwh >= 0
        group by upper(btrim(base.price_area))
        having count(distinct base.fixed_price_sek_per_kwh) > 1
      ) grouped;

      if cardinality(v_conflicting_areas) > 0 then
        raise exception using errcode = '23514',
          message = 'PUBLICATION_AREA_PRICE_SOURCE_AMBIGUOUS',
          detail = to_jsonb(v_conflicting_areas)::text;
      end if;

      select coalesce(array_agg(required_area order by required_area),
        '{}'::text[])
      into v_missing_areas
      from unnest(v_supported_areas) required_area
      where not exists (
        select 1
        from public.base_price_components base
        where base.company_id = v_assignment.company_id
          and base.price_plan_version_id = v_version.price_plan_version_id
          and base.source_type = 'fixed'
          and base.status = 'active'
          and upper(btrim(base.price_area)) = required_area
          and base.fixed_price_sek_per_kwh is not null
          and base.fixed_price_sek_per_kwh >= 0
      );

      if cardinality(v_missing_areas) > 0 then
        raise exception using errcode = '23514',
          message = 'PUBLICATION_AREA_PRICES_MISSING',
          detail = jsonb_build_object(
            'missing_price_areas', v_missing_areas,
            'rule', 'partial canonical fixed-area data is never supplemented from legacy rows'
          )::text;
      end if;

      insert into public.contract_price_option_area_prices(
        company_id,
        contract_price_option_id,
        price_plan_version_id,
        price_row_reference,
        price_area,
        amount,
        unit,
        vat_treatment,
        valid_from,
        valid_to,
        metadata,
        created_by,
        status
      )
      select
        v_assignment.company_id,
        v_option_id,
        v_version.price_plan_version_id,
        'canonical_' || lower(grouped.price_area) || '_' ||
          replace(v_option_id::text, '-', ''),
        grouped.price_area,
        grouped.fixed_price_sek_per_kwh * 100,
        'ore_per_kwh',
        'standard',
        v_offer.valid_from,
        v_offer.valid_to,
        jsonb_build_object(
          'source', 'base_price_components',
          'source_price_plan_version_id', v_version.price_plan_version_id
        ),
        v_actor,
        'active'
      from (
        select
          upper(btrim(base.price_area)) price_area,
          min(base.fixed_price_sek_per_kwh) fixed_price_sek_per_kwh
        from public.base_price_components base
        where base.company_id = v_assignment.company_id
          and base.price_plan_version_id = v_version.price_plan_version_id
          and base.source_type = 'fixed'
          and base.status = 'active'
          and upper(btrim(base.price_area)) = any(v_supported_areas)
          and base.fixed_price_sek_per_kwh is not null
          and base.fixed_price_sek_per_kwh >= 0
        group by upper(btrim(base.price_area))
      ) grouped;

      v_area_source := 'base_price_components_by_area';
    else
      if v_common_base_row_count > 0 then
        if v_common_base_distinct_count <> 1 then
          raise exception using errcode = '23514',
            message = 'PUBLICATION_AREA_PRICE_SOURCE_AMBIGUOUS',
            detail = jsonb_build_object(
              'source', 'base_price_components_common',
              'distinct_amount_count', v_common_base_distinct_count
            )::text;
        end if;
        v_fixed_price_ore := v_common_base_fixed_ore;
        v_area_source := 'base_price_components_common';
      else
        v_area_source := 'immutable_legacy_fixed_price';
      end if;

      if v_fixed_price_ore is null then
        raise exception using errcode = '23514',
          message = 'PUBLICATION_FIXED_PRICE_MISSING',
          detail = jsonb_build_object(
            'publication_version_id', v_version.id,
            'contract_product_version_id',
              v_version.contract_product_version_id,
            'price_plan_version_id', v_version.price_plan_version_id,
            'supported_price_areas', v_supported_areas
          )::text;
      end if;

      insert into public.contract_price_option_area_prices(
        company_id,
        contract_price_option_id,
        price_plan_version_id,
        price_row_reference,
        price_area,
        amount,
        unit,
        vat_treatment,
        valid_from,
        valid_to,
        metadata,
        created_by,
        status
      )
      select
        v_assignment.company_id,
        v_option_id,
        v_version.price_plan_version_id,
        'canonical_' || lower(required_area) || '_' ||
          replace(v_option_id::text, '-', ''),
        required_area,
        v_fixed_price_ore,
        'ore_per_kwh',
        'standard',
        v_offer.valid_from,
        v_offer.valid_to,
        jsonb_build_object(
          'source', v_area_source,
          'source_contract_offer_id', v_offer.id,
          'source_price_plan_version_id', v_version.price_plan_version_id
        ),
        v_actor,
        'active'
      from unnest(v_supported_areas) required_area;

    end if;
  else
    v_area_source := 'not_required';
  end if;

  insert into public.audit_logs(
    company_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    old_values,
    new_values,
    metadata
  ) values (
    v_assignment.company_id,
    v_actor,
    'contract_price_option',
    v_option_id::text,
    'contract_price_option_template_restored',
    null,
    (
      select to_jsonb(option_row)
      from public.contract_price_options option_row
      where option_row.id = v_option_id
    ),
    jsonb_build_object(
      'publication_version_id', v_version.id,
      'source_contract_offer_id', v_offer.id,
      'contract_product_version_id', v_version.contract_product_version_id,
      'price_plan_version_id', v_version.price_plan_version_id,
      'fixed_area_source', v_area_source,
      'commercial_values_changed', false
    )
  );

  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'source_kind', 'deterministic_legacy_graph',
    'publication_version_id', v_version.id,
    'template_price_option_id', v_option_id,
    'option_reference', v_option_reference,
    'contract_type', v_product_version.contract_type,
    'supported_price_areas', v_supported_areas,
    'fixed_area_source', v_area_source,
    'commercial_values_changed', false
  );
end;
$function$;

revoke all on function public.gridex_seed_publication_price_option_template_v2(uuid,uuid) from public, anon, authenticated;
grant execute on function public.gridex_seed_publication_price_option_template_v2(uuid,uuid) to service_role;

