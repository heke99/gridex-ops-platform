-- CLI forward; preserve every installed ordinary source-owner body. H end is
-- qualified per OWN physical object; captured archive/reviewer/issuer bindings
-- remain mandatory for later billing, activation and immutable effect replay.
BEGIN;
CREATE FUNCTION gridex_bilateral_prodat.recorded_supply_current_v1(c uuid,s uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;r gridex_bilateral_prodat.supply_effect_receipts%rowtype;
 t gridex_received_sources.supply_source_transitions%rowtype;w jsonb;cap jsonb;own jsonb;seen text[]:=ARRAY[]::text[];key text;
BEGIN
 PERFORM gridex_bilateral_prodat.lock_supply_v1();
 SELECT * INTO m FROM public.ediel_messages WHERE company_id=c AND id=s;
 SELECT * INTO t FROM gridex_received_sources.supply_source_transitions WHERE company_id=c AND source_message_id=s;
 IF m.id IS NULL OR t.source_message_id IS NULL OR m.raw_payload IS NULL OR t.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RETURN false;END IF;
 PERFORM public.ediel_require_source_bytes_available_v1(c,s);
 SELECT * INTO r FROM gridex_bilateral_prodat.supply_effect_receipts WHERE company_id=c AND source_message_id=s;
 IF r.source_message_id IS NULL THEN RETURN NOT EXISTS(SELECT FROM jsonb_array_elements(t.source_objects) o WHERE o->>'reason'='Z25');END IF;
 IF r.environment IS DISTINCT FROM m.environment OR r.payload_hash IS DISTINCT FROM t.payload_hash
  OR r.transition_hash IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') THEN RETURN false;END IF;
 w:=gridex_received_sources.normal_switch_wire_v1(m.raw_payload);
 IF w IS NULL OR (w->>'code' IN('Z04','Z05')) IS NOT TRUE OR t.source_code IS DISTINCT FROM w->>'code'
  OR m.direction IS DISTINCT FROM 'inbound' OR m.message_family IS DISTINCT FROM 'PRODAT'
  OR jsonb_array_length(r.profiles) IS DISTINCT FROM (SELECT count(*) FROM jsonb_array_elements(t.source_objects) o WHERE o->>'reason'='Z25') THEN RETURN false;END IF;
 FOR cap IN SELECT p FROM jsonb_array_elements(r.profiles) p LOOP
  key:=jsonb_build_array(cap->>'objectId',cap->>'lineItemReference')::text;
  IF key=ANY(seen) OR cap->>'owner' IS DISTINCT FROM 'immutable-bilateral-prodat-profile-v1'
   OR cap->>'process' IS DISTINCT FROM (CASE w->>'code' WHEN 'Z04' THEN 'normal_start_h' WHEN 'Z05' THEN 'own_end_h' END)
   OR gridex_bilateral_prodat.recorded_profile_authority_v1((cap->>'profileVersionId')::uuid,c) IS NOT TRUE THEN RETURN false;END IF;
  seen:=array_append(seen,key);
  SELECT o INTO own FROM jsonb_array_elements(t.source_objects) o WHERE o->>'reason'='Z25' AND o->>'point'=cap->>'objectId' AND o->>'li'=cap->>'lineItemReference';
  IF own IS NULL OR (SELECT count(*) FROM jsonb_array_elements(w->'objects') o WHERE o=own)<>1 THEN RETURN false;END IF;
 END LOOP;
 RETURN true;
END$$;

CREATE FUNCTION gridex_bilateral_prodat.require_own_end_v1(m public.ediel_messages,w jsonb,o jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE cap jsonb;BEGIN
 IF w->>'code' IS DISTINCT FROM 'Z05' OR o->>'reason' IS DISTINCT FROM 'Z25' THEN RAISE EXCEPTION 'bilateral_h_end_physical_scope_required';END IF;
 cap:=gridex_bilateral_prodat.own_source_capability_v1(m,w,o);
 IF cap->>'owner' IS DISTINCT FROM 'immutable-bilateral-prodat-profile-v1' OR cap->>'process' IS DISTINCT FROM 'own_end_h'
  OR cap->>'objectId' IS DISTINCT FROM o->>'point' OR cap->>'lineItemReference' IS DISTINCT FROM o->>'li' THEN RAISE EXCEPTION 'bilateral_h_end_current_profile_required';END IF;
END$$;

-- Derive from the latest complete P12/national owner, rather than replacing it
-- with an abbreviated implementation. The H-only dispatcher cannot reach its
-- other grammar branches. Every own object is qualified before any effect.
DO $derive$
DECLARE d text;anchor text;baseline text;BEGIN
 d:=pg_get_functiondef('gridex_received_sources.apply_supply_before_legal_context_v1(uuid,uuid,uuid)'::regprocedure);
 anchor:='  ELSIF wire->>''code''=''Z05'' AND reason IN (''Z22'',''Z23'') THEN';
 IF position(anchor IN d)=0 OR position('regulated_supply_authentic_ground_required' IN d)=0
  OR position('z05_accepted_relationship_baseline_required' IN d)=0 OR position('z05_original_object_mismatch' IN d)=0
  OR position('INSERT INTO gridex_received_sources.supply_source_transitions' IN d)=0
  OR position('object#>>''{business,owner}'' IN (''inbound-z04-switch-confirmation-v1'',''reviewed-received-structure-v1'')' IN d)=0
  OR to_regprocedure('gridex_bilateral_prodat.confirm_h_end_v1(uuid,uuid,uuid)') IS NOT NULL THEN RAISE EXCEPTION 'bilateral_h_end_installed_owner_contract_changed';END IF;
 d:=replace(d,'CREATE OR REPLACE FUNCTION gridex_received_sources.apply_supply_before_legal_context_v1(','CREATE OR REPLACE FUNCTION gridex_bilateral_prodat.confirm_h_end_v1(');
 d:=replace(d,anchor,'  ELSIF wire->>''code''=''Z05'' AND reason IN (''Z22'',''Z23'',''Z25'') THEN');
 d:=replace(d,'o->>''reason'' IS DISTINCT FROM reason OR ','');
 d:=replace(d,' FOR own IN SELECT o FROM jsonb_array_elements(wire->''objects'') o ORDER BY o->>''point'' LOOP',E' FOR own IN SELECT o FROM jsonb_array_elements(wire->''objects'') o ORDER BY o->>''point'' LOOP\n  reason:=own->>''reason'';');
 baseline:=E'     EXISTS(SELECT FROM gridex_received_sources.normal_switch_confirmations confirmation WHERE confirmation.period_id=p.id AND confirmation.company_id=p.company_id AND confirmation.source_message_id=p.source_message_id AND confirmation.source_object->>''point''=own->>''point'' AND confirmation.source_object->>''identityAgency''=own->>''identityAgency'' AND confirmation.source_object->>''customerIdentity''=own->>''customerIdentity'' AND confirmation.source_object->>''gridArea''=own->>''gridArea'' AND confirmation.market_start_at<event_at AND gridex_received_sources.supply_period_source_basis_v1(p.company_id,p.id,event_at-interval ''1 minute'',event_at) IS NOT NULL) OR\n';
 d:=replace(d,E'     EXISTS(SELECT FROM gridex_received_sources.object_assessments assessment',baseline||'     EXISTS(SELECT FROM gridex_received_sources.object_assessments assessment');
 d:=replace(d,E'BEGIN\n',E'BEGIN\n PERFORM gridex_bilateral_prodat.lock_supply_v1();\n');
 EXECUTE d;
END $derive$;

-- The ordinary basis retains its OID/body/owner/security path. Add only the
-- captured H receipt guard, before messages or market rows can be locked.
DO $basis$
DECLARE d text;body text;anchor text;BEGIN
 d:=pg_get_functiondef('gridex_received_sources.supply_period_source_basis_v1(uuid,uuid,timestamptz,timestamptz)'::regprocedure);
 SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid='gridex_received_sources.supply_period_source_basis_v1(uuid,uuid,timestamptz,timestamptz)'::regprocedure;
 anchor:=' version:=p.market_state_version;source_id:=p.source_message_id;';
 IF position(anchor IN body)=0 OR position('initial_transition.payload_hash' IN body)=0 OR position('mixed_period_canonical_v1' IN body)=0 THEN RAISE EXCEPTION 'bilateral_supply_installed_initial_scope_contract_changed';END IF;
 body:=replace(body,E'BEGIN\n',E'BEGIN\n PERFORM gridex_bilateral_prodat.lock_supply_v1();\n');
 body:=replace(body,anchor,E' IF gridex_bilateral_prodat.recorded_supply_current_v1(p_company_id,proof.source_message_id) IS NOT TRUE THEN RETURN NULL;END IF;\n IF p.source_end_message_id IS NOT NULL AND gridex_bilateral_prodat.recorded_supply_current_v1(p_company_id,p.source_end_message_id) IS NOT TRUE THEN RETURN NULL;END IF;\n'||anchor);
 EXECUTE replace(d,(SELECT prosrc FROM pg_proc WHERE oid='gridex_received_sources.supply_period_source_basis_v1(uuid,uuid,timestamptz,timestamptz)'::regprocedure),body);
 SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid='public.activate_customer_supply_v1(uuid,uuid,uuid,date,uuid,text)'::regprocedure;
 anchor:=' PERFORM z.id FROM public.ediel_messages z WHERE z.company_id=p_company_id AND z.id=ANY(ARRAY[proof.source_message_id,proof.original_message_id]) ORDER BY z.id FOR UPDATE;';
 IF position(anchor IN body)=0 OR position('normal_supply_activation_immutable_confirmation_required' IN body)=0 THEN RAISE EXCEPTION 'bilateral_supply_installed_activation_contract_changed';END IF;
 d:=pg_get_functiondef('public.activate_customer_supply_v1(uuid,uuid,uuid,date,uuid,text)'::regprocedure);
 body:=replace(body,E'BEGIN\n',E'BEGIN\n PERFORM gridex_bilateral_prodat.lock_supply_v1();\n');
 body:=replace(body,anchor,E' IF gridex_bilateral_prodat.recorded_supply_current_v1(p_company_id,proof.source_message_id) IS NOT TRUE THEN RAISE EXCEPTION ''bilateral_supply_activation_recorded_profile_required'';END IF;\n'||anchor);
 EXECUTE replace(d,(SELECT prosrc FROM pg_proc WHERE oid='public.activate_customer_supply_v1(uuid,uuid,uuid,date,uuid,text)'::regprocedure),body);
END $basis$;

ALTER FUNCTION public.ediel_apply_supply_source_v1(uuid,uuid,uuid) SET SCHEMA gridex_bilateral_prodat;
ALTER FUNCTION gridex_bilateral_prodat.ediel_apply_supply_source_v1(uuid,uuid,uuid) RENAME TO apply_supply_before_h_end_v1;
REVOKE ALL ON FUNCTION gridex_bilateral_prodat.apply_supply_before_h_end_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ediel_apply_supply_source_v1(p_company_id uuid,p_source_message_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE m public.ediel_messages%rowtype;w jsonb;v_own jsonb;r jsonb;prior boolean;BEGIN
 PERFORM gridex_bilateral_prodat.lock_supply_v1();
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_source_message_id AND company_id=p_company_id FOR UPDATE;
 IF m.id IS NOT NULL THEN PERFORM public.ediel_require_source_bytes_available_v1(m.company_id,m.id);END IF;
 w:=gridex_received_sources.normal_switch_wire_v1(m.raw_payload);
 IF m.direction='inbound' AND m.message_family='PRODAT' AND EXISTS(SELECT FROM jsonb_array_elements(w->'objects') o WHERE o->>'reason'='Z25') THEN
  prior:=EXISTS(SELECT FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=m.id AND company_id=m.company_id);
  IF prior AND gridex_bilateral_prodat.recorded_supply_current_v1(m.company_id,m.id) IS NOT TRUE THEN RAISE EXCEPTION 'bilateral_supply_recorded_current_profile_required';END IF;
  IF w->>'code'='Z05' THEN
   IF EXISTS(SELECT FROM jsonb_array_elements(w->'objects') own WHERE(own->>'reason' IN('Z22','Z23','Z25')) IS NOT TRUE) THEN RETURN jsonb_build_object('applied',false,'reason','bilateral_h_end_whole_scope_required');END IF;
   IF NOT prior THEN FOR v_own IN SELECT own FROM jsonb_array_elements(w->'objects') own WHERE own->>'reason'='Z25' LOOP PERFORM gridex_bilateral_prodat.require_own_end_v1(m,w,v_own);END LOOP;END IF;
   r:=gridex_bilateral_prodat.confirm_h_end_v1(p_company_id,p_source_message_id,p_actor_user_id);
   IF r->>'applied'='true' AND NOT prior THEN PERFORM gridex_bilateral_prodat.record_supply_effect_v1(m);END IF;RETURN r;
  END IF;
 END IF;
 RETURN gridex_bilateral_prodat.apply_supply_before_h_end_v1(p_company_id,p_source_message_id,p_actor_user_id);
END$$;
REVOKE ALL ON FUNCTION gridex_bilateral_prodat.recorded_supply_current_v1(uuid,uuid),gridex_bilateral_prodat.require_own_end_v1(public.ediel_messages,jsonb,jsonb),gridex_bilateral_prodat.confirm_h_end_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.ediel_apply_supply_source_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_apply_supply_source_v1(uuid,uuid,uuid) TO service_role;
COMMIT;
