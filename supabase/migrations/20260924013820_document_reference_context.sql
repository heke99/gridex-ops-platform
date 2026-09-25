-- CLI 2.101.0 forward. Context reference only; no retained PDF or C authority.
BEGIN;
INSERT INTO public.permissions(key,name,description,category)
VALUES('documents.read','Läsa dokument','Kan se uppladdade dokument och dokumentstatus.','Dokument')
ON CONFLICT(key) DO NOTHING;

-- Installation is durable, but cannot establish historical completeness. Every
-- read remains scoped to a real sealed Z05; this epoch does not hold all supplies.
CREATE TABLE gridex_received_sources.document_reference_epoch (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), installed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 history_coverage text NOT NULL DEFAULT 'incomplete' CHECK(history_coverage='incomplete')
);
INSERT INTO gridex_received_sources.document_reference_epoch DEFAULT VALUES;
CREATE TABLE gridex_received_sources.document_reference_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, environment text NOT NULL CHECK(environment IN ('test','production')),
 source_message_id uuid NOT NULL REFERENCES gridex_received_sources.sources(source_message_id) ON DELETE RESTRICT,
 document_id uuid NOT NULL REFERENCES public.customer_contract_documents(id) ON DELETE RESTRICT,
 actor_user_id uuid NOT NULL, predecessor_id uuid REFERENCES gridex_received_sources.document_reference_attempts(id),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(), created_xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
 facts jsonb NOT NULL CHECK(jsonb_typeof(facts)='object' AND octet_length(facts::text)<=262144),
 facts_hash text NOT NULL CHECK(facts_hash=encode(sha256(convert_to(facts::text,'UTF8')),'hex')),
 kind text NOT NULL DEFAULT 'context_document_reference_v1' CHECK(kind='context_document_reference_v1'),
 status text NOT NULL DEFAULT 'unresolved' CHECK(status='unresolved')
);
CREATE INDEX document_reference_attempt_scope ON gridex_received_sources.document_reference_attempts(company_id,environment,source_message_id,recorded_at,id);
CREATE TABLE gridex_received_sources.document_reference_outcomes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), attempt_id uuid NOT NULL UNIQUE REFERENCES gridex_received_sources.document_reference_attempts(id),
 company_id uuid NOT NULL, environment text NOT NULL CHECK(environment IN ('test','production')),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(), created_xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
 status text NOT NULL CHECK(status IN ('verified_at_observation','unavailable')),
 observation jsonb NOT NULL CHECK(jsonb_typeof(observation)='object' AND octet_length(observation::text)<=8192),
 facts_hash text NOT NULL CHECK(facts_hash=encode(sha256(convert_to(observation::text,'UTF8')),'hex'))
);
CREATE TABLE gridex_received_sources.document_reference_witnesses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), outcome_id uuid NOT NULL UNIQUE REFERENCES gridex_received_sources.document_reference_outcomes(id),
 company_id uuid NOT NULL, environment text NOT NULL CHECK(environment IN ('test','production')),
 facts_hash text NOT NULL, observed_at timestamptz NOT NULL DEFAULT clock_timestamp(), visibility_snapshot text NOT NULL
);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['document_reference_epoch','document_reference_attempts','document_reference_outcomes','document_reference_witnesses'] LOOP
 EXECUTE format('ALTER TABLE gridex_received_sources.%I ENABLE ROW LEVEL SECURITY',tab);
 EXECUTE format('ALTER TABLE gridex_received_sources.%I FORCE ROW LEVEL SECURITY',tab);
 EXECUTE format('REVOKE ALL ON gridex_received_sources.%I FROM PUBLIC,anon,authenticated,service_role',tab);
 EXECUTE format('CREATE TRIGGER immutable_update_delete BEFORE UPDATE OR DELETE ON gridex_received_sources.%I FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation()',tab);
 EXECUTE format('CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_received_sources.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation()',tab);
 END LOOP;
