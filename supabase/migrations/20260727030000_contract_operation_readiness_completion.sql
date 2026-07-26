-- GRIDEX OPS: operation-specific contract readiness and lifecycle completion.
-- Forward-only repair after 20260727020000.

begin;

-- Closed is a distinct terminal product state. Earlier schema only allowed
-- paused/archived, which forced close to masquerade as pause at product level.
alter table public.contract_products
  drop constraint if exists contract_products_status_check;
alter table public.contract_products
  add constraint contract_products_status_check
  check (status in ('draft','active','paused','closed','archived'));

create or replace function public.gridex_contract_readiness_blocker_v2(
  p_code text,
  p_field text,
  p_message text,
  p_current_value jsonb default null,
  p_resource_type text default null,
  p_resource_id uuid default null,
  p_metadata jsonb default null
) returns jsonb
language sql
immutable
security invoker
set search_path=public,pg_temp
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'code',p_code,
    'field',p_field,
    'message',p_message,
    'current_value',p_current_value,
    'resource_type',p_resource_type,
    'resource_id',p_resource_id,
    'metadata',p_metadata
  ))
$$;

create or replace function public.gridex_validate_contract_readiness_v2(
  p_company_id uuid,
  p_contract_offer_id uuid,
  p_operation text,
  p_channel text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path=public,auth,pg_temp
as $$
declare
  o public.contract_offers%rowtype;
  v_operation text:=lower(nullif(btrim(coalesce(p_operation,'')),''));
  v_channel text:=lower(nullif(btrim(coalesce(p_channel,'')),''));
  v_blockers jsonb:='[]'::jsonb;
  v_snapshot jsonb:='{}'::jsonb;
  v_components jsonb:='[]'::jsonb;
  v_price_areas text[]:='{}'::text[];
  v_area text;
  v_resolution text;
  v_expected_resolution text;
  v_energy_direction text;
  v_production_enabled boolean:=false;
  v_spot_weight numeric;
  v_portfolio_weight numeric;
  v_fixed_weight numeric;
  v_required_modules text[]:='{}'::text[];
  v_module text;
  v_template_version_id uuid;
  v_template_title text;
  v_template_body text;
  v_override_id uuid;
  v_override_mode text;
  v_override_title text;
  v_override_body text;
  v_source_title text;
  v_source_body text;
  v_rendered_title text;
  v_rendered_body text;
  v_unresolved text[]:='{}'::text[];
  v_profile jsonb;
  v_company jsonb;
  v_can_execute boolean;
begin
  if v_operation is null or v_operation not in (
    'publish_version','activate_channel','resume_channel','close','archive','delete'
  ) then
    v_blockers:=v_blockers||jsonb_build_array(
      public.gridex_contract_readiness_blocker_v2(
        'invalid_readiness_operation','operation',
        'Okänd readinessoperation.',to_jsonb(v_operation)
      )
    );
    return jsonb_build_object(
      'ok',false,'status','blocked','can_execute',false,'can_publish',false,
      'operation',v_operation,'channel',v_channel,'code','contract_not_ready',
      'blockers',v_blockers,'evaluated_at',now()
    );
  end if;

  if v_operation in ('activate_channel','resume_channel')
     and (v_channel is null or v_channel not in ('internal','website','api','partner','phone')) then
    v_blockers:=v_blockers||jsonb_build_array(
      public.gridex_contract_readiness_blocker_v2(
        'invalid_contract_channel','channel',
        'Kanalen måste vara internal, website, api, partner eller phone.',
        to_jsonb(v_channel)
      )
    );
  end if;

  select * into o
  from public.contract_offers co
  where co.id=p_contract_offer_id and co.company_id=p_company_id;

  if not found then
    v_blockers:=v_blockers||jsonb_build_array(
      public.gridex_contract_readiness_blocker_v2(
        'contract_offer_not_found','contract_offer_id',
        'Avtalsversionen hittades inte för valt bolag.',
        to_jsonb(p_contract_offer_id),'contract_offer',p_contract_offer_id
      )
    );
    return jsonb_build_object(
      'ok',false,'status','blocked','can_execute',false,'can_publish',false,
      'operation',v_operation,'channel',v_channel,'code','contract_not_ready',
      'blockers',v_blockers,'evaluated_at',now()
    );
  end if;

  if v_operation='publish_version' and o.lifecycle_status not in ('draft','ready','paused') then
    v_blockers:=v_blockers||jsonb_build_array(
      public.gridex_contract_readiness_blocker_v2(
        'lifecycle_status_not_publishable','lifecycle_status',
        'Endast draft, ready eller paused kan publiceras som en immutable avtalsversion.',
        to_jsonb(o.lifecycle_status),'contract_offer',o.id
      )
    );
  elsif v_operation in ('activate_channel','resume_channel')
        and o.lifecycle_status not in ('published','paused') then
    v_blockers:=v_blockers||jsonb_build_array(
      public.gridex_contract_readiness_blocker_v2(
        'lifecycle_status_not_channel_activatable','lifecycle_status',
        'Kanalen kan endast aktiveras för en publicerad eller pausad avtalsversion.',
        to_jsonb(o.lifecycle_status),'contract_offer',o.id
      )
    );
  elsif v_operation='close' and o.lifecycle_status not in ('draft','ready','published','paused') then
    v_blockers:=v_blockers||jsonb_build_array(
      public.gridex_contract_readiness_blocker_v2(
        case
          when o.lifecycle_status='closed' then 'contract_already_closed'
          when o.lifecycle_status='archived' then 'contract_already_archived'
          else 'lifecycle_status_not_closeable'
        end,
        'lifecycle_status','Endast draft, ready, published eller paused kan stängas.',
        to_jsonb(o.lifecycle_status),'contract_offer',o.id
      )
    );
  elsif v_operation='archive' and o.lifecycle_status not in ('draft','ready','paused','expired','closed','superseded') then
    v_blockers:=v_blockers||jsonb_build_array(
      public.gridex_contract_readiness_blocker_v2(
        'lifecycle_status_not_archivable','lifecycle_status',
        'Publicerade avtal måste först pausas eller stängas innan arkivering.',
        to_jsonb(o.lifecycle_status),'contract_offer',o.id
      )
    );
  elsif v_operation='delete' and o.lifecycle_status not in ('draft','ready') then
    v_blockers:=v_blockers||jsonb_build_array(
      public.gridex_contract_readiness_blocker_v2(
        'permanent_delete_requires_draft','lifecycle_status',
        'Permanent radering är endast tillåten för oanvända draft- eller ready-versioner.',
        to_jsonb(o.lifecycle_status),'contract_offer',o.id
      )
    );
  end if;

  -- Close/archive/delete have their own dependency graph and must not be blocked
  -- by publication-only commercial requirements.
  if v_operation not in ('publish_version','activate_channel','resume_channel') then
    v_can_execute:=jsonb_array_length(v_blockers)=0;
    return jsonb_build_object(
      'ok',v_can_execute,
      'status',case when v_can_execute then 'ready' else 'blocked' end,
      'can_execute',v_can_execute,'can_publish',v_can_execute,
      'operation',v_operation,'channel',v_channel,
      'code',case when v_can_execute then 'contract_ready' else 'contract_not_ready' end,
      'blockers',v_blockers,'lifecycle_status',o.lifecycle_status,
      'evaluated_at',now()
    );
  end if;

  v_snapshot:=coalesce(o.commercial_snapshot,'{}'::jsonb);
  v_components:=case
    when jsonb_typeof(v_snapshot->'base_components')='array' then v_snapshot->'base_components'
    when jsonb_typeof(v_snapshot->'pricing_snapshot'->'base_components')='array'
      then v_snapshot->'pricing_snapshot'->'base_components'
    else '[]'::jsonb
  end;
  v_production_enabled:=lower(coalesce(v_snapshot#>>'{production,enabled}','false'))='true';
  v_energy_direction:=lower(nullif(btrim(v_snapshot->>'energy_direction'),''));
  if v_energy_direction is null then
    -- Compatibility for immutable snapshots created before direction became
    -- explicit. All newly written snapshots carry this field.
    v_energy_direction:=case when v_production_enabled then 'production' else 'consumption' end;
  end if;
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

  select coalesce(array_agg(upper(btrim(area)) order by upper(btrim(area))),'{}'::text[])
  into v_price_areas
  from (
    select value as area
    from jsonb_array_elements_text(
      case when jsonb_typeof(v_snapshot->'price_areas')='array'
        then v_snapshot->'price_areas' else '[]'::jsonb end
    )
    where nullif(btrim(value),'') is not null
    union all
    select unnest(cpv.price_areas)
    from public.contract_product_versions cpv
    where cpv.id=o.contract_product_version_id
      and jsonb_array_length(
        case when jsonb_typeof(v_snapshot->'price_areas')='array'
          then v_snapshot->'price_areas' else '[]'::jsonb end
      )=0
  ) areas;

  if nullif(btrim(o.name),'') is null then
    v_blockers:=v_blockers||jsonb_build_array(public.gridex_contract_readiness_blocker_v2(
      'name_missing','name','Internt avtalsnamn saknas.',null,'contract_offer',o.id));
  end if;
  if o.contract_product_id is null then
    v_blockers:=v_blockers||jsonb_build_array(public.gridex_contract_readiness_blocker_v2(
      'canonical_product_missing','contract_product_id','Canonical avtalsprodukt saknas.',null,'contract_offer',o.id));
  end if;
  if o.contract_product_version_id is null then
    v_blockers:=v_blockers||jsonb_build_array(public.gridex_contract_readiness_blocker_v2(
      'canonical_product_version_missing','contract_product_version_id','Canonical immutable avtalsversion saknas.',null,'contract_offer',o.id));
  elsif not exists(
    select 1 from public.contract_product_versions cpv
    where cpv.id=o.contract_product_version_id
      and cpv.contract_product_id=o.contract_product_id
  ) then
    v_blockers:=v_blockers||jsonb_build_array(public.gridex_contract_readiness_blocker_v2(
      'canonical_product_version_mismatch','contract_product_version_id','Avtalsversionen tillhör inte vald canonical produkt.',to_jsonb(o.contract_product_version_id),'contract_product_version',o.contract_product_version_id));
  end if;

  if o.contract_product_version_id is not null and not exists(
    select 1 from public.tenant_contract_assignments ta
    where ta.company_id=p_company_id
      and ta.contract_product_version_id=o.contract_product_version_id
      and ta.status in ('active','paused')
  ) then
    v_blockers:=v_blockers||jsonb_build_array(public.gridex_contract_readiness_blocker_v2(
      'tenant_assignment_missing','tenant_contract_assignment_id','Aktiv eller pausad tenanttilldelning till exakt avtalsversion saknas.',null,'contract_product_version',o.contract_product_version_id));
  end if;

  if o.contract_product_version_id is not null and not exists(
    select 1 from public.tenant_contract_assignments ta
    join public.tenant_contract_channels ch on ch.assignment_id=ta.id
    where ta.company_id=p_company_id
      and ta.contract_product_version_id=o.contract_product_version_id
      and ch.channel='internal'
      and ch.status in ('active','paused')
  ) then
    v_blockers:=v_blockers||jsonb_build_array(public.gridex_contract_readiness_blocker_v2(
      'internal_channel_missing','internal_channel','Intern försäljningskanal saknas för tenanttilldelningen.',null,'contract_product_version',o.contract_product_version_id));
  end if;

  if o.price_plan_id is null then
    v_blockers:=v_blockers||jsonb_build_array(public.gridex_contract_readiness_blocker_v2('price_plan_missing','price_plan_id','Prisplan saknas.',null,'contract_offer',o.id));
  end if;
  if o.price_plan_version_id is null then
    v_blockers:=v_blockers||jsonb_build_array(public.gridex_contract_readiness_blocker_v2('price_plan_version_missing','price_plan_version_id','Låst prisversion saknas.',null,'contract_offer',o.id));
  end if;
  if o.price_book_id is null then
    v_blockers:=v_blockers||jsonb_build_array(public.gridex_contract_readiness_blocker_v2('price_book_missing','price_book_id','Prisbok eller prissnapshot saknas.',null,'contract_offer',o.id));
  end if;
  if o.invoice_fee_sek is null then
    v_blockers:=v_blockers||jsonb_build_array(public.gridex_contract_readiness_blocker_v2('invoice_fee_missing','invoice_fee_sek','Fakturaavgiften måste vara explicit angiven, även när den är 0.',null,'contract_offer',o.id));
  elsif o.invoice_fee_sek<0 then
    v_blockers:=v_blockers||jsonb_build_array(public.gridex_contract_readiness_blocker_v2('invoice_fee_invalid','invoice_fee_sek','Fakturaavgiften får inte vara negativ.',to_jsonb(o.invoice_fee_sek),'contract_offer',o.id));
  end if;
  if o.vat_rate is null or o.vat_rate<0 or o.vat_rate>1 then
    v_blockers:=v_blockers||jsonb_build_array(public.gridex_contract_readiness_blocker_v2('vat_rate_invalid','vat_rate','Moms måste ligga mellan 0 och 1.',to_jsonb(o.vat_rate),'contract_offer',o.id));
  end if;

  if cardinality(v_price_areas)=0 then
    v_blockers:=v_blockers||jsonb_build_array(public.gridex_contract_readiness_blocker_v2('price_areas_missing','commercial_snapshot.price_areas','Minst ett tillåtet elområde måste anges.',null,'contract_offer',o.id));
  elsif cardinality(v_price_areas)<>(select count(distinct area) from unnest(v_price_areas) area) then
    v_blockers:=v_blockers||jsonb_build_array(public.gridex_contract_readiness_blocker_v2('duplicate_price_areas','commercial_snapshot.price_areas','Elområdeslistan innehåller dubbletter.',to_jsonb(v_price_areas),'contract_offer',o.id));
  end if;
  if exists(select 1 from unnest(v_price_areas) area where area not in ('SE1','SE2','SE3','SE4')) then
    v_blockers:=v_blockers||jsonb_build_array(public.gridex_contract_readiness_blocker_v2('price_area_invalid','commercial_snapshot.price_areas','Elområdet måste vara SE1, SE2, SE3 eller SE4.',to_jsonb(v_price_areas),'contract_offer',o.id));
  end if;

  if o.contract_type='fixed' then
    foreach v_area in array v_price_areas loop
      if not exists(
        select 1
        from jsonb_array_elements(v_components) component
        where lower(coalesce(component->>'source_type',''))='fixed'
          and upper(coalesce(component->>'price_area',''))=v_area
          and coalesce(component->>'fixed_price_sek_per_kwh','') ~ '^[0-9]+([.][0-9]+)?$'
          and (component->>'fixed_price_sek_per_kwh')::numeric>0
      ) then
        v_blockers:=v_blockers||jsonb_build_array(public.gridex_contract_readiness_blocker_v2(
          'fixed_price_area_missing','commercial_snapshot.base_components.'||v_area,
          'Fastpris saknas eller är ogiltigt för '||v_area||'.',null,
          'contract_product_version',o.contract_product_version_id,
          jsonb_build_object('price_area',v_area)
        ));
      end if;
    end loop;
  end if;

  if v_resolution is null then
    v_blockers:=v_blockers||jsonb_build_array(public.gridex_contract_readiness_blocker_v2('resolution_missing','commercial_snapshot.interval_resolution','Prisupplösning saknas i den immutable kommersiella snapshoten.',null,'contract_offer',o.id));
  elsif v_expected_resolution is not null and v_resolution<>v_expected_resolution then
    v_blockers:=v_blockers||jsonb_build_array(public.gridex_contract_readiness_blocker_v2('resolution_mismatch','commercial_snapshot.interval_resolution','Prisupplösningen matchar inte vald avtalsmodell.',to_jsonb(v_resolution),'contract_offer',o.id,jsonb_build_object('expected',v_expected_resolution)));
  elsif o.contract_type='mixed' and v_resolution not in ('monthly','hourly','quarterly') then
    v_blockers:=v_blockers||jsonb_build_array(public.gridex_contract_readiness_blocker_v2('resolution_mismatch','commercial_snapshot.interval_resolution','Mixavtal måste använda monthly, hourly eller quarterly.',to_jsonb(v_resolution),'contract_offer',o.id));
  end if;

  if v_energy_direction not in ('consumption','production') then
    v_blockers:=v_blockers||jsonb_build_array(public.gridex_contract_readiness_blocker_v2(
      'energy_direction_invalid','commercial_snapshot.energy_direction',
      'Avtalsriktningen måste vara consumption eller production.',to_jsonb(v_energy_direction),
      'contract_offer',o.id
    ));
  end if;
  if v_production_enabled and v_energy_direction<>'production' then
    v_blockers:=v_blockers||jsonb_build_array(public.gridex_contract_readiness_blocker_v2(
      'production_direction_mismatch','commercial_snapshot.energy_direction',
      'Produktionsersättning är aktiverad men avtalsriktningen är inte production.',to_jsonb(v_energy_direction),
      'contract_offer',o.id
    ));
  elsif not v_production_enabled and v_energy_direction='production' then
    v_blockers:=v_blockers||jsonb_build_array(public.gridex_contract_readiness_blocker_v2(
      'production_configuration_missing','commercial_snapshot.production.enabled',
      'Avtalsriktningen är production men produktionskonfigurationen är inte aktiverad.',to_jsonb(false),
      'contract_offer',o.id
    ));
  end if;
  if v_production_enabled then
    if nullif(v_snapshot#>>'{production,settlement_mode}','') is null then
      v_blockers:=v_blockers||jsonb_build_array(public.gridex_contract_readiness_blocker_v2('production_settlement_mode_missing','commercial_snapshot.production.settlement_mode','Produktionsavtalet saknar avräkningsmodell.',null,'contract_offer',o.id));
    end if;
    if coalesce(
      case when coalesce(v_snapshot#>>'{production,compensation_ore_per_kwh}','') ~ '^[0-9]+([.][0-9]+)?$'
        then (v_snapshot#>>'{production,compensation_ore_per_kwh}')::numeric end,
      0
    )<=0 then
      v_blockers:=v_blockers||jsonb_build_array(public.gridex_contract_readiness_blocker_v2('production_compensation_missing','commercial_snapshot.production.compensation_ore_per_kwh','Produktionsavtalet saknar en positiv ersättningsnivå.',null,'contract_offer',o.id));
    end if;
  end if;

  if o.valid_from is not null and o.valid_to is not null and o.valid_to<o.valid_from then
    v_blockers:=v_blockers||jsonb_build_array(public.gridex_contract_readiness_blocker_v2('invalid_validity_period','valid_to','Giltig till ligger före giltig från.',to_jsonb(o.valid_to),'contract_offer',o.id));
  end if;
  if o.max_customers is not null and o.max_customers<=0 then
    v_blockers:=v_blockers||jsonb_build_array(public.gridex_contract_readiness_blocker_v2('invalid_max_customers','max_customers','Max antal kunder måste vara större än 0.',to_jsonb(o.max_customers),'contract_offer',o.id));
  end if;
  if coalesce(o.automatic_renewal,false) and o.automatic_renewal_term_months is null then
    v_blockers:=v_blockers||jsonb_build_array(public.gridex_contract_readiness_blocker_v2('automatic_renewal_term_missing','automatic_renewal_term_months','Automatisk förlängning saknar förlängningsperiod.',null,'contract_offer',o.id));
  end if;
  if o.discount_value is not null and o.discount_months is null then
    v_blockers:=v_blockers||jsonb_build_array(public.gridex_contract_readiness_blocker_v2('discount_months_missing','discount_months','Rabattvärde finns men rabattperiod saknas.',null,'contract_offer',o.id));
  end if;
  if o.contract_type in ('portfolio','mixed') and nullif(v_snapshot#>>'{portfolio_method,portfolio_id}','') is null then
    v_blockers:=v_blockers||jsonb_build_array(public.gridex_contract_readiness_blocker_v2('portfolio_id_missing','commercial_snapshot.portfolio_method.portfolio_id','Portfölj- eller mixavtal saknar portfölj-ID.',null,'contract_offer',o.id));
  end if;
  if o.contract_type in ('portfolio','mixed') then
    v_spot_weight:=case
      when coalesce(v_snapshot#>>'{portfolio_method,mix_shares,spot_weight_percent}','') ~ '^-?[0-9]+([.][0-9]+)?$'
        then (v_snapshot#>>'{portfolio_method,mix_shares,spot_weight_percent}')::numeric
      else null
    end;
    v_portfolio_weight:=case
      when coalesce(v_snapshot#>>'{portfolio_method,mix_shares,portfolio_weight_percent}','') ~ '^-?[0-9]+([.][0-9]+)?$'
        then (v_snapshot#>>'{portfolio_method,mix_shares,portfolio_weight_percent}')::numeric
      else null
    end;
    v_fixed_weight:=case
      when coalesce(v_snapshot#>>'{portfolio_method,mix_shares,fixed_weight_percent}','') ~ '^-?[0-9]+([.][0-9]+)?$'
        then (v_snapshot#>>'{portfolio_method,mix_shares,fixed_weight_percent}')::numeric
      else null
    end;
    if v_spot_weight is null or v_portfolio_weight is null or v_fixed_weight is null
       or v_spot_weight<0 or v_portfolio_weight<0 or v_fixed_weight<0
       or v_spot_weight+v_portfolio_weight+v_fixed_weight<>100 then
      v_blockers:=v_blockers||jsonb_build_array(public.gridex_contract_readiness_blocker_v2(
        'pricing_weights_invalid','commercial_snapshot.portfolio_method.mix_shares',
        'Spot-, portfölj- och fastvikter måste vara numeriska, icke-negativa och summera till 100 procent.',
        jsonb_build_object(
          'spot_weight_percent',v_snapshot#>>'{portfolio_method,mix_shares,spot_weight_percent}',
          'portfolio_weight_percent',v_snapshot#>>'{portfolio_method,mix_shares,portfolio_weight_percent}',
          'fixed_weight_percent',v_snapshot#>>'{portfolio_method,mix_shares,fixed_weight_percent}'
        ),'contract_offer',o.id
      ));
    end if;
  end if;

  if not exists(
    select 1 from public.platform_go_live_readiness_v readiness
    where readiness.company_id=p_company_id
      and readiness.has_actor_setting and readiness.has_brp
      and readiness.has_prodat_route and readiness.has_utilts_route
      and readiness.has_sender_identity
  ) then
    v_blockers:=v_blockers||jsonb_build_array(public.gridex_contract_readiness_blocker_v2('tenant_go_live_not_ready','company_id','Tenantens produktionsrouting, BRP eller avsändaridentitet är inte komplett.',to_jsonb(p_company_id),'company',p_company_id));
  end if;

  select to_jsonb(lp) into v_profile
  from public.tenant_legal_profiles lp
  where lp.company_id=p_company_id
    and lp.completeness_status in ('complete','verified')
    and not coalesce(lp.review_required,false);
  if v_profile is null then
    v_blockers:=v_blockers||jsonb_build_array(public.gridex_contract_readiness_blocker_v2('tenant_legal_profile_not_ready','tenant_legal_profile','Tenantens juridiska profil är inte komplett och granskad.',null,'company',p_company_id));
  end if;
  select to_jsonb(company_row) into v_company
  from public.companies company_row
  where company_row.id=p_company_id;

  select cpv.required_legal_modules
  into v_required_modules
  from public.contract_product_versions cpv
  where cpv.id=o.contract_product_version_id
    and cpv.contract_product_id=o.contract_product_id;
  if coalesce(cardinality(v_required_modules),0)=0 then
    v_required_modules:=public.gridex_required_legal_modules(
      o.customer_type,o.contract_type,'website',coalesce(o.automatic_renewal,false),
      coalesce(o.power_of_attorney_required,true),v_production_enabled
    );
  end if;

  if v_operation='publish_version' then
    -- Preview the exact canonical legal source selection used by
    -- gridex_materialize_legal_bundle_version. No legacy legal_bundle row is
    -- required for a draft.
    foreach v_module in array coalesce(v_required_modules,'{}'::text[]) loop
      v_template_version_id:=null;
      v_template_title:=null;
      v_template_body:=null;
      v_override_id:=null;
      v_override_mode:=null;
      v_override_title:=null;
      v_override_body:=null;
      v_source_title:=null;
      v_source_body:=null;

      select ltv.id,ltv.title,ltv.body
      into v_template_version_id,v_template_title,v_template_body
      from public.legal_templates lt
      join public.legal_template_versions ltv on ltv.legal_template_id=lt.id
      where lt.module_key=v_module
        and lt.status='active'
        and ltv.status='published'
        and ltv.locked_at is not null
      order by ltv.version_number desc,ltv.published_at desc nulls last
      limit 1;

      select legal_override.id,legal_override.legal_mode,legal_override.title,legal_override.body
      into v_override_id,v_override_mode,v_override_title,v_override_body
      from public.tenant_legal_overrides legal_override
      where legal_override.company_id=p_company_id
        and legal_override.module_key=v_module
        and legal_override.status in ('approved','published')
        and legal_override.locked_at is not null
      order by legal_override.reviewed_at desc nulls last,legal_override.created_at desc
      limit 1;

      if v_override_id is not null and v_override_mode='replacement' then
        v_source_title:=v_override_title;
        v_source_body:=v_override_body;
      elsif v_template_version_id is not null then
        v_source_title:=v_template_title;
        v_source_body:=v_template_body;
        if v_override_id is not null and v_override_mode='addendum' then
          v_source_title:=v_source_title||' – tenanttillägg';
          v_source_body:=v_source_body||E'\n\nTenanttillägg\n'||v_override_body;
        end if;
      else
        v_blockers:=v_blockers||jsonb_build_array(public.gridex_contract_readiness_blocker_v2(
          'required_legal_module_missing','legal_sources.'||v_module,
          'Obligatorisk juridikmodul saknar en publicerad låst källa: '||v_module||'.',null,
          'contract_product_version',o.contract_product_version_id,jsonb_build_object('module_key',v_module)
        ));
        continue;
      end if;

      if v_profile is not null then
        v_rendered_title:=public.gridex_render_legal_document(v_source_title,v_profile,v_company);
        v_rendered_body:=public.gridex_render_legal_document(v_source_body,v_profile,v_company);
        select coalesce(array_agg(distinct match_value[1] order by match_value[1]),'{}'::text[])
        into v_unresolved
        from regexp_matches(
          v_rendered_title||E'\n'||v_rendered_body,
          '\{\{[[:space:]]*([a-zA-Z0-9_.-]+)[[:space:]]*\}\}',
          'g'
        ) as matches(match_value);
        if cardinality(v_unresolved)>0 then
          v_blockers:=v_blockers||jsonb_build_array(public.gridex_contract_readiness_blocker_v2(
            'unresolved_legal_variables','legal_sources.'||v_module,
            'Juridikmodulen innehåller olösta mallvariabler.',to_jsonb(v_unresolved),
            'contract_product_version',o.contract_product_version_id,jsonb_build_object('module_key',v_module)
          ));
        end if;
      end if;
    end loop;
  else
    -- Channel activation is bound to the immutable bundle created by internal
    -- publication. Preview and commit therefore inspect the exact same locked
    -- legal bundle version.
    if o.legal_bundle_version_id is null then
      v_blockers:=v_blockers||jsonb_build_array(public.gridex_contract_readiness_blocker_v2(
        'legal_bundle_version_missing','legal_bundle_version_id',
        'Låst juridikversion saknas. Publicera avtalsversionen internt först.',null,
        'contract_offer',o.id
      ));
    elsif not exists(
      select 1 from public.legal_bundle_versions lbv
      where lbv.id=o.legal_bundle_version_id
        and lbv.company_id=p_company_id
        and lbv.contract_product_version_id=o.contract_product_version_id
        and lbv.status='published'
        and lbv.locked_at is not null
        and coalesce(cardinality(lbv.unresolved_variables),0)=0
    ) then
      v_blockers:=v_blockers||jsonb_build_array(public.gridex_contract_readiness_blocker_v2(
        'legal_bundle_version_not_ready','legal_bundle_version_id',
        'Juridikversionen är inte publicerad, låst och fri från olösta variabler.',
        to_jsonb(o.legal_bundle_version_id),'legal_bundle_version',o.legal_bundle_version_id
      ));
    else
      foreach v_module in array coalesce(v_required_modules,'{}'::text[]) loop
        if not exists(
          select 1 from public.legal_bundle_version_documents document
          where document.legal_bundle_version_id=o.legal_bundle_version_id
            and document.module_key=v_module
            and coalesce(cardinality(document.unresolved_variables),0)=0
        ) then
          v_blockers:=v_blockers||jsonb_build_array(public.gridex_contract_readiness_blocker_v2(
            'required_legal_module_missing','legal_bundle_version.'||v_module,
            'Den låsta juridikversionen saknar obligatorisk modul: '||v_module||'.',null,
            'legal_bundle_version',o.legal_bundle_version_id,jsonb_build_object('module_key',v_module)
          ));
        end if;
      end loop;
    end if;
  end if;

  v_can_execute:=jsonb_array_length(v_blockers)=0;
  return jsonb_build_object(
    'ok',v_can_execute,
    'status',case when v_can_execute then 'ready' else 'blocked' end,
    'can_execute',v_can_execute,
    'can_publish',v_can_execute,
    'operation',v_operation,
    'channel',v_channel,
    'code',case when v_can_execute then 'contract_ready' else 'contract_not_ready' end,
    'blockers',v_blockers,
    'lifecycle_status',o.lifecycle_status,
    'resolution',v_resolution,
    'expected_resolution',v_expected_resolution,
    'energy_direction',v_energy_direction,
    'required_legal_modules',to_jsonb(v_required_modules),
    'evaluated_at',now()
  );
end $$;

-- Compatibility wrapper for older internal callers. New code must call v2 and
-- consume the single structured blockers array.
create or replace function public.gridex_validate_contract_readiness(
  p_company_id uuid,p_contract_offer_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path=public,auth,pg_temp
as $$
declare
  v_status text;
  v_operation text;
  v_result jsonb;
  v_codes jsonb;
begin
  select lifecycle_status into v_status
  from public.contract_offers
  where id=p_contract_offer_id and company_id=p_company_id;
  v_operation:=case when v_status in ('published','paused') then 'activate_channel' else 'publish_version' end;
  v_result:=public.gridex_validate_contract_readiness_v2(
    p_company_id,p_contract_offer_id,v_operation,
    case when v_operation='activate_channel' then 'website' else null end
  );
  select coalesce(jsonb_agg(item->>'code'),'[]'::jsonb)
  into v_codes
  from jsonb_array_elements(coalesce(v_result->'blockers','[]'::jsonb)) item;
  return (v_result-'blockers')||jsonb_build_object(
    'blockers',v_codes,
    'blocker_details',coalesce(v_result->'blockers','[]'::jsonb)
  );
end $$;


-- Channel activation now consumes operation-specific readiness and returns
-- business blockers as JSON instead of embedding JSON in SQL exceptions.
-- Internal version publication returns structured business blockers and uses
-- the same operation-specific readiness that the admin preview consumes.
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

create or replace function public.gridex_publish_contract_channel(
  p_company_id uuid,p_offer_id uuid,p_channel text,p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  o public.contract_offers%rowtype;
  v_readiness jsonb;
  v_assignment_id uuid;
  v_publication_id uuid;
  v_publication_version_id uuid;
  v_legal_version_id uuid;
  v_public_offer_id uuid;
  v_snapshot jsonb;
  v_hash text;
  v_offer_reference text;
  v_version integer;
  v_channel text;
  v_billing_model text;
  v_spot_weight numeric;
  v_portfolio_weight numeric;
  v_fixed_weight numeric;
  v_price_areas text[]:='{}'::text[];
begin
  v_channel:=lower(coalesce(p_channel,''));
  if v_channel not in ('internal','website','api','partner','phone') then
    return jsonb_build_object(
      'ok',false,'changed',false,'code','invalid_contract_channel','channel',v_channel,
      'blockers',jsonb_build_array(public.gridex_contract_readiness_blocker_v2(
        'invalid_contract_channel','channel',
        'Kanalen måste vara internal, website, api, partner eller phone.',to_jsonb(v_channel)
      ))
    );
  end if;
  perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.publish');
  perform public.gridex_assert_contract_permission(p_actor_user_id,'pricing.publish');

  select * into o from public.contract_offers
  where id=p_offer_id and company_id=p_company_id for update;
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

  v_readiness:=public.gridex_validate_contract_readiness_v2(
    p_company_id,p_offer_id,
    case when o.lifecycle_status='paused' then 'resume_channel' else 'activate_channel' end,
    v_channel
  );
  if not coalesce((v_readiness->>'can_execute')::boolean,false) then
    return jsonb_build_object(
      'ok',false,'changed',false,'code','contract_channel_not_ready',
      'channel',v_channel,'lifecycle_status',o.lifecycle_status,
      'blockers',coalesce(v_readiness->'blockers','[]'::jsonb),
      'readiness',v_readiness
    );
  end if;
  if o.contract_product_version_id is null or not exists(
    select 1 from public.contract_product_versions pv
    where pv.id=o.contract_product_version_id and pv.status='approved' and pv.locked_at is not null
  ) then
    return jsonb_build_object(
      'ok',false,'changed',false,'code','contract_version_not_locked',
      'blockers',jsonb_build_array(public.gridex_contract_readiness_blocker_v2(
        'contract_version_not_locked','contract_product_version_id',
        'Canonical avtalsversion måste vara approved och låst före kanalaktivering.',
        to_jsonb(o.contract_product_version_id),'contract_product_version',o.contract_product_version_id
      ))
    );
  end if;

  if exists(
    select 1
    from public.tenant_contract_assignments ta
    join public.tenant_contract_channels ch on ch.assignment_id=ta.id
    join public.contract_publications cp on cp.assignment_id=ta.id and cp.channel=v_channel
    join public.contract_publication_versions cpv
      on cpv.contract_publication_id=cp.id
     and cpv.contract_product_version_id=o.contract_product_version_id
    where ta.company_id=p_company_id
      and ta.contract_product_version_id=o.contract_product_version_id
      and ta.status='active'
      and ch.channel=v_channel and ch.status='active'
      and cp.status='published' and cpv.status='published'
      and (ch.valid_from is null or ch.valid_from<=now())
      and (ch.valid_to is null or ch.valid_to>=now())
      and (
        v_channel<>'website'
        or exists(
          select 1 from public.public_contract_offers pco
          where pco.company_id=p_company_id
            and pco.contract_publication_version_id=cpv.id
            and pco.source_contract_offer_id=o.id
            and pco.lifecycle_status='published'
            and pco.publication_status='published'
            and pco.is_public and pco.website_enabled and pco.website_cta_enabled
        )
      )
  ) then
    return jsonb_build_object(
      'ok',true,'changed',false,'mode','published','code','contract_channel_already_active',
      'channel',v_channel,'contract_product_id',o.contract_product_id,
      'contract_product_version_id',o.contract_product_version_id,
      'blockers','[]'::jsonb
    );
  end if;

  perform public.gridex_sync_internal_offer_to_canonical(o.id);
  select * into o from public.contract_offers where id=o.id;

  -- The compatibility public-offer row is still consumed by parts of the
  -- website runtime. Derive its presentation fields from the same immutable
  -- commercial snapshot that is locked into the publication version.
  v_billing_model:=coalesce(nullif(o.commercial_snapshot->>'pricing_model',''),o.contract_type);
  v_spot_weight:=coalesce(
    case when coalesce(o.commercial_snapshot#>>'{portfolio_method,mix_shares,spot_weight_percent}','') ~ '^-?[0-9]+([.][0-9]+)?$'
      then (o.commercial_snapshot#>>'{portfolio_method,mix_shares,spot_weight_percent}')::numeric end,
    case when coalesce(o.commercial_snapshot->>'spot_weight_percent','') ~ '^-?[0-9]+([.][0-9]+)?$'
      then (o.commercial_snapshot->>'spot_weight_percent')::numeric end,
    100
  );
  v_portfolio_weight:=coalesce(
    case when coalesce(o.commercial_snapshot#>>'{portfolio_method,mix_shares,portfolio_weight_percent}','') ~ '^-?[0-9]+([.][0-9]+)?$'
      then (o.commercial_snapshot#>>'{portfolio_method,mix_shares,portfolio_weight_percent}')::numeric end,
    case when coalesce(o.commercial_snapshot->>'portfolio_weight_percent','') ~ '^-?[0-9]+([.][0-9]+)?$'
      then (o.commercial_snapshot->>'portfolio_weight_percent')::numeric end,
    0
  );
  v_fixed_weight:=coalesce(
    case when coalesce(o.commercial_snapshot#>>'{portfolio_method,mix_shares,fixed_weight_percent}','') ~ '^-?[0-9]+([.][0-9]+)?$'
      then (o.commercial_snapshot#>>'{portfolio_method,mix_shares,fixed_weight_percent}')::numeric end,
    case when coalesce(o.commercial_snapshot->>'fixed_weight_percent','') ~ '^-?[0-9]+([.][0-9]+)?$'
      then (o.commercial_snapshot->>'fixed_weight_percent')::numeric end,
    0
  );
  select coalesce(array_agg(distinct upper(btrim(area)) order by upper(btrim(area))),'{}'::text[])
  into v_price_areas
  from (
    select value as area
    from jsonb_array_elements_text(
      case when jsonb_typeof(o.commercial_snapshot->'price_areas')='array'
        then o.commercial_snapshot->'price_areas' else '[]'::jsonb end
    )
    where nullif(btrim(value),'') is not null
    union all
    select unnest(cpv.price_areas)
    from public.contract_product_versions cpv
    where cpv.id=o.contract_product_version_id
      and jsonb_array_length(
        case when jsonb_typeof(o.commercial_snapshot->'price_areas')='array'
          then o.commercial_snapshot->'price_areas' else '[]'::jsonb end
      )=0
  ) areas;

  -- Move only the selected channel from older versions in the same product
  -- series. Other channels stay active until separately switched.
  update public.tenant_contract_channels old_channel
  set status='ended',valid_to=coalesce(valid_to,now()),updated_at=now()
  from public.tenant_contract_assignments old_assignment
  join public.contract_product_versions old_version on old_version.id=old_assignment.contract_product_version_id
  where old_channel.assignment_id=old_assignment.id
    and old_assignment.company_id=p_company_id
    and old_version.contract_product_id=o.contract_product_id
    and old_assignment.contract_product_version_id<>o.contract_product_version_id
    and old_channel.channel=v_channel
    and old_channel.status in ('active','paused');

  -- Locked publication versions may only move through an explicit lifecycle transition.
  perform set_config('gridex.version_transition','on',true);
  update public.contract_publication_versions old_publication_version
  set status='ended',valid_to=coalesce(valid_to,now())
  from public.contract_publications old_publication
  join public.tenant_contract_assignments old_assignment on old_assignment.id=old_publication.assignment_id
  join public.contract_product_versions old_version on old_version.id=old_assignment.contract_product_version_id
  where old_publication_version.contract_publication_id=old_publication.id
    and old_assignment.company_id=p_company_id
    and old_version.contract_product_id=o.contract_product_id
    and old_assignment.contract_product_version_id<>o.contract_product_version_id
    and old_publication.channel=v_channel
    and old_publication_version.status='published';

  update public.contract_publications old_publication
  set status='ended',updated_at=now()
  from public.tenant_contract_assignments old_assignment
  join public.contract_product_versions old_version on old_version.id=old_assignment.contract_product_version_id
  where old_publication.assignment_id=old_assignment.id
    and old_assignment.company_id=p_company_id
    and old_version.contract_product_id=o.contract_product_id
    and old_assignment.contract_product_version_id<>o.contract_product_version_id
    and old_publication.channel=v_channel
    and old_publication.status not in ('ended','archived');

  update public.tenant_contract_assignments old_assignment
  set status=case when exists(
        select 1 from public.tenant_contract_channels remaining
        where remaining.assignment_id=old_assignment.id and remaining.status='active'
          and (remaining.valid_from is null or remaining.valid_from<=now())
          and (remaining.valid_to is null or remaining.valid_to>=now())
      ) then 'active' else 'ended' end,
      valid_to=case when exists(
        select 1 from public.tenant_contract_channels remaining
        where remaining.assignment_id=old_assignment.id and remaining.status='active'
          and (remaining.valid_from is null or remaining.valid_from<=now())
          and (remaining.valid_to is null or remaining.valid_to>=now())
      ) then old_assignment.valid_to else coalesce(old_assignment.valid_to,current_date) end,
      updated_at=now()
  from public.contract_product_versions old_version
  where old_version.id=old_assignment.contract_product_version_id
    and old_assignment.company_id=p_company_id
    and old_version.contract_product_id=o.contract_product_id
    and old_assignment.contract_product_version_id<>o.contract_product_version_id;

  update public.contract_offers old_offer
  set lifecycle_status=case when exists(
        select 1 from public.tenant_contract_assignments ta
        join public.tenant_contract_channels ch on ch.assignment_id=ta.id
        where ta.company_id=p_company_id
          and ta.contract_product_version_id=old_offer.contract_product_version_id
          and ta.status='active' and ch.status='active'
          and (ch.valid_from is null or ch.valid_from<=now())
          and (ch.valid_to is null or ch.valid_to>=now())
      ) then 'published' else 'superseded' end,
      status=case when exists(
        select 1 from public.tenant_contract_assignments ta
        join public.tenant_contract_channels ch on ch.assignment_id=ta.id
        where ta.company_id=p_company_id
          and ta.contract_product_version_id=old_offer.contract_product_version_id
          and ta.status='active' and ch.status='active'
      ) then 'active' else 'inactive' end,
      is_active=exists(
        select 1 from public.tenant_contract_assignments ta
        join public.tenant_contract_channels ch on ch.assignment_id=ta.id
        where ta.company_id=p_company_id
          and ta.contract_product_version_id=old_offer.contract_product_version_id
          and ta.status='active' and ch.status='active'
      ),
      superseded_at=case when exists(
        select 1 from public.tenant_contract_assignments ta
        join public.tenant_contract_channels ch on ch.assignment_id=ta.id
        where ta.company_id=p_company_id
          and ta.contract_product_version_id=old_offer.contract_product_version_id
          and ta.status='active' and ch.status='active'
      ) then old_offer.superseded_at else coalesce(old_offer.superseded_at,now()) end,
      updated_by=p_actor_user_id,updated_at=now()
  where old_offer.company_id=p_company_id
    and old_offer.contract_product_id=o.contract_product_id
    and old_offer.id<>o.id
    and old_offer.lifecycle_status not in ('archived','expired','closed');

  update public.contract_offers
  set lifecycle_status='published',status='active',is_active=true,
      superseded_at=null,updated_by=p_actor_user_id,updated_at=now()
  where id=o.id;
  update public.contract_products set status='active',updated_at=now()
  where id=o.contract_product_id and company_id=p_company_id;

  select id into v_assignment_id
  from public.tenant_contract_assignments
  where company_id=p_company_id and contract_product_version_id=o.contract_product_version_id
  for update;

  update public.tenant_contract_assignments
  set website_publication_allowed=website_publication_allowed or v_channel='website',
      internal_sales_allowed=internal_sales_allowed or v_channel='internal',
      status='active',valid_from=o.valid_from,valid_to=o.valid_to,updated_at=now()
  where id=v_assignment_id;

  insert into public.tenant_contract_channels(
    assignment_id,channel,status,valid_from,valid_to,marketing_content,updated_by
  ) values(
    v_assignment_id,v_channel,'active',o.valid_from::timestamptz,o.valid_to::timestamptz,
    jsonb_build_object('name',o.name,'source_contract_offer_id',o.id,'source_of_truth','contract_product_versions'),
    p_actor_user_id
  ) on conflict(assignment_id,channel) do update set
    status='active',valid_from=excluded.valid_from,valid_to=excluded.valid_to,
    marketing_content=excluded.marketing_content,updated_by=excluded.updated_by,updated_at=now();

  select legal_bundle_version_id into v_legal_version_id
  from public.contract_offers where id=o.id;

  insert into public.contract_publications(assignment_id,channel,status,created_by)
  values(v_assignment_id,v_channel,'published',p_actor_user_id)
  on conflict(assignment_id,channel) do update set status='published',updated_at=now()
  returning id into v_publication_id;

  select coalesce(max(version_number),0)+1 into v_version
  from public.contract_publication_versions where contract_publication_id=v_publication_id;
  v_offer_reference:=public.gridex_new_offer_reference(concat_ws('|',p_company_id::text,o.version_series_id::text,o.version_number::text,v_channel));
  v_snapshot:=jsonb_build_object(
    'schema','gridex_contract_publication_v5',
    'company_id',p_company_id,
    'contract_product_id',o.contract_product_id,
    'contract_product_version_id',o.contract_product_version_id,
    'source_contract_offer_id',o.id,
    'channel',v_channel,
    'offer_reference',v_offer_reference,
    'commercial_snapshot',o.commercial_snapshot,
    'legal_bundle_version_id',v_legal_version_id,
    'valid_from',o.valid_from,
    'valid_to',o.valid_to
  );
  v_hash:=encode(digest(v_snapshot::text,'sha256'),'hex');

  select id into v_publication_version_id
  from public.contract_publication_versions
  where contract_publication_id=v_publication_id and content_sha256=v_hash;
  if v_publication_version_id is null then
    insert into public.contract_publication_versions(
      contract_publication_id,version_number,contract_product_version_id,
      price_plan_id,price_plan_version_id,price_book_id,legal_bundle_version_id,
      customer_type,channel,valid_from,valid_to,publication_snapshot,offer_reference,
      content_sha256,status,published_at,locked_at,created_by
    ) values(
      v_publication_id,v_version,o.contract_product_version_id,
      o.price_plan_id,o.price_plan_version_id,o.price_book_id,v_legal_version_id,
      o.customer_type,v_channel,o.valid_from::timestamptz,o.valid_to::timestamptz,
      v_snapshot,v_offer_reference,v_hash,'published',now(),now(),p_actor_user_id
    ) returning id into v_publication_version_id;
  else
    -- Content is immutable, but a previously ended channel may be re-enabled.
    -- Reactivate the same locked publication identity instead of attempting a
    -- duplicate row with the same content hash/offer reference.
    perform set_config('gridex.version_transition','on',true);
    update public.contract_publication_versions
    set status='published',valid_from=o.valid_from::timestamptz,
        valid_to=o.valid_to::timestamptz,published_at=coalesce(published_at,now()),
        locked_at=coalesce(locked_at,now())
    where id=v_publication_version_id;
  end if;

  if v_channel='website' then
    perform set_config('gridex.public_offer_write','on',true);

    -- Only one website offer in a product series may be public. Older public
    -- compatibility rows remain for historic references but are immediately
    -- removed from all public/CTA surfaces.
    update public.public_contract_offers old_public
    set lifecycle_status='superseded',publication_status='unpublished',
        is_public=false,website_enabled=false,website_cta_enabled=false,
        updated_by=p_actor_user_id,updated_at=now()
    where old_public.company_id=p_company_id
      and old_public.contract_product_id=o.contract_product_id
      and old_public.source_contract_offer_id is distinct from o.id
      and (old_public.is_public or old_public.website_enabled or old_public.website_cta_enabled
           or old_public.publication_status='published');

    select id into v_public_offer_id
    from public.public_contract_offers
    where company_id=p_company_id and source_contract_offer_id=o.id
    order by created_at desc limit 1 for update;

    if v_public_offer_id is null then
      insert into public.public_contract_offers(
        company_id,source_contract_offer_id,version_series_id,version_number,
        contract_product_id,contract_product_version_id,contract_publication_version_id,
        legal_bundle_version_id,price_plan_id,price_plan_version_id,price_book_id,
        product_code,offer_code,public_name,public_description,contract_type,billing_model,
        customer_type,monthly_fee_sek,invoice_fee_sek,spot_markup_ore_per_kwh,
        variable_fee_ore_per_kwh,fixed_price_ore_per_kwh,green_fee_mode,green_fee_value,
        start_fee_sek,administration_fee_sek,break_fee_sek,discount_value,discount_unit,
        discount_months,vat_rate,terms_version,binding_months,notice_months,
        spot_weight_percent,portfolio_weight_percent,fixed_weight_percent,price_areas,
        automatic_renewal,power_of_attorney_required,valid_from,valid_to,
        is_public,is_archived,publication_status,lifecycle_status,website_enabled,
        website_cta_enabled,published_at,metadata,created_by,updated_by
      ) values(
        p_company_id,o.id,o.version_series_id,o.version_number,
        o.contract_product_id,o.contract_product_version_id,v_publication_version_id,
        v_legal_version_id,o.price_plan_id,o.price_plan_version_id,o.price_book_id,
        'electricity','contract-'||o.version_series_id::text,o.name,o.description,o.contract_type,
        v_billing_model,o.customer_type,
        o.monthly_fee_sek,o.invoice_fee_sek,o.spot_markup_ore_per_kwh,o.variable_fee_ore_per_kwh,
        o.fixed_price_ore_per_kwh,o.green_fee_mode,o.green_fee_value,o.start_fee_sek,o.admin_fee_sek,
        o.break_fee_sek,o.discount_value,o.discount_unit,o.discount_months,o.vat_rate,o.terms_version,
        o.default_binding_months,o.default_notice_months,
        v_spot_weight,v_portfolio_weight,v_fixed_weight,v_price_areas,
        o.automatic_renewal,o.power_of_attorney_required,o.valid_from,o.valid_to,
        true,false,'published','published',true,true,now(),
        jsonb_build_object('source_of_truth','contract_product_versions','offer_reference',v_offer_reference),
        p_actor_user_id,p_actor_user_id
      ) returning id into v_public_offer_id;
    else
      update public.public_contract_offers set
        contract_product_id=o.contract_product_id,
        contract_product_version_id=o.contract_product_version_id,
        contract_publication_version_id=v_publication_version_id,
        legal_bundle_version_id=v_legal_version_id,
        price_plan_id=o.price_plan_id,price_plan_version_id=o.price_plan_version_id,price_book_id=o.price_book_id,
        public_name=o.name,public_description=o.description,contract_type=o.contract_type,
        billing_model=v_billing_model,customer_type=o.customer_type,
        monthly_fee_sek=o.monthly_fee_sek,invoice_fee_sek=o.invoice_fee_sek,
        spot_markup_ore_per_kwh=o.spot_markup_ore_per_kwh,variable_fee_ore_per_kwh=o.variable_fee_ore_per_kwh,
        fixed_price_ore_per_kwh=o.fixed_price_ore_per_kwh,green_fee_mode=o.green_fee_mode,green_fee_value=o.green_fee_value,
        start_fee_sek=o.start_fee_sek,administration_fee_sek=o.admin_fee_sek,break_fee_sek=o.break_fee_sek,
        discount_value=o.discount_value,discount_unit=o.discount_unit,discount_months=o.discount_months,
        vat_rate=o.vat_rate,terms_version=o.terms_version,binding_months=o.default_binding_months,
        notice_months=o.default_notice_months,
        spot_weight_percent=v_spot_weight,portfolio_weight_percent=v_portfolio_weight,
        fixed_weight_percent=v_fixed_weight,price_areas=v_price_areas,
        automatic_renewal=o.automatic_renewal,
        power_of_attorney_required=o.power_of_attorney_required,valid_from=o.valid_from,valid_to=o.valid_to,
        is_public=true,is_archived=false,publication_status='published',lifecycle_status='published',
        website_enabled=true,website_cta_enabled=true,published_at=coalesce(published_at,now()),archived_at=null,
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('source_of_truth','contract_product_versions','offer_reference',v_offer_reference),
        updated_by=p_actor_user_id,updated_at=now()
      where id=v_public_offer_id;
    end if;
    update public.contract_publication_versions
    set legacy_public_contract_offer_id=v_public_offer_id
    where id=v_publication_version_id and legacy_public_contract_offer_id is null;
  end if;

  insert into public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata)
  values(
    p_company_id,p_actor_user_id,'contract_publication_version',v_publication_version_id::text,
    'contract.channel.published',null,v_snapshot,
    jsonb_build_object('offer_id',o.id,'channel',v_channel,'offer_reference',v_offer_reference)
  );

  return jsonb_build_object(
    'ok',true,'changed',true,'mode','published','channel',v_channel,
    'contract_product_id',o.contract_product_id,
    'contract_product_version_id',o.contract_product_version_id,
    'contract_publication_version_id',v_publication_version_id,
    'public_contract_offer_id',v_public_offer_id,
    'offer_reference',v_offer_reference,
    'affected_channels',1,
    'affected_publication_versions',1,
    'affected_public_offers',case when v_channel='website' then 1 else 0 end
  );
end $$;

-- Archive repeats operation-specific readiness under the same row lock used by the mutation.
create or replace function public.gridex_archive_contract_product(
  p_company_id uuid,p_offer_id uuid,p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  o public.contract_offers%rowtype;
  v_before jsonb;
  v_channels bigint:=0;
  v_publications bigint:=0;
  v_versions bigint:=0;
  v_assignments bigint:=0;
  v_public_offers bigint:=0;
  v_offers bigint:=0;
  v_readiness jsonb;
begin
  perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.archive');
  select * into o from public.contract_offers
  where id=p_offer_id and company_id=p_company_id for update;
  if not found then
    return jsonb_build_object(
      'ok',false,'changed',false,'mode','blocked','code','contract_not_found',
      'blockers',jsonb_build_array(public.gridex_contract_readiness_blocker_v2(
        'contract_offer_not_found','contract_offer_id',
        'Avtalsversionen hittades inte för valt bolag.',to_jsonb(p_offer_id),
        'contract_offer',p_offer_id
      ))
    );
  end if;
  if o.lifecycle_status='archived' then
    return jsonb_build_object(
      'ok',true,'changed',false,'mode','archived','code','contract_already_archived',
      'offer_id',o.id,'contract_product_id',o.contract_product_id
    );
  end if;

  v_readiness:=public.gridex_validate_contract_readiness_v2(
    p_company_id,o.id,'archive',null
  );
  if not coalesce((v_readiness->>'can_execute')::boolean,false) then
    return jsonb_build_object(
      'ok',false,'changed',false,'mode','blocked',
      'code','invalid_contract_transition',
      'current_status',o.lifecycle_status,'requested_status','archived',
      'blockers',coalesce(v_readiness->'blockers','[]'::jsonb),
      'readiness',v_readiness
    );
  end if;
  v_before:=to_jsonb(o);

  if o.contract_product_id is null then
    perform public.gridex_sync_internal_offer_to_canonical(o.id);
    select * into o from public.contract_offers where id=o.id for update;
  end if;

  update public.tenant_contract_channels ch
  set status='ended',valid_to=coalesce(valid_to,now()),updated_by=p_actor_user_id,updated_at=now()
  from public.tenant_contract_assignments ta
  join public.contract_product_versions cpv on cpv.id=ta.contract_product_version_id
  where ch.assignment_id=ta.id and ta.company_id=p_company_id and cpv.contract_product_id=o.contract_product_id
    and ch.status<>'ended';
  get diagnostics v_channels=row_count;

  perform set_config('gridex.version_transition','on',true);
  update public.contract_publication_versions pv
  set status=case when pv.locked_at is null then 'archived' else 'ended' end,
      valid_to=coalesce(valid_to,now())
  from public.contract_publications p
  join public.tenant_contract_assignments ta on ta.id=p.assignment_id
  join public.contract_product_versions cpv on cpv.id=ta.contract_product_version_id
  where pv.contract_publication_id=p.id and ta.company_id=p_company_id
    and cpv.contract_product_id=o.contract_product_id
    and pv.status not in ('ended','archived');
  get diagnostics v_versions=row_count;

  update public.contract_publications p set status='archived',updated_at=now()
  from public.tenant_contract_assignments ta
  join public.contract_product_versions cpv on cpv.id=ta.contract_product_version_id
  where p.assignment_id=ta.id and ta.company_id=p_company_id and cpv.contract_product_id=o.contract_product_id
    and p.status<>'archived';
  get diagnostics v_publications=row_count;

  update public.tenant_contract_assignments ta
  set status='ended',valid_to=coalesce(valid_to,current_date),updated_at=now()
  from public.contract_product_versions cpv
  where cpv.id=ta.contract_product_version_id and ta.company_id=p_company_id
    and cpv.contract_product_id=o.contract_product_id and ta.status<>'ended';
  get diagnostics v_assignments=row_count;

  perform set_config('gridex.public_offer_write','on',true);
  update public.public_contract_offers
  set lifecycle_status='archived',publication_status='archived',is_public=false,is_archived=true,
      website_enabled=false,website_cta_enabled=false,archived_at=coalesce(archived_at,now()),
      updated_by=p_actor_user_id,updated_at=now()
  where company_id=p_company_id and (
      (o.contract_product_id is not null and contract_product_id=o.contract_product_id)
      or source_contract_offer_id in (
        select series_offer.id from public.contract_offers series_offer
        where series_offer.company_id=p_company_id and series_offer.version_series_id=o.version_series_id
      )
    ) and not is_archived;
  get diagnostics v_public_offers=row_count;

  update public.contract_offers series_offer
  set lifecycle_status='archived',status='inactive',is_active=false,
      archived_at=coalesce(series_offer.archived_at,now()),
      updated_by=p_actor_user_id,updated_at=now()
  where series_offer.company_id=p_company_id
    and (series_offer.version_series_id=o.version_series_id
         or (o.contract_product_id is not null and series_offer.contract_product_id=o.contract_product_id))
    and series_offer.lifecycle_status<>'archived';
  get diagnostics v_offers=row_count;

  select * into o from public.contract_offers where id=p_offer_id;
  update public.contract_products set status='archived',updated_at=now()
  where id=o.contract_product_id and company_id=p_company_id;

  insert into public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata)
  values(p_company_id,p_actor_user_id,'contract_product',o.contract_product_id::text,'contract.product.archived',
    v_before,to_jsonb(o),jsonb_build_object(
      'offer_id',o.id,'history_preserved',true,'affected_channels',v_channels,
      'affected_publication_versions',v_versions,'affected_public_offers',v_public_offers
    ));

  return jsonb_build_object(
    'ok',true,'changed',(v_channels+v_publications+v_versions+v_assignments+v_public_offers+v_offers)>0,
    'mode','archived','code','contract_archived','offer',to_jsonb(o),'contract_product_id',o.contract_product_id,
    'affected_channels',v_channels,'affected_publications',v_publications,
    'affected_publication_versions',v_versions,'affected_assignments',v_assignments,
    'affected_public_offers',v_public_offers,'affected_contract_offers',v_offers
  );
end $$;

-- Terminal close with declared/fetched publication version IDs and preserved history.
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
  v_publication_version_ids uuid[]:='{}'::uuid[];
  v_offer_references text[]:='{}'::text[];
  v_channels bigint:=0;
  v_publications bigint:=0;
  v_versions bigint:=0;
  v_public_offers bigint:=0;
  v_quotes bigint:=0;
  v_event_id uuid;
  v_aggregate_id text;
  v_readiness jsonb;
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

  -- Repeat the same operation-specific readiness used by the admin preview
  -- after the target row has been locked. This prevents a stale UI preview
  -- from becoming the security or state-transition boundary.
  v_readiness:=public.gridex_validate_contract_readiness_v2(
    p_company_id,o.id,'close',null
  );
  if not coalesce((v_readiness->>'can_execute')::boolean,false) then
    return jsonb_build_object(
      'ok',false,'changed',false,'mode','blocked',
      'code','invalid_contract_transition',
      'current_status',o.lifecycle_status,'requested_status','closed',
      'blockers',coalesce(v_readiness->'blockers','[]'::jsonb),
      'readiness',v_readiness
    );
  end if;
  v_before:=to_jsonb(o);
  v_aggregate_id:=coalesce(o.contract_product_id,o.id)::text;

  -- Close only the selected version and currently sellable siblings. Historic
  -- superseded/expired/archived versions keep their original lifecycle status.
  v_offer_ids:=array(
    select co.id
    from public.contract_offers co
    where co.company_id=p_company_id
      and (
        co.id=o.id
        or (
          o.contract_product_id is not null
          and co.contract_product_id=o.contract_product_id
          and co.lifecycle_status in ('published','paused')
        )
      )
      and co.lifecycle_status not in ('superseded','expired','archived','closed')
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
  v_publication_version_ids:=array(
    select cpv.id
    from public.contract_publication_versions cpv
    join public.contract_publications cp on cp.id=cpv.contract_publication_id
    where cp.assignment_id=any(v_assignment_ids)
      and cpv.contract_product_version_id=any(v_product_version_ids)
    order by cpv.id
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
  where pco.id=any(v_public_offer_ids)
    and pco.lifecycle_status in ('draft','ready','published','paused');
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
  where co.id=any(v_offer_ids)
    and co.lifecycle_status in ('draft','ready','published','paused');

  if o.contract_product_id is not null then
    update public.contract_products cp
    set status='closed',updated_at=now()
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

-- Canonical admin archive/delete entry point. It repeats lifecycle readiness
-- after locking the offer, then delegates to the existing archive transaction
-- or the shared delete preview/commit dependency graph.
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
  v_mode text:=lower(nullif(btrim(coalesce(p_mode,'')),''));
  v_readiness jsonb;
  v_preview jsonb;
  v_lifecycle_status text;
begin
  if v_mode is null or v_mode not in ('archive','safe_delete') then
    return jsonb_build_object(
      'ok',false,'changed',false,'mode','blocked',
      'code','invalid_contract_remove_mode',
      'blockers',jsonb_build_array(public.gridex_contract_readiness_blocker_v2(
        'invalid_contract_remove_mode','mode',
        'Borttagningsläget måste vara archive eller safe_delete.',
        to_jsonb(v_mode),'contract_offer',p_offer_id
      ))
    );
  end if;

  if v_mode='archive' then
    perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.archive');
  else
    perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.delete_unused');
  end if;

  -- Lock before readiness so the state validated here cannot change before the
  -- delegated mutation repeats its own lock/dependency checks.
  select co.lifecycle_status into v_lifecycle_status
  from public.contract_offers co
  where co.id=p_offer_id and co.company_id=p_company_id
  for update;
  if not found then
    if v_mode='safe_delete' and exists(
      select 1 from public.audit_logs audit
      where audit.company_id=p_company_id
        and audit.action='contract.delete_unused'
        and audit.metadata->>'offer_id'=p_offer_id::text
    ) then
      return jsonb_build_object(
        'ok',true,'changed',false,'deleted',true,'mode','deleted',
        'code','contract_already_deleted','offer_id',p_offer_id
      );
    end if;
    return jsonb_build_object(
      'ok',false,'changed',false,'mode','blocked','code','contract_not_found',
      'blockers',jsonb_build_array(public.gridex_contract_readiness_blocker_v2(
        'contract_offer_not_found','contract_offer_id',
        'Avtalsversionen hittades inte för valt bolag.',to_jsonb(p_offer_id),
        'contract_offer',p_offer_id
      ))
    );
  end if;
  if v_mode='archive' and v_lifecycle_status='archived' then
    return jsonb_build_object(
      'ok',true,'changed',false,'mode','archived',
      'code','contract_already_archived','offer_id',p_offer_id
    );
  end if;

  v_readiness:=public.gridex_validate_contract_readiness_v2(
    p_company_id,p_offer_id,
    case when v_mode='archive' then 'archive' else 'delete' end,
    null
  );
  if not coalesce((v_readiness->>'can_execute')::boolean,false) then
    return jsonb_build_object(
      'ok',false,'changed',false,'mode','blocked',
      'code',case when v_mode='safe_delete' then 'contract_delete_blocked' else 'invalid_contract_transition' end,
      'blockers',coalesce(v_readiness->'blockers','[]'::jsonb),
      'recommended_action',case when v_mode='safe_delete' then 'archive' else null end,
      'readiness',v_readiness
    );
  end if;

  if v_mode='archive' then
    return public.gridex_archive_contract_product(
      p_company_id,p_offer_id,p_actor_user_id
    );
  end if;

  -- Preview and commit use the same dependency graph. The commit repeats the
  -- preview while holding its own row lock, closing the TOCTOU window.
  v_preview:=public.gridex_preview_delete_unused_contract(
    p_company_id,p_offer_id
  );
  if coalesce((v_preview->>'can_delete')::boolean,false) then
    return public.gridex_delete_unused_contract(
      p_company_id,p_offer_id,p_actor_user_id
    );
  end if;

  return jsonb_build_object(
    'ok',false,'changed',false,'mode','blocked',
    'code','contract_delete_blocked',
    'reason_codes',coalesce(v_preview->'reason_codes','[]'::jsonb),
    'blockers',coalesce(v_preview->'blockers','[]'::jsonb),
    'recommended_action',coalesce(v_preview->>'recommended_action','archive'),
    'delete_preview',v_preview,
    'readiness',v_readiness
  );
end $$;

revoke all on function public.gridex_contract_readiness_blocker_v2(
  text,text,text,jsonb,text,uuid,jsonb
) from public,anon;
grant execute on function public.gridex_contract_readiness_blocker_v2(
  text,text,text,jsonb,text,uuid,jsonb
) to service_role;

revoke all on function public.gridex_validate_contract_readiness_v2(
  uuid,uuid,text,text
) from public,anon,authenticated;
grant execute on function public.gridex_validate_contract_readiness_v2(
  uuid,uuid,text,text
) to service_role;

revoke all on function public.gridex_validate_contract_readiness(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.gridex_validate_contract_readiness(uuid,uuid)
  to service_role;

revoke all on function public.gridex_publish_internal_contract_version(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.gridex_publish_internal_contract_version(uuid,uuid,uuid)
  to service_role;

revoke all on function public.gridex_publish_contract_channel(uuid,uuid,text,uuid)
  from public,anon,authenticated;
grant execute on function public.gridex_publish_contract_channel(uuid,uuid,text,uuid)
  to service_role;

revoke all on function public.gridex_archive_contract_product(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.gridex_archive_contract_product(uuid,uuid,uuid)
  to service_role;

revoke all on function public.gridex_remove_internal_contract_offer(uuid,uuid,text,uuid)
  from public,anon,authenticated;
grant execute on function public.gridex_remove_internal_contract_offer(uuid,uuid,text,uuid)
  to service_role;

revoke all on function public.gridex_close_contract_product(uuid,uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.gridex_close_contract_product(uuid,uuid,uuid,text)
  to service_role;

comment on function public.gridex_validate_contract_readiness_v2(uuid,uuid,text,text) is
  'Operation-specific, service-only contract readiness. Returns one structured blockers array for publish_version, activate_channel, resume_channel, close, archive and delete.';
comment on function public.gridex_validate_contract_readiness(uuid,uuid) is
  'Compatibility wrapper for legacy callers. New code must use gridex_validate_contract_readiness_v2.';
comment on function public.gridex_publish_internal_contract_version(uuid,uuid,uuid) is
  'Readiness-gated immutable version publication. Business blockers are returned as structured JSON.';
comment on function public.gridex_publish_contract_channel(uuid,uuid,text,uuid) is
  'Idempotent channel activation using operation-specific readiness; business blockers are returned as structured JSON.';
comment on function public.gridex_close_contract_product(uuid,uuid,uuid,text) is
  'Terminal close for active/current versions only. Repeats close readiness under lock; historic superseded, expired and archived versions are preserved.';
comment on function public.gridex_remove_internal_contract_offer(uuid,uuid,text,uuid) is
  'Service-only canonical archive/delete entry point. Repeats lifecycle readiness under lock and reuses the shared deletion preview/commit graph.';

commit;
