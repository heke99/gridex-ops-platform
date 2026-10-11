-- One-off/manual contract offers can be bound to the contract they were made for.
--
-- gridex_prepare_manual_contract_binding saves a one-off offer and archives it
-- (is_active=false) so it never appears in a catalog. Two defects made every
-- consumer fail:
--   1. The save is always a draft, and ensure_internal_contract_publication
--      only mirrors the offer state, so the chain stayed draft/unlocked
--      (one_off_publication_not_locked / internal_offer_not_canonical_ready).
--      The materializer now publishes through the existing permission- and
--      readiness-gated gridex_publish_internal_contract_version first.
--   2. The customer_contracts availability trigger rejected the archived
--      offer with 23514 contract_offer_not_available. Affected consumers:
--   * signature request preparation (draft -> pending_signature),
--   * the admin signed-agreement import trigger,
--   * customer-card manual non-draft create (createCustomerContract).
--
-- The materializer now records a server-side reservation for the offer it
-- created. The availability trigger skips only the offer lifecycle/active/
-- validity-window check, and only when the contract references that exact
-- reserved offer of its own tenant and the reservation is unconsumed or was
-- consumed by this same contract. The first binding consumes it, so a one-off
-- offer serves exactly one contract. Channel and capacity checks, the canonical
-- binding guard and every refusal for catalog, inactive, cross-tenant or reused
-- offers are unchanged. No client flag, slug or payload marks an offer one-off.

begin;

create schema if not exists gridex_one_off_offer_binding;
revoke all on schema gridex_one_off_offer_binding from public, anon, authenticated, service_role;

