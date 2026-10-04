-- Actual CLI forward. Complete canonical own application plus actual reviewed
-- business scope commits each original object once; siblings keep explicit hold.
-- Whole-source historical receipts and exact new batch replays precede guards.
BEGIN;
CREATE TABLE gridex_received_sources.structural_object_apply_receipts(
 source_message_id uuid NOT NULL REFERENCES gridex_received_sources.sources(source_message_id),first_line_index integer NOT NULL CHECK(first_line_index>=0),
 company_id uuid NOT NULL,environment text NOT NULL CHECK(environment IN('test','production')),payload_hash text NOT NULL,
 canonical_assessment_id uuid NOT NULL REFERENCES gridex_received_sources.validation_assessments(id),object_assessment_id uuid NOT NULL REFERENCES gridex_received_sources.object_assessments(id),
 actor_user_id uuid NOT NULL,applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),source_received_at timestamptz NOT NULL,object_scope jsonb NOT NULL,effect jsonb NOT NULL,
 PRIMARY KEY(source_message_id,first_line_index));
CREATE TABLE gridex_received_sources.structural_apply_batches(
 source_message_id uuid NOT NULL REFERENCES gridex_received_sources.sources(source_message_id),requested_scope_key text NOT NULL,company_id uuid NOT NULL,environment text NOT NULL CHECK(environment IN('test','production')),
 payload_hash text NOT NULL,canonical_assessment_id uuid NOT NULL REFERENCES gridex_received_sources.validation_assessments(id),object_assessment_id uuid NOT NULL REFERENCES gridex_received_sources.object_assessments(id),
 result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(source_message_id,requested_scope_key));
ALTER TABLE gridex_received_sources.structural_object_apply_receipts ENABLE ROW LEVEL SECURITY;ALTER TABLE gridex_received_sources.structural_object_apply_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE gridex_received_sources.structural_apply_batches ENABLE ROW LEVEL SECURITY;ALTER TABLE gridex_received_sources.structural_apply_batches FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_received_sources.structural_object_apply_receipts,gridex_received_sources.structural_apply_batches FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON gridex_received_sources.structural_object_apply_receipts FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_received_sources.structural_object_apply_receipts FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON gridex_received_sources.structural_apply_batches FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_received_sources.structural_apply_batches FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();
-- Extend the SAME object ledger's acceptance proof, including the existing
-- life-event owner branch. Business/party snapshot checks remain unchanged.
DO $$DECLARE body text;old text;new text;occurrences integer;BEGIN
 SELECT pg_get_functiondef('gridex_received_sources.append_object_assessment(uuid,text,uuid,text,uuid,text)'::regprocedure) INTO body;
 old:=$old$register_fact->>'disposition' IS DISTINCT FROM 'accepted' OR original->>'syntaxDecision' IS DISTINCT FROM 'accepted' OR original->>'applicationDecision' IS DISTINCT FROM 'accepted' OR original->>'functionalDecision' IS DISTINCT FROM 'accepted'$old$;
 new:=$new$register_fact->>'disposition' IS DISTINCT FROM 'accepted' OR original->>'syntaxDecision' IS DISTINCT FROM 'accepted' OR NOT coalesce(gridex_received_sources.prodat_application_object_accepted_v1(p_company_id,src.source_message_id,canonical.id,scope),false)$new$;
 occurrences:=(length(body)-length(replace(body,old,'')))/length(old);
 IF occurrences NOT IN(1,2) THEN RAISE EXCEPTION 'partial_prodat_object_owner_contract_changed';END IF;
 EXECUTE replace(body,old,new);
