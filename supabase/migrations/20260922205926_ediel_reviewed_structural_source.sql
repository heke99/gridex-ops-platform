-- Created by actual Supabase CLI2.101.0, isolated run35783789546. Forward only.
-- Explicit full-original review is distinct from safe-apply and Z04's commit
-- handoff. Existing append/witness/history storage remains authoritative.
BEGIN;
-- Preserve the existing Z04 checker unchanged. The shared party semantics below
-- deliberately omit only its Z04-specific business/date checks; the separate
-- review checker supplies its own actual lifecycle and reviewer checks.
CREATE FUNCTION gridex_received_sources.review_party_proof_consistent(p_party jsonb,p_business jsonb,p_received timestamptz)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE identity jsonb:=p_party#>'{receiver,identity}'; evidence jsonb:=p_party#>'{receiver,evidence}';
 records jsonb:=evidence->'records'; facility jsonb:=p_party->'facility'; parties jsonb:=p_party->'parties';
 effective jsonb:=p_business->'effectiveFrom'; commit_row jsonb; name text; stamp text; instant timestamptz;
 party_start timestamptz; party_end timestamptz; evaluated timestamptz; role_values text[]; supplied_roles text[];
 actor_count bigint; identifier_count bigint; selected_actor_id uuid; legal_id text; relation_count bigint;
 relation_id uuid; transport_actor uuid; transport_id text; minute text; market_time timestamp; expected_day text;
