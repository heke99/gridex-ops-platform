-- Final assertions run before the executor's single outer COMMIT.
-- LEGACY_CATALOG_CAPTURE
-- LEGACY_DDL_ORACLES
DO $legacy$
DECLARE before_shape jsonb; after_shape jsonb; r record; result boolean; current_rows jsonb;
 expected_roles bigint; actual_roles bigint; col smallint; parent smallint; fk text;
BEGIN
 IF to_regclass('pg_temp.legacy_context') IS NULL OR
 (SELECT count(*) FROM pg_temp.legacy_context WHERE txid=txid_current() AND stage='Q')<>1 THEN
  RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='ENVELOPE_REQUIRED';
 END IF;
 SELECT catalog INTO STRICT before_shape FROM pg_temp.legacy_catalog_before;
 SELECT catalog INTO STRICT after_shape FROM pg_temp.legacy_catalog_after;
 -- The five tables remain empty; every unrelated relation is an exact multiset.
 FOR r IN SELECT key FROM jsonb_each(before_shape)
 WHERE key LIKE 'relation/%' AND before_shape->key->>'kind' IN ('r','p')
 AND key<>'relation/public.roles' LOOP
  EXECUTE format('SELECT NOT EXISTS ((SELECT to_jsonb(x) FROM %s x EXCEPT ALL SELECT row_value FROM pg_temp.legacy_rows WHERE relation_name=%L) UNION ALL (SELECT row_value FROM pg_temp.legacy_rows WHERE relation_name=%L EXCEPT ALL SELECT to_jsonb(x) FROM %s x))',substr(r.key,10),substr(r.key,10),substr(r.key,10),substr(r.key,10)) INTO result;
  IF result IS DISTINCT FROM true THEN RAISE EXCEPTION USING ERRCODE='P0003',MESSAGE='PRESERVATION_FAILED'; END IF;
 END LOOP;
 -- Exact arbitrary old-role JSON projection. Additional source-defined
 -- is_system is false for old IDs when the column was absent at admission.
 IF EXISTS (SELECT 1 FROM pg_temp.legacy_role_rows s LEFT JOIN public.roles a ON a.id=s.id
 WHERE a.id IS NULL OR s.row_value IS DISTINCT FROM
 (SELECT jsonb_object_agg(k,to_jsonb(a)->k) FROM unnest((SELECT role_columns FROM pg_temp.legacy_context)) k)) THEN
  RAISE EXCEPTION USING ERRCODE='P0003',MESSAGE='PRESERVATION_FAILED';
 END IF;
 IF NOT ('is_system'=ANY(SELECT unnest(role_columns) FROM pg_temp.legacy_context))
 AND EXISTS (SELECT 1 FROM public.roles a JOIN pg_temp.legacy_role_rows s ON a.id=s.id WHERE a.is_system IS DISTINCT FROM false) THEN
  RAISE EXCEPTION USING ERRCODE='P0003',MESSAGE='PRESERVATION_FAILED';
 END IF;
 SELECT cardinality(seeds) INTO expected_roles FROM pg_temp.legacy_context;
 SELECT count(*) INTO actual_roles FROM public.roles a WHERE NOT EXISTS(SELECT 1 FROM pg_temp.legacy_role_rows s WHERE s.id=a.id);
 IF actual_roles<>expected_roles OR EXISTS (
  SELECT 1 FROM public.roles a LEFT JOIN pg_temp.legacy_seed_oracle e ON a.key=e.key
  WHERE NOT EXISTS(SELECT 1 FROM pg_temp.legacy_role_rows s WHERE s.id=a.id)
  AND (e.key IS NULL OR NOT (a.key=ANY(SELECT unnest(seeds) FROM pg_temp.legacy_context))
   OR a.name IS DISTINCT FROM a.key OR a.description IS DISTINCT FROM e.description
   OR a.scope IS DISTINCT FROM 'company' OR a.is_active IS DISTINCT FROM true
   OR a.is_system IS DISTINCT FROM true OR a.is_system_role IS DISTINCT FROM true
   OR a.created_at IS DISTINCT FROM transaction_timestamp() OR a.updated_at IS DISTINCT FROM transaction_timestamp())) THEN
  RAISE EXCEPTION USING ERRCODE='P0003',MESSAGE='PRESERVATION_FAILED';
 END IF;
 IF EXISTS (SELECT key FROM public.roles WHERE key IS NOT NULL GROUP BY key HAVING count(*)>1) THEN
  RAISE EXCEPTION USING ERRCODE='P0003',MESSAGE='PRESERVATION_FAILED';
 END IF;
 -- Exact FK catalog semantics independently asserted (not a name-only guard).
 FOR r IN SELECT * FROM (VALUES
 ('user_profiles','active_company_id','public.companies'),
 ('company_memberships','disabled_by','auth.users'),
 ('company_memberships','removed_by','auth.users'),
 ('company_invitations','invited_by','auth.users'),
 ('company_invitations','invited_user_id','auth.users')) x(tbl,column_name,parent_name) LOOP
  SELECT attnum INTO STRICT col FROM pg_attribute WHERE attrelid=format('public.%I',r.tbl)::regclass AND attname=r.column_name AND NOT attisdropped;
  SELECT attnum INTO STRICT parent FROM pg_attribute WHERE attrelid=r.parent_name::regclass AND attname='id' AND NOT attisdropped;
  fk := r.tbl||'_'||r.column_name||'_fkey';
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=format('public.%I',r.tbl)::regclass AND conname=fk
   AND contype='f' AND conkey=ARRAY[col] AND confkey=ARRAY[parent] AND confrelid=r.parent_name::regclass
   AND confdeltype='n' AND confupdtype='a' AND confmatchtype='s' AND convalidated AND NOT condeferrable AND NOT condeferred) THEN
   RAISE EXCEPTION USING ERRCODE='P0003',MESSAGE='PRESERVATION_FAILED';
  END IF;
  INSERT INTO pg_temp.legacy_expected_deltas VALUES ('constraint/public.'||r.tbl||'/'||fk,
   after_shape->('constraint/public.'||r.tbl||'/'||fk)) ON CONFLICT DO NOTHING;
 END LOOP;
 -- Complete old catalog is invariant except explicitly named source CHECKs.
 -- New columns/indexes are compared with independently parsed immutable DDL.
 FOR r IN SELECT key,value FROM jsonb_each(before_shape) LOOP
  IF NOT EXISTS (SELECT 1 FROM pg_temp.legacy_expected_deltas WHERE key=r.key)
   AND r.value IS DISTINCT FROM after_shape->r.key THEN
   RAISE EXCEPTION USING ERRCODE='P0003',MESSAGE='PRESERVATION_FAILED';
  END IF;
 END LOOP;
 FOR r IN SELECT key,value FROM pg_temp.legacy_expected_deltas LOOP
  IF r.value IS DISTINCT FROM after_shape->r.key THEN
   RAISE EXCEPTION USING ERRCODE='P0003',MESSAGE='PRESERVATION_FAILED';
  END IF;
 END LOOP;
 IF EXISTS (SELECT 1 FROM jsonb_each(after_shape) a WHERE NOT before_shape ? a.key
  AND NOT EXISTS (SELECT 1 FROM pg_temp.legacy_expected_deltas d WHERE d.key=a.key)) THEN
  RAISE EXCEPTION USING ERRCODE='P0003',MESSAGE='PRESERVATION_FAILED';
 END IF;
 IF EXISTS ((SELECT name,definition FROM pg_temp.legacy_event_checks EXCEPT
  SELECT conname,pg_get_constraintdef(oid,false) FROM pg_constraint WHERE conrelid='public.auth_email_events'::regclass
  AND conname IN ('auth_email_events_event_type_check','auth_email_events_action_check','auth_email_events_status_check'))
 UNION ALL (SELECT conname,pg_get_constraintdef(oid,false) FROM pg_constraint WHERE conrelid='public.auth_email_events'::regclass
  AND conname IN ('auth_email_events_event_type_check','auth_email_events_action_check','auth_email_events_status_check')
  EXCEPT SELECT name,definition FROM pg_temp.legacy_event_checks)) THEN
  RAISE EXCEPTION USING ERRCODE='P0003',MESSAGE='PRESERVATION_FAILED';
 END IF;
 -- Policy/function/trigger identities are not normalized away in preservation.
 IF EXISTS(SELECT 1 FROM pg_temp.legacy_identity s WHERE
  CASE s.kind WHEN 'policy' THEN (SELECT to_jsonb(p) FROM pg_policy p WHERE p.oid=s.object_id)
  WHEN 'trigger' THEN (SELECT to_jsonb(t) FROM pg_trigger t WHERE t.oid=s.object_id)
  WHEN 'function' THEN (SELECT to_jsonb(p) FROM pg_proc p WHERE p.oid=s.object_id) END IS DISTINCT FROM s.value) THEN
  RAISE EXCEPTION USING ERRCODE='P0003',MESSAGE='PRESERVATION_FAILED';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.gridex_user_auth_integrity_v'::regclass AND reloptions @> ARRAY['security_invoker=true'])
 OR EXISTS (SELECT 1 FROM unnest(ARRAY['anon','authenticated','authenticator']) role_name
  WHERE has_table_privilege(role_name,'public.auth_provisioning_events','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   OR has_table_privilege(role_name,'public.gridex_user_auth_integrity_v','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) THEN
  RAISE EXCEPTION USING ERRCODE='P0003',MESSAGE='PRESERVATION_FAILED';
 END IF;
 UPDATE pg_temp.legacy_context SET stage='completed' WHERE txid=txid_current();
END $legacy$;
