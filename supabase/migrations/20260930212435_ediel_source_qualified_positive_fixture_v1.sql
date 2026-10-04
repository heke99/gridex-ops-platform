-- Actual Supabase CLI new migration. Prospective authentic positive test
-- originals only; no original bytes, publisher membership or owner grant seeded.
BEGIN;
CREATE TABLE gridex_negative_fixtures.positive_originals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),run_id uuid NOT NULL REFERENCES public.ediel_test_runs(id),
 role_code text NOT NULL,case_code text NOT NULL,suite text NOT NULL,revision text NOT NULL,step_no integer NOT NULL CHECK(step_no>0),
 source_reference text NOT NULL CHECK(length(source_reference)>0),owner_decision_reference text NOT NULL CHECK(length(owner_decision_reference)>0),
 original_file_sha256 text NOT NULL CHECK(original_file_sha256~'^[a-f0-9]{64}$'),wire_sha256 text NOT NULL CHECK(wire_sha256=original_file_sha256),original_wire text NOT NULL,
 expected_outcome text NOT NULL CHECK(expected_outcome='positive'),expected_diagnostic_codes jsonb NOT NULL CHECK(expected_diagnostic_codes='[]'::jsonb),
 test_receiver_ediel_id text NOT NULL CHECK(length(test_receiver_ediel_id)>0),valid_until timestamptz NOT NULL,published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(company_id,run_id,step_no,revision,wire_sha256)
);
CREATE TABLE gridex_negative_fixtures.positive_witnesses(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),registration_id uuid NOT NULL REFERENCES gridex_negative_fixtures.positive_originals(id),actor_user_id uuid NOT NULL,
 company_id uuid NOT NULL,run_id uuid NOT NULL,step_no integer NOT NULL,wire_sha256 text NOT NULL,qualification jsonb NOT NULL,prepared_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE gridex_negative_fixtures.positive_consumptions(
 witness_id uuid PRIMARY KEY REFERENCES gridex_negative_fixtures.positive_witnesses(id),registration_id uuid NOT NULL UNIQUE REFERENCES gridex_negative_fixtures.positive_originals(id),
 message_id uuid NOT NULL UNIQUE REFERENCES public.ediel_messages(id),company_id uuid NOT NULL,wire_sha256 text NOT NULL
);
DO $$DECLARE tab text;BEGIN FOREACH tab IN ARRAY ARRAY['positive_originals','positive_witnesses','positive_consumptions'] LOOP
 EXECUTE format('ALTER TABLE gridex_negative_fixtures.%I ENABLE ROW LEVEL SECURITY',tab);
 EXECUTE format('ALTER TABLE gridex_negative_fixtures.%I FORCE ROW LEVEL SECURITY',tab);
 EXECUTE format('REVOKE ALL ON TABLE gridex_negative_fixtures.%I FROM PUBLIC,anon,authenticated,service_role,gridex_ediel_fixture_authority_owner',tab);
 EXECUTE format('CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON gridex_negative_fixtures.%I FOR EACH ROW EXECUTE FUNCTION gridex_negative_fixtures.immutable_v1()',tab);
 EXECUTE format('CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_negative_fixtures.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_negative_fixtures.immutable_v1()',tab);
