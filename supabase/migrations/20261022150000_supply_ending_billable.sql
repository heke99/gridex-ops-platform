-- FINDINGS H2/H3 (reality scenario H, owner decision 2026-10-22): after the grid owner's end of supply
-- (PRODAT Z05) the customer's remaining supply days could never become billable.
--
--   H2  A Z05 for a future end leaves the period 'ending' until the end instant; the database billing gate
--       accepted only 'active'/'confirmed_by_grid_owner', so the last weeks of supply were refused.
--   H3  The supply-end follow-up (gridex_supply_end_followup_v1) terminates the contract when the end is
--       received (status 'terminated', termination_reason 'supply_end', ended_at = the end date); the gate
--       accepted only 'signed'/'active' contracts, so no value of the final month (and no value arriving
--       after the end for a day before it) could be billed: the final invoice was never prepared.
--
-- Design (minimal, keeps every received-source owner and the approved Z05 acceptance contracts unchanged):
--   * The trigger keeps terminating the contract when the end is received. The approved Z05 acceptance
--     tests (AT-Z05L/LK-SUPPLIER) pin exactly that follow-up, and its idempotency key is the end itself,
--     so deferring it to 'ended' would need a second firing path on the deadline sweep. Instead the gate
--     treats a contract that this very supply end terminated as still carrying the period up to the end:
--     the same rule the qualified supply basis already applies (20261002235300,
--     gridex_received_sources.supply_period_source_basis_v1). Any other terminated, cancelled or expired
--     contract stays refused.
--   * 'ending' and 'ended' periods are billable, but only for values inside the period: a received market
--     end at the start of its date (00:00 Ediel normal time = local midnight in winter, 01:00 in summer) is
--     exclusive, i.e. end_date is the first day no longer supplied (lib/billing/supplyPeriodEnd.ts, FINDINGS
--     H1); a manual end date stays the last supplied day. The qualified supply basis
--     (billing_supply_basis_v1) still requires the value to end at or before market_end_at.
--   * An ended period without an end date is never billable.
-- Tenant scope, service-role requirement, source basis, customer/metering-point/contract identity checks and
-- everything else are unchanged. Body rewrite with predecessor guards; owner, ACL and configuration unchanged.
BEGIN;
DO $h2$DECLARE f record;
 status_needle CONSTANT text:=$n$NOT coalesce(sp.status IN ('active','confirmed_by_grid_owner'),false) OR NOT coalesce(ct.status IN ('signed','active'),false)$n$;
 status_replacement CONSTANT text:=$n$NOT coalesce(sp.status IN ('active','confirmed_by_grid_owner','ending','ended'),false)
   OR (sp.status IN ('ending','ended') AND coalesce(sp.actual_end_date,sp.end_date) IS NULL)
   -- H3: a contract ended by exactly this period's end still carries the period up to that end.
   OR NOT coalesce(ct.status IN ('signed','active') OR (ct.status='terminated' AND ct.termination_reason='supply_end' AND sp.end_date IS NOT NULL AND ct.ended_at IS NOT NULL
    AND ((ct.ended_at AT TIME ZONE 'UTC')::date=sp.end_date OR (ct.ended_at AT TIME ZONE 'Europe/Stockholm')::date=sp.end_date)),false)$n$;
 end_needle CONSTANT text:=$n$(sp.end_date IS NOT NULL AND ((sp.end_date+1)::timestamp AT TIME ZONE 'Europe/Stockholm')<n.period_end)$n$;
 end_replacement CONSTANT text:=$n$(coalesce(sp.actual_end_date,sp.end_date) IS NOT NULL AND ((CASE
     -- H1: a received market end at the start of its date is exclusive (end_date = first day not supplied).
     WHEN sp.market_end_at IS NOT NULL AND sp.market_end_at<=(coalesce(sp.actual_end_date,sp.end_date)::timestamp AT TIME ZONE 'Europe/Stockholm')+interval '1 hour'
     THEN coalesce(sp.actual_end_date,sp.end_date) ELSE coalesce(sp.actual_end_date,sp.end_date)+1 END)::timestamp AT TIME ZONE 'Europe/Stockholm')<n.period_end)$n$;
 body text;
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p
  WHERE oid='public.gridex_set_metering_billing_gate(uuid,uuid,uuid,jsonb)'::regprocedure;
 IF (length(f.prosrc)-length(replace(f.prosrc,status_needle,'')))/length(status_needle)<>1
  OR (length(f.prosrc)-length(replace(f.prosrc,end_needle,'')))/length(end_needle)<>1 THEN RAISE EXCEPTION 'supply_ending_billable_predecessor_required';END IF;
 body:=replace(replace(f.prosrc,status_needle,status_replacement),end_needle,end_replacement);
 EXECUTE replace(f.definition,f.prosrc,body);
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'supply_ending_billable_metadata_changed';END IF;
END$h2$;
COMMIT;
