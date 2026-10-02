-- Tenantservice F12: personal / organization number changes as a high-risk flow.
--
-- Every change of customers.personal_number or customers.org_number goes through a request:
-- * without contracts it is applied at once by staff, with audit;
-- * with contracts it waits for the customer's approval via a single-use, expiring e-mail link
--   (only the SHA-256 of the token is stored) and is applied only when the customer approves.
-- The history (customer_identity_change_events) is append-only: updates and deletes are rejected.
-- Application happens in one transaction (gridex_decide_customer_identity_change_v1): lock the
-- request, re-check state and expiry, update the customer, record the event and an audit_logs row.
-- Forward-only; changes no existing data.
BEGIN;

CREATE TABLE public.customer_identity_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  field text NOT NULL CHECK (field IN ('personal_number', 'org_number')),
  previous_value text,
  new_value text NOT NULL CHECK (length(new_value) BETWEEN 1 AND 40),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  approval_required boolean NOT NULL,
  affected_contract_count integer NOT NULL DEFAULT 0 CHECK (affected_contract_count >= 0),
  recipient_email text,
  token_hash text CHECK (token_hash IS NULL OR token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz,
  status text NOT NULL CHECK (status IN ('pending_customer_approval', 'applied', 'rejected', 'expired', 'cancelled')),
  decided_at timestamptz,
  decided_by text CHECK (decided_by IS NULL OR decided_by IN ('customer', 'staff', 'system')),
  CONSTRAINT customer_identity_change_requests_company_customer_fkey FOREIGN KEY (company_id, customer_id)
    REFERENCES public.customers(company_id, id),
  CONSTRAINT customer_identity_change_requests_company_token_key UNIQUE (company_id, token_hash),
  CONSTRAINT customer_identity_change_requests_approval_shape CHECK (
    (approval_required AND recipient_email IS NOT NULL AND token_hash IS NOT NULL AND expires_at IS NOT NULL)
    OR (NOT approval_required AND token_hash IS NULL)
  )
);

COMMENT ON TABLE public.customer_identity_change_requests IS
  'F12: changes of customer personal/organization numbers. Customers with contracts must approve via a single-use e-mail link (token hash only).';

-- At most one open request per customer and field.
CREATE UNIQUE INDEX customer_identity_change_requests_one_pending_idx
  ON public.customer_identity_change_requests (company_id, customer_id, field)
  WHERE status = 'pending_customer_approval';
CREATE INDEX customer_identity_change_requests_customer_idx
  ON public.customer_identity_change_requests (company_id, customer_id, requested_at DESC);
-- Public approval links look a request up by token hash before the company is known.
CREATE INDEX customer_identity_change_requests_token_idx
  ON public.customer_identity_change_requests (token_hash) WHERE token_hash IS NOT NULL;

CREATE TABLE public.customer_identity_change_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  request_id uuid NOT NULL REFERENCES public.customer_identity_change_requests(id),
  event_type text NOT NULL CHECK (event_type IN ('requested', 'approval_sent', 'approved', 'rejected', 'applied', 'expired', 'cancelled')),
  actor_kind text NOT NULL CHECK (actor_kind IN ('staff', 'customer', 'system')),
  actor_user_id uuid,
  field text NOT NULL CHECK (field IN ('personal_number', 'org_number')),
  previous_value_masked text,
  new_value_masked text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_identity_change_events_company_customer_fkey FOREIGN KEY (company_id, customer_id)
    REFERENCES public.customers(company_id, id)
);

COMMENT ON TABLE public.customer_identity_change_events IS
  'F12: append-only audit history of personal/organization number changes (masked values).';

CREATE INDEX customer_identity_change_events_customer_idx
  ON public.customer_identity_change_events (company_id, customer_id, created_at DESC);
CREATE INDEX customer_identity_change_events_request_idx
  ON public.customer_identity_change_events (request_id);

CREATE FUNCTION public.gridex_customer_identity_events_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'customer_identity_change_events_append_only' USING ERRCODE = '42501';
END $$;

