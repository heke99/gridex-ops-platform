-- Exact missing CREATE TABLE column from the complete 20260529 rulebook source.
-- CREATE TABLE IF NOT EXISTS does not add columns to an older existing table.
-- Reconcile only this source-defined boolean; unknown existing shapes fail closed.
BEGIN;
DO $ack_shape$
BEGIN
  IF to_regclass('public.ediel_ack_rules') IS NULL THEN
    RAISE EXCEPTION 'EDIEL_ACK_PREREQUISITE_TABLE_MISSING';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.ediel_ack_rules'::regclass
                  AND attname='negative_aperak_on_error' AND NOT attisdropped) THEN
    ALTER TABLE public.ediel_ack_rules
      ADD COLUMN negative_aperak_on_error boolean NOT NULL DEFAULT true;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid='public.ediel_ack_rules'::regclass AND a.attname='negative_aperak_on_error'
      AND NOT a.attisdropped AND a.atttypid='boolean'::regtype AND a.attnotnull
      AND pg_get_expr(d.adbin,d.adrelid)='true'
  ) THEN
    RAISE EXCEPTION 'EDIEL_ACK_PREREQUISITE_COLUMN_SHAPE_MISMATCH';
  END IF;
END
$ack_shape$;
COMMIT;
