-- An expected contact version mismatch is a business conflict, not a
-- serialization failure. PostgREST 14 retries a custom 40001 indefinitely.
-- PT409 returns the existing conflict immediately, without changing the write.
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

DO $migration$
DECLARE
  v_before record;
  v_after record;
  v_body text;
  v_definition text;
  v_hash text;
  v_old constant text := $old$ERRCODE='40001', MESSAGE='contact_change_version_conflict'$old$;
  v_new constant text := $new$ERRCODE='PT409', MESSAGE='contact_change_version_conflict'$new$;
  v_before_hash constant text := '4c00ce8bffa2f89fe5627c05c2c05020e50046be5b4b08b01f9ca7e99c39b3e2';
  v_after_hash constant text := 'dcc59600b4daa4a3dc25b5ff531ace5c9b4b6a7834408ed5751b5d82657bea54';
BEGIN
  SELECT p.*,to_jsonb(p)-'prosrc' AS metadata INTO STRICT v_before
  FROM pg_catalog.pg_proc p
  WHERE p.oid='public.gridex_customer_contact_change_v1(uuid,uuid,text,uuid,uuid,text,text,timestamptz,jsonb,jsonb,text)'::regprocedure;
  v_body := v_before.prosrc;
  v_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_body,'UTF8')),'hex');

  -- Only the qualified predecessor or the exact already-fixed body is valid.
  IF v_before.prosecdef OR v_hash NOT IN (v_before_hash,v_after_hash) THEN
    RAISE EXCEPTION 'contact_version_conflict_predecessor_mismatch';
  END IF;
  IF v_hash=v_before_hash THEN
    IF (length(v_body)-length(replace(v_body,v_old,'')))<>length(v_old)
      OR position(v_new IN v_body)>0 THEN
      RAISE EXCEPTION 'contact_version_conflict_predecessor_mismatch';
    END IF;
    v_body := replace(v_body,v_old,v_new);
    v_definition := pg_catalog.pg_get_functiondef(v_before.oid);
    IF (length(v_definition)-length(replace(v_definition,v_before.prosrc,'')))<>length(v_before.prosrc) THEN
      RAISE EXCEPTION 'contact_version_conflict_source_binding_failed';
    END IF;
    EXECUTE replace(v_definition,v_before.prosrc,v_body);
  END IF;

  SELECT p.*,to_jsonb(p)-'prosrc' AS metadata INTO STRICT v_after
  FROM pg_catalog.pg_proc p WHERE p.oid=v_before.oid;
  IF v_after.metadata IS DISTINCT FROM v_before.metadata
    OR v_after.prosrc IS DISTINCT FROM v_body
    OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_after.prosrc,'UTF8')),'hex')<>v_after_hash THEN
    RAISE EXCEPTION 'contact_version_conflict_function_identity_changed';
  END IF;
END
$migration$;
