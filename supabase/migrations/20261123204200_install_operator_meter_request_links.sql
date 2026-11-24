-- Keep schema, view privileges, and CLI migration receipt in one transaction.
SET lock_timeout = '5s';
SET statement_timeout = '60s';
DO $gridex_staff_read_view$
BEGIN
CREATE VIEW public.gridex_operator_meter_request_links_v1
WITH (security_invoker = true) AS
WITH meter_sources AS (
  SELECT m.id, m.company_id, m.customer_id, request.id AS request_id,
         coalesce(m.is_current AND m.raw_payload->>'inboundEmailMessageId' = request.response_payload->>'inboundEmailMessageId'
           AND m.raw_payload->>'parseResultId' = request.response_payload->>'parseResultId', false) AS receipt_value_saved
  FROM public.metering_values m
  CROSS JOIN LATERAL (
    SELECT m.source_request_id AS id
    UNION
    SELECT transport.source_id
    FROM public.outbound_requests transport
    WHERE m.source_system = 'ediel_utilts_inbound_mail'
      AND transport.id = m.source_request_id
      AND transport.company_id = m.company_id
      AND transport.customer_id = m.customer_id
      AND transport.source_type = 'grid_owner_data_request'
  ) candidate
  JOIN public.grid_owner_data_requests request
    ON request.id = candidate.id
   AND request.company_id = m.company_id
   AND request.customer_id = m.customer_id
   AND (request.metering_point_id IS NULL OR request.metering_point_id = m.metering_point_id)
),
task_sources AS (
  SELECT task.id, task.company_id, task.customer_id, request.id AS request_id
  FROM public.customer_operation_tasks task
  JOIN public.outbound_requests transport
    ON transport.id = CASE WHEN task.metadata->>'sourceId' ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
                           THEN (task.metadata->>'sourceId')::uuid END
   AND transport.company_id = task.company_id
   AND transport.customer_id = task.customer_id
   AND transport.source_type = 'grid_owner_data_request'
  JOIN public.grid_owner_data_requests request
    ON request.id = transport.source_id
   AND request.company_id = task.company_id
   AND request.customer_id = task.customer_id
   AND (request.metering_point_id IS NULL OR request.metering_point_id = task.metering_point_id)
  WHERE task.task_type = 'ediel_utilts_meter_value_review'
    AND task.metadata #>> '{outbound,source_type}' = 'grid_owner_data_request'
    AND task.metadata #>> '{outbound,source_id}' = request.id::text
    AND task.metadata->>'inboundEmailMessageId' = request.response_payload->>'inboundEmailMessageId'
    AND task.metadata->>'parseResultId' = request.response_payload->>'parseResultId'
    AND task.metadata->>'inboundFamily' = 'UTILTS'
    AND task.metadata->>'inboundCode' = 'E66'
)
SELECT 'meter_value'::text AS source, id, company_id, customer_id, (array_agg(request_id))[1] AS request_id, bool_or(receipt_value_saved) AS receipt_value_saved
FROM meter_sources GROUP BY id,company_id,customer_id HAVING count(*) = 1
UNION ALL
SELECT 'operation_task', id, company_id, customer_id, request_id, false FROM task_sources;
REVOKE ALL ON public.gridex_operator_meter_request_links_v1 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.gridex_operator_meter_request_links_v1 TO authenticated, service_role;
END
$gridex_staff_read_view$;
RESET statement_timeout;
RESET lock_timeout;
