-- Dedicated staff machine authentication. Website provisioning and api_sales
-- remain mandatory in the existing Website wrapper; they are not staff policy.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '180s';

DO $$ BEGIN
  IF to_regprocedure('public.authenticate_integration_request_v1_credential_core(text,text,text,text[],text[],text,text,integer,integer)') IS NULL THEN
    RAISE EXCEPTION 'Native integration credential core is required';
  END IF;
END $$;

CREATE FUNCTION public.authenticate_staff_integration_request_v1(
  p_key_prefix text, p_secret_hash text, p_method text, p_route text,
  p_required_all text[] DEFAULT ARRAY[]::text[],
  p_required_any text[] DEFAULT ARRAY[]::text[],
  p_client_ip text DEFAULT NULL, p_origin text DEFAULT NULL,
  p_rate_limit_cost integer DEFAULT 1, p_window_seconds integer DEFAULT 60
) RETURNS TABLE (
  auth_outcome text, error_code text, tenant_status text,
  client_id uuid, company_id uuid, client_name text, client_status text,
  key_prefix text, scopes text[], allowed_ips text[], allowed_origins text[],
  metadata jsonb, rate_limit_per_minute integer, expires_at timestamptz,
  request_count integer, route_limit integer, reset_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_scope text;
  v_cost integer;
  v_client public.integration_api_clients%rowtype;
BEGIN
  -- Exact method/path pairs and bounded opaque references. Neither an empty
  -- caller scope array nor a cheaper supplied cost can weaken this matrix.
  IF p_method = 'POST' AND p_route IN (
    '/api/v1/staff/sessions', '/api/v1/staff/sessions/refresh',
    '/api/v1/staff/sessions/logout', '/api/v1/staff/sessions/mfa/challenge',
    '/api/v1/staff/sessions/mfa/verify', '/api/v1/staff/sessions/password',
    '/api/v1/staff/sessions/recovery', '/api/v1/staff/sessions/recovery/verify'
  ) THEN v_scope := 'staff_sessions.write';
  ELSIF p_method = 'GET' AND p_route = '/api/v1/staff/me' THEN
    v_scope := 'staff_context.read';
  ELSIF p_method = 'GET' AND (
    p_route = '/api/v1/staff/customers' OR
    p_route ~ '^/api/v1/staff/customers/customer_[A-Za-z0-9_-]{20,64}(/(contacts|addresses|facilities))?$'
  ) THEN v_scope := 'staff_customers.read';
  ELSIF p_method = 'GET' AND (
    p_route IN ('/api/v1/staff/support/cases', '/api/v1/staff/support/assignees') OR
    p_route ~ '^/api/v1/staff/support/cases/support_case_[A-Za-z0-9_-]{20,64}(/(entries|attachments))?$' OR
    p_route ~ '^/api/v1/staff/support/cases/support_case_[A-Za-z0-9_-]{20,64}/attachments/support_attachment_[A-Za-z0-9_-]{20,64}$'
  ) THEN v_scope := 'staff_support.read';
  ELSIF p_method = 'POST' AND (
    p_route = '/api/v1/staff/support/cases' OR
    p_route ~ '^/api/v1/staff/support/cases/support_case_[A-Za-z0-9_-]{20,64}/(replies|internal-notes|status|assignment|attachments)$'
  ) THEN v_scope := 'staff_support.write';
  END IF;
  IF v_scope IS NULL THEN
    RETURN QUERY SELECT 'denied'::text, 'api_scope_missing'::text, NULL::text,
      NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::text,
      NULL::text[], NULL::text[], NULL::text[], NULL::jsonb, NULL::integer,
      NULL::timestamptz, NULL::integer, NULL::integer, NULL::timestamptz;
    RETURN;
  END IF;
  v_cost := CASE WHEN p_method = 'POST' THEN 3 ELSE 1 END;

  -- Hold native client/tenant policy stable while the authoritative core
  -- authenticates and consumes its atomic route bucket. No stored hash leaves
  -- this SECURITY DEFINER boundary, including denied requests.
  SELECT c.* INTO v_client FROM public.integration_api_clients c
    WHERE c.key_prefix = p_key_prefix AND c.secret_hash = p_secret_hash
      AND c.deleted_at IS NULL FOR SHARE;
  IF v_client.id IS NOT NULL THEN
    PERFORM 1 FROM public.companies c WHERE c.id = v_client.company_id FOR SHARE;
    IF v_client.profile_key IS DISTINCT FROM 'custom'
       OR (v_client.metadata->>'integration_kind') IS DISTINCT FROM 'staff_support_v1' THEN
      RETURN QUERY SELECT 'denied'::text, 'api_client_inactive'::text, NULL::text,
        NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::text,
        NULL::text[], NULL::text[], NULL::text[], NULL::jsonb, NULL::integer,
        NULL::timestamptz, NULL::integer, NULL::integer, NULL::timestamptz;
      RETURN;
    END IF;
  END IF;
  RETURN QUERY SELECT a.*
    FROM public.authenticate_integration_request_v1_credential_core(
      p_key_prefix, p_secret_hash, p_route,
      coalesce(p_required_all, ARRAY[]::text[]) || ARRAY[v_scope],
      coalesce(p_required_any, ARRAY[]::text[]), p_client_ip, p_origin,
      v_cost, 60
    ) a;
END $$;

REVOKE ALL ON FUNCTION public.authenticate_staff_integration_request_v1(
  text,text,text,text,text[],text[],text,text,integer,integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authenticate_staff_integration_request_v1(
  text,text,text,text,text[],text[],text,text,integer,integer
) TO service_role;
COMMENT ON FUNCTION public.authenticate_staff_integration_request_v1(
  text,text,text,text,text[],text[],text,text,integer,integer
) IS 'Service-only staff_support_v1 custom-profile machine auth: pinned staff method/path/scope/cost matrix, native credentials, tenant lifecycle, IP/origin and atomic minute limits. Website provisioning policy remains unchanged.';
COMMIT;
