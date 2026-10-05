-- A stale identity decision is a business conflict, not a serialization
-- failure. Return its existing409 without PostgREST retrying the decision.
-- Keep the existing definer, approval, takeover and staff actor boundaries.
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

DO $migration$
DECLARE
  v_before record;
  v_after record;
  v_body text;
  v_definition text;
  v_hash text;
  v_old constant text := $old$RAISE EXCEPTION 'identity_change_stale' USING ERRCODE = '40001'$old$;
  v_new constant text := $new$RAISE EXCEPTION 'identity_change_stale' USING ERRCODE = 'PT409'$new$;
  v_before_hash constant text := 'e91471965c7b4989c1c81a679e4c828656ddf0b997eb2d3e92731a76158ab272';
  v_after_hash constant text := '075b242bf2891fbe4cb5eaeaae043e97a6173fa27b3304ff1e719e28038618a0';
BEGIN
  SELECT p.*,to_jsonb(p)-'prosrc' AS metadata INTO STRICT v_before
  FROM pg_catalog.pg_proc p
  WHERE p.oid='public.gridex_decide_customer_identity_change_v1(uuid,uuid,text,text,uuid,jsonb)'::regprocedure;
  v_body := v_before.prosrc;
  v_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_body,'UTF8')),'hex');

  -- Only the qualified predecessor or the exact already-fixed body is valid.
  IF NOT v_before.prosecdef OR v_hash NOT IN (v_before_hash,v_after_hash) THEN
    RAISE EXCEPTION 'identity_version_conflict_predecessor_mismatch';
  END IF;
  IF v_hash=v_before_hash THEN
    IF (length(v_body)-length(replace(v_body,v_old,'')))<>length(v_old)
      OR position(v_new IN v_body)>0 THEN
      RAISE EXCEPTION 'identity_version_conflict_predecessor_mismatch';
    END IF;
    v_body := replace(v_body,v_old,v_new);
    v_definition := pg_catalog.pg_get_functiondef(v_before.oid);
    IF (length(v_definition)-length(replace(v_definition,v_before.prosrc,'')))<>length(v_before.prosrc) THEN
      RAISE EXCEPTION 'identity_version_conflict_source_binding_failed';
    END IF;
    EXECUTE replace(v_definition,v_before.prosrc,v_body);
  END IF;

  SELECT p.*,to_jsonb(p)-'prosrc' AS metadata INTO STRICT v_after
  FROM pg_catalog.pg_proc p WHERE p.oid=v_before.oid;
  IF v_after.metadata IS DISTINCT FROM v_before.metadata
    OR v_after.prosrc IS DISTINCT FROM v_body
    OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_after.prosrc,'UTF8')),'hex')<>v_after_hash THEN
    RAISE EXCEPTION 'identity_version_conflict_function_identity_changed';
  END IF;
END
$migration$;
