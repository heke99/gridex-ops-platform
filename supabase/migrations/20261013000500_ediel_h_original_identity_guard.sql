-- Source-confirmed H05 agency alias and H08 exact-LI fallback holes.
-- Preserve existing complete functions, argument/OID/ACL/auth metadata and all
-- bytes outside the two original guards and the two identical dispatch sites.
-- A recorded national operation classifies only its still-open exact period
-- cohort. Exact selector/matcher/currentness continue to authorize effects;
-- classification never invents legal/provider or ordinary-source authority.
BEGIN;
DO $forward$
DECLARE f record;before_metadata jsonb;expected_config text[];d text;next_body text;signature text;expected_before text;expected_after text;old_anchor text;new_anchor text;
BEGIN
 signature:='gridex_bilateral_prodat.confirm_h_end_v1(uuid,uuid,uuid)';expected_before:='aa3ad717c57558b1939381722e5319084477ff79f62233880abc3c4c037b5e1b';expected_after:='7525bf7588205fbbdfebf0eb98017a20c58a7d5daa2a22077db49b246b577905';
 SELECT p.*,pg_get_functiondef(p.oid) definition INTO f FROM pg_proc p WHERE p.oid=to_regprocedure(signature);
 IF f.oid IS NULL THEN RAISE EXCEPTION 'h_original_identity_predecessor_required:%',signature;END IF;
 expected_config:=CASE WHEN signature LIKE 'gridex_bilateral_prodat.%' THEN ARRAY['search_path=pg_catalog','TimeZone=UTC'] ELSE ARRAY['search_path=pg_catalog'] END;
 IF f.prokind<>'f' OR f.prorettype<>'jsonb'::regtype OR f.proretset OR f.proisstrict OR f.pronargs<>3 OR f.pronargdefaults<>0 OR f.proargnames IS DISTINCT FROM ARRAY['p_company_id','p_source_message_id','p_actor_user_id']::text[]
  OR f.proargtypes::text<>format('%s %s %s','uuid'::regtype::oid,'uuid'::regtype::oid,'uuid'::regtype::oid) OR f.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR NOT f.prosecdef OR f.provolatile<>'v' OR f.proparallel<>'u' OR f.proconfig IS DISTINCT FROM expected_config THEN RAISE EXCEPTION 'h_original_identity_predecessor_metadata_required:%',signature;END IF;
 before_metadata:=to_jsonb(f)-'prosrc'-'definition';
 IF encode(sha256(convert_to(f.prosrc,'UTF8')),'hex')=expected_after THEN NULL;
 ELSIF encode(sha256(convert_to(f.prosrc,'UTF8')),'hex')=expected_before THEN
  next_body:=f.prosrc;
  old_anchor:=$anchor$original:=gridex_received_sources.supply_wire_v1(origin.raw_payload);
   IF original IS NULL OR original->>'code' IS DISTINCT FROM 'Z04'$anchor$;new_anchor:=$replacement$original:=gridex_received_sources.normal_switch_wire_v1(origin.raw_payload);
   IF original IS NULL OR original->>'code' IS DISTINCT FROM 'Z04'$replacement$;
  IF (length(next_body)-length(replace(next_body,old_anchor,'')))/length(old_anchor)<>1 THEN RAISE EXCEPTION 'h_original_identity_exact_anchor_required:%',signature;END IF;
  next_body:=replace(next_body,old_anchor,new_anchor);
  old_anchor:=$anchor$o->>'point'=own->>'point' AND o->>'customerIdentity'=own->>'customerIdentity' AND o->>'gridArea'=own->>'gridArea' AND gridex_received_sources.permission_time_v1(o->>'start')<event_at$anchor$;new_anchor:=$replacement$o->>'point'=own->>'point' AND o->>'identityAgency'=own->>'identityAgency' AND o->>'customerIdentity'=own->>'customerIdentity' AND o->>'gridArea'=own->>'gridArea' AND gridex_received_sources.permission_time_v1(o->>'start')<event_at$replacement$;
  IF (length(next_body)-length(replace(next_body,old_anchor,'')))/length(old_anchor)<>1 THEN RAISE EXCEPTION 'h_original_identity_exact_anchor_required:%',signature;END IF;
  next_body:=replace(next_body,old_anchor,new_anchor);
  IF encode(sha256(convert_to(next_body,'UTF8')),'hex')<>expected_after THEN RAISE EXCEPTION 'h_original_identity_postimage_required:%',signature;END IF;
  IF (length(f.definition)-length(replace(f.definition,f.prosrc,'')))/length(f.prosrc)<>1 THEN RAISE EXCEPTION 'h_original_identity_exact_definition_required:%',signature;END IF;
  d:=replace(f.definition,f.prosrc,next_body);EXECUTE d;
 ELSE RAISE EXCEPTION 'h_original_identity_unrecognized_preimage:%',signature;END IF;
 SELECT p.*,pg_get_functiondef(p.oid) definition INTO f FROM pg_proc p WHERE p.oid=to_regprocedure(signature);
 IF encode(sha256(convert_to(f.prosrc,'UTF8')),'hex')<>expected_after OR to_jsonb(f)-'prosrc'-'definition' IS DISTINCT FROM before_metadata THEN RAISE EXCEPTION 'h_original_identity_metadata_or_output_changed:%',signature;END IF;
 signature:='public.ediel_apply_supply_source_v1(uuid,uuid,uuid)';expected_before:='a56f7b44a37144e73ea61d91fb27ffb46e3b091b8064bd5c20b940a9431a2165';expected_after:='c726675206f198c1fe2c6959ba2c5d2529c37c936963087dafffe936ab9f9230';
 SELECT p.*,pg_get_functiondef(p.oid) definition INTO f FROM pg_proc p WHERE p.oid=to_regprocedure(signature);
 IF f.oid IS NULL THEN RAISE EXCEPTION 'h_original_identity_predecessor_required:%',signature;END IF;
 expected_config:=CASE WHEN signature LIKE 'gridex_bilateral_prodat.%' THEN ARRAY['search_path=pg_catalog','TimeZone=UTC'] ELSE ARRAY['search_path=pg_catalog'] END;
 IF f.prokind<>'f' OR f.prorettype<>'jsonb'::regtype OR f.proretset OR f.proisstrict OR f.pronargs<>3 OR f.pronargdefaults<>0 OR f.proargnames IS DISTINCT FROM ARRAY['p_company_id','p_source_message_id','p_actor_user_id']::text[]
  OR f.proargtypes::text<>format('%s %s %s','uuid'::regtype::oid,'uuid'::regtype::oid,'uuid'::regtype::oid) OR f.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR NOT f.prosecdef OR f.provolatile<>'v' OR f.proparallel<>'u' OR f.proconfig IS DISTINCT FROM expected_config THEN RAISE EXCEPTION 'h_original_identity_predecessor_metadata_required:%',signature;END IF;
 before_metadata:=to_jsonb(f)-'prosrc'-'definition';
 IF encode(sha256(convert_to(f.prosrc,'UTF8')),'hex')=expected_after THEN NULL;
 ELSIF encode(sha256(convert_to(f.prosrc,'UTF8')),'hex')=expected_before THEN
  next_body:=f.prosrc;
  old_anchor:=$anchor$gridex_supply_rescission.has_end_selector_v1(m,o)$anchor$;new_anchor:=$replacement$(gridex_supply_rescission.has_end_selector_v1(m,o) OR (
    o->>'reason'='Z22' AND EXISTS(
     SELECT FROM gridex_supply_rescission.outbound_operations recorded
     JOIN gridex_supply_rescission.mandates legal ON legal.id=recorded.mandate_id AND legal.company_id=recorded.company_id AND legal.environment=recorded.environment
     JOIN public.ediel_messages saved_request ON saved_request.id=recorded.message_id AND saved_request.company_id=recorded.company_id AND saved_request.environment=recorded.environment
     JOIN public.customer_supply_periods pending_period ON pending_period.id::text=legal.scope->>'periodId' AND pending_period.company_id=legal.company_id
     WHERE recorded.company_id=m.company_id AND recorded.environment=m.environment
      AND saved_request.direction='outbound' AND saved_request.message_family='PRODAT' AND saved_request.message_code='Z08'
      AND saved_request.source_operation_id=legal.id::text AND saved_request.immutable_payload_hash=recorded.payload_hash
      AND recorded.capability#>>'{objects,0,objectId}'=o->>'point' AND recorded.capability#>>'{objects,0,identityAgency}'=o->>'identityAgency'
      AND legal.scope->>'externalPoint'=o->>'point' AND legal.scope->>'identityAgency'=o->>'identityAgency'
      AND pending_period.customer_id::text=legal.scope->>'customerId' AND pending_period.metering_point_id::text=legal.scope->>'pointId'
      AND pending_period.market_state_version::text=legal.scope->>'stateVersion'
      AND pending_period.source_end_message_id IS NULL AND pending_period.market_end_at IS NULL
    )))$replacement$;
  IF (length(next_body)-length(replace(next_body,old_anchor,'')))/length(old_anchor)<>2 THEN RAISE EXCEPTION 'h_original_identity_exact_anchor_required:%',signature;END IF;
  next_body:=replace(next_body,old_anchor,new_anchor);
  IF encode(sha256(convert_to(next_body,'UTF8')),'hex')<>expected_after THEN RAISE EXCEPTION 'h_original_identity_postimage_required:%',signature;END IF;
  IF (length(f.definition)-length(replace(f.definition,f.prosrc,'')))/length(f.prosrc)<>1 THEN RAISE EXCEPTION 'h_original_identity_exact_definition_required:%',signature;END IF;
  d:=replace(f.definition,f.prosrc,next_body);EXECUTE d;
 ELSE RAISE EXCEPTION 'h_original_identity_unrecognized_preimage:%',signature;END IF;
 SELECT p.*,pg_get_functiondef(p.oid) definition INTO f FROM pg_proc p WHERE p.oid=to_regprocedure(signature);
 IF encode(sha256(convert_to(f.prosrc,'UTF8')),'hex')<>expected_after OR to_jsonb(f)-'prosrc'-'definition' IS DISTINCT FROM before_metadata THEN RAISE EXCEPTION 'h_original_identity_metadata_or_output_changed:%',signature;END IF;
END
$forward$;
COMMIT;
