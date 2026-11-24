-- Read the result for the verified physical source while the caller owns its mailbox poll.
CREATE FUNCTION public.gridex_can_acknowledge_verified_imap_source_v1(
 p_mailbox uuid,p_worker text,p_claimed_at timestamptz,p_mail uuid,p_scope text,p_folder text,
 p_validity bigint,p_uid bigint,p_sha256 text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $receipt$
DECLARE
 box public.ediel_mailboxes;
 mail public.inbound_email_messages;
 reception gridex_ediel_inbound_receptions.receptions;
 source public.ediel_messages;
 work gridex_e66_intake.work;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' THEN
  RAISE EXCEPTION 'imap_seen_service_required' USING ERRCODE='42501';
 END IF;
 SELECT * INTO box FROM public.ediel_mailboxes b
 WHERE (b.id,b.locked_by,b.locked_at)=(p_mailbox,p_worker,p_claimed_at);
 IF NOT FOUND THEN RAISE EXCEPTION 'imap_seen_mailbox_claim_required' USING ERRCODE='42501'; END IF;

 SELECT * INTO mail FROM public.inbound_email_messages m
 WHERE (m.id,m.mailbox_id,m.environment)=(p_mail,box.id,box.environment)
   AND ((m.imap_account_scope,m.imap_folder,m.imap_uid_validity,m.imap_uid,m.raw_mailbox_bytes_sha256)
       =(p_scope,p_folder,p_validity,p_uid,p_sha256)
     OR EXISTS(SELECT FROM gridex_ediel_transport.legacy_imap_job_recoveries h
       WHERE (h.inbound_email_message_id,h.mailbox_id,h.account_scope,h.folder,h.uid_validity,h.uid,h.physical_sha256)
        =(m.id,box.id,p_scope,p_folder,p_validity,p_uid,p_sha256)));
 IF NOT FOUND THEN RETURN false; END IF;

 -- Canonical inbound ACK originals are written directly against the physical
 -- mail. Their separate native application owner, not the inbound row, is proof.
 IF EXISTS(
   SELECT FROM public.ediel_messages m
   JOIN gridex_ack_authority.source_correlations r
    ON (r.ack_message_id,r.company_id,r.environment,r.ack_payload_hash)
      =(m.id,m.company_id,m.environment,m.immutable_payload_hash)
   JOIN gridex_ack_authority.applied_receipts a ON a.ack_message_id=r.ack_message_id
   WHERE m.inbound_email_message_id=mail.id AND m.environment=box.environment
    AND (mail.company_id IS NULL OR mail.company_id=m.company_id)
    AND (box.company_id=m.company_id OR box.is_shared_platform_mailbox)
    AND m.direction='inbound' AND m.message_family IN ('CONTRL','APERAK','UTILTS_ERR')
 ) THEN RETURN true; END IF;

 SELECT r.* INTO reception FROM gridex_ediel_inbound_receptions.receptions r
 WHERE r.inbound_email_message_id=mail.id AND r.environment=box.environment
   AND (mail.company_id IS NULL OR mail.company_id=r.company_id)
   AND (box.company_id=r.company_id OR box.is_shared_platform_mailbox)
   AND r.classification IN ('first_reception','protocol_duplicate')
   AND r.received_payload_hash=r.canonical_payload_hash;
 IF NOT FOUND THEN RETURN false; END IF;

 SELECT m.* INTO source FROM public.ediel_messages m
 JOIN gridex_ediel_inbound_receptions.receptions first
  ON (first.source_message_id,first.company_id,first.environment,first.canonical_payload_hash)
   =(m.id,m.company_id,m.environment,m.immutable_payload_hash)
 WHERE first.classification='first_reception' AND first.received_payload_hash=first.canonical_payload_hash
   AND (m.id,m.company_id,m.environment,m.immutable_payload_hash)
    =(reception.source_message_id,reception.company_id,reception.environment,reception.canonical_payload_hash)
   AND m.direction='inbound';
 IF NOT FOUND THEN RETURN false; END IF;

 IF (source.message_family,source.message_code)=('UTILTS','E66') THEN
  SELECT * INTO work FROM gridex_e66_intake.work w
  WHERE (w.source_id,w.company_id,w.environment,w.payload_sha256)
   =(source.id,source.company_id,source.environment,source.immutable_payload_hash);
  IF FOUND THEN
   RETURN (work.phase='complete' AND EXISTS(SELECT FROM gridex_e66_intake.completions d
    WHERE (d.source_id,d.company_id,d.environment,d.source_sha256)
     =(work.source_id,work.company_id,work.environment,work.payload_sha256)))
    OR (work.phase='registration_rejected' AND EXISTS(SELECT FROM gridex_e66_intake.registration_rejections r
     WHERE (r.source_id,r.reception_id,r.company_id,r.environment,r.mailbox_id,r.payload_sha256)
      =(work.source_id,work.reception_id,work.company_id,work.environment,work.mailbox_id,work.payload_sha256)
      AND r.completed_at IS NOT NULL));
  END IF;
  -- A retained legacy E66 has no durable work row. Its finalized native source approval
  -- and all original metering applications witness its stored business effect.
  RETURN EXISTS(
   SELECT FROM gridex_utilts_binding.contracts b
   JOIN public.ediel_ack_transaction_results a
    ON (a.source_message_id,a.company_id,a.environment,a.source_transaction_id)
     =(b.source_message_id,b.company_id,b.environment,b.transaction_id)
   WHERE (b.source_message_id,b.company_id,b.environment)
    =(source.id,source.company_id,source.environment)
    AND a.disposition='accepted' AND a.persistence_status='persisted'
    AND a.final_response_type='positive_aperak' AND a.finalized_at IS NOT NULL
    AND jsonb_array_length(b.contract->'observations')>0
    AND (SELECT count(*) FROM gridex_utilts_binding.metering_application_receipts m
      WHERE (m.source_message_id,m.company_id,m.environment,m.transaction_id,m.contract_hash)
        =(b.source_message_id,b.company_id,b.environment,b.transaction_id,b.contract_hash))
      =jsonb_array_length(b.contract->'observations'));
 END IF;

 IF source.message_family IN ('CONTRL','APERAK','UTILTS_ERR') THEN
  RETURN EXISTS(SELECT FROM gridex_ack_authority.applied_receipts a
   JOIN gridex_ack_authority.source_correlations r USING (ack_message_id)
   WHERE (r.ack_message_id,r.company_id,r.environment,r.ack_payload_hash)
    =(source.id,source.company_id,source.environment,source.immutable_payload_hash));
 END IF;

 IF source.message_family='PRODAT' THEN
  RETURN EXISTS(SELECT FROM gridex_received_sources.customer_primary_response_receipts d
    WHERE (d.source_message_id,d.company_id,d.environment,d.payload_hash)
     =(source.id,source.company_id,source.environment,source.immutable_payload_hash))
   OR EXISTS(SELECT FROM gridex_received_sources.permission_effect_receipts d
    WHERE (d.source_message_id,d.company_id,d.payload_hash)
     =(source.id,source.company_id,source.immutable_payload_hash))
   OR EXISTS(SELECT FROM gridex_received_sources.normal_switch_confirmations d
    WHERE (d.source_message_id,d.company_id)=(source.id,source.company_id))
   OR EXISTS(SELECT FROM gridex_received_sources.supply_source_transitions d
    WHERE (d.source_message_id,d.company_id,d.payload_hash)
     =(source.id,source.company_id,source.immutable_payload_hash))
   OR EXISTS(SELECT FROM gridex_received_sources.structural_apply_receipts d
    WHERE (d.source_message_id,d.company_id,d.environment,d.payload_hash)
     =(source.id,source.company_id,source.environment,source.immutable_payload_hash));
 END IF;
 RETURN false;
END
$receipt$;

REVOKE ALL ON FUNCTION public.gridex_can_acknowledge_verified_imap_source_v1(uuid,text,timestamptz,uuid,text,text,bigint,bigint,text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_can_acknowledge_verified_imap_source_v1(uuid,text,timestamptz,uuid,text,text,bigint,bigint,text)
 TO service_role;
