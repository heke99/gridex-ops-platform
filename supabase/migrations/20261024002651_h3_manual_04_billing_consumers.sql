-- PRIVATE source-qualified manual→actual received end billing consumers.
BEGIN;
CREATE FUNCTION gridex_received_sources.manual_received_billing_authority_v1(c uuid,pid uuid,s timestamptz,e timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE p public.customer_supply_periods%rowtype;ct public.customer_contracts%rowtype;b jsonb;BEGIN
 b:=gridex_received_sources.manual_received_source_basis_v1(c,pid,s,e);
 IF b->>'manualReceivedEndReceiptId' IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO p FROM public.customer_supply_periods WHERE id=pid AND company_id=c FOR SHARE;
 SELECT * INTO ct FROM public.customer_contracts WHERE id=p.contract_id AND company_id=c FOR SHARE;
 IF ct.status IS DISTINCT FROM 'terminated' OR NOT coalesce(ct.termination_reason IN('move_out','grid_contract_ended','customer_termination'),false) THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('version',1,'companyId',c,'periodId',p.id,'contractId',ct.id,'customerId',p.customer_id,'meteringPointId',p.metering_point_id,
  'receiptId',b->>'manualReceivedEndReceiptId','startAt',s,'endAt',e,'sourceEndMessageId',p.source_end_message_id,'marketStateVersion',p.market_state_version,
  'marketEndAt',p.market_end_at,'contractEndedAt',ct.ended_at,'contractStatus',ct.status,'terminationReason',ct.termination_reason);
END$$;
REVOKE ALL ON FUNCTION gridex_received_sources.manual_received_billing_authority_v1(uuid,uuid,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
DO $patch$ DECLARE f record;BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='public.gridex_read_billing_source_values_v1(uuid,uuid[])'::regprocedure;
 IF encode(sha256(convert_to(f.prosrc,'UTF8')),'hex') IS DISTINCT FROM '3d1a829f6b04f93ae332a3ee35168e8c15efdbb0861ef65266b5fb6bc5634b50' THEN RAISE EXCEPTION 'manual_received_consumer_exact_predecessor_required:public.gridex_read_billing_source_values_v1(uuid,uuid[])';END IF;
 EXECUTE replace(f.definition,f.prosrc,$body$
DECLARE n public.normalized_metering_values%rowtype;s public.ediel_messages%rowtype;b jsonb;result jsonb:='[]';manual_ends jsonb;
BEGIN
 IF coalesce(current_setting('role',true),'')<>'service_role' AND current_user<>'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 IF p_company_id IS NULL OR p_value_ids IS NULL OR cardinality(p_value_ids)>1000 OR array_position(p_value_ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'billing_source_scope_required' USING ERRCODE='22023'; END IF;
 PERFORM gridex_billing_source.lock_values_v1(p_company_id,p_value_ids);
 FOR n IN SELECT * FROM public.normalized_metering_values WHERE company_id=p_company_id AND id=ANY(p_value_ids) ORDER BY id LOOP
  b:=gridex_billing_source.basis_v1(p_company_id,n.id);
  SELECT * INTO s FROM public.ediel_messages WHERE id=n.source_message_id AND company_id=p_company_id;
  SELECT coalesce(jsonb_agg(a.b) FILTER(WHERE a.b IS NOT NULL),'[]'::jsonb) INTO manual_ends
   FROM public.customer_supply_periods p CROSS JOIN LATERAL(SELECT gridex_received_sources.manual_received_billing_authority_v1(p_company_id,p.id,n.period_start,n.period_end) b)a
   WHERE p.company_id=p_company_id AND p.metering_point_id=n.metering_point_id AND (n.customer_id IS NULL OR p.customer_id=n.customer_id)
    AND (n.supply_period_id IS NULL OR p.id=n.supply_period_id) AND p.market_start_at<n.period_end AND p.market_end_at>=n.period_end;
  result:=result||jsonb_build_array(to_jsonb(n)||jsonb_build_object('quantity_kwh',b->'quantityKwh','product_code',CASE WHEN b->'qualified'='true'::jsonb THEN b->'productCode' ELSE to_jsonb(n.product_code) END,'register_code',CASE WHEN b->'qualified'='true'::jsonb THEN b->'registerCode' ELSE to_jsonb(n.register_code) END,'quality_status',CASE WHEN b->'qualified'='true'::jsonb THEN b->'quality' ELSE to_jsonb(n.quality_status) END,
   'billing_source_basis',b,'billing_manual_received_end_authorities',manual_ends,'billing_source_message',CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object('id',s.id,'company_id',s.company_id,'message_family',s.message_family,'message_code',s.message_code,'status',s.status) END));
 END LOOP;
 RETURN result;
END $body$);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'manual_received_consumer_metadata_changed';END IF;
END$patch$;
DO $patch$ DECLARE f record;BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='public.gridex_persist_pricing_run(uuid,uuid,jsonb,jsonb)'::regprocedure;
 IF encode(sha256(convert_to(f.prosrc,'UTF8')),'hex') IS DISTINCT FROM '007a5782b002ba5d0dda1cff67ef075b1b05c3d79212f81430107f638be870c5' THEN RAISE EXCEPTION 'manual_received_consumer_exact_predecessor_required:public.gridex_persist_pricing_run(uuid,uuid,jsonb,jsonb)';END IF;
 EXECUTE replace(f.definition,f.prosrc,$body$
declare
  v_underlay public.billing_underlays%rowtype;
  v_run_id uuid;
  v_final_status text:=coalesce(nullif(p_result->>'status',''),'failed');
  v_rows integer;
  v_source_bound boolean;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_period_start_text text;
  v_period_end_text text;
  v_snapshot jsonb;
  v_contract_type text;
  v_expected_resolution text;
  v_input_receipt jsonb;
  v_current_snapshot jsonb;
begin
  if p_company_id is null or p_billing_underlay_id is null then
    raise exception using errcode='22023',message='company_and_billing_underlay_required';
  end if;
  if v_final_status not in ('success','failed','needs_review') then
    raise exception using errcode='22023',message='invalid_pricing_result_status';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_billing_underlay_id::text,0));
  select * into v_underlay from public.billing_underlays
  where id=p_billing_underlay_id and company_id=p_company_id for update;
  if not found then raise exception using errcode='P0002',message='billing_underlay_not_found_for_tenant'; end if;
  v_source_bound:=EXISTS(SELECT FROM gridex_billing_source.underlay_bindings b WHERE b.company_id=p_company_id AND b.underlay_id=p_billing_underlay_id);
  IF v_source_bound AND coalesce(p_pricing_snapshot,'{}'::jsonb) IS DISTINCT FROM coalesce(v_underlay.pricing_snapshot,'{}'::jsonb) THEN
    RAISE EXCEPTION 'source_bound_pricing_snapshot_mismatch' USING ERRCODE='23514';
  END IF;
  if v_underlay.contract_id is null or coalesce(v_underlay.contract_price_snapshot_id,v_underlay.pricing_snapshot_id) is null then
    raise exception using errcode='23514',message='exact_contract_and_price_snapshot_required';
  end if;
  if exists(select 1 from public.pricing_runs where company_id=p_company_id and billing_underlay_id=p_billing_underlay_id and status='locked') then
    raise exception using errcode='55000',message='pricing_run_locked';
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
  where c.company_id=p_company_id and c.id=v_underlay.contract_id and (c.status in ('active','signed')
    -- H3 (20261023199000): a contract terminated by exactly this underlay's supply end still carries its final period,
    -- by the rule of gridex_set_metering_billing_gate/gridex_store_billing_underlay (text-identical, n.period_* = v_period_*).
    or exists(select 1 from public.customer_supply_periods sp join public.customer_contracts ct on ct.id=c.id and ct.company_id=p_company_id
      where sp.id=v_underlay.supply_period_id and sp.company_id=p_company_id and sp.contract_id=ct.id
        and sp.customer_id=v_underlay.customer_id and sp.metering_point_id=v_underlay.metering_point_id
        and ct.customer_id=v_underlay.customer_id and ct.metering_point_id=v_underlay.metering_point_id
        and NOT (NOT coalesce(sp.status IN ('active','confirmed_by_grid_owner','ending','ended'),false)
   OR (sp.status IN ('ending','ended') AND coalesce(sp.actual_end_date,sp.end_date) IS NULL)
   -- H3: a contract ended by exactly this period's end still carries the period up to that end.
   -- H3b (20261023200000): that end is a Z05 supply end ('supply_end') or a manual move-out on that date ('move_out').
   OR NOT coalesce(ct.status IN ('signed','active') OR gridex_received_sources.manual_received_source_basis_v1(p_company_id,sp.id,v_period_start,v_period_end) IS NOT NULL OR (ct.status='terminated' AND ct.termination_reason IN ('supply_end','move_out','grid_contract_ended','customer_termination') AND sp.end_date IS NOT NULL AND ct.ended_at IS NOT NULL
    AND ((ct.ended_at AT TIME ZONE 'UTC')::date>=sp.end_date OR (ct.ended_at AT TIME ZONE 'Europe/Stockholm')::date>=sp.end_date)),false))
        and NOT (sp.start_date IS NULL OR (sp.start_date::timestamp AT TIME ZONE 'Europe/Stockholm')>v_period_start)
        and NOT (coalesce(sp.actual_end_date,sp.end_date) IS NOT NULL AND (CASE
     -- H1: a received market end at the start of its date is exclusive (end_date = first day not supplied).
     -- F108 M5: it ends at the market instant itself (00:00 +0100, 23:00Z in summer), as the qualified supply basis.
     WHEN sp.market_end_at IS NOT NULL AND sp.market_end_at<=(coalesce(sp.actual_end_date,sp.end_date)::timestamp AT TIME ZONE 'Europe/Stockholm')+interval '1 hour'
     THEN sp.market_end_at ELSE (coalesce(sp.actual_end_date,sp.end_date)+1)::timestamp AT TIME ZONE 'Europe/Stockholm' END)<v_period_end)));
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
    company_id,billing_underlay_id,customer_id,billing_period_start,billing_period_end,status,
    total_ex_vat,vat_amount,total_inc_vat,warnings,errors,metadata
  ) values (
    p_company_id,p_billing_underlay_id,v_underlay.customer_id,v_period_start,v_period_end,
    case when v_final_status='success' then 'needs_review' else v_final_status end,
    coalesce((p_result->>'total_ex_vat')::numeric,0),coalesce((p_result->>'vat_amount')::numeric,0),
    coalesce((p_result->>'total_inc_vat')::numeric,0),coalesce(p_result->'warnings','[]'::jsonb),
    coalesce(p_result->'errors','[]'::jsonb),jsonb_build_object('source','pricing_core','atomic',true)||case when v_input_receipt is not null then jsonb_build_object('interval_input_snapshot',v_input_receipt) else '{}'::jsonb end
  ) returning id into v_run_id;

  insert into public.pricing_preview_lines(
    company_id,pricing_run_id,billing_underlay_id,line_type,description,quantity,unit,
    unit_price_ex_vat,amount_ex_vat,vat_rate,vat_amount,amount_inc_vat,sort_order,metadata
  )
  select p_company_id,v_run_id,p_billing_underlay_id,
    coalesce(nullif(x->>'line_type',''),'unknown'),coalesce(nullif(x->>'description',''),'Prisrad'),
    nullif(x->>'quantity','')::numeric,coalesce(nullif(x->>'unit',''),'st'),nullif(x->>'unit_price_ex_vat','')::numeric,
    coalesce(nullif(x->>'amount_ex_vat','')::numeric,0),coalesce(nullif(x->>'vat_rate','')::numeric,0),
    coalesce(nullif(x->>'vat_amount','')::numeric,0),coalesce(nullif(x->>'amount_inc_vat','')::numeric,0),
    coalesce(nullif(x->>'sort_order','')::integer,100),coalesce(x->'metadata','{}'::jsonb)
  from jsonb_array_elements(coalesce(p_result->'lines','[]'::jsonb)) x;

  insert into public.pricing_interval_evidence(
    company_id,pricing_run_id,billing_underlay_id,billing_underlay_item_id,customer_contract_id,
    metering_interval_start,metering_interval_end,resolution,consumption_kwh,price_sek_per_kwh,
    amount_ex_vat,price_source_id,price_area,evidence_sha256
  )
  select p_company_id,v_run_id,p_billing_underlay_id,nullif(x->>'billing_underlay_item_id','')::uuid,
    v_underlay.contract_id,(x->>'metering_interval_start')::timestamptz,(x->>'metering_interval_end')::timestamptz,
    x->>'resolution',(x->>'consumption_kwh')::numeric,(x->>'price_sek_per_kwh')::numeric,
    (x->>'amount_ex_vat')::numeric,nullif(x->>'price_source_id','')::uuid,x->>'price_area',
    encode(digest((x||jsonb_build_object('pricing_run_id',v_run_id))::text,'sha256'),'hex')
  from jsonb_array_elements(coalesce(p_result->'interval_evidence','[]'::jsonb)) x;

  if v_final_status='success' then
    update public.pricing_runs set status='superseded'
    where company_id=p_company_id and billing_underlay_id=p_billing_underlay_id and id<>v_run_id and status='success';
    update public.pricing_runs set status='success' where id=v_run_id;
    update public.billing_underlays set
      status='validated',readiness_status='ready',readiness_issues='[]'::jsonb,
      invoice_readiness_status='ready_for_invoice',invoice_readiness_issues='[]'::jsonb,
      calculated_total_sek_ex_vat=coalesce((p_result->>'total_ex_vat')::numeric,0),
      calculated_vat_sek=coalesce((p_result->>'vat_amount')::numeric,0),
      calculated_total_sek_inc_vat=coalesce((p_result->>'total_inc_vat')::numeric,0),
      pricing_snapshot=CASE WHEN v_source_bound THEN pricing_snapshot ELSE coalesce(p_pricing_snapshot,'{}'::jsonb)||jsonb_build_object(
        'latest_pricing_run_id',v_run_id,'latest_pricing_warnings',coalesce(p_result->'warnings','[]'::jsonb),
        'latest_pricing_errors',coalesce(p_result->'errors','[]'::jsonb)
      ) END,updated_at=now()
    where id=p_billing_underlay_id and company_id=p_company_id;
    get diagnostics v_rows=row_count;
    if v_rows<>1 then raise exception using errcode='P0002',message='billing_underlay_atomic_update_failed'; end if;
  else
    update public.billing_underlays set
      pricing_snapshot=CASE WHEN v_source_bound THEN pricing_snapshot ELSE coalesce(pricing_snapshot,'{}'::jsonb)||jsonb_build_object(
        'latest_failed_pricing_run_id',v_run_id,'latest_pricing_errors',coalesce(p_result->'errors','[]'::jsonb)
      ) END,updated_at=now()
    where id=p_billing_underlay_id and company_id=p_company_id;
  end if;
  return v_run_id;
