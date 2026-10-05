-- Supabase CLI migration new ediel_source_qualified_negative_fixture_v1.
-- Original negative certification files only. No authentic file, owner grant,
-- expected diagnostic or permission to send to a market actor is seeded here.
BEGIN;
CREATE ROLE gridex_ediel_fixture_authority_owner NOLOGIN;
CREATE SCHEMA gridex_negative_fixtures;
REVOKE ALL ON SCHEMA gridex_negative_fixtures FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA gridex_negative_fixtures TO service_role,gridex_ediel_fixture_authority_owner;
CREATE TABLE gridex_negative_fixtures.originals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES public.companies(id),run_id uuid NOT NULL REFERENCES public.ediel_test_runs(id) ON DELETE RESTRICT,
 role_code text NOT NULL,case_code text NOT NULL,suite text NOT NULL,revision text NOT NULL,step_no integer NOT NULL CHECK(step_no>0),
 source_reference text NOT NULL CHECK(length(source_reference)>0),owner_decision_reference text NOT NULL CHECK(length(owner_decision_reference)>0),
 original_file_sha256 text NOT NULL CHECK(original_file_sha256~'^[a-f0-9]{64}$'),wire_sha256 text NOT NULL CHECK(wire_sha256=original_file_sha256),original_wire text NOT NULL,
 expected_outcome text NOT NULL CHECK(expected_outcome='negative'),expected_diagnostic_codes jsonb NOT NULL CHECK(jsonb_typeof(expected_diagnostic_codes)='array' AND jsonb_array_length(expected_diagnostic_codes) BETWEEN 1 AND 256),
 test_receiver_ediel_id text NOT NULL CHECK(length(test_receiver_ediel_id)>0),valid_until timestamptz NOT NULL,published_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,run_id,step_no,revision,wire_sha256)
);
ALTER TABLE gridex_negative_fixtures.originals ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_negative_fixtures.originals FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_negative_fixtures.originals FROM PUBLIC,anon,authenticated,service_role,gridex_ediel_fixture_authority_owner;
CREATE FUNCTION gridex_negative_fixtures.immutable_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN RAISE EXCEPTION 'ediel_negative_original_immutable';END$$;
CREATE TRIGGER negative_original_immutable BEFORE UPDATE OR DELETE ON gridex_negative_fixtures.originals FOR EACH ROW EXECUTE FUNCTION gridex_negative_fixtures.immutable_v1();
REVOKE ALL ON FUNCTION gridex_negative_fixtures.immutable_v1() FROM PUBLIC,anon,authenticated,service_role,gridex_ediel_fixture_authority_owner;
-- Public-original decoding only. This bijection avoids platform conversion
-- modules and never substitutes UTF8 bytes for the registered Latin1 original.
CREATE FUNCTION gridex_negative_fixtures.decode_latin1_v1(original bytea) RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
 SELECT string_agg(chr(get_byte(original,i)),'' ORDER BY i) FROM generate_series(0,octet_length(original)-1) i
