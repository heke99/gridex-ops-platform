-- The executor supplies owner-private expected catalogs rebuilt from first43.
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = public,extensions,pg_temp;
DO $legacy$
DECLARE r record; actual oid; expected oid; amount bigint;
BEGIN
 IF to_regclass('pg_temp.legacy_reference') IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='ENVELOPE_REQUIRED';
 END IF;
 -- Deterministic locks include all histories/trigger write targets. This
 -- intentionally stronger offline lock boundary is never a live procedure.
 FOR r IN SELECT key, value FROM jsonb_each((SELECT base FROM pg_temp.legacy_reference))
   WHERE key LIKE 'relation/%' AND value->>'kind' IN ('r','p') ORDER BY key LOOP
  actual := to_regclass(substr(r.key,10));
  IF actual IS NULL THEN RAISE EXCEPTION USING ERRCODE='42P01',MESSAGE='CATALOG_MISMATCH'; END IF;
  IF substr(r.key,10) IN ('public.roles','public.auth_email_events','public.company_invitations','public.company_memberships','public.user_profiles','public.user_roles') THEN
   EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE',actual::regclass);
  ELSE
   EXECUTE format('LOCK TABLE %s IN SHARE MODE',actual::regclass);
  END IF;
  expected := to_regclass(substr(r.key,10));
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION USING ERRCODE='42804',MESSAGE='CATALOG_MISMATCH'; END IF;
 END LOOP;
END $legacy$;
-- LEGACY_CATALOG_CAPTURE
CREATE TEMP TABLE legacy_context(txid bigint NOT NULL, stage text NOT NULL,
 role_columns text[] NOT NULL, seeds text[] NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE legacy_rows(relation_name text NOT NULL, row_value jsonb NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE legacy_role_rows(id uuid PRIMARY KEY, row_value jsonb NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE legacy_event_checks(name text PRIMARY KEY, definition text NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE legacy_identity(kind text, object_id oid, value jsonb) ON COMMIT DROP;
DO $legacy$
DECLARE r record; amount bigint; shape jsonb; base jsonb; final_shape jsonb; col text;
BEGIN
 SELECT catalog INTO STRICT shape FROM pg_temp.legacy_catalog_before;
 SELECT x.base,x.final INTO STRICT base,final_shape FROM pg_temp.legacy_reference x;
 FOREACH col IN ARRAY ARRAY['auth_email_events','company_invitations','company_memberships','user_profiles','user_roles'] LOOP
  EXECUTE format('SELECT count(*) FROM public.%I',col) INTO amount;
  IF amount<>0 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='DIRTY_DATA'; END IF;
 END LOOP;
 IF EXISTS (SELECT 1 FROM auth.users au WHERE
  EXISTS (SELECT 1 FROM public.company_memberships cm WHERE cm.user_id=au.id)
  OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id=au.id)) THEN
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='DIRTY_DATA';
 END IF;
 IF shape IS DISTINCT FROM base AND shape IS DISTINCT FROM final_shape THEN
  IF EXISTS (SELECT 1 FROM jsonb_each(shape) a WHERE (a.key LIKE 'trigger/%' OR a.key LIKE 'rule/%') AND a.value IS DISTINCT FROM base->a.key AND a.value IS DISTINCT FROM final_shape->a.key) THEN
   RAISE EXCEPTION USING ERRCODE='P0004',MESSAGE='UNEXPECTED_TRIGGER';
  END IF;
  -- Missing columns have a distinct native-style diagnostic; no original runs.
  IF EXISTS (SELECT 1 FROM jsonb_each(base) a WHERE a.key LIKE 'column/%' AND NOT shape ? a.key) THEN
   RAISE EXCEPTION USING ERRCODE='42703',MESSAGE='CATALOG_MISMATCH';
  END IF;
  RAISE EXCEPTION USING ERRCODE='42804',MESSAGE='CATALOG_MISMATCH';
 END IF;
 IF EXISTS (SELECT key FROM public.roles WHERE key IS NOT NULL GROUP BY key HAVING count(*)>1)
 OR EXISTS (SELECT 1 FROM public.roles a JOIN public.roles b ON lower(btrim(a.name))=lower(btrim(b.key)) AND a.id<>b.id)
 OR EXISTS (SELECT 1 FROM public.roles WHERE nullif(btrim(key),'') IS NULL AND lower(btrim(name))=ANY(ARRAY['company_admin','admin','operations_manager','operations_agent','customer_service_manager','customer_service_agent','sales_manager','pricing_manager','pricing_approver','finance_readonly','executive_readonly','compliance_manager','partner_manager','partner_api_user'])) THEN
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='DIRTY_DATA';
 END IF;
 INSERT INTO pg_temp.legacy_context SELECT txid_current(),'admitted',
  ARRAY(SELECT attname FROM pg_attribute WHERE attrelid='public.roles'::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum),
  ARRAY(SELECT k FROM unnest(ARRAY['company_admin','admin','operations_manager','operations_agent','customer_service_manager','customer_service_agent','sales_manager','pricing_manager','pricing_approver','finance_readonly','executive_readonly','compliance_manager','partner_manager','partner_api_user']) k
  WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE key=k));
 INSERT INTO pg_temp.legacy_role_rows SELECT id,to_jsonb(x) FROM public.roles x;
 INSERT INTO pg_temp.legacy_event_checks SELECT conname,pg_get_constraintdef(oid,false) FROM pg_constraint
  WHERE conrelid='public.auth_email_events'::regclass AND conname IN ('auth_email_events_event_type_check','auth_email_events_action_check','auth_email_events_status_check') AND contype='c' AND convalidated;
 FOR r IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname IN ('public','auth','storage') AND c.relkind IN ('r','p') AND NOT (n.nspname='public' AND c.relname='roles') ORDER BY n.nspname,c.relname LOOP
  EXECUTE format('INSERT INTO pg_temp.legacy_rows SELECT %L,to_jsonb(x) FROM %I.%I x',format('%I.%I',r.nspname,r.relname),r.nspname,r.relname);
 END LOOP;
 INSERT INTO pg_temp.legacy_identity
 SELECT 'policy',p.oid,to_jsonb(p) FROM pg_policy p
 UNION ALL SELECT 'trigger',t.oid,to_jsonb(t) FROM pg_trigger t WHERE NOT t.tgisinternal
 UNION ALL SELECT 'function',p.oid,to_jsonb(p) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','auth','storage');
END $legacy$;
