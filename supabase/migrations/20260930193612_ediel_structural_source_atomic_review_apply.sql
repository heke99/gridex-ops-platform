-- A source-only replacement for label/parsed-JSON safe apply. The existing
-- received-source owner ledger remains the dated structural authority.
-- This receipt records one whole original decision, not a second rule engine
-- or a fabricated historical baseline. No metering values are changed.
BEGIN;
CREATE TABLE gridex_received_sources.structural_apply_receipts (
 source_message_id uuid PRIMARY KEY REFERENCES gridex_received_sources.sources(source_message_id) ON DELETE RESTRICT,
 company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
 environment text NOT NULL CHECK(environment IN ('test','production')),
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
 canonical_assessment_id uuid NOT NULL REFERENCES gridex_received_sources.validation_assessments(id) ON DELETE RESTRICT,
 object_assessment_id uuid NOT NULL REFERENCES gridex_received_sources.object_assessments(id) ON DELETE RESTRICT,
 actor_user_id uuid NOT NULL,applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 source_received_at timestamptz NOT NULL,objects jsonb NOT NULL CHECK(jsonb_typeof(objects)='array'),result jsonb NOT NULL
);
ALTER TABLE gridex_received_sources.structural_apply_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_received_sources.structural_apply_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_received_sources.structural_apply_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER structural_apply_no_mutation BEFORE UPDATE OR DELETE ON gridex_received_sources.structural_apply_receipts FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER structural_apply_no_truncate BEFORE TRUNCATE ON gridex_received_sources.structural_apply_receipts FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();

