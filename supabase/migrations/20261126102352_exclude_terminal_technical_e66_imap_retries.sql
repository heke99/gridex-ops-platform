-- This read authorizes exclusion from scheduled retries only. The separate
-- physical IMAP Seen authority never consumes this result.
CREATE FUNCTION public.gridex_list_held_e66_technical_imap_uids_v1(
  p_mailbox uuid,p_worker text,p_claimed_at timestamptz,p_scope text,p_folder text,p_validity bigint,p_uids bigint[]
) RETURNS bigint[] LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $held$
DECLARE box public.ediel_mailboxes;
BEGIN
  IF current_setting('role',true) IS DISTINCT FROM 'service_role'
    OR coalesce(cardinality(p_uids),0) NOT BETWEEN 1 AND 256
    OR NOT coalesce(p_scope ~ '^[a-f0-9]{64}$',false)
    OR nullif(btrim(p_folder),'') IS NULL OR octet_length(p_folder)>1024
    OR NOT coalesce(p_validity BETWEEN 1 AND 4294967295,false)
    OR EXISTS (SELECT FROM unnest(p_uids) u WHERE u IS NULL OR u NOT BETWEEN 1 AND 4294967295)
  THEN RAISE EXCEPTION 'imap_technical_hold_read_scope_required' USING ERRCODE='42501'; END IF;

  SELECT * INTO box FROM public.ediel_mailboxes b
  WHERE (b.id,b.locked_by,b.locked_at)=(p_mailbox,p_worker,p_claimed_at) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'imap_technical_hold_mailbox_claim_required' USING ERRCODE='42501'; END IF;

  RETURN ARRAY(
    SELECT DISTINCT m.imap_uid
    FROM public.inbound_email_messages m
    JOIN gridex_e66_intake.work w ON (w.mail_id,w.mailbox_id,w.environment)=(m.id,box.id,box.environment)
    JOIN public.ediel_messages s ON (s.id,s.inbound_email_message_id,s.company_id,s.environment)
      =(w.source_id,m.id,w.company_id,w.environment)
    JOIN gridex_ediel_inbound_receptions.receptions r
      ON (r.id,r.inbound_email_message_id,r.source_message_id,r.company_id,r.environment,r.received_payload_hash)
      =(w.reception_id,m.id,w.source_id,w.company_id,w.environment,w.payload_sha256)
    JOIN gridex_e66_intake.technical_rejections t
      ON (t.source_id,t.reception_id,t.company_id,t.environment,t.mailbox_id,t.payload_sha256)
      =(w.source_id,w.reception_id,w.company_id,w.environment,w.mailbox_id,w.payload_sha256)
    JOIN public.ediel_messages a ON (a.id,a.related_message_id,a.company_id,a.environment,a.immutable_payload_hash)
      =(t.ack_id,t.source_id,t.company_id,t.environment,t.ack_sha256)
    JOIN gridex_ediel_ack_replay.creation_receipts c
      ON (c.ack_message_id,c.source_message_id,c.company_id,c.environment,c.source_payload_hash,c.ack_payload_hash)
      =(a.id,t.source_id,t.company_id,t.environment,t.payload_sha256,t.ack_sha256)
    WHERE (m.mailbox_id,m.environment,m.imap_account_scope,m.imap_folder,m.imap_uid_validity)
      =(box.id,box.environment,p_scope,p_folder,p_validity)
      AND m.imap_uid=ANY(p_uids)
      -- Intake freezes the physical digest and UID tuple. Scope the held
      -- shortcut to byte-identical retained MIME with an explicit reception
      -- hash; transformed or unsupported custody remains on the normal path.
      AND m.raw_mailbox_bytes_sha256 ~ '^[a-f0-9]{64}$'
      AND m.raw_mailbox_bytes_sha256=m.raw_message_sha256
      AND m.received_at_source IN ('imap_internal_date','poll_observed_at')
      AND (m.received_at,s.message_received_at)=(r.received_at,r.received_at)
      AND s.mailbox_message_id=m.id::text
      AND (box.company_id IS NULL OR box.company_id=w.company_id)
      AND r.classification='first_reception'
      AND r.transport_source_snapshot->>'mailboxId'=box.id::text
      AND r.transport_source_snapshot->>'rawMessageSha256'=m.raw_message_sha256
      AND w.phase='technical_rejected' AND w.lease_token IS NULL
      AND (s.direction,s.message_family,s.message_code)=('inbound','UTILTS','E66')
      AND encode(sha256(convert_to(s.raw_payload,'UTF8')),'hex')=t.payload_sha256
      AND (a.direction,a.message_family,c.family,c.outcome)=('outbound','CONTRL','CONTRL','negative')
      AND encode(sha256(convert_to(a.raw_payload,'UTF8')),'hex')=t.ack_sha256
      AND NOT EXISTS (
        SELECT FROM public.ediel_messages other
        WHERE other.inbound_email_message_id=m.id AND other.direction='inbound' AND other.id<>s.id
      )
    ORDER BY m.imap_uid
  );
END
$held$;

REVOKE ALL ON FUNCTION public.gridex_list_held_e66_technical_imap_uids_v1(uuid,text,timestamptz,text,text,bigint,bigint[])
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_list_held_e66_technical_imap_uids_v1(uuid,text,timestamptz,text,text,bigint,bigint[])
  TO service_role;
