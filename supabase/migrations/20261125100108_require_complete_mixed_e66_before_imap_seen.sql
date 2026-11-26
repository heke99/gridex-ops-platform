-- This proof authorizes only the verified mailbox poll's disposition.
-- It never advances a work phase, closes E73, creates an ACK, or applies Seen.
CREATE FUNCTION gridex_e66_intake.mixed_e66_seen_proof_v1(w gridex_e66_intake.work)
RETURNS boolean LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE
  qualification gridex_e66_intake.mixed_qualification_receipts;
  original public.ediel_messages;
  member record;
  binding jsonb;
  current_evidence jsonb;
  coverage jsonb;
  request_id uuid;
  sent_source_id uuid;
  accepted_count integer:=0;
  rejected_count integer:=0;
BEGIN
  IF (w.environment,w.phase) IS DISTINCT FROM ('test','mixed_qualified') OR w.lease_token IS NOT NULL
  THEN RETURN false; END IF;
  -- Incomplete work is common during polling. Avoid the graph lock on that path.
  IF EXISTS(SELECT FROM public.ediel_ack_transaction_results result
    WHERE (result.source_message_id,result.company_id,result.environment)=(w.source_id,w.company_id,w.environment)
      AND result.finalized_at IS NULL) THEN RETURN false; END IF;

  PERFORM gridex_utilts_binding.lock_storage_graph_v1();
  SELECT q.* INTO qualification FROM gridex_e66_intake.mixed_qualification_receipts q
  WHERE q.source_id=w.source_id;
  IF NOT FOUND OR gridex_e66_intake.request_upgrade_state_v1(w.source_id) IS DISTINCT FROM 'hold_qualification_unverified'
    OR EXISTS(SELECT FROM gridex_received_sources.validation_assessments a
      WHERE a.previous_assessment_id=qualification.assessment_id)
    OR EXISTS(SELECT FROM gridex_e66_intake.mixed_prelinked_holds h WHERE h.source_id=w.source_id)
    OR EXISTS(SELECT FROM gridex_e66_intake.sg11_format_holds h WHERE h.source_id=w.source_id)
    OR EXISTS(SELECT FROM gridex_e66_intake.sg11_compatibility_holds h WHERE h.source_id=w.source_id)
    OR EXISTS(SELECT FROM gridex_e66_intake.registration_rejections h WHERE h.source_id=w.source_id)
    OR EXISTS(SELECT FROM gridex_e66_intake.mixed_worker_attempts h WHERE h.source_id=w.source_id
      AND h.lease_expires_at>clock_timestamp())
    OR EXISTS(SELECT FROM gridex_e66_intake.mixed_e50_attempts h WHERE h.source_id=w.source_id
      AND h.lease_expires_at>clock_timestamp())
  THEN RETURN false; END IF;
  PERFORM gridex_e66_intake.require_dispatch_scope(w.company_id,w.environment,w.mailbox_id,qualification.actor_id);

  SELECT m.* INTO original FROM public.ediel_messages m
  WHERE (m.id,m.company_id,m.environment,m.immutable_payload_hash,m.direction,m.message_family,m.message_code)
    =(w.source_id,w.company_id,w.environment,w.payload_sha256,'inbound','UTILTS','E66')
    AND m.grid_owner_data_request_id IS NULL FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT r.membership INTO binding FROM gridex_utilts_binding.receipts r
  WHERE (r.source_message_id,r.company_id,r.environment,r.raw_hash,r.message_code)
    =(w.source_id,w.company_id,w.environment,w.payload_sha256,'E66');
  IF jsonb_typeof(binding) IS DISTINCT FROM 'array' OR jsonb_array_length(binding)<2
    OR binding IS DISTINCT FROM gridex_ack_authority.wire_v1(original.raw_payload)->'ide'
    OR (SELECT count(DISTINCT ide) FROM jsonb_array_elements_text(binding) AS members(ide))<>jsonb_array_length(binding)
    OR (SELECT count(*) FROM public.ediel_ack_transaction_results a
      WHERE (a.source_message_id,a.company_id,a.environment)=(w.source_id,w.company_id,w.environment))<>jsonb_array_length(binding)
  THEN RETURN false; END IF;

  FOR member IN
    SELECT wire.id,a.disposition,a.planned_response_type,a.persistence_status,
      a.persisted_series_id,a.final_response_type,a.finalized_at,a.response_message_id,
      reply.raw_payload AS reply_wire,reply.message_family AS reply_family,reply.ack_outcome AS reply_outcome,
      reply.immutable_payload_hash AS reply_hash,proof.ack_payload_hash AS creation_hash,
      accepted.series_id AS accepted_series,received_e73.request_id AS own_request,
      received_e73.sent_source_id AS own_sent_source,received_e73.evidence AS e73_evidence,
      prepared.wire_sha256 AS prepared_hash,rejected.completed_at AS rejected_at,rejected.response_sha256 AS rejected_hash
    FROM jsonb_array_elements_text(binding) WITH ORDINALITY AS wire(id,ordinality)
    LEFT JOIN public.ediel_ack_transaction_results a
      ON (a.source_message_id,a.company_id,a.environment,a.source_transaction_id)
        =(w.source_id,w.company_id,w.environment,wire.id)
    LEFT JOIN public.ediel_messages reply
      ON (reply.id,reply.related_message_id,reply.company_id,reply.environment,reply.direction,reply.message_standard)
        =(a.response_message_id,w.source_id,w.company_id,w.environment,'outbound','edifact')
    LEFT JOIN gridex_ediel_ack_replay.creation_receipts proof
      ON (proof.ack_message_id,proof.source_message_id,proof.company_id,proof.environment,proof.actor_user_id,
        proof.source_payload_hash,proof.family,proof.sequence_field,proof.sequence_value,proof.outcome)
        =(a.response_message_id,w.source_id,w.company_id,w.environment,qualification.actor_id,
          w.payload_sha256,reply.message_family,'relatedTransactionReference',wire.id,reply.ack_outcome)
    LEFT JOIN gridex_e66_intake.mixed_accepted_transactions accepted
      ON (accepted.source_id,accepted.transaction_id,accepted.transaction_index)=(w.source_id,wire.id,wire.ordinality-1)
    LEFT JOIN gridex_e66_intake.mixed_e73_request_basis received_e73
      ON (received_e73.source_id,received_e73.transaction_id,received_e73.company_id,received_e73.environment,received_e73.actor_id)
        =(w.source_id,wire.id,w.company_id,w.environment,qualification.actor_id)
    LEFT JOIN gridex_e66_intake.mixed_e73_ide_completions prepared
      ON (prepared.source_id,prepared.transaction_id,prepared.actor_id,prepared.source_sha256,prepared.basis_sha256)
        =(w.source_id,wire.id,qualification.actor_id,w.payload_sha256,received_e73.evidence_sha256)
    LEFT JOIN gridex_e66_intake.mixed_e50_attempts rejected
      ON (rejected.source_id,rejected.transaction_id,rejected.response_id)=(w.source_id,wire.id,a.response_message_id)
      AND rejected.lease_token IS NULL
    ORDER BY wire.ordinality
  LOOP
    IF member.finalized_at IS NULL OR member.response_message_id IS NULL
      OR member.reply_hash IS NULL OR member.reply_hash IS DISTINCT FROM member.creation_hash
      OR member.reply_hash IS DISTINCT FROM encode(sha256(convert_to(member.reply_wire,'UTF8')),'hex')
    THEN RETURN false; END IF;

    IF (member.disposition,member.planned_response_type,member.persistence_status,member.final_response_type)
      =('accepted','positive_aperak','persisted','positive_aperak')
    THEN
      IF member.accepted_series IS NULL OR member.accepted_series IS DISTINCT FROM member.persisted_series_id
        OR member.own_request IS NULL OR member.own_sent_source IS NULL
        OR member.prepared_hash IS DISTINCT FROM member.reply_hash
        OR (member.reply_family,member.reply_outcome) IS DISTINCT FROM ('APERAK','positive')
        OR (gridex_ack_authority.wire_v1(member.reply_wire)#>'{refs,ACW}') IS DISTINCT FROM jsonb_build_array(member.id)
      THEN RETURN false; END IF;
      current_evidence:=gridex_e66_intake.read_mixed_e73_evidence_v1(
        w.company_id,w.environment,w.source_id,qualification.actor_id,member.id);
      IF current_evidence IS NULL OR current_evidence IS DISTINCT FROM member.e73_evidence
        OR current_evidence->>'requestScope' IS DISTINCT FROM 'meter_values'
        OR (accepted_count>0 AND (request_id,sent_source_id) IS DISTINCT FROM (member.own_request,member.own_sent_source))
      THEN RETURN false; END IF;
      request_id:=member.own_request;
      sent_source_id:=member.own_sent_source;
      accepted_count:=accepted_count+1;
    ELSIF (member.disposition,member.planned_response_type,member.persistence_status,member.final_response_type)
      =('processability_rejected','utilts_err','not_applicable','utilts_err')
    THEN
      IF member.accepted_series IS NOT NULL OR member.persisted_series_id IS NOT NULL OR member.rejected_at IS NULL
        OR member.rejected_hash IS DISTINCT FROM member.reply_hash
        OR (member.reply_family,member.reply_outcome) IS DISTINCT FROM ('UTILTS_ERR','negative')
      THEN RETURN false; END IF;
      PERFORM gridex_e66_intake.require_mixed_e50_original_v1(w,qualification.actor_id,member.id);
      PERFORM gridex_e66_intake.require_mixed_e50_wire_v1(member.reply_wire,member.id);
      rejected_count:=rejected_count+1;
    ELSE
      RETURN false;
    END IF;
  END LOOP;

  IF accepted_count=0 OR rejected_count=0 THEN RETURN false; END IF;
  coverage:=gridex_e66_intake.read_mixed_e73_coverage_v1(w.company_id,w.environment,request_id,qualification.actor_id);
  RETURN (coverage->>'combinedObservedComplete')::boolean IS TRUE;
EXCEPTION WHEN insufficient_privilege OR object_not_in_prerequisite_state OR SQLSTATE 'P0U01' THEN
  RETURN false;
END
$$;
REVOKE ALL ON FUNCTION gridex_e66_intake.mixed_e66_seen_proof_v1(gridex_e66_intake.work)
  FROM PUBLIC,anon,authenticated,service_role;

DO $$
DECLARE
  owner regprocedure:='public.gridex_can_acknowledge_verified_imap_source_v1(uuid,text,timestamptz,uuid,text,text,bigint,bigint,text)';
  definition text;
  body text;
  marker text:='   RETURN (work.phase=''complete'' AND EXISTS(';
  guarded text:=$new$
   IF work.phase='mixed_qualified' THEN
    RETURN gridex_e66_intake.mixed_e66_seen_proof_v1(work);
   END IF;
$new$;
BEGIN
  SELECT pg_get_functiondef(owner),p.prosrc INTO STRICT definition,body FROM pg_proc p WHERE p.oid=owner;
  IF md5(body)<>'f3bc792129dd41c7ffcff3d425d9beef' OR strpos(body,marker)=0
  THEN RAISE EXCEPTION 'mixed_seen_owner_preimage_changed'; END IF;
  EXECUTE replace(definition,body,replace(body,marker,guarded||marker));
END
$$;
