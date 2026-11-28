-- This journal seals IDE preparation. It does not create an ACK or satisfy the singleton completion owner.
CREATE TABLE gridex_e66_intake.mixed_e73_ide_completions (
  source_id uuid NOT NULL,
  transaction_id text NOT NULL,
  actor_id uuid NOT NULL,
  first_lease_token uuid NOT NULL,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  basis_sha256 text NOT NULL CHECK (basis_sha256 ~ '^[0-9a-f]{64}$'),
  wire_sha256 text NOT NULL CHECK (wire_sha256 ~ '^[0-9a-f]{64}$'),
  rule_pack_id uuid NOT NULL,
  message_profile_id uuid NOT NULL,
  rule_source_sha256 text NOT NULL CHECK (rule_source_sha256 ~ '^[0-9a-f]{64}$'),
  sealed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (source_id,transaction_id),
  FOREIGN KEY (source_id,transaction_id)
    REFERENCES gridex_e66_intake.mixed_e73_request_basis(source_id,transaction_id)
);
REVOKE ALL ON gridex_e66_intake.mixed_e73_ide_completions FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_e66_intake.reject_mixed_e73_completion_mutation_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'mixed_e73_ide_completion_is_immutable' USING ERRCODE='55000';
END
$$;
REVOKE ALL ON FUNCTION gridex_e66_intake.reject_mixed_e73_completion_mutation_v1()
  FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER mixed_e73_ide_completion_is_immutable
BEFORE UPDATE OR DELETE OR TRUNCATE ON gridex_e66_intake.mixed_e73_ide_completions
FOR EACH STATEMENT EXECUTE FUNCTION gridex_e66_intake.reject_mixed_e73_completion_mutation_v1();

CREATE FUNCTION gridex_e66_intake.seal_mixed_e73_ide_completion_v1(
  p_company uuid,p_environment text,p_mailbox uuid,p_source uuid,p_actor uuid,
  p_transaction text,p_token uuid,p_wire text
) RETURNS jsonb
LANGUAGE plpgsql SET search_path TO pg_catalog AS $$
DECLARE
  precondition jsonb;
  original public.ediel_messages;
  original_wire jsonb;
  reply_wire jsonb;
  rule_basis jsonb;
  wire_sha256 text;
  existing gridex_e66_intake.mixed_e73_ide_completions;
  replayed boolean:=false;