create table gridex_one_off_offer_binding.reservations (
  offer_id uuid primary key references public.contract_offers(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Set when the caller binds in a later transaction (customer-card create
  -- preallocates its contract ID); only that contract may consume the offer.
  intended_contract_id uuid,
  -- The consuming contract is pinned: its ID cannot change while it holds
  -- the reservation, and deleting it releases nothing (the row goes away).
  consumed_contract_id uuid references public.customer_contracts(id)
    on update restrict on delete cascade deferrable initially deferred,
  consumed_at timestamptz,
  constraint reservations_consumption_coherent
    check ((consumed_contract_id is null) = (consumed_at is null)),
  constraint reservations_consumed_by_intended
    check (intended_contract_id is null or consumed_contract_id is null or consumed_contract_id = intended_contract_id)
);
revoke all on table gridex_one_off_offer_binding.reservations from public, anon, authenticated, service_role;

create or replace function public.gridex_prepare_manual_contract_binding(p_company_id uuid, p_payload jsonb, p_pricing_snapshot jsonb, p_actor_user_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_identity uuid := gen_random_uuid();
  v_intended_contract_id uuid := nullif(p_payload->>'intended_contract_id','')::uuid;
  v_saved jsonb;
  v_published jsonb;
  v_key text;
  v_offer_id uuid;
  v_publication_id uuid;
  v_publication public.contract_publication_versions%rowtype;
  v_product public.contract_product_versions%rowtype;
  v_legal public.legal_bundle_versions%rowtype;
begin
  if p_company_id is null then
    raise exception using errcode='22023',message='company_required';
  end if;

  p_payload := coalesce(p_payload,'{}'::jsonb) - 'intended_contract_id';
  p_pricing_snapshot := coalesce(p_pricing_snapshot,'{}'::jsonb);

  -- The signature-request and signed-import consumers pass the contract's
  -- commercial terms only in the pricing snapshot, while the offer save reads
  -- them from the payload. Fill each missing payload value from that
  -- server-side snapshot; explicitly supplied payload values always win.
  foreach v_key in array array[
    'pricing_model','fixed_price_ore_per_kwh','spot_markup_ore_per_kwh','variable_fee_ore_per_kwh',
    'monthly_fee_sek','invoice_fee_sek','green_fee_mode','green_fee_value','discount_value',
    'discount_unit','start_fee_sek','admin_fee_sek','break_fee_sek','vat_rate'
  ] loop
    if p_payload->v_key is null and jsonb_typeof(p_pricing_snapshot->v_key) <> 'null' then
      p_payload := p_payload || jsonb_build_object(v_key,p_pricing_snapshot->v_key);
    end if;
  end loop;
  if p_payload->'default_binding_months' is null and p_payload ? 'binding_months' then
    p_payload := p_payload || jsonb_build_object('default_binding_months',p_payload->'binding_months');
  end if;
  if p_payload->'default_notice_months' is null and p_payload ? 'notice_months' then
    p_payload := p_payload || jsonb_build_object('default_notice_months',p_payload->'notice_months');
  end if;
  -- Canonical pricing requires the price_areas array; those consumers send only
  -- the contract's single resolved price_area. Bridge only an absent canonical
  -- key: an explicit (even malformed) price_areas keeps its normal refusal path.
  if not (p_pricing_snapshot ? 'price_areas')
     and nullif(p_pricing_snapshot->>'price_area','') is not null then
    p_pricing_snapshot := p_pricing_snapshot
      || jsonb_build_object('price_areas',jsonb_build_array(p_pricing_snapshot->>'price_area'));
  end if;
  -- The contract's resolved price_area is authoritative for what it is billed
  -- on. An explicit canonical list that does not contain it would publish an
  -- offer for other areas, which no downstream check compares, so refuse it.
  -- A valid multi-area list that contains the resolved area stays eligible.
  if nullif(p_pricing_snapshot->>'price_area','') is not null
     and jsonb_typeof(p_pricing_snapshot->'price_areas')='array'
     and jsonb_array_length(p_pricing_snapshot->'price_areas')>0
     and not (p_pricing_snapshot->'price_areas' @> jsonb_build_array(p_pricing_snapshot->>'price_area')) then
    raise exception using
      errcode='23514',
      message='one_off_price_area_not_in_price_areas',
      detail=p_pricing_snapshot->>'price_area';
  end if;

  p_payload := p_payload || jsonb_build_object(
    'name',coalesce(nullif(p_payload->>'name',''),'Kundspecifikt avtal'),
    'slug','one-off-' || replace(v_identity::text,'-',''),
    'status','active',
    'is_active',true,
    'customer_type',coalesce(nullif(p_payload->>'customer_type',''),'both'),
    'contract_type',coalesce(nullif(p_payload->>'contract_type',''),'variable_hourly'),
    'campaign_code',coalesce(nullif(p_payload->>'campaign_code',''),'ONE_OFF'),
    'campaign_version',coalesce(nullif(p_payload->>'campaign_version',''),'v1'),
    'terms_version',coalesce(nullif(p_payload->>'terms_version',''),'canonical'),
    -- A one-off offer is sold (signed) now for a supply that may start later.
    -- The canonical sync keeps a future-valid offer's channel paused, which
    -- would block signing, so its sellable window opens today. The contract's
    -- own starts_at keeps the supply start; the price plan, valid from today,
    -- covers it.
    'valid_from',case when nullif(p_payload->>'valid_from','')::date > current_date
                      then current_date::text else p_payload->>'valid_from' end
  );
  p_pricing_snapshot := p_pricing_snapshot || jsonb_build_object(
    'one_off',true,
    'one_off_identity',v_identity,
    'source_of_truth','price_plan_versions'
  );

  v_saved := public.gridex_upsert_internal_contract_offer(
    p_company_id,null,p_payload,p_pricing_snapshot,p_actor_user_id
  );
  v_offer_id := nullif(v_saved#>>'{offer,id}','')::uuid;
  if v_offer_id is null then
    raise exception using errcode='P0001',message='one_off_offer_creation_failed';
  end if;

  -- The save above is always a draft. Publish it through the same permission-
  -- and readiness-gated command staff use for catalog versions; it promotes the
  -- pricing, materializes the legal bundle and locks the internal publication.
  -- A structured refusal is raised with its code and blockers.
  v_published := public.gridex_publish_internal_contract_version(
    p_company_id,v_offer_id,p_actor_user_id
  );
  if not coalesce((v_published->>'ok')::boolean,false) then
    raise exception using
      errcode='23514',
      message='one_off_publication_refused',
      detail=coalesce(v_published->>'code','unknown'),
      hint=coalesce(v_published->'blockers','[]'::jsonb)::text;
  end if;

  v_publication_id := public.gridex_ensure_internal_contract_publication(
    p_company_id,v_offer_id,p_actor_user_id
  );
  select * into v_publication
  from public.contract_publication_versions
  where id=v_publication_id and status='published' and locked_at is not null;
  if not found then
    raise exception using errcode='23514',message='one_off_publication_not_locked';
  end if;

  select * into v_product
  from public.contract_product_versions
  where id=v_publication.contract_product_version_id and status='approved' and locked_at is not null;
  if not found then
    raise exception using errcode='23514',message='one_off_product_version_not_locked';
  end if;
  select * into v_legal
  from public.legal_bundle_versions
  where id=v_publication.legal_bundle_version_id and status='published' and locked_at is not null;
  if not found or cardinality(v_legal.unresolved_variables)>0 then
    raise exception using errcode='23514',message='one_off_legal_version_not_ready';
  end if;

  update public.contract_offers
  set status='inactive',is_active=false,archived_at=coalesce(archived_at,now()),updated_at=now(),updated_by=p_actor_user_id
  where id=v_offer_id;

  -- Only this materializer may make an archived offer bindable, and only for
  -- the tenant it was created for. The reservation is consumed by the first
  -- contract that binds it.
  insert into gridex_one_off_offer_binding.reservations(offer_id,company_id,intended_contract_id)
  values (v_offer_id,p_company_id,v_intended_contract_id);

  return jsonb_build_object(
    'contract_offer_id',v_offer_id,
    'contract_product_id',v_product.contract_product_id,
    'contract_product_version_id',v_product.id,
    'contract_publication_version_id',v_publication.id,
    'price_plan_id',v_publication.price_plan_id,
    'price_plan_version_id',v_publication.price_plan_version_id,
    'price_book_id',v_publication.price_book_id,
    'legal_bundle_version_id',v_publication.legal_bundle_version_id,
    'offer_reference',v_publication.offer_reference,
    'commercial_snapshot',v_product.commercial_snapshot,
    'legal_snapshot',v_legal.rendered_snapshot,
    'source_of_truth','contract_publication_versions'
  );
end $$;

create or replace function public.gridex_enforce_contract_availability_and_capacity() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  o public.contract_offers%rowtype;
  v_count bigint;
  v_statuses text[]:=array['draft','pending_signature','signed','active'];
  v_reserved_one_off boolean:=false;
begin
  if new.status not in ('draft','pending_signature','signed','active') then
    return new;
  end if;
  if new.contract_offer_id is null and new.contract_product_id is null and new.contract_product_version_id is null then
    return new;
  end if;

  select * into o
  from public.contract_offers
  where company_id=new.company_id and (
    id=new.contract_offer_id
    or (new.contract_product_version_id is not null and contract_product_version_id=new.contract_product_version_id)
    or (new.contract_product_id is not null and contract_product_id=new.contract_product_id and lifecycle_status='published')
  )
  order by version_number desc limit 1 for update;
  if not found then
    raise exception using errcode='23514',message='contract_offer_not_available';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(o.version_series_id::text,0));

  -- A materializer-reserved one-off offer is bindable only by the contract that
  -- references it directly, in the same tenant, and only by one contract.
  if o.id=new.contract_offer_id then
    update gridex_one_off_offer_binding.reservations r
    set consumed_contract_id=new.id,consumed_at=coalesce(r.consumed_at,now())
    where r.offer_id=o.id and r.company_id=new.company_id
      and (r.consumed_contract_id is null or r.consumed_contract_id=new.id)
      and (r.intended_contract_id is null or r.intended_contract_id=new.id);
    v_reserved_one_off:=found;
  end if;

  if not v_reserved_one_off and (
     o.lifecycle_status<>'published' or not o.is_active
     or (o.valid_from is not null and o.valid_from>current_date)
     or (o.valid_to is not null and o.valid_to<current_date)) then
    raise exception using errcode='23514',message='contract_offer_not_available';
  end if;
  if not exists(
    select 1 from public.tenant_contract_assignments ta
    join public.tenant_contract_channels ch on ch.assignment_id=ta.id
    where ta.company_id=new.company_id
      and ta.contract_product_version_id=o.contract_product_version_id
      and ta.status='active'
      and ch.channel in ('internal','website','api','partner','phone') and ch.status='active'
      and (
        (ch.channel='internal' and ta.internal_sales_allowed)
        or (ch.channel='website' and ta.website_publication_allowed)
        or ch.channel in ('api','partner','phone')
      )
      and (ch.valid_from is null or ch.valid_from<=now())
      and (ch.valid_to is null or ch.valid_to>=now())
  ) then
    raise exception using errcode='23514',message='contract_channel_not_available';
  end if;

  if o.max_customers is not null then
    select count(*) into v_count
    from public.customer_contracts c
    where c.company_id=new.company_id and c.id is distinct from new.id
      and c.status=any(v_statuses) and (
        c.contract_offer_id=o.id
        or c.contract_product_id=o.contract_product_id
        or c.contract_product_version_id=o.contract_product_version_id
      );
    if v_count>=o.max_customers then
      raise exception using errcode='23514',message='contract_capacity_reached';
    end if;
  end if;
  return new;
end $$;

revoke all on function public.gridex_prepare_manual_contract_binding(uuid, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.gridex_prepare_manual_contract_binding(uuid, jsonb, jsonb, uuid) to service_role;
revoke all on function public.gridex_enforce_contract_availability_and_capacity() from public, anon, authenticated;
grant execute on function public.gridex_enforce_contract_availability_and_capacity() to service_role;

-- Signed-agreement import trigger: legal_bundle_versions has no legal_bundle_id
-- column (the canonical model stores the optional legacy bundle reference as
-- legacy_legal_bundle_id), so every import failed with 42703 when writing
-- customer_legal_acceptances. Byte-identical to 20261010200000 except that
-- one column reference.
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
  v_imported_at timestamptz := now();
  v_declared_signed_text text;
  v_declared_signed_date date;
  v_original_signature_timestamp timestamptz;
  v_timestamp_semantics text := 'administrative_import_time_original_signature_time_not_supplied';
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

  -- Staff declare the signing date of the uploaded signed agreement. When it
  -- is present it is the authoritative signing date; the import time is
  -- recorded separately as imported_at. Without it, the legacy import-time
  -- semantics apply unchanged.
  v_declared_signed_text := nullif(btrim(coalesce(new.metadata->>'declaredSignedDate', '')), '');
  if v_declared_signed_text is not null then
    if v_declared_signed_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception using
        errcode = '22007',
        message = 'admin_signed_contract_import_declared_signed_date_invalid';
    end if;
    begin
      v_declared_signed_date := v_declared_signed_text::date;
    exception when others then
      raise exception using
        errcode = '22007',
        message = 'admin_signed_contract_import_declared_signed_date_invalid';
    end;
    if v_declared_signed_date < date '2000-01-01'
       or v_declared_signed_date > (v_imported_at at time zone 'Europe/Stockholm')::date then
      raise exception using
        errcode = '22007',
        message = 'admin_signed_contract_import_declared_signed_date_out_of_range';
    end if;
    -- Same convention as the staff form: today uses the import instant (never
    -- a future instant); earlier dates use midday UTC so the calendar date is
    -- stable in Swedish time.
    v_accepted_at := case
      when v_declared_signed_date = (v_imported_at at time zone 'Europe/Stockholm')::date
        then v_imported_at
      else (v_declared_signed_date::timestamp + time '12:00') at time zone 'UTC'
    end;
    v_original_signature_timestamp := v_accepted_at;
    v_timestamp_semantics := 'staff_declared_signing_date_from_uploaded_signed_agreement';
  else
    v_accepted_at := coalesce(new.uploaded_at, v_imported_at);
  end if;
  v_signature := jsonb_build_object(
    'schema', 'gridex_imported_signed_contract_v1',
    'company_id', v_contract.company_id,
    'customer_id', v_contract.customer_id,
    'contract_id', v_contract.id,
    'channel', 'admin',
    'signing_method', 'imported_signed_document',
    'recorded_at', v_accepted_at,
    'original_signature_timestamp', v_original_signature_timestamp,
    'declared_signed_date', v_declared_signed_date,
    'imported_at', v_imported_at,
    'timestamp_semantics', v_timestamp_semantics,
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
    lbv.legacy_legal_bundle_id,
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
      'original_signature_timestamp', v_original_signature_timestamp,
      'declared_signed_date', v_declared_signed_date,
      'imported_at', v_imported_at,
      'timestamp_semantics', v_timestamp_semantics
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
        'original_signature_timestamp', v_original_signature_timestamp,
        'declared_signed_date', v_declared_signed_date,
        'imported_at', v_imported_at,
        'timestamp_semantics', v_timestamp_semantics
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

commit;
