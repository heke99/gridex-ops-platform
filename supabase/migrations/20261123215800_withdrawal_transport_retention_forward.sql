DO $migration$
BEGIN
CREATE FUNCTION public.gridex_check_withdrawal_email_transport_v1(
  p_company_id uuid,p_outbox_id uuid,p_lock_token uuid
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  mail public.tenant_email_outbox%ROWTYPE;
  recipient_customer_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'withdrawal_email_transport_service_role_required' USING ERRCODE='42501';
  END IF;
  SELECT customer_id INTO recipient_customer_id FROM public.tenant_email_outbox
  WHERE company_id=p_company_id AND id=p_outbox_id AND email_type='withdrawal_received';
  IF recipient_customer_id IS NULL OR p_lock_token IS NULL THEN RETURN 'not_current'; END IF;

  -- Use the pseudonymisation writer's customer lock before the claim row.
  PERFORM id FROM public.customers
  WHERE company_id=p_company_id AND id=recipient_customer_id FOR SHARE;
  IF NOT FOUND THEN RETURN 'not_current'; END IF;
  SELECT * INTO mail FROM public.tenant_email_outbox
  WHERE company_id=p_company_id AND id=p_outbox_id AND email_type='withdrawal_received'
    AND customer_id=recipient_customer_id AND status='processing' AND lock_token=p_lock_token
    AND locked_by='tenant-email-outbox' AND locked_at IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_current'; END IF;
  IF NOT gridex_correction_process.customer_retention_tombstoned_v1(p_company_id,recipient_customer_id) THEN
    RETURN 'current';
  END IF;

  -- Cancellation blocks future provider entry. Preserve any historical
  -- provider ID, attempt count and timestamps for transport reconciliation.
  UPDATE public.tenant_email_outbox
  SET status='cancelled',failure_reason='withdrawal_recipient_retention',
    last_error=NULL,next_attempt_at=NULL,locked_at=NULL,locked_by=NULL,lock_token=NULL,updated_at=now()
  WHERE company_id=mail.company_id AND id=mail.id;
  UPDATE public.communication_logs SET status='cancelled'
  WHERE company_id=mail.company_id AND id=mail.communication_log_id
    AND customer_id=mail.customer_id AND status='queued';
  RETURN 'suppressed_retention';
END $$;

REVOKE ALL ON FUNCTION public.gridex_check_withdrawal_email_transport_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_check_withdrawal_email_transport_v1(uuid,uuid,uuid) TO service_role;

ALTER TABLE public.tenant_email_outbox ADD COLUMN withdrawal_uncertain_attempt_id uuid;
UPDATE public.tenant_email_outbox
SET withdrawal_uncertain_attempt_id=gen_random_uuid()
WHERE email_type='withdrawal_received' AND status='delivery_uncertain';

CREATE FUNCTION public.gridex_assign_withdrawal_uncertain_attempt_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.email_type IS DISTINCT FROM 'withdrawal_received' OR NEW.status IS DISTINCT FROM 'delivery_uncertain' THEN
    NEW.withdrawal_uncertain_attempt_id:=NULL;
  ELSIF TG_OP='INSERT' THEN
    NEW.withdrawal_uncertain_attempt_id:=gen_random_uuid();
  ELSIF OLD.email_type IS DISTINCT FROM NEW.email_type OR OLD.status IS DISTINCT FROM NEW.status THEN
    NEW.withdrawal_uncertain_attempt_id:=gen_random_uuid();
  ELSE
    NEW.withdrawal_uncertain_attempt_id:=OLD.withdrawal_uncertain_attempt_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.gridex_assign_withdrawal_uncertain_attempt_v1() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER assign_withdrawal_uncertain_attempt_before_write
BEFORE INSERT OR UPDATE OF status,email_type,withdrawal_uncertain_attempt_id
ON public.tenant_email_outbox FOR EACH ROW EXECUTE FUNCTION public.gridex_assign_withdrawal_uncertain_attempt_v1();

CREATE FUNCTION public.gridex_requeue_uncertain_withdrawal_email_v1(p_company_id uuid,p_outbox_id uuid,p_reviewed_attempt_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  recipient_customer_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'withdrawal_email_transport_service_role_required' USING ERRCODE='42501';
  END IF;
  IF p_reviewed_attempt_id IS NULL THEN RETURN 'not_current'; END IF;
  SELECT customer_id INTO recipient_customer_id FROM public.tenant_email_outbox
  WHERE company_id=p_company_id AND id=p_outbox_id AND email_type='withdrawal_received' AND status='delivery_uncertain'
    AND withdrawal_uncertain_attempt_id=p_reviewed_attempt_id;
  IF NOT FOUND OR recipient_customer_id IS NULL THEN RETURN 'not_current'; END IF;
  PERFORM id FROM public.customers WHERE company_id=p_company_id AND id=recipient_customer_id FOR SHARE;
  IF NOT FOUND THEN RETURN 'not_current'; END IF;
  PERFORM id FROM public.tenant_email_outbox
  WHERE company_id=p_company_id AND id=p_outbox_id AND customer_id=recipient_customer_id
    AND email_type='withdrawal_received' AND status='delivery_uncertain'
    AND withdrawal_uncertain_attempt_id=p_reviewed_attempt_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_current'; END IF;
  IF gridex_correction_process.customer_retention_tombstoned_v1(p_company_id,recipient_customer_id) THEN
    RETURN 'suppressed_retention';
  END IF;

  IF EXISTS(SELECT FROM gridex_case_confirmation.withdrawal_provider_acceptances a
     WHERE a.company_id=p_company_id AND a.outbox_id=p_outbox_id) THEN
    RETURN 'accepted_projection_pending';
  END IF;

  UPDATE public.tenant_email_outbox SET status='queued',last_error=NULL,failure_reason=NULL,delivery_uncertain_at=NULL,
    next_attempt_at=now(),locked_at=NULL,locked_by=NULL,lock_token=NULL,updated_at=now()
  WHERE company_id=p_company_id AND id=p_outbox_id AND customer_id=recipient_customer_id
    AND email_type='withdrawal_received' AND status='delivery_uncertain'
    AND withdrawal_uncertain_attempt_id=p_reviewed_attempt_id;
  IF NOT FOUND THEN RETURN 'not_current'; END IF;
  RETURN 'queued';
END $$;

REVOKE ALL ON FUNCTION public.gridex_requeue_uncertain_withdrawal_email_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_requeue_uncertain_withdrawal_email_v1(uuid,uuid,uuid) TO service_role;
END
$migration$;
