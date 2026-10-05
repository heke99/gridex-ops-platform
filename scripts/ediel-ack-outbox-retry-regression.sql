\set ON_ERROR_STOP on
\pset pager off
-- Disposable native proof of the real outbox unique lock and status predicate.
-- This uses non-market fixture messages; TypeScript tests exercise the ACK caller.
BEGIN;
CREATE TEMP TABLE ack_outbox_retry_results(name text PRIMARY KEY, passed boolean NOT NULL) ON COMMIT DROP;
DO $$
DECLARE c uuid:=gen_random_uuid(); m uuid:=gen_random_uuid(); sent_id uuid; failed_id uuid; affected integer;
BEGIN
 INSERT INTO public.companies(id,name,status) VALUES(c,'ACK outbox retry fixture','active');
 INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,immutable_payload_hash)
 VALUES(m,c,'test','outbound','edifact','TEST','RETRY','draft','safe outbox fixture',encode(sha256(convert_to('safe outbox fixture','UTF8')),'hex'));
 INSERT INTO public.ediel_outbox(company_id,ediel_message_id,status,lock_key,environment)
 VALUES(c,m,'sent','ack-retry/sent/'||m,'test') RETURNING id INTO sent_id;
 INSERT INTO public.ediel_outbox(company_id,ediel_message_id,status,lock_key,environment)
 VALUES(c,m,'failed','ack-retry/failed/'||m,'test') RETURNING id INTO failed_id;

 INSERT INTO public.ediel_outbox(company_id,ediel_message_id,status,lock_key,environment)
 VALUES(c,m,'queued','ack-retry/sent/'||m,'test') ON CONFLICT(lock_key) DO NOTHING;
 GET DIAGNOSTICS affected=ROW_COUNT;
 INSERT INTO ack_outbox_retry_results VALUES('terminal-conflict-does-not-update',affected=0 AND
  (SELECT status='sent' FROM public.ediel_outbox WHERE id=sent_id));

 UPDATE public.ediel_outbox SET status='queued' WHERE id=sent_id AND status IN ('draft','prepared','failed');
 GET DIAGNOSTICS affected=ROW_COUNT;
 INSERT INTO ack_outbox_retry_results VALUES('terminal-conditional-retry-does-not-update',affected=0 AND
  (SELECT status='sent' FROM public.ediel_outbox WHERE id=sent_id));

 UPDATE public.ediel_outbox SET status='queued' WHERE id=failed_id AND status IN ('draft','prepared','failed');
 GET DIAGNOSTICS affected=ROW_COUNT;
 INSERT INTO ack_outbox_retry_results VALUES('known-failure-can-requeue-once',affected=1 AND
  (SELECT status='queued' FROM public.ediel_outbox WHERE id=failed_id) AND
  (SELECT count(*)=2 FROM public.ediel_outbox WHERE ediel_message_id=m));
END $$;
TABLE ack_outbox_retry_results;
DO $$ DECLARE failures text; BEGIN
 SELECT string_agg(name,', ') INTO failures FROM ack_outbox_retry_results WHERE NOT passed;
 IF failures IS NOT NULL THEN RAISE EXCEPTION 'ack_outbox_retry_regression_failed: %',failures; END IF;
END $$;
ROLLBACK;
