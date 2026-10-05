-- CLI forward. A documented H transitions profile extends exactly its OWN
-- physical source. Ordinary national normal/mixed source owners remain intact.
BEGIN;
CREATE TABLE gridex_bilateral_prodat.supply_effect_receipts(
 source_message_id uuid PRIMARY KEY REFERENCES public.ediel_messages(id),company_id uuid NOT NULL REFERENCES public.companies(id),environment text NOT NULL,
 payload_hash text NOT NULL CHECK(payload_hash~'^[a-f0-9]{64}$'),profiles jsonb NOT NULL CHECK(jsonb_typeof(profiles)='array' AND jsonb_array_length(profiles)>0),
 transition_hash text NOT NULL CHECK(transition_hash~'^[a-f0-9]{64}$'),recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE gridex_bilateral_prodat.supply_effect_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_bilateral_prodat.supply_effect_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_bilateral_prodat.supply_effect_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER bilateral_supply_receipt_immutable BEFORE UPDATE OR DELETE ON gridex_bilateral_prodat.supply_effect_receipts FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();
CREATE TRIGGER bilateral_supply_receipt_no_truncate BEFORE TRUNCATE ON gridex_bilateral_prodat.supply_effect_receipts FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();

CREATE FUNCTION gridex_bilateral_prodat.lock_supply_v1() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();PERFORM gridex_bilateral_prodat.lock_source_receipts_v1();
 LOCK TABLE gridex_bilateral_prodat.supply_effect_receipts IN SHARE ROW EXCLUSIVE MODE;
END$$;

CREATE FUNCTION gridex_bilateral_prodat.require_own_start_v1(m public.ediel_messages,whole_wire jsonb,own jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE capability jsonb;
BEGIN
 IF whole_wire->>'code' IS DISTINCT FROM 'Z04' OR own->>'reason' IS DISTINCT FROM 'Z25' THEN RAISE EXCEPTION 'bilateral_h_start_physical_scope_required';END IF;
 capability:=gridex_bilateral_prodat.own_source_capability_v1(m,whole_wire,own);
 IF capability->>'owner' IS DISTINCT FROM 'immutable-bilateral-prodat-profile-v1' OR capability->>'process' IS DISTINCT FROM 'normal_start_h'
  OR capability->>'objectId' IS DISTINCT FROM own->>'point' OR capability->>'lineItemReference' IS DISTINCT FROM own->>'li'
 THEN RAISE EXCEPTION 'bilateral_h_start_current_profile_required';END IF;
END$$;

-- Derive the private H implementation from the ACTUAL installed native
-- checker, including later independent source/contract guards. The only
-- permitted grammar delta is Z25; profile authority is required per own object.
-- No raw source is rewritten and no ordinary national guard is weakened.
DO $derive$
DECLARE definition text;name text;target text;anchor text;qualification text;
BEGIN
 FOREACH name IN ARRAY ARRAY['normal_switch_confirm_v1','normal_switch_confirm_mixed_v1'] LOOP
  target:=CASE name WHEN 'normal_switch_confirm_v1' THEN 'confirm_h_start_v1' ELSE 'confirm_h_start_mixed_v1' END;
  definition:=pg_get_functiondef(('gridex_received_sources.'||name||'(uuid,uuid,uuid)')::regprocedure);
  anchor:=' -- Discover all original rows first.';
  IF position(anchor IN definition)=0
   OR (length(definition)-length(replace(definition,'(o->>''reason'' IN(''Z22'',''Z23''))','')))/length('(o->>''reason'' IN(''Z22'',''Z23''))')<>1
   OR position('normal_z04_owned_signed_contract_scope_required' IN definition)=0
   OR position('normal_z04_exact_sent_original_required' IN definition)=0
   OR position('normal_z04_register_owner_scope_required' IN definition)=0
   OR position('INSERT INTO gridex_received_sources.supply_source_transitions' IN definition)=0
   OR to_regprocedure('gridex_bilateral_prodat.'||target||'(uuid,uuid,uuid)') IS NOT NULL
  THEN RAISE EXCEPTION 'bilateral_h_start_owner_derivation_changed:%',name;END IF;
  definition:=replace(definition,'CREATE OR REPLACE FUNCTION gridex_received_sources.'||name||'(','CREATE OR REPLACE FUNCTION gridex_bilateral_prodat.'||target||'(');
  definition:=replace(definition,'(o->>''reason'' IN(''Z22'',''Z23''))','(o->>''reason'' IN(''Z22'',''Z23'',''Z25''))');
  qualification:=' FOR own IN SELECT o FROM jsonb_array_elements(wire->''objects'') o WHERE o->>''reason''=''Z25'' LOOP PERFORM gridex_bilateral_prodat.require_own_start_v1(m,'||CASE name WHEN 'normal_switch_confirm_v1' THEN 'wire' ELSE 'whole_wire' END||',own);END LOOP;';
  definition:=replace(definition,anchor,qualification||E'\n'||anchor);
  -- This private checker may only be reached after the common graph prefix.
  definition:=replace(definition,E'BEGIN\n',E'BEGIN\n PERFORM gridex_bilateral_prodat.lock_supply_v1();\n');
  EXECUTE definition;
 END LOOP;
END $derive$;

CREATE FUNCTION gridex_bilateral_prodat.record_supply_effect_v1(m public.ediel_messages) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tr gridex_received_sources.supply_source_transitions%rowtype;prior gridex_bilateral_prodat.supply_effect_receipts%rowtype;wire jsonb;own jsonb;profiles jsonb:='[]';cap jsonb;
BEGIN
 SELECT * INTO tr FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=m.id AND company_id=m.company_id;
 IF tr.source_message_id IS NULL OR tr.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'bilateral_supply_actual_transition_required';END IF;
 wire:=gridex_received_sources.normal_switch_wire_v1(m.raw_payload);
 FOR own IN SELECT o FROM jsonb_array_elements(tr.source_objects)o WHERE o->>'reason'='Z25' LOOP
  cap:=gridex_bilateral_prodat.own_source_capability_v1(m,wire,own);
  IF cap->>'owner' IS DISTINCT FROM 'immutable-bilateral-prodat-profile-v1' THEN RAISE EXCEPTION 'bilateral_supply_current_own_profile_required';END IF;
  profiles:=profiles||jsonb_build_array(cap);
 END LOOP;
 IF jsonb_array_length(profiles)=0 THEN RAISE EXCEPTION 'bilateral_supply_actual_objects_required';END IF;
 SELECT * INTO prior FROM gridex_bilateral_prodat.supply_effect_receipts WHERE source_message_id=m.id;
 IF FOUND THEN
  IF prior.company_id IS DISTINCT FROM m.company_id OR prior.environment IS DISTINCT FROM m.environment OR prior.payload_hash IS DISTINCT FROM tr.payload_hash
   OR prior.profiles IS DISTINCT FROM profiles OR prior.transition_hash IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(tr)::text,'UTF8')),'hex') THEN RAISE EXCEPTION 'bilateral_supply_replay_conflict';END IF;RETURN;
 END IF;
 INSERT INTO gridex_bilateral_prodat.supply_effect_receipts VALUES(m.id,m.company_id,m.environment,tr.payload_hash,profiles,encode(sha256(convert_to(to_jsonb(tr)::text,'UTF8')),'hex'),clock_timestamp());
 INSERT INTO public.audit_logs(company_id,actor_user_id,action,entity_type,entity_id,details)
 VALUES(m.company_id,tr.actor_user_id,'ediel.bilateral_profile.supply_applied','ediel_message',m.id,jsonb_build_object('sourcePayloadHash',tr.payload_hash,'ownProfiles',profiles,'resultingStates',tr.resulting_states));
