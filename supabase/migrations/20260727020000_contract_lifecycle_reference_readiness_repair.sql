-- GRIDEX OPS: contract lifecycle reference/readiness repair.
--
-- Forward-only migration. Repairs the final runtime definitions without
-- modifying historical migrations.
--
-- Canonical offer identity:
--   contract_publication_versions.offer_reference
--   (public_contract_offers only carries the compatibility value in metadata).
--
-- This migration also makes publication/readiness and delete-preview failures
-- structured and safe to render in both superadmin entry points.

begin;

create or replace function public.gridex_contract_offer_references_v1(
  p_company_id uuid,
  p_public_offer_ids uuid[] default '{}'::uuid[],
  p_product_version_ids uuid[] default '{}'::uuid[],
  p_publication_version_ids uuid[] default '{}'::uuid[]
) returns text[]
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select coalesce(array_agg(reference order by reference),'{}'::text[])
  from (
    select distinct nullif(btrim(cpv.offer_reference),'') as reference
    from public.contract_publication_versions cpv
    join public.contract_publications cp
      on cp.id=cpv.contract_publication_id
    join public.tenant_contract_assignments ta
      on ta.id=cp.assignment_id
    where ta.company_id=p_company_id
      and (
        cpv.id=any(coalesce(p_publication_version_ids,'{}'::uuid[]))
        or cpv.contract_product_version_id=any(coalesce(p_product_version_ids,'{}'::uuid[]))
        or cpv.legacy_public_contract_offer_id=any(coalesce(p_public_offer_ids,'{}'::uuid[]))
      )

    union

    select distinct coalesce(
      nullif(btrim(pco.metadata->>'offer_reference'),''),
      nullif(btrim(pco.metadata->>'canonical_offer_reference'),'')
    ) as reference
    from public.public_contract_offers pco
    where pco.company_id=p_company_id
      and (
        pco.id=any(coalesce(p_public_offer_ids,'{}'::uuid[]))
        or pco.contract_product_version_id=any(coalesce(p_product_version_ids,'{}'::uuid[]))
      )
  ) refs
  where reference is not null
$$;

revoke all on function public.gridex_contract_offer_references_v1(
  uuid,uuid[],uuid[],uuid[]
) from public,anon,authenticated;
grant execute on function public.gridex_contract_offer_references_v1(
  uuid,uuid[],uuid[],uuid[]
) to service_role;

create or replace function public.gridex_contract_readiness_blocker_details_v1(
  p_blockers text[]
) returns jsonb
language sql
immutable
security invoker
set search_path=public,pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'code',b.code,
        'field',case b.code
          when 'contract_offer_not_found' then 'contract_offer_id'
          when 'lifecycle_status_not_publishable' then 'lifecycle_status'
          when 'name_missing' then 'name'
          when 'canonical_product_missing' then 'contract_product_id'
          when 'canonical_product_version_missing' then 'contract_product_version_id'
          when 'canonical_product_version_mismatch' then 'contract_product_version_id'
          when 'tenant_assignment_missing' then 'tenant_contract_assignment_id'
          when 'internal_channel_missing' then 'internal_channel'
          when 'price_plan_missing' then 'price_plan_id'
          when 'price_plan_version_missing' then 'price_plan_version_id'
          when 'price_book_missing' then 'price_book_id'
          when 'invoice_fee_missing' then 'invoice_fee_sek'
          when 'invoice_fee_invalid' then 'invoice_fee_sek'
          when 'vat_rate_invalid' then 'vat_rate'
          when 'fixed_price_missing' then 'fixed_price_ore_per_kwh'
          when 'price_areas_missing' then 'commercial_snapshot.price_areas'
          when 'duplicate_price_areas' then 'commercial_snapshot.price_areas'
          when 'resolution_missing' then 'commercial_snapshot.interval_resolution'
          when 'resolution_mismatch' then 'commercial_snapshot.interval_resolution'
          when 'invalid_validity_period' then 'valid_to'
          when 'invalid_max_customers' then 'max_customers'
          when 'automatic_renewal_term_missing' then 'automatic_renewal_term_months'
          when 'discount_months_missing' then 'discount_months'
          when 'portfolio_id_missing' then 'commercial_snapshot.portfolio_method.portfolio_id'
          when 'pricing_weights_invalid' then 'commercial_snapshot.portfolio_method.mix_shares'
          when 'production_settlement_mode_missing' then 'commercial_snapshot.production.settlement_mode'
          when 'tenant_go_live_not_ready' then 'company_id'
          when 'tenant_legal_profile_not_ready' then 'tenant_legal_profile'
          when 'required_legal_modules_missing' then 'legal_bundle'
          else null
        end,
        'message',case b.code
          when 'contract_offer_not_found' then 'Avtalsversionen hittades inte för valt bolag.'
          when 'lifecycle_status_not_publishable' then 'Nuvarande lifecycle-status kan inte publiceras. Skapa eller öppna ett draft, ready eller paused-utkast.'
          when 'name_missing' then 'Internt avtalsnamn saknas.'
          when 'canonical_product_missing' then 'Canonical avtalsprodukt saknas.'
          when 'canonical_product_version_missing' then 'Canonical immutable avtalsversion saknas.'
          when 'canonical_product_version_mismatch' then 'Avtalsversionen tillhör inte vald canonical produkt.'
          when 'tenant_assignment_missing' then 'Aktiv tenanttilldelning till exakt avtalsversion saknas.'
          when 'internal_channel_missing' then 'Intern försäljningskanal saknas för tenanttilldelningen.'
          when 'price_plan_missing' then 'Prisplan saknas.'
          when 'price_plan_version_missing' then 'Låst prisversion saknas.'
          when 'price_book_missing' then 'Prisbok eller prissnapshot saknas.'
          when 'invoice_fee_missing' then 'Fakturaavgiften måste vara explicit angiven, även när den är 0.'
          when 'invoice_fee_invalid' then 'Fakturaavgiften får inte vara negativ.'
          when 'vat_rate_invalid' then 'Moms måste ligga mellan 0 och 1.'
          when 'fixed_price_missing' then 'Fastprisavtal saknar ett positivt pris per kWh.'
          when 'price_areas_missing' then 'Minst ett tillåtet elområde måste anges.'
          when 'duplicate_price_areas' then 'Elområdeslistan innehåller dubbletter.'
          when 'resolution_missing' then 'Prisupplösning saknas i den immutable kommersiella snapshoten.'
          when 'resolution_mismatch' then 'Prisupplösningen matchar inte vald avtalsmodell.'
          when 'invalid_validity_period' then 'Giltig till ligger före giltig från.'
          when 'invalid_max_customers' then 'Max antal kunder måste vara större än 0.'
          when 'automatic_renewal_term_missing' then 'Automatisk förlängning saknar förlängningsperiod.'
          when 'discount_months_missing' then 'Rabattvärde finns men rabattperiod saknas.'
          when 'portfolio_id_missing' then 'Portfölj- eller mixavtal saknar portfölj-ID.'
          when 'pricing_weights_invalid' then 'Spot-, portfölj- och fastvikter måste summera till 100 procent.'
          when 'production_settlement_mode_missing' then 'Produktionsavtalet saknar avräkningsmodell.'
          when 'tenant_go_live_not_ready' then 'Tenantens produktionsrouting, BRP eller avsändaridentitet är inte komplett.'
          when 'tenant_legal_profile_not_ready' then 'Tenantens juridiska profil är inte komplett och granskad.'
          when 'required_legal_modules_missing' then 'Ett eller flera obligatoriska juridikmoduler saknar publicerad låst version.'
          else b.code
        end
      ))
      order by b.ordinal
    ),
    '[]'::jsonb
  )
  from unnest(coalesce(p_blockers,'{}'::text[])) with ordinality b(code,ordinal)
