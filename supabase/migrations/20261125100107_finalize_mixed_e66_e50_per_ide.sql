CREATE TABLE gridex_e66_intake.mixed_e50_attempts (
  source_id uuid NOT NULL REFERENCES gridex_e66_intake.mixed_qualification_receipts(source_id),
  transaction_id text NOT NULL,
  lease_token uuid,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz NOT NULL,
  response_id uuid UNIQUE REFERENCES public.ediel_messages(id),
  response_sha256 text CHECK (response_sha256 ~ '^[0-9a-f]{64}$'),
  completed_at timestamptz,
  PRIMARY KEY (source_id,transaction_id),
  CHECK ((lease_token IS NULL)=(lease_expires_at IS NULL)),
  CHECK ((response_id IS NULL)=(response_sha256 IS NULL)),
  CHECK (completed_at IS NULL OR response_id IS NOT NULL)
);
REVOKE ALL ON gridex_e66_intake.mixed_e50_attempts FROM PUBLIC,anon,authenticated,service_role;

-- Discover only the exact E50 functional error owned by the original qualification.
CREATE FUNCTION gridex_e66_intake.mixed_e50_candidates_v1(w gridex_e66_intake.work,p_actor uuid)
RETURNS TABLE(transaction_id text,transaction_index integer)
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT member.id,(member.ordinality-1)::integer
  FROM gridex_e66_intake.mixed_qualification_receipts q
  JOIN gridex_received_sources.validation_assessments assessment
    ON (assessment.id,assessment.source_message_id,assessment.company_id,assessment.environment,assessment.source_payload_hash)
      =(q.assessment_id,w.source_id,w.company_id,w.environment,w.payload_sha256)
  JOIN gridex_received_sources.utilts_transaction_validations intent
    ON (intent.assessment_id,intent.source_message_id,intent.company_id,intent.environment,intent.source_payload_hash)
      =(assessment.id,w.source_id,w.company_id,w.environment,w.payload_sha256)
  JOIN gridex_received_sources.utilts_functional_validations facts
    ON (facts.assessment_id,facts.source_message_id,facts.company_id,facts.environment,facts.source_payload_hash)
      =(assessment.id,w.source_id,w.company_id,w.environment,w.payload_sha256)
  JOIN gridex_utilts_binding.receipts binding
    ON (binding.source_message_id,binding.company_id,binding.environment,binding.raw_hash,binding.message_code)
      =(w.source_id,w.company_id,w.environment,w.payload_sha256,'E66')
  CROSS JOIN LATERAL jsonb_array_elements_text(binding.membership) WITH ORDINALITY AS member(id,ordinality)
  JOIN public.ediel_ack_transaction_results result
    ON (result.source_message_id,result.company_id,result.environment,result.source_transaction_id)
      =(w.source_id,w.company_id,w.environment,member.id)
  CROSS JOIN LATERAL (SELECT
    intent.transaction_facts_text::jsonb #> ARRAY['transactions',(member.ordinality-1)::text] AS value,
    facts.functional_facts_text::jsonb #> ARRAY['transactions',(member.ordinality-1)::text] AS error) target
  WHERE (q.source_id,q.actor_id)=(w.source_id,p_actor)
    AND w.environment='test' AND w.phase='mixed_qualified' AND w.lease_token IS NULL
    AND (result.disposition,result.planned_response_type,result.persistence_status)
      =('processability_rejected','utilts_err','not_applicable')
    AND result.persisted_series_id IS NULL
    AND result.issue_codes=ARRAY['UTILTS_E66_DELIVERY_END_AFTER_REGISTRATION']::text[]
    AND (target.value->>'transactionId',target.value->>'disposition',target.value->>'responseType')
      =(member.id,'processability_rejected','utilts_err')
    AND (target.error->>'transactionId',target.error->>'transactionIndex')
      =(member.id,(member.ordinality-1)::text)
    AND jsonb_array_length(target.error->'errors')=1
    AND (target.error#>>'{errors,0,code}',target.error#>>'{errors,0,referenceQualifier}',target.error#>>'{errors,0,referenceNumber}')
      =('E50','TN',member.id)
    AND NOT EXISTS (SELECT FROM gridex_received_sources.validation_assessments later
      WHERE later.previous_assessment_id=assessment.id)
    AND NOT EXISTS (SELECT FROM gridex_e66_intake.mixed_accepted_transactions accepted
      WHERE (accepted.source_id,accepted.transaction_id)=(w.source_id,member.id))
$$;
REVOKE ALL ON FUNCTION gridex_e66_intake.mixed_e50_candidates_v1(gridex_e66_intake.work,uuid)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_e66_intake.require_mixed_e50_original_v1(w gridex_e66_intake.work,p_actor uuid,p_ide text)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE
  original public.ediel_messages;
  guide jsonb;
  tokens jsonb;
  first_index integer;
  boundary integer;
  selected_index integer;
  deliveries jsonb;
  registrations jsonb;
  dates text;
BEGIN
  SELECT e.transaction_index INTO selected_index
  FROM gridex_e66_intake.mixed_e50_candidates_v1(w,p_actor) e WHERE e.transaction_id=p_ide;
  IF selected_index IS NULL
    OR gridex_e66_intake.request_upgrade_state_v1(w.source_id) IS DISTINCT FROM 'hold_qualification_unverified'
  THEN RAISE EXCEPTION 'mixed_e50_original_required' USING ERRCODE='55000'; END IF;

  SELECT * INTO original FROM public.ediel_messages m
  WHERE (m.id,m.company_id,m.environment,m.immutable_payload_hash,m.message_family,m.message_code,m.direction)
    =(w.source_id,w.company_id,w.environment,w.payload_sha256,'UTILTS','E66','inbound')
    AND m.grid_owner_data_request_id IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'mixed_e50_original_required' USING ERRCODE='55000'; END IF;
  guide:=gridex_ediel_source_rules.require_v1(w.company_id,w.source_id);
  tokens:=gridex_utilts_binding.wire_tokens_v1(original.raw_payload);
  SELECT (t->>'index')::int INTO first_index FROM jsonb_array_elements(tokens) t
  WHERE t->>'tag'='IDE' ORDER BY (t->>'index')::int OFFSET selected_index LIMIT 1;
  IF NOT EXISTS(SELECT FROM public.ediel_rule_packs p WHERE p.id=(guide->>'rulePackId')::uuid
        AND p.family='UTILTS' AND p.guide_version='25-A-5')
    OR (gridex_ack_authority.wire_v1(original.raw_payload)#>>ARRAY['ide',selected_index::text]) IS DISTINCT FROM p_ide
    OR first_index IS NULL
    OR NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) t
      WHERE t->>'tag'='MKS' AND t#>>'{elements,2,0}' IN ('E02','E03'))
  THEN RAISE EXCEPTION 'mixed_e50_original_required' USING ERRCODE='55000'; END IF;

  SELECT min((t->>'index')::int) INTO boundary FROM jsonb_array_elements(tokens) t
  WHERE t->>'tag' IN ('IDE','SEQ','UNT') AND (t->>'index')::int>first_index;
  SELECT jsonb_agg(t#>'{elements,1}') FILTER(WHERE t#>>'{elements,1,0}'='324'),
    jsonb_agg(t#>'{elements,1}') FILTER(WHERE t#>>'{elements,1,0}'='597')
  INTO deliveries,registrations FROM jsonb_array_elements(tokens) t
  WHERE t->>'tag'='DTM' AND (t->>'index')::int>first_index AND (t->>'index')::int<boundary;
  dates:=deliveries#>>'{0,1}';
  IF jsonb_array_length(deliveries) IS DISTINCT FROM 1 OR jsonb_array_length(registrations) IS DISTINCT FROM 1
    OR jsonb_array_length(deliveries->0) IS DISTINCT FROM 3 OR jsonb_array_length(registrations->0) IS DISTINCT FROM 3
    OR deliveries#>>'{0,2}' IS DISTINCT FROM '719' OR registrations#>>'{0,2}' IS DISTINCT FROM '203'
    OR NOT coalesce(dates ~ '^[0-9]{24}$',false)
    OR NOT coalesce(gridex_utilts_binding.esco_local_time_v1(right(dates,12),'+0000')
       >gridex_utilts_binding.esco_local_time_v1(registrations#>>'{0,1}','+0000'),false)
  THEN RAISE EXCEPTION 'mixed_e50_original_required' USING ERRCODE='55000'; END IF;
END
$$;
REVOKE ALL ON FUNCTION gridex_e66_intake.require_mixed_e50_original_v1(gridex_e66_intake.work,uuid,text)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_e66_intake.require_mixed_e50_wire_v1(p_raw text,p_ide text)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE tokens jsonb:=gridex_utilts_binding.wire_tokens_v1(p_raw);
BEGIN
  IF NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='BGM' AND t#>>'{elements,1,0}'='ERR')
    OR (SELECT jsonb_agg(jsonb_build_array(t#>'{elements,1}',t#>'{elements,2}',t#>'{elements,3}'))
      FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='STS' AND t#>>'{elements,1,0}'='E01')
      IS DISTINCT FROM '[[["E01","","260"],["41"],["E50","","260"]]]'::jsonb
    OR (SELECT jsonb_agg(t#>>'{elements,1,1}') FROM jsonb_array_elements(tokens) t
      WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='TN') IS DISTINCT FROM jsonb_build_array(p_ide)
  THEN RAISE EXCEPTION 'mixed_e50_canonical_err_required' USING ERRCODE='55000'; END IF;
END
$$;
REVOKE ALL ON FUNCTION gridex_e66_intake.require_mixed_e50_wire_v1(text,text) FROM PUBLIC,anon,authenticated,service_role;

-- Consumption is limited to the guarded worker's current transaction. The finalizer
-- cannot turn an arbitrary ERR draft into an accepted mixed transaction outcome.
CREATE TABLE gridex_e66_intake.mixed_e50_finalize_context (
  tx xid8 PRIMARY KEY,
  source_id uuid NOT NULL,
  transaction_id text NOT NULL,
  actor_id uuid NOT NULL,
  mailbox_id uuid NOT NULL,
  response_id uuid NOT NULL
);
REVOKE ALL ON gridex_e66_intake.mixed_e50_finalize_context FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_e66_intake.step_mixed_e50_v1(
  p_company uuid,p_environment text,p_mailbox uuid,p_actor uuid,p_action text,
  p_source uuid,p_ide text,p_lease uuid,p_draft jsonb
) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE
  w gridex_e66_intake.work;
  attempt gridex_e66_intake.mixed_e50_attempts;
  protected_reply jsonb;
  response uuid;
  digest text;
  raw text;
  finalize_result jsonb;
BEGIN
  SELECT c.* INTO w FROM gridex_e66_intake.work c
  JOIN gridex_e66_intake.mixed_qualification_receipts q ON q.source_id=c.source_id AND q.actor_id=p_actor
  WHERE (c.source_id,c.company_id,c.environment,c.mailbox_id)=(p_source,p_company,p_environment,p_mailbox)
    AND c.phase='mixed_qualified' AND c.lease_token IS NULL AND c.environment='test' FOR UPDATE OF c;
  SELECT * INTO attempt FROM gridex_e66_intake.mixed_e50_attempts a
  WHERE (a.source_id,a.transaction_id,a.lease_token)=(w.source_id,p_ide,p_lease)
    AND a.completed_at IS NULL AND a.lease_expires_at>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('kind','held','reason','mixed_e50_lease_unavailable'); END IF;

  IF p_action='defer' THEN
    UPDATE gridex_e66_intake.mixed_e50_attempts SET lease_token=NULL,lease_expires_at=NULL,
      next_attempt_at=clock_timestamp()+interval '60 seconds'
    WHERE (source_id,transaction_id)=(p_source,p_ide);
    RETURN jsonb_build_object('kind','yielded');
  END IF;
  PERFORM gridex_e66_intake.require_mixed_e50_original_v1(w,p_actor,p_ide);

  IF p_action='advance' AND attempt.response_id IS NULL THEN
    RETURN jsonb_build_object('kind','render_e50','sourceHash',w.payload_sha256);
  END IF;
  IF p_action='store' AND attempt.response_id IS NULL THEN
    PERFORM gridex_e66_intake.require_mixed_e50_wire_v1(p_draft->>'rawPayload',p_ide);
    protected_reply:=gridex_ediel_ack_replay.create_v1(p_company,p_environment,p_source,w.payload_sha256,
      p_actor,'UTILTS_ERR','relatedTransactionReference',p_ide,'negative',p_draft,NULL);
  ELSE
    protected_reply:=gridex_ediel_ack_replay.read_v1(p_company,p_environment,p_source,p_actor,
      'UTILTS_ERR','relatedTransactionReference',p_ide);
  END IF;
  response:=(protected_reply#>>'{ackMessage,id}')::uuid;
  raw:=protected_reply#>>'{ackMessage,raw_payload}';
  digest:=encode(sha256(convert_to(raw,'UTF8')),'hex');
  PERFORM gridex_e66_intake.require_mixed_e50_wire_v1(raw,p_ide);
  IF response IS NULL OR protected_reply#>>'{ackMessage,status}' IS DISTINCT FROM 'draft'
    OR protected_reply#>>'{ackMessage,message_sent_at}' IS NOT NULL
    OR NOT EXISTS(SELECT FROM gridex_ediel_ack_replay.creation_receipts r
      WHERE (r.ack_message_id,r.source_message_id,r.company_id,r.environment,r.actor_user_id,
             r.source_payload_hash,r.ack_payload_hash,r.family,r.sequence_field,r.sequence_value,r.outcome)
        =(response,p_source,p_company,p_environment,p_actor,w.payload_sha256,digest,
          'UTILTS_ERR','relatedTransactionReference',p_ide,'negative'))
    OR (attempt.response_id IS NOT NULL AND (attempt.response_id,attempt.response_sha256) IS DISTINCT FROM (response,digest))
  THEN RAISE EXCEPTION 'mixed_e50_protected_reply_required' USING ERRCODE='55000'; END IF;

  IF p_action='store' THEN
    UPDATE gridex_e66_intake.mixed_e50_attempts SET response_id=response,response_sha256=digest
    WHERE (source_id,transaction_id)=(p_source,p_ide);
  ELSIF p_action='finish' THEN
    IF attempt.response_id IS NULL THEN RAISE EXCEPTION 'mixed_e50_protected_reply_required' USING ERRCODE='55000'; END IF;
    INSERT INTO gridex_e66_intake.mixed_e50_finalize_context
    VALUES (pg_current_xact_id(),p_source,p_ide,p_actor,p_mailbox,response);
    finalize_result:=public.gridex_finalize_utilts_transaction_ack_v1(p_company,p_environment,p_source,p_ide,
      'utilts_err',response,p_actor,p_mailbox);
    IF (finalize_result->>'status' IN ('finalized','already_finalized')) IS NOT TRUE
      OR finalize_result->>'responseMessageId' IS DISTINCT FROM response::text
    THEN RAISE EXCEPTION 'mixed_e50_finalization_conflict' USING ERRCODE='55000'; END IF;
    DELETE FROM gridex_e66_intake.mixed_e50_finalize_context WHERE tx=pg_current_xact_id();
    UPDATE gridex_e66_intake.mixed_e50_attempts SET completed_at=clock_timestamp(),lease_token=NULL,lease_expires_at=NULL
    WHERE (source_id,transaction_id)=(p_source,p_ide);
    RETURN jsonb_build_object('kind','e50_finalized','responseId',response);
  END IF;
  RETURN jsonb_build_object('kind','finalize_e50','responseId',response);
END
$$;
REVOKE ALL ON FUNCTION gridex_e66_intake.step_mixed_e50_v1(uuid,text,uuid,uuid,text,uuid,text,uuid,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;

DO $$
DECLARE
  owner regprocedure;
  definition text;
  body text;
  patched text;
  discovery text := $new$
  UNION ALL
  SELECT rejected.transaction_id,rejected.transaction_index,
    coalesce(attempt.next_attempt_at,w.created_at+interval '1 microsecond')
  FROM gridex_e66_intake.mixed_e50_candidates_v1(w,p_actor) rejected
  JOIN public.ediel_ack_transaction_results result
    ON (result.company_id,result.environment,result.source_message_id,result.source_transaction_id)
      =(w.company_id,w.environment,w.source_id,rejected.transaction_id)
  LEFT JOIN gridex_e66_intake.mixed_e50_attempts attempt
    ON (attempt.source_id,attempt.transaction_id)=(w.source_id,rejected.transaction_id)
  WHERE result.finalized_at IS NULL AND result.final_response_type IS NULL AND result.response_message_id IS NULL
    AND attempt.completed_at IS NULL AND coalesce(attempt.next_attempt_at,w.created_at)<=p_now
    AND (attempt.lease_expires_at IS NULL OR attempt.lease_expires_at<=p_now)
$new$;
  claim_marker text:='    INSERT INTO gridex_e66_intake.mixed_worker_attempts AS prior';
  early_claim text:=$new$
    IF candidate.rejected THEN
      INSERT INTO gridex_e66_intake.mixed_e50_attempts AS prior
        (source_id,transaction_id,lease_token,lease_expires_at,next_attempt_at)
      VALUES(candidate.source_id,candidate.transaction_id,worker_lease,clock_timestamp()+interval '75 seconds',clock_timestamp())
      ON CONFLICT(source_id,transaction_id) DO UPDATE SET
        lease_token=excluded.lease_token,lease_expires_at=excluded.lease_expires_at,next_attempt_at=excluded.next_attempt_at
      WHERE prior.completed_at IS NULL AND (prior.lease_expires_at IS NULL OR prior.lease_expires_at<=clock_timestamp())
        AND prior.next_attempt_at<=clock_timestamp();
      IF NOT FOUND THEN RETURN jsonb_build_object('kind','idle'); END IF;
      RETURN jsonb_build_object('kind','claimed','sourceId',candidate.source_id,'transactionId',candidate.transaction_id,'lease',worker_lease);
    END IF;
$new$;
  delegate_marker text:='  PERFORM gridex_utilts_binding.lock_storage_graph_v1();';
  e50_delegate text:=$new$
  IF EXISTS (SELECT FROM gridex_e66_intake.mixed_e50_attempts a
    WHERE (a.source_id,a.transaction_id)=(p_source,p_ide)) THEN
    RETURN gridex_e66_intake.step_mixed_e50_v1(p_company,p_environment,p_mailbox,p_actor,p_action,
      p_source,p_ide,p_worker_lease,p_draft);
  END IF;
$new$;
  finish_marker text:='    recovery:=gridex_e66_intake.read_mixed_positive_recovery_v1';
  finish_guard text:=$new$    IF p_response_type='utilts_err' THEN
      IF NOT EXISTS(SELECT FROM gridex_e66_intake.mixed_e50_finalize_context ctx
        WHERE (ctx.tx,ctx.source_id,ctx.transaction_id,ctx.actor_id,ctx.mailbox_id,ctx.response_id)
          =(pg_current_xact_id_if_assigned(),p_source_message_id,p_transaction_id,p_actor_user_id,p_mailbox_id,p_response_message_id))
      THEN RAISE EXCEPTION 'mixed_e50_finalizer_context_required' USING ERRCODE='42501'; END IF;
    ELSE
$new$;
BEGIN
  owner:='gridex_e66_intake.due_mixed_worker_members_v1(gridex_e66_intake.work,uuid,timestamptz)';
  SELECT pg_get_functiondef(owner),p.prosrc INTO STRICT definition,body FROM pg_proc p WHERE p.oid=owner;
  IF md5(body)<>'5ef90c82a0c1cffa228822a33d848195' THEN RAISE EXCEPTION 'mixed_e50_discovery_owner_changed'; END IF;
  EXECUTE replace(definition,body,body||discovery);

  owner:='public.gridex_step_mixed_e66_worker_v1(uuid,text,uuid,uuid,text,uuid,text,uuid,uuid,jsonb)';
  SELECT pg_get_functiondef(owner),p.prosrc INTO STRICT definition,body FROM pg_proc p WHERE p.oid=owner;
  IF md5(body)<>'1decb20c2e34d9abb635dd3071134633' THEN RAISE EXCEPTION 'mixed_e50_worker_owner_changed'; END IF;
  patched:=replace(body,'SELECT w.source_id,c.transaction_id INTO candidate',$new$SELECT w.source_id,c.transaction_id,
      NOT EXISTS (SELECT FROM gridex_e66_intake.mixed_accepted_transactions accepted
        WHERE (accepted.source_id,accepted.transaction_id)=(w.source_id,c.transaction_id)) AS rejected INTO candidate$new$);
  patched:=replace(patched,claim_marker,early_claim||claim_marker);
  patched:=replace(patched,delegate_marker,delegate_marker||e50_delegate);
  EXECUTE replace(definition,body,patched);

  owner:='public.gridex_finalize_utilts_transaction_ack_v1(uuid,text,uuid,text,text,uuid,uuid,uuid)';
  SELECT pg_get_functiondef(owner),p.prosrc INTO STRICT definition,body FROM pg_proc p WHERE p.oid=owner;
  IF md5(body)<>'d5533090de3dcc0b61d1bf7b3a563aac' THEN RAISE EXCEPTION 'mixed_e50_finalizer_owner_changed'; END IF;
  patched:=replace(body,'p_response_type<>''positive_aperak''','p_response_type NOT IN (''positive_aperak'',''utilts_err'')');
  patched:=replace(patched,finish_marker,finish_guard||finish_marker);
  patched:=replace(patched,$old$USING ERRCODE='55000'; END IF;
  END IF;$old$,$new$USING ERRCODE='55000'; END IF;
    END IF;
  END IF;$new$);
  EXECUTE replace(definition,body,patched);
END
$$;
