-- Price only the delivered portion of a previously qualified normal supplier switch.
-- Release source: authenticated canonical capture 45327096087.
CREATE FUNCTION gridex_billing_source.ordinary_ended_supply_v1(
  period public.customer_supply_periods, contract public.customer_contracts, start_at timestamptz, end_at timestamptz
) RETURNS boolean
LANGUAGE sql STABLE SET search_path TO pg_catalog
AS $body$
  SELECT coalesce(
    period.status='ended' AND contract.status='terminated' AND contract.termination_reason='supply_end'
    AND period.company_id=contract.company_id AND period.contract_id=contract.id
    AND period.customer_id=contract.customer_id AND period.metering_point_id=contract.metering_point_id
    AND isfinite(period.market_start_at) AND period.market_start_at<=start_at AND start_at<end_at
    AND isfinite(period.market_end_at) AND end_at<=period.market_end_at AND period.market_end_at<=statement_timestamp()
    AND EXISTS (
      SELECT FROM gridex_received_sources.normal_switch_confirmations confirmation
      JOIN gridex_received_sources.normal_supply_activations activation
        ON activation.period_id=confirmation.period_id AND activation.company_id=confirmation.company_id
        AND activation.source_message_id=confirmation.source_message_id
      JOIN public.ediel_messages initial
        ON initial.id=period.source_message_id AND initial.company_id=period.company_id
        AND initial.direction='inbound' AND initial.message_family='PRODAT' AND initial.message_code='Z04'
      JOIN public.ediel_messages closing
        ON closing.id=period.source_end_message_id AND closing.company_id=period.company_id
        AND closing.environment=initial.environment
        AND closing.direction='inbound' AND closing.message_family='PRODAT' AND closing.message_code='Z05'
      JOIN gridex_received_sources.supply_source_transitions terminal
        ON terminal.source_message_id=closing.id AND terminal.company_id=closing.company_id AND terminal.source_code='Z05'
      WHERE confirmation.period_id=period.id AND confirmation.company_id=period.company_id
        AND confirmation.contract_id=contract.id AND confirmation.source_message_id=period.source_message_id
        AND confirmation.protected_contract_hash=gridex_received_sources.production_contract_hash_v1(contract)
        AND initial.immutable_payload_hash=encode(sha256(convert_to(initial.raw_payload,'UTF8')),'hex')
        AND terminal.payload_hash=closing.immutable_payload_hash
        AND terminal.payload_hash=encode(sha256(convert_to(closing.raw_payload,'UTF8')),'hex')
        AND NOT EXISTS (
          SELECT FROM (VALUES (initial.id,initial.immutable_payload_hash),(closing.id,closing.immutable_payload_hash)) source(id,hash)
          WHERE NOT EXISTS (
            SELECT FROM gridex_received_sources.validation_assessments assessment
            WHERE assessment.source_message_id=source.id AND assessment.source_payload_hash=source.hash
              AND assessment.company_id=period.company_id AND assessment.environment=initial.environment
              AND assessment.facts_text::jsonb->>'syntaxDecision'='accepted'
              AND assessment.facts_text::jsonb->>'applicationDecision'='accepted'
              AND assessment.facts_text::jsonb->>'functionalDecision'='accepted'
              AND NOT EXISTS (
                SELECT FROM gridex_received_sources.validation_assessments newer
                WHERE newer.previous_assessment_id=assessment.id
              )
          )
        )
        AND jsonb_array_length(terminal.source_objects)=1 AND terminal.source_objects#>>'{0,reason}'='Z22'
        AND EXISTS (
          SELECT FROM jsonb_array_elements(terminal.resulting_states) state
          WHERE state->>'id'=period.id::text AND state->>'market_state_version'=period.market_state_version::text
            AND state->>'source_end_message_id'=closing.id::text
            AND (state->>'market_end_at')::timestamptz=period.market_end_at
        )
    ),false)
$body$;

