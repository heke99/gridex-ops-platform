-- Physical compatibility for existing scoped webhook owners/dispatchers.
-- Unknown legacy client/provenance/timestamps stay unknown. Preserve public
-- references, Vault TEXT references, hashes, existing security and history.
DO $webhook_physical_forward$
DECLARE
  target oid := 'public.webhook_subscriptions'::regclass;
  clients oid := 'public.integration_api_clients'::regclass;
  col record;
  attribute pg_catalog.pg_attribute%ROWTYPE;
  actual pg_catalog.pg_constraint%ROWTYPE;
  actual_index pg_catalog.pg_index%ROWTYPE;
  expected_index pg_catalog.pg_index%ROWTYPE;
  old_default text;
  expected_expression text;
  actual_expression text;
  keys text[];
  foreign_keys text[];
  uuid_equal oid;
  index_oid oid;
BEGIN
  PERFORM pg_catalog.set_config('search_path', 'pg_catalog, pg_temp', true);
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
  PERFORM pg_catalog.set_config('statement_timeout', '60s', true);
  LOCK TABLE public.webhook_subscriptions IN ACCESS EXCLUSIVE MODE;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_class WHERE oid=target AND relkind='r' AND relrowsecurity)
    OR NOT EXISTS (SELECT FROM pg_catalog.pg_attribute WHERE attrelid=target AND attname='company_id' AND atttypid='uuid'::regtype AND attnotnull AND NOT attisdropped)
    OR NOT EXISTS (SELECT FROM pg_catalog.pg_attribute WHERE attrelid=target AND attname='endpoint_url' AND atttypid='text'::regtype AND attnotnull AND NOT attisdropped)
    OR NOT EXISTS (SELECT FROM pg_catalog.pg_attribute WHERE attrelid=target AND attname='status' AND atttypid='text'::regtype AND attnotnull AND NOT attisdropped)
  THEN RAISE EXCEPTION 'webhook_physical_shape_conflict' USING ERRCODE='55000'; END IF;

  -- Missing fields get neutral defaults; existing incompatible profiles refuse.
  -- No client inference, provenance label, UUID cast or historical clock guess.
  FOR col IN SELECT * FROM (VALUES
    ('api_client_id','uuid'::regtype,'uuid'),
    ('description','text'::regtype,'text'),
    ('metadata','jsonb'::regtype,'jsonb'),
    ('last_success_at','timestamptz'::regtype,'timestamptz'),
    ('last_failure_at','timestamptz'::regtype,'timestamptz')
  ) AS columns(name,expected_type,type_sql) LOOP
    SELECT * INTO attribute FROM pg_catalog.pg_attribute
      WHERE attrelid=target AND attname=col.name AND NOT attisdropped;
    IF NOT FOUND THEN
      IF col.name='metadata' THEN
        ALTER TABLE public.webhook_subscriptions ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
      ELSE
        EXECUTE pg_catalog.format('ALTER TABLE public.webhook_subscriptions ADD COLUMN %I %s',col.name,col.type_sql);
      END IF;
    ELSE
      SELECT pg_catalog.pg_get_expr(adbin,adrelid,false) INTO old_default
        FROM pg_catalog.pg_attrdef WHERE adrelid=target AND adnum=attribute.attnum;
      IF attribute.atttypid IS DISTINCT FROM col.expected_type::oid
        OR attribute.atttypmod IS DISTINCT FROM -1
        OR attribute.attgenerated IS DISTINCT FROM ''
        OR attribute.attidentity IS DISTINCT FROM ''
        OR (col.name<>'metadata' AND (attribute.attnotnull OR old_default IS NOT NULL))
        OR (col.name='metadata' AND old_default IS NOT NULL AND old_default IS DISTINCT FROM '''{}''::jsonb')
      THEN RAISE EXCEPTION 'webhook_physical_column_conflict:%',col.name USING ERRCODE='55000'; END IF;
    END IF;
  END LOOP;

  IF EXISTS (SELECT FROM public.webhook_subscriptions WHERE metadata IS NOT NULL AND pg_catalog.jsonb_typeof(metadata)<>'object')
  THEN RAISE EXCEPTION 'webhook_metadata_object_conflict' USING ERRCODE='55000'; END IF;
  IF EXISTS (SELECT FROM public.webhook_subscriptions WHERE metadata IS NULL) THEN
    -- Canonical history has no UPDATE trigger. Do not disable an unknown
    -- richer profile's audit/timestamp hook to make a backfill appear stable.
    IF EXISTS (SELECT FROM pg_catalog.pg_trigger WHERE tgrelid=target AND NOT tgisinternal AND tgenabled<>'D' AND (tgtype::int & 16)=16)
      OR EXISTS (SELECT FROM pg_catalog.pg_rewrite WHERE ev_class=target AND ev_type='2')
    THEN RAISE EXCEPTION 'webhook_metadata_backfill_hook_conflict' USING ERRCODE='55000'; END IF;
    UPDATE public.webhook_subscriptions SET metadata='{}'::jsonb WHERE metadata IS NULL;
  END IF;
  ALTER TABLE public.webhook_subscriptions ALTER COLUMN metadata SET DEFAULT '{}'::jsonb,
    ALTER COLUMN metadata SET NOT NULL;

  -- Compile independent expected CHECK/index expressions on this exact server.
  -- Exclusive temporary names cannot adopt/drop an unknown existing object.
  CREATE TEMPORARY TABLE webhook_expected_shape_20261101092632 (
    company_id uuid NOT NULL, api_client_id uuid, endpoint_url text NOT NULL,
    status text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT expected_metadata_object CHECK (pg_catalog.jsonb_typeof(metadata)='object')
  ) ON COMMIT DROP;
  SELECT pg_catalog.pg_get_expr(conbin,conrelid,false) INTO STRICT expected_expression
    FROM pg_catalog.pg_constraint WHERE conrelid='pg_temp.webhook_expected_shape_20261101092632'::regclass AND conname='expected_metadata_object';
  SELECT * INTO actual FROM pg_catalog.pg_constraint WHERE conrelid=target AND conname='webhook_subscriptions_metadata_object_check';
  IF NOT FOUND THEN
    ALTER TABLE public.webhook_subscriptions ADD CONSTRAINT webhook_subscriptions_metadata_object_check CHECK (pg_catalog.jsonb_typeof(metadata)='object');
    SELECT * INTO STRICT actual FROM pg_catalog.pg_constraint WHERE conrelid=target AND conname='webhook_subscriptions_metadata_object_check';
  END IF;
  SELECT pg_catalog.pg_get_expr(actual.conbin,target,false) INTO actual_expression;
  SELECT pg_catalog.array_agg(a.attname::text ORDER BY k.ordinality) INTO keys
    FROM pg_catalog.unnest(actual.conkey) WITH ORDINALITY k(attnum,ordinality)
    JOIN pg_catalog.pg_attribute a ON a.attrelid=target AND a.attnum=k.attnum;
  IF actual.contype IS DISTINCT FROM 'c' OR NOT actual.convalidated OR actual.connoinherit
    OR actual.condeferrable OR NOT actual.conislocal OR actual.coninhcount<>0
    OR keys IS DISTINCT FROM ARRAY['metadata']::text[] OR actual_expression IS DISTINCT FROM expected_expression
  THEN RAISE EXCEPTION 'webhook_metadata_check_conflict' USING ERRCODE='55000'; END IF;

  -- Never silently clear/cascade a linked credential on physical client delete.
  IF EXISTS (
    SELECT FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_attribute a
      ON a.attrelid=target AND a.attname='api_client_id' AND a.attnum=ANY(c.conkey)
    WHERE c.conrelid=target AND c.contype='f' AND (c.confdeltype<>'a' OR c.confupdtype<>'a')
  ) THEN RAISE EXCEPTION 'webhook_client_delete_policy_conflict' USING ERRCODE='55000'; END IF;
  SELECT * INTO actual FROM pg_catalog.pg_constraint WHERE conrelid=target AND conname='webhook_subscriptions_company_client_fkey';
  IF NOT FOUND THEN
    ALTER TABLE public.webhook_subscriptions ADD CONSTRAINT webhook_subscriptions_company_client_fkey
      FOREIGN KEY(company_id,api_client_id) REFERENCES public.integration_api_clients(company_id,id)
      MATCH SIMPLE ON UPDATE NO ACTION ON DELETE NO ACTION NOT DEFERRABLE;
    SELECT * INTO STRICT actual FROM pg_catalog.pg_constraint WHERE conrelid=target AND conname='webhook_subscriptions_company_client_fkey';
  END IF;
  SELECT pg_catalog.array_agg(a.attname::text ORDER BY k.ordinality) INTO keys
    FROM pg_catalog.unnest(actual.conkey) WITH ORDINALITY k(attnum,ordinality)
    JOIN pg_catalog.pg_attribute a ON a.attrelid=target AND a.attnum=k.attnum;
  SELECT pg_catalog.array_agg(a.attname::text ORDER BY k.ordinality) INTO foreign_keys
    FROM pg_catalog.unnest(actual.confkey) WITH ORDINALITY k(attnum,ordinality)
    JOIN pg_catalog.pg_attribute a ON a.attrelid=clients AND a.attnum=k.attnum;
  SELECT oid INTO STRICT uuid_equal FROM pg_catalog.pg_operator
    WHERE oprnamespace='pg_catalog'::regnamespace AND oprname='=' AND oprleft='uuid'::regtype AND oprright='uuid'::regtype;
  IF actual.contype IS DISTINCT FROM 'f' OR NOT actual.convalidated OR actual.confrelid IS DISTINCT FROM clients
    OR actual.condeferrable OR actual.condeferred OR actual.confmatchtype IS DISTINCT FROM 's'
    OR actual.confupdtype IS DISTINCT FROM 'a' OR actual.confdeltype IS DISTINCT FROM 'a'
    OR NOT actual.conislocal OR actual.coninhcount<>0
    OR keys IS DISTINCT FROM ARRAY['company_id','api_client_id']::text[]
    OR foreign_keys IS DISTINCT FROM ARRAY['company_id','id']::text[]
    OR actual.conpfeqop IS DISTINCT FROM ARRAY[uuid_equal,uuid_equal]::oid[]
    OR actual.conppeqop IS DISTINCT FROM ARRAY[uuid_equal,uuid_equal]::oid[]
    OR actual.conffeqop IS DISTINCT FROM ARRAY[uuid_equal,uuid_equal]::oid[]
  THEN RAISE EXCEPTION 'webhook_company_client_fk_conflict' USING ERRCODE='55000'; END IF;

  IF EXISTS (SELECT FROM public.webhook_subscriptions WHERE api_client_id IS NOT NULL AND status<>'revoked'
    GROUP BY company_id,api_client_id,endpoint_url HAVING count(*)>1)
  THEN RAISE EXCEPTION 'webhook_client_endpoint_duplicates' USING ERRCODE='55000'; END IF;
  CREATE UNIQUE INDEX webhook_expected_endpoint_20261101092632
    ON webhook_expected_shape_20261101092632(company_id,api_client_id,endpoint_url)
    WHERE api_client_id IS NOT NULL AND status<>'revoked';
  SELECT * INTO STRICT expected_index FROM pg_catalog.pg_index
    WHERE indexrelid='pg_temp.webhook_expected_endpoint_20261101092632'::regclass;
  SELECT c.oid INTO index_oid FROM pg_catalog.pg_class c
    WHERE c.relnamespace='public'::regnamespace AND c.relname='webhook_subscriptions_company_client_endpoint_uidx';
  IF index_oid IS NULL THEN
    CREATE UNIQUE INDEX webhook_subscriptions_company_client_endpoint_uidx
      ON public.webhook_subscriptions(company_id,api_client_id,endpoint_url)
      WHERE api_client_id IS NOT NULL AND status<>'revoked';
    index_oid:='public.webhook_subscriptions_company_client_endpoint_uidx'::regclass;
  END IF;
  SELECT * INTO actual_index FROM pg_catalog.pg_index WHERE indexrelid=index_oid;
  IF NOT FOUND THEN RAISE EXCEPTION 'webhook_client_endpoint_index_conflict' USING ERRCODE='55000'; END IF;
  SELECT pg_catalog.array_agg(a.attname::text ORDER BY k.ordinality) INTO keys
    FROM pg_catalog.unnest(actual_index.indkey) WITH ORDINALITY k(attnum,ordinality)
    JOIN pg_catalog.pg_attribute a ON a.attrelid=target AND a.attnum=k.attnum;
  IF actual_index.indrelid IS DISTINCT FROM target OR NOT actual_index.indisunique
    OR NOT actual_index.indisvalid OR NOT actual_index.indisready OR NOT actual_index.indislive
    OR NOT actual_index.indimmediate OR actual_index.indisprimary OR actual_index.indisexclusion
    OR actual_index.indnullsnotdistinct OR actual_index.indnkeyatts<>3 OR actual_index.indnatts<>3
    OR actual_index.indexprs IS NOT NULL OR keys IS DISTINCT FROM ARRAY['company_id','api_client_id','endpoint_url']::text[]
    OR actual_index.indclass::text IS DISTINCT FROM expected_index.indclass::text
    OR actual_index.indcollation::text IS DISTINCT FROM expected_index.indcollation::text
    OR actual_index.indoption::text IS DISTINCT FROM expected_index.indoption::text
    OR (SELECT relam FROM pg_catalog.pg_class WHERE oid=index_oid) IS DISTINCT FROM (SELECT relam FROM pg_catalog.pg_class WHERE oid=expected_index.indexrelid)
    OR pg_catalog.pg_get_expr(actual_index.indpred,target,false) IS DISTINCT FROM pg_catalog.pg_get_expr(expected_index.indpred,expected_index.indrelid,false)
  THEN RAISE EXCEPTION 'webhook_client_endpoint_index_conflict' USING ERRCODE='55000'; END IF;
  -- Transactional cache notification: no notification survives a refused DDL.
  PERFORM pg_catalog.pg_notify('pgrst','reload schema');
END
$webhook_physical_forward$;
