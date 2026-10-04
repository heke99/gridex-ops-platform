-- CLI-created. A correlated DSN is an immutable source observation only.
-- It never rewrites provider acceptance, grants retry or activates business.
BEGIN;
CREATE FUNCTION gridex_ediel_transport.dsn_sending_mailbox_v1(c uuid,env text,smtp_from text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b public.ediel_mailboxes%rowtype;chosen uuid;n integer:=0;
BEGIN
 FOR b IN SELECT * FROM public.ediel_mailboxes WHERE is_active AND environment=env
  AND lower(email_address)=lower(smtp_from) AND (company_id=c OR company_id IS NULL AND is_shared_platform_mailbox) ORDER BY id FOR SHARE LOOP
  chosen:=b.id;n:=n+1;
 END LOOP;
 RETURN CASE WHEN n=1 THEN chosen ELSE NULL END;
END $$;
REVOKE ALL ON FUNCTION gridex_ediel_transport.dsn_sending_mailbox_v1(uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE VIEW gridex_ediel_transport.dsn_matchable_attempts_v1 AS
 SELECT a.id,a.message_id,a.company_id,a.environment,a.binding,a.created_at,a.entered_at,
  a.observed_at,a.classification,'generic_journal'::text AS lane
 FROM gridex_ediel_transport.attempts a WHERE a.entered_at IS NOT NULL
 UNION ALL
 SELECT a.id,a.message_id,a.company_id,a.environment,a.binding,a.created_at,e.observed_at,
  result.observed_at,result.facts->>'classification','sealed_z08'::text
 FROM gridex_outbound_dispatch.attempts a
 JOIN gridex_outbound_dispatch.events e ON e.attempt_id=a.id AND e.company_id=a.company_id AND e.environment=a.environment AND e.kind='provider_call_entered'
 JOIN gridex_outbound_dispatch.witnesses w ON w.event_id=e.id AND w.company_id=e.company_id AND w.environment=e.environment
 LEFT JOIN gridex_outbound_dispatch.events result ON result.attempt_id=a.id AND result.kind='provider_result';
REVOKE ALL ON gridex_ediel_transport.dsn_matchable_attempts_v1 FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE gridex_ediel_transport.dsn_observations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 inbound_email_message_id uuid NOT NULL REFERENCES public.inbound_email_messages(id) ON DELETE RESTRICT,
 company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
 environment text NOT NULL CHECK(environment IN('test','production')),
 mailbox_id uuid NOT NULL REFERENCES public.ediel_mailboxes(id) ON DELETE RESTRICT,
 message_id uuid NOT NULL REFERENCES public.ediel_messages(id) ON DELETE RESTRICT,
 attempt_id uuid NOT NULL,lane text NOT NULL CHECK(lane IN('generic_journal','sealed_z08')),
 source_field text NOT NULL CHECK(source_field IN('raw_email','body_text','attachment')),
 attachment_id uuid REFERENCES public.inbound_email_attachments(id) ON DELETE RESTRICT,source_sha256 text NOT NULL CHECK(source_sha256~'^[a-f0-9]{64}$'),
 report jsonb NOT NULL CHECK(report->>'transportCorrelation'='unverified'),
 report_sha256 text NOT NULL,observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 authorizes_resend boolean NOT NULL DEFAULT false CHECK(NOT authorizes_resend),
 delivery_proven boolean NOT NULL DEFAULT false CHECK(NOT delivery_proven),
 UNIQUE(inbound_email_message_id,source_field,source_sha256,attempt_id,lane)
);
ALTER TABLE gridex_ediel_transport.dsn_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_ediel_transport.dsn_observations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_ediel_transport.dsn_observations FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON gridex_ediel_transport.dsn_observations FOR EACH ROW EXECUTE FUNCTION gridex_outbound_dispatch.immutable_v1();
CREATE TRIGGER no_truncate BEFORE TRUNCATE ON gridex_ediel_transport.dsn_observations FOR EACH STATEMENT EXECUTE FUNCTION gridex_outbound_dispatch.immutable_v1();

CREATE FUNCTION gridex_ediel_transport.freeze_dsn_mail_source_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT FROM gridex_ediel_transport.dsn_observations o WHERE o.inbound_email_message_id=OLD.id
  AND (NEW.company_id IS DISTINCT FROM OLD.company_id
   OR to_jsonb(NEW)->>'ediel_mailbox_id' IS DISTINCT FROM to_jsonb(OLD)->>'ediel_mailbox_id'
   OR to_jsonb(NEW)->>'mailbox_id' IS DISTINCT FROM to_jsonb(OLD)->>'mailbox_id'
   OR to_jsonb(NEW)->>'environment' IS DISTINCT FROM to_jsonb(OLD)->>'environment'
   OR o.source_field='raw_email' AND to_jsonb(NEW)->>'raw_email' IS DISTINCT FROM to_jsonb(OLD)->>'raw_email'
   OR o.source_field='body_text' AND to_jsonb(NEW)->>'body_text' IS DISTINCT FROM to_jsonb(OLD)->>'body_text')) THEN RAISE EXCEPTION 'ediel_dsn_observation_source_immutable';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ediel_dsn_source_immutable BEFORE UPDATE ON public.inbound_email_messages FOR EACH ROW EXECUTE FUNCTION gridex_ediel_transport.freeze_dsn_mail_source_v1();
