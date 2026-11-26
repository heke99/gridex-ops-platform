DO $migration$
BEGIN

-- Called inside the future ordinary reservation/approval/output transaction.
CREATE FUNCTION gridex_billing_source.lock_price_series_members_v1(
  p_company uuid,
  p_customer uuid,
  p_contract uuid,
  p_site uuid,
  p_point uuid,
  p_billing_month text,
  p_expected jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO pg_catalog
SET "TimeZone" TO 'UTC'
AS $function$
DECLARE
  hold_reason constant text := 'price_timeline_invoice_review_required';
  month_date date;
  month_start timestamptz;
  month_end timestamptz;
  underlay_ids uuid[];
  source_ids uuid[];
  source_count bigint;
  supply_period uuid;
  scope_timeline jsonb;
  snapshot_ids jsonb := '[]'::jsonb;
  members jsonb := '[]'::jsonb;
  expected_actual jsonb := '[]'::jsonb;
  previous_end timestamptz;
  start_at timestamptz;
  end_at timestamptz;
  net numeric := 0;
  quantity numeric := 0;
  source record;
  locked public.pricing_runs%ROWTYPE;
  seal gridex_locked_pricing_evidence.run_seals%ROWTYPE;
  evidence jsonb;
BEGIN
  IF p_company IS NULL OR p_customer IS NULL OR p_contract IS NULL OR p_site IS NULL OR p_point IS NULL
    OR p_billing_month IS NULL OR p_billing_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
    OR jsonb_typeof(p_expected) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invoice_price_series_scope_required' USING ERRCODE='22023';
  END IF;
  IF current_setting('transaction_isolation') NOT IN ('read committed','read uncommitted') THEN
    RAISE EXCEPTION 'invoice_price_timeline_read_committed_required' USING ERRCODE='25001';
  END IF;

  month_date := (p_billing_month || '-01')::date;
  month_start := month_date::timestamp AT TIME ZONE 'Europe/Stockholm';
  month_end := (month_date + interval '1 month') AT TIME ZONE 'Europe/Stockholm';

  -- Match the lock order of the native ordinary billing source owners.
  PERFORM gridex_bilateral_prodat.lock_supply_v1();
  PERFORM gridex_regulated_supply.lock_graph_v1();

  SELECT array_agg(u.id ORDER BY u.id) INTO underlay_ids
  FROM public.billing_underlays u
  WHERE u.company_id=p_company AND u.customer_id=p_customer AND u.metering_point_id=p_point
    AND p_contract IN (u.contract_id,u.customer_contract_id)
    AND u.underlay_year=extract(year FROM month_date) AND u.underlay_month=extract(month FROM month_date)
    AND u.energy_direction='consumption' AND u.settlement_type='invoice';
  IF coalesce(cardinality(underlay_ids),0)<2
    OR cardinality(underlay_ids)<>jsonb_array_length(p_expected) THEN
    RAISE EXCEPTION 'invoice_price_series_members_changed' USING ERRCODE='23514';
  END IF;

  SELECT min(u.supply_period_id::text)::uuid INTO supply_period
  FROM public.billing_underlays u WHERE u.company_id=p_company AND u.id=ANY(underlay_ids);
  SELECT count(*),array_agg(DISTINCT (v->>'normalizedValueId')::uuid ORDER BY (v->>'normalizedValueId')::uuid)
    INTO source_count,source_ids
  FROM gridex_billing_source.underlay_bindings b
  CROSS JOIN LATERAL jsonb_array_elements(b.source_basis->'values') v
  WHERE b.company_id=p_company AND b.underlay_id=ANY(underlay_ids);
  IF supply_period IS NULL OR coalesce(cardinality(source_ids),0)=0 OR array_position(source_ids,NULL) IS NOT NULL
    OR source_count<>cardinality(source_ids) THEN
    RAISE EXCEPTION 'invoice_price_series_source_required' USING ERRCODE='23514';
  END IF;
  PERFORM gridex_billing_source.lock_values_v1(p_company,source_ids,supply_period);
  PERFORM FROM public.customer_contracts c WHERE c.company_id=p_company
    AND c.customer_id=p_customer AND c.id=p_contract AND c.metering_point_id=p_point
    AND coalesce(c.site_id,c.customer_site_id)=p_site
    AND (c.site_id IS NULL OR c.customer_site_id IS NULL OR c.site_id=c.customer_site_id)
    FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice_price_series_scope_changed' USING ERRCODE='23514'; END IF;
  PERFORM FROM public.billing_underlays u
  WHERE u.company_id=p_company AND u.id=ANY(underlay_ids) ORDER BY u.id FOR SHARE NOWAIT;

  FOR source IN
    SELECT u.id,u.customer_contract_id,u.contract_id,u.site_id,u.customer_site_id,u.supply_period_id,
      u.billing_period_start,u.billing_period_end,u.contract_price_snapshot_id,u.currency,u.total_kwh,
      u.status,u.readiness_status,u.missing_values_count,u.billing_block_reason,
      u.payload,b.source_basis,b.source_basis_hash,b.exact_total_kwh
    FROM public.billing_underlays u
    LEFT JOIN gridex_billing_source.underlay_bindings b ON b.company_id=u.company_id AND b.underlay_id=u.id
    WHERE u.company_id=p_company AND u.id=ANY(underlay_ids)
    ORDER BY u.billing_period_start,u.billing_period_end,u.id
  LOOP
    start_at := (source.source_basis->>'start')::timestamptz;
    end_at := (source.source_basis->>'end')::timestamptz;
    IF source.supply_period_id IS DISTINCT FROM supply_period
      OR coalesce(source.customer_contract_id,source.contract_id) IS DISTINCT FROM p_contract
      OR (source.customer_contract_id IS NOT NULL AND source.contract_id IS NOT NULL AND source.customer_contract_id<>source.contract_id)
      OR coalesce(source.customer_site_id,source.site_id) IS DISTINCT FROM p_site
      OR (source.site_id IS NOT NULL AND source.customer_site_id IS NOT NULL AND source.site_id<>source.customer_site_id)
      OR source.status IS DISTINCT FROM 'validated' OR source.readiness_status IS DISTINCT FROM 'ready'
      OR source.currency IS DISTINCT FROM 'SEK' OR source.total_kwh IS NULL OR coalesce(source.missing_values_count,0)<>0
      OR source.billing_block_reason IS DISTINCT FROM hold_reason
      OR source.source_basis->>'invoiceReviewHold' IS DISTINCT FROM hold_reason
      OR source.source_basis->>'contractId' IS DISTINCT FROM p_contract::text
      OR source.source_basis->>'energyDirection' IS DISTINCT FROM 'consumption'
      OR source.source_basis#>>'{price,id}' IS DISTINCT FROM source.contract_price_snapshot_id::text
      OR source.exact_total_kwh IS DISTINCT FROM source.total_kwh
      OR source.source_basis_hash IS DISTINCT FROM encode(sha256(convert_to(source.source_basis::text,'UTF8')),'hex')
      OR NOT coalesce(isfinite(start_at) AND isfinite(end_at) AND start_at>=month_start AND end_at<=month_end AND end_at>start_at,false)
      OR start_at IS DISTINCT FROM (source.payload->>'billing_period_start_instant')::timestamptz
      OR end_at IS DISTINCT FROM (source.payload->>'billing_period_end_instant')::timestamptz
      OR source.billing_period_start IS DISTINCT FROM (start_at AT TIME ZONE 'Europe/Stockholm')::date
      OR source.billing_period_end IS DISTINCT FROM (end_at AT TIME ZONE 'Europe/Stockholm')::date
      OR (previous_end IS NOT NULL AND start_at IS DISTINCT FROM previous_end) THEN
      RAISE EXCEPTION 'invoice_price_series_source_changed' USING ERRCODE='23514';
    END IF;
    PERFORM gridex_billing_source.require_underlay_v1(p_company,source.id);

    IF scope_timeline IS NULL THEN
      scope_timeline := source.payload->'contract_price_timeline';
      IF start_at IS DISTINCT FROM (scope_timeline->>'from')::timestamptz THEN
        RAISE EXCEPTION 'invoice_price_series_coverage_changed' USING ERRCODE='23514';
      END IF;
    ELSIF scope_timeline IS DISTINCT FROM source.payload->'contract_price_timeline' THEN
      RAISE EXCEPTION 'invoice_price_series_coverage_changed' USING ERRCODE='23514';
    END IF;
    PERFORM gridex_billing_source.require_contract_price_timeline_v1(
      p_company,p_contract,source.contract_price_snapshot_id,start_at,end_at,scope_timeline);

    -- A segment must agree with its actual signed fixed-price version, not just
    -- with the month's ordered list of price IDs.
    PERFORM FROM public.contract_price_snapshots s
    JOIN public.price_plan_versions v ON v.company_id=s.company_id AND v.id=s.price_plan_version_id
    WHERE s.company_id=p_company AND s.contract_id=p_contract AND s.id=source.contract_price_snapshot_id
      AND s.pricing_model='fixed' AND s.source='issue_signed_terms'
      AND s.valid_from<=source.billing_period_start
      AND (s.valid_to IS NULL OR s.valid_to>=((end_at - interval '1 microsecond') AT TIME ZONE 'Europe/Stockholm')::date)
      AND v.locked_at IS NOT NULL AND v.content_sha256=source.source_basis->>'priceVersionHash'
      AND to_jsonb(s) IS NOT DISTINCT FROM source.source_basis->'price'
    FOR SHARE OF s,v NOWAIT;
    IF NOT FOUND THEN RAISE EXCEPTION 'invoice_price_series_signed_price_changed' USING ERRCODE='23514'; END IF;

    SELECT p.* INTO STRICT locked FROM public.pricing_runs p
      WHERE p.company_id=p_company AND p.customer_id=p_customer AND p.billing_underlay_id=source.id
        AND p.status='locked' AND p.locked_at IS NOT NULL
        AND p.energy_direction='consumption' AND p.settlement_type='invoice'
      FOR SHARE NOWAIT;
    IF locked.billing_period_start IS DISTINCT FROM start_at OR locked.billing_period_end IS DISTINCT FROM end_at THEN
      RAISE EXCEPTION 'invoice_price_series_pricing_period_changed' USING ERRCODE='23514';
    END IF;
    SELECT s.* INTO STRICT seal FROM gridex_locked_pricing_evidence.run_seals s
      WHERE s.company_id=p_company AND s.underlay_id=source.id AND s.run_id=locked.id FOR SHARE NOWAIT;
    evidence := gridex_locked_pricing_evidence.source_rows(p_company,source.id,locked.id);
    IF jsonb_array_length(evidence)<>seal.evidence_count
      OR gridex_locked_pricing_evidence.seal_digest(p_company,source.id,locked.id,evidence) IS DISTINCT FROM seal.evidence_digest THEN
      RAISE EXCEPTION 'invoice_price_series_pricing_evidence_changed' USING ERRCODE='23514';
    END IF;

    snapshot_ids := snapshot_ids||jsonb_build_array(source.contract_price_snapshot_id);
    expected_actual := expected_actual||jsonb_build_array(jsonb_build_object('underlayId',source.id,'pricingRunId',locked.id));
    members := members||jsonb_build_array(jsonb_build_object(
      'underlayId',source.id,'pricingRunId',locked.id,'priceSnapshotId',source.contract_price_snapshot_id,
      'sourceBasisSha256',source.source_basis_hash,'pricingEvidenceSha256',encode(seal.evidence_digest,'hex'),
      'from',start_at,'until',end_at,'quantityKwh',source.total_kwh,
      'amountExVat',locked.total_ex_vat,'lockedVatAmount',locked.vat_amount,'lockedAmountIncVat',locked.total_inc_vat
    ));
    previous_end := end_at;
    net := net+locked.total_ex_vat;
    quantity := quantity+source.total_kwh;
  END LOOP;

  IF (scope_timeline->>'until')::timestamptz IS DISTINCT FROM previous_end
    OR scope_timeline->'snapshotIds' IS DISTINCT FROM snapshot_ids
    OR expected_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'invoice_price_series_members_changed' USING ERRCODE='23514';
  END IF;
  RETURN jsonb_build_object(
    'kind','same_site_fixed_price_series_v1','companyId',p_company,'customerId',p_customer,'contractId',p_contract,
    'siteId',p_site,'meteringPointId',p_point,'supplyPeriodId',supply_period,'billingMonth',p_billing_month,'currency','SEK',
    'members',members,'quantityKwh',quantity,'amountExVat',net
  );
EXCEPTION
  WHEN no_data_found OR too_many_rows THEN
    RAISE EXCEPTION 'invoice_price_series_locked_pricing_required' USING ERRCODE='23514';
END;
$function$;
REVOKE ALL ON FUNCTION gridex_billing_source.lock_price_series_members_v1(uuid,uuid,uuid,uuid,uuid,text,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;

END
$migration$;
-- Private preparation foundation for a single metering point with several prices.
-- No application role can reserve, read or mutate these records directly.
CREATE TABLE gridex_billing_source.price_series_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  contract_id uuid NOT NULL,
  site_id uuid NOT NULL,
  metering_point_id uuid NOT NULL,
  billing_month text NOT NULL CHECK (billing_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  basis jsonb NOT NULL CHECK (jsonb_typeof(basis) = 'object'),
  basis_sha256 text NOT NULL CHECK (basis_sha256 = encode(sha256(convert_to(basis::text, 'UTF8')), 'hex')),
  UNIQUE (company_id, id),
  UNIQUE (company_id, customer_id, contract_id, site_id, metering_point_id, billing_month),
  FOREIGN KEY (company_id, contract_id) REFERENCES public.customer_contracts(company_id, id)
);

CREATE TABLE gridex_billing_source.price_series_reservation_members (
  company_id uuid NOT NULL,
  reservation_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal > 0),
  billing_underlay_id uuid NOT NULL REFERENCES public.billing_underlays(id),
  pricing_run_id uuid NOT NULL REFERENCES public.pricing_runs(id),
  PRIMARY KEY (company_id, billing_underlay_id),
  UNIQUE (company_id, reservation_id, ordinal),
  FOREIGN KEY (company_id, reservation_id)
    REFERENCES gridex_billing_source.price_series_reservations(company_id, id)
);

REVOKE ALL ON TABLE gridex_billing_source.price_series_reservations,
  gridex_billing_source.price_series_reservation_members FROM PUBLIC, anon, authenticated, service_role;

-- All three single-source producers already hold the shared invoice-basis lock.
DO $extend_single_fence$
DECLARE
  target constant regprocedure := 'gridex_invoice_groups.fence_single()'::regprocedure;
  original constant text := $original$            AND s.billing_underlay_id=NEW.billing_underlay_id) THEN$original$;
  replacement constant text := $replacement$            AND s.billing_underlay_id=NEW.billing_underlay_id) OR EXISTS(
    SELECT FROM gridex_billing_source.price_series_reservation_members s
    WHERE s.company_id=NEW.company_id AND s.billing_underlay_id=NEW.billing_underlay_id
  ) THEN$replacement$;
  original_lock constant text := $old$  PERFORM gridex_invoice_groups.lock_source(NEW.company_id,NEW.billing_underlay_id);$old$;
  guarded_lock constant text := $new$  -- A transaction snapshot taken before a separate reservation committed
  -- cannot prove its absence after acquiring the advisory lock.
  IF current_setting('transaction_isolation') NOT IN ('read committed','read uncommitted') THEN
    RAISE EXCEPTION 'invoice_source_reservation_read_committed_required' USING ERRCODE='25001';
  END IF;
  PERFORM gridex_invoice_groups.lock_source(NEW.company_id,NEW.billing_underlay_id);$new$;
  definition text;
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=target) IS DISTINCT FROM 'fc816b408450a95623bc553026dfd647'
  THEN RAISE EXCEPTION 'invoice_price_series_single_fence_predecessor_changed'; END IF;
  definition:=pg_get_functiondef(target);
  EXECUTE replace(replace(definition,original_lock,guarded_lock),original,replacement);
