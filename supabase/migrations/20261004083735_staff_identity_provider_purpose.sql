-- S1: separate staff identity configuration and replay protection from customer assertions.
-- Existing configurations remain customer/report; staff configurations always fail closed.
BEGIN;

ALTER TABLE public.tenant_customer_identity_providers
  ADD COLUMN purpose text NOT NULL DEFAULT 'customer',
  ADD CONSTRAINT tenant_customer_identity_providers_purpose_check CHECK (purpose IN ('customer','staff')),
  ADD CONSTRAINT tenant_customer_identity_providers_staff_shape_check
    CHECK (purpose <> 'staff' OR (subject_claim = 'sub' AND enforcement = 'enforce'));

DROP INDEX public.tenant_customer_identity_providers_active_uidx;
CREATE UNIQUE INDEX tenant_customer_identity_providers_active_uidx
  ON public.tenant_customer_identity_providers(company_id,purpose) WHERE is_active;

CREATE TABLE public.tenant_staff_assertion_replays (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  jti text NOT NULL CHECK (length(jti) BETWEEN 8 AND 200),
  expires_at timestamptz NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id,jti)
);
CREATE INDEX tenant_staff_assertion_replays_expiry_idx
  ON public.tenant_staff_assertion_replays(expires_at);
ALTER TABLE public.tenant_staff_assertion_replays ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tenant_staff_assertion_replays FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,DELETE ON TABLE public.tenant_staff_assertion_replays TO service_role;

INSERT INTO public.platform_table_classification(table_name,kind,rationale,null_company_meaning,classified_by)
VALUES ('tenant_staff_assertion_replays','tenant',
  'Company-scoped one-time staff assertion identifiers; service-only RLS and explicit company binding.',
  NULL,'migration:staff_identity_provider_purpose')
ON CONFLICT (table_name) DO UPDATE SET kind=EXCLUDED.kind,rationale=EXCLUDED.rationale,
  null_company_meaning=EXCLUDED.null_company_meaning,classified_by=EXCLUDED.classified_by,classified_at=now();

COMMENT ON COLUMN public.tenant_customer_identity_providers.purpose IS
  'customer for Mina sidor; staff for signed staff assertions with sub=Gridex user id and mandatory enforcement.';
COMMENT ON TABLE public.tenant_staff_assertion_replays IS
  'Staff API replay protection; customer and staff jti namespaces are intentionally separate.';
-- The legacy permissions table has no PostgREST permission_id relationship. Resolve ID-only
-- overrides in one service-only query; never widen the override scope to platform/global rows.
CREATE FUNCTION public.gridex_staff_permission_overrides_v1(p_company_id uuid,p_user_id uuid)
RETURNS TABLE(permission_key text,effect text,status text,is_active boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT coalesce(nullif(up.permission_key,''),p.key,p.name),up.effect,up.status,up.is_active
  FROM public.user_permissions up
  LEFT JOIN public.permissions p ON p.id=up.permission_id AND p.is_active
  WHERE up.company_id=p_company_id AND up.user_id=p_user_id
    AND up.status='active' AND up.is_active
    AND coalesce(nullif(up.permission_key,''),p.key,p.name) IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.gridex_staff_permission_overrides_v1(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_staff_permission_overrides_v1(uuid,uuid) TO service_role;
COMMIT;
