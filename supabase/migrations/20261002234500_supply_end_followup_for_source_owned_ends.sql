-- Source-owned supply ends (received Z05, bilateral H end, LK closure end and
-- national rescission end) set the period's end date themselves. Unlike
-- gridex_end_customer_supply_v1 (20261002213000, legacy path), they did not end
-- the contract or open final-invoice work, so the last partial period was
-- never invoiced and the contract kept running.
--
-- When a supply period receives an end date by any other path than
-- gridex_end_customer_supply_v1 (which marks metadata.end_key), the same
-- follow-up now happens in the same transaction, scoped to the period's own
-- tenant:
--   * the contract is terminated when no other supply under it continues;
--   * a break-fee review task opens when the end falls inside the binding
--     period (a person decides; nothing is charged automatically);
--   * a final-invoice task opens for the period up to the end date.
-- It is idempotent per period and end date.
BEGIN;
CREATE OR REPLACE FUNCTION public.gridex_supply_end_followup_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_catalog','pg_temp' AS $function$
DECLARE
  v_end date := coalesce(NEW.actual_end_date, NEW.end_date);
  v_key text := 'source-end:' || NEW.id::text || ':' || coalesce(NEW.actual_end_date, NEW.end_date)::text;
  v_contract public.customer_contracts%rowtype;
  v_contract_id uuid := coalesce(NEW.customer_contract_id, NEW.contract_id);
  v_binding_end date;
BEGIN
  IF v_end IS NULL OR NEW.company_id IS NULL OR NEW.customer_id IS NULL
   OR coalesce(NEW.metadata->>'end_key','') <> ''
   OR NEW.status NOT IN ('ending','ended')
   OR (OLD.end_date IS NOT DISTINCT FROM NEW.end_date AND OLD.actual_end_date IS NOT DISTINCT FROM NEW.actual_end_date AND OLD.status IN ('ending','ended')) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.customer_operation_tasks t WHERE t.company_id = NEW.company_id AND t.customer_id = NEW.customer_id
     AND t.task_type = 'final_invoice_pending' AND t.metadata->>'end_key' = v_key) THEN
    RETURN NEW;
  END IF;

  IF v_contract_id IS NOT NULL THEN
    SELECT * INTO v_contract FROM public.customer_contracts
     WHERE id = v_contract_id AND company_id = NEW.company_id AND customer_id = NEW.customer_id FOR UPDATE;
    IF FOUND AND v_contract.status IN ('signed','active') AND NOT EXISTS (
      SELECT 1 FROM public.customer_supply_periods other
       WHERE other.company_id = NEW.company_id AND coalesce(other.customer_contract_id, other.contract_id) = v_contract_id
         AND other.id <> NEW.id AND other.status IN ('active','confirmed_by_grid_owner')
         AND (coalesce(other.actual_end_date, other.end_date) IS NULL OR coalesce(other.actual_end_date, other.end_date) > v_end)) THEN
      BEGIN
        PERFORM public.gridex_record_customer_contract_event_v1(NEW.company_id, v_contract_id, NEW.customer_id, 'terminated', now(),
          'Avtalet upphörde eftersom leveransen till anläggningen upphörde.',
          jsonb_build_object('ends_at', v_end, 'termination_notice_date', now(), 'termination_reason', 'supply_end',
            'reason_code', 'supply_end', 'source_message_id', NEW.source_message_id),
          NULL, NULL, 'supply-end:' || v_contract_id::text || ':' || v_key);
      EXCEPTION WHEN OTHERS THEN
        -- The received supply end stands; a person ends the contract.
        INSERT INTO public.customer_operation_tasks(company_id, customer_id, metering_point_id, task_type, status, priority, title, description, metadata)
        VALUES (NEW.company_id, NEW.customer_id, NEW.metering_point_id, 'contract_end_review', 'open', 'high',
          'Avsluta avtal efter leveransslut',
          'Leveransen har upphört men avtalet kunde inte avslutas automatiskt. Kontrollera och avsluta avtalet.',
          jsonb_build_object('contract_id', v_contract_id, 'supply_end_date', v_end, 'end_key', v_key, 'reason', SQLERRM));
      END;
      IF coalesce(v_contract.binding_months, 0) > 0 AND v_contract.starts_at IS NOT NULL THEN
        v_binding_end := (v_contract.starts_at + make_interval(months => v_contract.binding_months))::date;
        IF v_binding_end > v_end THEN
          INSERT INTO public.customer_operation_tasks(company_id, customer_id, metering_point_id, task_type, status, priority, title, description, metadata)
          VALUES (NEW.company_id, NEW.customer_id, NEW.metering_point_id, 'break_fee_review', 'open', 'normal',
            'Bedöm brytavgift vid leveransslut',
            'Leveransen upphörde före bindningstidens slut. Bedöm om avtalet medger en brytavgift; inget debiteras automatiskt.',
            jsonb_build_object('contract_id', v_contract_id, 'binding_months', v_contract.binding_months,
              'binding_ends_at', v_binding_end, 'supply_end_date', v_end, 'end_key', v_key));
        END IF;
      END IF;
    END IF;
  END IF;

  INSERT INTO public.customer_operation_tasks(company_id, customer_id, metering_point_id, task_type, status, priority, title, description, metadata)
  VALUES (NEW.company_id, NEW.customer_id, NEW.metering_point_id, 'final_invoice_pending', 'open', 'high', 'Slutfaktura',
    'Leveransen upphör ' || to_char(v_end, 'YYYY-MM-DD') || '. Invänta slutavläsningen och fakturera perioden till och med slutdatumet.',
    jsonb_build_object('supply_end_date', v_end, 'end_reason', 'supply_end', 'end_key', v_key, 'supply_period_id', NEW.id));
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.gridex_supply_end_followup_v1() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_supply_end_followup ON public.customer_supply_periods;
CREATE TRIGGER trg_supply_end_followup
  AFTER UPDATE OF end_date, actual_end_date, status ON public.customer_supply_periods
  FOR EACH ROW EXECUTE FUNCTION public.gridex_supply_end_followup_v1();
COMMIT;
