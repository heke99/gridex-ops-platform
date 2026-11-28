DO $migration$
BEGIN
CREATE FUNCTION gridex_case_confirmation.protect_held_underlay_contract_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $guard$
BEGIN
  IF (NEW.contract_id,NEW.customer_contract_id,NEW.supply_period_id)
       IS NOT DISTINCT FROM (OLD.contract_id,OLD.customer_contract_id,OLD.supply_period_id) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT FROM public.customer_cases work
    WHERE work.company_id=OLD.company_id AND work.customer_id=OLD.customer_id
      AND work.customer_contract_id IN (OLD.contract_id,OLD.customer_contract_id)
      AND work.status='billing_blocked' AND work.billing_blocked
      AND work.metadata->>'scopeType'='contract'
      AND work.metadata->>'scopeId'=work.customer_contract_id::text
  ) THEN
    RAISE EXCEPTION 'billing_underlay_held_lineage_conflict' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION gridex_case_confirmation.protect_held_underlay_contract_v1()
  FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER gridex_held_underlay_contract_lineage_guard
BEFORE UPDATE OF contract_id,customer_contract_id,supply_period_id ON public.billing_underlays
FOR EACH ROW EXECUTE FUNCTION gridex_case_confirmation.protect_held_underlay_contract_v1();
END
$migration$;