CREATE FUNCTION public.ediel_apply_reviewed_structure_v1(p_company_id uuid,p_source_message_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;src gridex_received_sources.sources%rowtype;
 canonical gridex_received_sources.validation_assessments%rowtype;assessment gridex_received_sources.object_assessments%rowtype;
 prior gridex_received_sources.structural_apply_receipts%rowtype;entry jsonb;business jsonb;wire jsonb;tokens jsonb;own_tokens jsonb;
 objects jsonb:='[]';counted integer;reg jsonb;lin jsonb;point public.metering_points%rowtype;site public.customer_sites%rowtype;
 line_start integer;line_end integer;physical_count integer;effective_at timestamptz;result jsonb;applied_count integer:=0;
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
 IF canonical.facts_text::jsonb->>'syntaxDecision' IS DISTINCT FROM 'accepted' OR canonical.facts_text::jsonb->>'applicationDecision' IS DISTINCT FROM 'accepted'
  OR canonical.facts_text::jsonb->>'functionalDecision' IS DISTINCT FROM 'accepted' THEN RETURN jsonb_build_object('applied',false,'reason','structural_apply_canonical_source_not_accepted'); END IF;
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
 -- Follow the normal supply commit order: original inbound baselines first,
 -- then their originating outbound requests, switches, periods, points/sites.
 -- Acquire whole-message sets before proof evaluation to prevent a concurrent
 -- cancellation/activation from changing coverage halfway through an apply.
 PERFORM original.id FROM public.ediel_messages original WHERE original.company_id=p_company_id AND original.environment=m.environment
  AND original.id IN(SELECT (e#>>'{business,coverageWindow,baselineSourceMessageId}')::uuid FROM jsonb_array_elements(assessment.facts_text::jsonb->'objects') e) ORDER BY original.id FOR SHARE;
 PERFORM original.id FROM public.ediel_messages original WHERE original.company_id=p_company_id AND original.environment=m.environment
  AND original.id IN(SELECT (e#>>'{business,coverageWindow,outboundSourceMessageId}')::uuid FROM jsonb_array_elements(assessment.facts_text::jsonb->'objects') e) ORDER BY original.id FOR SHARE;
 PERFORM sw.id FROM public.supplier_switch_requests sw WHERE sw.company_id=p_company_id
  AND sw.id IN(SELECT (e#>>'{business,switchRequestId}')::uuid FROM jsonb_array_elements(assessment.facts_text::jsonb->'objects') e) ORDER BY sw.id FOR UPDATE;
 PERFORM sp.id FROM public.customer_supply_periods sp WHERE sp.company_id=p_company_id
  AND sp.id IN(SELECT (e#>>'{business,supplyPeriodId}')::uuid FROM jsonb_array_elements(assessment.facts_text::jsonb->'objects') e) ORDER BY sp.id FOR UPDATE;
 PERFORM mp.id FROM public.metering_points mp WHERE mp.company_id=p_company_id
  AND mp.id IN(SELECT (e#>>'{business,meteringPointId}')::uuid FROM jsonb_array_elements(assessment.facts_text::jsonb->'objects') e) ORDER BY mp.id FOR UPDATE;
 PERFORM cs.id FROM public.customer_sites cs WHERE cs.company_id=p_company_id
  AND cs.id IN(SELECT (e#>>'{business,siteId}')::uuid FROM jsonb_array_elements(assessment.facts_text::jsonb->'objects') e) ORDER BY cs.id FOR UPDATE;
 FOR entry IN SELECT e FROM jsonb_array_elements(assessment.facts_text::jsonb->'objects') e ORDER BY e#>>'{business,meteringPointId}' LOOP
  business:=entry->'business';wire:=business->'wire';
  IF entry->>'disposition' IS DISTINCT FROM 'accepted' OR business->>'owner' IS DISTINCT FROM 'reviewed-received-structure-v1'
   OR (wire->>'businessCase' IN ('change_with_reading','change_without_reading','meter_exchange')) IS NOT TRUE
   OR gridex_received_sources.review_business_proof_consistent(entry->'party',business,m.id) IS NOT TRUE THEN RETURN jsonb_build_object('applied',false,'reason','structural_apply_original_review_required'); END IF;
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
  objects:=objects||jsonb_build_array(jsonb_build_object('object',entry->'object','meteringPointId',point.id,'siteId',site.id,
   'effectiveAt',effective_at,'sourceReceivedAt',src.source_received_at,'wire',wire,'sourceRegisters',own_tokens,
   'readingFollowUp',jsonb_build_object('status',CASE WHEN wire->>'businessCase'='change_without_reading' THEN 'not_required_by_this_change' ELSE 'source_process_evidence_required' END,
    'criterion',CASE WHEN wire->>'businessCase'='change_without_reading' THEN 'AT-Z06G-SUPPLIER' WHEN wire->>'businessCase'='meter_exchange' THEN 'AT-Z10M-SUPPLIER' ELSE 'AT-Z06F-SUPPLIER' END,
    'deadline',NULL,'fulfilled',false)));
  applied_count:=applied_count+jsonb_array_length(entry#>'{object,registers}');
 END LOOP;
 result:=jsonb_build_object('applied',true,'appliedCount',applied_count,'objects',objects,'sourceMessageId',m.id,'objectAssessmentId',assessment.id);
 INSERT INTO gridex_received_sources.structural_apply_receipts(source_message_id,company_id,environment,payload_hash,canonical_assessment_id,object_assessment_id,actor_user_id,source_received_at,objects,result)
 VALUES(m.id,p_company_id,m.environment,src.payload_hash,canonical.id,assessment.id,p_actor_user_id,src.source_received_at,objects,result);
 INSERT INTO public.ediel_message_events(company_id,ediel_message_id,message_id,event_type,event_status,message,payload,event_payload,created_by)
 VALUES(p_company_id,m.id,m.id,'manual_note','success','Granskad källbunden strukturversion tillämpad.',
  jsonb_build_object('safeApply',true,'safeApplyDecision','applied','appliedCount',applied_count,'sourceAssessmentId',assessment.id,'appliedAutomatically',false),
  jsonb_build_object('safeApply',true,'safeApplyDecision','applied','appliedCount',applied_count,'sourceAssessmentId',assessment.id,'appliedAutomatically',false),p_actor_user_id);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.ediel_apply_reviewed_structure_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_apply_reviewed_structure_v1(uuid,uuid,uuid) TO service_role;
COMMENT ON TABLE gridex_received_sources.structural_apply_receipts IS 'Whole-source atomic review effects referencing the single immutable received-source structural authority; valid time and receipt time remain separate. No old receipts, baselines or meter values are fabricated.';
COMMIT;
