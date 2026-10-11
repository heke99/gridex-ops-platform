-- Preserve the exact Z02 gate; its refusal issue must use an allowed severity.
-- This changes no admission decision, core response, CHECK, trigger or privilege.
BEGIN;

DO $migration$
DECLARE
  v_signature constant text := 'public.gridex_gate_exact_z02_atomic_apply()';
  v_old_hash constant text := '4025d5ada5bc455f9b581b2e4ce26454ddb7769a92c71517f068c2f88bdbc55b';
  v_new_hash constant text := '118f62e6dc781c4a69a183a9d7675cd4cde6488bc55a2dea0e6dc8e876eb1033';
  v_old_literal constant text := E'    ''critical'',\n    ''ediel_z02_atomic_core_apply'',';
  v_new_literal constant text := E'    ''blocking'',\n    ''ediel_z02_atomic_core_apply'',';
  v_oid oid;
  v_relation oid;
  v_gate pg_catalog.pg_proc%ROWTYPE;
  v_trigger pg_catalog.pg_trigger%ROWTYPE;
  v_before_gate jsonb;
  v_before_trigger jsonb;
  v_before_trigger_definition text;
  v_before_comment text;
  v_before_core jsonb;
  v_after_core jsonb;
  v_definition text;
  v_body text;
  v_hash text;