END LOOP;END $$;
CREATE FUNCTION gridex_negative_fixtures.assert_prepare_actor_v1(actor uuid,company uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF actor IS NULL OR company IS NULL OR NOT EXISTS(SELECT FROM public.company_memberships x WHERE x.company_id=company AND x.user_id=actor AND x.status='active' AND x.is_active AND x.accepted_at IS NOT NULL)
  OR NOT EXISTS(SELECT FROM public.user_profiles x WHERE x.id=actor AND x.user_status='active')
  OR NOT (coalesce(public.gridex_actor_has_company_permission(actor,company,'communication.write'),false) OR coalesce(public.gridex_actor_has_company_permission(actor,company,'ediel_testing.write'),false))
 THEN RAISE EXCEPTION 'ediel_fixture_prepare_actor_not_authorized' USING ERRCODE='42501';END IF;
END $$;
CREATE FUNCTION gridex_negative_fixtures.publish_positive_v1(p_context jsonb,p_original bytea,p_publisher text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.ediel_test_runs%rowtype;prior gridex_negative_fixtures.positive_originals%rowtype;wire text;hash text;result uuid;tokens jsonb;
BEGIN
 IF p_publisher IS DISTINCT FROM 'gridex_ediel_fixture_authority_owner' OR p_original IS NULL OR octet_length(p_original) NOT BETWEEN 1 AND 10485760
  OR p_context->>'expectedOutcome' IS DISTINCT FROM 'positive' OR p_context->'expectedDiagnosticCodes' IS DISTINCT FROM '[]'::jsonb
  OR nullif(p_context->>'sourceReference','') IS NULL OR nullif(p_context->>'ownerDecisionReference','') IS NULL OR nullif(p_context->>'testReceiverEdielId','') IS NULL
 THEN RAISE EXCEPTION 'ediel_positive_fixture_qualified_original_required';END IF;
 SELECT * INTO STRICT r FROM public.ediel_test_runs WHERE id=(p_context->>'runId')::uuid AND company_id=(p_context->>'companyId')::uuid AND environment='test' AND status IN('draft','running') FOR SHARE;
 PERFORM gridex_negative_fixtures.assert_actor_v1((p_context->>'actorUserId')::uuid,r.company_id,'communication.write');
 IF r.role_code IS DISTINCT FROM p_context->>'roleCode' OR r.test_case_code IS DISTINCT FROM p_context->>'caseCode' OR r.test_suite IS DISTINCT FROM p_context->>'suite'
  OR r.approval_version IS DISTINCT FROM p_context->>'revision' OR (p_context->>'stepNo')::integer<=0 OR (p_context->>'validUntil')::timestamptz<=clock_timestamp()
 THEN RAISE EXCEPTION 'ediel_positive_fixture_run_scope_mismatch';END IF;
 wire:=gridex_negative_fixtures.decode_latin1_v1(p_original);hash:=encode(sha256(p_original),'hex');tokens:=gridex_received_sources.wire_tokens_bounded_v1(wire,999999);
 IF tokens IS NULL OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNB')<>1
  OR NOT EXISTS(SELECT FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNB' AND t#>>'{elements,3,0}'=p_context->>'testReceiverEdielId' AND t#>>'{elements,11,0}'='1') THEN RAISE EXCEPTION 'ediel_positive_fixture_test_original_required';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(r.id::text||'|'||(p_context->>'stepNo')||'|'||hash,0));
 SELECT * INTO prior FROM gridex_negative_fixtures.positive_originals WHERE company_id=r.company_id AND run_id=r.id AND step_no=(p_context->>'stepNo')::integer AND revision=r.approval_version AND wire_sha256=hash;
 IF FOUND THEN
  IF prior.test_receiver_ediel_id IS DISTINCT FROM p_context->>'testReceiverEdielId' OR prior.source_reference IS DISTINCT FROM p_context->>'sourceReference'
   OR prior.owner_decision_reference IS DISTINCT FROM p_context->>'ownerDecisionReference' OR prior.valid_until IS DISTINCT FROM (p_context->>'validUntil')::timestamptz THEN RAISE EXCEPTION 'ediel_positive_fixture_original_conflict';END IF;
  RETURN prior.id;
 END IF;
 INSERT INTO gridex_negative_fixtures.positive_originals(company_id,run_id,role_code,case_code,suite,revision,step_no,source_reference,owner_decision_reference,original_file_sha256,wire_sha256,original_wire,expected_outcome,expected_diagnostic_codes,test_receiver_ediel_id,valid_until)
 VALUES(r.company_id,r.id,r.role_code,r.test_case_code,r.test_suite,r.approval_version,(p_context->>'stepNo')::integer,p_context->>'sourceReference',p_context->>'ownerDecisionReference',hash,hash,wire,'positive','[]',p_context->>'testReceiverEdielId',(p_context->>'validUntil')::timestamptz) RETURNING id INTO result;
 RETURN result;
END $$;
CREATE FUNCTION public.gridex_ediel_positive_fixture_publish_v1(p_context jsonb,p_original bytea) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$ BEGIN
 IF current_user<>'gridex_ediel_fixture_authority_owner' THEN RAISE EXCEPTION 'ediel_positive_fixture_source_owner_required' USING ERRCODE='42501';END IF;
 RETURN gridex_negative_fixtures.publish_positive_v1(p_context,p_original,current_user);END $$;
CREATE FUNCTION gridex_negative_fixtures.read_positive_v1(p_context jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.ediel_test_runs%rowtype;f gridex_negative_fixtures.positive_originals%rowtype;wire text:=p_context->>'rawPayload';tokens jsonb;
BEGIN
 SELECT * INTO STRICT r FROM public.ediel_test_runs WHERE id=(p_context->>'runId')::uuid AND company_id=(p_context->>'companyId')::uuid AND environment='test' AND status IN('draft','running') FOR SHARE;
 PERFORM gridex_negative_fixtures.assert_prepare_actor_v1((p_context->>'actorUserId')::uuid,r.company_id);
 SELECT * INTO f FROM gridex_negative_fixtures.positive_originals WHERE company_id=r.company_id AND run_id=r.id AND role_code=r.role_code AND case_code=r.test_case_code AND suite=r.test_suite AND revision=r.approval_version
  AND step_no=(p_context->>'stepNo')::integer AND original_wire=wire AND valid_until>clock_timestamp();
 IF NOT FOUND THEN RETURN NULL;END IF;
 tokens:=gridex_received_sources.wire_tokens_bounded_v1(wire,999999);
 IF tokens IS NULL OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNB')<>1
  OR NOT EXISTS(SELECT FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNB' AND t#>>'{elements,3,0}'=f.test_receiver_ediel_id AND t#>>'{elements,11,0}'='1') THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('kind','source_qualified_positive_fixture','version',1,'registrationId',f.id,'companyId',r.company_id,'runId',r.id,'roleCode',r.role_code,'caseCode',r.test_case_code,'suite',r.test_suite,'revision',r.approval_version,'stepNo',f.step_no,
  'wireSha256',f.wire_sha256,'originalFileSha256',f.original_file_sha256,'expectedOutcome','positive','expectedDiagnosticCodes','[]'::jsonb,'testReceiverEdielId',f.test_receiver_ediel_id,'validUntil',f.valid_until,'sourceReference',f.source_reference,'ownerDecisionReference',f.owner_decision_reference,'authorizesBusinessEffect',false);
END $$;
CREATE FUNCTION public.gridex_ediel_positive_fixture_read_v1(p_context jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$ BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501';END IF;RETURN gridex_negative_fixtures.read_positive_v1(p_context);END $$;
CREATE FUNCTION gridex_negative_fixtures.prepare_positive_v1(p_context jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q jsonb;witness uuid;
BEGIN q:=gridex_negative_fixtures.read_positive_v1(p_context);
 IF q IS NULL OR q->>'registrationId' IS DISTINCT FROM p_context->>'registrationId' THEN RAISE EXCEPTION 'ediel_positive_fixture_witness_required';END IF;
 INSERT INTO gridex_negative_fixtures.positive_witnesses(registration_id,actor_user_id,company_id,run_id,step_no,wire_sha256,qualification)
 VALUES((q->>'registrationId')::uuid,(p_context->>'actorUserId')::uuid,(q->>'companyId')::uuid,(q->>'runId')::uuid,(q->>'stepNo')::integer,q->>'wireSha256',q) RETURNING id INTO witness;
 RETURN jsonb_build_object('witnessId',witness,'qualification',q);
END $$;
CREATE FUNCTION public.gridex_ediel_positive_fixture_prepare_v1(p_context jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$ BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501';END IF;RETURN gridex_negative_fixtures.prepare_positive_v1(p_context);END $$;
CREATE FUNCTION gridex_negative_fixtures.prepared_positive_fixture_v1(p_company uuid,p_witness uuid,p_raw text,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE w gridex_negative_fixtures.positive_witnesses%rowtype;q jsonb;
BEGIN
 SELECT * INTO w FROM gridex_negative_fixtures.positive_witnesses WHERE id=p_witness AND company_id=p_company AND actor_user_id=p_actor FOR SHARE;
 IF w.id IS NULL OR EXISTS(SELECT FROM gridex_negative_fixtures.positive_consumptions c WHERE c.witness_id=w.id) THEN RAISE EXCEPTION 'ediel_positive_fixture_prepared_original_required';END IF;
 q:=gridex_negative_fixtures.read_positive_v1(jsonb_build_object('companyId',p_company,'runId',w.run_id,'stepNo',w.step_no,'actorUserId',p_actor,'rawPayload',p_raw));
 IF q IS NULL OR q IS DISTINCT FROM w.qualification THEN RAISE EXCEPTION 'ediel_positive_fixture_prepared_original_required';END IF;RETURN q;
END $$;
CREATE FUNCTION gridex_negative_fixtures.consume_positive_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE w gridex_negative_fixtures.positive_witnesses%rowtype;f gridex_negative_fixtures.positive_originals%rowtype;r public.ediel_test_runs%rowtype;prior gridex_negative_fixtures.positive_consumptions%rowtype;
BEGIN
 IF NEW.execution_context_snapshot->>'sourceQualifiedPositiveFixtureWitnessId' IS NULL THEN RETURN NEW;END IF;
 SELECT * INTO w FROM gridex_negative_fixtures.positive_witnesses WHERE id=(NEW.execution_context_snapshot->>'sourceQualifiedPositiveFixtureWitnessId')::uuid FOR UPDATE;
 IF w.id IS NULL THEN RAISE EXCEPTION 'ediel_positive_fixture_witness_required';END IF;
 SELECT * INTO STRICT f FROM gridex_negative_fixtures.positive_originals WHERE id=w.registration_id FOR SHARE;
 IF NEW.company_id IS DISTINCT FROM w.company_id OR NEW.environment IS DISTINCT FROM 'test' OR NEW.direction IS DISTINCT FROM 'outbound' OR NEW.message_standard IS DISTINCT FROM 'edifact' OR NEW.raw_payload IS DISTINCT FROM f.original_wire THEN RAISE EXCEPTION 'ediel_positive_fixture_message_scope_invalid';END IF;
 SELECT * INTO prior FROM gridex_negative_fixtures.positive_consumptions WHERE registration_id=f.id;
 IF FOUND THEN IF prior.message_id IS DISTINCT FROM NEW.id OR prior.witness_id IS DISTINCT FROM w.id THEN RAISE EXCEPTION 'ediel_positive_fixture_original_already_consumed';END IF;RETURN NEW;END IF;
 IF TG_OP='UPDATE' AND nullif(OLD.raw_payload,'') IS NOT NULL THEN RAISE EXCEPTION 'ediel_positive_fixture_historical_original_unavailable';END IF;
 SELECT * INTO STRICT r FROM public.ediel_test_runs WHERE id=w.run_id AND company_id=w.company_id AND environment='test' AND status IN('draft','running') FOR SHARE;
 PERFORM gridex_negative_fixtures.assert_prepare_actor_v1(w.actor_user_id,w.company_id);
 IF r.role_code IS DISTINCT FROM f.role_code OR r.test_case_code IS DISTINCT FROM f.case_code OR r.test_suite IS DISTINCT FROM f.suite OR r.approval_version IS DISTINCT FROM f.revision OR f.valid_until<=clock_timestamp() THEN RAISE EXCEPTION 'ediel_positive_fixture_current_run_required';END IF;
 -- Test provenance does not waive the normal canonical owner witness. Both
 -- private consumptions occur in the same actual INSERT transaction.
 PERFORM gridex_ediel_outbound_owner.require_v1(NEW.company_id,NEW.id);
 INSERT INTO gridex_negative_fixtures.positive_consumptions VALUES(w.id,f.id,NEW.id,w.company_id,w.wire_sha256);
 RETURN NEW;
END $$;
CREATE TRIGGER ediel_positive_fixture_origin AFTER INSERT OR UPDATE OF raw_payload,execution_context_snapshot ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_negative_fixtures.consume_positive_v1();
CREATE FUNCTION gridex_negative_fixtures.require_positive_message_v1(p_company uuid,p_message uuid,p_expected_code text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;f gridex_negative_fixtures.positive_originals%rowtype;w gridex_negative_fixtures.positive_witnesses%rowtype;r public.ediel_test_runs%rowtype;tokens jsonb;code text;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_message AND company_id=p_company AND environment='test' AND direction='outbound' AND message_standard='edifact' FOR SHARE;
 SELECT witness.* INTO w FROM gridex_negative_fixtures.positive_consumptions c JOIN gridex_negative_fixtures.positive_witnesses witness ON witness.id=c.witness_id WHERE c.message_id=m.id AND c.company_id=p_company FOR SHARE OF witness;
 IF w.id IS NULL OR m.execution_context_snapshot->>'sourceQualifiedPositiveFixtureWitnessId' IS DISTINCT FROM w.id::text THEN RAISE EXCEPTION 'ediel_positive_fixture_original_required';END IF;
 SELECT * INTO STRICT f FROM gridex_negative_fixtures.positive_originals WHERE id=w.registration_id FOR SHARE;
 SELECT * INTO STRICT r FROM public.ediel_test_runs WHERE id=w.run_id AND company_id=p_company AND environment='test' AND status IN('draft','running') FOR SHARE;
 IF m.raw_payload IS DISTINCT FROM f.original_wire OR r.role_code IS DISTINCT FROM f.role_code OR r.test_case_code IS DISTINCT FROM f.case_code OR r.test_suite IS DISTINCT FROM f.suite OR r.approval_version IS DISTINCT FROM f.revision OR f.valid_until<=clock_timestamp() THEN RAISE EXCEPTION 'ediel_positive_fixture_current_run_required';END IF;
 IF (SELECT count(*) FROM public.ediel_test_run_messages l WHERE l.ediel_message_id=m.id)<>1 OR NOT EXISTS(SELECT FROM public.ediel_test_run_messages l WHERE l.ediel_message_id=m.id AND l.test_run_id=w.run_id AND l.step_no=w.step_no) THEN RAISE EXCEPTION 'ediel_positive_fixture_actual_run_link_required';END IF;
 PERFORM gridex_negative_fixtures.assert_actor_v1(w.actor_user_id,p_company,'communication.send');PERFORM gridex_ediel_outbound_owner.require_v1(p_company,m.id);
 tokens:=gridex_received_sources.wire_tokens_bounded_v1(m.raw_payload,999999);
 IF tokens IS NULL OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNH')<>1 OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='BGM')<>1 THEN RAISE EXCEPTION 'ediel_positive_fixture_physical_message_required';END IF;
 SELECT t#>>'{elements,1,0}' INTO code FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='BGM';
 IF code IS DISTINCT FROM m.message_code OR (p_expected_code IS NOT NULL AND code IS DISTINCT FROM p_expected_code) THEN RAISE EXCEPTION 'ediel_positive_fixture_physical_message_required';END IF;
 RETURN w.qualification;
END $$;
REVOKE ALL ON FUNCTION gridex_negative_fixtures.publish_positive_v1(jsonb,bytea,text),gridex_negative_fixtures.read_positive_v1(jsonb),gridex_negative_fixtures.prepare_positive_v1(jsonb),gridex_negative_fixtures.consume_positive_v1(),gridex_negative_fixtures.require_positive_message_v1(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role,gridex_ediel_fixture_authority_owner;
REVOKE ALL ON FUNCTION gridex_negative_fixtures.assert_prepare_actor_v1(uuid,uuid),gridex_negative_fixtures.prepared_positive_fixture_v1(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role,gridex_ediel_fixture_authority_owner;
GRANT EXECUTE ON FUNCTION gridex_negative_fixtures.publish_positive_v1(jsonb,bytea,text) TO gridex_ediel_fixture_authority_owner;
GRANT EXECUTE ON FUNCTION gridex_negative_fixtures.read_positive_v1(jsonb),gridex_negative_fixtures.prepare_positive_v1(jsonb),gridex_negative_fixtures.prepared_positive_fixture_v1(uuid,uuid,text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.gridex_ediel_positive_fixture_publish_v1(jsonb,bytea),public.gridex_ediel_positive_fixture_read_v1(jsonb),public.gridex_ediel_positive_fixture_prepare_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role,gridex_ediel_fixture_authority_owner;
GRANT EXECUTE ON FUNCTION public.gridex_ediel_positive_fixture_publish_v1(jsonb,bytea) TO gridex_ediel_fixture_authority_owner;
GRANT EXECUTE ON FUNCTION public.gridex_ediel_positive_fixture_read_v1(jsonb),public.gridex_ediel_positive_fixture_prepare_v1(jsonb),gridex_negative_fixtures.require_positive_message_v1(uuid,uuid,text) TO service_role;
CREATE TABLE gridex_negative_fixtures.negative_prepared_witnesses(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),registration_id uuid NOT NULL REFERENCES gridex_negative_fixtures.originals(id),actor_user_id uuid NOT NULL,
 company_id uuid NOT NULL,run_id uuid NOT NULL,step_no integer NOT NULL,wire_sha256 text NOT NULL,qualification jsonb NOT NULL,prepared_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE gridex_negative_fixtures.negative_prepared_consumptions(
 witness_id uuid PRIMARY KEY REFERENCES gridex_negative_fixtures.negative_prepared_witnesses(id),registration_id uuid NOT NULL UNIQUE REFERENCES gridex_negative_fixtures.originals(id),
 message_id uuid NOT NULL UNIQUE REFERENCES public.ediel_messages(id),company_id uuid NOT NULL,wire_sha256 text NOT NULL
);
DO $$DECLARE tab text;BEGIN FOREACH tab IN ARRAY ARRAY['negative_prepared_witnesses','negative_prepared_consumptions'] LOOP
 EXECUTE format('ALTER TABLE gridex_negative_fixtures.%I ENABLE ROW LEVEL SECURITY',tab);EXECUTE format('ALTER TABLE gridex_negative_fixtures.%I FORCE ROW LEVEL SECURITY',tab);
 EXECUTE format('REVOKE ALL ON TABLE gridex_negative_fixtures.%I FROM PUBLIC,anon,authenticated,service_role,gridex_ediel_fixture_authority_owner',tab);
 EXECUTE format('CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON gridex_negative_fixtures.%I FOR EACH ROW EXECUTE FUNCTION gridex_negative_fixtures.immutable_v1()',tab);
 EXECUTE format('CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_negative_fixtures.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_negative_fixtures.immutable_v1()',tab);
END LOOP;END $$;
CREATE FUNCTION gridex_negative_fixtures.read_negative_preparation_v1(p_context jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.ediel_test_runs%rowtype;m public.ediel_messages%rowtype;run_id uuid;step integer;company uuid:=(p_context->>'companyId')::uuid;wire text:=p_context->>'rawPayload';f gridex_negative_fixtures.originals%rowtype;tokens jsonb;receiver text;
BEGIN
 IF p_context->>'messageId' IS NOT NULL THEN RAISE EXCEPTION 'ediel_negative_fixture_draft_context_required';END IF;
 IF p_context->>'messageId' IS NOT NULL THEN
  SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=(p_context->>'messageId')::uuid AND company_id=company AND direction='outbound' AND environment='test' AND message_standard='edifact';
  SELECT l.test_run_id,l.step_no INTO STRICT run_id,step FROM public.ediel_test_run_messages l JOIN public.ediel_test_runs x ON x.id=l.test_run_id AND x.company_id=m.company_id AND x.environment='test' WHERE l.ediel_message_id=m.id;
  wire:=m.raw_payload;
 ELSE run_id:=(p_context->>'runId')::uuid;step:=(p_context->>'stepNo')::integer;END IF;
 SELECT * INTO STRICT r FROM public.ediel_test_runs WHERE id=run_id AND company_id=company AND environment='test' AND status IN ('draft','running') FOR SHARE;
 PERFORM gridex_negative_fixtures.assert_prepare_actor_v1((p_context->>'actorUserId')::uuid,company);
 SELECT * INTO f FROM gridex_negative_fixtures.originals WHERE company_id=company AND originals.run_id=r.id AND step_no=step AND revision=r.approval_version
  -- Exact text equality to the bijectively decoded stored original is required.
  -- The server adapter additionally recomputes its actual Latin1 byte hash.
  AND role_code=r.role_code AND case_code=r.test_case_code AND suite=r.test_suite AND original_wire=wire AND valid_until>now();
 IF NOT FOUND THEN RETURN NULL;END IF;
 tokens:=gridex_received_sources.wire_tokens_bounded_v1(wire,999999);
 IF tokens IS NULL OR (SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='UNB')<>1 THEN RETURN NULL;END IF;
 SELECT t#>>'{elements,3,0}' INTO receiver FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='UNB';
 IF receiver IS DISTINCT FROM f.test_receiver_ediel_id THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('kind','source_qualified_negative_fixture','version',1,'authorizesBusinessEffect',false,'registrationId',f.id,'companyId',company,'runId',r.id,'roleCode',r.role_code,'caseCode',r.test_case_code,'suite',r.test_suite,'revision',r.approval_version,'stepNo',step,'wireSha256',f.wire_sha256,'originalFileSha256',f.original_file_sha256,'expectedOutcome','negative','expectedDiagnosticCodes',f.expected_diagnostic_codes,'testReceiverEdielId',receiver,'validUntil',f.valid_until,'sourceReference',f.source_reference,'ownerDecisionReference',f.owner_decision_reference);
END$$;
CREATE FUNCTION public.gridex_ediel_negative_fixture_prepare_read_v1(p_context jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$ BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501';END IF;RETURN gridex_negative_fixtures.read_negative_preparation_v1(p_context);END $$;
CREATE FUNCTION gridex_negative_fixtures.prepare_negative_v1(p_context jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q jsonb;witness uuid;
BEGIN q:=gridex_negative_fixtures.read_negative_preparation_v1(p_context);
 IF q IS NULL OR q->>'registrationId' IS DISTINCT FROM p_context->>'registrationId' THEN RAISE EXCEPTION 'ediel_negative_fixture_witness_required';END IF;
 INSERT INTO gridex_negative_fixtures.negative_prepared_witnesses(registration_id,actor_user_id,company_id,run_id,step_no,wire_sha256,qualification)
 VALUES((q->>'registrationId')::uuid,(p_context->>'actorUserId')::uuid,(q->>'companyId')::uuid,(q->>'runId')::uuid,(q->>'stepNo')::integer,q->>'wireSha256',q) RETURNING id INTO witness;
 RETURN jsonb_build_object('witnessId',witness,'qualification',q);
END $$;
CREATE FUNCTION public.gridex_ediel_negative_fixture_prepare_v1(p_context jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$ BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501';END IF;RETURN gridex_negative_fixtures.prepare_negative_v1(p_context);END $$;
CREATE FUNCTION gridex_negative_fixtures.prepared_negative_fixture_v1(p_company uuid,p_witness uuid,p_raw text,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE w gridex_negative_fixtures.negative_prepared_witnesses%rowtype;q jsonb;
BEGIN
 SELECT * INTO w FROM gridex_negative_fixtures.negative_prepared_witnesses WHERE id=p_witness AND company_id=p_company AND actor_user_id=p_actor FOR SHARE;
 IF w.id IS NULL OR EXISTS(SELECT FROM gridex_negative_fixtures.negative_prepared_consumptions c WHERE c.witness_id=w.id) THEN RAISE EXCEPTION 'ediel_negative_fixture_prepared_original_required';END IF;
 q:=gridex_negative_fixtures.read_negative_preparation_v1(jsonb_build_object('companyId',p_company,'runId',w.run_id,'stepNo',w.step_no,'actorUserId',p_actor,'rawPayload',p_raw));
 IF q IS NULL OR q IS DISTINCT FROM w.qualification THEN RAISE EXCEPTION 'ediel_negative_fixture_prepared_original_required';END IF;RETURN q;
END $$;
CREATE FUNCTION gridex_negative_fixtures.consume_negative_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE w gridex_negative_fixtures.negative_prepared_witnesses%rowtype;f gridex_negative_fixtures.originals%rowtype;r public.ediel_test_runs%rowtype;prior gridex_negative_fixtures.negative_prepared_consumptions%rowtype;
BEGIN
 IF NEW.execution_context_snapshot->>'sourceQualifiedNegativeFixtureWitnessId' IS NULL THEN RETURN NEW;END IF;
 SELECT * INTO w FROM gridex_negative_fixtures.negative_prepared_witnesses WHERE id=(NEW.execution_context_snapshot->>'sourceQualifiedNegativeFixtureWitnessId')::uuid FOR UPDATE;
 IF w.id IS NULL THEN RAISE EXCEPTION 'ediel_negative_fixture_witness_required';END IF;
 SELECT * INTO STRICT f FROM gridex_negative_fixtures.originals WHERE id=w.registration_id FOR SHARE;
 IF NEW.company_id IS DISTINCT FROM w.company_id OR NEW.environment IS DISTINCT FROM 'test' OR NEW.direction IS DISTINCT FROM 'outbound' OR NEW.message_standard IS DISTINCT FROM 'edifact' OR NEW.raw_payload IS DISTINCT FROM f.original_wire THEN RAISE EXCEPTION 'ediel_negative_fixture_message_scope_invalid';END IF;
 SELECT * INTO prior FROM gridex_negative_fixtures.negative_prepared_consumptions WHERE registration_id=f.id;
 IF FOUND THEN IF prior.message_id IS DISTINCT FROM NEW.id OR prior.witness_id IS DISTINCT FROM w.id THEN RAISE EXCEPTION 'ediel_negative_fixture_original_already_consumed';END IF;RETURN NEW;END IF;
 IF TG_OP='UPDATE' AND nullif(OLD.raw_payload,'') IS NOT NULL THEN RAISE EXCEPTION 'ediel_negative_fixture_historical_original_unavailable';END IF;
 SELECT * INTO STRICT r FROM public.ediel_test_runs WHERE id=w.run_id AND company_id=w.company_id AND environment='test' AND status IN('draft','running') FOR SHARE;
 PERFORM gridex_negative_fixtures.assert_prepare_actor_v1(w.actor_user_id,w.company_id);
 IF r.role_code IS DISTINCT FROM f.role_code OR r.test_case_code IS DISTINCT FROM f.case_code OR r.test_suite IS DISTINCT FROM f.suite OR r.approval_version IS DISTINCT FROM f.revision OR f.valid_until<=clock_timestamp() THEN RAISE EXCEPTION 'ediel_negative_fixture_current_run_required';END IF;
 -- Test provenance does not waive the normal canonical owner witness. Both
 -- private consumptions occur in the same actual INSERT transaction.
 PERFORM gridex_ediel_outbound_owner.require_v1(NEW.company_id,NEW.id);
 INSERT INTO gridex_negative_fixtures.negative_prepared_consumptions VALUES(w.id,f.id,NEW.id,w.company_id,w.wire_sha256);
 RETURN NEW;
END $$;
CREATE TRIGGER ediel_negative_fixture_origin AFTER INSERT OR UPDATE OF raw_payload,execution_context_snapshot ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_negative_fixtures.consume_negative_v1();
CREATE FUNCTION gridex_negative_fixtures.require_negative_message_v1(p_company uuid,p_message uuid,p_expected_code text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;f gridex_negative_fixtures.originals%rowtype;w gridex_negative_fixtures.negative_prepared_witnesses%rowtype;r public.ediel_test_runs%rowtype;tokens jsonb;code text;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_message AND company_id=p_company AND environment='test' AND direction='outbound' AND message_standard='edifact' FOR SHARE;
 SELECT witness.* INTO w FROM gridex_negative_fixtures.negative_prepared_consumptions c JOIN gridex_negative_fixtures.negative_prepared_witnesses witness ON witness.id=c.witness_id WHERE c.message_id=m.id AND c.company_id=p_company FOR SHARE OF witness;
 IF w.id IS NULL OR m.execution_context_snapshot->>'sourceQualifiedNegativeFixtureWitnessId' IS DISTINCT FROM w.id::text THEN RAISE EXCEPTION 'ediel_negative_fixture_original_required';END IF;
 SELECT * INTO STRICT f FROM gridex_negative_fixtures.originals WHERE id=w.registration_id FOR SHARE;
 SELECT * INTO STRICT r FROM public.ediel_test_runs WHERE id=w.run_id AND company_id=p_company AND environment='test' AND status IN('draft','running') FOR SHARE;
 IF m.raw_payload IS DISTINCT FROM f.original_wire OR r.role_code IS DISTINCT FROM f.role_code OR r.test_case_code IS DISTINCT FROM f.case_code OR r.test_suite IS DISTINCT FROM f.suite OR r.approval_version IS DISTINCT FROM f.revision OR f.valid_until<=clock_timestamp() THEN RAISE EXCEPTION 'ediel_negative_fixture_current_run_required';END IF;
 IF (SELECT count(*) FROM public.ediel_test_run_messages l WHERE l.ediel_message_id=m.id)<>1 OR NOT EXISTS(SELECT FROM public.ediel_test_run_messages l WHERE l.ediel_message_id=m.id AND l.test_run_id=w.run_id AND l.step_no=w.step_no) THEN RAISE EXCEPTION 'ediel_negative_fixture_actual_run_link_required';END IF;
 PERFORM gridex_negative_fixtures.assert_actor_v1(w.actor_user_id,p_company,'communication.send');PERFORM gridex_ediel_outbound_owner.require_v1(p_company,m.id);
 tokens:=gridex_received_sources.wire_tokens_bounded_v1(m.raw_payload,999999);
 IF tokens IS NULL OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNH')<>1 OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='BGM')<>1 THEN RAISE EXCEPTION 'ediel_negative_fixture_physical_message_required';END IF;
 SELECT t#>>'{elements,1,0}' INTO code FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='BGM';
 IF code IS DISTINCT FROM m.message_code OR (p_expected_code IS NOT NULL AND code IS DISTINCT FROM p_expected_code) THEN RAISE EXCEPTION 'ediel_negative_fixture_physical_message_required';END IF;
 RETURN w.qualification;
END $$;
REVOKE ALL ON FUNCTION gridex_negative_fixtures.read_negative_preparation_v1(jsonb),gridex_negative_fixtures.prepare_negative_v1(jsonb),gridex_negative_fixtures.prepared_negative_fixture_v1(uuid,uuid,text,uuid),gridex_negative_fixtures.consume_negative_v1(),gridex_negative_fixtures.require_negative_message_v1(uuid,uuid,text),public.gridex_ediel_negative_fixture_prepare_read_v1(jsonb),public.gridex_ediel_negative_fixture_prepare_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role,gridex_ediel_fixture_authority_owner;
GRANT EXECUTE ON FUNCTION gridex_negative_fixtures.read_negative_preparation_v1(jsonb),gridex_negative_fixtures.prepare_negative_v1(jsonb),gridex_negative_fixtures.prepared_negative_fixture_v1(uuid,uuid,text,uuid),gridex_negative_fixtures.require_negative_message_v1(uuid,uuid,text),public.gridex_ediel_negative_fixture_prepare_read_v1(jsonb),public.gridex_ediel_negative_fixture_prepare_v1(jsonb) TO service_role;
COMMIT;
