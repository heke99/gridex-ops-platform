-- Read-only excerpt from artifact11334955859; NOT a migration or newly executed query.
CREATE VIEW public.ediel_message_ack_state_v WITH (security_invoker='true') AS
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

CREATE VIEW public.ediel_overdue_message_acks_v WITH (security_invoker='true') AS
 SELECT id,
    company_id,
    direction,
    message_family,
    message_code,
    message_version,
    status,
    environment,
    requires_contrl,
    requires_aperak,
    contrl_status,
    aperak_status,
    utilts_err_status,
    ack_due_at,
    message_sent_at,
    message_received_at,
    acknowledged_at,
    failed_at,
    canonical_ack_state
   FROM public.ediel_message_ack_state_v
  WHERE (canonical_ack_state = 'ack_overdue'::text);
