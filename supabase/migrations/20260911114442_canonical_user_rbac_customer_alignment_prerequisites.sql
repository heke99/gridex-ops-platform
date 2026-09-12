-- Actual CLI 2.101.0 identity 20260911114442. Owner-private actual63 control.
-- Only the evidenced missing C index input is added; this is not broad 1B replay.
DO $alignment$
BEGIN
 IF current_user<>'postgres' OR current_setting('transaction_isolation')<>'read committed'
 OR to_regclass('pg_temp.alignment_context') IS NULL
 OR to_regclass('pg_temp.alignment_reference') IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='ALIGNMENT_CONTEXT_REQUIRED';
 END IF;
 IF (SELECT count(*) FROM pg_temp.alignment_context c JOIN pg_temp.alignment_reference r
 ON c.hashes=r.hashes AND c.token=r.token WHERE c.database_name=current_database()
 AND c.backend=pg_backend_pid() AND c.txid=txid_current() AND c.stage='ADMITTED')<>1 THEN
  RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='ALIGNMENT_CONTEXT_REQUIRED';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='pg_temp.alignment_context'::regclass
 AND relnamespace=pg_my_temp_schema() AND relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)
 AND relacl IS NULL) OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='pg_temp.alignment_reference'::regclass
 AND relnamespace=pg_my_temp_schema() AND relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)
 AND relacl IS NULL) THEN
  RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='ALIGNMENT_CONTEXT_REQUIRED';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.billing_export_run_items'::regclass
 AND attname='contract_id' AND NOT attisdropped) THEN
  ALTER TABLE public.billing_export_run_items ADD COLUMN contract_id uuid;
 ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.billing_export_run_items'::regclass
 AND attname='contract_id' AND atttypid='uuid'::regtype AND NOT attisdropped) THEN
  RAISE EXCEPTION USING ERRCODE='42804',MESSAGE='ALIGNMENT_PREREQUISITE_SHAPE';
 END IF;
END $alignment$;
