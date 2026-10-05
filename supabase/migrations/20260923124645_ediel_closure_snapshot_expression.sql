-- Native run35862101094 proved22P02 at the closure proof IF: subtraction
-- binds before JSON extraction and casts the key literal as JSON. Parenthesize
-- extraction only; preserve every closed-shape, owner, original-wire and time guard.
CREATE OR REPLACE FUNCTION gridex_received_sources.review_closure_proof_consistent(p_party jsonb,p_business jsonb,p_source_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE src gridex_received_sources.sources%rowtype; baseline gridex_received_sources.sources%rowtype;
 root gridex_received_sources.object_assessments%rowtype; current_root gridex_received_sources.object_assessments%rowtype;
 review_snap gridex_received_sources.object_selection_snapshots%rowtype;
 cover jsonb:=p_business->'coverageWindow'; wire jsonb:=p_business->'wire'; reference jsonb:=p_business->'baselineCoverageAssessment';
 root_entry jsonb; current_entry jsonb; epoch timestamptz; valid_start timestamptz; valid_end timestamptz;
 change_at timestamptz; minute text; market_time timestamp; owner_ok boolean;
BEGIN
 SELECT * INTO src FROM gridex_received_sources.sources WHERE source_message_id=p_source_id AND company_id=(p_business->>'companyId')::uuid
 AND environment=p_business->>'environment' AND payload_hash=p_business->>'sourcePayloadHash';
 IF NOT FOUND OR src.message_code<>'Z05' OR src.source_received_at IS NULL THEN RETURN false; END IF;
 IF jsonb_typeof(p_business) IS DISTINCT FROM 'object'
 OR jsonb_typeof(cover) IS DISTINCT FROM 'object'
 OR jsonb_typeof(reference) IS DISTINCT FROM 'object'
 OR p_business->>'owner' IS DISTINCT FROM 'reviewed-received-closure-v1'
 OR p_business->>'coverage' IS DISTINCT FROM 'reviewed_post_ledger_closure'
 OR p_business->>'businessDisposition' IS DISTINCT FROM 'reviewed'
 OR p_business->>'reviewStatement' IS DISTINCT FROM 'original_supply_closure'
 OR p_business->>'graphNamespace' IS DISTINCT FROM 'legacy_unqualified'
 OR p_business#>>'{object,identityAgency}' IS DISTINCT FROM '9'
 OR p_business-ARRAY['version','owner','coverage','sourceDisposition','businessDisposition','graphNamespace','sourceMessageId','sourcePayloadHash','sourceReceivedAt','companyId','environment','object','assessedAt','wire','reviewerUserId','reviewStatement','customerId','meteringPointId','siteId','switchRequestId','supplyPeriodId','coverageWindow','baselineCurrentAssessmentId','reviewSnapshot','baselineCoverageAssessment','legacyEndDateProjection']<>'{}'::jsonb
 OR NOT p_business ?& ARRAY['version','owner','coverage','sourceDisposition','businessDisposition','graphNamespace','sourceMessageId','sourcePayloadHash','sourceReceivedAt','companyId','environment','object','assessedAt','wire','reviewerUserId','reviewStatement','customerId','meteringPointId','siteId','switchRequestId','supplyPeriodId','coverageWindow','baselineCurrentAssessmentId','reviewSnapshot','baselineCoverageAssessment','legacyEndDateProjection']
 OR jsonb_typeof(p_business->'reviewSnapshot') IS DISTINCT FROM 'object'
 OR (p_business->'reviewSnapshot')-ARRAY['snapshotId','readsetHash','cutoffAt']<>'{}'::jsonb
 OR NOT p_business->'reviewSnapshot' ?& ARRAY['snapshotId','readsetHash','cutoffAt']
 -- Handbok 26A p70 supplier handoff; LK is a conservative supported subset.
 OR substring(wire#>>'{effectiveTo,marketMinute}',9,4) IS DISTINCT FROM '0000'
 OR NOT gridex_received_sources.closure_wire_matches_v1(src.raw_payload,p_business->'object',wire)
 OR NOT gridex_received_sources.review_party_proof_consistent(p_party,p_business,src.source_received_at)
 OR NOT EXISTS(SELECT FROM public.companies c WHERE c.id=src.company_id AND coalesce(c.status,'active') IN ('active','onboarding'))
 OR NOT (public.gridex_actor_has_company_permission((p_business->>'reviewerUserId')::uuid,src.company_id,'communication.write')
   OR public.gridex_actor_has_company_permission((p_business->>'reviewerUserId')::uuid,src.company_id,'ediel_testing.write')) THEN RETURN false; END IF;
 IF cover->>'kind' IS DISTINCT FROM 'post_ledger_supply' OR cover->>'supplyPeriodId' IS DISTINCT FROM p_business->>'supplyPeriodId'
 OR cover->>'switchRequestId' IS DISTINCT FROM p_business->>'switchRequestId'
 OR cover-ARRAY['kind','baselineSourceMessageId','baselineAssessmentId','baselineFactsHash','supplyPeriodId','switchRequestId','switchCreatedAt','outboundSourceMessageId','outboundCreatedAt','validFrom','validTo']<>'{}'::jsonb
 OR NOT cover ?& ARRAY['kind','baselineSourceMessageId','baselineAssessmentId','baselineFactsHash','supplyPeriodId','switchRequestId','switchCreatedAt','outboundSourceMessageId','outboundCreatedAt','validFrom','validTo']
 OR wire->'object' IS DISTINCT FROM p_business->'object' OR wire->>'messageCode' IS DISTINCT FROM src.message_code
 OR wire->>'legalSender' IS DISTINCT FROM p_party#>>'{parties,legalSender}' OR wire->>'legalReceiver' IS DISTINCT FROM p_party#>>'{parties,legalReceiver}'
 OR wire->>'transportSender' IS DISTINCT FROM p_party#>>'{parties,transportSender}' OR wire->>'transportReceiver' IS DISTINCT FROM p_party#>>'{parties,transportReceiver}'
 THEN RETURN false; END IF;
 SELECT * INTO review_snap FROM gridex_received_sources.object_selection_snapshots
 WHERE id=(p_business#>>'{reviewSnapshot,snapshotId}')::uuid AND company_id=src.company_id AND environment=src.environment
 AND readset_hash=p_business#>>'{reviewSnapshot,readsetHash}' AND cutoff_at=(p_business#>>'{reviewSnapshot,cutoffAt}')::timestamptz;
 IF NOT FOUND OR (review_snap.readset_text::jsonb->>'complete') IS DISTINCT FROM 'true'
 OR review_snap.cutoff_at>(p_business->>'assessedAt')::timestamptz
 OR NOT EXISTS(SELECT FROM jsonb_array_elements(review_snap.readset_text::jsonb->'sources') item
   WHERE item->>'sourceMessageId'=src.source_message_id::text AND item->>'payloadHash'=src.payload_hash) THEN RETURN false; END IF;
 SELECT opened_at INTO epoch FROM gridex_received_sources.epoch WHERE singleton;
 valid_start:=(cover->>'validFrom')::timestamptz; valid_end:=(cover->>'validTo')::timestamptz;
 minute:=wire#>>'{effectiveTo,marketMinute}';
 IF minute IS NULL OR minute !~ '^[0-9]{12}$' OR substring(minute,1,4)::int<1 OR substring(minute,9,2)::int>23 OR substring(minute,11,2)::int>59 THEN RETURN false; END IF;
 market_time:=make_timestamp(substring(minute,1,4)::int,substring(minute,5,2)::int,substring(minute,7,2)::int,substring(minute,9,2)::int,substring(minute,11,2)::int,0);
 change_at:=market_time AT TIME ZONE 'Etc/GMT-1';
 IF (wire#>>'{effectiveTo,utc}')::timestamptz IS DISTINCT FROM change_at OR valid_start IS NULL OR NOT isfinite(valid_start)
 OR valid_start<epoch OR (valid_end IS NOT NULL AND (NOT isfinite(valid_end) OR valid_end<=valid_start))
 OR change_at<=valid_start OR (valid_end IS NOT NULL AND change_at<>valid_end)
 OR p_business->>'legacyEndDateProjection' IS DISTINCT FROM market_time::date::text THEN RETURN false; END IF;
 SELECT * INTO baseline FROM gridex_received_sources.sources WHERE source_message_id=(cover->>'baselineSourceMessageId')::uuid
 AND company_id=src.company_id AND environment=src.environment AND message_code='Z04';
 IF NOT FOUND OR baseline.source_message_id=src.source_message_id OR reference IS DISTINCT FROM jsonb_build_object(
  'sourceMessageId',baseline.source_message_id,'assessmentId',p_business->>'baselineCurrentAssessmentId',
  'factsHash',reference->>'factsHash','payloadHash',baseline.payload_hash) THEN RETURN false; END IF;
 SELECT a.* INTO root FROM gridex_received_sources.object_assessments a JOIN gridex_received_sources.object_availability_witnesses w ON w.assessment_id=a.id
 WHERE a.id=(cover->>'baselineAssessmentId')::uuid AND a.source_message_id=baseline.source_message_id AND a.company_id=src.company_id
 AND a.environment=src.environment AND a.facts_hash=cover->>'baselineFactsHash' AND w.facts_hash=a.facts_hash AND w.observed_at<=review_snap.cutoff_at;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT value INTO root_entry FROM jsonb_array_elements(root.facts_text::jsonb->'objects')
 WHERE value#>>'{object,objectId}'=p_business#>>'{object,objectId}' AND value#>>'{object,identityAgency}'='9';
 IF root_entry->>'disposition' IS DISTINCT FROM 'accepted' OR root_entry#>>'{business,owner}' IS DISTINCT FROM 'inbound-z04-switch-confirmation-v1'
 OR root.source_payload_hash IS DISTINCT FROM baseline.payload_hash
 OR root_entry#>>'{business,sourceMessageId}' IS DISTINCT FROM baseline.source_message_id::text
 OR root_entry#>>'{business,sourcePayloadHash}' IS DISTINCT FROM baseline.payload_hash
 OR root_entry#>>'{business,companyId}' IS DISTINCT FROM src.company_id::text
 OR root_entry#>>'{business,environment}' IS DISTINCT FROM src.environment
 OR root_entry#>>'{party,parties,legalSender}' IS DISTINCT FROM wire->>'legalSender'
 OR root_entry#>>'{party,parties,legalReceiver}' IS DISTINCT FROM wire->>'legalReceiver'
 OR root_entry#>>'{business,switchRequestId}' IS DISTINCT FROM p_business->>'switchRequestId'
 OR root_entry#>>'{business,supplyPeriodId}' IS DISTINCT FROM p_business->>'supplyPeriodId'
 OR root_entry#>>'{business,customerId}' IS DISTINCT FROM p_business->>'customerId'
 OR root_entry#>>'{business,meteringPointId}' IS DISTINCT FROM p_business->>'meteringPointId'
 OR root_entry#>>'{business,siteId}' IS DISTINCT FROM p_business->>'siteId'
 OR (root_entry#>>'{business,effectiveFrom,utc}')::timestamptz IS DISTINCT FROM valid_start THEN RETURN false; END IF;
 SELECT a.* INTO current_root FROM gridex_received_sources.object_assessments a JOIN gridex_received_sources.object_availability_witnesses w ON w.assessment_id=a.id
 WHERE a.id=(p_business->>'baselineCurrentAssessmentId')::uuid AND a.source_message_id=baseline.source_message_id
 AND a.company_id=src.company_id AND a.environment=src.environment AND w.facts_hash=a.facts_hash AND w.observed_at<=review_snap.cutoff_at
 AND NOT EXISTS(SELECT FROM gridex_received_sources.object_assessments next WHERE next.previous_assessment_id=a.id);
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT value INTO current_entry FROM jsonb_array_elements(current_root.facts_text::jsonb->'objects')
 WHERE value#>>'{object,objectId}'=p_business#>>'{object,objectId}' AND value#>>'{object,identityAgency}'='9';
 IF current_entry->>'disposition' IS DISTINCT FROM 'accepted'
 OR current_entry#>>'{business,owner}' IS DISTINCT FROM 'reviewed-received-structure-v1'
 OR current_entry#>>'{business,wire,messageCode}' IS DISTINCT FROM 'Z04'
 OR current_entry#>'{business,wire,functionCode}' NOT IN ('"9"'::jsonb,'null'::jsonb)
 OR current_entry#>'{business,replaces}' IS DISTINCT FROM 'null'::jsonb
 OR current_entry#>'{business,coverageWindow}' IS DISTINCT FROM cover
 OR current_root.facts_hash IS DISTINCT FROM reference->>'factsHash'
 OR current_root.source_payload_hash IS DISTINCT FROM baseline.payload_hash
 OR current_entry#>>'{business,sourceMessageId}' IS DISTINCT FROM baseline.source_message_id::text
 OR current_entry#>>'{business,sourcePayloadHash}' IS DISTINCT FROM baseline.payload_hash
 OR current_entry#>>'{business,companyId}' IS DISTINCT FROM src.company_id::text
 OR current_entry#>>'{business,environment}' IS DISTINCT FROM src.environment
 OR current_entry#>>'{business,customerId}' IS DISTINCT FROM p_business->>'customerId'
 OR current_entry#>>'{business,meteringPointId}' IS DISTINCT FROM p_business->>'meteringPointId'
 OR current_entry#>>'{business,siteId}' IS DISTINCT FROM p_business->>'siteId'
 OR current_entry#>>'{business,switchRequestId}' IS DISTINCT FROM p_business->>'switchRequestId'
 OR current_entry#>>'{business,supplyPeriodId}' IS DISTINCT FROM p_business->>'supplyPeriodId'
 OR current_entry#>>'{business,wire,legalSender}' IS DISTINCT FROM wire->>'legalSender'
 OR current_entry#>>'{business,wire,legalReceiver}' IS DISTINCT FROM wire->>'legalReceiver'
 OR (current_entry#>>'{business,wire,effectiveFrom,utc}')::timestamptz IS DISTINCT FROM valid_start
 THEN RETURN false; END IF;
 -- The retained snapshot must actually contain the current baseline assessment,
 -- rather than merely sharing a plausible time and tenant with it.
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(review_snap.readset_text::jsonb->'sources') source,
  LATERAL jsonb_array_elements(source->'assessments') assessment
  WHERE source->>'sourceMessageId'=baseline.source_message_id::text AND source->>'payloadHash'=baseline.payload_hash
  AND assessment->>'id'=root.id::text AND assessment->>'factsHash'=root.facts_hash
  AND (assessment->>'availableAt')::timestamptz<=review_snap.cutoff_at) THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(review_snap.readset_text::jsonb->'sources') source,
  LATERAL jsonb_array_elements(source->'assessments') assessment
  WHERE source->>'sourceMessageId'=baseline.source_message_id::text AND assessment->>'id'=current_root.id::text
  AND assessment->>'factsHash'=current_root.facts_hash AND (assessment->>'availableAt')::timestamptz<=review_snap.cutoff_at) THEN RETURN false; END IF;
 -- Selection may not choose a convenient reviewed root among ambiguous
 -- latest witnessed baselines for this same immutable supply and object.
 IF (SELECT count(*) FROM gridex_received_sources.object_assessments a
  JOIN gridex_received_sources.object_availability_witnesses w ON w.assessment_id=a.id AND w.facts_hash=a.facts_hash
  JOIN gridex_received_sources.sources source ON source.source_message_id=a.source_message_id
  CROSS JOIN LATERAL jsonb_array_elements(a.facts_text::jsonb->'objects') item
  WHERE a.company_id=src.company_id AND a.environment=src.environment AND source.message_code='Z04'
  AND w.observed_at<=review_snap.cutoff_at
  AND NOT EXISTS(SELECT FROM gridex_received_sources.object_assessments child WHERE child.previous_assessment_id=a.id)
  AND item->>'disposition'='accepted' AND item#>>'{business,owner}'='reviewed-received-structure-v1'
  AND item#>>'{business,supplyPeriodId}'=p_business->>'supplyPeriodId'
  AND item#>>'{object,objectId}'=p_business#>>'{object,objectId}' AND item#>>'{object,identityAgency}'='9'
  AND item#>>'{business,wire,legalSender}'=wire->>'legalSender'
  AND item#>>'{business,wire,legalReceiver}'=wire->>'legalReceiver')<>1 THEN RETURN false; END IF;
 IF (SELECT count(*) FROM public.customer_supply_periods sp WHERE sp.company_id=src.company_id
  AND sp.source_message_id=src.source_message_id AND sp.status='ended'
  AND sp.customer_id=(p_business->>'customerId')::uuid AND sp.metering_point_id=(p_business->>'meteringPointId')::uuid)<>1 THEN RETURN false; END IF;
 SELECT EXISTS(SELECT FROM public.supplier_switch_requests sw
 JOIN public.customer_supply_periods sp ON sp.id=(p_business->>'supplyPeriodId')::uuid
 JOIN public.ediel_messages outbound ON outbound.id=sw.outbound_z03_message_id
 JOIN public.metering_points mp ON mp.id=sw.metering_point_id JOIN public.customer_sites cs ON cs.id=sw.site_id
 WHERE sw.id=(p_business->>'switchRequestId')::uuid AND sw.company_id=src.company_id AND sp.company_id=src.company_id
 AND sw.inbound_z04_message_id=baseline.source_message_id AND sp.source_message_id=src.source_message_id
 AND sw.status='accepted' AND sp.status='ended'
 AND sw.rff_li_reference=current_entry#>>'{business,wire,caseReference}'
 AND sw.metering_point_id=(p_business->>'meteringPointId')::uuid AND sp.metering_point_id=sw.metering_point_id
 AND sw.customer_id=(p_business->>'customerId')::uuid AND sp.customer_id=sw.customer_id AND sw.site_id=(p_business->>'siteId')::uuid
 AND (sp.source_switch_request_id IS NULL OR sp.source_switch_request_id=sw.id)
 AND mp.company_id=src.company_id AND cs.company_id=src.company_id AND mp.site_id=cs.id AND mp.customer_id=sw.customer_id AND cs.customer_id=sw.customer_id
 AND (sp.start_date::timestamp AT TIME ZONE 'Etc/GMT-1')=valid_start AND sw.confirmed_start_date=sp.start_date
 AND sp.end_date=market_time::date
 AND sw.created_at=(cover->>'switchCreatedAt')::timestamptz AND sw.created_at>=epoch AND sw.created_at<=valid_start
 AND outbound.id=(cover->>'outboundSourceMessageId')::uuid AND outbound.company_id=src.company_id AND outbound.environment=src.environment
 AND outbound.direction='outbound' AND outbound.message_standard='edifact' AND outbound.message_family='PRODAT' AND outbound.message_code='Z03'
 AND outbound.created_at=(cover->>'outboundCreatedAt')::timestamptz AND outbound.created_at>=sw.created_at AND outbound.created_at<=review_snap.cutoff_at
 AND outbound.message_sent_at>=outbound.created_at AND outbound.message_sent_at<=baseline.source_received_at
 AND outbound.customer_id=sw.customer_id AND outbound.metering_point_id=sw.metering_point_id AND outbound.site_id=sw.site_id) INTO owner_ok;
 IF owner_ok IS DISTINCT FROM true THEN RETURN false; END IF;
 RETURN true;
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range OR invalid_parameter_value THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.review_closure_proof_consistent(jsonb,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;

