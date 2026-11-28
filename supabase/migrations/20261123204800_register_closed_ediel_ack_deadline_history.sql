-- Apply this database owner and its migration receipt atomically.
SET lock_timeout = '5s';
SET statement_timeout = '60s';
DO $gridex_migration$
BEGIN
CREATE OR REPLACE FUNCTION public.gridex_list_closed_ack_deadline_history_v1(
  p_evaluated_at timestamptz,
  p_company_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 12
)
RETURNS TABLE (
  timer_id uuid, ediel_message_id uuid, timer_type text,
  status text, due_at timestamptz, evidence text
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO pg_catalog
AS $function$
  SELECT timer.id, timer.ediel_message_id, timer.timer_type, timer.status, timer.due_at,
    CASE WHEN physical_late.observed THEN 'late_contrl'
      WHEN history.event_state = 'expired' THEN 'expiry_recorded'
      ELSE 'breach_recorded' END
  FROM public.ediel_sla_timers timer
  JOIN public.ediel_messages source ON source.id = timer.ediel_message_id
    AND source.company_id = timer.company_id AND source.direction = 'inbound' AND source.message_standard = 'edifact'
  CROSS JOIN LATERAL (
    SELECT CASE WHEN (timer.payload #>> '{lateContrl,dueAt}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
      AND pg_input_is_valid(timer.payload #>> '{lateContrl,dueAt}', 'timestamp with time zone')
      THEN (timer.payload #>> '{lateContrl,dueAt}')::timestamptz END AS due_at,
      CASE WHEN (timer.payload #>> '{lateContrl,sentAt}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
      AND pg_input_is_valid(timer.payload #>> '{lateContrl,sentAt}', 'timestamp with time zone')
      THEN (timer.payload #>> '{lateContrl,sentAt}')::timestamptz END AS sent_at
  ) parsed
  CROSS JOIN LATERAL (
    SELECT COALESCE(timer.timer_type = 'contrl_due'
      AND jsonb_typeof(timer.payload -> 'lateContrl') = 'object'
      AND timer.payload #>> '{lateContrl,acknowledgementId}' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      AND parsed.due_at = timer.due_at AND parsed.sent_at > timer.due_at
      AND parsed.sent_at <= p_evaluated_at, false) AS observed
  ) physical_late
  LEFT JOIN LATERAL (
    SELECT event.payload ->> 'status' AS event_state
    FROM public.ediel_message_events event
    WHERE NOT physical_late.observed AND event.company_id = timer.company_id
      AND event.ediel_message_id = timer.ediel_message_id
      AND event.event_type = 'manual_note' AND event.event_status = 'error'
      AND event.created_at >= timer.due_at AND event.created_at <= p_evaluated_at
      AND event.payload ->> 'timerId' = timer.id::text
      AND event.payload ->> 'timerType' = timer.timer_type
      AND CASE WHEN (event.payload ->> 'dueAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
      AND pg_input_is_valid(event.payload ->> 'dueAt', 'timestamp with time zone')
        THEN (event.payload ->> 'dueAt')::timestamptz END = timer.due_at
      AND (
        (event.payload ->> 'status' = 'expired' AND event.message = 'Ediel SLA timer is now expired.')
        OR (timer.timer_type = 'contrl_due' AND event.payload ->> 'status' = 'resolved'
          AND event.payload ->> 'slaBreachFactKey' = 'contrl_due:' || timer.id::text || ':' || extract(epoch FROM timer.due_at)::text)
      )
    ORDER BY event.created_at DESC, event.id DESC
    LIMIT 1
  ) history ON true
  WHERE isfinite(p_evaluated_at) AND isfinite(timer.due_at) AND timer.due_at <= p_evaluated_at
    AND timer.company_id IS NOT NULL AND (p_company_id IS NULL OR timer.company_id = p_company_id)
    AND timer.status IN ('resolved', 'cancelled')
    AND (physical_late.observed OR history.event_state IS NOT NULL)
  ORDER BY timer.due_at DESC, timer.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 12), 1), 50)
$function$;
REVOKE ALL ON FUNCTION public.gridex_list_closed_ack_deadline_history_v1(timestamptz, uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gridex_list_closed_ack_deadline_history_v1(timestamptz, uuid, integer) TO service_role;
END
$gridex_migration$;
RESET statement_timeout;
RESET lock_timeout;
