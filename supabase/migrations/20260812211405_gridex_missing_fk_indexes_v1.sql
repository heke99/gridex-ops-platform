-- Add covering indexes for every currently unindexed foreign key in the public schema.
-- Deterministic names make this replay-safe; existing qualifying indexes are detected before creation.
SET LOCAL lock_timeout = '10s';

DO $$
DECLARE
  r record;
  cols text;
  idx_name text;
BEGIN
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
      substr(md5(r.constraint_name), 1, 12)
    );

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.%I (%s)',
      idx_name,
      r.schema_name,
      r.table_name,
      cols
    );
  END LOOP;
END
$$;
