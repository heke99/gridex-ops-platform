-- Apply install/catalog checks/ACL as one migration and ledger transaction.
DO $install_signature_command$
DECLARE
 predecessor record;
BEGIN
 PERFORM set_config('lock_timeout','3s',true);
 FOR predecessor IN SELECT * FROM (VALUES
  ('public.gridex_assert_contract_permission(uuid,text)','4d842e5cb0a2903a08b718eb34826e08e294c766a7295410a46bc178135cbcb8'),
  ('public.ediel_require_contract_records_available_v1(uuid,uuid)','b36aeada8feb12c51f24ea3689a1cf81e330ac47b5483081ba7134b3291c307c'),
  ('public.gridex_prepare_signature_before_record_retention_v1(uuid,uuid,uuid,text,text,timestamp with time zone,uuid,text)','96ff30a1422207ad556da8648502fc36d002300a017be7aa793c621cc8d13596'),
  ('public.gridex_prepare_customer_contract_signature_request_v1(uuid,uuid,uuid,text,text,timestamp with time zone,uuid,text)','b760a13e2388f791046a771fa0d1c79a76a3c1334fb3eff43140abdcdc402577'),
  ('public.gridex_mark_customer_contract_signature_request_sent_v1(uuid,uuid)','af949bbd7651edd5a72c6b8561fceaa6db0d6eee448a2e93c87c5cdcb530129e')
 ) AS required(proc,sha)
 LOOP
  IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc
    WHERE oid=to_regprocedure(predecessor.proc)) IS DISTINCT FROM predecessor.sha THEN
   RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='signature_command_predecessor_changed';
  END IF;
 END LOOP;

-- Additive signature command. Completion is one database transaction.
-- The receipt is stored on the service-only signature request, not on tenant-editable logs.
-- Hold schema stability while allowing ordinary ROW EXCLUSIVE writers.
LOCK TABLE public.customer_contract_signature_requests IN SHARE UPDATE EXCLUSIVE MODE;
PERFORM set_config('search_path','pg_catalog',true);
IF NOT EXISTS (
 SELECT FROM pg_index i WHERE i.indexrelid=to_regclass('public.customer_contract_signature_requests_command_uidx')
  AND i.indrelid='public.customer_contract_signature_requests'::regclass
  AND i.indisvalid AND i.indisready AND i.indislive AND i.indisunique
  AND pg_get_indexdef(i.indexrelid) = $index_definition$CREATE UNIQUE INDEX customer_contract_signature_requests_command_uidx ON public.customer_contract_signature_requests USING btree (company_id, ((metadata ->> 'signature_command_key'::text))) WHERE (metadata ? 'signature_command_key'::text)$index_definition$
) THEN
 RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='signature_command_required_index_unavailable';
