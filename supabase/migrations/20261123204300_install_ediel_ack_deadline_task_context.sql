-- Keep schema, view privileges, and CLI migration receipt in one transaction.
SET lock_timeout = '5s';
SET statement_timeout = '60s';
DO $gridex_staff_read_view$
BEGIN
CREATE VIEW public.gridex_ediel_ack_deadline_task_context_v1
WITH (security_invoker = true) AS
SELECT task.id, task.company_id, task.customer_id, request.id AS request_id,
       (request.acknowledged_at IS NOT NULL OR
        request.status IN ('syntax_rejected','application_rejected','confirmed','business_response_received')) AS answered
  FROM public.customer_operation_tasks task
  JOIN public.outbound_requests request
    ON request.company_id = task.company_id
   AND request.customer_id = task.customer_id
   AND request.id = CASE
     WHEN task.metadata->>'sourceId' ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
     THEN (task.metadata->>'sourceId')::uuid
   END
 WHERE task.task_type = 'ediel_ack_overdue'
   AND task.metadata @> '{"monitor":"ack_overdue","createdBy":"batch_7a_overdue_monitor"}'::jsonb;
REVOKE ALL ON public.gridex_ediel_ack_deadline_task_context_v1 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.gridex_ediel_ack_deadline_task_context_v1 TO authenticated, service_role;
END
$gridex_staff_read_view$;
RESET statement_timeout;
RESET lock_timeout;
