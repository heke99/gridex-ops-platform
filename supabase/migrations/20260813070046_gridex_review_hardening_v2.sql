-- Forward-only remediation for review findings discovered after the initial Supabase lint normalization.
-- 1) restore platform-admin SELECT semantics lost when selected FOR ALL policies were split,
-- 2) require full (non-partial) foreign-key coverage indexes,
-- 3) make the existing service-only deny guard restrictive so future permissive policies cannot bypass it.

set lock_timeout = '10s';
set statement_timeout = '300s';

DO $$
DECLARE
  r record;
  v_count integer;
BEGIN
  WITH launch_tables AS (
    SELECT p.tablename
    FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.policyname IN (
        'gridex_launch_platform_only_insert',
        'gridex_launch_platform_only_update',
        'gridex_launch_platform_only_delete'
      )
    GROUP BY p.tablename
    HAVING count(*) = 3
  ), missing_read AS (
    SELECT lt.tablename
    FROM launch_tables lt
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename = lt.tablename
        AND p.cmd = 'SELECT'
    )
  )
  SELECT count(*) INTO v_count FROM missing_read;

  IF v_count <> 35 THEN
    RAISE EXCEPTION 'Expected 35 gridex_launch platform-only tables without SELECT coverage, found %', v_count;
  END IF;

  FOR r IN
    WITH launch_tables AS (
      SELECT p.tablename
      FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND p.policyname IN (
          'gridex_launch_platform_only_insert',
          'gridex_launch_platform_only_update',
          'gridex_launch_platform_only_delete'
        )
      GROUP BY p.tablename
      HAVING count(*) = 3
    )
    SELECT lt.tablename
    FROM launch_tables lt
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename = lt.tablename
        AND p.cmd = 'SELECT'
    )
    ORDER BY lt.tablename
  LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS PERMISSIVE FOR SELECT TO authenticated USING ((select gridex_user_is_platform_admin()))',
      'gridex_launch_platform_only_select_restored',
      r.tablename
    );
  END LOOP;
END
$$;

DO $$
DECLARE
  r record;
  cols text;
  idx_name text;
  v_count integer;
  v_remaining integer;
BEGIN
  WITH fk AS (
    SELECT con.conrelid,
           n.nspname AS schema_name,
           c.relname AS table_name,
           con.conname AS constraint_name,
           con.conkey
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.contype = 'f'
      AND n.nspname = 'public'
  ), missing AS (
    SELECT fk.*
    FROM fk
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_index i
      WHERE i.indrelid = fk.conrelid
        AND i.indisvalid
        AND i.indisready
        AND i.indpred IS NULL
        AND i.indexprs IS NULL
        AND i.indnkeyatts >= cardinality(fk.conkey)
        AND (i.indkey::smallint[])[0:cardinality(fk.conkey)-1] = fk.conkey
    )
  )
  SELECT count(*) INTO v_count FROM missing;

  IF v_count <> 57 THEN
    RAISE EXCEPTION 'Expected 57 foreign keys lacking full indexes, found %', v_count;
  END IF;

  FOR r IN
    WITH fk AS (
      SELECT con.conrelid,
             n.nspname AS schema_name,
             c.relname AS table_name,
             con.conname AS constraint_name,
             con.conkey
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE con.contype = 'f'
        AND n.nspname = 'public'
    )
    SELECT fk.*
    FROM fk
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_index i
      WHERE i.indrelid = fk.conrelid
        AND i.indisvalid
        AND i.indisready
        AND i.indpred IS NULL
        AND i.indexprs IS NULL
        AND i.indnkeyatts >= cardinality(fk.conkey)
        AND (i.indkey::smallint[])[0:cardinality(fk.conkey)-1] = fk.conkey
    )
    ORDER BY schema_name, table_name, constraint_name
  LOOP
    SELECT string_agg(format('%I', a.attname), ', ' ORDER BY k.ord)
      INTO cols
    FROM unnest(r.conkey) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a
      ON a.attrelid = r.conrelid
     AND a.attnum = k.attnum;

    idx_name := format(
      'idx_fk_%s_%s',
      left(r.table_name, 30),
      substr(md5(r.schema_name || '.' || r.table_name || '.' || r.constraint_name), 1, 16)
    );

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.%I (%s)',
      idx_name,
      r.schema_name,
      r.table_name,
      cols
    );
  END LOOP;

  WITH fk AS (
    SELECT con.conrelid, con.conkey
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.contype = 'f'
      AND n.nspname = 'public'
  )
  SELECT count(*) INTO v_remaining
  FROM fk
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indrelid = fk.conrelid
      AND i.indisvalid
      AND i.indisready
      AND i.indpred IS NULL
      AND i.indexprs IS NULL
      AND i.indnkeyatts >= cardinality(fk.conkey)
      AND (i.indkey::smallint[])[0:cardinality(fk.conkey)-1] = fk.conkey
  );

  IF v_remaining <> 0 THEN
    RAISE EXCEPTION 'Full FK index remediation incomplete: % foreign keys remain uncovered', v_remaining;
  END IF;
END
$$;

DO $$
DECLARE
  r record;
  v_count integer;
  v_other_user_policies integer;
  v_user_grants integer;
  v_restrictive integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND policyname = 'gridex_explicit_service_only_deny'
    AND permissive = 'PERMISSIVE'
    AND cmd = 'ALL'
    AND roles::text = '{anon,authenticated}'
    AND qual = 'false'
    AND with_check = 'false';

  IF v_count <> 61 THEN
    RAISE EXCEPTION 'Expected 61 permissive service-only deny policies, found %', v_count;
  END IF;

  WITH svc AS (
    SELECT tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname = 'gridex_explicit_service_only_deny'
  )
  SELECT count(*) INTO v_other_user_policies
  FROM pg_policies p
  JOIN svc s USING (tablename)
  WHERE p.schemaname = 'public'
    AND p.policyname <> 'gridex_explicit_service_only_deny'
    AND p.roles && ARRAY['anon','authenticated','public']::name[];

  IF v_other_user_policies <> 0 THEN
    RAISE EXCEPTION 'Refusing service-only restrictive conversion: % other user-facing policies exist', v_other_user_policies;
  END IF;

  WITH svc AS (
    SELECT tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname = 'gridex_explicit_service_only_deny'
  )
  SELECT count(*) INTO v_user_grants
  FROM information_schema.role_table_grants g
  WHERE g.table_schema = 'public'
    AND g.grantee IN ('anon','authenticated')
    AND g.table_name IN (SELECT tablename FROM svc);

  IF v_user_grants <> 0 THEN
    RAISE EXCEPTION 'Refusing service-only restrictive conversion: % anon/authenticated grants exist', v_user_grants;
  END IF;

  FOR r IN
    SELECT tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname = 'gridex_explicit_service_only_deny'
    ORDER BY tablename
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', 'gridex_explicit_service_only_deny', r.tablename);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
      'gridex_explicit_service_only_deny',
      r.tablename
    );
  END LOOP;

  SELECT count(*) INTO v_restrictive
  FROM pg_policies
  WHERE schemaname = 'public'
    AND policyname = 'gridex_explicit_service_only_deny'
    AND permissive = 'RESTRICTIVE'
    AND cmd = 'ALL'
    AND roles::text = '{anon,authenticated}'
    AND qual = 'false'
    AND with_check = 'false';

  IF v_restrictive <> 61 THEN
    RAISE EXCEPTION 'Service-only restrictive conversion incomplete: expected 61, found %', v_restrictive;
  END IF;
END
$$;
