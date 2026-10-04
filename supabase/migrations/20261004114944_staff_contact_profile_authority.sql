-- Staff contact writes already run the locked company role-profile/override
-- guard before replay or mutation. The legacy OPS resolver must not make a
-- second, different staff-API permission decision. Keep all other paths intact.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

DO $migration$
DECLARE
  v_function record;
  v_after record;
  v_body text;
  v_definition text;
  v_legacy constant text := $legacy$  IF p_actor_kind='staff'
     AND NOT coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'masterdata.write'),false) THEN$legacy$;
  v_staff_aware constant text := $staff_aware$  IF p_actor_kind='staff'
     AND p_channel <> 'staff_api'
     AND NOT coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'masterdata.write'),false) THEN$staff_aware$;
  v_guard constant text := $guard$  IF p_channel NOT IN ('ops','customer_api','phone','staff_api') OR p_channel IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='contact_change_channel_invalid';
  END IF;
  IF p_channel='staff_api' THEN
    IF p_actor_kind IS DISTINCT FROM 'staff' THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='contact_change_staff_api_actor_invalid';
    END IF;
    PERFORM public.gridex_staff_assert_write_actor_v1(p_company_id,p_actor_user_id,p_api_client_id,'masterdata.write');
  END IF;$guard$;
BEGIN
  SELECT p.*,to_jsonb(p)-'prosrc' AS metadata INTO STRICT v_function
    FROM pg_proc p WHERE p.oid='public.gridex_customer_contact_change_v1(uuid,uuid,text,uuid,uuid,text,text,timestamptz,jsonb,jsonb,text)'::regprocedure;
  v_body := v_function.prosrc;

  -- Refuse an unexpected predecessor rather than broadening a write boundary.
  IF v_function.prosecdef
    OR position(v_guard IN v_body)=0
    OR (length(v_body)-length(replace(v_body,v_guard,'')))<>length(v_guard)
    OR position(v_guard IN v_body)>position('  -- Idempotent replay:' IN v_body)
    OR position('  -- Idempotent replay:' IN v_body)=0 THEN
    RAISE EXCEPTION 'staff_contact_profile_guard_predecessor_mismatch';
  END IF;

  IF position(v_legacy IN v_body)>0 THEN
    IF (length(v_body)-length(replace(v_body,v_legacy,'')))<>length(v_legacy)
      OR position(v_staff_aware IN v_body)>0
      OR position(v_guard IN v_body)>position(v_legacy IN v_body) THEN
      RAISE EXCEPTION 'staff_contact_profile_permission_predecessor_mismatch';
    END IF;
    v_body := replace(v_body,v_legacy,v_staff_aware);
    v_definition := pg_get_functiondef(v_function.oid);
    IF position(v_function.prosrc IN v_definition)=0 THEN
      RAISE EXCEPTION 'staff_contact_profile_source_binding_failed';
    END IF;
    EXECUTE replace(v_definition,v_function.prosrc,v_body);
  ELSIF (length(v_body)-length(replace(v_body,v_staff_aware,'')))<>length(v_staff_aware)
    OR position(v_guard IN v_body)>position(v_staff_aware IN v_body) THEN
    RAISE EXCEPTION 'staff_contact_profile_permission_predecessor_mismatch';
  END IF;

  SELECT p.*,to_jsonb(p)-'prosrc' AS metadata INTO STRICT v_after
    FROM pg_proc p WHERE p.oid=v_function.oid;
  IF v_after.metadata IS DISTINCT FROM v_function.metadata
    OR v_after.prosrc IS DISTINCT FROM v_body THEN
    RAISE EXCEPTION 'staff_contact_profile_function_identity_changed';
  END IF;
END
$migration$;
COMMIT;
