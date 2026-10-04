-- Mandatory native guard. Includes the qualified forward without changing bytes;
-- all synthetic rows and temporary objects are discarded by the final rollback.
\set ON_ERROR_STOP on
\getenv staff_retention_read_sql GRIDEX_STAFF_CUSTOMER_RETENTION_READ_SQL
\if :{?staff_retention_read_sql}
\else
  \echo 'GRIDEX_STAFF_CUSTOMER_RETENTION_READ_SQL is required'
  \quit 1
\endif
BEGIN;
CREATE FUNCTION pg_temp.staff_retention_catalog() RETURNS jsonb
LANGUAGE sql SET search_path=pg_catalog AS $$
SELECT jsonb_build_object(
 'schema',(SELECT to_jsonb(n) FROM pg_namespace n WHERE nspname='gridex_ediel_retention'),
 'owner',(SELECT to_jsonb(r) FROM pg_roles r WHERE rolname='gridex_ediel_retention_owner'),
 'members',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.member,m.grantor) FROM pg_auth_members m WHERE roleid=to_regrole('gridex_ediel_retention_owner')),
 'databaseAcl',(SELECT to_jsonb(d.datacl) FROM pg_database d WHERE datname=current_database()),
 'publicAcl',(SELECT to_jsonb(n.nspacl) FROM pg_namespace n WHERE nspname='public'),
 'customersAcl',(SELECT to_jsonb(c.relacl) FROM pg_class c WHERE oid='public.customers'::regclass),
 'rpc',(SELECT to_jsonb(p) FROM pg_proc p WHERE oid=to_regprocedure('public.ediel_customer_record_tombstones_v1(uuid,uuid)')),
 'relations',(SELECT jsonb_agg(jsonb_build_object('relation',to_jsonb(c),
   'columns',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
   'constraints',(SELECT jsonb_agg(to_jsonb(k) ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid=c.oid),
   'triggers',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal)) ORDER BY c.relname)
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='gridex_ediel_retention'));
$$;
CREATE TEMP TABLE staff_retention_before AS SELECT pg_temp.staff_retention_catalog() AS catalog;
-- Disposable native absence rehearsal: preserve every canonical object by OID.
-- These names/roles/grants exist only inside this savepoint and outer rollback.
SAVEPOINT staff_retention_absent;
ALTER ROLE gridex_ediel_retention_owner RENAME TO staff_retention_native_original_owner;
ALTER SCHEMA gridex_ediel_retention RENAME TO staff_retention_native_original_schema;
ALTER FUNCTION public.ediel_customer_record_tombstones_v1(uuid,uuid) RENAME TO staff_retention_native_original_reader;
CREATE ROLE staff_retention_native_migration NOLOGIN NOINHERIT CREATEROLE BYPASSRLS;
GRANT staff_retention_native_migration TO CURRENT_USER WITH INHERIT FALSE,SET TRUE;
GRANT USAGE ON SCHEMA public,auth,gridex_received_sources TO staff_retention_native_migration WITH GRANT OPTION;
GRANT CREATE ON SCHEMA public TO staff_retention_native_migration WITH GRANT OPTION;
GRANT SELECT,UPDATE ON public.customers TO staff_retention_native_migration WITH GRANT OPTION;
GRANT REFERENCES ON public.companies,public.customers,public.customer_contracts,auth.users TO staff_retention_native_migration;
GRANT EXECUTE ON FUNCTION gridex_received_sources.reject_mutation() TO staff_retention_native_migration;
DO $$ BEGIN EXECUTE format('GRANT CREATE ON DATABASE %I TO staff_retention_native_migration WITH GRANT OPTION',current_database()); END $$;
SET LOCAL ROLE staff_retention_native_migration;
\i :staff_retention_read_sql
DO $$ BEGIN
 IF current_user<>'staff_retention_native_migration'
  OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND NOT rolsuper AND rolcreaterole AND rolbypassrls)
  OR has_database_privilege('gridex_ediel_retention_owner',current_database(),'CREATE')
  OR has_schema_privilege('gridex_ediel_retention_owner','public','CREATE')
  OR has_function_privilege('anon','public.ediel_customer_record_tombstones_v1(uuid,uuid)','EXECUTE')
  OR has_function_privilege('authenticated','public.ediel_customer_record_tombstones_v1(uuid,uuid)','EXECUTE')
  OR NOT has_function_privilege('service_role','public.ediel_customer_record_tombstones_v1(uuid,uuid)','EXECUTE') THEN
  RAISE EXCEPTION 'nonsuper absence source, restored receiver, transient grant or RPC ACL failed';
 END IF;
END $$;
RESET ROLE;
ROLLBACK TO SAVEPOINT staff_retention_absent;
RELEASE SAVEPOINT staff_retention_absent;
\i :staff_retention_read_sql
DO $$ BEGIN
 IF (SELECT catalog FROM pg_temp.staff_retention_before) IS DISTINCT FROM pg_temp.staff_retention_catalog() THEN
  RAISE EXCEPTION 'existing canonical retention read prerequisite must be a catalog no-op';
 END IF;
END $$;

CREATE TEMP TABLE staff_retention_fixture AS SELECT
 gen_random_uuid() AS company,gen_random_uuid() AS other_company,
 gen_random_uuid() AS customer,gen_random_uuid() AS other_customer,
 gen_random_uuid() AS actor,gen_random_uuid() AS target,gen_random_uuid() AS other_target;
