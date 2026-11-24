DO $migration$
BEGIN
CREATE FUNCTION gridex_case_confirmation.require_underlay_invoice_open_v1(p_company uuid,p_underlay uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SET search_path TO pg_catalog AS $fn$
BEGIN
  IF EXISTS (
    SELECT FROM public.billing_underlays u
    JOIN public.customer_cases work ON work.company_id=u.company_id AND work.customer_id=u.customer_id
     AND work.customer_contract_id IN (u.contract_id,u.customer_contract_id)
    WHERE u.company_id=p_company AND u.id=p_underlay
      AND work.status='billing_blocked' AND work.billing_blocked
      AND work.metadata->>'scopeType'='contract'
      AND work.metadata->>'scopeId'=work.customer_contract_id::text
  ) THEN
    RAISE EXCEPTION 'invoice_file_contract_case_hold' USING ERRCODE='23514';
  END IF;
END
$fn$;

CREATE FUNCTION gridex_case_confirmation.require_group_invoice_open_v1(p_company uuid,p_invoice uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SET search_path TO pg_catalog AS $fn$
DECLARE source_id uuid;
BEGIN
  FOR source_id IN SELECT s.billing_underlay_id FROM gridex_invoice_groups.sources s
    WHERE s.company_id=p_company AND s.invoice_id=p_invoice ORDER BY s.billing_underlay_id
  LOOP
    PERFORM gridex_case_confirmation.require_underlay_invoice_open_v1(p_company,source_id);
  END LOOP;
END
$fn$;

REVOKE ALL ON FUNCTION gridex_case_confirmation.require_underlay_invoice_open_v1(uuid,uuid),
  gridex_case_confirmation.require_group_invoice_open_v1(uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
END
$migration$;
