-- Created by Supabase CLI2.120.0. Assigned retained-mail permanent negatives only.
BEGIN;
-- Assigned retained-mail negative birth only. No code-profile or business grant.
CREATE SCHEMA gridex_ediel_header_negative_birth;
REVOKE ALL ON SCHEMA gridex_ediel_header_negative_birth FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE gridex_ediel_header_negative_birth.guide_extensions(version text PRIMARY KEY,evidence jsonb NOT NULL);
CREATE TABLE gridex_ediel_header_negative_birth.receipts(
 source_message_id uuid PRIMARY KEY REFERENCES public.ediel_messages(id) DEFERRABLE INITIALLY DEFERRED,
 company_id uuid NOT NULL,environment text NOT NULL CHECK(environment IN('test','production')),actor_user_id uuid NOT NULL,
 inbound_email_message_id uuid NOT NULL UNIQUE REFERENCES public.inbound_email_messages(id),parse_result_id uuid NOT NULL UNIQUE REFERENCES public.inbound_ediel_parse_results(id),
 payload_sha256 text NOT NULL CHECK(payload_sha256~'^[a-f0-9]{64}$'),source_received_at timestamptz NOT NULL,
 observed_at timestamptz NOT NULL,creation_txid bigint NOT NULL,status text NOT NULL CHECK(status IN('pending','consumed')),
 source_facts jsonb NOT NULL,evidence jsonb NOT NULL
);
ALTER TABLE gridex_ediel_header_negative_birth.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_ediel_header_negative_birth.receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE gridex_ediel_header_negative_birth.guide_extensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_ediel_header_negative_birth.guide_extensions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA gridex_ediel_header_negative_birth FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_ediel_header_negative_birth.classify_v1(raw text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE t jsonb:=gridex_utilts_binding.wire_tokens_v1(raw);u jsonb:=gridex_ediel_technical_ack.envelope(raw);h jsonb;b jsonb;l jsonb;selector jsonb;trailer jsonb;end_interchange jsonb;reason text;code text;field text;li text;missing integer;
BEGIN
 IF t IS NULL OR u IS NULL OR octet_length(raw)>262144
  OR EXISTS(SELECT FROM unnest(ARRAY['UNB','UNH','BGM','LIN','UNT','UNZ'])tag WHERE (SELECT count(*) FROM jsonb_array_elements(t)x WHERE x->>'tag'=tag)<>1) THEN RETURN NULL;END IF;
 SELECT x INTO trailer FROM jsonb_array_elements(t)x WHERE x->>'tag'='UNT';SELECT x INTO end_interchange FROM jsonb_array_elements(t)x WHERE x->>'tag'='UNZ';
 SELECT x INTO h FROM jsonb_array_elements(t)x WHERE x->>'tag'='UNH';SELECT x INTO b FROM jsonb_array_elements(t)x WHERE x->>'tag'='BGM';SELECT x INTO l FROM jsonb_array_elements(t)x WHERE x->>'tag'='LIN';
 IF (h->>'index')::int<>1 OR (trailer->>'index')::int<>jsonb_array_length(t)-2 OR (end_interchange->>'index')::int<>jsonb_array_length(t)-1
  OR trailer#>'{elements,1}' IS DISTINCT FROM jsonb_build_array(((trailer->>'index')::int-(h->>'index')::int+1)::text) OR trailer#>'{elements,2}' IS DISTINCT FROM h#>'{elements,1}'
  OR end_interchange#>'{elements,1}' IS DISTINCT FROM '["1"]'::jsonb OR end_interchange#>>'{elements,2,0}' IS DISTINCT FROM u->>'interchangeReference'
  OR h#>'{elements,2}' IS DISTINCT FROM '["PRODAT","D","97A","UN","E2SE6A"]'::jsonb
  OR nullif(h#>>'{elements,1,0}','') IS NULL OR length(h#>>'{elements,1,0}')>14
  OR nullif(b#>>'{elements,2,0}','') IS NULL OR length(b#>>'{elements,2,0}')>35
  OR b#>>'{elements,3,0}' IS DISTINCT FROM '9' OR b#>>'{elements,4,0}' IS DISTINCT FROM 'AB'
  OR l#>'{elements,1}' IS DISTINCT FROM '["1"]'::jsonb OR coalesce(l#>'{elements,2}','[]') NOT IN('[]'::jsonb,'[""]'::jsonb)
  OR coalesce(l#>>'{elements,3,0}','')!~'^[0-9]{18}$' OR coalesce(l#>>'{elements,3,3}','') NOT IN('9','89')
  OR (l->>'index')::int<=(b->>'index')::int THEN RETURN NULL;END IF;
 SELECT x INTO selector FROM jsonb_array_elements(t)x WHERE x->>'tag'='CCI' AND x#>>'{elements,2,0}'='Z13';
 IF (SELECT count(*) FROM jsonb_array_elements(t)x WHERE x->>'tag'='CCI' AND x#>>'{elements,2,0}'='Z13')>1 THEN RETURN NULL;END IF;
 IF selector IS NOT NULL THEN
  IF (selector->>'index')::int<=(l->>'index')::int THEN RETURN NULL;END IF;
  SELECT x#>>'{elements,1,0}' INTO reason FROM jsonb_array_elements(t)x WHERE x->>'tag'='CAV' AND (x->>'index')::int=(selector->>'index')::int+1;
  IF reason IS DISTINCT FROM 'Z25' THEN RETURN NULL;END IF;
 END IF;
 missing:=(nullif(b#>>'{elements,1,0}','') IS NULL)::int+(nullif(u->>'applicationReference','') IS NULL)::int+(selector IS NULL)::int;
 IF missing<>1 THEN RETURN NULL;END IF;code:=nullif(b#>>'{elements,1,0}','');
 field:=CASE WHEN code IS NULL THEN '202' WHEN nullif(u->>'applicationReference','') IS NULL THEN '311' ELSE '223' END;
 IF field='202' AND(u->>'applicationReference' IS DISTINCT FROM '23-DDQ-PRODAT' OR reason IS DISTINCT FROM 'Z25' OR EXISTS(SELECT FROM jsonb_array_elements_text(coalesce(b#>'{elements,1}','[]'))x WHERE nullif(x,'') IS NOT NULL)) THEN RETURN NULL;END IF;
 IF field IN('311','223') AND code IS DISTINCT FROM 'Z04' THEN RETURN NULL;END IF;
 IF field='223' AND u->>'applicationReference' IS DISTINCT FROM '23-DDQ-PRODAT' THEN RETURN NULL;END IF;
 IF field='311' AND reason IS DISTINCT FROM 'Z25' THEN RETURN NULL;END IF;
 SELECT min(x#>>'{elements,1,1}') INTO li FROM jsonb_array_elements(t)x WHERE x->>'tag'='RFF' AND x#>>'{elements,1,0}'='LI' AND (x->>'index')::int>(l->>'index')::int;
 IF (SELECT count(*) FROM jsonb_array_elements(t)x WHERE x->>'tag'='RFF' AND x#>>'{elements,1,0}'='LI' AND (x->>'index')::int>(l->>'index')::int)<>1 OR nullif(li,'') IS NULL OR length(li)>35 THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('fieldCode',field,'physicalCode',code,'parsedCode',coalesce(code,'PRODAT_UNKNOWN'),'originalUNB',u,'messageReference',h#>>'{elements,1,0}',
  'negativeScope',CASE field WHEN '223' THEN 'object' ELSE 'message' END,'ownOccurrence',CASE WHEN field='223' THEN jsonb_build_object('scope','object','messageReference',h#>>'{elements,1,0}','lineIndex',0,'lineNumber','1','registerPosition',1,'firstLineIndex',(l->>'index')::int,'objectId',l#>>'{elements,3,0}','identityAgency',l#>>'{elements,3,3}','lineItemReference',li) ELSE NULL END);
END $$;

CREATE FUNCTION gridex_ediel_header_negative_birth.family_basis_v1(c uuid,env text,raw text,received_at timestamptz,observed timestamptz,classification jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t jsonb:=gridex_utilts_binding.wire_tokens_v1(raw);l integer;fr jsonb;recipient jsonb;cs uuid[];actors uuid[];namespace jsonb;
 editions jsonb;edition jsonb;guide jsonb;pack public.ediel_rule_packs%rowtype;sources jsonb;day date;g jsonb;process jsonb;process_version text;role_facts jsonb;market_facts jsonb;correction jsonb;field text:=classification->>'fieldCode';reply_app text:=nullif(classification#>>'{originalUNB,applicationReference}','');
BEGIN
 IF classification IS NULL OR classification#>>'{originalUNB,environment}' IS DISTINCT FROM env OR received_at IS NULL THEN RAISE EXCEPTION 'assigned_prodat_negative_family_basis_required';END IF;
 SELECT min((x->>'index')::int) INTO l FROM jsonb_array_elements(t)x WHERE x->>'tag'='LIN';
 SELECT x INTO STRICT fr FROM jsonb_array_elements(t)x WHERE x->>'tag'='NAD' AND x#>>'{elements,1,0}'='FR' AND (x->>'index')::int<l;
 SELECT x INTO STRICT recipient FROM jsonb_array_elements(t)x WHERE x->>'tag'='NAD' AND x#>>'{elements,1,0}'='DO' AND (x->>'index')::int<l;
 IF fr#>'{elements,2}' IS DISTINCT FROM jsonb_build_array(fr#>>'{elements,2,0}','160','SVK') OR recipient#>'{elements,2}' IS DISTINCT FROM jsonb_build_array(recipient#>>'{elements,2,0}','160','SVK')
  OR coalesce(fr#>>'{elements,2,0}','')!~'^[0-9]{5}$' OR coalesce(recipient#>>'{elements,2,0}','')!~'^[0-9]{5}$'
  OR coalesce(fr#>>'{elements,9,0}','')!~'^[A-Z]{2}$' OR coalesce(recipient#>>'{elements,9,0}','')!~'^[A-Z]{2}$' THEN RAISE EXCEPTION 'assigned_prodat_negative_legal_header_required';END IF;
 LOCK TABLE public.tenant_actor_identifiers,public.tenant_actor_roles,public.tenant_ediel_profiles IN SHARE MODE;
 SELECT array_agg(DISTINCT i.company_id),array_agg(DISTINCT i.actor_id) INTO cs,actors FROM public.tenant_actor_identifiers i WHERE i.environment=env AND i.identifier_type='EdielId' AND i.identifier_value=recipient#>>'{elements,2,0}' AND i.valid_from<=observed AND(i.valid_to IS NULL OR observed<i.valid_to);
 IF cardinality(cs) IS DISTINCT FROM 1 OR cardinality(actors) IS DISTINCT FROM 1 OR cs[1] IS DISTINCT FROM c THEN RAISE EXCEPTION 'assigned_prodat_negative_namespace_required';END IF;
 SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) INTO namespace FROM public.tenant_actor_identifiers i WHERE i.company_id=c AND i.actor_id=actors[1] AND i.environment=env AND i.identifier_type='EdielId' AND i.identifier_value=recipient#>>'{elements,2,0}' AND i.valid_from<=observed AND(i.valid_to IS NULL OR observed<i.valid_to);
 day:=(received_at AT TIME ZONE 'Europe/Stockholm')::date;
 SELECT jsonb_agg(e.evidence) INTO editions FROM gridex_ediel_common_header.source_editions e WHERE e.evidence#>>'{originalSource,sha256}'='83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95' AND EXISTS(SELECT FROM jsonb_array_elements(e.evidence#>'{catalog,guides}')x WHERE(x->>'effectiveFrom')::date<=day AND(x->>'effectiveTo' IS NULL OR day<=(x->>'effectiveTo')::date));
 IF jsonb_array_length(coalesce(editions,'[]'))<>1 THEN RAISE EXCEPTION 'assigned_prodat_negative_original_guide_required';END IF;edition:=editions->0;
 SELECT x INTO STRICT guide FROM jsonb_array_elements(edition#>'{catalog,guides}')x WHERE(x->>'effectiveFrom')::date<=day AND(x->>'effectiveTo' IS NULL OR day<=(x->>'effectiveTo')::date);
 LOCK TABLE public.ediel_rule_packs,public.ediel_rule_pack_sources IN SHARE MODE;
 SELECT * INTO STRICT pack FROM public.ediel_rule_packs p WHERE p.family='PRODAT' AND p.market='electricity' AND p.status IN('active','transition','future') AND p.guide_version||':r'||p.guide_revision=edition#>>'{catalog,registeredVersion}' AND p.unh_association_code=guide->>'associationAssignedCode' AND p.valid_from<=day AND(p.valid_to IS NULL OR day<=p.valid_to);
 SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') INTO sources FROM public.ediel_rule_pack_sources s WHERE s.rule_pack_id=pack.id;
 SELECT evidence INTO STRICT g FROM gridex_ediel_header_negative_birth.guide_extensions;
 IF g->>'sourceSha256' IS DISTINCT FROM edition#>>'{originalSource,sha256}' OR g#>>'{sourceTable,source}' IS DISTINCT FROM 'P' OR g#>>'{sourceTable,page}' IS DISTINCT FROM '120' OR g->>'tableIndex' IS DISTINCT FROM '105' THEN RAISE EXCEPTION 'assigned_prodat_negative_original_guide_required';END IF;
 IF field='311' THEN
  -- Existing frozen source process projection, not a business profile, owns the
  -- correction. The actual source remains missing APP and receives no role grant.
  process_version:='111385d7f0a83dd865de369ccee9aae3dc52098a5d3105cb3bacb4070ff7579b';
  SELECT x INTO STRICT process FROM gridex_ediel_readiness.source_editions e CROSS JOIN LATERAL jsonb_array_elements(e.catalog)x WHERE e.source_version=process_version AND x->>'family'='PRODAT' AND x->>'code'='Z04' AND x->>'subtype'='H' AND x->>'transactionReasonCode'='Z25' AND x->>'direction'='inbound' AND x->'receiverRoles'='["supplier"]'::jsonb AND x->'applicationReferences'='["23-DDQ-PRODAT"]'::jsonb;
  SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) INTO role_facts FROM public.tenant_actor_roles r WHERE r.company_id=c AND r.environment=env AND r.actor_id=actors[1] AND r.role_code='electricity_supplier' AND r.valid_from<=observed AND(r.valid_to IS NULL OR observed<r.valid_to);
  SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) INTO market_facts FROM public.tenant_ediel_profiles p WHERE p.company_id=c AND p.environment=env AND p.market='electricity' AND p.is_enabled AND p.valid_from<=observed AND(p.valid_to IS NULL OR observed<p.valid_to);
  IF jsonb_array_length(coalesce(role_facts,'[]'))<>1 OR jsonb_array_length(coalesce(market_facts,'[]'))<>1 THEN RAISE EXCEPTION 'assigned_prodat_negative_311_supplier_process_required';END IF;
  reply_app:=process#>>'{applicationReferences,0}';
  correction:=jsonb_build_object('sourceEdition',edition->>'sourceVersion','sourceSha256',g->>'sourceSha256','tableIndex',105,'page',120,'fieldCode','311','originalApplicationReference',NULL,'expectedApplicationReference',reply_app,'processEdition',process_version,'canonicalProjection',process,'actorRole','electricity_supplier','market','electricity','legalActorId',actors[1],'roleFacts',role_facts,'marketFacts',market_facts,'sourceTableSha256',g->>'sourceTableSha256');
 END IF;
 RETURN jsonb_build_object('kind','prodat_common_header_rejection','version',1,'companyId',c,'environment',env,'sourceHash',encode(sha256(convert_to(raw,'UTF8')),'hex'),'sourceReceivedAt',received_at,'observedAt',observed,
  'negativeField',jsonb_build_object('fieldCode',field,'ercCode','41','text',(edition#>>ARRAY['catalog','ackConstraints','fieldLabels',field])||' saknas'),'negativeScope',classification->'negativeScope','ownOccurrence',classification->'ownOccurrence',
  'guide',guide,'familyEdition',jsonb_build_object('version',edition#>>'{catalog,registeredVersion}','rulePack',to_jsonb(pack),'guideSources',sources,'sourceProjection',edition||jsonb_build_object('negativeHeaderGuide',g)),
  'identities',jsonb_build_object('family','PRODAT','transport',jsonb_build_object('interchangeReference',classification#>>'{originalUNB,interchangeReference}','uciReference',classification#>>'{originalUNB,uciReference}','senderComponents',classification#>'{originalUNB,sender}','receiverComponents',classification#>'{originalUNB,receiver}'),
   'legalSender',jsonb_build_object('id',fr#>>'{elements,2,0}','identityComponents',fr#>'{elements,2}','country',fr#>>'{elements,9,0}'),'legalReceiver',jsonb_build_object('id',recipient#>>'{elements,2,0}','identityComponents',recipient#>'{elements,2}','country',recipient#>>'{elements,9,0}'),'applicationReference',nullif(classification#>>'{originalUNB,applicationReference}','')),
  'legalNamespace',namespace,'replyApplicationReference',reply_app,'applicationReferenceCorrection',correction,'authorizesBusinessEffect',false,'permanentNegative',true)
  || CASE WHEN field='202' THEN jsonb_build_object('field202',jsonb_build_object('fieldCode','202','ercCode','41','text',edition#>>'{catalog,label}'||' saknas')) ELSE '{}'::jsonb END;
END $$;

CREATE FUNCTION gridex_ediel_header_negative_birth.is_bound_v1(m public.ediel_messages,pending boolean DEFAULT false) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT FROM gridex_ediel_header_negative_birth.receipts r WHERE r.source_message_id=m.id AND r.company_id=m.company_id AND r.environment=m.environment AND r.actor_user_id=m.created_by
  AND r.inbound_email_message_id=m.inbound_email_message_id AND r.inbound_email_message_id::text=m.mailbox_message_id AND r.source_received_at=m.message_received_at AND r.payload_sha256=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
  AND m.direction='inbound' AND m.message_standard='edifact' AND m.message_family='PRODAT' AND m.resolved_company_id=m.company_id
  AND m.message_code=r.source_facts->>'messageCode' AND m.application_reference IS NOT DISTINCT FROM r.source_facts->>'applicationReference'
  AND m.sender_ediel_id=r.source_facts->>'senderEdielId' AND m.receiver_ediel_id=r.source_facts->>'receiverEdielId' AND m.interchange_reference=r.source_facts->>'interchangeReference'
  AND m.canonical_rule_pack_id IS NULL AND m.rule_profile_version_id IS NULL AND m.rule_profile_key IS NULL AND m.rule_profile_version IS NULL AND m.rule_pack_checksum IS NULL AND coalesce(m.rule_pack_snapshot,'{}')='{}'::jsonb
  AND m.switch_request_id IS NULL AND m.grid_owner_data_request_id IS NULL AND m.partner_export_id IS NULL
  AND m.customer_id IS NULL AND m.site_id IS NULL AND m.metering_point_id IS NULL AND m.grid_owner_id IS NULL AND m.outbound_request_id IS NULL AND m.related_message_id IS NULL
  AND ((pending AND r.status='pending' AND r.creation_txid=txid_current()) OR(NOT pending AND r.status='consumed')))
$$;

CREATE FUNCTION gridex_ediel_header_negative_birth.receipt_guard_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.status='pending' AND NEW.status='consumed' AND OLD.creation_txid=txid_current()
  AND (to_jsonb(NEW)-'status')=(to_jsonb(OLD)-'status') AND EXISTS(SELECT FROM public.ediel_messages m WHERE m.id=NEW.source_message_id AND gridex_ediel_header_negative_birth.is_bound_v1(m,true)) THEN RETURN NEW;END IF;
 RAISE EXCEPTION 'assigned_prodat_negative_birth_receipt_immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER immutable_receipt BEFORE UPDATE OR DELETE ON gridex_ediel_header_negative_birth.receipts FOR EACH ROW EXECUTE FUNCTION gridex_ediel_header_negative_birth.receipt_guard_v1();
CREATE FUNCTION gridex_ediel_header_negative_birth.complete_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT FROM gridex_ediel_header_negative_birth.receipts r JOIN public.ediel_messages m ON m.id=r.source_message_id WHERE r.source_message_id=NEW.source_message_id AND r.status='consumed' AND gridex_ediel_header_negative_birth.is_bound_v1(m,false)) THEN RAISE EXCEPTION 'assigned_prodat_negative_birth_not_consumed';END IF;RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER complete_birth AFTER INSERT ON gridex_ediel_header_negative_birth.receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gridex_ediel_header_negative_birth.complete_v1();
CREATE FUNCTION gridex_ediel_header_negative_birth.immutable_guide_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN RAISE EXCEPTION 'assigned_prodat_negative_original_guide_immutable';END $$;
CREATE TRIGGER immutable_guide BEFORE UPDATE OR DELETE ON gridex_ediel_header_negative_birth.guide_extensions FOR EACH ROW EXECUTE FUNCTION gridex_ediel_header_negative_birth.immutable_guide_v1();
CREATE FUNCTION gridex_ediel_header_negative_birth.original_guard_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT FROM gridex_ediel_header_negative_birth.receipts r WHERE r.source_message_id=OLD.id) THEN IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;END IF;
 IF TG_OP='UPDATE' AND OLD.raw_payload IS NOT NULL AND NEW.raw_payload IS NULL AND public.ediel_is_qualified_retention_transition_v1(OLD,NEW) THEN RETURN NEW;END IF;
 IF TG_OP='UPDATE' AND gridex_ediel_header_negative_birth.is_bound_v1(NEW,false) AND NEW.immutable_payload_hash IS NOT DISTINCT FROM OLD.immutable_payload_hash
  AND NEW.sender_sub_address IS NOT DISTINCT FROM OLD.sender_sub_address AND NEW.receiver_sub_address IS NOT DISTINCT FROM OLD.receiver_sub_address
  AND NEW.parsed_unb_sender_ediel_id IS NOT DISTINCT FROM OLD.parsed_unb_sender_ediel_id AND NEW.parsed_unb_receiver_ediel_id IS NOT DISTINCT FROM OLD.parsed_unb_receiver_ediel_id
  AND NEW.external_reference IS NOT DISTINCT FROM OLD.external_reference THEN RETURN NEW;END IF;
 RAISE EXCEPTION 'assigned_prodat_negative_original_immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER assigned_prodat_negative_original_immutable BEFORE UPDATE OR DELETE ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_ediel_header_negative_birth.original_guard_v1();

CREATE FUNCTION gridex_ediel_header_negative_birth.create_v1(c uuid,env text,actor uuid,mail_id uuid,parse_id uuid,expected_raw text,expected_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE mail public.inbound_email_messages%rowtype;p public.inbound_ediel_parse_results%rowtype;box public.ediel_mailboxes%rowtype;m public.ediel_messages%rowtype;r gridex_ediel_header_negative_birth.receipts%rowtype;
 observed timestamptz;classification jsonb;e jsonb;facts jsonb;reception jsonb;tokens jsonb;bgm jsonb;
BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();PERFORM gridex_ediel_inbound_receptions.authorize_v1(c,actor,'communication.write');
 IF env IS NULL OR env NOT IN('test','production') OR mail_id IS NULL OR parse_id IS NULL OR expected_raw IS NULL OR expected_hash IS NULL OR expected_hash IS DISTINCT FROM encode(sha256(convert_to(expected_raw,'UTF8')),'hex') THEN RAISE EXCEPTION 'assigned_prodat_negative_expected_original_required';END IF;
 SELECT * INTO mail FROM public.inbound_email_messages WHERE id=mail_id FOR UPDATE;SELECT * INTO p FROM public.inbound_ediel_parse_results WHERE id=parse_id FOR SHARE;SELECT * INTO box FROM public.ediel_mailboxes WHERE id=mail.mailbox_id FOR SHARE;
 IF mail.id IS NULL OR mail.company_id IS DISTINCT FROM c OR mail.environment IS DISTINCT FROM env OR mail.received_at IS NULL OR p.id IS NULL OR p.company_id IS DISTINCT FROM c OR p.inbound_email_message_id IS DISTINCT FROM mail.id OR p.raw_payload IS DISTINCT FROM expected_raw
  OR box.id IS NULL OR box.environment IS DISTINCT FROM env OR box.is_active IS NOT TRUE OR (box.company_id IS DISTINCT FROM c AND box.is_shared_platform_mailbox IS NOT TRUE)
  OR box.email_address IS NULL OR btrim(box.email_address)!~'^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' THEN RAISE EXCEPTION 'assigned_prodat_negative_retained_ingress_required';END IF;
 PERFORM a.id FROM public.inbound_email_attachments a WHERE a.inbound_email_message_id=mail.id ORDER BY a.id FOR SHARE;
 IF NOT(coalesce(position(p.raw_payload IN mail.raw_edifact_payload),0)>0 OR coalesce(position(p.raw_payload IN mail.body_text),0)>0 OR coalesce(position(p.raw_payload IN mail.raw_email),0)>0 OR EXISTS(SELECT FROM public.inbound_email_attachments a WHERE a.inbound_email_message_id=mail.id AND(a.company_id IS NULL OR a.company_id=c) AND coalesce(position(p.raw_payload IN a.raw_text),0)>0)) THEN RAISE EXCEPTION 'assigned_prodat_negative_retained_bytes_required';END IF;
 classification:=gridex_ediel_header_negative_birth.classify_v1(expected_raw);
 IF classification IS NULL OR p.message_family IS DISTINCT FROM 'PRODAT' OR p.message_code IS DISTINCT FROM classification->>'parsedCode'
  OR p.sender_sub_address IS DISTINCT FROM nullif(classification#>>'{originalUNB,sender,2}','') OR p.receiver_sub_address IS DISTINCT FROM nullif(classification#>>'{originalUNB,receiver,2}','')
  OR p.application_reference IS DISTINCT FROM nullif(classification#>>'{originalUNB,applicationReference}','') OR p.sender_ediel_id IS DISTINCT FROM classification#>>'{originalUNB,sender,0}' OR p.receiver_ediel_id IS DISTINCT FROM classification#>>'{originalUNB,receiver,0}' OR p.interchange_reference IS DISTINCT FROM classification#>>'{originalUNB,interchangeReference}' THEN RAISE EXCEPTION 'assigned_prodat_negative_exact_classification_required';END IF;
 SELECT * INTO r FROM gridex_ediel_header_negative_birth.receipts WHERE inbound_email_message_id=mail_id FOR SHARE;
 IF r.source_message_id IS NOT NULL THEN
  SELECT * INTO m FROM public.ediel_messages WHERE id=r.source_message_id FOR SHARE;
  IF r.company_id IS DISTINCT FROM c OR r.environment IS DISTINCT FROM env OR r.actor_user_id IS DISTINCT FROM actor OR r.parse_result_id IS DISTINCT FROM parse_id OR r.payload_sha256 IS DISTINCT FROM expected_hash OR r.source_received_at IS DISTINCT FROM mail.received_at OR NOT gridex_ediel_header_negative_birth.is_bound_v1(m,false) THEN RAISE EXCEPTION 'assigned_prodat_negative_replay_conflict';END IF;
 ELSE
  observed:=clock_timestamp();e:=gridex_ediel_header_negative_birth.family_basis_v1(c,env,expected_raw,mail.received_at,observed,classification);m.id:=gen_random_uuid();
  e:=e||jsonb_build_object('sourceMessageId',m.id,'assignedNegativeBirthReceiptId',m.id);
  facts:=jsonb_build_object('messageCode',p.message_code,'applicationReference',p.application_reference,'senderEdielId',p.sender_ediel_id,'receiverEdielId',p.receiver_ediel_id,'interchangeReference',p.interchange_reference);
  INSERT INTO gridex_ediel_header_negative_birth.receipts VALUES(m.id,c,env,actor,mail.id,p.id,expected_hash,mail.received_at,observed,txid_current(),'pending',facts,e) RETURNING * INTO r;
  tokens:=gridex_utilts_binding.wire_tokens_v1(expected_raw);SELECT x INTO bgm FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='BGM';
  INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,created_by,resolved_company_id,
   sender_ediel_id,receiver_ediel_id,sender_sub_address,receiver_sub_address,parsed_unb_sender_ediel_id,parsed_unb_receiver_ediel_id,application_reference,interchange_reference,external_reference,raw_payload,parsed_payload,
   inbound_email_message_id,mailbox_message_id,message_received_at,processing_status,tenant_resolution_status,business_match_status)
  VALUES(m.id,c,env,'inbound','edifact','PRODAT',p.message_code,'validation_failed',actor,c,p.sender_ediel_id,p.receiver_ediel_id,p.sender_sub_address,p.receiver_sub_address,p.sender_ediel_id,p.receiver_ediel_id,p.application_reference,p.interchange_reference,bgm#>>'{elements,2,0}',expected_raw,p.parsed_payload,
   mail.id,mail.id::text,mail.received_at,'manual_review','tenant_resolved','business_unresolved') RETURNING * INTO m;
  IF NOT gridex_ediel_header_negative_birth.is_bound_v1(m,true) THEN RAISE EXCEPTION 'assigned_prodat_negative_birth_scope_required';END IF;
  reception:=public.ediel_record_inbound_reception_v1(c,m.id,actor,mail.id,p.id);
  IF reception->>'classification' IS DISTINCT FROM 'first_reception' THEN RAISE EXCEPTION 'assigned_prodat_negative_first_reception_required';END IF;
  UPDATE gridex_ediel_header_negative_birth.receipts SET status='consumed' WHERE source_message_id=m.id RETURNING * INTO r;
 END IF;
 RETURN jsonb_build_object('version',1,'disposition','assigned_header_negative','sourceMessageId',r.source_message_id,'companyId',r.company_id,'environment',r.environment,'sourcePayloadHash',r.payload_sha256,'inboundEmailMessageId',r.inbound_email_message_id,'parseResultId',r.parse_result_id,'sourceReceivedAt',r.source_received_at,
  'fieldCode',r.evidence#>>'{negativeField,fieldCode}','rejectionField',r.evidence->'negativeField','correctedApplicationReference',CASE WHEN r.evidence#>>'{negativeField,fieldCode}'='311' THEN r.evidence->'replyApplicationReference' ELSE 'null'::jsonb END,'authorizesBusinessEffect',false,'permanentNegative',true);
END $$;
CREATE FUNCTION public.ediel_create_assigned_prodat_header_negative_v1(p_company_id uuid,p_environment text,p_actor_user_id uuid,p_inbound_email_message_id uuid,p_parse_result_id uuid,p_expected_raw_payload text,p_expected_payload_hash text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT gridex_ediel_header_negative_birth.create_v1(p_company_id,p_environment,p_actor_user_id,p_inbound_email_message_id,p_parse_result_id,p_expected_raw_payload,p_expected_payload_hash)$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_ediel_header_negative_birth FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.ediel_create_assigned_prodat_header_negative_v1(uuid,text,uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_create_assigned_prodat_header_negative_v1(uuid,text,uuid,uuid,uuid,text,text) TO service_role;

INSERT INTO gridex_ediel_header_negative_birth.guide_extensions VALUES('068e8f82c082c2d3513ead62f4833fa89884488cbd0347fa499a0949a4c9e3c6','{"sourceSha256":"83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95","tableIndex":105,"sourceTable":{"source":"P","page":120,"table":1,"bbox":[102.797,81.38,773.582983,468.69999500000006],"rows":[["Fältkod",null,"Fältnamn - engelska",null,null,"Fältnamn - svenska",null,null,"Villkor för fältet"],["311",null,"Application Reference",null,null,"Application Reference",null,null,"Giltiga koder: 23-DDQ-PRODAT, 23-DGI-PRODAT (för PRODAT i\nelmarknaden), 27-DDQ-PRODAT (för PRODAT i\nnaturgasmarknaden).\nOm koden är fel eller saknas anges i APERAK-svarets UNB-segment\nden kod det borde ha varit."],["312",null,"Association assigned code",null,null,"Version",null,null,"Giltiga koder: E2SE5A (elmarknaden) E2SE6B (naturgasmarknaden)."],["202",null,"Message name",null,null,"Meddelandenamn",null,null,"Giltiga koder: Z01, Z02, Z03, Z04, Z05, Z06, Z08, Z09, Z10, Z13, Z14,\nZ15, Z18"],["203",null,"Message Id.",null,null,"Meddelandeidentifikation",null,null,"Ej blankt"],["313",null,"Request for\nacknowledgement",null,null,"Kvittensbegäran",null,null,"Giltiga koder: AB, NA. Om koden är NA i t.ex. PRODAT Z03 får inte\nmeddelandet avvisas. Meddelandet får endast avvisas om fältet\nsaknas eller inte är AB eller NA."],["204","","","Message function","","","Meddelandefunktion","",""],["205",null,"Message date",null,null,"Meddelandedatum (Dagens datum)",null,null,"Korrekt datum/rätt format (CCYYMMDDHHmm), ej framåt i tiden"],["206",null,"Time zone",null,null,"Tidszon",null,null,"Giltigt värde: Offset till UTC, alltid \"1\" i Sverige"],["301","","","Free text (header)","","","Fritext (huvud)","",""],["207",null,"Sender",null,null,"Avsändare (Ediel-ID)",null,null,"Giltigt Ediel-id för en godkänd aktör enligt Ediel-register i\nEdielportalen. För PRODAT Z13 förutsätts avsändaren ha ett avtal\nmed mottagaren."],["315","","","Senders organisation no","","","Avsändarens org.nr","",""],["208",null,"Recipient",null,null,"Mottagare (Ediel-ID)",null,null,"Mottagarens Ediel-id"],["314",null,"Sequence number",null,null,"Sekvensnummer",null,null,"Ska börja med 1 för första anläggningen. Varje nytt LIN-segment\nmåste ha ett högre nummer än föregående LIN-segment. Saknas\nnågot nummer i sekvensen, de kommer i fel ordning, eller första inte\nbörjar med 1, returneras negativt APERAK (kod 27) och hela\nmeddelandet avvisas."]]},"sourceTableSha256":"d42b5b933b17e251159a4cbc05cd3d873b791cfbe2eda89ab2cec3c3ef37d932","sourceTablesManifestSha256":"a23e928bdbe7e4bd514df99c789482023aea1d2f70f2a26f4a7ae5c05c973728"}'::jsonb);
CREATE FUNCTION gridex_ediel_header_negative_birth.evidence_v1(m public.ediel_messages) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e jsonb;
BEGIN
 IF NOT(gridex_ediel_header_negative_birth.is_bound_v1(m,true) OR gridex_ediel_header_negative_birth.is_bound_v1(m,false)) THEN RETURN NULL;END IF;
 SELECT evidence INTO e FROM gridex_ediel_header_negative_birth.receipts WHERE source_message_id=m.id;RETURN e;
END $$;
CREATE FUNCTION gridex_ediel_header_negative_birth.reply_application_v1(m public.ediel_messages,e jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE retained jsonb;correction jsonb;
BEGIN
 retained:=gridex_ediel_header_negative_birth.evidence_v1(m);
 IF retained IS NULL OR retained->'negativeField' IS DISTINCT FROM e->'negativeField' OR retained->'applicationReferenceCorrection' IS DISTINCT FROM e->'applicationReferenceCorrection' OR retained->'replyApplicationReference' IS DISTINCT FROM e->'replyApplicationReference' THEN RAISE EXCEPTION 'assigned_prodat_negative_reply_source_required';END IF;
 IF retained#>>'{negativeField,fieldCode}'<>'311' THEN RETURN retained->>'replyApplicationReference';END IF;
 correction:=retained->'applicationReferenceCorrection';
 IF m.application_reference IS NOT NULL OR gridex_ediel_header_negative_birth.classify_v1(m.raw_payload)->>'fieldCode' IS DISTINCT FROM '311'
  OR correction->>'processEdition' IS DISTINCT FROM '111385d7f0a83dd865de369ccee9aae3dc52098a5d3105cb3bacb4070ff7579b' OR correction->>'expectedApplicationReference' IS DISTINCT FROM '23-DDQ-PRODAT'
  OR correction->>'sourceSha256' IS DISTINCT FROM '83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95' OR correction->>'tableIndex' IS DISTINCT FROM '105' OR correction->>'page' IS DISTINCT FROM '120'
  OR correction->'originalApplicationReference' IS DISTINCT FROM 'null'::jsonb OR correction->>'actorRole' IS DISTINCT FROM 'electricity_supplier' OR correction->>'market' IS DISTINCT FROM 'electricity'
 THEN RAISE EXCEPTION 'assigned_prodat_negative_reply_source_required';END IF;
 RETURN correction->>'expectedApplicationReference';
END $$;
CREATE FUNCTION gridex_ediel_header_negative_birth.require_fresh_reply_process_v1(m public.ediel_messages,e jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE retained jsonb;correction jsonb;observed timestamptz:=clock_timestamp();legal_actor_uuid uuid;
BEGIN
 PERFORM gridex_ediel_header_negative_birth.reply_application_v1(m,e);retained:=gridex_ediel_header_negative_birth.evidence_v1(m);
 IF retained IS NULL OR retained->'negativeField' IS DISTINCT FROM e->'negativeField' OR retained->'applicationReferenceCorrection' IS DISTINCT FROM e->'applicationReferenceCorrection' OR retained->'replyApplicationReference' IS DISTINCT FROM e->'replyApplicationReference' THEN RAISE EXCEPTION 'assigned_prodat_negative_reply_source_required';END IF;
 IF retained#>>'{negativeField,fieldCode}'<>'311' THEN RETURN;END IF;
 correction:=retained->'applicationReferenceCorrection';legal_actor_uuid:=(correction->>'legalActorId')::uuid;
 LOCK TABLE public.tenant_actor_identifiers,public.tenant_actor_roles,public.tenant_ediel_profiles IN SHARE MODE;
 IF correction->>'processEdition' IS DISTINCT FROM '111385d7f0a83dd865de369ccee9aae3dc52098a5d3105cb3bacb4070ff7579b' OR correction->>'expectedApplicationReference' IS DISTINCT FROM '23-DDQ-PRODAT'
  OR m.application_reference IS NOT NULL OR gridex_ediel_header_negative_birth.classify_v1(m.raw_payload)->>'fieldCode' IS DISTINCT FROM '311'
  OR NOT EXISTS(SELECT FROM gridex_ediel_readiness.source_editions d CROSS JOIN LATERAL jsonb_array_elements(d.catalog)x WHERE d.source_version=correction->>'processEdition' AND x=correction->'canonicalProjection')
  OR NOT EXISTS(SELECT FROM public.tenant_actor_identifiers i WHERE i.company_id=m.company_id AND i.environment=m.environment AND i.actor_id=legal_actor_uuid AND i.identifier_type='EdielId' AND i.identifier_value=e#>>'{identities,legalReceiver,id}' AND i.valid_from<=observed AND(i.valid_to IS NULL OR observed<i.valid_to))
  OR (SELECT count(*) FROM public.tenant_actor_roles r WHERE r.company_id=m.company_id AND r.environment=m.environment AND r.actor_id=legal_actor_uuid AND r.role_code='electricity_supplier' AND r.valid_from<=observed AND(r.valid_to IS NULL OR observed<r.valid_to))<>1
  OR (SELECT count(*) FROM public.tenant_ediel_profiles p WHERE p.company_id=m.company_id AND p.environment=m.environment AND p.market='electricity' AND p.is_enabled AND p.valid_from<=observed AND(p.valid_to IS NULL OR observed<p.valid_to))<>1 THEN RAISE EXCEPTION 'assigned_prodat_negative_311_current_process_required';END IF;
 RETURN;
END $$;
CREATE FUNCTION gridex_ediel_header_negative_birth.source_wire_v1(m public.ediel_messages) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e jsonb:=gridex_ediel_header_negative_birth.evidence_v1(m);classification jsonb;t jsonb;u jsonb;h jsonb;b jsonb;refs jsonb;
BEGIN
 IF e#>>'{negativeField,fieldCode}' IS DISTINCT FROM '311' THEN RETURN gridex_ack_authority.wire_v1(m.raw_payload);END IF;
 classification:=gridex_ediel_header_negative_birth.classify_v1(m.raw_payload);
 IF classification->>'fieldCode' IS DISTINCT FROM '311' THEN RAISE EXCEPTION 'assigned_prodat_negative_reply_source_required';END IF;
 t:=gridex_utilts_binding.wire_tokens_v1(m.raw_payload);u:=classification->'originalUNB';
 SELECT x->'elements' INTO STRICT h FROM jsonb_array_elements(t)x WHERE x->>'tag'='UNH';SELECT x->'elements' INTO STRICT b FROM jsonb_array_elements(t)x WHERE x->>'tag'='BGM';
 SELECT jsonb_agg(x#>>'{elements,1,1}' ORDER BY(x->>'index')::int) INTO refs FROM jsonb_array_elements(t)x WHERE x->>'tag'='RFF' AND x#>>'{elements,1,0}'='LI';
 -- Missing APP is an original physical fact. This local observation describes
 -- the actual retained wire; only the reply comparison corrects its APP below.
 RETURN jsonb_build_object('sender',u->'sender','receiver',u->'receiver','interchange',u->'interchangeReference','app',NULL,'environment',u->'environment','family','PRODAT','type',h->2,'unhRef',h#>>'{1,0}','code',b#>>'{1,0}','document',b#>>'{2,0}','function',b#>>'{3,0}','legalSender',e#>>'{identities,legalSender,id}','legalReceiver',e#>>'{identities,legalReceiver,id}','refs',jsonb_build_object('LI',refs));
END $$;
CREATE FUNCTION gridex_ediel_header_negative_birth.assert_ack_v1(m public.ediel_messages,e jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE source public.ediel_messages%rowtype;retained jsonb;field text:=e#>>'{negativeField,fieldCode}';t jsonb:=gridex_utilts_binding.wire_tokens_v1(m.raw_payload);a jsonb:=gridex_ack_authority.wire_v1(m.raw_payload);s jsonb;u jsonb;h jsonb;b jsonb;g jsonb;f jsonb;reply text;
BEGIN
 SELECT * INTO source FROM public.ediel_messages WHERE id=m.related_message_id FOR SHARE;retained:=gridex_ediel_header_negative_birth.evidence_v1(source);
 IF retained IS NULL OR (e-'syntaxAssessmentId') IS DISTINCT FROM retained OR field NOT IN('202','311','223') OR retained->'negativeField' IS DISTINCT FROM e->'negativeField' OR retained->'ownOccurrence' IS DISTINCT FROM e->'ownOccurrence'
  OR m.company_id IS DISTINCT FROM source.company_id OR m.environment IS DISTINCT FROM source.environment OR m.direction IS DISTINCT FROM 'outbound' OR m.message_family IS DISTINCT FROM 'APERAK' OR m.message_code IS DISTINCT FROM 'APERAK'
  OR m.canonical_rule_pack_id IS NOT NULL OR m.rule_profile_version_id IS NOT NULL OR m.rule_profile_key IS NOT NULL OR m.rule_profile_version IS NOT NULL OR m.rule_pack_checksum IS NOT NULL OR coalesce(m.rule_pack_snapshot,'{}')<>'{}'::jsonb
  OR a IS NULL OR a->>'family' IS DISTINCT FROM 'APERAK' OR a->>'function' IS DISTINCT FROM (CASE field WHEN '223' THEN '34' ELSE '27' END)
  OR (SELECT count(*) FROM jsonb_array_elements(t)x WHERE x->>'tag'='ERC')<>1 OR (SELECT count(*) FROM jsonb_array_elements(t)x WHERE x->>'tag'='FTX')<>1 THEN RAISE EXCEPTION 'assigned_prodat_negative_ack_scope_required';END IF;
 reply:=gridex_ediel_header_negative_birth.reply_application_v1(source,e);s:=gridex_ediel_header_negative_birth.source_wire_v1(source);u:=gridex_ediel_technical_ack.envelope(source.raw_payload);
 SELECT x->'elements' INTO h FROM jsonb_array_elements(t)x WHERE x->>'tag'='UNH';SELECT x->'elements' INTO b FROM jsonb_array_elements(t)x WHERE x->>'tag'='UNB';SELECT x->'elements' INTO g FROM jsonb_array_elements(t)x WHERE x->>'tag'='ERC';SELECT x->'elements' INTO f FROM jsonb_array_elements(t)x WHERE x->>'tag'='FTX';
 IF h->2 IS DISTINCT FROM e#>'{familyEdition,sourceProjection,catalog,ackConstraints,technicalProfile}' OR b->2 IS DISTINCT FROM u->'receiver' OR b->3 IS DISTINCT FROM u->'sender' OR nullif(b#>>'{7,0}','') IS DISTINCT FROM reply OR coalesce(b#>>'{11,0}','') IS DISTINCT FROM u->>'testIndicator'
  OR g->1 IS DISTINCT FROM jsonb_build_array(e#>>'{negativeField,ercCode}','','260') OR f->1 IS DISTINCT FROM '["AAO"]'::jsonb OR f->3 IS DISTINCT FROM jsonb_build_array(field,'','260') OR f->4 IS DISTINCT FROM jsonb_build_array(e#>>'{negativeField,text}')
  OR jsonb_array_length(f)>5 OR coalesce(f->2,'[]') NOT IN('[]'::jsonb,'[""]'::jsonb) OR length(f#>>'{4,0}')>(e#>>'{familyEdition,sourceProjection,catalog,ackConstraints,textMax}')::int
  OR (SELECT count(*) FROM jsonb_array_elements(t)x WHERE x->>'tag'='BGM')<>1 OR (SELECT count(*) FROM jsonb_array_elements(t)x WHERE x->>'tag'='DTM')<>1
  OR EXISTS(SELECT FROM jsonb_array_elements(t)x WHERE x->>'tag' NOT IN('UNB','UNH','BGM','DTM','NAD','ERC','FTX','RFF','UNT','UNZ'))
  OR (SELECT(x->>'index')::int FROM jsonb_array_elements(t)x WHERE x->>'tag'='FTX') IS DISTINCT FROM (SELECT(x->>'index')::int+1 FROM jsonb_array_elements(t)x WHERE x->>'tag'='ERC')
  OR nullif(h#>>'{1,0}','') IS NULL OR length(h#>>'{1,0}')>14
  OR (SELECT count(*) FROM jsonb_array_elements(t)x WHERE x->>'tag'='DTM' AND x#>>'{elements,1,0}'=e#>>'{familyEdition,sourceProjection,catalog,commonAckConstraints,documentDate,qualifier}' AND x#>>'{elements,1,2}'=e#>>'{familyEdition,sourceProjection,catalog,commonAckConstraints,documentDate,format}' AND gridex_ediel_ack_guide.date_time_v1(x#>>'{elements,1,1}') IS TRUE)<>1
  THEN RAISE EXCEPTION 'assigned_prodat_negative_ack_scope_required';END IF;
 IF EXISTS(SELECT FROM unnest(ARRAY['FR','DO'])role WHERE(SELECT count(*) FROM jsonb_array_elements(t)x WHERE x->>'tag'='NAD' AND x#>>'{elements,1,0}'=role)<>1)
  OR EXISTS(SELECT FROM jsonb_array_elements(t)x WHERE x->>'tag'='NAD' AND x#>>'{elements,1,0}' IN('FR','DO') AND(x->>'index')::int>=(SELECT(z->>'index')::int FROM jsonb_array_elements(t)z WHERE z->>'tag'='ERC'))
  OR NOT EXISTS(SELECT FROM jsonb_array_elements(t)x WHERE x->>'tag'='NAD' AND x#>>'{elements,1,0}'='FR' AND x#>'{elements,2}'=e#>'{identities,legalReceiver,identityComponents}' AND x#>>'{elements,9,0}'=e#>>'{identities,legalReceiver,country}')
  OR NOT EXISTS(SELECT FROM jsonb_array_elements(t)x WHERE x->>'tag'='NAD' AND x#>>'{elements,1,0}'='DO' AND x#>'{elements,2}'=e#>'{identities,legalSender,identityComponents}' AND x#>>'{elements,9,0}'=e#>>'{identities,legalSender,country}') THEN RAISE EXCEPTION 'assigned_prodat_negative_ack_scope_required';END IF;
 -- APP correction applies only to this actual frozen311 negative, in a local
 -- wire observation. Retained source raw/APP and the global predicate stay intact.
 IF field='311' THEN s:=jsonb_set(s,'{app}',to_jsonb(reply));END IF;
 IF NOT coalesce(gridex_ack_authority.source_match_v1(a,s),false) THEN RAISE EXCEPTION 'assigned_prodat_negative_ack_scope_required';END IF;
 IF field='223' THEN
  IF EXISTS(SELECT FROM jsonb_array_elements(t)x WHERE x->>'tag'='RFF' AND x#>>'{elements,1,0}' IN('LI','Z07') AND(x->>'index')::int<(SELECT(z->>'index')::int FROM jsonb_array_elements(t)z WHERE z->>'tag'='FTX'))
   OR (SELECT count(*) FROM jsonb_array_elements(t)x WHERE x->>'tag'='RFF' AND x#>>'{elements,1,0}'='LI')<>1
   OR (SELECT count(*) FROM jsonb_array_elements(t)x WHERE x->>'tag'='RFF' AND x#>>'{elements,1,0}'='Z07')<>1
   OR (SELECT count(*) FROM jsonb_array_elements(t)x WHERE x->>'tag'='RFF' AND x#>>'{elements,1,0}'='LI' AND x#>>'{elements,1,1}'=e#>>'{ownOccurrence,lineItemReference}')<>1
   OR (SELECT count(*) FROM jsonb_array_elements(t)x WHERE x->>'tag'='RFF' AND x#>>'{elements,1,0}'='Z07' AND x#>>'{elements,1,1}'=e#>>'{ownOccurrence,objectId}')<>1
   OR EXISTS(SELECT FROM jsonb_array_elements(t)x WHERE x->>'tag'='RFF' AND x#>>'{elements,1,0}' NOT IN('ACW','LI','Z07')) THEN RAISE EXCEPTION 'assigned_prodat_negative_223_own_object_required';END IF;
 ELSE
  IF EXISTS(SELECT FROM jsonb_array_elements(t)x WHERE x->>'tag'='RFF' AND x#>>'{elements,1,0}' NOT IN('ACW')) THEN RAISE EXCEPTION 'assigned_prodat_negative_ack_scope_required';END IF;
 END IF;
END $$;
CREATE FUNCTION gridex_ediel_header_negative_birth.source_matches_v1(a jsonb,s jsonb,source public.ediel_messages) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e jsonb:=gridex_ediel_header_negative_birth.evidence_v1(source);app text;
BEGIN
 IF e#>>'{negativeField,fieldCode}' IS DISTINCT FROM '311' THEN RETURN gridex_ack_authority.source_match_v1(a,s);END IF;
 IF s IS DISTINCT FROM gridex_ack_authority.wire_v1(source.raw_payload) OR a->>'family' IS DISTINCT FROM 'APERAK' OR a->>'function' IS DISTINCT FROM '27' OR a->'erc' IS DISTINCT FROM '["41"]'::jsonb THEN RETURN false;END IF;
 app:=gridex_ediel_header_negative_birth.reply_application_v1(source,e);RETURN gridex_ack_authority.source_match_v1(a,jsonb_set(gridex_ediel_header_negative_birth.source_wire_v1(source),'{app}',to_jsonb(app)));
END $$;
CREATE FUNCTION gridex_ediel_header_negative_birth.scopes_v1(raw text,source public.ediel_messages) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e jsonb:=gridex_ediel_header_negative_birth.evidence_v1(source);m public.ediel_messages%rowtype;wire jsonb;
BEGIN
 IF e#>>'{negativeField,fieldCode}' IS DISTINCT FROM '311' THEN RETURN gridex_ediel_ack_guide.prodat_outcomes_v1(raw,source.raw_payload);END IF;
 m.company_id:=source.company_id;m.environment:=source.environment;m.direction:='outbound';m.message_family:='APERAK';m.message_code:='APERAK';m.related_message_id:=source.id;m.raw_payload:=raw;
 PERFORM gridex_ediel_header_negative_birth.assert_ack_v1(m,e);wire:=gridex_ediel_header_negative_birth.source_wire_v1(source);
 RETURN jsonb_build_array(jsonb_build_object('scope','message','reference',wire->>'document','physicalReference',jsonb_build_object('documentId',wire->>'document'),'outcome','negative'));
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_ediel_header_negative_birth FROM PUBLIC,anon,authenticated,service_role;

DO $assigned_birth_upgrade$
DECLARE target_oid oid;before_definition text;after_definition text;old_body text;new_body text;
BEGIN
 target_oid:='public.gridex_bind_inbound_ediel_rule_pack_evidence()'::regprocedure;
 SELECT prosrc INTO old_body FROM pg_proc WHERE pg_proc.oid=target_oid;
 IF encode(sha256(convert_to(old_body,'UTF8')),'hex') IS DISTINCT FROM 'f14af8ea448b37db8a6ed2a0d92889930da95ff2f9c34b4c21f4e38b277affb9' THEN RAISE EXCEPTION 'assigned_prodat_negative_unknown_preimage:public.gridex_bind_inbound_ediel_rule_pack_evidence';END IF;
 new_body:=$assigned_birth_body$
declare
  v_rule_pack_id uuid;
  v_profile_id uuid;
  v_profile_key text;
  v_guide_version text;
  v_guide_revision text;
  v_source_hash text;
  v_effective_date date;
  v_match_count integer;
begin
  if tg_op='INSERT' and gridex_ediel_header_negative_birth.is_bound_v1(new,true) is true then return new;end if;
  if new.direction <> 'inbound' or new.company_id is null or new.message_family not in ('PRODAT','UTILTS') then
    return new;
  end if;

  if new.canonical_rule_pack_id is not null
     and nullif(new.rule_profile_key,'') is not null
     and new.rule_profile_version_id is not null
     and nullif(new.rule_profile_version,'') is not null
     and nullif(new.rule_pack_checksum,'') is not null
     and coalesce(new.rule_pack_snapshot,'{}'::jsonb) <> '{}'::jsonb then
    return new;
  end if;

  v_effective_date := coalesce(new.message_received_at::date, new.created_at::date, current_date);

  select count(*)
  into v_match_count
  from public.ediel_message_profiles mp
  join public.ediel_rule_packs rp on rp.id = mp.rule_pack_id
  where mp.is_enabled = true
    and mp.profile->>'family' = new.message_family
    and mp.message_code = new.message_code
    and mp.direction in ('inbound','both')
    and rp.status in ('active','future')
    and rp.valid_from <= v_effective_date
    and (rp.valid_to is null or rp.valid_to >= v_effective_date);

  if v_match_count <> 1 then
    raise exception 'canonical_inbound_rule_profile_resolution_failed:%:%:%:%',
      new.message_family, coalesce(new.message_code,''), v_effective_date, v_match_count
      using errcode='23514';
  end if;

  select mp.rule_pack_id, mp.id, mp.profile_key, rp.guide_version, rp.guide_revision, rp.source_hash
  into v_rule_pack_id, v_profile_id, v_profile_key, v_guide_version, v_guide_revision, v_source_hash
  from public.ediel_message_profiles mp
  join public.ediel_rule_packs rp on rp.id = mp.rule_pack_id
  where mp.is_enabled = true
    and mp.profile->>'family' = new.message_family
    and mp.message_code = new.message_code
    and mp.direction in ('inbound','both')
    and rp.status in ('active','future')
    and rp.valid_from <= v_effective_date
    and (rp.valid_to is null or rp.valid_to >= v_effective_date)
  limit 1;

  new.canonical_rule_pack_id := v_rule_pack_id;
  new.rule_profile_key := v_profile_key;
  new.rule_profile_version_id := v_profile_id;
  new.rule_profile_version := v_guide_version || ':r' || v_guide_revision;
  new.rule_pack_checksum := v_source_hash;
  new.rule_pack_snapshot := jsonb_build_object(
    'family', new.message_family,
    'code', new.message_code,
    'direction', 'inbound',
    'environment', new.environment,
    'profileKey', v_profile_key,
    'profileVersionId', v_profile_id,
    'version', v_guide_version || ':r' || v_guide_revision,
    'checksum', v_source_hash,
    'authority', 'gridex_bind_inbound_ediel_rule_pack_evidence',
    'databaseRole', 'evidence_only',
    'effectiveDate', v_effective_date
  );

  return new;
end;
$assigned_birth_body$;
 before_definition:=pg_get_functiondef(target_oid);
 IF (length(before_definition)-length(replace(before_definition,old_body,'')))/length(old_body)<>1 THEN RAISE EXCEPTION 'assigned_prodat_negative_unique_body_required';END IF;
 after_definition:=replace(before_definition,old_body,new_body);EXECUTE after_definition;
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE pg_proc.oid=target_oid) IS DISTINCT FROM 'b0773e5506090d50768e4cf7ad336f49515206e1357d84f6da02d6714f26651d' THEN RAISE EXCEPTION 'assigned_prodat_negative_postimage_mismatch';END IF;
END $assigned_birth_upgrade$;
DO $assigned_birth_upgrade$
DECLARE target_oid oid;before_definition text;after_definition text;old_body text;new_body text;
BEGIN
 target_oid:='gridex_ediel_common_header.capture_source()'::regprocedure;
 SELECT prosrc INTO old_body FROM pg_proc WHERE pg_proc.oid=target_oid;
 IF encode(sha256(convert_to(old_body,'UTF8')),'hex') IS DISTINCT FROM '3e52b4ec869c50789f559f214e1a7296b269f362c425676fb53227e13451a993' THEN RAISE EXCEPTION 'assigned_prodat_negative_unknown_preimage:gridex_ediel_common_header.capture_source';END IF;
 new_body:=$assigned_birth_body$
DECLARE observed timestamptz:=clock_timestamp();tokens jsonb;header jsonb;bgm jsonb;parts jsonb;u jsonb;fr jsonb;recipient jsonb;edition jsonb;guide jsonb;pack public.ediel_rule_packs%rowtype;sources jsonb;
 cs uuid[];actors uuid[];c uuid;namespace jsonb;state text:='ready';reason text;defect text;description text;first_detail integer;date date;editions jsonb;
BEGIN
 IF TG_OP='INSERT' AND gridex_ediel_header_negative_birth.is_bound_v1(NEW,true) IS TRUE THEN
  INSERT INTO gridex_ediel_common_header.sources SELECT NEW.id,NEW.company_id,NEW.company_id,NEW.environment,r.payload_sha256,r.source_received_at,r.observed_at,'ready',NULL,r.evidence FROM gridex_ediel_header_negative_birth.receipts r WHERE r.source_message_id=NEW.id AND r.creation_txid=txid_current() AND r.status='pending';
  RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' AND OLD.raw_payload IS NOT NULL AND NEW.raw_payload IS NULL AND public.ediel_is_qualified_retention_transition_v1(OLD,NEW) THEN RETURN NEW;END IF;
 IF TG_OP='UPDATE' AND nullif(OLD.raw_payload,'') IS NOT NULL THEN RETURN NEW;END IF;
 IF NEW.direction IS DISTINCT FROM 'inbound' OR nullif(NEW.raw_payload,'') IS NULL OR EXISTS(SELECT FROM gridex_ediel_common_header.sources WHERE source_message_id=NEW.id) THEN RETURN NEW;END IF;
 tokens:=gridex_utilts_binding.wire_tokens_v1(NEW.raw_payload);
 IF tokens IS NULL OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNH')<>1 THEN RETURN NEW;END IF;
 SELECT t INTO header FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNH';IF header#>>'{elements,2,0}' IS DISTINCT FROM 'PRODAT' THEN RETURN NEW;END IF;
 SELECT min((t->>'index')::integer) INTO first_detail FROM jsonb_array_elements(tokens)t WHERE t->>'tag' IN('LIN','UNT','UNZ');
 SELECT t INTO bgm FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='BGM' AND (t->>'index')::integer<first_detail;
 IF bgm IS NULL THEN RETURN NEW;END IF;parts:=bgm#>'{elements,1}';
 -- The source-generated original family list owns field202; no arbitrary
 -- selected code, subtype or market role can be manufactured for an unknown.
 SELECT coalesce(jsonb_agg(e.evidence),'[]') INTO editions FROM gridex_ediel_common_header.source_editions e WHERE EXISTS(SELECT FROM jsonb_array_elements(e.evidence#>'{catalog,guides}')g WHERE (g->>'effectiveFrom')::date<=(NEW.message_received_at AT TIME ZONE 'Europe/Stockholm')::date AND(g->>'effectiveTo' IS NULL OR(NEW.message_received_at AT TIME ZONE 'Europe/Stockholm')::date<=(g->>'effectiveTo')::date));
 edition:=editions->0;IF jsonb_array_length(editions)=1 AND edition#>'{catalog,allowedCodes}' ? coalesce(parts->>0,'') THEN RETURN NEW;END IF;
 BEGIN
  IF jsonb_array_length(editions)<>1 THEN RAISE EXCEPTION 'ediel_common_header_rejection_basis_required';END IF;
  IF NEW.environment NOT IN('test','production') OR NEW.message_received_at IS NULL OR octet_length(NEW.raw_payload)>262144 THEN RAISE EXCEPTION 'ediel_common_header_rejection_basis_required';END IF;
  date:=(NEW.message_received_at AT TIME ZONE 'Europe/Stockholm')::date;
  SELECT g INTO STRICT guide FROM jsonb_array_elements(edition#>'{catalog,guides}')g WHERE (g->>'effectiveFrom')::date<=date AND (g->>'effectiveTo' IS NULL OR date<=(g->>'effectiveTo')::date);
  IF header#>'{elements,2}' IS DISTINCT FROM edition#>'{catalog,technicalType}' THEN RAISE EXCEPTION 'ediel_common_header_rejection_basis_required';END IF;
  u:=gridex_ediel_technical_ack.envelope(NEW.raw_payload);
  IF u IS NULL OR u->>'environment' IS DISTINCT FROM NEW.environment OR NOT(edition#>'{catalog,applicationReferences}' ? (u->>'applicationReference')) THEN RAISE EXCEPTION 'ediel_common_header_rejection_basis_required';END IF;
  SELECT t INTO STRICT fr FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}'='FR' AND (t->>'index')::integer<first_detail;
  SELECT t INTO STRICT recipient FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}'='DO' AND (t->>'index')::integer<first_detail;
  IF jsonb_array_length(fr#>'{elements,2}')<>3 OR jsonb_array_length(recipient#>'{elements,2}')<>3 OR nullif(fr#>>'{elements,2,0}','') IS NULL OR nullif(recipient#>>'{elements,2,0}','') IS NULL
   OR fr#>>'{elements,2,1}' IS DISTINCT FROM '160' OR fr#>>'{elements,2,2}' IS DISTINCT FROM 'SVK' OR recipient#>>'{elements,2,1}' IS DISTINCT FROM '160' OR recipient#>>'{elements,2,2}' IS DISTINCT FROM 'SVK'
   OR coalesce(fr#>>'{elements,9,0}','')!~'^[A-Z]{2}$' OR coalesce(recipient#>>'{elements,9,0}','')!~'^[A-Z]{2}$' THEN RAISE EXCEPTION 'ediel_common_header_rejection_basis_required';END IF;
  -- Namespace ownership is a legal identity fact only, never an inferred role,
  -- grant or entitlement to process the unknown business message.
  LOCK TABLE public.tenant_actor_identifiers IN SHARE MODE;
  SELECT array_agg(DISTINCT i.company_id),array_agg(DISTINCT i.actor_id) INTO cs,actors FROM public.tenant_actor_identifiers i WHERE i.environment=NEW.environment AND i.identifier_type='EdielId' AND i.identifier_value=recipient#>>'{elements,2,0}' AND i.valid_from<=observed AND(i.valid_to IS NULL OR observed<i.valid_to);
  IF cardinality(cs) IS DISTINCT FROM 1 OR cardinality(actors) IS DISTINCT FROM 1 OR (NEW.company_id IS NOT NULL AND NEW.company_id IS DISTINCT FROM cs[1]) THEN RAISE EXCEPTION 'ediel_common_header_rejection_basis_required';END IF;c:=cs[1];
  SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) INTO namespace FROM public.tenant_actor_identifiers i WHERE i.company_id=c AND i.actor_id=actors[1] AND i.environment=NEW.environment AND i.identifier_type='EdielId' AND i.identifier_value=recipient#>>'{elements,2,0}' AND i.valid_from<=observed AND(i.valid_to IS NULL OR observed<i.valid_to);
  LOCK TABLE public.ediel_rule_packs,public.ediel_rule_pack_sources IN SHARE MODE;
  SELECT * INTO STRICT pack FROM public.ediel_rule_packs r WHERE r.family='PRODAT' AND r.market='electricity' AND r.status IN('active','transition','future') AND r.guide_version||':r'||r.guide_revision=edition#>>'{catalog,registeredVersion}' AND r.unh_association_code=guide->>'associationAssignedCode' AND r.valid_from<=date AND(r.valid_to IS NULL OR date<=r.valid_to);
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') INTO sources FROM public.ediel_rule_pack_sources s WHERE s.rule_pack_id=pack.id;
  defect:=CASE WHEN EXISTS(SELECT FROM jsonb_array_elements_text(parts)p WHERE nullif(p,'') IS NOT NULL) THEN 'invalid' ELSE 'missing' END;
  description:=CASE defect WHEN 'missing' THEN (edition#>>'{catalog,label}')||' saknas' ELSE 'Felaktigt '||(edition#>>'{catalog,label}')||' '||(SELECT string_agg(p,':' ORDER BY i) FROM jsonb_array_elements_text(parts)WITH ORDINALITY x(p,i)) END;
 EXCEPTION WHEN OTHERS THEN state:='held';reason:='ediel_common_header_rejection_basis_required';END;
 INSERT INTO gridex_ediel_common_header.sources VALUES(NEW.id,NEW.company_id,c,NEW.environment,encode(sha256(convert_to(NEW.raw_payload,'UTF8')),'hex'),NEW.message_received_at,observed,state,reason,
  jsonb_build_object('kind','prodat_common_header_rejection','version',1,'companyId',c,'environment',NEW.environment,'sourceMessageId',NEW.id,'sourceHash',encode(sha256(convert_to(NEW.raw_payload,'UTF8')),'hex'),'sourceReceivedAt',NEW.message_received_at,'observedAt',observed,
   'field202',jsonb_build_object('fieldCode','202','ercCode',CASE defect WHEN 'missing' THEN '41' ELSE '42' END,'text',description),'guide',guide,'familyEdition',jsonb_build_object('version',edition#>>'{catalog,registeredVersion}','rulePack',to_jsonb(pack),'guideSources',sources,'sourceProjection',edition),
   'identities',jsonb_build_object('family','PRODAT','transport',jsonb_build_object('interchangeReference',u->>'interchangeReference','uciReference',u->>'uciReference','senderComponents',u->'sender','receiverComponents',u->'receiver'),
    'legalSender',jsonb_build_object('id',fr#>>'{elements,2,0}','identityComponents',fr#>'{elements,2}','country',fr#>>'{elements,9,0}'),'legalReceiver',jsonb_build_object('id',recipient#>>'{elements,2,0}','identityComponents',recipient#>'{elements,2}','country',recipient#>>'{elements,9,0}'),'applicationReference',u->>'applicationReference'),
   'legalNamespace',namespace,'authorizesBusinessEffect',false));RETURN NEW;
END$assigned_birth_body$;
 before_definition:=pg_get_functiondef(target_oid);
 IF (length(before_definition)-length(replace(before_definition,old_body,'')))/length(old_body)<>1 THEN RAISE EXCEPTION 'assigned_prodat_negative_unique_body_required';END IF;
 after_definition:=replace(before_definition,old_body,new_body);EXECUTE after_definition;
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE pg_proc.oid=target_oid) IS DISTINCT FROM '2122ea50ee16ba1b18f3fc50aca084ff59434fdb359dbf11974eead0c6d6fa5e' THEN RAISE EXCEPTION 'assigned_prodat_negative_postimage_mismatch';END IF;
END $assigned_birth_upgrade$;
DO $assigned_birth_upgrade$
DECLARE target_oid oid;before_definition text;after_definition text;old_body text;new_body text;
BEGIN
 target_oid:='gridex_ediel_common_header.assert_ack_v1(public.ediel_messages,jsonb)'::regprocedure;
 SELECT prosrc INTO old_body FROM pg_proc WHERE pg_proc.oid=target_oid;
 IF encode(sha256(convert_to(old_body,'UTF8')),'hex') IS DISTINCT FROM 'ef64ba91ce4ee85f8255a7c28900b76a9424e1fe564668ee18e6414e092b5df4' THEN RAISE EXCEPTION 'assigned_prodat_negative_unknown_preimage:gridex_ediel_common_header.assert_ack_v1';END IF;
 new_body:=$assigned_birth_body$
DECLARE tokens jsonb;wire jsonb;source public.ediel_messages%rowtype;u jsonb;g jsonb;ftx jsonb;unb jsonb;unh jsonb;bgm jsonb;
BEGIN
 IF e->>'assignedNegativeBirthReceiptId' IS NOT NULL THEN PERFORM gridex_ediel_header_negative_birth.assert_ack_v1(m,e);RETURN;END IF;
 IF m.company_id::text IS DISTINCT FROM e->>'companyId' OR m.environment IS DISTINCT FROM e->>'environment' OR m.related_message_id::text IS DISTINCT FROM e->>'sourceMessageId' OR m.direction IS DISTINCT FROM 'outbound' OR m.message_family IS DISTINCT FROM 'APERAK' OR m.message_code IS DISTINCT FROM 'APERAK'
  OR m.canonical_rule_pack_id IS NOT NULL OR m.rule_profile_version_id IS NOT NULL OR m.rule_profile_key IS NOT NULL OR m.rule_profile_version IS NOT NULL OR m.rule_pack_checksum IS NOT NULL OR coalesce(m.rule_pack_snapshot,'{}')<>'{}' THEN RAISE EXCEPTION 'ediel_common_header_negative_scope_invalid';END IF;
 tokens:=gridex_utilts_binding.wire_tokens_v1(m.raw_payload);wire:=gridex_ack_authority.wire_v1(m.raw_payload);
 IF wire IS NULL OR wire->>'family'<>'APERAK' OR wire->>'function' IS DISTINCT FROM '27' OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='ERC')<>1 OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='FTX')<>1 THEN RAISE EXCEPTION 'ediel_common_header_negative_scope_invalid';END IF;
 SELECT t->'elements' INTO unb FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNB';SELECT t->'elements' INTO unh FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNH';SELECT t->'elements' INTO bgm FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='BGM';
 SELECT t->'elements' INTO g FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='ERC';SELECT t->'elements' INTO ftx FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='FTX';
 SELECT * INTO STRICT source FROM public.ediel_messages WHERE id=m.related_message_id FOR SHARE;u:=gridex_ediel_technical_ack.envelope(source.raw_payload);
 IF unh->2 IS DISTINCT FROM e#>'{familyEdition,sourceProjection,catalog,ackConstraints,technicalProfile}' OR unb->2 IS DISTINCT FROM u->'receiver' OR unb->3 IS DISTINCT FROM u->'sender' OR coalesce(unb#>>'{7,0}','') IS DISTINCT FROM u->>'applicationReference' OR coalesce(unb#>>'{11,0}','') IS DISTINCT FROM u->>'testIndicator'
  OR g->1 IS DISTINCT FROM jsonb_build_array(e#>>'{field202,ercCode}','','260') OR ftx->1 IS DISTINCT FROM '["AAO"]'::jsonb OR ftx->3 IS DISTINCT FROM '["202","","260"]'::jsonb OR ftx->4 IS DISTINCT FROM jsonb_build_array(e#>>'{field202,text}') OR length(ftx#>>'{4,0}')>(e#>>'{familyEdition,sourceProjection,catalog,ackConstraints,textMax}')::integer
  OR wire->>'legalSender' IS DISTINCT FROM e#>>'{identities,legalReceiver,id}' OR wire->>'legalReceiver' IS DISTINCT FROM e#>>'{identities,legalSender,id}' THEN RAISE EXCEPTION 'ediel_common_header_negative_scope_invalid';END IF;
 -- Full legal qualifiers/country and known original document reference stay
 -- tied to the actual physical own header, not merely matching public IDs.
 IF EXISTS(SELECT FROM unnest(ARRAY['FR','DO'])role WHERE (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}'=role)<>1) THEN RAISE EXCEPTION 'ediel_common_header_negative_scope_invalid';END IF;
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}'='FR' AND t#>'{elements,2}'=e#>'{identities,legalReceiver,identityComponents}' AND t#>>'{elements,9,0}'=e#>>'{identities,legalReceiver,country}')
  OR NOT EXISTS(SELECT FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}'='DO' AND t#>'{elements,2}'=e#>'{identities,legalSender,identityComponents}' AND t#>>'{elements,9,0}'=e#>>'{identities,legalSender,country}') THEN RAISE EXCEPTION 'ediel_common_header_negative_scope_invalid';END IF;
 IF jsonb_array_length(ftx)>5 OR coalesce(ftx->2,'[]') NOT IN('[]'::jsonb,'[""]'::jsonb) OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='DTM' AND t#>>'{elements,1,0}'=e#>>'{familyEdition,sourceProjection,catalog,commonAckConstraints,documentDate,qualifier}' AND t#>>'{elements,1,2}'=e#>>'{familyEdition,sourceProjection,catalog,commonAckConstraints,documentDate,format}' AND t#>>'{elements,1,1}'~'^[0-9]{12}$')<>1
  OR EXISTS(SELECT FROM jsonb_array_elements(tokens)t WHERE t->>'tag' IN('IDE','LIN','UCI','UCM'))
  OR EXISTS(SELECT FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}' NOT IN('ACW')) THEN RAISE EXCEPTION 'ediel_common_header_negative_scope_invalid';END IF;
 IF NOT coalesce(gridex_ack_authority.source_match_v1(wire,gridex_ack_authority.wire_v1(source.raw_payload)),false) THEN RAISE EXCEPTION 'ediel_common_header_negative_scope_invalid';END IF;
END$assigned_birth_body$;
 before_definition:=pg_get_functiondef(target_oid);
 IF (length(before_definition)-length(replace(before_definition,old_body,'')))/length(old_body)<>1 THEN RAISE EXCEPTION 'assigned_prodat_negative_unique_body_required';END IF;
 after_definition:=replace(before_definition,old_body,new_body);EXECUTE after_definition;
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE pg_proc.oid=target_oid) IS DISTINCT FROM '3a7f87953d6979c8c8aafbbdeec6a070ce9f73780e18f11e1c0f01f24bfa19a3' THEN RAISE EXCEPTION 'assigned_prodat_negative_postimage_mismatch';END IF;
END $assigned_birth_upgrade$;
DO $assigned_birth_upgrade$
DECLARE target_oid oid;before_definition text;after_definition text;old_body text;new_body text;
BEGIN
 target_oid:='gridex_ediel_common_header.require_current_scope_v1(jsonb)'::regprocedure;
 SELECT prosrc INTO old_body FROM pg_proc WHERE pg_proc.oid=target_oid;
 IF encode(sha256(convert_to(old_body,'UTF8')),'hex') IS DISTINCT FROM '260268258aa40427c2fd8dd329ef265a0b9378d5f715e7689e27c6500816b8ed' THEN RAISE EXCEPTION 'assigned_prodat_negative_unknown_preimage:gridex_ediel_common_header.require_current_scope_v1';END IF;
 new_body:=$assigned_birth_body$DECLARE companies uuid[];actors uuid[];technical jsonb;observed timestamptz:=clock_timestamp();BEGIN
 SELECT array_agg(DISTINCT i.company_id),array_agg(DISTINCT i.actor_id) INTO companies,actors FROM public.tenant_actor_identifiers i WHERE i.environment=e->>'environment' AND i.identifier_type='EdielId' AND i.identifier_value=e#>>'{identities,legalReceiver,id}' AND i.valid_from<=observed AND(i.valid_to IS NULL OR observed<i.valid_to);
 IF cardinality(companies) IS DISTINCT FROM 1 OR cardinality(actors) IS DISTINCT FROM 1 OR companies[1]::text IS DISTINCT FROM e->>'companyId' OR NOT EXISTS(SELECT FROM jsonb_array_elements(e->'legalNamespace')n WHERE n->>'actor_id'=actors[1]::text) THEN RAISE EXCEPTION 'ediel_common_header_current_identity_unavailable';END IF;
 SELECT evidence INTO technical FROM gridex_ediel_technical_ack.sources WHERE source_message_id=(e->>'sourceMessageId')::uuid;
 PERFORM gridex_ediel_technical_ack.require_current_endpoint_v1(technical);
 IF e->>'assignedNegativeBirthReceiptId' IS NOT NULL THEN PERFORM gridex_ediel_header_negative_birth.reply_application_v1(m,e) FROM public.ediel_messages m WHERE m.id=(e->>'sourceMessageId')::uuid;END IF;END$assigned_birth_body$;
 before_definition:=pg_get_functiondef(target_oid);
 IF (length(before_definition)-length(replace(before_definition,old_body,'')))/length(old_body)<>1 THEN RAISE EXCEPTION 'assigned_prodat_negative_unique_body_required';END IF;
 after_definition:=replace(before_definition,old_body,new_body);EXECUTE after_definition;
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE pg_proc.oid=target_oid) IS DISTINCT FROM '05f9a3bf4e132922e70b9af9fccd63c91d324cea47b96e05da511a0d86234116' THEN RAISE EXCEPTION 'assigned_prodat_negative_postimage_mismatch';END IF;
END $assigned_birth_upgrade$;
DO $assigned_birth_upgrade$
DECLARE target_oid oid;before_definition text;after_definition text;old_body text;new_body text;
BEGIN
 target_oid:='gridex_ediel_technical_ack.select_configured_reply_route_v2(uuid,jsonb,text,text,text,integer)'::regprocedure;
 SELECT prosrc INTO old_body FROM pg_proc WHERE pg_proc.oid=target_oid;
 IF encode(sha256(convert_to(old_body,'UTF8')),'hex') IS DISTINCT FROM '2f18db5ee43b16cbe5a69e7bcdf579d4771ba0f870b8279edb209e0d4e17d911' THEN RAISE EXCEPTION 'assigned_prodat_negative_unknown_preimage:gridex_ediel_technical_ack.select_configured_reply_route_v2';END IF;
 new_body:=$assigned_birth_body$
DECLARE u jsonb;msg uuid:=(e->>'sourceMessageId')::uuid;route public.communication_routes%rowtype;profile public.ediel_route_profiles%rowtype;runtime jsonb;candidate_ids uuid[];candidate_profile_ids uuid[];env text;original public.ediel_messages%rowtype;reception gridex_ediel_inbound_receptions.receptions%rowtype;original_box public.ediel_mailboxes%rowtype;birth_smtp text;technical_birth record;smtp_birth gridex_ediel_inbound_receptions.technical_mailbox_births%rowtype;common_basis jsonb;
BEGIN
 IF reply_family IS NULL OR reply_family NOT IN('CONTRL','APERAK') OR e->>'companyId' IS DISTINCT FROM c::text THEN RAISE EXCEPTION 'ediel_prescribed_reply_route_basis_required';END IF;
 PERFORM gridex_ediel_technical_ack.require_current_endpoint_v1(e);u:=e->'originalUNB';env:=e->>'environment';
 IF reply_family='APERAK' THEN
  SELECT b.evidence INTO common_basis FROM gridex_ediel_common_header.sources b WHERE b.source_message_id=msg AND b.company_id=c AND b.environment=env AND b.status='ready';
  IF common_basis#>>'{negativeField,fieldCode}'='311' THEN
   common_basis:=gridex_ediel_common_header.require_v1(c,env,msg);
   PERFORM gridex_ediel_header_negative_birth.require_fresh_reply_process_v1(m,common_basis) FROM public.ediel_messages m WHERE m.id=msg;
   SELECT jsonb_set(u,'{applicationReference}',to_jsonb(gridex_ediel_header_negative_birth.reply_application_v1(m,common_basis))) INTO u FROM public.ediel_messages m WHERE m.id=msg;
  END IF;
 END IF;
 IF current_smtp_from IS NULL OR current_smtp_from!~'^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' OR nullif(current_smtp_host,'') IS NULL OR current_smtp_port NOT BETWEEN 1 AND 65535 THEN RAISE EXCEPTION 'ediel_technical_ack_smtp_account_unqualified';END IF;
 -- Hold the configured candidate universe stable; duplicate matches are held,
 -- never chosen by age, preference, old email or a local role/default APP.
 SELECT * INTO original FROM public.ediel_messages WHERE id=msg AND (company_id=c OR company_id IS NULL) FOR SHARE;
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
 LOCK TABLE public.communication_routes,public.ediel_route_profiles,public.ediel_transport_profiles IN SHARE MODE;
 SELECT array_agg(r.id),array_agg(p.id) INTO candidate_ids,candidate_profile_ids FROM public.communication_routes r JOIN public.ediel_route_profiles p ON p.communication_route_id=r.id AND p.company_id=r.company_id
 LEFT JOIN public.ediel_transport_profiles tp ON tp.id=p.transport_profile_id AND tp.company_id=c AND tp.environment=env
 WHERE r.company_id=c AND r.is_active AND r.route_scope='ediel_ack'
  AND ((env='production' AND r.environment_type::text='production') OR(env='test' AND r.environment_type::text IN('tgt_test','agt_test','bilateral_test')))
  AND p.environment=env AND p.is_enabled AND p.is_active AND p.message_standard='edifact' AND p.payload_format='edifact'
  AND (p.message_family IS NULL OR p.message_family=reply_family) AND (p.business_code IS NULL OR p.business_code=reply_family)
  AND p.sender_ediel_id=u#>>'{receiver,0}' AND p.receiver_ediel_id=u#>>'{sender,0}'
  AND coalesce(p.sender_subaddress,p.sender_sub_address,'')=coalesce(u#>>'{receiver,2}','')
  AND coalesce(p.receiver_subaddress,p.receiver_sub_address,'')=coalesce(u#>>'{sender,2}','')
  AND (p.sender_subaddress IS NULL OR p.sender_sub_address IS NULL OR p.sender_subaddress=p.sender_sub_address)
  AND (p.receiver_subaddress IS NULL OR p.receiver_sub_address IS NULL OR p.receiver_subaddress=p.receiver_sub_address)
  AND p.application_reference IS NOT DISTINCT FROM u->>'applicationReference' AND p.mailbox=current_smtp_from
  AND r.target_email~'^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'
  AND ((p.transport_profile_id IS NULL AND p.smtp_host=current_smtp_host AND p.smtp_port=current_smtp_port)
    OR(tp.id IS NOT NULL AND tp.is_active AND tp.transport_channel='smtp' AND tp.direction IN('outbound','both') AND tp.sender_email=current_smtp_from AND tp.host=current_smtp_host AND tp.port=current_smtp_port
      AND(p.smtp_host IS NULL OR p.smtp_host=current_smtp_host) AND(p.smtp_port IS NULL OR p.smtp_port=current_smtp_port)));
 IF coalesce(cardinality(candidate_ids),0)<>1 THEN RAISE EXCEPTION 'ediel_technical_ack_route_count:%',coalesce(cardinality(candidate_ids),0);END IF;
 -- Read precisely the one named pair selected by that complete locked predicate.
 SELECT * INTO STRICT route FROM public.communication_routes r WHERE r.id=candidate_ids[1] AND r.company_id=c FOR SHARE;
 SELECT * INTO STRICT profile FROM public.ediel_route_profiles p WHERE p.id=candidate_profile_ids[1] AND p.company_id=c FOR SHARE;
 runtime:=to_jsonb(profile)||jsonb_build_object('route_profile_id',profile.id,'communication_route_id',route.id,'route_name',route.route_name,'communication_route_active',route.is_active,'route_scope',route.route_scope,'route_type',route.route_type,'grid_owner_id',route.grid_owner_id,'target_system',route.target_system,'endpoint',route.endpoint,'target_email',route.target_email,'supported_payload_version',route.supported_payload_version,'communication_route_notes',route.notes,'route_profile_notes',profile.notes);
 RETURN jsonb_build_object('kind',CASE WHEN reply_family='CONTRL' THEN 'technical_syntax_ack_route' ELSE 'prodat_common_header_negative_ack_route' END,'smtpHost',current_smtp_host,'smtpPort',current_smtp_port,'companyId',c,'environment',env,'sourceMessageId',msg,'sourceHash',e->>'sourceHash',
  'route',to_jsonb(route)||jsonb_build_object('auth_config','{}'::jsonb),'routeRuntime',runtime,'senderEdielId',u#>>'{receiver,0}','senderQualifier',nullif(u#>>'{receiver,1}',''),'senderSubAddress',nullif(u#>>'{receiver,2}',''),
  'receiverEdielId',u#>>'{sender,0}','receiverQualifier',nullif(u#>>'{sender,1}',''),'receiverSubAddress',nullif(u#>>'{sender,2}',''),'receiverMessageSubAddress',nullif(u#>>'{sender,2}',''),
  'applicationReference',u->>'applicationReference','senderEmail',current_smtp_from,'receiverEmail',route.target_email,'mailbox',current_smtp_from,
  'routeKey',concat(lower(reply_family),'_source_reply|',route.id,'|',profile.id,'|',env,'|',u->>'applicationReference'),'authorizesBusinessEffect',false);
END $assigned_birth_body$;
 before_definition:=pg_get_functiondef(target_oid);
 IF (length(before_definition)-length(replace(before_definition,old_body,'')))/length(old_body)<>1 THEN RAISE EXCEPTION 'assigned_prodat_negative_unique_body_required';END IF;
 after_definition:=replace(before_definition,old_body,new_body);EXECUTE after_definition;
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE pg_proc.oid=target_oid) IS DISTINCT FROM 'e5ded00091d4cf50ff80ef6cc92ca1d352b2b19c7795e9491dcef874950a5fd1' THEN RAISE EXCEPTION 'assigned_prodat_negative_postimage_mismatch';END IF;
END $assigned_birth_upgrade$;
DO $assigned_birth_upgrade$
DECLARE target_oid oid;before_definition text;after_definition text;old_body text;new_body text;
BEGIN
 target_oid:='gridex_ediel_ack_guide.validate_response_for_message_v1(public.ediel_messages,public.ediel_messages,jsonb)'::regprocedure;
 SELECT prosrc INTO old_body FROM pg_proc WHERE pg_proc.oid=target_oid;
 IF encode(sha256(convert_to(old_body,'UTF8')),'hex') IS DISTINCT FROM '4427ea1ef069870fd68bcf320345a464d00653a9c1e711048ef98a42d4fd783f' THEN RAISE EXCEPTION 'assigned_prodat_negative_unknown_preimage:gridex_ediel_ack_guide.validate_response_for_message_v1';END IF;
 new_body:=$assigned_birth_body$
DECLARE facet jsonb;actual jsonb;expected jsonb;w gridex_ediel_outbound_owner.witnesses%rowtype;row_established gridex_ediel_ack_guide.established_prodat_acks%rowtype;
BEGIN
 IF m.execution_context_snapshot->>'prodatCommonHeaderNegativeWitnessId' IS NOT NULL AND gridex_ediel_header_negative_birth.evidence_v1(s) IS NOT NULL THEN
  PERFORM gridex_ediel_header_negative_birth.assert_ack_v1(m,gridex_ediel_common_header.require_ack_v1(m));RETURN true;
 END IF;
 IF gridex_ediel_duplicate_responses.allows_message_v1(m) THEN PERFORM gridex_ediel_duplicate_responses.require_wire_v1(m.raw_payload,s.raw_payload,projection);RETURN true;END IF;
 IF m.message_family IS DISTINCT FROM 'APERAK' OR s.message_family IS DISTINCT FROM 'PRODAT' OR m.execution_context_snapshot->>'prodatCommonHeaderNegativeWitnessId' IS NOT NULL THEN RETURN gridex_ediel_ack_guide.validate_v1(m.raw_payload,s.raw_payload,projection);END IF;
 SELECT * INTO row_established FROM gridex_ediel_ack_guide.established_prodat_acks WHERE ack_message_id=m.id;
 IF row_established.ack_message_id IS NOT NULL THEN
  IF row_established.source_message_id IS DISTINCT FROM s.id OR row_established.company_id IS DISTINCT FROM m.company_id OR row_established.environment IS DISTINCT FROM m.environment
   OR row_established.ack_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') OR row_established.source_hash IS DISTINCT FROM encode(sha256(convert_to(s.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'prodat_response_established_original_changed';END IF;
  SELECT witness.* INTO w FROM gridex_ediel_outbound_owner.consumptions c JOIN gridex_ediel_outbound_owner.witnesses witness ON witness.id=c.witness_id WHERE c.source_message_id=m.id AND c.company_id=m.company_id AND c.environment=m.environment AND c.payload_sha256=row_established.ack_hash;
  IF w.id IS NULL THEN RAISE EXCEPTION 'prodat_response_established_original_changed';END IF;PERFORM gridex_ediel_outbound_owner.assert_message_before_native_ack_guide_v1(m,w);RETURN true;
 END IF;
 facet:=gridex_ediel_ack_guide.bound_prodat_response_v1(m,s);
 IF NOT coalesce(gridex_ediel_ack_guide.validate_prodat_planned_v1(m.raw_payload,s.raw_payload,projection,facet->'objects'),false) THEN RETURN false;END IF;
 actual:=gridex_ediel_ack_guide.prodat_wire_responses_v1(m.raw_payload,facet->'objects');
 -- A per-object ACK must carry its actual planned own errors/confirmation;
 -- another object's response and an invented subset cannot supply its result.
 SELECT coalesce(jsonb_agg(x ORDER BY x::text),'[]') INTO expected FROM jsonb_array_elements(facet->'responses')x WHERE EXISTS(SELECT FROM jsonb_array_elements(actual)a WHERE a->'scope'=x->'scope' AND a->'lineIndex'=x->'lineIndex');
 SELECT coalesce(jsonb_agg(x ORDER BY x::text),'[]') INTO actual FROM jsonb_array_elements(actual)x;
 RETURN jsonb_array_length(actual)>0 AND actual=expected;
END $assigned_birth_body$;
 before_definition:=pg_get_functiondef(target_oid);
 IF (length(before_definition)-length(replace(before_definition,old_body,'')))/length(old_body)<>1 THEN RAISE EXCEPTION 'assigned_prodat_negative_unique_body_required';END IF;
 after_definition:=replace(before_definition,old_body,new_body);EXECUTE after_definition;
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE pg_proc.oid=target_oid) IS DISTINCT FROM '6621b89df8f294129d90f263030d4e3dfb544f34a313baa2278996e9d6547bf0' THEN RAISE EXCEPTION 'assigned_prodat_negative_postimage_mismatch';END IF;
END $assigned_birth_upgrade$;
DO $assigned_birth_upgrade$
DECLARE target_oid oid;before_definition text;after_definition text;old_body text;new_body text;
BEGIN
 target_oid:='gridex_ediel_ack_guide.prodat_original_outcomes_v1(public.ediel_messages,public.ediel_messages)'::regprocedure;
 SELECT prosrc INTO old_body FROM pg_proc WHERE pg_proc.oid=target_oid;
 IF encode(sha256(convert_to(old_body,'UTF8')),'hex') IS DISTINCT FROM 'ce04c5ef24950fcdd2eb01eb3211bd91729e51ebb1e90787e459e2246078aed2' THEN RAISE EXCEPTION 'assigned_prodat_negative_unknown_preimage:gridex_ediel_ack_guide.prodat_original_outcomes_v1';END IF;
 new_body:=$assigned_birth_body$
DECLARE facet jsonb;
BEGIN
 IF m.execution_context_snapshot->>'prodatCommonHeaderNegativeWitnessId' IS NOT NULL AND gridex_ediel_header_negative_birth.evidence_v1(s) IS NOT NULL THEN RETURN gridex_ediel_header_negative_birth.scopes_v1(m.raw_payload,s);END IF;
 IF m.execution_context_snapshot->>'prodatCommonHeaderNegativeWitnessId' IS NOT NULL OR EXISTS(SELECT FROM gridex_ediel_ack_guide.established_prodat_acks WHERE ack_message_id=m.id) THEN RETURN gridex_ediel_ack_guide.prodat_outcomes_v1(m.raw_payload,s.raw_payload);END IF;
 facet:=gridex_ediel_ack_guide.bound_prodat_response_v1(m,s);
 RETURN gridex_ediel_ack_guide.prodat_outcomes_v2(m.raw_payload,s.raw_payload,facet->'objects');
END $assigned_birth_body$;
 before_definition:=pg_get_functiondef(target_oid);
 IF (length(before_definition)-length(replace(before_definition,old_body,'')))/length(old_body)<>1 THEN RAISE EXCEPTION 'assigned_prodat_negative_unique_body_required';END IF;
 after_definition:=replace(before_definition,old_body,new_body);EXECUTE after_definition;
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE pg_proc.oid=target_oid) IS DISTINCT FROM '8bd7ddfc3382ee5949e2943e23553abdce66f1ce5a9d37cc06d97d378e6c97a7' THEN RAISE EXCEPTION 'assigned_prodat_negative_postimage_mismatch';END IF;
END $assigned_birth_upgrade$;
DO $assigned_birth_upgrade$
DECLARE target_oid oid;before_definition text;after_definition text;old_body text;new_body text;
BEGIN
 target_oid:='gridex_ack_authority.read_outbound_originals_v1(uuid,text)'::regprocedure;
 SELECT prosrc INTO old_body FROM pg_proc WHERE pg_proc.oid=target_oid;
 IF encode(sha256(convert_to(old_body,'UTF8')),'hex') IS DISTINCT FROM '5f23be0938cae8be01971b12688ab8f313205fd5f02324887f6cf765d08d52d9' THEN RAISE EXCEPTION 'assigned_prodat_negative_unknown_preimage:gridex_ack_authority.read_outbound_originals_v1';END IF;
 new_body:=$assigned_birth_body$
DECLARE source public.ediel_messages%rowtype;ack public.ediel_messages%rowtype;a jsonb;s jsonb;h jsonb;items jsonb:='[]';source_hash text;ack_hash text;qualified boolean;matched boolean;company uuid;technical gridex_ediel_technical_ack.sources%rowtype;reply gridex_ediel_technical_ack.replies%rowtype;common gridex_ediel_common_header.sources%rowtype;
BEGIN
 IF p_source IS NULL OR p_family IS NULL OR p_family NOT IN('CONTRL','APERAK','UTILTS_ERR') THEN RAISE EXCEPTION 'ack_original_read_scope_required' USING ERRCODE='22023';END IF;
 SELECT * INTO source FROM public.ediel_messages WHERE id=p_source AND direction='inbound';
 IF source.id IS NULL THEN RAISE EXCEPTION 'ack_original_inbound_source_required' USING ERRCODE='23514';END IF;
 source_hash:=encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex');s:=gridex_ack_authority.wire_v1(source.raw_payload);
 SELECT * INTO technical FROM gridex_ediel_technical_ack.sources WHERE source_message_id=source.id AND environment=source.environment AND payload_sha256=source_hash AND status='ready';
 SELECT * INTO common FROM gridex_ediel_common_header.sources WHERE source_message_id=source.id AND environment=source.environment AND payload_sha256=source_hash AND status='ready';
 IF source.company_id IS NULL AND technical.company_id IS NOT NULL AND common.company_id IS NOT NULL AND technical.company_id<>common.company_id THEN RAISE EXCEPTION 'ack_original_tenant_basis_ambiguous';END IF;
 company:=coalesce(source.company_id,technical.company_id,common.company_id);
 IF company IS NULL THEN RETURN jsonb_build_object('version',1,'sourceMessageId',source.id,'sourcePayloadHash',source_hash,'environment',source.environment,'companyId',NULL,'originals','[]'::jsonb);END IF;
 FOR ack IN SELECT m.* FROM public.ediel_messages m WHERE m.direction='outbound' AND m.company_id=company AND m.environment=source.environment AND m.message_family=p_family
  AND (m.related_message_id=source.id OR EXISTS(SELECT FROM gridex_ediel_outbound_owner.consumptions c JOIN gridex_ediel_outbound_owner.witnesses w ON w.id=c.witness_id WHERE c.source_message_id=m.id AND w.related_message_id=source.id)
   OR EXISTS(SELECT FROM gridex_ediel_common_header.negative_consumptions c JOIN gridex_ediel_common_header.negative_witnesses w ON w.id=c.witness_id WHERE c.ack_message_id=m.id AND w.source_message_id=source.id) OR EXISTS(SELECT FROM gridex_ediel_ack_replay.creation_receipts r WHERE r.ack_message_id=m.id AND r.source_message_id=source.id AND r.company_id=company AND r.environment=source.environment AND r.source_payload_hash=source_hash AND r.ack_payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')) OR (p_family='CONTRL' AND gridex_ediel_technical_ack.retained_source_v1(m,false)=source.id)) ORDER BY m.created_at,m.id LOOP
  IF gridex_ediel_duplicate_responses.is_duplicate_ack_v1(ack.id) THEN CONTINUE;END IF;
  ack_hash:=encode(sha256(convert_to(ack.raw_payload,'UTF8')),'hex');a:=gridex_ack_authority.wire_v1(ack.raw_payload);qualified:=false;matched:=false;
  IF p_family='CONTRL' THEN
   h:=gridex_ediel_technical_ack.envelope(source.raw_payload);
   matched:=a IS NOT NULL AND h IS NOT NULL AND a->>'family'='CONTRL' AND a->'sender'=h->'receiver' AND a->'receiver'=h->'sender'
    AND a->>'environment'=h->>'environment' AND a->>'app'=h->>'applicationReference' AND a->>'uciRef'=h->>'uciReference' AND a->'uciSender'=h->'sender' AND a->'uciReceiver'=h->'receiver';
   IF NOT coalesce(matched,false) THEN CONTINUE;END IF;
   SELECT * INTO reply FROM gridex_ediel_technical_ack.replies WHERE source_message_id=source.id AND company_id=company AND environment=source.environment AND payload_sha256=source_hash;
   qualified:=gridex_ediel_technical_ack.retained_source_v1(ack,true)=source.id AND technical.company_id IS NOT DISTINCT FROM company AND reply.source_message_id IS NOT NULL AND reply.evidence->'originalUNB'=h
    AND reply.evidence->>'syntaxDecision' IN('accepted','rejected') AND a->>'uciAction'=CASE reply.evidence->>'syntaxDecision' WHEN 'accepted' THEN '1' ELSE '4' END
    AND ack.immutable_rendered_at IS NOT NULL AND ack.immutable_payload_hash=ack_hash;
  ELSE
   matched:=gridex_ediel_header_negative_birth.source_matches_v1(a,s,source);
   IF NOT coalesce(matched,false) THEN CONTINUE;END IF;
   qualified:=EXISTS(SELECT FROM gridex_received_sources.sources r WHERE r.source_message_id=source.id AND r.company_id=company AND r.environment=source.environment AND r.payload_hash=source_hash AND r.raw_payload=source.raw_payload)
    AND EXISTS(SELECT FROM gridex_ediel_outbound_owner.consumptions c JOIN gridex_ediel_outbound_owner.witnesses w ON w.id=c.witness_id
    WHERE c.source_message_id=ack.id AND c.company_id=company AND c.environment=source.environment AND c.payload_sha256=ack_hash
     AND w.company_id=company AND w.environment=source.environment AND w.payload_sha256=ack_hash AND w.related_message_id=source.id AND w.family=p_family AND w.code=ack.message_code)
    OR EXISTS(SELECT FROM gridex_ediel_common_header.negative_consumptions c JOIN gridex_ediel_common_header.negative_witnesses w ON w.id=c.witness_id
     WHERE common.source_message_id=source.id AND common.company_id=company AND common.payload_sha256=source_hash
      AND c.ack_message_id=ack.id AND c.company_id=company AND c.environment=source.environment AND c.payload_sha256=ack_hash
      AND w.company_id=company AND w.environment=source.environment AND w.source_message_id=source.id AND w.payload_sha256=ack_hash);
  END IF;
  -- Failed/cancelled is only an operational projection. A genuine born ACK
  -- remains its own original; missing historical basis is an explicit hold.
  items:=items||jsonb_build_array(jsonb_build_object('status',CASE WHEN coalesce(qualified,false) THEN 'qualified' ELSE 'held' END,'message',to_jsonb(ack),'payloadHash',ack_hash));
 END LOOP;
 RETURN jsonb_build_object('version',1,'sourceMessageId',source.id,'sourcePayloadHash',source_hash,'environment',source.environment,'companyId',company,'originals',items);
END $assigned_birth_body$;
 before_definition:=pg_get_functiondef(target_oid);
 IF (length(before_definition)-length(replace(before_definition,old_body,'')))/length(old_body)<>1 THEN RAISE EXCEPTION 'assigned_prodat_negative_unique_body_required';END IF;
 after_definition:=replace(before_definition,old_body,new_body);EXECUTE after_definition;
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE pg_proc.oid=target_oid) IS DISTINCT FROM '142f25b2cfdb260e7183a2ceb5fcb309498bd0bc9b86ce297738743f9434707e' THEN RAISE EXCEPTION 'assigned_prodat_negative_postimage_mismatch';END IF;
END $assigned_birth_upgrade$;
DO $assigned_birth_upgrade$
DECLARE target_oid oid;before_definition text;after_definition text;old_body text;new_body text;
BEGIN
 target_oid:='gridex_ediel_ack_replay.read_scope_v2(uuid,text,uuid,text,uuid,text,text)'::regprocedure;
 SELECT prosrc INTO old_body FROM pg_proc WHERE pg_proc.oid=target_oid;
 IF encode(sha256(convert_to(old_body,'UTF8')),'hex') IS DISTINCT FROM 'a3e5a15e923db9c88e4bbc2e24e356e6da839608defd92916fbb8a70ef346748' THEN RAISE EXCEPTION 'assigned_prodat_negative_unknown_preimage:gridex_ediel_ack_replay.read_scope_v2';END IF;
 new_body:=$assigned_birth_body$
DECLARE gate jsonb;source public.ediel_messages%rowtype;wanted jsonb;own_scopes jsonb;want jsonb;own_scope jsonb;qualified jsonb;chosen jsonb;candidate public.ediel_messages%rowtype;overlap boolean;covers boolean;any_overlap boolean:=false;BEGIN
 -- Same protected current-source gate precedes every candidate selection. All
 -- current graph fences and message SHARE are acquired by the exact reader.
 gate:=gridex_ediel_duplicate_responses.read_business_original_v1(c,env,source_id,actor,family,NULL,'prepare');
 source:=jsonb_populate_record(NULL::public.ediel_messages,gate->'sourceMessage');
 IF source_hash IS NULL OR source_hash IS DISTINCT FROM encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'canonical_ack_actual_original_mismatch';END IF;
 IF family IS DISTINCT FROM 'APERAK' OR source.message_family IS DISTINCT FROM 'PRODAT' OR nullif(wanted_raw,'') IS NULL OR octet_length(wanted_raw)>8388608 THEN RAISE EXCEPTION 'ediel_ack_replay_physical_prodat_scope_required';END IF;
 wanted:=gridex_ediel_header_negative_birth.scopes_v1(wanted_raw,source);
 FOR candidate IN SELECT p.* FROM public.ediel_messages p WHERE
  (p.company_id=c AND p.environment=env AND p.direction='outbound' AND p.message_family=family AND p.related_message_id=source.id)
  OR EXISTS(SELECT FROM gridex_ediel_outbound_owner.consumptions co JOIN gridex_ediel_outbound_owner.witnesses w ON w.id=co.witness_id WHERE co.source_message_id=p.id AND w.related_message_id=source.id AND w.family=read_scope_v2.family)
  OR EXISTS(SELECT FROM gridex_ediel_common_header.negative_consumptions co JOIN gridex_ediel_common_header.negative_witnesses w ON w.id=co.witness_id WHERE co.ack_message_id=p.id AND w.source_message_id=source.id) ORDER BY p.id FOR SHARE LOOP
  IF gridex_ediel_duplicate_responses.is_duplicate_ack_v1(candidate.id) THEN CONTINUE;END IF;
  -- A forged, foreign, held or missing immutable own original never becomes
  -- authority just because its public parsed/status/outcome cache matches.
  qualified:=gridex_ediel_duplicate_responses.read_business_original_v1(c,env,source.id,actor,family,candidate.id,'prepare');
  IF qualified IS NULL THEN RAISE EXCEPTION 'ediel_historical_prodat_ack_scope_basis_unavailable';END IF;
  own_scopes:=gridex_ediel_header_negative_birth.scopes_v1(candidate.raw_payload,source);overlap:=false;covers:=true;
  FOR want IN SELECT x FROM jsonb_array_elements(wanted)x LOOP
   IF NOT EXISTS(SELECT FROM jsonb_array_elements(own_scopes)x WHERE
    (x->>'scope'='message' OR x->>'scope'=want->>'scope' AND x->>'reference'=want->>'reference') AND x->>'outcome'=want->>'outcome') THEN covers:=false;END IF;
   FOR own_scope IN SELECT x FROM jsonb_array_elements(own_scopes)x LOOP
    IF gridex_ediel_ack_guide.prodat_scope_overlap_v1(want,own_scope) THEN
     overlap:=true;IF own_scope->>'outcome' IS DISTINCT FROM want->>'outcome' THEN RAISE EXCEPTION 'ediel_prodat_ack_scope_conflicting_outcome';END IF;
    END IF;
   END LOOP;
  END LOOP;
  any_overlap:=any_overlap OR overlap;
  IF covers THEN
   IF chosen IS NOT NULL THEN RAISE EXCEPTION 'ediel_ack_replay_own_response_ambiguous';END IF;
   chosen:=qualified||jsonb_build_object('version',2,'requestedPayloadHash',encode(sha256(convert_to(wanted_raw,'UTF8')),'hex'),'requestedScopes',wanted,'ackScopes',own_scopes);
  END IF;
 END LOOP;
 IF chosen IS NOT NULL THEN
  PERFORM gridex_ediel_duplicate_responses.read_business_original_v1(c,env,source.id,actor,family,(chosen#>>'{ackMessage,id}')::uuid,'prepare');
  RETURN chosen;END IF;
 -- Never replay one fixed subgroup as if it answered the entire request, nor
 -- mint a fresh overlapping decision. Caller can request its actual new scopes.
 IF any_overlap THEN RAISE EXCEPTION 'ediel_prodat_ack_scope_partially_fixed';END IF;
 PERFORM gridex_ediel_duplicate_responses.read_business_original_v1(c,env,source.id,actor,family,NULL,'prepare');
 RETURN NULL;
END $assigned_birth_body$;
 before_definition:=pg_get_functiondef(target_oid);
 IF (length(before_definition)-length(replace(before_definition,old_body,'')))/length(old_body)<>1 THEN RAISE EXCEPTION 'assigned_prodat_negative_unique_body_required';END IF;
 after_definition:=replace(before_definition,old_body,new_body);EXECUTE after_definition;
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE pg_proc.oid=target_oid) IS DISTINCT FROM '82bbf47f8d02f428178ac0cb1caf4613f3364d01a5cfbcb857af478ead05a349' THEN RAISE EXCEPTION 'assigned_prodat_negative_postimage_mismatch';END IF;
END $assigned_birth_upgrade$;
DO $assigned_birth_upgrade$
DECLARE target_oid oid;before_definition text;after_definition text;old_body text;new_body text;
BEGIN
 target_oid:='gridex_ediel_ack_replay.create_scope_v2(uuid,text,uuid,text,uuid,text,text,text,text,jsonb,jsonb)'::regprocedure;
 SELECT prosrc INTO old_body FROM pg_proc WHERE pg_proc.oid=target_oid;
 IF encode(sha256(convert_to(old_body,'UTF8')),'hex') IS DISTINCT FROM '687c6d6b860436cfcd99993209360508cdfe948d74d3d482400e7f990c526357' THEN RAISE EXCEPTION 'assigned_prodat_negative_unknown_preimage:gridex_ediel_ack_replay.create_scope_v2';END IF;
 new_body:=$assigned_birth_body$
DECLARE existing jsonb;s public.ediel_messages%rowtype;m public.ediel_messages%rowtype;w gridex_ediel_outbound_owner.witnesses%rowtype;
 ctx jsonb;basis jsonb;prepared jsonb;route jsonb;tokens jsonb;scopes jsonb;unb jsonb;unh jsonb;bgm jsonb;parsed jsonb;raw text;physical_family text;wire_outcome text;common boolean;
 op text;event_id uuid;business_type text;business_id uuid;resource record;resource_json jsonb;reference record;result jsonb;
BEGIN
 -- Identical lock order to replay. Stabilize every current native permission,
 -- local role/profile, representation and positive data-approval source first.
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 PERFORM gridex_bilateral_prodat.lock_source_receipts_v1();
 -- Acquire write-compatible candidate-universe lock before replay's SHARE.
 -- Concurrent fresh creations cannot both upgrade SHARE to INSERT, even when
 -- their original/sequence keys differ. They re-read after the first commits.
 LOCK TABLE public.ediel_messages IN SHARE ROW EXCLUSIVE MODE;
 existing:=gridex_ediel_ack_replay.read_scope_v2(c,env,source_id,source_hash,actor,family,draft->>'rawPayload');
 SELECT * INTO STRICT s FROM public.ediel_messages WHERE id=source_id AND environment=env AND direction='inbound' AND (company_id=c OR company_id IS NULL) FOR SHARE;
 IF source_hash IS NULL OR source_hash IS DISTINCT FROM encode(sha256(convert_to(s.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'canonical_ack_actual_original_mismatch';END IF;
 IF outcome IS NOT NULL AND outcome NOT IN('positive','negative') THEN RAISE EXCEPTION 'ediel_ack_atomic_outcome_required';END IF;
 IF existing IS NOT NULL THEN
  IF outcome IS NOT NULL AND outcome IS DISTINCT FROM (CASE WHEN NOT EXISTS(SELECT FROM jsonb_array_elements(existing->'requestedScopes')x WHERE x->>'outcome'<>'positive') THEN 'positive' ELSE 'negative' END) THEN RAISE EXCEPTION 'ediel_ack_atomic_wire_outcome_mismatch';END IF;
  PERFORM gridex_ediel_duplicate_responses.read_business_original_v1(c,env,s.id,actor,family,(existing#>>'{ackMessage,id}')::uuid,'prepare');
  RETURN existing||jsonb_build_object('replayed',true);END IF;
 PERFORM public.ediel_require_source_bytes_available_v1(c,s.id);
 -- Fresh-only caller whitelist. An established own response above never uses
 -- a new draft, mints a witness, writes a receipt/event or selects a route.
 IF jsonb_typeof(draft) IS DISTINCT FROM 'object' OR EXISTS(SELECT FROM jsonb_object_keys(draft) k WHERE k<>ALL(ARRAY[
  'rawPayload','messageVersion','processType','transportType','mailbox','senderEdielId','senderName','senderSubAddress','receiverEdielId','receiverName','receiverSubAddress',
  'senderEmail','receiverEmail','subject','fileName','mimeType','interchangeReference','externalReference','correlationReference','transactionReference','applicationReference',
  'originalMessageId','originalTransactionId','originalMessageCode','communicationRouteId','routeProfileId','parsedPayload','validationReport',
  'requiresContrl','requiresAperak','syntaxCheckStatus','functionalCheckStatus','messageCreatedAt','validatedAt','ackDueAt'])) THEN RAISE EXCEPTION 'ediel_ack_atomic_draft_whitelist_required';END IF;
 raw:=draft->>'rawPayload';IF nullif(raw,'') IS NULL OR octet_length(raw)>8388608 THEN RAISE EXCEPTION 'ediel_ack_atomic_wire_required';END IF;
 tokens:=gridex_utilts_binding.wire_tokens_v1(raw);
 IF tokens IS NULL OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNB')<>1 OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNH')<>1 THEN RAISE EXCEPTION 'ediel_ack_atomic_wire_required';END IF;
 SELECT t INTO unb FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNB';SELECT t INTO unh FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNH';SELECT t INTO bgm FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='BGM';
 physical_family:=CASE WHEN unh#>>'{elements,2,0}'='UTILTS' AND bgm#>>'{elements,1,0}'='ERR' THEN 'UTILTS_ERR' ELSE unh#>>'{elements,2,0}' END;
 IF physical_family IS DISTINCT FROM family THEN RAISE EXCEPTION 'ediel_ack_atomic_wire_family_mismatch';END IF;
 common:=family='APERAK' AND s.message_family='PRODAT' AND EXISTS(SELECT FROM gridex_ediel_common_header.sources p WHERE p.source_message_id=s.id AND p.company_id=c AND p.environment=env AND p.status='ready');
 IF family='CONTRL' THEN
  basis:=gridex_ediel_technical_ack.require_source_v1(c,s.id);
  IF jsonb_typeof(smtp) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'ediel_ack_atomic_smtp_required';END IF;
  route:=gridex_ediel_technical_ack.select_configured_reply_route_v2(c,basis,'CONTRL',smtp->>'from',smtp->>'host',(smtp->>'port')::integer);
 ELSIF common THEN
  IF sequence_field IS NOT NULL OR outcome IS DISTINCT FROM 'negative' THEN RAISE EXCEPTION 'canonical_common_header_negative_only';END IF;
  IF jsonb_typeof(smtp) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'ediel_ack_atomic_smtp_required';END IF;
  prepared:=gridex_ediel_common_header.prepare_with_route_v2(c,env,s.id,actor,raw,smtp->>'from',smtp->>'host',(smtp->>'port')::integer);
  basis:=prepared->'evidence';SELECT b.route INTO route FROM gridex_ediel_common_header.negative_route_bindings b WHERE b.witness_id=(prepared->>'witnessId')::uuid;
 ELSE
  ctx:=gridex_ediel_ack_replay.require_current_source_role_v2(c,env,s.id);basis:=gridex_ediel_source_rules.require_v1(c,s.id);
  -- Derive positive service scope only from genuine current private native
  -- accepted storage. A prescribed negative ACK requires no data grant.
  IF ctx->>'actorRole' IN('energy_service_company','esco') AND family='APERAK' AND EXISTS(SELECT FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='ERC' AND t#>>'{elements,1,0}'='100') THEN
   PERFORM gridex_ediel_ack_replay.capture_positive_service_scope_v1(c,env,s.id,raw,actor);END IF;
  IF s.message_family='PRODAT' AND family='APERAK' AND EXISTS(SELECT FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='ERC' AND t#>>'{elements,1,0}'='100') THEN
   PERFORM public.ediel_require_prodat_bilateral_positive_source_v1(c,s.id);END IF;
  prepared:=gridex_ediel_outbound_owner.prepare_v1(jsonb_build_object('companyId',c,'environment',env,'actorUserId',actor,'rawPayload',raw,'relatedMessageId',s.id,'rulePackEvidence',basis));
  SELECT * INTO STRICT w FROM gridex_ediel_outbound_owner.witnesses WHERE id=(prepared->>'witnessId')::uuid;
  IF w.family IS DISTINCT FROM family OR w.related_message_id IS DISTINCT FROM s.id OR w.company_id IS DISTINCT FROM c OR w.environment IS DISTINCT FROM env THEN RAISE EXCEPTION 'ediel_ack_atomic_owner_scope_mismatch';END IF;
 END IF;
 -- Native parse controls all physical reference/endpoint metadata; no parsed
 -- caller reference or foreign resource ID becomes a business identity.
 parsed:=coalesce(draft->'parsedPayload','{}'::jsonb)-ARRAY['relatedTransactionReference','utiltsErrSequenceToken','ackScope','sourceMessageId','ackSourceId','serviceAssignment','sourceAuthority','rulePackEvidence'];
 IF jsonb_typeof(parsed) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'ediel_ack_atomic_metadata_required';END IF;
 IF sequence_field IS NOT NULL THEN parsed:=parsed||jsonb_build_object(sequence_field,sequence_value);END IF;
 IF sequence_field='relatedTransactionReference' THEN parsed:=parsed||jsonb_build_object('ackScope','transaction');END IF;
 parsed:=parsed||jsonb_build_object('ackSourceId',s.id,'ackFamily',family);
 scopes:=gridex_ediel_header_negative_birth.scopes_v1(raw,s);
 parsed:=parsed||jsonb_build_object('ackScope',CASE WHEN EXISTS(SELECT FROM jsonb_array_elements(scopes)x WHERE x->>'scope'='message') THEN 'message' ELSE 'object' END);
 -- Derived index only. Its physical source scopes are recomputed natively on
 -- every use; no caller sequence/hash becomes an authority capability.
 op:='ediel_ack:'||s.id::text||':'||family||':rawscope:'||encode(sha256(convert_to(scopes::text,'UTF8')),'hex');
 m.id:=gen_random_uuid();m.company_id:=c;m.environment:=env;m.direction:='outbound';m.message_standard:='edifact';m.message_family:=family;
 m.message_code:=CASE WHEN w.id IS NOT NULL THEN w.code ELSE family END;m.raw_payload:=raw;m.related_message_id:=s.id;m.status:='draft';m.source_operation_id:=op;
 m.test_flag:=CASE env WHEN 'production' THEN 0 ELSE 1 END;m.message_version:=draft->>'messageVersion';m.process_type:=draft->>'processType';m.transport_type:='smtp';
 m.sender_ediel_id:=unb#>>'{elements,2,0}';m.receiver_ediel_id:=unb#>>'{elements,3,0}';m.sender_sub_address:=nullif(unb#>>'{elements,2,2}','');m.receiver_sub_address:=nullif(unb#>>'{elements,3,2}','');
 m.interchange_reference:=unb#>>'{elements,5,0}';m.application_reference:=unb#>>'{elements,7,0}';m.original_message_id:=unh#>>'{elements,1,0}';m.external_reference:=bgm#>>'{elements,2,0}';
 m.original_transaction_id:=sequence_value;m.original_message_code:=CASE WHEN common THEN NULL ELSE s.message_code END;
 SELECT t#>>'{elements,1,1}' INTO m.correlation_reference FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='ACW' ORDER BY (t->>'index')::int LIMIT 1;
 SELECT t#>>'{elements,1,1}' INTO m.transaction_reference FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='TN' ORDER BY (t->>'index')::int LIMIT 1;
 IF m.transaction_reference IS NULL AND nullif(sequence_value,'') IS NOT NULL THEN
  SELECT t#>>'{elements,1,1}' INTO m.transaction_reference FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='ACW' AND t#>>'{elements,1,1}'=sequence_value ORDER BY (t->>'index')::int LIMIT 1;
 END IF;
 m.sender_name:=draft->>'senderName';m.receiver_name:=draft->>'receiverName';m.subject:=draft->>'subject';m.file_name:=draft->>'fileName';m.mime_type:=draft->>'mimeType';
 m.communication_route_id:=nullif(draft->>'communicationRouteId','')::uuid;m.route_profile_id:=nullif(draft->>'routeProfileId','')::uuid;
 m.sender_email:=draft->>'senderEmail';m.receiver_email:=draft->>'receiverEmail';m.mailbox:=draft->>'mailbox';
 IF route IS NOT NULL THEN
  IF m.communication_route_id::text IS DISTINCT FROM route#>>'{route,id}' OR m.route_profile_id::text IS DISTINCT FROM route#>>'{routeRuntime,route_profile_id}'
   OR m.sender_email IS DISTINCT FROM route->>'senderEmail' OR m.receiver_email IS DISTINCT FROM route->>'receiverEmail' OR m.mailbox IS DISTINCT FROM route->>'mailbox' THEN RAISE EXCEPTION 'ediel_ack_atomic_route_changed';END IF;
 ELSE
  -- Fresh ordinary response selects the exact named route/profile under lock;
  -- replay above never consults these mutable rows.
  LOCK TABLE public.communication_routes,public.ediel_route_profiles,public.ediel_transport_profiles IN SHARE MODE;
  IF NOT EXISTS(SELECT FROM public.communication_routes r JOIN public.ediel_route_profiles p ON p.communication_route_id=r.id AND p.company_id=c
   WHERE r.id=m.communication_route_id AND p.id=m.route_profile_id AND r.company_id=c AND r.is_active AND p.is_enabled AND p.environment=env
    AND p.sender_ediel_id=m.sender_ediel_id AND p.receiver_ediel_id=m.receiver_ediel_id
    AND coalesce(p.sender_subaddress,p.sender_sub_address,'')=coalesce(m.sender_sub_address,'') AND coalesce(p.receiver_subaddress,p.receiver_sub_address,'')=coalesce(m.receiver_sub_address,'')
    AND p.application_reference IS NOT DISTINCT FROM m.application_reference AND r.target_email IS NOT DISTINCT FROM m.receiver_email AND p.mailbox IS NOT DISTINCT FROM m.mailbox) THEN RAISE EXCEPTION 'ediel_ack_atomic_route_changed';END IF;
 END IF;
 m.rule_pack_snapshot:='{}'::jsonb;m.execution_context_snapshot:='{}'::jsonb;IF common THEN m.execution_context_snapshot:=jsonb_build_object('prodatCommonHeaderNegativeWitnessId',prepared->>'witnessId');
 ELSIF w.id IS NOT NULL THEN
  m.execution_context_snapshot:=jsonb_build_object('outboundOwnerWitnessId',w.id);m.canonical_rule_pack_id:=(w.evidence->>'rulePackId')::uuid;m.rule_profile_version_id:=(w.evidence->>'messageProfileId')::uuid;
  m.rule_profile_key:=w.evidence->>'profileKey';m.rule_profile_version:=w.evidence->>'version';m.rule_pack_checksum:=w.evidence->>'sourceHash';m.rule_pack_snapshot:=(w.evidence->'snapshot')||jsonb_build_object('inheritedFromSourceMessage',true,'sourceMessageId',s.id,'authority','resolveCanonicalEdielPolicy');
  -- Resource links must be owned by the actual original tenant. They never
  -- arrive through the caller draft. Lock the real rows before inheriting.
  FOR resource IN SELECT * FROM (VALUES('customers',s.customer_id),('customer_sites',s.site_id),('metering_points',s.metering_point_id),('grid_owners',s.grid_owner_id),('supplier_switch_requests',s.switch_request_id),('grid_owner_data_requests',s.grid_owner_data_request_id),('outbound_requests',s.outbound_request_id),('partner_exports',s.partner_export_id)) v(table_name,id) WHERE id IS NOT NULL LOOP
   EXECUTE format('SELECT to_jsonb(r) FROM public.%I r WHERE r.id=$1 AND r.company_id=$2 FOR SHARE',resource.table_name) INTO resource_json USING resource.id,c;
   IF resource_json IS NULL THEN RAISE EXCEPTION 'ediel_ack_atomic_foreign_source_resource';END IF;
  END LOOP;
  m.customer_id:=s.customer_id;m.site_id:=s.site_id;m.metering_point_id:=s.metering_point_id;m.grid_owner_id:=s.grid_owner_id;
  m.switch_request_id:=s.switch_request_id;m.grid_owner_data_request_id:=s.grid_owner_data_request_id;m.outbound_request_id:=s.outbound_request_id;m.partner_export_id:=s.partner_export_id;
 END IF;
 m.parsed_payload:=parsed;m.validation_report:=coalesce(draft->'validationReport','{}'::jsonb);m.requires_contrl:=false;m.requires_aperak:=false;
 m.contrl_status:='not_required';m.aperak_status:='not_required';m.utilts_err_status:='not_required';m.syntax_check_status:=draft->>'syntaxCheckStatus';m.functional_check_status:=draft->>'functionalCheckStatus';
 m.message_created_at:=coalesce((draft->>'messageCreatedAt')::timestamptz,clock_timestamp());m.validated_at:=(draft->>'validatedAt')::timestamptz;m.ack_due_at:=(draft->>'ackDueAt')::timestamptz;
 m.created_by:=actor;m.updated_by:=actor;
 -- Set physical outcome before immutable namespace/public row insertion.
 IF family='CONTRL' THEN wire_outcome:=CASE basis->>'syntaxDecision' WHEN 'accepted' THEN 'positive' WHEN 'rejected' THEN 'negative' END;
 ELSIF common OR family='UTILTS_ERR' THEN wire_outcome:='negative';
 ELSE wire_outcome:=CASE WHEN EXISTS(SELECT FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='ERC') AND NOT EXISTS(SELECT FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='ERC' AND t#>>'{elements,1,0}'<>'100') THEN 'positive' ELSE 'negative' END;END IF;
 IF wire_outcome IS NULL OR outcome IS NOT NULL AND outcome IS DISTINCT FROM wire_outcome THEN RAISE EXCEPTION 'ediel_ack_atomic_wire_outcome_mismatch';END IF;
 m.ack_outcome:=wire_outcome;m.ack_status:=wire_outcome;m.parsed_payload:=m.parsed_payload||jsonb_build_object('ackOutcome',wire_outcome);
 INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,message_version,process_type,test_flag,status,transport_type,
  raw_payload,related_message_id,source_operation_id,sender_ediel_id,receiver_ediel_id,sender_sub_address,receiver_sub_address,sender_name,receiver_name,sender_email,receiver_email,mailbox,subject,file_name,mime_type,
  communication_route_id,route_profile_id,interchange_reference,application_reference,original_message_id,original_transaction_id,original_message_code,external_reference,correlation_reference,transaction_reference,
  execution_context_snapshot,canonical_rule_pack_id,rule_profile_version_id,rule_profile_key,rule_profile_version,rule_pack_checksum,rule_pack_snapshot,
  customer_id,site_id,metering_point_id,grid_owner_id,switch_request_id,grid_owner_data_request_id,outbound_request_id,partner_export_id,
  parsed_payload,validation_report,requires_contrl,requires_aperak,contrl_status,aperak_status,utilts_err_status,ack_outcome,ack_status,syntax_check_status,functional_check_status,message_created_at,validated_at,ack_due_at,created_by,updated_by)
 VALUES(m.id,m.company_id,m.environment,m.direction,m.message_standard,m.message_family,m.message_code,m.message_version,m.process_type,m.test_flag,m.status,m.transport_type,
  m.raw_payload,m.related_message_id,m.source_operation_id,m.sender_ediel_id,m.receiver_ediel_id,m.sender_sub_address,m.receiver_sub_address,m.sender_name,m.receiver_name,m.sender_email,m.receiver_email,m.mailbox,m.subject,m.file_name,m.mime_type,
  m.communication_route_id,m.route_profile_id,m.interchange_reference,m.application_reference,m.original_message_id,m.original_transaction_id,m.original_message_code,m.external_reference,m.correlation_reference,m.transaction_reference,
  m.execution_context_snapshot,m.canonical_rule_pack_id,m.rule_profile_version_id,m.rule_profile_key,m.rule_profile_version,m.rule_pack_checksum,m.rule_pack_snapshot,
  m.customer_id,m.site_id,m.metering_point_id,m.grid_owner_id,m.switch_request_id,m.grid_owner_data_request_id,m.outbound_request_id,m.partner_export_id,
  m.parsed_payload,m.validation_report,m.requires_contrl,m.requires_aperak,m.contrl_status,m.aperak_status,m.utilts_err_status,m.ack_outcome,m.ack_status,m.syntax_check_status,m.functional_check_status,m.message_created_at,m.validated_at,m.ack_due_at,m.created_by,m.updated_by) RETURNING * INTO m;
 -- Real native guide/source/namespace/witness consumption triggers ran. Re-read
 -- their immutable original/ACK receipts before publishing effects/results.
 IF family<>'CONTRL' AND NOT coalesce(common,false) THEN PERFORM gridex_ediel_source_rules.capture_v1(c,m.id);END IF;
 result:=gridex_ediel_duplicate_responses.read_business_original_v1(c,env,s.id,actor,family,m.id,'prepare');
 result:=result||jsonb_build_object('version',2,'requestedPayloadHash',encode(sha256(convert_to(raw,'UTF8')),'hex'),'requestedScopes',scopes,'ackScopes',scopes);
 IF result#>>'{ackMessage,id}' IS DISTINCT FROM m.id::text THEN RAISE EXCEPTION 'ediel_ack_atomic_postwrite_owner_mismatch';END IF;
 business_type:=CASE WHEN m.switch_request_id IS NOT NULL THEN 'supplier_switch_request' WHEN m.grid_owner_data_request_id IS NOT NULL THEN 'grid_owner_data_request' WHEN m.outbound_request_id IS NOT NULL THEN 'outbound_request' WHEN m.partner_export_id IS NOT NULL THEN 'partner_export' END;
 business_id:=coalesce(m.switch_request_id,m.grid_owner_data_request_id,m.outbound_request_id,m.partner_export_id);
 IF business_id IS NOT NULL THEN
  FOR reference IN SELECT DISTINCT reference_type,reference_value FROM (
   SELECT 'UNB_REF'::text reference_type,m.interchange_reference reference_value UNION ALL SELECT 'BGM_REF',m.external_reference
   UNION ALL SELECT 'RFF_'||(t#>>'{elements,1,0}'),t#>>'{elements,1,1}' FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}' IN('LI','ACW','Z07','TN')
   UNION ALL SELECT 'IDE',t#>>'{elements,2,0}' FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='IDE') r WHERE nullif(reference_value,'') IS NOT NULL LOOP
   INSERT INTO public.ediel_business_references(company_id,source_message_id,reference_type,reference_value,message_family,message_code,business_object_type,business_object_id,customer_id,customer_site_id,metering_point_id)
    VALUES(c,m.id,reference.reference_type,reference.reference_value,family,m.message_code,business_type,business_id,m.customer_id,m.site_id,m.metering_point_id)
    ON CONFLICT(company_id,reference_type,reference_value,business_object_type,business_object_id) DO NOTHING;
  END LOOP;
 END IF;
 INSERT INTO public.ediel_message_events(company_id,ediel_message_id,message_id,event_type,event_status,message,payload,event_payload,created_by)
  VALUES(c,m.id,m.id,'created','info','Ediel message '||family||' '||coalesce(m.message_code,'')||' skapad.',jsonb_build_object('status',m.status,'direction',m.direction,'externalReference',m.external_reference,'communicationRouteId',m.communication_route_id),jsonb_build_object('sourceMessageId',s.id,'sourceOperationId',op,'atomicOwner',true),actor) RETURNING id INTO event_id;
 INSERT INTO gridex_ediel_ack_replay.creation_receipts VALUES(m.id,s.id,c,env,actor,source_hash,encode(sha256(convert_to(raw,'UTF8')),'hex'),op,event_id,family,sequence_field,sequence_value,wire_outcome,clock_timestamp());
 PERFORM gridex_ediel_duplicate_responses.read_business_original_v1(c,env,s.id,actor,family,m.id,'prepare');
 RETURN result||jsonb_build_object('replayed',false);
END $assigned_birth_body$;
 before_definition:=pg_get_functiondef(target_oid);
 IF (length(before_definition)-length(replace(before_definition,old_body,'')))/length(old_body)<>1 THEN RAISE EXCEPTION 'assigned_prodat_negative_unique_body_required';END IF;
 after_definition:=replace(before_definition,old_body,new_body);EXECUTE after_definition;
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE pg_proc.oid=target_oid) IS DISTINCT FROM '7d8a69eca294252fb3245ce789a1df31bbf651434d1ea56d5ab99b88db76d854' THEN RAISE EXCEPTION 'assigned_prodat_negative_postimage_mismatch';END IF;
END $assigned_birth_upgrade$;
DO $assigned_birth_upgrade$
DECLARE target_oid oid;before_definition text;after_definition text;old_body text;new_body text;
BEGIN
 target_oid:='gridex_ediel_ack_replay.read_exact_v2(uuid,text,uuid,uuid,text,uuid)'::regprocedure;
 SELECT prosrc INTO old_body FROM pg_proc WHERE pg_proc.oid=target_oid;
 IF encode(sha256(convert_to(old_body,'UTF8')),'hex') IS DISTINCT FROM '437b397f9e99496bad725ac563fc2d19bdeabc9daab8d4ea5730df58859697c2' THEN RAISE EXCEPTION 'assigned_prodat_negative_unknown_preimage:gridex_ediel_ack_replay.read_exact_v2';END IF;
 new_body:=$assigned_birth_body$
DECLARE source public.ediel_messages%rowtype;ack public.ediel_messages%rowtype;ids uuid[];context jsonb;ack_context jsonb;basis jsonb;own_basis jsonb;
 a jsonb;s jsonb;tokens jsonb;sequence_field text:=NULL;sequence_value text:=NULL;common_source boolean;observed timestamptz:=clock_timestamp();companies uuid[];wire_outcome text;
BEGIN
 IF c IS NULL OR actor IS NULL OR source_id IS NULL OR env IS NULL OR env NOT IN('test','production') OR family IS NULL OR family NOT IN('CONTRL','APERAK','UTILTS_ERR')
  OR (sequence_field IS NULL)<>(sequence_value IS NULL) OR sequence_field IS NOT NULL AND (sequence_field NOT IN('relatedTransactionReference','utiltsErrSequenceToken') OR nullif(btrim(sequence_value),'') IS NULL)
  OR family='CONTRL' AND sequence_field IS NOT NULL OR sequence_field='utiltsErrSequenceToken' AND family<>'UTILTS_ERR' THEN
  RAISE EXCEPTION 'ediel_ack_replay_scope_required' USING ERRCODE='22023';END IF;
 -- A permission decision must remain true through source/ACK qualification.
 -- SHARE prevents UPDATE/DELETE and phantom INSERT grants/namespace collisions;
 -- all permission sources used by the current native resolver are included.
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 PERFORM gridex_bilateral_prodat.lock_source_receipts_v1();
 IF NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=actor AND u.user_status='active')
  OR NOT EXISTS(SELECT FROM public.company_memberships m WHERE m.company_id=c AND m.user_id=actor AND m.status='active' AND m.is_active AND m.accepted_at IS NOT NULL)
  OR NOT EXISTS(SELECT FROM public.companies co WHERE co.id=c AND co.status='active') THEN
  RAISE EXCEPTION 'ediel_ack_replay_actor_not_authorized' USING ERRCODE='42501';END IF;
 -- Stabilize the entire own-source candidate set, including opposite outcomes.
 -- A later concurrent INSERT is re-read through this same command after 23505.
 LOCK TABLE public.ediel_messages IN SHARE MODE;
 SELECT * INTO source FROM public.ediel_messages WHERE id=source_id AND environment=env AND direction='inbound'
  AND message_standard='edifact' AND (company_id=c OR company_id IS NULL) FOR SHARE;
 IF source.id IS NULL OR nullif(source.raw_payload,'') IS NULL THEN RAISE EXCEPTION 'ediel_ack_replay_actual_source_unavailable';END IF;
 common_source:=family='APERAK' AND source.message_family='PRODAT' AND EXISTS(SELECT FROM gridex_ediel_common_header.sources p WHERE p.source_message_id=source.id AND p.company_id=c AND p.environment=env AND p.status='ready');
 IF public.gridex_actor_has_company_permission(actor,c,'communication.write') IS NOT TRUE
  AND NOT(env='test' AND (family='CONTRL' OR common_source) AND public.gridex_actor_has_company_permission(actor,c,'ediel_testing.write') IS TRUE) THEN
  RAISE EXCEPTION 'ediel_ack_replay_actor_not_authorized' USING ERRCODE='42501';END IF;
 IF family='CONTRL' THEN
  basis:=gridex_ediel_technical_ack.require_source_v1(c,source.id);
  PERFORM gridex_ediel_technical_ack.require_current_endpoint_v1(basis);
 ELSIF common_source THEN
  basis:=gridex_ediel_common_header.require_v1(c,env,source.id);
  PERFORM gridex_ediel_common_header.require_current_scope_v1(basis);
 ELSE
  IF source.company_id IS DISTINCT FROM c THEN RAISE EXCEPTION 'ediel_ack_replay_actual_source_unavailable';END IF;
  basis:=gridex_ediel_source_rules.require_v1(c,source.id);
  context:=gridex_ediel_ack_replay.require_current_source_role_v2(c,env,source.id);
  -- The immutable local legal recipient becomes the ACK issuer. Both wire
  -- legal parties and full transport components are matched below; only the
  -- current local namespace is resolved here, without profile/role re-selection.
  IF context->>'basisKind' IS DISTINCT FROM 'observed_source_persistence' OR context->>'companyId' IS DISTINCT FROM c::text OR context->>'environment' IS DISTINCT FROM env THEN RAISE EXCEPTION 'ediel_ack_replay_legal_scope_invalid';END IF;
  SELECT array_agg(DISTINCT i.company_id) INTO companies FROM public.tenant_actor_identifiers i WHERE i.environment=env AND i.identifier_type='EdielId'
   AND i.identifier_value=context->>'legalEdielId' AND i.valid_from<=observed AND (i.valid_to IS NULL OR observed<i.valid_to);
  IF cardinality(companies) IS DISTINCT FROM 1 OR companies[1] IS DISTINCT FROM c OR NOT EXISTS(SELECT FROM public.tenant_actor_identifiers i WHERE i.company_id=c AND i.environment=env
   AND i.actor_id::text=context->>'legalActorId' AND i.identifier_type='EdielId' AND i.identifier_value=context->>'legalEdielId'
   AND i.valid_from<=observed AND (i.valid_to IS NULL OR observed<i.valid_to)) THEN RAISE EXCEPTION 'ediel_ack_replay_legal_scope_invalid';END IF;
  PERFORM gridex_ediel_technical_ack.require_current_endpoint_v1(context);
 END IF;
 IF ack_id IS NULL THEN RETURN jsonb_build_object('version',1,'sourceMessage',to_jsonb(source));END IF;
 SELECT array_agg(m.id) INTO ids FROM public.ediel_messages m WHERE m.id=ack_id AND m.company_id=c AND m.environment=env AND m.direction='outbound' AND m.related_message_id=source.id AND m.message_family=family;
 IF coalesce(cardinality(ids),0)=0 THEN RETURN NULL;END IF;
 IF cardinality(ids)<>1 THEN RAISE EXCEPTION 'ediel_ack_replay_own_response_ambiguous';END IF;
 SELECT * INTO STRICT ack FROM public.ediel_messages WHERE id=ids[1] AND company_id=c AND environment=env AND direction='outbound' AND related_message_id=source.id AND message_family=family FOR SHARE;
 IF NOT EXISTS(SELECT FROM gridex_ediel_wire_namespace.coverage w WHERE w.source_message_id=ack.id AND w.company_id=c AND w.environment=env
  AND w.payload_sha256=encode(sha256(convert_to(ack.raw_payload,'UTF8')),'hex')) THEN RAISE EXCEPTION 'ediel_ack_replay_private_own_wire_unavailable';END IF;
 IF family='CONTRL' THEN
  own_basis:=gridex_ediel_technical_ack.require_contrl_v1(ack);
  IF own_basis IS DISTINCT FROM basis THEN RAISE EXCEPTION 'ediel_ack_replay_original_basis_mismatch';END IF;
  wire_outcome:=CASE own_basis->>'syntaxDecision' WHEN 'accepted' THEN 'positive' WHEN 'rejected' THEN 'negative' END;
 ELSIF common_source THEN
  own_basis:=gridex_ediel_ack_replay.require_common_own_v2(ack);
  IF own_basis IS DISTINCT FROM basis THEN RAISE EXCEPTION 'ediel_ack_replay_original_basis_mismatch';END IF;
  wire_outcome:='negative';
 ELSE
  own_basis:=gridex_ediel_outbound_owner.require_v1(c,ack.id);
  IF own_basis IS DISTINCT FROM basis OR gridex_ediel_source_rules.require_v1(c,ack.id) IS DISTINCT FROM basis
   OR NOT EXISTS(SELECT FROM gridex_ediel_source_rules.receipts r WHERE r.source_message_id=ack.id AND r.original_source_message_id=source.id) THEN RAISE EXCEPTION 'ediel_ack_replay_original_basis_mismatch';END IF;
  ack_context:=gridex_ediel_inbound_context.require_v1(c,ack.id);
  IF ack_context->>'basisKind' IS DISTINCT FROM 'prescribed_outbound_ack' OR ack_context->>'originalSourceMessageId' IS DISTINCT FROM source.id::text
   OR ack_context->>'originalSourceHash' IS DISTINCT FROM encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex')
   OR ack_context->>'legalActorId' IS DISTINCT FROM context->>'legalActorId' OR ack_context->>'legalEdielId' IS DISTINCT FROM context->>'legalEdielId'
   OR ack_context->>'transportActorId' IS DISTINCT FROM context->>'transportActorId' THEN RAISE EXCEPTION 'ediel_ack_replay_legal_scope_invalid';END IF;
  a:=gridex_ack_authority.wire_v1(ack.raw_payload);s:=gridex_ack_authority.wire_v1(source.raw_payload);
  IF NOT coalesce(gridex_ediel_header_negative_birth.source_matches_v1(a,s,source),false) THEN RAISE EXCEPTION 'ediel_ack_replay_physical_source_mismatch';END IF;
  IF sequence_field='relatedTransactionReference' AND (NOT coalesce(s->'ide','[]') ? sequence_value
   OR NOT (CASE family WHEN 'APERAK' THEN coalesce(a#>'{refs,ACW}','[]') ELSE coalesce(a#>'{refs,TN}','[]') END) ? sequence_value
   OR ack.parsed_payload->>'ackScope' IS DISTINCT FROM 'transaction') THEN RAISE EXCEPTION 'ediel_ack_replay_sequence_mismatch';END IF;
  IF sequence_field='utiltsErrSequenceToken' THEN
   tokens:=gridex_utilts_binding.wire_tokens_v1(ack.raw_payload);
   IF NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='STS' AND t#>>'{elements,1,0}'='E01' AND t#>>'{elements,2,0}'='41' AND t#>>'{elements,3,0}'=sequence_value) THEN RAISE EXCEPTION 'ediel_ack_replay_sequence_mismatch';END IF;
  END IF;
  wire_outcome:=CASE WHEN family='UTILTS_ERR' THEN 'negative' WHEN jsonb_array_length(coalesce(a->'erc','[]'))>0 AND NOT EXISTS(SELECT FROM jsonb_array_elements_text(a->'erc') x WHERE x<>'100') THEN 'positive' ELSE 'negative' END;
 END IF;
 IF common_source THEN PERFORM gridex_ediel_ack_replay.require_common_guide_v2(ack,own_basis);ELSE PERFORM gridex_ediel_ack_replay.require_readonly_guide_v2(ack);END IF;
 IF family='APERAK' AND source.message_family='PRODAT' THEN PERFORM gridex_ediel_ack_replay.require_readonly_prodat_ledger_v2(ack);END IF;
 IF family='APERAK' AND source.message_family='PRODAT' AND EXISTS(SELECT FROM jsonb_array_elements(gridex_utilts_binding.wire_tokens_v1(ack.raw_payload))t WHERE t->>'tag'='ERC' AND t#>>'{elements,1,0}'='100') THEN
  PERFORM public.ediel_require_recorded_prodat_bilateral_ack_source_v1(c,source.id,encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex'));END IF;
 IF NOT common_source AND family<>'CONTRL' AND context->>'actorRole' IN('energy_service_company','esco') AND wire_outcome='positive' THEN
  PERFORM gridex_ediel_ack_replay.require_positive_service_scope_v1(c,env,source.id,ack.raw_payload);END IF;
 IF wire_outcome IS NULL OR ack.ack_outcome IS NOT NULL AND ack.ack_outcome IS DISTINCT FROM wire_outcome THEN RAISE EXCEPTION 'ediel_ack_replay_own_outcome_mismatch';END IF;
 RETURN jsonb_build_object('version',1,'sourceMessage',to_jsonb(source),'ackMessage',to_jsonb(ack)||jsonb_build_object('ack_outcome',wire_outcome));
END $assigned_birth_body$;
 before_definition:=pg_get_functiondef(target_oid);
 IF (length(before_definition)-length(replace(before_definition,old_body,'')))/length(old_body)<>1 THEN RAISE EXCEPTION 'assigned_prodat_negative_unique_body_required';END IF;
 after_definition:=replace(before_definition,old_body,new_body);EXECUTE after_definition;
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE pg_proc.oid=target_oid) IS DISTINCT FROM '17dcd4a63fd77dc71c70df714740fb58325f44f600a6501e4a526a515bbf3702' THEN RAISE EXCEPTION 'assigned_prodat_negative_postimage_mismatch';END IF;
END $assigned_birth_upgrade$;
DO $assigned_birth_upgrade$
DECLARE target_oid oid;before_definition text;after_definition text;old_body text;new_body text;
BEGIN
 target_oid:='gridex_ediel_ack_guide.require_registered_basis_v1(public.ediel_messages,text,jsonb,jsonb)'::regprocedure;
 SELECT prosrc INTO old_body FROM pg_proc WHERE pg_proc.oid=target_oid;
 IF encode(sha256(convert_to(old_body,'UTF8')),'hex') IS DISTINCT FROM '24ee9b0424081c78ead6ca250270a80554cc29a8d49d2ffd4060470a738884d9' THEN RAISE EXCEPTION 'assigned_prodat_negative_unknown_preimage:gridex_ediel_ack_guide.require_registered_basis_v1';END IF;
 new_body:=$assigned_birth_body$
DECLARE r jsonb;v text;n integer;physical jsonb;
BEGIN
 IF p_kind='technical' THEN RETURN;END IF;
 IF p_kind='common' THEN r:=p_basis#>'{familyEdition,rulePack}';v:=p_basis#>>'{familyEdition,version}';ELSE r:=p_basis#>'{snapshot,rulePack}';v:=p_basis->>'version';
  IF p_basis#>>'{snapshot,version}' IS DISTINCT FROM v THEN RAISE EXCEPTION 'ediel_registered_original_guide_unavailable';END IF;
 END IF;
 IF p_kind='common' THEN physical:=gridex_ediel_header_negative_birth.source_wire_v1(m);ELSE physical:=gridex_ack_authority.wire_v1(m.raw_payload);END IF;
 IF r IS NULL OR physical IS NULL OR r->>'family' IS DISTINCT FROM physical->>'family' OR nullif(v,'') IS NULL THEN RAISE EXCEPTION 'ediel_registered_original_guide_unavailable';END IF;
 SELECT count(*) INTO n FROM jsonb_array_elements(p_projection->'registeredGuideScopes')s WHERE s->>'family'=r->>'family' AND s->>'guideVersion'=r->>'guide_version' AND s->>'guideRevision'=r->>'guide_revision';
 IF n<>1 THEN RAISE EXCEPTION 'ediel_registered_original_guide_unavailable';END IF;
END $assigned_birth_body$;
 before_definition:=pg_get_functiondef(target_oid);
 IF (length(before_definition)-length(replace(before_definition,old_body,'')))/length(old_body)<>1 THEN RAISE EXCEPTION 'assigned_prodat_negative_unique_body_required';END IF;
 after_definition:=replace(before_definition,old_body,new_body);EXECUTE after_definition;
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE pg_proc.oid=target_oid) IS DISTINCT FROM 'f4accf3447e1cacda8b6482273acf55b242e238117018219901ace16e6fcd9e8' THEN RAISE EXCEPTION 'assigned_prodat_negative_postimage_mismatch';END IF;
END $assigned_birth_upgrade$;
DO $assigned_birth_upgrade$
DECLARE target_oid oid;before_definition text;after_definition text;old_body text;new_body text;
BEGIN
 target_oid:='gridex_ediel_ack_replay.require_common_guide_v2(public.ediel_messages,jsonb)'::regprocedure;
 SELECT prosrc INTO old_body FROM pg_proc WHERE pg_proc.oid=target_oid;
 IF encode(sha256(convert_to(old_body,'UTF8')),'hex') IS DISTINCT FROM '62760d411bb7b354aba8be0b9fb59542d3149778c69bb0c72f3a809d9711285c' THEN RAISE EXCEPTION 'assigned_prodat_negative_unknown_preimage:gridex_ediel_ack_replay.require_common_guide_v2';END IF;
 new_body:=$assigned_birth_body$DECLARE s public.ediel_messages%rowtype;b gridex_ediel_ack_guide.source_bindings%rowtype;e gridex_ediel_ack_guide.editions%rowtype;BEGIN
 SELECT * INTO s FROM public.ediel_messages WHERE id=m.related_message_id AND (company_id=m.company_id OR company_id IS NULL) AND environment=m.environment AND direction='inbound' FOR SHARE;
 SELECT * INTO b FROM gridex_ediel_ack_guide.source_bindings WHERE source_message_id=s.id AND kind='common' FOR SHARE;
 IF s.id IS NULL OR b.source_message_id IS NULL OR b.company_id IS DISTINCT FROM m.company_id OR b.environment IS DISTINCT FROM m.environment
  OR b.payload_sha256 IS DISTINCT FROM encode(sha256(convert_to(s.raw_payload,'UTF8')),'hex') OR b.original_basis IS DISTINCT FROM basis THEN RAISE EXCEPTION 'ediel_ack_guide_original_basis_changed';END IF;
 SELECT * INTO STRICT e FROM gridex_ediel_ack_guide.editions WHERE source_version=b.source_version;
 IF basis->>'assignedNegativeBirthReceiptId' IS NOT NULL THEN
  IF gridex_ediel_ack_replay.require_common_own_v2(m) IS DISTINCT FROM basis THEN RAISE EXCEPTION 'ediel_ack_guide_original_basis_changed';END IF;
  PERFORM gridex_ediel_header_negative_birth.assert_ack_v1(m,basis);RETURN;
 END IF;
 IF NOT coalesce(gridex_ediel_ack_guide.validate_v1(m.raw_payload,s.raw_payload,e.projection),false) THEN RAISE EXCEPTION 'ediel_native_ack_guide_invalid';END IF;
END $assigned_birth_body$;
 before_definition:=pg_get_functiondef(target_oid);
 IF (length(before_definition)-length(replace(before_definition,old_body,'')))/length(old_body)<>1 THEN RAISE EXCEPTION 'assigned_prodat_negative_unique_body_required';END IF;
 after_definition:=replace(before_definition,old_body,new_body);EXECUTE after_definition;
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE pg_proc.oid=target_oid) IS DISTINCT FROM 'f1d41fab30a94537a7b27343a064c3dc18bfa136a7fd45bdf6048f82486d46aa' THEN RAISE EXCEPTION 'assigned_prodat_negative_postimage_mismatch';END IF;
END $assigned_birth_upgrade$;
DO $assigned_birth_upgrade$
DECLARE target_oid oid;before_definition text;after_definition text;old_body text;new_body text;
BEGIN
 target_oid:='gridex_ediel_ack_replay.require_readonly_prodat_ledger_v2(public.ediel_messages)'::regprocedure;
 SELECT prosrc INTO old_body FROM pg_proc WHERE pg_proc.oid=target_oid;
 IF encode(sha256(convert_to(old_body,'UTF8')),'hex') IS DISTINCT FROM '9da31cffc2d663353698995e1769e3c87ab0167f2f9cb990bad95f188bebcc9f' THEN RAISE EXCEPTION 'assigned_prodat_negative_unknown_preimage:gridex_ediel_ack_replay.require_readonly_prodat_ledger_v2';END IF;
 new_body:=$assigned_birth_body$
DECLARE source public.ediel_messages%rowtype;scopes jsonb;a jsonb;scope jsonb;n bigint;BEGIN
 a:=gridex_ack_authority.wire_v1(m.raw_payload);
 IF m.message_family IS DISTINCT FROM 'APERAK' OR a#>>'{type,2}' IS DISTINCT FROM '96A' OR a#>>'{type,4}' IS DISTINCT FROM 'E2SE6A' THEN RETURN;END IF;
 SELECT * INTO source FROM public.ediel_messages WHERE id=m.related_message_id AND direction='inbound' AND environment=m.environment AND (company_id=m.company_id OR company_id IS NULL) FOR SHARE;
 IF source.id IS NULL OR nullif(source.raw_payload,'') IS NULL THEN RAISE EXCEPTION 'ediel_ack_replay_actual_source_unavailable';END IF;
 scopes:=gridex_ediel_header_negative_birth.scopes_v1(m.raw_payload,source);
 SELECT count(*) INTO n FROM gridex_ediel_ack_guide.outbound_prodat_scopes WHERE ack_message_id=m.id;
 -- Older already consumed native originals are qualified from their protected
 -- source/witness/raw guide, without retroactive ledger INSERT or repair.
 IF n=0 THEN RETURN;END IF;
 IF n<>jsonb_array_length(scopes) THEN RAISE EXCEPTION 'ediel_prodat_ack_scope_original_changed';END IF;
 FOR scope IN SELECT x FROM jsonb_array_elements(scopes)x LOOP
  IF NOT EXISTS(SELECT FROM gridex_ediel_ack_guide.outbound_prodat_scopes r WHERE r.ack_message_id=m.id AND r.company_id=m.company_id AND r.environment=m.environment AND r.source_message_id=source.id
   AND r.source_payload_sha256=encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex') AND r.ack_payload_sha256=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
   AND r.scope_kind=scope->>'scope' AND r.scope_reference=scope->>'reference' AND r.physical_source_reference=scope->'physicalReference' AND r.outcome=scope->>'outcome') THEN RAISE EXCEPTION 'ediel_prodat_ack_scope_original_changed';END IF;
 END LOOP;
END $assigned_birth_body$;
 before_definition:=pg_get_functiondef(target_oid);
 IF (length(before_definition)-length(replace(before_definition,old_body,'')))/length(old_body)<>1 THEN RAISE EXCEPTION 'assigned_prodat_negative_unique_body_required';END IF;
 after_definition:=replace(before_definition,old_body,new_body);EXECUTE after_definition;
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE pg_proc.oid=target_oid) IS DISTINCT FROM '0689be7506e4d163895ce4904a1a52c8bb95debf53e1807ab9c33a40990d3774' THEN RAISE EXCEPTION 'assigned_prodat_negative_postimage_mismatch';END IF;
END $assigned_birth_upgrade$;

COMMIT;
