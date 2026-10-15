-- PRIVATE bounded native-forward SOURCE proposal, NOT APPLIED and NOT a ledger claim.
-- Restore only the legal-name index policy of immutable20260930153118 (SHA4d4289746b256fab93c4523f13eb1b7ecd388525e26e36045fdc4c316b41cc08).
-- Original Jun11/Sep30/151412 SQL and source history remain unchanged.
-- Native may qualify exact both-index predecessor or exact desired absent-old replay.
-- No generated-expression change, new index, business rows/RPC, grant or CASCADE.
BEGIN;
SET LOCAL search_path=pg_catalog;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $actor_legal_name_forward$
DECLARE
 specs constant jsonb:=$registry_specs$[{"table":"public.platform_market_actors","column":"normalized_name","raw_column":"name","before":"lower(regexp_replace(COALESCE(name, ''::text), '\\\\s+'::text, ' '::text, 'g'::text))","after":"lower(regexp_replace(COALESCE(name, ''::text), '\\s+'::text, ' '::text, 'g'::text))","expression_sql":"lower(regexp_replace(COALESCE(name, ''::text), E'\\\\s+'::text, ' '::text, 'g'::text))","expected_relation":{"acl":"{postgres=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}","kind":"r","owner":"postgres","options":null,"tablespace":"0","persistence":"p","rowsecurity":true,"access_method":"2","forcerowsecurity":false,"replica_identity":"d"},"expected_target":{"catalog":{"attacl":null,"attlen":-1,"attnum":3,"attname":"normalized_name","attalign":"i","attbyval":false,"attndims":0,"atttypid":"25","atthasdef":true,"atttypmod":-1,"attislocal":true,"attnotnull":false,"attoptions":null,"attstorage":"x","attcacheoff":-1,"attidentity":"","attinhcount":0,"attcollation":"100","attgenerated":"s","attisdropped":false,"attfdwoptions":null,"atthasmissing":false,"attmissingval":null,"attstattarget":null,"attcompression":""},"type":"text"},"columns":[{"name":"id","type":"uuid","number":1,"generated":"","identity":"","not_null":true,"default":"gen_random_uuid()"},{"name":"name","type":"text","number":2,"generated":"","identity":"","not_null":true,"default":null},{"name":"normalized_name","type":"text","number":3,"generated":"s","identity":"","not_null":false,"default":null},{"name":"country_code","type":"text","number":4,"generated":"","identity":"","not_null":true,"default":"'SE'::text"},{"name":"org_number","type":"text","number":5,"generated":"","identity":"","not_null":false,"default":null},{"name":"legal_name","type":"text","number":6,"generated":"","identity":"","not_null":false,"default":null},{"name":"status","type":"text","number":7,"generated":"","identity":"","not_null":true,"default":"'active'::text"},{"name":"match_status","type":"text","number":8,"generated":"","identity":"","not_null":true,"default":"'needs_review'::text"},{"name":"source","type":"text","number":9,"generated":"","identity":"","not_null":true,"default":"'manual'::text"},{"name":"source_reference","type":"text","number":10,"generated":"","identity":"","not_null":false,"default":null},{"name":"visible_to_tenants","type":"boolean","number":11,"generated":"","identity":"","not_null":true,"default":"false"},{"name":"verified_at","type":"timestamp with time zone","number":12,"generated":"","identity":"","not_null":false,"default":null},{"name":"verified_by","type":"uuid","number":13,"generated":"","identity":"","not_null":false,"default":null},{"name":"metadata","type":"jsonb","number":14,"generated":"","identity":"","not_null":true,"default":"'{}'::jsonb"},{"name":"imported_at","type":"timestamp with time zone","number":15,"generated":"","identity":"","not_null":false,"default":null},{"name":"created_at","type":"timestamp with time zone","number":16,"generated":"","identity":"","not_null":true,"default":"now()"},{"name":"updated_at","type":"timestamp with time zone","number":17,"generated":"","identity":"","not_null":true,"default":"now()"},{"name":"not_seen_in_latest_import","type":"boolean","number":18,"generated":"","identity":"","not_null":true,"default":"false"},{"name":"last_seen_in_import_at","type":"timestamp with time zone","number":19,"generated":"","identity":"","not_null":false,"default":null},{"name":"registry_import_status","type":"text","number":20,"generated":"","identity":"","not_null":true,"default":"'unknown'::text"}],"unique_index":"platform_market_actors_normalized_name_uidx","unique_definition":"CREATE UNIQUE INDEX platform_market_actors_normalized_name_uidx ON public.platform_market_actors USING btree (normalized_name)","desired_indexes":[["platform_market_actors_pkey","CREATE UNIQUE INDEX platform_market_actors_pkey ON public.platform_market_actors USING btree (id)"],["platform_market_actors_import_seen_idx","CREATE INDEX platform_market_actors_import_seen_idx ON public.platform_market_actors USING btree (not_seen_in_latest_import, last_seen_in_import_at DESC)"],["platform_market_actors_normalized_name_search_idx","CREATE INDEX platform_market_actors_normalized_name_search_idx ON public.platform_market_actors USING btree (normalized_name)"],["platform_market_actors_org_idx","CREATE INDEX platform_market_actors_org_idx ON public.platform_market_actors USING btree (org_number) WHERE (org_number IS NOT NULL)"],["platform_market_actors_status_idx","CREATE INDEX platform_market_actors_status_idx ON public.platform_market_actors USING btree (status, match_status, visible_to_tenants)"]]},{"table":"public.platform_actor_aliases","column":"normalized_alias","raw_column":"alias","before":"lower(regexp_replace(COALESCE(alias, ''::text), '\\\\s+'::text, ' '::text, 'g'::text))","after":"lower(regexp_replace(COALESCE(alias, ''::text), '\\s+'::text, ' '::text, 'g'::text))","expression_sql":"lower(regexp_replace(COALESCE(alias, ''::text), E'\\\\s+'::text, ' '::text, 'g'::text))","expected_relation":{"acl":"{postgres=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}","kind":"r","owner":"postgres","options":null,"tablespace":"0","persistence":"p","rowsecurity":true,"access_method":"2","forcerowsecurity":false,"replica_identity":"d"},"expected_target":{"catalog":{"attacl":null,"attlen":-1,"attnum":4,"attname":"normalized_alias","attalign":"i","attbyval":false,"attndims":0,"atttypid":"25","atthasdef":true,"atttypmod":-1,"attislocal":true,"attnotnull":false,"attoptions":null,"attstorage":"x","attcacheoff":-1,"attidentity":"","attinhcount":0,"attcollation":"100","attgenerated":"s","attisdropped":false,"attfdwoptions":null,"atthasmissing":false,"attmissingval":null,"attstattarget":null,"attcompression":""},"type":"text"},"columns":[{"name":"id","type":"uuid","number":1,"generated":"","identity":"","not_null":true,"default":"gen_random_uuid()"},{"name":"actor_id","type":"uuid","number":2,"generated":"","identity":"","not_null":true,"default":null},{"name":"alias","type":"text","number":3,"generated":"","identity":"","not_null":true,"default":null},{"name":"normalized_alias","type":"text","number":4,"generated":"s","identity":"","not_null":false,"default":null},{"name":"alias_source","type":"text","number":5,"generated":"","identity":"","not_null":true,"default":"'system'::text"},{"name":"confidence","type":"numeric(5,4)","number":6,"generated":"","identity":"","not_null":true,"default":"1"},{"name":"is_verified","type":"boolean","number":7,"generated":"","identity":"","not_null":true,"default":"false"},{"name":"metadata","type":"jsonb","number":8,"generated":"","identity":"","not_null":true,"default":"'{}'::jsonb"},{"name":"created_at","type":"timestamp with time zone","number":9,"generated":"","identity":"","not_null":true,"default":"now()"},{"name":"updated_at","type":"timestamp with time zone","number":10,"generated":"","identity":"","not_null":true,"default":"now()"}],"unique_index":"platform_actor_aliases_uidx","unique_definition":"CREATE UNIQUE INDEX platform_actor_aliases_uidx ON public.platform_actor_aliases USING btree (actor_id, normalized_alias)","desired_indexes":[["platform_actor_aliases_pkey","CREATE UNIQUE INDEX platform_actor_aliases_pkey ON public.platform_actor_aliases USING btree (id)"],["platform_actor_aliases_lookup_idx","CREATE INDEX platform_actor_aliases_lookup_idx ON public.platform_actor_aliases USING btree (normalized_alias)"],["platform_actor_aliases_uidx","CREATE UNIQUE INDEX platform_actor_aliases_uidx ON public.platform_actor_aliases USING btree (actor_id, normalized_alias)"]]}]$registry_specs$::jsonb;
 spec jsonb; rel oid; obsolete oid; actors oid; aliases oid; actual jsonb; expr text;
 protected_before jsonb; protected_after jsonb;
 rows_before jsonb; rows_after jsonb;
 catalog_query constant text:=$protected_registry$
 WITH table_ids AS (SELECT unnest(ARRAY[$1::oid,$2::oid]) oid),
 protected_ids AS (
  SELECT oid FROM table_ids UNION SELECT i.indexrelid FROM pg_index i
  WHERE i.indrelid=ANY(ARRAY[$1::oid,$2::oid]) AND i.indexrelid<>$3::oid
 )
 SELECT jsonb_build_object(
  'namespace',(SELECT to_jsonb(n) FROM pg_namespace n WHERE n.oid='public'::regnamespace),
  'classes',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.oid) FROM pg_class c WHERE c.oid IN(SELECT oid FROM protected_ids)),
  'attributes',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attrelid,a.attnum) FROM pg_attribute a WHERE a.attrelid IN(SELECT oid FROM protected_ids)),
  'defaults',(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.oid) FROM pg_attrdef d WHERE d.adrelid IN(SELECT oid FROM table_ids)),
  'indexes',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.indexrelid) FROM pg_index i WHERE i.indrelid IN(SELECT oid FROM table_ids) AND i.indexrelid<>$3::oid),
  'constraints',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.oid) FROM pg_constraint c WHERE c.conrelid IN(SELECT oid FROM table_ids) OR c.confrelid IN(SELECT oid FROM table_ids)),
  'triggers',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) FROM pg_trigger t WHERE t.tgrelid IN(SELECT oid FROM table_ids)),
  'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_policy p WHERE p.polrelid IN(SELECT oid FROM table_ids)),
  'rewrites',(SELECT jsonb_agg(to_jsonb(w) ORDER BY w.oid) FROM pg_rewrite w WHERE w.ev_class IN(SELECT oid FROM table_ids)),
  'types',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) FROM pg_type t WHERE t.typrelid IN(SELECT oid FROM table_ids) OR t.typelem IN(SELECT c.reltype FROM pg_class c WHERE c.oid IN(SELECT oid FROM table_ids))),
  'dependencies',(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.classid,d.objid,d.objsubid,d.refclassid,d.refobjid,d.refobjsubid,d.deptype) FROM pg_depend d
   WHERE ((d.classid='pg_class'::regclass AND d.objid IN(SELECT oid FROM protected_ids)) OR (d.refclassid='pg_class'::regclass AND d.refobjid IN(SELECT oid FROM protected_ids)))
   AND NOT ((d.classid='pg_class'::regclass AND d.objid=$3::oid) OR (d.refclassid='pg_class'::regclass AND d.refobjid=$3::oid))),
  'shared_dependencies',(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.dbid,d.classid,d.objid,d.objsubid,d.refclassid,d.refobjid,d.deptype) FROM pg_shdepend d WHERE d.classid='pg_class'::regclass AND d.objid IN(SELECT oid FROM protected_ids))
 )
 $protected_registry$;
 row_query constant text:=$registry_rows$
 SELECT jsonb_build_object(
  'actors',(SELECT jsonb_build_object('count',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY id),''),'UTF8')),'hex')) FROM public.platform_market_actors t),
  'aliases',(SELECT jsonb_build_object('count',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY id),''),'UTF8')),'hex')) FROM public.platform_actor_aliases t)
 )
 $registry_rows$;
