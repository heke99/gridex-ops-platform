-- Expose only a single exact original when every saved link can still be qualified.
CREATE FUNCTION public.gridex_read_billing_ediel_blocker_sources_v1(
  p_actor_user_id uuid, p_company_id uuid, p_underlay_ids uuid[]
)
RETURNS TABLE (underlay_id uuid, source_message_id uuid)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO pg_catalog
AS $function$
  SELECT u.id, matched.sources[1]
  FROM public.billing_underlays u
  CROSS JOIN LATERAL (
    SELECT array_agg(matches.id) AS sources
    FROM (
      SELECT DISTINCT source.id
      FROM public.billing_underlay_items item
      JOIN public.normalized_metering_values value ON value.id=item.source_normalized_metering_value_id
        AND value.company_id=u.company_id AND value.customer_id=u.customer_id
        AND value.metering_point_id=u.metering_point_id AND value.supply_period_id=u.supply_period_id
        AND value.revision_status='current' AND value.billing_gate_status IN ('blocked','conflict')
        AND value.billing_gate_reasons @> '[{"code":"source_basis_unqualified"}]'::jsonb
        AND item.period_start>=value.period_start AND item.period_end<=value.period_end
      JOIN public.ediel_messages source ON source.id=value.source_message_id AND source.company_id=u.company_id
        AND source.customer_id=u.customer_id AND source.metering_point_id=u.metering_point_id
        AND source.direction='inbound' AND source.message_family='UTILTS' AND source.message_code='E66'
        AND source.environment='production' AND source.test_flag=0
        AND source.raw_payload IS NOT NULL
        AND source.immutable_payload_hash=encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex')
      WHERE item.company_id=u.company_id AND item.customer_id=u.customer_id
        AND item.metering_point_id=u.metering_point_id AND item.billing_underlay_id=u.id
        AND item.source_table='normalized_metering_values'
        AND EXISTS (
          SELECT FROM public.ediel_unresolved_items issue WHERE issue.source_message_id=source.id
            AND issue.company_id=u.company_id AND issue.status='open' AND issue.issue_type='billing_gate_blocked'
            AND issue.extracted_identifiers @> jsonb_build_object(
              'normalizedValueId',value.id,'meteringPointId',value.metering_point_id,
              'supplyPeriodIds',jsonb_build_array(value.supply_period_id),
              'reasonCodes',jsonb_build_array('source_basis_unqualified')
            )
        )
      LIMIT 2
    ) matches
  ) matched
  WHERE public.canonical_actor_is_platform_admin(p_actor_user_id)
    AND coalesce(cardinality(p_underlay_ids),0) BETWEEN 1 AND 100
    AND u.company_id=p_company_id AND u.id=ANY(p_underlay_ids)
    AND u.status='pending' AND u.readiness_status='blocked'
    AND cardinality(matched.sources)=1;
$function$;
REVOKE ALL ON FUNCTION public.gridex_read_billing_ediel_blocker_sources_v1(uuid,uuid,uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_read_billing_ediel_blocker_sources_v1(uuid,uuid,uuid[]) TO service_role;

-- Minimal current customer-facing summary. A separately published invoice
-- for this same underlay takes precedence over an older retained blocker.
CREATE FUNCTION public.gridex_list_portal_billing_review_months_v1(
  p_company_id uuid,p_customer_ids uuid[],p_last_year integer,p_last_month integer
)
RETURNS TABLE(year integer,month integer)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO pg_catalog
AS $function$
  SELECT DISTINCT u.underlay_year,u.underlay_month
  FROM public.billing_underlays u
  JOIN public.customers c ON c.id=u.customer_id AND c.company_id=u.company_id
  WHERE p_last_year BETWEEN 2000 AND 2100
    AND p_last_month BETWEEN 1 AND 12
    AND coalesce(cardinality(p_customer_ids),0) BETWEEN 1 AND 100
    AND u.company_id=p_company_id AND u.customer_id=ANY(p_customer_ids)
    AND (u.underlay_year,u.underlay_month) <= (p_last_year,p_last_month)
    AND u.underlay_month BETWEEN 1 AND 12
    AND u.status='pending' AND u.readiness_status='blocked'
    AND u.billing_block_reason ~ '(^|;)[[:space:]]*source_basis_unqualified([[:space:]]*[;:]|[[:space:]]*$)'
    AND NOT EXISTS (
      SELECT FROM public.customer_invoices i WHERE i.company_id=u.company_id AND i.customer_id=u.customer_id
        AND i.status IN ('issued','sent','paid','overdue','cancelled','credited')
        AND (i.billing_underlay_id=u.id OR EXISTS (
          SELECT FROM public.invoice_export_items e WHERE e.company_id=u.company_id AND e.customer_id=u.customer_id
            AND e.billing_underlay_id=u.id AND e.id IN (i.invoice_export_item_id,i.canonical_export_item_id)
        ))
    )
  ORDER BY u.underlay_year DESC,u.underlay_month DESC
  LIMIT 3;
$function$;
REVOKE ALL ON FUNCTION public.gridex_list_portal_billing_review_months_v1(uuid,uuid[],integer,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_list_portal_billing_review_months_v1(uuid,uuid[],integer,integer)
  TO service_role;
