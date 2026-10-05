-- Forward-only fail-closed owner correction. P26.A p65.
BEGIN;
CREATE OR REPLACE FUNCTION gridex_received_sources.review_business_proof_consistent(p_party jsonb,p_business jsonb,p_source_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE src gridex_received_sources.sources%rowtype; baseline gridex_received_sources.sources%rowtype;
 root gridex_received_sources.object_assessments%rowtype; current_root gridex_received_sources.object_assessments%rowtype;
 review_snap gridex_received_sources.object_selection_snapshots%rowtype;
 predecessor gridex_received_sources.object_assessments%rowtype;
 cover jsonb:=p_business->'coverageWindow'; wire jsonb:=p_business->'wire'; replacement jsonb:=p_business->'replaces';
 root_entry jsonb; current_entry jsonb; previous_entry jsonb; epoch timestamptz; valid_start timestamptz; valid_end timestamptz;
 change_at timestamptz; minute text; market_time timestamp; owner_ok boolean;
BEGIN
 SELECT * INTO src FROM gridex_received_sources.sources WHERE source_message_id=p_source_id;
 IF NOT FOUND OR src.message_code NOT IN ('Z04','Z06','Z10') OR src.source_received_at IS NULL THEN RETURN false; END IF;
 -- Z06/E34 needs a persisted death assessment or a counterparty-scoped bilateral
 -- agreement. Neither authoritative producer exists in this review owner.
 IF src.message_code='Z06' AND p_business#>>'{wire,businessCase}'='customer_only' THEN RETURN false; END IF;
 IF p_business->>'owner' IS DISTINCT FROM 'reviewed-received-structure-v1'
 OR p_business->>'coverage' IS DISTINCT FROM 'reviewed_post_ledger_supply'
 OR p_business->>'businessDisposition' IS DISTINCT FROM 'reviewed'
 OR p_business->>'reviewStatement' IS DISTINCT FROM 'original_structural_message'
 OR p_business->>'graphNamespace' IS DISTINCT FROM 'legacy_unqualified'
 OR p_business#>>'{object,identityAgency}' IS DISTINCT FROM '9'
 OR p_business-ARRAY['version','owner','coverage','sourceDisposition','businessDisposition','graphNamespace','sourceMessageId','sourcePayloadHash','sourceReceivedAt','companyId','environment','object','assessedAt','wire','reviewerUserId','reviewStatement','customerId','meteringPointId','siteId','switchRequestId','supplyPeriodId','coverageWindow','baselineCurrentAssessmentId','reviewSnapshot','replaces']<>'{}'::jsonb
 OR NOT p_business ?& ARRAY['wire','reviewerUserId','reviewStatement','coverageWindow','baselineCurrentAssessmentId','reviewSnapshot','replaces']
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
 OR wire#>>'{effectiveFrom,fieldNumber}' IS DISTINCT FROM (CASE WHEN src.message_code='Z04' THEN '210' ELSE '216' END)
 OR (CASE src.message_code WHEN 'Z04' THEN wire->>'businessCase'='supply_baseline' WHEN 'Z10' THEN wire->>'businessCase'='meter_exchange'
     ELSE wire->>'businessCase' IN ('customer_only','change_with_reading','change_without_reading') END) IS DISTINCT FROM true
 OR jsonb_typeof(wire->'registers') IS DISTINCT FROM 'array' OR jsonb_array_length(wire->'registers')<>jsonb_array_length(p_business#>'{object,registers}')
 OR nullif(wire->>'caseReference','') IS NULL OR nullif(wire->>'documentReference','') IS NULL THEN RETURN false; END IF;
 SELECT * INTO review_snap FROM gridex_received_sources.object_selection_snapshots
 WHERE id=(p_business#>>'{reviewSnapshot,snapshotId}')::uuid AND company_id=src.company_id AND environment=src.environment
 AND readset_hash=p_business#>>'{reviewSnapshot,readsetHash}' AND cutoff_at=(p_business#>>'{reviewSnapshot,cutoffAt}')::timestamptz;
 IF NOT FOUND OR (review_snap.readset_text::jsonb->>'complete') IS DISTINCT FROM 'true'
 OR review_snap.cutoff_at>(p_business->>'assessedAt')::timestamptz
 OR NOT EXISTS(SELECT FROM jsonb_array_elements(review_snap.readset_text::jsonb->'sources') item
   WHERE item->>'sourceMessageId'=src.source_message_id::text AND item->>'payloadHash'=src.payload_hash) THEN RETURN false; END IF;
 SELECT opened_at INTO epoch FROM gridex_received_sources.epoch WHERE singleton;
 valid_start:=(cover->>'validFrom')::timestamptz; valid_end:=(cover->>'validTo')::timestamptz;
 minute:=wire#>>'{effectiveFrom,marketMinute}';
 IF minute IS NULL OR minute !~ '^[0-9]{12}$' OR substring(minute,1,4)::int<1 OR substring(minute,9,2)::int>23 OR substring(minute,11,2)::int>59 THEN RETURN false; END IF;
 market_time:=make_timestamp(substring(minute,1,4)::int,substring(minute,5,2)::int,substring(minute,7,2)::int,substring(minute,9,2)::int,substring(minute,11,2)::int,0);
 change_at:=market_time AT TIME ZONE 'Etc/GMT-1';
 IF (wire#>>'{effectiveFrom,utc}')::timestamptz IS DISTINCT FROM change_at OR valid_start IS NULL OR NOT isfinite(valid_start)
 OR valid_start<epoch OR (valid_end IS NOT NULL AND (NOT isfinite(valid_end) OR valid_end<=valid_start))
 OR change_at<valid_start OR (valid_end IS NOT NULL AND change_at>=valid_end)
 OR (src.message_code='Z04' AND change_at<>valid_start) THEN RETURN false; END IF;
 SELECT * INTO baseline FROM gridex_received_sources.sources WHERE source_message_id=(cover->>'baselineSourceMessageId')::uuid
 AND company_id=src.company_id AND environment=src.environment AND message_code='Z04';
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT a.* INTO root FROM gridex_received_sources.object_assessments a JOIN gridex_received_sources.object_availability_witnesses w ON w.assessment_id=a.id
 WHERE a.id=(cover->>'baselineAssessmentId')::uuid AND a.source_message_id=baseline.source_message_id AND a.company_id=src.company_id
 AND a.environment=src.environment AND a.facts_hash=cover->>'baselineFactsHash' AND w.facts_hash=a.facts_hash AND w.observed_at<=review_snap.cutoff_at;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT value INTO root_entry FROM jsonb_array_elements(root.facts_text::jsonb->'objects')
 WHERE value#>>'{object,objectId}'=p_business#>>'{object,objectId}' AND value#>>'{object,identityAgency}'='9';
 IF root_entry->>'disposition' IS DISTINCT FROM 'accepted' OR root_entry#>>'{business,owner}' IS DISTINCT FROM 'inbound-z04-switch-confirmation-v1'
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
 IF current_entry->>'disposition' IS DISTINCT FROM 'accepted' THEN RETURN false; END IF;
 -- The retained snapshot must actually contain the current baseline assessment,
 -- rather than merely sharing a plausible time and tenant with it.
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(review_snap.readset_text::jsonb->'sources') source,
  LATERAL jsonb_array_elements(source->'assessments') assessment
  WHERE source->>'sourceMessageId'=baseline.source_message_id::text AND assessment->>'id'=current_root.id::text
  AND assessment->>'factsHash'=current_root.facts_hash AND (assessment->>'availableAt')::timestamptz<=review_snap.cutoff_at) THEN RETURN false; END IF;
 SELECT EXISTS(SELECT FROM public.supplier_switch_requests sw
 JOIN public.customer_supply_periods sp ON sp.id=(p_business->>'supplyPeriodId')::uuid
 JOIN public.ediel_messages outbound ON outbound.id=sw.outbound_z03_message_id
 JOIN public.metering_points mp ON mp.id=sw.metering_point_id JOIN public.customer_sites cs ON cs.id=sw.site_id
 WHERE sw.id=(p_business->>'switchRequestId')::uuid AND sw.company_id=src.company_id AND sp.company_id=src.company_id
 AND sw.inbound_z04_message_id=baseline.source_message_id AND sp.source_message_id=baseline.source_message_id
 AND sw.status='accepted' AND sp.status='confirmed_by_grid_owner'
 AND sw.metering_point_id=(p_business->>'meteringPointId')::uuid AND sp.metering_point_id=sw.metering_point_id
 AND sw.customer_id=(p_business->>'customerId')::uuid AND sp.customer_id=sw.customer_id AND sw.site_id=(p_business->>'siteId')::uuid
 AND (sp.source_switch_request_id IS NULL OR sp.source_switch_request_id=sw.id)
 AND mp.company_id=src.company_id AND cs.company_id=src.company_id AND mp.site_id=cs.id AND mp.customer_id=sw.customer_id AND cs.customer_id=sw.customer_id
 AND (sp.start_date::timestamp AT TIME ZONE 'Etc/GMT-1')=valid_start AND sw.confirmed_start_date=sp.start_date
 AND (sp.end_date::timestamp AT TIME ZONE 'Etc/GMT-1') IS NOT DISTINCT FROM valid_end
 AND sw.created_at=(cover->>'switchCreatedAt')::timestamptz AND sw.created_at>=epoch AND sw.created_at<=valid_start
 AND outbound.id=(cover->>'outboundSourceMessageId')::uuid AND outbound.company_id=src.company_id AND outbound.environment=src.environment
 AND outbound.direction='outbound' AND outbound.message_standard='edifact' AND outbound.message_family='PRODAT' AND outbound.message_code='Z03'
 AND outbound.created_at=(cover->>'outboundCreatedAt')::timestamptz AND outbound.created_at>=sw.created_at AND outbound.created_at<=review_snap.cutoff_at
 AND outbound.message_sent_at>=outbound.created_at AND outbound.message_sent_at<=baseline.source_received_at
 AND outbound.customer_id=sw.customer_id AND outbound.metering_point_id=sw.metering_point_id AND outbound.site_id=sw.site_id) INTO owner_ok;
 IF owner_ok IS DISTINCT FROM true THEN RETURN false; END IF;
 IF wire->>'functionCode'='5' THEN
  IF replacement IS NULL OR jsonb_typeof(replacement)<>'object' OR replacement->>'sourceMessageId'=src.source_message_id::text THEN RETURN false; END IF;
  SELECT a.* INTO predecessor FROM gridex_received_sources.object_assessments a JOIN gridex_received_sources.object_availability_witnesses w ON w.assessment_id=a.id
  WHERE a.id=(replacement->>'assessmentId')::uuid AND a.source_message_id=(replacement->>'sourceMessageId')::uuid
  AND a.company_id=src.company_id AND a.environment=src.environment AND a.source_payload_hash=replacement->>'payloadHash'
  AND w.facts_hash=a.facts_hash AND w.observed_at<=review_snap.cutoff_at
  AND NOT EXISTS(SELECT FROM gridex_received_sources.object_assessments next WHERE next.previous_assessment_id=a.id);
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT value INTO previous_entry FROM jsonb_array_elements(predecessor.facts_text::jsonb->'objects')
  WHERE value#>>'{object,objectId}'=p_business#>>'{object,objectId}' AND value#>>'{object,identityAgency}'='9';
  IF previous_entry->>'disposition' IS DISTINCT FROM 'accepted' OR previous_entry#>>'{business,owner}' IS DISTINCT FROM 'reviewed-received-structure-v1'
  OR previous_entry#>>'{business,supplyPeriodId}' IS DISTINCT FROM p_business->>'supplyPeriodId'
  OR previous_entry#>>'{business,wire,messageCode}' IS DISTINCT FROM wire->>'messageCode'
  OR previous_entry#>>'{business,wire,businessCase}' IS DISTINCT FROM wire->>'businessCase'
  OR previous_entry#>>'{business,wire,caseReference}' IS DISTINCT FROM wire->>'caseReference'
  OR previous_entry#>>'{business,wire,documentReference}' IS NOT DISTINCT FROM wire->>'documentReference'
  OR previous_entry#>>'{business,wire,legalSender}' IS DISTINCT FROM wire->>'legalSender'
  OR previous_entry#>>'{business,wire,legalReceiver}' IS DISTINCT FROM wire->>'legalReceiver' THEN RETURN false; END IF;
 ELSE
  IF wire->'functionCode' NOT IN ('"9"'::jsonb,'null'::jsonb) OR replacement IS DISTINCT FROM 'null'::jsonb
   OR (src.message_code='Z04' AND baseline.source_message_id<>src.source_message_id) THEN RETURN false; END IF;
 END IF;
 RETURN true;
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range OR invalid_parameter_value THEN RETURN false;
END $$;
COMMIT;
