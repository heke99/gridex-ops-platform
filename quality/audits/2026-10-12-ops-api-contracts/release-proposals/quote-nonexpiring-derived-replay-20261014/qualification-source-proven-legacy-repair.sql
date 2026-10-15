BEGIN;
CREATE OR REPLACE FUNCTION public.gridex_onboard_customer_graph_quote_commit_v2(p_command jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $function$
declare
  v_channel text := nullif(p_command->>'channel', '');
  v_company_id uuid := nullif(p_command->>'company_id', '')::uuid;
  v_quote_command jsonb := p_command->'quote';
  v_contract_command jsonb := p_command->'contract';
  v_quote public.website_contract_quotes%rowtype;
  v_application_id uuid;
  v_result jsonb;
  v_domain_event_id uuid;
  v_public_offer_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'canonical_onboarding_service_role_required';
  end if;

  if v_channel <> 'website' then
    return public.gridex_onboard_customer_graph_core(p_command);
  end if;

  if v_company_id is null
     or jsonb_typeof(coalesce(v_quote_command, 'null'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(v_contract_command, 'null'::jsonb)) <> 'object'
     or nullif(v_quote_command->>'quote_reference', '') is null
     or nullif(v_quote_command->>'quote_hash', '') is null
     or nullif(v_quote_command->>'application_id', '') is null then
    raise exception using
      errcode = '22023',
      message = 'website_onboarding_quote_commit_payload_required';
  end if;

  v_application_id := (v_quote_command->>'application_id')::uuid;
  v_public_offer_id :=
    nullif(v_contract_command->>'public_contract_offer_id', '')::uuid;

  select *
  into v_quote
  from public.website_contract_quotes quote
  where quote.company_id = v_company_id
    and quote.quote_reference = v_quote_command->>'quote_reference'
  for update;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'website_quote_not_found_for_tenant';
  end if;

  if v_quote.status = 'consumed'
     and v_quote.consumed_application_id = v_application_id then
    v_result := public.gridex_onboard_customer_graph_core(p_command);
    return v_result || jsonb_build_object(
      'quote_id', v_quote.id,
      'quote_status', 'consumed',
      'quote_existing', true
    );
  end if;
  if v_quote.status <> 'active' then
    raise exception using
      errcode = '23514',
      message = 'website_quote_not_active';
  end if;
  if v_quote.valid_until <= now() then
    raise exception using
      errcode = '23514',
      message = 'website_quote_expired';
  end if;
  if v_quote.quote_hash_version not in (
       'v2_full_quote',
       'v3_commercial_selection'
     )
     or v_quote.quote_hash is distinct from v_quote_command->>'quote_hash' then
    raise exception using
      errcode = '23514',
      message = 'website_quote_integrity_mismatch';
  end if;

  if v_quote.offer_reference is distinct from
       v_quote_command->>'offer_reference'
     or v_quote.offer_reference is distinct from
       v_contract_command->>'offer_reference'
     or v_quote.contract_product_id is distinct from
       nullif(v_contract_command->>'contract_product_id', '')::uuid
     or v_quote.contract_product_version_id is distinct from
       nullif(v_contract_command->>'contract_product_version_id', '')::uuid
     or v_quote.contract_publication_version_id is distinct from
       nullif(v_contract_command->>'contract_publication_version_id', '')::uuid
     or v_quote.price_plan_id is distinct from
       nullif(v_contract_command->>'price_plan_id', '')::uuid
     or v_quote.price_plan_version_id is distinct from
       nullif(v_contract_command->>'price_plan_version_id', '')::uuid
     or v_quote.price_book_id is distinct from
       nullif(v_contract_command->>'price_book_id', '')::uuid
     or v_quote.legal_bundle_version_id is distinct from
       nullif(v_contract_command->>'legal_bundle_version_id', '')::uuid
     or v_quote.energy_direction is distinct from
       v_contract_command->>'energy_direction' then
    raise exception using
      errcode = '23514',
      message = 'website_quote_contract_chain_mismatch';
  end if;

  if not exists (
    select 1
    from public.canonical_public_contract_offers_v offer
    where offer.company_id = v_company_id
      and offer.id = v_public_offer_id
      and offer.canonical_offer_reference = v_quote.offer_reference
      and offer.contract_product_id = v_quote.contract_product_id
      and offer.contract_product_version_id =
        v_quote.contract_product_version_id
      and offer.contract_publication_version_id =
        v_quote.contract_publication_version_id
      and offer.legal_bundle_version_id = v_quote.legal_bundle_version_id
      and offer.publication_status = 'published'
      and offer.lifecycle_status = 'published'
      and offer.is_public = true
      and offer.website_enabled = true
      and offer.website_cta_enabled = true
      and (offer.valid_from is null or offer.valid_from <= current_date)
      and (offer.valid_to is null or offer.valid_to >= current_date)
  ) then
    raise exception using
      errcode = '23514',
      message = 'website_quote_offer_no_longer_available';
  end if;

  if not exists (
    select 1
    from public.website_customer_applications application
    where application.id = v_application_id
      and application.company_id = v_company_id
      and application.status = 'processing'
      and p_command->'application'->>'source_record_id' =
        v_application_id::text
  ) then
    raise exception using
      errcode = '23514',
      message = 'website_application_reservation_invalid';
  end if;

  v_result := public.gridex_onboard_customer_graph_core(p_command);
  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception using
      errcode = '23514',
      message = 'website_onboarding_graph_not_committed';
  end if;
  if nullif(v_result->>'contract_id', '') is null
     or nullif(v_result->>'application_id', '') is null then
    raise exception using
      errcode = '23502',
      message = 'website_onboarding_graph_incomplete';
  end if;

  update public.website_contract_quotes
  set status = 'consumed',
      consumed_at = now(),
      consumed_application_id = v_application_id,
      updated_at = now()
  where id = v_quote.id
    and company_id = v_company_id
    and status = 'active';
  if not found then
    raise exception using
      errcode = '40001',
      message = 'website_quote_consume_race';
  end if;

  update public.website_customer_applications
  set customer_id = (v_result->>'customer_id')::uuid,
      customer_site_id = nullif(v_result->>'site_id', '')::uuid,
      metering_point_id =
        nullif(v_result->>'metering_point_id', '')::uuid,
      contract_id = (v_result->>'contract_id')::uuid,
      contract_number = nullif(v_result->>'contract_number', ''),
      quote_reference = v_quote.quote_reference,
      public_contract_offer_id = v_public_offer_id,
      contract_product_id = v_quote.contract_product_id,
      contract_product_version_id = v_quote.contract_product_version_id,
      contract_publication_version_id =
        v_quote.contract_publication_version_id,
      price_plan_id = v_quote.price_plan_id,
      price_plan_version_id = v_quote.price_plan_version_id,
      price_book_id = v_quote.price_book_id,
      legal_bundle_version_id = v_quote.legal_bundle_version_id,
      energy_direction = v_quote.energy_direction,
      updated_at = now()
  where id = v_application_id
    and company_id = v_company_id;

  insert into public.domain_events(
    company_id,
    event_type,
    aggregate_type,
    aggregate_id,
    actor_user_id,
    source,
    idempotency_key,
    payload
  ) values (
    v_company_id,
    'application.quote_committed',
    'website_customer_application',
    v_application_id,
    nullif(p_command->>'actor_user_id', '')::uuid,
    'gridex_onboard_customer_graph',
    'application-quote-commit:' || v_application_id::text,
    jsonb_build_object(
      'application_id', v_application_id,
      'quote_id', v_quote.id,
      'quote_reference', v_quote.quote_reference,
      'customer_id', v_result->>'customer_id',
      'contract_id', v_result->>'contract_id'
    )
  )
  on conflict do nothing
  returning id into v_domain_event_id;

  if v_domain_event_id is not null then
    insert into public.event_outbox(
      company_id,
      domain_event_id,
      destination_type,
      destination_key,
      payload
    ) values (
      v_company_id,
      v_domain_event_id,
      'internal',
      'application.quote_committed',
      jsonb_build_object(
        'domain_event_id', v_domain_event_id,
        'application_id', v_application_id,
        'quote_id', v_quote.id
      )
    ) on conflict do nothing;
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
    v_company_id,
    nullif(p_command->>'actor_user_id', '')::uuid,
    'website_customer_application',
    v_application_id,
    'application.quote_committed',
    jsonb_build_object('quote_status', 'active'),
    jsonb_build_object(
      'quote_status', 'consumed',
      'contract_id', v_result->>'contract_id'
    ),
    jsonb_build_object(
      'quote_id', v_quote.id,
      'idempotency_key', p_command->>'idempotency_key'
    )
  );

  return v_result || jsonb_build_object(
    'quote_id', v_quote.id,
    'quote_status', 'consumed',
    'quote_existing', false
  );
end
$function$;
-- OPS replay-only derived artifact; not an applied migration or ledger claim.
-- Immutable source: migrations/20261013093906_ops_api_website_quote_nonexpiring_policy.sql
-- Source SHA256: 7eceae42dccce7a968182d144389329d1c11466bf0c896afff62250950f9f2ce
-- Preserve the canonical already-complete quote policy, or perform exactly the
-- original legacy TTL removal. No quote row, deadline or historical SQL changes.

SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $ops_quote_nonexpiring_replay$
DECLARE
 target oid:=to_regprocedure('public.gridex_onboard_customer_graph_quote_commit_v2(jsonb)');
 before_function pg_catalog.pg_proc%rowtype;
 after_function pg_catalog.pg_proc%rowtype;
 definition text;
 body_hash text;
 expiry_block constant text:=$anchor$  if v_quote.valid_until <= now() then
    raise exception using
      errcode = '23514',
      message = 'website_quote_expired';
  end if;
$anchor$;
BEGIN
 SELECT * INTO STRICT before_function FROM pg_catalog.pg_proc WHERE oid=target;
 IF pg_catalog.pg_get_userbyid(before_function.proowner)<>'postgres'
 OR before_function.prokind<>'f' OR before_function.prorettype<>'jsonb'::regtype
 OR before_function.proargtypes<>ARRAY['jsonb'::regtype::oid]::oidvector
 OR before_function.pronargs<>1 OR before_function.proallargtypes IS NOT NULL
 OR before_function.proargmodes IS NOT NULL OR before_function.proargnames IS DISTINCT FROM ARRAY['p_command']::text[]
 OR before_function.pronargdefaults<>0 OR before_function.proargdefaults IS NOT NULL
 OR before_function.proretset OR NOT before_function.prosecdef OR before_function.proisstrict OR before_function.proleakproof
 OR before_function.provolatile<>'v' OR before_function.proparallel<>'u'
 OR before_function.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_catalog, pg_temp']::text[]
 OR before_function.proacl IS DISTINCT FROM ARRAY['postgres=X/postgres','service_role=X/postgres']::aclitem[]
 OR (SELECT lanname FROM pg_catalog.pg_language WHERE oid=before_function.prolang)<>'plpgsql'
 OR before_function.procost<>100 OR before_function.prorows<>0 OR before_function.provariadic<>0 OR before_function.prosupport<>0
 OR before_function.protrftypes IS NOT NULL OR before_function.probin IS NOT NULL OR before_function.prosqlbody IS NOT NULL
 THEN RAISE EXCEPTION 'ops_quote_replay_full_metadata_required'; END IF;
 definition:=pg_catalog.pg_get_functiondef(target);
 body_hash:=pg_catalog.md5(before_function.prosrc);
 IF body_hash='007d078d9d0065395edf2190d4f1d3b6' THEN
  IF pg_catalog.md5(definition)<>'fe9fcd88e137756d6b663b5bcaa7363f'
  OR strpos(before_function.prosrc,expiry_block)<>0
  OR strpos(before_function.prosrc,'website_quote_expired')<>0
  THEN RAISE EXCEPTION 'ops_quote_replay_canonical_nonexpiring_definition_required'; END IF;
  -- Verified no-op: no CREATE OR REPLACE and no business-row operation.
 ELSIF body_hash='4daec568bdaf10d1354ddd39145d0d94' THEN
  IF length(definition)-length(replace(definition,expiry_block,''))<>length(expiry_block)
  THEN RAISE EXCEPTION 'ops_quote_replay_exact_legacy_ttl_anchor_required'; END IF;
  definition:=replace(definition,expiry_block,'');
  IF pg_catalog.md5(definition)<>'fe9fcd88e137756d6b663b5bcaa7363f'
  THEN RAISE EXCEPTION 'ops_quote_replay_exact_canonical_transformation_required'; END IF;
  EXECUTE definition;
 ELSE RAISE EXCEPTION 'ops_quote_replay_unknown_predecessor';
 END IF;
 SELECT * INTO STRICT after_function FROM pg_catalog.pg_proc WHERE oid=target;
 IF (to_jsonb(after_function)-'prosrc') IS DISTINCT FROM (to_jsonb(before_function)-'prosrc')
 OR pg_catalog.md5(after_function.prosrc)<>'007d078d9d0065395edf2190d4f1d3b6'
 OR pg_catalog.md5(pg_catalog.pg_get_functiondef(target))<>'fe9fcd88e137756d6b663b5bcaa7363f'
 THEN RAISE EXCEPTION 'ops_quote_replay_function_identity_or_effect_changed'; END IF;
 IF body_hash='007d078d9d0065395edf2190d4f1d3b6' AND to_jsonb(after_function) IS DISTINCT FROM to_jsonb(before_function)
 THEN RAISE EXCEPTION 'ops_quote_replay_canonical_noop_changed'; END IF;
END $ops_quote_nonexpiring_replay$;


COMMIT;