CREATE FUNCTION gridex_ediel_transport.freeze_dsn_attachment_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT FROM gridex_ediel_transport.dsn_observations o WHERE o.attachment_id=OLD.id)
  AND (TG_OP='DELETE' OR NEW.raw_text IS DISTINCT FROM OLD.raw_text OR NEW.inbound_email_message_id IS DISTINCT FROM OLD.inbound_email_message_id)
 THEN RAISE EXCEPTION 'ediel_dsn_observation_source_immutable';END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER ediel_dsn_source_immutable BEFORE UPDATE OR DELETE ON public.inbound_email_attachments FOR EACH ROW EXECUTE FUNCTION gridex_ediel_transport.freeze_dsn_attachment_v1();
REVOKE ALL ON FUNCTION gridex_ediel_transport.freeze_dsn_mail_source_v1(),gridex_ediel_transport.freeze_dsn_attachment_v1() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION gridex_ediel_transport.dsn_candidates_v1(p_company_id uuid,p_environment text,p_rfc_message_id text,p_final_recipient text,p_mailbox_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_company_id IS NULL OR p_environment NOT IN('test','production') OR p_environment IS NULL OR nullif(btrim(p_rfc_message_id),'') IS NULL OR nullif(btrim(p_final_recipient),'') IS NULL OR p_mailbox_id IS NULL THEN RAISE EXCEPTION 'ediel_dsn_scope_required';END IF;
 IF NOT EXISTS(SELECT FROM public.ediel_mailboxes b WHERE b.id=p_mailbox_id AND b.environment=p_environment AND b.is_active AND (b.company_id=p_company_id OR b.company_id IS NULL AND b.is_shared_platform_mailbox)) THEN RAISE EXCEPTION 'ediel_dsn_mailbox_scope_invalid';END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('attemptId',a.id,'messageId',a.message_id,'environment',a.environment,'enteredAt',a.entered_at,'observedAt',a.observed_at,'smtpClassification',a.classification,'lane',a.lane,'correlationStatus','unverified') ORDER BY a.created_at,a.id,a.lane)
  FROM gridex_ediel_transport.dsn_matchable_attempts_v1 a WHERE a.company_id=p_company_id AND a.environment=p_environment
   AND a.binding->>'sourceMailboxId'=p_mailbox_id::text
   AND a.binding->>'rfcMessageId'=p_rfc_message_id AND lower(a.binding->>'to')=lower(p_final_recipient)),'[]'::jsonb);
END $$;

