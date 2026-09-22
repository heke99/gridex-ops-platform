-- Created by Supabase CLI 2.101.0 in isolated run35742590285; forward only.
BEGIN;
CREATE TABLE gridex_received_sources.object_assessments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 source_message_id uuid NOT NULL REFERENCES gridex_received_sources.sources(source_message_id) ON DELETE RESTRICT,
 company_id uuid NOT NULL, environment text NOT NULL CHECK(environment IN ('test','production')),
 source_payload_hash text NOT NULL,
 canonical_assessment_id uuid NOT NULL REFERENCES gridex_received_sources.validation_assessments(id) ON DELETE RESTRICT,
 previous_assessment_id uuid REFERENCES gridex_received_sources.object_assessments(id) ON DELETE RESTRICT,
 facts_text text NOT NULL CHECK(octet_length(facts_text)<=262144),
 facts_hash text NOT NULL CHECK(facts_hash=encode(sha256(convert_to(facts_text,'UTF8')),'hex')),
 owner_readsets jsonb NOT NULL CHECK(jsonb_typeof(owner_readsets)='array'),
 created_xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
 assessed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX source_object_assessment_first ON gridex_received_sources.object_assessments(source_message_id) WHERE previous_assessment_id IS NULL;
CREATE UNIQUE INDEX source_object_assessment_previous ON gridex_received_sources.object_assessments(previous_assessment_id) WHERE previous_assessment_id IS NOT NULL;
CREATE INDEX source_object_assessment_scope ON gridex_received_sources.object_assessments(company_id,environment,assessed_at,id);
ALTER TABLE gridex_received_sources.object_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_received_sources.object_assessments FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_received_sources.object_assessments FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER source_object_assessment_no_mutation BEFORE UPDATE OR DELETE ON gridex_received_sources.object_assessments FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER source_object_assessment_no_truncate BEFORE TRUNCATE ON gridex_received_sources.object_assessments FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();

