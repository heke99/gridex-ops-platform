-- 20260925235000 bound the H dispatch checkpoint to the physical wire:
--   - a PRODAT outbound whose bytes do not tokenize, or carry no BGM, is
--     scoped (held before provider entry) whatever its row code says;
--   - the canonical LK exemption applies only to a Z08 row whose physical BGM
--     is Z08 and whose bytes carry Z23 and no Z25, and it is reported as
--     unscopedReason=canonical_lk_exemption.
-- 20260930175554/203322/211852 rebuilt the base body
-- (gridex_outbound_dispatch.mutate_before_observed_clock_v1) from an older
-- variant and silently dropped both: malformed PRODAT originals became
-- unscoped, and a stale Z08 LK row with other bytes (e.g. a Z05 wire) was
-- exempted from the checkpoint.
--
-- Restore the 20260925235000 scoping exactly in the current body. Everything
-- after the scope decision (observed clock, Latin1 bytes, recipient binding,
-- replay precedence) is unchanged, as are signature, security, configuration
-- and ACL.
BEGIN;
DO $restore$DECLARE f record;body text;
 n1 CONSTANT text:=$n$  scoped:=o.message_id IS NOT NULL OR (m.direction='outbound' AND (m.message_code='Z08' OR EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='BGM' AND t#>>'{elements,1,0}'='Z08')));$n$;
 r1 CONSTANT text:=$n$  scoped:=o.message_id IS NOT NULL OR (m.direction='outbound' AND (
   m.message_code='Z08' OR (m.message_family='PRODAT' AND (tokens IS NULL OR NOT EXISTS(
    SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='BGM')))
   OR EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='BGM' AND t#>>'{elements,1,0}'='Z08')));$n$;
 n2 CONSTANT text:=$n$  IF o.message_id IS NULL AND m.rule_profile_key='PRODAT:Z08:LK:26.A:r3'
   AND EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='CAV' AND t#>>'{elements,1,0}'='Z23')
   AND NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='CAV' AND t#>>'{elements,1,0}'='Z25') THEN scoped:=false; END IF;$n$;
 r2 CONSTANT text:=$n$  IF o.message_id IS NULL AND m.direction='outbound' AND m.message_family='PRODAT'
   AND m.message_code='Z08' AND m.rule_profile_key='PRODAT:Z08:LK:26.A:r3'
   AND EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='BGM' AND t#>>'{elements,1,0}'='Z08')
   AND EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='CAV' AND t#>>'{elements,1,0}'='Z23')
   AND NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='CAV' AND t#>>'{elements,1,0}'='Z25')
  THEN RETURN jsonb_build_object('scoped',false,'unscopedReason','canonical_lk_exemption'); END IF;$n$;
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='gridex_outbound_dispatch.mutate_before_observed_clock_v1(jsonb)'::regprocedure;
 IF (length(f.prosrc)-length(replace(f.prosrc,n1,'')))/length(n1)<>1 OR (length(f.prosrc)-length(replace(f.prosrc,n2,'')))/length(n2)<>1 THEN RAISE EXCEPTION 'outbound_dispatch_lk_scope_predecessor_required';END IF;
 body:=replace(replace(f.prosrc,n1,r1),n2,r2);
 EXECUTE replace(f.definition,f.prosrc,body);
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'outbound_dispatch_lk_scope_metadata_changed';END IF;
END$restore$;
COMMIT;
