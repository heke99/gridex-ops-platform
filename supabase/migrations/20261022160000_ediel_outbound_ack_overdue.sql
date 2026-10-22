-- GOR-05 (reality scenario I): a sent outbound Ediel message whose CONTRL/APERAK never arrives is overdue.
--
-- ediel_message_ack_state_v ranked awaiting_contrl/awaiting_aperak before ack_overdue, so a message still
-- waiting for the counterparty's acknowledgement could never become ack_overdue and never appeared in
-- ediel_overdue_message_acks_v (the ACK SLA monitor's source). A grid owner that stays silent on our Z03
-- therefore left the request pending forever (TM-CONTRL, ENV-04 "samma kvittensbeslut i kuvert och bevakning").
--
-- Forward-only change of one CASE branch, placed directly after 'failed': an OUTBOUND message that was actually
-- sent (message_sent_at), whose ack deadline has passed, that is not acknowledged and still has a required
-- CONTRL or APERAK pending, is 'ack_overdue'. Inbound rows and every other branch keep their previous result.
-- Columns, column order, security_invoker and grants are unchanged (CREATE OR REPLACE keeps existing grants);
-- the dependent ediel_overdue_message_acks_v selects the same columns and needs no change.
-- Overdue is display/escalation only: it authorizes no resend (TR-05 "en utgången timer ensam är inget
-- tillstånd till automatisk ny sändning").
BEGIN;

CREATE OR REPLACE VIEW public.ediel_message_ack_state_v WITH (security_invoker='true') AS
 SELECT id,
    company_id,
    direction,
    message_family,
    COALESCE(message_code, ''::text) AS message_code,
    message_version,
    status,
    environment,
    COALESCE(requires_contrl, false) AS requires_contrl,
    COALESCE(requires_aperak, false) AS requires_aperak,
    contrl_status,
    aperak_status,
    utilts_err_status,
    ack_due_at,
    message_sent_at,
    message_received_at,
    acknowledged_at,
    failed_at,
        CASE
            WHEN (status = 'failed'::text) THEN 'failed'::text
            WHEN ((direction = 'outbound'::text) AND (message_sent_at IS NOT NULL) AND (ack_due_at IS NOT NULL) AND (ack_due_at < now())
              AND (acknowledged_at IS NULL)
              AND ((COALESCE(requires_contrl, false) AND (COALESCE(contrl_status, 'pending'::text) = 'pending'::text))
                OR (COALESCE(requires_aperak, false) AND (COALESCE(aperak_status, 'pending'::text) = 'pending'::text)))) THEN 'ack_overdue'::text
            WHEN (COALESCE(requires_contrl, false) AND (COALESCE(contrl_status, 'pending'::text) = 'pending'::text)) THEN 'awaiting_contrl'::text
            WHEN (COALESCE(contrl_status, ''::text) = 'failed'::text) THEN 'contrl_failed'::text
            WHEN (COALESCE(requires_aperak, false) AND (COALESCE(aperak_status, 'pending'::text) = 'pending'::text)) THEN 'awaiting_aperak'::text
            WHEN ((aperak_status = 'received'::text) AND (ack_outcome = 'negative'::text)) THEN 'aperak_received_negative'::text
            WHEN ((aperak_status = 'received'::text) AND (ack_outcome = 'positive'::text)) THEN 'aperak_received_positive'::text
            WHEN (COALESCE(utilts_err_status, ''::text) = 'received'::text) THEN 'utilts_err_received'::text
            WHEN ((ack_due_at IS NOT NULL) AND (ack_due_at < now()) AND (acknowledged_at IS NULL)) THEN 'ack_overdue'::text
            WHEN ((NOT COALESCE(requires_contrl, false)) AND (NOT COALESCE(requires_aperak, false))) THEN 'no_ack_required'::text
            ELSE 'in_progress'::text
        END AS canonical_ack_state
   FROM public.ediel_messages m;

COMMENT ON VIEW public.ediel_message_ack_state_v IS
  'Canonical ACK state per Ediel message. A sent outbound message past ack_due_at with a required CONTRL/APERAK still pending is ack_overdue (20261022160000, GOR-05); overdue authorizes no resend.';

COMMIT;
