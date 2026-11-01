-- Exact zero-consumption metering input; no fabricated commodity price.
-- Preserve function identity/ACL/config and every nonzero body branch.
BEGIN;
DO $repair$
DECLARE entry record; definition text; before_oid oid; before_acl aclitem[]; before_config text[];
 before_security boolean; before_volatility "char"; current_sha text; anchors text[]; replacements text[]; i integer;
BEGIN
 FOR entry IN SELECT * FROM (VALUES
  ('public.gridex_read_interval_pricing_snapshot_v1(uuid,uuid,timestamptz,timestamptz,text,text,jsonb)','e5136394e47ffa4b649d7228f63728f438ca25a7f30c4b26788c938cfb1a3d66','53822b8e7e2d5c710739fd075a2b262590fa950b7a5362e55d448c85b2354234',true),
  ('public.gridex_persist_pricing_run(uuid,uuid,jsonb,jsonb)','bce60486b4f1c94253d9ce4a444f6277babcbfb3ed106815aff8299f6dd96c95','0b196e776dc3c83b4edba4172ce3f0399f93eb50f09c43717f6e4d645c02a11b',false)) AS source(signature,predecessor_sha,target_sha,is_reader) LOOP
  SELECT p.oid,p.proacl,p.proconfig,p.prosecdef,p.provolatile,pg_get_functiondef(p.oid),encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')
   INTO STRICT before_oid,before_acl,before_config,before_security,before_volatility,definition,current_sha FROM pg_proc p WHERE p.oid=entry.signature::regprocedure;
  IF (SELECT p.prokind<>'f' OR p.prorettype<>(CASE WHEN entry.is_reader THEN 'jsonb'::regtype ELSE 'uuid'::regtype END) FROM pg_proc p WHERE p.oid=before_oid)
    OR NOT before_security OR before_volatility<>(CASE WHEN entry.is_reader THEN 's'::"char" ELSE 'v'::"char" END)
    OR before_config IS DISTINCT FROM (CASE WHEN entry.is_reader THEN ARRAY['search_path=public, extensions, pg_temp','TimeZone=UTC'] ELSE ARRAY['search_path=public, extensions, pg_temp'] END)
    OR has_function_privilege('anon',before_oid,'EXECUTE') OR has_function_privilege('authenticated',before_oid,'EXECUTE')
    OR NOT has_function_privilege('service_role',before_oid,'EXECUTE') THEN
    RAISE EXCEPTION 'zero_interval_function_contract_changed'; END IF;
  IF current_sha=entry.target_sha THEN CONTINUE; END IF;
  IF current_sha<>entry.predecessor_sha THEN RAISE EXCEPTION 'zero_interval_function_predecessor_changed'; END IF;
  IF entry.is_reader THEN
   anchors:=ARRAY[$p$  v_underlay public.billing_underlays%rowtype;
$p$,$p$  -- Exactly loadMarketPriceSourcePolicies$p$,$p$  into v_items,v_prices,v_policies;$p$,$p$  v_fingerprint:=encode($p$,$p$'items',v_items,'prices',v_prices)::text,'sha256')$p$,$p$extensions.digest(jsonb_build_object('selector'$p$];
   replacements:=ARRAY[$p$  v_underlay public.billing_underlays%rowtype;
  v_zero_metering_only boolean := false;
  v_zero_snapshot public.contract_price_snapshots%rowtype;
  v_zero_contract_type text;
  v_zero_resolution text;
  v_zero_components jsonb;
  v_zero_component jsonb;
  v_zero_area text;
  v_zero_weight numeric;
  v_zero_area_component text;
  v_zero_start timestamptz;
  v_zero_end timestamptz;
  v_zero_from timestamptz;
  v_zero_to timestamptz;
  v_zero_date text;
  v_zero_eligible integer := 0;
  v_zero_item record;
$p$,$p$  -- Obligation first: no item predicate or caller result/receipt can disable it.
  if v_underlay.total_kwh=0 and v_underlay.energy_direction='consumption' and v_underlay.settlement_type='invoice' then
    select s.* into v_zero_snapshot from public.contract_price_snapshots s
      join public.customer_contracts c on c.id=s.contract_id and c.company_id=s.company_id
      where s.company_id=p_company_id and s.contract_id=v_underlay.contract_id
        and s.id=coalesce(v_underlay.contract_price_snapshot_id,v_underlay.pricing_snapshot_id);
    if not found then raise exception using errcode='23514',message='zero_interval_immutable_contract_required'; end if;
    select c.contract_type into v_zero_contract_type from public.customer_contracts c
      where c.company_id=p_company_id and c.id=v_underlay.contract_id;
    v_zero_resolution:=coalesce(nullif(btrim(v_zero_snapshot.snapshot_json->>'interval_resolution'),''),
      nullif(btrim(v_zero_snapshot.snapshot_json#>>'{pricing,interval_resolution}'),''),
      case v_zero_contract_type when 'variable_hourly' then 'hourly' when 'variable_quarterly' then 'quarterly' else 'monthly' end);
    if v_zero_resolution not in ('monthly','hourly','quarterly') then
      raise exception using errcode='23514',message='zero_interval_canonical_resolution_invalid'; end if;
    if v_zero_resolution in ('hourly','quarterly') then
      v_zero_area:=coalesce(nullif(btrim(v_underlay.price_area),''),nullif(btrim(v_underlay.payload->>'price_area'),''));
      if (v_zero_area in ('SE1','SE2','SE3','SE4')) is not true then
        raise exception using errcode='23514',message='zero_interval_actual_area_required'; end if;
      v_zero_components:=v_zero_snapshot.base_price_components_snapshot;
      if v_zero_components='[]'::jsonb then
        v_zero_components:=coalesce(v_zero_snapshot.snapshot_json->'base_price_components_snapshot',v_zero_snapshot.snapshot_json->'base_price_components'); end if;
      if jsonb_typeof(v_zero_components) is distinct from 'array' or v_zero_components='[]'::jsonb then
        raise exception using errcode='23514',message='zero_interval_canonical_components_required'; end if;
      -- Component applicability follows actual business dates, not caller selectors.
      v_zero_start:=coalesce(v_underlay.billing_period_start,(v_period_start at time zone 'Europe/Stockholm')::date)::timestamp at time zone 'UTC';
      v_zero_end:=coalesce(v_underlay.billing_period_end,(v_period_end at time zone 'Europe/Stockholm')::date)::timestamp at time zone 'UTC';
      for v_zero_component in select value from jsonb_array_elements(v_zero_components) loop
        if jsonb_typeof(v_zero_component) is distinct from 'object'
          or (coalesce(v_zero_component->>'source_type',v_zero_component->>'sourceType') in ('spot','fixed','portfolio','manual')) is not true then
          raise exception using errcode='23514',message='zero_interval_canonical_component_invalid'; end if;
        begin
          v_zero_weight:=coalesce(nullif(btrim(v_zero_component->>'weight_percent'),''),nullif(btrim(v_zero_component->>'weightPercent'),''),'100')::numeric;
          v_zero_area_component:=upper(btrim(coalesce(v_zero_component->>'price_area',v_zero_component->>'priceArea','')));
          if v_zero_area_component<>'' and v_zero_area_component not in ('SE1','SE2','SE3','SE4') then raise exception 'invalid_area'; end if;
          v_zero_date:=coalesce(nullif(v_zero_component->>'valid_from',''),nullif(v_zero_component->>'validFrom',''));
          if v_zero_date is not null and v_zero_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and v_zero_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'ambiguous_component_time'; end if;
          v_zero_from:=case when v_zero_date is null then '-infinity'::timestamptz
            when v_zero_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (v_zero_date||'T00:00:00Z')::timestamptz else v_zero_date::timestamptz end;
          v_zero_date:=coalesce(nullif(v_zero_component->>'valid_to',''),nullif(v_zero_component->>'validTo',''));
          if v_zero_date is not null and v_zero_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and v_zero_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'ambiguous_component_time'; end if;
          v_zero_to:=case when v_zero_date is null then 'infinity'::timestamptz
            when v_zero_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (v_zero_date||'T00:00:00Z')::timestamptz+interval '1 day' else v_zero_date::timestamptz end;
        exception when others then raise exception using errcode='23514',message='zero_interval_canonical_component_invalid'; end;
        if v_zero_weight::text in ('NaN','Infinity','-Infinity') or v_zero_weight<0 or v_zero_weight>100
          or v_zero_from>v_zero_start and v_zero_from<v_zero_end or v_zero_to>v_zero_start and v_zero_to<v_zero_end then
          raise exception using errcode='23514',message='zero_interval_canonical_component_invalid'; end if;
        if (v_zero_area_component='' or v_zero_area_component=v_zero_area) and v_zero_from<v_zero_end and v_zero_to>v_zero_start then
          v_zero_eligible:=v_zero_eligible+1;
          if coalesce(v_zero_component->>'source_type',v_zero_component->>'sourceType')='spot' and v_zero_weight>0 then v_zero_metering_only:=true; end if;
        end if;
      end loop;
      if v_zero_eligible=0 then raise exception using errcode='23514',message='zero_interval_canonical_area_period_required'; end if;
    end if;
  end if;
  if v_zero_metering_only then
    select coalesce(jsonb_agg(to_jsonb(i) order by i.period_start,i.id),'[]'::jsonb) into v_items
      from (select * from public.billing_underlay_items where company_id=p_company_id and billing_underlay_id=p_billing_underlay_id order by period_start,id limit 150001) i;
    if jsonb_array_length(v_items)=0 then raise exception using errcode='23514',message='zero_interval_actual_items_required'; end if;
    for v_zero_item in select * from public.billing_underlay_items where company_id=p_company_id and billing_underlay_id=p_billing_underlay_id loop
      if not isfinite(v_zero_item.period_start) or not isfinite(v_zero_item.period_end)
        or v_zero_item.period_start<v_period_start or v_zero_item.period_end>v_period_end
        or v_zero_item.period_end-v_zero_item.period_start not in (interval '15 minutes',interval '60 minutes')
        or v_zero_resolution='quarterly' and v_zero_item.period_end-v_zero_item.period_start<>interval '15 minutes'
        or v_zero_item.quantity is null and v_zero_item.quantity_kwh is null
        or v_zero_item.quantity is not null and (v_zero_item.quantity::text in ('NaN','Infinity','-Infinity')
          or v_zero_item.quantity<>0 or lower(btrim(v_zero_item.unit)) not in ('kwh','wh','mwh') or v_zero_item.unit is null)
        or v_zero_item.quantity_kwh is not null and (v_zero_item.quantity_kwh::text in ('NaN','Infinity','-Infinity') or v_zero_item.quantity_kwh<>0)
      then raise exception using errcode='23514',message='zero_interval_actual_items_invalid'; end if;
    end loop;
    v_prices:='[]'::jsonb;v_policies:='[]'::jsonb;
  else
  -- Exactly loadMarketPriceSourcePolicies$p$,$p$  into v_items,v_prices,v_policies;
  end if;$p$,$p$  if v_zero_metering_only then v_receipt:=v_receipt||jsonb_build_object('input_kind','metering_only_zero_consumption_v1'); end if;
  v_fingerprint:=encode($p$,$p$'items',v_items,'prices',v_prices)||case when v_zero_metering_only then jsonb_build_object('immutable_contract_snapshot',to_jsonb(v_zero_snapshot)) else '{}'::jsonb end)::text,'sha256')$p$,$p$extensions.digest((jsonb_build_object('selector'$p$];
  ELSE
   anchors:=ARRAY[$p$  v_underlay public.billing_underlays%rowtype;
$p$,$p$  -- Successful spot interval results$p$,$p$  if (jsonb_array_length(coalesce(p_result->'interval_evidence'$p$,$p$    v_input_receipt:=p_result->'interval_input_snapshot';$p$];
   replacements:=ARRAY[$p$  v_underlay public.billing_underlays%rowtype;
  v_zero_metering_only boolean := false;
  v_zero_snapshot public.contract_price_snapshots%rowtype;
  v_zero_contract_type text;
  v_zero_resolution text;
  v_zero_components jsonb;
  v_zero_component jsonb;
  v_zero_area text;
  v_zero_weight numeric;
  v_zero_area_component text;
  v_zero_start timestamptz;
  v_zero_end timestamptz;
  v_zero_from timestamptz;
  v_zero_to timestamptz;
  v_zero_date text;
  v_zero_eligible integer := 0;
  v_zero_item record;
$p$,$p$  if v_final_status='success' then
  -- Obligation first: no item predicate or caller result/receipt can disable it.
  if v_underlay.total_kwh=0 and v_underlay.energy_direction='consumption' and v_underlay.settlement_type='invoice' then
    select s.* into v_zero_snapshot from public.contract_price_snapshots s
      join public.customer_contracts c on c.id=s.contract_id and c.company_id=s.company_id
      where s.company_id=p_company_id and s.contract_id=v_underlay.contract_id
        and s.id=coalesce(v_underlay.contract_price_snapshot_id,v_underlay.pricing_snapshot_id);
    if not found then raise exception using errcode='23514',message='zero_interval_immutable_contract_required'; end if;
    select c.contract_type into v_zero_contract_type from public.customer_contracts c
      where c.company_id=p_company_id and c.id=v_underlay.contract_id;
    v_zero_resolution:=coalesce(nullif(btrim(v_zero_snapshot.snapshot_json->>'interval_resolution'),''),
      nullif(btrim(v_zero_snapshot.snapshot_json#>>'{pricing,interval_resolution}'),''),
      case v_zero_contract_type when 'variable_hourly' then 'hourly' when 'variable_quarterly' then 'quarterly' else 'monthly' end);
    if v_zero_resolution not in ('monthly','hourly','quarterly') then
      raise exception using errcode='23514',message='zero_interval_canonical_resolution_invalid'; end if;
    if v_zero_resolution in ('hourly','quarterly') then
      v_zero_area:=coalesce(nullif(btrim(v_underlay.price_area),''),nullif(btrim(v_underlay.payload->>'price_area'),''));
      if (v_zero_area in ('SE1','SE2','SE3','SE4')) is not true then
        raise exception using errcode='23514',message='zero_interval_actual_area_required'; end if;
      v_zero_components:=v_zero_snapshot.base_price_components_snapshot;
      if v_zero_components='[]'::jsonb then
        v_zero_components:=coalesce(v_zero_snapshot.snapshot_json->'base_price_components_snapshot',v_zero_snapshot.snapshot_json->'base_price_components'); end if;
      if jsonb_typeof(v_zero_components) is distinct from 'array' or v_zero_components='[]'::jsonb then
        raise exception using errcode='23514',message='zero_interval_canonical_components_required'; end if;
      -- Component applicability follows actual business dates, not caller selectors.
      v_zero_start:=coalesce(v_underlay.billing_period_start,(v_period_start at time zone 'Europe/Stockholm')::date)::timestamp at time zone 'UTC';
      v_zero_end:=coalesce(v_underlay.billing_period_end,(v_period_end at time zone 'Europe/Stockholm')::date)::timestamp at time zone 'UTC';
      for v_zero_component in select value from jsonb_array_elements(v_zero_components) loop
        if jsonb_typeof(v_zero_component) is distinct from 'object'
          or (coalesce(v_zero_component->>'source_type',v_zero_component->>'sourceType') in ('spot','fixed','portfolio','manual')) is not true then
          raise exception using errcode='23514',message='zero_interval_canonical_component_invalid'; end if;
        begin
          v_zero_weight:=coalesce(nullif(btrim(v_zero_component->>'weight_percent'),''),nullif(btrim(v_zero_component->>'weightPercent'),''),'100')::numeric;
          v_zero_area_component:=upper(btrim(coalesce(v_zero_component->>'price_area',v_zero_component->>'priceArea','')));
          if v_zero_area_component<>'' and v_zero_area_component not in ('SE1','SE2','SE3','SE4') then raise exception 'invalid_area'; end if;
          v_zero_date:=coalesce(nullif(v_zero_component->>'valid_from',''),nullif(v_zero_component->>'validFrom',''));
          if v_zero_date is not null and v_zero_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and v_zero_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'ambiguous_component_time'; end if;
          v_zero_from:=case when v_zero_date is null then '-infinity'::timestamptz
            when v_zero_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (v_zero_date||'T00:00:00Z')::timestamptz else v_zero_date::timestamptz end;
          v_zero_date:=coalesce(nullif(v_zero_component->>'valid_to',''),nullif(v_zero_component->>'validTo',''));
          if v_zero_date is not null and v_zero_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and v_zero_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'ambiguous_component_time'; end if;
          v_zero_to:=case when v_zero_date is null then 'infinity'::timestamptz
            when v_zero_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (v_zero_date||'T00:00:00Z')::timestamptz+interval '1 day' else v_zero_date::timestamptz end;
        exception when others then raise exception using errcode='23514',message='zero_interval_canonical_component_invalid'; end;
        if v_zero_weight::text in ('NaN','Infinity','-Infinity') or v_zero_weight<0 or v_zero_weight>100
          or v_zero_from>v_zero_start and v_zero_from<v_zero_end or v_zero_to>v_zero_start and v_zero_to<v_zero_end then
          raise exception using errcode='23514',message='zero_interval_canonical_component_invalid'; end if;
        if (v_zero_area_component='' or v_zero_area_component=v_zero_area) and v_zero_from<v_zero_end and v_zero_to>v_zero_start then
          v_zero_eligible:=v_zero_eligible+1;
          if coalesce(v_zero_component->>'source_type',v_zero_component->>'sourceType')='spot' and v_zero_weight>0 then v_zero_metering_only:=true; end if;
        end if;
      end loop;
      if v_zero_eligible=0 then raise exception using errcode='23514',message='zero_interval_canonical_area_period_required'; end if;
    end if;
  end if;
  end if;
  -- Successful spot interval results$p$,$p$  if (v_zero_metering_only or jsonb_array_length(coalesce(p_result->'interval_evidence'$p$,$p$    v_input_receipt:=p_result->'interval_input_snapshot';
    if v_zero_metering_only and (
      v_input_receipt->>'input_kind' is distinct from 'metering_only_zero_consumption_v1'
      or v_input_receipt->>'price_count' is distinct from '0' or v_input_receipt->>'policy_count' is distinct from '0'
      or coalesce(p_result->'interval_evidence','[]'::jsonb)<>'[]'::jsonb
      or coalesce(p_result->'prices','[]'::jsonb)<>'[]'::jsonb or coalesce(p_result->'policies','[]'::jsonb)<>'[]'::jsonb)
    then raise exception using errcode='23514',message='zero_interval_metering_only_receipt_required'; end if;
$p$];
  END IF;
  FOR i IN 1..array_length(anchors,1) LOOP
    IF length(definition)-length(replace(definition,anchors[i],''))<>length(anchors[i]) THEN
      RAISE EXCEPTION 'zero_interval_function_exact_anchor_changed'; END IF;
    definition:=replace(definition,anchors[i],replacements[i]);
  END LOOP;
  EXECUTE definition;
  IF NOT EXISTS(SELECT FROM pg_proc p WHERE p.oid=before_oid AND p.oid=entry.signature::regprocedure
      AND p.proacl IS NOT DISTINCT FROM before_acl AND p.proconfig IS NOT DISTINCT FROM before_config
      AND p.prosecdef=before_security AND p.provolatile=before_volatility
      AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=entry.target_sha) THEN
    RAISE EXCEPTION 'zero_interval_function_postcondition_changed'; END IF;
 END LOOP;
END;
$repair$;
COMMIT;