END IF;
CREATE FUNCTION public.gridex_queue_customer_contract_signature_command_v1(
 p_company_id uuid,p_customer_id uuid,p_contract_id uuid,p_actor_user_id uuid,p_recipient_email text,
 p_channel text,p_expires_in_hours double precision,p_command_id uuid,p_expected_request_id uuid,p_mail jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $signature_command$
DECLARE
 c public.customer_contracts%rowtype;
 l public.communication_logs%rowtype;
 o public.tenant_email_outbox%rowtype;
 r public.customer_contract_signature_requests%rowtype;
 scope jsonb;
 result jsonb;
 key text;
 recipient text:=lower(btrim(p_recipient_email));
 before_ids uuid[];
 signed_url text;
 link_token text;
 now_at timestamptz;
 log_id uuid:=gen_random_uuid();
 outbox_id uuid:=gen_random_uuid();
 replayed boolean:=false;
 delivery_status text;
 rule_enabled boolean;
 receipt_sender_mode text;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='signature_command_service_required';
 END IF;
 IF p_company_id IS NULL OR p_customer_id IS NULL OR p_contract_id IS NULL OR p_actor_user_id IS NULL
   OR recipient IS NULL OR recipient !~ '^[^[:space:]@]+@[^[:space:]@]+$'
   OR (p_channel IN ('internal','website','partner_api','customer_portal')) IS NOT TRUE
   OR (p_expires_in_hours BETWEEN 1 AND 336) IS NOT TRUE
   OR (p_command_id IS NULL AND p_expected_request_id IS NOT NULL) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='signature_command_invalid';
 END IF;
 -- Match the canonical company-before-contract order, then check the same authorization.
 PERFORM public.gridex_assert_contract_permission(p_actor_user_id,'contracts.create');
 PERFORM id FROM public.companies WHERE id=p_company_id FOR SHARE;
 SELECT * INTO c FROM public.customer_contracts
  WHERE id=p_contract_id AND company_id=p_company_id AND customer_id=p_customer_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='signature_request_contract_not_found_for_tenant'; END IF;
 PERFORM public.ediel_require_contract_records_available_v1(p_company_id,p_contract_id);
 scope:=jsonb_build_object('contractId',p_contract_id,'customerId',p_customer_id,'actorId',p_actor_user_id,
  'channel',p_channel,'expiresInHours',p_expires_in_hours,'priorRequestId',p_expected_request_id);
 key:='contract_signature_command:'||coalesce(p_command_id::text,'initial:'||p_contract_id::text);
 SELECT * INTO r FROM public.customer_contract_signature_requests WHERE company_id=p_company_id
  AND metadata ? 'signature_command_key' AND metadata->>'signature_command_key'=key;
 IF FOUND THEN
  IF r.customer_id IS DISTINCT FROM p_customer_id OR r.customer_contract_id IS DISTINCT FROM p_contract_id
   OR r.recipient_email IS DISTINCT FROM recipient OR r.channel IS DISTINCT FROM p_channel
   OR r.metadata->'signature_command_scope' IS DISTINCT FROM scope THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='signature_command_scope_conflict';
  END IF;
  log_id:=(r.metadata->>'signature_command_log_id')::uuid;
  outbox_id:=(r.metadata->>'signature_command_outbox_id')::uuid;
  receipt_sender_mode:=r.metadata->>'signature_command_sender_mode';
  result:=r.metadata->'signature_command_result';
  IF log_id IS NULL OR outbox_id IS NULL OR result->>'request_id' IS DISTINCT FROM r.id::text THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='signature_command_receipt_changed';
  END IF;
  SELECT * INTO o FROM public.tenant_email_outbox WHERE id=outbox_id AND company_id=p_company_id
   AND customer_id=p_customer_id AND email_type='contract.signature_requested' AND to_email=recipient
   AND (communication_log_id=log_id OR communication_log_id IS NULL);
  -- Retention may mask or remove delivery bytes and the ordinary communications log.
  delivery_status:=coalesce(o.status,'unknown');
  replayed:=true; ELSE
  SELECT array_agg(id ORDER BY id) INTO before_ids FROM public.customer_contract_signature_requests
    WHERE company_id=p_company_id AND customer_contract_id=p_contract_id AND customer_id=p_customer_id
      AND revoked_at IS NULL AND used_at IS NULL AND (p_command_id IS NOT NULL OR expires_at>clock_timestamp());
  IF coalesce(cardinality(before_ids),0)>1 OR before_ids[1] IS DISTINCT FROM p_expected_request_id THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='signature_command_stale';
  END IF;
  IF p_mail IS NULL THEN RETURN NULL; END IF;
  signed_url:=p_mail->>'signing_url';
  link_token:=substring(signed_url from '/sign/contract/([a-f0-9]{64})$');
  IF jsonb_typeof(p_mail) IS DISTINCT FROM 'object' OR link_token IS NULL OR signed_url !~ '^https?://[^[:space:]]+$'
    OR nullif(btrim(p_mail->>'from'),'') IS NULL OR nullif(btrim(p_mail->>'sender_email'),'') IS NULL
    OR nullif(btrim(p_mail->>'subject'),'') IS NULL OR nullif(btrim(p_mail->>'html'),'') IS NULL
    OR position(signed_url in p_mail->>'html')=0 OR length(p_mail->>'html')>1048576
    OR (p_mail->>'contract_name') IS DISTINCT FROM c.contract_name
    OR (p_mail->>'contract_number') IS DISTINCT FROM c.contract_number THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='signature_command_mail_invalid';
  END IF;
  IF p_mail->>'template_id'='system-default:contract.signature_requested:sv' THEN
   PERFORM id FROM public.company_email_templates WHERE company_id=p_company_id
    AND template_key='contract.signature_requested' AND language='sv' AND is_active FOR SHARE;
   IF FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='signature_command_template_changed'; END IF;
  ELSE
   PERFORM id FROM public.company_email_templates WHERE id=(p_mail->>'template_id')::uuid
    AND company_id=p_company_id AND template_key='contract.signature_requested' AND language='sv' AND is_active
    AND updated_at IS NOT DISTINCT FROM (p_mail->>'template_updated_at')::timestamptz FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='signature_command_template_changed'; END IF;
  END IF;
  SELECT enabled INTO rule_enabled FROM public.email_event_rules WHERE company_id=p_company_id
    AND event_key='contract.signature_requested' AND template_key='contract.signature_requested'
    ORDER BY updated_at DESC LIMIT 1 FOR SHARE;
  IF FOUND AND rule_enabled IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='signature_command_rule_disabled'; END IF;
  now_at:=clock_timestamp();
  result:=public.gridex_prepare_customer_contract_signature_request_v1(p_company_id,p_customer_id,p_contract_id,
   encode(sha256(convert_to(link_token,'UTF8')),'hex'),recipient,now_at+make_interval(secs=>p_expires_in_hours*3600),p_actor_user_id,p_channel);
  IF result->'ok' IS DISTINCT FROM 'true'::jsonb OR result->>'contract_name' IS DISTINCT FROM c.contract_name
    OR result->>'contract_number' IS DISTINCT FROM c.contract_number OR result->>'recipient_email' IS DISTINCT FROM recipient THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='signature_command_prepared_binding_changed';
  END IF;
  SELECT * INTO STRICT r FROM public.customer_contract_signature_requests WHERE id=(result->>'request_id')::uuid
   AND company_id=p_company_id AND customer_id=p_customer_id AND customer_contract_id=p_contract_id AND channel=p_channel;
  INSERT INTO public.communication_logs(id,company_id,customer_id,event_key,template_key,recipient_email,sender_email,
    reply_to_email,subject,status,provider,created_by,customer_number,contract_id,metadata,sender_mode,from_name,domain_verified_at,template_version,idempotency_key)
  VALUES(log_id,p_company_id,p_customer_id,'contract.signature_requested','contract.signature_requested',recipient,
   p_mail->>'sender_email',p_mail->>'reply_to',p_mail->>'subject','queued','resend',p_actor_user_id,p_mail->>'customer_number',p_contract_id,
   jsonb_build_object('contract_id',p_contract_id,'signature_request_id',r.id,'signature_channel',p_channel,
    'signature_expires_at',r.expires_at,'contract_publication_version_id',result->'contract_publication_version_id',
    'price_plan_version_id',result->'price_plan_version_id','legal_bundle_version_id',result->'legal_bundle_version_id',
    'contract_price_snapshot_id',result->'contract_price_snapshot_id','customer_number',p_mail->>'customer_number',
    'idempotency_key',key,
    'template_snapshot',p_mail->'template_snapshot','sender_snapshot',p_mail->'sender_snapshot',
    'rendered_snapshot',jsonb_build_object('subject',p_mail->>'subject')),
   p_mail->>'sender_mode',p_mail->>'from_name',(p_mail->>'domain_verified_at')::timestamptz,p_mail->>'template_version',key)
  RETURNING * INTO l;
  INSERT INTO public.tenant_email_outbox(id,company_id,customer_id,communication_log_id,email_type,to_email,from_email,
    reply_to_email,subject,html_body,text_body,status,attempts,max_attempts,next_attempt_at,branding_snapshot,provider_idempotency_key)
  VALUES(outbox_id,p_company_id,p_customer_id,log_id,'contract.signature_requested',recipient,btrim(p_mail->>'from'),
   p_mail->>'reply_to',btrim(p_mail->>'subject'),btrim(p_mail->>'html'),p_mail->>'text','queued',0,5,now_at,
   coalesce(p_mail->'branding_snapshot','{}'::jsonb),'tenant-email:'||p_company_id::text||':'||outbox_id::text)
  RETURNING * INTO o;
  delivery_status:=o.status;
  receipt_sender_mode:=l.sender_mode;
  UPDATE public.customer_contract_signature_requests SET metadata=metadata||jsonb_build_object(
   'signature_command_key',key,'signature_command_scope',scope,'signature_command_log_id',log_id,
   'signature_command_outbox_id',outbox_id,'signature_command_sender_mode',receipt_sender_mode,'signature_command_result',result)
  WHERE id=r.id AND company_id=p_company_id AND customer_id=p_customer_id AND customer_contract_id=p_contract_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='signature_command_receipt_changed'; END IF;
  PERFORM public.gridex_mark_customer_contract_signature_request_sent_v1(r.id,p_company_id);
  IF r.expires_at<=clock_timestamp() THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='signature_request_expiry_invalid';
  END IF;
 END IF;
 RETURN jsonb_build_object('request',result,'communication_log_id',log_id,'sender_mode',receipt_sender_mode,
  'delivery_status',CASE WHEN r.revoked_at IS NOT NULL OR r.used_at IS NOT NULL OR r.expires_at<=clock_timestamp() THEN 'cancelled' ELSE delivery_status END,
  'replayed',replayed);
END;
$signature_command$;
REVOKE ALL ON FUNCTION public.gridex_queue_customer_contract_signature_command_v1(uuid,uuid,uuid,uuid,text,text,double precision,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_queue_customer_contract_signature_command_v1(uuid,uuid,uuid,uuid,text,text,double precision,uuid,uuid,jsonb) TO service_role;

END;
$install_signature_command$;
