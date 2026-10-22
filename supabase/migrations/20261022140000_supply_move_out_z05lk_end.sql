-- FINDINGS H7 (reality scenario H, owner decision 2026-10-22): an ordinary move-out notice from the grid
-- owner never ended our supply.
--
-- When a new customer moves in at the facility with another supplier, the grid owner sends the losing
-- supplier PRODAT Z05 with transaction reason Z23 (LK, change of customer and supplier). Two places treated
-- EVERY Z05 that carries a Z23 object as our own bilateral LK closure (20261001085523):
--   1. gridex_supply_rescission.apply_supply_before_rescission_v1 routed it to the bilateral closure owner,
--      which requires our own sent Z08 LK (gridex_bilateral_prodat.matched_closure_operation_v1) and otherwise
--      raises bilateral_closure_exact_sent_original_required. The reception rolled back and held the source:
--      the period stayed open, the contract signed, no final-invoice follow-up; billing went on after the move.
--   2. The positive-ACK authority guards (ediel_require_prodat_bilateral_positive_source_v1 and
--      ediel_require_recorded_prodat_bilateral_ack_source_v1) demanded a bilateral capability for it, so no
--      APERAK could be sent for an ordinary end.
-- The ordinary independent end (gridex_received_sources.apply_supply_before_legal_context_v1, plan 'end')
-- already handles reason Z22 AND Z23 on the accepted Z04 baseline of the period; it was unreachable for Z23.
--
-- Now:
--   * The bilateral closure branch is taken only when it owns the source: a replay of a source it already
--     recorded (gridex_bilateral_prodat.closure_end_receipts), or a Z23 object that matches our own actually
--     sent Z08 LK closure operation. Every other Z05 falls through unchanged to the next owner in the chain,
--     so an ordinary move-out notice ends the period through the same qualified path as a switch-away notice
--     (accepted baseline, exact customer identity, grid area and legal parties; replay is idempotent).
--   * The ACK guards exempt exactly a Z05 Z23 whose recorded effect is that ordinary end:
--     gridex_bilateral_prodat.ordinary_z05_end_v1 = its supply transition exists for the exact received bytes
--     and no bilateral closure receipt exists. Before any effect, and for our own closures, the bilateral
--     authority is required exactly as before.
-- Body rewrites with predecessor guards; owners, ACLs, configuration and every other line are unchanged.
BEGIN;

CREATE FUNCTION gridex_bilateral_prodat.ordinary_z05_end_v1(m public.ediel_messages) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT m.message_family='PRODAT' AND m.message_code='Z05' AND m.direction='inbound'
  AND EXISTS(SELECT FROM gridex_received_sources.supply_source_transitions t WHERE t.source_message_id=m.id AND t.company_id=m.company_id
   AND t.source_code='Z05' AND t.payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'))
  AND NOT EXISTS(SELECT FROM gridex_bilateral_prodat.closure_end_receipts recorded WHERE recorded.company_id=m.company_id AND recorded.source_message_id=m.id)
$$;
REVOKE ALL ON FUNCTION gridex_bilateral_prodat.ordinary_z05_end_v1(public.ediel_messages) FROM PUBLIC,anon,authenticated,service_role;

DO $h7$DECLARE f record;body text;
 closure_needle CONSTANT text:=$n$ IF m.direction='inbound' AND m.message_family='PRODAT' AND w->>'code'='Z05' AND EXISTS(SELECT FROM jsonb_array_elements(w->'objects') o WHERE o->>'reason'='Z23') THEN$n$;
 closure_replacement CONSTANT text:=$n$ IF m.direction='inbound' AND m.message_family='PRODAT' AND w->>'code'='Z05' AND EXISTS(SELECT FROM jsonb_array_elements(w->'objects') o WHERE o->>'reason'='Z23')
  -- H7: only a closure this owner recorded, or one that matches our own sent Z08 LK, belongs here.
  AND (EXISTS(SELECT FROM gridex_bilateral_prodat.closure_end_receipts recorded WHERE recorded.company_id=m.company_id AND recorded.source_message_id=m.id)
   OR EXISTS(SELECT FROM jsonb_array_elements(w->'objects') o WHERE o->>'reason'='Z23' AND gridex_bilateral_prodat.matched_closure_operation_v1(m,w,o) IS NOT NULL)) THEN$n$;
 object_needle CONSTANT text:=$n$wire->>'code'='Z05' AND o->>'reason'='Z23'$n$;
 object_replacement CONSTANT text:=$n$wire->>'code'='Z05' AND o->>'reason'='Z23' AND gridex_bilateral_prodat.ordinary_z05_end_v1(m) IS NOT TRUE$n$;
 own_needle CONSTANT text:=$n$wire->>'code'='Z05' AND own->>'reason'='Z23'$n$;
 own_replacement CONSTANT text:=$n$wire->>'code'='Z05' AND own->>'reason'='Z23' AND gridex_bilateral_prodat.ordinary_z05_end_v1(m) IS NOT TRUE$n$;
BEGIN
 -- 1. Source owner chain.
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p
  WHERE oid='gridex_supply_rescission.apply_supply_before_rescission_v1(uuid,uuid,uuid)'::regprocedure;
 IF (length(f.prosrc)-length(replace(f.prosrc,closure_needle,'')))/length(closure_needle)<>1 THEN RAISE EXCEPTION 'supply_move_out_closure_predecessor_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,closure_needle,closure_replacement));
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'supply_move_out_closure_metadata_changed';END IF;
 -- 2. Positive-ACK authority for a new reply.
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p
  WHERE oid='public.ediel_require_prodat_bilateral_positive_source_v1(uuid,uuid)'::regprocedure;
 IF (length(f.prosrc)-length(replace(f.prosrc,object_needle,'')))/length(object_needle)<>1
  OR (length(f.prosrc)-length(replace(f.prosrc,own_needle,'')))/length(own_needle)<>1 THEN RAISE EXCEPTION 'supply_move_out_positive_source_predecessor_required';END IF;
 body:=replace(replace(f.prosrc,object_needle,object_replacement),own_needle,own_replacement);
 EXECUTE replace(f.definition,f.prosrc,body);
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'supply_move_out_positive_source_metadata_changed';END IF;
 -- 3. Recorded ACK authority for replay/duplicate replies.
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p
  WHERE oid='public.ediel_require_recorded_prodat_bilateral_ack_source_v1(uuid,uuid,text)'::regprocedure;
 IF (length(f.prosrc)-length(replace(f.prosrc,object_needle,'')))/length(object_needle)<>1 THEN RAISE EXCEPTION 'supply_move_out_recorded_source_predecessor_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,object_needle,object_replacement));
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'supply_move_out_recorded_source_metadata_changed';END IF;
END$h7$;
COMMIT;