end
$body$);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'manual_received_consumer_metadata_changed';END IF;
END$patch$;
DO $patch$ DECLARE f record;BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='public.gridex_read_interval_pricing_snapshot_v1(uuid,uuid,timestamp with time zone,timestamp with time zone,text,text,jsonb)'::regprocedure;
 IF encode(sha256(convert_to(f.prosrc,'UTF8')),'hex') IS DISTINCT FROM '3a4370c53f10d8c5aa596d476320a42b597bde395c992f260d3d5fa9e710258d' THEN RAISE EXCEPTION 'manual_received_consumer_exact_predecessor_required:public.gridex_read_interval_pricing_snapshot_v1(uuid,uuid,timestamp with time zone,timestamp with time zone,text,text,jsonb)';END IF;
 EXECUTE replace(f.definition,f.prosrc,$body$
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
  where c.company_id=p_company_id and c.id=v_underlay.contract_id and (c.status in ('active','signed')
    -- H3 (20261023199000): a contract terminated by exactly this underlay's supply end still carries its final period,
    -- by the rule of gridex_set_metering_billing_gate/gridex_store_billing_underlay (text-identical, n.period_* = v_period_*).
    or exists(select 1 from public.customer_supply_periods sp join public.customer_contracts ct on ct.id=c.id and ct.company_id=p_company_id
      where sp.id=v_underlay.supply_period_id and sp.company_id=p_company_id and sp.contract_id=ct.id
        and sp.customer_id=v_underlay.customer_id and sp.metering_point_id=v_underlay.metering_point_id
        and ct.customer_id=v_underlay.customer_id and ct.metering_point_id=v_underlay.metering_point_id
        and NOT (NOT coalesce(sp.status IN ('active','confirmed_by_grid_owner','ending','ended'),false)
   OR (sp.status IN ('ending','ended') AND coalesce(sp.actual_end_date,sp.end_date) IS NULL)
   -- H3: a contract ended by exactly this period's end still carries the period up to that end.
   -- H3b (20261023200000): that end is a Z05 supply end ('supply_end') or a manual move-out on that date ('move_out').
   OR NOT coalesce(ct.status IN ('signed','active') OR gridex_received_sources.manual_received_source_basis_v1(p_company_id,sp.id,v_period_start,v_period_end) IS NOT NULL OR (ct.status='terminated' AND ct.termination_reason IN ('supply_end','move_out','grid_contract_ended','customer_termination') AND sp.end_date IS NOT NULL AND ct.ended_at IS NOT NULL
    AND ((ct.ended_at AT TIME ZONE 'UTC')::date>=sp.end_date OR (ct.ended_at AT TIME ZONE 'Europe/Stockholm')::date>=sp.end_date)),false))
        and NOT (sp.start_date IS NULL OR (sp.start_date::timestamp AT TIME ZONE 'Europe/Stockholm')>v_period_start)
        and NOT (coalesce(sp.actual_end_date,sp.end_date) IS NOT NULL AND (CASE
     -- H1: a received market end at the start of its date is exclusive (end_date = first day not supplied).
     -- F108 M5: it ends at the market instant itself (00:00 +0100, 23:00Z in summer), as the qualified supply basis.
     WHEN sp.market_end_at IS NOT NULL AND sp.market_end_at<=(coalesce(sp.actual_end_date,sp.end_date)::timestamp AT TIME ZONE 'Europe/Stockholm')+interval '1 hour'
     THEN sp.market_end_at ELSE (coalesce(sp.actual_end_date,sp.end_date)+1)::timestamp AT TIME ZONE 'Europe/Stockholm' END)<v_period_end)));
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
$body$);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'manual_received_consumer_metadata_changed';END IF;
END$patch$;
DO $patch$ DECLARE f record;BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='public.gridex_set_metering_billing_gate(uuid,uuid,uuid,jsonb)'::regprocedure;
 IF encode(sha256(convert_to(f.prosrc,'UTF8')),'hex') IS DISTINCT FROM '08d95c8082f4bab789987524b2d29573b716b31cdfd09503aee821ad8d4b332d' THEN RAISE EXCEPTION 'manual_received_consumer_exact_predecessor_required:public.gridex_set_metering_billing_gate(uuid,uuid,uuid,jsonb)';END IF;
 EXECUTE replace(f.definition,f.prosrc,$body$
DECLARE b jsonb;legal_basis jsonb;n public.normalized_metering_values%rowtype;sp public.customer_supply_periods%rowtype;ct public.customer_contracts%rowtype;
BEGIN
 IF coalesce(current_setting('role',true),'')<>'service_role' AND current_user<>'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 IF p_company_id IS NULL OR p_metering_value_id IS NULL OR p_normalized_value_id IS NULL OR p_gate IS NULL THEN RAISE EXCEPTION 'billing_gate_scope_required' USING ERRCODE='22023'; END IF;
 PERFORM gridex_billing_source.lock_values_v1(p_company_id,ARRAY[p_normalized_value_id],nullif(p_gate->>'supply_period_id','')::uuid);
 SELECT * INTO n FROM public.normalized_metering_values WHERE company_id=p_company_id AND id=p_normalized_value_id AND source_metering_value_id=p_metering_value_id;
 IF n.id IS NULL THEN RAISE EXCEPTION 'billing_gate_value_scope_mismatch'; END IF;
 IF p_gate->>'billing_status'='billable' OR p_gate->>'billing_gate_status'='eligible' THEN
  b:=gridex_billing_source.basis_v1(p_company_id,n.id);
  IF b->'qualified' IS DISTINCT FROM 'true'::jsonb OR b->'qualityEstablished' IS DISTINCT FROM 'true'::jsonb OR b->'quality' IS DISTINCT FROM 'null'::jsonb
   OR p_gate->>'source_message_id' IS DISTINCT FROM n.source_message_id::text THEN RAISE EXCEPTION 'billing_gate_qualified_final_source_required' USING ERRCODE='23514'; END IF;
  SELECT * INTO sp FROM public.customer_supply_periods WHERE id=(p_gate->>'supply_period_id')::uuid AND company_id=p_company_id FOR SHARE;
  SELECT * INTO ct FROM public.customer_contracts WHERE id=sp.contract_id AND company_id=p_company_id FOR SHARE;
  IF sp.id IS NULL OR ct.id IS NULL OR NOT coalesce(sp.status IN ('active','confirmed_by_grid_owner','ending','ended'),false)
   OR (sp.status IN ('ending','ended') AND coalesce(sp.actual_end_date,sp.end_date) IS NULL)
   -- H3: a contract ended by exactly this period's end still carries the period up to that end.
   -- H3b (20261023200000): that end is a Z05 supply end ('supply_end') or a manual move-out on that date ('move_out').
   OR NOT coalesce(ct.status IN ('signed','active') OR gridex_received_sources.manual_received_source_basis_v1(p_company_id,sp.id,n.period_start,n.period_end) IS NOT NULL OR (ct.status='terminated' AND ct.termination_reason IN ('supply_end','move_out','grid_contract_ended','customer_termination') AND sp.end_date IS NOT NULL AND ct.ended_at IS NOT NULL
    AND ((ct.ended_at AT TIME ZONE 'UTC')::date>=sp.end_date OR (ct.ended_at AT TIME ZONE 'Europe/Stockholm')::date>=sp.end_date)),false)
   OR sp.customer_id IS DISTINCT FROM n.customer_id OR sp.metering_point_id IS DISTINCT FROM n.metering_point_id OR ct.customer_id IS DISTINCT FROM n.customer_id OR ct.metering_point_id IS DISTINCT FROM n.metering_point_id
   OR sp.start_date IS NULL OR (sp.start_date::timestamp AT TIME ZONE 'Europe/Stockholm')>n.period_start
   OR (coalesce(sp.actual_end_date,sp.end_date) IS NOT NULL AND (CASE
     -- H1: a received market end at the start of its date is exclusive (end_date = first day not supplied).
     -- F108 M5: it ends at the market instant itself (00:00 +0100, 23:00Z in summer), as the qualified supply basis.
     WHEN sp.market_end_at IS NOT NULL AND sp.market_end_at<=(coalesce(sp.actual_end_date,sp.end_date)::timestamp AT TIME ZONE 'Europe/Stockholm')+interval '1 hour'
     THEN sp.market_end_at ELSE (coalesce(sp.actual_end_date,sp.end_date)+1)::timestamp AT TIME ZONE 'Europe/Stockholm' END)<n.period_end)
   OR nullif(coalesce(to_jsonb(ct)->>'starts_at',to_jsonb(ct)->>'start_date'),'') IS NULL
   OR (left(coalesce(to_jsonb(ct)->>'starts_at',to_jsonb(ct)->>'start_date'),10)::date::timestamp AT TIME ZONE 'Europe/Stockholm')>n.period_start
   OR (nullif(coalesce(to_jsonb(ct)->>'ends_at',to_jsonb(ct)->>'end_date'),'') IS NOT NULL AND (CASE WHEN sp.market_start_at IS NOT NULL OR sp.market_end_at IS NOT NULL
     -- F108: on an Ediel-qualified supply the contract's last day also covers the end of its Ediel month.
     THEN GREATEST((left(coalesce(to_jsonb(ct)->>'ends_at',to_jsonb(ct)->>'end_date'),10)::date+1)::timestamp AT TIME ZONE 'Europe/Stockholm',(left(coalesce(to_jsonb(ct)->>'ends_at',to_jsonb(ct)->>'end_date'),10)::date+1)::timestamp AT TIME ZONE 'Etc/GMT-1')
     ELSE (left(coalesce(to_jsonb(ct)->>'ends_at',to_jsonb(ct)->>'end_date'),10)::date+1)::timestamp AT TIME ZONE 'Europe/Stockholm' END)<n.period_end)
   THEN RAISE EXCEPTION 'billing_gate_supply_contract_scope_mismatch' USING ERRCODE='23514'; END IF;
  legal_basis:=gridex_received_sources.billing_supply_basis_v1(p_company_id,sp.id,n.period_start,n.period_end);
  IF legal_basis IS NULL OR legal_basis->'qualified' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'billing_gate_qualified_supply_source_required' USING ERRCODE='23514'; END IF;
  p_gate:=p_gate||jsonb_build_object('billing_gate_snapshot',coalesce(p_gate->'billing_gate_snapshot','{}')||jsonb_build_object('source_basis',b,'supply_source_basis',legal_basis));
 END IF;
 RETURN gridex_billing_source.gridex_set_metering_billing_gate_before_source_v2(p_company_id,p_metering_value_id,p_normalized_value_id,p_gate);
END $body$);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'manual_received_consumer_metadata_changed';END IF;
END$patch$;
DO $patch$ DECLARE f record;BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='public.gridex_store_billing_underlay(uuid,jsonb,jsonb,uuid)'::regprocedure;
 IF encode(sha256(convert_to(f.prosrc,'UTF8')),'hex') IS DISTINCT FROM '35d8fe640f2c199c635caffc7b22065d0ad59b98ae621764edaf016613f61f0c' THEN RAISE EXCEPTION 'manual_received_consumer_exact_predecessor_required:public.gridex_store_billing_underlay(uuid,jsonb,jsonb,uuid)';END IF;
 EXECUTE replace(f.definition,f.prosrc,$body$
DECLARE item jsonb;basis jsonb;legal_basis jsonb;rows_basis jsonb:='[]';source_basis jsonb;basis_hash text;total numeric:=0;u public.billing_underlays%rowtype;
 n public.normalized_metering_values%rowtype;sp public.customer_supply_periods%rowtype;ct public.customer_contracts%rowtype;price public.contract_price_snapshots%rowtype;pv public.price_plan_versions%rowtype;
 prior gridex_billing_source.underlay_bindings%rowtype;stored_id uuid;start_at timestamptz;end_at timestamptz;ready boolean;
BEGIN
 IF coalesce(current_setting('role',true),'')<>'service_role' AND current_user<>'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 IF p_company_id IS NULL OR p_underlay IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'billing_underlay_scope_required' USING ERRCODE='22023'; END IF;
 start_at:=(p_underlay->>'billing_period_start')::timestamptz;end_at:=(p_underlay->>'billing_period_end')::timestamptz;
 IF start_at IS NULL OR end_at IS NULL OR end_at<=start_at THEN RAISE EXCEPTION 'billing_underlay_exact_period_required' USING ERRCODE='22023'; END IF;
 ready:=p_underlay->>'status'='validated' OR p_underlay->>'readiness_status'='ready';
 PERFORM pg_advisory_xact_lock(hashtextextended(p_company_id::text||':billing-underlay-batch',0));
 SELECT * INTO u FROM public.billing_underlays WHERE company_id=p_company_id AND customer_id=(p_underlay->>'customer_id')::uuid AND metering_point_id=(p_underlay->>'metering_point_id')::uuid
  AND underlay_year=(p_underlay->>'underlay_year')::integer AND underlay_month=(p_underlay->>'underlay_month')::integer
  AND billing_period_start=(start_at AT TIME ZONE 'Europe/Stockholm')::date AND billing_period_end=(end_at AT TIME ZONE 'Europe/Stockholm')::date AND energy_direction=p_underlay->>'energy_direction';
 SELECT * INTO prior FROM gridex_billing_source.underlay_bindings WHERE underlay_id=u.id;
 IF NOT ready THEN
  PERFORM 1 FROM public.billing_underlays WHERE id=u.id FOR UPDATE;
  IF prior.underlay_id IS NOT NULL THEN RAISE EXCEPTION 'billing_source_finalized_underlay_requires_correction' USING ERRCODE='55000'; END IF;
  RETURN gridex_billing_source.gridex_store_billing_underlay_before_source_v2(p_company_id,p_underlay,p_items,p_actor_user_id);
 END IF;
 IF jsonb_array_length(p_items)=0 OR (SELECT count(DISTINCT value->>'source_normalized_metering_value_id') FROM jsonb_array_elements(p_items))<>jsonb_array_length(p_items) THEN RAISE EXCEPTION 'billing_underlay_unique_sources_required'; END IF;
 PERFORM gridex_billing_source.lock_values_v1(p_company_id,ARRAY(SELECT (value->>'source_normalized_metering_value_id')::uuid FROM jsonb_array_elements(p_items)),(p_underlay->>'supply_period_id')::uuid);
 SELECT * INTO sp FROM public.customer_supply_periods WHERE id=(p_underlay->>'supply_period_id')::uuid AND company_id=p_company_id FOR SHARE;
 SELECT * INTO ct FROM public.customer_contracts WHERE id=(p_underlay->>'contract_id')::uuid AND company_id=p_company_id FOR SHARE;
 SELECT * INTO price FROM public.contract_price_snapshots WHERE id=(p_underlay->>'contract_price_snapshot_id')::uuid AND company_id=p_company_id FOR SHARE;
 SELECT * INTO pv FROM public.price_plan_versions WHERE id=price.price_plan_version_id AND company_id=p_company_id FOR SHARE;
 IF sp.id IS NULL OR ct.id IS NULL OR price.id IS NULL OR pv.id IS NULL OR pv.locked_at IS NULL OR NOT coalesce(pv.content_sha256 ~ '^[a-f0-9]{64}$',false) OR NOT coalesce(pv.status IN ('active','approved','published'),false)
  OR sp.contract_id IS DISTINCT FROM ct.id OR sp.customer_id IS DISTINCT FROM ct.customer_id OR sp.metering_point_id IS DISTINCT FROM ct.metering_point_id
  OR NOT coalesce(sp.status IN ('active','confirmed_by_grid_owner','ending','ended'),false)
   OR (sp.status IN ('ending','ended') AND coalesce(sp.actual_end_date,sp.end_date) IS NULL)
   -- H3: a contract ended by exactly this period's end still carries the period up to that end.
   -- H3b (20261023200000): that end is a Z05 supply end ('supply_end') or a manual move-out on that date ('move_out').
   OR NOT coalesce(ct.status IN ('signed','active') OR gridex_received_sources.manual_received_source_basis_v1(p_company_id,sp.id,start_at,end_at) IS NOT NULL OR (ct.status='terminated' AND ct.termination_reason IN ('supply_end','move_out','grid_contract_ended','customer_termination') AND sp.end_date IS NOT NULL AND ct.ended_at IS NOT NULL
    AND ((ct.ended_at AT TIME ZONE 'UTC')::date>=sp.end_date OR (ct.ended_at AT TIME ZONE 'Europe/Stockholm')::date>=sp.end_date)),false) OR price.contract_id IS DISTINCT FROM ct.id
  OR sp.customer_id::text IS DISTINCT FROM p_underlay->>'customer_id' OR sp.metering_point_id::text IS DISTINCT FROM p_underlay->>'metering_point_id'
  OR price.id::text IS DISTINCT FROM p_underlay->>'pricing_snapshot_id' OR price.price_plan_version_id::text IS DISTINCT FROM p_underlay->>'price_plan_version_id'
  OR price.snapshot_json IS DISTINCT FROM p_underlay->'pricing_snapshot' OR price.valid_from IS NULL OR (price.valid_from::timestamp AT TIME ZONE 'Europe/Stockholm')>start_at
  OR (price.valid_to IS NOT NULL AND (CASE WHEN sp.market_start_at IS NOT NULL OR sp.market_end_at IS NOT NULL
     -- F108: on an Ediel-qualified supply the price's last day also covers the end of its Ediel month.
     THEN GREATEST((price.valid_to+1)::timestamp AT TIME ZONE 'Europe/Stockholm',(price.valid_to+1)::timestamp AT TIME ZONE 'Etc/GMT-1')
     ELSE (price.valid_to+1)::timestamp AT TIME ZONE 'Europe/Stockholm' END)<end_at)
  OR sp.start_date IS NULL OR (sp.start_date::timestamp AT TIME ZONE 'Europe/Stockholm')>start_at OR (sp.end_date IS NOT NULL AND ((sp.end_date+1)::timestamp AT TIME ZONE 'Europe/Stockholm')<end_at)
  OR nullif(coalesce(to_jsonb(ct)->>'starts_at',to_jsonb(ct)->>'start_date'),'') IS NULL
  OR (left(coalesce(to_jsonb(ct)->>'starts_at',to_jsonb(ct)->>'start_date'),10)::date::timestamp AT TIME ZONE 'Europe/Stockholm')>start_at
  OR (nullif(coalesce(to_jsonb(ct)->>'ends_at',to_jsonb(ct)->>'end_date'),'') IS NOT NULL AND (CASE WHEN sp.market_start_at IS NOT NULL OR sp.market_end_at IS NOT NULL
     -- F108: on an Ediel-qualified supply the contract's last day also covers the end of its Ediel month.
     THEN GREATEST((left(coalesce(to_jsonb(ct)->>'ends_at',to_jsonb(ct)->>'end_date'),10)::date+1)::timestamp AT TIME ZONE 'Europe/Stockholm',(left(coalesce(to_jsonb(ct)->>'ends_at',to_jsonb(ct)->>'end_date'),10)::date+1)::timestamp AT TIME ZONE 'Etc/GMT-1')
     ELSE (left(coalesce(to_jsonb(ct)->>'ends_at',to_jsonb(ct)->>'end_date'),10)::date+1)::timestamp AT TIME ZONE 'Europe/Stockholm' END)<end_at)
 THEN RAISE EXCEPTION 'billing_underlay_supply_contract_price_basis_required' USING ERRCODE='23514'; END IF;
 legal_basis:=gridex_received_sources.billing_supply_basis_v1(p_company_id,sp.id,start_at,end_at);
 IF legal_basis IS NULL OR legal_basis->'qualified' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'billing_underlay_qualified_supply_source_required' USING ERRCODE='23514'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_items) ORDER BY value->>'source_normalized_metering_value_id' LOOP
  SELECT * INTO n FROM public.normalized_metering_values WHERE company_id=p_company_id AND id=(item->>'source_normalized_metering_value_id')::uuid FOR SHARE;
  basis:=gridex_billing_source.basis_v1(p_company_id,n.id);
  IF basis->'qualified' IS DISTINCT FROM 'true'::jsonb OR basis->'quality' IS DISTINCT FROM 'null'::jsonb OR basis->'qualityEstablished' IS DISTINCT FROM 'true'::jsonb
   OR n.billing_gate_status IS DISTINCT FROM 'eligible' OR n.billing_status IS DISTINCT FROM 'billable' OR n.supply_period_id IS DISTINCT FROM sp.id
   OR n.customer_id IS DISTINCT FROM sp.customer_id OR n.metering_point_id IS DISTINCT FROM sp.metering_point_id OR n.period_start<start_at OR n.period_end>end_at
   OR (item->>'quantity_kwh')::numeric IS DISTINCT FROM abs(n.quantity_kwh) OR (item->>'quantity')::numeric IS DISTINCT FROM abs(n.quantity_kwh)
   OR item->>'unit' IS DISTINCT FROM 'kWh' OR item->>'product_code' IS DISTINCT FROM basis->>'productCode' OR item->>'register_code' IS DISTINCT FROM basis->>'registerCode'
   OR p_underlay->>'energy_direction' IS DISTINCT FROM (CASE WHEN n.direction='production' THEN 'production' WHEN n.quantity_kwh<0 THEN 'consumption_correction' ELSE 'consumption' END)
   OR (item->>'period_start')::timestamptz IS DISTINCT FROM n.period_start OR (item->>'period_end')::timestamptz IS DISTINCT FROM n.period_end
  THEN RAISE EXCEPTION 'billing_underlay_qualified_source_mismatch' USING ERRCODE='23514'; END IF;
  total:=total+abs(n.quantity_kwh);rows_basis:=rows_basis||jsonb_build_array(basis||jsonb_build_object('revisionNumber',n.revision_number,'supplyPeriodId',sp.id));
 END LOOP;
 IF total IS DISTINCT FROM (p_underlay->>'total_kwh')::numeric THEN RAISE EXCEPTION 'billing_underlay_exact_total_mismatch'; END IF;
 source_basis:=jsonb_build_object('values',rows_basis,'supply',legal_basis,'contractId',ct.id,'contractStatus',ct.status,'price',to_jsonb(price),'priceVersionHash',pv.content_sha256,'energyDirection',p_underlay->>'energy_direction','start',start_at,'end',end_at);
 basis_hash:=encode(digest(convert_to(source_basis::text,'UTF8'),'sha256'),'hex');
 PERFORM 1 FROM public.billing_underlays WHERE id=u.id FOR UPDATE;
 IF prior.underlay_id IS NOT NULL THEN
  IF prior.source_basis_hash IS DISTINCT FROM basis_hash OR prior.exact_total_kwh IS DISTINCT FROM total THEN RAISE EXCEPTION 'billing_source_finalized_underlay_requires_correction' USING ERRCODE='55000'; END IF;
  RETURN prior.underlay_id;
 END IF;
 stored_id:=gridex_billing_source.gridex_store_billing_underlay_before_source_v2(p_company_id,p_underlay,p_items,p_actor_user_id);
 INSERT INTO gridex_billing_source.underlay_bindings(underlay_id,company_id,source_basis,source_basis_hash,exact_total_kwh,actor_user_id) VALUES(stored_id,p_company_id,source_basis,basis_hash,total,p_actor_user_id);
 RETURN stored_id;
