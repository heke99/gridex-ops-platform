\set ON_ERROR_STOP on
-- Run only against an explicitly owned disposable PostgreSQL backend:
-- psql "$OWNED_TEST_DB_URL" -X -f scripts/billing-gate-customer-attribution-native-regression.sql
-- All fixture and RPC writes roll back. Never point this at a shared or live DB.
-- These cases exercise the actual public RPC's non-billable paths. They do not
-- qualify an Ediel original, an eligible/billable source basis, full migrations,
-- trigger/RLS admission, or an original 105-scenario acceptance criterion.
BEGIN;

DO $regression$
DECLARE
  company_id uuid := gen_random_uuid();
  foreign_company_id uuid := gen_random_uuid();
  owner_id uuid := gen_random_uuid();
  other_customer_id uuid := gen_random_uuid();
  foreign_customer_id uuid := gen_random_uuid();
  point_id uuid := gen_random_uuid();
  meter_id uuid := gen_random_uuid();
  normalized_id uuid := gen_random_uuid();
  gate_status text;
  input_kind text;
  proposed_customer uuid;
  persisted_owner uuid;
  gate jsonb;
  before_rows jsonb;
  after_rows jsonb;
  result jsonb;
  actual_message text;
  original_role text := current_setting('role');
  expected_denials integer := 0;
  positive_writes integer := 0;
  failures integer := 0;
