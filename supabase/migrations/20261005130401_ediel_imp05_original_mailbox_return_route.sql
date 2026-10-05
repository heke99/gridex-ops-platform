-- IMP05 / T24.A6 §5.4.4: a SMTP acknowledgement comes from the mailbox
-- originally targeted by the retained reception. Extend the same prospective
-- reception and configured-route owners; never reconstruct historical custody.
BEGIN;
LOCK TABLE public.ediel_mailboxes,public.inbound_email_messages,
 gridex_ediel_inbound_receptions.receptions,gridex_unattributed_intake.raw_births
 IN SHARE ROW EXCLUSIVE MODE;

-- The protected intake intentionally has no legal company or ordinary
-- reception. Its existing raw INSERT authority freezes the original mailbox
-- here in the same transaction; never scan or attest earlier mutable mail.
CREATE TABLE gridex_ediel_inbound_receptions.technical_mailbox_births (
 inbound_email_message_id uuid PRIMARY KEY REFERENCES gridex_unattributed_intake.raw_births,
 raw_snapshot_hash text NOT NULL CHECK (raw_snapshot_hash ~ '^[a-f0-9]{64}$'),
 mailbox_id uuid NOT NULL,
 environment text NOT NULL CHECK (environment IN ('test','production')),
 mailbox_company_id uuid,
 mailbox_shared boolean NOT NULL,
 smtp_address text NOT NULL CHECK (smtp_address ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'),
 observed_at timestamptz NOT NULL
);
ALTER TABLE gridex_ediel_inbound_receptions.technical_mailbox_births ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_ediel_inbound_receptions.technical_mailbox_births FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_ediel_inbound_receptions.technical_mailbox_births FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_ediel_inbound_receptions.capture_technical_mailbox_birth_v1() RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path TO pg_catalog AS $$
DECLARE mail public.inbound_email_messages%rowtype;box public.ediel_mailboxes%rowtype;
BEGIN
 IF TG_OP<>'INSERT' OR TG_TABLE_SCHEMA<>'gridex_unattributed_intake' OR TG_TABLE_NAME<>'raw_births'
 THEN RAISE EXCEPTION 'ediel_original_mailbox_birth_owner_required';END IF;
 SELECT * INTO mail FROM public.inbound_email_messages WHERE id=NEW.inbound_email_message_id FOR SHARE;
 SELECT * INTO box FROM public.ediel_mailboxes WHERE id=mail.mailbox_id FOR SHARE;
 -- Missing SMTP holds the later return route, not storage of original mail.
 IF mail.id IS NULL OR box.id IS NULL OR (mail.environment IN ('test','production')) IS NOT TRUE
  OR box.environment IS DISTINCT FROM mail.environment OR box.is_active IS NOT TRUE
  OR NEW.snapshot_hash IS DISTINCT FROM gridex_unattributed_intake.raw_hash_v1(mail)
  OR box.email_address IS NULL OR btrim(box.email_address)!~'^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'
 THEN RETURN NEW;END IF;
 INSERT INTO gridex_ediel_inbound_receptions.technical_mailbox_births(
  inbound_email_message_id,raw_snapshot_hash,mailbox_id,environment,mailbox_company_id,mailbox_shared,smtp_address,observed_at)
 VALUES(mail.id,NEW.snapshot_hash,box.id,mail.environment,box.company_id,box.is_shared_platform_mailbox,btrim(box.email_address),NEW.observed_at);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION gridex_ediel_inbound_receptions.capture_technical_mailbox_birth_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ediel_original_technical_mailbox_birth AFTER INSERT ON gridex_unattributed_intake.raw_births
 FOR EACH ROW EXECUTE FUNCTION gridex_ediel_inbound_receptions.capture_technical_mailbox_birth_v1();
CREATE TRIGGER immutable_receipt BEFORE UPDATE OR DELETE ON gridex_ediel_inbound_receptions.technical_mailbox_births
 FOR EACH ROW EXECUTE FUNCTION gridex_unattributed_intake.immutable_v1();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_ediel_inbound_receptions.technical_mailbox_births
 FOR EACH STATEMENT EXECUTE FUNCTION gridex_unattributed_intake.immutable_v1();

-- The invoker trigger inherits the actual existing definer's authority.
-- Assert compatible ownership instead of adding grants or a new definer.
DO $birth_owner$
DECLARE authority oid;
BEGIN
 SELECT proowner INTO STRICT authority FROM pg_proc
  WHERE oid='gridex_unattributed_intake.capture_custody_v1()'::regprocedure AND prosecdef;
 IF authority IS DISTINCT FROM (SELECT proowner FROM pg_proc
   WHERE oid='gridex_ediel_technical_ack.select_configured_reply_route_v2(uuid,jsonb,text,text,text,integer)'::regprocedure)
  OR authority IS DISTINCT FROM (SELECT proowner FROM pg_proc
   WHERE oid='gridex_ediel_inbound_receptions.capture_technical_mailbox_birth_v1()'::regprocedure AND NOT prosecdef)
  OR authority IS DISTINCT FROM (SELECT relowner FROM pg_class
   WHERE oid='gridex_ediel_inbound_receptions.technical_mailbox_births'::regclass)
  OR NOT EXISTS(SELECT FROM pg_trigger WHERE tgrelid='public.inbound_email_messages'::regclass
   AND tgfoid='gridex_unattributed_intake.capture_custody_v1()'::regprocedure
   AND tgname='gridex_technical_raw_birth' AND tgenabled IN ('O','A'))
 THEN RAISE EXCEPTION 'ediel_original_mailbox_birth_authority_required';END IF;
END $birth_owner$;

DO $capture$
DECLARE f regprocedure:='public.ediel_record_inbound_reception_v1(uuid,uuid,uuid,uuid,uuid)'::regprocedure;
 before jsonb;after jsonb;body text;definition text;needle text;replacement text;
BEGIN
 SELECT jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl::text,'security',prosecdef,'config',proconfig,'volatility',provolatile,'parallel',proparallel),prosrc
 INTO STRICT before,body FROM pg_proc WHERE oid=f;
 IF position('gridex_ediel_inbound_receptions.authorize_v1' IN body)=0
  OR position('ediel_reception_retained_transport_bytes_required' IN body)=0
  OR position('(m.mailbox_message_id=mail.id::text)' IN body)=0
  OR position('RETURN gridex_ediel_inbound_receptions.result_v1(prior,true)' IN body)=0
 THEN RAISE EXCEPTION 'ediel_imp05_original_reception_owner_required';END IF;
 needle:='INSERT INTO gridex_ediel_inbound_receptions.receptions(company_id,source_message_id,inbound_email_message_id,parse_result_id,actor_user_id,environment,canonical_payload_hash,received_payload_hash,received_at,classification,scope,transport_source_snapshot)';
 IF (length(body)-length(replace(body,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'ediel_imp05_reception_insert_boundary_changed';END IF;
 replacement:=$sql$IF box.email_address IS NULL OR btrim(box.email_address)!~'^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' THEN
  RAISE EXCEPTION 'ediel_original_mailbox_smtp_custody_required';END IF;
 $sql$||needle;
 body:=replace(body,needle,replacement);
 needle:=$sql$'sourceKind','retained_mail_observation','deliveryAuthenticated',false$sql$;
 IF (length(body)-length(replace(body,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'ediel_imp05_reception_snapshot_boundary_changed';END IF;
 body:=replace(body,needle,needle||$sql$,'originalMailboxSmtpAddress',btrim(box.email_address),'originalMailboxCompanyId',box.company_id,'originalMailboxEnvironment',box.environment,'originalMailboxShared',box.is_shared_platform_mailbox$sql$);
 definition:=pg_get_functiondef(f);
 IF position((SELECT prosrc FROM pg_proc WHERE oid=f) IN definition)=0 THEN RAISE EXCEPTION 'ediel_imp05_reception_definition_binding_required';END IF;
 EXECUTE replace(definition,(SELECT prosrc FROM pg_proc WHERE oid=f),body);
 SELECT jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl::text,'security',prosecdef,'config',proconfig,'volatility',provolatile,'parallel',proparallel)
 INTO STRICT after FROM pg_proc WHERE oid=f;
 IF before IS DISTINCT FROM after THEN RAISE EXCEPTION 'ediel_imp05_reception_authority_changed';END IF;
END $capture$;

DO $reader$
DECLARE f regprocedure:='gridex_ediel_technical_ack.select_configured_reply_route_v2(uuid,jsonb,text,text,text,integer)'::regprocedure;
 before jsonb;after jsonb;body text;definition text;needle text;replacement text;
BEGIN
 SELECT jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl::text,'security',prosecdef,'config',proconfig,'volatility',provolatile,'parallel',proparallel),prosrc
 INTO STRICT before,body FROM pg_proc WHERE oid=f;
 IF position('ediel_prescribed_reply_route_basis_required' IN body)=0
  OR position('reply_family NOT IN(''CONTRL'',''APERAK'')' IN body)=0
  OR position('e->>''companyId'' IS DISTINCT FROM c::text' IN body)=0
  OR position('gridex_ediel_technical_ack.require_current_endpoint_v1' IN body)=0
  OR position('p.mailbox=current_smtp_from' IN body)=0
  OR position('p.application_reference IS NOT DISTINCT FROM' IN body)=0
 THEN RAISE EXCEPTION 'ediel_imp05_current_ack_route_owner_required';END IF;
 needle:='candidate_profile_ids uuid[];env text;';
 IF (length(body)-length(replace(body,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'ediel_imp05_ack_declaration_boundary_changed';END IF;
 body:=replace(body,needle,needle||'original public.ediel_messages%rowtype;reception gridex_ediel_inbound_receptions.receptions%rowtype;original_box public.ediel_mailboxes%rowtype;birth_smtp text;technical_birth record;smtp_birth gridex_ediel_inbound_receptions.technical_mailbox_births%rowtype;common_basis jsonb;');
 needle:='LOCK TABLE public.communication_routes,public.ediel_route_profiles,public.ediel_transport_profiles IN SHARE MODE;';
 IF (length(body)-length(replace(body,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'ediel_imp05_ack_current_route_boundary_changed';END IF;
 replacement:=$sql$SELECT * INTO original FROM public.ediel_messages WHERE id=msg AND (company_id=c OR company_id IS NULL) FOR SHARE;
 IF original.id IS NULL OR original.direction IS DISTINCT FROM 'inbound' OR original.environment IS DISTINCT FROM env
  OR nullif(original.mailbox_message_id,'') IS NULL OR nullif(original.raw_payload,'') IS NULL
  OR e->>'sourceHash' IS DISTINCT FROM encode(sha256(convert_to(original.raw_payload,'UTF8')),'hex')
 THEN RAISE EXCEPTION 'ediel_original_mailbox_source_required';END IF;
 IF original.company_id IS NULL THEN
  IF gridex_unattributed_intake.is_birth_v1(original) IS NOT TRUE
   OR gridex_ediel_technical_ack.require_source_v1(c,original.id) IS DISTINCT FROM e
  THEN RAISE EXCEPTION 'ediel_original_mailbox_source_required';END IF;
  IF reply_family='APERAK' THEN
   common_basis:=gridex_ediel_common_header.require_v1(c,env,original.id);
   PERFORM gridex_ediel_common_header.require_current_scope_v1(common_basis);
   IF e->>'sourceHash' IS DISTINCT FROM common_basis->>'sourceHash'
    OR e->>'syntaxAssessmentId' IS DISTINCT FROM common_basis->>'syntaxAssessmentId'
   THEN RAISE EXCEPTION 'ediel_common_header_route_basis_mismatch';END IF;
  END IF;
  SELECT * INTO technical_birth FROM gridex_unattributed_intake.technical_births WHERE source_message_id=original.id FOR SHARE;
  PERFORM gridex_unattributed_intake.require_custody_v1(technical_birth.inbound_email_message_id,technical_birth.parse_result_id);
  IF NOT EXISTS(SELECT FROM gridex_ediel_technical_ack.sources source
   WHERE source.source_message_id=original.id AND source.company_id=c AND source.source_company_id IS NULL
    AND source.status='ready' AND source.environment=env AND source.payload_sha256=e->>'sourceHash'
    AND source.source_received_at=original.message_received_at)
   OR NOT EXISTS(SELECT FROM gridex_unattributed_intake.physical_claims claim
    WHERE claim.protected_source_id=original.id
     AND claim.physical_key=gridex_unattributed_intake.physical_key_v1(technical_birth.physical_envelope))
  THEN RAISE EXCEPTION 'ediel_original_mailbox_source_required';END IF;
  SELECT * INTO smtp_birth FROM gridex_ediel_inbound_receptions.technical_mailbox_births
   WHERE inbound_email_message_id=technical_birth.inbound_email_message_id AND environment=env FOR SHARE;
  birth_smtp:=smtp_birth.smtp_address;
  IF smtp_birth.inbound_email_message_id IS NULL OR birth_smtp IS NULL
   OR birth_smtp!~'^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'
   OR lower(btrim(current_smtp_from)) IS DISTINCT FROM lower(birth_smtp)
   OR NOT EXISTS(SELECT FROM gridex_unattributed_intake.raw_births raw
    WHERE raw.inbound_email_message_id=smtp_birth.inbound_email_message_id
     AND raw.snapshot_hash=smtp_birth.raw_snapshot_hash AND raw.observed_at=smtp_birth.observed_at)
  THEN RAISE EXCEPTION 'ediel_original_mailbox_smtp_custody_required';END IF;
  SELECT box.* INTO original_box FROM public.ediel_mailboxes box
   JOIN public.inbound_email_messages mail ON mail.mailbox_id=box.id
   WHERE mail.id=technical_birth.inbound_email_message_id AND box.id=smtp_birth.mailbox_id
    AND original.mailbox_message_id=mail.id::text AND original.inbound_email_message_id=mail.id
    AND mail.company_id IS NULL AND mail.environment=env AND box.environment=env AND box.is_active
    AND (box.company_id=c OR box.company_id IS NULL)
    AND box.company_id IS NOT DISTINCT FROM smtp_birth.mailbox_company_id
    AND box.is_shared_platform_mailbox IS NOT DISTINCT FROM smtp_birth.mailbox_shared
   FOR SHARE OF box,mail;
  IF original_box.id IS NULL THEN RAISE EXCEPTION 'ediel_original_mailbox_source_required';END IF;
  -- Recheck complete custody after the mailbox lock, including mailbox_type.
  PERFORM gridex_unattributed_intake.require_custody_v1(technical_birth.inbound_email_message_id,technical_birth.parse_result_id);
 ELSE
 SELECT * INTO reception FROM gridex_ediel_inbound_receptions.receptions
  WHERE source_message_id=original.id AND company_id=c AND environment=env
   AND classification='first_reception' AND inbound_email_message_id::text=original.mailbox_message_id FOR SHARE;
 birth_smtp:=reception.transport_source_snapshot->>'originalMailboxSmtpAddress';
 IF reception.id IS NULL OR reception.canonical_payload_hash IS DISTINCT FROM e->>'sourceHash'
  OR reception.received_payload_hash IS DISTINCT FROM reception.canonical_payload_hash
  OR reception.transport_source_snapshot->>'parsePayloadHash' IS DISTINCT FROM reception.received_payload_hash
  OR reception.transport_source_snapshot->>'originalMailboxEnvironment' IS DISTINCT FROM env
  OR birth_smtp IS NULL OR birth_smtp!~'^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'
  OR lower(btrim(current_smtp_from)) IS DISTINCT FROM lower(birth_smtp)
 THEN RAISE EXCEPTION 'ediel_original_mailbox_smtp_custody_required';END IF;
 SELECT box.* INTO original_box FROM public.ediel_mailboxes box
  JOIN public.inbound_email_messages mail ON mail.mailbox_id=box.id
  WHERE mail.id=reception.inbound_email_message_id AND box.id::text=reception.transport_source_snapshot->>'mailboxId'
   AND (mail.company_id IS NULL OR mail.company_id=c) AND (mail.environment IS NULL OR mail.environment=env)
   AND box.environment=env AND box.is_active
   AND (box.company_id=c OR box.company_id IS NULL OR box.is_shared_platform_mailbox)
   AND (reception.transport_source_snapshot->>'originalMailboxCompanyId'=c::text
    OR reception.transport_source_snapshot->>'originalMailboxCompanyId' IS NULL
    OR reception.transport_source_snapshot->'originalMailboxShared'='true'::jsonb)
  FOR SHARE OF box,mail;
 IF original_box.id IS NULL THEN RAISE EXCEPTION 'ediel_original_mailbox_source_required';END IF;
 END IF;
 $sql$||needle;
 body:=replace(body,needle,replacement);
 definition:=pg_get_functiondef(f);
 IF position((SELECT prosrc FROM pg_proc WHERE oid=f) IN definition)=0 THEN RAISE EXCEPTION 'ediel_imp05_ack_definition_binding_required';END IF;
 EXECUTE replace(definition,(SELECT prosrc FROM pg_proc WHERE oid=f),body);
 SELECT jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl::text,'security',prosecdef,'config',proconfig,'volatility',provolatile,'parallel',proparallel)
 INTO STRICT after FROM pg_proc WHERE oid=f;
 IF before IS DISTINCT FROM after THEN RAISE EXCEPTION 'ediel_imp05_ack_route_authority_changed';END IF;
END $reader$;
COMMIT;
