BEGIN;
-- ACK09: a real new transport reception is distinct from replay of a saved
-- original. This observation grants no business, actor or duplicate-ACK truth.
CREATE SCHEMA gridex_ediel_inbound_receptions;
REVOKE ALL ON SCHEMA gridex_ediel_inbound_receptions FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE gridex_ediel_inbound_receptions.receptions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),
 source_message_id uuid NOT NULL REFERENCES public.ediel_messages(id),
 inbound_email_message_id uuid NOT NULL UNIQUE REFERENCES public.inbound_email_messages(id),
 parse_result_id uuid NOT NULL REFERENCES public.inbound_ediel_parse_results(id),
 actor_user_id uuid NOT NULL REFERENCES auth.users(id),environment text NOT NULL CHECK(environment IN('test','production')),
 canonical_payload_hash text NOT NULL,received_payload_hash text NOT NULL,received_at timestamptz NOT NULL,
 classification text NOT NULL CHECK(classification IN('first_reception','protocol_duplicate','identity_conflict')),
 scope jsonb NOT NULL,transport_source_snapshot jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE INDEX receptions_source_message ON gridex_ediel_inbound_receptions.receptions(source_message_id);
CREATE UNIQUE INDEX one_first_reception_per_original ON gridex_ediel_inbound_receptions.receptions(source_message_id) WHERE classification='first_reception';
CREATE TABLE gridex_ediel_inbound_receptions.response_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),reception_id uuid NOT NULL UNIQUE REFERENCES gridex_ediel_inbound_receptions.receptions(id),
 company_id uuid NOT NULL REFERENCES public.companies(id),source_message_id uuid NOT NULL REFERENCES public.ediel_messages(id),
 reason text NOT NULL CHECK(reason IN('authentic_duplicate_transport_response_policy_required','same_identity_different_original_requires_review')),
 status text NOT NULL DEFAULT 'held' CHECK(status='held'),recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
DO $$DECLARE name text;BEGIN FOR name IN SELECT unnest(ARRAY['receptions','response_requests']) LOOP
 EXECUTE format('ALTER TABLE gridex_ediel_inbound_receptions.%I ENABLE ROW LEVEL SECURITY',name);
 EXECUTE format('ALTER TABLE gridex_ediel_inbound_receptions.%I FORCE ROW LEVEL SECURITY',name);
 EXECUTE format('REVOKE ALL ON gridex_ediel_inbound_receptions.%I FROM PUBLIC,anon,authenticated,service_role',name);
 EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON gridex_ediel_inbound_receptions.%I FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1()',name);
 EXECUTE format('CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_ediel_inbound_receptions.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1()',name);
END LOOP;END $$;
CREATE FUNCTION gridex_ediel_inbound_receptions.authorize_v1(c uuid,actor uuid,permission text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 PERFORM u.id FROM public.user_profiles u WHERE u.id=actor FOR SHARE;
 PERFORM x.user_id FROM public.company_memberships x WHERE x.company_id=c AND x.user_id=actor FOR SHARE;
 IF c IS NULL OR actor IS NULL OR permission IS NULL OR permission NOT IN('communication.write','communication.read')
  OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=actor AND u.user_status='active')
  OR NOT EXISTS(SELECT FROM public.company_memberships x WHERE x.company_id=c AND x.user_id=actor AND x.status='active' AND x.is_active AND x.accepted_at IS NOT NULL)
  OR (CASE permission WHEN 'communication.read' THEN coalesce(public.gridex_actor_has_company_permission(actor,c,'communication.read'),false) OR coalesce(public.gridex_actor_has_company_permission(actor,c,'communication.write'),false)
   ELSE coalesce(public.gridex_actor_has_company_permission(actor,c,'communication.write'),false) END) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_reception_actor_forbidden' USING ERRCODE='42501';END IF;
END $$;
CREATE FUNCTION gridex_ediel_inbound_receptions.guard_original_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF EXISTS(SELECT FROM gridex_ediel_inbound_receptions.receptions r WHERE r.source_message_id=OLD.id)
  AND (TG_OP='DELETE' OR
   (NEW.company_id,NEW.environment,NEW.direction,NEW.message_standard,NEW.message_family,NEW.message_code,NEW.raw_payload,NEW.sender_ediel_id,NEW.receiver_ediel_id,NEW.application_reference,NEW.interchange_reference,NEW.message_received_at,NEW.inbound_email_message_id,NEW.mailbox_message_id)
   IS DISTINCT FROM
   (OLD.company_id,OLD.environment,OLD.direction,OLD.message_standard,OLD.message_family,OLD.message_code,OLD.raw_payload,OLD.sender_ediel_id,OLD.receiver_ediel_id,OLD.application_reference,OLD.interchange_reference,OLD.message_received_at,OLD.inbound_email_message_id,OLD.mailbox_message_id))
 THEN RAISE EXCEPTION 'ediel_registered_reception_original_immutable';END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER registered_reception_original_immutable BEFORE UPDATE OR DELETE ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_ediel_inbound_receptions.guard_original_v1();