BEGIN
  IF nullif(p_wire,'') IS NULL OR octet_length(p_wire)>8388608 THEN
    RAISE EXCEPTION 'mixed_e73_ide_completion_invalid_wire' USING ERRCODE='22023';
  END IF;
  -- The precondition pins the active source work, scope, existing ledger and current basis.
  precondition:=gridex_e66_intake.mixed_e73_draft_precondition_v1(
    p_company,p_environment,p_mailbox,p_source,p_actor,p_transaction,'validate',p_token);
  IF precondition->>'status' IS DISTINCT FROM 'valid' THEN RETURN precondition; END IF;
  PERFORM public.ediel_require_source_bytes_available_v1(p_company,p_source);
  SELECT m.* INTO STRICT original FROM public.ediel_messages m
  WHERE (m.id,m.company_id,m.environment)=(p_source,p_company,p_environment) FOR SHARE;
  IF precondition->>'sourceSha256' IS DISTINCT FROM encode(sha256(convert_to(original.raw_payload,'UTF8')),'hex')
  THEN RAISE EXCEPTION 'mixed_e73_ide_completion_original_changed' USING ERRCODE='55000'; END IF;
  rule_basis:=gridex_ediel_source_rules.require_v1(p_company,p_source);
  original_wire:=gridex_ack_authority.wire_v1(original.raw_payload);
  reply_wire:=gridex_ack_authority.wire_v1(p_wire);
  IF gridex_ack_authority.source_match_v1(reply_wire,original_wire) IS NOT TRUE
    OR reply_wire->'type' IS DISTINCT FROM '["APERAK","D","04A","UN","E5SE5A"]'::jsonb
    OR reply_wire->>'code' IS DISTINCT FROM '312'
    OR reply_wire->'erc' IS DISTINCT FROM '["100"]'::jsonb
    OR reply_wire#>'{refs,ACW}' IS DISTINCT FROM jsonb_build_array(p_transaction)
    OR reply_wire#>'{ercGroups,0,acw}' IS DISTINCT FROM jsonb_build_array(p_transaction)
    OR jsonb_array_length(reply_wire#>'{refs,DM}') IS DISTINCT FROM 1
    OR nullif(reply_wire#>>'{refs,DM,0}','') IS NULL
    OR original_wire->'ide'->((precondition->>'transactionIndex')::integer) IS DISTINCT FROM to_jsonb(p_transaction)
  THEN RAISE EXCEPTION 'mixed_e73_ide_completion_wire_scope_mismatch' USING ERRCODE='55000'; END IF;
  wire_sha256:=encode(sha256(convert_to(p_wire,'UTF8')),'hex');

  SELECT c.* INTO existing FROM gridex_e66_intake.mixed_e73_ide_completions c
    WHERE (c.source_id,c.transaction_id)=(p_source,p_transaction);
  IF FOUND THEN
    IF (existing.actor_id,existing.source_sha256,existing.basis_sha256,existing.wire_sha256,
        existing.rule_pack_id,existing.message_profile_id,existing.rule_source_sha256)
       IS DISTINCT FROM (p_actor,precondition->>'sourceSha256',precondition->>'basisSha256',wire_sha256,
         (rule_basis->>'rulePackId')::uuid,(rule_basis->>'messageProfileId')::uuid,rule_basis->>'sourceHash')
    THEN RAISE EXCEPTION 'mixed_e73_ide_completion_replay_changed' USING ERRCODE='55000'; END IF;
    replayed:=true;
  ELSE
    INSERT INTO gridex_e66_intake.mixed_e73_ide_completions
      (source_id,transaction_id,actor_id,first_lease_token,source_sha256,basis_sha256,wire_sha256,
       rule_pack_id,message_profile_id,rule_source_sha256)
    VALUES (p_source,p_transaction,p_actor,p_token,precondition->>'sourceSha256',precondition->>'basisSha256',wire_sha256,
      (rule_basis->>'rulePackId')::uuid,(rule_basis->>'messageProfileId')::uuid,rule_basis->>'sourceHash')
    RETURNING * INTO existing;
  END IF;
  RETURN jsonb_build_object('status','ide_preparation_recorded','transactionId',p_transaction,
    'sourceId',p_source,'wireSha256',wire_sha256,'sealedAt',existing.sealed_at,'replayed',replayed,
    'draftAuthorized',false,'dispatchAuthorized',false);
END
$$;
REVOKE ALL ON FUNCTION gridex_e66_intake.seal_mixed_e73_ide_completion_v1(uuid,text,uuid,uuid,uuid,text,uuid,text)
  FROM PUBLIC,anon,authenticated,service_role;

-- Private creation context lives for the exact canonical writer transaction only.
CREATE TABLE gridex_e66_intake.mixed_positive_create_context (
  xact xid8 PRIMARY KEY,
  source_id uuid NOT NULL,
  transaction_id text NOT NULL,
  company_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  lease_token uuid NOT NULL,
  basis_sha256 text NOT NULL,
  source_sha256 text NOT NULL,
  wire_sha256 text NOT NULL
);
REVOKE ALL ON gridex_e66_intake.mixed_positive_create_context FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_e66_intake.has_mixed_positive_create_context_v1(
  p_company uuid,p_env text,p_source uuid,p_transaction text,p_source_hash text,p_ack uuid
) RETURNS boolean LANGUAGE sql VOLATILE SET search_path TO pg_catalog AS $$
  SELECT p_env='test' AND p_ack IS NULL AND EXISTS (
    SELECT FROM gridex_e66_intake.mixed_positive_create_context x
    JOIN gridex_e66_intake.mixed_e73_ide_completions c
      ON (c.source_id,c.transaction_id,c.actor_id,c.basis_sha256,c.source_sha256,c.wire_sha256)
        =(x.source_id,x.transaction_id,x.actor_id,x.basis_sha256,x.source_sha256,x.wire_sha256)
    JOIN gridex_e66_intake.mixed_e73_draft_preconditions d
      ON (d.source_id,d.transaction_id,d.actor_id,d.basis_sha256,d.lease_token)
        =(x.source_id,x.transaction_id,x.actor_id,x.basis_sha256,x.lease_token)
    WHERE d.expires_at>clock_timestamp() AND (x.xact,x.company_id,x.source_id,x.transaction_id,x.source_sha256)
      =(pg_current_xact_id_if_assigned(),p_company,p_source,p_transaction,p_source_hash)
  )
$$;
REVOKE ALL ON FUNCTION gridex_e66_intake.has_mixed_positive_create_context_v1(uuid,text,uuid,text,text,uuid)
  FROM PUBLIC,anon,authenticated,service_role;

-- Exact preimage splice. Only the two whole-source CREATE prerequisites gain a TEST-scoped branch.
DO $$
DECLARE
  owner regprocedure:='gridex_utilts_binding.require_positive_storage_authority_v1(uuid,text,uuid,text,uuid,text)';
  body text;
  definition text;
  request_anchor text:='AND gridex_e66_intake.request_upgrade_state_v1(source.id) NOT IN (''outside'',''matched_basis'',''unmatched'')';
  phase_anchor text:='AND EXISTS(SELECT FROM gridex_e66_intake.work w WHERE w.source_id=source.id) THEN';
  guard text:=' AND NOT gridex_e66_intake.has_mixed_positive_create_context_v1(p_company_id,p_environment,source.id,p_transaction_id,source_hash,p_ack_message_id)';
  patched text;
BEGIN
  SELECT p.prosrc,pg_get_functiondef(owner) INTO STRICT body,definition FROM pg_proc p WHERE p.oid=owner;
  IF md5(body)<>'78b407eb8413f83f2e73b28e80f897a9' OR strpos(body,request_anchor)=0 OR strpos(body,phase_anchor)=0 THEN
    RAISE EXCEPTION 'positive_storage_owner_preimage_changed: %',md5(body);
  END IF;
  patched:=replace(replace(body,request_anchor,request_anchor||guard),
    phase_anchor,replace(phase_anchor,' THEN',guard||' THEN'));
  EXECUTE replace(definition,body,patched);
END
$$;

CREATE FUNCTION gridex_e66_intake.persist_mixed_positive_draft_v1(
  p_company uuid,p_environment text,p_mailbox uuid,p_source uuid,p_actor uuid,p_transaction text,p_token uuid,p_draft jsonb
) RETURNS jsonb LANGUAGE plpgsql SET search_path TO pg_catalog AS $$
DECLARE
  precondition jsonb;
  completion gridex_e66_intake.mixed_e73_ide_completions;
  digest text;
  canonical_result jsonb;
  xact_id xid8;
BEGIN
  IF p_environment IS DISTINCT FROM 'test' OR jsonb_typeof(p_draft) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'mixed_positive_scope_required' USING ERRCODE='22023';
  END IF;
  precondition:=gridex_e66_intake.mixed_e73_draft_precondition_v1(
    p_company,p_environment,p_mailbox,p_source,p_actor,p_transaction,'validate',p_token);
  IF precondition->>'status' IS DISTINCT FROM 'valid' THEN RETURN precondition; END IF;
  digest:=encode(sha256(convert_to(p_draft->>'rawPayload','UTF8')),'hex');
  SELECT c.* INTO completion FROM gridex_e66_intake.mixed_e73_ide_completions c
  WHERE (c.source_id,c.transaction_id,c.actor_id,c.source_sha256,c.basis_sha256,c.wire_sha256)
    =(p_source,p_transaction,p_actor,precondition->>'sourceSha256',precondition->>'basisSha256',digest);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mixed_positive_completion_required' USING ERRCODE='55000';
  END IF;
  xact_id:=pg_current_xact_id();
  INSERT INTO gridex_e66_intake.mixed_positive_create_context
    VALUES(xact_id,p_source,p_transaction,p_company,p_actor,p_token,completion.basis_sha256,
      completion.source_sha256,completion.wire_sha256);
  canonical_result:=gridex_ediel_ack_replay.create_v1(p_company,p_environment,p_source,completion.source_sha256,
    p_actor,'APERAK','relatedTransactionReference',p_transaction,'positive',p_draft,NULL);
  IF canonical_result#>>'{ackMessage,raw_payload}' IS DISTINCT FROM p_draft->>'rawPayload'
    OR canonical_result#>>'{ackMessage,status}' IS DISTINCT FROM 'draft'
  THEN RAISE EXCEPTION 'mixed_positive_exact_draft_mismatch' USING ERRCODE='55000'; END IF;
  DELETE FROM gridex_e66_intake.mixed_positive_create_context x WHERE x.xact=xact_id;
  RETURN canonical_result;
END
$$;
REVOKE ALL ON FUNCTION gridex_e66_intake.persist_mixed_positive_draft_v1(uuid,text,uuid,uuid,uuid,text,uuid,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;

-- Recovery reads the existing native draft. It never creates, finalizes or sends a response.
CREATE FUNCTION gridex_e66_intake.read_mixed_positive_recovery_v1(
  p_company uuid,p_environment text,p_mailbox uuid,p_source uuid,p_actor uuid,p_transaction text
) RETURNS jsonb LANGUAGE plpgsql SET search_path TO pg_catalog AS $$
DECLARE
  readiness jsonb;
  completion gridex_e66_intake.mixed_e73_ide_completions;
  native_original jsonb;
  reservation public.ediel_ack_transaction_results;
  ack_id uuid;
  status text;
BEGIN
  PERFORM gridex_utilts_binding.lock_storage_graph_v1();
  PERFORM gridex_e66_intake.require_dispatch_scope(p_company,p_environment,p_mailbox,p_actor);
  IF p_environment IS DISTINCT FROM 'test' OR NOT EXISTS (
    SELECT FROM gridex_e66_intake.work w
    WHERE (w.source_id,w.company_id,w.environment,w.mailbox_id)=(p_source,p_company,p_environment,p_mailbox)
      AND w.phase='mixed_qualified' AND w.lease_token IS NULL
  ) THEN RETURN jsonb_build_object('status','held','reason','missing_mixed_work'); END IF;

  readiness:=gridex_e66_intake.read_mixed_e73_ide_readiness_v1(p_company,p_environment,p_source,p_actor,p_transaction);
  IF coalesce(readiness->>'status','') NOT IN ('ready_for_reply_evaluation','hold_existing_response') THEN
    RETURN jsonb_build_object('status','held','reason',coalesce(readiness->>'status','readiness_unavailable'));
  END IF;
  SELECT c.* INTO completion FROM gridex_e66_intake.mixed_e73_ide_completions c
  WHERE (c.source_id,c.transaction_id,c.actor_id)=(p_source,p_transaction,p_actor);
  IF NOT FOUND THEN RETURN jsonb_build_object('status','held','reason','missing_ide_completion'); END IF;

  native_original:=gridex_ediel_ack_replay.read_v1(p_company,p_environment,p_source,p_actor,
    'APERAK','relatedTransactionReference',p_transaction);
  IF native_original IS NULL THEN RETURN jsonb_build_object('status','held','reason','missing_native_draft'); END IF;
  ack_id:=(native_original#>>'{ackMessage,id}')::uuid;
  IF native_original#>>'{ackMessage,status}' IS DISTINCT FROM 'draft'
    OR native_original#>>'{ackMessage,message_sent_at}' IS NOT NULL
    OR native_original#>>'{ackMessage,ack_outcome}' IS DISTINCT FROM 'positive'
    OR completion.wire_sha256 IS DISTINCT FROM encode(sha256(convert_to(native_original#>>'{ackMessage,raw_payload}','UTF8')),'hex')
    OR completion.source_sha256 IS DISTINCT FROM encode(sha256(convert_to(native_original#>>'{sourceMessage,raw_payload}','UTF8')),'hex')
    OR NOT EXISTS (
      SELECT FROM gridex_ediel_ack_replay.creation_receipts r
      WHERE (r.ack_message_id,r.source_message_id,r.company_id,r.environment,r.actor_user_id,
             r.source_payload_hash,r.ack_payload_hash,r.family,r.sequence_field,r.sequence_value,r.outcome)
        =(ack_id,p_source,p_company,p_environment,p_actor,completion.source_sha256,completion.wire_sha256,
          'APERAK','relatedTransactionReference',p_transaction,'positive')
    )
  THEN RAISE EXCEPTION 'mixed_recovery_native_receipt_mismatch' USING ERRCODE='55000'; END IF;

  SELECT a.* INTO reservation FROM public.ediel_ack_transaction_results a
  WHERE (a.company_id,a.environment,a.source_message_id,a.source_transaction_id)
    =(p_company,p_environment,p_source,p_transaction);
  IF NOT FOUND THEN RAISE EXCEPTION 'mixed_recovery_result_unavailable' USING ERRCODE='55000'; END IF;
  IF reservation.finalized_at IS NOT NULL THEN
    IF (reservation.response_message_id,reservation.final_response_type::text) IS DISTINCT FROM (ack_id,'positive_aperak') THEN
      RAISE EXCEPTION 'mixed_recovery_conflicting_final_reply' USING ERRCODE='55000';
    END IF;
    status:='already_finalized';
  ELSIF reservation.response_message_id IS NULL AND reservation.final_response_type IS NULL
    AND readiness->>'status'='ready_for_reply_evaluation'
    AND readiness->>'basisSha256'=completion.basis_sha256 THEN
    status:='recovered_draft';
  ELSE
    RETURN jsonb_build_object('status','held','reason','mixed_recovery_result_not_available');
  END IF;
  RETURN jsonb_build_object('status',status,'ackId',ack_id,'sourceId',p_source,
    'transactionId',p_transaction,'wireSha256',completion.wire_sha256,'dispatchAuthorized',false);
END
$$;
REVOKE ALL ON FUNCTION gridex_e66_intake.read_mixed_positive_recovery_v1(uuid,text,uuid,uuid,uuid,text)
  FROM PUBLIC,anon,authenticated,service_role;
