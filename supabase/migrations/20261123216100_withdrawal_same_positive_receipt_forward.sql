DO $migration$
BEGIN
DO $preimage$
BEGIN
  IF (SELECT md5(p.prosrc) FROM pg_proc p
      WHERE p.oid=to_regprocedure('public.gridex_commit_withdrawal_email_acceptance_v1(uuid,uuid,uuid,text)'))
      IS DISTINCT FROM 'd54c71e1caaee5ef87edf25596ced43b' THEN
    RAISE EXCEPTION 'withdrawal_acceptance_projection_preimage_changed';
  END IF;
  IF (SELECT md5(p.prosrc) FROM pg_proc p
      WHERE p.oid=to_regprocedure('gridex_case_confirmation.withdrawal_acceptance_reconcile_ready_v1(public.tenant_email_outbox,gridex_case_confirmation.withdrawal_provider_acceptances)'))
      IS DISTINCT FROM 'e6564135d4b3ec3fcf5d04e0ae6bd97d' THEN
    RAISE EXCEPTION 'withdrawal_acceptance_projection_preimage_changed';
  END IF;
  IF (SELECT md5(p.prosrc) FROM pg_proc p
      WHERE p.oid=to_regprocedure('public.gridex_reconcile_withdrawal_email_acceptance_v1(uuid,uuid,uuid,uuid,uuid)'))
      IS DISTINCT FROM '3e8a5c07df4486d5bf2697f540de7aa9' THEN
    RAISE EXCEPTION 'withdrawal_acceptance_projection_preimage_changed';
  END IF;
END $preimage$;

ALTER TABLE gridex_case_confirmation.withdrawal_provider_acceptances
  ADD COLUMN covered_by_lock_token uuid,
  ADD CONSTRAINT withdrawal_acceptance_projection_cover CHECK (
    covered_by_lock_token IS NULL OR
      (covered_by_lock_token<>lock_token AND projected_at IS NOT NULL AND reconciled_by IS NULL AND reconciled_attempt_id IS NULL)
  ),
  ADD CONSTRAINT withdrawal_acceptance_projection_cover_scope
    FOREIGN KEY(company_id,outbox_id,covered_by_lock_token)
    REFERENCES gridex_case_confirmation.withdrawal_provider_acceptances(company_id,outbox_id,lock_token);

CREATE FUNCTION gridex_case_confirmation.cover_withdrawal_acceptances_v1(
  verified gridex_case_confirmation.withdrawal_provider_acceptances
) RETURNS void
LANGUAGE sql SET search_path=pg_catalog AS $$
  UPDATE gridex_case_confirmation.withdrawal_provider_acceptances a
  SET projected_at=clock_timestamp(),covered_by_lock_token=verified.lock_token
  WHERE a.company_id=verified.company_id AND a.outbox_id=verified.outbox_id
    AND a.provider_message_id=verified.provider_message_id AND a.lock_token<>verified.lock_token
    AND a.projected_at IS NULL AND verified.projected_at IS NOT NULL AND verified.covered_by_lock_token IS NULL
