-- Created with Supabase CLI2.118.0.
-- Periodic DGI E66 reason follows U25A2 and OE2g. An alternate reason is
-- an actual bilateral source fact, separately reviewed, never a caller flag.
BEGIN;
CREATE TABLE gridex_ediel_services.periodic_reason_reviews(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),
 artifact_id uuid NOT NULL REFERENCES gridex_ediel_services.artifacts(id),evidence_id uuid NOT NULL REFERENCES public.ediel_service_evidence(id),
 generic_review_id uuid NOT NULL REFERENCES gridex_ediel_services.reviews(id),scope_basis_version bigint NOT NULL CHECK(scope_basis_version>0),
 claims jsonb NOT NULL CHECK(jsonb_typeof(claims)='object'),claims_hash text NOT NULL CHECK(claims_hash~'^[a-f0-9]{64}$'),
 reviewer_user_id uuid NOT NULL,review_sequence bigint NOT NULL CHECK(review_sequence>0),
 decision text NOT NULL CHECK(decision IN('approved','held','rejected')),reason text NOT NULL,reviewed_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,evidence_id,review_sequence)
);
ALTER TABLE gridex_ediel_services.periodic_reason_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_ediel_services.periodic_reason_reviews FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_ediel_services.periodic_reason_reviews FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_ediel_services.periodic_reason_immutable_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN RAISE EXCEPTION 'ediel_periodic_reason_review_immutable';END$$;
CREATE TRIGGER periodic_reason_review_immutable BEFORE UPDATE OR DELETE ON gridex_ediel_services.periodic_reason_reviews
 FOR EACH ROW EXECUTE FUNCTION gridex_ediel_services.periodic_reason_immutable_v1();
CREATE TRIGGER periodic_reason_review_no_truncate BEFORE TRUNCATE ON gridex_ediel_services.periodic_reason_reviews
 FOR EACH STATEMENT EXECUTE FUNCTION gridex_ediel_services.periodic_reason_immutable_v1();
CREATE FUNCTION gridex_ediel_services.lock_periodic_reason_graph_v1(writing boolean DEFAULT false) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 PERFORM gridex_ediel_services.lock_evidence_graph_v1();
 IF writing THEN LOCK TABLE gridex_ediel_services.periodic_reason_reviews IN SHARE ROW EXCLUSIVE MODE;
 ELSE LOCK TABLE gridex_ediel_services.periodic_reason_reviews IN SHARE MODE;END IF;
END $$;
CREATE FUNCTION gridex_ediel_services.signed_periodic_reason_claims_v1(artifact gridex_ediel_services.artifacts) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE payload jsonb;claims jsonb;a public.ediel_service_assignments%rowtype;sender_ids text[];receiver_ids text[];
BEGIN
 PERFORM gridex_ediel_services.lock_periodic_reason_graph_v1();
 IF artifact.evidence_kind NOT IN('dso_contract','service_contract') OR gridex_ediel_services.receipt_current_v1(artifact) IS NOT TRUE THEN RETURN NULL;END IF;
 -- Decode only after authenticating the exact original signed payload bytes.
 payload:=convert_from(decode(artifact.issuer_receipt->>'payloadBase64','base64'),'UTF8')::jsonb;
 claims:=payload->'periodicE66Reason';
 IF jsonb_typeof(claims) IS DISTINCT FROM 'object' OR EXISTS(SELECT FROM jsonb_object_keys(claims) k WHERE k NOT IN('version','reasonCode','applicationReference','senderEdielId','receiverEdielId'))
 OR claims->'version' IS DISTINCT FROM '1'::jsonb OR (claims->>'reasonCode' IN('E23','E88')) IS NOT TRUE
 OR (claims->>'applicationReference'~'^23-DGI-E66-(S|T)$') IS NOT TRUE THEN RETURN NULL;END IF;
 SELECT * INTO a FROM public.ediel_service_assignments WHERE company_id=artifact.company_id AND id=artifact.assignment_id;
 IF a.id IS NULL OR a.scope_basis_version IS DISTINCT FROM artifact.scope_basis_version OR artifact.scope IS DISTINCT FROM gridex_service_administration.scope_v1(a) THEN RETURN NULL;END IF;
 SELECT array_agg(DISTINCT i.identifier_value ORDER BY i.identifier_value) INTO sender_ids FROM public.platform_actor_identifiers i
  WHERE i.actor_id=a.dso_actor_id AND lower(i.identifier_type) IN('edielid','ediel_id') AND i.is_verified
  AND (i.valid_from IS NULL OR i.valid_from<=current_date) AND (i.valid_to IS NULL OR i.valid_to>=current_date);
 SELECT array_agg(DISTINCT i.identifier_value ORDER BY i.identifier_value) INTO receiver_ids FROM public.tenant_actor_identifiers i
  WHERE i.company_id=a.company_id AND i.actor_id=a.provider_actor_id AND i.environment=a.environment AND i.identifier_type='EdielId'
  AND i.valid_from<=now() AND (i.valid_to IS NULL OR i.valid_to>now());
 IF cardinality(sender_ids) IS DISTINCT FROM 1 OR cardinality(receiver_ids) IS DISTINCT FROM 1
 OR claims->>'senderEdielId' IS DISTINCT FROM sender_ids[1] OR claims->>'receiverEdielId' IS DISTINCT FROM receiver_ids[1]
 OR sender_ids[1]!~'^[0-9]{5}$' OR receiver_ids[1]!~'^[0-9]{5}$' THEN RETURN NULL;END IF;
 RETURN claims;
EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value OR character_not_in_repertoire THEN RETURN NULL;
END $$;
CREATE FUNCTION public.ediel_review_periodic_e66_reason_v1(p_company_id uuid,p_actor_user_id uuid,p_artifact_id uuid,p_evidence_id uuid,p_review jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE artifact gridex_ediel_services.artifacts%rowtype;e public.ediel_service_evidence%rowtype;generic gridex_ediel_services.reviews%rowtype;
 claims jsonb;v gridex_ediel_services.periodic_reason_reviews%rowtype;seq bigint;decision text;
BEGIN
 PERFORM gridex_ediel_services.lock_periodic_reason_graph_v1(true);
 IF gridex_ediel_services.actor_current_v1(p_company_id,p_actor_user_id,true) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_periodic_reason_reviewer_forbidden' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(p_review) IS DISTINCT FROM 'object' OR EXISTS(SELECT FROM jsonb_object_keys(p_review) k WHERE k NOT IN('decision','reason','sourceHash','scopeHash'))
 OR (p_review->>'decision' IN('approve','hold','reject')) IS NOT TRUE OR nullif(btrim(p_review->>'reason'),'') IS NULL OR length(p_review->>'reason')>2000 THEN RAISE EXCEPTION 'ediel_periodic_reason_review_shape_invalid';END IF;
 SELECT * INTO artifact FROM gridex_ediel_services.artifacts WHERE company_id=p_company_id AND id=p_artifact_id;
 SELECT * INTO e FROM public.ediel_service_evidence WHERE company_id=p_company_id AND id=p_evidence_id FOR SHARE;
 SELECT * INTO generic FROM gridex_ediel_services.reviews WHERE company_id=p_company_id AND artifact_id=p_artifact_id AND evidence_id=p_evidence_id ORDER BY review_sequence DESC LIMIT 1;
 IF artifact.id IS NULL OR e.id IS NULL OR generic.id IS NULL OR artifact.submitted_by=p_actor_user_id OR generic.decision<>'approved' OR generic.id IS DISTINCT FROM (SELECT r.id FROM gridex_ediel_services.reviews r WHERE r.company_id=p_company_id AND r.evidence_id=p_evidence_id ORDER BY r.review_sequence DESC LIMIT 1)
 OR generic.artifact_id IS DISTINCT FROM artifact.id OR generic.scope_basis_version IS DISTINCT FROM artifact.scope_basis_version
 OR gridex_ediel_services.review_current_v1(e) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_periodic_reason_separate_current_review_required';END IF;
 IF artifact.source_hash IS DISTINCT FROM p_review->>'sourceHash' OR artifact.scope_hash IS DISTINCT FROM p_review->>'scopeHash' THEN RAISE EXCEPTION 'ediel_periodic_reason_review_original_hash_required';END IF;
 claims:=gridex_ediel_services.signed_periodic_reason_claims_v1(artifact);
 IF claims IS NULL THEN RAISE EXCEPTION 'ediel_periodic_reason_signed_bilateral_claim_required';END IF;
 SELECT coalesce(max(review_sequence),0)+1 INTO seq FROM gridex_ediel_services.periodic_reason_reviews WHERE company_id=p_company_id AND evidence_id=p_evidence_id;
 decision:=CASE p_review->>'decision' WHEN 'approve' THEN 'approved' WHEN 'reject' THEN 'rejected' ELSE 'held' END;
 INSERT INTO gridex_ediel_services.periodic_reason_reviews(company_id,artifact_id,evidence_id,generic_review_id,scope_basis_version,claims,claims_hash,reviewer_user_id,review_sequence,decision,reason)
 VALUES(p_company_id,artifact.id,e.id,generic.id,artifact.scope_basis_version,claims,encode(sha256(convert_to(claims::text,'UTF8')),'hex'),p_actor_user_id,seq,decision,p_review->>'reason') RETURNING * INTO v;
 RETURN jsonb_build_object('version',1,'reviewId',v.id,'companyId',v.company_id,'artifactId',v.artifact_id,'evidenceId',v.evidence_id,'reviewSequence',v.review_sequence,'status',v.decision,'claimsHash',v.claims_hash,'reasonCode',claims->>'reasonCode','marketActivationGranted',false);
END $$;
CREATE FUNCTION gridex_ediel_services.current_periodic_reason_agreement_v1(a public.ediel_service_assignments,app text,sender text,receiver text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE k text;e public.ediel_service_evidence%rowtype;artifact gridex_ediel_services.artifacts%rowtype;v gridex_ediel_services.periodic_reason_reviews%rowtype;claims jsonb;result jsonb:='[]';candidate jsonb;
BEGIN
 PERFORM gridex_ediel_services.lock_periodic_reason_graph_v1();
 FOREACH k IN ARRAY ARRAY['dso_contract','service_contract'] LOOP
  candidate:=NULL;
  FOR e IN SELECT x.* FROM public.ediel_service_evidence x WHERE x.company_id=a.company_id AND x.assignment_id=a.id AND x.kind=k AND x.status='verified' ORDER BY x.id LOOP
   SELECT * INTO v FROM gridex_ediel_services.periodic_reason_reviews WHERE company_id=a.company_id AND evidence_id=e.id ORDER BY review_sequence DESC LIMIT 1;
   IF v.id IS NULL OR v.decision<>'approved' OR v.generic_review_id IS DISTINCT FROM (SELECT r.id FROM gridex_ediel_services.reviews r WHERE r.company_id=a.company_id AND r.evidence_id=e.id ORDER BY r.review_sequence DESC LIMIT 1) OR v.scope_basis_version IS DISTINCT FROM a.scope_basis_version OR gridex_ediel_services.actor_current_v1(a.company_id,v.reviewer_user_id,true) IS NOT TRUE OR gridex_ediel_services.review_current_v1(e) IS NOT TRUE THEN CONTINUE;END IF;
   SELECT * INTO artifact FROM gridex_ediel_services.artifacts WHERE company_id=a.company_id AND id=v.artifact_id;
   claims:=gridex_ediel_services.signed_periodic_reason_claims_v1(artifact);
   IF claims IS NULL OR claims IS DISTINCT FROM v.claims OR v.claims_hash IS DISTINCT FROM encode(sha256(convert_to(claims::text,'UTF8')),'hex')
   OR claims->>'applicationReference' IS DISTINCT FROM app OR claims->>'senderEdielId' IS DISTINCT FROM sender OR claims->>'receiverEdielId' IS DISTINCT FROM receiver THEN CONTINUE;END IF;
   IF candidate IS NOT NULL THEN RAISE EXCEPTION 'ediel_periodic_reason_agreement_ambiguous';END IF;
   candidate:=jsonb_build_object('reasonCode',claims->>'reasonCode','kind',k,'reviewId',v.id,'claimsHash',v.claims_hash,'artifactId',artifact.id,'sourceHash',artifact.source_hash,'scopeHash',artifact.scope_hash,'assignmentId',a.id,'scopeBasisVersion',a.scope_basis_version);
  END LOOP;
  IF candidate IS NULL THEN RETURN NULL;END IF;
  result:=result||jsonb_build_array(candidate);
 END LOOP;
 IF (SELECT count(DISTINCT x->>'reasonCode') FROM jsonb_array_elements(result)x)<>1 THEN RAISE EXCEPTION 'ediel_periodic_reason_contract_agreement_conflict';END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION gridex_ediel_services.lock_periodic_reason_graph_v1(boolean),gridex_ediel_services.signed_periodic_reason_claims_v1(gridex_ediel_services.artifacts),gridex_ediel_services.current_periodic_reason_agreement_v1(public.ediel_service_assignments,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.ediel_review_periodic_e66_reason_v1(uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_review_periodic_e66_reason_v1(uuid,uuid,uuid,uuid,jsonb) TO service_role;

-- Read-only national reason qualification. This proves neither accepted series
-- nor permission to write business data; existing private storage gates remain.
CREATE FUNCTION gridex_ediel_services.periodic_reason_projection_v1(c uuid,env text,sourceid uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE ctx jsonb;source public.ediel_messages%rowtype;tokens jsonb;own jsonb;proof jsonb;agreement jsonb;a public.ediel_service_assignments%rowtype;
 sender text;receiver text;app text;point text;product text;period text;offset_value text;received text;reason text;own_start int;own_end int;header_end int;idx int:=0;
 v_start timestamptz;v_end timestamptz;dso_ids text[];upstream jsonb;current_upstream jsonb;scopes jsonb;agreements jsonb;result jsonb:='[]';scope jsonb;
BEGIN
 PERFORM gridex_ediel_services.lock_periodic_reason_graph_v1();
 ctx:=gridex_ediel_ack_replay.require_current_source_role_v2(c,env,sourceid);
 SELECT * INTO STRICT source FROM public.ediel_messages WHERE company_id=c AND id=sourceid AND environment=env FOR SHARE;
 tokens:=gridex_utilts_binding.wire_tokens_v1(source.raw_payload);
 IF tokens IS NULL OR ctx->>'family' IS DISTINCT FROM 'UTILTS' OR ctx->>'code' IS DISTINCT FROM 'E66'
 OR source.direction IS DISTINCT FROM 'inbound' OR source.message_standard IS DISTINCT FROM 'edifact' OR source.message_family IS DISTINCT FROM 'UTILTS' OR source.message_code IS DISTINCT FROM 'E66' THEN RAISE EXCEPTION 'ediel_periodic_reason_current_source_required';END IF;
 -- A qualified different receiver role is outside this ESCO contract gate.
 -- Missing/stale role is rejected by the actual current-role owner above.
 IF (ctx->>'actorRole' IN('energy_service_company','esco')) IS NOT TRUE THEN
  RETURN jsonb_build_object('version',1,'companyId',c,'environment',env,'sourceMessageId',sourceid,'sourcePayloadHash',encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex'),'status','not_applicable','expectedReasons','[]'::jsonb,'holdReason',NULL);
 END IF;
 SELECT x#>>'{elements,7,0}' INTO STRICT app FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='UNB';
 SELECT x#>>'{elements,2,0}' INTO STRICT sender FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='NAD' AND x#>>'{elements,1,0}'='MS';
 SELECT x#>>'{elements,2,0}' INTO STRICT receiver FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='NAD' AND x#>>'{elements,1,0}'='MR';
 IF (app~'^23-DGI-E66-(S|T)$') IS NOT TRUE OR app IS DISTINCT FROM ctx->>'applicationReference' OR app IS DISTINCT FROM source.application_reference
 OR receiver IS DISTINCT FROM ctx->>'legalEdielId' OR sender!~'^[0-9]{5}$' OR receiver!~'^[0-9]{5}$'
 OR (SELECT count(*) FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='NAD' AND x#>>'{elements,1,0}'='DGI')<>1 THEN RAISE EXCEPTION 'ediel_periodic_reason_legal_parties_required';END IF;
 SELECT x#>>'{elements,1,1}' INTO STRICT offset_value FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='DTM' AND x#>>'{elements,1,0}'='735' AND x#>>'{elements,1,2}'='406';
 FOR own IN SELECT value FROM jsonb_array_elements(tokens) WITH ORDINALITY x(value,n) WHERE value->>'tag'='IDE' ORDER BY n LOOP
  own_start:=(own->>'index')::int;
  SELECT min((x->>'index')::int) INTO own_end FROM jsonb_array_elements(tokens)x WHERE (x->>'index')::int>own_start AND x->>'tag' IN('IDE','UNT');
  SELECT coalesce(min((x->>'index')::int),own_end) INTO header_end FROM jsonb_array_elements(tokens)x WHERE (x->>'index')::int>own_start AND (x->>'index')::int<own_end AND x->>'tag'='SEQ';
  SELECT x#>>'{elements,3,0}' INTO STRICT product FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='LIN' AND (x->>'index')::int>own_start AND (x->>'index')::int<header_end AND x#>>'{elements,3,3}'='9';
  SELECT x#>>'{elements,1,1}' INTO STRICT period FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='DTM' AND (x->>'index')::int>own_start AND (x->>'index')::int<header_end AND x#>>'{elements,1,0}'='324' AND x#>>'{elements,1,2}'='719';
  SELECT x#>>'{elements,3,0}' INTO STRICT received FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='STS' AND (x->>'index')::int>own_start AND (x->>'index')::int<header_end AND x#>>'{elements,1,0}'='7';
  point:=gridex_utilts_binding.supported_point_v1(tokens,own#>>'{elements,2,0}');
  v_start:=gridex_utilts_binding.esco_local_time_v1(substr(period,1,12),offset_value);v_end:=gridex_utilts_binding.esco_local_time_v1(substr(period,13,12),offset_value);
  IF point IS NULL OR period!~'^[0-9]{24}$' OR v_start IS NULL OR v_end IS NULL OR v_end<=v_start THEN RAISE EXCEPTION 'ediel_periodic_reason_physical_scope_required';END IF;
  -- National communication evidence is separate from positive data approval.
  -- No current grant/Z14 is demanded to qualify this own negative condition.
  -- The real accepted-storage owner still checks its full grant set separately.
  scopes:='[]';agreements:='[]';reason:=NULL;upstream:=NULL;
  FOR a IN SELECT x.* FROM public.ediel_service_assignments x WHERE x.company_id=c AND x.environment=env
   AND x.provider_actor_id::text=ctx->>'legalActorId' AND x.actor_profile_id::text=ctx#>>'{facts,profile,id}'
   AND x.status='active' AND x.valid_from<=now() AND (x.valid_to IS NULL OR now()<x.valid_to)
   AND point=ANY(x.object_ids) AND product=ANY(x.product_ids) AND v_start>=x.data_start AND (x.data_end IS NULL OR v_end<=x.data_end) ORDER BY x.id LOOP
   SELECT array_agg(DISTINCT i.identifier_value ORDER BY i.identifier_value) INTO dso_ids FROM public.platform_actor_identifiers i
    WHERE i.actor_id=a.dso_actor_id AND lower(i.identifier_type) IN('edielid','ediel_id') AND i.is_verified AND (i.valid_from IS NULL OR i.valid_from<=current_date) AND (i.valid_to IS NULL OR i.valid_to>=current_date);
   IF cardinality(dso_ids) IS DISTINCT FROM 1 OR dso_ids[1] IS DISTINCT FROM sender THEN CONTINUE;END IF;
   agreement:=gridex_ediel_services.current_periodic_reason_agreement_v1(a,app,sender,receiver);
   IF agreement IS NULL THEN RAISE EXCEPTION 'ediel_periodic_reason_current_contract_source_fact_required' USING ERRCODE='42501';END IF;
   current_upstream:=jsonb_build_array(a.customer_id,a.dso_actor_id,a.provider_actor_id,a.actor_profile_id);
   IF upstream IS NOT NULL AND upstream IS DISTINCT FROM current_upstream THEN RAISE EXCEPTION 'ediel_periodic_reason_upstream_relation_ambiguous';END IF;
   upstream:=current_upstream;
   IF reason IS NOT NULL AND reason IS DISTINCT FROM agreement#>>'{0,reasonCode}' THEN RAISE EXCEPTION 'ediel_periodic_reason_mission_agreement_conflict';END IF;
   reason:=agreement#>>'{0,reasonCode}';agreements:=agreements||agreement;scopes:=scopes||jsonb_build_array(to_jsonb(a));
  END LOOP;
  IF reason IS NULL THEN RAISE EXCEPTION 'ediel_periodic_reason_current_contract_source_fact_required' USING ERRCODE='42501';END IF;
  scope:=jsonb_build_object('applicationReference',app,'senderEdielId',sender,'receiverEdielId',receiver,'transactionId',own#>>'{elements,2,0}','point',point,'product',product,'periodStart',v_start,'periodEnd',v_end,'assignmentScopes',scopes,'agreementReceipts',agreements);
  result:=result||jsonb_build_array(jsonb_build_object('transactionIndex',idx,'transactionId',own#>>'{elements,2,0}','reasonCode',reason,'receivedReasonCode',received,'scopeHash',encode(sha256(convert_to(scope::text,'UTF8')),'hex'),'agreementReviewIds',(SELECT coalesce(jsonb_agg(x->'reviewId'),'[]') FROM jsonb_array_elements(agreements)x)));
  idx:=idx+1;
 END LOOP;
 IF idx=0 OR (SELECT count(DISTINCT x->>'reasonCode') FROM jsonb_array_elements(result)x)<>1 THEN RAISE EXCEPTION 'ediel_periodic_reason_one_message_reason_required';END IF;
 RETURN jsonb_build_object('version',1,'companyId',c,'environment',env,'sourceMessageId',sourceid,'sourcePayloadHash',encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex'),'status','qualified','expectedReasons',result,'holdReason',NULL);
END $$;
CREATE FUNCTION public.gridex_read_periodic_dgi_e66_reason_v1(p_company_id uuid,p_message_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE source public.ediel_messages%rowtype;result jsonb;
BEGIN
 PERFORM gridex_ediel_services.lock_periodic_reason_graph_v1();
 SELECT * INTO STRICT source FROM public.ediel_messages WHERE company_id=p_company_id AND id=p_message_id FOR SHARE;
 BEGIN result:=gridex_ediel_services.periodic_reason_projection_v1(p_company_id,source.environment,p_message_id);
 EXCEPTION WHEN raise_exception OR insufficient_privilege OR no_data_found OR too_many_rows OR invalid_text_representation THEN
  result:=jsonb_build_object('version',1,'companyId',p_company_id,'environment',source.environment,'sourceMessageId',p_message_id,'sourcePayloadHash',encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex'),'status','held','expectedReasons','[]'::jsonb,'holdReason',SQLERRM);
 END;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION gridex_ediel_services.periodic_reason_projection_v1(uuid,text,uuid),gridex_ediel_services.periodic_reason_immutable_v1() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.gridex_read_periodic_dgi_e66_reason_v1(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_read_periodic_dgi_e66_reason_v1(uuid,uuid) TO service_role;
CREATE FUNCTION gridex_ediel_services.require_periodic_reason_v1(c uuid,env text,sourceid uuid,transactionid text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE projection jsonb;own_reason jsonb;
BEGIN
 projection:=gridex_ediel_services.periodic_reason_projection_v1(c,env,sourceid);
 SELECT x INTO STRICT own_reason FROM jsonb_array_elements(projection->'expectedReasons')x WHERE x->>'transactionId'=transactionid;
 IF own_reason->>'reasonCode' IS DISTINCT FROM own_reason->>'receivedReasonCode' THEN RAISE EXCEPTION 'utilts_esco_periodic_reason_unqualified' USING ERRCODE='42501';END IF;
END $$;
REVOKE ALL ON FUNCTION gridex_ediel_services.require_periodic_reason_v1(uuid,text,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_ediel_services.require_periodic_outcome_v1(c uuid,sourceid uuid,transactionid text,disposition text,issues jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE source public.ediel_messages%rowtype;ctx jsonb;projection jsonb;own_reason jsonb;
BEGIN
 IF disposition<>'accepted' AND NOT coalesce(issues ? 'UTILTS_PERIODIC_DGI_REASON_INVALID',false) THEN RETURN;END IF;
 PERFORM gridex_ediel_services.lock_periodic_reason_graph_v1();
 SELECT * INTO STRICT source FROM public.ediel_messages WHERE company_id=c AND id=sourceid;
 IF source.message_family IS DISTINCT FROM 'UTILTS' OR source.message_code IS DISTINCT FROM 'E66' OR (source.application_reference ~ '^23-DGI-E66-(S|T)$') IS NOT TRUE THEN RETURN;END IF;
 ctx:=gridex_ediel_ack_replay.require_current_source_role_v2(c,source.environment,sourceid);
 IF (ctx->>'actorRole' IN('energy_service_company','esco')) IS NOT TRUE THEN RETURN;END IF;
 projection:=gridex_ediel_services.periodic_reason_projection_v1(c,source.environment,sourceid);
 SELECT x INTO STRICT own_reason FROM jsonb_array_elements(projection->'expectedReasons')x WHERE x->>'transactionId'=transactionid;
 IF (disposition='accepted' AND own_reason->>'reasonCode' IS DISTINCT FROM own_reason->>'receivedReasonCode')
 OR (coalesce(issues ? 'UTILTS_PERIODIC_DGI_REASON_INVALID',false) AND (disposition<>'guide_rejected' OR own_reason->>'reasonCode' IS NOT DISTINCT FROM own_reason->>'receivedReasonCode')) THEN RAISE EXCEPTION 'utilts_periodic_own_source_outcome_unqualified' USING ERRCODE='P0U01';END IF;
END $$;
REVOKE ALL ON FUNCTION gridex_ediel_services.require_periodic_outcome_v1(uuid,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION gridex_received_sources.require_utilts_transaction_v1(p_company uuid,p_source uuid,p_transaction text,p_disposition text,p_response text,p_issue_codes jsonb) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 PERFORM gridex_received_sources.require_utilts_transaction_before_issuer_v1(p_company,p_source,p_transaction,p_disposition,p_response,p_issue_codes);
 PERFORM gridex_utilts_issuer.require_first_effect_v1(p_company,p_source,p_transaction,p_disposition,p_issue_codes);
 PERFORM gridex_ediel_services.require_periodic_outcome_v1(p_company,p_source,p_transaction,p_disposition,p_issue_codes);
END $$;
CREATE OR REPLACE FUNCTION gridex_utilts_binding.require_current_esco_storage_v1(c uuid,env text,sourceid uuid,transactions jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE ctx jsonb;source public.ediel_messages%rowtype;tokens jsonb;item jsonb;contract jsonb;point text;product text;period text;offset_value text;v_period_start timestamptz;v_period_end timestamptz;
 own_start int;own_end int;header_end int;sender text;candidate uuid;candidates uuid[];
 a public.ediel_service_assignments%rowtype;g public.ediel_data_access_grants%rowtype;l public.ediel_assignment_permission_links%rowtype;p public.metering_permissions%rowtype;dso_ids text[];
BEGIN
 PERFORM gridex_ediel_services.lock_periodic_reason_graph_v1();
 -- The private receipt decides the legal role; caller JSON cannot opt out.
 SELECT context INTO ctx FROM gridex_ediel_inbound_context.receipts WHERE company_id=c AND source_message_id=sourceid AND environment=env AND status='ready';
 IF ctx IS NULL THEN
  IF EXISTS(SELECT FROM jsonb_array_elements(transactions) x WHERE x->>'disposition'='accepted') THEN PERFORM gridex_ediel_inbound_context.require_v1(c,sourceid);END IF;
  RETURN;
 END IF;
 ctx:=gridex_ediel_inbound_context.require_v1(c,sourceid);
 IF (ctx->>'actorRole' IN ('energy_service_company','esco')) IS NOT TRUE THEN RETURN;END IF;
 ctx:=gridex_ediel_ack_replay.require_current_source_role_v2(c,env,sourceid);
 SELECT * INTO STRICT source FROM public.ediel_messages WHERE company_id=c AND id=sourceid AND environment=env FOR SHARE;
 IF ctx->>'family' IS DISTINCT FROM 'UTILTS' OR ctx->>'code' IS DISTINCT FROM 'E66' OR source.direction IS DISTINCT FROM 'inbound'
 OR source.message_family IS DISTINCT FROM 'UTILTS' OR source.message_code IS DISTINCT FROM 'E66'
 OR ctx->>'applicationReference' IS DISTINCT FROM source.application_reference OR (ctx->>'applicationReference' ~ '^23-(DDQ|DGI)-E66-(S|T)$') IS NOT TRUE THEN RAISE EXCEPTION 'utilts_esco_source_scope_unqualified' USING ERRCODE='42501';END IF;
 tokens:=gridex_utilts_binding.wire_tokens_v1(source.raw_payload);
 SELECT min(x#>>'{elements,2,0}') INTO sender FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='NAD' AND x#>>'{elements,1,0}'='MS';
 IF sender IS NULL OR (SELECT count(*) FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='NAD' AND x#>>'{elements,1,0}'='MS')<>1 THEN RAISE EXCEPTION 'utilts_esco_source_dso_unqualified' USING ERRCODE='42501';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(transactions) LOOP
  -- Every requested outcome must be the actual canonical private own-IDE facet.
  PERFORM gridex_received_sources.require_utilts_transaction_v1(c,sourceid,item->>'transactionId',item->>'disposition',item->>'responseType',item->'issueCodes');
  -- A protocol-prescribed negative own-original response needs communication
  -- authority/current local role, but does not authorize positive business data.
  IF item->>'disposition'<>'accepted' THEN CONTINUE;END IF;
  PERFORM gridex_ediel_source_rules.require_v1(c,sourceid);
  contract:=item->'consumptionContract';
  IF NOT coalesce(gridex_utilts_binding.validate_contract_v1(contract),false) OR contract->>'companyId' IS DISTINCT FROM c::text OR contract->>'environment' IS DISTINCT FROM env OR contract->>'messageCode' IS DISTINCT FROM 'E66' OR contract->>'seriesKind' IS DISTINCT FROM 'actual' OR item->>'seriesKind' IS DISTINCT FROM 'actual' OR contract->>'transactionId' IS DISTINCT FROM item->>'transactionId' THEN RAISE EXCEPTION 'utilts_esco_contract_scope_unqualified' USING ERRCODE='42501';END IF;
  point:=gridex_utilts_binding.supported_point_v1(tokens,item->>'transactionId');
  SELECT (x->>'index')::int INTO STRICT own_start FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='IDE' AND x#>>'{elements,2,0}'=item->>'transactionId';
  SELECT min((x->>'index')::int) INTO own_end FROM jsonb_array_elements(tokens) x WHERE (x->>'index')::int>own_start AND x->>'tag' IN('IDE','UNT');
  SELECT coalesce(min((x->>'index')::int),own_end) INTO header_end FROM jsonb_array_elements(tokens) x WHERE (x->>'index')::int>own_start AND (x->>'index')::int<own_end AND x->>'tag'='SEQ';
  SELECT x#>>'{elements,3,0}' INTO STRICT product FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='LIN' AND (x->>'index')::int>own_start AND (x->>'index')::int<header_end AND x#>>'{elements,3,3}'='9';
  SELECT x#>>'{elements,1,1}' INTO STRICT period FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='DTM' AND (x->>'index')::int>own_start AND (x->>'index')::int<header_end AND x#>>'{elements,1,0}'='324' AND x#>>'{elements,1,2}'='719';
  SELECT x#>>'{elements,1,1}' INTO STRICT offset_value FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='DTM' AND (x->>'index')::int<own_start AND x#>>'{elements,1,0}'='735' AND x#>>'{elements,1,2}'='406';
  v_period_start:=gridex_utilts_binding.esco_local_time_v1(substr(period,1,12),offset_value);v_period_end:=gridex_utilts_binding.esco_local_time_v1(substr(period,13,12),offset_value);
  IF point IS NULL OR period !~ '^[0-9]{24}$' OR nullif(product,'') IS NULL OR v_period_start IS NULL OR v_period_end IS NULL OR v_period_end<=v_period_start
  OR item->>'externalMeteringPointId' IS DISTINCT FROM point OR item->>'productId' IS DISTINCT FROM product OR (item->>'periodStart')::timestamptz IS DISTINCT FROM v_period_start OR (item->>'periodEnd')::timestamptz IS DISTINCT FROM v_period_end
  OR (contract#>>'{interpretation,localPeriodStart}')::timestamp IS DISTINCT FROM (v_period_start+make_interval(mins=>(substr(offset_value,2,2)::int*60+substr(offset_value,4,2)::int)*CASE left(offset_value,1) WHEN '-' THEN -1 ELSE 1 END)) AT TIME ZONE 'UTC' OR (contract#>>'{interpretation,localPeriodEnd}')::timestamp IS DISTINCT FROM (v_period_end+make_interval(mins=>(substr(offset_value,2,2)::int*60+substr(offset_value,4,2)::int)*CASE left(offset_value,1) WHEN '-' THEN -1 ELSE 1 END)) AT TIME ZONE 'UTC' OR contract#>>'{interpretation,timezoneRaw}' IS DISTINCT FROM offset_value
  OR EXISTS(SELECT FROM jsonb_array_elements(contract->'observations') o WHERE o->>'externalPoint' IS DISTINCT FROM point OR o->>'productCode' IS DISTINCT FROM product OR (o->>'periodStart')::timestamptz<v_period_start OR (o->>'periodEnd')::timestamptz>v_period_end) THEN RAISE EXCEPTION 'utilts_esco_physical_scope_unqualified' USING ERRCODE='42501';END IF;
  PERFORM gridex_ediel_ack_replay.current_service_grant_set_v2(c,env,ctx,sender,point,product,v_period_start,v_period_end,contract,NULL);
  IF (ctx->>'applicationReference' ~ '^23-DGI-E66-(S|T)$') IS TRUE THEN
   PERFORM gridex_ediel_services.require_periodic_reason_v1(c,env,sourceid,item->>'transactionId');
  END IF;

 END LOOP;
EXCEPTION WHEN no_data_found OR too_many_rows THEN RAISE EXCEPTION 'utilts_esco_physical_scope_unqualified' USING ERRCODE='42501';END $$;

COMMIT;
