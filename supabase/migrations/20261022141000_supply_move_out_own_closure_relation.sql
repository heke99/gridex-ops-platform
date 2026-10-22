-- FINDINGS H7 follow-up (owner rule 2026-10-22): a move-out notice that relates to our own Z08 LK closure
-- must match it exactly; only a move-out notice unrelated to any own closure ends the period ordinarily.
--
-- 20261022140000 sent a Z05 LK (CAV Z23) to the bilateral closure owner only when it matched our own SENT
-- Z08 LK. A Z05 LK that relates to our own closure but does not match it (wrong LI, wrong end minute, or an
-- original that was never sent) then fell through to the ordinary end and ended the period. That broke the
-- approved AT-Z08LK-SUPPLIER/P-16 behaviour (scripts/ediel-at-z08lk-supplier-native.test.ts wrong LI / wrong
-- end minute, scripts/ediel-bilateral-prodat-h-original-native.test.ts unsent LK original): such a source is
-- held with no effect.
--
-- Rule now (gridex_bilateral_prodat.z05_closure_owned_v1, used by the source chain):
--   the bilateral closure owner owns a Z05 when it already recorded the source, or when any Z23 object
--     * matches our own sent Z08 LK closure operation exactly (gridex_bilateral_prodat.matched_closure_operation_v1), or
--     * relates to an own Z08 LK (gridex_bilateral_prodat.related_own_closure_v1):
--         - an own Z08 LK original of the tenant and environment, sent or unsent, carries the object's LI, or
--         - an own closure operation exists for the same physical metering point whose period has not
--           received an end yet (sent or unsent original).
--   The owner requires every Z23 object to match exactly and otherwise raises
--   bilateral_closure_exact_sent_original_required: the reception rolls back and holds the source.
--   Every other Z05 LK (no own closure at all) ends the period through the ordinary qualified path (H7).
-- The ACK guards stay consistent without change: gridex_bilateral_prodat.ordinary_z05_end_v1 is true only
-- for a source the ordinary path actually ended (its supply transition exists and no closure receipt), so a
-- held related source keeps requiring the bilateral authority, exactly as before H7.
-- Tenant and environment scope on every relation. Body rewrite with a predecessor guard on the exact
-- 20261022140000 condition; owner, ACL, configuration and every other line are unchanged.
BEGIN;

CREATE FUNCTION gridex_bilateral_prodat.related_own_closure_v1(m public.ediel_messages, own jsonb) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT own->>'reason'='Z23' AND (
  -- An own Z08 LK original (sent or unsent) that carries this LI.
  EXISTS(SELECT FROM gridex_bilateral_prodat.outbound_operations sealed
   JOIN public.ediel_messages original ON original.id=sealed.message_id AND original.company_id=sealed.company_id AND original.environment=sealed.environment
   WHERE sealed.company_id=m.company_id AND sealed.environment=m.environment AND original.direction='outbound' AND original.message_family='PRODAT' AND original.message_code='Z08'
    AND nullif(own->>'li','') IS NOT NULL AND sealed.capability#>>'{objects,0,lineItemReference}'=own->>'li')
  -- An own closure operation for the same physical point whose period has not received an end.
  OR EXISTS(SELECT FROM gridex_bilateral_prodat.closure_operations operation
   JOIN public.customer_supply_periods period ON period.id=operation.period_id AND period.company_id=operation.company_id
   JOIN public.metering_points point ON point.id=period.metering_point_id AND point.company_id=period.company_id
   WHERE operation.company_id=m.company_id AND operation.environment=m.environment AND period.source_end_message_id IS NULL
    AND nullif(own->>'point','') IS NOT NULL AND coalesce(point.ediel_metering_point_id,point.metering_point_id)=own->>'point'))
$$;

CREATE FUNCTION gridex_bilateral_prodat.z05_closure_owned_v1(m public.ediel_messages, w jsonb) RETURNS boolean
LANGUAGE sql SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT FROM gridex_bilateral_prodat.closure_end_receipts recorded WHERE recorded.company_id=m.company_id AND recorded.source_message_id=m.id)
  OR EXISTS(SELECT FROM jsonb_array_elements(w->'objects') o WHERE o->>'reason'='Z23'
   AND (gridex_bilateral_prodat.related_own_closure_v1(m,o) OR gridex_bilateral_prodat.matched_closure_operation_v1(m,w,o) IS NOT NULL))
$$;
REVOKE ALL ON FUNCTION gridex_bilateral_prodat.related_own_closure_v1(public.ediel_messages,jsonb),gridex_bilateral_prodat.z05_closure_owned_v1(public.ediel_messages,jsonb)
 FROM PUBLIC,anon,authenticated,service_role;

DO $h7b$DECLARE f record;
 needle CONSTANT text:=$n$
  -- H7: only a closure this owner recorded, or one that matches our own sent Z08 LK, belongs here.
  AND (EXISTS(SELECT FROM gridex_bilateral_prodat.closure_end_receipts recorded WHERE recorded.company_id=m.company_id AND recorded.source_message_id=m.id)
   OR EXISTS(SELECT FROM jsonb_array_elements(w->'objects') o WHERE o->>'reason'='Z23' AND gridex_bilateral_prodat.matched_closure_operation_v1(m,w,o) IS NOT NULL)) THEN$n$;
 replacement CONSTANT text:=$n$
  -- H7: the closure owner owns a Z05 it recorded, or one that matches or relates to our own Z08 LK (it must
  -- then match exactly or is held); only a Z05 LK unrelated to any own closure takes the ordinary end.
  AND gridex_bilateral_prodat.z05_closure_owned_v1(m,w) THEN$n$;
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p
  WHERE oid='gridex_supply_rescission.apply_supply_before_rescission_v1(uuid,uuid,uuid)'::regprocedure;
 IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'supply_move_out_relation_predecessor_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,replacement));
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'supply_move_out_relation_metadata_changed';END IF;
END$h7b$;
COMMIT;
