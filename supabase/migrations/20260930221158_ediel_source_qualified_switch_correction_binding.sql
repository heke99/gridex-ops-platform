-- TR05/CALL03: append an operation-qualified corrected switch original and
-- advance only its still-unapproved operative correlation. Old messages, ACKs,
-- provider attempts and immutable originals remain unchanged.
BEGIN;
ALTER TABLE gridex_received_sources.switch_originals ADD COLUMN recovery_operation_id uuid REFERENCES gridex_received_sources.prodat_recovery_operations(id);
CREATE UNIQUE INDEX switch_original_recovery_operation_unique ON gridex_received_sources.switch_originals(recovery_operation_id) WHERE recovery_operation_id IS NOT NULL;
CREATE FUNCTION public.ediel_bind_switch_correction_v1(p_company_id uuid,p_message_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;s public.supplier_switch_requests%rowtype;c public.customer_contracts%rowtype;
 r public.outbound_requests%rowtype;mp public.metering_points%rowtype;prior gridex_received_sources.switch_originals%rowtype;
 op gridex_received_sources.prodat_recovery_operations%rowtype; old_origin gridex_received_sources.switch_originals%rowtype; original public.ediel_messages%rowtype;basis jsonb;w jsonb;own jsonb;before_state jsonb;identity text;identity_qualifier text;expected_reason text;i public.ediel_message_intents%rowtype;
BEGIN
 -- Discover the selector only. The immutable operation authority locks and
 -- requalifies the original/ACK before any operative switch mutation.
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id;
 SELECT operation.* INTO op FROM gridex_received_sources.prodat_recovery_messages link JOIN gridex_received_sources.prodat_recovery_operations operation ON operation.id=link.operation_id WHERE link.message_id=m.id AND operation.company_id=p_company_id;
 IF op.id IS NULL OR (op.kind IN('contrl_correction','aperak_correction')) IS NOT TRUE THEN RAISE EXCEPTION 'switch_correction_operation_required';END IF;
 SELECT * INTO prior FROM gridex_received_sources.switch_originals WHERE message_id=m.id;
 IF prior.message_id IS NOT NULL THEN
  PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
  PERFORM cm.user_id FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id FOR SHARE;
  IF prior.company_id IS DISTINCT FROM p_company_id OR prior.recovery_operation_id IS DISTINCT FROM op.id OR prior.intent_id IS DISTINCT FROM m.intent_id OR prior.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'switch_correction_replay_conflict';END IF;
  IF p_actor_user_id IS NULL OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.write') IS NOT TRUE OR NOT EXISTS(SELECT FROM public.company_memberships cm JOIN public.user_profiles u ON u.id=cm.user_id WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL AND u.user_status='active') THEN RAISE EXCEPTION 'switch_original_execution_actor_required';END IF;
  RETURN jsonb_build_object('status','bound','messageId',m.id,'idempotent',true);
 END IF;
 basis:=public.ediel_prodat_recovery_operation_basis_v1(p_company_id,op.id,p_actor_user_id);
 IF basis IS NULL OR basis->>'operationId' IS DISTINCT FROM op.id::text OR basis->>'correctedPayloadHash' IS DISTINCT FROM op.corrected_payload_hash THEN RAISE EXCEPTION 'switch_correction_qualified_negative_source_required';END IF;
 SELECT * INTO STRICT original FROM public.ediel_messages WHERE id=op.original_message_id AND company_id=p_company_id FOR UPDATE;
 SELECT * INTO old_origin FROM gridex_received_sources.switch_originals WHERE message_id=original.id AND company_id=p_company_id;
 IF old_origin.message_id IS NULL OR old_origin.payload_hash IS DISTINCT FROM op.original_payload_hash OR original.immutable_payload_hash IS DISTINCT FROM op.original_payload_hash OR op.original_payload_hash IS DISTINCT FROM encode(sha256(convert_to(original.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'switch_correction_owned_original_required';END IF;
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id FOR UPDATE;
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 PERFORM cm.user_id FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id FOR SHARE;
 IF p_actor_user_id IS NULL OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active')
  OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL)
  OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.write') IS NOT TRUE THEN RAISE EXCEPTION 'switch_original_execution_actor_required';END IF;
 PERFORM gridex_ediel_transport.require_message_intent_v1(m);
 SELECT * INTO i FROM public.ediel_message_intents WHERE id=m.intent_id FOR SHARE;
 SELECT * INTO s FROM public.supplier_switch_requests WHERE id=old_origin.switch_id AND company_id=p_company_id FOR UPDATE;
 SELECT * INTO c FROM public.customer_contracts WHERE id=coalesce(s.customer_contract_id,s.contract_id) AND company_id=p_company_id FOR SHARE;
 SELECT * INTO mp FROM public.metering_points WHERE id=s.metering_point_id AND company_id=p_company_id FOR SHARE;
 SELECT * INTO r FROM public.outbound_requests WHERE id=m.outbound_request_id AND company_id=p_company_id FOR SHARE;
 PERFORM customer.id FROM public.customers customer WHERE customer.id=s.customer_id AND customer.company_id=p_company_id FOR SHARE;
 SELECT coalesce(nullif(btrim(customer.org_number),''),nullif(btrim(customer.personal_number),'')),CASE WHEN nullif(btrim(customer.org_number),'') IS NOT NULL THEN 'SE1' ELSE 'SE2' END INTO identity,identity_qualifier FROM public.customers customer WHERE customer.id=s.customer_id AND customer.company_id=p_company_id;
 w:=gridex_received_sources.switch_origin_wire_v1(m.raw_payload);own:=w#>'{objects,0}';
 expected_reason:=CASE WHEN s.request_type='move_in' OR s.prodat_variant='LK' OR s.prodat_reason='Z23' THEN 'Z23' ELSE 'Z22' END;
 IF i.id IS NULL OR i.operation_id IS DISTINCT FROM op.id OR i.supplier_switch_request_id IS DISTINCT FROM s.id OR s.id IS NULL OR c.id IS NULL OR mp.id IS NULL OR r.id IS NULL OR w IS NULL OR m.direction IS DISTINCT FROM 'outbound' OR m.message_standard IS DISTINCT FROM 'edifact' OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.message_code IS DISTINCT FROM 'Z03' OR m.status IS DISTINCT FROM 'draft'
  OR m.immutable_rendered_at IS NULL OR m.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
  OR m.switch_request_id IS DISTINCT FROM s.id OR m.source_operation_id IS DISTINCT FROM op.id::text OR m.original_message_id IS DISTINCT FROM original.id OR m.environment IS DISTINCT FROM op.environment OR m.raw_payload IS DISTINCT FROM op.corrected_raw_payload OR m.immutable_payload_hash IS DISTINCT FROM op.corrected_payload_hash OR m.customer_id IS DISTINCT FROM s.customer_id OR m.site_id IS DISTINCT FROM coalesce(s.site_id,s.customer_site_id) OR m.metering_point_id IS DISTINCT FROM s.metering_point_id
  OR (s.site_id IS NOT NULL AND s.site_id IS DISTINCT FROM m.site_id) OR (s.customer_site_id IS NOT NULL AND s.customer_site_id IS DISTINCT FROM m.site_id) OR (s.contract_id IS NOT NULL AND s.contract_id IS DISTINCT FROM c.id) OR (s.customer_contract_id IS NOT NULL AND s.customer_contract_id IS DISTINCT FROM c.id)
  OR s.outbound_z03_message_id IS DISTINCT FROM original.id OR s.inbound_z04_message_id IS NOT NULL OR s.lifecycle_blocked IS DISTINCT FROM false OR (s.status IN('prepared','queued','submitted','failed','rejected')) IS NOT TRUE
  OR (r.payload->>'environment') IS DISTINCT FROM m.environment OR r.source_type IS DISTINCT FROM 'manual' OR r.source_id IS DISTINCT FROM i.id OR r.operation_id IS DISTINCT FROM op.id OR r.request_type IS DISTINCT FROM 'supplier_switch' OR r.customer_id IS DISTINCT FROM s.customer_id OR r.site_id IS DISTINCT FROM m.site_id OR r.metering_point_id IS DISTINCT FROM mp.id
  OR c.id IS DISTINCT FROM old_origin.contract_id OR gridex_received_sources.production_contract_hash_v1(c) IS DISTINCT FROM old_origin.contract_hash OR c.customer_id IS DISTINCT FROM s.customer_id OR c.metering_point_id IS DISTINCT FROM mp.id OR (c.status IN('signed','active')) IS NOT TRUE OR c.signed_at IS NULL OR nullif(c.signed_version,'') IS NULL
  OR mp.customer_id IS DISTINCT FROM s.customer_id OR mp.site_id IS DISTINCT FROM m.site_id OR own->>'installationPoint' IS DISTINCT FROM coalesce(nullif(mp.ediel_metering_point_id,''),nullif(mp.meter_point_id,'')) OR own->>'installationAgency' IS DISTINCT FROM '9'
  OR own->>'customerQualifier' IS DISTINCT FROM identity_qualifier OR own->>'customerAgency' IS DISTINCT FROM '260' OR own->>'reason' IS DISTINCT FROM expected_reason OR own->>'customerIdentity' IS DISTINCT FROM identity OR nullif(own->>'li','') IS NULL
  OR (own-'li'-'line') IS DISTINCT FROM (old_origin.original_object-'li'-'line') OR gridex_received_sources.permission_date_v1(own->>'start') IS DISTINCT FROM s.requested_start_date THEN RAISE EXCEPTION 'switch_original_owned_source_required';END IF;
 PERFORM public.gridex_assert_supplier_switch_ready(p_company_id,c.id);
 before_state:=to_jsonb(s);
 UPDATE public.supplier_switch_requests SET outbound_z03_message_id=m.id,rff_li_reference=own->>'li',status='prepared',updated_by=p_actor_user_id,updated_at=now() WHERE id=s.id AND company_id=p_company_id RETURNING * INTO s;
 INSERT INTO gridex_received_sources.switch_originals(message_id,company_id,switch_id,intent_id,outbound_request_id,payload_hash,contract_id,contract_hash,original_object,previous_switch,resulting_switch,actor_user_id,recovery_operation_id)
 VALUES(m.id,p_company_id,s.id,m.intent_id,m.outbound_request_id,m.immutable_payload_hash,c.id,gridex_received_sources.production_contract_hash_v1(c),own,before_state,to_jsonb(s),p_actor_user_id,op.id);
 RETURN jsonb_build_object('status','bound','messageId',m.id,'idempotent',false);
END $$;
REVOKE ALL ON FUNCTION public.ediel_bind_switch_correction_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_bind_switch_correction_v1(uuid,uuid,uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.ediel_require_switch_original_current_v1(p_company_id uuid,p_message_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;o gridex_received_sources.switch_originals%rowtype;s public.supplier_switch_requests%rowtype;
 c public.customer_contracts%rowtype;mp public.metering_points%rowtype;r public.outbound_requests%rowtype;i public.ediel_message_intents%rowtype;op gridex_received_sources.prodat_recovery_operations%rowtype; expected_operation uuid;expected_request_source uuid;expected_request_type text;q jsonb;w jsonb;
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
 expected_operation:=o.switch_id;expected_request_source:=o.switch_id;expected_request_type:='supplier_switch_request';
 IF o.recovery_operation_id IS NOT NULL THEN
  SELECT operation.* INTO op FROM gridex_received_sources.prodat_recovery_messages link JOIN gridex_received_sources.prodat_recovery_operations operation ON operation.id=link.operation_id WHERE link.message_id=m.id AND operation.company_id=p_company_id;
  IF op.id IS DISTINCT FROM o.recovery_operation_id OR (op.kind IN('contrl_correction','aperak_correction')) IS NOT TRUE OR m.original_message_id IS DISTINCT FROM op.original_message_id THEN RAISE EXCEPTION 'switch_correction_current_operation_required';END IF;
  PERFORM public.ediel_require_prodat_recovery_current_v1(p_company_id,m.id);
  expected_operation:=op.id;expected_request_source:=o.intent_id;expected_request_type:='manual';
 END IF;
 SELECT * INTO s FROM public.supplier_switch_requests WHERE id=o.switch_id AND company_id=o.company_id FOR SHARE;
 SELECT * INTO c FROM public.customer_contracts WHERE id=o.contract_id AND company_id=o.company_id FOR SHARE;
 SELECT * INTO mp FROM public.metering_points WHERE id=s.metering_point_id AND company_id=s.company_id FOR SHARE;
 SELECT * INTO r FROM public.outbound_requests WHERE id=o.outbound_request_id AND company_id=o.company_id FOR SHARE;
 SELECT * INTO i FROM public.ediel_message_intents WHERE id=o.intent_id FOR SHARE;
 IF i.id IS NULL OR i.operation_id IS DISTINCT FROM expected_operation OR i.supplier_switch_request_id IS DISTINCT FROM s.id OR m.source_operation_id IS DISTINCT FROM expected_operation::text OR w IS NULL OR (w#>>'{objects,0,reason}' IN('Z22','Z23')) IS NOT TRUE
  OR m.immutable_rendered_at IS NULL OR m.immutable_payload_hash IS DISTINCT FROM o.payload_hash OR o.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
  OR m.intent_id IS DISTINCT FROM o.intent_id OR m.outbound_request_id IS DISTINCT FROM o.outbound_request_id OR m.switch_request_id IS DISTINCT FROM s.id OR m.customer_id IS DISTINCT FROM s.customer_id OR m.site_id IS DISTINCT FROM coalesce(s.site_id,s.customer_site_id) OR m.metering_point_id IS DISTINCT FROM s.metering_point_id
  OR r.id IS NULL OR (r.payload->>'environment') IS DISTINCT FROM m.environment OR r.source_type IS DISTINCT FROM expected_request_type OR r.source_id IS DISTINCT FROM expected_request_source OR r.operation_id IS DISTINCT FROM expected_operation OR r.request_type IS DISTINCT FROM 'supplier_switch' OR r.customer_id IS DISTINCT FROM m.customer_id OR r.site_id IS DISTINCT FROM m.site_id OR r.metering_point_id IS DISTINCT FROM m.metering_point_id
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
CREATE OR REPLACE FUNCTION gridex_received_sources.switch_original_message_immutable_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT FROM gridex_received_sources.switch_originals o WHERE o.message_id=OLD.id) AND
 ROW(NEW.id,NEW.company_id,NEW.environment,NEW.direction,NEW.message_standard,NEW.message_family,NEW.message_code,NEW.intent_id,NEW.outbound_request_id,NEW.source_operation_id,NEW.switch_request_id,NEW.customer_id,NEW.site_id,NEW.metering_point_id,NEW.raw_payload,NEW.immutable_payload_hash,NEW.immutable_rendered_at,NEW.original_message_id)
 IS DISTINCT FROM ROW(OLD.id,OLD.company_id,OLD.environment,OLD.direction,OLD.message_standard,OLD.message_family,OLD.message_code,OLD.intent_id,OLD.outbound_request_id,OLD.source_operation_id,OLD.switch_request_id,OLD.customer_id,OLD.site_id,OLD.metering_point_id,OLD.raw_payload,OLD.immutable_payload_hash,OLD.immutable_rendered_at,OLD.original_message_id)
 THEN RAISE EXCEPTION 'switch_original_bound_message_immutable';END IF;RETURN NEW;
END $$;

-- Locked operational request projections cannot introduce another environment
-- or operation than their immutable source/intent. No original migration edit.
CREATE OR REPLACE FUNCTION public.ediel_bind_switch_original_v1(p_company_id uuid,p_switch_id uuid,p_message_id uuid,p_actor_user_id uuid) RETURNS jsonb
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
  OR (r.payload->>'environment') IS DISTINCT FROM m.environment OR r.source_type IS DISTINCT FROM 'supplier_switch_request' OR r.source_id IS DISTINCT FROM s.id OR r.operation_id IS DISTINCT FROM s.id OR r.request_type IS DISTINCT FROM 'supplier_switch' OR r.customer_id IS DISTINCT FROM s.customer_id OR r.site_id IS DISTINCT FROM m.site_id OR r.metering_point_id IS DISTINCT FROM mp.id
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
CREATE OR REPLACE FUNCTION public.ediel_reserve_prodat_recovery_origin_v1(p_company_id uuid,p_operation_id uuid,p_actor_user_id uuid,p_intent_id uuid,p_outbound_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE op gridex_received_sources.prodat_recovery_operations%rowtype;o gridex_received_sources.prodat_recovery_origins%rowtype;i public.ediel_message_intents%rowtype;m public.ediel_messages%rowtype;r public.outbound_requests%rowtype;basis jsonb;w jsonb;request_type text;
BEGIN
 basis:=public.ediel_prodat_recovery_operation_basis_v1(p_company_id,p_operation_id,p_actor_user_id);
 IF basis IS NULL THEN RAISE EXCEPTION 'prodat_recovery_correction_basis_required';END IF;
 SELECT * INTO STRICT op FROM gridex_received_sources.prodat_recovery_operations WHERE id=p_operation_id AND company_id=p_company_id;
 -- The preceding source qualification already holds the sealed original lock.
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=op.original_message_id AND company_id=p_company_id;
 w:=gridex_received_sources.prodat_recovery_wire_v1(op.corrected_raw_payload);
 SELECT * INTO i FROM public.ediel_message_intents WHERE id=p_intent_id AND company_id=p_company_id FOR SHARE;
 request_type:=CASE WHEN w->>'code' IN ('Z03','Z08') THEN 'supplier_switch' WHEN w->>'code' IN ('Z13','Z18') THEN 'metering_access' ELSE 'customer_masterdata' END;
 IF i.id IS NULL OR i.environment IS DISTINCT FROM op.environment OR i.message_family IS DISTINCT FROM 'PRODAT' OR i.message_code IS DISTINCT FROM w->>'code'
 OR i.direction IS DISTINCT FROM 'outbound' OR i.customer_id IS DISTINCT FROM m.customer_id OR i.operation_id IS DISTINCT FROM op.id
 OR i.validation_status IS DISTINCT FROM 'validated' OR i.interchange_reference IS DISTINCT FROM w->>'interchange' OR i.message_reference IS DISTINCT FROM w->>'messageReference'
 OR i.sender_ediel_id IS DISTINCT FROM w#>>'{transportSender,0}' OR i.receiver_ediel_id IS DISTINCT FROM w#>>'{transportReceiver,0}'
 OR i.communication_route_id IS NULL OR i.route_profile_id IS NULL THEN RAISE EXCEPTION 'prodat_recovery_intent_scope_required';END IF;
 SELECT * INTO o FROM gridex_received_sources.prodat_recovery_origins WHERE operation_id=op.id FOR UPDATE;
 SELECT * INTO r FROM public.outbound_requests WHERE id=coalesce(o.outbound_request_id,p_outbound_request_id) FOR SHARE;
 IF r.id IS NULL OR r.company_id IS DISTINCT FROM p_company_id OR r.customer_id IS DISTINCT FROM m.customer_id OR (r.payload->>'environment') IS DISTINCT FROM op.environment OR r.source_type IS DISTINCT FROM 'manual' OR r.source_id::text IS DISTINCT FROM i.id::text OR r.operation_id IS DISTINCT FROM op.id OR r.site_id IS DISTINCT FROM m.site_id OR r.metering_point_id IS DISTINCT FROM m.metering_point_id OR r.request_type IS DISTINCT FROM request_type THEN RAISE EXCEPTION 'prodat_recovery_owned_request_required';END IF;
 IF o.operation_id IS NOT NULL THEN
  IF o.company_id IS DISTINCT FROM p_company_id OR o.intent_id IS DISTINCT FROM i.id THEN RAISE EXCEPTION 'prodat_recovery_origin_conflict';END IF;
  RETURN jsonb_build_object('status','reserved','intentId',o.intent_id,'outboundRequestId',o.outbound_request_id,'messageId',(SELECT message_id FROM gridex_received_sources.prodat_recovery_messages WHERE operation_id=op.id));
 END IF;
 IF EXISTS(SELECT FROM gridex_received_sources.prodat_recovery_messages WHERE operation_id=op.id) THEN RAISE EXCEPTION 'prodat_recovery_legacy_bound_origin_held';END IF;
 INSERT INTO gridex_received_sources.prodat_recovery_origins(operation_id,company_id,intent_id,outbound_request_id,actor_user_id) VALUES(op.id,p_company_id,i.id,p_outbound_request_id,p_actor_user_id);
 RETURN jsonb_build_object('status','reserved','intentId',i.id,'outboundRequestId',p_outbound_request_id,'messageId',null);
END $$;
CREATE OR REPLACE FUNCTION public.ediel_reserve_production_contract_origin_v1(p_company_id uuid,p_event_id uuid,p_actor_user_id uuid,p_intent_id uuid,p_outbound_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b jsonb;e gridex_received_sources.production_contract_events%rowtype;o gridex_received_sources.production_contract_origins%rowtype;i public.ediel_message_intents%rowtype;period gridex_received_sources.production_contract_periods%rowtype;r public.outbound_requests%rowtype;point public.metering_points%rowtype;
BEGIN
 SELECT * INTO e FROM gridex_received_sources.production_contract_events WHERE id=p_event_id AND company_id=p_company_id FOR UPDATE;
 PERFORM mp.id FROM public.metering_points mp WHERE mp.id=e.metering_point_id AND mp.company_id=e.company_id FOR UPDATE;
 b:=public.ediel_production_contract_source_v1(p_company_id,p_event_id,p_actor_user_id);IF b->>'status' IS DISTINCT FROM 'authorized' THEN RETURN b;END IF;
 SELECT * INTO i FROM public.ediel_message_intents WHERE id=p_intent_id AND company_id=p_company_id FOR SHARE;
 IF i.id IS NULL OR i.environment IS DISTINCT FROM e.environment OR i.message_family IS DISTINCT FROM 'PRODAT' OR i.message_code IS DISTINCT FROM 'Z09' OR i.customer_id IS DISTINCT FROM e.customer_id OR i.metering_point_id IS DISTINCT FROM e.point_id OR i.operation_id IS DISTINCT FROM e.id
 THEN RETURN jsonb_build_object('status','held','missing',jsonb_build_array('production_contract_intent_scope_mismatch'));END IF;
 SELECT * INTO o FROM gridex_received_sources.production_contract_origins WHERE event_id=e.id FOR UPDATE;
 SELECT * INTO r FROM public.outbound_requests WHERE id=coalesce(o.outbound_request_id,p_outbound_request_id) AND company_id=e.company_id FOR SHARE;
 SELECT * INTO point FROM public.metering_points WHERE id=e.metering_point_id AND company_id=e.company_id FOR SHARE;
 IF r.id IS NULL OR point.id IS NULL OR r.customer_id IS DISTINCT FROM e.customer_id OR r.site_id IS DISTINCT FROM point.site_id OR r.metering_point_id IS DISTINCT FROM e.metering_point_id OR (r.payload->>'environment') IS DISTINCT FROM e.environment
 OR r.source_type IS DISTINCT FROM 'manual' OR r.source_id IS DISTINCT FROM i.id OR r.operation_id IS DISTINCT FROM e.id OR r.request_type IS DISTINCT FROM 'customer_masterdata' THEN RETURN jsonb_build_object('status','held','missing',jsonb_build_array('production_contract_owned_request_required'));END IF;
 IF o.event_id IS NOT NULL THEN IF o.intent_id IS DISTINCT FROM i.id THEN RAISE EXCEPTION 'production_contract_origin_conflict';END IF;RETURN jsonb_build_object('status','reserved','messageId',o.message_id,'outboundRequestId',o.outbound_request_id);END IF;
 IF e.event_kind='signed' THEN
 IF EXISTS(SELECT FROM gridex_received_sources.production_contract_periods p WHERE p.company_id=e.company_id AND p.environment=e.environment AND p.metering_point_id=e.metering_point_id AND (p.end_at IS NULL OR p.end_at>e.boundary_at)) THEN RETURN jsonb_build_object('status','held','missing',jsonb_build_array('production_contract_overlapping_owned_period'));END IF;
 INSERT INTO gridex_received_sources.production_contract_periods(start_event_id,company_id,environment,contract_id,customer_id,metering_point_id,start_at) VALUES(e.id,e.company_id,e.environment,e.contract_id,e.customer_id,e.metering_point_id,e.boundary_at);
 ELSE
 SELECT * INTO period FROM gridex_received_sources.production_contract_periods WHERE start_event_id=e.start_event_id AND company_id=e.company_id FOR UPDATE;
 IF NOT FOUND OR period.end_event_id IS NOT NULL THEN RETURN jsonb_build_object('status','held','missing',jsonb_build_array('production_contract_owned_open_period_required'));END IF;
 UPDATE gridex_received_sources.production_contract_periods SET end_at=e.boundary_at,end_event_id=e.id WHERE start_event_id=period.start_event_id;
 END IF;
 INSERT INTO gridex_received_sources.production_contract_origins(event_id,intent_id,company_id,actor_user_id,outbound_request_id) VALUES(e.id,i.id,e.company_id,p_actor_user_id,p_outbound_request_id);
 RETURN jsonb_build_object('status','reserved','messageId',null,'outboundRequestId',p_outbound_request_id);
END $$;


CREATE FUNCTION gridex_received_sources.production_contract_source_for_execution_v1(p_company_id uuid,p_event_id uuid,p_actor_user_id uuid,p_permission text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e gridex_received_sources.production_contract_events%rowtype;c public.customer_contracts%rowtype;mp public.metering_points%rowtype;ids uuid[];start gridex_received_sources.production_contract_events%rowtype;
BEGIN
 IF (p_permission IN('communication.write','communication.send')) IS NOT TRUE THEN RAISE EXCEPTION 'production_contract_execution_phase_required';END IF;
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 PERFORM cm.id FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id FOR SHARE;
 IF p_actor_user_id IS NULL OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active')
 OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL)
 OR (CASE WHEN p_permission='communication.send' THEN coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.send'),false) OR coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'ediel.send'),false) ELSE coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.write'),false) END) IS NOT TRUE
 THEN RETURN jsonb_build_object('status','held','missing',jsonb_build_array('production_contract_execution_actor_unqualified'));END IF;
 SELECT * INTO e FROM gridex_received_sources.production_contract_events WHERE id=p_event_id AND company_id=p_company_id FOR UPDATE;
 IF NOT FOUND OR e.approved_at>now() OR EXISTS(SELECT FROM gridex_received_sources.production_contract_revocations r WHERE r.event_id=e.id)
 THEN RETURN jsonb_build_object('status','held','missing',jsonb_build_array('authentic_production_contract_event_required'));END IF;
 PERFORM customer.id FROM public.customers customer WHERE customer.id=e.customer_id AND customer.company_id=e.company_id FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','held','missing',jsonb_build_array('production_contract_owned_customer_required'));END IF;
 SELECT * INTO c FROM public.customer_contracts WHERE id=e.contract_id AND company_id=e.company_id FOR SHARE;
 SELECT * INTO mp FROM public.metering_points WHERE id=e.metering_point_id AND company_id=e.company_id FOR SHARE;
 IF c.id IS NULL OR mp.id IS NULL OR c.customer_id IS DISTINCT FROM e.customer_id OR c.metering_point_id IS DISTINCT FROM e.metering_point_id
 OR mp.customer_id IS DISTINCT FROM e.customer_id OR mp.product_direction IS DISTINCT FROM 'production'
 OR mp.ediel_metering_point_id IS DISTINCT FROM e.point_id OR mp.grid_owner_ediel_id IS DISTINCT FROM e.legal_receiver_id OR mp.grid_area_code IS DISTINCT FROM e.grid_area_code
 OR c.signed_at IS NULL OR nullif(c.signed_version,'') IS NULL OR c.signed_version IS DISTINCT FROM e.contract_revision
 OR gridex_received_sources.production_contract_hash_v1(c) IS DISTINCT FROM e.protected_contract_hash
 THEN RETURN jsonb_build_object('status','held','missing',jsonb_build_array('production_contract_current_owner_scope_changed'));END IF;
 PERFORM p.id FROM public.tenant_ediel_profiles p WHERE p.company_id=e.company_id AND p.environment=e.environment ORDER BY p.id FOR SHARE;
 PERFORM i.id FROM public.tenant_actor_identifiers i WHERE i.company_id=e.company_id AND i.environment=e.environment ORDER BY i.id FOR SHARE;
 PERFORM r.id FROM public.tenant_actor_roles r WHERE r.company_id=e.company_id AND r.environment=e.environment ORDER BY r.id FOR SHARE;
 PERFORM i.id FROM public.platform_actor_identifiers i WHERE i.identifier_value=e.legal_receiver_id ORDER BY i.id FOR SHARE;
 PERFORM a.id FROM public.platform_market_actors a WHERE a.id=e.dso_actor_id FOR SHARE;
 PERFORM r.id FROM public.platform_actor_roles r WHERE r.actor_id=e.dso_actor_id ORDER BY r.id FOR SHARE;
 IF NOT EXISTS(SELECT FROM public.tenant_ediel_profiles p WHERE p.company_id=e.company_id AND p.environment=e.environment AND p.market='electricity' AND p.is_enabled AND p.valid_from<=now() AND (p.valid_to IS NULL OR now()<p.valid_to))
 OR NOT EXISTS(SELECT FROM public.tenant_actor_roles r WHERE r.company_id=e.company_id AND r.environment=e.environment AND r.actor_id=e.legal_actor_id AND r.role_code='electricity_supplier' AND r.valid_from<=now() AND (r.valid_to IS NULL OR now()<r.valid_to))
 OR (SELECT count(DISTINCT (i.actor_id,i.identifier_value)) FROM public.tenant_actor_identifiers i WHERE i.company_id=e.company_id AND i.environment=e.environment AND i.identifier_type='EdielId' AND i.valid_from<=now() AND (i.valid_to IS NULL OR now()<i.valid_to))<>1
 OR NOT EXISTS(SELECT FROM public.tenant_actor_identifiers i WHERE i.company_id=e.company_id AND i.environment=e.environment AND i.actor_id=e.legal_actor_id AND i.identifier_type='EdielId' AND i.identifier_value=e.legal_sender_id AND i.valid_from<=now() AND (i.valid_to IS NULL OR now()<i.valid_to))
 THEN RETURN jsonb_build_object('status','held','missing',jsonb_build_array('production_contract_current_legal_supplier_required'));END IF;
 SELECT array_agg(DISTINCT i.actor_id) INTO ids FROM public.platform_actor_identifiers i WHERE lower(i.identifier_type) IN ('edielid','ediel_id') AND i.identifier_value=e.legal_receiver_id AND i.is_verified AND (i.valid_from IS NULL OR i.valid_from<=current_date) AND (i.valid_to IS NULL OR current_date<=i.valid_to);
 IF coalesce(cardinality(ids),0)<>1 OR ids[1] IS DISTINCT FROM e.dso_actor_id
 OR NOT EXISTS(SELECT FROM public.platform_actor_identifiers i WHERE i.actor_id=e.dso_actor_id AND i.identifier_type='EdielId' AND i.identifier_value=e.legal_receiver_id AND i.is_verified AND (i.valid_from IS NULL OR i.valid_from<=current_date) AND (i.valid_to IS NULL OR current_date<=i.valid_to))
 OR NOT EXISTS(SELECT FROM public.platform_market_actors a WHERE a.id=e.dso_actor_id AND a.status='active' AND a.match_status='verified')
 OR NOT EXISTS(SELECT FROM public.platform_actor_roles r WHERE r.actor_id=e.dso_actor_id AND r.actor_role='grid_owner' AND r.is_active) THEN RETURN jsonb_build_object('status','held','missing',jsonb_build_array('production_contract_verified_dso_identity_required'));END IF;
 IF e.event_kind='ceased' THEN
 SELECT * INTO start FROM gridex_received_sources.production_contract_events WHERE id=e.start_event_id AND company_id=e.company_id FOR SHARE;
 IF start.id IS NULL OR start.event_kind IS DISTINCT FROM 'signed' OR start.environment IS DISTINCT FROM e.environment OR start.contract_id IS DISTINCT FROM e.contract_id OR start.metering_point_id IS DISTINCT FROM e.metering_point_id OR start.customer_id IS DISTINCT FROM e.customer_id OR start.boundary_at>=e.boundary_at OR EXISTS(SELECT FROM gridex_received_sources.production_contract_revocations r WHERE r.event_id=start.id)
 THEN RETURN jsonb_build_object('status','held','missing',jsonb_build_array('production_contract_original_start_required'));END IF;
 END IF;
 RETURN jsonb_build_object('status','authorized','companyId',e.company_id,'environment',e.environment,'eventId',e.id,'eventKind',e.event_kind,'sourceDigest',e.source_sha256,'sourceVersion',e.source_version,'sourceReference',e.source_reference,
 'legalActorId',e.legal_actor_id,'legalSenderId',e.legal_sender_id,'legalReceiverId',e.legal_receiver_id,'contractId',e.contract_id,'customerId',e.customer_id,'meteringPointId',e.metering_point_id,'pointId',e.point_id,'identityAgency',e.identity_agency,'gridArea',e.grid_area_code,
 'contractReference',e.contract_reference,'contractRevision',e.contract_revision,'boundaryAt',e.boundary_at);
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.production_contract_source_for_execution_v1(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.ediel_production_contract_source_v1(p_company_id uuid,p_event_id uuid,p_actor_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN RETURN gridex_received_sources.production_contract_source_for_execution_v1(p_company_id,p_event_id,p_actor_user_id,'communication.write');END $$;
CREATE OR REPLACE FUNCTION public.ediel_production_contract_message_basis_v1(p_company_id uuid,p_message_id uuid,p_actor_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o gridex_received_sources.production_contract_origins%rowtype;m public.ediel_messages%rowtype;b jsonb;r public.outbound_requests%rowtype;e gridex_received_sources.production_contract_events%rowtype;
BEGIN
 SELECT * INTO o FROM gridex_received_sources.production_contract_origins WHERE company_id=p_company_id AND message_id=p_message_id;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id FOR SHARE;
 IF m.intent_id IS DISTINCT FROM o.intent_id OR m.source_operation_id IS DISTINCT FROM o.event_id::text OR o.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'production_contract_bound_payload_changed';END IF;
 b:=gridex_received_sources.production_contract_source_for_execution_v1(p_company_id,o.event_id,p_actor_user_id,CASE WHEN public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.send') IS TRUE OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'ediel.send') IS TRUE THEN 'communication.send' ELSE 'communication.write' END);
 IF b->>'status' IS DISTINCT FROM 'authorized' THEN RETURN b;END IF;
 SELECT * INTO e FROM gridex_received_sources.production_contract_events WHERE id=o.event_id AND company_id=o.company_id;
 SELECT * INTO r FROM public.outbound_requests WHERE id=o.outbound_request_id AND company_id=o.company_id FOR SHARE;
 IF e.id IS NULL OR r.id IS NULL OR m.outbound_request_id IS DISTINCT FROM o.outbound_request_id OR (r.payload->>'environment') IS DISTINCT FROM e.environment
 OR r.source_type IS DISTINCT FROM 'manual' OR r.source_id IS DISTINCT FROM o.intent_id OR r.operation_id IS DISTINCT FROM e.id OR r.request_type IS DISTINCT FROM 'customer_masterdata'
 OR r.customer_id IS DISTINCT FROM m.customer_id OR r.site_id IS DISTINCT FROM m.site_id OR r.metering_point_id IS DISTINCT FROM m.metering_point_id THEN RAISE EXCEPTION 'production_contract_current_request_required';END IF;
 RETURN jsonb_build_object('basis',b,'intentId',o.intent_id);
END $$;
CREATE FUNCTION gridex_received_sources.require_production_contract_source_current_v1(p_company_id uuid,p_message_id uuid,p_actor_user_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;o gridex_received_sources.production_contract_origins%rowtype;e gridex_received_sources.production_contract_events%rowtype;i public.ediel_message_intents%rowtype;r public.outbound_requests%rowtype;point public.metering_points%rowtype;b jsonb;w jsonb;q jsonb;period gridex_received_sources.production_contract_periods%rowtype;op gridex_received_sources.prodat_recovery_operations%rowtype;original public.ediel_messages%rowtype;original_wire jsonb;actual_dates jsonb;original_dates jsonb;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id FOR SHARE;
 IF m.id IS NULL THEN RAISE EXCEPTION 'production_contract_current_message_required';END IF;
 IF m.direction IS DISTINCT FROM 'outbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.message_code IS DISTINCT FROM 'Z09' THEN RETURN;END IF;
 SELECT * INTO o FROM gridex_received_sources.production_contract_origins WHERE company_id=p_company_id AND message_id=m.id;
 w:=gridex_received_sources.prodat_recovery_wire_v1(m.raw_payload);
 IF o.event_id IS NULL THEN
  IF NOT EXISTS(SELECT FROM jsonb_array_elements(coalesce(w->'objects','[]')) own WHERE own->>'reason'='Z70') THEN RETURN;END IF;
  SELECT operation.* INTO op FROM gridex_received_sources.prodat_recovery_messages link JOIN gridex_received_sources.prodat_recovery_operations operation ON operation.id=link.operation_id WHERE link.message_id=m.id AND operation.company_id=p_company_id;
  IF op.id IS NOT NULL THEN
   PERFORM public.ediel_require_prodat_recovery_current_v1(p_company_id,m.id);
   SELECT * INTO original FROM public.ediel_messages WHERE id=op.original_message_id AND company_id=p_company_id FOR SHARE;
   original_wire:=gridex_received_sources.prodat_recovery_wire_v1(original.raw_payload);
   IF original.id IS NULL OR m.original_message_id IS DISTINCT FROM original.id OR m.source_operation_id IS DISTINCT FROM op.id::text OR (op.kind IN('contrl_correction','aperak_correction')) IS NOT TRUE OR op.corrected_raw_payload IS DISTINCT FROM m.raw_payload OR op.corrected_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
    OR original_wire->>'legalSender' IS DISTINCT FROM w->>'legalSender' OR original_wire->>'legalReceiver' IS DISTINCT FROM w->>'legalReceiver' OR jsonb_array_length(w->'objects') IS DISTINCT FROM 1 OR (w#>'{objects,0}'-'li'-'line') IS DISTINCT FROM (original_wire#>'{objects,0}'-'li'-'line') THEN RAISE EXCEPTION 'production_contract_recovery_source_scope_required';END IF;
   SELECT jsonb_agg(token->'elements'->1 ORDER BY token->>'index') INTO actual_dates FROM jsonb_array_elements(gridex_received_sources.closure_wire_tokens_v2(m.raw_payload)) token WHERE token->>'tag'='DTM' AND token#>>'{elements,1,0}' IN('92','93','157');
   SELECT jsonb_agg(token->'elements'->1 ORDER BY token->>'index') INTO original_dates FROM jsonb_array_elements(gridex_received_sources.closure_wire_tokens_v2(original.raw_payload)) token WHERE token->>'tag'='DTM' AND token#>>'{elements,1,0}' IN('92','93','157');
   IF actual_dates IS DISTINCT FROM original_dates THEN RAISE EXCEPTION 'production_contract_recovery_boundary_scope_required';END IF;
   PERFORM gridex_received_sources.require_production_contract_source_current_v1(p_company_id,original.id,p_actor_user_id);
   PERFORM gridex_ediel_transport.require_message_intent_v1(m);
   RETURN;
  END IF;
  -- A test environment alone cannot originate a production-contract event.
  IF m.environment IS DISTINCT FROM 'test' THEN RAISE EXCEPTION 'production_contract_current_origin_required';END IF;
  IF EXISTS(SELECT FROM gridex_negative_fixtures.positive_consumptions c WHERE c.company_id=p_company_id AND c.message_id=m.id) AND EXISTS(SELECT FROM gridex_negative_fixtures.negative_prepared_consumptions c WHERE c.company_id=p_company_id AND c.message_id=m.id) THEN RAISE EXCEPTION 'production_contract_fixture_source_ambiguous';END IF;
  IF EXISTS(SELECT FROM gridex_negative_fixtures.positive_consumptions c WHERE c.company_id=p_company_id AND c.message_id=m.id) THEN
   q:=gridex_negative_fixtures.require_positive_message_v1(p_company_id,m.id,'Z09');
   IF q->>'kind' IS DISTINCT FROM 'source_qualified_positive_fixture' OR q->>'expectedOutcome' IS DISTINCT FROM 'positive' OR q->'expectedDiagnosticCodes' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'production_contract_fixture_scope_required';END IF;
  ELSIF EXISTS(SELECT FROM gridex_negative_fixtures.negative_prepared_consumptions c WHERE c.company_id=p_company_id AND c.message_id=m.id) THEN
   q:=gridex_negative_fixtures.require_negative_message_v1(p_company_id,m.id,'Z09');
   IF q->>'kind' IS DISTINCT FROM 'source_qualified_negative_fixture' OR q->>'expectedOutcome' IS DISTINCT FROM 'negative' OR jsonb_typeof(q->'expectedDiagnosticCodes') IS DISTINCT FROM 'array' OR jsonb_array_length(q->'expectedDiagnosticCodes') NOT BETWEEN 1 AND 256 THEN RAISE EXCEPTION 'production_contract_fixture_scope_required';END IF;
  ELSE RAISE EXCEPTION 'production_contract_current_origin_required';END IF;
  IF q->>'companyId' IS DISTINCT FROM p_company_id::text OR q->>'roleCode' IS DISTINCT FROM 'supplier' OR q->>'authorizesBusinessEffect' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'production_contract_fixture_supplier_required';END IF;
  RETURN;
 END IF;
 b:=gridex_received_sources.production_contract_source_for_execution_v1(p_company_id,o.event_id,p_actor_user_id,'communication.send');
 IF b->>'status' IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION 'production_contract_current_source_required';END IF;
 SELECT * INTO STRICT e FROM gridex_received_sources.production_contract_events WHERE id=o.event_id AND company_id=p_company_id;
 SELECT * INTO i FROM public.ediel_message_intents WHERE id=o.intent_id AND company_id=p_company_id FOR SHARE;
 SELECT * INTO r FROM public.outbound_requests WHERE id=o.outbound_request_id AND company_id=p_company_id FOR SHARE;
 SELECT * INTO point FROM public.metering_points WHERE id=e.metering_point_id AND company_id=p_company_id FOR SHARE;
 SELECT * INTO period FROM gridex_received_sources.production_contract_periods WHERE start_event_id=CASE WHEN e.event_kind='signed' THEN e.id ELSE e.start_event_id END AND company_id=p_company_id FOR SHARE;
 IF i.id IS NULL OR r.id IS NULL OR point.id IS NULL OR period.start_event_id IS NULL OR w IS NULL OR m.intent_id IS DISTINCT FROM o.intent_id OR m.outbound_request_id IS DISTINCT FROM o.outbound_request_id OR m.source_operation_id IS DISTINCT FROM e.id::text
 OR m.environment IS DISTINCT FROM e.environment OR m.customer_id IS DISTINCT FROM e.customer_id OR m.metering_point_id IS DISTINCT FROM e.metering_point_id OR m.site_id IS DISTINCT FROM point.site_id OR m.immutable_rendered_at IS NULL OR m.immutable_payload_hash IS DISTINCT FROM o.payload_hash OR o.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
 OR i.operation_id IS DISTINCT FROM e.id OR i.ediel_message_id IS DISTINCT FROM m.id OR i.outbound_request_id IS DISTINCT FROM r.id OR i.validation_status IS DISTINCT FROM 'validated'
 OR (r.payload->>'environment') IS DISTINCT FROM e.environment OR r.source_type IS DISTINCT FROM 'manual' OR r.source_id IS DISTINCT FROM i.id OR r.operation_id IS DISTINCT FROM e.id OR r.request_type IS DISTINCT FROM 'customer_masterdata' OR r.customer_id IS DISTINCT FROM e.customer_id OR r.site_id IS DISTINCT FROM m.site_id OR r.metering_point_id IS DISTINCT FROM e.metering_point_id
 OR period.environment IS DISTINCT FROM e.environment OR period.contract_id IS DISTINCT FROM e.contract_id OR period.customer_id IS DISTINCT FROM e.customer_id OR period.metering_point_id IS DISTINCT FROM e.metering_point_id OR (e.event_kind='signed' AND (period.start_at IS DISTINCT FROM e.boundary_at OR period.end_at IS NOT NULL)) OR (e.event_kind='ceased' AND (period.end_event_id IS DISTINCT FROM e.id OR period.end_at IS DISTINCT FROM e.boundary_at))
 OR w->>'code' IS DISTINCT FROM 'Z09' OR w->>'legalSender' IS DISTINCT FROM e.legal_sender_id OR w->>'legalReceiver' IS DISTINCT FROM e.legal_receiver_id OR jsonb_array_length(w->'objects') IS DISTINCT FROM 1 OR w#>>'{objects,0,reason}' IS DISTINCT FROM 'Z70' OR w#>>'{objects,0,point}' IS DISTINCT FROM e.point_id OR w#>>'{objects,0,identityAgency}' IS DISTINCT FROM e.identity_agency
 THEN RAISE EXCEPTION 'production_contract_current_origin_required';END IF;
 PERFORM gridex_ediel_transport.require_message_intent_v1(m);
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.require_production_contract_source_current_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION gridex_ediel_transport.mutate_v1(jsonb) RENAME TO mutate_before_production_contract_source_v1;
CREATE FUNCTION gridex_ediel_transport.mutate_v1(input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 result:=gridex_ediel_transport.mutate_before_production_contract_source_v1(input);
 IF (input->>'action' IN('prepare','enter')) IS NOT TRUE OR result->>'proceed' IS DISTINCT FROM 'true' THEN RETURN result;END IF;
 PERFORM gridex_received_sources.require_production_contract_source_current_v1((input->>'companyId')::uuid,(input->>'messageId')::uuid,(input->>'actorUserId')::uuid);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION gridex_ediel_transport.mutate_v1(jsonb),gridex_ediel_transport.mutate_before_production_contract_source_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
-- Point observations use the same owner, not a second status/date engine.
-- PostgreSQL timestamps are discrete microsecond values: at < end is exactly
-- equivalent to next_representable_timestamp(at) <= end. The successor is a
-- membership probe, not a market deadline, guessed minute or approved period.
CREATE FUNCTION gridex_received_sources.supply_period_source_at_v1(p_company_id uuid,p_period_id uuid,p_at timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE basis jsonb;
BEGIN
 IF p_at IS NULL OR NOT isfinite(p_at) THEN RETURN NULL;END IF;
 basis:=gridex_received_sources.supply_period_source_basis_v1(p_company_id,p_period_id,p_at,p_at+interval '1 microsecond');
 IF basis IS NULL OR basis->>'qualified' IS DISTINCT FROM 'true' OR (basis->>'marketStartAt')::timestamptz IS NULL OR (basis->>'marketStartAt')::timestamptz>p_at OR ((basis->>'marketEndAt') IS NOT NULL AND p_at>=(basis->>'marketEndAt')::timestamptz) THEN RETURN NULL;END IF;
 RETURN basis||jsonb_build_object('basisKind','exact_source_point','at',p_at);
EXCEPTION WHEN datetime_field_overflow THEN RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.supply_period_source_at_v1(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
