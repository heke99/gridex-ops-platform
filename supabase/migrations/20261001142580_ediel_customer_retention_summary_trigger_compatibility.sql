-- Customer pseudonymisation could never complete:
-- 1. public.ediel_pseudonymise_customer_retention_v1 runs as
--    gridex_ediel_retention_owner. Its customers UPDATE fires the invoker
--    process-summary triggers, which call
--    public.gridex_refresh_customer_process_summary. Only postgres and
--    service_role may execute that function (42501).
-- 2. If the summary were refreshed, it would rewrite customers.process_summary
--    after pseudonymisation. gridex_ediel_retention.customer_tombstone_guard_v1
--    requires a tombstoned customer's process_summary to stay '{}'
--    (customer_retention_personal_fields_tombstoned).
-- A tombstoned customer has no live process summary. The refresh is now a
-- no-op for exactly those customers, through a private definer probe in the process-fact schema (no client
-- execute) so that the gridex_ediel_retention schema stays closed to service_role. The retention
-- owner role, not any client role, may execute the refresh.
BEGIN;
CREATE FUNCTION gridex_correction_process.customer_retention_tombstoned_v1(p_company_id uuid,p_customer_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog' AS $$
 SELECT EXISTS(SELECT FROM gridex_ediel_retention.customer_tombstones t WHERE t.customer_id=p_customer_id AND t.company_id=p_company_id)
$$;
REVOKE ALL ON FUNCTION gridex_correction_process.customer_retention_tombstoned_v1(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION gridex_correction_process.customer_retention_tombstoned_v1(uuid,uuid) TO service_role,gridex_ediel_retention_owner;

DO $rewrite$DECLARE f record;needle CONSTANT text:=E'begin\n  select\n    count(*) filter';
 replacement CONSTANT text:=E'begin\n  -- A retention tombstone fixes this customer''s summary at ''{}''.\n  IF gridex_correction_process.customer_retention_tombstoned_v1(p_company_id,p_customer_id) THEN RETURN ''{}''::jsonb; END IF;\n  select\n    count(*) filter';
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='public.gridex_refresh_customer_process_summary(uuid,uuid,text)'::regprocedure;
 IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'customer_summary_refresh_predecessor_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,replacement));
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'customer_summary_refresh_metadata_changed';END IF;
END$rewrite$;
GRANT EXECUTE ON FUNCTION public.gridex_refresh_customer_process_summary(uuid,uuid,text) TO gridex_ediel_retention_owner;
COMMIT;