CREATE FUNCTION gridex_ediel_inbound_receptions.result_v1(r gridex_ediel_inbound_receptions.receptions,replay boolean) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$SELECT jsonb_build_object('companyId',r.company_id,'sourceMessageId',r.source_message_id,'inboundEmailMessageId',r.inbound_email_message_id,'parseResultId',r.parse_result_id,'receptionId',r.id,'classification',r.classification,'isReplay',replay,'receivedAt',r.received_at,'canonicalPayloadHash',r.canonical_payload_hash,'receivedPayloadHash',r.received_payload_hash,'responseRequestId',q.id,'status',CASE WHEN q.id IS NULL THEN 'observed' ELSE 'held' END,'reason',q.reason,'businessEffectAuthorized',false) FROM (SELECT 1) single LEFT JOIN gridex_ediel_inbound_receptions.response_requests q ON q.reception_id=r.id$$;
CREATE FUNCTION public.ediel_record_inbound_reception_v1(p_company_id uuid,p_message_id uuid,p_actor_user_id uuid,p_inbound_email_message_id uuid,p_parse_result_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;mail public.inbound_email_messages%rowtype;p public.inbound_ediel_parse_results%rowtype;
 box public.ediel_mailboxes%rowtype;prior gridex_ediel_inbound_receptions.receptions%rowtype;r gridex_ediel_inbound_receptions.receptions%rowtype;canonical_hash text;incoming_hash text;kind text;
BEGIN
 PERFORM gridex_ediel_inbound_receptions.authorize_v1(p_company_id,p_actor_user_id,'communication.write');
 IF p_message_id IS NULL OR p_inbound_email_message_id IS NULL OR p_parse_result_id IS NULL THEN RAISE EXCEPTION 'ediel_real_reception_source_required';END IF;
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id FOR UPDATE;
 IF m.id IS NULL OR m.direction IS DISTINCT FROM 'inbound' OR m.message_standard IS DISTINCT FROM 'edifact' OR (m.environment IN('test','production')) IS NOT TRUE OR nullif(m.raw_payload,'') IS NULL THEN RAISE EXCEPTION 'ediel_reception_original_not_owned';END IF;
 -- Serialize the exact retained receipt before its possible held projection;
 -- two different canonical selectors must not both upgrade a shared mail lock.
 SELECT * INTO mail FROM public.inbound_email_messages WHERE id=p_inbound_email_message_id FOR UPDATE;
 SELECT * INTO p FROM public.inbound_ediel_parse_results WHERE id=p_parse_result_id FOR SHARE;
 SELECT * INTO box FROM public.ediel_mailboxes WHERE id=mail.mailbox_id FOR SHARE;
 IF mail.id IS NULL OR p.id IS NULL OR p.inbound_email_message_id IS DISTINCT FROM mail.id OR p.company_id IS DISTINCT FROM p_company_id
  OR (mail.company_id IS NOT NULL AND mail.company_id IS DISTINCT FROM p_company_id)
  OR (mail.environment IS NOT NULL AND mail.environment IS DISTINCT FROM m.environment)
  OR box.id IS NULL OR box.environment IS DISTINCT FROM m.environment
  OR (box.company_id IS NOT NULL AND box.company_id IS DISTINCT FROM p_company_id AND box.is_shared_platform_mailbox IS NOT TRUE)
  OR mail.received_at IS NULL OR nullif(p.raw_payload,'') IS NULL
  OR p.sender_ediel_id IS DISTINCT FROM m.sender_ediel_id OR p.receiver_ediel_id IS DISTINCT FROM m.receiver_ediel_id
  OR p.application_reference IS DISTINCT FROM m.application_reference OR p.interchange_reference IS DISTINCT FROM m.interchange_reference
  OR p.message_family IS DISTINCT FROM m.message_family OR p.message_code IS DISTINCT FROM m.message_code
 THEN RAISE EXCEPTION 'ediel_real_reception_source_scope_required';END IF;
 PERFORM a.id FROM public.inbound_email_attachments a WHERE a.inbound_email_message_id=mail.id ORDER BY a.id FOR SHARE;
 -- The parse must come from the retained actual transport source. An editable
 -- parse projection alone cannot manufacture a new mailbox reception.
 IF NOT(coalesce(position(p.raw_payload IN mail.raw_edifact_payload),0)>0 OR coalesce(position(p.raw_payload IN mail.body_text),0)>0
  OR coalesce(position(p.raw_payload IN mail.raw_email),0)>0 OR EXISTS(SELECT FROM public.inbound_email_attachments a WHERE a.inbound_email_message_id=mail.id AND (a.company_id IS NULL OR a.company_id=p_company_id) AND coalesce(position(p.raw_payload IN a.raw_text),0)>0)) THEN RAISE EXCEPTION 'ediel_reception_retained_transport_bytes_required';END IF;
 canonical_hash:=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex');incoming_hash:=encode(sha256(convert_to(p.raw_payload,'UTF8')),'hex');
 SELECT * INTO prior FROM gridex_ediel_inbound_receptions.receptions WHERE inbound_email_message_id=mail.id FOR SHARE;
 IF prior.id IS NOT NULL THEN
  IF prior.company_id IS DISTINCT FROM p_company_id OR prior.source_message_id IS DISTINCT FROM m.id OR prior.environment IS DISTINCT FROM m.environment
   OR prior.canonical_payload_hash IS DISTINCT FROM canonical_hash OR prior.received_payload_hash IS DISTINCT FROM incoming_hash THEN RAISE EXCEPTION 'ediel_reception_frozen_source_conflict';END IF;
  RETURN gridex_ediel_inbound_receptions.result_v1(prior,true);
 END IF;
 kind:=CASE WHEN incoming_hash IS DISTINCT FROM canonical_hash THEN 'identity_conflict'
  WHEN (m.inbound_email_message_id=mail.id OR m.mailbox_message_id=mail.id::text)
   AND NOT EXISTS(SELECT FROM gridex_ediel_inbound_receptions.receptions old WHERE old.source_message_id=m.id AND old.classification='first_reception') THEN 'first_reception'
  ELSE 'protocol_duplicate' END;
 INSERT INTO gridex_ediel_inbound_receptions.receptions(company_id,source_message_id,inbound_email_message_id,parse_result_id,actor_user_id,environment,canonical_payload_hash,received_payload_hash,received_at,classification,scope,transport_source_snapshot)
 VALUES(p_company_id,m.id,mail.id,p.id,p_actor_user_id,m.environment,canonical_hash,incoming_hash,mail.received_at,kind,jsonb_build_object('sender',p.sender_ediel_id,'receiver',p.receiver_ediel_id,'applicationReference',p.application_reference,'interchangeReference',p.interchange_reference,'family',p.message_family,'code',p.message_code),jsonb_build_object('mailboxId',mail.mailbox_id,'internetMessageId',mail.internet_message_id,'rawMessageSha256',mail.raw_message_sha256,'parsePayloadHash',incoming_hash,'sourceKind','retained_mail_observation','deliveryAuthenticated',false)) RETURNING * INTO r;
 IF kind<>'first_reception' THEN
  INSERT INTO gridex_ediel_inbound_receptions.response_requests(reception_id,company_id,source_message_id,reason) VALUES(r.id,p_company_id,m.id,CASE kind WHEN 'identity_conflict' THEN 'same_identity_different_original_requires_review' ELSE 'authentic_duplicate_transport_response_policy_required' END);
  UPDATE public.inbound_email_messages SET company_id=p_company_id,processing_status='manual_review',match_status='protocol_response_held',error_message='Ny Ediel-mottagning kräver källbelagt protokollsvar.',match_payload=coalesce(match_payload,'{}')||jsonb_build_object('protocolReception',gridex_ediel_inbound_receptions.result_v1(r,false)),updated_at=clock_timestamp() WHERE id=mail.id AND (company_id IS NULL OR company_id=p_company_id);
 END IF;
 RETURN gridex_ediel_inbound_receptions.result_v1(r,false);
END $$;
CREATE FUNCTION public.ediel_inbound_reception_request_v1(p_company_id uuid,p_message_id uuid,p_actor_user_id uuid,p_inbound_email_message_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE r gridex_ediel_inbound_receptions.receptions%rowtype;m public.ediel_messages%rowtype;assessment uuid;result jsonb;BEGIN
 PERFORM gridex_ediel_inbound_receptions.authorize_v1(p_company_id,p_actor_user_id,'communication.read');
 IF p_inbound_email_message_id IS NULL THEN RAISE EXCEPTION 'ediel_exact_reception_selector_required';END IF;
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id FOR SHARE;
 SELECT * INTO r FROM gridex_ediel_inbound_receptions.receptions WHERE company_id=p_company_id AND source_message_id=p_message_id AND inbound_email_message_id=p_inbound_email_message_id;
 IF r.id IS NULL THEN RETURN NULL;END IF;
 IF m.id IS NULL OR m.environment IS DISTINCT FROM r.environment OR m.direction IS DISTINCT FROM 'inbound' OR r.canonical_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'ediel_reception_original_changed';END IF;
 SELECT v.id INTO assessment FROM gridex_received_sources.validation_assessments v WHERE v.source_message_id=m.id AND v.company_id=p_company_id AND v.environment=m.environment AND v.source_payload_hash=r.canonical_payload_hash AND v.previous_assessment_id IS NULL;
 result:=gridex_ediel_inbound_receptions.result_v1(r,true);
 RETURN result||jsonb_build_object('firstValidationAssessmentId',assessment,'firstOutcomeAvailable',assessment IS NOT NULL,'duplicateResponseActivated',false);
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_ediel_inbound_receptions FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.ediel_record_inbound_reception_v1(uuid,uuid,uuid,uuid,uuid),public.ediel_inbound_reception_request_v1(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_record_inbound_reception_v1(uuid,uuid,uuid,uuid,uuid),public.ediel_inbound_reception_request_v1(uuid,uuid,uuid,uuid) TO service_role;
COMMIT;