BEGIN
  INSERT INTO public.companies(id, name)
  VALUES (company_id, 'Owned billing attribution regression'),
         (foreign_company_id, 'Owned foreign attribution regression');
  INSERT INTO public.customers(id, company_id, full_name)
  VALUES (owner_id, company_id, 'Persisted owner'),
         (other_customer_id, company_id, 'Different customer in same tenant'),
         (foreign_customer_id, foreign_company_id, 'Different tenant customer');
  INSERT INTO public.metering_points(id, company_id, customer_id)
  VALUES (point_id, company_id, owner_id);
  INSERT INTO public.metering_values(
    id, company_id, customer_id, metering_point_id, value_kwh,
    period_start, period_end, source_system, revision_status
  ) VALUES (
    meter_id, company_id, owner_id, point_id, 1,
    '2026-01-01 00:00:00+00', '2026-01-01 00:15:00+00', 'manual', 'current'
  );
  INSERT INTO public.normalized_metering_values(
    id, company_id, customer_id, metering_point_id, source_metering_value_id,
    period_start, period_end, quantity_kwh, source_type, revision_status
  ) VALUES (
    normalized_id, company_id, owner_id, point_id, meter_id,
    '2026-01-01 00:00:00+00', '2026-01-01 00:15:00+00', 1, 'manual', 'current'
  );

  -- Before the fix the real public RPC accepts each proposed different owner
  -- and mutates both rows. Each successful unexpected call is rolled back by
  -- its local subtransaction before the next case.
  FOREACH gate_status IN ARRAY ARRAY['pending_match', 'blocked', 'conflict'] LOOP
    FOREACH input_kind IN ARRAY ARRAY['same_tenant_other', 'foreign_tenant', 'previously_unassigned'] LOOP
      persisted_owner := CASE WHEN input_kind = 'previously_unassigned' THEN NULL ELSE owner_id END;
      proposed_customer := CASE input_kind
        WHEN 'same_tenant_other' THEN other_customer_id
        WHEN 'foreign_tenant' THEN foreign_customer_id
        ELSE owner_id
      END;
      UPDATE public.normalized_metering_values
      SET customer_id = persisted_owner WHERE id = normalized_id;
      SELECT jsonb_build_object('raw', to_jsonb(m), 'normalized', to_jsonb(n))
      INTO before_rows FROM public.metering_values m
      CROSS JOIN public.normalized_metering_values n
      WHERE m.id = meter_id AND n.id = normalized_id;
      gate := jsonb_build_object(
        'customer_id', proposed_customer, 'billing_status', gate_status,
        'billing_gate_status', gate_status,
        'billing_gate_reasons', jsonb_build_array('regression'),
        'billing_gate_snapshot', jsonb_build_object('case', input_kind)
      );
      BEGIN
        PERFORM set_config('role', 'service_role', true);
        PERFORM public.gridex_set_metering_billing_gate(company_id, meter_id, normalized_id, gate);
        PERFORM set_config('role', original_role, true);
        IF NOT EXISTS (
          SELECT FROM public.metering_values m CROSS JOIN public.normalized_metering_values n
          WHERE m.id = meter_id AND n.id = normalized_id
            AND m.customer_id = proposed_customer AND n.customer_id = proposed_customer
            AND m.billing_status = gate_status AND n.billing_status = gate_status
        ) THEN RAISE EXCEPTION 'unexpected successful gate result without observed reassignment'; END IF;
        RAISE EXCEPTION 'unexpected_customer_reassignment_accepted' USING ERRCODE = 'P0R18';
      EXCEPTION
        WHEN check_violation THEN
          GET STACKED DIAGNOSTICS actual_message = MESSAGE_TEXT;
          IF actual_message <> 'billing_gate_customer_attribution_mismatch' THEN
            RAISE EXCEPTION 'wrong denial for %/%: %', gate_status, input_kind, actual_message;
          END IF;
          expected_denials := expected_denials + 1;
        WHEN SQLSTATE 'P0R18' THEN
          failures := failures + 1;
          RAISE NOTICE 'FAIL: %/% accepted and wrote the proposed customer to both rows', gate_status, input_kind;
      END;
      PERFORM set_config('role', original_role, true);
      SELECT jsonb_build_object('raw', to_jsonb(m), 'normalized', to_jsonb(n))
      INTO after_rows FROM public.metering_values m
      CROSS JOIN public.normalized_metering_values n
      WHERE m.id = meter_id AND n.id = normalized_id;
      IF after_rows IS DISTINCT FROM before_rows THEN
        RAISE EXCEPTION 'denied gate changed persisted rows for %/%', gate_status, input_kind;
      END IF;
    END LOOP;
  END LOOP;

  -- Explicitly unchanged ownership must still allow ordinary gate effects.
  UPDATE public.normalized_metering_values SET customer_id = owner_id WHERE id = normalized_id;
  FOREACH gate_status IN ARRAY ARRAY['pending_match', 'blocked', 'conflict'] LOOP
    gate := jsonb_build_object(
      'customer_id', owner_id, 'billing_status', gate_status,
      'billing_gate_status', gate_status,
      'billing_gate_reasons', jsonb_build_array('same_owner'),
      'billing_gate_snapshot', jsonb_build_object('case', 'same_owner'),
      'billing_gate_evaluated_at', '2026-10-28T20:00:00Z'
    );
    PERFORM set_config('role', 'service_role', true);
    result := public.gridex_set_metering_billing_gate(company_id, meter_id, normalized_id, gate);
    PERFORM set_config('role', original_role, true);
    IF result->>'status' IS DISTINCT FROM gate_status OR NOT EXISTS (
      SELECT FROM public.metering_values m JOIN public.normalized_metering_values n
        ON n.source_metering_value_id = m.id
      WHERE m.id = meter_id AND n.id = normalized_id
        AND m.customer_id = owner_id AND n.customer_id = owner_id
        AND m.billing_status = gate_status AND n.billing_status = gate_status
        AND m.billing_gate_status = gate_status AND n.billing_gate_status = gate_status
        AND m.billing_gate_reasons = gate->'billing_gate_reasons'
        AND n.billing_gate_reasons = gate->'billing_gate_reasons'
        AND m.billing_gate_snapshot = gate->'billing_gate_snapshot'
        AND n.billing_gate_snapshot = gate->'billing_gate_snapshot'
        AND m.billing_gate_evaluated_at = '2026-10-28T20:00:00Z'::timestamptz
        AND n.billing_gate_evaluated_at = '2026-10-28T20:00:00Z'::timestamptz
    ) THEN RAISE EXCEPTION 'same-owner gate effects were not preserved for %', gate_status; END IF;
    positive_writes := positive_writes + 1;
  END LOOP;

  -- Omitted, JSON null and empty IDs retain both raw and normalized ownership,
  -- including a historically unassigned normalized row. No mirror-fill policy
  -- or point-current-owner inference is introduced by this fix.
  FOREACH persisted_owner IN ARRAY ARRAY[owner_id, NULL::uuid] LOOP
    UPDATE public.normalized_metering_values SET customer_id = persisted_owner WHERE id = normalized_id;
    FOREACH gate_status IN ARRAY ARRAY['pending_match', 'blocked', 'conflict'] LOOP
      FOREACH input_kind IN ARRAY ARRAY['omitted', 'null', 'empty'] LOOP
        gate := jsonb_build_object('billing_status', gate_status, 'billing_gate_status', gate_status);
        IF input_kind = 'null' THEN gate := gate || '{"customer_id":null}'::jsonb;
        ELSIF input_kind = 'empty' THEN gate := gate || '{"customer_id":""}'::jsonb;
        END IF;
        PERFORM set_config('role', 'service_role', true);
        result := public.gridex_set_metering_billing_gate(company_id, meter_id, normalized_id, gate);
        PERFORM set_config('role', original_role, true);
        IF result->>'status' IS DISTINCT FROM gate_status OR NOT EXISTS (
          SELECT FROM public.metering_values m CROSS JOIN public.normalized_metering_values n
          WHERE m.id = meter_id AND n.id = normalized_id
            AND m.customer_id = owner_id AND n.customer_id IS NOT DISTINCT FROM persisted_owner
            AND m.billing_status = gate_status AND n.billing_status = gate_status
        ) THEN RAISE EXCEPTION 'ownership not preserved for %/%/%', persisted_owner, gate_status, input_kind; END IF;
        positive_writes := positive_writes + 1;
      END LOOP;
    END LOOP;
  END LOOP;

  IF failures <> 0 OR expected_denials <> 9 OR positive_writes <> 21 THEN
    RAISE EXCEPTION 'billing attribution regression failed: % accepted reassignments, %/9 denials, %/21 positive writes',
      failures, expected_denials, positive_writes;
  END IF;
  RAISE NOTICE 'PASS: 9 exact customer-attribution denials, 21 legitimate/preserving gate writes; rollback follows';
END
$regression$;

ROLLBACK;
