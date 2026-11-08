-- Forward-only compatibility for the shared pre-resolution idempotency ledger.
-- The historical 20261030130100 proposal is immutable reference material.
-- Customer-bound tenant/FK/merged-customer guards, both key domains, RLS and
-- owner/replay semantics remain in force. No data or other ledger is created.
DO $customerless_forward$
DECLARE
  target oid := 'public.customer_portal_write_idempotency'::regclass;
  wanted constant text := 'customer_portal_write_idempotency_customer_required_check';
  actual pg_catalog.pg_constraint%ROWTYPE;
  expected_expression text;
  actual_expression text;
  used_columns text[];
BEGIN
  PERFORM pg_catalog.set_config('search_path', 'pg_catalog, pg_temp', true);
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
  LOCK TABLE public.customer_portal_write_idempotency IN ACCESS EXCLUSIVE MODE;

  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_class WHERE oid = target AND relkind = 'r'
  ) OR NOT EXISTS (
    SELECT FROM pg_catalog.pg_attribute
    WHERE attrelid = target AND attname = 'customer_id'
      AND atttypid = 'pg_catalog.uuid'::regtype AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT FROM pg_catalog.pg_attribute
    WHERE attrelid = target AND attname = 'route'
      AND atttypid = 'pg_catalog.text'::regtype AND attnotnull
      AND attcollation = 'pg_catalog."default"'::regcollation
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'customerless_ledger_shape_conflict' USING ERRCODE = '55000';
  END IF;

  -- Let this PostgreSQL server compile the expected expression. Comparison of
  -- catalog deparses avoids accepting a reused name or normalizing arbitrary
  -- SQL with regexes. Exclusive CREATE refuses an unknown preexisting temp.
  CREATE TEMPORARY TABLE customerless_expected_check_20261101084405 (
    customer_id uuid,
    route text NOT NULL,
    CONSTRAINT expected_customer_required CHECK (
      customer_id IS NOT NULL OR route IN (
        '/api/partner/v1/customer',
        '/api/partner/v1/contract',
        '/api/partner/v1/webhook/subscription',
        '/api/partner/v1/customers',
        '/api/partner/v1/contracts',
        '/api/partner/v1/webhooks/subscriptions',
        '/api/v1/customer-portal/sync'
      )
    )
  ) ON COMMIT DROP;
  SELECT pg_catalog.pg_get_expr(conbin, conrelid, false)
    INTO STRICT expected_expression
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'pg_temp.customerless_expected_check_20261101084405'::regclass
      AND conname = 'expected_customer_required';

  SELECT * INTO actual FROM pg_catalog.pg_constraint
    WHERE conrelid = target AND conname = wanted;
  IF NOT FOUND THEN
    ALTER TABLE public.customer_portal_write_idempotency
      ADD CONSTRAINT customer_portal_write_idempotency_customer_required_check
      CHECK (
        customer_id IS NOT NULL OR route IN (
          '/api/partner/v1/customer',
          '/api/partner/v1/contract',
          '/api/partner/v1/webhook/subscription',
          '/api/partner/v1/customers',
          '/api/partner/v1/contracts',
          '/api/partner/v1/webhooks/subscriptions',
          '/api/v1/customer-portal/sync'
        )
      );
    SELECT * INTO STRICT actual FROM pg_catalog.pg_constraint
      WHERE conrelid = target AND conname = wanted;
  END IF;

  SELECT pg_catalog.pg_get_expr(actual.conbin, target, false)
    INTO actual_expression;
  SELECT pg_catalog.array_agg(a.attname::text ORDER BY a.attname::text)
    INTO used_columns
    FROM pg_catalog.unnest(actual.conkey) AS k(attnum)
    JOIN pg_catalog.pg_attribute a ON a.attrelid = target AND a.attnum = k.attnum;
  IF actual.contype IS DISTINCT FROM 'c'
    OR actual.convalidated IS DISTINCT FROM true
    OR actual.connoinherit IS DISTINCT FROM false
    OR actual.condeferrable IS DISTINCT FROM false
    OR actual.conislocal IS DISTINCT FROM true
    OR actual.coninhcount IS DISTINCT FROM 0
    OR used_columns IS DISTINCT FROM ARRAY['customer_id', 'route']::text[]
    OR actual_expression IS DISTINCT FROM expected_expression THEN
    -- NOT VALID still enforces new writes, but cannot certify existing rows.
    -- A wrong/permissive predicate could admit unsupported NULL operations.
    RAISE EXCEPTION 'customerless_required_check_conflict' USING ERRCODE = '55000';
  END IF;

  -- Same atomic statement/table lock as the validated-predicate observation.
  ALTER TABLE public.customer_portal_write_idempotency
    ALTER COLUMN customer_id DROP NOT NULL;
END
$customerless_forward$;
