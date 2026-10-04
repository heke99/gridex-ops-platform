-- public.ediel_require_switch_original_current_v1 guards every outbound Z03 at
-- transport. It knows only the national normal-switch original (reasons
-- Z22/Z23, gridex_received_sources.switch_originals), so a bilateral H start
-- (Z03/H, reason Z25) produced by the bilateral PRODAT owner (20261001031053,
-- recorded in gridex_bilateral_prodat.outbound_operations) always failed with
-- switch_original_current_source_required and could never be sent.
--
-- A Z03 whose wire requires the bilateral outbound owner
-- (gridex_bilateral_prodat.outbound_required_v1) is now delegated to that
-- owner's current read (public.ediel_read_bilateral_prodat_outbound_original_v1),
-- which re-requires the source bytes and the recorded outbound original. It must
-- return the recorded capability; otherwise the send is refused. National Z03
-- handling is unchanged.
--
-- The transport guards for the signed requested method and the BRP source
-- (gridex_received_sources.require_switch_contract_request_current_v1 /
-- require_switch_brp_source_current_v1) need their bindings, which only the
-- national bind chain created. public.ediel_bind_switch_original_v1 now creates
-- the same two bindings when it binds a bilateral H original, so both guards
-- apply to H starts unchanged.
BEGIN;
DO $owner$DECLARE f record;
 needle CONSTANT text:=$n$ IF w IS NOT NULL AND w#>>'{objects,0,reason}'='Z24' THEN RETURN;END IF;$n$;
 replacement CONSTANT text:=$n$ IF w IS NOT NULL AND w#>>'{objects,0,reason}'='Z24' THEN RETURN;END IF;
 IF gridex_bilateral_prodat.outbound_required_v1(m.raw_payload) IS TRUE THEN
  IF public.ediel_read_bilateral_prodat_outbound_original_v1(m.company_id,m.id) IS NULL THEN RAISE EXCEPTION 'switch_original_current_source_required';END IF;
  RETURN;
 END IF;$n$;
BEGIN
 IF to_regprocedure('gridex_bilateral_prodat.outbound_required_v1(text)') IS NULL OR to_regprocedure('public.ediel_read_bilateral_prodat_outbound_original_v1(uuid,uuid)') IS NULL THEN RAISE EXCEPTION 'switch_original_bilateral_owner_predecessor_required';END IF;
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='public.ediel_require_switch_original_current_v1(uuid,uuid)'::regprocedure;
 IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'switch_original_bilateral_owner_predecessor_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,replacement));
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'switch_original_bilateral_owner_metadata_changed';END IF;
END$owner$;
DO $bind$DECLARE f record;
 needle CONSTANT text:=$n$THEN RETURN gridex_bilateral_prodat.bind_switch_h_v1(p_company_id,p_switch_id,p_message_id,p_actor_user_id);END IF;$n$;
 replacement CONSTANT text:=$n$THEN
  result:=gridex_bilateral_prodat.bind_switch_h_v1(p_company_id,p_switch_id,p_message_id,p_actor_user_id);
  -- Same first-effect bindings as the national original: the signed requested
  -- method and the BRP source are bound with the H original, so the transport
  -- guards requalify them before every send.
  IF result->>'status'='bound' AND result->>'idempotent' IS DISTINCT FROM 'true' THEN
   PERFORM gridex_received_sources.bind_switch_contract_request_v1(p_company_id,p_message_id,p_actor_user_id);
   PERFORM gridex_received_sources.bind_switch_brp_source_v1(p_company_id,p_message_id,p_actor_user_id);
  END IF;
  RETURN result;
 END IF;$n$;
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='public.ediel_bind_switch_original_v1(uuid,uuid,uuid,uuid)'::regprocedure;
 IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 OR position('DECLARE m public.ediel_messages%rowtype;' in f.prosrc)=0 THEN RAISE EXCEPTION 'switch_h_binding_predecessor_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,replace(replace(f.prosrc,'DECLARE m public.ediel_messages%rowtype;','DECLARE m public.ediel_messages%rowtype;result jsonb;'),needle,replacement));
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'switch_h_binding_metadata_changed';END IF;
END$bind$;
COMMIT;