END $$;
CREATE FUNCTION gridex_received_sources.document_reference_actor_v1(p_company_id uuid,p_actor_user_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$ BEGIN
 IF p_company_id IS NULL OR p_actor_user_id IS NULL
 OR EXISTS(SELECT FROM unnest(ARRAY['communication.send','documents.read','customers.read']) permission
 WHERE NOT coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,permission),false))
 OR NOT EXISTS(SELECT FROM public.user_profiles WHERE id=p_actor_user_id AND user_status='active')
 OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=p_company_id AND user_id=p_actor_user_id AND is_active AND status='active')
 OR NOT EXISTS(SELECT FROM public.companies WHERE id=p_company_id AND coalesce(is_active,true)
 AND coalesce(status,'active') NOT IN ('archived','suspended','pending_deletion','deleted','deleted_test_only','inactive','paused','closed'))
 THEN RAISE EXCEPTION 'document_reference_unavailable' USING ERRCODE='42501'; END IF;
END $$;

-- Real graph, never source concern's wildcard customer/supply or caller links.
CREATE FUNCTION gridex_received_sources.document_reference_facts_v1(p_company_id uuid,p_environment text,p_source_message_id uuid,p_document_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE src gridex_received_sources.sources%rowtype; doc public.customer_contract_documents%rowtype;
 wire jsonb; graph jsonb; n integer; eligible boolean; locked jsonb;
BEGIN
 SELECT * INTO src FROM gridex_received_sources.sources WHERE source_message_id=p_source_message_id AND company_id=p_company_id AND environment=p_environment;
 SELECT d.* INTO doc FROM public.customer_contract_documents d JOIN public.customer_contracts c ON c.id=d.customer_contract_id AND c.company_id=p_company_id
 WHERE d.id=p_document_id AND d.company_id=p_company_id;
 IF src.source_message_id IS NULL OR doc.id IS NULL OR src.origin<>'database_insert' OR src.message_code IS DISTINCT FROM 'Z05'
 OR src.payload_hash IS DISTINCT FROM encode(sha256(convert_to(src.raw_payload,'UTF8')),'hex')
 THEN RAISE EXCEPTION 'document_reference_unavailable' USING ERRCODE='42501'; END IF;
 wire:=gridex_received_sources.correction_wire_observation_v1(src.raw_payload);
 locked:=jsonb_build_object('id',doc.id,'company_id',doc.company_id,'customer_contract_id',doc.customer_contract_id,
 'document_type',doc.document_type,'storage_bucket',doc.storage_bucket,'storage_path',doc.storage_path,'mime_type',doc.mime_type,
 'document_sha256',doc.document_sha256,'generation_snapshot',doc.generation_snapshot);
 SELECT count(*),(jsonb_agg(jsonb_build_object('customerId',c.customer_id,'contractId',c.id,'siteId',s.id,'pointId',m.id,'supplyPeriodId',sp.id,
 'objectId',wire->>'objectId','identityAgency',wire->>'identityAgency','legalSender',wire->>'legalSender','legalReceiver',wire->>'legalReceiver')))->0 INTO n,graph
 FROM public.customer_contracts c
 JOIN public.customers customer ON customer.id=c.customer_id AND customer.company_id=p_company_id
 JOIN public.customer_sites s ON s.id=c.customer_site_id AND s.company_id=p_company_id AND s.customer_id=customer.id
 JOIN public.metering_points m ON m.id=c.metering_point_id AND m.company_id=p_company_id AND m.customer_id=customer.id AND m.site_id=s.id
 JOIN public.customer_supply_periods sp ON sp.company_id=p_company_id AND sp.customer_id=customer.id AND sp.metering_point_id=m.id AND sp.customer_contract_id=c.id
 JOIN public.grid_owners g ON g.id=m.grid_owner_id AND g.id=s.grid_owner_id AND (g.company_id IS NULL OR g.company_id=p_company_id)
 WHERE c.id=doc.customer_contract_id AND c.company_id=p_company_id AND (c.site_id IS NULL OR c.site_id=s.id)
 AND (m.customer_site_id IS NULL OR m.customer_site_id=s.id)
 AND (sp.contract_id IS NULL OR sp.contract_id=c.id)
 AND m.meter_point_id=wire->>'objectId' AND (m.metering_point_id IS NULL OR m.metering_point_id=wire->>'objectId')
 AND s.facility_id=wire->>'objectId' AND wire->>'identityAgency'='9'
 AND g.ediel_id=wire->>'legalSender' AND g.environment=p_environment AND g.is_active AND g.lifecycle_status='active'
 AND EXISTS(SELECT FROM public.tenant_ediel_profiles p WHERE p.company_id=p_company_id AND p.environment=p_environment AND p.market='electricity' AND p.is_enabled
 AND p.valid_from<=src.source_received_at AND (p.valid_to IS NULL OR src.source_received_at<p.valid_to))
 AND (SELECT count(DISTINCT (i.actor_id,i.identifier_value)) FROM public.tenant_actor_identifiers i WHERE i.company_id=p_company_id AND i.environment=p_environment
 AND i.identifier_type='EdielId' AND i.valid_from<=src.source_received_at AND (i.valid_to IS NULL OR src.source_received_at<i.valid_to))=1
 AND EXISTS(SELECT FROM public.tenant_actor_identifiers i JOIN public.tenant_actor_roles r ON r.company_id=i.company_id AND r.environment=i.environment AND r.actor_id=i.actor_id
 WHERE i.company_id=p_company_id AND i.environment=p_environment AND i.identifier_type='EdielId' AND i.identifier_value=wire->>'legalReceiver'
 AND i.valid_from<=src.source_received_at AND (i.valid_to IS NULL OR src.source_received_at<i.valid_to)
 AND r.role_code='electricity_supplier' AND r.valid_from<=src.source_received_at AND (r.valid_to IS NULL OR src.source_received_at<r.valid_to));
 IF n<>1 THEN graph:=NULL; END IF;
 eligible:=n=1 AND doc.storage_path IS NOT NULL AND doc.document_type='signed_contract_pdf' AND doc.storage_bucket='customer-contract-documents'
 AND doc.mime_type='application/pdf' AND doc.document_sha256 ~ '^[a-f0-9]{64}$';
 RETURN jsonb_build_object('sourceHash',src.payload_hash,'sourceScope',wire,'document',locked,'graph',graph,'eligible',coalesce(eligible,false));
END $$;
CREATE FUNCTION gridex_received_sources.begin_document_reference_v1(p_company_id uuid,p_environment text,p_source_message_id uuid,p_document_id uuid,p_actor_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE facts jsonb; a gridex_received_sources.document_reference_attempts%rowtype; predecessor uuid;
BEGIN
 PERFORM gridex_received_sources.document_reference_actor_v1(p_company_id,p_actor_user_id);
 facts:=gridex_received_sources.document_reference_facts_v1(p_company_id,p_environment,p_source_message_id,p_document_id);
 -- Preserve source registration as independently discoverable context. Foreign
 -- document failures above cannot write a concern about the foreign document.
 PERFORM gridex_received_sources.capture_correction_concern_v1(p_company_id,p_environment,p_source_message_id,p_actor_user_id);
 IF NOT EXISTS(SELECT FROM gridex_received_sources.correction_concerns c JOIN gridex_received_sources.correction_witnesses w ON w.capture_id=c.id AND w.facts_hash=c.facts_hash
 WHERE c.source_message_id=p_source_message_id AND c.company_id=p_company_id AND c.environment=p_environment AND c.created_xid<>pg_current_xact_id())
 THEN RAISE EXCEPTION 'document_source_capture_unwitnessed' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_source_message_id::text||p_document_id::text,0));
 SELECT id INTO predecessor FROM gridex_received_sources.document_reference_attempts WHERE source_message_id=p_source_message_id AND document_id=p_document_id ORDER BY recorded_at DESC,id DESC LIMIT 1;
 INSERT INTO gridex_received_sources.document_reference_attempts(company_id,environment,source_message_id,document_id,actor_user_id,predecessor_id,facts,facts_hash)
 VALUES(p_company_id,p_environment,p_source_message_id,p_document_id,p_actor_user_id,predecessor,facts,encode(sha256(convert_to(facts::text,'UTF8')),'hex')) RETURNING * INTO a;
 RETURN jsonb_build_object('kind',a.kind,'attemptId',a.id,'companyId',a.company_id,'environment',a.environment,'sourceMessageId',a.source_message_id,
 'documentId',a.document_id,'actorUserId',a.actor_user_id,'recordedAt',a.recorded_at,'factsHash',a.facts_hash,'eligible',facts->'eligible','document',facts->'document');
