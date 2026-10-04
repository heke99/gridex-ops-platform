-- Prospective source-proof permission correction. The actual transport journal
-- still checks communication.send on its current sender; a frozen original
-- is not invalid merely because its legitimate draft preparer cannot send.
BEGIN;
CREATE OR REPLACE FUNCTION gridex_negative_fixtures.require_positive_message_v1(p_company uuid,p_message uuid,p_expected_code text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;f gridex_negative_fixtures.positive_originals%rowtype;w gridex_negative_fixtures.positive_witnesses%rowtype;r public.ediel_test_runs%rowtype;tokens jsonb;code text;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_message AND company_id=p_company AND environment='test' AND direction='outbound' AND message_standard='edifact' FOR SHARE;
 SELECT witness.* INTO w FROM gridex_negative_fixtures.positive_consumptions c JOIN gridex_negative_fixtures.positive_witnesses witness ON witness.id=c.witness_id WHERE c.message_id=m.id AND c.company_id=p_company FOR SHARE OF witness;
 IF w.id IS NULL OR m.execution_context_snapshot->>'sourceQualifiedPositiveFixtureWitnessId' IS DISTINCT FROM w.id::text THEN RAISE EXCEPTION 'ediel_positive_fixture_original_required';END IF;
 SELECT * INTO STRICT f FROM gridex_negative_fixtures.positive_originals WHERE id=w.registration_id FOR SHARE;
 SELECT * INTO STRICT r FROM public.ediel_test_runs WHERE id=w.run_id AND company_id=p_company AND environment='test' AND status IN('draft','running') FOR SHARE;
 IF m.raw_payload IS DISTINCT FROM f.original_wire OR r.role_code IS DISTINCT FROM f.role_code OR r.test_case_code IS DISTINCT FROM f.case_code OR r.test_suite IS DISTINCT FROM f.suite OR r.approval_version IS DISTINCT FROM f.revision OR f.valid_until<=clock_timestamp() THEN RAISE EXCEPTION 'ediel_positive_fixture_current_run_required';END IF;
 IF (SELECT count(*) FROM public.ediel_test_run_messages l WHERE l.ediel_message_id=m.id)<>1 OR NOT EXISTS(SELECT FROM public.ediel_test_run_messages l WHERE l.ediel_message_id=m.id AND l.test_run_id=w.run_id AND l.step_no=w.step_no) THEN RAISE EXCEPTION 'ediel_positive_fixture_actual_run_link_required';END IF;
 PERFORM gridex_negative_fixtures.assert_prepare_actor_v1(w.actor_user_id,p_company);PERFORM gridex_ediel_outbound_owner.require_v1(p_company,m.id);
 tokens:=gridex_received_sources.wire_tokens_bounded_v1(m.raw_payload,999999);
 IF tokens IS NULL OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNH')<>1 OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='BGM')<>1 THEN RAISE EXCEPTION 'ediel_positive_fixture_physical_message_required';END IF;
 SELECT t#>>'{elements,1,0}' INTO code FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='BGM';
 IF code IS DISTINCT FROM m.message_code OR (p_expected_code IS NOT NULL AND code IS DISTINCT FROM p_expected_code) THEN RAISE EXCEPTION 'ediel_positive_fixture_physical_message_required';END IF;
 RETURN w.qualification;
END $$;
CREATE OR REPLACE FUNCTION gridex_negative_fixtures.require_negative_message_v1(p_company uuid,p_message uuid,p_expected_code text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;f gridex_negative_fixtures.originals%rowtype;w gridex_negative_fixtures.negative_prepared_witnesses%rowtype;r public.ediel_test_runs%rowtype;tokens jsonb;code text;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_message AND company_id=p_company AND environment='test' AND direction='outbound' AND message_standard='edifact' FOR SHARE;
 SELECT witness.* INTO w FROM gridex_negative_fixtures.negative_prepared_consumptions c JOIN gridex_negative_fixtures.negative_prepared_witnesses witness ON witness.id=c.witness_id WHERE c.message_id=m.id AND c.company_id=p_company FOR SHARE OF witness;
 IF w.id IS NULL OR m.execution_context_snapshot->>'sourceQualifiedNegativeFixtureWitnessId' IS DISTINCT FROM w.id::text THEN RAISE EXCEPTION 'ediel_negative_fixture_original_required';END IF;
 SELECT * INTO STRICT f FROM gridex_negative_fixtures.originals WHERE id=w.registration_id FOR SHARE;
 SELECT * INTO STRICT r FROM public.ediel_test_runs WHERE id=w.run_id AND company_id=p_company AND environment='test' AND status IN('draft','running') FOR SHARE;
 IF m.raw_payload IS DISTINCT FROM f.original_wire OR r.role_code IS DISTINCT FROM f.role_code OR r.test_case_code IS DISTINCT FROM f.case_code OR r.test_suite IS DISTINCT FROM f.suite OR r.approval_version IS DISTINCT FROM f.revision OR f.valid_until<=clock_timestamp() THEN RAISE EXCEPTION 'ediel_negative_fixture_current_run_required';END IF;
 IF (SELECT count(*) FROM public.ediel_test_run_messages l WHERE l.ediel_message_id=m.id)<>1 OR NOT EXISTS(SELECT FROM public.ediel_test_run_messages l WHERE l.ediel_message_id=m.id AND l.test_run_id=w.run_id AND l.step_no=w.step_no) THEN RAISE EXCEPTION 'ediel_negative_fixture_actual_run_link_required';END IF;
 PERFORM gridex_negative_fixtures.assert_prepare_actor_v1(w.actor_user_id,p_company);PERFORM gridex_ediel_outbound_owner.require_v1(p_company,m.id);
 tokens:=gridex_received_sources.wire_tokens_bounded_v1(m.raw_payload,999999);
 IF tokens IS NULL OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNH')<>1 OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='BGM')<>1 THEN RAISE EXCEPTION 'ediel_negative_fixture_physical_message_required';END IF;
 SELECT t#>>'{elements,1,0}' INTO code FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='BGM';
 IF code IS DISTINCT FROM m.message_code OR (p_expected_code IS NOT NULL AND code IS DISTINCT FROM p_expected_code) THEN RAISE EXCEPTION 'ediel_negative_fixture_physical_message_required';END IF;
 RETURN w.qualification;
END $$;
COMMIT;