BEGIN
  v_oid := pg_catalog.to_regprocedure(v_signature);
  v_relation := pg_catalog.to_regclass('public.customer_operation_jobs');
  IF v_oid IS NULL OR v_relation IS NULL THEN
    RAISE EXCEPTION 'z02_atomic_refusal_migration_prerequisite';
  END IF;

  SELECT p.* INTO v_gate FROM pg_catalog.pg_proc AS p WHERE p.oid = v_oid;
  IF NOT FOUND
     OR v_gate.pronargs IS DISTINCT FROM 0
     OR v_gate.prokind IS DISTINCT FROM 'f'
     OR v_gate.prorettype IS DISTINCT FROM 'pg_catalog.trigger'::pg_catalog.regtype
     OR v_gate.prolang IS DISTINCT FROM (SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'plpgsql')
     OR v_gate.prosecdef IS DISTINCT FROM TRUE
     OR v_gate.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[] THEN
    RAISE EXCEPTION 'z02_atomic_refusal_migration_prerequisite';
  END IF;

  -- Validate the installed restriction without manufacturing or changing ACLs.
  IF (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')) <> 3
     OR EXISTS (
       SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_gate.proacl, pg_catalog.acldefault('f', v_gate.proowner)))
       WHERE grantee = 0 AND privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'z02_atomic_refusal_migration_prerequisite';
  END IF;
  IF pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE') IS DISTINCT FROM FALSE
     OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE') IS DISTINCT FROM FALSE
     OR pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'z02_atomic_refusal_migration_prerequisite';
  END IF;

  SELECT t.* INTO v_trigger FROM pg_catalog.pg_trigger AS t
  WHERE t.tgrelid = v_relation AND t.tgname = 'trg_customer_operation_job_z02_zz_atomic_apply';
  IF NOT FOUND
     OR v_trigger.tgfoid IS DISTINCT FROM v_oid
     OR v_trigger.tgisinternal IS DISTINCT FROM FALSE
     OR v_trigger.tgenabled IS DISTINCT FROM 'O'
     OR v_trigger.tgtype IS DISTINCT FROM 23
     OR v_trigger.tgnargs IS DISTINCT FROM 0
     OR v_trigger.tgqual IS NOT NULL
     OR v_trigger.tgconstraint IS DISTINCT FROM 0::oid
     OR v_trigger.tgparentid IS DISTINCT FROM 0::oid
     OR v_trigger.tgdeferrable IS DISTINCT FROM FALSE
     OR v_trigger.tginitdeferred IS DISTINCT FROM FALSE
     OR (SELECT pg_catalog.array_agg(a.attname::text ORDER BY watched.ordinality)
         FROM pg_catalog.unnest(v_trigger.tgattr::smallint[]) WITH ORDINALITY AS watched(attnum, ordinality)
         JOIN pg_catalog.pg_attribute AS a ON a.attrelid = v_relation AND a.attnum = watched.attnum)
        IS DISTINCT FROM ARRAY['status', 'payload', 'job_type']::text[] THEN
    RAISE EXCEPTION 'z02_atomic_refusal_migration_prerequisite';
  END IF;

  v_before_gate := pg_catalog.to_jsonb(v_gate) - 'prosrc';
  v_before_trigger := pg_catalog.to_jsonb(v_trigger);
  v_before_trigger_definition := pg_catalog.pg_get_triggerdef(v_trigger.oid);
  v_before_comment := pg_catalog.obj_description(v_oid, 'pg_proc');
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) ORDER BY p.oid), '[]'::jsonb)
    INTO v_before_core
  FROM pg_catalog.pg_proc AS p JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE (n.nspname = 'public' AND p.proname = 'gridex_apply_exact_z02_core')
     OR (n.nspname = 'gridex_received_sources' AND p.proname = 'gridex_apply_exact_z02_core_before_current_source_v1');

  v_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_gate.prosrc, 'UTF8')), 'hex');
  IF v_hash = v_old_hash THEN
    IF (pg_catalog.length(v_gate.prosrc) - pg_catalog.length(pg_catalog.replace(v_gate.prosrc, v_old_literal, '')))
         IS DISTINCT FROM pg_catalog.length(v_old_literal) THEN
      RAISE EXCEPTION 'z02_atomic_refusal_migration_unreviewed_body';
    END IF;
    v_body := pg_catalog.replace(v_gate.prosrc, v_old_literal, v_new_literal);
    IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_body, 'UTF8')), 'hex') IS DISTINCT FROM v_new_hash THEN
      RAISE EXCEPTION 'z02_atomic_refusal_migration_unreviewed_body';
    END IF;
    v_definition := pg_catalog.pg_get_functiondef(v_oid);
    IF (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_gate.prosrc, '')))
         IS DISTINCT FROM pg_catalog.length(v_gate.prosrc) THEN
      RAISE EXCEPTION 'z02_atomic_refusal_migration_unreviewed_definition';
    END IF;
    -- Use the trusted installed declaration, preserving its OID, owner and ACL.
    EXECUTE pg_catalog.replace(v_definition, v_gate.prosrc, v_body);
  ELSIF v_hash IS DISTINCT FROM v_new_hash THEN
    RAISE EXCEPTION 'z02_atomic_refusal_migration_unreviewed_body';
  END IF;

  -- The recognized repaired branch performs no function DDL and checks the
  -- same prerequisites and preservation conditions as the original branch.
  SELECT p.* INTO v_gate FROM pg_catalog.pg_proc AS p WHERE p.oid = v_oid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'z02_atomic_refusal_migration_postcondition';
  END IF;
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) ORDER BY p.oid), '[]'::jsonb)
    INTO v_after_core
  FROM pg_catalog.pg_proc AS p JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE (n.nspname = 'public' AND p.proname = 'gridex_apply_exact_z02_core')
     OR (n.nspname = 'gridex_received_sources' AND p.proname = 'gridex_apply_exact_z02_core_before_current_source_v1');

  IF pg_catalog.to_regprocedure(v_signature) IS DISTINCT FROM v_oid
     OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_gate.prosrc, 'UTF8')), 'hex') IS DISTINCT FROM v_new_hash
     OR (pg_catalog.to_jsonb(v_gate) - 'prosrc') IS DISTINCT FROM v_before_gate
     OR pg_catalog.obj_description(v_oid, 'pg_proc') IS DISTINCT FROM v_before_comment
     OR (SELECT pg_catalog.to_jsonb(t) FROM pg_catalog.pg_trigger AS t WHERE t.oid = v_trigger.oid) IS DISTINCT FROM v_before_trigger
     OR pg_catalog.pg_get_triggerdef(v_trigger.oid) IS DISTINCT FROM v_before_trigger_definition
     OR v_after_core IS DISTINCT FROM v_before_core THEN
    RAISE EXCEPTION 'z02_atomic_refusal_migration_postcondition';
  END IF;
END
$migration$;

COMMIT;
