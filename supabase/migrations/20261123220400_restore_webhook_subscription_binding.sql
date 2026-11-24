DO $migration$
DECLARE
  subscriptions CONSTANT regclass := 'public.webhook_subscriptions'::regclass;
  api_clients CONSTANT regclass := 'public.integration_api_clients'::regclass;
  subscription_client_column smallint;
  client_id_column smallint;
BEGIN
  -- Replays retaining only the Batch 7 foundation missed this additive part of
  -- 20260609162000. Keep existing bindings and unknown historical values intact.
  ALTER TABLE public.webhook_subscriptions
    ADD COLUMN IF NOT EXISTS api_client_id uuid,
    ADD COLUMN IF NOT EXISTS description text,
    ADD COLUMN IF NOT EXISTS last_success_at timestamptz,
    ADD COLUMN IF NOT EXISTS last_failure_at timestamptz,
    ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

  IF EXISTS (
    SELECT FROM (VALUES
      ('api_client_id','uuid'::regtype,false),
      ('description','text'::regtype,false),
      ('last_success_at','timestamptz'::regtype,false),
      ('last_failure_at','timestamptz'::regtype,false),
      ('metadata','jsonb'::regtype,true)
    ) AS expected(column_name,data_type,required)
    LEFT JOIN pg_catalog.pg_attribute actual
      ON actual.attrelid = subscriptions AND actual.attname = expected.column_name
      AND actual.attnum > 0 AND NOT actual.attisdropped
    WHERE actual.atttypid IS DISTINCT FROM expected.data_type::oid
       OR actual.attnotnull IS DISTINCT FROM expected.required
  ) THEN
    RAISE EXCEPTION 'webhook_subscription_binding_columns_incompatible';
  END IF;

  SELECT attnum INTO STRICT subscription_client_column
  FROM pg_catalog.pg_attribute WHERE attrelid = subscriptions AND attname = 'api_client_id' AND NOT attisdropped;
  SELECT attnum INTO STRICT client_id_column
  FROM pg_catalog.pg_attribute WHERE attrelid = api_clients AND attname = 'id' AND NOT attisdropped;
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_constraint
    WHERE conrelid = subscriptions AND conkey = ARRAY[subscription_client_column]
      AND contype = 'f' AND confrelid = api_clients AND confkey = ARRAY[client_id_column]
      AND confdeltype = 'n' AND convalidated
  ) THEN
    IF EXISTS (
      SELECT FROM pg_catalog.pg_constraint
      WHERE conrelid = subscriptions AND (conname = 'webhook_subscriptions_api_client_id_fkey'
        OR (conkey = ARRAY[subscription_client_column] AND contype = 'f'))
    ) THEN
      RAISE EXCEPTION 'webhook_subscription_binding_constraint_incompatible';
    END IF;

    ALTER TABLE public.webhook_subscriptions
      ADD CONSTRAINT webhook_subscriptions_api_client_id_fkey
      FOREIGN KEY (api_client_id) REFERENCES public.integration_api_clients(id) ON DELETE SET NULL;
  END IF;

  CREATE INDEX IF NOT EXISTS webhook_subscriptions_api_client_idx
    ON public.webhook_subscriptions(api_client_id, status, created_at DESC)
    WHERE api_client_id IS NOT NULL;

  -- The original consistency migration skipped its index when this column was
  -- absent. Duplicate existing bindings require review before DDL can commit.
  CREATE UNIQUE INDEX IF NOT EXISTS webhook_subscriptions_company_client_endpoint_uidx
    ON public.webhook_subscriptions(company_id, api_client_id, endpoint_url)
    WHERE api_client_id IS NOT NULL AND status <> 'revoked';
END
$migration$;
