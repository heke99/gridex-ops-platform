-- Independent certification classification is a separate authentic original.
-- A genuine fixture registration, E34 or Z41 alone never proves death.
-- No declaration, workbook, original, publisher membership or business grant is seeded.
BEGIN;
CREATE TABLE gridex_customer_life_events.certification_classifications(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),registration_id uuid NOT NULL,
 expected_outcome text NOT NULL CHECK(expected_outcome IN('positive','negative')),run_id uuid NOT NULL REFERENCES public.ediel_test_runs(id),
 role_code text NOT NULL CHECK(role_code='supplier'),case_code text NOT NULL,suite text NOT NULL,revision text NOT NULL,step_no integer NOT NULL CHECK(step_no>0),
 wire_sha256 text NOT NULL CHECK(wire_sha256~'^[a-f0-9]{64}$'),original_file_sha256 text NOT NULL CHECK(original_file_sha256~'^[a-f0-9]{64}$'),
 classification text NOT NULL CHECK(classification IN('death','bankruptcy','other_masterdata')),selection jsonb NOT NULL,
 workbook_original bytea NOT NULL CHECK(octet_length(workbook_original) BETWEEN 1 AND 10485760),workbook_sha256 text NOT NULL CHECK(workbook_sha256=encode(sha256(workbook_original),'hex')),
 classification_original bytea NOT NULL CHECK(octet_length(classification_original) BETWEEN 1 AND 10485760),classification_sha256 text NOT NULL CHECK(classification_sha256=encode(sha256(classification_original),'hex')),
 source_reference text NOT NULL CHECK(length(btrim(source_reference))>0),source_version text NOT NULL CHECK(length(btrim(source_version))>0),owner_decision_reference text NOT NULL CHECK(length(btrim(owner_decision_reference))>0),
 valid_until timestamptz NOT NULL,published_by uuid NOT NULL REFERENCES auth.users(id),published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(company_id,registration_id,expected_outcome,source_reference,source_version));
CREATE TABLE gridex_customer_life_events.certification_classification_revocations(
 declaration_id uuid PRIMARY KEY REFERENCES gridex_customer_life_events.certification_classifications(id),source_reference text NOT NULL CHECK(length(btrim(source_reference))>0),
 source_original bytea NOT NULL CHECK(octet_length(source_original) BETWEEN 1 AND 10485760),source_sha256 text NOT NULL CHECK(source_sha256=encode(sha256(source_original),'hex')),revoked_at timestamptz NOT NULL DEFAULT clock_timestamp());
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['certification_classifications','certification_classification_revocations'] LOOP
 EXECUTE format('ALTER TABLE gridex_customer_life_events.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE gridex_customer_life_events.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON gridex_customer_life_events.%I FROM PUBLIC,anon,authenticated,service_role,gridex_ediel_fixture_authority_owner',t);
 EXECUTE format('CREATE TRIGGER certification_classification_immutable BEFORE UPDATE OR DELETE ON gridex_customer_life_events.%I FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation()',t);
 EXECUTE format('CREATE TRIGGER certification_classification_no_truncate BEFORE TRUNCATE ON gridex_customer_life_events.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation()',t);
END LOOP;END$$;
CREATE FUNCTION gridex_customer_life_events.lock_certification_revocation_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN
 PERFORM id FROM gridex_customer_life_events.certification_classifications WHERE id=NEW.declaration_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'customer_event_certification_declaration_required';END IF;RETURN NEW;END$$;