$$;

grant execute on function public.gridex_contract_readiness_blocker_details_v1(text[])
  to authenticated,service_role;

create or replace function public.gridex_contract_delete_blocker_details_v1(
  p_reason_codes text[],
  p_business jsonb,
  p_quote_count bigint,
  p_counts jsonb,
  p_foreign_key_blockers jsonb
) returns jsonb
language sql
immutable
security invoker
set search_path=public,pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'resource_type',case b.code
          when 'HAS_CUSTOMER_CONTRACTS' then 'customer_contract'
          when 'HAS_ACCEPTED_APPLICATIONS' then 'customer_application'
          when 'HAS_EXTERNAL_INTAKES' then 'external_intake'
          when 'HAS_BINDING_PRICE_SNAPSHOTS' then 'contract_price_snapshot'
          when 'HAS_INVOICES' then 'customer_invoice'
          when 'HAS_BILLING_HISTORY' then 'billing_underlay'
          when 'HAS_CHARGE_LEDGER' then 'charge_ledger'
          when 'HAS_LEGAL_ACCEPTANCES' then 'customer_contract_acceptance'
          when 'HAS_WEBSITE_QUOTES' then 'website_quote'
          when 'HAS_SUCCESSOR_VERSION' then 'successor_contract_version'
          when 'HAS_SHARED_CANONICAL_VERSION' then 'shared_contract_product_version'
          when 'HAS_SHARED_LEGAL_VERSION' then 'shared_legal_bundle_version'
          when 'PUBLICATION_GRAPH_INCONSISTENT' then 'publication_graph'
          when 'PERMANENT_DELETE_REQUIRES_DRAFT' then 'contract_lifecycle'
          when 'HAS_RESTRICTING_FOREIGN_KEYS' then 'foreign_key'
          else lower(b.code)
        end,
        'count',case b.code
          when 'HAS_CUSTOMER_CONTRACTS' then coalesce((p_business->>'customer_contracts')::bigint,0)
          when 'HAS_ACCEPTED_APPLICATIONS' then coalesce((p_business->>'customer_applications')::bigint,0)
          when 'HAS_EXTERNAL_INTAKES' then coalesce((p_business->>'external_intakes')::bigint,0)
          when 'HAS_BINDING_PRICE_SNAPSHOTS' then coalesce((p_business->>'binding_price_snapshots')::bigint,0)
          when 'HAS_INVOICES' then coalesce((p_business->>'invoices')::bigint,0)
          when 'HAS_BILLING_HISTORY' then coalesce((p_business->>'billing_underlays')::bigint,0)+coalesce((p_business->>'billing_underlay_items')::bigint,0)
          when 'HAS_CHARGE_LEDGER' then coalesce((p_business->>'charge_ledger')::bigint,0)
          when 'HAS_LEGAL_ACCEPTANCES' then coalesce((p_business->>'legal_acceptances')::bigint,0)
          when 'HAS_WEBSITE_QUOTES' then coalesce(p_quote_count,0)
          when 'HAS_SUCCESSOR_VERSION' then coalesce((p_counts->>'successor_offers')::bigint,0)
          when 'HAS_SHARED_CANONICAL_VERSION' then coalesce((p_counts->>'shared_product_version_references')::bigint,0)
          when 'HAS_SHARED_LEGAL_VERSION' then coalesce((p_counts->>'shared_legal_version_references')::bigint,0)
          when 'PUBLICATION_GRAPH_INCONSISTENT' then coalesce((p_counts->>'unsafe_graph_issues')::bigint,0)
          when 'HAS_RESTRICTING_FOREIGN_KEYS' then coalesce((p_foreign_key_blockers->>'count')::bigint,0)
          else 1
        end,
        'reason',b.code,
        'message',case b.code
          when 'HAS_CUSTOMER_CONTRACTS' then 'Signerade eller aktiva kundavtal måste bevaras.'
          when 'HAS_ACCEPTED_APPLICATIONS' then 'En eller flera kundansökningar refererar till avtalet.'
          when 'HAS_EXTERNAL_INTAKES' then 'Externa kundintag refererar till avtalet.'
          when 'HAS_BINDING_PRICE_SNAPSHOTS' then 'Bindande prissnapshots måste bevaras.'
          when 'HAS_INVOICES' then 'Fakturahistorik refererar till avtalet.'
          when 'HAS_BILLING_HISTORY' then 'Faktureringsunderlag refererar till avtalet.'
          when 'HAS_CHARGE_LEDGER' then 'Avgiftsliggaren refererar till avtalet.'
          when 'HAS_LEGAL_ACCEPTANCES' then 'Juridiska accepter måste bevaras.'
          when 'HAS_WEBSITE_QUOTES' then 'Utfärdade website-offerter måste bevaras.'
          when 'HAS_SUCCESSOR_VERSION' then 'Avtalsversionen har en efterföljande version.'
          when 'HAS_SHARED_CANONICAL_VERSION' then 'Canonical avtalsversion delas av annan data.'
          when 'HAS_SHARED_LEGAL_VERSION' then 'Juridikversionen delas av annan data.'
          when 'PUBLICATION_GRAPH_INCONSISTENT' then 'Publiceringsgrafen är inkonsekvent och måste repareras.'
          when 'PERMANENT_DELETE_REQUIRES_DRAFT' then 'Permanent radering tillåts endast för draft eller ready.'
          when 'HAS_RESTRICTING_FOREIGN_KEYS' then 'Skyddade foreign keys refererar fortfarande till publiceringen.'
          else b.code
        end
      ))
      order by b.ordinal
    ),
    '[]'::jsonb
  )
  from unnest(coalesce(p_reason_codes,'{}'::text[])) with ordinality b(code,ordinal)
