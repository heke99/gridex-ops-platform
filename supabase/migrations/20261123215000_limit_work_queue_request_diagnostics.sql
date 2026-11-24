-- Keep the invoker view, row boundaries and RPC shape. Only a current
-- canonical platform administrator can receive the two raw descriptions.
DO $migration$
DECLARE
  queue_view oid := to_regclass('public.gridex_work_queue_v');
  prior_search_path text := current_setting('search_path');
BEGIN
  PERFORM set_config('search_path', 'pg_catalog,pg_temp', true);
  IF queue_view IS NULL OR NOT EXISTS (
    SELECT 1
    FROM pg_class
    WHERE oid = queue_view AND relkind = 'v'
      AND reloptions = ARRAY['security_invoker=true']
  ) OR encode(sha256(convert_to(pg_get_viewdef(queue_view, false), 'UTF8')), 'hex') IS DISTINCT FROM
    '93f6722fd852b1c1dea13e329e6e5d353cb2f74043d0f12747ce84b7e7e1ef13'
  THEN
    RAISE EXCEPTION 'gridex_work_queue_view_predecessor_changed';
  END IF;

  CREATE OR REPLACE VIEW public.gridex_work_queue_v WITH (security_invoker='true') AS
   SELECT cb.id,
      cb.company_id,
      cb.customer_id,
      'Blockerare'::text AS source,
      COALESCE(c.customer_number, (cb.customer_id)::text) AS customer_number,
      COALESCE(NULLIF(c.company_name, ''::text), NULLIF(c.full_name, ''::text), NULLIF(TRIM(BOTH FROM concat_ws(' '::text, c.first_name, c.last_name)), ''::text), c.email, 'Kund utan namn'::text) AS customer_label,
      COALESCE(NULLIF(cb.title, ''::text), replace(COALESCE(cb.blocker_type, 'blocker'::text), '_'::text, ' '::text)) AS title,
      COALESCE(NULLIF(cb.description, ''::text), replace(COALESCE(cb.blocker_type, 'blocker'::text), '_'::text, ' '::text)) AS description,
      COALESCE(cb.status, 'open'::text) AS status,
          CASE
              WHEN (cb.severity = 'critical'::text) THEN 'critical'::text
              WHEN (cb.severity = 'warning'::text) THEN 'high'::text
              ELSE 'normal'::text
          END AS priority,
      cb.created_at,
      ('/admin/customers/'::text || (cb.customer_id)::text) AS href,
      'Öppna kundkort'::text AS action_label
     FROM (public.customer_blockers cb
       JOIN public.customers c ON (((c.id = cb.customer_id) AND (c.company_id = cb.company_id))))
    WHERE ((cb.status = ANY (ARRAY['open'::text, 'pending_review'::text, 'action_required'::text])) AND (COALESCE(c.source, ''::text) <> 'ediel_portal_test'::text) AND (COALESCE(c.status, ''::text) <> ALL (ARRAY['archived'::text, 'deleted'::text, 'deleted_test_only'::text, 'pending_deletion'::text])))
  UNION ALL
   SELECT cir.id,
      cir.company_id,
      cir.customer_id,
      'Uppgiftsbegäran'::text AS source,
      COALESCE(c.customer_number, (cir.customer_id)::text) AS customer_number,
      COALESCE(NULLIF(c.company_name, ''::text), NULLIF(c.full_name, ''::text), NULLIF(TRIM(BOTH FROM concat_ws(' '::text, c.first_name, c.last_name)), ''::text), c.email, 'Kund utan namn'::text) AS customer_label,
      ('Väntar på '::text ||
          CASE
              WHEN (cir.target_party_type = 'current_supplier'::text) THEN 'nuvarande leverantör'::text
              WHEN (cir.target_party_type = 'grid_owner'::text) THEN 'nätägare'::text
              ELSE 'kund'::text
          END) AS title,
      CASE
              WHEN (SELECT public.gridex_user_is_platform_admin()) THEN
                  COALESCE(NULLIF(cir.blocker_reason, ''), NULLIF(cir.notes, ''),
                      replace(COALESCE(cir.request_type, 'uppgiftsbegäran'), '_', ' '))
              WHEN cir.status = 'missing_authorization' THEN 'Fullmakt saknas.'
              WHEN cir.status = 'route_missing' THEN 'Utskicksväg saknas.'
              ELSE 'Öppna uppgiftsbegäran för att följa statusen.'
          END AS description,
      COALESCE(cir.status, 'pending'::text) AS status,
          CASE
              WHEN (cir.status = ANY (ARRAY['missing_authorization'::text, 'blocked'::text, 'negative_aperak'::text, 'route_missing'::text])) THEN 'high'::text
              ELSE 'normal'::text
          END AS priority,
      cir.created_at,
      (('/admin/customers/'::text || (cir.customer_id)::text) || '?tab=data-requests'::text) AS href,
      'Öppna uppgiftsbegäran'::text AS action_label
     FROM (public.customer_info_requests cir
       JOIN public.customers c ON (((c.id = cir.customer_id) AND (c.company_id = cir.company_id))))
    WHERE ((cir.status = ANY (ARRAY['open'::text, 'new'::text, 'pending'::text, 'pending_review'::text, 'action_required'::text, 'missing_authorization'::text, 'blocked'::text, 'route_missing'::text, 'manual_review_required'::text, 'failed'::text, 'sent'::text, 'waiting_for_z02'::text, 'waiting_response'::text])) AND (COALESCE(c.source, ''::text) <> 'ediel_portal_test'::text) AND (COALESCE(c.status, ''::text) <> ALL (ARRAY['archived'::text, 'deleted'::text, 'deleted_test_only'::text, 'pending_deletion'::text])))
  UNION ALL
   SELECT gor.id,
      gor.company_id,
      gor.customer_id,
      'Nätägare'::text AS source,
      COALESCE(c.customer_number, (gor.customer_id)::text) AS customer_number,
      COALESCE(NULLIF(c.company_name, ''::text), NULLIF(c.full_name, ''::text), NULLIF(TRIM(BOTH FROM concat_ws(' '::text, c.first_name, c.last_name)), ''::text), c.email, 'Kund utan namn'::text) AS customer_label,
      'Begäran till nätägare'::text AS title,
      CASE
              WHEN (SELECT public.gridex_user_is_platform_admin()) THEN
                  COALESCE(NULLIF(gor.failure_reason, ''), NULLIF(gor.notes, ''),
                      replace(COALESCE(gor.request_scope, 'uppgiftsbegäran'), '_', ' '))
              ELSE 'Kontrollera nätägarbegäran innan du går vidare.'
          END AS description,
      COALESCE(gor.status, 'pending'::text) AS status,
          CASE
              WHEN (gor.status = 'failed'::text) THEN 'high'::text
              ELSE 'normal'::text
          END AS priority,
      gor.created_at,
      (('/admin/customers/'::text || (gor.customer_id)::text) || '?tab=data-requests'::text) AS href,
      'Öppna kundkort'::text AS action_label
     FROM (public.grid_owner_data_requests gor
       JOIN public.customers c ON (((c.id = gor.customer_id) AND (c.company_id = gor.company_id))))
    WHERE ((gor.status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text])) AND (COALESCE(c.source, ''::text) <> 'ediel_portal_test'::text) AND (COALESCE(c.status, ''::text) <> ALL (ARRAY['archived'::text, 'deleted'::text, 'deleted_test_only'::text, 'pending_deletion'::text])))
  UNION ALL
   SELECT cot.id,
      cot.company_id,
      cot.customer_id,
      'Ärende'::text AS source,
      COALESCE(c.customer_number, (cot.customer_id)::text) AS customer_number,
      COALESCE(NULLIF(c.company_name, ''::text), NULLIF(c.full_name, ''::text), NULLIF(TRIM(BOTH FROM concat_ws(' '::text, c.first_name, c.last_name)), ''::text), c.email, 'Kund utan namn'::text) AS customer_label,
      COALESCE(NULLIF(cot.title, ''::text), replace(COALESCE(cot.task_type, 'åtgärd'::text), '_'::text, ' '::text)) AS title,
      COALESCE(NULLIF(cot.description, ''::text), replace(COALESCE(cot.task_type, 'åtgärd'::text), '_'::text, ' '::text)) AS description,
      COALESCE(cot.status, 'open'::text) AS status,
          CASE
              WHEN (cot.priority = ANY (ARRAY['critical'::text, 'high'::text, 'low'::text])) THEN cot.priority
              ELSE 'normal'::text
          END AS priority,
      cot.created_at,
      ('/admin/customers/'::text || (cot.customer_id)::text) AS href,
      'Öppna kundkort'::text AS action_label
     FROM (public.customer_operation_tasks cot
       JOIN public.customers c ON (((c.id = cot.customer_id) AND (c.company_id = cot.company_id))))
    WHERE ((cot.status = ANY (ARRAY['open'::text, 'new'::text, 'pending'::text, 'action_required'::text])) AND (COALESCE(c.source, ''::text) <> 'ediel_portal_test'::text) AND (COALESCE(c.status, ''::text) <> ALL (ARRAY['archived'::text, 'deleted'::text, 'deleted_test_only'::text, 'pending_deletion'::text])))
  UNION ALL
   SELECT ssr.id,
      ssr.company_id,
      ssr.customer_id,
      'Leverantörsbyte'::text AS source,
      COALESCE(c.customer_number, (ssr.customer_id)::text) AS customer_number,
      COALESCE(NULLIF(c.company_name, ''::text), NULLIF(c.full_name, ''::text), NULLIF(TRIM(BOTH FROM concat_ws(' '::text, c.first_name, c.last_name)), ''::text), c.email, 'Kund utan namn'::text) AS customer_label,
      'Leverantörsbyte behöver uppföljning'::text AS title,
      replace(COALESCE(ssr.request_type, 'supplier_switch'::text), '_'::text, ' '::text) AS description,
      COALESCE(ssr.status, 'pending'::text) AS status,
          CASE
              WHEN (ssr.status = ANY (ARRAY['accepted'::text, 'ready'::text])) THEN 'high'::text
              ELSE 'normal'::text
          END AS priority,
      ssr.created_at,
      (('/admin/customers/'::text || (ssr.customer_id)::text) || '?tab=supplier-switch'::text) AS href,
      'Öppna leverantörsbyte'::text AS action_label
     FROM (public.supplier_switch_requests ssr
       JOIN public.customers c ON (((c.id = ssr.customer_id) AND (c.company_id = ssr.company_id))))
    WHERE ((ssr.status = ANY (ARRAY['draft'::text, 'ready'::text, 'queued'::text, 'submitted'::text, 'accepted'::text, 'pending'::text, 'open'::text])) AND (COALESCE(c.source, ''::text) <> 'ediel_portal_test'::text) AND (COALESCE(c.status, ''::text) <> ALL (ARRAY['archived'::text, 'deleted'::text, 'deleted_test_only'::text, 'pending_deletion'::text])));
  PERFORM set_config('search_path', prior_search_path, true);
END
$migration$;