CREATE TRIGGER certification_classification_revocation_lock BEFORE INSERT ON gridex_customer_life_events.certification_classification_revocations FOR EACH ROW EXECUTE FUNCTION gridex_customer_life_events.lock_certification_revocation_v1();
CREATE FUNCTION gridex_customer_life_events.certification_selection_v1(classification text,selection jsonb,raw text,workbook_hash text,decision_hash text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE wire jsonb;own jsonb;fact jsonb;seen jsonb:='[]';BEGIN
 wire:=gridex_customer_life_events.wire_partition_v1(raw);
 IF wire IS NULL OR wire->>'family' IS DISTINCT FROM 'PRODAT' OR wire->>'code' IS DISTINCT FROM 'Z09' OR jsonb_typeof(selection) IS DISTINCT FROM 'object' OR selection#>>'{source,kind}' IS DISTINCT FROM 'caller_selection'
  OR jsonb_typeof(selection->'objects') IS DISTINCT FROM 'array' OR jsonb_array_length(selection->'objects') IS DISTINCT FROM jsonb_array_length(wire->'objects') OR(classification IN('death','bankruptcy','other_masterdata')) IS NOT TRUE THEN RETURN false;END IF;
 FOR own IN SELECT item FROM jsonb_array_elements(wire->'objects')item LOOP
  IF nullif(own->>'point','') IS NULL OR(own->>'identityAgency' IN('9','89')) IS NOT TRUE OR own->>'reason' IS DISTINCT FROM 'E34' OR nullif(own->>'li','') IS NULL THEN RETURN false;END IF;
  IF(SELECT count(*) FROM jsonb_array_elements(selection->'objects')f WHERE f#>>'{installation,id}'=own->>'point' AND f#>>'{installation,agency}'=own->>'identityAgency')<>1 THEN RETURN false;END IF;
  SELECT f INTO fact FROM jsonb_array_elements(selection->'objects')f WHERE f#>>'{installation,id}'=own->>'point' AND f#>>'{installation,agency}'=own->>'identityAgency';
  IF seen@>jsonb_build_array(fact->'objectKey') OR nullif(fact->>'objectKey','') IS NULL OR fact#>>'{process,code}' IS DISTINCT FROM 'Z09' OR fact#>>'{process,reason}' IS DISTINCT FROM 'E34' OR fact->>'lineItemReference' IS DISTINCT FROM own->>'li'
   OR fact#>>'{customer,kind}' IS DISTINCT FROM 'test_customer' OR fact#>>'{customer,workbookSha256}' IS DISTINCT FROM workbook_hash OR nullif(fact#>>'{customer,sheet}','') IS NULL OR nullif(fact#>>'{customer,entityLabel}','') IS NULL
   OR fact#>>'{legalSupplier,id}' IS DISTINCT FROM wire->>'legalSender' OR fact#>>'{legalSupplier,qualifier}' IS DISTINCT FROM '160' OR fact#>>'{legalSupplier,agency}' IS DISTINCT FROM 'SVK'
   OR fact#>>'{legalGridOwner,id}' IS DISTINCT FROM wire->>'legalReceiver' OR fact#>>'{legalGridOwner,qualifier}' IS DISTINCT FROM '160' OR fact#>>'{legalGridOwner,agency}' IS DISTINCT FROM 'SVK'
   OR fact#>>'{event,key}' IS DISTINCT FROM fact#>>'{event,eventKey}' OR nullif(fact#>>'{event,key}','') IS NULL OR fact#>>'{event,revision}' IS DISTINCT FROM decision_hash
   OR fact#>>'{assessment,kind}' IS DISTINCT FROM 'known' OR fact#>>'{assessment,value}' IS DISTINCT FROM (CASE classification WHEN 'death' THEN 'death' ELSE 'not_death' END)
   OR fact#>>'{assessment,evidence,eventKey}' IS DISTINCT FROM fact#>>'{event,eventKey}' OR fact#>>'{assessment,evidence,revision}' IS DISTINCT FROM decision_hash THEN RETURN false;END IF;
  seen:=seen||jsonb_build_array(fact->'objectKey');
 END LOOP;RETURN true;
EXCEPTION WHEN data_exception THEN RETURN false;END$$;
CREATE FUNCTION gridex_customer_life_events.certification_basis_v1(q jsonb,raw text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d gridex_customer_life_events.certification_classifications%rowtype;BEGIN
 IF q IS NULL OR q->>'authorizesBusinessEffect' IS DISTINCT FROM 'false' OR q->>'roleCode' IS DISTINCT FROM 'supplier' OR(q->>'expectedOutcome' IN('positive','negative')) IS NOT TRUE THEN RETURN NULL;END IF;
 IF(SELECT count(*) FROM gridex_customer_life_events.certification_classifications x WHERE x.company_id::text=q->>'companyId' AND x.registration_id::text=q->>'registrationId' AND x.expected_outcome=q->>'expectedOutcome'
  AND x.valid_until>clock_timestamp() AND NOT EXISTS(SELECT FROM gridex_customer_life_events.certification_classification_revocations r WHERE r.declaration_id=x.id))<>1 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['independent_authentic_certification_customer_event_classification']);END IF;
 SELECT * INTO d FROM gridex_customer_life_events.certification_classifications x WHERE x.company_id::text=q->>'companyId' AND x.registration_id::text=q->>'registrationId' AND x.expected_outcome=q->>'expectedOutcome'
  AND x.valid_until>clock_timestamp() AND NOT EXISTS(SELECT FROM gridex_customer_life_events.certification_classification_revocations r WHERE r.declaration_id=x.id) FOR SHARE;
 IF EXISTS(SELECT FROM gridex_customer_life_events.certification_classification_revocations r WHERE r.declaration_id=d.id) OR d.run_id::text IS DISTINCT FROM q->>'runId' OR d.role_code IS DISTINCT FROM q->>'roleCode' OR d.case_code IS DISTINCT FROM q->>'caseCode' OR d.suite IS DISTINCT FROM q->>'suite' OR d.revision IS DISTINCT FROM q->>'revision' OR d.step_no::text IS DISTINCT FROM q->>'stepNo'
  OR d.wire_sha256 IS DISTINCT FROM q->>'wireSha256' OR d.original_file_sha256 IS DISTINCT FROM q->>'originalFileSha256' OR d.valid_until>(q->>'validUntil')::timestamptz
  OR gridex_customer_life_events.certification_selection_v1(d.classification,d.selection,raw,d.workbook_sha256,d.classification_sha256) IS NOT TRUE THEN RETURN jsonb_build_object('status','held','missing',ARRAY['same_registered_original_classification_workbook_and_whole_object_scope']);END IF;
 RETURN jsonb_build_object('status','authorized','sourceKind','independently_classified_fixture','authorizesBusinessEffect',false,'companyId',d.company_id,'environment','test','code','Z09','rawPayload',raw,
  'declarationId',d.id,'sourceVersion',d.source_version,'sourceDigest',d.classification_sha256,'sourceReference',d.source_reference,'classification',d.classification,'selection',d.selection,
  'fixtureRegistrationId',d.registration_id,'runId',d.run_id,'expectedOutcome',d.expected_outcome,'expectedDiagnosticCodes',q->'expectedDiagnosticCodes');
END$$;
CREATE FUNCTION gridex_customer_life_events.publish_certification_v1(context jsonb,workbook bytea,decision bytea,publisher text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q jsonb;raw text;reg jsonb;result uuid;prior gridex_customer_life_events.certification_classifications%rowtype;BEGIN
 IF publisher IS DISTINCT FROM 'gridex_ediel_fixture_authority_owner' OR workbook IS NULL OR decision IS NULL OR octet_length(workbook) NOT BETWEEN 1 AND 10485760 OR octet_length(decision) NOT BETWEEN 1 AND 10485760
  OR nullif(context->>'sourceReference','') IS NULL OR nullif(context->>'sourceVersion','') IS NULL OR nullif(context->>'ownerDecisionReference','') IS NULL OR(context->>'expectedOutcome' IN('positive','negative')) IS NOT TRUE THEN RAISE EXCEPTION 'customer_event_independent_certification_originals_required';END IF;
 PERFORM gridex_negative_fixtures.assert_prepare_actor_v1((context->>'actorUserId')::uuid,(context->>'companyId')::uuid);
 IF context->>'expectedOutcome'='positive' THEN SELECT to_jsonb(f) INTO reg FROM gridex_negative_fixtures.positive_originals f WHERE id=(context->>'registrationId')::uuid AND company_id=(context->>'companyId')::uuid FOR SHARE;
 ELSE SELECT to_jsonb(f) INTO reg FROM gridex_negative_fixtures.originals f WHERE id=(context->>'registrationId')::uuid AND company_id=(context->>'companyId')::uuid FOR SHARE;END IF;
 IF reg IS NULL THEN RAISE EXCEPTION 'customer_event_genuine_certification_registration_required';END IF;raw:=reg->>'original_wire';
 IF context->>'expectedOutcome'='positive' THEN q:=gridex_negative_fixtures.read_positive_v1(jsonb_build_object('companyId',context->>'companyId','runId',reg->>'run_id','stepNo',reg->>'step_no','actorUserId',context->>'actorUserId','rawPayload',raw));
 ELSE q:=gridex_negative_fixtures.read_negative_preparation_v1(jsonb_build_object('companyId',context->>'companyId','runId',reg->>'run_id','stepNo',reg->>'step_no','actorUserId',context->>'actorUserId','rawPayload',raw));END IF;
 IF q->>'registrationId' IS DISTINCT FROM context->>'registrationId' OR q->>'roleCode' IS DISTINCT FROM 'supplier' OR q->>'authorizesBusinessEffect' IS DISTINCT FROM 'false' OR(context->>'validUntil')::timestamptz<=clock_timestamp() OR(context->>'validUntil')::timestamptz>(q->>'validUntil')::timestamptz
  OR gridex_customer_life_events.certification_selection_v1(context->>'classification',context->'selection',raw,encode(sha256(workbook),'hex'),encode(sha256(decision),'hex')) IS NOT TRUE THEN RAISE EXCEPTION 'customer_event_same_registered_independent_classification_required';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer-event-certification|'||(context->>'companyId')||'|'||(context->>'registrationId'),0));
 SELECT * INTO prior FROM gridex_customer_life_events.certification_classifications WHERE company_id=(context->>'companyId')::uuid AND registration_id=(context->>'registrationId')::uuid AND expected_outcome=context->>'expectedOutcome' AND source_reference=context->>'sourceReference' AND source_version=context->>'sourceVersion' FOR SHARE;
 IF FOUND THEN
  IF prior.classification IS DISTINCT FROM context->>'classification' OR prior.selection IS DISTINCT FROM context->'selection' OR prior.workbook_original IS DISTINCT FROM workbook OR prior.classification_original IS DISTINCT FROM decision OR prior.owner_decision_reference IS DISTINCT FROM context->>'ownerDecisionReference' OR prior.valid_until IS DISTINCT FROM(context->>'validUntil')::timestamptz THEN RAISE EXCEPTION 'customer_event_certification_immutable_source_conflict';END IF;RETURN prior.id;
 END IF;
 IF EXISTS(SELECT FROM gridex_customer_life_events.certification_classifications d WHERE d.company_id=(context->>'companyId')::uuid AND d.registration_id=(context->>'registrationId')::uuid AND d.expected_outcome=context->>'expectedOutcome' AND NOT EXISTS(SELECT FROM gridex_customer_life_events.certification_classification_revocations r WHERE r.declaration_id=d.id)) THEN RAISE EXCEPTION 'customer_event_certification_classification_already_published';END IF;
 INSERT INTO gridex_customer_life_events.certification_classifications(company_id,registration_id,expected_outcome,run_id,role_code,case_code,suite,revision,step_no,wire_sha256,original_file_sha256,classification,selection,workbook_original,workbook_sha256,classification_original,classification_sha256,source_reference,source_version,owner_decision_reference,valid_until,published_by)
 VALUES((q->>'companyId')::uuid,(q->>'registrationId')::uuid,q->>'expectedOutcome',(q->>'runId')::uuid,q->>'roleCode',q->>'caseCode',q->>'suite',q->>'revision',(q->>'stepNo')::integer,q->>'wireSha256',q->>'originalFileSha256',context->>'classification',context->'selection',workbook,encode(sha256(workbook),'hex'),decision,encode(sha256(decision),'hex'),context->>'sourceReference',context->>'sourceVersion',context->>'ownerDecisionReference',(context->>'validUntil')::timestamptz,(context->>'actorUserId')::uuid) RETURNING id INTO result;RETURN result;
END$$;
CREATE FUNCTION public.ediel_publish_customer_event_certification_v1(p_context jsonb,p_workbook_original bytea,p_classification_original bytea) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$BEGIN
 IF current_user<>'gridex_ediel_fixture_authority_owner' THEN RAISE EXCEPTION 'customer_event_certification_source_owner_required' USING ERRCODE='42501';END IF;
 RETURN gridex_customer_life_events.publish_certification_v1(p_context,p_workbook_original,p_classification_original,current_user);END$$;
CREATE FUNCTION gridex_customer_life_events.revoke_certification_v1(declaration uuid,actor uuid,reference text,original bytea,publisher text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE d gridex_customer_life_events.certification_classifications%rowtype;r gridex_customer_life_events.certification_classification_revocations%rowtype;BEGIN
 IF publisher IS DISTINCT FROM 'gridex_ediel_fixture_authority_owner' OR nullif(btrim(reference),'') IS NULL OR original IS NULL OR octet_length(original) NOT BETWEEN 1 AND 10485760 THEN RAISE EXCEPTION 'customer_event_certification_revocation_original_required';END IF;
 SELECT * INTO d FROM gridex_customer_life_events.certification_classifications WHERE id=declaration FOR UPDATE;IF d.id IS NULL THEN RAISE EXCEPTION 'customer_event_certification_declaration_required';END IF;
 PERFORM gridex_negative_fixtures.assert_prepare_actor_v1(actor,d.company_id);
 SELECT * INTO r FROM gridex_customer_life_events.certification_classification_revocations WHERE declaration_id=d.id;
 IF FOUND THEN IF r.source_reference IS DISTINCT FROM reference OR r.source_original IS DISTINCT FROM original THEN RAISE EXCEPTION 'customer_event_certification_revocation_conflict';END IF;RETURN;END IF;
 INSERT INTO gridex_customer_life_events.certification_classification_revocations(declaration_id,source_reference,source_original,source_sha256) VALUES(d.id,reference,original,encode(sha256(original),'hex'));
END$$;
CREATE FUNCTION public.ediel_revoke_customer_event_certification_v1(p_declaration_id uuid,p_actor_user_id uuid,p_source_reference text,p_revocation_original bytea) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$BEGIN
 IF current_user<>'gridex_ediel_fixture_authority_owner' THEN RAISE EXCEPTION 'customer_event_certification_source_owner_required' USING ERRCODE='42501';END IF;
 PERFORM gridex_customer_life_events.revoke_certification_v1(p_declaration_id,p_actor_user_id,p_source_reference,p_revocation_original,current_user);
END$$;
CREATE FUNCTION public.ediel_customer_event_certification_basis_v1(p_company_id uuid,p_run_id uuid,p_step_no integer,p_actor_user_id uuid,p_raw_payload text,p_expected_outcome text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE q jsonb;BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'customer_event_service_required' USING ERRCODE='42501';END IF;
 IF p_expected_outcome='positive' THEN q:=gridex_negative_fixtures.read_positive_v1(jsonb_build_object('companyId',p_company_id,'runId',p_run_id,'stepNo',p_step_no,'actorUserId',p_actor_user_id,'rawPayload',p_raw_payload));
 ELSIF p_expected_outcome='negative' THEN q:=gridex_negative_fixtures.read_negative_preparation_v1(jsonb_build_object('companyId',p_company_id,'runId',p_run_id,'stepNo',p_step_no,'actorUserId',p_actor_user_id,'rawPayload',p_raw_payload));
 ELSE RAISE EXCEPTION 'customer_event_fixture_outcome_required';END IF;
 RETURN gridex_customer_life_events.certification_basis_v1(q,p_raw_payload);
END$$;
ALTER FUNCTION gridex_customer_life_events.require_current_v1(uuid,uuid,uuid,text) RENAME TO require_before_certification_v1;
CREATE FUNCTION gridex_customer_life_events.require_current_v1(c uuid,mid uuid,actor uuid,phase text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE m public.ediel_messages%rowtype;q jsonb;b jsonb;BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=mid AND company_id=c FOR SHARE;IF m.id IS NULL THEN RAISE EXCEPTION 'customer_life_event_message_scope_required';END IF;
 IF m.direction IS DISTINCT FROM 'outbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.message_code IS DISTINCT FROM 'Z09' OR EXISTS(SELECT FROM gridex_customer_life_events.originals WHERE message_id=mid AND company_id=c) OR EXISTS(SELECT FROM gridex_received_sources.prodat_recovery_messages WHERE message_id=mid) THEN RETURN gridex_customer_life_events.require_before_certification_v1(c,mid,actor,phase);END IF;
 IF m.environment='test' AND m.execution_context_snapshot->>'sourceQualifiedPositiveFixtureWitnessId' IS NOT NULL AND m.execution_context_snapshot->>'sourceQualifiedNegativeFixtureWitnessId' IS NULL THEN q:=gridex_negative_fixtures.require_positive_message_v1(c,mid,'Z09');
 ELSIF m.environment='test' AND m.execution_context_snapshot->>'sourceQualifiedNegativeFixtureWitnessId' IS NOT NULL AND m.execution_context_snapshot->>'sourceQualifiedPositiveFixtureWitnessId' IS NULL THEN q:=gridex_negative_fixtures.require_negative_message_v1(c,mid,'Z09');END IF;
 IF q IS NOT NULL THEN
  IF phase='send' THEN PERFORM gridex_customer_life_events.require_actor_v1(c,actor,'send');ELSE PERFORM gridex_negative_fixtures.assert_prepare_actor_v1(actor,c);END IF;
  b:=gridex_customer_life_events.certification_basis_v1(q,m.raw_payload);
  IF b->>'status' IS DISTINCT FROM 'authorized' OR m.immutable_rendered_at IS NULL OR m.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'customer_event_independent_certification_classification_required';END IF;
  RETURN jsonb_build_object('certification',true,'basis',b,'intentId',m.intent_id);
 END IF;RETURN gridex_customer_life_events.require_before_certification_v1(c,mid,actor,phase);
END$$;
REVOKE ALL ON FUNCTION gridex_customer_life_events.revoke_certification_v1(uuid,uuid,text,bytea,text),gridex_customer_life_events.lock_certification_revocation_v1(),gridex_customer_life_events.certification_selection_v1(text,jsonb,text,text,text),gridex_customer_life_events.certification_basis_v1(jsonb,text),gridex_customer_life_events.publish_certification_v1(jsonb,bytea,bytea,text),gridex_customer_life_events.require_current_v1(uuid,uuid,uuid,text),gridex_customer_life_events.require_before_certification_v1(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role,gridex_ediel_fixture_authority_owner;
GRANT USAGE ON SCHEMA gridex_customer_life_events TO gridex_ediel_fixture_authority_owner;
GRANT EXECUTE ON FUNCTION gridex_customer_life_events.publish_certification_v1(jsonb,bytea,bytea,text),gridex_customer_life_events.revoke_certification_v1(uuid,uuid,text,bytea,text) TO gridex_ediel_fixture_authority_owner;
REVOKE ALL ON FUNCTION public.ediel_revoke_customer_event_certification_v1(uuid,uuid,text,bytea),public.ediel_publish_customer_event_certification_v1(jsonb,bytea,bytea),public.ediel_customer_event_certification_basis_v1(uuid,uuid,integer,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_publish_customer_event_certification_v1(jsonb,bytea,bytea),public.ediel_revoke_customer_event_certification_v1(uuid,uuid,text,bytea) TO gridex_ediel_fixture_authority_owner;
GRANT EXECUTE ON FUNCTION public.ediel_customer_event_certification_basis_v1(uuid,uuid,integer,uuid,text,text) TO service_role;
COMMIT;