END $$;
CREATE FUNCTION gridex_received_sources.observe_document_reference_v1(p_company_id uuid,p_environment text,p_attempt_id uuid,p_actor_user_id uuid,p_observation jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE a gridex_received_sources.document_reference_attempts%rowtype; o gridex_received_sources.document_reference_outcomes%rowtype;
 current_facts jsonb; observed jsonb:=p_observation; started timestamptz; completed timestamptz;
BEGIN
 PERFORM gridex_received_sources.document_reference_actor_v1(p_company_id,p_actor_user_id);
 SELECT * INTO a FROM gridex_received_sources.document_reference_attempts WHERE id=p_attempt_id AND company_id=p_company_id AND environment=p_environment AND actor_user_id=p_actor_user_id AND created_xid<>pg_current_xact_id();
 IF a.id IS NULL THEN RAISE EXCEPTION 'document_attempt_not_committed' USING ERRCODE='23514'; END IF;
 IF jsonb_typeof(observed) IS DISTINCT FROM 'object' OR octet_length(observed::text)>8192
 OR NOT observed ?& ARRAY['status','startedAt','completedAt','byteCount']
 OR EXISTS(SELECT FROM jsonb_object_keys(observed) k WHERE k NOT IN ('status','reason','startedAt','completedAt','byteCount','sha256'))
 OR observed->>'status' IS NULL OR observed->>'status' NOT IN ('verified_at_observation','unavailable')
 OR jsonb_typeof(observed->'byteCount') IS DISTINCT FROM 'number' OR observed->>'byteCount' !~ '^[0-9]+$'
 OR (observed->>'byteCount')::numeric>9007199254740991
 OR ((observed->>'byteCount')::numeric>2097152 AND observed->>'reason' IS DISTINCT FROM 'oversize') THEN RAISE EXCEPTION 'invalid_document_observation' USING ERRCODE='23514'; END IF;
 IF observed->>'startedAt' IS NOT NULL OR observed->>'completedAt' IS NOT NULL THEN
 started:=(observed->>'startedAt')::timestamptz;completed:=(observed->>'completedAt')::timestamptz;
 IF started IS NULL OR completed IS NULL OR NOT isfinite(started) OR NOT isfinite(completed) OR completed<started OR started<a.recorded_at OR completed>clock_timestamp()+interval '1 second'
 THEN RAISE EXCEPTION 'invalid_document_observation_time' USING ERRCODE='23514'; END IF;
 END IF;
 IF observed->>'status'='verified_at_observation' AND (started IS NULL OR completed-started>interval '10 seconds' OR observed->>'sha256' IS DISTINCT FROM a.facts#>>'{document,document_sha256}' OR observed ? 'reason' OR a.facts->'eligible'<>'true'::jsonb)
 THEN RAISE EXCEPTION 'invalid_document_verified_observation' USING ERRCODE='23514'; END IF;
 IF observed->>'status'='unavailable' AND (observed ? 'sha256' OR observed->>'reason' IS NULL OR observed->>'reason' NOT IN ('ineligible_document','oversize','timeout','hash_mismatch','storage_error','unresolved_link'))
 THEN RAISE EXCEPTION 'invalid_document_unavailable_observation' USING ERRCODE='23514'; END IF;
 BEGIN current_facts:=gridex_received_sources.document_reference_facts_v1(p_company_id,p_environment,a.source_message_id,a.document_id);
 EXCEPTION WHEN insufficient_privilege THEN current_facts:=NULL; END;
 IF current_facts IS DISTINCT FROM a.facts THEN observed:=observed||jsonb_build_object('status','unavailable','reason','graph_changed'); END IF;
 INSERT INTO gridex_received_sources.document_reference_outcomes(attempt_id,company_id,environment,status,observation,facts_hash)
 VALUES(a.id,a.company_id,a.environment,observed->>'status',observed,encode(sha256(convert_to(observed::text,'UTF8')),'hex')) RETURNING * INTO o;
 RETURN jsonb_build_object('attemptId',a.id,'outcomeId',o.id,'factsHash',o.facts_hash,'status',o.status);
END $$;
CREATE FUNCTION gridex_received_sources.witness_document_reference_v1(p_company_id uuid,p_environment text,p_outcome_id uuid,p_facts_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o gridex_received_sources.document_reference_outcomes%rowtype; w gridex_received_sources.document_reference_witnesses%rowtype;
BEGIN
 SELECT * INTO o FROM gridex_received_sources.document_reference_outcomes WHERE id=p_outcome_id AND company_id=p_company_id AND environment=p_environment AND facts_hash=p_facts_hash AND created_xid<>pg_current_xact_id();
 IF o.id IS NULL THEN RAISE EXCEPTION 'document_outcome_not_committed' USING ERRCODE='23514'; END IF;
 INSERT INTO gridex_received_sources.document_reference_witnesses(outcome_id,company_id,environment,facts_hash,visibility_snapshot)
 VALUES(o.id,o.company_id,o.environment,o.facts_hash,pg_current_snapshot()::text) ON CONFLICT(outcome_id) DO NOTHING;
 SELECT * INTO STRICT w FROM gridex_received_sources.document_reference_witnesses WHERE outcome_id=o.id;
 RETURN jsonb_build_object('attemptId',o.attempt_id,'outcomeId',o.id,'factsHash',o.facts_hash,'witnessId',w.id,'availableAt',w.observed_at);
END $$;
-- Source-scoped cutoff read. Raw candidates survive failed initial attempt. No
-- absence-of-attempt or new epoch can assert completeness. Caller must perform
-- a new capture/readback before relying on any returned document observation.
CREATE FUNCTION gridex_received_sources.read_document_reference_context_v1(p_company_id uuid,p_environment text,p_source_message_id uuid,p_actor_user_id uuid,p_cutoff timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE src gridex_received_sources.sources%rowtype; rows jsonb; n integer;
BEGIN
 PERFORM gridex_received_sources.document_reference_actor_v1(p_company_id,p_actor_user_id);
 IF p_cutoff IS NULL OR NOT isfinite(p_cutoff) OR p_cutoff>clock_timestamp() THEN RAISE EXCEPTION 'invalid_document_cutoff' USING ERRCODE='23514'; END IF;
 SELECT * INTO src FROM gridex_received_sources.sources WHERE source_message_id=p_source_message_id AND company_id=p_company_id AND environment=p_environment
 AND message_code='Z05' AND captured_at<=p_cutoff;
 IF src.source_message_id IS NULL THEN RAISE EXCEPTION 'document_reference_unavailable' USING ERRCODE='42501'; END IF;
 SELECT count(*) INTO n FROM gridex_received_sources.document_reference_attempts WHERE source_message_id=src.source_message_id AND recorded_at<=p_cutoff;
 SELECT coalesce(jsonb_agg(row_data ORDER BY recorded_at,id),'[]'::jsonb) INTO rows FROM (
 SELECT a.recorded_at,a.id,jsonb_build_object('attemptId',a.id,'documentId',a.document_id,'recordedAt',a.recorded_at,'factsHash',a.facts_hash,
 'sourceScope',a.facts->'sourceScope','graph',a.facts->'graph','predecessorId',a.predecessor_id,
 'document',a.facts->'document','createdXid',a.created_xid::text,
 'outcome',CASE WHEN o.id IS NOT NULL THEN jsonb_build_object('outcomeId',o.id,'recordedAt',o.recorded_at,'createdXid',o.created_xid::text,'observation',o.observation,'factsHash',o.facts_hash) ELSE NULL END,
 'witness',CASE WHEN w.id IS NOT NULL THEN jsonb_build_object('witnessId',w.id,'availableAt',w.observed_at,'visibilitySnapshot',w.visibility_snapshot) ELSE NULL END) row_data
 FROM gridex_received_sources.document_reference_attempts a
 LEFT JOIN gridex_received_sources.document_reference_outcomes o ON o.attempt_id=a.id AND o.recorded_at<=p_cutoff AND o.created_xid<>pg_current_xact_id()
 LEFT JOIN gridex_received_sources.document_reference_witnesses w ON w.outcome_id=o.id AND w.observed_at<=p_cutoff
 WHERE a.source_message_id=src.source_message_id AND a.recorded_at<=p_cutoff AND a.created_xid<>pg_current_xact_id()
 ORDER BY a.recorded_at,a.id LIMIT 1000) bounded;
 RETURN jsonb_build_object('kind','context_document_reference_v1','companyId',p_company_id,'environment',p_environment,'sourceMessageId',src.source_message_id,
 'sourceHash',src.payload_hash,'sourceScope',gridex_received_sources.correction_wire_observation_v1(src.raw_payload),
 'cutoff',p_cutoff,'visibilitySnapshot',pg_current_snapshot()::text,'coverage','incomplete','authority','none','requiresRevalidation',true,'truncated',n>1000,'attempts',rows,
 'epoch',(SELECT jsonb_build_object('installedAt',installed_at,'historyCoverage',history_coverage) FROM gridex_received_sources.document_reference_epoch));
END $$;
CREATE FUNCTION public.gridex_begin_document_reference_v1(p_company_id uuid,p_environment text,p_source_message_id uuid,p_document_id uuid,p_actor_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$ BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'document_reference_service_required' USING ERRCODE='42501'; END IF;
 RETURN gridex_received_sources.begin_document_reference_v1(p_company_id,p_environment,p_source_message_id,p_document_id,p_actor_user_id); END $$;
REVOKE ALL ON FUNCTION public.gridex_begin_document_reference_v1(uuid,text,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_begin_document_reference_v1(uuid,text,uuid,uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION gridex_received_sources.begin_document_reference_v1(uuid,text,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_received_sources.begin_document_reference_v1(uuid,text,uuid,uuid,uuid) TO service_role;
CREATE FUNCTION public.gridex_observe_document_reference_v1(p_company_id uuid,p_environment text,p_attempt_id uuid,p_actor_user_id uuid,p_observation jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$ BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'document_reference_service_required' USING ERRCODE='42501'; END IF;
 RETURN gridex_received_sources.observe_document_reference_v1(p_company_id,p_environment,p_attempt_id,p_actor_user_id,p_observation); END $$;
REVOKE ALL ON FUNCTION public.gridex_observe_document_reference_v1(uuid,text,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_observe_document_reference_v1(uuid,text,uuid,uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION gridex_received_sources.observe_document_reference_v1(uuid,text,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_received_sources.observe_document_reference_v1(uuid,text,uuid,uuid,jsonb) TO service_role;
CREATE FUNCTION public.gridex_witness_document_reference_v1(p_company_id uuid,p_environment text,p_outcome_id uuid,p_facts_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$ BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'document_reference_service_required' USING ERRCODE='42501'; END IF;
 RETURN gridex_received_sources.witness_document_reference_v1(p_company_id,p_environment,p_outcome_id,p_facts_hash); END $$;
REVOKE ALL ON FUNCTION public.gridex_witness_document_reference_v1(uuid,text,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_witness_document_reference_v1(uuid,text,uuid,text) TO service_role;
REVOKE ALL ON FUNCTION gridex_received_sources.witness_document_reference_v1(uuid,text,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_received_sources.witness_document_reference_v1(uuid,text,uuid,text) TO service_role;
CREATE FUNCTION public.gridex_read_document_reference_context_v1(p_company_id uuid,p_environment text,p_source_message_id uuid,p_actor_user_id uuid,p_cutoff timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$ BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'document_reference_service_required' USING ERRCODE='42501'; END IF;
 RETURN gridex_received_sources.read_document_reference_context_v1(p_company_id,p_environment,p_source_message_id,p_actor_user_id,p_cutoff); END $$;
REVOKE ALL ON FUNCTION public.gridex_read_document_reference_context_v1(uuid,text,uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_read_document_reference_context_v1(uuid,text,uuid,uuid,timestamptz) TO service_role;
REVOKE ALL ON FUNCTION gridex_received_sources.read_document_reference_context_v1(uuid,text,uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_received_sources.read_document_reference_context_v1(uuid,text,uuid,uuid,timestamptz) TO service_role;
REVOKE ALL ON FUNCTION gridex_received_sources.document_reference_actor_v1(uuid,uuid),gridex_received_sources.document_reference_facts_v1(uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
