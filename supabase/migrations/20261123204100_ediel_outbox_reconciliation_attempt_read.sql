-- Keep creation and the service-only grant atomic with the migration ledger.
DO $ediel_attempt_read_migration$
BEGIN
CREATE FUNCTION public.gridex_read_ediel_outbox_reconciliation_attempt_v1(
  p_outbox_id uuid, p_claim_id uuid, p_company_id uuid
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'pg_catalog'
AS $rpc$
  SELECT jsonb_build_object(
    'outboxId', o.id, 'claimId', o.current_send_attempt_id,
    'messageId', o.ediel_message_id, 'environment', o.environment,
    'journalStatus', CASE
      WHEN j.matched = 0 THEN 'not_recorded'
      WHEN j.matched <> 1 THEN 'ambiguous'
      WHEN j.classification = 'accepted' AND j.entered IS NOT NULL AND j.observed IS NOT NULL THEN 'provider_accepted'
      WHEN j.entered IS NOT NULL THEN 'entered'
      ELSE 'prepared'
    END,
    'journalId', CASE WHEN j.matched = 1 THEN j.attempt_id END,
    'enteredAt', CASE WHEN j.matched = 1 THEN j.entered END,
    'observedAt', CASE WHEN j.matched = 1 THEN j.observed END)
  FROM public.ediel_outbox o
  CROSS JOIN LATERAL (
    SELECT count(*) AS matched, min(a.id::text) AS attempt_id, max(a.classification) AS classification,
           max(a.entered_at) AS entered, max(a.observed_at) AS observed
    FROM gridex_ediel_transport.attempts a
    WHERE a.company_id = o.company_id AND a.environment = o.environment
      AND a.message_id = o.ediel_message_id
      AND a.owner @> jsonb_build_object('kind','worker','outboxId',o.id,'sendAttemptId',o.current_send_attempt_id)
  ) j
  WHERE o.id = p_outbox_id AND o.current_send_attempt_id = p_claim_id
    AND o.company_id IS NOT NULL AND (p_company_id IS NULL OR o.company_id = p_company_id)
    AND o.status = 'delivery_uncertain'
$rpc$;
REVOKE ALL ON FUNCTION public.gridex_read_ediel_outbox_reconciliation_attempt_v1(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_read_ediel_outbox_reconciliation_attempt_v1(uuid,uuid,uuid) TO service_role;
END
$ediel_attempt_read_migration$;
