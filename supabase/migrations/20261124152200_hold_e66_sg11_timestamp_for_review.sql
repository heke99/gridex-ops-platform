-- The migration runner owns the single transaction and journal write.


CREATE TABLE gridex_e66_intake.sg11_format_holds (
  source_id uuid PRIMARY KEY REFERENCES gridex_e66_intake.work(source_id),
  company_id uuid NOT NULL,
  environment text NOT NULL CHECK (environment IN ('test','production')),
  mailbox_id uuid NOT NULL,
  reception_id uuid NOT NULL,
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  profile_checksum text NOT NULL CHECK (profile_checksum ~ '^[a-f0-9]{64}$'),
  actor_id uuid NOT NULL,
  lease_token uuid NOT NULL,
  diagnostic jsonb NOT NULL CHECK (jsonb_typeof(diagnostic)='object'),
  held_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Use the same decoded wire tokens as the native persistence owner.
-- Return the first definitive occurrence; no ACK field number is assigned.
CREATE FUNCTION gridex_e66_intake.sg11_forbidden_timestamp_v1(p_raw text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path TO 'pg_catalog' AS $diagnose$
DECLARE
  tokens jsonb := gridex_utilts_binding.wire_tokens_v1(p_raw);
  token jsonb;
  tag text;
  qualifier text;
  e66 boolean := false;
  ide text;
  seq integer := 0;
  quantity text;
BEGIN
  IF jsonb_typeof(tokens) IS DISTINCT FROM 'array'
    OR (SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='UNH')<>1 THEN
    RETURN NULL;
  END IF;
  FOR token IN SELECT value FROM jsonb_array_elements(tokens) LOOP
    tag := token->>'tag';
    qualifier := token#>>'{elements,1,0}';
    CASE tag
      WHEN 'UNH' THEN
        IF token#>>'{elements,2,0}' IS DISTINCT FROM 'UTILTS' THEN RETURN NULL; END IF;
      WHEN 'BGM' THEN e66 := qualifier='E66';
      WHEN 'IDE' THEN
        ide := CASE WHEN qualifier='24' THEN nullif(token#>>'{elements,2,0}','') END;
        seq := 0;
        quantity := NULL;
      WHEN 'SEQ' THEN seq := seq+1; quantity := NULL;
      WHEN 'QTY' THEN quantity := nullif(qualifier,'');
      WHEN 'PRI' THEN quantity := NULL;
      WHEN 'MOA' THEN quantity := NULL;
      WHEN 'UNT' THEN EXIT;
      WHEN 'DTM' THEN
        IF e66 AND ide IS NOT NULL AND seq>0 AND qualifier='597' AND quantity NOT IN ('220','42') THEN
          RETURN jsonb_build_object('reason','UTILTS_E66_SG11_TIMESTAMP_QUANTITY_NOT_ALLOWED',
            'transactionId',ide,'observationIndex',seq-1,'wireTokenIndex',token->'index',
            'quantityQualifier',quantity);
        END IF;
      ELSE NULL;
    END CASE;
  END LOOP;
  RETURN NULL;
END
$diagnose$;

CREATE FUNCTION gridex_e66_intake.hold_sg11_format_v1(
  p_company uuid,p_environment text,p_mailbox uuid,p_source uuid,p_actor uuid,p_lease uuid
) RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'pg_catalog' AS $hold$
DECLARE
  w gridex_e66_intake.work;
  source public.ediel_messages;
  saved gridex_e66_intake.sg11_format_holds;
  basis jsonb;
  diagnostic jsonb;
BEGIN
  PERFORM gridex_utilts_binding.lock_storage_graph_v1();
  PERFORM gridex_e66_intake.require_dispatch_scope(p_company,p_environment,p_mailbox,p_actor);
  SELECT * INTO STRICT w FROM gridex_e66_intake.work
    WHERE (source_id,company_id,environment,mailbox_id)=(p_source,p_company,p_environment,p_mailbox)
    FOR UPDATE;
  SELECT * INTO saved FROM gridex_e66_intake.sg11_format_holds WHERE source_id=p_source;
  IF saved.source_id IS NULL THEN
    w:=gridex_e66_intake.require_registration_rejection_claim_v1(
      p_company,p_environment,p_mailbox,p_source,p_actor,p_lease);
  ELSIF w.phase IS DISTINCT FROM 'sg11_format_review'
    OR (saved.company_id,saved.environment,saved.mailbox_id,saved.reception_id,saved.payload_sha256,
      saved.actor_id,saved.lease_token) IS DISTINCT FROM
      (p_company,p_environment,p_mailbox,w.reception_id,w.payload_sha256,p_actor,p_lease)
    OR gridex_e66_intake.request_upgrade_state_v1(p_source) IS DISTINCT FROM 'hold_qualification_unverified'
  THEN
    RAISE EXCEPTION 'e66_sg11_format_review_replay_changed' USING ERRCODE='55000';
  END IF;
  SELECT * INTO STRICT source FROM public.ediel_messages WHERE id=w.source_id FOR UPDATE;
  basis:=gridex_ediel_source_rules.require_v1(p_company,p_source);
  IF basis->>'version' IS DISTINCT FROM '25-A-5:r5'
    OR basis#>>'{snapshot,version}' IS DISTINCT FROM '25-A-5:r5'
    OR basis#>>'{snapshot,rulePack,market}' IS DISTINCT FROM 'electricity'
    OR basis#>>'{snapshot,rulePack,family}' IS DISTINCT FROM 'UTILTS'
    OR basis#>>'{snapshot,rulePack,guide_version}' IS DISTINCT FROM '25-A-5'
    OR basis#>>'{snapshot,rulePack,guide_revision}' IS DISTINCT FROM '5'
    OR coalesce(basis->>'sourceHash','') !~ '^[a-f0-9]{64}$'
    OR NOT EXISTS(SELECT FROM jsonb_array_elements(basis#>'{snapshot,guideSources}') s
      WHERE s->>'source_type'='technical_guide' AND s->>'revision'='25-A-5'
        AND s->>'source_hash'='b76a61b9aa6f136771e5db4948296d1b632b8d775314eb6c93783595ae419db2') THEN
    RAISE EXCEPTION 'e66_sg11_format_review_guide_unavailable' USING ERRCODE='55000';
  END IF;
  diagnostic:=gridex_e66_intake.sg11_forbidden_timestamp_v1(source.raw_payload);
  IF diagnostic IS NULL THEN
    RAISE EXCEPTION 'e66_sg11_format_review_no_occurrence' USING ERRCODE='55000';
  END IF;
  IF saved.source_id IS NOT NULL THEN
    IF (saved.profile_checksum,saved.diagnostic) IS DISTINCT FROM (basis->>'sourceHash',diagnostic) THEN
      RAISE EXCEPTION 'e66_sg11_format_review_replay_changed' USING ERRCODE='55000';
    END IF;
    RETURN jsonb_build_object('sourceId',p_source,'diagnostic',diagnostic,'replayed',true);
  END IF;
  IF w.lease_until<=clock_timestamp()
    OR gridex_e66_intake.request_upgrade_state_v1(p_source) IS DISTINCT FROM 'qualify_normally'
    OR EXISTS (SELECT FROM gridex_e66_intake.registration_rejections WHERE source_id=p_source)
    OR EXISTS (SELECT FROM public.ediel_messages a WHERE a.company_id=p_company AND a.environment=p_environment
      AND a.related_message_id=p_source AND a.direction='outbound'
      AND a.message_family IN ('APERAK','UTILTS_ERR'))
  THEN
    RAISE EXCEPTION 'e66_sg11_format_review_prior_owner_or_effect' USING ERRCODE='55000';
  END IF;
  INSERT INTO gridex_e66_intake.sg11_format_holds
    (source_id,company_id,environment,mailbox_id,reception_id,payload_sha256,profile_checksum,actor_id,lease_token,diagnostic)
  VALUES(p_source,p_company,p_environment,p_mailbox,w.reception_id,w.payload_sha256,basis->>'sourceHash',
    p_actor,p_lease,diagnostic);
  INSERT INTO public.ediel_message_events
    (company_id,ediel_message_id,message_id,event_type,event_status,message,payload,event_payload,created_by)
  VALUES(p_company,p_source,p_source,'validated','warning',
    'E66 hålls för granskning. Tidsstämpeln DTM+597 hör till en otillåten mängdtyp.',
    diagnostic,diagnostic,p_actor);
  UPDATE gridex_e66_intake.work SET phase='sg11_format_review',lease_actor=NULL,lease_token=NULL,lease_until=NULL
   WHERE source_id=p_source;
  RETURN jsonb_build_object('sourceId',p_source,'diagnostic',diagnostic,'replayed',false);
END
$hold$;

REVOKE ALL ON gridex_e66_intake.sg11_format_holds FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION gridex_e66_intake.sg11_forbidden_timestamp_v1(text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION gridex_e66_intake.hold_sg11_format_v1(uuid,text,uuid,uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;

-- Private candidate overlay. Keep the existing RPC identity, ACL, and ordinary
-- qualification body. A typed object requests one deliberately distinct review.
DO $adapter$
DECLARE
  owner oid := 'public.gridex_commit_e66_qualification_v1(uuid,text,uuid,uuid,uuid,uuid,jsonb)'::regprocedure;
  before_metadata jsonb;
  body text;
  definition text;
  entry text := 'BEGIN' || E'\n' || ' PERFORM gridex_utilts_binding.lock_storage_graph_v1();';
  review text := $review$BEGIN
 IF p_transactions = '{"operation":"hold_sg11_format_review"}'::jsonb THEN
  RETURN gridex_e66_intake.hold_sg11_format_v1(
    p_company,p_environment,p_mailbox,p_source,p_actor,p_lease)
    || jsonb_build_object('kind','sg11_format_review');
 END IF;
 PERFORM gridex_utilts_binding.lock_storage_graph_v1();$review$;
BEGIN
 SELECT p.prosrc,pg_get_functiondef(owner),to_jsonb(p)-'prosrc'
   INTO STRICT body,definition,before_metadata
   FROM pg_proc p WHERE p.oid=owner;
 IF encode(sha256(convert_to(body,'UTF8')),'hex')
      <> '6754cd1843d923dde075f061421361cb3f0df2752e3ab2dc270f9d58aa0d4e93'
    OR strpos(body,entry)=0 THEN
   RAISE EXCEPTION 'e66_sg11_qualification_adapter_owner_changed';
 END IF;
 EXECUTE replace(definition,body,replace(body,entry,review));
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=owner)
     IS DISTINCT FROM before_metadata THEN
   RAISE EXCEPTION 'e66_sg11_qualification_adapter_metadata_changed';
 END IF;
END
$adapter$;


CREATE TABLE gridex_e66_intake.sg11_compatibility_holds (
  source_id uuid PRIMARY KEY REFERENCES public.ediel_messages(id),
  company_id uuid NOT NULL,
  environment text NOT NULL CHECK (environment IN ('test','production')),
  mailbox_id uuid NOT NULL,
  reception_id uuid NOT NULL,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  profile_checksum text NOT NULL CHECK (profile_checksum ~ '^[a-f0-9]{64}$'),
  actor_id uuid NOT NULL,
  diagnostic jsonb NOT NULL CHECK (jsonb_typeof(diagnostic)='object'),
  held_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON gridex_e66_intake.sg11_compatibility_holds FROM PUBLIC,anon,authenticated,service_role;

-- Called only with the persistence owner's storage graph and source row locked.
CREATE FUNCTION gridex_e66_intake.hold_compatible_sg11_format_v1(
  original public.ediel_messages, actor uuid
) RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'pg_catalog' AS $hold$
DECLARE
  reception gridex_ediel_inbound_receptions.receptions;
  saved gridex_e66_intake.sg11_compatibility_holds;
  digest text := encode(sha256(convert_to(original.raw_payload,'UTF8')),'hex');
  basis jsonb;
  diagnostic jsonb;
  mailbox uuid;
BEGIN
  PERFORM gridex_ediel_inbound_receptions.authorize_v1(original.company_id,actor,'communication.write');
  SELECT * INTO STRICT reception FROM gridex_ediel_inbound_receptions.receptions r
  WHERE (r.source_message_id,r.company_id,r.environment,r.inbound_email_message_id)
      =(original.id,original.company_id,original.environment,original.inbound_email_message_id)
    AND r.classification='first_reception'
    AND r.canonical_payload_hash=digest AND r.received_payload_hash=digest;
  mailbox:=(reception.transport_source_snapshot->>'mailboxId')::uuid;
  IF mailbox IS NULL OR NOT EXISTS (SELECT FROM public.ediel_mailboxes m
    WHERE m.id=mailbox AND m.environment=original.environment AND
      (m.company_id=original.company_id OR m.is_shared_platform_mailbox IS TRUE)) THEN
    RAISE EXCEPTION 'e66_sg11_compatibility_reception_unavailable' USING ERRCODE='55000';
  END IF;
  basis:=gridex_ediel_source_rules.require_v1(original.company_id,original.id);
  IF basis->>'version' IS DISTINCT FROM '25-A-5:r5'
    OR basis#>>'{snapshot,version}' IS DISTINCT FROM '25-A-5:r5'
    OR basis#>>'{snapshot,rulePack,market}' IS DISTINCT FROM 'electricity'
    OR basis#>>'{snapshot,rulePack,family}' IS DISTINCT FROM 'UTILTS'
    OR basis#>>'{snapshot,rulePack,guide_version}' IS DISTINCT FROM '25-A-5'
    OR basis#>>'{snapshot,rulePack,guide_revision}' IS DISTINCT FROM '5'
    OR coalesce(basis->>'sourceHash','') !~ '^[a-f0-9]{64}$'
    OR NOT EXISTS(SELECT FROM jsonb_array_elements(basis#>'{snapshot,guideSources}') s
      WHERE s->>'source_type'='technical_guide' AND s->>'revision'='25-A-5'
        AND s->>'source_hash'='b76a61b9aa6f136771e5db4948296d1b632b8d775314eb6c93783595ae419db2') THEN
    RAISE EXCEPTION 'e66_sg11_format_review_guide_unavailable' USING ERRCODE='55000';
  END IF;
  diagnostic:=gridex_e66_intake.sg11_forbidden_timestamp_v1(original.raw_payload);
  IF diagnostic IS NULL THEN
    RAISE EXCEPTION 'e66_sg11_format_review_no_occurrence' USING ERRCODE='55000';
  END IF;
  SELECT * INTO saved FROM gridex_e66_intake.sg11_compatibility_holds WHERE source_id=original.id;
  IF FOUND THEN
    IF (saved.company_id,saved.environment,saved.mailbox_id,saved.reception_id,saved.source_sha256,
          saved.profile_checksum,saved.diagnostic) IS DISTINCT FROM
       (original.company_id,original.environment,mailbox,reception.id,digest,basis->>'sourceHash',diagnostic) THEN
      RAISE EXCEPTION 'e66_sg11_compatibility_replay_changed' USING ERRCODE='55000';
    END IF;
    RETURN jsonb_build_object('kind','sg11_format_review','sourceId',original.id,
      'diagnostic',diagnostic,'replayed',true);
  END IF;
  IF EXISTS (SELECT FROM gridex_utilts_binding.receipts WHERE source_message_id=original.id)
    OR EXISTS (SELECT FROM public.ediel_ack_transaction_results WHERE source_message_id=original.id)
    OR EXISTS (SELECT FROM public.ediel_messages a WHERE a.company_id=original.company_id AND a.environment=original.environment
      AND a.related_message_id=original.id AND a.direction='outbound'
      AND a.message_family IN ('APERAK','UTILTS_ERR')) THEN
    RAISE EXCEPTION 'e66_sg11_compatibility_prior_effect' USING ERRCODE='55000';
  END IF;
  INSERT INTO gridex_e66_intake.sg11_compatibility_holds
    (source_id,company_id,environment,mailbox_id,reception_id,source_sha256,profile_checksum,actor_id,diagnostic)
  VALUES(original.id,original.company_id,original.environment,mailbox,reception.id,digest,
    basis->>'sourceHash',actor,diagnostic);
  INSERT INTO public.ediel_message_events
    (company_id,ediel_message_id,message_id,event_type,event_status,message,payload,event_payload,created_by)
  VALUES(original.company_id,original.id,original.id,'validated','warning',
    'E66 hålls för granskning. Tidsstämpeln DTM+597 hör till en otillåten mängdtyp.',
    diagnostic,diagnostic,actor);
  RETURN jsonb_build_object('kind','sg11_format_review','sourceId',original.id,
    'diagnostic',diagnostic,'replayed',false);
END
$hold$;
REVOKE ALL ON FUNCTION gridex_e66_intake.hold_compatible_sg11_format_v1(public.ediel_messages,uuid)
  FROM PUBLIC,anon,authenticated,service_role;

DO $owners$
DECLARE
  owner oid;
  old_catalog jsonb;
  body text;
  definition text;
  prefix text;
  transition text;
BEGIN
 owner:='public.gridex_persist_utilts_consumption_v1(uuid,text,uuid,text,text,jsonb,uuid)'::regprocedure;
 SELECT p.prosrc,pg_get_functiondef(owner),to_jsonb(p)-'prosrc'
  INTO STRICT body,definition,old_catalog FROM pg_proc p WHERE p.oid=owner;
 prefix:=' RETURN gridex_e66_intake.persist_owned_utilts_v1(';
 IF encode(sha256(convert_to(body,'UTF8')),'hex')<>'1b0612772f3873ff668a4a92afaa3c6e8a31df18284fbc09c12cec2f99b42e61'
   OR strpos(body,prefix)=0 THEN RAISE EXCEPTION 'e66_sg11_compatibility_owner_changed'; END IF;
 transition:=$write$
 IF p_message_code='E66' THEN
  IF p_transactions='{"operation":"hold_sg11_format_review"}'::jsonb THEN
   RETURN gridex_e66_intake.hold_compatible_sg11_format_v1(source,p_actor_user_id);
  END IF;
  IF EXISTS (SELECT FROM gridex_e66_intake.sg11_compatibility_holds WHERE source_id=p_source_message_id) THEN
   RAISE EXCEPTION 'e66_sg11_format_review_active' USING ERRCODE='55000';
  END IF;
 END IF;
$write$;
 EXECUTE replace(definition,body,replace(body,prefix,transition||prefix));
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=owner)
   IS DISTINCT FROM old_catalog THEN RAISE EXCEPTION 'e66_sg11_compatibility_owner_metadata_changed'; END IF;

 owner:='public.gridex_finish_e66_classification_v1(uuid,uuid,text,uuid,uuid,uuid,uuid,text,timestamptz,text)'::regprocedure;
 SELECT p.prosrc,pg_get_functiondef(owner),to_jsonb(p)-'prosrc'
  INTO STRICT body,definition,old_catalog FROM pg_proc p WHERE p.oid=owner;
 prefix:=' ts:=clock_timestamp();';
 IF encode(sha256(convert_to(body,'UTF8')),'hex')<>'9626b250cd4468cfacf22c32877d7acd78495f123e0bc5924073402e815a2abb'
   OR strpos(body,prefix)=0 THEN RAISE EXCEPTION 'e66_sg11_native_handoff_changed'; END IF;
 transition:=$handoff$
 IF EXISTS (SELECT FROM gridex_e66_intake.sg11_compatibility_holds WHERE source_id=p_message) THEN
  IF NOT EXISTS (SELECT FROM gridex_e66_intake.sg11_compatibility_holds h WHERE
    (h.source_id,h.company_id,h.environment,h.mailbox_id,h.reception_id,h.source_sha256)
     =(w.source_id,w.company_id,w.environment,w.mailbox_id,w.reception_id,w.payload_sha256))
   OR w.phase IS DISTINCT FROM 'qualification'
   OR w.lease_token IS NOT NULL THEN
   RAISE EXCEPTION 'e66_sg11_native_handoff_review_changed' USING ERRCODE='55000';
  END IF;
  UPDATE gridex_e66_intake.work SET phase='sg11_format_review' WHERE source_id=p_message;
 END IF;
$handoff$;
 EXECUTE replace(definition,body,replace(body,prefix,transition||prefix));
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=owner)
   IS DISTINCT FROM old_catalog THEN RAISE EXCEPTION 'e66_sg11_native_handoff_metadata_changed'; END IF;
END
$owners$;
