DO $migration$
DECLARE
  spec record;
  original record;
  patched text;
BEGIN
  FOR spec IN SELECT * FROM (VALUES
    ('public.gridex_set_metering_billing_gate(uuid,uuid,uuid,jsonb)',
     'ae6df44dbbe7a16435c5dead61b1c1861d2046fd9ba3a19dbd637875d0da4abf'),
    ('public.gridex_read_billing_source_values_v1(uuid,uuid[])',
     'f4ebfdf958b4023cc44bc2c8f5894e6efbe877926dee24f689afaf5ca8585a19'),
    ('public.gridex_read_billing_source_values_compact_v1(uuid,uuid[])',
     'd3996c214e3a15ac5108d527969f03682ed502e04d69843db2af413f1c088dff'),
    ('public.gridex_store_billing_underlay(uuid,jsonb,jsonb,uuid)',
     '75539361e56f0a3a6b4f85ae86810f6d0b07175cd57c5e56939da50f2a214b17'),
    ('gridex_billing_source.ordinary_ended_pricing_v1(public.billing_underlays)',
     '1f5e182633eaf1109b9f5c54bfdeb55616ef71fb6fdde49eb0dd97b5bbf624d9'),
    ('gridex_billing_source.lock_ordinary_invoice_pricing_source_v1(uuid,uuid,boolean)',
     '23f49da471ede0a392e4102971511079bf5ebabfd272968005edbc672b74d22a'),
    ('public.gridex_read_billing_underlay_source_basis_v1(uuid,uuid[])',
     '9cb9aded68503f164c269760b7a29489636e6cc4bb6287d912af04579bb7006d')
  ) AS bodies(signature,body_hash) LOOP
    IF (SELECT encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') FROM pg_proc p
        WHERE p.oid=spec.signature::regprocedure) IS DISTINCT FROM spec.body_hash
    THEN RAISE EXCEPTION 'planned_move_out_finance_exact_owner_required: %',spec.signature; END IF;
    IF (SELECT p.proowner FROM pg_proc p WHERE p.oid=spec.signature::regprocedure)
       IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user)
    THEN RAISE EXCEPTION 'planned_move_out_finance_owner_role_required: %',spec.signature; END IF;
  END LOOP;

  CREATE TABLE gridex_billing_source.planned_move_out_receipts (
    company_id uuid NOT NULL,
    normalized_value_id uuid NOT NULL,
    meter_value_id uuid NOT NULL,
    source_message_id uuid NOT NULL,
    supply_period_id uuid NOT NULL,
    contract_id uuid NOT NULL,
    source_basis_sha256 text NOT NULL CHECK (source_basis_sha256 ~ '^[0-9a-f]{64}$'),
    supply_source_basis jsonb NOT NULL,
    close_evidence jsonb NOT NULL,
    PRIMARY KEY(company_id,normalized_value_id)
  );
  ALTER TABLE gridex_billing_source.planned_move_out_receipts ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON TABLE gridex_billing_source.planned_move_out_receipts FROM PUBLIC,anon,authenticated,service_role;

  EXECUTE $ddl$
    CREATE FUNCTION gridex_billing_source.planned_move_out_close_receipt_v1(
      period public.customer_supply_periods, contract public.customer_contracts
    ) RETURNS jsonb LANGUAGE sql STABLE SET search_path TO pg_catalog
    AS $body$
      SELECT CASE WHEN count(*)=1 THEN jsonb_agg(jsonb_build_object(
        'contractId',contract.id, 'eventId',event.id, 'effectiveDate',period.end_date,
        'recordedAt',period.metadata->>'planned_end_recorded_at',
        'cutoffAt',(period.end_date+1)::timestamp AT TIME ZONE 'Europe/Stockholm'
      ))->0 END
      FROM public.customer_lifecycle_events event
      WHERE event.company_id=period.company_id AND event.customer_id=period.customer_id
        AND event.event_type='move_out' AND event.event_status='completed' AND event.effective_date=period.end_date
        AND event.created_at=CASE WHEN pg_input_is_valid(period.metadata->>'planned_end_recorded_at','timestamptz')
          THEN (period.metadata->>'planned_end_recorded_at')::timestamptz END
    $body$
  $ddl$;
  EXECUTE $ddl$
    CREATE FUNCTION gridex_billing_source.read_planned_move_out_receipt_v1(
      value public.normalized_metering_values, source_basis jsonb
    ) RETURNS jsonb LANGUAGE sql STABLE SET search_path TO pg_catalog
    AS $body$
      SELECT receipt.close_evidence
      FROM gridex_billing_source.planned_move_out_receipts receipt
      JOIN public.customer_supply_periods period ON (period.company_id,period.id)=(receipt.company_id,receipt.supply_period_id)
      JOIN public.customer_contracts contract ON (contract.company_id,contract.id)=(receipt.company_id,receipt.contract_id)
      WHERE (receipt.company_id,receipt.normalized_value_id,receipt.meter_value_id,receipt.source_message_id,receipt.supply_period_id)
            =(value.company_id,value.id,value.source_metering_value_id,value.source_message_id,value.supply_period_id)
        AND value.revision_status='current' AND value.billing_status='billable' AND value.billing_gate_status='eligible'
        AND source_basis->>'qualified'='true'
        AND receipt.source_basis_sha256=encode(sha256(convert_to(source_basis::text,'UTF8')),'hex')
        AND receipt.supply_source_basis IS NOT DISTINCT FROM value.billing_gate_snapshot->'supply_source_basis'
        AND receipt.close_evidence->>'recordedAt'=period.metadata->>'planned_end_recorded_at'
        AND receipt.supply_source_basis->>'currentSourceMessageId'=period.source_message_id::text
        AND receipt.supply_source_basis->>'marketStateVersion'=period.market_state_version::text
        -- This projection currently holds the raw observation locks. Check the
        -- retained market rows without taking the graph locks in reverse order.
        AND EXISTS (
          SELECT FROM public.ediel_messages source
          JOIN gridex_received_sources.validation_assessments assessment
            ON (assessment.company_id,assessment.environment,assessment.source_message_id,assessment.source_payload_hash)
              =(source.company_id,source.environment,source.id,source.immutable_payload_hash)
          WHERE (source.company_id,source.id)=(period.company_id,period.source_message_id)
            AND source.direction='inbound' AND source.message_family='PRODAT' AND source.message_code='Z04'
            AND source.immutable_payload_hash=receipt.supply_source_basis->>'payloadHash'
            AND source.immutable_payload_hash=encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex')
            AND assessment.facts_text::jsonb->>'syntaxDecision'='accepted'
            AND assessment.facts_text::jsonb->>'functionalDecision'='accepted'
            AND (assessment.facts_text::jsonb->>'applicationDecision'='accepted'
              OR gridex_received_sources.supply_effect_assessment_owns_period_v1(period.company_id,source.id,period.id,assessment.id)
              OR gridex_received_sources.mixed_period_canonical_v1(assessment.id,period.company_id,period.id,source.id))
            AND NOT EXISTS (
              SELECT FROM gridex_received_sources.validation_assessments successor
              WHERE successor.previous_assessment_id=assessment.id)
        )
        AND NOT EXISTS (
          SELECT FROM gridex_ediel_retention.blob_tombstones removed
          WHERE removed.company_id=receipt.company_id
            AND removed.message_id IN (period.source_message_id,(receipt.supply_source_basis->>'originalMessageId')::uuid)
        )
        AND gridex_received_sources.planned_move_out_supply_window_v1(period,contract,value.period_start,value.period_end)
    $body$
  $ddl$;
  EXECUTE $ddl$
    CREATE FUNCTION gridex_billing_source.is_planned_move_out_underlay_v1(
      underlay public.billing_underlays, basis jsonb
    ) RETURNS boolean LANGUAGE sql STABLE SET search_path TO pg_catalog
    AS $body$
      SELECT EXISTS (
        SELECT FROM public.customer_supply_periods period
        JOIN public.customer_contracts contract ON (contract.company_id,contract.id)=(period.company_id,period.contract_id)
        WHERE (period.company_id,period.id,period.contract_id,period.customer_id,period.metering_point_id)
          =(underlay.company_id,underlay.supply_period_id,underlay.contract_id,underlay.customer_id,underlay.metering_point_id)
          AND basis#>>'{supply,currentSourceMessageId}'=period.source_message_id::text
          AND basis#>>'{supply,marketStateVersion}'=period.market_state_version::text
          AND basis->>'contractId'=contract.id::text
          AND gridex_received_sources.planned_move_out_supply_window_v1(
            period,contract,(basis->>'start')::timestamptz,(basis->>'end')::timestamptz)
      )
    $body$
  $ddl$;
  REVOKE ALL ON FUNCTION gridex_billing_source.planned_move_out_close_receipt_v1(public.customer_supply_periods,public.customer_contracts),
    gridex_billing_source.read_planned_move_out_receipt_v1(public.normalized_metering_values,jsonb),
    gridex_billing_source.is_planned_move_out_underlay_v1(public.billing_underlays,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;

  FOR spec IN SELECT * FROM (VALUES
    ('gate','public.gridex_set_metering_billing_gate(uuid,uuid,uuid,jsonb)'),
    ('read','public.gridex_read_billing_source_values_v1(uuid,uuid[])'),
    ('read','public.gridex_read_billing_source_values_compact_v1(uuid,uuid[])'),
    ('underlay','public.gridex_store_billing_underlay(uuid,jsonb,jsonb,uuid)'),
    ('pricing','gridex_billing_source.ordinary_ended_pricing_v1(public.billing_underlays)'),
    ('pricing_lock','gridex_billing_source.lock_ordinary_invoice_pricing_source_v1(uuid,uuid,boolean)'),
    ('underlay_read','public.gridex_read_billing_underlay_source_basis_v1(uuid,uuid[])')
  ) AS targets(kind,signature) LOOP
    SELECT p.oid,p.prosrc,pg_get_functiondef(p.oid) definition,to_jsonb(p)-'prosrc' metadata
      INTO STRICT original FROM pg_proc p WHERE p.oid=spec.signature::regprocedure;
    patched:=original.prosrc;
    CASE spec.kind
    WHEN 'gate' THEN
      patched:=replace(patched,$old$DECLARE b jsonb;legal_basis jsonb;$old$,
        $new$DECLARE b jsonb;legal_basis jsonb;planned_move_out boolean:=false;v_close_evidence jsonb;basis_digest text;$new$);
      patched:=replace(patched,$old$ -- Use the market owner order$old$,$new$
 IF jsonb_typeof(p_gate->'billing_gate_snapshot')='object' AND ((p_gate->'billing_gate_snapshot')?'administrative_close_basis') THEN
  p_gate:=jsonb_set(p_gate,'{billing_gate_snapshot}',(p_gate->'billing_gate_snapshot')-'administrative_close_basis');
 END IF;
 -- Use the market owner order$new$);
      patched:=replace(patched,$old$  IF sp.id IS NULL OR ct.id IS NULL OR NOT ($old$,$new$
  planned_move_out:=CASE WHEN n.direction='consumption' AND n.quantity_kwh>=0
    AND ct.status='terminated' AND ct.termination_reason='move_out'
    THEN gridex_received_sources.planned_move_out_supply_window_v1(sp,ct,n.period_start,n.period_end)
    ELSE false END;
  IF sp.id IS NULL OR ct.id IS NULL OR NOT (planned_move_out OR $new$);
      patched:=replace(patched,$old$  p_gate:=p_gate||jsonb_build_object('billing_gate_snapshot',$old$,$new$
  IF planned_move_out THEN
   v_close_evidence:=gridex_billing_source.planned_move_out_close_receipt_v1(sp,ct);
   IF v_close_evidence IS NULL THEN RAISE EXCEPTION 'billing_gate_planned_move_out_receipt_required' USING ERRCODE='23514'; END IF;
   basis_digest:=encode(sha256(convert_to(b::text,'UTF8')),'hex');
   INSERT INTO gridex_billing_source.planned_move_out_receipts
     (company_id,normalized_value_id,meter_value_id,source_message_id,supply_period_id,contract_id,source_basis_sha256,supply_source_basis,close_evidence)
   VALUES(p_company_id,n.id,p_metering_value_id,n.source_message_id,sp.id,ct.id,basis_digest,legal_basis,v_close_evidence)
   ON CONFLICT(company_id,normalized_value_id) DO NOTHING;
   IF NOT EXISTS(SELECT FROM gridex_billing_source.planned_move_out_receipts r
    WHERE (r.company_id,r.normalized_value_id,r.meter_value_id,r.source_message_id,r.supply_period_id,r.contract_id,
           r.source_basis_sha256,r.supply_source_basis,r.close_evidence)
          =(p_company_id,n.id,p_metering_value_id,n.source_message_id,sp.id,ct.id,basis_digest,legal_basis,v_close_evidence)) THEN
    RAISE EXCEPTION 'billing_gate_planned_move_out_receipt_conflict' USING ERRCODE='23514';
   END IF;
  END IF;
  p_gate:=p_gate||jsonb_build_object('billing_gate_snapshot',$new$);
    WHEN 'read' THEN
      patched:=replace(patched,$old$DECLARE n public.normalized_metering_values%rowtype;$old$,
        $new$DECLARE admin_close jsonb; n public.normalized_metering_values%rowtype;$new$);
      patched:=replace(patched,$old$  b:=gridex_billing_source.basis_entry_v1(bases->i);i:=i+1;$old$,$new$  b:=gridex_billing_source.basis_entry_v1(bases->i);i:=i+1;
  admin_close:=CASE WHEN n.billing_status='billable' AND n.billing_gate_status='eligible'
    THEN gridex_billing_source.read_planned_move_out_receipt_v1(n,b) END;
  IF jsonb_typeof(n.billing_gate_snapshot)='object' THEN
   n.billing_gate_snapshot:=n.billing_gate_snapshot-'administrative_close_basis';
  END IF;$new$);
      patched:=replace(patched,$old$'status',s.status) END));$old$,$new$'status',s.status) END)
   || CASE WHEN admin_close IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('billing_administrative_close_basis',admin_close) END);$new$);
    WHEN 'underlay' THEN
      patched:=replace(patched,$old$DECLARE item jsonb;basis jsonb;legal_basis jsonb;$old$,
        $new$DECLARE item jsonb;basis jsonb;legal_basis jsonb;planned_move_out boolean:=false;$new$);
      patched:=replace(patched,$old$ IF sp.id IS NULL OR ct.id IS NULL OR price.id IS NULL$old$,$new$
 planned_move_out:=CASE WHEN p_underlay->>'energy_direction'='consumption'
   AND ct.status='terminated' AND ct.termination_reason='move_out'
   THEN gridex_received_sources.planned_move_out_supply_window_v1(sp,ct,start_at,end_at)
   ELSE false END;
 IF sp.id IS NULL OR ct.id IS NULL OR price.id IS NULL$new$);
      patched:=replace(patched,$old$OR NOT (coalesce(sp.status IN ('active','confirmed_by_grid_owner')$old$,
        $new$OR NOT (planned_move_out OR coalesce(sp.status IN ('active','confirmed_by_grid_owner')$new$);
      patched:=replace(patched,$old$  IF basis->'qualified' IS DISTINCT FROM 'true'::jsonb$old$,
        $new$  IF (planned_move_out AND gridex_billing_source.read_planned_move_out_receipt_v1(n,basis) IS NULL)
   OR basis->'qualified' IS DISTINCT FROM 'true'::jsonb$new$);
    WHEN 'pricing' THEN
      patched:=replace(patched,
        $old$AND binding.source_basis->>'contractStatus'='terminated'$old$,'');
      patched:=replace(patched,
        $old$      AND binding.source_basis#>>'{supply,currentSourceMessageId}'=period.source_end_message_id::text
$old$,'');
      patched:=replace(patched,
        $old$      AND gridex_billing_source.ordinary_ended_supply_v1(
        period,contract,(binding.source_basis->>'start')::timestamptz,(binding.source_basis->>'end')::timestamptz
      )$old$,
        $new$      AND (
        (binding.source_basis->>'contractStatus'='terminated'
          AND binding.source_basis#>>'{supply,currentSourceMessageId}'=period.source_end_message_id::text
          AND gridex_billing_source.ordinary_ended_supply_v1(
            period,contract,(binding.source_basis->>'start')::timestamptz,(binding.source_basis->>'end')::timestamptz))
        OR (binding.source_basis->>'contractStatus' IN ('signed','active','terminated')
          AND gridex_billing_source.is_planned_move_out_underlay_v1(underlay,binding.source_basis))
      )$new$);
    WHEN 'pricing_lock' THEN
      patched:=replace(patched,
        $old$      OR p_first_output AND gridex_billing_source.frozen_ordinary_invoice_source_v1(source_basis));$old$,
        $new$      OR p_first_output AND gridex_billing_source.frozen_ordinary_invoice_source_v1(source_basis)
      OR (source_basis->>'contractStatus' IN ('signed','active') AND EXISTS (
        SELECT FROM public.billing_underlays candidate
        WHERE (candidate.company_id,candidate.id)=(p_company,p_underlay)
          AND gridex_billing_source.is_planned_move_out_underlay_v1(candidate,source_basis)
      )));$new$);
      patched:=replace(patched,
        $old$  IF (binding.source_basis->>'contractStatus'='terminated' AND NOT gridex_billing_source.ordinary_ended_pricing_v1(underlay))$old$,
        $new$  IF ((binding.source_basis->>'contractStatus'='terminated'
    OR gridex_billing_source.is_planned_move_out_underlay_v1(underlay,binding.source_basis))
    AND NOT gridex_billing_source.ordinary_ended_pricing_v1(underlay))$new$);
    WHEN 'underlay_read' THEN
      patched:=replace(patched,
        $old$  IF qualified AND b.source_basis->>'contractStatus'='terminated' AND gridex_billing_source.ordinary_ended_pricing_v1(u) THEN$old$,
        $new$  IF qualified AND (b.source_basis->>'contractStatus'='terminated'
    OR gridex_billing_source.is_planned_move_out_underlay_v1(u,b.source_basis))
    AND gridex_billing_source.ordinary_ended_pricing_v1(u) THEN$new$);
    END CASE;
    IF patched=original.prosrc
      OR (spec.kind='gate' AND position('billing_gate_planned_move_out_receipt_conflict' in patched)=0)
      OR (spec.kind='read' AND position('billing_administrative_close_basis' in patched)=0)
      OR (spec.kind='underlay' AND position('planned_move_out_supply_window_v1' in patched)=0)
      OR (spec.kind IN ('pricing','pricing_lock','underlay_read') AND position('is_planned_move_out_underlay_v1' in patched)=0)
    THEN RAISE EXCEPTION 'planned_move_out_finance_exact_anchor_required: %',spec.signature; END IF;
    EXECUTE replace(original.definition,original.prosrc,patched);
    IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=original.oid) IS DISTINCT FROM original.metadata
    THEN RAISE EXCEPTION 'planned_move_out_finance_owner_metadata_changed: %',spec.signature; END IF;
  END LOOP;
END
$migration$;
