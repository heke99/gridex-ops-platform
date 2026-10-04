-- P12/P13/P14: complete physical source scope is qualified before any write.
-- Operational DATE columns are projections; exact events and original decisions
-- remain in an immutable tenant-bound ledger. No consumer/grant is deleted.
BEGIN;
ALTER TABLE public.customer_supply_periods ADD COLUMN market_start_at timestamptz, ADD COLUMN market_end_at timestamptz, ADD COLUMN market_state_version bigint NOT NULL DEFAULT 0, ADD COLUMN source_end_message_id uuid REFERENCES public.ediel_messages(id);
CREATE TABLE gridex_received_sources.regulated_supply_ground_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),environment text NOT NULL CHECK(environment IN ('test','production')),
 legal_actor_id uuid NOT NULL,dso_actor_id uuid NOT NULL,grid_area_code text NOT NULL,process text NOT NULL CHECK(process IN ('assigned_supply','production_receipt_obligation')),
 bilateral_agreement_id uuid NOT NULL REFERENCES public.tenant_bilateral_agreements(id),consumption_supply_period_id uuid REFERENCES public.customer_supply_periods(id),
 source_reference text NOT NULL CHECK(length(source_reference)>0),source_sha256 text NOT NULL CHECK(source_sha256~'^[a-f0-9]{64}$'),legal_decision_reference text NOT NULL CHECK(length(legal_decision_reference)>0),registry_version text NOT NULL CHECK(length(registry_version)>0),
 approved_by uuid NOT NULL REFERENCES auth.users(id),approved_at timestamptz NOT NULL,valid_from timestamptz NOT NULL,valid_to timestamptz CHECK(valid_to>valid_from),revoked_at timestamptz,
 UNIQUE(company_id,environment,legal_actor_id,dso_actor_id,grid_area_code,process,registry_version)
);
-- No approval API or seed: authentic mandate/decision and versioned registry
-- import must be established independently before these held capabilities run.
ALTER TABLE gridex_received_sources.regulated_supply_ground_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_received_sources.regulated_supply_ground_versions FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE gridex_received_sources.supply_source_transitions (
 source_message_id uuid PRIMARY KEY REFERENCES public.ediel_messages(id) ON DELETE RESTRICT,company_id uuid NOT NULL REFERENCES public.companies(id),
 payload_hash text NOT NULL,source_code text NOT NULL,source_objects jsonb NOT NULL,previous_states jsonb NOT NULL,resulting_states jsonb NOT NULL,
 qualified_switch_ids uuid[] NOT NULL,actor_user_id uuid NOT NULL,applied_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE gridex_received_sources.supply_source_transitions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_received_sources.supply_source_transitions FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER supply_source_transition_immutable BEFORE UPDATE OR DELETE ON gridex_received_sources.supply_source_transitions FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();
CREATE TRIGGER supply_source_transition_no_truncate BEFORE TRUNCATE ON gridex_received_sources.supply_source_transitions FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();
CREATE FUNCTION gridex_received_sources.supply_wire_v1(p_raw text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE tokens jsonb:=gridex_received_sources.closure_wire_tokens_v2(p_raw);t jsonb;e jsonb;out jsonb:='{}';objects jsonb:='[]';obj jsonb;characteristic text;key text;value text;
BEGIN
 IF tokens IS NULL THEN RETURN NULL; END IF;
 FOR t IN SELECT x FROM jsonb_array_elements(tokens) x ORDER BY (x->>'index')::int LOOP
  e:=t->'elements';
  IF t->>'tag'='BGM' THEN out:=out||jsonb_build_object('code',e#>>'{1,0}','bgmId',e#>>'{2,0}'); END IF;
  IF t->>'tag'='NAD' AND obj IS NULL AND e#>>'{1,0}' IN ('FR','DO') THEN
   key:=CASE e#>>'{1,0}' WHEN 'FR' THEN 'sender' ELSE 'receiver' END;
   IF out ? key OR e#>>'{2,1}' IS DISTINCT FROM '160' OR e#>>'{2,2}' IS DISTINCT FROM 'SVK' THEN RETURN NULL; END IF;
   out:=out||jsonb_build_object(key,e#>>'{2,0}');
  END IF;
  IF t->>'tag'='LIN' THEN
   IF obj IS NOT NULL THEN objects:=objects||jsonb_build_array(obj); END IF;
   obj:=jsonb_build_object('point',nullif(e#>>'{3,0}',''),'line',e#>>'{1,0}');characteristic:=NULL;
  ELSIF obj IS NOT NULL THEN
   key:=NULL;value:=NULL;
   IF t->>'tag'='RFF' AND e#>>'{1,0}' IN ('LI','Z05','Z07') THEN key:=CASE e#>>'{1,0}' WHEN 'LI' THEN 'li' WHEN 'Z05' THEN 'gridArea' ELSE 'consumptionPoint' END;value:=e#>>'{1,1}';
   ELSIF t->>'tag'='NAD' AND e#>>'{1,0}'='UD' THEN key:='customerIdentity';value:=e#>>'{2,0}';
   ELSIF t->>'tag'='DTM' AND e#>>'{1,0}' IN ('92','93') THEN
    key:=CASE e#>>'{1,0}' WHEN '92' THEN 'start' ELSE 'end' END;value:=e#>>'{1,1}';
    IF e#>>'{1,2}' IS DISTINCT FROM '203' THEN RETURN NULL; END IF;
   ELSIF t->>'tag'='CCI' THEN characteristic:=e#>>'{2,0}';
   ELSIF t->>'tag'='CAV' THEN key:=CASE characteristic WHEN 'Z13' THEN 'reason' WHEN 'Z23' THEN 'status' END;value:=e#>>'{1,0}';
   END IF;
   IF key IS NOT NULL THEN IF obj ? key THEN RETURN NULL; END IF;obj:=obj||jsonb_build_object(key,nullif(value,''));END IF;
  END IF;
 END LOOP;
 IF obj IS NOT NULL THEN objects:=objects||jsonb_build_array(obj);END IF;
 IF (out->>'code' IN ('Z03','Z04','Z05','Z09')) IS NOT TRUE OR nullif(out->>'sender','') IS NULL OR nullif(out->>'receiver','') IS NULL OR jsonb_array_length(objects)=0 THEN RETURN NULL;END IF;
 RETURN out||jsonb_build_object('objects',objects);
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.supply_wire_v1(text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ediel_apply_supply_source_v1(p_company_id uuid,p_source_message_id uuid,p_actor_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE m public.ediel_messages%rowtype;sp public.customer_supply_periods%rowtype;sw public.supplier_switch_requests%rowtype;origin public.ediel_messages%rowtype;
 prior gridex_received_sources.supply_source_transitions%rowtype;ground gridex_received_sources.regulated_supply_ground_versions%rowtype;
 wire jsonb;original jsonb;own jsonb;entry jsonb;plan jsonb;plans jsonb:='[]';before_states jsonb:='[]';after_states jsonb;old jsonb;
 ids uuid[];point public.metering_points%rowtype;consumption public.metering_points%rowtype;legal_actor uuid;dso_actor uuid;
 event_at timestamptz;start_at timestamptz;reason text;period_id uuid;expected_version bigint;qualified boolean;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_source_message_id AND company_id=p_company_id FOR UPDATE;
 IF NOT FOUND OR m.direction IS DISTINCT FROM 'inbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR p_actor_user_id IS NULL THEN RETURN jsonb_build_object('applied',false,'reason','supply_source_unavailable');END IF;
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 PERFORM cm.id FROM public.company_memberships cm WHERE cm.company_id=m.company_id AND cm.user_id=p_actor_user_id FOR SHARE;
 IF NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active') OR NOT coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,m.company_id,'metering.write'),false)
 OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=m.company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL) THEN RETURN jsonb_build_object('applied',false,'reason','supply_execution_actor_unqualified');END IF;
 SELECT * INTO prior FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=m.id;
 IF FOUND THEN IF prior.company_id IS DISTINCT FROM m.company_id OR prior.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'supply_replay_conflict';END IF;RETURN jsonb_build_object('applied',true,'idempotent',true,'periods',prior.resulting_states);END IF;
 IF NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments v WHERE v.source_message_id=m.id AND v.company_id=m.company_id AND v.environment=m.environment AND v.source_payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
 AND v.facts_text::jsonb->>'syntaxDecision'='accepted' AND v.facts_text::jsonb->>'applicationDecision'='accepted' AND v.facts_text::jsonb->>'functionalDecision'='accepted' AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id)) THEN RETURN jsonb_build_object('applied',false,'reason','canonical_supply_source_not_accepted');END IF;
 wire:=gridex_received_sources.supply_wire_v1(m.raw_payload);
 IF wire IS NULL OR (wire->>'code' IN ('Z04','Z05')) IS NOT TRUE THEN RETURN jsonb_build_object('applied',false,'reason','supply_wire_unavailable');END IF;
 -- No mixed physical subtype, duplicate point, or partially applied message.
 SELECT o->>'reason' INTO reason FROM jsonb_array_elements(wire->'objects') o LIMIT 1;
 IF nullif(reason,'') IS NULL OR EXISTS(SELECT FROM jsonb_array_elements(wire->'objects') o WHERE o->>'reason' IS DISTINCT FROM reason OR nullif(o->>'point','') IS NULL OR nullif(o->>'li','') IS NULL)
 OR (SELECT count(DISTINCT o->>'point') FROM jsonb_array_elements(wire->'objects') o)<>jsonb_array_length(wire->'objects') THEN RETURN jsonb_build_object('applied',false,'reason','supply_object_scope_unqualified');END IF;
 PERFORM tp.id FROM public.tenant_ediel_profiles tp WHERE tp.company_id=m.company_id AND tp.environment=m.environment ORDER BY tp.id FOR SHARE;
 PERFORM i.id FROM public.tenant_actor_identifiers i WHERE i.company_id=m.company_id AND i.environment=m.environment ORDER BY i.id FOR SHARE;
 PERFORM r.id FROM public.tenant_actor_roles r WHERE r.company_id=m.company_id AND r.environment=m.environment ORDER BY r.id FOR SHARE;
 IF NOT EXISTS(SELECT FROM public.tenant_ediel_profiles tp WHERE tp.company_id=m.company_id AND tp.environment=m.environment AND tp.market='electricity' AND tp.is_enabled AND tp.valid_from<=m.message_received_at AND (tp.valid_to IS NULL OR m.message_received_at<tp.valid_to)) THEN RETURN jsonb_build_object('applied',false,'reason','supply_tenant_profile_unqualified');END IF;
 SELECT array_agg(DISTINCT i.actor_id) INTO ids FROM public.tenant_actor_identifiers i JOIN public.tenant_actor_roles r ON r.company_id=i.company_id AND r.environment=i.environment AND r.actor_id=i.actor_id
 WHERE i.company_id=m.company_id AND i.environment=m.environment AND i.identifier_type='EdielId' AND i.identifier_value=wire->>'receiver' AND i.valid_from<=m.message_received_at AND (i.valid_to IS NULL OR m.message_received_at<i.valid_to)
 AND r.role_code='electricity_supplier' AND r.valid_from<=m.message_received_at AND (r.valid_to IS NULL OR m.message_received_at<r.valid_to);
 IF coalesce(cardinality(ids),0)<>1 THEN RETURN jsonb_build_object('applied',false,'reason','supply_legal_actor_unqualified');END IF;legal_actor:=ids[1];
 FOR own IN SELECT o FROM jsonb_array_elements(wire->'objects') o ORDER BY o->>'point' LOOP
  event_at:=gridex_received_sources.permission_time_v1(own->>CASE WHEN wire->>'code'='Z04' THEN 'start' ELSE 'end' END);
  IF event_at IS NULL THEN RETURN jsonb_build_object('applied',false,'reason','supply_effective_time_unavailable');END IF;
  IF wire->>'code'='Z04' AND reason IN ('Z26','Z70') THEN
   SELECT array_agg(mp.id ORDER BY mp.id) INTO ids FROM public.metering_points mp WHERE mp.company_id=m.company_id AND mp.ediel_metering_point_id=own->>'point' AND mp.grid_area_code=own->>'gridArea' AND mp.grid_owner_ediel_id=wire->>'sender'
    AND mp.customer_id IS NOT NULL AND (m.customer_id IS NULL OR m.customer_id=mp.customer_id) AND (m.metering_point_id IS NULL OR m.metering_point_id=mp.id);
   IF coalesce(cardinality(ids),0)<>1 THEN RETURN jsonb_build_object('applied',false,'reason','regulated_supply_exact_object_unavailable');END IF;
   SELECT * INTO point FROM public.metering_points WHERE id=ids[1] AND company_id=m.company_id FOR UPDATE;
   PERFORM customer.id FROM public.customers customer WHERE customer.id=point.customer_id AND customer.company_id=m.company_id FOR SHARE;
   IF NOT EXISTS(SELECT FROM public.customers customer WHERE customer.id=point.customer_id AND customer.company_id=m.company_id AND own->>'customerIdentity'=coalesce(nullif(btrim(customer.org_number),''),nullif(btrim(customer.personal_number),''))) THEN RETURN jsonb_build_object('applied',false,'reason','regulated_supply_customer_identity_unqualified');END IF;
   PERFORM ai.id FROM public.platform_actor_identifiers ai WHERE lower(ai.identifier_type) IN ('edielid','ediel_id') AND ai.identifier_value=wire->>'sender' ORDER BY ai.id FOR SHARE;
   SELECT array_agg(DISTINCT ai.actor_id) INTO ids FROM public.platform_actor_identifiers ai WHERE lower(ai.identifier_type) IN ('edielid','ediel_id') AND ai.identifier_value=wire->>'sender' AND ai.is_verified AND (ai.valid_from IS NULL OR ai.valid_from<=(m.message_received_at AT TIME ZONE 'Etc/GMT-1')::date) AND (ai.valid_to IS NULL OR (m.message_received_at AT TIME ZONE 'Etc/GMT-1')::date<=ai.valid_to);
   IF coalesce(cardinality(ids),0)<>1 THEN RETURN jsonb_build_object('applied',false,'reason','regulated_supply_dso_registry_unavailable');END IF;dso_actor:=ids[1];
   PERFORM ba.id FROM public.tenant_bilateral_agreements ba WHERE ba.company_id=m.company_id AND ba.environment=m.environment AND ba.counterparty_actor_id=dso_actor ORDER BY ba.id FOR SHARE;
   PERFORM g.id FROM gridex_received_sources.regulated_supply_ground_versions g WHERE g.company_id=m.company_id AND g.environment=m.environment AND g.legal_actor_id=legal_actor AND g.dso_actor_id=dso_actor AND g.grid_area_code=own->>'gridArea' ORDER BY g.id FOR SHARE;
   SELECT array_agg(g.id ORDER BY g.id) INTO ids FROM gridex_received_sources.regulated_supply_ground_versions g JOIN public.tenant_bilateral_agreements ba ON ba.id=g.bilateral_agreement_id AND ba.company_id=g.company_id AND ba.environment=g.environment AND ba.counterparty_actor_id=g.dso_actor_id
   WHERE g.company_id=m.company_id AND g.environment=m.environment AND g.legal_actor_id=legal_actor AND g.dso_actor_id=dso_actor AND g.grid_area_code=own->>'gridArea' AND g.process=CASE reason WHEN 'Z26' THEN 'assigned_supply' ELSE 'production_receipt_obligation' END
    AND g.approved_at<=m.message_received_at AND g.revoked_at IS NULL AND g.valid_from<=event_at AND (g.valid_to IS NULL OR event_at<g.valid_to) AND ba.is_enabled AND ba.valid_from<=event_at AND (ba.valid_to IS NULL OR event_at<ba.valid_to) AND ba.source_reference=g.source_reference;
   IF coalesce(cardinality(ids),0)<>1 THEN RETURN jsonb_build_object('applied',false,'reason','regulated_supply_authentic_ground_required');END IF;
   SELECT * INTO ground FROM gridex_received_sources.regulated_supply_ground_versions WHERE id=ids[1] FOR SHARE;
   IF reason='Z70' THEN
    SELECT cp.* INTO consumption FROM public.customer_supply_periods rel JOIN public.metering_points cp ON cp.id=rel.metering_point_id AND cp.company_id=rel.company_id JOIN public.customer_contracts cc ON cc.id=coalesce(rel.customer_contract_id,rel.contract_id) AND cc.company_id=rel.company_id AND cc.customer_id=rel.customer_id
    WHERE rel.id=ground.consumption_supply_period_id AND rel.company_id=m.company_id AND rel.customer_id=point.customer_id AND cp.ediel_metering_point_id=own->>'consumptionPoint' AND cp.product_direction='consumption' AND cc.energy_direction='consumption' AND cc.status IN ('signed','active') AND rel.status IN ('active','confirmed_by_grid_owner')
    AND rel.start_date<=gridex_received_sources.permission_date_v1(own->>'start') AND (rel.end_date IS NULL OR rel.end_date>gridex_received_sources.permission_date_v1(own->>'start')) FOR SHARE OF rel,cp,cc;
    IF NOT FOUND OR point.product_direction IS DISTINCT FROM 'production' THEN RETURN jsonb_build_object('applied',false,'reason','production_obligation_own_consumption_link_required');END IF;
   END IF;
   IF EXISTS(SELECT FROM public.customer_supply_periods p WHERE p.company_id=m.company_id AND p.metering_point_id=point.id AND p.status NOT IN ('cancelled','ended') AND (p.end_date IS NULL OR p.end_date>gridex_received_sources.permission_date_v1(own->>'start'))) THEN RETURN jsonb_build_object('applied',false,'reason','regulated_supply_conflicting_period');END IF;
   period_id:=gen_random_uuid();plans:=plans||jsonb_build_array(jsonb_build_object('kind','regulated','periodId',period_id,'pointId',point.id,'customerId',point.customer_id,'eventAt',event_at,'groundId',ground.id,'object',own));
  ELSIF wire->>'code'='Z04' AND reason='Z24' THEN
   -- Match every cancellation to its sealed, actually sent original Z03.
   SELECT array_agg(s.id ORDER BY s.id) INTO ids FROM public.supplier_switch_requests s JOIN public.ediel_messages z ON z.id=s.outbound_z03_message_id AND z.company_id=s.company_id AND z.environment=m.environment
    WHERE s.company_id=m.company_id AND z.direction='outbound' AND z.message_sent_at IS NOT NULL AND z.status='sent' AND z.immutable_rendered_at IS NOT NULL AND z.immutable_payload_hash=encode(sha256(convert_to(z.raw_payload,'UTF8')),'hex')
    AND EXISTS(SELECT FROM jsonb_array_elements(gridex_received_sources.supply_wire_v1(z.raw_payload)->'objects') o WHERE o->>'point'=own->>'point' AND o->>'li'=own->>'li' AND o->>'customerIdentity'=own->>'customerIdentity' AND o->>'start'=own->>'start' AND o->>'reason' IN ('Z22','Z23'))
    AND gridex_received_sources.supply_wire_v1(z.raw_payload)->>'sender'=wire->>'receiver' AND gridex_received_sources.supply_wire_v1(z.raw_payload)->>'receiver'=wire->>'sender';
   IF coalesce(cardinality(ids),0)<>1 THEN RETURN jsonb_build_object('applied',false,'reason','z04c_exact_original_unavailable');END IF;
   SELECT * INTO sw FROM public.supplier_switch_requests WHERE id=ids[1] AND company_id=m.company_id FOR UPDATE;
   SELECT * INTO origin FROM public.ediel_messages WHERE id=sw.outbound_z03_message_id AND company_id=m.company_id AND environment=m.environment FOR SHARE;
   original:=gridex_received_sources.supply_wire_v1(origin.raw_payload);
   IF NOT FOUND OR origin.direction IS DISTINCT FROM 'outbound' OR origin.status IS DISTINCT FROM 'sent' OR origin.message_sent_at IS NULL OR origin.immutable_rendered_at IS NULL OR origin.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(origin.raw_payload,'UTF8')),'hex')
    OR original IS NULL OR original->>'code' IS DISTINCT FROM 'Z03' OR original->>'sender' IS DISTINCT FROM wire->>'receiver' OR original->>'receiver' IS DISTINCT FROM wire->>'sender'
    OR origin.customer_id IS DISTINCT FROM sw.customer_id OR origin.metering_point_id IS DISTINCT FROM sw.metering_point_id OR (m.customer_id IS NOT NULL AND m.customer_id<>sw.customer_id) OR (m.metering_point_id IS NOT NULL AND m.metering_point_id<>sw.metering_point_id)
    OR NOT EXISTS(SELECT FROM jsonb_array_elements(original->'objects') o WHERE o->>'point'=own->>'point' AND o->>'li'=own->>'li' AND o->>'customerIdentity'=own->>'customerIdentity' AND o->>'start'=own->>'start' AND o->>'reason' IN ('Z22','Z23'))
    THEN RETURN jsonb_build_object('applied',false,'reason','z04c_locked_original_mismatch');END IF;
   IF (sw.status IN ('draft','prepared','queued','sent','submitted','waiting','waiting_for_z04','accepted','cancellation_requested','cancelled_before_start')) IS NOT TRUE THEN RETURN jsonb_build_object('applied',false,'reason','z04c_effect_already_executed_compensation_required');END IF;
   SELECT array_agg(p.id ORDER BY p.id) INTO ids FROM public.customer_supply_periods p WHERE p.company_id=m.company_id AND p.customer_id=sw.customer_id AND p.metering_point_id=sw.metering_point_id AND (p.source_switch_request_id=sw.id OR p.source_message_id=sw.inbound_z04_message_id);
   IF coalesce(cardinality(ids),0)>1 THEN RETURN jsonb_build_object('applied',false,'reason','z04c_conflicting_periods');END IF;
   IF coalesce(cardinality(ids),0)=1 THEN
    SELECT * INTO sp FROM public.customer_supply_periods WHERE id=ids[1] AND company_id=m.company_id FOR UPDATE;
    IF sp.status IS DISTINCT FROM 'confirmed_by_grid_owner' OR sp.customer_id IS DISTINCT FROM sw.customer_id OR sp.metering_point_id IS DISTINCT FROM sw.metering_point_id OR sp.start_date IS DISTINCT FROM gridex_received_sources.permission_date_v1(own->>'start') OR coalesce(sp.market_start_at,sp.start_date::timestamp AT TIME ZONE 'Etc/GMT-1')<=now() THEN RETURN jsonb_build_object('applied',false,'reason','z04c_effect_already_executed_compensation_required');END IF;
    before_states:=before_states||jsonb_build_array(to_jsonb(sp));period_id:=sp.id;
   ELSE period_id:=NULL;END IF;
   plans:=plans||jsonb_build_array(jsonb_build_object('kind','cancel_start','periodId',period_id,'switchId',sw.id,'object',own));
  ELSIF wire->>'code'='Z05' AND reason='Z24' THEN
   SELECT array_agg(p.id ORDER BY p.id) INTO ids FROM public.customer_supply_periods p JOIN gridex_received_sources.supply_source_transitions tr ON tr.source_message_id=p.source_end_message_id AND tr.company_id=p.company_id
    JOIN public.ediel_messages z ON z.id=tr.source_message_id AND z.company_id=tr.company_id AND z.environment=m.environment
    WHERE p.company_id=m.company_id AND z.direction='inbound' AND tr.payload_hash=encode(sha256(convert_to(z.raw_payload,'UTF8')),'hex') AND gridex_received_sources.supply_wire_v1(z.raw_payload)->>'sender'=wire->>'sender' AND gridex_received_sources.supply_wire_v1(z.raw_payload)->>'receiver'=wire->>'receiver'
    AND EXISTS(SELECT FROM jsonb_array_elements(tr.source_objects) o WHERE o->>'point'=own->>'point' AND o->>'li'=own->>'li' AND o->>'end'=own->>'end')
    AND EXISTS(SELECT FROM jsonb_array_elements(tr.resulting_states) state WHERE state->>'id'=p.id::text AND (state->>'market_state_version')::bigint=p.market_state_version AND (state-ARRAY['updated_at','status'])=(to_jsonb(p)-ARRAY['updated_at','status']));
   IF coalesce(cardinality(ids),0)<>1 THEN RETURN jsonb_build_object('applied',false,'reason','z05c_exact_original_ending_unavailable');END IF;
   SELECT * INTO sp FROM public.customer_supply_periods WHERE id=ids[1] AND company_id=m.company_id FOR UPDATE;
   SELECT * INTO prior FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=sp.source_end_message_id AND company_id=m.company_id;
   SELECT state INTO old FROM jsonb_array_elements(prior.previous_states) state WHERE state->>'id'=sp.id::text;
   IF old IS NULL OR NOT EXISTS(SELECT FROM jsonb_array_elements(prior.resulting_states) saved WHERE saved->>'id'=sp.id::text AND (sp.status=saved->>'status' OR sp.status='ended' AND saved->>'status'='ending' AND sp.market_end_at<=now())) OR EXISTS(SELECT FROM public.customer_supply_periods p WHERE p.company_id=m.company_id AND p.metering_point_id=sp.metering_point_id AND p.id<>sp.id AND p.status NOT IN ('ended','cancelled') AND (p.end_date IS NULL OR p.end_date>sp.start_date)) THEN RETURN jsonb_build_object('applied',false,'reason','z05c_conflicting_continuation');END IF;
   before_states:=before_states||jsonb_build_array(to_jsonb(sp));plans:=plans||jsonb_build_array(jsonb_build_object('kind','restore_end','periodId',sp.id,'previous',old,'object',own));
  ELSIF wire->>'code'='Z05' AND reason IN ('Z22','Z23') THEN
   -- Actual accepted baseline owner ties the physical object to a relationship;
   -- a unique local row or DATE similarity is never sufficient authority.
   SELECT array_agg(p.id ORDER BY p.id) INTO ids FROM public.customer_supply_periods p
    WHERE p.company_id=m.company_id AND p.status IN ('active','confirmed_by_grid_owner','ending') AND p.source_end_message_id IS NULL AND (
     EXISTS(SELECT FROM gridex_received_sources.object_assessments assessment JOIN gridex_received_sources.sources src ON src.source_message_id=assessment.source_message_id AND src.company_id=assessment.company_id AND src.payload_hash=assessment.source_payload_hash
      JOIN public.ediel_messages base ON base.id=src.source_message_id AND base.company_id=src.company_id AND base.environment=src.environment AND base.direction='inbound' AND src.payload_hash=encode(sha256(convert_to(base.raw_payload,'UTF8')),'hex')
      CROSS JOIN LATERAL jsonb_array_elements(assessment.facts_text::jsonb->'objects') object
      WHERE assessment.company_id=p.company_id AND assessment.environment=m.environment AND assessment.source_message_id=p.source_message_id
       AND object->>'disposition'='accepted' AND object#>>'{object,objectId}'=own->>'point' AND object#>>'{object,identityAgency}'='9'
       AND object#>>'{business,supplyPeriodId}'=p.id::text AND object#>>'{business,customerId}'=p.customer_id::text AND object#>>'{business,meteringPointId}'=p.metering_point_id::text
       AND object#>>'{business,owner}' IN ('inbound-z04-switch-confirmation-v1','reviewed-received-structure-v1')
       AND object#>>'{party,parties,legalSender}'=wire->>'sender' AND object#>>'{party,parties,legalReceiver}'=wire->>'receiver'
       AND NOT EXISTS(SELECT FROM gridex_received_sources.object_assessments child WHERE child.previous_assessment_id=assessment.id))
     OR EXISTS(SELECT FROM gridex_received_sources.supply_source_transitions tr JOIN public.ediel_messages base ON base.id=tr.source_message_id AND base.company_id=tr.company_id AND base.environment=m.environment AND base.direction='inbound'
      WHERE tr.company_id=p.company_id AND tr.source_message_id=p.source_message_id AND tr.source_code='Z04' AND tr.payload_hash=encode(sha256(convert_to(base.raw_payload,'UTF8')),'hex')
       AND EXISTS(SELECT FROM jsonb_array_elements(tr.resulting_states) state WHERE state->>'id'=p.id::text AND state->>'customer_id'=p.customer_id::text AND state->>'metering_point_id'=p.metering_point_id::text)
       AND EXISTS(SELECT FROM jsonb_array_elements(tr.source_objects) object WHERE object->>'point'=own->>'point' AND object->>'customerIdentity'=own->>'customerIdentity' AND object->>'gridArea'=own->>'gridArea' AND object->>'reason' IN ('Z26','Z70')))
    );
   IF coalesce(cardinality(ids),0)<>1 THEN RETURN jsonb_build_object('applied',false,'reason','z05_accepted_relationship_baseline_required');END IF;
   SELECT * INTO sp FROM public.customer_supply_periods WHERE id=ids[1] AND company_id=m.company_id FOR UPDATE;
   SELECT * INTO origin FROM public.ediel_messages WHERE id=sp.source_message_id AND company_id=m.company_id AND environment=m.environment FOR SHARE;
   original:=gridex_received_sources.supply_wire_v1(origin.raw_payload);
   IF original IS NULL OR original->>'code' IS DISTINCT FROM 'Z04' OR original->>'sender' IS DISTINCT FROM wire->>'sender' OR original->>'receiver' IS DISTINCT FROM wire->>'receiver'
    OR NOT EXISTS(SELECT FROM jsonb_array_elements(original->'objects') o WHERE o->>'point'=own->>'point' AND o->>'customerIdentity'=own->>'customerIdentity' AND o->>'gridArea'=own->>'gridArea' AND gridex_received_sources.permission_time_v1(o->>'start')<event_at)
    OR (m.customer_id IS NOT NULL AND m.customer_id<>sp.customer_id) OR (m.metering_point_id IS NOT NULL AND m.metering_point_id<>sp.metering_point_id) THEN RETURN jsonb_build_object('applied',false,'reason','z05_original_object_mismatch');END IF;
   before_states:=before_states||jsonb_build_array(to_jsonb(sp));plans:=plans||jsonb_build_array(jsonb_build_object('kind','end','periodId',sp.id,'eventAt',event_at,'object',own));
  ELSE RETURN jsonb_build_object('applied',false,'reason','supply_profile_not_qualified');END IF;
 END LOOP;
 -- All owned objects, current originals and ground records are locked/qualified.
 FOR plan IN SELECT x FROM jsonb_array_elements(plans) x LOOP
  IF plan->>'kind'='regulated' THEN
   INSERT INTO public.customer_supply_periods(id,company_id,customer_id,metering_point_id,start_date,market_start_at,source,source_process,source_message_id,status,market_state_version,metadata)
    VALUES((plan->>'periodId')::uuid,m.company_id,(plan->>'customerId')::uuid,(plan->>'pointId')::uuid,gridex_received_sources.permission_date_v1(plan#>>'{object,start}'),(plan->>'eventAt')::timestamptz,'ediel_qualified_source',CASE reason WHEN 'Z26' THEN 'assigned_supply' ELSE 'production_receipt_obligation' END,m.id,'confirmed_by_grid_owner',1,jsonb_build_object('sourceGroundId',plan->>'groundId','sourceObject',plan->'object','sourceReceivedAt',m.message_received_at));
  ELSIF plan->>'kind'='cancel_start' THEN
   UPDATE public.supplier_switch_requests SET status='cancelled_before_start',inbound_z04_message_id=m.id,completed_at=now(),updated_at=now() WHERE id=(plan->>'switchId')::uuid AND company_id=m.company_id;
   UPDATE public.customer_supply_periods SET status='cancelled',market_state_version=market_state_version+1,updated_at=now(),metadata=coalesce(metadata,'{}')||jsonb_build_object('startCancellationSource',m.id) WHERE id=(plan->>'periodId')::uuid AND company_id=m.company_id;
  ELSIF plan->>'kind'='end' THEN
   UPDATE public.customer_supply_periods SET end_date=gridex_received_sources.permission_date_v1(plan#>>'{object,end}'),market_end_at=(plan->>'eventAt')::timestamptz,source_end_message_id=m.id,status=CASE WHEN (plan->>'eventAt')::timestamptz<=now() THEN 'ended' ELSE 'ending' END,market_state_version=market_state_version+1,updated_at=now() WHERE id=(plan->>'periodId')::uuid AND company_id=m.company_id;
  ELSIF plan->>'kind'='restore_end' THEN
   UPDATE public.customer_supply_periods SET status=plan#>>'{previous,status}',end_date=(plan#>>'{previous,end_date}')::date,market_end_at=(plan#>>'{previous,market_end_at}')::timestamptz,source_end_message_id=(plan#>>'{previous,source_end_message_id}')::uuid,market_state_version=market_state_version+1,updated_at=now(),metadata=coalesce(metadata,'{}')||jsonb_build_object('endCancellationSource',m.id) WHERE id=(plan->>'periodId')::uuid AND company_id=m.company_id;
  END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]'::jsonb) INTO after_states FROM public.customer_supply_periods p WHERE p.company_id=m.company_id AND p.id IN (SELECT (plan->>'periodId')::uuid FROM jsonb_array_elements(plans) plan);
 INSERT INTO gridex_received_sources.supply_source_transitions(source_message_id,company_id,payload_hash,source_code,source_objects,previous_states,resulting_states,qualified_switch_ids,actor_user_id) VALUES(m.id,m.company_id,encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'),wire->>'code',wire->'objects',before_states,after_states,ARRAY(SELECT (plan->>'switchId')::uuid FROM jsonb_array_elements(plans) plan WHERE plan->>'kind'='cancel_start'),p_actor_user_id);
 RETURN jsonb_build_object('applied',true,'periods',after_states,'regulated',wire->>'code'='Z04' AND reason IN ('Z26','Z70'));
END $$;
REVOKE ALL ON FUNCTION public.ediel_apply_supply_source_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_apply_supply_source_v1(uuid,uuid,uuid) TO service_role;
CREATE FUNCTION public.ediel_supply_start_is_cancelled_v1(p_company_id uuid,p_switch_request_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT FROM public.supplier_switch_requests sw JOIN gridex_received_sources.supply_source_transitions tr ON tr.source_message_id=sw.inbound_z04_message_id AND tr.company_id=sw.company_id WHERE sw.id=p_switch_request_id AND sw.company_id=p_company_id AND sw.status='cancelled_before_start' AND sw.id=ANY(tr.qualified_switch_ids) AND tr.source_code='Z04' AND EXISTS(SELECT FROM jsonb_array_elements(tr.source_objects) o WHERE o->>'reason'='Z24'))
$$;
REVOKE ALL ON FUNCTION public.ediel_supply_start_is_cancelled_v1(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_supply_start_is_cancelled_v1(uuid,uuid) TO service_role;
CREATE FUNCTION public.ediel_advance_supply_deadlines_v1(p_company_id uuid,p_actor_user_id uuid,p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE changed integer;activated integer;
BEGIN
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 IF p_actor_user_id IS NULL OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active') THEN RETURN jsonb_build_object('updated',0);END IF;
 WITH due AS (SELECT p.id FROM public.customer_supply_periods p JOIN gridex_received_sources.supply_source_transitions tr ON tr.source_message_id=p.source_end_message_id AND tr.company_id=p.company_id JOIN public.ediel_messages m ON m.id=tr.source_message_id AND m.company_id=tr.company_id WHERE (p_company_id IS NULL OR p.company_id=p_company_id) AND coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p.company_id,'metering.write'),false) AND EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=p.company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL) AND p.status='ending' AND p.market_end_at<=now() AND tr.payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') AND EXISTS(SELECT FROM jsonb_array_elements(tr.resulting_states) s WHERE s->>'id'=p.id::text AND (s->>'market_state_version')::bigint=p.market_state_version AND (s->>'market_end_at')::timestamptz=p.market_end_at) ORDER BY p.market_end_at,p.id LIMIT least(greatest(coalesce(p_limit,100),1),200) FOR UPDATE OF p SKIP LOCKED)
 UPDATE public.customer_supply_periods p SET status='ended',updated_at=now() FROM due WHERE p.id=due.id AND (p_company_id IS NULL OR p.company_id=p_company_id) AND p.status='ending';
 GET DIAGNOSTICS changed=ROW_COUNT;
 -- These are separate regulated market relationships. No ordinary Z03 or
 -- consumer-contract activation/notification is introduced by this profile.
 WITH due AS (
  SELECT p.id FROM public.customer_supply_periods p JOIN gridex_received_sources.supply_source_transitions tr ON tr.source_message_id=p.source_message_id AND tr.company_id=p.company_id
  JOIN public.ediel_messages m ON m.id=tr.source_message_id AND m.company_id=tr.company_id
  JOIN gridex_received_sources.regulated_supply_ground_versions g ON g.id::text=p.metadata->>'sourceGroundId' AND g.company_id=p.company_id AND g.environment=m.environment
  JOIN public.tenant_bilateral_agreements ba ON ba.id=g.bilateral_agreement_id AND ba.company_id=g.company_id AND ba.environment=g.environment AND ba.counterparty_actor_id=g.dso_actor_id
  JOIN public.tenant_actor_roles role ON role.company_id=p.company_id AND role.environment=m.environment AND role.actor_id=g.legal_actor_id AND role.role_code='electricity_supplier' AND role.valid_from<=now() AND (role.valid_to IS NULL OR now()<role.valid_to)
  JOIN public.tenant_ediel_profiles profile ON profile.company_id=p.company_id AND profile.environment=m.environment AND profile.market='electricity' AND profile.is_enabled AND profile.valid_from<=now() AND (profile.valid_to IS NULL OR now()<profile.valid_to)
  WHERE (p_company_id IS NULL OR p.company_id=p_company_id) AND p.status='confirmed_by_grid_owner' AND p.source_process IN ('assigned_supply','production_receipt_obligation') AND p.market_start_at<=now()
   AND coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p.company_id,'metering.write'),false) AND EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=p.company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL)
   AND tr.payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') AND g.revoked_at IS NULL AND g.valid_from<=now() AND (g.valid_to IS NULL OR now()<g.valid_to) AND ba.is_enabled AND ba.source_reference=g.source_reference AND ba.valid_from<=now() AND (ba.valid_to IS NULL OR now()<ba.valid_to)
      AND EXISTS(SELECT FROM jsonb_array_elements(tr.resulting_states) saved WHERE saved->>'id'=p.id::text AND (saved->>'market_state_version')::bigint=p.market_state_version AND (saved->>'market_start_at')::timestamptz=p.market_start_at AND saved->>'customer_id'=p.customer_id::text AND saved->>'metering_point_id'=p.metering_point_id::text AND saved->>'source_process'=p.source_process AND saved->'metadata'=p.metadata)
   ORDER BY p.market_start_at,p.id LIMIT least(greatest(coalesce(p_limit,100),1),200) FOR UPDATE OF p SKIP LOCKED FOR SHARE OF g,ba,role,profile)
 UPDATE public.customer_supply_periods p SET status='active',updated_at=now() FROM due WHERE p.id=due.id AND p.status='confirmed_by_grid_owner';
 GET DIAGNOSTICS activated=ROW_COUNT;RETURN jsonb_build_object('updated',changed+activated);

END $$;
REVOKE ALL ON FUNCTION public.ediel_advance_supply_deadlines_v1(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_advance_supply_deadlines_v1(uuid,uuid,integer) TO service_role;
COMMIT;
