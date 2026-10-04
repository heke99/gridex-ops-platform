-- CALL03/P11: a normal switch's first outbound original is the actual rendered
-- own intent, never a guessed LI or a later ACK. No supply is approved here.
BEGIN;
CREATE TABLE gridex_received_sources.switch_originals(
 message_id uuid PRIMARY KEY REFERENCES public.ediel_messages(id),company_id uuid NOT NULL REFERENCES public.companies(id),
 switch_id uuid NOT NULL REFERENCES public.supplier_switch_requests(id),intent_id uuid NOT NULL REFERENCES public.ediel_message_intents(id),
 outbound_request_id uuid NOT NULL REFERENCES public.outbound_requests(id),payload_hash text NOT NULL,contract_id uuid NOT NULL REFERENCES public.customer_contracts(id),
 contract_hash text NOT NULL,original_object jsonb NOT NULL,previous_switch jsonb NOT NULL,resulting_switch jsonb NOT NULL,
 actor_user_id uuid NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE gridex_received_sources.switch_originals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_received_sources.switch_originals FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER switch_original_immutable BEFORE UPDATE OR DELETE ON gridex_received_sources.switch_originals FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();
CREATE TRIGGER switch_original_no_truncate BEFORE TRUNCATE ON gridex_received_sources.switch_originals FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();

-- Actual field209 LIN scope with optional field233 NAD+IT. When present,
-- installation identifier/agency must equal the physical owned object.
-- The sole v2 release/UNA decoder owns lexical parsing and canonical admission
-- retains the field/subtype authority.
CREATE FUNCTION gridex_received_sources.switch_origin_wire_v1(raw text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE w jsonb:=gridex_received_sources.normal_switch_wire_v1(raw);tokens jsonb:=gridex_received_sources.closure_wire_tokens_v2(raw);t jsonb;installation jsonb;customer jsonb;own jsonb;
BEGIN
 IF w IS NULL OR w->>'code' IS DISTINCT FROM 'Z03' OR jsonb_array_length(w->'objects')<>1 OR (SELECT count(*) FROM jsonb_array_elements(tokens) item WHERE item->>'tag'='LIN')<>1 THEN RETURN NULL;END IF;
 FOR t IN SELECT e FROM jsonb_array_elements(tokens)e LOOP
  IF t->>'tag'='NAD' AND t#>>'{elements,1,0}'='UD' THEN IF customer IS NOT NULL THEN RETURN NULL;END IF;customer:=jsonb_build_object('customerQualifier',t#>>'{elements,2,1}','customerAgency',t#>>'{elements,2,2}');END IF;
  IF t->>'tag'='NAD' AND t#>>'{elements,1,0}'='IT' THEN IF installation IS NOT NULL THEN RETURN NULL;END IF;installation:=jsonb_build_object('installationPoint',t#>>'{elements,2,0}','installationAgency',t#>>'{elements,2,2}');END IF;
 END LOOP;
 own:=w#>'{objects,0}';
 IF nullif(own->>'point','') IS NULL OR (own->>'identityAgency' IN('9','89')) IS NOT TRUE THEN RETURN NULL;END IF;
 IF installation IS NOT NULL AND (installation->>'installationPoint' IS DISTINCT FROM own->>'point' OR installation->>'installationAgency' IS DISTINCT FROM own->>'identityAgency') THEN RETURN NULL;END IF;
 IF customer IS NULL THEN RETURN NULL;END IF;
 own:=own||customer||jsonb_build_object('installationPoint',own->>'point','installationAgency',own->>'identityAgency');
 RETURN w||jsonb_build_object('objects',jsonb_build_array(own));
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.switch_origin_wire_v1(text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.ediel_bind_switch_original_v1(p_company_id uuid,p_switch_id uuid,p_message_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;s public.supplier_switch_requests%rowtype;c public.customer_contracts%rowtype;
 r public.outbound_requests%rowtype;mp public.metering_points%rowtype;prior gridex_received_sources.switch_originals%rowtype;
 w jsonb;own jsonb;before_state jsonb;identity text;identity_qualifier text;expected_reason text;i public.ediel_message_intents%rowtype;
BEGIN
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id FOR UPDATE;
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 PERFORM cm.user_id FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id FOR SHARE;
 IF p_actor_user_id IS NULL OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active')
  OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL)
  OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.write') IS NOT TRUE THEN RAISE EXCEPTION 'switch_original_execution_actor_required';END IF;
 SELECT * INTO prior FROM gridex_received_sources.switch_originals WHERE message_id=m.id;
 IF FOUND THEN IF prior.company_id IS DISTINCT FROM p_company_id OR prior.switch_id IS DISTINCT FROM p_switch_id OR prior.intent_id IS DISTINCT FROM m.intent_id OR prior.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'switch_original_replay_conflict';END IF;RETURN jsonb_build_object('status','bound','messageId',m.id,'idempotent',true);END IF;
 PERFORM gridex_ediel_transport.require_message_intent_v1(m);
 SELECT * INTO i FROM public.ediel_message_intents WHERE id=m.intent_id FOR SHARE;
 SELECT * INTO s FROM public.supplier_switch_requests WHERE id=p_switch_id AND company_id=p_company_id FOR UPDATE;
 SELECT * INTO c FROM public.customer_contracts WHERE id=coalesce(s.customer_contract_id,s.contract_id) AND company_id=p_company_id FOR SHARE;
 SELECT * INTO mp FROM public.metering_points WHERE id=s.metering_point_id AND company_id=p_company_id FOR SHARE;
 SELECT * INTO r FROM public.outbound_requests WHERE id=m.outbound_request_id AND company_id=p_company_id FOR SHARE;
 PERFORM customer.id FROM public.customers customer WHERE customer.id=s.customer_id AND customer.company_id=p_company_id FOR SHARE;
 SELECT coalesce(nullif(btrim(customer.org_number),''),nullif(btrim(customer.personal_number),'')),CASE WHEN nullif(btrim(customer.org_number),'') IS NOT NULL THEN 'SE1' ELSE 'SE2' END INTO identity,identity_qualifier FROM public.customers customer WHERE customer.id=s.customer_id AND customer.company_id=p_company_id;
 w:=gridex_received_sources.switch_origin_wire_v1(m.raw_payload);own:=w#>'{objects,0}';
 expected_reason:=CASE WHEN s.request_type='move_in' OR s.prodat_variant='LK' OR s.prodat_reason='Z23' THEN 'Z23' ELSE 'Z22' END;
 IF i.id IS NULL OR i.operation_id IS DISTINCT FROM s.id OR s.id IS NULL OR c.id IS NULL OR mp.id IS NULL OR r.id IS NULL OR w IS NULL OR m.direction IS DISTINCT FROM 'outbound' OR m.message_standard IS DISTINCT FROM 'edifact' OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.message_code IS DISTINCT FROM 'Z03' OR m.status IS DISTINCT FROM 'draft'
  OR m.immutable_rendered_at IS NULL OR m.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
  OR m.switch_request_id IS DISTINCT FROM s.id OR m.source_operation_id IS DISTINCT FROM s.id::text OR m.customer_id IS DISTINCT FROM s.customer_id OR m.site_id IS DISTINCT FROM coalesce(s.site_id,s.customer_site_id) OR m.metering_point_id IS DISTINCT FROM s.metering_point_id
  OR (s.site_id IS NOT NULL AND s.site_id IS DISTINCT FROM m.site_id) OR (s.customer_site_id IS NOT NULL AND s.customer_site_id IS DISTINCT FROM m.site_id) OR (s.contract_id IS NOT NULL AND s.contract_id IS DISTINCT FROM c.id) OR (s.customer_contract_id IS NOT NULL AND s.customer_contract_id IS DISTINCT FROM c.id)
  OR s.outbound_z03_message_id IS NOT NULL OR s.inbound_z04_message_id IS NOT NULL OR s.lifecycle_blocked IS DISTINCT FROM false OR (s.status IN('draft','ready','ready_for_switch','ready_for_z03','z03_ready','prepared','queued','waiting')) IS NOT TRUE
  OR r.environment IS DISTINCT FROM m.environment OR r.source_type IS DISTINCT FROM 'supplier_switch_request' OR r.source_id IS DISTINCT FROM s.id OR r.operation_id IS DISTINCT FROM s.id OR r.request_type IS DISTINCT FROM 'supplier_switch' OR r.customer_id IS DISTINCT FROM s.customer_id OR r.site_id IS DISTINCT FROM m.site_id OR r.metering_point_id IS DISTINCT FROM mp.id
  OR c.customer_id IS DISTINCT FROM s.customer_id OR c.metering_point_id IS DISTINCT FROM mp.id OR (c.status IN('signed','active')) IS NOT TRUE OR c.signed_at IS NULL OR nullif(c.signed_version,'') IS NULL
  OR mp.customer_id IS DISTINCT FROM s.customer_id OR mp.site_id IS DISTINCT FROM m.site_id OR own->>'installationPoint' IS DISTINCT FROM coalesce(nullif(mp.ediel_metering_point_id,''),nullif(mp.meter_point_id,'')) OR own->>'installationAgency' IS DISTINCT FROM '9'
  OR own->>'customerQualifier' IS DISTINCT FROM identity_qualifier OR own->>'customerAgency' IS DISTINCT FROM '260' OR own->>'reason' IS DISTINCT FROM expected_reason OR own->>'customerIdentity' IS DISTINCT FROM identity OR nullif(own->>'li','') IS NULL
  OR gridex_received_sources.permission_date_v1(own->>'start') IS DISTINCT FROM s.requested_start_date THEN RAISE EXCEPTION 'switch_original_owned_source_required';END IF;
 PERFORM public.gridex_assert_supplier_switch_ready(p_company_id,c.id);
 before_state:=to_jsonb(s);
 UPDATE public.supplier_switch_requests SET outbound_z03_message_id=m.id,rff_li_reference=own->>'li',status='prepared',updated_by=p_actor_user_id,updated_at=now() WHERE id=s.id AND company_id=p_company_id RETURNING * INTO s;
 INSERT INTO gridex_received_sources.switch_originals(message_id,company_id,switch_id,intent_id,outbound_request_id,payload_hash,contract_id,contract_hash,original_object,previous_switch,resulting_switch,actor_user_id)
 VALUES(m.id,p_company_id,s.id,m.intent_id,m.outbound_request_id,m.immutable_payload_hash,c.id,gridex_received_sources.production_contract_hash_v1(c),own,before_state,to_jsonb(s),p_actor_user_id);
 RETURN jsonb_build_object('status','bound','messageId',m.id,'idempotent',false);
END $$;
REVOKE ALL ON FUNCTION public.ediel_bind_switch_original_v1(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_bind_switch_original_v1(uuid,uuid,uuid,uuid) TO service_role;

CREATE FUNCTION gridex_received_sources.switch_original_message_immutable_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT FROM gridex_received_sources.switch_originals o WHERE o.message_id=OLD.id) AND
 ROW(NEW.id,NEW.company_id,NEW.environment,NEW.direction,NEW.message_standard,NEW.message_family,NEW.message_code,NEW.intent_id,NEW.outbound_request_id,NEW.source_operation_id,NEW.switch_request_id,NEW.customer_id,NEW.site_id,NEW.metering_point_id,NEW.raw_payload,NEW.immutable_payload_hash,NEW.immutable_rendered_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.company_id,OLD.environment,OLD.direction,OLD.message_standard,OLD.message_family,OLD.message_code,OLD.intent_id,OLD.outbound_request_id,OLD.source_operation_id,OLD.switch_request_id,OLD.customer_id,OLD.site_id,OLD.metering_point_id,OLD.raw_payload,OLD.immutable_payload_hash,OLD.immutable_rendered_at)
 THEN RAISE EXCEPTION 'switch_original_bound_message_immutable';END IF;RETURN NEW;
END $$;
CREATE TRIGGER ediel_switch_original_message_immutable BEFORE UPDATE ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.switch_original_message_immutable_v1();
REVOKE ALL ON FUNCTION gridex_received_sources.switch_original_message_immutable_v1() FROM PUBLIC,anon,authenticated,service_role;

-- Current origination authority at native entry. Historical accepted/uncertain
-- transport receipts are returned by the delegated owner before this first
-- effect gate; a test environment alone is never provenance.
CREATE FUNCTION public.ediel_require_switch_original_current_v1(p_company_id uuid,p_message_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;o gridex_received_sources.switch_originals%rowtype;s public.supplier_switch_requests%rowtype;
 c public.customer_contracts%rowtype;mp public.metering_points%rowtype;r public.outbound_requests%rowtype;i public.ediel_message_intents%rowtype;q jsonb;w jsonb;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id FOR SHARE;
 IF m.id IS NULL THEN RAISE EXCEPTION 'switch_original_message_required';END IF;
 IF m.direction IS DISTINCT FROM 'outbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.message_code IS DISTINCT FROM 'Z03' THEN RETURN;END IF;
 w:=gridex_received_sources.switch_origin_wire_v1(m.raw_payload);
 -- Z03C has its own cancellation owner, never a new normal-switch original.
 IF w IS NOT NULL AND w#>>'{objects,0,reason}'='Z24' THEN RETURN;END IF;
 SELECT * INTO o FROM gridex_received_sources.switch_originals WHERE message_id=m.id AND company_id=m.company_id;
 IF NOT FOUND THEN
  IF m.environment IS DISTINCT FROM 'test' THEN RAISE EXCEPTION 'switch_original_source_required';END IF;
  IF EXISTS(SELECT FROM gridex_negative_fixtures.positive_consumptions x WHERE x.company_id=m.company_id AND x.message_id=m.id)
   AND EXISTS(SELECT FROM gridex_negative_fixtures.negative_prepared_consumptions x WHERE x.company_id=m.company_id AND x.message_id=m.id) THEN RAISE EXCEPTION 'switch_fixture_source_ambiguous';END IF;
  IF EXISTS(SELECT FROM gridex_negative_fixtures.positive_consumptions x WHERE x.company_id=m.company_id AND x.message_id=m.id) THEN
   q:=gridex_negative_fixtures.require_positive_message_v1(m.company_id,m.id,'Z03');
   IF q->>'kind' IS DISTINCT FROM 'source_qualified_positive_fixture' OR q->>'expectedOutcome' IS DISTINCT FROM 'positive' OR q->'expectedDiagnosticCodes' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'switch_fixture_positive_scope_required';END IF;
  ELSIF EXISTS(SELECT FROM gridex_negative_fixtures.negative_prepared_consumptions x WHERE x.company_id=m.company_id AND x.message_id=m.id) THEN
   q:=gridex_negative_fixtures.require_negative_message_v1(m.company_id,m.id,'Z03');
   IF q->>'kind' IS DISTINCT FROM 'source_qualified_negative_fixture' OR q->>'expectedOutcome' IS DISTINCT FROM 'negative' OR jsonb_typeof(q->'expectedDiagnosticCodes') IS DISTINCT FROM 'array' OR jsonb_array_length(q->'expectedDiagnosticCodes') NOT BETWEEN 1 AND 256 THEN RAISE EXCEPTION 'switch_fixture_negative_scope_required';END IF;
  ELSE RAISE EXCEPTION 'switch_original_source_required';END IF;
  IF q->>'companyId' IS DISTINCT FROM m.company_id::text OR q->>'roleCode' IS DISTINCT FROM 'supplier' OR q->>'authorizesBusinessEffect' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'switch_fixture_supplier_scope_required';END IF;
  RETURN;
 END IF;
 SELECT * INTO s FROM public.supplier_switch_requests WHERE id=o.switch_id AND company_id=o.company_id FOR SHARE;
 SELECT * INTO c FROM public.customer_contracts WHERE id=o.contract_id AND company_id=o.company_id FOR SHARE;
 SELECT * INTO mp FROM public.metering_points WHERE id=s.metering_point_id AND company_id=s.company_id FOR SHARE;
 SELECT * INTO r FROM public.outbound_requests WHERE id=o.outbound_request_id AND company_id=o.company_id FOR SHARE;
 SELECT * INTO i FROM public.ediel_message_intents WHERE id=o.intent_id FOR SHARE;
 IF i.id IS NULL OR i.operation_id IS DISTINCT FROM s.id OR m.source_operation_id IS DISTINCT FROM s.id::text OR w IS NULL OR (w#>>'{objects,0,reason}' IN('Z22','Z23')) IS NOT TRUE
  OR m.immutable_rendered_at IS NULL OR m.immutable_payload_hash IS DISTINCT FROM o.payload_hash OR o.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
  OR m.intent_id IS DISTINCT FROM o.intent_id OR m.outbound_request_id IS DISTINCT FROM o.outbound_request_id OR m.switch_request_id IS DISTINCT FROM s.id OR m.customer_id IS DISTINCT FROM s.customer_id OR m.site_id IS DISTINCT FROM coalesce(s.site_id,s.customer_site_id) OR m.metering_point_id IS DISTINCT FROM s.metering_point_id
  OR r.id IS NULL OR r.environment IS DISTINCT FROM m.environment OR r.source_type IS DISTINCT FROM 'supplier_switch_request' OR r.source_id IS DISTINCT FROM s.id OR r.operation_id IS DISTINCT FROM s.id OR r.request_type IS DISTINCT FROM 'supplier_switch' OR r.customer_id IS DISTINCT FROM m.customer_id OR r.site_id IS DISTINCT FROM m.site_id OR r.metering_point_id IS DISTINCT FROM m.metering_point_id
  OR s.id IS NULL OR c.id IS NULL OR mp.id IS NULL OR s.outbound_z03_message_id IS DISTINCT FROM m.id OR s.inbound_z04_message_id IS NOT NULL OR s.lifecycle_blocked IS DISTINCT FROM false OR (s.status IN('prepared','queued','submitted')) IS NOT TRUE
  OR (s.contract_id IS NOT NULL AND s.contract_id IS DISTINCT FROM c.id) OR (s.customer_contract_id IS NOT NULL AND s.customer_contract_id IS DISTINCT FROM c.id)
  OR (s.site_id IS NOT NULL AND s.site_id IS DISTINCT FROM m.site_id) OR (s.customer_site_id IS NOT NULL AND s.customer_site_id IS DISTINCT FROM m.site_id)
  OR s.rff_li_reference IS DISTINCT FROM o.original_object->>'li' OR w#>'{objects,0}' IS DISTINCT FROM o.original_object
  OR gridex_received_sources.production_contract_hash_v1(c) IS DISTINCT FROM o.contract_hash OR (c.status IN('signed','active')) IS NOT TRUE
  OR c.customer_id IS DISTINCT FROM m.customer_id OR c.metering_point_id IS DISTINCT FROM mp.id OR mp.customer_id IS DISTINCT FROM m.customer_id OR mp.site_id IS DISTINCT FROM m.site_id
  OR o.original_object->>'installationPoint' IS DISTINCT FROM coalesce(nullif(mp.ediel_metering_point_id,''),nullif(mp.meter_point_id,''))
  THEN RAISE EXCEPTION 'switch_original_current_source_required';END IF;
 PERFORM public.gridex_assert_supplier_switch_ready(p_company_id,c.id);
END $$;
REVOKE ALL ON FUNCTION public.ediel_require_switch_original_current_v1(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_require_switch_original_current_v1(uuid,uuid) TO service_role;
ALTER FUNCTION gridex_ediel_transport.mutate_v1(jsonb) RENAME TO mutate_before_switch_original_v1;
CREATE FUNCTION gridex_ediel_transport.mutate_v1(i jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 result:=gridex_ediel_transport.mutate_before_switch_original_v1(i);
 IF (i->>'action' IN('prepare','enter')) IS NOT TRUE OR result->>'proceed' IS DISTINCT FROM 'true' THEN RETURN result;END IF;
 PERFORM public.ediel_require_switch_original_current_v1((i->>'companyId')::uuid,(i->>'messageId')::uuid);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION gridex_ediel_transport.mutate_v1(jsonb),gridex_ediel_transport.mutate_before_switch_original_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
