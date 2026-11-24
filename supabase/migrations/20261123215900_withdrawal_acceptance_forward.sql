DO $migration$
BEGIN
CREATE TABLE gridex_case_confirmation.withdrawal_provider_entries (
  company_id uuid NOT NULL,
  outbox_id uuid NOT NULL,
  lock_token uuid NOT NULL,
  customer_id uuid NOT NULL,
  entered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (company_id,outbox_id,lock_token)
);

CREATE TABLE gridex_case_confirmation.withdrawal_provider_acceptances (
  company_id uuid NOT NULL,
  outbox_id uuid NOT NULL,
  lock_token uuid NOT NULL,
  provider_message_id text NOT NULL CHECK (length(btrim(provider_message_id)) BETWEEN 1 AND 500),
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  projected_at timestamptz,
  PRIMARY KEY (company_id,outbox_id,lock_token),
  FOREIGN KEY (company_id,outbox_id,lock_token) REFERENCES
    gridex_case_confirmation.withdrawal_provider_entries(company_id,outbox_id,lock_token)
);

ALTER TABLE gridex_case_confirmation.withdrawal_provider_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_case_confirmation.withdrawal_provider_acceptances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_case_confirmation.withdrawal_provider_entries,
  gridex_case_confirmation.withdrawal_provider_acceptances FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.gridex_reserve_withdrawal_email_provider_entry_v1(
  p_company_id uuid,p_outbox_id uuid,p_lock_token uuid
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  gate text;
  recipient_customer_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'withdrawal_provider_entry_service_role_required' USING ERRCODE='42501';
  END IF;
  -- Keep the existing customer -> outbox order and locks through this outer
  -- transaction. The acceptance writer needs only the outbox lock.
  gate := public.gridex_check_withdrawal_email_transport_v1(p_company_id,p_outbox_id,p_lock_token);
  IF gate IS DISTINCT FROM 'current' THEN RETURN gate; END IF;
  SELECT customer_id INTO STRICT recipient_customer_id FROM public.tenant_email_outbox
  WHERE company_id=p_company_id AND id=p_outbox_id AND lock_token=p_lock_token;
  IF EXISTS(SELECT FROM gridex_case_confirmation.withdrawal_provider_acceptances a
      WHERE a.company_id=p_company_id AND a.outbox_id=p_outbox_id) THEN
    UPDATE public.tenant_email_outbox
    SET status='delivery_uncertain',failure_reason='withdrawal_acceptance_projection_pending',
      delivery_uncertain_at=clock_timestamp(),next_attempt_at=NULL,
      locked_at=NULL,locked_by=NULL,lock_token=NULL,updated_at=clock_timestamp()
    WHERE company_id=p_company_id AND id=p_outbox_id AND status='processing' AND lock_token=p_lock_token;
    RETURN 'accepted_projection_pending';
  END IF;
  INSERT INTO gridex_case_confirmation.withdrawal_provider_entries(company_id,outbox_id,lock_token,customer_id)
  VALUES(p_company_id,p_outbox_id,p_lock_token,recipient_customer_id) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN 'provider_entry_already_reserved'; END IF;
  RETURN 'current';
END $$;

CREATE FUNCTION public.gridex_commit_withdrawal_email_acceptance_v1(
  p_company_id uuid,p_outbox_id uuid,p_lock_token uuid,p_provider_message_id text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  mail public.tenant_email_outbox%ROWTYPE;
  entry_customer_id uuid;
  accepted gridex_case_confirmation.withdrawal_provider_acceptances%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'withdrawal_provider_acceptance_service_role_required' USING ERRCODE='42501';
  END IF;
  IF p_provider_message_id IS NULL OR length(btrim(p_provider_message_id)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'withdrawal_provider_acceptance_id_required' USING ERRCODE='22023';
  END IF;

  SELECT * INTO mail FROM public.tenant_email_outbox
  WHERE company_id=p_company_id AND id=p_outbox_id AND email_type='withdrawal_received' FOR UPDATE;
  SELECT customer_id INTO entry_customer_id FROM gridex_case_confirmation.withdrawal_provider_entries
  WHERE company_id=p_company_id AND outbox_id=p_outbox_id AND lock_token=p_lock_token;
  IF NOT FOUND THEN RETURN 'not_current'; END IF;
  INSERT INTO gridex_case_confirmation.withdrawal_provider_acceptances(company_id,outbox_id,lock_token,provider_message_id)
  VALUES(p_company_id,p_outbox_id,p_lock_token,p_provider_message_id) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT accepted FROM gridex_case_confirmation.withdrawal_provider_acceptances
  WHERE company_id=p_company_id AND outbox_id=p_outbox_id AND lock_token=p_lock_token;
  IF accepted.provider_message_id IS DISTINCT FROM p_provider_message_id THEN
    RAISE EXCEPTION 'withdrawal_provider_acceptance_conflict' USING ERRCODE='23505';
  END IF;
  IF accepted.projected_at IS NOT NULL THEN RETURN 'projected'; END IF;

  IF mail.status IS DISTINCT FROM 'processing' OR mail.lock_token IS DISTINCT FROM p_lock_token
    OR mail.customer_id IS DISTINCT FROM entry_customer_id THEN
    RETURN 'accepted_projection_pending';
  END IF;
  BEGIN
    IF mail.communication_log_id IS NOT NULL THEN
      UPDATE public.communication_logs
      SET status='sent',provider_message_id=accepted.provider_message_id,
        sent_at=accepted.accepted_at,error_message=NULL
      WHERE company_id=mail.company_id AND id=mail.communication_log_id AND customer_id=entry_customer_id
        AND channel='email' AND template_key='withdrawal_received' AND status='queued';
      IF NOT FOUND THEN
        RETURN 'accepted_projection_pending';
      END IF;
    END IF;
    UPDATE public.tenant_email_outbox
    SET status='sent',provider_message_id=accepted.provider_message_id,sent_at=accepted.accepted_at,
      failure_reason=NULL,last_error=NULL,delivery_uncertain_at=NULL,
      locked_at=NULL,locked_by=NULL,lock_token=NULL,updated_at=clock_timestamp()
    WHERE company_id=p_company_id AND id=p_outbox_id AND status='processing' AND lock_token=p_lock_token;
    IF NOT FOUND THEN RAISE EXCEPTION 'withdrawal_provider_projection_claim_changed' USING ERRCODE='23514'; END IF;
    UPDATE gridex_case_confirmation.withdrawal_provider_acceptances SET projected_at=clock_timestamp()
    WHERE company_id=p_company_id AND outbox_id=p_outbox_id AND lock_token=p_lock_token;
  EXCEPTION WHEN integrity_constraint_violation THEN
    -- Keep the observed acceptance outside the rolled-back projection.
    RETURN 'accepted_projection_pending';
  END;
  RETURN 'projected';
END $$;

REVOKE ALL ON FUNCTION public.gridex_reserve_withdrawal_email_provider_entry_v1(uuid,uuid,uuid),
  public.gridex_commit_withdrawal_email_acceptance_v1(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_reserve_withdrawal_email_provider_entry_v1(uuid,uuid,uuid),
  public.gridex_commit_withdrawal_email_acceptance_v1(uuid,uuid,uuid,text) TO service_role;
END
$migration$;