BEGIN
 IF p_received IS NULL OR NOT isfinite(p_received)
  OR p_business->>'sourceDisposition' IS DISTINCT FROM 'not_established'
  OR p_business->>'graphNamespace' IS DISTINCT FROM 'legacy_unqualified'
  OR p_party->>'historicalKnowledge' IS DISTINCT FROM 'not_established'
  OR p_party->>'authentication' IS DISTINCT FROM 'not_assessed'
  OR evidence->'version' IS DISTINCT FROM '1'::jsonb
  OR evidence->>'owner' IS DISTINCT FROM 'canonical-tenant-ediel-identity-v1'
  OR evidence->>'consistency' IS DISTINCT FROM 'independent_reads'
  OR evidence->>'historicalKnowledge' IS DISTINCT FROM 'not_established'
  OR evidence->>'sourceDisposition' IS DISTINCT FROM 'not_established'
  OR facility->>'owner' IS DISTINCT FROM 'selected-facility-grid-owner-v1'
  OR facility->>'consistency' IS DISTINCT FROM 'independent_reads'
  OR facility->>'historicalKnowledge' IS DISTINCT FROM 'not_established'
  OR identity->>'companyId' IS DISTINCT FROM p_business->>'companyId'
  OR identity->>'environment' IS DISTINCT FROM p_business->>'environment'
  OR jsonb_typeof(identity->'representedByTransportAgent') IS DISTINCT FROM 'boolean'
  OR jsonb_typeof(identity->'roleCodes') IS DISTINCT FROM 'array'
  OR jsonb_typeof(parties) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
 -- PostgreSQL's timestamp/date types own calendar parsing. Reject infinities,
 -- date-only spellings and excess fractional precision before typed equality.
 FOR stamp IN SELECT value FROM unnest(ARRAY[p_business->>'assessedAt',p_business->>'sourceReceivedAt',
  p_party#>>'{source,receivedAt}',p_party->>'assessedAt',p_party->>'completedAt',evidence->>'evaluatedAt',
  evidence->>'observedAt',evidence->>'completedAt',facility->>'observedAt',facility->>'completedAt']) value LOOP
  IF stamp IS NULL OR stamp !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' THEN RETURN false; END IF;
  instant:=stamp::timestamptz;
  IF NOT isfinite(instant) OR instant<p_received OR instant>statement_timestamp() THEN RETURN false; END IF;
 END LOOP;
 party_start:=(p_party->>'assessedAt')::timestamptz;party_end:=(p_party->>'completedAt')::timestamptz;evaluated:=(evidence->>'evaluatedAt')::timestamptz;
 IF (p_business->>'sourceReceivedAt')::timestamptz<>p_received OR (p_party#>>'{source,receivedAt}')::timestamptz<>p_received
  OR party_end<party_start OR evaluated<>party_start
  OR (evidence->>'observedAt')::timestamptz<evaluated OR (evidence->>'completedAt')::timestamptz<(evidence->>'observedAt')::timestamptz
  OR (evidence->>'completedAt')::timestamptz>party_end
  OR (facility->>'observedAt')::timestamptz<party_start OR (facility->>'completedAt')::timestamptz<(facility->>'observedAt')::timestamptz
  OR (facility->>'completedAt')::timestamptz>party_end THEN RETURN false; END IF;
 FOREACH name IN ARRAY ARRAY['legalSender','legalReceiver','transportSender','transportReceiver'] LOOP
  IF jsonb_typeof(parties->name) IS DISTINCT FROM 'string' OR length(parties->>name) NOT BETWEEN 1 AND 128
   OR parties->>name<>btrim(parties->>name) THEN RETURN false; END IF;
 END LOOP;
 -- Same half-open tenant validity used by resolveCanonicalTenantEdielIdentity.
 IF NOT EXISTS(SELECT FROM jsonb_populate_recordset(NULL::public.tenant_ediel_profiles,records->'profiles') r
  WHERE r.is_enabled AND r.market='electricity' AND r.valid_from<=evaluated AND (r.valid_to IS NULL OR evaluated<r.valid_to)) THEN RETURN false; END IF;
 SELECT count(DISTINCT r.actor_id),count(DISTINCT nullif(btrim(r.identifier_value),'')),min(r.actor_id::text)::uuid,min(nullif(btrim(r.identifier_value),''))
 INTO actor_count,identifier_count,selected_actor_id,legal_id
 FROM jsonb_populate_recordset(NULL::public.tenant_actor_identifiers,records->'identifiers') r
 WHERE r.identifier_type='EdielId' AND r.valid_from<=evaluated AND (r.valid_to IS NULL OR evaluated<r.valid_to);
 IF actor_count<>1 OR identifier_count<>1 OR selected_actor_id::text IS DISTINCT FROM identity->>'legalActorId'
  OR legal_id IS DISTINCT FROM identity->>'legalEdielId' OR legal_id IS DISTINCT FROM parties->>'legalReceiver' THEN RETURN false; END IF;
 SELECT array_agg(DISTINCT btrim(r.role_code) ORDER BY btrim(r.role_code)) INTO role_values
 FROM jsonb_populate_recordset(NULL::public.tenant_actor_roles,records->'roles') r
 WHERE r.actor_id=selected_actor_id AND nullif(btrim(r.role_code),'') IS NOT NULL AND r.valid_from<=evaluated AND (r.valid_to IS NULL OR evaluated<r.valid_to);
 IF EXISTS(SELECT FROM jsonb_array_elements(identity->'roleCodes') r WHERE jsonb_typeof(r)<>'string') THEN RETURN false; END IF;
 SELECT array_agg(DISTINCT value ORDER BY value) INTO supplied_roles FROM jsonb_array_elements_text(identity->'roleCodes');
 IF role_values IS DISTINCT FROM supplied_roles OR NOT coalesce('electricity_supplier'=ANY(role_values),false) THEN RETURN false; END IF;
 SELECT count(*),min(r.id::text)::uuid,min(r.counterparty_actor_id::text)::uuid INTO relation_count,relation_id,transport_actor
 FROM jsonb_populate_recordset(NULL::public.tenant_counterparty_relations,records->'relations') r
 WHERE r.relation_type='ediel_transport_agent' AND r.is_enabled AND r.valid_from<=evaluated AND (r.valid_to IS NULL OR evaluated<r.valid_to);
 IF relation_count=0 THEN
  IF identity->'representedByTransportAgent'<>'false'::jsonb OR identity->'transportRelationId' IS DISTINCT FROM 'null'::jsonb
   OR identity->>'transportActorId' IS DISTINCT FROM selected_actor_id::text OR identity->>'transportEdielId' IS DISTINCT FROM legal_id
   OR records->'transportIdentifiers' IS DISTINCT FROM '[]'::jsonb THEN RETURN false; END IF;
 ELSE
  IF relation_count<>1 OR identity->'representedByTransportAgent'<>'true'::jsonb
   OR identity->>'transportRelationId' IS DISTINCT FROM relation_id::text OR identity->>'transportActorId' IS DISTINCT FROM transport_actor::text
   OR transport_actor=selected_actor_id THEN RETURN false; END IF;
  IF EXISTS(SELECT FROM jsonb_populate_recordset(NULL::public.platform_actor_identifiers,records->'transportIdentifiers') r WHERE r.is_verified IS DISTINCT FROM true) THEN RETURN false; END IF;
  SELECT count(DISTINCT nullif(btrim(r.identifier_value),'')),min(nullif(btrim(r.identifier_value),'')) INTO identifier_count,transport_id
  FROM jsonb_populate_recordset(NULL::public.platform_actor_identifiers,records->'transportIdentifiers') r
  WHERE r.actor_id=transport_actor AND r.identifier_type='EdielId'
   AND (r.valid_from IS NULL OR r.valid_from::timestamp AT TIME ZONE 'UTC'<=evaluated)
   AND (r.valid_to IS NULL OR evaluated<r.valid_to::timestamp AT TIME ZONE 'UTC');
  IF identifier_count<>1 OR transport_id=legal_id OR transport_id IS DISTINCT FROM identity->>'transportEdielId' THEN RETURN false; END IF;
 END IF;
 IF parties->>'transportReceiver' IS DISTINCT FROM identity->>'transportEdielId'
  OR parties->>'transportSender' IS DISTINCT FROM parties->>'legalSender'
  OR parties->>'legalSender' IS DISTINCT FROM facility#>>'{gridOwner,ediel_id}'
  OR facility#>'{gridOwner,is_active}' IS DISTINCT FROM 'true'::jsonb OR facility#>>'{gridOwner,lifecycle_status}' IS DISTINCT FROM 'active'
  OR facility#>>'{gridOwner,environment}' IS DISTINCT FROM p_business->>'environment'
  OR (p_business->>'environment'='production' AND facility#>>'{gridOwner,ediel_id}' IN ('91100','91109'))
  OR facility#>>'{meteringPoint,meter_point_id}' IS DISTINCT FROM p_business#>>'{object,objectId}'
  OR facility#>>'{site,facility_id}' IS DISTINCT FROM p_business#>>'{object,objectId}'
  OR facility#>>'{meteringPoint,site_id}' IS DISTINCT FROM facility#>>'{site,id}'
  OR (facility#>'{meteringPoint,customer_site_id}'<>'null'::jsonb AND facility#>>'{meteringPoint,customer_site_id}' IS DISTINCT FROM facility#>>'{site,id}')
  OR facility#>>'{meteringPoint,grid_owner_id}' IS DISTINCT FROM facility#>>'{gridOwner,id}'
  OR facility#>>'{site,grid_owner_id}' IS DISTINCT FROM facility#>>'{gridOwner,id}' THEN RETURN false; END IF;
 RETURN true;
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range OR invalid_parameter_value THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.review_party_proof_consistent(jsonb,jsonb,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_received_sources.review_business_proof_consistent(p_party jsonb,p_business jsonb,p_source_id uuid)
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
REVOKE ALL ON FUNCTION gridex_received_sources.review_business_proof_consistent(jsonb,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION gridex_received_sources.append_object_assessment(p_company_id uuid,p_environment text,p_source_message_id uuid,p_source_payload_hash text,p_canonical_assessment_id uuid,p_facts_text text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE src gridex_received_sources.sources%rowtype; canonical gridex_received_sources.validation_assessments%rowtype;
 facts jsonb; original jsonb; entry jsonb; scope jsonb; register_fact jsonb; business jsonb; party jsonb; records jsonb;
 position integer:=0; prior uuid; result_id uuid; digest text; snapshot_text text; valid_owners boolean; owner_readsets jsonb:='[]'::jsonb;
BEGIN
 SELECT * INTO src FROM gridex_received_sources.sources WHERE source_message_id=p_source_message_id AND company_id=p_company_id AND environment=p_environment FOR UPDATE;
 IF NOT FOUND OR src.payload_hash IS DISTINCT FROM p_source_payload_hash OR src.received_context IS NULL OR p_facts_text IS NULL OR octet_length(p_facts_text)>262144 THEN RAISE EXCEPTION 'source_object_scope_unavailable' USING ERRCODE='23514'; END IF;
 SELECT * INTO canonical FROM gridex_received_sources.validation_assessments WHERE id=p_canonical_assessment_id AND source_message_id=src.source_message_id AND company_id=p_company_id AND environment=p_environment AND source_payload_hash=src.payload_hash;
 IF NOT FOUND THEN RAISE EXCEPTION 'source_object_canonical_unavailable' USING ERRCODE='23514'; END IF;
 facts:=p_facts_text::jsonb; original:=canonical.facts_text::jsonb;
 IF jsonb_typeof(facts) IS DISTINCT FROM 'object' OR NOT facts ?& ARRAY['version','owner','ruleVersion','canonicalFactsHash','objects']
 OR facts-ARRAY['version','owner','ruleVersion','canonicalFactsHash','objects']<>'{}'::jsonb
 OR facts->'version' IS DISTINCT FROM '1'::jsonb OR facts->>'owner' IS DISTINCT FROM 'received-source-object-decisions-v1'
 OR facts->>'ruleVersion' IS DISTINCT FROM '1' OR facts->>'canonicalFactsHash' IS DISTINCT FROM canonical.facts_hash
 OR jsonb_typeof(facts->'objects') IS DISTINCT FROM 'array' OR jsonb_typeof(original#>'{registerValidation,objects}') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'source_object_facts_invalid' USING ERRCODE='23514'; END IF;
 IF jsonb_array_length(facts->'objects')<>jsonb_array_length(original#>'{registerValidation,objects}') OR jsonb_array_length(facts->'objects') NOT BETWEEN 1 AND 8192 THEN RAISE EXCEPTION 'source_object_membership_incomplete' USING ERRCODE='23514'; END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(facts->'objects') LOOP
  register_fact:=original#>ARRAY['registerValidation','objects',position::text];position:=position+1;
  scope:=entry->'object';business:=entry->'business';party:=entry->'party';
  IF jsonb_typeof(entry) IS DISTINCT FROM 'object' OR NOT entry ?& ARRAY['object','disposition','reasons','business','party']
   OR entry-ARRAY['object','disposition','reasons','business','party']<>'{}'::jsonb OR scope IS DISTINCT FROM register_fact-ARRAY['disposition','reasons']
   OR coalesce(entry->>'disposition','') NOT IN ('accepted','rejected','unavailable') OR jsonb_typeof(entry->'reasons') IS DISTINCT FROM 'array'
   THEN RAISE EXCEPTION 'source_object_decision_invalid' USING ERRCODE='23514';END IF;
  IF (entry->>'disposition'='accepted') IS DISTINCT FROM (jsonb_array_length(entry->'reasons')=0)
   OR jsonb_array_length(entry->'reasons')>128 OR EXISTS(SELECT FROM jsonb_array_elements(entry->'reasons') r WHERE jsonb_typeof(r) IS DISTINCT FROM 'string' OR r#>>'{}' !~ '^[A-Za-z0-9_.:-]{1,128}$') THEN RAISE EXCEPTION 'source_object_reason_invalid' USING ERRCODE='23514'; END IF;
  IF business<>'null'::jsonb AND (jsonb_typeof(business) IS DISTINCT FROM 'object' OR business->>'sourceMessageId' IS DISTINCT FROM src.source_message_id::text OR business->>'sourcePayloadHash' IS DISTINCT FROM src.payload_hash OR business->>'companyId' IS DISTINCT FROM p_company_id::text OR business->>'environment' IS DISTINCT FROM p_environment OR business->'object' IS DISTINCT FROM scope) THEN RAISE EXCEPTION 'source_object_business_scope_invalid' USING ERRCODE='23514'; END IF;
  IF party<>'null'::jsonb AND (jsonb_typeof(party) IS DISTINCT FROM 'object' OR party#>>'{source,sourceMessageId}' IS DISTINCT FROM src.source_message_id::text OR party#>>'{source,sourcePayloadHash}' IS DISTINCT FROM src.payload_hash OR party#>>'{source,companyId}' IS DISTINCT FROM p_company_id::text OR party#>>'{source,environment}' IS DISTINCT FROM p_environment OR party->'object' IS DISTINCT FROM scope) THEN RAISE EXCEPTION 'source_object_party_scope_invalid' USING ERRCODE='23514'; END IF;
  IF entry->>'disposition'='accepted' THEN
   IF register_fact->>'disposition' IS DISTINCT FROM 'accepted' OR original->>'syntaxDecision' IS DISTINCT FROM 'accepted' OR original->>'applicationDecision' IS DISTINCT FROM 'accepted' OR original->>'functionalDecision' IS DISTINCT FROM 'accepted'
    OR (CASE business->>'owner' WHEN 'inbound-z04-switch-confirmation-v1' THEN business->>'businessDisposition'='committed' WHEN 'reviewed-received-structure-v1' THEN business->>'businessDisposition'='reviewed' ELSE false END) IS DISTINCT FROM true
    OR business->'version' IS DISTINCT FROM '1'::jsonb OR party->'version' IS DISTINCT FROM '1'::jsonb
    OR party->>'owner' IS DISTINCT FROM 'received-source-party-binding-v1' OR party->>'ruleVersion' IS DISTINCT FROM '1' OR party->>'disposition' IS DISTINCT FROM 'accepted'
    OR party->'reasons' IS DISTINCT FROM '[]'::jsonb OR party#>>'{receiver,evidence,completeness}' IS DISTINCT FROM 'exact_count'
    OR scope->>'identityAgency' IS DISTINCT FROM '9' OR party#>>'{facility,meteringPoint,id}' IS DISTINCT FROM business->>'meteringPointId'
    OR party#>>'{facility,site,id}' IS DISTINCT FROM business->>'siteId' THEN RAISE EXCEPTION 'source_object_acceptance_unproven' USING ERRCODE='23514'; END IF;
   records:=party#>'{receiver,evidence,records}';
   -- All owner revalidation calls below share this SELECT's snapshot, rather
   -- than treating independent earlier network reads as an atomic observation.
   SELECT pg_current_snapshot()::text,
    (CASE business->>'owner' WHEN 'inbound-z04-switch-confirmation-v1' THEN gridex_received_sources.object_owner_proof_consistent(party,business,src.source_received_at) ELSE gridex_received_sources.review_business_proof_consistent(party,business,src.source_message_id) END)
    AND gridex_received_sources.owner_rows_match('profiles',records->'profiles',p_company_id,p_environment,NULL)
    AND gridex_received_sources.owner_rows_match('identifiers',records->'identifiers',p_company_id,p_environment,NULL)
    AND gridex_received_sources.owner_rows_match('roles',records->'roles',p_company_id,p_environment,(party#>>'{receiver,identity,legalActorId}')::uuid)
    AND gridex_received_sources.owner_rows_match('relations',records->'relations',p_company_id,p_environment,NULL)
    AND (CASE WHEN party#>>'{receiver,identity,representedByTransportAgent}'='true' THEN gridex_received_sources.owner_rows_match('transportIdentifiers',records->'transportIdentifiers',p_company_id,p_environment,(party#>>'{receiver,identity,transportActorId}')::uuid) ELSE records->'transportIdentifiers'='[]'::jsonb END)
    AND gridex_received_sources.owner_rows_match('point',jsonb_build_array(party#>'{facility,meteringPoint}'),p_company_id,p_environment,(business->>'meteringPointId')::uuid)
    AND gridex_received_sources.owner_rows_match('site',jsonb_build_array(party#>'{facility,site}'),p_company_id,p_environment,(business->>'siteId')::uuid)
    AND gridex_received_sources.owner_rows_match('gridOwner',jsonb_build_array(party#>'{facility,gridOwner}'),p_company_id,p_environment,(party#>>'{facility,gridOwner,id}')::uuid)
    AND (business->>'owner'='reviewed-received-structure-v1' OR EXISTS(SELECT FROM public.supplier_switch_requests sw JOIN public.customer_supply_periods sp ON sp.id=(business->>'supplyPeriodId')::uuid
      WHERE sw.id=(business->>'switchRequestId')::uuid AND sw.company_id=p_company_id AND sp.company_id=p_company_id
      AND sw.inbound_z04_message_id=src.source_message_id AND sp.source_message_id=src.source_message_id
      AND sw.metering_point_id=(business->>'meteringPointId')::uuid AND sp.metering_point_id=sw.metering_point_id
      AND sw.site_id=(business->>'siteId')::uuid AND sw.customer_id=(business->>'customerId')::uuid AND sp.customer_id=sw.customer_id
      AND sw.status='accepted' AND sp.status='confirmed_by_grid_owner'
      AND EXISTS(SELECT FROM public.metering_points mp JOIN public.customer_sites cs ON cs.id=mp.site_id WHERE mp.id=sw.metering_point_id AND mp.company_id=p_company_id AND cs.company_id=p_company_id AND mp.customer_id=sw.customer_id AND cs.customer_id=sw.customer_id AND cs.id=sw.site_id)
      AND sw.confirmed_start_date::text=business#>>'{committedRecords,switch,confirmedStartDate}' AND sp.start_date::text=business#>>'{committedRecords,supply,startDate}'))
   INTO snapshot_text,valid_owners;
   IF valid_owners IS DISTINCT FROM true THEN RAISE EXCEPTION 'source_object_owner_snapshot_changed' USING ERRCODE='23514'; END IF;
   owner_readsets:=owner_readsets||jsonb_build_array(jsonb_build_object('object',scope,'snapshot',snapshot_text,'observedAt',clock_timestamp()));
  END IF;
 END LOOP;
 SELECT id INTO prior FROM gridex_received_sources.object_assessments a WHERE source_message_id=src.source_message_id AND NOT EXISTS(SELECT FROM gridex_received_sources.object_assessments child WHERE child.previous_assessment_id=a.id);
 digest:=encode(sha256(convert_to(p_facts_text,'UTF8')),'hex');
 INSERT INTO gridex_received_sources.object_assessments(source_message_id,company_id,environment,source_payload_hash,canonical_assessment_id,previous_assessment_id,facts_text,facts_hash,owner_readsets)
 VALUES(src.source_message_id,p_company_id,p_environment,src.payload_hash,canonical.id,prior,p_facts_text,digest,owner_readsets) RETURNING id INTO result_id;
 RETURN jsonb_build_object('version',1,'assessmentId',result_id,'companyId',p_company_id,'environment',p_environment,'sourceMessageId',src.source_message_id,'sourcePayloadHash',src.payload_hash,'canonicalAssessmentId',canonical.id,'factsHash',digest);
END $$;

-- An internal evidence gap is neither national rejection nor acceptance.
ALTER TABLE public.ediel_ack_transaction_results DROP CONSTRAINT ediel_ack_transaction_results_disposition_check;
ALTER TABLE public.ediel_ack_transaction_results ADD CONSTRAINT ediel_ack_transaction_results_disposition_check
 CHECK(disposition IS NULL OR disposition IN ('accepted','syntax_rejected','guide_rejected','processability_rejected','internal_review'));
ALTER TABLE public.ediel_ack_transaction_results DROP CONSTRAINT ediel_ack_transaction_results_planned_response_check;
ALTER TABLE public.ediel_ack_transaction_results ADD CONSTRAINT ediel_ack_transaction_results_planned_response_check
 CHECK(planned_response_type IS NULL OR planned_response_type IN ('positive_aperak','negative_contrl','negative_aperak','utilts_err','none'));
ALTER TABLE public.ediel_ack_transaction_results ADD CONSTRAINT ediel_ack_transaction_results_internal_review_response_check
 CHECK(coalesce(disposition='internal_review',false)=coalesce(planned_response_type='none',false));

create or replace function public.gridex_persist_utilts_transactions_v1(
  p_company_id uuid,
  p_environment text,
  p_source_message_id uuid,
  p_message_code text,
  p_transactions jsonb
) returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare
  v_source public.ediel_messages%rowtype;
  v_item jsonb;
  v_transaction_id text;
  v_disposition text;
  v_response_type text;
  v_dedupe_key text;
  v_series_identity text;
  v_series_id uuid;
  v_previous_id uuid;
  v_version integer;
  v_inserted boolean;
  v_quantity jsonb;
  v_order integer;
  v_results jsonb := '[]'::jsonb;
  v_error text;
begin
  if p_environment not in ('test','production') then raise exception 'utilts_environment_invalid'; end if;
  if jsonb_typeof(p_transactions) <> 'array' then raise exception 'utilts_transactions_must_be_array'; end if;

  select * into v_source from public.ediel_messages where id=p_source_message_id for share;
  if not found or v_source.message_family <> 'UTILTS' then raise exception 'utilts_source_message_missing'; end if;
  if v_source.company_id is distinct from p_company_id or v_source.environment is distinct from p_environment then
    raise exception 'utilts_source_tenant_or_environment_mismatch' using errcode='23514';
  end if;

  for v_item in select value from jsonb_array_elements(p_transactions)
  loop
    v_transaction_id := nullif(btrim(v_item->>'transactionId'),'');
    v_disposition := coalesce(nullif(v_item->>'disposition',''),'processability_rejected');
    v_response_type := coalesce(nullif(v_item->>'responseType',''),'utilts_err');
    if v_transaction_id is null then v_transaction_id := 'transaction-' || (jsonb_array_length(v_results)+1)::text; end if;

    insert into public.ediel_ack_transaction_results(
      company_id,environment,source_message_id,source_transaction_id,
      syntax_result,guide_validation_result,processability_result,
      disposition,planned_response_type,issue_codes,persistence_status,updated_at
    ) values (
      p_company_id,p_environment,p_source_message_id,v_transaction_id,
      case when v_disposition='syntax_rejected' then 'negative' else 'positive' end,
      case when v_disposition='guide_rejected' then 'negative' when v_disposition='syntax_rejected' then 'pending' else 'positive' end,
      case when v_disposition='processability_rejected' then 'negative' when v_disposition='accepted' then 'positive' when v_disposition='internal_review' then 'pending' else 'not_applicable' end,
      v_disposition,v_response_type,
      coalesce(array(select jsonb_array_elements_text(coalesce(v_item->'issueCodes','[]'::jsonb))),array[]::text[]),
      case when v_disposition='accepted' then 'pending' else 'not_applicable' end,now()
    ) on conflict(company_id,environment,source_message_id,source_transaction_id)
    do update set
      syntax_result=excluded.syntax_result,
      guide_validation_result=excluded.guide_validation_result,
      processability_result=excluded.processability_result,
      disposition=excluded.disposition,
      planned_response_type=excluded.planned_response_type,
      issue_codes=excluded.issue_codes,
      persistence_status=excluded.persistence_status,
      persisted_series_id=null,
      persistence_error=null,
      updated_at=now();

    if v_disposition <> 'accepted' then
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'transactionId',v_transaction_id,'disposition',v_disposition,
        'responseType',v_response_type,'persistenceStatus','not_applicable'
      ));
      continue;
    end if;

    begin
      v_series_identity := concat_ws('|',p_company_id::text,coalesce(v_item->>'seriesKind','actual'),
        p_message_code,coalesce(v_item->>'externalMeteringPointId',''),coalesce(v_item->>'gridAreaId',''),
        coalesce(v_item->>'periodStart',''),coalesce(v_item->>'periodEnd',''),
        coalesce(v_item->>'resolution','UNKNOWN'),coalesce(v_item->>'productId',''));
      perform pg_advisory_xact_lock(hashtextextended(v_series_identity,0));
      v_dedupe_key := encode(digest(convert_to(v_series_identity || '|' || v_transaction_id,'UTF8'),'sha256'),'hex');
      v_previous_id := null;
      v_version := 1;
      select id,version_no into v_previous_id,v_version
      from public.meter_reading_series
      where company_id=p_company_id and is_current
        and series_kind=coalesce(v_item->>'seriesKind','actual')
        and coalesce(message_code,'')=coalesce(p_message_code,'')
        and coalesce(external_metering_point_id,'')=coalesce(v_item->>'externalMeteringPointId','')
        and coalesce(grid_area_id,'')=coalesce(v_item->>'gridAreaId','')
        and period_start is not distinct from nullif(v_item->>'periodStart','')::timestamptz
        and period_end is not distinct from nullif(v_item->>'periodEnd','')::timestamptz
        and resolution=coalesce(v_item->>'resolution','UNKNOWN')
        and coalesce(product_id,'')=coalesce(v_item->>'productId','')
        and dedupe_key<>v_dedupe_key
      order by version_no desc limit 1 for update;
      if v_previous_id is not null then v_version := v_version + 1; end if;

      insert into public.meter_reading_series(
        company_id,metering_point_id,source_ediel_message_id,external_metering_point_id,
        grid_area_id,period_start,period_end,resolution,unit,quality_status,dedupe_key,
        message_code,source_transaction_reference,series_kind,product_id,time_series_product,
        actor_context,registration_date,latest_update_date,version_no,supersedes_series_id,
        is_current,correction_reason,raw_transaction,immutable_hash
      ) values (
        p_company_id,nullif(v_item->>'meteringPointId','')::uuid,p_source_message_id,
        nullif(v_item->>'externalMeteringPointId',''),nullif(v_item->>'gridAreaId',''),
        nullif(v_item->>'periodStart','')::timestamptz,nullif(v_item->>'periodEnd','')::timestamptz,
        coalesce(nullif(v_item->>'resolution',''),'UNKNOWN'),coalesce(nullif(v_item->>'unit',''),'KWH'),
        'received',v_dedupe_key,p_message_code,v_transaction_id,coalesce(v_item->>'seriesKind','actual'),
        nullif(v_item->>'productId',''),v_item->'timeSeriesProduct',coalesce(v_item->'actorContext','{}'::jsonb),
        nullif(v_item->>'registrationDate','')::timestamptz,nullif(v_item->>'latestUpdateDate','')::timestamptz,
        v_version,v_previous_id,true,nullif(v_item->>'correctionReason',''),v_item,
        encode(digest(convert_to(v_item::text,'UTF8'),'sha256'),'hex')
      ) on conflict(company_id,dedupe_key) do nothing returning id into v_series_id;
      v_inserted := v_series_id is not null;
      if not v_inserted then
        select id into v_series_id from public.meter_reading_series
        where company_id=p_company_id and dedupe_key=v_dedupe_key;
      else
        if v_previous_id is not null then
          update public.meter_reading_series set is_current=false where id=v_previous_id;
        end if;
        v_order := 0;
        for v_quantity in select value from jsonb_array_elements(coalesce(v_item->'quantities','[]'::jsonb))
        loop
          v_order := v_order + 1;
          insert into public.meter_reading_values(
            company_id,series_id,reading_at,quantity,unit,quality,source_order,
            observation_id,qualifier,raw_value,metadata
          ) values (
            p_company_id,v_series_id,nullif(v_quantity->>'readingAt','')::timestamptz,
            nullif(v_quantity->>'value','')::numeric,coalesce(nullif(v_item->>'unit',''),'KWH'),
            coalesce(nullif(v_quantity->>'quality',''),'unknown'),v_order,
            coalesce(nullif(v_quantity->>'observationId',''),v_order::text),
            nullif(v_quantity->>'qualifier',''),v_quantity->>'raw',coalesce(v_quantity->'metadata','{}'::jsonb)
          );
        end loop;
      end if;

      update public.ediel_ack_transaction_results set
        persistence_status='persisted',persisted_series_id=v_series_id,persistence_error=null,updated_at=now()
      where company_id=p_company_id and environment=p_environment
        and source_message_id=p_source_message_id and source_transaction_id=v_transaction_id;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'transactionId',v_transaction_id,'disposition','accepted','responseType','positive_aperak',
        'persistenceStatus','persisted','seriesId',v_series_id,'idempotentReplay',not v_inserted
      ));
    exception when others then
      get stacked diagnostics v_error = message_text;
      update public.ediel_ack_transaction_results set
        disposition='processability_rejected',planned_response_type='utilts_err',
        processability_result='negative',persistence_status='failed',persistence_error=left(v_error,500),
        issue_codes=array_append(issue_codes,'UTILTS_PERSISTENCE_FAILED'),updated_at=now()
      where company_id=p_company_id and environment=p_environment
        and source_message_id=p_source_message_id and source_transaction_id=v_transaction_id;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'transactionId',v_transaction_id,'disposition','processability_rejected','responseType','utilts_err',
        'persistenceStatus','failed','issueCodes',jsonb_build_array('UTILTS_PERSISTENCE_FAILED')
      ));
    end;
  end loop;
  return v_results;
end $$;

revoke all on function public.gridex_persist_utilts_transactions_v1(uuid,text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.gridex_persist_utilts_transactions_v1(uuid,text,uuid,text,jsonb) to service_role;


COMMIT;
