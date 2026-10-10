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
  v_offer_id uuid;
  v_publication_id uuid;
  v_publication public.contract_publication_versions%rowtype;
  v_product public.contract_product_versions%rowtype;
  v_legal public.legal_bundle_versions%rowtype;
begin
  if p_company_id is null then
    raise exception using errcode='22023',message='company_required';
  end if;

  p_payload := (coalesce(p_payload,'{}'::jsonb) - 'intended_contract_id') || jsonb_build_object(
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
  p_pricing_snapshot := coalesce(p_pricing_snapshot,'{}'::jsonb) || jsonb_build_object(
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

commit;
