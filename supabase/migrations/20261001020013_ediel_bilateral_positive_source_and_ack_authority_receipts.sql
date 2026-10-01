-- Exact positive OWN objects, captured only after real business commits. A
-- negative sibling is never promoted by this receipt. Historical replay uses
-- captured profile IDs and original custody; it does not select a new guide.
BEGIN;
CREATE TABLE gridex_bilateral_prodat.source_capability_receipts(
 source_message_id uuid PRIMARY KEY REFERENCES public.ediel_messages(id),company_id uuid NOT NULL REFERENCES public.companies(id),environment text NOT NULL,
 source_payload_hash text NOT NULL CHECK(source_payload_hash~'^[a-f0-9]{64}$'),assessment_id uuid NOT NULL REFERENCES gridex_received_sources.validation_assessments(id),
 object_facts_hash text NOT NULL CHECK(object_facts_hash~'^[a-f0-9]{64}$'),positive_objects jsonb NOT NULL CHECK(jsonb_typeof(positive_objects)='array' AND jsonb_array_length(positive_objects)>0),
 business_transition_hash text NOT NULL CHECK(business_transition_hash~'^[a-f0-9]{64}$'),recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE gridex_bilateral_prodat.source_capability_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_bilateral_prodat.source_capability_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_bilateral_prodat.source_capability_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER bilateral_source_receipt_immutable BEFORE UPDATE OR DELETE ON gridex_bilateral_prodat.source_capability_receipts FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();
CREATE TRIGGER bilateral_source_receipt_no_truncate BEFORE TRUNCATE ON gridex_bilateral_prodat.source_capability_receipts FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();

-- Same authorization prefix as capture/ACK. Take write-compatible receipt lock
-- before any source row, so parallel ACK creation cannot upgrade a read lock.
CREATE FUNCTION gridex_bilateral_prodat.lock_source_receipts_v1() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 PERFORM gridex_regulated_supply.lock_graph_v1();PERFORM gridex_bilateral_prodat.lock_graph_v1();
 LOCK TABLE gridex_bilateral_prodat.source_capability_receipts IN SHARE ROW EXCLUSIVE MODE;
END$$;

-- Replay checks the EXACT captured profile/archive/reviewer/issuer/legal tuple.
-- Current field-rule rows, guide activation and route rows are not reselected.
CREATE FUNCTION gridex_bilateral_prodat.recorded_profile_authority_v1(profile uuid,company uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE o gridex_bilateral_prodat.origins%rowtype;a gridex_bilateral_prodat.artifacts%rowtype;r gridex_bilateral_prodat.reviews%rowtype;g gridex_bilateral_prodat.profile_versions%rowtype;agreement public.tenant_bilateral_agreements%rowtype;binding jsonb;
BEGIN
 PERFORM gridex_bilateral_prodat.lock_graph_v1();
 SELECT * INTO o FROM gridex_bilateral_prodat.origins WHERE ground_id=profile AND company_id=company;
 SELECT * INTO a FROM gridex_bilateral_prodat.artifacts WHERE id=o.artifact_id AND company_id=company;
 SELECT * INTO r FROM gridex_bilateral_prodat.reviews WHERE id=o.review_id AND artifact_id=a.id AND company_id=company;
 SELECT * INTO g FROM gridex_bilateral_prodat.profile_versions WHERE id=profile AND company_id=company;
 IF o.ground_id IS NULL OR a.id IS NULL OR r.id IS NULL OR g.id IS NULL OR r.decision IS DISTINCT FROM 'approved' OR r.reviewer_user_id=a.submitted_by
  OR g.revoked_at IS NOT NULL OR now()<g.valid_from OR now()>=g.valid_to OR o.ground_binding IS DISTINCT FROM to_jsonb(g)-'revoked_at'
  OR gridex_bilateral_prodat.actor_v1(company,r.reviewer_user_id,'review') IS NOT TRUE OR gridex_bilateral_prodat.receipt_current_v1(a) IS NOT TRUE THEN RETURN false;END IF;
 SELECT * INTO agreement FROM public.tenant_bilateral_agreements WHERE id=g.bilateral_agreement_id AND company_id=company AND environment=g.environment AND is_enabled AND valid_from<=now() AND(valid_to IS NULL OR now()<valid_to);
 IF agreement.id IS NULL OR to_jsonb(agreement) IS DISTINCT FROM a.scope->'agreementBinding' THEN RETURN false;END IF;
 SELECT jsonb_build_object('profiles',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.tenant_ediel_profiles p WHERE company_id=company AND environment=g.environment AND market='electricity' AND is_enabled),
 'identifiers',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.tenant_actor_identifiers i WHERE company_id=company AND environment=g.environment AND actor_id=g.legal_actor_id),
 'roles',(SELECT jsonb_agg(to_jsonb(role) ORDER BY role.id) FROM public.tenant_actor_roles role WHERE company_id=company AND environment=g.environment AND actor_id=g.legal_actor_id),
 'counterparty',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.platform_actor_identifiers i WHERE actor_id=g.dso_actor_id AND is_verified)) INTO binding;
 RETURN binding=a.scope->'legalBinding'
  AND (SELECT count(DISTINCT (company_id,actor_id)) FROM public.tenant_actor_identifiers WHERE environment=g.environment AND identifier_type='EdielId' AND identifier_value=a.scope->>'legalSenderId' AND valid_from<=now() AND(valid_to IS NULL OR now()<valid_to))=1
  AND EXISTS(SELECT FROM public.tenant_actor_roles WHERE company_id=company AND environment=g.environment AND actor_id=g.legal_actor_id AND role_code='electricity_supplier' AND valid_from<=now() AND(valid_to IS NULL OR now()<valid_to))
  AND EXISTS(SELECT FROM public.tenant_ediel_profiles WHERE company_id=company AND environment=g.environment AND market='electricity' AND is_enabled AND valid_from<=now() AND(valid_to IS NULL OR now()<valid_to))
  AND (SELECT count(DISTINCT actor_id) FROM public.platform_actor_identifiers WHERE identifier_value=a.scope->>'legalReceiverId' AND lower(identifier_type) IN('edielid','ediel_id') AND is_verified AND(valid_from IS NULL OR valid_from<=current_date) AND(valid_to IS NULL OR current_date<=valid_to))=1
  AND EXISTS(SELECT FROM public.platform_actor_identifiers WHERE actor_id=g.dso_actor_id AND identifier_value=a.scope->>'legalReceiverId' AND lower(identifier_type) IN('edielid','ediel_id') AND is_verified AND(valid_from IS NULL OR valid_from<=current_date) AND(valid_to IS NULL OR current_date<=valid_to))
  AND EXISTS(SELECT FROM public.tenant_actor_identifiers WHERE company_id=company AND environment=g.environment AND actor_id=g.legal_actor_id AND identifier_value=a.scope->>'legalSenderId' AND identifier_type='EdielId' AND valid_from<=now() AND(valid_to IS NULL OR now()<valid_to));
