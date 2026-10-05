-- The cancellation-origin immutability trigger on public.ediel_messages
-- (20260930214933) is SECURITY INVOKER while its private schema grants no
-- USAGE to service_role or authenticated. Every ordinary owner-path update of
-- an outbound message therefore failed with "permission denied for schema
-- gridex_switch_cancellations" before the guard could evaluate.
--
-- Least privilege: the trigger only reads gridex_switch_cancellations.origins,
-- so it runs as its owner with the already pinned empty search_path. No schema
-- privilege is granted; body, trigger and revoked EXECUTE stay unchanged.
BEGIN;
DO $definer$DECLARE f regprocedure:='gridex_switch_cancellations.bound_message_immutable_v1()'::regprocedure;before jsonb;
BEGIN
 IF (SELECT prosecdef FROM pg_proc WHERE oid=f) OR (SELECT proconfig FROM pg_proc WHERE oid=f) IS DISTINCT FROM ARRAY['search_path=""'] THEN
  RAISE EXCEPTION 'switch_cancellation_trigger_predecessor_required';END IF;
 SELECT to_jsonb(p)-'prosecdef' INTO before FROM pg_proc p WHERE oid=f;
 ALTER FUNCTION gridex_switch_cancellations.bound_message_immutable_v1() SECURITY DEFINER;
 IF (SELECT to_jsonb(p)-'prosecdef' FROM pg_proc p WHERE oid=f) IS DISTINCT FROM before OR NOT (SELECT prosecdef FROM pg_proc WHERE oid=f) THEN
  RAISE EXCEPTION 'switch_cancellation_trigger_metadata_changed';END IF;
END$definer$;
COMMIT;