END$$;

-- Preserve the public predecessor's OID, owner, security configuration and ACL
-- under its private name. Ordinary source processing still calls its full body.
ALTER FUNCTION public.ediel_apply_supply_source_v1(uuid,uuid,uuid) SET SCHEMA gridex_bilateral_prodat;
ALTER FUNCTION gridex_bilateral_prodat.ediel_apply_supply_source_v1(uuid,uuid,uuid) RENAME TO apply_supply_before_h_v1;
REVOKE ALL ON FUNCTION gridex_bilateral_prodat.apply_supply_before_h_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ediel_apply_supply_source_v1(p_company_id uuid,p_source_message_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE m public.ediel_messages%rowtype;wire jsonb;result jsonb;assessment gridex_received_sources.validation_assessments%rowtype;
BEGIN
 PERFORM gridex_bilateral_prodat.lock_supply_v1();
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_source_message_id AND company_id=p_company_id FOR UPDATE;
 IF m.id IS NOT NULL THEN PERFORM public.ediel_require_source_bytes_available_v1(m.company_id,m.id);END IF;
 wire:=gridex_received_sources.normal_switch_wire_v1(m.raw_payload);
 IF m.direction='inbound' AND m.message_family='PRODAT' AND wire->>'code'='Z04'
  AND EXISTS(SELECT FROM jsonb_array_elements(wire->'objects')o WHERE o->>'reason'='Z25') THEN
  PERFORM public.ediel_require_source_bytes_available_v1(m.company_id,m.id);
  SELECT * INTO assessment FROM gridex_received_sources.validation_assessments a WHERE a.source_message_id=m.id AND a.company_id=m.company_id AND a.environment=m.environment
   AND a.source_payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=a.id);
  IF assessment.facts_text::jsonb->>'applicationDecision'='rejected' THEN result:=gridex_bilateral_prodat.confirm_h_start_mixed_v1(p_company_id,p_source_message_id,p_actor_user_id);
  ELSE result:=gridex_bilateral_prodat.confirm_h_start_v1(p_company_id,p_source_message_id,p_actor_user_id);END IF;
  IF result->>'applied'='true' THEN PERFORM gridex_bilateral_prodat.record_supply_effect_v1(m);END IF;
  RETURN result;
 END IF;
 RETURN gridex_bilateral_prodat.apply_supply_before_h_v1(p_company_id,p_source_message_id,p_actor_user_id);