END$$;

-- Qualify one actual physical object of the stored original. This is shared by
-- the whole-source policy facet and mixed positive receipt; no subset message
-- or synthetic source is created, and no sibling authority is inferred.
CREATE FUNCTION gridex_bilateral_prodat.own_source_capability_v1(m public.ediel_messages,wire jsonb,own jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE ids uuid[];g gridex_bilateral_prodat.profile_versions%rowtype;a gridex_bilateral_prodat.artifacts%rowtype;regulated gridex_received_sources.regulated_supply_ground_versions%rowtype;event_at timestamptz;kind text;legal jsonb;point uuid;
BEGIN
 PERFORM gridex_bilateral_prodat.lock_source_receipts_v1();PERFORM public.ediel_require_source_bytes_available_v1(m.company_id,m.id);
 IF m.direction IS DISTINCT FROM 'inbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.raw_payload IS NULL
  OR wire IS DISTINCT FROM gridex_received_sources.normal_switch_wire_v1(m.raw_payload)
  OR (SELECT count(*) FROM jsonb_array_elements(wire->'objects') o WHERE o=own)<>1
  OR NOT EXISTS(SELECT FROM gridex_received_sources.sources original WHERE original.company_id=m.company_id AND original.environment=m.environment AND original.source_message_id=m.id AND original.raw_payload=m.raw_payload AND original.payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')) THEN RETURN NULL;END IF;
 legal:=gridex_ediel_inbound_context.require_v1(m.company_id,m.id);PERFORM gridex_ediel_source_rules.require_v1(m.company_id,m.id);
 IF legal->>'actorRole' IS DISTINCT FROM 'electricity_supplier' OR wire->>'receiver' IS DISTINCT FROM legal->>'legalEdielId' OR legal->>'code' IS DISTINCT FROM wire->>'code'
  OR (own->>'identityAgency' IN('9','89')) IS NOT TRUE OR nullif(own->>'li','') IS NULL THEN RETURN NULL;END IF;
 event_at:=gridex_received_sources.permission_time_v1(own->>CASE WHEN wire->>'code'='Z04' THEN 'start' ELSE 'end' END);
 IF event_at IS NULL THEN RETURN NULL;END IF;
 IF wire->>'code'='Z04' AND own->>'reason' IN('Z26','Z70') THEN
  kind:=CASE own->>'reason' WHEN 'Z26' THEN 'assigned_supply' ELSE 'production_receipt_obligation' END;
  SELECT array_agg(mp.id) INTO ids FROM public.metering_points mp WHERE mp.company_id=m.company_id AND mp.ediel_metering_point_id=own->>'point' AND mp.grid_owner_ediel_id=wire->>'sender' AND mp.grid_area_code=own->>'gridArea';
  IF coalesce(cardinality(ids),0)<>1 THEN RETURN NULL;END IF;point:=ids[1];
  SELECT array_agg(ground.id) INTO ids FROM gridex_received_sources.regulated_supply_ground_versions ground WHERE ground.company_id=m.company_id AND ground.environment=m.environment AND ground.legal_actor_id::text=legal->>'legalActorId' AND ground.process=kind AND ground.approved_at<=m.message_received_at AND gridex_regulated_supply.ground_wire_current_v1(ground.id,m.company_id,point,event_at,own) IS TRUE;
  IF coalesce(cardinality(ids),0)<>1 THEN RETURN NULL;END IF;SELECT * INTO regulated FROM gridex_received_sources.regulated_supply_ground_versions WHERE id=ids[1];
  RETURN jsonb_build_object('owner','immutable-regulated-supply-ground-v1','objectId',own->>'point','identityAgency',own->>'identityAgency','firstLineIndex',gridex_bilateral_prodat.first_line_index_v1(m.raw_payload,own),'lineItemReference',own->>'li','profileVersionId',regulated.id,'process',kind,'sourceHash',regulated.source_sha256,'sourceGrammarHash',right(regulated.registry_version,64));
 END IF;
 kind:=CASE WHEN wire->>'code'='Z04' AND own->>'reason'='Z25' THEN 'normal_start_h' WHEN wire->>'code'='Z05' AND own->>'reason'='Z25' THEN 'own_end_h' WHEN wire->>'code'='Z05' AND own->>'reason'='Z23' THEN 'closure_request_lk' END;
 IF kind IS NULL THEN RETURN NULL;END IF;
 IF (SELECT count(*) FROM public.metering_points mp JOIN public.customers customer ON customer.id=mp.customer_id AND customer.company_id=mp.company_id WHERE mp.company_id=m.company_id AND mp.ediel_metering_point_id=own->>'point' AND mp.grid_owner_ediel_id=wire->>'sender' AND mp.grid_area_code=own->>'gridArea')<>1 THEN RETURN NULL;END IF;
 SELECT array_agg(v.id ORDER BY v.id) INTO ids FROM gridex_bilateral_prodat.profile_versions v JOIN gridex_bilateral_prodat.origins origin ON origin.ground_id=v.id AND origin.company_id=v.company_id JOIN gridex_bilateral_prodat.artifacts archived ON archived.id=origin.artifact_id AND archived.company_id=v.company_id
 WHERE v.company_id=m.company_id AND v.environment=m.environment AND v.process=kind AND v.legal_actor_id::text=legal->>'legalActorId' AND v.grid_area_code=own->>'gridArea' AND v.approved_at<=m.message_received_at
  AND archived.scope->>'legalSenderId'=wire->>'receiver' AND archived.scope->>'legalReceiverId'=wire->>'sender'
  AND EXISTS(SELECT FROM jsonb_array_elements(archived.scope#>'{sourceGrammar,profiles}') p WHERE p->>'id'=m.rule_profile_version_id::text AND p->>'message_code'=wire->>'code')
  AND archived.scope->>'rulePackId'=m.canonical_rule_pack_id::text AND archived.scope#>>'{sourceGrammar,pack,source_hash}'=m.rule_pack_checksum AND gridex_bilateral_prodat.ground_current_v1(v.id,m.company_id,event_at) IS TRUE;
 IF coalesce(cardinality(ids),0)<>1 THEN RETURN NULL;END IF;
 SELECT * INTO g FROM gridex_bilateral_prodat.profile_versions WHERE id=ids[1];SELECT archived.* INTO a FROM gridex_bilateral_prodat.origins o JOIN gridex_bilateral_prodat.artifacts archived ON archived.id=o.artifact_id AND archived.company_id=o.company_id WHERE o.ground_id=g.id;
 RETURN jsonb_build_object('owner','immutable-bilateral-prodat-profile-v1','objectId',own->>'point','identityAgency',own->>'identityAgency','firstLineIndex',gridex_bilateral_prodat.first_line_index_v1(m.raw_payload,own),'lineItemReference',own->>'li','profileVersionId',g.id,'process',kind,'sourceHash',a.source_hash,'sourceGrammarHash',a.scope->>'sourceGrammarHash');
END$$;

CREATE FUNCTION public.ediel_require_recorded_prodat_bilateral_ack_source_v1(p_company_id uuid,p_source_message_id uuid,p_source_payload_hash text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE tr gridex_received_sources.supply_source_transitions%rowtype;r gridex_bilateral_prodat.source_capability_receipts%rowtype;m public.ediel_messages%rowtype;own jsonb;g gridex_received_sources.regulated_supply_ground_versions%rowtype;a gridex_bilateral_prodat.artifacts%rowtype;wire jsonb;
BEGIN
 PERFORM gridex_bilateral_prodat.lock_source_receipts_v1();SELECT * INTO m FROM public.ediel_messages WHERE id=p_source_message_id AND company_id=p_company_id FOR SHARE;
 SELECT * INTO r FROM gridex_bilateral_prodat.source_capability_receipts WHERE source_message_id=p_source_message_id AND company_id=p_company_id;
 IF r.source_message_id IS NULL THEN
  wire:=gridex_received_sources.normal_switch_wire_v1(m.raw_payload);
  IF m.message_family='PRODAT' AND EXISTS(SELECT FROM jsonb_array_elements(wire->'objects') o WHERE o->>'reason' IN('Z25','Z26','Z70')) THEN RAISE EXCEPTION 'prodat_bilateral_recorded_source_authority_required';END IF;RETURN;
 END IF;
 SELECT * INTO tr FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=r.source_message_id AND company_id=r.company_id;
 IF tr.source_message_id IS NULL OR encode(sha256(convert_to(to_jsonb(tr)::text,'UTF8')),'hex') IS DISTINCT FROM r.business_transition_hash THEN RAISE EXCEPTION 'prodat_bilateral_recorded_source_authority_required';END IF;
 IF m.id IS NULL OR r.environment IS DISTINCT FROM m.environment OR r.source_payload_hash IS DISTINCT FROM p_source_payload_hash
  OR NOT EXISTS(SELECT FROM gridex_received_sources.sources original WHERE original.source_message_id=r.source_message_id AND original.company_id=r.company_id AND original.environment=r.environment AND original.payload_hash=r.source_payload_hash)
  OR NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments assessment JOIN gridex_received_sources.prodat_object_validation_facets facet ON facet.assessment_id=assessment.id AND facet.facts_hash=r.object_facts_hash WHERE assessment.id=r.assessment_id AND assessment.company_id=r.company_id AND assessment.environment=r.environment AND assessment.source_message_id=r.source_message_id AND assessment.source_payload_hash=r.source_payload_hash) THEN RAISE EXCEPTION 'prodat_bilateral_recorded_source_authority_required';END IF;
 FOR own IN SELECT o FROM jsonb_array_elements(r.positive_objects) o LOOP
  IF own->>'owner'='immutable-regulated-supply-ground-v1' THEN
   SELECT * INTO g FROM gridex_received_sources.regulated_supply_ground_versions WHERE id=(own->>'profileVersionId')::uuid AND company_id=r.company_id;
   IF g.id IS NULL OR g.source_sha256 IS DISTINCT FROM own->>'sourceHash' OR right(g.registry_version,64) IS DISTINCT FROM own->>'sourceGrammarHash'
    OR gridex_regulated_supply.ground_current_v1(g.id,r.company_id,(own->>'pointId')::uuid,(own->>'eventAt')::timestamptz) IS NOT TRUE THEN RAISE EXCEPTION 'prodat_bilateral_recorded_source_authority_required';END IF;
  ELSIF own->>'owner'='immutable-bilateral-prodat-profile-v1' THEN
   SELECT archived.* INTO a FROM gridex_bilateral_prodat.origins origin JOIN gridex_bilateral_prodat.artifacts archived ON archived.id=origin.artifact_id AND archived.company_id=origin.company_id WHERE origin.ground_id=(own->>'profileVersionId')::uuid AND origin.company_id=r.company_id;
   IF a.id IS NULL OR a.source_hash IS DISTINCT FROM own->>'sourceHash' OR a.scope->>'sourceGrammarHash' IS DISTINCT FROM own->>'sourceGrammarHash' OR gridex_bilateral_prodat.recorded_profile_authority_v1((own->>'profileVersionId')::uuid,r.company_id) IS NOT TRUE THEN RAISE EXCEPTION 'prodat_bilateral_recorded_source_authority_required';END IF;
  ELSE RAISE EXCEPTION 'prodat_bilateral_recorded_source_authority_required';END IF;
 END LOOP;
END$$;

CREATE FUNCTION public.ediel_require_prodat_bilateral_positive_source_v1(p_company_id uuid,p_source_message_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE m public.ediel_messages%rowtype;canonical gridex_received_sources.validation_assessments%rowtype;facet gridex_received_sources.prodat_object_validation_facets%rowtype;tr gridex_received_sources.supply_source_transitions%rowtype;prior gridex_bilateral_prodat.source_capability_receipts%rowtype;
 wire jsonb;guide jsonb;own jsonb;cap jsonb;positive jsonb:='[]';ids uuid[];point public.metering_points%rowtype;state jsonb;event_at timestamptz;
BEGIN
 PERFORM gridex_bilateral_prodat.lock_source_receipts_v1();SELECT * INTO m FROM public.ediel_messages WHERE id=p_source_message_id AND company_id=p_company_id FOR SHARE;
 IF m.id IS NULL OR m.direction IS DISTINCT FROM 'inbound' OR m.message_family IS DISTINCT FROM 'PRODAT' THEN RETURN;END IF;
 PERFORM public.ediel_require_source_bytes_available_v1(m.company_id,m.id);
 wire:=gridex_received_sources.normal_switch_wire_v1(m.raw_payload);
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(wire->'objects') o WHERE o->>'reason' IN('Z25','Z26','Z70')) THEN RETURN;END IF;
 PERFORM public.ediel_require_source_bytes_available_v1(m.company_id,m.id);
 SELECT * INTO prior FROM gridex_bilateral_prodat.source_capability_receipts WHERE source_message_id=m.id;
 IF FOUND THEN PERFORM public.ediel_require_recorded_prodat_bilateral_ack_source_v1(m.company_id,m.id,encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'));RETURN;END IF;
 IF (SELECT count(*) FROM gridex_received_sources.validation_assessments a WHERE a.source_message_id=m.id AND a.company_id=m.company_id AND a.environment=m.environment AND a.source_payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=a.id))<>1 THEN RAISE EXCEPTION 'prodat_bilateral_positive_source_unqualified';END IF;
 SELECT * INTO canonical FROM gridex_received_sources.validation_assessments a WHERE a.source_message_id=m.id AND a.company_id=m.company_id AND a.environment=m.environment AND a.source_payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=a.id);
 SELECT * INTO facet FROM gridex_received_sources.prodat_object_validation_facets WHERE assessment_id=canonical.id AND company_id=m.company_id AND environment=m.environment AND source_message_id=m.id AND source_payload_hash=canonical.source_payload_hash;
 SELECT * INTO tr FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=m.id AND company_id=m.company_id;
 IF canonical.facts_text::jsonb->>'syntaxDecision' IS DISTINCT FROM 'accepted' OR (canonical.facts_text::jsonb->>'applicationDecision' IN('accepted','rejected')) IS NOT TRUE OR canonical.facts_text::jsonb->>'functionalDecision' IS DISTINCT FROM 'accepted'
  OR facet.facts_text::jsonb->>'sharedAccepted' IS DISTINCT FROM 'true' OR facet.facts_text::jsonb->>'owner' IS DISTINCT FROM 'canonical-full-prodat-object-validation-v1'
  OR facet.facts_text::jsonb->>'coverage' IS DISTINCT FROM 'full_canonical_guide_objects_only' OR facet.facts_hash IS DISTINCT FROM encode(sha256(convert_to(facet.facts_text,'UTF8')),'hex')
  OR canonical.facts_text::jsonb#>>'{registerValidation,owner}' IS DISTINCT FROM 'validateProdatRegisterPolicy' OR canonical.facts_text::jsonb#>>'{registerValidation,coverage}' IS DISTINCT FROM 'canonical_register_only'
  OR tr.source_message_id IS NULL OR tr.payload_hash IS DISTINCT FROM canonical.source_payload_hash OR tr.source_code IS DISTINCT FROM wire->>'code'
  OR EXISTS(SELECT FROM jsonb_array_elements(facet.facts_text::jsonb->'objects') o WHERE o->>'disposition'='unavailable')
  OR jsonb_array_length(facet.facts_text::jsonb->'objects') IS DISTINCT FROM jsonb_array_length(wire->'objects') THEN RAISE EXCEPTION 'prodat_bilateral_positive_source_unqualified';END IF;
 FOR guide IN SELECT o FROM jsonb_array_elements(facet.facts_text::jsonb->'objects') o WHERE o->>'disposition'='accepted' LOOP
  SELECT o INTO own FROM jsonb_array_elements(wire->'objects') o WHERE o->>'point'=guide->>'objectId' AND o->>'identityAgency'=guide->>'identityAgency' AND o->>'li'=guide->>'lineItemReference' AND gridex_bilateral_prodat.first_line_index_v1(m.raw_payload,o)=(guide->>'firstLineIndex')::integer;
  IF own IS NULL OR NOT EXISTS(SELECT FROM jsonb_array_elements(tr.source_objects) o WHERE o-'registerCount'=own-'registerCount') THEN RAISE EXCEPTION 'prodat_bilateral_positive_source_unqualified';END IF;
  IF own->>'reason' NOT IN('Z25','Z26','Z70') THEN CONTINUE;END IF;
  cap:=gridex_bilateral_prodat.own_source_capability_v1(m,wire,own);IF cap IS NULL THEN RAISE EXCEPTION 'prodat_bilateral_current_authority_required';END IF;
  SELECT array_agg(mp.id) INTO ids FROM public.metering_points mp WHERE mp.company_id=m.company_id AND mp.ediel_metering_point_id=own->>'point' AND mp.grid_owner_ediel_id=wire->>'sender' AND mp.grid_area_code=own->>'gridArea';
  IF coalesce(cardinality(ids),0)<>1 THEN RAISE EXCEPTION 'prodat_bilateral_positive_source_unqualified';END IF;SELECT * INTO point FROM public.metering_points WHERE id=ids[1] AND company_id=m.company_id;
  SELECT p INTO state FROM jsonb_array_elements(tr.resulting_states) p WHERE p->>'metering_point_id'=point.id::text AND p->>'customer_id'=point.customer_id::text;
  event_at:=gridex_received_sources.permission_time_v1(own->>CASE WHEN wire->>'code'='Z04' THEN 'start' ELSE 'end' END);
  IF state IS NULL OR event_at IS NULL OR NOT EXISTS(SELECT FROM public.customer_supply_periods p WHERE p.company_id=m.company_id AND p.id::text=state->>'id' AND to_jsonb(p)-ARRAY['updated_at','status']=state-ARRAY['updated_at','status']) THEN RAISE EXCEPTION 'prodat_bilateral_positive_source_unqualified';END IF;
  IF cap->>'owner'='immutable-regulated-supply-ground-v1' AND (state#>>'{metadata,sourceGroundId}' IS DISTINCT FROM cap->>'profileVersionId' OR state->>'source_message_id' IS DISTINCT FROM m.id::text) THEN RAISE EXCEPTION 'prodat_bilateral_positive_source_unqualified';END IF;
  IF cap->>'process'='normal_start_h' AND NOT EXISTS(SELECT FROM gridex_received_sources.normal_switch_confirmations confirmation WHERE confirmation.source_message_id=m.id AND confirmation.company_id=m.company_id AND confirmation.period_id::text=state->>'id' AND confirmation.source_object=own) THEN RAISE EXCEPTION 'prodat_bilateral_positive_source_unqualified';END IF;
  IF cap->>'process'='own_end_h' AND (state->>'source_end_message_id' IS DISTINCT FROM m.id::text OR (state->>'market_end_at')::timestamptz IS DISTINCT FROM event_at) THEN RAISE EXCEPTION 'prodat_bilateral_positive_source_unqualified';END IF;
  positive:=positive||jsonb_build_array(cap||jsonb_build_object('pointId',point.id,'eventAt',event_at,'supplyPeriodId',state->>'id'));
 END LOOP;
 IF jsonb_array_length(positive)=0 THEN RAISE EXCEPTION 'prodat_bilateral_positive_source_unqualified';END IF;
 INSERT INTO gridex_bilateral_prodat.source_capability_receipts(source_message_id,company_id,environment,source_payload_hash,assessment_id,object_facts_hash,positive_objects,business_transition_hash)
 VALUES(m.id,m.company_id,m.environment,canonical.source_payload_hash,canonical.id,facet.facts_hash,positive,encode(sha256(convert_to(to_jsonb(tr)::text,'UTF8')),'hex'));
 PERFORM public.ediel_require_recorded_prodat_bilateral_ack_source_v1(m.company_id,m.id,canonical.source_payload_hash);
END$$;

CREATE FUNCTION public.ediel_require_current_prodat_bilateral_ack_source_v1(p_company_id uuid,p_ack_message_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE ack public.ediel_messages%rowtype;source public.ediel_messages%rowtype;raw text;
BEGIN
 PERFORM gridex_bilateral_prodat.lock_source_receipts_v1();SELECT * INTO ack FROM public.ediel_messages WHERE id=p_ack_message_id AND company_id=p_company_id FOR SHARE;
 IF ack.direction IS DISTINCT FROM 'outbound' OR ack.message_family IS DISTINCT FROM 'APERAK' OR ack.raw_payload IS NULL THEN RETURN;END IF;
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(gridex_received_sources.wire_tokens_bounded_v1(ack.raw_payload,10000)) t WHERE t->>'tag'='ERC' AND t#>>'{elements,1,0}'='100') THEN RETURN;END IF;
 SELECT * INTO source FROM public.ediel_messages WHERE id=ack.related_message_id AND company_id=p_company_id AND environment=ack.environment FOR SHARE;
 IF source.id IS NULL THEN RAISE EXCEPTION 'prodat_bilateral_recorded_source_authority_required';END IF;
 PERFORM public.ediel_require_recorded_prodat_bilateral_ack_source_v1(p_company_id,source.id,(SELECT original.payload_hash FROM gridex_received_sources.sources original WHERE original.source_message_id=source.id AND original.company_id=p_company_id AND original.environment=source.environment));
END$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_bilateral_prodat FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.ediel_require_prodat_bilateral_positive_source_v1(uuid,uuid),public.ediel_require_recorded_prodat_bilateral_ack_source_v1(uuid,uuid,text),public.ediel_require_current_prodat_bilateral_ack_source_v1(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_require_prodat_bilateral_positive_source_v1(uuid,uuid),public.ediel_require_recorded_prodat_bilateral_ack_source_v1(uuid,uuid,text),public.ediel_require_current_prodat_bilateral_ack_source_v1(uuid,uuid) TO service_role;
COMMIT;