DO $$
DECLARE f record; result jsonb; denied boolean; table_name text;
BEGIN
 SELECT * INTO f FROM pg_temp.staff_retention_fixture;
 INSERT INTO public.companies(id,name,status) VALUES
  (f.company,'Synthetic staff retention read A','active'),(f.other_company,'Synthetic staff retention read B','active');
 INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_anonymous)
 VALUES(f.actor,'authenticated','authenticated',f.actor::text||'@example.invalid','{}','{}',now(),now(),false);
 INSERT INTO public.customers(id,company_id,customer_type,status,full_name) VALUES
  (f.customer,f.company,'private','draft','Synthetic staff retention A'),
  (f.other_customer,f.other_company,'private','draft','Synthetic staff retention B');
 IF public.ediel_customer_record_tombstones_v1(f.company,f.customer)<>'[]'::jsonb THEN RAISE EXCEPTION 'empty native tombstone array required'; END IF;
 INSERT INTO gridex_ediel_retention.record_decisions(id,company_id,retention_class,target_id,customer_id,source_hash,target_hash,document_bytes,document_hash,submitted_by)
 VALUES(f.target,f.company,'customer_address_history',f.target,f.customer,repeat('a',64),repeat('b',64),'a'::bytea,encode(sha256('a'::bytea),'hex'),f.actor),
  (f.other_target,f.other_company,'customer_address_history',f.other_target,f.other_customer,repeat('c',64),repeat('d',64),'b'::bytea,encode(sha256('b'::bytea),'hex'),f.actor);
 INSERT INTO gridex_ediel_retention.record_reviews(id,decision_id,actor_user_id,outcome,reason)
 VALUES(f.target,f.target,f.actor,'approved','Synthetic native proof'),(f.other_target,f.other_target,f.actor,'approved','Synthetic native proof');
 INSERT INTO gridex_ediel_retention.record_tombstones(retention_class,target_id,company_id,customer_id,decision_id,review_id,source_hash,target_hash,byte_length,actor_user_id,journal_retain_until,journal_purpose_reference)
 VALUES('customer_address_history',f.target,f.company,f.customer,f.target,f.target,repeat('a',64),repeat('b',64),1,f.actor,'2030-01-01Z','Synthetic native proof'),
  ('customer_address_history',f.other_target,f.other_company,f.other_customer,f.other_target,f.other_target,repeat('c',64),repeat('d',64),1,f.actor,'2030-01-01Z','Synthetic native proof');
 result:=public.ediel_customer_record_tombstones_v1(f.company,f.customer);
 IF jsonb_array_length(result)<>1 OR result->0->>'targetId'<>f.target::text
  OR result->0->>'retentionClass'<>'customer_address_history' OR result->0->>'sourceHash'<>repeat('a',64)
  OR result->0->'personalDataAvailable'<>'false'::jsonb THEN RAISE EXCEPTION 'native tombstone result or company filter incorrect'; END IF;
 denied:=false;
 BEGIN PERFORM public.ediel_customer_record_tombstones_v1(f.other_company,f.customer);
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='customer_record_customer_scope_required' THEN denied:=true; ELSE RAISE; END IF; END;
 IF NOT denied THEN RAISE EXCEPTION 'foreign company customer accepted'; END IF;
 denied:=false;
 BEGIN INSERT INTO gridex_ediel_retention.record_tombstones
  SELECT retention_class,gen_random_uuid(),company_id,customer_id,contract_id,gen_random_uuid(),review_id,source_hash,target_hash,byte_length,storage_path,actor_user_id,journal_retain_until,journal_purpose_reference,created_at
  FROM gridex_ediel_retention.record_tombstones WHERE target_id=f.target;
 EXCEPTION WHEN foreign_key_violation THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'invalid native decision FK accepted'; END IF;
 FOREACH table_name IN ARRAY ARRAY['record_class_catalog','record_decisions','record_reviews','record_tombstones'] LOOP
  denied:=false;
  BEGIN EXECUTE format('UPDATE gridex_ediel_retention.%I SET %s',table_name,CASE WHEN table_name IN('record_class_catalog','record_tombstones') THEN 'retention_class=retention_class' ELSE 'id=id' END);
  EXCEPTION WHEN check_violation THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'immutable update accepted: %',table_name; END IF;
  denied:=false;
  BEGIN EXECUTE format('DELETE FROM gridex_ediel_retention.%I',table_name); EXCEPTION WHEN check_violation THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'immutable delete accepted: %',table_name; END IF;
  denied:=false;
  BEGIN EXECUTE format('TRUNCATE gridex_ediel_retention.%I CASCADE',table_name); EXCEPTION WHEN check_violation THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'immutable truncate accepted: %',table_name; END IF;
 END LOOP;
 PERFORM set_config('staff.retention_company',f.company::text,true),set_config('staff.retention_customer',f.customer::text,true);
END $$;
SET LOCAL ROLE service_role;
DO $$ BEGIN
 IF jsonb_array_length(public.ediel_customer_record_tombstones_v1(current_setting('staff.retention_company')::uuid,current_setting('staff.retention_customer')::uuid))<>1 THEN
  RAISE EXCEPTION 'service-only native tombstone read failed';
 END IF;
 BEGIN PERFORM 1 FROM gridex_ediel_retention.record_tombstones; RAISE EXCEPTION 'service direct private table access accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM public.ediel_customer_record_tombstones_v1(current_setting('staff.retention_company')::uuid,current_setting('staff.retention_customer')::uuid);
  RAISE EXCEPTION 'anon invoked private tombstone RPC'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.ediel_customer_record_tombstones_v1(current_setting('staff.retention_company')::uuid,current_setting('staff.retention_customer')::uuid);
  RAISE EXCEPTION 'authenticated invoked private tombstone RPC'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM 1 FROM gridex_ediel_retention.record_tombstones; RAISE EXCEPTION 'authenticated direct private table access accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
DO $$ BEGIN RAISE NOTICE 'STAFF_CUSTOMER_RETENTION_READ_PREREQUISITE_NATIVE_PASS'; END $$;
ROLLBACK;