END$$;
-- The existing mixed reader must dispatch from the stored physical source,
-- then read its actual private outcome/outbox. Ordinary L/LK bodies stay intact.
CREATE FUNCTION gridex_bilateral_prodat.dispatch_mixed_start_v1(c uuid,source_id uuid,actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;wire jsonb;
BEGIN
 PERFORM gridex_bilateral_prodat.lock_supply_v1();
 SELECT * INTO m FROM public.ediel_messages WHERE id=source_id AND company_id=c FOR SHARE;
 wire:=gridex_received_sources.normal_switch_wire_v1(m.raw_payload);
 IF EXISTS(SELECT FROM jsonb_array_elements(wire->'objects')o WHERE o->>'reason'='Z25') THEN RETURN public.ediel_apply_supply_source_v1(c,source_id,actor);END IF;
 RETURN gridex_received_sources.normal_switch_confirm_mixed_v1(c,source_id,actor);
END$$;
DO $mixed_ports$
DECLARE definition text;name text;needle text:='gridex_received_sources.normal_switch_confirm_mixed_v1(p_company_id,p_source_message_id,p_actor_user_id)';
BEGIN
 FOREACH name IN ARRAY ARRAY['ediel_process_prodat_mixed_z04_v1','ediel_read_prodat_mixed_reply_v1'] LOOP
  definition:=pg_get_functiondef(('public.'||name||'(uuid,uuid,uuid)')::regprocedure);
  IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'bilateral_h_mixed_actual_reader_contract_changed:%',name;END IF;
  EXECUTE replace(definition,needle,'gridex_bilateral_prodat.dispatch_mixed_start_v1(p_company_id,p_source_message_id,p_actor_user_id)');
 END LOOP;
END $mixed_ports$;
REVOKE ALL ON FUNCTION gridex_bilateral_prodat.dispatch_mixed_start_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION gridex_bilateral_prodat.lock_supply_v1(),gridex_bilateral_prodat.require_own_start_v1(public.ediel_messages,jsonb,jsonb),gridex_bilateral_prodat.confirm_h_start_v1(uuid,uuid,uuid),gridex_bilateral_prodat.confirm_h_start_mixed_v1(uuid,uuid,uuid),gridex_bilateral_prodat.record_supply_effect_v1(public.ediel_messages) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.ediel_apply_supply_source_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_apply_supply_source_v1(uuid,uuid,uuid) TO service_role;
COMMIT;
