-- local142: restore original mailbox runtime fields omitted by canonical replay.
-- 20260528_batch_7a_route_inbound_mail_platform_ui.sql: SMTP and audit fields.
-- 20260601070000_ediel_production_readiness_hardening.sql: SMTP/success timestamp.
-- Canonical base is the existing 20260530152700 actor-configuration mailbox:
-- June1 ALTER adds nullable smtp_port without a default. Preserve the original
-- May28 CREATE profile (DEFAULT 587) too; never rewrite an existing default/data.
-- PR1034's nullable successful-poll timestamp remains compatible and untouched.
-- No mailbox/transport configuration, secret, poll, readiness or job is seeded.
DO $mailbox_runtime$
DECLARE
  relation_oid oid := pg_catalog.to_regclass('public.ediel_mailboxes');
  expected record;
  actual record;
BEGIN
  IF relation_oid IS NULL OR NOT EXISTS (
    SELECT FROM pg_catalog.pg_class WHERE oid=relation_oid AND relkind='r'
  ) THEN
    RAISE EXCEPTION 'mailbox_runtime_prerequisite_missing';
  END IF;
  LOCK TABLE public.ediel_mailboxes IN ACCESS EXCLUSIVE MODE;
  -- Require the source-defined base, but preserve unrelated forward extensions.
  FOR expected IN SELECT * FROM (VALUES
    ('id','uuid',true),('company_id','uuid',false),
    ('mailbox_name','text',true),('environment','text',true),
    ('metadata','jsonb',true)
  ) AS base(column_name,type_name,not_null) LOOP
    IF NOT EXISTS (
      SELECT FROM pg_catalog.pg_attribute a
      WHERE a.attrelid=relation_oid AND a.attname=expected.column_name
        AND a.attnum>0 AND NOT a.attisdropped
        AND a.atttypid=pg_catalog.to_regtype(expected.type_name)
        AND a.attnotnull=expected.not_null
    ) THEN RAISE EXCEPTION 'mailbox_runtime_prerequisite_missing'; END IF;
  END LOOP;
  -- Validate every present target before the first DDL; unknown partial forms
  -- abort the single atomic DO instead of silently accepting or normalizing them.
  FOR expected IN SELECT * FROM (VALUES
    ('smtp_host','text'),('smtp_port','integer'),
    ('last_successful_poll_at','timestamp with time zone'),
    ('created_by','uuid'),('updated_by','uuid')
  ) AS targets(column_name,type_name) LOOP
    SELECT a.atttypid,a.atttypmod,a.attnotnull,a.attidentity,a.attgenerated,
      pg_catalog.pg_get_expr(d.adbin,d.adrelid) AS default_expression
    INTO actual FROM pg_catalog.pg_attribute a
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid=relation_oid AND a.attname=expected.column_name
      AND a.attnum>0 AND NOT a.attisdropped;
    IF FOUND AND (
      actual.atttypid<>pg_catalog.to_regtype(expected.type_name)
      OR actual.atttypmod<>-1 OR actual.attnotnull
      OR actual.attidentity<>'' OR actual.attgenerated<>''
      OR (actual.default_expression IS NOT NULL AND NOT (
        expected.column_name='smtp_port' AND actual.default_expression='587'
      ))
    ) THEN
      RAISE EXCEPTION 'mailbox_runtime_column_unknown: %',expected.column_name;
    END IF;
  END LOOP;
  ALTER TABLE public.ediel_mailboxes
    ADD COLUMN IF NOT EXISTS smtp_host text,
    ADD COLUMN IF NOT EXISTS smtp_port integer,
    ADD COLUMN IF NOT EXISTS last_successful_poll_at timestamptz,
    ADD COLUMN IF NOT EXISTS created_by uuid,
    ADD COLUMN IF NOT EXISTS updated_by uuid;
END
$mailbox_runtime$;
