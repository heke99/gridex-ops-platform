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
  IF (SELECT count(*)
      FROM (VALUES
        ('public.data_quality_issues','public.data_quality_issues_open_key_uidx'),
        ('public.dashboard_alerts','public.dashboard_alerts_open_key_uidx')
      ) wanted(table_name,index_name)
      JOIN pg_class c ON c.oid=to_regclass(wanted.index_name)
      JOIN pg_index i ON i.indexrelid=c.oid
      JOIN pg_am am ON am.oid=c.relam
      WHERE c.relkind='i' AND am.amname='btree'
        AND i.indrelid=wanted.table_name::regclass
        AND i.indisunique AND i.indisvalid AND i.indisready AND i.indislive
        AND i.indimmediate AND NOT i.indisexclusion AND NOT i.indnullsnotdistinct
        AND i.indnkeyatts=2 AND i.indnatts=2
        AND i.indexprs IS NULL AND i.indpred IS NULL
        AND ARRAY(SELECT a.attname::text
          FROM unnest(i.indkey) WITH ORDINALITY k(attnum,n)
          JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum
          ORDER BY k.n)=ARRAY['company_id','open_key']::text[]
     ) <> 2 THEN
    RAISE EXCEPTION 'quality_cutover_open_key_index_unqualified';
  END IF;
  IF EXISTS (SELECT 1
      FROM (VALUES
        ('public.data_quality_issues','data_quality_issues_company_id_entity_type_entity_id_issue__key',
         ARRAY['company_id','entity_type','entity_id','issue_type','status']::text[]),
        ('public.dashboard_alerts','dashboard_alerts_company_id_alert_type_entity_type_entity_i_key',
         ARRAY['company_id','alert_type','entity_type','entity_id','status']::text[])
      ) wanted(table_name,constraint_name,key_columns)
      JOIN pg_constraint c ON c.conrelid=wanted.table_name::regclass AND c.conname=wanted.constraint_name
      LEFT JOIN pg_index i ON i.indexrelid=c.conindid
      WHERE c.contype<>'u' OR c.condeferrable OR c.condeferred OR NOT c.convalidated
        OR i.indexrelid IS NULL OR i.indnullsnotdistinct
        OR ARRAY(SELECT a.attname::text
          FROM unnest(c.conkey) WITH ORDINALITY k(attnum,n)
          JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
          ORDER BY k.n) IS DISTINCT FROM wanted.key_columns
     ) THEN
    RAISE EXCEPTION 'quality_cutover_legacy_constraint_unqualified';
  END IF;
  SELECT jsonb_agg(jsonb_build_array(n.nspname,to_jsonb(p),obj_description(p.oid,'pg_proc')) ORDER BY p.oid)
  INTO before_functions FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname IN ('public','gridex_quality','gridex_manual_inbound');
  ALTER TABLE public.data_quality_issues DROP CONSTRAINT IF EXISTS data_quality_issues_company_id_entity_type_entity_id_issue__key;
  ALTER TABLE public.dashboard_alerts DROP CONSTRAINT IF EXISTS dashboard_alerts_company_id_alert_type_entity_type_entity_i_key;
  SELECT jsonb_agg(jsonb_build_array(n.nspname,to_jsonb(p),obj_description(p.oid,'pg_proc')) ORDER BY p.oid)
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