-- Compare the exact owner read inputs to one calling-statement MVCC snapshot.
-- Table/columns/predicates are a closed internal allowlist, never caller SQL.
-- Typed record population normalizes DATE/TIMESTAMPTZ spelling before equality.
CREATE FUNCTION gridex_received_sources.owner_rows_match(p_kind text,p_rows jsonb,p_company uuid,p_environment text,p_actor uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE relation_name text; columns_text text; predicate_text text; matches boolean;
BEGIN
 IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows)>8192 THEN RETURN false; END IF;
 CASE p_kind
 WHEN 'profiles' THEN relation_name:='tenant_ediel_profiles'; columns_text:='id,company_id,environment,market,is_enabled,valid_from,valid_to'; predicate_text:='company_id=$2 AND environment=$3 AND market=''electricity'' AND is_enabled';
 WHEN 'identifiers' THEN relation_name:='tenant_actor_identifiers'; columns_text:='id,company_id,environment,actor_id,identifier_type,identifier_value,qualifier,subaddress,valid_from,valid_to'; predicate_text:='company_id=$2 AND environment=$3 AND identifier_type=''EdielId''';
 WHEN 'roles' THEN relation_name:='tenant_actor_roles'; columns_text:='id,company_id,environment,actor_id,role_code,valid_from,valid_to'; predicate_text:='company_id=$2 AND environment=$3 AND actor_id=$4';
 WHEN 'relations' THEN relation_name:='tenant_counterparty_relations'; columns_text:='id,company_id,environment,counterparty_actor_id,relation_type,is_enabled,valid_from,valid_to'; predicate_text:='company_id=$2 AND environment=$3 AND relation_type=''ediel_transport_agent'' AND is_enabled';
 WHEN 'transportIdentifiers' THEN relation_name:='platform_actor_identifiers'; columns_text:='id,actor_id,identifier_type,identifier_value,id_code_qualifier,id_code_responsible,source,is_verified,valid_from,valid_to,created_at,updated_at'; predicate_text:='actor_id=$4 AND identifier_type=''EdielId''';
 WHEN 'point' THEN relation_name:='metering_points'; columns_text:='id,company_id,meter_point_id,site_id,customer_site_id,grid_owner_id'; predicate_text:='company_id=$2 AND id=$4';
 WHEN 'site' THEN relation_name:='customer_sites'; columns_text:='id,company_id,facility_id,grid_owner_id'; predicate_text:='company_id=$2 AND id=$4';
 WHEN 'gridOwner' THEN relation_name:='grid_owners'; columns_text:='id,name,ediel_id,is_active,lifecycle_status,default_prodat_subaddress,default_utilts_subaddress,communication_email,email,environment'; predicate_text:='id=$4';
 ELSE RETURN false;
 END CASE;
 EXECUTE format('SELECT NOT EXISTS((SELECT %1$s FROM public.%2$I WHERE %3$s EXCEPT ALL SELECT %1$s FROM jsonb_populate_recordset(NULL::public.%2$I,$1)) UNION ALL (SELECT %1$s FROM jsonb_populate_recordset(NULL::public.%2$I,$1) EXCEPT ALL SELECT %1$s FROM public.%2$I WHERE %3$s))',columns_text,relation_name,predicate_text)
 INTO matches USING p_rows,p_company,p_environment,p_actor;
 RETURN matches;
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.owner_rows_match(text,jsonb,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Validate the existing live-owner output's internal identity/temporal semantics.
-- This does not parse EDIFACT or manufacture an owner decision. The surrounding
-- calling statement separately compares every input set with current real rows.
CREATE FUNCTION gridex_received_sources.object_owner_proof_consistent(p_party jsonb,p_business jsonb,p_received timestamptz)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE identity jsonb:=p_party#>'{receiver,identity}'; evidence jsonb:=p_party#>'{receiver,evidence}';
 records jsonb:=evidence->'records'; facility jsonb:=p_party->'facility'; parties jsonb:=p_party->'parties';
 effective jsonb:=p_business->'effectiveFrom'; commit_row jsonb; name text; stamp text; instant timestamptz;
 party_start timestamptz; party_end timestamptz; evaluated timestamptz; role_values text[]; supplied_roles text[];
 actor_count bigint; identifier_count bigint; selected_actor_id uuid; legal_id text; relation_count bigint;
 relation_id uuid; transport_actor uuid; transport_id text; minute text; market_time timestamp; expected_day text;
BEGIN
 IF p_received IS NULL OR NOT isfinite(p_received)
  OR p_business->>'coverage' IS DISTINCT FROM 'committed_switch_and_supply_only'
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
 IF jsonb_typeof(effective) IS DISTINCT FROM 'object' OR effective->>'fieldNumber' IS DISTINCT FROM '210'
  OR effective->>'committedDatePrecision' IS DISTINCT FROM 'market_calendar_day'
  OR effective-ARRAY['fieldNumber','marketMinute','utc','committedDatePrecision']<>'{}'::jsonb THEN RETURN false; END IF;
 minute:=effective->>'marketMinute';
 IF minute IS NULL OR minute !~ '^[0-9]{12}$' OR substring(minute,1,4)::int<1 OR substring(minute,9,2)::int>23 OR substring(minute,11,2)::int>59 THEN RETURN false; END IF;
 market_time:=make_timestamp(substring(minute,1,4)::int,substring(minute,5,2)::int,substring(minute,7,2)::int,substring(minute,9,2)::int,substring(minute,11,2)::int,0);
 IF effective->>'utc' IS NULL OR (effective->>'utc')::timestamptz IS DISTINCT FROM (market_time AT TIME ZONE 'Etc/GMT-1') THEN RETURN false; END IF;
 expected_day:=to_char(market_time,'YYYY-MM-DD');
 FOREACH name IN ARRAY ARRAY['switch','supply'] LOOP
  commit_row:=p_business#>ARRAY['committedRecords',name];
  IF jsonb_typeof(commit_row) IS DISTINCT FROM 'object'
   OR commit_row->>'id' IS DISTINCT FROM p_business->>(CASE WHEN name='switch' THEN 'switchRequestId' ELSE 'supplyPeriodId' END)
   OR commit_row->>'companyId' IS DISTINCT FROM p_business->>'companyId'
   OR commit_row->>'customerId' IS DISTINCT FROM p_business->>'customerId'
   OR commit_row->>'meteringPointId' IS DISTINCT FROM p_business->>'meteringPointId'
   OR commit_row->>'sourceMessageId' IS DISTINCT FROM p_business->>'sourceMessageId'
   OR commit_row->>'status' IS DISTINCT FROM CASE WHEN name='switch' THEN 'accepted' ELSE 'confirmed_by_grid_owner' END
   OR commit_row->>(CASE WHEN name='switch' THEN 'confirmedStartDate' ELSE 'startDate' END) IS DISTINCT FROM expected_day
   OR (name='switch' AND commit_row->>'siteId' IS DISTINCT FROM p_business->>'siteId') THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range OR invalid_parameter_value THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.object_owner_proof_consistent(jsonb,jsonb,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_received_sources.append_object_assessment(p_company_id uuid,p_environment text,p_source_message_id uuid,p_source_payload_hash text,p_canonical_assessment_id uuid,p_facts_text text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
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
    OR business->>'owner' IS DISTINCT FROM 'inbound-z04-switch-confirmation-v1' OR business->>'businessDisposition' IS DISTINCT FROM 'committed'
    OR business->'version' IS DISTINCT FROM '1'::jsonb OR party->'version' IS DISTINCT FROM '1'::jsonb
    OR party->>'owner' IS DISTINCT FROM 'received-source-party-binding-v1' OR party->>'ruleVersion' IS DISTINCT FROM '1' OR party->>'disposition' IS DISTINCT FROM 'accepted'
    OR party->'reasons' IS DISTINCT FROM '[]'::jsonb OR party#>>'{receiver,evidence,completeness}' IS DISTINCT FROM 'exact_count'
    OR scope->>'identityAgency' IS DISTINCT FROM '9' OR party#>>'{facility,meteringPoint,id}' IS DISTINCT FROM business->>'meteringPointId'
    OR party#>>'{facility,site,id}' IS DISTINCT FROM business->>'siteId' THEN RAISE EXCEPTION 'source_object_acceptance_unproven' USING ERRCODE='23514'; END IF;
   records:=party#>'{receiver,evidence,records}';
   -- All owner revalidation calls below share this SELECT's snapshot, rather
   -- than treating independent earlier network reads as an atomic observation.
   SELECT pg_current_snapshot()::text,
    gridex_received_sources.object_owner_proof_consistent(party,business,src.source_received_at)
    AND gridex_received_sources.owner_rows_match('profiles',records->'profiles',p_company_id,p_environment,NULL)
    AND gridex_received_sources.owner_rows_match('identifiers',records->'identifiers',p_company_id,p_environment,NULL)
    AND gridex_received_sources.owner_rows_match('roles',records->'roles',p_company_id,p_environment,(party#>>'{receiver,identity,legalActorId}')::uuid)
    AND gridex_received_sources.owner_rows_match('relations',records->'relations',p_company_id,p_environment,NULL)
    AND (CASE WHEN party#>>'{receiver,identity,representedByTransportAgent}'='true' THEN gridex_received_sources.owner_rows_match('transportIdentifiers',records->'transportIdentifiers',p_company_id,p_environment,(party#>>'{receiver,identity,transportActorId}')::uuid) ELSE records->'transportIdentifiers'='[]'::jsonb END)
    AND gridex_received_sources.owner_rows_match('point',jsonb_build_array(party#>'{facility,meteringPoint}'),p_company_id,p_environment,(business->>'meteringPointId')::uuid)
    AND gridex_received_sources.owner_rows_match('site',jsonb_build_array(party#>'{facility,site}'),p_company_id,p_environment,(business->>'siteId')::uuid)
    AND gridex_received_sources.owner_rows_match('gridOwner',jsonb_build_array(party#>'{facility,gridOwner}'),p_company_id,p_environment,(party#>>'{facility,gridOwner,id}')::uuid)
    AND EXISTS(SELECT FROM public.supplier_switch_requests sw JOIN public.customer_supply_periods sp ON sp.id=(business->>'supplyPeriodId')::uuid
      WHERE sw.id=(business->>'switchRequestId')::uuid AND sw.company_id=p_company_id AND sp.company_id=p_company_id
      AND sw.inbound_z04_message_id=src.source_message_id AND sp.source_message_id=src.source_message_id
      AND sw.metering_point_id=(business->>'meteringPointId')::uuid AND sp.metering_point_id=sw.metering_point_id
      AND sw.site_id=(business->>'siteId')::uuid AND sw.customer_id=(business->>'customerId')::uuid AND sp.customer_id=sw.customer_id
      AND sw.status='accepted' AND sp.status='confirmed_by_grid_owner'
      AND EXISTS(SELECT FROM public.metering_points mp JOIN public.customer_sites cs ON cs.id=mp.site_id WHERE mp.id=sw.metering_point_id AND mp.company_id=p_company_id AND cs.company_id=p_company_id AND mp.customer_id=sw.customer_id AND cs.customer_id=sw.customer_id AND cs.id=sw.site_id)
      AND sw.confirmed_start_date::text=business#>>'{committedRecords,switch,confirmedStartDate}' AND sp.start_date::text=business#>>'{committedRecords,supply,startDate}')
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
CREATE FUNCTION public.gridex_record_source_object_decisions_v1(p_company_id uuid,p_environment text,p_source_message_id uuid,p_source_payload_hash text,p_canonical_assessment_id uuid,p_facts_text text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$ BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'received_evidence_service_required' USING ERRCODE='42501'; END IF;
 RETURN gridex_received_sources.append_object_assessment(p_company_id,p_environment,p_source_message_id,p_source_payload_hash,p_canonical_assessment_id,p_facts_text);
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.append_object_assessment(uuid,text,uuid,text,uuid,text),public.gridex_record_source_object_decisions_v1(uuid,text,uuid,text,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_received_sources.append_object_assessment(uuid,text,uuid,text,uuid,text),public.gridex_record_source_object_decisions_v1(uuid,text,uuid,text,uuid,text) TO service_role;
COMMENT ON TABLE gridex_received_sources.object_assessments IS 'Immutable exact-object owner compositions. Assessment correction chains are not market-source supersession. Availability for comparison requires a later verified read set; assessed_at alone is not commit visibility.';
COMMIT;
