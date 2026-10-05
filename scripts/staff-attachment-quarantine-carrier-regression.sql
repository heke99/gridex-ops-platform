-- Disposable PostgreSQL 17 clean replay only; all catalog changes roll back.
-- The forward is included byte-for-byte, without extracting or rewriting SQL.
\set ON_ERROR_STOP on
\getenv staff_attachment_carrier_sql GRIDEX_STAFF_ATTACHMENT_CARRIER_SQL
BEGIN;

CREATE FUNCTION pg_temp.staff_attachment_carrier_catalog()
RETURNS TABLE(kind text, key text, value jsonb)
LANGUAGE sql STABLE AS $catalog$
  SELECT 'bucket', b.id, to_jsonb(b) FROM storage.buckets b
  UNION ALL
  SELECT 'relation', c.oid::text,
    jsonb_build_object('owner', c.relowner, 'acl', c.relacl::text,
      'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity)
  FROM pg_class c WHERE c.oid IN (
    'storage.buckets'::regclass, 'storage.objects'::regclass,
    'public.customer_case_attachments'::regclass)
  UNION ALL
  SELECT 'policy', p.oid::text, to_jsonb(p)
  FROM pg_policy p WHERE p.polrelid IN (
    'storage.buckets'::regclass, 'storage.objects'::regclass,
    'public.customer_case_attachments'::regclass)
  UNION ALL
  SELECT 'constraint', c.oid::text, to_jsonb(c)
  FROM pg_constraint c WHERE c.conrelid = 'public.customer_case_attachments'::regclass;
$catalog$;

CREATE FUNCTION pg_temp.assert_staff_attachment_carrier_catalog(expected regclass, phase text)
RETURNS void LANGUAGE plpgsql AS $assert$
DECLARE changed boolean;
BEGIN
  EXECUTE format(
    'SELECT EXISTS ((SELECT * FROM %s EXCEPT ALL SELECT * FROM pg_temp.staff_attachment_carrier_catalog())
      UNION ALL (SELECT * FROM pg_temp.staff_attachment_carrier_catalog() EXCEPT ALL SELECT * FROM %s))',
    expected, expected) INTO changed;
  IF changed THEN RAISE EXCEPTION 'staff_attachment_carrier_%_unexpected_catalog_change', phase; END IF;
END;
$assert$;

DO $preflight$
BEGIN
  IF current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999 THEN
    RAISE EXCEPTION 'staff_attachment_carrier_requires_postgresql_17';
  END IF;
  IF NOT EXISTS (
    SELECT FROM storage.buckets b WHERE b.id = 'support-case-attachments'
      AND b.public IS FALSE AND b.file_size_limit = 10485760
      AND ARRAY(SELECT mime FROM unnest(b.allowed_mime_types) AS t(mime) ORDER BY mime)
        = ARRAY['application/octet-stream', 'application/pdf', 'image/jpeg', 'image/png']::text[]
  ) THEN RAISE EXCEPTION 'staff_attachment_carrier_clean_replay_prerequisite_invalid'; END IF;
END;
$preflight$;

CREATE TEMP TABLE staff_attachment_carrier_before ON COMMIT DROP
AS SELECT * FROM pg_temp.staff_attachment_carrier_catalog();
SAVEPOINT staff_attachment_carrier_rehearsal;

-- Recreate only the legacy transport restriction, inside this disposable rollback.
UPDATE storage.buckets SET allowed_mime_types = ARRAY['application/pdf', 'image/png', 'image/jpeg']::text[]
WHERE id = 'support-case-attachments';
CREATE TEMP TABLE staff_attachment_carrier_expected ON COMMIT DROP AS
SELECT kind, key,
  CASE WHEN kind = 'bucket' AND key = 'support-case-attachments' THEN
    jsonb_set(value, '{allowed_mime_types}', '["application/pdf","image/png","image/jpeg","application/octet-stream"]'::jsonb)
  ELSE value END AS value
FROM pg_temp.staff_attachment_carrier_catalog();

\i :staff_attachment_carrier_sql
SELECT pg_temp.assert_staff_attachment_carrier_catalog('pg_temp.staff_attachment_carrier_expected', 'legacy_upgrade');

-- The exact same source must be a no-op on the already-correct four-type state.
\i :staff_attachment_carrier_sql
SELECT pg_temp.assert_staff_attachment_carrier_catalog('pg_temp.staff_attachment_carrier_expected', 'idempotence');

ROLLBACK TO SAVEPOINT staff_attachment_carrier_rehearsal;
SELECT pg_temp.assert_staff_attachment_carrier_catalog('pg_temp.staff_attachment_carrier_before', 'rollback');
ROLLBACK;