END
$extend_single_fence$;

CREATE FUNCTION gridex_billing_source.fence_price_series_group_source_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $function$
BEGIN
  IF current_setting('transaction_isolation') NOT IN ('read committed','read uncommitted') THEN
    RAISE EXCEPTION 'invoice_source_reservation_read_committed_required' USING ERRCODE='25001';
  END IF;
  PERFORM gridex_invoice_groups.lock_source(NEW.company_id, NEW.billing_underlay_id);
  IF EXISTS(SELECT FROM gridex_billing_source.price_series_reservation_members s
    WHERE s.company_id=NEW.company_id AND s.billing_underlay_id=NEW.billing_underlay_id)
  THEN RAISE EXCEPTION 'invoice_group_source_already_reserved' USING ERRCODE='23505'; END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION gridex_billing_source.fence_price_series_group_source_v1()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER invoice_group_price_series_reservation_fence
  BEFORE INSERT OR UPDATE OF company_id, billing_underlay_id, invoice_id ON gridex_invoice_groups.sources
  FOR EACH ROW EXECUTE FUNCTION gridex_billing_source.fence_price_series_group_source_v1();

CREATE FUNCTION gridex_billing_source.reserve_price_series_v1(
  p_company uuid, p_customer uuid, p_contract uuid, p_site uuid, p_point uuid, p_billing_month text, p_expected jsonb
) RETURNS jsonb
LANGUAGE plpgsql SET search_path TO pg_catalog AS $function$
DECLARE
  underlay_id uuid;
  verified_basis jsonb;
  verified_hash text;
  retained_members jsonb;
  answer gridex_billing_source.price_series_reservations%ROWTYPE;
