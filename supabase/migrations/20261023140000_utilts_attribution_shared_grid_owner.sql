-- FINDINGS F101 (reality world 2026-10-23, scenario F run 21): every bound UTILTS
-- consumption sink refused with utilts_consumption_grid_owner_changed, because
-- gridex_utilts_binding.lock_attribution_v1 required grid_owners.company_id = tenant.
-- In the registry model (F41) grid owners are platform-shared rows (company_id IS NULL),
-- and the product's own site/point path assigns the shared row to the tenant's data
-- (F58: normalizeGridOwnerIdToOps accepts "shared or own, never another tenant's").
--
-- The grid owner is now accepted when it is the tenant's own row, or a shared row that
-- the tenant is bound to by its own data in this same attribution: the tenant-owned
-- metering point, customer site or grid-owner data request that names this grid owner
-- (the canonical binding of gridex_received_sources.document_reference_facts_v1:
-- g.id = tenant point/site grid_owner_id AND (g.company_id IS NULL OR g.company_id = tenant)).
-- An arbitrary shared row and another tenant's row are still refused with the same
-- error. Lock order (customer, sites, point, grid owner, request) and FOR SHARE are kept;
-- the request is still locked and rechecked afterwards.
-- The body is rewritten with metadata/OID/ACL preserved.
BEGIN;
DO $rewrite$DECLARE f record;
 target CONSTANT regprocedure:='gridex_utilts_binding.lock_attribution_v1(uuid,jsonb,boolean)'::regprocedure;
 needle CONSTANT text:=$n$g.id=(p_attribution->>'gridOwnerId')::uuid AND g.company_id=p_company FOR SHARE;$n$;
 replacement CONSTANT text:=$r$g.id=(p_attribution->>'gridOwnerId')::uuid AND (g.company_id=p_company OR (g.company_id IS NULL AND (
   (v_point.id IS NOT NULL AND v_point.company_id=p_company AND v_point.customer_id=v_customer AND v_point.grid_owner_id=g.id)
   OR EXISTS(SELECT FROM public.customer_sites s WHERE s.id IN ((p_attribution->>'siteId')::uuid,(p_attribution->>'customerSiteId')::uuid)
    AND s.company_id=p_company AND s.customer_id=v_customer AND s.grid_owner_id=g.id)
   OR EXISTS(SELECT FROM public.grid_owner_data_requests r WHERE r.id=(p_attribution->>'sourceRequestId')::uuid
    AND r.company_id=p_company AND r.customer_id=v_customer AND r.grid_owner_id=g.id)))) FOR SHARE;$r$;
 installed text;
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE p.oid=target;
 IF encode(sha256(convert_to(f.prosrc,'UTF8')),'hex') IS DISTINCT FROM '168ef9b1ef2d6f903174061619e4f2a1c2542ea04754405808b37d735f7f99de'
  OR (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1
  OR (length(f.definition)-length(replace(f.definition,f.prosrc,'')))/length(f.prosrc)<>1 THEN
  RAISE EXCEPTION 'utilts_attribution_shared_grid_owner_predecessor_required' USING ERRCODE='P0U01'; END IF;
 EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,replacement));
 SELECT p.prosrc INTO STRICT installed FROM pg_proc p WHERE p.oid=f.oid;
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=f.oid) IS DISTINCT FROM f.metadata
  OR installed IS DISTINCT FROM replace(f.prosrc,needle,replacement) THEN
  RAISE EXCEPTION 'utilts_attribution_shared_grid_owner_metadata_changed' USING ERRCODE='P0U01'; END IF;
END$rewrite$;
COMMIT;
