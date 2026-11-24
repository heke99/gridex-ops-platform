CREATE FUNCTION public.gridex_customer_segments_page_v1(
  p_company_id uuid,
  p_query text,
  p_segment text,
  p_page integer,
  p_page_size integer
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_context jsonb;
  v_platform boolean;
  v_result jsonb;
  v_query text;
BEGIN
  IF p_query IS NULL OR length(p_query) > 300
     OR p_segment IS NULL OR p_segment NOT IN ('all', 'signed', 'pending_activation', 'move', 'switch')
     OR p_page IS NULL OR p_page NOT BETWEEN 1 AND 1000000
     OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'customer_segments_invalid_selection' USING ERRCODE = '22023';
  END IF;

  v_context := public.canonical_authenticated_tenant_context(p_company_id);
  v_platform := v_context->'is_platform_admin' = 'true'::jsonb;
  IF v_context->'authorized' IS DISTINCT FROM 'true'::jsonb OR NOT coalesce(v_platform, false) AND (
    p_company_id IS NULL OR v_context->>'selected_company_id' IS DISTINCT FROM p_company_id::text
    OR NOT coalesce((v_context->'permissions') ?| ARRAY['customers.read', 'reports.read'], false)
  ) THEN
    RAISE EXCEPTION 'customer_segments_forbidden' USING ERRCODE = '42501';
  END IF;

  v_query := lower(btrim(p_query));
  WITH matches AS MATERIALIZED (
    SELECT c.id, c.company_id, c.created_at,
      EXISTS (
        SELECT FROM public.customer_contracts k WHERE k.company_id = c.company_id AND k.customer_id = c.id
          AND k.status IN ('signed', 'active')
      ) AS signed,
      (EXISTS (
        SELECT FROM public.customer_contracts k WHERE k.company_id = c.company_id AND k.customer_id = c.id
          AND k.status IN ('pending_signature', 'signed')
      ) OR EXISTS (
        SELECT FROM public.customer_sites s WHERE s.company_id = c.company_id AND s.customer_id = c.id
          AND s.status IN ('pending_activation', 'pending_move')
      )) AS pending_activation,
      EXISTS (
        SELECT FROM public.supplier_switch_requests r WHERE r.company_id = c.company_id AND r.customer_id = c.id
          AND r.request_type IN ('move_in', 'move_out_takeover')
          AND r.status NOT IN ('completed', 'failed', 'rejected', 'cancelled', 'cancelled_before_start')
      ) AS move,
      EXISTS (
        SELECT FROM public.supplier_switch_requests r WHERE r.company_id = c.company_id AND r.customer_id = c.id
          AND r.request_type = 'switch'
          AND r.status NOT IN ('completed', 'failed', 'rejected', 'cancelled', 'cancelled_before_start')
      ) AS switch
    FROM public.customers c
    WHERE c.company_id IS NOT NULL AND (p_company_id IS NULL OR c.company_id = p_company_id)
      AND c.source IS DISTINCT FROM 'ediel_portal_test'
      AND (c.status IS NULL OR c.status NOT IN ('archived', 'deleted', 'deleted_test_only', 'pending_deletion'))
      AND (v_query = '' OR EXISTS (
        SELECT FROM unnest(ARRAY[c.full_name, c.company_name, c.email, c.phone, c.personal_number, c.org_number,
          c.customer_number, c.first_name, c.last_name]) AS fields(value)
        WHERE strpos(lower(fields.value), v_query) > 0
      ))
  ), counts AS (
    SELECT jsonb_build_object(
      'all', count(*), 'signed', count(*) FILTER (WHERE signed),
      'pending_activation', count(*) FILTER (WHERE pending_activation),
      'move', count(*) FILTER (WHERE move), 'switch', count(*) FILTER (WHERE switch)
    ) AS payload FROM matches
  ), selection AS (
    SELECT least(p_page, greatest(1, ((payload->>p_segment)::bigint + p_page_size - 1) / p_page_size)) AS page
    FROM counts
  ), page_ids AS (
    SELECT id, company_id FROM matches
    WHERE CASE p_segment WHEN 'signed' THEN signed WHEN 'pending_activation' THEN pending_activation
      WHEN 'move' THEN move WHEN 'switch' THEN switch ELSE true END
    ORDER BY created_at DESC NULLS LAST, id DESC
    LIMIT p_page_size OFFSET (SELECT (page - 1) * p_page_size FROM selection)
  ), page_rows AS (
    SELECT c.id, c.company_id, c.full_name, c.company_name, c.first_name, c.last_name, c.customer_number,
      coalesce(c.customer_type, 'private') AS customer_type, coalesce(c.status, 'draft') AS status,
      c.email, c.phone, coalesce(c.created_at, '1970-01-01T00:00:00Z'::timestamptz) AS created_at,
      sites.site_count, sites.active_site_count
    FROM page_ids ids
    JOIN public.customers c ON c.id = ids.id AND c.company_id = ids.company_id
    CROSS JOIN LATERAL (
      SELECT count(*) AS site_count, count(*) FILTER (WHERE s.status = 'active') AS active_site_count
      FROM public.customer_sites s WHERE s.customer_id = c.id AND s.company_id = c.company_id
    ) sites
  )
  SELECT jsonb_build_object('counts', counts.payload, 'page', selection.page,
    'rows', coalesce((SELECT jsonb_agg(page_rows ORDER BY created_at DESC, id DESC) FROM page_rows), '[]'::jsonb))
  INTO v_result FROM counts CROSS JOIN selection;

  RETURN v_result;
END
$$;

REVOKE ALL ON FUNCTION public.gridex_customer_segments_page_v1(uuid,text,text,integer,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gridex_customer_segments_page_v1(uuid,text,text,integer,integer) TO authenticated;