$$;
REVOKE ALL ON FUNCTION gridex_case_confirmation.cover_withdrawal_acceptances_v1(
  gridex_case_confirmation.withdrawal_provider_acceptances) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.gridex_commit_withdrawal_email_acceptance_v1(
  p_company_id uuid,p_outbox_id uuid,p_lock_token uuid,p_provider_message_id text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  mail public.tenant_email_outbox%ROWTYPE;
  entry_customer_id uuid;
  accepted gridex_case_confirmation.withdrawal_provider_acceptances%ROWTYPE;
  canonical_receipt gridex_case_confirmation.withdrawal_provider_acceptances%ROWTYPE;
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
  IF mail.status='sent' AND mail.provider_message_id=p_provider_message_id THEN
    -- A second positive result for the same provider message can reuse a
    -- completed local projection. Mere current status or provider ID on the
    -- outbox is insufficient without its own matching durable proof.
    SELECT * INTO canonical_receipt FROM gridex_case_confirmation.withdrawal_provider_acceptances p
    WHERE p.company_id=p_company_id AND p.outbox_id=p_outbox_id
      AND p.provider_message_id=p_provider_message_id AND p.projected_at IS NOT NULL
      AND p.covered_by_lock_token IS NULL
    ORDER BY p.projected_at,p.lock_token LIMIT 1;
    IF FOUND THEN
      PERFORM gridex_case_confirmation.cover_withdrawal_acceptances_v1(canonical_receipt);
      RETURN 'projected';
    END IF;
  END IF;

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
    WHERE company_id=p_company_id AND outbox_id=p_outbox_id AND lock_token=p_lock_token
    RETURNING * INTO canonical_receipt;
    PERFORM gridex_case_confirmation.cover_withdrawal_acceptances_v1(canonical_receipt);
  EXCEPTION WHEN integrity_constraint_violation THEN
    -- Keep the observed acceptance outside the rolled-back projection.
    RETURN 'accepted_projection_pending';
  END;
  RETURN 'projected';
END $$;

CREATE OR REPLACE FUNCTION gridex_case_confirmation.withdrawal_acceptance_reconcile_ready_v1(
  mail public.tenant_email_outbox,proof gridex_case_confirmation.withdrawal_provider_acceptances
) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT mail.status='delivery_uncertain' AND mail.withdrawal_uncertain_attempt_id IS NOT NULL
    AND mail.lock_token IS NULL AND mail.locked_at IS NULL AND mail.locked_by IS NULL
    AND proof.projected_at IS NULL AND (mail.provider_message_id IS NULL OR mail.provider_message_id=proof.provider_message_id)
    AND EXISTS(SELECT FROM gridex_case_confirmation.withdrawal_provider_entries e
      WHERE e.company_id=mail.company_id AND e.outbox_id=mail.id AND e.lock_token=proof.lock_token AND e.customer_id=mail.customer_id)
    AND NOT EXISTS(
      SELECT FROM gridex_case_confirmation.withdrawal_provider_entries e
      LEFT JOIN gridex_case_confirmation.withdrawal_provider_acceptances other
        ON other.company_id=e.company_id AND other.outbox_id=e.outbox_id AND other.lock_token=e.lock_token
      WHERE e.company_id=mail.company_id AND e.outbox_id=mail.id AND e.lock_token<>proof.lock_token
        AND other.provider_message_id IS DISTINCT FROM proof.provider_message_id
    )
    AND (mail.communication_log_id IS NULL OR EXISTS(SELECT FROM public.communication_logs l
      WHERE l.id=mail.communication_log_id AND l.company_id=mail.company_id AND l.customer_id=mail.customer_id
        AND l.channel='email' AND l.template_key='withdrawal_received' AND l.status='queued'
        AND (l.provider_message_id IS NULL OR l.provider_message_id=proof.provider_message_id)))
$$;

CREATE OR REPLACE FUNCTION public.gridex_reconcile_withdrawal_email_acceptance_v1(
  p_company_id uuid,p_outbox_id uuid,p_acceptance_token uuid,p_reviewed_attempt_id uuid,p_actor_user_id uuid
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  mail public.tenant_email_outbox%ROWTYPE;
  proof gridex_case_confirmation.withdrawal_provider_acceptances%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR public.canonical_actor_is_platform_admin(p_actor_user_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'withdrawal_acceptance_review_actor_required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO mail FROM public.tenant_email_outbox
  WHERE company_id=p_company_id AND id=p_outbox_id AND email_type='withdrawal_received' FOR UPDATE;
  IF NOT FOUND THEN RETURN 'review_changed'; END IF;
  IF public.canonical_actor_is_platform_admin(p_actor_user_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'withdrawal_acceptance_review_actor_required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO proof FROM gridex_case_confirmation.withdrawal_provider_acceptances
  WHERE company_id=p_company_id AND outbox_id=p_outbox_id AND lock_token=p_acceptance_token FOR UPDATE;
  IF NOT FOUND OR p_reviewed_attempt_id IS NULL THEN RETURN 'review_changed'; END IF;
  IF proof.reconciled_attempt_id=p_reviewed_attempt_id THEN RETURN 'existing'; END IF;
  IF mail.withdrawal_uncertain_attempt_id IS DISTINCT FROM p_reviewed_attempt_id THEN RETURN 'review_changed'; END IF;
  IF gridex_case_confirmation.withdrawal_acceptance_reconcile_ready_v1(mail,proof) IS NOT TRUE THEN RETURN 'held'; END IF;

  IF mail.communication_log_id IS NOT NULL THEN
    UPDATE public.communication_logs SET status='sent',provider_message_id=proof.provider_message_id,
      sent_at=proof.accepted_at,error_message=NULL
    WHERE id=mail.communication_log_id AND company_id=p_company_id AND customer_id=mail.customer_id
      AND channel='email' AND template_key='withdrawal_received' AND status='queued'
      AND (provider_message_id IS NULL OR provider_message_id=proof.provider_message_id);
    IF NOT FOUND THEN RETURN 'held'; END IF;
  END IF;
  UPDATE public.tenant_email_outbox
  SET status='sent',provider_message_id=proof.provider_message_id,sent_at=proof.accepted_at,delivery_uncertain_at=NULL,
    last_error=NULL,failure_reason=NULL,next_attempt_at=NULL,updated_at=clock_timestamp()
  WHERE company_id=p_company_id AND id=p_outbox_id AND status='delivery_uncertain'
    AND withdrawal_uncertain_attempt_id=p_reviewed_attempt_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'withdrawal_acceptance_review_changed' USING ERRCODE='23514'; END IF;
  UPDATE gridex_case_confirmation.withdrawal_provider_acceptances
  SET projected_at=clock_timestamp(),reconciled_by=p_actor_user_id,reconciled_attempt_id=p_reviewed_attempt_id
  WHERE company_id=p_company_id AND outbox_id=p_outbox_id AND lock_token=p_acceptance_token
  RETURNING * INTO proof;
  PERFORM gridex_case_confirmation.cover_withdrawal_acceptances_v1(proof);
  INSERT INTO public.audit_logs(actor_user_id,company_id,entity_type,entity_id,action,metadata)
  VALUES(p_actor_user_id,p_company_id,'tenant_email_outbox',p_outbox_id,'withdrawal_email_acceptance_reconciled',
    jsonb_build_object('reviewedAttemptId',p_reviewed_attempt_id,'acceptedAt',proof.accepted_at));
  RETURN 'projected';
END $$;
END
$migration$;