CREATE TRIGGER customer_identity_change_events_no_update
  BEFORE UPDATE OR DELETE ON public.customer_identity_change_events
  FOR EACH ROW EXECUTE FUNCTION public.gridex_customer_identity_events_append_only();
CREATE TRIGGER customer_identity_change_events_no_truncate
  BEFORE TRUNCATE ON public.customer_identity_change_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.gridex_customer_identity_events_append_only();

CREATE FUNCTION public.gridex_mask_identity_number(p_value text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE WHEN p_value IS NULL OR btrim(p_value) = '' THEN NULL
              ELSE '••••' || right(regexp_replace(p_value, '[^0-9]', '', 'g'), 4) END
$$;

-- Decides one request atomically. p_outcome: 'applied' (staff direct or customer approval),
-- 'rejected' (customer declined), 'expired', 'cancelled' (staff withdrew).
CREATE FUNCTION public.gridex_decide_customer_identity_change_v1(
  p_company_id uuid,
  p_request_id uuid,
  p_outcome text,
  p_decided_by text,
  p_actor_user_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  r public.customer_identity_change_requests%rowtype;
  v_current text;
BEGIN
  IF p_outcome NOT IN ('applied', 'rejected', 'expired', 'cancelled') THEN
    RAISE EXCEPTION 'identity_change_outcome_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_decided_by NOT IN ('customer', 'staff', 'system') THEN
    RAISE EXCEPTION 'identity_change_actor_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO r FROM public.customer_identity_change_requests
   WHERE id = p_request_id AND company_id = p_company_id
   FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'identity_change_not_found' USING ERRCODE = 'P0002'; END IF;

  IF r.status <> 'pending_customer_approval' THEN
    RAISE EXCEPTION 'identity_change_not_pending' USING ERRCODE = '55000';
  END IF;
  IF p_outcome = 'applied' AND r.approval_required AND p_decided_by <> 'customer' THEN
    RAISE EXCEPTION 'identity_change_requires_customer_approval' USING ERRCODE = '42501';
  END IF;
  IF p_outcome IN ('applied', 'rejected') AND r.approval_required AND r.expires_at <= now() THEN
    UPDATE public.customer_identity_change_requests SET status = 'expired', decided_at = now(), decided_by = 'system' WHERE id = r.id;
    INSERT INTO public.customer_identity_change_events (company_id, customer_id, request_id, event_type, actor_kind, field, previous_value_masked, new_value_masked)
    VALUES (r.company_id, r.customer_id, r.id, 'expired', 'system', r.field,
            public.gridex_mask_identity_number(r.previous_value), public.gridex_mask_identity_number(r.new_value));
    RETURN jsonb_build_object('status', 'expired', 'request_id', r.id);
  END IF;

  IF p_outcome = 'applied' THEN
    -- The value must still be what the request was based on; otherwise someone changed it meanwhile.
    EXECUTE format('SELECT %I FROM public.customers WHERE company_id = $1 AND id = $2 FOR UPDATE', r.field)
      INTO v_current USING r.company_id, r.customer_id;
    IF v_current IS DISTINCT FROM r.previous_value THEN
      RAISE EXCEPTION 'identity_change_stale' USING ERRCODE = '40001';
    END IF;
    EXECUTE format('UPDATE public.customers SET %I = $1, updated_at = now() WHERE company_id = $2 AND id = $3', r.field)
      USING r.new_value, r.company_id, r.customer_id;
  END IF;

  UPDATE public.customer_identity_change_requests
     SET status = p_outcome, decided_at = now(), decided_by = p_decided_by
   WHERE id = r.id;

  IF r.approval_required AND p_outcome IN ('applied', 'rejected') THEN
    INSERT INTO public.customer_identity_change_events (company_id, customer_id, request_id, event_type, actor_kind, actor_user_id, field, previous_value_masked, new_value_masked)
    VALUES (r.company_id, r.customer_id, r.id, CASE WHEN p_outcome = 'applied' THEN 'approved' ELSE 'rejected' END,
            p_decided_by, p_actor_user_id, r.field,
            public.gridex_mask_identity_number(r.previous_value), public.gridex_mask_identity_number(r.new_value));
  END IF;
  INSERT INTO public.customer_identity_change_events (company_id, customer_id, request_id, event_type, actor_kind, actor_user_id, field, previous_value_masked, new_value_masked, detail)
  VALUES (r.company_id, r.customer_id, r.id,
          CASE p_outcome WHEN 'applied' THEN 'applied' WHEN 'rejected' THEN 'rejected' ELSE p_outcome END,
          p_decided_by, p_actor_user_id, r.field,
          public.gridex_mask_identity_number(r.previous_value), public.gridex_mask_identity_number(r.new_value),
          jsonb_build_object('affected_contract_count', r.affected_contract_count, 'approval_required', r.approval_required));

  INSERT INTO public.audit_logs (company_id, actor_user_id, actor_type, system_actor, entity_type, entity_id, action,
                                 old_values, new_values, metadata, request_id, correlation_id, resource_type, resource_id)
  VALUES (r.company_id, p_actor_user_id,
          CASE WHEN p_actor_user_id IS NULL THEN 'system' ELSE 'user' END,
          CASE WHEN p_actor_user_id IS NULL THEN 'customer_identity_change:' || p_decided_by ELSE NULL END,
          'customer', r.customer_id::text, 'customer_identity_change_' || p_outcome,
          jsonb_build_object(r.field, public.gridex_mask_identity_number(r.previous_value)),
          jsonb_build_object(r.field, public.gridex_mask_identity_number(r.new_value)),
          jsonb_build_object('identity_change_request_id', r.id, 'decided_by', p_decided_by,
                             'approval_required', r.approval_required, 'affected_contract_count', r.affected_contract_count),
          r.id::text, r.id::text, 'customer_identity_change_request', r.id::text);

  RETURN jsonb_build_object('status', p_outcome, 'request_id', r.id, 'customer_id', r.customer_id, 'field', r.field);
END $$;

-- Public approval links know only the token. Returns at most the matching request (never the
-- token hash or the recipient), so the app needs no cross-tenant table access for this path.
CREATE FUNCTION public.gridex_find_customer_identity_change_by_token_v1(p_token_hash text)
RETURNS TABLE (id uuid, company_id uuid, customer_id uuid, field text, previous_value text, new_value text,
               status text, expires_at timestamptz, affected_contract_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT r.id, r.company_id, r.customer_id, r.field, r.previous_value, r.new_value, r.status, r.expires_at, r.affected_contract_count
    FROM public.customer_identity_change_requests r
   WHERE p_token_hash ~ '^[0-9a-f]{64}$' AND r.token_hash = p_token_hash
   LIMIT 2
$$;

ALTER TABLE public.customer_identity_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_identity_change_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.customer_identity_change_requests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.customer_identity_change_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.customer_identity_change_requests TO service_role;
GRANT SELECT, INSERT ON TABLE public.customer_identity_change_events TO service_role;
REVOKE ALL ON FUNCTION public.gridex_decide_customer_identity_change_v1(uuid, uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_decide_customer_identity_change_v1(uuid, uuid, text, text, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.gridex_find_customer_identity_change_by_token_v1(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_find_customer_identity_change_by_token_v1(text) TO service_role;
REVOKE ALL ON FUNCTION public.gridex_customer_identity_events_append_only() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gridex_mask_identity_number(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_mask_identity_number(text) TO service_role;

INSERT INTO public.platform_table_classification(table_name, kind, rationale, null_company_meaning, classified_by)
VALUES
  ('customer_identity_change_requests', 'tenant',
   'F12: tenant-owned personal/organization number change requests with customer approval. Service-role-only access with RLS enabled.',
   NULL, 'migration:customer_identity_change_requests'),
  ('customer_identity_change_events', 'tenant',
   'F12: append-only audit history of personal/organization number changes (masked). Service-role-only access with RLS enabled.',
   NULL, 'migration:customer_identity_change_requests')
ON CONFLICT (table_name) DO UPDATE SET
  kind = EXCLUDED.kind, rationale = EXCLUDED.rationale, null_company_meaning = EXCLUDED.null_company_meaning,
  classified_by = EXCLUDED.classified_by, classified_at = now();

COMMIT;