CREATE FUNCTION gridex_billing_source.ordinary_ended_pricing_v1(underlay public.billing_underlays)
RETURNS boolean
LANGUAGE sql STABLE SET search_path TO pg_catalog
AS $body$
  SELECT EXISTS (
    SELECT FROM gridex_billing_source.underlay_bindings binding
    JOIN public.customer_supply_periods period ON period.company_id=underlay.company_id AND period.id=underlay.supply_period_id
    JOIN public.customer_contracts contract ON contract.company_id=underlay.company_id AND contract.id=underlay.contract_id
    JOIN public.contract_price_snapshots price
      ON price.company_id=underlay.company_id AND price.id=underlay.contract_price_snapshot_id AND price.contract_id=contract.id
    JOIN public.price_plan_versions version ON version.company_id=underlay.company_id AND version.id=price.price_plan_version_id
    WHERE binding.company_id=underlay.company_id AND binding.underlay_id=underlay.id
      AND underlay.energy_direction='consumption' AND binding.source_basis->>'energyDirection'='consumption'
      AND NOT EXISTS (
        SELECT FROM gridex_ediel_retention.finance_tombstones removed
        WHERE removed.company_id=underlay.company_id AND (
          (removed.retention_class IN ('billing_underlay_source_body','billing_underlay_payload_body') AND removed.target_id=underlay.id::text)
          OR (removed.retention_class='settlement_calculation_body' AND removed.target_id=underlay.portfolio_monthly_settlement_id::text)
        )
      )
      AND NOT EXISTS (
        SELECT FROM gridex_ediel_retention.blob_tombstones removed
        WHERE removed.company_id=underlay.company_id AND removed.message_id IN (period.source_message_id,period.source_end_message_id)
      )
      AND underlay.customer_id=period.customer_id AND underlay.metering_point_id=period.metering_point_id
      AND (underlay.customer_contract_id IS NULL OR underlay.customer_contract_id=contract.id)
      AND binding.exact_total_kwh=underlay.total_kwh
      AND binding.source_basis_hash=encode(sha256(convert_to(binding.source_basis::text,'UTF8')),'hex')
      AND binding.source_basis->>'contractId'=contract.id::text AND binding.source_basis->>'contractStatus'='terminated'
      AND binding.source_basis#>>'{supply,qualified}'='true' AND binding.source_basis#>>'{supply,activated}'='true'
      AND binding.source_basis#>>'{supply,initialSourceMessageId}'=period.source_message_id::text
      AND binding.source_basis#>>'{supply,currentSourceMessageId}'=period.source_end_message_id::text
      AND binding.source_basis#>>'{supply,marketStateVersion}'=period.market_state_version::text
      AND binding.source_basis#>>'{price,id}'=price.id::text
      AND version.id=underlay.price_plan_version_id AND version.locked_at IS NOT NULL
      AND version.status IN ('active','approved','published') AND version.content_sha256=binding.source_basis->>'priceVersionHash'
      AND binding.source_basis#>'{price,snapshot_json}'=price.snapshot_json
      AND underlay.pricing_snapshot_id=price.id AND underlay.pricing_snapshot=price.snapshot_json
      AND (binding.source_basis->>'start')::timestamptz=(underlay.payload->>'billing_period_start_instant')::timestamptz
      AND (binding.source_basis->>'end')::timestamptz=(underlay.payload->>'billing_period_end_instant')::timestamptz
      AND gridex_billing_source.ordinary_ended_supply_v1(
        period,contract,(binding.source_basis->>'start')::timestamptz,(binding.source_basis->>'end')::timestamptz
      )
      AND NOT EXISTS (SELECT FROM gridex_billing_source.correction_journal correction WHERE correction.underlay_id=underlay.id)
  )
$body$;

