-- IMP05 / T24.A6 §5.4.4: a SMTP acknowledgement comes from the mailbox
-- originally targeted by the retained reception. Extend the same prospective
-- reception and configured-route owners; never reconstruct historical custody.
BEGIN;
LOCK TABLE public.ediel_mailboxes,public.inbound_email_messages,
 gridex_ediel_inbound_receptions.receptions IN SHARE ROW EXCLUSIVE MODE;

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
 body:=replace(body,needle,needle||'original public.ediel_messages%rowtype;reception gridex_ediel_inbound_receptions.receptions%rowtype;original_box public.ediel_mailboxes%rowtype;birth_smtp text;');
 needle:='LOCK TABLE public.communication_routes,public.ediel_route_profiles,public.ediel_transport_profiles IN SHARE MODE;';
 IF (length(body)-length(replace(body,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'ediel_imp05_ack_current_route_boundary_changed';END IF;
 replacement:=$sql$SELECT * INTO original FROM public.ediel_messages WHERE id=msg AND company_id=c FOR SHARE;
 IF original.id IS NULL OR original.direction IS DISTINCT FROM 'inbound' OR original.environment IS DISTINCT FROM env
  OR nullif(original.mailbox_message_id,'') IS NULL OR nullif(original.raw_payload,'') IS NULL
  OR e->>'sourceHash' IS DISTINCT FROM encode(sha256(convert_to(original.raw_payload,'UTF8')),'hex')
 THEN RAISE EXCEPTION 'ediel_original_mailbox_source_required';END IF;
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
