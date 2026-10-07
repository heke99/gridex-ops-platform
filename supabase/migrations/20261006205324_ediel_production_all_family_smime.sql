-- TR-09 (owner decision 2026-10-04): S/MIME is required for every outbound
-- message family in production. Plaintext is admitted only through the
-- journaled, bounded transport exception (fail closed). Forward-only: replaces
-- the PRODAT/EDIFACT-only check in gridex_transport_exception.stage_v1 from
-- 20261001000609; no data, grant, ownership or signature change.
BEGIN;
CREATE OR REPLACE FUNCTION gridex_transport_exception.stage_v1(i jsonb,r jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE action text:=i->>'action';c uuid:=(i->>'companyId')::uuid;mid uuid:=(i->>'messageId')::uuid;actor uuid:=(i->>'actorUserId')::uuid;
 attempt uuid:=(i->>'attemptId')::uuid;b jsonb:=i#>'{binding,transportException}';a jsonb;o gridex_transport_exception.operations%rowtype;m public.ediel_messages%rowtype;limit_attempts integer;event_kind text;
BEGIN
 IF action='prepare' AND r->>'proceed'='true' THEN
  SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=mid AND company_id=c FOR SHARE;
  IF b IS NULL OR b='null'::jsonb THEN
   IF m.direction='outbound' AND m.environment='production'
    AND i#>>'{binding,mimeMode}' IS DISTINCT FROM 'ediel-smime-enveloped' THEN RAISE EXCEPTION 'transport_exception_actual_approved_plaintext_source_required';END IF;
   RETURN;
  END IF;
  a:=gridex_transport_exception.read_v1(c,mid,actor,(b->>'approvalId')::uuid);
  IF a->>'status' IS DISTINCT FROM 'authorized' OR b IS DISTINCT FROM (a-ARRAY['status','version','companyId','environment','messageId','actorUserId','routeId','senderEdielId','receiverEdielId','receiverEmail','validFrom','validTo'])
   OR ((a->>'case'='crl_refresh_failure') IS DISTINCT FROM (i#>>'{binding,mimeMode}'='ediel-smime-enveloped'))
   THEN RAISE EXCEPTION 'transport_exception_fresh_exact_attempt_binding_required';END IF;
  SELECT * INTO o FROM gridex_transport_exception.operations WHERE attempt_id=attempt FOR SHARE;
  IF FOUND THEN
   IF o.company_id IS DISTINCT FROM c OR o.message_id IS DISTINCT FROM mid OR o.actor_user_id IS DISTINCT FROM actor OR o.environment IS DISTINCT FROM m.environment OR o.binding IS DISTINCT FROM b
    THEN RAISE EXCEPTION 'transport_exception_attempt_scope_changed';END IF;RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended((a->>'approvalId')||'|transport_exception_budget',0));
  SELECT maximum_attempts INTO STRICT limit_attempts FROM gridex_transport_exception.approvals WHERE id=(a->>'approvalId')::uuid FOR SHARE;
  IF (SELECT count(*) FROM gridex_transport_exception.operations WHERE approval_id=(a->>'approvalId')::uuid)>=limit_attempts THEN RAISE EXCEPTION 'transport_exception_bounded_attempt_budget_exhausted';END IF;
  INSERT INTO gridex_transport_exception.operations VALUES(attempt,(a->>'approvalId')::uuid,c,mid,m.environment,actor,b,clock_timestamp());
  INSERT INTO gridex_transport_exception.events(attempt_id,company_id,message_id,kind,facts) VALUES(attempt,c,mid,'prepared',r);
  INSERT INTO gridex_transport_exception.alarms(attempt_id,company_id,message_id,responsible_user_id,facts)
   SELECT attempt,c,mid,approved_by,jsonb_build_object('case',a->>'case','sourceDigest',a->>'sourceDigest','approvalDigest',a->>'approvalDigest','tlsEvidenceDigest',a->>'tlsEvidenceDigest','mandatoryTls',true,'validTo',a->>'validTo','administratorAlarm',true)
   FROM gridex_transport_exception.approvals WHERE id=(a->>'approvalId')::uuid;
 ELSIF action IN('enter','observe','result','release') THEN
  SELECT * INTO o FROM gridex_transport_exception.operations WHERE attempt_id=attempt FOR SHARE;IF NOT FOUND THEN RETURN;END IF;
  IF o.company_id IS DISTINCT FROM c OR o.message_id IS DISTINCT FROM mid OR o.actor_user_id IS DISTINCT FROM actor OR o.environment IS DISTINCT FROM i->>'environment' THEN RAISE EXCEPTION 'transport_exception_attempt_scope_changed';END IF;
  IF action='enter' AND r->>'proceed'='true' THEN
   a:=gridex_transport_exception.read_v1(c,mid,actor,o.approval_id);
   IF a->>'status' IS DISTINCT FROM 'authorized' OR o.binding IS DISTINCT FROM (a-ARRAY['status','version','companyId','environment','messageId','actorUserId','routeId','senderEdielId','receiverEdielId','receiverEmail','validFrom','validTo']) THEN RAISE EXCEPTION 'transport_exception_fresh_entry_authority_required';END IF;event_kind:='entered';
  ELSIF action IN('observe','result') AND EXISTS(SELECT FROM gridex_transport_exception.events WHERE attempt_id=attempt AND kind='entered') THEN event_kind:='observed';
  ELSIF action='release' THEN event_kind:='released';ELSE RETURN;END IF;
  INSERT INTO gridex_transport_exception.events(attempt_id,company_id,message_id,kind,facts) VALUES(attempt,c,mid,event_kind,r) ON CONFLICT(attempt_id,kind) DO NOTHING;
 END IF;
END$$;
COMMIT;
