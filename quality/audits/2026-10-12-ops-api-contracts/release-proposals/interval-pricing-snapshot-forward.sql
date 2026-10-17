-- Prospective forward repair, reviewed against actual OPS catalog bodies.
-- This module SUPERSEDES pricing-run-instant-forward.sql; never apply that older
-- predecessor-bound patch after this module. No historical money/time backfill.
-- One service-only STABLE entry snapshot replaces separately paged financial reads.
-- The existing VOLATILE persist takes its underlay lock first, then short SHARE
-- locks and obtains a fresh SPI snapshot after any lock wait before any writes.
BEGIN;
DO $guard$
BEGIN
  IF to_regprocedure('public.gridex_read_interval_pricing_snapshot_v1(uuid,uuid,timestamp with time zone,timestamp with time zone,text,text,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'interval_pricing_snapshot_rpc_already_exists';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.gridex_persist_pricing_run(uuid,uuid,jsonb,jsonb)'::regprocedure)
     IS DISTINCT FROM '40e5c757d605d6a899e2189cf36e16b0' THEN
    RAISE EXCEPTION 'interval_pricing_snapshot_persist_predecessor_changed';
  END IF;
END;
$guard$;

CREATE FUNCTION public.gridex_read_interval_pricing_snapshot_v1(
  p_company_id uuid, p_billing_underlay_id uuid,
  p_period_start timestamptz, p_period_end timestamptz,
  p_price_area text, p_required_resolution text, p_expected_underlay jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO public,extensions,pg_temp
SET TimeZone TO 'UTC'
AS $snapshot$
DECLARE
  v_underlay public.billing_underlays%rowtype;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_period_start_text text;
  v_period_end_text text;
  v_snapshot jsonb;
  v_contract_type text;
  v_expected_resolution text;
  v_area text;
  v_items jsonb;
  v_prices jsonb;
  v_policies jsonb;
  v_receipt jsonb;
  v_fingerprint text;
BEGIN
  if p_company_id is null or p_billing_underlay_id is null
     or p_period_start is null or p_period_end is null
     or not isfinite(p_period_start) or not isfinite(p_period_end)
     or p_period_end<=p_period_start
     or p_required_resolution is null or p_required_resolution not in ('hourly','quarterly')
     or p_price_area is null or p_price_area not in ('SE1','SE2','SE3','SE4')
     or jsonb_typeof(p_expected_underlay) is distinct from 'object' then
    raise exception using errcode='22023',message='interval_pricing_snapshot_selector_invalid';
  end if;
  select * into v_underlay from public.billing_underlays
    where company_id=p_company_id and id=p_billing_underlay_id;
  if not found then
    raise exception using errcode='P0002',message='billing_underlay_not_found_for_tenant';
  end if;
  if to_jsonb(v_underlay) is distinct from p_expected_underlay then
    raise exception using errcode='40001',message='interval_pricing_underlay_changed_retry';
  end if;
  if v_underlay.underlay_year is null or v_underlay.underlay_month is null then
    raise exception using errcode='23514',message='pricing_run_period_month_required';
  end if;
  if coalesce(v_underlay.payload,'{}'::jsonb) ? 'billing_period_start_instant'
     or coalesce(v_underlay.payload,'{}'::jsonb) ? 'billing_period_end_instant' then
    if jsonb_typeof(v_underlay.payload->'billing_period_start_instant') is distinct from 'string'
       or jsonb_typeof(v_underlay.payload->'billing_period_end_instant') is distinct from 'string' then
      raise exception using errcode='23514',message='pricing_run_period_instant_pair_required';
    end if;
    v_period_start_text := v_underlay.payload->>'billing_period_start_instant';
    v_period_end_text := v_underlay.payload->>'billing_period_end_instant';
    if v_period_start_text !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$'
       or v_period_end_text !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' then
      raise exception using errcode='23514',message='pricing_run_period_timezone_required';
    end if;
    v_period_start := v_period_start_text::timestamptz;
    v_period_end := v_period_end_text::timestamptz;
    if (v_underlay.payload ? 'billing_period_timezone'
        and v_underlay.payload->>'billing_period_timezone' is distinct from 'Europe/Stockholm')
       or (v_underlay.payload ? 'billing_period_end_exclusive'
           and v_underlay.payload->'billing_period_end_exclusive' is distinct from 'true'::jsonb)
       or (v_underlay.billing_period_start is not null and (v_period_start at time zone 'Europe/Stockholm')::date is distinct from v_underlay.billing_period_start)
       or (v_underlay.billing_period_end is not null and (v_period_end at time zone 'Europe/Stockholm')::date is distinct from v_underlay.billing_period_end) then
      raise exception using errcode='23514',message='pricing_run_period_metadata_mismatch';
    end if;
  else
    v_period_start := coalesce(v_underlay.billing_period_start,make_date(v_underlay.underlay_year,v_underlay.underlay_month,1))::timestamp at time zone 'Europe/Stockholm';
    v_period_end := coalesce(v_underlay.billing_period_end,(make_date(v_underlay.underlay_year,v_underlay.underlay_month,1)+interval '1 month')::date)::timestamp at time zone 'Europe/Stockholm';
  end if;
  if v_period_end <= v_period_start then
    raise exception using errcode='23514',message='pricing_run_period_chronology_invalid';
  end if;

  -- Match engine.normalizePricingSnapshot and its interval-resolution fallback.
  select (case when jsonb_typeof(v_underlay.pricing_snapshot)='object' then v_underlay.pricing_snapshot else '{}'::jsonb end)||(case when jsonb_typeof(s.snapshot_json)='object' then s.snapshot_json else '{}'::jsonb end), c.contract_type
    into v_snapshot,v_contract_type
  from public.customer_contracts c
  left join public.contract_price_snapshots s
    on s.company_id=p_company_id and s.contract_id=c.id
    and s.id=coalesce(v_underlay.contract_price_snapshot_id,v_underlay.pricing_snapshot_id)
  where c.company_id=p_company_id and c.id=v_underlay.contract_id and c.status in ('active','signed');
  v_snapshot:=coalesce(v_snapshot,case when jsonb_typeof(v_underlay.pricing_snapshot)='object' then v_underlay.pricing_snapshot else '{}'::jsonb end);
  v_expected_resolution:=coalesce(nullif(btrim(v_snapshot->>'interval_resolution'),''),
    nullif(btrim(v_snapshot#>>'{pricing,interval_resolution}'),''),
    case v_contract_type when 'variable_quarterly' then 'quarterly'
      when 'variable_hourly' then 'hourly' else 'monthly' end);
  v_area:=coalesce(nullif(btrim(v_underlay.price_area),''),nullif(btrim(v_underlay.payload->>'price_area'),''));
  if p_period_start is distinct from v_period_start or p_period_end is distinct from v_period_end
     or p_price_area is distinct from v_area or p_required_resolution is distinct from v_expected_resolution then
    raise exception using errcode='23514',message='interval_pricing_snapshot_underlay_selector_mismatch';
  end if;

  -- Exactly loadMarketPriceSourcePolicies + existing interval eligibility:
  -- enabled company policy, required supported_resolutions, ascending priority.
  -- price_areas is captured but does not introduce a new interval eligibility rule.
  -- Native NOT NULL/check constraints prove JS defaults 100/180/[] cannot fire
  -- on these actual columns; all other policy fields are captured unchanged.
  with policies as materialized (
    select p.* from public.company_market_price_sources p
    where p.company_id=p_company_id and p.enabled=true
      and p_required_resolution=any(p.supported_resolutions)
    order by p.priority,p.source_key limit 150001
  ), items as materialized (
    select i.* from public.billing_underlay_items i
    where i.company_id=p_company_id and i.billing_underlay_id=p_billing_underlay_id
    order by i.period_start,i.id limit 150001
  ), prices as materialized (
    select s.* from public.spot_price_intervals s
    where s.price_area=p_price_area and s.time_start<p_period_end and s.time_end>p_period_start
      and exists(select 1 from policies p where p.source_key=s.source)
    order by s.time_start,s.id limit 150001
  )
  select
    coalesce((select jsonb_agg(to_jsonb(i) order by i.period_start,i.id) from items i),'[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(s) order by s.time_start,s.id) from prices s),'[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(p) order by p.priority,p.source_key) from policies p),'[]'::jsonb)
  into v_items,v_prices,v_policies;
  if jsonb_array_length(v_items)>150000 or jsonb_array_length(v_prices)>150000
     or jsonb_array_length(v_policies)>150000 then
    raise exception using errcode='54000',message='interval_pricing_snapshot_row_limit_exceeded';
  end if;
  v_receipt:=jsonb_build_object('schema_version',1,'company_id',p_company_id,
    'billing_underlay_id',p_billing_underlay_id,'period_start',v_period_start,
    'period_end',v_period_end,'price_area',v_area,'required_resolution',v_expected_resolution,
    'item_count',jsonb_array_length(v_items),'price_count',jsonb_array_length(v_prices),
    'policy_count',jsonb_array_length(v_policies));
  v_fingerprint:=encode(extensions.digest(jsonb_build_object('selector',v_receipt,
    'underlay',to_jsonb(v_underlay),'policies',v_policies,'items',v_items,'prices',v_prices)::text,'sha256'),'hex');
  return jsonb_build_object('receipt',v_receipt||jsonb_build_object('fingerprint',v_fingerprint),
    'items',v_items,'prices',v_prices,'policies',v_policies);
END;
$snapshot$;
REVOKE ALL ON FUNCTION public.gridex_read_interval_pricing_snapshot_v1(uuid,uuid,timestamptz,timestamptz,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_read_interval_pricing_snapshot_v1(uuid,uuid,timestamptz,timestamptz,text,text,jsonb) TO service_role;
COMMENT ON FUNCTION public.gridex_read_interval_pricing_snapshot_v1(uuid,uuid,timestamptz,timestamptz,text,text,jsonb)
  IS 'Internal service-only bounded interval pricing snapshot; company/underlay selectors and mutation fingerprint are derived and verified natively.';

DO $repair$
DECLARE
  v_definition text;
  v_body_md5 text;
BEGIN
  select pg_get_functiondef(p.oid),md5(p.prosrc) into strict v_definition,v_body_md5
    from pg_proc p where p.oid='public.gridex_persist_pricing_run(uuid,uuid,jsonb,jsonb)'::regprocedure;
  if v_body_md5 is distinct from '40e5c757d605d6a899e2189cf36e16b0' then
    raise exception 'interval_pricing_snapshot_persist_predecessor_changed';
  end if;
  if length(v_definition)-length(replace(v_definition,$anchor0$  v_rows integer;
$anchor0$,'')) <> length($anchor0$  v_rows integer;
$anchor0$) then
    raise exception 'interval_pricing_snapshot_exact_anchor_0_changed';
  end if;
  if length(v_definition)-length(replace(v_definition,$anchor1$  insert into public.pricing_runs(
$anchor1$,'')) <> length($anchor1$  insert into public.pricing_runs(
$anchor1$) then
    raise exception 'interval_pricing_snapshot_exact_anchor_1_changed';
  end if;
  if length(v_definition)-length(replace(v_definition,$anchor2$    p_company_id,p_billing_underlay_id,v_underlay.customer_id,v_underlay.billing_period_start,v_underlay.billing_period_end,
$anchor2$,'')) <> length($anchor2$    p_company_id,p_billing_underlay_id,v_underlay.customer_id,v_underlay.billing_period_start,v_underlay.billing_period_end,
$anchor2$) then
    raise exception 'interval_pricing_snapshot_exact_anchor_2_changed';
  end if;
  if length(v_definition)-length(replace(v_definition,$anchor3$coalesce(p_result->'errors','[]'::jsonb),jsonb_build_object('source','pricing_core','atomic',true)$anchor3$,'')) <> length($anchor3$coalesce(p_result->'errors','[]'::jsonb),jsonb_build_object('source','pricing_core','atomic',true)$anchor3$) then
    raise exception 'interval_pricing_snapshot_exact_anchor_3_changed';
  end if;
  v_definition:=replace(v_definition,$anchor0$  v_rows integer;
$anchor0$,$patch0$  v_rows integer;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_period_start_text text;
  v_period_end_text text;
  v_snapshot jsonb;
  v_contract_type text;
  v_expected_resolution text;
  v_input_receipt jsonb;
  v_current_snapshot jsonb;
$patch0$);
  v_definition:=replace(v_definition,$anchor1$  insert into public.pricing_runs(
$anchor1$,$patch1$  if v_underlay.underlay_year is null or v_underlay.underlay_month is null then
    raise exception using errcode='23514',message='pricing_run_period_month_required';
  end if;
  if coalesce(v_underlay.payload,'{}'::jsonb) ? 'billing_period_start_instant'
     or coalesce(v_underlay.payload,'{}'::jsonb) ? 'billing_period_end_instant' then
    if jsonb_typeof(v_underlay.payload->'billing_period_start_instant') is distinct from 'string'
       or jsonb_typeof(v_underlay.payload->'billing_period_end_instant') is distinct from 'string' then
      raise exception using errcode='23514',message='pricing_run_period_instant_pair_required';
    end if;
    v_period_start_text := v_underlay.payload->>'billing_period_start_instant';
    v_period_end_text := v_underlay.payload->>'billing_period_end_instant';
    if v_period_start_text !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$'
       or v_period_end_text !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' then
      raise exception using errcode='23514',message='pricing_run_period_timezone_required';
    end if;
    v_period_start := v_period_start_text::timestamptz;
    v_period_end := v_period_end_text::timestamptz;
    if (v_underlay.payload ? 'billing_period_timezone'
        and v_underlay.payload->>'billing_period_timezone' is distinct from 'Europe/Stockholm')
       or (v_underlay.payload ? 'billing_period_end_exclusive'
           and v_underlay.payload->'billing_period_end_exclusive' is distinct from 'true'::jsonb)
       or (v_underlay.billing_period_start is not null and (v_period_start at time zone 'Europe/Stockholm')::date is distinct from v_underlay.billing_period_start)
       or (v_underlay.billing_period_end is not null and (v_period_end at time zone 'Europe/Stockholm')::date is distinct from v_underlay.billing_period_end) then
      raise exception using errcode='23514',message='pricing_run_period_metadata_mismatch';
    end if;
  else
    v_period_start := coalesce(v_underlay.billing_period_start,make_date(v_underlay.underlay_year,v_underlay.underlay_month,1))::timestamp at time zone 'Europe/Stockholm';
    v_period_end := coalesce(v_underlay.billing_period_end,(make_date(v_underlay.underlay_year,v_underlay.underlay_month,1)+interval '1 month')::date)::timestamp at time zone 'Europe/Stockholm';
  end if;
  if v_period_end <= v_period_start then
    raise exception using errcode='23514',message='pricing_run_period_chronology_invalid';
  end if;

  -- Match engine.normalizePricingSnapshot and its interval-resolution fallback.
  select (case when jsonb_typeof(v_underlay.pricing_snapshot)='object' then v_underlay.pricing_snapshot else '{}'::jsonb end)||(case when jsonb_typeof(s.snapshot_json)='object' then s.snapshot_json else '{}'::jsonb end), c.contract_type
    into v_snapshot,v_contract_type
  from public.customer_contracts c
  left join public.contract_price_snapshots s
    on s.company_id=p_company_id and s.contract_id=c.id
    and s.id=coalesce(v_underlay.contract_price_snapshot_id,v_underlay.pricing_snapshot_id)
  where c.company_id=p_company_id and c.id=v_underlay.contract_id and c.status in ('active','signed');
  v_snapshot:=coalesce(v_snapshot,case when jsonb_typeof(v_underlay.pricing_snapshot)='object' then v_underlay.pricing_snapshot else '{}'::jsonb end);
  v_expected_resolution:=coalesce(nullif(btrim(v_snapshot->>'interval_resolution'),''),
    nullif(btrim(v_snapshot#>>'{pricing,interval_resolution}'),''),
    case v_contract_type when 'variable_quarterly' then 'quarterly'
      when 'variable_hourly' then 'hourly' else 'monthly' end);
  -- Successful spot interval results and any captured interval evidence require
  -- a native receipt. Missing receipt cannot silently skip the locked recheck.
  if (jsonb_array_length(coalesce(p_result->'interval_evidence','[]'::jsonb))>0
      or (v_final_status='success' and v_expected_resolution in ('hourly','quarterly')
          and exists(select 1 from jsonb_array_elements(coalesce(p_result->'lines','[]'::jsonb)) x
            where x->>'line_type'='base_price' and x#>>'{metadata,source_type}'='spot'
              and coalesce((x#>>'{metadata,weight_percent}')::numeric,100)>0)))
     and jsonb_typeof(p_result->'interval_input_snapshot') is distinct from 'object' then
    raise exception using errcode='23514',message='interval_pricing_snapshot_receipt_required';
  end if;
  if p_result ? 'interval_input_snapshot' then
    if jsonb_typeof(p_result->'interval_input_snapshot') is distinct from 'object' then
      raise exception using errcode='23514',message='interval_pricing_snapshot_receipt_invalid';
    end if;
    v_input_receipt:=p_result->'interval_input_snapshot';
    if (v_input_receipt->>'schema_version') is distinct from '1'
       or (v_input_receipt->>'company_id') is distinct from p_company_id::text
       or (v_input_receipt->>'billing_underlay_id') is distinct from p_billing_underlay_id::text
       or (v_input_receipt->>'fingerprint') is null
       or (v_input_receipt->>'fingerprint') !~ '^[0-9a-f]{64}$' then
      raise exception using errcode='23514',message='interval_pricing_snapshot_receipt_invalid';
    end if;
    -- Existing advisory/underlay row lock is already held. SHARE blocks every
    -- INSERT/UPDATE/DELETE price, child quantity and source-policy mutation until
    -- commit. VOLATILE persist's following SPI SELECT gets a fresh snapshot
    -- after lock waits; STABLE read sees that one fresh snapshot throughout.
    lock table public.spot_price_intervals in share mode;
    lock table public.billing_underlay_items in share mode;
    lock table public.company_market_price_sources in share mode;
    select public.gridex_read_interval_pricing_snapshot_v1(p_company_id,p_billing_underlay_id,
      (v_input_receipt->>'period_start')::timestamptz,(v_input_receipt->>'period_end')::timestamptz,
      v_input_receipt->>'price_area',v_input_receipt->>'required_resolution',to_jsonb(v_underlay))
      into v_current_snapshot;
    if v_current_snapshot->'receipt' is distinct from v_input_receipt then
      raise exception using errcode='40001',message='interval_pricing_inputs_changed_retry';
    end if;
  end if;

  insert into public.pricing_runs(
$patch1$);
  v_definition:=replace(v_definition,$anchor2$    p_company_id,p_billing_underlay_id,v_underlay.customer_id,v_underlay.billing_period_start,v_underlay.billing_period_end,
$anchor2$,$patch2$    p_company_id,p_billing_underlay_id,v_underlay.customer_id,v_period_start,v_period_end,
$patch2$);
  v_definition:=replace(v_definition,$anchor3$coalesce(p_result->'errors','[]'::jsonb),jsonb_build_object('source','pricing_core','atomic',true)$anchor3$,$patch3$coalesce(p_result->'errors','[]'::jsonb),jsonb_build_object('source','pricing_core','atomic',true)||case when v_input_receipt is not null then jsonb_build_object('interval_input_snapshot',v_input_receipt) else '{}'::jsonb end$patch3$);
  -- CREATE OR REPLACE retains the existing identity, return type, VOLATILE
  -- semantics, security definer, search_path and exact existing EXECUTE grants.
  execute v_definition;
END;
$repair$;
COMMIT;
