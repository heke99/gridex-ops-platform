-- One-off manual contract binding: staff publish rights (owner decision 2026-10-11).
--
-- Staff holding contracts.create may create, send for signing and import
-- one-off contracts without the catalog rights contracts.publish and
-- pricing.publish. The exemption covers only the offer the materializer
-- creates, for its tenant and actor, inside the same transaction, through a
-- private authorization row no API role can write; it is deleted right after
-- the publish. Readiness gates are unchanged. Both functions are otherwise
-- byte-identical to 20260727030000 and 20261010230000 respectively.

create table gridex_one_off_offer_binding.publish_authorizations (
  offer_id uuid primary key references public.contract_offers(id) on delete cascade,
  company_id uuid not null,
  actor_user_id uuid,
  txid bigint not null
);
revoke all on table gridex_one_off_offer_binding.publish_authorizations from public, anon, authenticated, service_role;

create or replace function public.gridex_publish_internal_contract_version(
  p_company_id uuid,p_offer_id uuid,p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  o public.contract_offers%rowtype;
  v_readiness jsonb;
  v_pricing jsonb;
  v_canonical uuid;
begin
  -- Owner decision 2026-10-11: a one-off offer created by the manual-binding
  -- materializer in this same transaction is published under the creator's
  -- contracts.create right, which the materializer asserts. Every other
  -- publish keeps the catalog publish rights.
  if not exists (
    select 1 from gridex_one_off_offer_binding.publish_authorizations a
    where a.offer_id=p_offer_id and a.company_id=p_company_id
      and a.actor_user_id is not distinct from p_actor_user_id
      and a.txid=txid_current()
  ) then
    perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.publish');
    perform public.gridex_assert_contract_permission(p_actor_user_id,'pricing.publish');
  end if;

  select * into o
  from public.contract_offers
  where id=p_offer_id and company_id=p_company_id
  for update;
  if not found then
    return jsonb_build_object(
      'ok',false,'changed',false,'code','contract_offer_not_found',
      'blockers',jsonb_build_array(public.gridex_contract_readiness_blocker_v2(
        'contract_offer_not_found','contract_offer_id',
        'Avtalsversionen hittades inte för valt bolag.',to_jsonb(p_offer_id),
        'contract_offer',p_offer_id
      ))
    );
  end if;
  if o.lifecycle_status='published' then
    return jsonb_build_object(
      'ok',true,'changed',false,'mode','published','code','contract_already_published',
      'offer',to_jsonb(o),'blockers','[]'::jsonb
    );
  end if;
  if o.lifecycle_status not in ('draft','ready','paused') then
    return jsonb_build_object(
      'ok',false,'changed',false,'code','contract_version_not_publishable',
      'lifecycle_status',o.lifecycle_status,
      'blockers',jsonb_build_array(public.gridex_contract_readiness_blocker_v2(
        'lifecycle_status_not_publishable','lifecycle_status',
        'Endast draft, ready eller paused kan publiceras som en immutable avtalsversion.',
        to_jsonb(o.lifecycle_status),'contract_offer',o.id
      ))
    );
  end if;

  v_readiness:=public.gridex_validate_contract_readiness_v2(
    p_company_id,o.id,'publish_version',null
  );
  if not coalesce((v_readiness->>'can_execute')::boolean,false) then
    return jsonb_build_object(
      'ok',false,'changed',false,'code','contract_version_not_publishable',
      'lifecycle_status',o.lifecycle_status,
      'blockers',coalesce(v_readiness->'blockers','[]'::jsonb),
      'readiness',v_readiness
    );
  end if;

  -- Pricing promotion can write canonical pricing rows. Keep it inside a
  -- subtransaction so an identity mismatch returns a structured business
  -- result without leaving orphaned price versions or books behind.
  begin
    v_pricing:=public.gridex_create_or_version_contract_pricing(
      p_company_id,o.name,o.contract_type,
      coalesce(o.commercial_snapshot->>'pricing_model',o.contract_type),
      o.customer_type,coalesce(o.commercial_snapshot,'{}'::jsonb)-'lifecycle_status',
      o.valid_from,o.valid_to,true,p_actor_user_id
    );

    if (v_pricing->>'price_plan_version_id')::uuid is distinct from o.price_plan_version_id
       or nullif(v_pricing->>'price_book_id','')::uuid is distinct from o.price_book_id then
      raise exception using
        errcode='P0001',
        message='contract_pricing_identity_changed_during_publish';
    end if;
  exception
    when raise_exception then
      if sqlerrm='contract_pricing_identity_changed_during_publish' then
        return jsonb_build_object(
          'ok',false,'changed',false,'code','contract_pricing_identity_changed_during_publish',
          'blockers',jsonb_build_array(public.gridex_contract_readiness_blocker_v2(
            'contract_pricing_identity_changed_during_publish','price_plan_version_id',
            'Publicering försökte byta den immutable prisidentiteten. Skapa en ny avtalsversion i stället.',
            to_jsonb(o.price_plan_version_id),'contract_offer',o.id
          ))
        );
      end if;
      raise;
  end;

  begin
    update public.contract_offers
    set lifecycle_status='published',status='active',is_active=true,
        price_plan_id=(v_pricing->>'price_plan_id')::uuid,
        price_plan_version_id=(v_pricing->>'price_plan_version_id')::uuid,
        price_book_id=nullif(v_pricing->>'price_book_id','')::uuid,
        updated_by=p_actor_user_id,updated_at=now()
    where id=o.id
    returning * into o;

    v_canonical:=public.gridex_sync_internal_offer_to_canonical(o.id);
  exception
    when check_violation then
      if sqlerrm='internal_offer_legal_documents_not_ready' then
        return jsonb_build_object(
          'ok',false,'changed',false,'code','contract_version_not_publishable',
          'blockers',jsonb_build_array(public.gridex_contract_readiness_blocker_v2(
            'unresolved_legal_variables','legal_bundle_version_id',
            'Juridikmaterialiseringen innehåller olösta variabler.',null,
            'contract_offer',o.id
          )),
          'readiness',v_readiness
        );
      end if;
      raise;
  end;
  select * into o from public.contract_offers where id=o.id;

  update public.contract_offers predecessor
  set lifecycle_status=case when exists(
        select 1 from public.tenant_contract_assignments ta
        join public.tenant_contract_channels ch on ch.assignment_id=ta.id
        where ta.company_id=p_company_id
          and ta.contract_product_version_id=predecessor.contract_product_version_id
          and ta.status='active' and ch.status='active'
          and (ch.valid_from is null or ch.valid_from<=now())
          and (ch.valid_to is null or ch.valid_to>=now())
      ) then 'published' else 'superseded' end,
      status=case when exists(
        select 1 from public.tenant_contract_assignments ta
        join public.tenant_contract_channels ch on ch.assignment_id=ta.id
        where ta.company_id=p_company_id
          and ta.contract_product_version_id=predecessor.contract_product_version_id
          and ta.status='active' and ch.status='active'
          and (ch.valid_from is null or ch.valid_from<=now())
          and (ch.valid_to is null or ch.valid_to>=now())
      ) then 'active' else 'inactive' end,
      is_active=exists(
        select 1 from public.tenant_contract_assignments ta
        join public.tenant_contract_channels ch on ch.assignment_id=ta.id
        where ta.company_id=p_company_id
          and ta.contract_product_version_id=predecessor.contract_product_version_id
          and ta.status='active' and ch.status='active'
          and (ch.valid_from is null or ch.valid_from<=now())
          and (ch.valid_to is null or ch.valid_to>= now())
      ),
      superseded_at=case when exists(
        select 1 from public.tenant_contract_assignments ta
        join public.tenant_contract_channels ch on ch.assignment_id=ta.id
        where ta.company_id=p_company_id
          and ta.contract_product_version_id=predecessor.contract_product_version_id
          and ta.status='active' and ch.status='active'
      ) then predecessor.superseded_at else coalesce(predecessor.superseded_at,now()) end,
      updated_by=p_actor_user_id,updated_at=now()
  where predecessor.company_id=p_company_id
    and predecessor.version_series_id=o.version_series_id
    and predecessor.id<>o.id
    and predecessor.lifecycle_status in ('published','paused','ready','draft');

  insert into public.audit_logs(
    company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata
  ) values(
    p_company_id,p_actor_user_id,'contract_offer',o.id::text,
    'contract.version.published',null,to_jsonb(o),
    jsonb_build_object(
      'version_series_id',o.version_series_id,
      'contract_product_id',o.contract_product_id,
      'contract_product_version_id',v_canonical,
      'price_plan_version_id',o.price_plan_version_id,
      'price_book_id',o.price_book_id,
      'readiness',v_readiness
    )
  );

  return jsonb_build_object(
    'ok',true,'changed',true,'mode','published','code','contract_version_published',
    'offer',to_jsonb(o),
    'contract_product_id',o.contract_product_id,
    'contract_product_version_id',v_canonical,
    'price_plan_version_id',o.price_plan_version_id,
    'price_book_id',o.price_book_id,
    'readiness',v_readiness
  );
end $$;


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
  -- Staff who may create contracts may sell a one-off contract without the
  -- catalog publish rights: authorize exactly this new offer, for this actor,
  -- in this transaction, and withdraw the authorization right after.
  perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.create');
  insert into gridex_one_off_offer_binding.publish_authorizations(offer_id,company_id,actor_user_id,txid)
  values (v_offer_id,p_company_id,p_actor_user_id,txid_current());
  v_published := public.gridex_publish_internal_contract_version(
    p_company_id,v_offer_id,p_actor_user_id
  );
  delete from gridex_one_off_offer_binding.publish_authorizations where offer_id=v_offer_id;
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

revoke all on function public.gridex_publish_internal_contract_version(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.gridex_publish_internal_contract_version(uuid,uuid,uuid)
  to service_role;
revoke all on function public.gridex_prepare_manual_contract_binding(uuid, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.gridex_prepare_manual_contract_binding(uuid, jsonb, jsonb, uuid) to service_role;
