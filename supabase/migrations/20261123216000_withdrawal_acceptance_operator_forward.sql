DO $migration$
BEGIN
ALTER TABLE gridex_case_confirmation.withdrawal_provider_acceptances
  ADD COLUMN reconciled_by uuid,
  ADD COLUMN reconciled_attempt_id uuid,
  ADD CONSTRAINT withdrawal_acceptance_operator_receipt CHECK (
    (reconciled_by IS NULL AND reconciled_attempt_id IS NULL)
    OR (reconciled_by IS NOT NULL AND reconciled_attempt_id IS NOT NULL AND projected_at IS NOT NULL)
  );
CREATE INDEX withdrawal_acceptance_pending_idx
  ON gridex_case_confirmation.withdrawal_provider_acceptances(accepted_at,company_id,outbox_id,lock_token)
  WHERE projected_at IS NULL;

CREATE FUNCTION gridex_case_confirmation.withdrawal_acceptance_reconcile_ready_v1(
  mail public.tenant_email_outbox,proof gridex_case_confirmation.withdrawal_provider_acceptances
) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT mail.status='delivery_uncertain' AND mail.withdrawal_uncertain_attempt_id IS NOT NULL
    AND mail.lock_token IS NULL AND mail.locked_at IS NULL AND mail.locked_by IS NULL
    AND proof.projected_at IS NULL AND (mail.provider_message_id IS NULL OR mail.provider_message_id=proof.provider_message_id)
    AND EXISTS(SELECT FROM gridex_case_confirmation.withdrawal_provider_entries e
      WHERE e.company_id=mail.company_id AND e.outbox_id=mail.id AND e.lock_token=proof.lock_token AND e.customer_id=mail.customer_id)
    AND NOT EXISTS(SELECT FROM gridex_case_confirmation.withdrawal_provider_entries e
      WHERE e.company_id=mail.company_id AND e.outbox_id=mail.id AND e.lock_token<>proof.lock_token)
    AND (mail.communication_log_id IS NULL OR EXISTS(SELECT FROM public.communication_logs l
      WHERE l.id=mail.communication_log_id AND l.company_id=mail.company_id AND l.customer_id=mail.customer_id
        AND l.channel='email' AND l.template_key='withdrawal_received' AND l.status='queued'
        AND (l.provider_message_id IS NULL OR l.provider_message_id=proof.provider_message_id)))
$$;
REVOKE ALL ON FUNCTION gridex_case_confirmation.withdrawal_acceptance_reconcile_ready_v1(
  public.tenant_email_outbox,gridex_case_confirmation.withdrawal_provider_acceptances) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.gridex_read_system_health_tenant_email_review_v1(p_actor_user_id uuid)
RETURNS TABLE(id uuid,company_id uuid,to_email text,subject text,delivery_uncertain_at timestamptz,
  email_type text,withdrawal_uncertain_attempt_id uuid,review_state text,accepted_at timestamptz,acceptance_token uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR public.canonical_actor_is_platform_admin(p_actor_user_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'withdrawal_acceptance_review_actor_required' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
  WITH positive_keys AS (
    SELECT a.company_id,a.outbox_id FROM gridex_case_confirmation.withdrawal_provider_acceptances a
    WHERE a.projected_at IS NULL
    UNION
    SELECT o.company_id,o.id FROM public.tenant_email_outbox o
    WHERE o.email_type='withdrawal_received' AND o.status='delivery_uncertain'
  ), known AS (
    SELECT DISTINCT ON (a.company_id,a.outbox_id) a.*
    FROM positive_keys k JOIN gridex_case_confirmation.withdrawal_provider_acceptances a
      ON a.company_id=k.company_id AND a.outbox_id=k.outbox_id
    ORDER BY a.company_id,a.outbox_id,a.accepted_at DESC,a.lock_token
  ), work AS (
    SELECT o.id,o.company_id,NULL::text AS to_email,NULL::text AS subject,o.delivery_uncertain_at,
      o.email_type,o.withdrawal_uncertain_attempt_id,
      CASE WHEN gridex_case_confirmation.withdrawal_acceptance_reconcile_ready_v1(o,a)
           THEN 'accepted_ready' ELSE 'accepted_review' END AS review_state,
      a.accepted_at,a.lock_token AS acceptance_token,a.accepted_at AS sort_at
    FROM known a JOIN public.tenant_email_outbox o ON o.company_id=a.company_id AND o.id=a.outbox_id
    WHERE o.email_type='withdrawal_received'
    UNION ALL
    SELECT o.id,o.company_id,o.to_email,o.subject,o.delivery_uncertain_at,o.email_type,o.withdrawal_uncertain_attempt_id,
      'unknown',NULL::timestamptz,NULL::uuid,o.delivery_uncertain_at
    FROM public.tenant_email_outbox o
    WHERE o.status='delivery_uncertain'
      AND NOT EXISTS(SELECT FROM known a WHERE a.company_id=o.company_id AND a.outbox_id=o.id)
  )
  SELECT w.id,w.company_id,w.to_email,w.subject,w.delivery_uncertain_at,w.email_type,
    w.withdrawal_uncertain_attempt_id,w.review_state,w.accepted_at,w.acceptance_token
  FROM work w ORDER BY w.sort_at,w.id LIMIT 20;
END $$;

CREATE FUNCTION public.gridex_reconcile_withdrawal_email_acceptance_v1(
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
  WHERE company_id=p_company_id AND outbox_id=p_outbox_id AND lock_token=p_acceptance_token;
  INSERT INTO public.audit_logs(actor_user_id,company_id,entity_type,entity_id,action,metadata)
  VALUES(p_actor_user_id,p_company_id,'tenant_email_outbox',p_outbox_id,'withdrawal_email_acceptance_reconciled',
    jsonb_build_object('reviewedAttemptId',p_reviewed_attempt_id,'acceptedAt',proof.accepted_at));
  RETURN 'projected';
END $$;

REVOKE ALL ON FUNCTION public.gridex_read_system_health_tenant_email_review_v1(uuid),
  public.gridex_reconcile_withdrawal_email_acceptance_v1(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_read_system_health_tenant_email_review_v1(uuid),
  public.gridex_reconcile_withdrawal_email_acceptance_v1(uuid,uuid,uuid,uuid,uuid) TO service_role;
END
$migration$;
