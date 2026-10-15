-- Prospective correction of two STORED whitespace-derived actor registry columns.
-- All original fields, UUIDs and source receipts remain unchanged. Existing unique
-- keys are retained; collision checks occur under ACCESS EXCLUSIVE locks.
-- Exact native aggregate qualification: 649 actors/647 aliases, zero collisions,
-- zero current derived values changing. Counts are evidence, not replay guards.
BEGIN;
SET LOCAL search_path=pg_catalog;
SET LOCAL standard_conforming_strings=on;
DO $generated_actor_normalizers$
DECLARE
 config jsonb := $normalizer_contracts$[{"table":"public.platform_market_actors","column":"normalized_name","raw_column":"name","before":"lower(regexp_replace(COALESCE(name, ''::text), '\\\\s+'::text, ' '::text, 'g'::text))","after":"lower(regexp_replace(COALESCE(name, ''::text), '\\s+'::text, ' '::text, 'g'::text))","expression_sql":"lower(regexp_replace(COALESCE(name, ''::text), E'\\\\s+'::text, ' '::text, 'g'::text))","expected_relation":{"acl":"{postgres=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}","kind":"r","owner":"postgres","options":null,"tablespace":"0","persistence":"p","rowsecurity":true,"access_method":"2","forcerowsecurity":false,"replica_identity":"d"},"expected_target":{"catalog":{"attacl":null,"attlen":-1,"attnum":3,"attname":"normalized_name","attalign":"i","attbyval":false,"attndims":0,"atttypid":"25","atthasdef":true,"atttypmod":-1,"attislocal":true,"attnotnull":false,"attoptions":null,"attstorage":"x","attcacheoff":-1,"attidentity":"","attinhcount":0,"attcollation":"100","attgenerated":"s","attisdropped":false,"attfdwoptions":null,"atthasmissing":false,"attmissingval":null,"attstattarget":null,"attcompression":""},"type":"text"},"columns":[{"name":"id","type":"uuid","number":1,"generated":"","identity":"","not_null":true,"default":"gen_random_uuid()"},{"name":"name","type":"text","number":2,"generated":"","identity":"","not_null":true,"default":null},{"name":"normalized_name","type":"text","number":3,"generated":"s","identity":"","not_null":false,"default":null},{"name":"country_code","type":"text","number":4,"generated":"","identity":"","not_null":true,"default":"'SE'::text"},{"name":"org_number","type":"text","number":5,"generated":"","identity":"","not_null":false,"default":null},{"name":"legal_name","type":"text","number":6,"generated":"","identity":"","not_null":false,"default":null},{"name":"status","type":"text","number":7,"generated":"","identity":"","not_null":true,"default":"'active'::text"},{"name":"match_status","type":"text","number":8,"generated":"","identity":"","not_null":true,"default":"'needs_review'::text"},{"name":"source","type":"text","number":9,"generated":"","identity":"","not_null":true,"default":"'manual'::text"},{"name":"source_reference","type":"text","number":10,"generated":"","identity":"","not_null":false,"default":null},{"name":"visible_to_tenants","type":"boolean","number":11,"generated":"","identity":"","not_null":true,"default":"false"},{"name":"verified_at","type":"timestamp with time zone","number":12,"generated":"","identity":"","not_null":false,"default":null},{"name":"verified_by","type":"uuid","number":13,"generated":"","identity":"","not_null":false,"default":null},{"name":"metadata","type":"jsonb","number":14,"generated":"","identity":"","not_null":true,"default":"'{}'::jsonb"},{"name":"imported_at","type":"timestamp with time zone","number":15,"generated":"","identity":"","not_null":false,"default":null},{"name":"created_at","type":"timestamp with time zone","number":16,"generated":"","identity":"","not_null":true,"default":"now()"},{"name":"updated_at","type":"timestamp with time zone","number":17,"generated":"","identity":"","not_null":true,"default":"now()"},{"name":"not_seen_in_latest_import","type":"boolean","number":18,"generated":"","identity":"","not_null":true,"default":"false"},{"name":"last_seen_in_import_at","type":"timestamp with time zone","number":19,"generated":"","identity":"","not_null":false,"default":null},{"name":"registry_import_status","type":"text","number":20,"generated":"","identity":"","not_null":true,"default":"'unknown'::text"}],"unique_index":"platform_market_actors_normalized_name_uidx","unique_definition":"CREATE UNIQUE INDEX platform_market_actors_normalized_name_uidx ON public.platform_market_actors USING btree (normalized_name)"},{"table":"public.platform_actor_aliases","column":"normalized_alias","raw_column":"alias","before":"lower(regexp_replace(COALESCE(alias, ''::text), '\\\\s+'::text, ' '::text, 'g'::text))","after":"lower(regexp_replace(COALESCE(alias, ''::text), '\\s+'::text, ' '::text, 'g'::text))","expression_sql":"lower(regexp_replace(COALESCE(alias, ''::text), E'\\\\s+'::text, ' '::text, 'g'::text))","expected_relation":{"acl":"{postgres=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}","kind":"r","owner":"postgres","options":null,"tablespace":"0","persistence":"p","rowsecurity":true,"access_method":"2","forcerowsecurity":false,"replica_identity":"d"},"expected_target":{"catalog":{"attacl":null,"attlen":-1,"attnum":4,"attname":"normalized_alias","attalign":"i","attbyval":false,"attndims":0,"atttypid":"25","atthasdef":true,"atttypmod":-1,"attislocal":true,"attnotnull":false,"attoptions":null,"attstorage":"x","attcacheoff":-1,"attidentity":"","attinhcount":0,"attcollation":"100","attgenerated":"s","attisdropped":false,"attfdwoptions":null,"atthasmissing":false,"attmissingval":null,"attstattarget":null,"attcompression":""},"type":"text"},"columns":[{"name":"id","type":"uuid","number":1,"generated":"","identity":"","not_null":true,"default":"gen_random_uuid()"},{"name":"actor_id","type":"uuid","number":2,"generated":"","identity":"","not_null":true,"default":null},{"name":"alias","type":"text","number":3,"generated":"","identity":"","not_null":true,"default":null},{"name":"normalized_alias","type":"text","number":4,"generated":"s","identity":"","not_null":false,"default":null},{"name":"alias_source","type":"text","number":5,"generated":"","identity":"","not_null":true,"default":"'system'::text"},{"name":"confidence","type":"numeric(5,4)","number":6,"generated":"","identity":"","not_null":true,"default":"1"},{"name":"is_verified","type":"boolean","number":7,"generated":"","identity":"","not_null":true,"default":"false"},{"name":"metadata","type":"jsonb","number":8,"generated":"","identity":"","not_null":true,"default":"'{}'::jsonb"},{"name":"created_at","type":"timestamp with time zone","number":9,"generated":"","identity":"","not_null":true,"default":"now()"},{"name":"updated_at","type":"timestamp with time zone","number":10,"generated":"","identity":"","not_null":true,"default":"now()"}],"unique_index":"platform_actor_aliases_uidx","unique_definition":"CREATE UNIQUE INDEX platform_actor_aliases_uidx ON public.platform_actor_aliases USING btree (actor_id, normalized_alias)"}]$normalizer_contracts$::jsonb;
 spec jsonb;
 relation_id oid;
 actual jsonb;
 before_catalog jsonb;
 after_catalog jsonb;
 before_originals jsonb;
 after_originals jsonb;
 expression_before text;
 expression_after text;
 collision_count bigint;
 mismatch_count bigint;
 dependent_index_names text[];
 dependent_after_names text[];
 catalog_query text := $protected_actor_catalog$SELECT jsonb_build_object('relation',jsonb_build_object('oid',c.oid,'owner',c.relowner,'acl',c.relacl,'kind',c.relkind,'persistence',c.relpersistence,'options',c.reloptions,'rowsecurity',c.relrowsecurity,'forcerowsecurity',c.relforcerowsecurity,'replica_identity',c.relreplident,'access_method',c.relam,'tablespace',c.reltablespace),
 'columns',(SELECT jsonb_agg(jsonb_build_object('catalog',CASE WHEN c.oid=to_regclass('public.platform_market_actors') AND a.attname IN('not_seen_in_latest_import','registry_import_status') THEN to_jsonb(a)-'atthasmissing'-'attmissingval' ELSE to_jsonb(a) END,'default',CASE WHEN a.attname=$1 THEN NULL ELSE pg_get_expr(d.adbin,d.adrelid) END) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0),
 'indexes',(SELECT jsonb_agg(jsonb_build_object('catalog',CASE WHEN ic.relnamespace=c.relnamespace AND ic.relname::text=ANY($3) THEN to_jsonb(i)-'indexrelid' ELSE to_jsonb(i) END,'schema',ic.relnamespace,'definition',pg_get_indexdef(i.indexrelid),'owner',ic.relowner,'acl',ic.relacl,'name',ic.relname,'options',ic.reloptions,'access_method',ic.relam,'tablespace',ic.reltablespace) ORDER BY ic.relnamespace,ic.relname) FROM pg_index i JOIN pg_class ic ON ic.oid=i.indexrelid WHERE i.indrelid=c.oid),
 'constraints',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.oid) FROM pg_constraint x WHERE x.conrelid=c.oid),
 'triggers',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) FROM pg_trigger t WHERE t.tgrelid=c.oid),
 'policies',(SELECT jsonb_agg(to_jsonb(po) ORDER BY po.oid) FROM pg_policy po WHERE po.polrelid=c.oid)) FROM pg_class c WHERE c.oid=$2$protected_actor_catalog$;
