-- Portal advisory status. Transport and activation continue to own their decisions.
CREATE FUNCTION public.gridex_read_supplier_switch_status_basis_v1(
  p_company_id uuid, p_customer_ids uuid[]
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path TO pg_catalog
SET TimeZone TO 'Europe/Stockholm'
AS $$
DECLARE
  checked_at constant timestamptz := statement_timestamp();
  civil_today constant date := (checked_at AT TIME ZONE 'Europe/Stockholm')::date;
  selected record;
  decision jsonb;
  unknown_basis constant jsonb := '{"ready":false,"fullmakt":"unverified"}'::jsonb;
BEGIN
  IF p_company_id IS NULL OR cardinality(p_customer_ids) IS NULL OR cardinality(p_customer_ids) = 0 THEN
    RETURN unknown_basis;
  END IF;

  SELECT min(rows.customer_id::text)::uuid AS customer_id, min(rows.id::text)::uuid AS contract_id
  INTO selected
  FROM (
    SELECT c.id, c.customer_id
    FROM public.customer_contracts c
    WHERE c.company_id = p_company_id AND c.customer_id = ANY(p_customer_ids)
      AND c.status IN ('signed','pending_supplier_switch','pending_switch','pending_start')
      AND (c.ends_at IS NULL OR c.ends_at >= civil_today)
    LIMIT 2
  ) rows
  HAVING count(*) = 1;
  IF NOT FOUND THEN RETURN unknown_basis; END IF;

  -- The canonical owner holds the same customer row as retention writers.
  PERFORM public.ediel_require_portal_retention_access_v1(p_company_id, selected.customer_id);

  WITH candidates AS MATERIALIZED (
    SELECT c.id, c.company_id, c.customer_id, c.site_id, c.customer_site_id, c.metering_point_id,
      c.legal_bundle_version_id, c.ends_at, coalesce(c.customer_site_id,c.site_id) AS exact_site,
      coalesce(c.requested_start_date,c.expected_start_at,c.starts_at) AS planned_start
    FROM public.customer_contracts c
    WHERE c.company_id = p_company_id AND c.customer_id = ANY(p_customer_ids)
      AND c.status IN ('signed','pending_supplier_switch','pending_switch','pending_start')
      AND (c.ends_at IS NULL OR c.ends_at >= civil_today)
    LIMIT 2
  ), agreement AS (
    SELECT c.*
    FROM candidates c
    WHERE (SELECT count(*) FROM candidates) = 1
      AND c.id = selected.contract_id AND c.customer_id = selected.customer_id
      AND c.exact_site IS NOT NULL AND c.legal_bundle_version_id IS NOT NULL
      AND (c.customer_site_id IS NULL OR c.site_id IS NULL OR c.customer_site_id = c.site_id)
      AND c.planned_start IS NOT NULL AND (c.ends_at IS NULL OR c.ends_at >= c.planned_start)
  ), points AS MATERIALIZED (
    SELECT m.id
    FROM agreement c
    JOIN public.metering_points m ON m.company_id = c.company_id AND m.customer_id = c.customer_id
      AND (m.site_id = c.exact_site OR m.customer_site_id = c.exact_site)
      AND (c.metering_point_id IS NULL OR m.id = c.metering_point_id)
    LIMIT 2
  ), portal_basis AS (
    SELECT c.*, m.id AS point_id
    FROM agreement c
    JOIN public.metering_points m ON (SELECT count(*) FROM points) = 1 AND m.id = (SELECT id FROM points LIMIT 1)
      AND coalesce(m.customer_site_id,m.site_id) = c.exact_site
      AND (m.customer_site_id IS NULL OR m.site_id IS NULL OR m.customer_site_id = m.site_id)
      AND m.status NOT IN ('inactive','closed')
      AND (m.start_date IS NULL OR m.start_date <= c.planned_start)
      AND (m.end_date IS NULL OR m.end_date >= c.planned_start)
  ), fullmakt AS (
    SELECT c.*, coalesce(history.signed, false) AS observed_signed,
      coalesce(history.signed AND history.current AND EXISTS (
        SELECT 1 FROM public.customer_authorization_documents d
        JOIN public.authorization_scopes s ON s.company_id = d.company_id
          AND s.customer_id = d.customer_id AND s.authorization_document_id = d.id
        WHERE d.company_id = c.company_id AND d.customer_id = c.customer_id AND d.site_id = c.exact_site
          AND d.power_of_attorney_id = history.id AND d.status IN ('active','signed')
          AND (d.customer_contract_id IS NULL OR d.customer_contract_id = c.id)
          AND (d.metering_point_id IS NULL OR d.metering_point_id = c.point_id)
          AND (history.metering_point_id = c.point_id OR (history.metering_point_id IS NULL AND (
            c.metering_point_id IS NULL OR
            (d.id = history.document_id AND d.metering_point_id = c.point_id AND d.customer_contract_id = c.id)
          )))
          AND s.status = 'active' AND s.revoked_at IS NULL AND s.covers_current_supplier_contract
          AND (s.valid_from IS NULL OR s.valid_from <= civil_today)
          AND (s.valid_to IS NULL OR s.valid_to >= civil_today)
      ), false) AS effective
    FROM portal_basis c
    LEFT JOIN LATERAL (
      SELECT p.id, p.document_id, p.metering_point_id,
        p.status = 'signed' AND coalesce(p.accepted_at,p.signed_at) <= checked_at
          AND (p.contract_id IS NULL OR p.customer_contract_id IS NULL OR p.contract_id = p.customer_contract_id)
          AND (p.site_id IS NULL OR p.customer_site_id IS NULL OR p.site_id = p.customer_site_id)
          AND (p.metering_point_id IS NULL OR p.metering_point_id = c.point_id)
          AS signed,
        p.revoked_at IS NULL AND (p.valid_from IS NULL OR p.valid_from <= civil_today)
          AND (p.valid_to IS NULL OR p.valid_to >= civil_today)
          AND (p.valid_until IS NULL OR p.valid_until >= civil_today)
          AND (p.expires_at IS NULL OR checked_at < p.expires_at)
          AS current
      FROM public.powers_of_attorney p
      WHERE p.company_id = c.company_id AND p.customer_id = c.customer_id AND p.scope = 'supplier_switch'
        AND (p.contract_id = c.id OR p.customer_contract_id = c.id)
        AND (p.site_id = c.exact_site OR p.customer_site_id = c.exact_site)
      ORDER BY p.created_at DESC,p.id DESC
      LIMIT 1
    ) history ON true
  )
  SELECT jsonb_build_object(
    'ready', f.effective AND EXISTS (
      SELECT 1 FROM public.customer_contract_lifecycle_readiness_v v
      WHERE v.company_id = f.company_id AND v.customer_id = f.customer_id AND v.customer_contract_id = f.id
        AND v.customer_site_id = f.exact_site AND v.metering_point_id IS NOT DISTINCT FROM f.metering_point_id
        AND v.switch_ready IS TRUE AND cardinality(v.blockers) = 0
        AND v.legal_document_count BETWEEN 1 AND 100 AND v.legal_document_count = v.accepted_document_count
        AND NOT EXISTS (
          SELECT 1 FROM public.legal_bundle_version_documents d
          WHERE d.legal_bundle_version_id = f.legal_bundle_version_id
            AND (d.content_sha256 !~ '^[a-f0-9]{64}$' OR NOT EXISTS (
              SELECT 1 FROM public.customer_legal_acceptances a
              WHERE a.company_id = f.company_id AND a.customer_id = f.customer_id AND a.contract_id = f.id
                AND a.legal_bundle_version_document_id = d.id AND a.legal_document_sha256 = d.content_sha256
                AND a.accepted_at <= checked_at
            ))
        )
    ),
    'fullmakt', CASE WHEN f.effective THEN 'effective' WHEN f.observed_signed THEN 'signed_unverified' ELSE 'unverified' END
  ) INTO decision FROM fullmakt f;
  RETURN coalesce(decision, unknown_basis);
END
$$;

REVOKE ALL ON FUNCTION public.gridex_read_supplier_switch_status_basis_v1(uuid,uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_read_supplier_switch_status_basis_v1(uuid,uuid[]) TO service_role;