BEGIN
 IF current_user IS DISTINCT FROM 'postgres' OR session_user IS DISTINCT FROM 'postgres'
 OR current_setting('server_version_num')::integer<170000 OR current_setting('server_version_num')::integer>=180000
 THEN RAISE EXCEPTION 'actor_legal_name_forward_pg17_postgres_required'; END IF;
 -- The exact same lock order protects actors and their alias key before any snapshot/effect.
 LOCK TABLE public.platform_market_actors,public.platform_actor_aliases IN ACCESS EXCLUSIVE MODE;
 actors:=to_regclass('public.platform_market_actors'); aliases:=to_regclass('public.platform_actor_aliases');
 IF actors IS NULL OR aliases IS NULL THEN RAISE EXCEPTION 'actor_legal_name_forward_existing_relations_required'; END IF;
 obsolete:=coalesce(to_regclass('public.platform_market_actors_normalized_name_uidx')::oid,0::oid);
 FOR spec IN SELECT value FROM jsonb_array_elements(specs) LOOP
  rel:=to_regclass(spec->>'table');
  SELECT jsonb_build_object('owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,'kind',c.relkind,
   'persistence',c.relpersistence,'options',c.reloptions,'rowsecurity',c.relrowsecurity,
   'forcerowsecurity',c.relforcerowsecurity,'replica_identity',c.relreplident,
   'access_method',c.relam::text,'tablespace',c.reltablespace::text) INTO actual FROM pg_class c WHERE c.oid=rel;
  IF actual IS DISTINCT FROM spec->'expected_relation' THEN RAISE EXCEPTION 'actor_legal_name_forward_relation_unknown: %',spec->>'table'; END IF;
  SELECT jsonb_build_object('catalog',to_jsonb(a)-'attrelid','type',format_type(a.atttypid,a.atttypmod)) INTO actual
   FROM pg_attribute a WHERE a.attrelid=rel AND a.attname=spec->>'column' AND NOT a.attisdropped;
  IF actual IS DISTINCT FROM spec->'expected_target' THEN RAISE EXCEPTION 'actor_legal_name_forward_generated_column_unknown: %',spec->>'table'; END IF;
  SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'number',a.attnum,
   'generated',a.attgenerated,'identity',a.attidentity,'not_null',a.attnotnull,
   'default',CASE WHEN a.attname=spec->>'column' THEN NULL ELSE pg_get_expr(d.adbin,d.adrelid) END) ORDER BY a.attnum) INTO actual
   FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=rel AND a.attnum>0 AND NOT a.attisdropped;
  IF actual IS DISTINCT FROM spec->'columns' THEN RAISE EXCEPTION 'actor_legal_name_forward_columns_unknown: %',spec->>'table'; END IF;
  SELECT pg_get_expr(d.adbin,d.adrelid) INTO expr FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum WHERE a.attrelid=rel AND a.attname=spec->>'column';
  IF expr IS DISTINCT FROM spec->>'before' AND expr IS DISTINCT FROM spec->>'after' THEN RAISE EXCEPTION 'actor_legal_name_forward_expression_unknown: %',spec->>'table'; END IF;
  SELECT jsonb_agg(jsonb_build_array(ic.relname,pg_get_indexdef(i.indexrelid)) ORDER BY ic.relname COLLATE "C") INTO actual
   FROM pg_index i JOIN pg_class ic ON ic.oid=i.indexrelid WHERE i.indrelid=rel AND i.indexrelid<>obsolete;
  IF actual IS DISTINCT FROM (SELECT jsonb_agg(v ORDER BY (v->>0) COLLATE "C") FROM jsonb_array_elements(spec->'desired_indexes') v)
  THEN RAISE EXCEPTION 'actor_legal_name_forward_exact_desired_indexes_required: %',spec->>'table'; END IF;
 END LOOP;
 -- Every retained index must still be an ordinary, valid source-defined btree with no new capabilities.
 IF EXISTS(SELECT FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
  WHERE i.indrelid=ANY(ARRAY[actors,aliases]) AND i.indexrelid<>obsolete
   AND (c.relnamespace IS DISTINCT FROM 'public'::regnamespace OR c.relkind IS DISTINCT FROM 'i'::"char"
    OR c.relpersistence IS DISTINCT FROM 'p'::"char" OR c.relowner IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname='postgres')
    OR c.relacl IS NOT NULL OR c.reloptions IS NOT NULL OR c.reltablespace IS DISTINCT FROM 0::oid
    OR c.relam IS DISTINCT FROM (SELECT oid FROM pg_am WHERE amname='btree') OR c.relispartition
    OR NOT i.indisvalid OR NOT i.indisready OR NOT i.indislive OR NOT i.indimmediate
    OR i.indisexclusion OR i.indisclustered OR i.indisreplident OR i.indnullsnotdistinct OR i.indcheckxmin))
 THEN RAISE EXCEPTION 'actor_legal_name_forward_retained_index_metadata_unknown'; END IF;
 -- Pin exact canonical nonunique search index mechanics, not only its display definition.
 IF NOT EXISTS(SELECT FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
  WHERE c.oid='public.platform_market_actors_normalized_name_search_idx'::regclass
   AND i.indrelid=actors AND c.relnamespace='public'::regnamespace AND c.relkind='i' AND c.relpersistence='p'
   AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname='postgres') AND c.relacl IS NULL AND c.reloptions IS NULL AND c.reltablespace=0
   AND c.relam=(SELECT oid FROM pg_am WHERE amname='btree') AND NOT c.relispartition
   AND NOT i.indisunique AND NOT i.indisprimary AND NOT i.indisexclusion AND NOT i.indisclustered AND NOT i.indisreplident
   AND i.indisvalid AND i.indisready AND i.indislive AND i.indimmediate AND NOT i.indnullsnotdistinct AND NOT i.indcheckxmin
   AND i.indnatts=1 AND i.indnkeyatts=1 AND i.indkey='3'::int2vector AND i.indoption='0'::int2vector
   AND i.indcollation=ARRAY['"default"'::regcollation::oid]::oidvector
   AND i.indclass=ARRAY[(SELECT oid FROM pg_opclass WHERE opcnamespace='pg_catalog'::regnamespace AND opcname='text_ops' AND opcmethod=(SELECT oid FROM pg_am WHERE amname='btree'))]::oidvector
   AND i.indexprs IS NULL AND i.indpred IS NULL
   AND pg_get_indexdef(i.indexrelid)='CREATE INDEX platform_market_actors_normalized_name_search_idx ON public.platform_market_actors USING btree (normalized_name)')
 THEN RAISE EXCEPTION 'actor_legal_name_forward_exact_nonunique_search_required'; END IF;
 IF NOT EXISTS(SELECT FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE c.oid='public.platform_actor_aliases_uidx'::regclass AND i.indrelid=aliases
  AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname='postgres') AND c.relacl IS NULL AND c.reloptions IS NULL
  AND i.indisunique AND i.indisvalid AND i.indisready AND i.indislive AND i.indimmediate
  AND NOT i.indisprimary AND NOT i.indisexclusion AND NOT i.indnullsnotdistinct
  AND i.indpred IS NULL AND i.indexprs IS NULL AND i.indnatts=2 AND i.indnkeyatts=2 AND i.indkey='2 4'::int2vector
  AND pg_get_indexdef(i.indexrelid)='CREATE UNIQUE INDEX platform_actor_aliases_uidx ON public.platform_actor_aliases USING btree (actor_id, normalized_alias)')
 THEN RAISE EXCEPTION 'actor_legal_name_forward_exact_unique_alias_key_required'; END IF;
 IF obsolete<>0 THEN
  IF NOT EXISTS(SELECT FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
   WHERE i.indexrelid=obsolete AND i.indrelid=actors AND c.relnamespace='public'::regnamespace
    AND c.relkind='i' AND c.relpersistence='p' AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname='postgres')
    AND c.relacl IS NULL AND c.reloptions IS NULL AND c.reltablespace=0 AND c.relam=(SELECT oid FROM pg_am WHERE amname='btree') AND NOT c.relispartition
    AND i.indisunique AND NOT i.indisprimary AND NOT i.indisexclusion AND NOT i.indisclustered AND NOT i.indisreplident
    AND i.indisvalid AND i.indisready AND i.indislive AND i.indimmediate AND NOT i.indnullsnotdistinct AND NOT i.indcheckxmin
    AND i.indnatts=1 AND i.indnkeyatts=1 AND i.indkey='3'::int2vector AND i.indoption='0'::int2vector
    AND i.indcollation=ARRAY['"default"'::regcollation::oid]::oidvector
    AND i.indclass=ARRAY[(SELECT oid FROM pg_opclass WHERE opcnamespace='pg_catalog'::regnamespace AND opcname='text_ops' AND opcmethod=(SELECT oid FROM pg_am WHERE amname='btree'))]::oidvector
    AND i.indexprs IS NULL AND i.indpred IS NULL
    AND pg_get_indexdef(i.indexrelid)='CREATE UNIQUE INDEX platform_market_actors_normalized_name_uidx ON public.platform_market_actors USING btree (normalized_name)')
  THEN RAISE EXCEPTION 'actor_legal_name_forward_retired_index_unknown'; END IF;
  IF EXISTS(SELECT FROM pg_constraint WHERE conindid=obsolete)
   OR EXISTS(SELECT FROM pg_depend WHERE refclassid='pg_class'::regclass AND refobjid=obsolete)
   OR EXISTS(SELECT FROM pg_depend WHERE classid='pg_class'::regclass AND objid=obsolete AND deptype='e')
  THEN RAISE EXCEPTION 'actor_legal_name_forward_retired_index_dependency_unknown'; END IF;
 END IF;
 EXECUTE catalog_query INTO protected_before USING actors,aliases,obsolete;
 EXECUTE row_query INTO rows_before;
 IF obsolete<>0 THEN DROP INDEX public.platform_market_actors_normalized_name_uidx RESTRICT; END IF;
 IF to_regclass('public.platform_market_actors_normalized_name_uidx') IS NOT NULL THEN RAISE EXCEPTION 'actor_legal_name_forward_retired_index_remains'; END IF;
 EXECUTE catalog_query INTO protected_after USING actors,aliases,obsolete;
 EXECUTE row_query INTO rows_after;
 IF protected_after IS DISTINCT FROM protected_before THEN RAISE EXCEPTION 'actor_legal_name_forward_complete_protected_catalog_changed'; END IF;
 IF rows_after IS DISTINCT FROM rows_before THEN RAISE EXCEPTION 'actor_legal_name_forward_all_original_rows_changed'; END IF;
END $actor_legal_name_forward$;
COMMIT;
