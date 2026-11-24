DO $gridex_c44_migration$
BEGIN
CREATE SCHEMA gridex_case_confirmation;
REVOKE ALL ON SCHEMA gridex_case_confirmation FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE gridex_case_confirmation.withdrawal_intents (
  case_id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  outbox_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','queued','skipped_missing_recipient','suppressed_retention')),
  available_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK ((state='pending')=(completed_at IS NULL)),
  FOREIGN KEY (case_id,company_id,customer_id)
    REFERENCES public.customer_cases(id,company_id,customer_id) ON DELETE CASCADE
);
ALTER TABLE gridex_case_confirmation.withdrawal_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_case_confirmation.withdrawal_intents FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX withdrawal_intents_due_idx ON gridex_case_confirmation.withdrawal_intents(available_at,case_id)
  WHERE state='pending';

CREATE FUNCTION public.gridex_list_due_withdrawal_confirmations_v1(p_company_id uuid,p_limit integer)
RETURNS TABLE(case_id uuid,company_id uuid,customer_id uuid,customer_email text,customer_name text,
 case_title text,next_action text,actor_user_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN
   RAISE EXCEPTION 'withdrawal_confirmation_service_role_required' USING ERRCODE='42501';
 END IF;
 RETURN QUERY SELECT q.case_id,q.company_id,q.customer_id,
   CASE WHEN NOT retention.suppressed THEN nullif(lower(btrim(c.email)),'') END,
   CASE WHEN NOT retention.suppressed THEN
     coalesce(nullif(c.full_name,''),nullif(concat_ws(' ',nullif(c.first_name,''),nullif(c.last_name,'')),''),c.company_name)
   END,
   CASE WHEN NOT retention.suppressed THEN work.title END,
   CASE WHEN NOT retention.suppressed THEN work.next_action END,
   work.created_by
 FROM gridex_case_confirmation.withdrawal_intents q
 JOIN public.customer_cases work ON work.id=q.case_id AND work.company_id=q.company_id AND work.customer_id=q.customer_id
 JOIN public.customers c ON c.id=q.customer_id AND c.company_id=q.company_id
 CROSS JOIN LATERAL (
   SELECT gridex_correction_process.customer_retention_tombstoned_v1(q.company_id,q.customer_id) AS suppressed
 ) retention
 WHERE q.state='pending' AND q.available_at<=now() AND (p_company_id IS NULL OR q.company_id=p_company_id)
 ORDER BY q.available_at,q.case_id
 LIMIT greatest(1,least(coalesce(p_limit,25),100));
END $$;

CREATE FUNCTION public.gridex_defer_withdrawal_confirmation_v1(p_company_id uuid,p_case_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN
   RAISE EXCEPTION 'withdrawal_confirmation_service_role_required' USING ERRCODE='42501';
 END IF;
 UPDATE gridex_case_confirmation.withdrawal_intents SET available_at=now()+interval '5 minutes'
 WHERE company_id=p_company_id AND case_id=p_case_id AND state='pending';
END $$;

CREATE FUNCTION public.gridex_publish_withdrawal_confirmation_v1(p_company_id uuid,p_case_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
 q gridex_case_confirmation.withdrawal_intents%ROWTYPE;
 recipient text;
 contract_id uuid;
 actor_id uuid;
 log_id uuid;
 mail_key text;
 state_out text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN
   RAISE EXCEPTION 'withdrawal_confirmation_service_role_required' USING ERRCODE='42501';
 END IF;
 SELECT * INTO q FROM gridex_case_confirmation.withdrawal_intents
 WHERE company_id=p_company_id AND case_id=p_case_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'withdrawal_confirmation_case_missing' USING ERRCODE='P0002'; END IF;
 IF q.state<>'pending' THEN
   RETURN jsonb_build_object('state',q.state,'outboxId',CASE WHEN q.state='queued' THEN q.outbox_id END,'existing',true);
 END IF;
 -- Follow customer -> case -> intent custody. An address edit cannot cross the
 -- final receiver comparison, and case-removal cascades keep their lock order.
 SELECT c.email INTO STRICT recipient FROM public.customers c
 WHERE c.company_id=q.company_id AND c.id=q.customer_id FOR SHARE;
 SELECT work.customer_contract_id,work.created_by INTO STRICT contract_id,actor_id
 FROM public.customer_cases work
 WHERE work.company_id=q.company_id AND work.customer_id=q.customer_id AND work.id=q.case_id
   AND work.case_type='withdrawal' AND work.source='customer_card_contract_withdrawal_v1' FOR SHARE;
 SELECT * INTO q FROM gridex_case_confirmation.withdrawal_intents
 WHERE company_id=p_company_id AND case_id=p_case_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'withdrawal_confirmation_case_missing' USING ERRCODE='P0002'; END IF;
 IF q.state<>'pending' THEN
   RETURN jsonb_build_object('state',q.state,'outboxId',CASE WHEN q.state='queued' THEN q.outbox_id END,'existing',true);
 END IF;
 -- The canonical pseudonymisation writer takes an exclusive lock on the
 -- same customer row. Re-read its durable decision after our lock, before
 -- accepting any prepared payload, including one rendered before retention.
 IF gridex_correction_process.customer_retention_tombstoned_v1(q.company_id,q.customer_id) THEN
   UPDATE gridex_case_confirmation.withdrawal_intents SET state='suppressed_retention',completed_at=now()
   WHERE case_id=q.case_id;
   RETURN jsonb_build_object('state','suppressed_retention','outboxId',NULL,'existing',false);
 END IF;
 recipient := nullif(lower(btrim(recipient)),'');
 IF recipient IS NULL AND p_payload IS NULL THEN
   state_out:='skipped_missing_recipient';
 ELSE
   IF recipient IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
      OR nullif(lower(btrim(p_payload->>'toEmail')),'') IS DISTINCT FROM recipient THEN
     RAISE EXCEPTION 'withdrawal_confirmation_recipient_changed' USING ERRCODE='23514';
   END IF;
   IF nullif(btrim(p_payload->>'from'),'') IS NULL OR nullif(btrim(p_payload->>'senderEmail'),'') IS NULL
      OR nullif(btrim(p_payload->>'subject'),'') IS NULL OR nullif(btrim(p_payload->>'html'),'') IS NULL
      OR jsonb_typeof(p_payload->'branding') IS DISTINCT FROM 'object' THEN
     RAISE EXCEPTION 'withdrawal_confirmation_payload_invalid' USING ERRCODE='22023';
   END IF;
   mail_key:='tenant-email:'||q.company_id::text||':'||q.outbox_id::text;
   INSERT INTO public.communication_logs(
     company_id,customer_id,contract_id,channel,template_key,recipient_email,sender_email,
     reply_to_email,subject,status,created_by,metadata,sender_mode,idempotency_key
   ) VALUES (
     q.company_id,q.customer_id,contract_id,'email','withdrawal_received',recipient,p_payload->>'senderEmail',
     p_payload->>'replyTo',p_payload->>'subject','queued',actor_id,
     jsonb_build_object('source','tenant_template_email','customer_case_id',q.case_id),p_payload->>'senderMode',mail_key
   ) RETURNING id INTO log_id;
   INSERT INTO public.tenant_email_outbox(
     id,company_id,customer_id,customer_case_id,communication_log_id,email_type,to_email,
     from_email,reply_to_email,subject,html_body,text_body,status,attempts,max_attempts,next_attempt_at,
     branding_snapshot,redirect_url,provider_idempotency_key,created_by
   ) VALUES (
     q.outbox_id,q.company_id,q.customer_id,q.case_id,log_id,'withdrawal_received',recipient,
     p_payload->>'from',p_payload->>'replyTo',p_payload->>'subject',p_payload->>'html',p_payload->>'text',
     'queued',0,5,now(),p_payload->'branding',p_payload->>'redirectUrl',mail_key,actor_id
   );
   state_out:='queued';
 END IF;
 UPDATE gridex_case_confirmation.withdrawal_intents
 SET state=state_out,completed_at=now() WHERE case_id=q.case_id;
 INSERT INTO public.customer_case_events(company_id,customer_case_id,customer_id,event_type,event_status,message,payload,created_by)
 VALUES(q.company_id,q.case_id,q.customer_id,'tenant_email_queued',
   CASE WHEN state_out='queued' THEN 'success' ELSE 'warning' END,
   CASE WHEN state_out='queued' THEN 'Bolagets bekräftelsemejl köades.'
     ELSE 'Bekräftelsemejlet hoppades över eftersom kundens e-post saknas.' END,
   jsonb_build_object('templateKey','withdrawal_received','confirmationState',state_out,
     'outboxId',CASE WHEN state_out='queued' THEN q.outbox_id END),actor_id);
 RETURN jsonb_build_object('state',state_out,'outboxId',CASE WHEN state_out='queued' THEN q.outbox_id END,'existing',false);
END $$;

REVOKE ALL ON FUNCTION public.gridex_list_due_withdrawal_confirmations_v1(uuid,integer),
 public.gridex_defer_withdrawal_confirmation_v1(uuid,uuid),
 public.gridex_publish_withdrawal_confirmation_v1(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_list_due_withdrawal_confirmations_v1(uuid,integer),
 public.gridex_defer_withdrawal_confirmation_v1(uuid,uuid),
 public.gridex_publish_withdrawal_confirmation_v1(uuid,uuid,jsonb) TO service_role;
END;
$gridex_c44_migration$;
