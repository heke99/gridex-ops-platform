-- gridex_received_sources.supply_period_source_basis_v1 re-reads the immutable
-- source basis of a supply period for a queried interval and required the
-- carrying contract to be signed/active. When the period receives its end,
-- the supply-end follow-up (gridex_end_customer_supply_v1 on main, and
-- 20261002234500 for source-owned ends) terminates the contract at once
-- (termination_reason 'supply_end', ended_at = the end date). Every later
-- read of that same period's basis, e.g. the reviewed received closure, was
-- then NULL, although the interval lies inside the period and the protected
-- contract hash (which excludes status) is unchanged.
--
-- A contract terminated by exactly this period's end still carried the
-- period. Any other terminated, cancelled or expired contract stays refused.
-- Body rewrite with predecessor and metadata guards; nothing else changes.
BEGIN;
DO $basis$DECLARE f record;
 needle CONSTANT text:=$n$(c.status IN('signed','active')) IS NOT TRUE$n$;
 replacement CONSTANT text:=$n$(c.status IN('signed','active') OR c.status='terminated' AND c.termination_reason='supply_end' AND p.end_date IS NOT NULL AND c.ended_at IS NOT NULL
   AND ((c.ended_at AT TIME ZONE 'UTC')::date=p.end_date OR (c.ended_at AT TIME ZONE 'Europe/Stockholm')::date=p.end_date)) IS NOT TRUE$n$;
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p
  WHERE oid='gridex_received_sources.supply_period_source_basis_v1(uuid,uuid,timestamptz,timestamptz)'::regprocedure;
 IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'supply_basis_contract_end_predecessor_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,replacement));
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'supply_basis_contract_end_metadata_changed';END IF;
END$basis$;
COMMIT;