CREATE FUNCTION gridex_ediel_transport.record_dsn_v1(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c uuid:=(p_input->>'companyId')::uuid;actor uuid:=(p_input->>'actorUserId')::uuid;mailid uuid:=(p_input->>'inboundEmailMessageId')::uuid;
 mail public.inbound_email_messages%rowtype;mb public.ediel_mailboxes%rowtype;body text;field text:=p_input->>'sourceField';attachment uuid:=(p_input->>'attachmentId')::uuid;
 report jsonb:=p_input->'report';recipient jsonb;sourcehash text;candidate jsonb;candidates jsonb;obs gridex_ediel_transport.dsn_observations%rowtype;
BEGIN
 PERFORM 1 FROM public.user_profiles u WHERE u.id=actor FOR SHARE;
 PERFORM 1 FROM public.company_memberships m WHERE m.company_id=c AND m.user_id=actor FOR SHARE;
 IF c IS NULL OR actor IS NULL OR mailid IS NULL OR field IS NULL OR field NOT IN('raw_email','body_text','attachment')
  OR NOT EXISTS(SELECT FROM public.company_memberships m WHERE m.company_id=c AND m.user_id=actor AND m.status='active' AND m.is_active AND m.accepted_at IS NOT NULL)
  OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=actor AND u.user_status='active') OR NOT coalesce(public.gridex_actor_has_company_permission(actor,c,'communication.read'),false) THEN RAISE EXCEPTION 'ediel_dsn_actor_scope_invalid' USING ERRCODE='42501';END IF;
 SELECT * INTO mail FROM public.inbound_email_messages WHERE id=mailid AND company_id=c FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ediel_dsn_mail_scope_invalid';END IF;
 SELECT * INTO mb FROM public.ediel_mailboxes WHERE id=coalesce(nullif(to_jsonb(mail)->>'ediel_mailbox_id','')::uuid,nullif(to_jsonb(mail)->>'mailbox_id','')::uuid) FOR SHARE;
 IF NOT FOUND OR NOT mb.is_active OR mb.environment NOT IN('test','production') OR mb.company_id IS DISTINCT FROM c AND NOT(mb.company_id IS NULL AND mb.is_shared_platform_mailbox)
  OR to_jsonb(mail)->>'environment' IS NOT NULL AND to_jsonb(mail)->>'environment' IS DISTINCT FROM mb.environment THEN RAISE EXCEPTION 'ediel_dsn_mailbox_scope_invalid';END IF;
 IF field='attachment' THEN
  SELECT a.raw_text INTO body FROM public.inbound_email_attachments a WHERE a.id=attachment AND a.inbound_email_message_id=mailid FOR SHARE;
 ELSE
  IF attachment IS NOT NULL THEN RAISE EXCEPTION 'ediel_dsn_source_invalid';END IF;
  body:=to_jsonb(mail)->>field;
 END IF;
 sourcehash:=encode(sha256(convert_to(body,'UTF8')),'hex');
 IF body IS NULL OR octet_length(body)>26214400 OR sourcehash IS DISTINCT FROM p_input->>'sourceHash' OR jsonb_typeof(report) IS DISTINCT FROM 'object' OR octet_length(report::text)>262144
  OR report->>'version' IS DISTINCT FROM '1' OR report->>'transportCorrelation' IS DISTINCT FROM 'unverified' OR report->'issues' IS DISTINCT FROM '[]'::jsonb
  OR jsonb_typeof(report->'originalMessageIds') IS DISTINCT FROM 'array' OR jsonb_array_length(report->'originalMessageIds')<>1
  OR jsonb_typeof(report->'recipients') IS DISTINCT FROM 'array' OR jsonb_array_length(report->'recipients')<>1 THEN RAISE EXCEPTION 'ediel_dsn_source_invalid';END IF;
 recipient:=report->'recipients'->0;
 IF recipient->>'action' IS NULL OR recipient->>'action' NOT IN('failed','delayed','delivered','relayed','expanded') OR coalesce(recipient->>'status','')!~'^[245]\.[0-9]{1,3}\.[0-9]{1,3}$'
  OR left(recipient->>'status',1) IS DISTINCT FROM (CASE recipient->>'action' WHEN 'failed' THEN '5' WHEN 'delayed' THEN '4' ELSE '2' END)
  OR recipient#>>'{finalRecipient,type}' IS NULL OR recipient#>>'{finalRecipient,type}' NOT IN('rfc822','utf-8')
  OR coalesce(recipient#>>'{finalRecipient,address}','')!~'^[^[:space:]<>@]+@[^[:space:]<>@]+$'
  OR body!~* 'message/(global-)?delivery-status' OR strpos(body,report#>>'{originalMessageIds,0}')=0
  OR strpos(lower(body),lower(recipient#>>'{finalRecipient,address}'))=0 THEN RAISE EXCEPTION 'ediel_dsn_source_invalid';END IF;
 candidates:=gridex_ediel_transport.dsn_candidates_v1(c,mb.environment,report#>>'{originalMessageIds,0}',recipient#>>'{finalRecipient,address}',mb.id);
 IF jsonb_array_length(candidates)<>1 THEN RAISE EXCEPTION 'ediel_dsn_attempt_ambiguous_or_missing';END IF;
 candidate:=candidates->0;
 SELECT * INTO obs FROM gridex_ediel_transport.dsn_observations WHERE inbound_email_message_id=mailid AND source_field=field AND source_sha256=sourcehash AND attempt_id=(candidate->>'attemptId')::uuid AND lane=candidate->>'lane';
 IF FOUND THEN
  IF obs.company_id IS DISTINCT FROM c OR obs.environment IS DISTINCT FROM mb.environment OR obs.attachment_id IS DISTINCT FROM attachment OR obs.report IS DISTINCT FROM report THEN RAISE EXCEPTION 'ediel_dsn_observation_immutable';END IF;
 ELSE
  IF EXISTS(SELECT FROM gridex_ediel_transport.dsn_observations o WHERE o.inbound_email_message_id=mailid AND o.source_field=field AND o.attachment_id IS NOT DISTINCT FROM attachment AND o.source_sha256<>sourcehash) THEN RAISE EXCEPTION 'ediel_dsn_observation_source_changed';END IF;
  INSERT INTO gridex_ediel_transport.dsn_observations(inbound_email_message_id,company_id,environment,mailbox_id,message_id,attempt_id,lane,source_field,attachment_id,source_sha256,report,report_sha256)
   VALUES(mailid,c,mb.environment,mb.id,(candidate->>'messageId')::uuid,(candidate->>'attemptId')::uuid,candidate->>'lane',field,attachment,sourcehash,report,encode(sha256(convert_to(report::text,'UTF8')),'hex')) RETURNING * INTO obs;
 END IF;
 RETURN jsonb_build_object('version',1,'observationId',obs.id,'attemptId',obs.attempt_id,'messageId',obs.message_id,'sourceHash',obs.source_sha256,'observedAt',obs.observed_at,'transportCorrelation','source_matched_unverified','authorizesResend',false,'deliveryProven',false);
END $$;

CREATE FUNCTION gridex_ediel_transport.read_dsn_v1(p_company_id uuid,p_actor_user_id uuid,p_message_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM 1 FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 PERFORM 1 FROM public.company_memberships m WHERE m.company_id=p_company_id AND m.user_id=p_actor_user_id FOR SHARE;
 IF NOT EXISTS(SELECT FROM public.company_memberships m WHERE m.company_id=p_company_id AND m.user_id=p_actor_user_id AND m.status='active' AND m.is_active AND m.accepted_at IS NOT NULL)
  OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active') OR NOT coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.read'),false)
  OR NOT EXISTS(SELECT FROM public.ediel_messages m WHERE m.id=p_message_id AND m.company_id=p_company_id AND m.direction='outbound') THEN RAISE EXCEPTION 'ediel_dsn_actor_scope_invalid' USING ERRCODE='42501';END IF;
 IF (SELECT count(*) FROM gridex_ediel_transport.dsn_observations WHERE company_id=p_company_id AND message_id=p_message_id)>256 THEN RAISE EXCEPTION 'ediel_dsn_observation_read_limit';END IF;
 RETURN jsonb_build_object('version',1,'companyId',p_company_id,'messageId',p_message_id,'authorizesResend',false,'deliveryProven',false,'observations',coalesce((SELECT jsonb_agg(jsonb_build_object('observationId',o.id,'attemptId',o.attempt_id,'observedAt',o.observed_at,'transportCorrelation','source_matched_unverified','recipient',o.report#>'{recipients,0}') ORDER BY o.observed_at,o.id) FROM gridex_ediel_transport.dsn_observations o WHERE o.company_id=p_company_id AND o.message_id=p_message_id),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION gridex_ediel_transport.record_dsn_v1(jsonb),gridex_ediel_transport.read_dsn_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_ediel_transport.record_dsn_v1(jsonb),gridex_ediel_transport.read_dsn_v1(uuid,uuid,uuid) TO service_role;
CREATE FUNCTION public.ediel_record_dsn_source_observation_v1(p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN IF current_user<>'service_role' THEN RAISE EXCEPTION 'ediel_dsn_service_required' USING ERRCODE='42501';END IF;RETURN gridex_ediel_transport.record_dsn_v1(p_input);END $$;
CREATE FUNCTION public.ediel_read_dsn_source_observations_v1(p_company_id uuid,p_actor_user_id uuid,p_message_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN IF current_user<>'service_role' THEN RAISE EXCEPTION 'ediel_dsn_service_required' USING ERRCODE='42501';END IF;RETURN gridex_ediel_transport.read_dsn_v1(p_company_id,p_actor_user_id,p_message_id);END $$;
REVOKE ALL ON FUNCTION public.ediel_record_dsn_source_observation_v1(jsonb),public.ediel_read_dsn_source_observations_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_record_dsn_source_observation_v1(jsonb),public.ediel_read_dsn_source_observations_v1(uuid,uuid,uuid) TO service_role;
COMMIT;
