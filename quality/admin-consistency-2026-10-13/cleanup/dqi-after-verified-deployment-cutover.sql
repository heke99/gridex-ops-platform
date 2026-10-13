-- Execute only after the new production application is verified and legacy
-- five-column conflict-target writers have drained. This is the remaining
-- second-forward cutover, not a replay of its superseded function definitions.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.data_quality_issues, public.dashboard_alerts IN ACCESS EXCLUSIVE MODE;
DO $cutover$
DECLARE before_functions jsonb; after_functions jsonb;
BEGIN
  IF to_regclass('public.data_quality_issues_open_key_uidx') IS NULL
     OR to_regclass('public.dashboard_alerts_open_key_uidx') IS NULL THEN
    RAISE EXCEPTION 'quality_cutover_open_key_index_missing';
  END IF;
  SELECT jsonb_agg(jsonb_build_array(n.nspname,p.proname,p.oid::text,md5(p.prosrc),p.prosecdef,p.provolatile,p.proconfig,p.proacl::text) ORDER BY p.oid)
  INTO before_functions FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname IN ('public','gridex_quality','gridex_manual_inbound');
  ALTER TABLE public.data_quality_issues DROP CONSTRAINT IF EXISTS data_quality_issues_company_id_entity_type_entity_id_issue__key;
  ALTER TABLE public.dashboard_alerts DROP CONSTRAINT IF EXISTS dashboard_alerts_company_id_alert_type_entity_type_entity_i_key;
  SELECT jsonb_agg(jsonb_build_array(n.nspname,p.proname,p.oid::text,md5(p.prosrc),p.prosecdef,p.provolatile,p.proconfig,p.proacl::text) ORDER BY p.oid)
  INTO after_functions FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname IN ('public','gridex_quality','gridex_manual_inbound');
  IF before_functions IS DISTINCT FROM after_functions THEN
    RAISE EXCEPTION 'quality_cutover_function_metadata_changed';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid IN ('public.data_quality_issues'::regclass,'public.dashboard_alerts'::regclass)
      AND conname IN ('data_quality_issues_company_id_entity_type_entity_id_issue__key','dashboard_alerts_company_id_alert_type_entity_type_entity_i_key')) THEN
    RAISE EXCEPTION 'quality_cutover_legacy_constraint_remains';
  END IF;
END $cutover$;
COMMIT;