REVOKE ALL ON FUNCTION gridex_billing_source.ordinary_ended_supply_v1(
  public.customer_supply_periods,public.customer_contracts,timestamptz,timestamptz
), gridex_billing_source.ordinary_ended_pricing_v1(public.billing_underlays)
FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_billing_source.frozen_ordinary_invoice_source_v1(basis jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO pg_catalog
AS $body$
  SELECT coalesce(basis->>'contractStatus'='terminated' OR (
    basis#>>'{supply,switchId}' IS NOT NULL
    AND basis#>>'{supply,originalMessageId}' IS NOT NULL
    AND basis#>>'{supply,activated}'='true'
  ),false)
$body$;
REVOKE ALL ON FUNCTION gridex_billing_source.frozen_ordinary_invoice_source_v1(jsonb)
FROM PUBLIC,anon,authenticated,service_role;

-- Discover the frozen readings before any price advisory or financial row lock.
-- The same source owner orders message, measured value, and period row locks.
CREATE FUNCTION gridex_billing_source.lock_ordinary_invoice_pricing_source_v1(p_company uuid,p_underlay uuid,p_first_output boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql SET search_path TO pg_catalog
AS $body$
DECLARE
  underlay public.billing_underlays%rowtype;
  binding gridex_billing_source.underlay_bindings%rowtype;
  sources uuid[];
BEGIN
  SELECT * INTO binding FROM gridex_billing_source.underlay_bindings
  WHERE company_id=p_company AND underlay_id=p_underlay
    AND (source_basis->>'contractStatus'='terminated'
      OR p_first_output AND gridex_billing_source.frozen_ordinary_invoice_source_v1(source_basis));
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO STRICT underlay FROM public.billing_underlays WHERE company_id=p_company AND id=p_underlay;
  SELECT array_agg((entry->>'normalizedValueId')::uuid ORDER BY entry->>'normalizedValueId') INTO sources
  FROM jsonb_array_elements(binding.source_basis->'values') entry;
  IF coalesce(cardinality(sources),0)=0 THEN
    RAISE EXCEPTION 'ended_supply_pricing_sources_required' USING ERRCODE='23514';
  END IF;
  PERFORM gridex_bilateral_prodat.lock_supply_v1();
  PERFORM gridex_regulated_supply.lock_graph_v1();
  PERFORM gridex_billing_source.lock_values_v1(p_company,sources,underlay.supply_period_id);
  PERFORM gridex_billing_source.require_underlay_v1(p_company,p_underlay);
  PERFORM FROM public.contract_price_snapshots price
    JOIN public.price_plan_versions version ON version.id=price.price_plan_version_id AND version.company_id=p_company
    WHERE price.id=underlay.contract_price_snapshot_id AND price.company_id=p_company FOR SHARE OF price,version;
  SELECT * INTO STRICT underlay FROM public.billing_underlays WHERE company_id=p_company AND id=p_underlay;
  IF (binding.source_basis->>'contractStatus'='terminated' AND NOT gridex_billing_source.ordinary_ended_pricing_v1(underlay))
     OR NOT EXISTS (
    SELECT FROM gridex_billing_source.underlay_bindings current_binding
    WHERE current_binding.company_id=p_company AND current_binding.underlay_id=p_underlay
      AND current_binding.source_basis_hash=binding.source_basis_hash
  ) THEN
    RAISE EXCEPTION 'ended_supply_pricing_basis_changed' USING ERRCODE='23514';
  END IF;
  RETURN binding.source_basis_hash;
END
$body$;
REVOKE ALL ON FUNCTION gridex_billing_source.lock_ordinary_invoice_pricing_source_v1(uuid,uuid,boolean)
FROM PUBLIC,anon,authenticated,service_role;

-- Batch archives can contain several historical readings from the same E66
-- envelope. Lock their shared parent messages in one order before each proof.
CREATE FUNCTION gridex_billing_source.lock_ordinary_invoice_sources_v1(p_company uuid,p_underlays uuid[])
RETURNS jsonb LANGUAGE plpgsql SET search_path TO pg_catalog
AS $body$
DECLARE
  chosen uuid[];
  underlay uuid;
  binding_hash text;
  receipts jsonb:='{}';
BEGIN
  SELECT array_agg(b.underlay_id ORDER BY b.underlay_id) INTO chosen
  FROM gridex_billing_source.underlay_bindings b
  WHERE b.company_id=p_company AND b.underlay_id=ANY(p_underlays)
    AND gridex_billing_source.frozen_ordinary_invoice_source_v1(b.source_basis);
  IF chosen IS NULL THEN RETURN receipts; END IF;
  PERFORM gridex_bilateral_prodat.lock_supply_v1();
  PERFORM gridex_regulated_supply.lock_graph_v1();
  PERFORM message.id FROM public.ediel_messages message
  WHERE message.company_id=p_company AND message.id IN (
    SELECT (reading->>'sourceMessageId')::uuid
    FROM gridex_billing_source.underlay_bindings bound
    CROSS JOIN LATERAL jsonb_array_elements(bound.source_basis->'values') reading
    WHERE bound.company_id=p_company AND bound.underlay_id=ANY(chosen)
  )
  ORDER BY message.id FOR UPDATE;
  FOREACH underlay IN ARRAY chosen LOOP
    binding_hash:=gridex_billing_source.lock_ordinary_invoice_pricing_source_v1(p_company,underlay,true);
    IF binding_hash IS NULL THEN
      RAISE EXCEPTION 'ended_supply_pricing_basis_changed' USING ERRCODE='23514';
    END IF;
    receipts:=receipts||jsonb_build_object(underlay::text,binding_hash);
  END LOOP;
  RETURN receipts;
END
$body$;
REVOKE ALL ON FUNCTION gridex_billing_source.lock_ordinary_invoice_sources_v1(uuid,uuid[])
FROM PUBLIC,anon,authenticated,service_role;

DO $ended_pricing$
DECLARE
  previous text;
BEGIN
  IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc
    WHERE oid='public.gridex_set_metering_billing_gate(uuid,uuid,uuid,jsonb)'::regprocedure) IS DISTINCT FROM '6436365140840667c35faa1414bff1cff0540ee80b8bc2e21ef092763b70b1be' THEN
    RAISE EXCEPTION 'ordinary_ended_pricing_preimage_changed:gridex_set_metering_billing_gate';
  END IF;
  SELECT pg_get_functiondef('public.gridex_set_metering_billing_gate(uuid,uuid,uuid,jsonb)'::regprocedure) INTO STRICT previous;
  previous:=replace(previous,$previous$ PERFORM gridex_billing_source.lock_values_v1$previous$,$replacement$ -- Use the market owner order before any source message lock. One E66
 -- envelope may contain measurements for both active and ended supplies.
 IF p_gate->>'billing_status'='billable' OR p_gate->>'billing_gate_status'='eligible' THEN
  PERFORM gridex_bilateral_prodat.lock_supply_v1();
  PERFORM gridex_regulated_supply.lock_graph_v1();
 END IF;
 PERFORM gridex_billing_source.lock_values_v1$replacement$);
  previous:=replace(previous,$previous$NOT coalesce(sp.status IN ('active','confirmed_by_grid_owner'),false) OR NOT coalesce(ct.status IN ('signed','active'),false)$previous$,$replacement$NOT (coalesce(sp.status IN ('active','confirmed_by_grid_owner') AND ct.status IN ('signed','active'),false)
   OR coalesce(n.direction='consumption' AND n.quantity_kwh>=0 AND gridex_billing_source.ordinary_ended_supply_v1(sp,ct,n.period_start,n.period_end),false))$replacement$);
  EXECUTE previous;
  IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc
    WHERE oid='public.gridex_store_billing_underlay(uuid,jsonb,jsonb,uuid)'::regprocedure) IS DISTINCT FROM '9f258a5cc0fef64144d86e1b73bcde4b27ddf1cae09ca2231a3a02df35e5e71b' THEN
    RAISE EXCEPTION 'ordinary_ended_pricing_preimage_changed:gridex_store_billing_underlay';
  END IF;
  SELECT pg_get_functiondef('public.gridex_store_billing_underlay(uuid,jsonb,jsonb,uuid)'::regprocedure) INTO STRICT previous;
  previous:=replace(previous,$previous$ PERFORM gridex_billing_source.lock_values_v1$previous$,$replacement$ PERFORM gridex_bilateral_prodat.lock_supply_v1();
 PERFORM gridex_regulated_supply.lock_graph_v1();
 PERFORM gridex_billing_source.lock_values_v1$replacement$);
  previous:=replace(previous,$previous$NOT coalesce(sp.status IN ('active','confirmed_by_grid_owner'),false) OR NOT coalesce(ct.status IN ('signed','active'),false)$previous$,$replacement$NOT (coalesce(sp.status IN ('active','confirmed_by_grid_owner') AND ct.status IN ('signed','active'),false)
   OR coalesce(p_underlay->>'energy_direction'='consumption' AND gridex_billing_source.ordinary_ended_supply_v1(sp,ct,start_at,end_at),false))$replacement$);
  previous:=replace(previous,$previous$ PERFORM 1 FROM public.billing_underlays WHERE id=u.id FOR UPDATE;
 IF prior.underlay_id IS NOT NULL THEN$previous$,$replacement$ PERFORM 1 FROM public.billing_underlays WHERE id=u.id FOR UPDATE NOWAIT;
 IF prior.underlay_id IS NOT NULL THEN$replacement$);
  EXECUTE previous;
  IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc
    WHERE oid='public.gridex_read_billing_underlay_source_basis_v1(uuid,uuid[])'::regprocedure) IS DISTINCT FROM '496d105d3460b02556c830318043efd3cb8939b97475690729b325b50787cbb7' THEN
    RAISE EXCEPTION 'ordinary_ended_pricing_preimage_changed:gridex_read_billing_underlay_source_basis_v1';
  END IF;
  SELECT pg_get_functiondef('public.gridex_read_billing_underlay_source_basis_v1(uuid,uuid[])'::regprocedure) INTO STRICT previous;
  previous:=replace(previous,$previous$b gridex_billing_source.underlay_bindings%rowtype;qualified boolean;$previous$,$replacement$b gridex_billing_source.underlay_bindings%rowtype;qualified boolean;ended_contract jsonb;$replacement$);
  previous:=replace(previous,$previous$  result:=result||jsonb_build_array(jsonb_build_object('id',u.id,'qualified',qualified,'totalKwh',gridex_utilts_binding.canonical_decimal_v2(u.total_kwh::text),'sourceBasisHash',b.source_basis_hash,'correctionRequired',EXISTS(SELECT FROM gridex_billing_source.correction_journal j WHERE j.underlay_id=u.id)));$previous$,$replacement$  -- The source owner has revalidated the exact stored underlay. Expose only
  -- the contract facts that the historic pricing engine needs.
  IF qualified AND b.source_basis->>'contractStatus'='terminated' AND gridex_billing_source.ordinary_ended_pricing_v1(u) THEN
   SELECT jsonb_build_object('id',c.id,'contract_type',c.contract_type,
     'actual_start_date',to_jsonb(c)->'actual_start_date','actual_start_at',to_jsonb(c)->'actual_start_at',
     'starts_at',c.starts_at,'ends_at',c.ends_at,'fixed_price_ore_per_kwh',c.fixed_price_ore_per_kwh)
   INTO ended_contract FROM public.customer_contracts c WHERE c.company_id=p_company_id AND c.id=u.contract_id;
  ELSE
   ended_contract:=NULL;
  END IF;
  result:=result||jsonb_build_array(jsonb_build_object('id',u.id,'qualified',qualified,'totalKwh',gridex_utilts_binding.canonical_decimal_v2(u.total_kwh::text),'sourceBasisHash',b.source_basis_hash,'correctionRequired',EXISTS(SELECT FROM gridex_billing_source.correction_journal j WHERE j.underlay_id=u.id)) || CASE WHEN ended_contract IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('terminatedPricingContract',ended_contract) END);$replacement$);
  EXECUTE previous;
  IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc
    WHERE oid='public.gridex_read_interval_pricing_snapshot_v1(uuid,uuid,timestamptz,timestamptz,text,text,jsonb)'::regprocedure) IS DISTINCT FROM 'e5136394e47ffa4b649d7228f63728f438ca25a7f30c4b26788c938cfb1a3d66' THEN
    RAISE EXCEPTION 'ordinary_ended_pricing_preimage_changed:gridex_read_interval_pricing_snapshot_v1';
  END IF;
  SELECT pg_get_functiondef('public.gridex_read_interval_pricing_snapshot_v1(uuid,uuid,timestamptz,timestamptz,text,text,jsonb)'::regprocedure) INTO STRICT previous;
  previous:=replace(previous,$previous$and c.id=v_underlay.contract_id and c.status in ('active','signed');$previous$,$replacement$and c.id=v_underlay.contract_id AND (c.status IN ('active','signed') OR gridex_billing_source.ordinary_ended_pricing_v1(v_underlay));
  IF NOT FOUND AND EXISTS (
    SELECT FROM public.customer_contracts c
    WHERE c.company_id=p_company_id AND c.id=v_underlay.contract_id AND c.status='terminated'
  ) THEN RAISE EXCEPTION 'ended_supply_pricing_basis_required' USING ERRCODE='23514'; END IF;$replacement$);
  EXECUTE previous;
  IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc
    WHERE oid='public.gridex_persist_pricing_run(uuid,uuid,jsonb,jsonb)'::regprocedure) IS DISTINCT FROM '0ccb70e24872cc30cbf6e3f22bdc09ebd5eb552caf6393c2376d14cc5ad436c7' THEN
    RAISE EXCEPTION 'ordinary_ended_pricing_preimage_changed:gridex_persist_pricing_run';
  END IF;
  SELECT pg_get_functiondef('public.gridex_persist_pricing_run(uuid,uuid,jsonb,jsonb)'::regprocedure) INTO STRICT previous;
  previous:=replace(previous,$previous$  v_source_bound boolean;$previous$,$replacement$  v_source_bound boolean;
  v_ended_source_hash text;$replacement$);
  previous:=replace(previous,$previous$  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_billing_underlay_id::text,0));$previous$,$replacement$  IF v_final_status='success' THEN
    v_ended_source_hash:=gridex_billing_source.lock_ordinary_invoice_pricing_source_v1(p_company_id,p_billing_underlay_id);
  END IF;
  IF v_ended_source_hash IS NULL THEN
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_billing_underlay_id::text,0));
  ELSIF NOT pg_try_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_billing_underlay_id::text,0)) THEN
    RAISE EXCEPTION 'ended_supply_pricing_finance_busy' USING ERRCODE='55P03';
  END IF;$replacement$);
  previous:=replace(previous,$previous$and c.id=v_underlay.contract_id and c.status in ('active','signed');$previous$,$replacement$and c.id=v_underlay.contract_id AND (c.status IN ('active','signed') OR gridex_billing_source.ordinary_ended_pricing_v1(v_underlay));
  IF v_final_status='success' AND EXISTS (
    SELECT FROM public.customer_contracts c
    WHERE c.company_id=p_company_id AND c.id=v_underlay.contract_id AND c.status='terminated'
  ) AND (
    NOT gridex_billing_source.ordinary_ended_pricing_v1(v_underlay)
    OR NOT EXISTS (
      SELECT FROM gridex_billing_source.underlay_bindings current_binding
      WHERE current_binding.company_id=p_company_id AND current_binding.underlay_id=v_underlay.id
        AND current_binding.source_basis_hash=v_ended_source_hash
    )
  ) THEN
    RAISE EXCEPTION 'ended_supply_pricing_basis_required' USING ERRCODE='23514';
  END IF;$replacement$);
  previous:=replace(previous,$previous$  select * into v_underlay from public.billing_underlays
  where id=p_billing_underlay_id and company_id=p_company_id for update;$previous$,$replacement$  IF v_ended_source_hash IS NULL THEN
  select * into v_underlay from public.billing_underlays
  where id=p_billing_underlay_id and company_id=p_company_id for update;
  ELSE
  select * into v_underlay from public.billing_underlays
  where id=p_billing_underlay_id and company_id=p_company_id for update NOWAIT;
  END IF;$replacement$);
  EXECUTE previous;
  IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc
    WHERE oid='public.gridex_lock_pricing_run(uuid,uuid,uuid)'::regprocedure) IS DISTINCT FROM '2dbef106cb33170ec4490bba75164b479a26a24df9264162c3f368089eba4a08' THEN
    RAISE EXCEPTION 'ordinary_ended_pricing_preimage_changed:gridex_lock_pricing_run';
  END IF;
  SELECT pg_get_functiondef('public.gridex_lock_pricing_run(uuid,uuid,uuid)'::regprocedure) INTO STRICT previous;
  previous:=replace(previous,$previous$  v_month text;$previous$,$replacement$  v_month text;
  v_ended_source_hash text;$replacement$);
  previous:=replace(previous,$previous$  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_pricing_run_id::text,0));$previous$,$replacement$  -- A receipt already locked remains readable after a later source change.
  -- Requalify before taking financial locks on any new successful run.
  SELECT * INTO v_run FROM public.pricing_runs
  WHERE id=p_pricing_run_id AND company_id=p_company_id AND status='success';
  IF FOUND THEN v_ended_source_hash:=gridex_billing_source.lock_ordinary_invoice_pricing_source_v1(p_company_id,v_run.billing_underlay_id); END IF;
  IF v_ended_source_hash IS NULL THEN
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_pricing_run_id::text,0));
  ELSIF NOT pg_try_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_pricing_run_id::text,0)) THEN
    RAISE EXCEPTION 'ended_supply_pricing_finance_busy' USING ERRCODE='55P03';
  END IF;$replacement$);
  previous:=replace(previous,$previous$  insert into public.price_period_locks$previous$,$replacement$  IF EXISTS (
    SELECT FROM public.customer_contracts c
    WHERE c.company_id=p_company_id AND c.id=v_underlay.contract_id AND c.status='terminated'
  ) AND (
    NOT gridex_billing_source.ordinary_ended_pricing_v1(v_underlay)
    OR NOT EXISTS (
      SELECT FROM gridex_billing_source.underlay_bindings current_binding
      WHERE current_binding.company_id=p_company_id AND current_binding.underlay_id=v_underlay.id
        AND current_binding.source_basis_hash=v_ended_source_hash
    )
  ) THEN
    RAISE EXCEPTION 'ended_supply_pricing_basis_required' USING ERRCODE='23514';
  END IF;

  insert into public.price_period_locks$replacement$);
  previous:=replace(previous,$previous$  select * into v_run from public.pricing_runs where id=p_pricing_run_id and company_id=p_company_id for update;$previous$,$replacement$  IF v_ended_source_hash IS NULL THEN
  select * into v_run from public.pricing_runs where id=p_pricing_run_id and company_id=p_company_id for update;
  ELSE
  select * into v_run from public.pricing_runs where id=p_pricing_run_id and company_id=p_company_id for update NOWAIT;
  END IF;$replacement$);
  previous:=replace(previous,$previous$  select * into v_underlay from public.billing_underlays where id=v_run.billing_underlay_id and company_id=p_company_id for update;$previous$,$replacement$  IF v_ended_source_hash IS NULL THEN
  select * into v_underlay from public.billing_underlays where id=v_run.billing_underlay_id and company_id=p_company_id for update;
  ELSE
  select * into v_underlay from public.billing_underlays where id=v_run.billing_underlay_id and company_id=p_company_id for update NOWAIT;
  END IF;$replacement$);
  EXECUTE previous;
  IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc
    WHERE oid='public.gridex_reserve_capway_dispatch_entry_v1(uuid,uuid,uuid,uuid,uuid,uuid,text,text,timestamptz,text,text,text,text,text)'::regprocedure) IS DISTINCT FROM '6412794ef7f691c072dd5a2d5af5be25c7221cceed8d6686de5df1c0e07e9693' THEN
    RAISE EXCEPTION 'ordinary_ended_pricing_preimage_changed:gridex_reserve_capway_dispatch_entry_v1';
  END IF;
  SELECT pg_get_functiondef('public.gridex_reserve_capway_dispatch_entry_v1(uuid,uuid,uuid,uuid,uuid,uuid,text,text,timestamptz,text,text,text,text,text)'::regprocedure) INTO STRICT previous;
  previous:=replace(previous,$previous$  reserved uuid;$previous$,$replacement$  reserved uuid;
  discovered_underlay uuid;
  ended_source_hash text;$replacement$);
  previous:=replace(previous,$previous$  -- The canonical withdrawal owner$previous$,$replacement$  -- Take the same graph locks as the qualified underlay writer before any
  -- financial row locks. Reject an unauthorized actor before graph activity.
  IF public.gridex_actor_has_company_permission(p_actor,p_company,'billing_underlay.export') IS NOT TRUE THEN
    RAISE EXCEPTION 'capway_dispatch_actor_forbidden' USING ERRCODE='42501';
  END IF;
  PERFORM gridex_bilateral_prodat.lock_supply_v1();
  PERFORM gridex_regulated_supply.lock_graph_v1();
  IF p_phase='create' THEN
    SELECT i.billing_underlay_id INTO discovered_underlay FROM public.invoice_export_items i
    JOIN public.invoice_export_runs r ON r.id=i.export_run_id AND r.company_id=i.company_id
    JOIN public.customer_invoices v ON v.invoice_export_item_id=i.id AND v.id=p_invoice AND v.company_id=i.company_id
    WHERE i.id=p_item AND i.company_id=p_company AND i.export_run_id=p_run
      AND i.environment=p_environment AND i.provider='capway_aptic';
    IF FOUND THEN ended_source_hash:=gridex_billing_source.lock_ordinary_invoice_pricing_source_v1(p_company,discovered_underlay); END IF;
  END IF;

  -- The canonical withdrawal owner$replacement$);
  previous:=replace(previous,$previous$  PERFORM gridex_case_confirmation.require_underlay_invoice_open_v1$previous$,$replacement$  IF p_phase='create' AND EXISTS (
    SELECT FROM gridex_billing_source.underlay_bindings current_binding
    WHERE current_binding.company_id=p_company AND current_binding.underlay_id=underlay.id
      AND current_binding.source_basis->>'contractStatus'='terminated'
      AND current_binding.source_basis_hash IS DISTINCT FROM ended_source_hash
  ) THEN RAISE EXCEPTION 'ended_supply_pricing_basis_changed' USING ERRCODE='23514'; END IF;
  PERFORM gridex_case_confirmation.require_underlay_invoice_open_v1$replacement$);
  previous:=replace(previous,$previous$  SELECT * INTO company FROM public.companies WHERE id=p_company FOR UPDATE;$previous$,$replacement$  SELECT * INTO company FROM public.companies WHERE id=p_company FOR UPDATE NOWAIT;$replacement$);
  previous:=replace(previous,$previous$  PERFORM FROM public.customers WHERE id=item.customer_id AND company_id=p_company FOR UPDATE;$previous$,$replacement$  PERFORM FROM public.customers WHERE id=item.customer_id AND company_id=p_company FOR UPDATE NOWAIT;$replacement$);
  previous:=replace(previous,$previous$  SELECT * INTO STRICT underlay FROM public.billing_underlays
    WHERE id=item.billing_underlay_id AND company_id=p_company FOR SHARE;$previous$,$replacement$  SELECT * INTO STRICT underlay FROM public.billing_underlays
    WHERE id=item.billing_underlay_id AND company_id=p_company FOR SHARE NOWAIT;$replacement$);
  previous:=replace(previous,$previous$  SELECT * INTO STRICT pricing FROM public.pricing_runs
    WHERE id=item.pricing_run_id AND company_id=p_company FOR SHARE;$previous$,$replacement$  SELECT * INTO STRICT pricing FROM public.pricing_runs
    WHERE id=item.pricing_run_id AND company_id=p_company FOR SHARE NOWAIT;$replacement$);
  EXECUTE previous;
  IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc
    WHERE oid='public.gridex_approve_invoice_export_item_v1(uuid,uuid,uuid,jsonb,text)'::regprocedure) IS DISTINCT FROM 'ce3ae029237a33871bb6bf9ee35fc36370a81b6c38c3be0de3f1ab2d9cc523ac' THEN
    RAISE EXCEPTION 'ordinary_ended_pricing_preimage_changed:gridex_approve_invoice_export_item_v1';
  END IF;
  SELECT pg_get_functiondef('public.gridex_approve_invoice_export_item_v1(uuid,uuid,uuid,jsonb,text)'::regprocedure) INTO STRICT previous;
  previous:=replace(previous,$previous$  v_approved_at timestamptz;$previous$,$replacement$  v_approved_at timestamptz;
  discovered_underlay uuid;
  ended_source_hash text;$replacement$);
  previous:=replace(previous,$previous$  -- Match file creation's company$previous$,$replacement$  -- Only a first approval can acquire new source authority. Reading a
  -- complete historical approval follows the existing receipt path.
  IF public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'billing_underlay.export') IS TRUE
    AND EXISTS (SELECT FROM auth.users u JOIN public.user_profiles profile ON profile.id=u.id
      WHERE u.id=p_actor_user_id AND u.deleted_at IS NULL AND u.email_confirmed_at IS NOT NULL
        AND (u.banned_until IS NULL OR u.banned_until<=clock_timestamp()) AND profile.user_status='active') THEN
    SELECT i.billing_underlay_id INTO discovered_underlay
    FROM public.invoice_export_items i
    JOIN public.customer_invoices mirror ON mirror.invoice_export_item_id=i.id AND mirror.company_id=i.company_id
    WHERE i.company_id=p_company_id AND i.id=p_export_item_id AND i.status='pending'
      AND (i.metadata#>>'{approval,status}') IS DISTINCT FROM 'approved'
      AND (mirror.metadata#>>'{approval,status}') IS DISTINCT FROM 'approved';
    IF FOUND THEN ended_source_hash:=gridex_billing_source.lock_ordinary_invoice_pricing_source_v1(p_company_id,discovered_underlay,true); END IF;
  END IF;

  -- Match file creation's company$replacement$);
  previous:=replace(previous,$previous$  v_approved_at:=clock_timestamp();$previous$,$replacement$  IF EXISTS (
    SELECT FROM gridex_billing_source.underlay_bindings current_binding
    WHERE current_binding.company_id=p_company_id AND current_binding.underlay_id=v_underlay.id
      AND gridex_billing_source.frozen_ordinary_invoice_source_v1(current_binding.source_basis)
      AND current_binding.source_basis_hash IS DISTINCT FROM ended_source_hash
  ) THEN RAISE EXCEPTION 'ended_supply_pricing_basis_changed' USING ERRCODE='23514'; END IF;
  v_approved_at:=clock_timestamp();$replacement$);
  previous:=replace(previous,$previous$  SELECT * INTO v_company FROM public.companies WHERE id=p_company_id FOR UPDATE;$previous$,$replacement$  IF ended_source_hash IS NULL THEN
  SELECT * INTO v_company FROM public.companies WHERE id=p_company_id FOR UPDATE;
  ELSE
  SELECT * INTO v_company FROM public.companies WHERE id=p_company_id FOR UPDATE NOWAIT;
  END IF;$replacement$);
  previous:=replace(previous,$previous$  SELECT * INTO v_item FROM public.invoice_export_items
    WHERE company_id=p_company_id AND id=p_export_item_id FOR UPDATE;$previous$,$replacement$  IF ended_source_hash IS NULL THEN
  SELECT * INTO v_item FROM public.invoice_export_items
    WHERE company_id=p_company_id AND id=p_export_item_id FOR UPDATE;
  ELSE
  SELECT * INTO v_item FROM public.invoice_export_items
    WHERE company_id=p_company_id AND id=p_export_item_id FOR UPDATE NOWAIT;
  END IF;$replacement$);
  EXECUTE previous;
  IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc
    WHERE oid='gridex_invoice_file_archive.create_file(uuid,text,text,uuid,jsonb,text,uuid,timestamptz,text,jsonb)'::regprocedure) IS DISTINCT FROM '28be525f2186cb3533598b07793f2d1298b4a517d624e54f62e5b7404b53100a' THEN
    RAISE EXCEPTION 'ordinary_ended_pricing_preimage_changed:gridex_invoice_file_archive.create_file';
  END IF;
  SELECT pg_get_functiondef('gridex_invoice_file_archive.create_file(uuid,text,text,uuid,jsonb,text,uuid,timestamptz,text,jsonb)'::regprocedure) INTO STRICT previous;
  previous:=replace(previous,$previous$  r jsonb;$previous$,$replacement$  r jsonb;
  ended_source_hashes jsonb;
  discovered_item_ids uuid[];$replacement$);
  previous:=replace(previous,$previous$  IF p_provider IS NOT NULL THEN
    BEGIN$previous$,$replacement$  SELECT array_agg((row_data->>'invoice_export_item_id')::uuid) INTO discovered_item_ids
  FROM jsonb_array_elements(p_rows) row_data;
  ended_source_hashes:=gridex_billing_source.lock_ordinary_invoice_sources_v1(
    p_company_id,ARRAY(
      SELECT i.billing_underlay_id FROM public.invoice_export_items i
      JOIN public.invoice_export_runs run ON run.id=i.export_run_id AND run.company_id=i.company_id
      WHERE i.company_id=p_company_id AND i.id=ANY(discovered_item_ids)
        AND i.status='pending' AND i.export_file_id IS NULL AND i.metadata#>>'{approval,status}'='approved'
        AND run.environment=p_environment AND run.billing_month=p_billing_month
    )
  );

  IF p_provider IS NOT NULL THEN
    BEGIN$replacement$);
  previous:=replace(previous,$previous$  SELECT invoice_export_target_system, billing_provider_environment, invoice_export_enabled$previous$,$replacement$  -- Existing invoice owners may already have finance locks when checking a
  -- source. Keep the source-first branch from waiting behind such an owner.
  IF ended_source_hashes<>'{}'::jsonb THEN
    BEGIN
      PERFORM FROM public.companies WHERE id=p_company_id FOR UPDATE NOWAIT;
      PERFORM item.id FROM public.invoice_export_items item
        WHERE item.company_id=p_company_id AND item.id=ANY(discovered_item_ids)
        ORDER BY item.id FOR UPDATE NOWAIT;
      PERFORM mirror.id FROM public.customer_invoices mirror
        WHERE mirror.company_id=p_company_id AND mirror.invoice_export_item_id=ANY(discovered_item_ids)
        ORDER BY mirror.invoice_export_item_id FOR UPDATE NOWAIT;
    EXCEPTION WHEN lock_not_available THEN
      RAISE EXCEPTION 'invoice_file_finance_lock_busy' USING ERRCODE='55P03';
    END;
  END IF;
  SELECT invoice_export_target_system, billing_provider_environment, invoice_export_enabled$replacement$);
  previous:=replace(previous,$previous$  SELECT coalesce(sum((x->>'amount_inc_vat')$previous$,$replacement$  IF EXISTS (
    SELECT FROM public.invoice_export_items i
    JOIN gridex_billing_source.underlay_bindings bound ON bound.company_id=i.company_id AND bound.underlay_id=i.billing_underlay_id
    WHERE i.company_id=p_company_id AND i.id=ANY(v_ids)
      AND gridex_billing_source.frozen_ordinary_invoice_source_v1(bound.source_basis)
      AND bound.source_basis_hash IS DISTINCT FROM ended_source_hashes->>bound.underlay_id::text
  ) THEN RAISE EXCEPTION 'ended_supply_pricing_basis_changed' USING ERRCODE='23514'; END IF;

  SELECT coalesce(sum((x->>'amount_inc_vat')$replacement$);
  EXECUTE previous;
END
$ended_pricing$;