$$;
REVOKE ALL ON FUNCTION gridex_negative_fixtures.decode_latin1_v1(bytea) FROM PUBLIC,anon,authenticated,service_role,gridex_ediel_fixture_authority_owner;
CREATE FUNCTION gridex_negative_fixtures.assert_actor_v1(actor uuid,company uuid,permission text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF actor IS NULL OR company IS NULL OR NOT EXISTS(SELECT FROM public.company_memberships x WHERE x.company_id=company AND x.user_id=actor AND x.status='active' AND x.is_active AND x.accepted_at IS NOT NULL)
 OR NOT EXISTS(SELECT FROM public.user_profiles x WHERE x.id=actor AND x.user_status='active') OR NOT coalesce(public.gridex_actor_has_company_permission(actor,company,permission),false)
 THEN RAISE EXCEPTION 'ediel_negative_fixture_actor_not_authorized' USING ERRCODE='42501';END IF;
END$$;
REVOKE ALL ON FUNCTION gridex_negative_fixtures.assert_actor_v1(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role,gridex_ediel_fixture_authority_owner;
CREATE FUNCTION gridex_negative_fixtures.publish_v1(p_context jsonb,p_original bytea,p_publisher text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.ediel_test_runs%rowtype;prior gridex_negative_fixtures.originals%rowtype;wire text;hash text;result uuid;diagnostics jsonb:=p_context->'expectedDiagnosticCodes';
BEGIN
 IF p_publisher IS DISTINCT FROM 'gridex_ediel_fixture_authority_owner' OR p_original IS NULL OR octet_length(p_original) NOT BETWEEN 1 AND 10485760
 OR jsonb_typeof(diagnostics) IS DISTINCT FROM 'array' OR jsonb_array_length(diagnostics) NOT BETWEEN 1 AND 256
 OR EXISTS(SELECT FROM jsonb_array_elements(diagnostics) d WHERE jsonb_typeof(d)<>'string' OR length(d#>>'{}') NOT BETWEEN 1 AND 128)
 OR p_context->>'expectedOutcome' IS DISTINCT FROM 'negative' OR nullif(p_context->>'sourceReference','') IS NULL OR nullif(p_context->>'ownerDecisionReference','') IS NULL
 THEN RAISE EXCEPTION 'ediel_negative_fixture_qualified_original_required';END IF;
 SELECT * INTO STRICT r FROM public.ediel_test_runs WHERE id=(p_context->>'runId')::uuid AND company_id=(p_context->>'companyId')::uuid AND environment='test' FOR SHARE;
 PERFORM gridex_negative_fixtures.assert_actor_v1((p_context->>'actorUserId')::uuid,r.company_id,'communication.write');
 IF r.role_code IS DISTINCT FROM p_context->>'roleCode' OR r.test_case_code IS DISTINCT FROM p_context->>'caseCode' OR r.test_suite IS DISTINCT FROM p_context->>'suite'
 OR r.approval_version IS DISTINCT FROM p_context->>'revision' OR (p_context->>'stepNo')::integer<=0 OR (p_context->>'validUntil')::timestamptz<=now()
 THEN RAISE EXCEPTION 'ediel_negative_fixture_run_scope_mismatch';END IF;
 wire:=gridex_negative_fixtures.decode_latin1_v1(p_original);hash:=encode(sha256(p_original),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(r.id::text||'|'||(p_context->>'stepNo')||'|'||hash,0));
 SELECT * INTO prior FROM gridex_negative_fixtures.originals WHERE company_id=r.company_id AND run_id=r.id AND step_no=(p_context->>'stepNo')::integer AND revision=r.approval_version AND wire_sha256=hash;
 IF FOUND THEN
  IF prior.expected_diagnostic_codes IS DISTINCT FROM diagnostics OR prior.test_receiver_ediel_id IS DISTINCT FROM p_context->>'testReceiverEdielId'
   OR prior.source_reference IS DISTINCT FROM p_context->>'sourceReference' OR prior.owner_decision_reference IS DISTINCT FROM p_context->>'ownerDecisionReference'
   OR prior.valid_until IS DISTINCT FROM (p_context->>'validUntil')::timestamptz THEN RAISE EXCEPTION 'ediel_negative_fixture_original_conflict';END IF;
  RETURN prior.id;
 END IF;
 INSERT INTO gridex_negative_fixtures.originals(company_id,run_id,role_code,case_code,suite,revision,step_no,source_reference,owner_decision_reference,original_file_sha256,wire_sha256,original_wire,expected_outcome,expected_diagnostic_codes,test_receiver_ediel_id,valid_until)
 VALUES(r.company_id,r.id,r.role_code,r.test_case_code,r.test_suite,r.approval_version,(p_context->>'stepNo')::integer,p_context->>'sourceReference',p_context->>'ownerDecisionReference',hash,hash,wire,'negative',diagnostics,p_context->>'testReceiverEdielId',(p_context->>'validUntil')::timestamptz) RETURNING id INTO result;
 RETURN result;
END$$;
REVOKE ALL ON FUNCTION gridex_negative_fixtures.publish_v1(jsonb,bytea,text) FROM PUBLIC,anon,authenticated,service_role,gridex_ediel_fixture_authority_owner;
GRANT EXECUTE ON FUNCTION gridex_negative_fixtures.publish_v1(jsonb,bytea,text) TO gridex_ediel_fixture_authority_owner;
CREATE FUNCTION public.gridex_ediel_negative_fixture_publish_v1(p_context jsonb,p_original bytea) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN IF current_user<>'gridex_ediel_fixture_authority_owner' THEN RAISE EXCEPTION 'ediel_negative_fixture_source_owner_required' USING ERRCODE='42501';END IF;
 RETURN gridex_negative_fixtures.publish_v1(p_context,p_original,current_user);END$$;
REVOKE ALL ON FUNCTION public.gridex_ediel_negative_fixture_publish_v1(jsonb,bytea) FROM PUBLIC,anon,authenticated,service_role,gridex_ediel_fixture_authority_owner;
GRANT EXECUTE ON FUNCTION public.gridex_ediel_negative_fixture_publish_v1(jsonb,bytea) TO gridex_ediel_fixture_authority_owner;
CREATE FUNCTION gridex_negative_fixtures.read_v1(p_context jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.ediel_test_runs%rowtype;m public.ediel_messages%rowtype;run_id uuid;step integer;company uuid:=(p_context->>'companyId')::uuid;wire text:=p_context->>'rawPayload';f gridex_negative_fixtures.originals%rowtype;tokens jsonb;receiver text;
BEGIN
 IF p_context->>'messageId' IS NOT NULL THEN
  SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=(p_context->>'messageId')::uuid AND company_id=company AND direction='outbound' AND environment='test' AND message_standard='edifact';
  SELECT l.test_run_id,l.step_no INTO STRICT run_id,step FROM public.ediel_test_run_messages l JOIN public.ediel_test_runs x ON x.id=l.test_run_id AND x.company_id=m.company_id AND x.environment='test' WHERE l.ediel_message_id=m.id;
  wire:=m.raw_payload;
 ELSE run_id:=(p_context->>'runId')::uuid;step:=(p_context->>'stepNo')::integer;END IF;
 SELECT * INTO STRICT r FROM public.ediel_test_runs WHERE id=run_id AND company_id=company AND environment='test' AND status IN ('draft','running') FOR SHARE;
 PERFORM gridex_negative_fixtures.assert_actor_v1((p_context->>'actorUserId')::uuid,company,'communication.send');
 SELECT * INTO f FROM gridex_negative_fixtures.originals WHERE company_id=company AND originals.run_id=r.id AND step_no=step AND revision=r.approval_version
  -- Exact text equality to the bijectively decoded stored original is required.
  -- The server adapter additionally recomputes its actual Latin1 byte hash.
  AND role_code=r.role_code AND case_code=r.test_case_code AND suite=r.test_suite AND original_wire=wire AND valid_until>now();
 IF NOT FOUND THEN RETURN NULL;END IF;
 tokens:=gridex_received_sources.wire_tokens_bounded_v1(wire,999999);
 IF tokens IS NULL OR (SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='UNB')<>1 THEN RETURN NULL;END IF;
 SELECT t#>>'{elements,3,0}' INTO receiver FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='UNB';
 IF receiver IS DISTINCT FROM f.test_receiver_ediel_id THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('registrationId',f.id,'companyId',company,'runId',r.id,'roleCode',r.role_code,'caseCode',r.test_case_code,'suite',r.test_suite,'revision',r.approval_version,'stepNo',step,'wireSha256',f.wire_sha256,'originalFileSha256',f.original_file_sha256,'expectedOutcome','negative','expectedDiagnosticCodes',f.expected_diagnostic_codes,'testReceiverEdielId',receiver,'validUntil',f.valid_until,'sourceReference',f.source_reference,'ownerDecisionReference',f.owner_decision_reference);
END$$;
REVOKE ALL ON FUNCTION gridex_negative_fixtures.read_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role,gridex_ediel_fixture_authority_owner;
GRANT EXECUTE ON FUNCTION gridex_negative_fixtures.read_v1(jsonb) TO service_role;
CREATE FUNCTION public.gridex_ediel_negative_fixture_read_v1(p_context jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'ediel_negative_fixture_service_required' USING ERRCODE='42501';END IF;
 RETURN gridex_negative_fixtures.read_v1(p_context);END$$;
REVOKE ALL ON FUNCTION public.gridex_ediel_negative_fixture_read_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role,gridex_ediel_fixture_authority_owner;
GRANT EXECUTE ON FUNCTION public.gridex_ediel_negative_fixture_read_v1(jsonb) TO service_role;
COMMIT;
