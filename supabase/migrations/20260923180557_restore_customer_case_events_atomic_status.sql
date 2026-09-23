-- Forward restoration: the retained May source defined this event model, but
-- the checksum-pinned clean-replay foundation omitted it. Preserve live rows.
CREATE TABLE IF NOT EXISTS public.customer_case_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_case_id uuid NOT NULL REFERENCES public.customer_cases(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_status text NOT NULL DEFAULT 'info',
  message text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_case_events_status_check CHECK (event_status IN ('info','success','warning','error'))
);

-- Reject legacy ownership drift rather than assigning events to a new tenant.
-- The validated composite FK also protects future service-role writers and
-- customer/case reassignment. The existing case -> customer composite FK
-- supplies the final customer/company binding.
ALTER TABLE public.customer_case_events
  ALTER COLUMN company_id SET NOT NULL,
  ALTER COLUMN customer_case_id SET NOT NULL,
  ALTER COLUMN customer_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS customer_cases_event_owner_key
  ON public.customer_cases(id, company_id, customer_id);
DO $$
BEGIN
  -- September's customer-chain repair skipped this table in clean replay. It
  -- already exists on live legacy tables, so restore it only where absent.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.customer_case_events'::regclass
    AND conname='customer_case_events_customer_company_fk') THEN
    ALTER TABLE public.customer_case_events ADD CONSTRAINT customer_case_events_customer_company_fk
      FOREIGN KEY (customer_id, company_id) REFERENCES public.customers(id, company_id)
      ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.customer_case_events'::regclass
    AND conname='customer_case_events_case_owner_fk') THEN
    ALTER TABLE public.customer_case_events ADD CONSTRAINT customer_case_events_case_owner_fk
      FOREIGN KEY (customer_case_id, company_id, customer_id)
      REFERENCES public.customer_cases(id, company_id, customer_id) ON DELETE CASCADE;
  END IF;
END
$$;
CREATE INDEX IF NOT EXISTS customer_case_events_case_idx
  ON public.customer_case_events(customer_case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS customer_case_events_company_idx
  ON public.customer_case_events(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS customer_case_events_customer_idx
  ON public.customer_case_events(customer_id);
CREATE INDEX IF NOT EXISTS customer_case_events_actor_idx
  ON public.customer_case_events(created_by) WHERE created_by IS NOT NULL;

-- All existing readers/writers run on the server. Do not expose a new browser
-- surface or inherit the original broad authenticated May policy.
ALTER TABLE public.customer_case_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.customer_case_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.customer_case_events TO service_role;

-- SECURITY INVOKER plus explicit EXECUTE keeps service-role authorization at
-- the server boundary. Tenant and actor checks still run for every invocation.
CREATE OR REPLACE FUNCTION public.gridex_update_customer_case_status(
  p_case_id uuid,
  p_company_id uuid,
  p_status text,
  p_actor_user_id uuid,
  p_expected_source text DEFAULT NULL,
  p_message text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_case public.customer_cases%ROWTYPE;
  v_old_status text;
  v_is_platform boolean;
  v_now timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO v_case FROM public.customer_cases
    WHERE id=p_case_id AND company_id=p_company_id
      AND (p_expected_source IS NULL OR source=p_expected_source)
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='customer_case_not_found_in_scope';
  END IF;

  v_is_platform := public.canonical_actor_is_platform_admin(p_actor_user_id);
  -- Ediel's operational view is tenant-write only, even when the optional
  -- expected-source argument is omitted. Support retains its platform actor
  -- behavior, still subject to real selected-company membership below.
  IF v_case.source='ediel_inbound_state_machine' AND v_is_platform THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='ediel_case_status_requires_tenant_actor';
  END IF;

  -- The existing scoped permission resolver checks the auth user for deletion
  -- and bans inside its established definer boundary; do not grant this
  -- invoker direct access to auth.users.
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles up
    JOIN public.company_memberships cm ON cm.user_id=up.id AND cm.company_id=v_case.company_id
    JOIN public.companies c ON c.id=cm.company_id
    WHERE up.id=p_actor_user_id AND up.user_status='active'
      AND cm.status='active' AND coalesce(cm.is_active,true)
      AND c.status IN ('active','onboarding') AND coalesce(c.is_active,true)
  ) OR NOT (coalesce(v_is_platform,false) OR coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,v_case.company_id,'cases.write'),false))
  THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='customer_case_status_actor_not_authorized';
  END IF;

  v_old_status := v_case.status;
  UPDATE public.customer_cases SET status=p_status, updated_by=p_actor_user_id, updated_at=v_now,
    resolved_at=CASE WHEN p_status='resolved' THEN v_now ELSE resolved_at END,
    closed_at=CASE WHEN p_status='closed' THEN v_now ELSE closed_at END
    WHERE id=v_case.id AND company_id=v_case.company_id
    RETURNING * INTO v_case;

  INSERT INTO public.customer_case_events(
    company_id,customer_case_id,customer_id,event_type,event_status,message,payload,created_by
  ) VALUES (
    v_case.company_id,v_case.id,v_case.customer_id,'status_changed',
    CASE WHEN p_status IN ('closed','resolved') THEN 'success' ELSE 'info' END,
    coalesce(nullif(btrim(p_message),''),'Ärendet uppdaterades till '||p_status||'.'),
    jsonb_build_object('status',p_status),p_actor_user_id
  );
  -- The canonical audit trigger fills required actor/request/resource context.
  -- Neither an event error nor an audit error is swallowed: all three writes
  -- belong to this one database transaction and roll back together.
  INSERT INTO public.audit_logs(
    company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata
  ) VALUES (
    v_case.company_id,p_actor_user_id,'customer_case',v_case.id::text,'customer_case_status_changed',
    jsonb_build_object('status',v_old_status),
    jsonb_build_object('status',p_status,'message',p_message),
    jsonb_build_object('customer_id',v_case.customer_id)
  );
  RETURN to_jsonb(v_case);
END
$$;
REVOKE ALL ON FUNCTION public.gridex_update_customer_case_status(uuid,uuid,text,uuid,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_update_customer_case_status(uuid,uuid,text,uuid,text,text)
  TO service_role;
COMMENT ON FUNCTION public.gridex_update_customer_case_status(uuid,uuid,text,uuid,text,text)
  IS 'Server-only atomic operational status/event/audit update; no source approval, ACK or business side effects.';
