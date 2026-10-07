-- A reviewed standard death has its own committed confirmed-customer facet,
-- not a modern customer-primary receipt. Consume that real owner at first
-- APERAK birth without changing the customer's live state or any old ACK.
BEGIN;

CREATE FUNCTION gridex_received_sources.confirmed_death_response_v1(c uuid,source_id uuid,requested integer[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE m public.ediel_messages%rowtype;v gridex_requested_changes.confirmed_customer_versions%rowtype;
 w gridex_requested_changes.customer_version_availability%rowtype;binding gridex_ediel_ack_guide.source_bindings%rowtype;
 snapshot jsonb;body jsonb;qualified jsonb;function_facet jsonb;scope jsonb;tokens jsonb;lin jsonb;own_tokens jsonb;ud jsonb;dtm jsonb;
 initial jsonb;planned jsonb;objects jsonb;projection jsonb;positive_text text;first_line integer;end_line integer;w_xmin numeric;
BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 SELECT * INTO m FROM public.ediel_messages WHERE id=source_id AND company_id=c FOR SHARE;
 IF m.id IS NULL OR m.direction IS DISTINCT FROM 'inbound' OR m.message_standard IS DISTINCT FROM 'edifact'
  OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.message_code IS DISTINCT FROM 'Z06' THEN
  RAISE EXCEPTION 'prodat_confirmed_death_response_source_required';END IF;
 SELECT * INTO v FROM gridex_requested_changes.confirmed_customer_versions WHERE source_message_id=m.id AND company_id=c AND environment=m.environment FOR SHARE;
 IF v.source_message_id IS NULL OR v.event_id IS NULL OR v.bilateral_artifact_id IS NOT NULL OR v.party->>'deathStatus' IS DISTINCT FROM 'Z41'
  OR v.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') OR v.received_at IS DISTINCT FROM m.message_received_at
  OR v.created_xid=pg_current_xact_id() OR NOT pg_visible_in_snapshot(v.created_xid,pg_current_snapshot())
  OR NOT EXISTS(SELECT FROM gridex_requested_changes.events e WHERE e.id=v.event_id AND e.company_id=c AND e.environment=m.environment AND e.variant='E' AND e.event_kind='death') THEN
  RAISE EXCEPTION 'prodat_confirmed_death_response_own_effect_unavailable';END IF;
 SELECT * INTO w FROM gridex_requested_changes.customer_version_availability a WHERE a.source_message_id=v.source_message_id AND a.company_id=c AND a.environment=m.environment AND a.payload_hash=v.payload_hash FOR SHARE;
 SELECT a.xmin::text::numeric INTO w_xmin FROM gridex_requested_changes.customer_version_availability a WHERE a.source_message_id=v.source_message_id AND a.company_id=c AND a.environment=m.environment AND a.payload_hash=v.payload_hash;
 IF w.source_message_id IS NULL OR w_xmin=mod(pg_current_xact_id()::text::numeric,4294967296)
  OR NOT pg_visible_in_snapshot(v.created_xid,w.visibility_snapshot::pg_snapshot) THEN
  RAISE EXCEPTION 'prodat_confirmed_death_response_committed_availability_required';END IF;
 -- Reuse the existing actual history owner: latest accepted canonical source,
 -- independent current event/issuer/reviewer, own legal supply/site and custody.
 snapshot:=gridex_received_sources.open_object_selection_snapshot(c,m.environment,clock_timestamp());body:=(snapshot->>'readsetText')::jsonb;
 IF body->>'complete' IS DISTINCT FROM 'true' OR body->>'companyId' IS DISTINCT FROM c::text OR body->>'environment' IS DISTINCT FROM m.environment THEN
  RAISE EXCEPTION 'prodat_confirmed_death_response_complete_readset_required';END IF;
 qualified:=gridex_requested_changes.customer_facet_basis_v1(body,(body->>'cutoffAt')::timestamptz,c,m.environment,v.customer_id,v.site_id,m.id::text,v.object_id,v.identity_agency);
 IF qualified IS NULL OR qualified->>'sourceMessageId' IS DISTINCT FROM m.id::text OR qualified->>'payloadHash' IS DISTINCT FROM v.payload_hash
  OR qualified->>'customerId' IS DISTINCT FROM v.customer_id::text OR qualified->>'siteId' IS DISTINCT FROM v.site_id::text
  OR qualified->>'meteringPointId' IS DISTINCT FROM v.metering_point_id::text OR qualified->>'supplyPeriodId' IS DISTINCT FROM v.supply_period_id::text
  OR qualified->>'objectId' IS DISTINCT FROM v.object_id OR qualified->>'identityAgency' IS DISTINCT FROM v.identity_agency
  OR qualified->>'legalSender' IS DISTINCT FROM v.legal_sender OR qualified->>'legalReceiver' IS DISTINCT FROM v.legal_receiver
  OR (qualified->>'effectiveAt')::timestamptz IS DISTINCT FROM v.effective_at OR qualified->'party' IS DISTINCT FROM v.party
  OR (qualified->>'availableAt')::timestamptz IS DISTINCT FROM w.observed_at THEN
  RAISE EXCEPTION 'prodat_confirmed_death_response_current_owner_required';END IF;
 IF v.result->>'applied' IS DISTINCT FROM 'true' OR v.result->>'owner' IS DISTINCT FROM 'confirmed-customer-source-v1'
  OR v.result->>'sourceMessageId' IS DISTINCT FROM m.id::text OR v.result->>'payloadHash' IS DISTINCT FROM v.payload_hash
  OR v.result->>'eventId' IS DISTINCT FROM v.event_id::text OR v.result->>'appliedCount' IS DISTINCT FROM '1'
  OR jsonb_typeof(v.result->'objects') IS DISTINCT FROM 'array' OR jsonb_array_length(v.result->'objects')<>1
  OR v.result#>>'{objects,0,meteringPointId}' IS DISTINCT FROM v.metering_point_id::text OR v.result#>>'{objects,0,siteId}' IS DISTINCT FROM v.site_id::text
  OR (v.result#>>'{objects,0,effectiveAt}')::timestamptz IS DISTINCT FROM v.effective_at
  OR (v.result#>>'{objects,0,sourceReceivedAt}')::timestamptz IS DISTINCT FROM v.received_at THEN
  RAISE EXCEPTION 'prodat_confirmed_death_response_result_required';END IF;
 function_facet:=gridex_received_sources.require_prodat_source_function_objects_v1(c,m.id);
 IF function_facet->>'assessmentId' IS DISTINCT FROM v.canonical_assessment_id::text
  OR jsonb_typeof(function_facet->'objects') IS DISTINCT FROM 'array' OR jsonb_array_length(function_facet->'objects')<>1
  OR function_facet#>>'{objects,0,functionalDecision}' IS DISTINCT FROM 'accepted' THEN
  RAISE EXCEPTION 'prodat_confirmed_death_response_canonical_scope_required';END IF;
 scope:=(function_facet->'objects'->0)-'functionalDecision'-'reasonCodes';first_line:=(scope#>>'{registers,0,segmentIndex}')::integer;
 IF scope->>'objectId' IS DISTINCT FROM v.object_id OR scope->>'identityAgency' IS DISTINCT FROM v.identity_agency
  OR scope#>>'{registers,0,registerPosition}' IS DISTINCT FROM '1' OR first_line IS NULL
  OR gridex_received_sources.prodat_first_register_characteristic_v1(m.raw_payload,scope,'Z13') IS DISTINCT FROM 'E34'
  OR gridex_received_sources.prodat_first_register_characteristic_v1(m.raw_payload,scope,'Z17') IS DISTINCT FROM 'Z41' THEN
  RAISE EXCEPTION 'prodat_confirmed_death_response_physical_scope_required';END IF;
 IF requested IS NOT NULL AND requested IS DISTINCT FROM ARRAY[first_line] THEN RAISE EXCEPTION 'prodat_confirmed_death_response_scope_required';END IF;
 tokens:=gridex_received_sources.closure_wire_tokens_v2(m.raw_payload);
 SELECT t INTO lin FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='LIN' ORDER BY(t->>'index')::integer LIMIT 1;
 IF (lin->>'index')::integer IS DISTINCT FROM first_line OR lin#>>'{elements,3,0}' IS DISTINCT FROM v.object_id OR lin#>>'{elements,3,3}' IS DISTINCT FROM v.identity_agency
  OR (SELECT count(DISTINCT jsonb_build_array(t#>>'{elements,3,0}',t#>>'{elements,3,3}')) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='LIN')<>1 THEN
  RAISE EXCEPTION 'prodat_confirmed_death_response_whole_object_required';END IF;
 SELECT min((t->>'index')::integer) INTO end_line FROM jsonb_array_elements(tokens)t WHERE(t->>'index')::integer>first_line AND t->>'tag' IN('LIN','UNT','UNZ','UNH');
 SELECT jsonb_agg(t ORDER BY(t->>'index')::integer) INTO own_tokens FROM jsonb_array_elements(tokens)t WHERE(t->>'index')::integer>first_line AND(t->>'index')::integer<end_line;
 IF (SELECT count(*) FROM jsonb_array_elements(own_tokens)t WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}'='UD')<>1
  OR (SELECT count(*) FROM jsonb_array_elements(own_tokens)t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='LI' AND nullif(t#>>'{elements,1,1}','') IS NOT NULL)<>1
  OR (SELECT count(*) FROM jsonb_array_elements(own_tokens)t WHERE t->>'tag'='DTM' AND t#>>'{elements,1,0}'='157' AND t#>>'{elements,1,2}'='203')<>1 THEN
  RAISE EXCEPTION 'prodat_confirmed_death_response_own_party_clock_reference_required';END IF;
 SELECT t INTO ud FROM jsonb_array_elements(own_tokens)t WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}'='UD';
 SELECT t INTO dtm FROM jsonb_array_elements(own_tokens)t WHERE t->>'tag'='DTM' AND t#>>'{elements,1,0}'='157';
 IF ud#>'{elements,2}' IS DISTINCT FROM jsonb_build_array(v.party->>'id',v.party->>'qualifier',v.party->>'agency')
  OR gridex_received_sources.permission_time_v1(dtm#>>'{elements,1,1}') IS DISTINCT FROM v.effective_at THEN
  RAISE EXCEPTION 'prodat_confirmed_death_response_own_party_clock_reference_required';END IF;
 initial:=gridex_received_sources.read_prodat_response_assessment_v1(c,m.id,v.canonical_assessment_id);
 SELECT e INTO planned FROM jsonb_array_elements(initial->'objects')e WHERE e->'lineIndex'=to_jsonb(first_line);
 IF planned IS NULL OR jsonb_array_length(initial->'objects')<>1 OR planned->>'outcome'='negative'
  OR planned->>'id' IS DISTINCT FROM v.object_id OR planned->'registerLineIndices' IS DISTINCT FROM(SELECT jsonb_agg(r->'segmentIndex' ORDER BY ord) FROM jsonb_array_elements(scope->'registers') WITH ORDINALITY x(r,ord))
  OR planned->>'li' IS DISTINCT FROM(SELECT t#>>'{elements,1,1}' FROM jsonb_array_elements(own_tokens)t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='LI') THEN
  RAISE EXCEPTION 'prodat_confirmed_death_response_own_plan_required';END IF;
 SELECT * INTO binding FROM gridex_ediel_ack_guide.source_bindings WHERE source_message_id=m.id AND kind='national' FOR SHARE;
 IF binding.source_message_id IS NULL OR binding.company_id IS DISTINCT FROM c OR binding.environment IS DISTINCT FROM m.environment OR binding.payload_sha256 IS DISTINCT FROM v.payload_hash THEN
  RAISE EXCEPTION 'prodat_confirmed_death_response_original_guide_required';END IF;
 projection:=gridex_ediel_ack_guide.projection_for_original_v1(binding.source_version);positive_text:=projection#>>'{constraints,common,positiveText}';
 IF positive_text IS NULL OR NOT(projection#>'{constraints,PRODAT,allowedErc}'@>'["100"]'::jsonb) THEN RAISE EXCEPTION 'prodat_confirmed_death_response_original_guide_required';END IF;
 SELECT jsonb_agg(e||jsonb_build_object('outcome','positive') ORDER BY ord) INTO objects FROM jsonb_array_elements(initial->'objects') WITH ORDINALITY x(e,ord);
 RETURN initial||jsonb_build_object('objects',objects,'responses',jsonb_build_array(jsonb_build_object('scope','object','lineIndex',first_line,'ercCode','100','fieldCode',NULL,'text',positive_text,'id',planned->'id','li',planned->'li')),
  'effectScopes',jsonb_build_array(jsonb_build_object('lineIndex',first_line,'canonicalAssessmentId',v.canonical_assessment_id,'objectAssessmentId',NULL,
   'effectReceiptId',v.source_message_id,'effectFactsHash',encode(sha256(convert_to(to_jsonb(v)::text,'UTF8')),'hex'),'appliedAt',w.observed_at,'effectKind','confirmed_customer_version')));
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.confirmed_death_response_v1(uuid,uuid,integer[]) FROM PUBLIC,anon,authenticated,service_role;

-- Change only exact body anchors; retain OID, owner, ACL, settings and wrappers.
DO $patch$ DECLARE sig regprocedure;definition text;before_metadata jsonb;after_metadata jsonb;needle text;replacement text;source_alias text;BEGIN
 sig:='gridex_received_sources.prodat_structural_response_v1(uuid,uuid,integer[])'::regprocedure;
 SELECT to_jsonb(p)-'prosrc',pg_get_functiondef(p.oid) INTO before_metadata,definition FROM pg_proc p WHERE p.oid=sig;
 needle:=$old$IF m.message_code IN('Z06','Z10') THEN RETURN gridex_received_sources.prodat_response_before_domain_effects_v1(c,source_id,requested);END IF;$old$;
 replacement:=$new$IF m.message_code='Z06' AND EXISTS(SELECT FROM gridex_requested_changes.confirmed_customer_versions v WHERE v.source_message_id=m.id AND v.company_id=c AND v.environment=m.environment AND v.event_id IS NOT NULL AND v.bilateral_artifact_id IS NULL) THEN RETURN gridex_received_sources.confirmed_death_response_v1(c,source_id,requested);END IF;
 $new$||needle;
 IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'confirmed_death_response_wrapper_contract_changed';END IF;
 EXECUTE replace(definition,needle,replacement);
 SELECT to_jsonb(p)-'prosrc' INTO after_metadata FROM pg_proc p WHERE p.oid=sig;
 IF before_metadata IS DISTINCT FROM after_metadata THEN RAISE EXCEPTION 'confirmed_death_response_function_metadata_changed';END IF;

 FOREACH sig IN ARRAY ARRAY['gridex_ediel_ack_guide.bound_prodat_response_before_domain_effects_v1(public.ediel_messages,public.ediel_messages)'::regprocedure,'gridex_ediel_outbound_owner.prepare_before_fresh_ack_envelope_v1(jsonb)'::regprocedure] LOOP
  SELECT to_jsonb(p)-'prosrc',pg_get_functiondef(p.oid) INTO before_metadata,definition FROM pg_proc p WHERE p.oid=sig;
  source_alias:=CASE WHEN sig='gridex_ediel_outbound_owner.prepare_before_fresh_ack_envelope_v1(jsonb)'::regprocedure THEN 'source' ELSE 's' END;
  needle:='EXISTS(SELECT FROM gridex_received_sources.customer_primary_response_receipts r WHERE r.source_message_id='||source_alias||'.id)';
  replacement:=needle||' OR EXISTS(SELECT FROM gridex_requested_changes.confirmed_customer_versions v WHERE v.source_message_id='||source_alias||'.id AND v.company_id='||source_alias||'.company_id AND v.environment='||source_alias||'.environment AND v.event_id IS NOT NULL AND v.bilateral_artifact_id IS NULL)';
  IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'confirmed_death_response_presence_contract_changed';END IF;
  definition:=replace(definition,needle,replacement);
  needle:='EXISTS(SELECT FROM gridex_received_sources.customer_primary_response_receipts r WHERE r.source_message_id='||source_alias||'.id AND r.first_line_index=ANY(positive_indices))';
  replacement:=needle||' OR EXISTS(SELECT FROM gridex_requested_changes.confirmed_customer_versions v WHERE v.source_message_id='||source_alias||'.id AND v.company_id='||source_alias||'.company_id AND v.environment='||source_alias||'.environment AND v.event_id IS NOT NULL AND v.bilateral_artifact_id IS NULL)';
  IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'confirmed_death_response_positive_scope_contract_changed';END IF;
  EXECUTE replace(definition,needle,replacement);
  SELECT to_jsonb(p)-'prosrc' INTO after_metadata FROM pg_proc p WHERE p.oid=sig;
  IF before_metadata IS DISTINCT FROM after_metadata THEN RAISE EXCEPTION 'confirmed_death_response_function_metadata_changed';END IF;
 END LOOP;

 sig:='gridex_received_sources.require_domain_response_at_birth_v1()'::regprocedure;
 SELECT to_jsonb(p)-'prosrc',pg_get_functiondef(p.oid) INTO before_metadata,definition FROM pg_proc p WHERE p.oid=sig;
 needle:=$old$IF s.message_code NOT IN('Z04','Z05','Z14','Z15') OR s.id IS NULL THEN RETURN NEW;END IF;$old$;
 replacement:=$new$IF s.id IS NULL OR(s.message_code NOT IN('Z04','Z05','Z14','Z15') AND NOT(s.message_code='Z06' AND EXISTS(SELECT FROM gridex_requested_changes.confirmed_customer_versions v WHERE v.source_message_id=s.id AND v.company_id=s.company_id AND v.environment=s.environment AND v.event_id IS NOT NULL AND v.bilateral_artifact_id IS NULL))) THEN RETURN NEW;END IF;$new$;
 IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'confirmed_death_response_birth_contract_changed';END IF;
 EXECUTE replace(definition,needle,replacement);
 SELECT to_jsonb(p)-'prosrc' INTO after_metadata FROM pg_proc p WHERE p.oid=sig;
 IF before_metadata IS DISTINCT FROM after_metadata THEN RAISE EXCEPTION 'confirmed_death_response_function_metadata_changed';END IF;
END $patch$;
COMMIT;
