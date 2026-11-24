DO $migration$
BEGIN
DO $preimage$
BEGIN
  IF (SELECT md5(p.prosrc) FROM pg_proc p
      WHERE p.oid=to_regprocedure('public.gridex_read_system_health_tenant_email_review_v1(uuid)'))
      IS DISTINCT FROM '15d4b39947152c17426ae471fde65a3c' THEN
    RAISE EXCEPTION 'withdrawal_retained_review_preimage_changed';
  END IF;
END $preimage$;

CREATE OR REPLACE FUNCTION public.gridex_read_system_health_tenant_email_review_v1(p_actor_user_id uuid)
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
    SELECT o.id,o.company_id,
      CASE WHEN NOT retention.blocked THEN o.to_email END,
      CASE WHEN NOT retention.blocked THEN o.subject END,
      o.delivery_uncertain_at,o.email_type,
      CASE WHEN NOT retention.blocked THEN o.withdrawal_uncertain_attempt_id END,
      CASE WHEN retention.blocked THEN 'unknown_retention' ELSE 'unknown' END,
      NULL::timestamptz,NULL::uuid,o.delivery_uncertain_at
    FROM public.tenant_email_outbox o
    CROSS JOIN LATERAL (
      SELECT CASE WHEN o.email_type='withdrawal_received' AND o.customer_id IS NOT NULL
        THEN gridex_correction_process.customer_retention_tombstoned_v1(o.company_id,o.customer_id)
        ELSE false END AS blocked
    ) retention
    WHERE o.status='delivery_uncertain'
      AND NOT EXISTS(SELECT FROM known a WHERE a.company_id=o.company_id AND a.outbox_id=o.id)
  )
  SELECT w.id,w.company_id,w.to_email,w.subject,w.delivery_uncertain_at,w.email_type,
    w.withdrawal_uncertain_attempt_id,w.review_state,w.accepted_at,w.acceptance_token
  FROM work w ORDER BY w.sort_at,w.id LIMIT 20;
END $$;
END
$migration$;
