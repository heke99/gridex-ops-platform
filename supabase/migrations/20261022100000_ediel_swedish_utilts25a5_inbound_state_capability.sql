-- Restore inbound state-machine readiness on the Swedish UTILTS 25-A-5 pack.
-- 20261021052940 derived state from productionReadiness and left the seven
-- 'partial' inbound profiles (E30, E72, E74, S01, S04, S06, S07) without it.
-- Inbound runtime decisions require it, and 25-A-4 (now superseded from
-- 2026-10-01) has it for every UTILTS message, so these sources would only be
-- held. Builder/outbound readiness and every other column stay unchanged.
BEGIN;
DO $u5_inbound_state$
DECLARE pack uuid;changed int;
BEGIN
 SELECT id INTO STRICT pack FROM public.ediel_rule_packs
 WHERE market='electricity' AND family='UTILTS' AND guide_version='25-A-5' AND guide_revision='5';
 UPDATE public.ediel_runtime_capabilities
 SET state_machine_ready=true,updated_at=now()
 WHERE rule_pack_id=pack AND direction='inbound' AND NOT state_machine_ready
  AND verification->>'source'='canonical-swedish-utilts25a5-projection'
  AND message_code IN ('E30','E72','E74','S01','S04','S06','S07');
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed NOT IN (0,7) THEN RAISE EXCEPTION 'ediel_u5_inbound_state_unexpected_rows:%',changed;END IF;
 IF EXISTS(SELECT FROM public.ediel_runtime_capabilities WHERE rule_pack_id=pack AND direction='inbound' AND NOT state_machine_ready)
 THEN RAISE EXCEPTION 'ediel_u5_inbound_state_incomplete';END IF;
END $u5_inbound_state$;
COMMIT;