BEGIN
 IF current_setting('server_version_num')::integer<170000 THEN
  RAISE EXCEPTION 'generated_actor_normalizers_postgresql17_required'; END IF;
 -- One explicit order protects both unique keys and prevents concurrent registry writes.
 LOCK TABLE public.platform_market_actors,public.platform_actor_aliases IN ACCESS EXCLUSIVE MODE;
 FOR spec IN SELECT value FROM jsonb_array_elements(config) LOOP
  relation_id:=to_regclass(spec->>'table');
  IF relation_id IS NULL THEN RAISE EXCEPTION 'generated_actor_normalizers_table_missing'; END IF;
  SELECT jsonb_build_object('owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,'kind',c.relkind,
   'persistence',c.relpersistence,'options',c.reloptions,'rowsecurity',c.relrowsecurity,
   'forcerowsecurity',c.relforcerowsecurity,'replica_identity',c.relreplident,
   'access_method',c.relam::text,'tablespace',c.reltablespace::text)
   INTO actual FROM pg_class c WHERE c.oid=relation_id;
  IF actual IS DISTINCT FROM spec->'expected_relation' THEN
   RAISE EXCEPTION 'generated_actor_normalizers_relation_attributes_changed_requires_review: %',spec->>'table'; END IF;
  SELECT jsonb_build_object('catalog',to_jsonb(a)-'attrelid','type',format_type(a.atttypid,a.atttypmod))
   INTO actual FROM pg_attribute a WHERE a.attrelid=relation_id AND a.attname=spec->>'column' AND NOT a.attisdropped;
  IF actual IS DISTINCT FROM spec->'expected_target' THEN
   RAISE EXCEPTION 'generated_actor_normalizers_column_attributes_changed_requires_review: %',spec->>'table'; END IF;
  SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
   'number',a.attnum,'generated',a.attgenerated,'identity',a.attidentity,'not_null',a.attnotnull,
   'default',CASE WHEN a.attname=spec->>'column' THEN NULL ELSE pg_get_expr(d.adbin,d.adrelid) END) ORDER BY a.attnum)
   INTO actual FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=relation_id AND a.attnum>0 AND NOT a.attisdropped;
  IF actual IS DISTINCT FROM spec->'columns' THEN
   RAISE EXCEPTION 'generated_actor_normalizers_original_columns_changed_requires_review: %',spec->>'table'; END IF;
  IF NOT EXISTS(SELECT FROM pg_index i JOIN pg_class ic ON ic.oid=i.indexrelid
   WHERE i.indrelid=relation_id AND ic.relname=spec->>'unique_index' AND i.indisunique AND i.indisvalid AND i.indisready
    AND i.indpred IS NULL AND pg_get_indexdef(i.indexrelid)=spec->>'unique_definition') THEN
   RAISE EXCEPTION 'generated_actor_normalizers_original_unique_key_changed: %',spec->>'table'; END IF;
  SELECT pg_get_expr(d.adbin,d.adrelid) INTO expression_before FROM pg_attrdef d
   JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
   WHERE a.attrelid=relation_id AND a.attname=spec->>'column';
  IF expression_before IS DISTINCT FROM spec->>'before' AND expression_before IS DISTINCT FROM spec->>'after' THEN
   RAISE EXCEPTION 'generated_actor_normalizers_unknown_expression: %',spec->>'table'; END IF;
  -- PG17 materializes two genuine historical fast-default storage artifacts.
  -- Their logical defaults and every original field remain exact; reject any
  -- other missing-value state before allowing this physical-only normalization.
  IF spec->>'raw_column'='name' AND EXISTS(SELECT FROM pg_attribute a
   WHERE a.attrelid=relation_id AND a.attname IN('not_seen_in_latest_import','registry_import_status')
    AND NOT ((NOT a.atthasmissing AND a.attmissingval IS NULL)
      OR (a.atthasmissing AND to_jsonb(a.attmissingval)=CASE WHEN a.attname='not_seen_in_latest_import'
          THEN '[false]'::jsonb ELSE '["unknown"]'::jsonb END))) THEN
   RAISE EXCEPTION 'generated_actor_normalizers_unknown_fast_default_storage_state'; END IF;
  -- PostgreSQL17 rebuilds indexes genuinely dependent on the changed column.
  -- Derive the exact allowed set from pg_depend, retaining every logical field
  -- and every unrelated OID. No index is dropped/renamed or weakened by us.
  SELECT array_agg(DISTINCT ic.relname::text ORDER BY ic.relname::text)
   INTO dependent_index_names FROM pg_depend dep JOIN pg_index i ON i.indexrelid=dep.objid
   JOIN pg_class ic ON ic.oid=i.indexrelid JOIN pg_attribute a ON a.attrelid=i.indrelid
   WHERE dep.classid='pg_class'::regclass AND dep.refclassid='pg_class'::regclass
    AND dep.refobjid=relation_id AND dep.refobjsubid=a.attnum AND i.indrelid=relation_id
    AND a.attname=spec->>'column';
  IF dependent_index_names IS NULL OR NOT (spec->>'unique_index'=ANY(dependent_index_names)) THEN
   RAISE EXCEPTION 'generated_actor_normalizers_generated_unique_dependency_required'; END IF;
  EXECUTE catalog_query INTO before_catalog USING spec->>'column',relation_id,dependent_index_names;
  EXECUTE format('SELECT jsonb_build_object(''count'',count(*),''sha256'',encode(sha256(convert_to(coalesce(string_agg((to_jsonb(t)-%L)::text,E''\n'' ORDER BY id),''''),''UTF8'')),''hex'')) FROM %s t',spec->>'column',spec->>'table') INTO before_originals;
  IF spec->>'raw_column'='name' THEN
   SELECT count(*) INTO collision_count FROM(SELECT lower(regexp_replace(coalesce(name,''),E'\\s+',' ','g'))
    FROM public.platform_market_actors GROUP BY 1 HAVING count(*)>1) collisions;
  ELSE
   SELECT count(*) INTO collision_count FROM(SELECT actor_id,lower(regexp_replace(coalesce(alias,''),E'\\s+',' ','g'))
    FROM public.platform_actor_aliases GROUP BY 1,2 HAVING count(*)>1) collisions;
  END IF;
  IF collision_count<>0 THEN
   RAISE EXCEPTION 'generated_actor_normalizers_corrected_unique_key_collision: %',spec->>'table'; END IF;
  IF expression_before=spec->>'before' THEN
   EXECUTE format('ALTER TABLE %s ALTER COLUMN %I SET EXPRESSION AS (%s)',spec->>'table',spec->>'column',spec->>'expression_sql');
  END IF;
  SELECT pg_get_expr(d.adbin,d.adrelid) INTO expression_after FROM pg_attrdef d
   JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
   WHERE a.attrelid=relation_id AND a.attname=spec->>'column';
  IF expression_after IS DISTINCT FROM spec->>'after' THEN
   RAISE EXCEPTION 'generated_actor_normalizers_correct_expression_required: %',spec->>'table'; END IF;
  EXECUTE format('SELECT count(*) FROM %s WHERE %I IS DISTINCT FROM (%s)',spec->>'table',spec->>'column',spec->>'expression_sql') INTO mismatch_count;
  IF mismatch_count<>0 THEN RAISE EXCEPTION 'generated_actor_normalizers_stored_values_not_correct'; END IF;
  SELECT array_agg(DISTINCT ic.relname::text ORDER BY ic.relname::text)
   INTO dependent_after_names FROM pg_depend dep JOIN pg_index i ON i.indexrelid=dep.objid
   JOIN pg_class ic ON ic.oid=i.indexrelid JOIN pg_attribute a ON a.attrelid=i.indrelid
   WHERE dep.classid='pg_class'::regclass AND dep.refclassid='pg_class'::regclass
    AND dep.refobjid=relation_id AND dep.refobjsubid=a.attnum AND i.indrelid=relation_id
    AND a.attname=spec->>'column';
  IF dependent_after_names IS DISTINCT FROM dependent_index_names THEN
   RAISE EXCEPTION 'generated_actor_normalizers_generated_index_dependency_set_changed'; END IF;
  EXECUTE catalog_query INTO after_catalog USING spec->>'column',relation_id,dependent_index_names;
  IF after_catalog IS DISTINCT FROM before_catalog THEN
   RAISE EXCEPTION 'generated_actor_normalizers_protected_catalog_changed: %',spec->>'table'; END IF;
  EXECUTE format('SELECT jsonb_build_object(''count'',count(*),''sha256'',encode(sha256(convert_to(coalesce(string_agg((to_jsonb(t)-%L)::text,E''\n'' ORDER BY id),''''),''UTF8'')),''hex'')) FROM %s t',spec->>'column',spec->>'table') INTO after_originals;
  IF after_originals IS DISTINCT FROM before_originals THEN
   RAISE EXCEPTION 'generated_actor_normalizers_original_rows_changed: %',spec->>'table'; END IF;
 END LOOP;
END;
$generated_actor_normalizers$;
COMMIT;