BEGIN
  IF jsonb_typeof(p_expected) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invoice_price_series_scope_required' USING ERRCODE='22023';
  END IF;
  IF jsonb_array_length(p_expected) NOT BETWEEN 2 AND 32 THEN
    RAISE EXCEPTION 'invoice_price_series_scope_required' USING ERRCODE='22023';
  END IF;
  -- The same lock covers all existing one-source allocations and explicit group allocation.
  -- A stable order keeps callers for an identical set from waiting on each other in a cycle.
  FOR underlay_id IN SELECT DISTINCT (m->>'underlayId')::uuid FROM jsonb_array_elements(p_expected) m ORDER BY 1 LOOP
    IF underlay_id IS NULL THEN RAISE EXCEPTION 'invoice_price_series_scope_required' USING ERRCODE='22023'; END IF;
    PERFORM gridex_invoice_groups.lock_source(p_company, underlay_id);
  END LOOP;
  verified_basis:=gridex_billing_source.lock_price_series_members_v1(
    p_company,p_customer,p_contract,p_site,p_point,p_billing_month,p_expected);
  verified_hash:=encode(sha256(convert_to(verified_basis::text,'UTF8')),'hex');

  SELECT * INTO answer FROM gridex_billing_source.price_series_reservations r
  WHERE r.company_id=p_company AND r.customer_id=p_customer AND r.contract_id=p_contract AND r.site_id=p_site
    AND r.metering_point_id=p_point AND r.billing_month=p_billing_month FOR SHARE;
  IF FOUND THEN
    SELECT jsonb_agg(jsonb_build_object('underlayId',m.billing_underlay_id,'pricingRunId',m.pricing_run_id) ORDER BY m.ordinal)
      INTO retained_members FROM gridex_billing_source.price_series_reservation_members m
      WHERE m.company_id=p_company AND m.reservation_id=answer.id;
    IF retained_members IS DISTINCT FROM p_expected THEN
      RAISE EXCEPTION 'invoice_price_series_reservation_members_changed' USING ERRCODE='23514';
    END IF;
    IF answer.basis_sha256 IS DISTINCT FROM verified_hash OR answer.basis IS DISTINCT FROM verified_basis THEN
      RAISE EXCEPTION 'invoice_price_series_reservation_changed' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('id',answer.id,'basisSha256',answer.basis_sha256,'existing',true);
  END IF;

  FOR underlay_id IN SELECT (m->>'underlayId')::uuid FROM jsonb_array_elements(verified_basis->'members') m LOOP
    IF EXISTS(SELECT FROM public.invoice_export_items e WHERE e.company_id=p_company
        AND e.billing_underlay_id=underlay_id AND e.status<>'cancelled')
      OR EXISTS(SELECT FROM public.customer_invoices i WHERE i.company_id=p_company
        AND i.billing_underlay_id=underlay_id AND i.status<>'cancelled')
      OR EXISTS(SELECT FROM public.billing_export_run_items e WHERE e.company_id=p_company
        AND e.billing_underlay_id=underlay_id AND e.status<>'blocked')
      OR EXISTS(SELECT FROM gridex_invoice_groups.sources g WHERE g.company_id=p_company
        AND g.billing_underlay_id=underlay_id)
    THEN RAISE EXCEPTION 'invoice_group_source_already_reserved' USING ERRCODE='23505'; END IF;
  END LOOP;

  INSERT INTO gridex_billing_source.price_series_reservations(
    company_id,customer_id,contract_id,site_id,metering_point_id,billing_month,basis,basis_sha256
  ) VALUES (p_company,p_customer,p_contract,p_site,p_point,p_billing_month,verified_basis,verified_hash)
  RETURNING * INTO answer;
  INSERT INTO gridex_billing_source.price_series_reservation_members(
    company_id,reservation_id,ordinal,billing_underlay_id,pricing_run_id
  ) SELECT p_company,answer.id,ordinal,(m->>'underlayId')::uuid,(m->>'pricingRunId')::uuid
    FROM jsonb_array_elements(verified_basis->'members') WITH ORDINALITY AS member(m,ordinal);
  RETURN jsonb_build_object('id',answer.id,'basisSha256',answer.basis_sha256,'existing',false);
END
$function$;
REVOKE ALL ON FUNCTION gridex_billing_source.reserve_price_series_v1(uuid,uuid,uuid,uuid,uuid,text,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