END $body$);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'manual_received_consumer_metadata_changed';END IF;
END$patch$;
DO $patch$ DECLARE f record;BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='public.gridex_read_billing_underlay_source_basis_v1(uuid,uuid[])'::regprocedure;
 IF encode(sha256(convert_to(f.prosrc,'UTF8')),'hex') IS DISTINCT FROM '496d105d3460b02556c830318043efd3cb8939b97475690729b325b50787cbb7' THEN RAISE EXCEPTION 'manual_received_consumer_exact_predecessor_required:public.gridex_read_billing_underlay_source_basis_v1(uuid,uuid[])';END IF;
 EXECUTE replace(f.definition,f.prosrc,$body$
DECLARE result jsonb:='[]';u public.billing_underlays%rowtype;b gridex_billing_source.underlay_bindings%rowtype;qualified boolean;manual_end jsonb;
BEGIN
 IF coalesce(current_setting('role',true),'')<>'service_role' AND current_user<>'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 IF p_company_id IS NULL OR p_underlay_ids IS NULL OR cardinality(p_underlay_ids)>1000 OR array_position(p_underlay_ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'billing_underlay_read_scope_required'; END IF;
 FOR u IN SELECT * FROM public.billing_underlays WHERE company_id=p_company_id AND id=ANY(p_underlay_ids) ORDER BY id LOOP
  SELECT * INTO b FROM gridex_billing_source.underlay_bindings WHERE underlay_id=u.id AND company_id=p_company_id;
  qualified:=true;
  BEGIN PERFORM gridex_billing_source.require_underlay_v1(p_company_id,u.id);
  EXCEPTION WHEN check_violation THEN qualified:=false; END;
  manual_end:=CASE WHEN qualified THEN gridex_received_sources.manual_received_billing_authority_v1(p_company_id,u.supply_period_id,(b.source_basis->>'start')::timestamptz,(b.source_basis->>'end')::timestamptz) END;
  result:=result||jsonb_build_array(jsonb_build_object('id',u.id,'qualified',qualified,'manualReceivedEndReceiptQualified',manual_end IS NOT NULL,'manualReceivedEndAuthorities',CASE WHEN manual_end IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(manual_end) END,'totalKwh',gridex_utilts_binding.canonical_decimal_v2(u.total_kwh::text),'sourceBasisHash',b.source_basis_hash,'correctionRequired',EXISTS(SELECT FROM gridex_billing_source.correction_journal j WHERE j.underlay_id=u.id)));
 END LOOP;
 RETURN result;
END $body$);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'manual_received_consumer_metadata_changed';END IF;
END$patch$;
DO $view$ DECLARE view_oid oid;before jsonb;BEGIN
 view_oid:='public.billing_export_readiness_v'::regclass;
 IF pg_get_viewdef(view_oid) IS DISTINCT FROM $old$ WITH facts AS (
         SELECT b.company_id,
            b.id AS billing_underlay_id,
            b.contract_id,
            b.energy_direction,
            b.settlement_type,
            b.readiness_status AS underlay_readiness_status,
            b.status AS underlay_status,
            COALESCE(b.contract_price_snapshot_id, b.pricing_snapshot_id) AS contract_price_snapshot_id,
            COALESCE(NULLIF((b.pricing_snapshot ->> 'interval_resolution'::text), ''::text), NULLIF((b.pricing_snapshot #>> '{pricing,interval_resolution}'::text[]), ''::text), 'monthly'::text) AS interval_resolution,
            c.id AS exact_contract_id,
            s.id AS exact_snapshot_id,
            pr.id AS pricing_run_id,
            pr.status AS pricing_run_status,
            ( SELECT count(*) AS count
                   FROM billing_underlay_items bi
                  WHERE ((bi.company_id = b.company_id) AND (bi.billing_underlay_id = b.id))) AS underlay_item_count,
            ( SELECT count(*) AS count
                   FROM pricing_interval_evidence pie
                  WHERE ((pie.company_id = b.company_id) AND (pie.pricing_run_id = pr.id))) AS interval_evidence_count,
            (EXISTS ( SELECT 1
                   FROM pricing_preview_lines ppl
                  WHERE ((ppl.company_id = b.company_id) AND (ppl.pricing_run_id = pr.id) AND (ppl.line_type = 'production_compensation_credit'::text) AND (ppl.amount_ex_vat < (0)::numeric)))) AS has_production_credit_line,
            (EXISTS ( SELECT 1
                   FROM pricing_preview_lines ppl
                  WHERE ((ppl.company_id = b.company_id) AND (ppl.pricing_run_id = pr.id) AND (ppl.amount_ex_vat < (0)::numeric)))) AS has_negative_credit_line
           FROM (((billing_underlays b
             LEFT JOIN customer_contracts c ON (((c.id = b.contract_id) AND (c.company_id = b.company_id) AND ((c.status = ANY (ARRAY['signed'::text, 'active'::text])) OR (EXISTS ( SELECT 1
                   FROM ((customer_supply_periods sp
                     JOIN customer_contracts ct ON (((ct.id = c.id) AND (ct.company_id = b.company_id))))
                     JOIN pricing_runs n ON (((n.company_id = b.company_id) AND (n.billing_underlay_id = b.id) AND (n.status = 'locked'::text))))
                  WHERE ((sp.id = b.supply_period_id) AND (sp.company_id = b.company_id) AND (sp.contract_id = ct.id) AND (sp.customer_id = b.customer_id) AND (sp.metering_point_id = b.metering_point_id) AND (ct.customer_id = b.customer_id) AND (ct.metering_point_id = b.metering_point_id) AND (NOT ((NOT COALESCE((sp.status = ANY (ARRAY['active'::text, 'confirmed_by_grid_owner'::text, 'ending'::text, 'ended'::text])), false)) OR ((sp.status = ANY (ARRAY['ending'::text, 'ended'::text])) AND (COALESCE(sp.actual_end_date, sp.end_date) IS NULL)) OR (NOT COALESCE(((ct.status = ANY (ARRAY['signed'::text, 'active'::text])) OR ((ct.status = 'terminated'::text) AND (ct.termination_reason = ANY (ARRAY['supply_end'::text, 'move_out'::text, 'grid_contract_ended'::text, 'customer_termination'::text])) AND (sp.end_date IS NOT NULL) AND (ct.ended_at IS NOT NULL) AND ((((ct.ended_at AT TIME ZONE 'UTC'::text))::date >= sp.end_date) OR (((ct.ended_at AT TIME ZONE 'Europe/Stockholm'::text))::date >= sp.end_date)))), false)))) AND (NOT ((sp.start_date IS NULL) OR (((sp.start_date)::timestamp without time zone AT TIME ZONE 'Europe/Stockholm'::text) > n.billing_period_start))) AND (NOT ((COALESCE(sp.actual_end_date, sp.end_date) IS NOT NULL) AND (
                        CASE
                            WHEN ((sp.market_end_at IS NOT NULL) AND (sp.market_end_at <= (((COALESCE(sp.actual_end_date, sp.end_date))::timestamp without time zone AT TIME ZONE 'Europe/Stockholm'::text) + '01:00:00'::interval))) THEN sp.market_end_at
                            ELSE (((COALESCE(sp.actual_end_date, sp.end_date) + 1))::timestamp without time zone AT TIME ZONE 'Europe/Stockholm'::text)
                        END < n.billing_period_end))))))))))
             LEFT JOIN contract_price_snapshots s ON (((s.id = COALESCE(b.contract_price_snapshot_id, b.pricing_snapshot_id)) AND (s.company_id = b.company_id) AND (s.contract_id = b.contract_id))))
             LEFT JOIN LATERAL ( SELECT p.id,
                    p.status
                   FROM pricing_runs p
                  WHERE ((p.company_id = b.company_id) AND (p.billing_underlay_id = b.id) AND (p.status = 'locked'::text))
                  ORDER BY p.locked_at DESC NULLS LAST, p.created_at DESC
                 LIMIT 1) pr ON (true))
        ), evaluated AS (
         SELECT f.company_id,
            f.billing_underlay_id,
            f.contract_id,
            f.energy_direction,
            f.settlement_type,
            f.underlay_readiness_status,
            f.underlay_status,
            f.contract_price_snapshot_id,
            f.interval_resolution,
            f.exact_contract_id,
            f.exact_snapshot_id,
            f.pricing_run_id,
            f.pricing_run_status,
            f.underlay_item_count,
            f.interval_evidence_count,
            f.has_production_credit_line,
            f.has_negative_credit_line,
            array_remove(ARRAY[
                CASE
                    WHEN (f.underlay_readiness_status <> 'ready'::text) THEN 'underlay_not_ready'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN (f.exact_contract_id IS NULL) THEN 'exact_signed_contract_missing'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN (f.exact_snapshot_id IS NULL) THEN 'exact_contract_price_snapshot_missing'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN ((f.pricing_run_id IS NULL) OR (f.pricing_run_status <> 'locked'::text)) THEN 'locked_pricing_run_missing'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN ((f.energy_direction = 'production'::text) AND (f.settlement_type <> ALL (ARRAY['credit_invoice'::text, 'self_billing'::text]))) THEN 'production_settlement_type_invalid'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN ((f.energy_direction = 'production'::text) AND (NOT f.has_production_credit_line)) THEN 'production_credit_line_missing'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN ((f.energy_direction = 'consumption_correction'::text) AND (f.settlement_type <> 'credit_invoice'::text)) THEN 'consumption_correction_settlement_invalid'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN ((f.energy_direction = 'consumption_correction'::text) AND (NOT f.has_negative_credit_line)) THEN 'consumption_correction_credit_line_missing'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN ((f.energy_direction = 'consumption'::text) AND (f.interval_resolution = ANY (ARRAY['hourly'::text, 'quarterly'::text, 'quarter_hour'::text])) AND (f.interval_evidence_count <> f.underlay_item_count)) THEN 'interval_evidence_incomplete'::text
                    ELSE NULL::text
                END], NULL::text) AS blockers_array
           FROM facts f
        )
 SELECT company_id,
    billing_underlay_id,
    contract_id,
    contract_price_snapshot_id,
    pricing_run_id,
    energy_direction,
    settlement_type,
    interval_resolution,
    underlay_item_count,
    interval_evidence_count,
        CASE
            WHEN (cardinality(blockers_array) = 0) THEN 'ready'::text
            ELSE 'blocked'::text
        END AS status,
    (cardinality(blockers_array) = 0) AS is_exportable,
    to_jsonb(blockers_array) AS blockers
   FROM evaluated;$old$ THEN RAISE EXCEPTION 'manual_received_export_exact_predecessor_required';END IF;
 SELECT jsonb_build_object('owner',relowner,'acl',relacl,'options',reloptions) INTO before FROM pg_class WHERE pg_class.oid=view_oid;
 EXECUTE 'CREATE OR REPLACE VIEW public.billing_export_readiness_v WITH (security_invoker=true) AS '||$new$ WITH facts AS (
         SELECT b.company_id,
            b.id AS billing_underlay_id,
            b.contract_id,
            b.energy_direction,
            b.settlement_type,
            b.readiness_status AS underlay_readiness_status,
            b.status AS underlay_status,
            COALESCE(b.contract_price_snapshot_id, b.pricing_snapshot_id) AS contract_price_snapshot_id,
            COALESCE(NULLIF((b.pricing_snapshot ->> 'interval_resolution'::text), ''::text), NULLIF((b.pricing_snapshot #>> '{pricing,interval_resolution}'::text[]), ''::text), 'monthly'::text) AS interval_resolution,
            c.id AS exact_contract_id,
            s.id AS exact_snapshot_id,
            pr.id AS pricing_run_id,
            pr.status AS pricing_run_status,
            ( SELECT count(*) AS count
                   FROM billing_underlay_items bi
                  WHERE ((bi.company_id = b.company_id) AND (bi.billing_underlay_id = b.id))) AS underlay_item_count,
            ( SELECT count(*) AS count
                   FROM pricing_interval_evidence pie
                  WHERE ((pie.company_id = b.company_id) AND (pie.pricing_run_id = pr.id))) AS interval_evidence_count,
            (EXISTS ( SELECT 1
                   FROM pricing_preview_lines ppl
                  WHERE ((ppl.company_id = b.company_id) AND (ppl.pricing_run_id = pr.id) AND (ppl.line_type = 'production_compensation_credit'::text) AND (ppl.amount_ex_vat < (0)::numeric)))) AS has_production_credit_line,
            (EXISTS ( SELECT 1
                   FROM pricing_preview_lines ppl
                  WHERE ((ppl.company_id = b.company_id) AND (ppl.pricing_run_id = pr.id) AND (ppl.amount_ex_vat < (0)::numeric)))) AS has_negative_credit_line
           FROM (((billing_underlays b
             LEFT JOIN customer_contracts c ON (((c.id = b.contract_id) AND (c.company_id = b.company_id) AND ((c.status = ANY (ARRAY['signed'::text, 'active'::text])) OR (EXISTS ( SELECT 1
                   FROM ((customer_supply_periods sp
                     JOIN customer_contracts ct ON (((ct.id = c.id) AND (ct.company_id = b.company_id))))
                     JOIN pricing_runs n ON (((n.company_id = b.company_id) AND (n.billing_underlay_id = b.id) AND (n.status = 'locked'::text))))
                  WHERE ((sp.id = b.supply_period_id) AND (sp.company_id = b.company_id) AND (sp.contract_id = ct.id) AND (sp.customer_id = b.customer_id) AND (sp.metering_point_id = b.metering_point_id) AND (ct.customer_id = b.customer_id) AND (ct.metering_point_id = b.metering_point_id) AND (NOT ((NOT COALESCE((sp.status = ANY (ARRAY['active'::text, 'confirmed_by_grid_owner'::text, 'ending'::text, 'ended'::text])), false)) OR ((sp.status = ANY (ARRAY['ending'::text, 'ended'::text])) AND (COALESCE(sp.actual_end_date, sp.end_date) IS NULL)) OR (NOT COALESCE(((ct.status = ANY (ARRAY['signed'::text, 'active'::text])) OR (CASE WHEN current_setting('role',true)='service_role' OR session_user='service_role' THEN COALESCE((public.gridex_read_billing_underlay_source_basis_v1(b.company_id,ARRAY[b.id])#>>'{0,manualReceivedEndReceiptQualified}')::boolean,false) ELSE false END) OR ((ct.status = 'terminated'::text) AND (ct.termination_reason = ANY (ARRAY['supply_end'::text, 'move_out'::text, 'grid_contract_ended'::text, 'customer_termination'::text])) AND (sp.end_date IS NOT NULL) AND (ct.ended_at IS NOT NULL) AND ((((ct.ended_at AT TIME ZONE 'UTC'::text))::date >= sp.end_date) OR (((ct.ended_at AT TIME ZONE 'Europe/Stockholm'::text))::date >= sp.end_date)))), false)))) AND (NOT ((sp.start_date IS NULL) OR (((sp.start_date)::timestamp without time zone AT TIME ZONE 'Europe/Stockholm'::text) > n.billing_period_start))) AND (NOT ((COALESCE(sp.actual_end_date, sp.end_date) IS NOT NULL) AND (
                        CASE
                            WHEN ((sp.market_end_at IS NOT NULL) AND (sp.market_end_at <= (((COALESCE(sp.actual_end_date, sp.end_date))::timestamp without time zone AT TIME ZONE 'Europe/Stockholm'::text) + '01:00:00'::interval))) THEN sp.market_end_at
                            ELSE (((COALESCE(sp.actual_end_date, sp.end_date) + 1))::timestamp without time zone AT TIME ZONE 'Europe/Stockholm'::text)
                        END < n.billing_period_end))))))))))
             LEFT JOIN contract_price_snapshots s ON (((s.id = COALESCE(b.contract_price_snapshot_id, b.pricing_snapshot_id)) AND (s.company_id = b.company_id) AND (s.contract_id = b.contract_id))))
             LEFT JOIN LATERAL ( SELECT p.id,
                    p.status
                   FROM pricing_runs p
                  WHERE ((p.company_id = b.company_id) AND (p.billing_underlay_id = b.id) AND (p.status = 'locked'::text))
                  ORDER BY p.locked_at DESC NULLS LAST, p.created_at DESC
                 LIMIT 1) pr ON (true))
        ), evaluated AS (
         SELECT f.company_id,
            f.billing_underlay_id,
            f.contract_id,
            f.energy_direction,
            f.settlement_type,
            f.underlay_readiness_status,
            f.underlay_status,
            f.contract_price_snapshot_id,
            f.interval_resolution,
            f.exact_contract_id,
            f.exact_snapshot_id,
            f.pricing_run_id,
            f.pricing_run_status,
            f.underlay_item_count,
            f.interval_evidence_count,
            f.has_production_credit_line,
            f.has_negative_credit_line,
            array_remove(ARRAY[
                CASE
                    WHEN (f.underlay_readiness_status <> 'ready'::text) THEN 'underlay_not_ready'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN (f.exact_contract_id IS NULL) THEN 'exact_signed_contract_missing'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN (f.exact_snapshot_id IS NULL) THEN 'exact_contract_price_snapshot_missing'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN ((f.pricing_run_id IS NULL) OR (f.pricing_run_status <> 'locked'::text)) THEN 'locked_pricing_run_missing'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN ((f.energy_direction = 'production'::text) AND (f.settlement_type <> ALL (ARRAY['credit_invoice'::text, 'self_billing'::text]))) THEN 'production_settlement_type_invalid'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN ((f.energy_direction = 'production'::text) AND (NOT f.has_production_credit_line)) THEN 'production_credit_line_missing'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN ((f.energy_direction = 'consumption_correction'::text) AND (f.settlement_type <> 'credit_invoice'::text)) THEN 'consumption_correction_settlement_invalid'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN ((f.energy_direction = 'consumption_correction'::text) AND (NOT f.has_negative_credit_line)) THEN 'consumption_correction_credit_line_missing'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN ((f.energy_direction = 'consumption'::text) AND (f.interval_resolution = ANY (ARRAY['hourly'::text, 'quarterly'::text, 'quarter_hour'::text])) AND (f.interval_evidence_count <> f.underlay_item_count)) THEN 'interval_evidence_incomplete'::text
                    ELSE NULL::text
                END], NULL::text) AS blockers_array
           FROM facts f
        )
 SELECT company_id,
    billing_underlay_id,
    contract_id,
    contract_price_snapshot_id,
    pricing_run_id,
    energy_direction,
    settlement_type,
    interval_resolution,
    underlay_item_count,
    interval_evidence_count,
        CASE
            WHEN (cardinality(blockers_array) = 0) THEN 'ready'::text
            ELSE 'blocked'::text
        END AS status,
    (cardinality(blockers_array) = 0) AS is_exportable,
    to_jsonb(blockers_array) AS blockers
   FROM evaluated;$new$;
 IF (SELECT jsonb_build_object('owner',relowner,'acl',relacl,'options',reloptions) FROM pg_class WHERE pg_class.oid=view_oid) IS DISTINCT FROM before THEN RAISE EXCEPTION 'manual_received_export_metadata_changed';END IF;
END$view$;
COMMIT;