END $$;
CREATE OR REPLACE FUNCTION public.ediel_apply_reviewed_structure_objects_v2(p_company_id uuid,p_source_message_id uuid,p_actor_user_id uuid,p_object_line_indices integer[] DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;src gridex_received_sources.sources%rowtype;
 canonical gridex_received_sources.validation_assessments%rowtype;assessment gridex_received_sources.object_assessments%rowtype;
 prior gridex_received_sources.structural_apply_receipts%rowtype;entry jsonb;business jsonb;wire jsonb;tokens jsonb;own_tokens jsonb;
 objects jsonb:='[]';counted integer;reg jsonb;lin jsonb;point public.metering_points%rowtype;site public.customer_sites%rowtype;
 line_start integer;line_end integer;physical_count integer;effective_at timestamptz;result jsonb;applied_count integer:=0;period_preflight jsonb;locked_periods jsonb;application jsonb;selected jsonb:='[]';manifest jsonb:='[]';own_effect jsonb;first_line integer;scope_key text;requested integer[];
 batch gridex_received_sources.structural_apply_batches%rowtype;own_prior gridex_received_sources.structural_object_apply_receipts%rowtype;skipped_count integer:=0;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'structural_apply_service_required' USING ERRCODE='42501'; END IF;
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_source_message_id AND company_id=p_company_id FOR UPDATE;
 IF NOT FOUND OR m.direction IS DISTINCT FROM 'inbound' OR m.message_standard IS DISTINCT FROM 'edifact'
  OR m.message_family IS DISTINCT FROM 'PRODAT' OR (m.message_code IN ('Z06','Z10')) IS NOT TRUE THEN RAISE EXCEPTION 'structural_apply_source_required'; END IF;
 PERFORM cm.user_id FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id FOR SHARE;
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 IF p_actor_user_id IS NULL OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL)
  OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active')
  OR NOT coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'metering.write'),false) THEN RAISE EXCEPTION 'ediel_tenant_actor_forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO prior FROM gridex_received_sources.structural_apply_receipts WHERE source_message_id=m.id;
 IF FOUND THEN
  IF prior.company_id IS DISTINCT FROM m.company_id OR prior.environment IS DISTINCT FROM m.environment OR prior.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'structural_apply_replay_conflict'; END IF;
  RETURN prior.result;
 END IF;
 IF p_object_line_indices IS NOT NULL AND (cardinality(p_object_line_indices) NOT BETWEEN 1 AND 8192 OR EXISTS(SELECT FROM unnest(p_object_line_indices) n WHERE n IS NULL OR n<0) OR cardinality(p_object_line_indices)<>(SELECT count(DISTINCT n) FROM unnest(p_object_line_indices)n)) THEN RAISE EXCEPTION 'structural_apply_requested_scope_invalid';END IF;
 SELECT array_agg(n ORDER BY n) INTO requested FROM unnest(p_object_line_indices)n;
 scope_key:=CASE WHEN p_object_line_indices IS NULL THEN 'all_source_objects' ELSE encode(sha256(convert_to(to_jsonb(requested)::text,'UTF8')),'hex') END;
 SELECT * INTO batch FROM gridex_received_sources.structural_apply_batches WHERE source_message_id=m.id AND requested_scope_key=scope_key;
 IF FOUND THEN
  IF batch.company_id IS DISTINCT FROM m.company_id OR batch.environment IS DISTINCT FROM m.environment OR batch.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'structural_apply_replay_conflict';END IF;
  RETURN batch.result;
 END IF;
 -- A differently requested read of already established own receipts is
 -- still replay. It must not acquire today's role/rule basis as new authority.
 IF requested IS NOT NULL AND cardinality(requested)=(SELECT count(*) FROM gridex_received_sources.structural_object_apply_receipts r WHERE r.source_message_id=m.id AND r.first_line_index=ANY(requested)) THEN
  IF EXISTS(SELECT FROM gridex_received_sources.structural_object_apply_receipts r WHERE r.source_message_id=m.id AND r.first_line_index=ANY(requested) AND(r.company_id IS DISTINCT FROM m.company_id OR r.environment IS DISTINCT FROM m.environment OR r.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'))) THEN RAISE EXCEPTION 'structural_apply_object_replay_conflict';END IF;
  SELECT jsonb_agg(r.effect ORDER BY r.first_line_index),sum(jsonb_array_length(r.object_scope->'registers')),jsonb_agg(jsonb_build_object('object',r.object_scope,'status','already_applied') ORDER BY r.first_line_index)
   INTO objects,applied_count,manifest FROM gridex_received_sources.structural_object_apply_receipts r WHERE r.source_message_id=m.id AND r.first_line_index=ANY(requested);
  RETURN jsonb_build_object('applied',true,'appliedCount',applied_count,'skippedCount',0,'objects',objects,'sourceMessageId',m.id,'manifest',manifest);
 END IF;
 -- Current admission cannot relabel an already committed source outcome.
 PERFORM gridex_ediel_inbound_context.require_v1(p_company_id,m.id);
 PERFORM gridex_ediel_source_rules.require_v1(p_company_id,m.id);
 SELECT * INTO src FROM gridex_received_sources.sources WHERE source_message_id=m.id AND company_id=p_company_id AND environment=m.environment FOR UPDATE;
 IF NOT FOUND OR src.raw_payload IS DISTINCT FROM m.raw_payload OR src.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
  OR src.source_received_at IS NULL OR src.source_received_at IS DISTINCT FROM m.message_received_at THEN RAISE EXCEPTION 'structural_apply_immutable_source_required'; END IF;
 SELECT count(*) INTO counted FROM gridex_received_sources.validation_assessments a WHERE a.source_message_id=m.id AND a.company_id=p_company_id AND a.environment=m.environment
  AND a.source_payload_hash=src.payload_hash AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=a.id);
 IF counted<>1 THEN RETURN jsonb_build_object('applied',false,'reason','structural_apply_canonical_source_ambiguous'); END IF;
 SELECT * INTO canonical FROM gridex_received_sources.validation_assessments a WHERE a.source_message_id=m.id AND a.company_id=p_company_id AND a.environment=m.environment
  AND a.source_payload_hash=src.payload_hash AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=a.id) FOR SHARE;
 application:=gridex_received_sources.require_prodat_application_objects_v1(p_company_id,m.id);
 IF canonical.facts_text::jsonb->>'syntaxDecision' IS DISTINCT FROM 'accepted' OR application->>'assessmentId' IS DISTINCT FROM canonical.id::text OR application->>'headerDecision' IS DISTINCT FROM 'accepted' THEN RETURN jsonb_build_object('applied',false,'reason','structural_apply_canonical_source_not_accepted');END IF;
 SELECT count(*) INTO counted FROM gridex_received_sources.object_assessments a WHERE a.source_message_id=m.id AND a.company_id=p_company_id AND a.environment=m.environment
  AND a.source_payload_hash=src.payload_hash AND NOT EXISTS(SELECT FROM gridex_received_sources.object_assessments child WHERE child.previous_assessment_id=a.id);
 IF counted<>1 THEN RETURN jsonb_build_object('applied',false,'reason','structural_apply_original_review_required'); END IF;
 SELECT * INTO assessment FROM gridex_received_sources.object_assessments a WHERE a.source_message_id=m.id AND a.company_id=p_company_id AND a.environment=m.environment
  AND a.source_payload_hash=src.payload_hash AND NOT EXISTS(SELECT FROM gridex_received_sources.object_assessments child WHERE child.previous_assessment_id=a.id) FOR SHARE;
 IF assessment.canonical_assessment_id IS DISTINCT FROM canonical.id OR jsonb_typeof(assessment.facts_text::jsonb->'objects') IS DISTINCT FROM 'array'
  OR jsonb_array_length(assessment.facts_text::jsonb->'objects')<1 THEN RETURN jsonb_build_object('applied',false,'reason','structural_apply_original_review_required'); END IF;
 tokens:=gridex_received_sources.closure_wire_tokens_v2(src.raw_payload);
 IF tokens IS NULL THEN RAISE EXCEPTION 'structural_apply_whole_wire_required'; END IF;
 SELECT count(*) INTO physical_count FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='LIN';
 -- The owner assessment must cover every physical object/register, with no
 -- caller-provided changes, entity IDs, field labels or partial object writes.
 IF (SELECT coalesce(sum(jsonb_array_length(e#>'{object,registers}')),0) FROM jsonb_array_elements(assessment.facts_text::jsonb->'objects') e)<>physical_count THEN RAISE EXCEPTION 'structural_apply_physical_scope_incomplete'; END IF;
 -- Keep the complete physical partition. Only SAME full application AND
 -- actual source-specific business/party owner can qualify a first effect.
 IF requested IS NOT NULL AND EXISTS(SELECT FROM unnest(requested)n WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(assessment.facts_text::jsonb->'objects')e WHERE (e#>>'{object,registers,0,segmentIndex}')::integer=n)) THEN RAISE EXCEPTION 'structural_apply_requested_scope_invalid';END IF;
 FOR entry IN SELECT e FROM jsonb_array_elements(assessment.facts_text::jsonb->'objects')e LOOP
  first_line:=(entry#>>'{object,registers,0,segmentIndex}')::integer;
  IF requested IS NOT NULL AND NOT first_line=ANY(requested) THEN
   manifest:=manifest||jsonb_build_array(jsonb_build_object('object',entry->'object','status','not_requested'));skipped_count:=skipped_count+jsonb_array_length(entry#>'{object,registers}');CONTINUE;
  END IF;
  SELECT * INTO own_prior FROM gridex_received_sources.structural_object_apply_receipts WHERE source_message_id=m.id AND first_line_index=first_line;
  IF FOUND THEN
   IF own_prior.company_id IS DISTINCT FROM m.company_id OR own_prior.environment IS DISTINCT FROM m.environment OR own_prior.payload_hash IS DISTINCT FROM src.payload_hash OR own_prior.object_scope IS DISTINCT FROM entry->'object' THEN RAISE EXCEPTION 'structural_apply_object_replay_conflict';END IF;
   objects:=objects||jsonb_build_array(own_prior.effect);applied_count:=applied_count+jsonb_array_length(entry#>'{object,registers}');
   manifest:=manifest||jsonb_build_array(jsonb_build_object('object',entry->'object','status','already_applied'));CONTINUE;
  END IF;
  IF entry->>'disposition'='accepted' AND coalesce(gridex_received_sources.prodat_application_object_accepted_v1(p_company_id,m.id,canonical.id,entry->'object'),false) THEN
   IF entry#>>'{business,owner}' IS DISTINCT FROM 'reviewed-received-structure-v1' OR(entry#>>'{business,wire,businessCase}' IN('change_with_reading','change_without_reading','meter_exchange')) IS NOT TRUE THEN RAISE EXCEPTION 'structural_apply_original_review_required';END IF;
   selected:=selected||jsonb_build_array(entry);
  ELSE
   IF requested IS NOT NULL THEN RAISE EXCEPTION 'structural_apply_requested_object_not_qualified';END IF;
   skipped_count:=skipped_count+jsonb_array_length(entry#>'{object,registers}');manifest:=manifest||jsonb_build_array(jsonb_build_object('object',entry->'object','status',CASE WHEN entry->>'disposition'='rejected' THEN 'rejected' ELSE 'held' END));
  END IF;
 END LOOP;
 IF jsonb_array_length(selected)=0 AND applied_count=0 THEN RETURN jsonb_build_object('applied',false,'reason','structural_apply_no_qualified_object','manifest',manifest);END IF;
 -- Follow the normal supply commit order: original inbound baselines first,
 -- then their originating outbound requests, switches, periods, points/sites.
 -- Acquire whole-message sets before proof evaluation to prevent a concurrent
 -- cancellation/activation from changing coverage halfway through an apply.
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',sp.id,'sourceId',sp.source_message_id,'version',sp.market_state_version) ORDER BY sp.id),'[]') INTO period_preflight
 FROM public.customer_supply_periods sp WHERE sp.company_id=p_company_id AND sp.id IN(SELECT (e#>>'{business,supplyPeriodId}')::uuid FROM jsonb_array_elements(selected) e);
 PERFORM original.id FROM public.ediel_messages original WHERE original.company_id=p_company_id AND original.environment=m.environment AND original.id IN(
  SELECT (e#>>'{business,coverageWindow,baselineSourceMessageId}')::uuid FROM jsonb_array_elements(selected) e UNION
  SELECT (e#>>'{business,coverageWindow,outboundSourceMessageId}')::uuid FROM jsonb_array_elements(selected) e UNION
  SELECT (p->>'sourceId')::uuid FROM jsonb_array_elements(period_preflight) p UNION
  SELECT tr.source_message_id FROM gridex_received_sources.supply_source_transitions tr,jsonb_array_elements(tr.resulting_states) own,jsonb_array_elements(period_preflight) p
   WHERE tr.company_id=p_company_id AND own->>'id'=p->>'id' AND own->>'market_state_version'=p->>'version'
 ) ORDER BY original.id FOR UPDATE;
 PERFORM sw.id FROM public.supplier_switch_requests sw WHERE sw.company_id=p_company_id
  AND sw.id IN(SELECT (e#>>'{business,switchRequestId}')::uuid FROM jsonb_array_elements(selected) e) ORDER BY sw.id FOR UPDATE;
 PERFORM sp.id FROM public.customer_supply_periods sp WHERE sp.company_id=p_company_id
  AND sp.id IN(SELECT (e#>>'{business,supplyPeriodId}')::uuid FROM jsonb_array_elements(selected) e) ORDER BY sp.id FOR UPDATE;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',sp.id,'sourceId',sp.source_message_id,'version',sp.market_state_version) ORDER BY sp.id),'[]') INTO locked_periods
 FROM public.customer_supply_periods sp WHERE sp.company_id=p_company_id AND sp.id IN(SELECT (e#>>'{business,supplyPeriodId}')::uuid FROM jsonb_array_elements(selected) e);
 IF locked_periods IS DISTINCT FROM period_preflight THEN RETURN jsonb_build_object('applied',false,'reason','structural_apply_supply_version_changed_retry'); END IF;
 PERFORM mp.id FROM public.metering_points mp WHERE mp.company_id=p_company_id
  AND mp.id IN(SELECT (e#>>'{business,meteringPointId}')::uuid FROM jsonb_array_elements(selected) e) ORDER BY mp.id FOR UPDATE;
 PERFORM cs.id FROM public.customer_sites cs WHERE cs.company_id=p_company_id
  AND cs.id IN(SELECT (e#>>'{business,siteId}')::uuid FROM jsonb_array_elements(selected) e) ORDER BY cs.id FOR UPDATE;
 FOR entry IN SELECT e FROM jsonb_array_elements(selected) e ORDER BY e#>>'{business,meteringPointId}' LOOP
  business:=entry->'business';wire:=business->'wire';
  IF entry->>'disposition' IS DISTINCT FROM 'accepted' OR business->>'owner' IS DISTINCT FROM 'reviewed-received-structure-v1'
   OR (wire->>'businessCase' IN ('change_with_reading','change_without_reading','meter_exchange')) IS NOT TRUE
   OR gridex_received_sources.review_business_proof_consistent(entry->'party',business,m.id) IS NOT TRUE THEN RAISE EXCEPTION 'structural_apply_original_review_required';END IF;
  SELECT * INTO point FROM public.metering_points WHERE id=(business->>'meteringPointId')::uuid AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND OR point.meter_point_id IS DISTINCT FROM entry#>>'{object,objectId}' OR point.customer_id IS DISTINCT FROM (business->>'customerId')::uuid
   OR point.site_id IS DISTINCT FROM (business->>'siteId')::uuid THEN RAISE EXCEPTION 'structural_apply_point_scope_unqualified'; END IF;
  SELECT * INTO site FROM public.customer_sites WHERE id=point.site_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND OR site.customer_id IS DISTINCT FROM point.customer_id THEN RAISE EXCEPTION 'structural_apply_site_scope_unqualified'; END IF;
  effective_at:=(wire#>>'{effectiveFrom,utc}')::timestamptz;own_tokens:='[]';
  FOR reg IN SELECT r FROM jsonb_array_elements(entry#>'{object,registers}') r LOOP
   line_start:=(reg->>'segmentIndex')::integer;
   SELECT t INTO lin FROM jsonb_array_elements(tokens) t WHERE (t->>'index')::integer=line_start;
   IF lin->>'tag' IS DISTINCT FROM 'LIN' OR lin#>>'{elements,3,0}' IS DISTINCT FROM entry#>>'{object,objectId}'
    OR lin#>>'{elements,3,3}' IS DISTINCT FROM entry#>>'{object,identityAgency}' OR lin#>>'{elements,1,0}' IS DISTINCT FROM reg->>'lineNumber' THEN RAISE EXCEPTION 'structural_apply_physical_scope_incomplete'; END IF;
   SELECT min((t->>'index')::integer) INTO line_end FROM jsonb_array_elements(tokens) t WHERE (t->>'index')::integer>line_start AND t->>'tag' IN ('LIN','UNT','UNZ','UNH');
   own_tokens:=own_tokens||jsonb_build_array(jsonb_build_object('register',reg,'tokens',(SELECT jsonb_agg(t ORDER BY (t->>'index')::integer) FROM jsonb_array_elements(tokens) t WHERE (t->>'index')::integer>=line_start AND (t->>'index')::integer<line_end)));
  END LOOP;
  -- The primary dated source ledger is used by structuralSourceSelection and
  -- the live UTILTS qualification boundary. Do not flatten its future/history
  -- versions into current global masterdata or alter any earlier meter values.
  own_effect:=jsonb_build_object('object',entry->'object','meteringPointId',point.id,'siteId',site.id,
   'effectiveAt',effective_at,'sourceReceivedAt',src.source_received_at,'wire',wire,'sourceRegisters',own_tokens,
   'readingFollowUp',jsonb_build_object('status',CASE WHEN wire->>'businessCase'='change_without_reading' THEN 'not_required_by_this_change' ELSE 'source_process_evidence_required' END,
    'criterion',CASE WHEN wire->>'businessCase'='change_without_reading' THEN 'AT-Z06G-SUPPLIER' WHEN wire->>'businessCase'='meter_exchange' THEN 'AT-Z10M-SUPPLIER' ELSE 'AT-Z06F-SUPPLIER' END,
    'deadline',NULL,'fulfilled',false));
  first_line:=(entry#>>'{object,registers,0,segmentIndex}')::integer;
  INSERT INTO gridex_received_sources.structural_object_apply_receipts(source_message_id,first_line_index,company_id,environment,payload_hash,canonical_assessment_id,object_assessment_id,actor_user_id,source_received_at,object_scope,effect)
  VALUES(m.id,first_line,p_company_id,m.environment,src.payload_hash,canonical.id,assessment.id,p_actor_user_id,src.source_received_at,entry->'object',own_effect);
  objects:=objects||jsonb_build_array(own_effect);manifest:=manifest||jsonb_build_array(jsonb_build_object('object',entry->'object','status','applied'));
  applied_count:=applied_count+jsonb_array_length(entry#>'{object,registers}');
 END LOOP;
 result:=jsonb_build_object('applied',true,'appliedCount',applied_count,'objects',objects,'sourceMessageId',m.id,'objectAssessmentId',assessment.id,'canonicalAssessmentId',canonical.id,'skippedCount',skipped_count,'manifest',manifest);
 INSERT INTO gridex_received_sources.structural_apply_batches(source_message_id,requested_scope_key,company_id,environment,payload_hash,canonical_assessment_id,object_assessment_id,result)
 VALUES(m.id,scope_key,p_company_id,m.environment,src.payload_hash,canonical.id,assessment.id,result);
 INSERT INTO public.ediel_message_events(company_id,ediel_message_id,message_id,event_type,event_status,message,payload,event_payload,created_by)
 VALUES(p_company_id,m.id,m.id,'manual_note','success','Granskad källbunden strukturversion tillämpad.',
  jsonb_build_object('safeApply',true,'safeApplyDecision','applied','appliedCount',applied_count,'sourceAssessmentId',assessment.id,'appliedAutomatically',false),
  jsonb_build_object('safeApply',true,'safeApplyDecision','applied','appliedCount',applied_count,'sourceAssessmentId',assessment.id,'appliedAutomatically',false),p_actor_user_id);
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.ediel_apply_reviewed_structure_v1(p_company_id uuid,p_source_message_id uuid,p_actor_user_id uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT public.ediel_apply_reviewed_structure_objects_v2(p_company_id,p_source_message_id,p_actor_user_id,NULL)$$;
REVOKE ALL ON FUNCTION public.ediel_apply_reviewed_structure_objects_v2(uuid,uuid,uuid,integer[]),public.ediel_apply_reviewed_structure_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_apply_reviewed_structure_objects_v2(uuid,uuid,uuid,integer[]),public.ediel_apply_reviewed_structure_v1(uuid,uuid,uuid) TO service_role;
-- Actual dated readers and method observation retain the SAME owner checks;
-- the new immutable own receipt is another application record, not a chooser.
CREATE OR REPLACE FUNCTION gridex_received_sources.structural_effect_matches_v1(c uuid,env text,source_id uuid,assessment_id uuid,customer uuid,site uuid,point uuid,period uuid,object_id text,agency text,cutoff timestamptz) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 WITH receipts AS(SELECT source_message_id,company_id,environment,payload_hash,canonical_assessment_id,object_assessment_id,applied_at,objects FROM gridex_received_sources.structural_apply_receipts
 UNION ALL SELECT source_message_id,company_id,environment,payload_hash,canonical_assessment_id,object_assessment_id,applied_at,jsonb_build_array(effect) FROM gridex_received_sources.structural_object_apply_receipts)
 SELECT count(*)=1 FROM receipts r
 JOIN gridex_received_sources.sources s ON s.source_message_id=r.source_message_id AND s.company_id=r.company_id AND s.environment=r.environment AND s.payload_hash=r.payload_hash
 JOIN gridex_received_sources.object_assessments a ON a.id=r.object_assessment_id AND a.company_id=r.company_id AND a.environment=r.environment AND a.source_message_id=r.source_message_id AND a.source_payload_hash=r.payload_hash AND a.canonical_assessment_id=r.canonical_assessment_id,
 LATERAL jsonb_array_elements(a.facts_text::jsonb->'objects') own,LATERAL jsonb_array_elements(r.objects) applied
 WHERE r.company_id=c AND r.environment=env AND r.source_message_id=source_id AND r.object_assessment_id=assessment_id AND r.applied_at<=cutoff
 AND s.payload_hash=encode(sha256(convert_to(s.raw_payload,'UTF8')),'hex') AND a.facts_hash=encode(sha256(convert_to(a.facts_text,'UTF8')),'hex')
 AND own->>'disposition'='accepted' AND own#>>'{business,owner}'='reviewed-received-structure-v1'
 AND own#>>'{business,companyId}'=c::text AND own#>>'{business,environment}'=env AND own#>>'{business,customerId}'=customer::text AND own#>>'{business,siteId}'=site::text AND own#>>'{business,meteringPointId}'=point::text AND own#>>'{business,supplyPeriodId}'=period::text
 AND own#>>'{object,objectId}'=object_id AND own#>>'{object,identityAgency}'=agency AND applied->'object'=own->'object' AND applied->'wire'=own#>'{business,wire}'
 AND applied->>'meteringPointId'=point::text AND applied->>'siteId'=site::text
$$;
REVOKE ALL ON FUNCTION gridex_received_sources.structural_effect_matches_v1(uuid,text,uuid,uuid,uuid,uuid,uuid,uuid,text,text,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION gridex_received_sources.applied_structural_method_objects_v1(c uuid,msg uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r record;s gridex_received_sources.sources%rowtype;a gridex_received_sources.object_assessments%rowtype;f gridex_received_sources.prodat_ignored_field_facets%rowtype;
 own jsonb;assessed jsonb;business jsonb;first_register jsonb;token jsonb;characteristic text;method text;method_count integer;out jsonb:='[]';
BEGIN
 <<receipt_loop>> FOR r IN SELECT company_id,environment,source_message_id,payload_hash,object_assessment_id,canonical_assessment_id,source_received_at,applied_at,objects FROM gridex_received_sources.structural_apply_receipts WHERE company_id=c AND source_message_id=msg
 UNION ALL SELECT company_id,environment,source_message_id,payload_hash,object_assessment_id,canonical_assessment_id,source_received_at,applied_at,jsonb_build_array(effect) FROM gridex_received_sources.structural_object_apply_receipts WHERE company_id=c AND source_message_id=msg LOOP
 SELECT * INTO s FROM gridex_received_sources.sources WHERE company_id=c AND source_message_id=msg AND environment=r.environment;
 SELECT * INTO a FROM gridex_received_sources.object_assessments WHERE id=r.object_assessment_id AND company_id=c AND source_message_id=msg AND environment=r.environment;
 SELECT * INTO f FROM gridex_received_sources.prodat_ignored_field_facets WHERE canonical_assessment_id=r.canonical_assessment_id AND company_id=c AND source_message_id=msg AND environment=r.environment;
 IF s.source_message_id IS NULL OR a.id IS NULL OR f.canonical_assessment_id IS NULL OR s.payload_hash IS DISTINCT FROM r.payload_hash OR s.payload_hash IS DISTINCT FROM encode(sha256(convert_to(s.raw_payload,'UTF8')),'hex') OR a.facts_hash IS DISTINCT FROM encode(sha256(convert_to(a.facts_text,'UTF8')),'hex') OR a.source_payload_hash IS DISTINCT FROM s.payload_hash OR a.canonical_assessment_id IS DISTINCT FROM r.canonical_assessment_id OR f.source_payload_hash IS DISTINCT FROM s.payload_hash OR f.fields_hash IS DISTINCT FROM encode(sha256(convert_to(f.fields_text,'UTF8')),'hex') THEN CONTINUE receipt_loop;END IF;
 FOR own IN SELECT value FROM jsonb_array_elements(r.objects) LOOP
  SELECT value INTO assessed FROM jsonb_array_elements(a.facts_text::jsonb->'objects') value WHERE value->'object'=own->'object';
  business:=assessed->'business';first_register:=own#>'{sourceRegisters,0}';
  IF assessed->>'disposition' IS DISTINCT FROM 'accepted' OR business->>'owner' IS DISTINCT FROM 'reviewed-received-structure-v1' OR business->'wire' IS DISTINCT FROM own->'wire' OR business->>'companyId' IS DISTINCT FROM c::text OR business->>'environment' IS DISTINCT FROM r.environment OR business->>'meteringPointId' IS DISTINCT FROM own->>'meteringPointId' OR business->>'siteId' IS DISTINCT FROM own->>'siteId' OR nullif(business->>'customerId','') IS NULL OR own#>>'{wire,messageCode}' IS DISTINCT FROM 'Z06' OR (own#>>'{wire,businessCase}' IN('change_with_reading','change_without_reading')) IS NOT TRUE THEN CONTINUE;END IF;
  characteristic:=NULL;method:=NULL;method_count:=0;
  FOR token IN SELECT value FROM jsonb_array_elements(first_register->'tokens') LOOP
   IF token->>'tag'='CCI' THEN characteristic:=token#>>'{elements,2,0}';
   ELSIF token->>'tag'='CAV' AND characteristic='Z04' THEN method_count:=method_count+1;method:=token#>>'{elements,1,0}';END IF;
  END LOOP;
  IF method_count<>1 OR EXISTS(SELECT FROM jsonb_array_elements(f.fields_text::jsonb) ignored WHERE ignored->>'fieldNumber'='217' AND ignored#>>'{occurrence,objectId}'=own#>>'{object,objectId}' AND ignored#>>'{occurrence,identityAgency}'=own#>>'{object,identityAgency}' AND ignored#>>'{occurrence,messageReference}'=own#>>'{object,messageReference}' AND ignored#>>'{occurrence,lineIndex}'=first_register#>>'{register,lineIndex}') THEN method:=NULL;END IF;
  out:=out||jsonb_build_array(jsonb_build_object('companyId',c,'environment',r.environment,'sourceMessageId',msg,'sourcePayloadHash',r.payload_hash,'customerId',business->>'customerId','siteId',own->>'siteId','meteringPointId',own->>'meteringPointId','objectId',own#>>'{object,objectId}','identityAgency',own#>>'{object,identityAgency}','businessCase',own#>>'{wire,businessCase}','effectiveAt',own->'effectiveAt','legalNetwork',own#>>'{wire,legalSender}','legalSupplier',own#>>'{wire,legalReceiver}','measurementMethod',nullif(method,''),'sourceReceivedAt',r.source_received_at,'appliedAt',r.applied_at));
 END LOOP;
 END LOOP receipt_loop;
 RETURN CASE WHEN jsonb_array_length(out)=0 THEN NULL ELSE out END;
END$$;
REVOKE ALL ON FUNCTION gridex_received_sources.applied_structural_method_objects_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
DO $$DECLARE body text;old text;new text;BEGIN
 SELECT pg_get_functiondef('gridex_method_expectations.reconcile_v1(uuid,uuid)'::regprocedure) INTO body;
 old:=$old$FOR src IN SELECT r.source_message_id FROM gridex_received_sources.structural_apply_receipts r
  WHERE r.company_id=b.company_id AND r.environment=b.environment AND (source_filter IS NULL OR r.source_message_id=source_filter) ORDER BY r.applied_at,r.source_message_id LOOP$old$;
 new:=$new$FOR src IN SELECT r.source_message_id FROM(SELECT source_message_id,company_id,environment,applied_at FROM gridex_received_sources.structural_apply_receipts UNION ALL SELECT source_message_id,company_id,environment,applied_at FROM gridex_received_sources.structural_object_apply_receipts)r
  WHERE r.company_id=b.company_id AND r.environment=b.environment AND (source_filter IS NULL OR r.source_message_id=source_filter) GROUP BY r.source_message_id ORDER BY min(r.applied_at),r.source_message_id LOOP$new$;
 IF strpos(body,old)=0 THEN RAISE EXCEPTION 'partial_structural_method_consumer_contract_changed';END IF;EXECUTE replace(body,old,new);
END $$;
-- Reconcile after all selected writes exist; a later event/transaction failure
-- rolls back both effects and any source-only expectation observation.
CREATE TRIGGER method_expectation_applied_scope AFTER INSERT ON gridex_received_sources.structural_apply_batches FOR EACH ROW EXECUTE FUNCTION gridex_method_expectations.applied_source_v1();
COMMIT;