$$;

grant execute on function public.gridex_contract_delete_blocker_details_v1(
  text[],jsonb,bigint,jsonb,jsonb
) to authenticated,service_role;

create or replace function public.gridex_validate_contract_readiness(
  p_company_id uuid,p_contract_offer_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  o public.contract_offers%rowtype;
  v_blockers text[]:='{}'::text[];
  v_snapshot jsonb;
  v_required_modules text[];
  v_production_enabled boolean:=false;
  v_resolution text;
  v_expected_resolution text;
  v_blocker_details jsonb:='[]'::jsonb;
begin
  select * into o from public.contract_offers
  where id=p_contract_offer_id and company_id=p_company_id;
  if not found then
    return jsonb_build_object(
      'status','blocked','can_publish',false,
      'blockers',jsonb_build_array('contract_offer_not_found'),
      'blocker_details',public.gridex_contract_readiness_blocker_details_v1(array['contract_offer_not_found']::text[])
    );
  end if;

  v_snapshot:=coalesce(o.commercial_snapshot,'{}'::jsonb);
  v_production_enabled:=coalesce((v_snapshot#>>'{production,enabled}')::boolean,false);
  v_resolution:=lower(nullif(btrim(coalesce(
    v_snapshot->>'interval_resolution',
    v_snapshot#>>'{pricing,interval_resolution}',
    v_snapshot->>'resolution'
  )),''));
  v_expected_resolution:=case
    when o.contract_type in ('variable_monthly','spot') then 'monthly'
    when o.contract_type='variable_hourly' then 'hourly'
    when o.contract_type='variable_quarterly' then 'quarterly'
    when o.contract_type='fixed' then 'fixed'
    when o.contract_type='portfolio' then 'portfolio'
    else null
  end;
  v_required_modules:=public.gridex_required_legal_modules(
    o.customer_type,o.contract_type,'internal',coalesce(o.automatic_renewal,false),
    coalesce(o.power_of_attorney_required,true),v_production_enabled
  );

  if o.lifecycle_status not in ('draft','ready','paused') then v_blockers:=array_append(v_blockers,'lifecycle_status_not_publishable'); end if;
  if nullif(btrim(o.name),'') is null then v_blockers:=array_append(v_blockers,'name_missing'); end if;
  if o.contract_product_id is null then v_blockers:=array_append(v_blockers,'canonical_product_missing'); end if;
  if o.contract_product_version_id is null then
    v_blockers:=array_append(v_blockers,'canonical_product_version_missing');
  elsif not exists(
    select 1 from public.contract_product_versions cpv
    where cpv.id=o.contract_product_version_id
      and cpv.contract_product_id=o.contract_product_id
  ) then
    v_blockers:=array_append(v_blockers,'canonical_product_version_mismatch');
  end if;
  if o.contract_product_version_id is not null and not exists(
    select 1 from public.tenant_contract_assignments ta
    where ta.company_id=p_company_id
      and ta.contract_product_version_id=o.contract_product_version_id
      and ta.status in ('active','paused')
  ) then v_blockers:=array_append(v_blockers,'tenant_assignment_missing'); end if;
  if o.contract_product_version_id is not null and not exists(
    select 1
    from public.tenant_contract_assignments ta
    join public.tenant_contract_channels ch on ch.assignment_id=ta.id
    where ta.company_id=p_company_id
      and ta.contract_product_version_id=o.contract_product_version_id
      and ch.channel='internal'
      and ch.status in ('active','paused')
  ) then v_blockers:=array_append(v_blockers,'internal_channel_missing'); end if;
  if o.price_plan_id is null then v_blockers:=array_append(v_blockers,'price_plan_missing'); end if;
  if o.price_plan_version_id is null then v_blockers:=array_append(v_blockers,'price_plan_version_missing'); end if;
  if o.price_book_id is null then v_blockers:=array_append(v_blockers,'price_book_missing'); end if;
  if o.invoice_fee_sek is null then v_blockers:=array_append(v_blockers,'invoice_fee_missing'); end if;
  if o.invoice_fee_sek is not null and o.invoice_fee_sek<0 then v_blockers:=array_append(v_blockers,'invoice_fee_invalid'); end if;
  if o.vat_rate is null or o.vat_rate<0 or o.vat_rate>1 then v_blockers:=array_append(v_blockers,'vat_rate_invalid'); end if;
  if o.contract_type='fixed' and (o.fixed_price_ore_per_kwh is null or o.fixed_price_ore_per_kwh<=0) then v_blockers:=array_append(v_blockers,'fixed_price_missing'); end if;
  if jsonb_array_length(
       case when jsonb_typeof(v_snapshot->'price_areas')='array'
         then v_snapshot->'price_areas' else '[]'::jsonb end
     )=0 then
    v_blockers:=array_append(v_blockers,'price_areas_missing');
  elsif (select count(*) from jsonb_array_elements_text(v_snapshot->'price_areas'))
        <> (select count(distinct upper(value)) from jsonb_array_elements_text(v_snapshot->'price_areas')) then
    v_blockers:=array_append(v_blockers,'duplicate_price_areas');
  end if;
  if v_resolution is null then
    v_blockers:=array_append(v_blockers,'resolution_missing');
  elsif v_expected_resolution is not null and v_resolution<>v_expected_resolution then
    v_blockers:=array_append(v_blockers,'resolution_mismatch');
  elsif o.contract_type='mixed' and v_resolution not in ('monthly','hourly','quarterly') then
    v_blockers:=array_append(v_blockers,'resolution_mismatch');
  end if;
  if v_production_enabled and nullif(v_snapshot#>>'{production,settlement_mode}','') is null then
    v_blockers:=array_append(v_blockers,'production_settlement_mode_missing');
  end if;
  if o.valid_from is not null and o.valid_to is not null and o.valid_to<o.valid_from then v_blockers:=array_append(v_blockers,'invalid_validity_period'); end if;
  if o.max_customers is not null and o.max_customers<=0 then v_blockers:=array_append(v_blockers,'invalid_max_customers'); end if;
  if coalesce(o.automatic_renewal,false) and o.automatic_renewal_term_months is null then v_blockers:=array_append(v_blockers,'automatic_renewal_term_missing'); end if;
  if o.discount_value is not null and o.discount_months is null then v_blockers:=array_append(v_blockers,'discount_months_missing'); end if;
  if o.contract_type in ('portfolio','mixed') and nullif(v_snapshot#>>'{portfolio_method,portfolio_id}','') is null then v_blockers:=array_append(v_blockers,'portfolio_id_missing'); end if;
  if o.contract_type in ('portfolio','mixed') and coalesce((v_snapshot#>>'{portfolio_method,mix_shares,spot_weight_percent}')::numeric,0)
      +coalesce((v_snapshot#>>'{portfolio_method,mix_shares,portfolio_weight_percent}')::numeric,0)
      +coalesce((v_snapshot#>>'{portfolio_method,mix_shares,fixed_weight_percent}')::numeric,0)<>100 then
    v_blockers:=array_append(v_blockers,'pricing_weights_invalid');
  end if;
  if not exists(
    select 1 from public.platform_go_live_readiness_v readiness
    where readiness.company_id=p_company_id
      and readiness.has_actor_setting
      and readiness.has_brp
      and readiness.has_prodat_route
      and readiness.has_utilts_route
      and readiness.has_sender_identity
  ) then v_blockers:=array_append(v_blockers,'tenant_go_live_not_ready'); end if;
  if not exists(
    select 1 from public.tenant_legal_profiles lp
    where lp.company_id=p_company_id
      and lp.completeness_status in ('complete','verified')
      and not coalesce(lp.review_required,false)
  ) then v_blockers:=array_append(v_blockers,'tenant_legal_profile_not_ready'); end if;
  if exists(
    select 1 from unnest(v_required_modules) as required(module_key)
    where not exists(
      select 1 from public.legal_templates lt
      join public.legal_template_versions ltv on ltv.legal_template_id=lt.id
      where lt.module_key=required.module_key and lt.status='active'
        and ltv.status='published' and ltv.locked_at is not null
    )
  ) then v_blockers:=array_append(v_blockers,'required_legal_modules_missing'); end if;

  v_blocker_details:=public.gridex_contract_readiness_blocker_details_v1(v_blockers);

  return jsonb_build_object(
    'status',case when cardinality(v_blockers)=0 then 'ready' else 'blocked' end,
    'can_publish',cardinality(v_blockers)=0,
    'blockers',to_jsonb(v_blockers),
    'blocker_details',v_blocker_details,
    'resolution',v_resolution,
    'expected_resolution',v_expected_resolution,
    'energy_direction',case when v_production_enabled then 'production' else 'consumption' end,
    'required_legal_modules',to_jsonb(v_required_modules),
    'evaluated_at',now()
  );
end $$;

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
  perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.publish');
  perform public.gridex_assert_contract_permission(p_actor_user_id,'pricing.publish');

  select * into o
  from public.contract_offers
  where id=p_offer_id and company_id=p_company_id
  for update;
  if not found then
    return jsonb_build_object(
      'ok',false,'changed',false,'code','contract_offer_not_found',
      'blockers',jsonb_build_array(jsonb_build_object(
        'code','contract_offer_not_found','field','contract_offer_id',
        'message','Avtalsversionen hittades inte för valt bolag.'
      ))
    );
  end if;
  if o.lifecycle_status='published' then
    return jsonb_build_object(
      'ok',true,'changed',false,'mode','published',
      'code','contract_already_published','offer',to_jsonb(o),
      'blockers','[]'::jsonb
    );
  end if;

  v_readiness:=public.gridex_validate_contract_readiness(p_company_id,o.id);
  if o.lifecycle_status not in ('draft','ready','paused')
     or not coalesce((v_readiness->>'can_publish')::boolean,false) then
    return jsonb_build_object(
      'ok',false,'changed',false,'code','contract_version_not_publishable',
      'lifecycle_status',o.lifecycle_status,
      'blocker_codes',coalesce(v_readiness->'blockers','[]'::jsonb),
      'blockers',coalesce(v_readiness->'blocker_details','[]'::jsonb),
      'readiness',v_readiness
    );
  end if;

  -- Reuse the draft's exact immutable commercial hash and promote the same
  -- pricing version/book. A lifecycle change must never create a new price.
  v_pricing:=public.gridex_create_or_version_contract_pricing(
    p_company_id,o.name,o.contract_type,
    coalesce(o.commercial_snapshot->>'pricing_model',o.contract_type),
    o.customer_type,coalesce(o.commercial_snapshot,'{}'::jsonb)-'lifecycle_status',
    o.valid_from,o.valid_to,true,p_actor_user_id
  );

  if (v_pricing->>'price_plan_version_id')::uuid is distinct from o.price_plan_version_id
     or nullif(v_pricing->>'price_book_id','')::uuid is distinct from o.price_book_id then
    raise exception using errcode='23514',message='contract_pricing_identity_changed_during_publish';
  end if;

  update public.contract_offers
  set lifecycle_status='published',status='active',is_active=true,
      price_plan_id=(v_pricing->>'price_plan_id')::uuid,
      price_plan_version_id=(v_pricing->>'price_plan_version_id')::uuid,
      price_book_id=nullif(v_pricing->>'price_book_id','')::uuid,
      updated_by=p_actor_user_id,updated_at=now()
  where id=o.id
  returning * into o;

  v_canonical:=public.gridex_sync_internal_offer_to_canonical(o.id);
  select * into o from public.contract_offers where id=o.id;

  -- Only now, after pricing/legal/canonical publication succeeded, retire the
  -- predecessor. Existing customer contracts remain bound to their old IDs.
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
          and (ch.valid_to is null or ch.valid_to>=now())
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
    'ok',true,'changed',true,'mode','published','offer',to_jsonb(o),
    'contract_product_id',o.contract_product_id,
    'contract_product_version_id',v_canonical,
    'price_plan_version_id',o.price_plan_version_id,
    'price_book_id',o.price_book_id,
    'readiness',v_readiness
  );
end $$;

create or replace function public.gridex_preview_delete_unused_contract(
  p_company_id uuid,
  p_offer_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  o public.contract_offers%rowtype;
  v_business jsonb;
  v_graph jsonb;
  v_counts jsonb;
  v_public_offer_ids uuid[]:='{}'::uuid[];
  v_product_version_ids uuid[]:='{}'::uuid[];
  v_publication_version_ids uuid[]:='{}'::uuid[];
  v_legal_version_ids uuid[]:='{}'::uuid[];
  v_offer_references text[]:='{}'::text[];
  v_quote_count bigint:=0;
  v_backfill_issue_count bigint:=0;
  v_business_total bigint:=0;
  v_unsafe_total bigint:=0;
  v_reason_codes text[]:='{}'::text[];
  v_can_delete boolean:=false;
  v_delete_status_allowed boolean:=false;
  v_public_fk_blockers jsonb;
begin
  select * into o
  from public.contract_offers co
  where co.id=p_offer_id and co.company_id=p_company_id;
  if not found then
    return jsonb_build_object(
      'ok',false,'code','contract_offer_not_found',
      'can_delete',false,'deletable',false,
      'blockers',jsonb_build_array(jsonb_build_object(
        'resource_type','contract_offer','count',0,
        'reason','contract_offer_not_found',
        'message','Avtalet hittades inte för valt bolag.'
      ))
    );
  end if;

  v_business:=public.gridex_contract_business_usage_counts(p_company_id,p_offer_id);
  v_graph:=public.gridex_resolve_contract_lifecycle_graph(p_company_id,p_offer_id);
  if not coalesce((v_graph->>'ok')::boolean,false) then
    return v_graph||jsonb_build_object('can_delete',false,'deletable',false);
  end if;
  v_counts:=coalesce(v_graph->'counts','{}'::jsonb);

  select coalesce(array_agg(value::uuid),'{}'::uuid[])
    into v_public_offer_ids
  from jsonb_array_elements_text(coalesce(v_graph->'public_contract_offer_ids','[]'::jsonb));
  select coalesce(array_agg(value::uuid),'{}'::uuid[])
    into v_product_version_ids
  from jsonb_array_elements_text(coalesce(v_graph->'contract_product_version_ids','[]'::jsonb));
  select coalesce(array_agg(value::uuid),'{}'::uuid[])
    into v_publication_version_ids
  from jsonb_array_elements_text(coalesce(v_graph->'publication_version_ids','[]'::jsonb));
  select coalesce(array_agg(value::uuid),'{}'::uuid[])
    into v_legal_version_ids
  from jsonb_array_elements_text(coalesce(v_graph->'legal_bundle_version_ids','[]'::jsonb));

  v_offer_references:=public.gridex_contract_offer_references_v1(
    p_company_id,
    v_public_offer_ids,
    v_product_version_ids,
    v_publication_version_ids
  );

  select count(*) into v_quote_count
  from public.website_contract_quotes q
  where q.company_id=p_company_id and (
    q.contract_product_version_id=any(v_product_version_ids)
    or q.contract_publication_version_id=any(v_publication_version_ids)
    or q.legal_bundle_version_id=any(v_legal_version_ids)
    or q.offer_reference=any(v_offer_references)
  );

  select count(*) into v_backfill_issue_count
  from public.contract_lifecycle_backfill_issues i
  where i.company_id=p_company_id and (
    i.contract_offer_id=p_offer_id
    or i.public_contract_offer_id=any(v_public_offer_ids)
  );

  v_business_total:=coalesce((v_business->>'total')::bigint,0)+v_quote_count;
  v_unsafe_total:=coalesce((v_counts->>'successor_offers')::bigint,0)
    +coalesce((v_counts->>'shared_product_version_references')::bigint,0)
    +coalesce((v_counts->>'shared_legal_version_references')::bigint,0)
    +coalesce((v_counts->>'unsafe_graph_issues')::bigint,0);
  v_delete_status_allowed:=o.lifecycle_status in ('draft','ready');

  if coalesce((v_business->>'customer_contracts')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_CUSTOMER_CONTRACTS'); end if;
  if coalesce((v_business->>'customer_applications')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_ACCEPTED_APPLICATIONS'); end if;
  if coalesce((v_business->>'external_intakes')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_EXTERNAL_INTAKES'); end if;
  if coalesce((v_business->>'binding_price_snapshots')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_BINDING_PRICE_SNAPSHOTS'); end if;
  if coalesce((v_business->>'invoices')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_INVOICES'); end if;
  if coalesce((v_business->>'billing_underlays')::bigint,0)>0 or coalesce((v_business->>'billing_underlay_items')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_BILLING_HISTORY'); end if;
  if coalesce((v_business->>'charge_ledger')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_CHARGE_LEDGER'); end if;
  if coalesce((v_business->>'legal_acceptances')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_LEGAL_ACCEPTANCES'); end if;
  if v_quote_count>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_WEBSITE_QUOTES'); end if;
  if coalesce((v_counts->>'successor_offers')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_SUCCESSOR_VERSION'); end if;
  if coalesce((v_counts->>'shared_product_version_references')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_SHARED_CANONICAL_VERSION'); end if;
  if coalesce((v_counts->>'shared_legal_version_references')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_SHARED_LEGAL_VERSION'); end if;
  if coalesce((v_counts->>'unsafe_graph_issues')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'PUBLICATION_GRAPH_INCONSISTENT'); end if;
  if not v_delete_status_allowed then v_reason_codes:=array_append(v_reason_codes,'PERMANENT_DELETE_REQUIRES_DRAFT'); end if;

  -- Backfill issue rows are technical diagnostics and are deleted before their
  -- referenced public offer. They are reported but never misclassified as
  -- customer/business history.
  v_public_fk_blockers:=public.gridex_fk_reference_blockers(
    'public.public_contract_offers'::regclass,
    v_public_offer_ids,
    array[
      'contract_lifecycle_backfill_issues',
      'contract_publication_versions'
    ]
  );
  if coalesce((v_public_fk_blockers->>'count')::integer,0)>0 then
    v_reason_codes:=array_append(v_reason_codes,'HAS_RESTRICTING_FOREIGN_KEYS');
  end if;

  v_can_delete:=v_delete_status_allowed
    and v_business_total=0
    and v_unsafe_total=0
    and coalesce((v_public_fk_blockers->>'count')::integer,0)=0;

  return jsonb_build_object(
    'ok',true,
    'code',case when v_can_delete then null else 'contract_delete_blocked' end,
    'contract_product_id',o.contract_product_id,
    'can_delete',v_can_delete,
    'deletable',v_can_delete,
    'has_business_usage',v_business_total>0,
    'requires_archive',v_business_total>0 or not v_delete_status_allowed,
    'requires_unpublish',o.lifecycle_status in ('published','paused'),
    'recommended_action',case
      when o.lifecycle_status in ('published','paused') then 'unpublish'
      when o.lifecycle_status in ('closed','expired','archived','superseded') then 'hide_terminal'
      when v_business_total>0 then 'archive'
      when v_unsafe_total>0 then 'repair'
      when v_can_delete then 'delete'
      else 'review'
    end,
    'result_mode',case when v_can_delete then 'delete' else 'archive_only' end,
    'business_blockers',(v_business-'ok'-'total')||jsonb_build_object('website_quotes',v_quote_count),
    'business_references',(v_business-'ok'-'total')||jsonb_build_object('website_quotes',v_quote_count),
    'removable_system_dependencies',jsonb_build_object(
      'public_offers',coalesce((v_counts->>'public_offers')::bigint,0),
      'tenant_assignments',coalesce((v_counts->>'tenant_assignments')::bigint,0),
      'publications',coalesce((v_counts->>'publications')::bigint,0),
      'publication_versions',coalesce((v_counts->>'publication_versions')::bigint,0),
      'legal_bundle_versions',coalesce((v_counts->>'legal_bundle_versions')::bigint,0),
      'backfill_issues',v_backfill_issue_count
    ),
    'system_references',v_counts||jsonb_build_object(
      'website_quotes',v_quote_count,
      'contract_lifecycle_backfill_issues',v_backfill_issue_count
    ),
    'foreign_key_blockers',v_public_fk_blockers,
    'reason_codes',to_jsonb(v_reason_codes),
    'blockers',public.gridex_contract_delete_blocker_details_v1(
      v_reason_codes,v_business,v_quote_count,v_counts,v_public_fk_blockers
    ),
    'lifecycle_status',o.lifecycle_status,
    'canonical_mapping_complete',
      o.contract_product_id is not null and o.contract_product_version_id is not null,
    'legacy_cleanup_supported',true,
    'graph',v_graph
  );
end $$;

create or replace function public.gridex_delete_unused_contract(
  p_company_id uuid,
  p_offer_id uuid,
  p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  o public.contract_offers%rowtype;
  v_preview jsonb;
  v_graph jsonb;
  v_product_id uuid;
  v_public_offer_ids uuid[]:='{}'::uuid[];
  v_assignment_ids uuid[]:='{}'::uuid[];
  v_product_version_ids uuid[]:='{}'::uuid[];
  v_publication_ids uuid[]:='{}'::uuid[];
  v_publication_version_ids uuid[]:='{}'::uuid[];
  v_legal_version_ids uuid[]:='{}'::uuid[];
  v_counts jsonb:='{}'::jsonb;
  v_count bigint;
begin
  perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.delete_unused');
  select * into o
  from public.contract_offers co
  where co.id=p_offer_id and co.company_id=p_company_id
  for update;
  if not found then
    raise exception using errcode='P0002',message='contract_offer_not_found';
  end if;

  v_preview:=public.gridex_preview_delete_unused_contract(p_company_id,p_offer_id);
  if not coalesce((v_preview->>'can_delete')::boolean,false) then
    return jsonb_build_object(
      'ok',false,'changed',false,'deleted',false,'mode','blocked',
      'code','contract_delete_blocked',
      'reason_codes',coalesce(v_preview->'reason_codes','[]'::jsonb),
      'blockers',coalesce(v_preview->'blockers','[]'::jsonb),
      'recommended_action',coalesce(v_preview->>'recommended_action','review'),
      'delete_preview',v_preview
    );
  end if;

  v_graph:=v_preview->'graph';
  select coalesce(array_agg(value::uuid),'{}'::uuid[]) into v_public_offer_ids
    from jsonb_array_elements_text(coalesce(v_graph->'public_contract_offer_ids','[]'::jsonb));
  select coalesce(array_agg(value::uuid),'{}'::uuid[]) into v_assignment_ids
    from jsonb_array_elements_text(coalesce(v_graph->'tenant_assignment_ids','[]'::jsonb));
  select coalesce(array_agg(value::uuid),'{}'::uuid[]) into v_product_version_ids
    from jsonb_array_elements_text(coalesce(v_graph->'contract_product_version_ids','[]'::jsonb));
  select coalesce(array_agg(value::uuid),'{}'::uuid[]) into v_publication_ids
    from jsonb_array_elements_text(coalesce(v_graph->'publication_ids','[]'::jsonb));
  select coalesce(array_agg(value::uuid),'{}'::uuid[]) into v_publication_version_ids
    from jsonb_array_elements_text(coalesce(v_graph->'publication_version_ids','[]'::jsonb));
  select coalesce(array_agg(value::uuid),'{}'::uuid[]) into v_legal_version_ids
    from jsonb_array_elements_text(coalesce(v_graph->'legal_bundle_version_ids','[]'::jsonb));

  v_product_id:=o.contract_product_id;
  perform set_config('gridex.public_offer_write','on',true);
  perform set_config('gridex.version_transition','on',true);
  perform set_config('gridex.publication_link_repair','on',true);

  update public.tenant_contract_channels ch
  set status='ended',
      valid_to=coalesce(ch.valid_to,now()),
      updated_by=p_actor_user_id,
      updated_at=now()
  where ch.assignment_id=any(v_assignment_ids) and ch.status<>'ended';

  update public.contract_publications cp
  set status='ended',updated_at=now()
  where cp.id=any(v_publication_ids) and cp.status not in ('ended','archived');

  update public.contract_publication_versions cpv
  set status='ended',valid_to=coalesce(cpv.valid_to,now())
  where cpv.id=any(v_publication_version_ids)
    and cpv.status not in ('ended','archived');

  update public.contract_publication_versions cpv
  set legacy_public_contract_offer_id=null
  where cpv.legacy_public_contract_offer_id=any(v_public_offer_ids);

  -- Diagnostics belong to the removed technical graph. Delete them before the
  -- public offer regardless of historical FK action drift.
  delete from public.contract_lifecycle_backfill_issues i
  where i.company_id=p_company_id and (
    i.contract_offer_id=p_offer_id
    or i.public_contract_offer_id=any(v_public_offer_ids)
  );
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('contract_lifecycle_backfill_issues',v_count);

  perform public.gridex_assert_no_public_offer_fk_references(v_public_offer_ids);

  delete from public.contract_offer_versions cov
  where cov.company_id=p_company_id and cov.contract_offer_id=o.id;
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('contract_offer_versions',v_count);

  delete from public.public_contract_offers pco where pco.id=any(v_public_offer_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('public_contract_offers',v_count);

  delete from public.contract_publication_versions cpv
  where cpv.id=any(v_publication_version_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('contract_publication_versions',v_count);

  delete from public.contract_publications cp where cp.id=any(v_publication_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('contract_publications',v_count);

  delete from public.tenant_contract_channels ch where ch.assignment_id=any(v_assignment_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('tenant_contract_channels',v_count);

  delete from public.tenant_contract_assignments ta where ta.id=any(v_assignment_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('tenant_contract_assignments',v_count);

  delete from public.contract_offers co
  where co.id=o.id and co.company_id=p_company_id;
  get diagnostics v_count=row_count;
  if v_count<>1 then
    raise exception using errcode='55000',message='contract_offer_delete_count_mismatch';
  end if;
  v_counts:=v_counts||jsonb_build_object('contract_offers',v_count);

  delete from public.legal_bundle_version_documents d
  where d.legal_bundle_version_id=any(v_legal_version_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('legal_bundle_version_documents',v_count);

  delete from public.legal_bundle_versions lbv where lbv.id=any(v_legal_version_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('legal_bundle_versions',v_count);

  delete from public.contract_product_versions cpv
  where cpv.id=any(v_product_version_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('contract_product_versions',v_count);

  if v_product_id is not null
     and not exists(
       select 1 from public.contract_product_versions cpv
       where cpv.contract_product_id=v_product_id
     ) then
    delete from public.contract_products cp
    where cp.id=v_product_id and cp.company_id=p_company_id;
    get diagnostics v_count=row_count;
    v_counts:=v_counts||jsonb_build_object('contract_products',v_count);
  end if;

  -- Price versions/books are immutable shared pricing evidence and have many
  -- later consumers (quotes, portfolio, invoices). Contract deletion does not
  -- own their garbage collection.
  insert into public.audit_logs(
    company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata
  ) values(
    p_company_id,p_actor_user_id,'contract_product',coalesce(v_product_id,p_offer_id)::text,
    'contract.delete_unused',to_jsonb(o),null,
    jsonb_build_object('offer_id',p_offer_id,'deleted_rows',v_counts,'preview',v_preview)
  );

  return jsonb_build_object(
    'ok',true,'changed',true,'deleted',true,'mode','deleted',
    'offer_id',p_offer_id,'contract_product_id',v_product_id,
    'deleted_rows',v_counts
  );
end $$;

create or replace function public.gridex_remove_internal_contract_offer(
  p_company_id uuid,
  p_offer_id uuid,
  p_mode text default 'archive',
  p_actor_user_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_preview jsonb;
begin
  if p_mode='archive' then
    return public.gridex_archive_contract_product(p_company_id,p_offer_id,p_actor_user_id);
  elsif p_mode='safe_delete' then
    v_preview:=public.gridex_preview_delete_unused_contract(p_company_id,p_offer_id);
    if coalesce((v_preview->>'can_delete')::boolean,false) then
      return public.gridex_delete_unused_contract(p_company_id,p_offer_id,p_actor_user_id);
    end if;
    return jsonb_build_object(
      'ok',false,'changed',false,'mode','blocked',
      'code','contract_delete_blocked',
      'reason_codes',coalesce(v_preview->'reason_codes','[]'::jsonb),
      'blockers',coalesce(v_preview->'blockers','[]'::jsonb),
      'recommended_action',coalesce(v_preview->>'recommended_action','review'),
      'delete_preview',v_preview
    );
  end if;
  raise exception using errcode='22023',message='invalid_contract_remove_mode';
end $$;

create or replace function public.gridex_close_contract_product(
  p_company_id uuid,
  p_offer_id uuid,
  p_actor_user_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  o public.contract_offers%rowtype;
  v_before jsonb;
  v_offer_ids uuid[]:='{}'::uuid[];
  v_product_version_ids uuid[]:='{}'::uuid[];
  v_assignment_ids uuid[]:='{}'::uuid[];
  v_public_offer_ids uuid[]:='{}'::uuid[];
  v_offer_references text[]:='{}'::text[];
  v_channels bigint:=0;
  v_publications bigint:=0;
  v_versions bigint:=0;
  v_public_offers bigint:=0;
  v_quotes bigint:=0;
  v_event_id uuid;
  v_aggregate_id text;
begin
  perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.close');
  if nullif(btrim(coalesce(p_reason,'')),'') is null then
    return jsonb_build_object('ok',false,'changed',false,'code','contract_close_reason_required');
  end if;

  select * into o
  from public.contract_offers co
  where co.id=p_offer_id and co.company_id=p_company_id
  for update;
  if not found then
    return jsonb_build_object('ok',false,'changed',false,'code','contract_not_found');
  end if;
  if o.lifecycle_status='closed' then
    return jsonb_build_object('ok',true,'changed',false,'mode','closed','code','contract_already_closed');
  end if;
  if o.lifecycle_status='archived' then
    return jsonb_build_object('ok',false,'changed',false,'code','contract_already_archived');
  end if;
  v_before:=to_jsonb(o);
  v_aggregate_id:=coalesce(o.contract_product_id,o.id)::text;

  v_offer_ids:=array(
    select co.id
    from public.contract_offers co
    where co.company_id=p_company_id and (
      co.id=o.id
      or (o.contract_product_id is not null and co.contract_product_id=o.contract_product_id)
    )
    order by co.id
  );
  v_product_version_ids:=array(
    select distinct co.contract_product_version_id
    from public.contract_offers co
    where co.id=any(v_offer_ids) and co.contract_product_version_id is not null
    order by co.contract_product_version_id
  );
  v_assignment_ids:=array(
    select ta.id
    from public.tenant_contract_assignments ta
    where ta.company_id=p_company_id
      and ta.contract_product_version_id=any(v_product_version_ids)
    order by ta.id
  );
  v_public_offer_ids:=array(
    select pco.id
    from public.public_contract_offers pco
    where pco.company_id=p_company_id and (
      pco.source_contract_offer_id=any(v_offer_ids)
      or pco.contract_product_version_id=any(v_product_version_ids)
    )
    order by pco.id
  );
  v_offer_references:=public.gridex_contract_offer_references_v1(
    p_company_id,
    v_public_offer_ids,
    v_product_version_ids,
    v_publication_version_ids
  );

  perform set_config('gridex.version_transition','on',true);
  perform set_config('gridex.public_offer_write','on',true);

  update public.tenant_contract_channels ch
  set status='ended',valid_to=coalesce(ch.valid_to,now()),
      updated_by=p_actor_user_id,updated_at=now()
  where ch.assignment_id=any(v_assignment_ids) and ch.status<>'ended';
  get diagnostics v_channels=row_count;

  update public.contract_publications cp
  set status='ended',updated_at=now()
  where cp.assignment_id=any(v_assignment_ids)
    and cp.status not in ('ended','archived');
  get diagnostics v_publications=row_count;

  update public.contract_publication_versions cpv
  set status='ended',valid_to=coalesce(cpv.valid_to,now())
  where cpv.contract_publication_id in (
    select cp.id from public.contract_publications cp
    where cp.assignment_id=any(v_assignment_ids)
  ) and cpv.status not in ('ended','archived');
  get diagnostics v_versions=row_count;

  update public.public_contract_offers pco
  set lifecycle_status='closed',publication_status='unpublished',
      is_public=false,website_enabled=false,website_cta_enabled=false,
      closed_at=coalesce(pco.closed_at,now()),closed_by=p_actor_user_id,
      close_reason=btrim(p_reason),updated_by=p_actor_user_id,updated_at=now()
  where pco.id=any(v_public_offer_ids);
  get diagnostics v_public_offers=row_count;

  update public.website_contract_quotes q
  set status='revoked',updated_at=now()
  where q.company_id=p_company_id and q.status='active' and (
    q.offer_reference=any(v_offer_references)
    or q.contract_product_version_id=any(v_product_version_ids)
  );
  get diagnostics v_quotes=row_count;

  update public.tenant_contract_assignments ta
  set status='ended',valid_to=coalesce(ta.valid_to,now()),updated_at=now()
  where ta.id=any(v_assignment_ids) and ta.status<>'ended';

  update public.contract_offers co
  set lifecycle_status='closed',status='inactive',is_active=false,
      closed_at=coalesce(co.closed_at,now()),closed_by=p_actor_user_id,
      close_reason=btrim(p_reason),updated_by=p_actor_user_id,updated_at=now()
  where co.id=any(v_offer_ids);

  if o.contract_product_id is not null then
    update public.contract_products cp
    set status='archived',updated_at=now()
    where cp.id=o.contract_product_id and cp.company_id=p_company_id;
  end if;

  insert into public.audit_logs(
    company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata
  ) values(
    p_company_id,p_actor_user_id,'contract_product',v_aggregate_id,
    'contract.closed',v_before,
    jsonb_build_object('lifecycle_status','closed','closed_at',now(),'close_reason',btrim(p_reason)),
    jsonb_build_object(
      'offer_id',o.id,'legacy_without_product_id',o.contract_product_id is null,
      'affected_channels',v_channels,'affected_publications',v_publications,
      'affected_publication_versions',v_versions,'affected_public_offers',v_public_offers,
      'revoked_unused_quotes',v_quotes
    )
  );

  insert into public.domain_events(
    company_id,event_type,aggregate_type,aggregate_id,actor_user_id,source,idempotency_key,payload
  ) values(
    p_company_id,'contract.closed','contract_product',v_aggregate_id,
    p_actor_user_id,'database',
    format('contract.closed:%s:%s',v_aggregate_id,extract(epoch from now())::bigint),
    jsonb_build_object(
      'contract_product_id',o.contract_product_id,
      'offer_id',o.id,'reason',btrim(p_reason)
    )
  ) returning id into v_event_id;

  insert into public.event_outbox(
    company_id,domain_event_id,destination_type,destination_key,payload
  ) values(
    p_company_id,v_event_id,'webhook','contract.closed',
    jsonb_build_object('domain_event_id',v_event_id,'event_type','contract.closed')
  ) on conflict do nothing;

  perform public.gridex_bump_contract_publication_revision(
    p_company_id,'website','contract_closed',v_aggregate_id
  );
  perform public.gridex_bump_contract_publication_revision(
    p_company_id,'api','contract_closed',v_aggregate_id
  );

  return jsonb_build_object(
    'ok',true,'changed',true,'mode','closed','code','contract_closed',
    'contract_product_id',o.contract_product_id,'offer_id',o.id,
    'legacy_without_product_id',o.contract_product_id is null,
    'affected_channels',v_channels,'affected_publications',v_publications,
    'affected_publication_versions',v_versions,'affected_public_offers',v_public_offers,
    'revoked_unused_quotes',v_quotes,'event_id',v_event_id
  );
end $$;


revoke all on function public.gridex_contract_offer_references_v1(
  uuid,uuid[],uuid[],uuid[]
) from public,anon,authenticated;
grant execute on function public.gridex_contract_offer_references_v1(
  uuid,uuid[],uuid[],uuid[]
) to service_role;

revoke all on function public.gridex_preview_delete_unused_contract(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.gridex_preview_delete_unused_contract(uuid,uuid)
  to service_role;

revoke all on function public.gridex_delete_unused_contract(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.gridex_delete_unused_contract(uuid,uuid,uuid)
  to service_role;

revoke all on function public.gridex_remove_internal_contract_offer(
  uuid,uuid,text,uuid
) from public,anon,authenticated;
grant execute on function public.gridex_remove_internal_contract_offer(
  uuid,uuid,text,uuid
) to service_role;

revoke all on function public.gridex_close_contract_product(
  uuid,uuid,uuid,text
) from public,anon,authenticated;
grant execute on function public.gridex_close_contract_product(
  uuid,uuid,uuid,text
) to service_role;

revoke all on function public.gridex_publish_internal_contract_version(
  uuid,uuid,uuid
) from public,anon,authenticated;
grant execute on function public.gridex_publish_internal_contract_version(
  uuid,uuid,uuid
) to service_role;

comment on function public.gridex_contract_offer_references_v1(
  uuid,uuid[],uuid[],uuid[]
) is
  'Returns tenant-scoped canonical offer references from contract_publication_versions.offer_reference with metadata fallback for legacy public offers.';

comment on function public.gridex_validate_contract_readiness(uuid,uuid) is
  'Central publication readiness contract. Returns stable blocker codes plus field/message blocker_details.';

comment on function public.gridex_publish_internal_contract_version(uuid,uuid,uuid) is
  'Readiness-gated, idempotent internal publication. Business blockers are returned as structured JSON instead of hidden behind SQLSTATE 23514.';

comment on function public.gridex_preview_delete_unused_contract(uuid,uuid) is
  'Service-only tenant-safe delete preview using the same dependency graph and structured blockers as the commit command.';

comment on function public.gridex_close_contract_product(uuid,uuid,uuid,text) is
  'Terminal contract close. Resolves quote revocation references from contract_publication_versions.offer_reference, never from a nonexistent public_contract_offers column.';

commit;
