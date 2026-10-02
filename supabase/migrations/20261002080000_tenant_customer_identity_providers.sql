-- Tenantservice P1c: independent end-customer proof.
--
-- A tenant registers how its own customers log in (BankID/Freja broker, any OIDC provider, or
-- its own password/OTP login). Gridex then verifies a short-lived signed assertion from that
-- login on every end-customer call instead of trusting the tenant server's word alone.
--
-- Only PUBLIC material is stored: an OIDC issuer + JWKS URL, or a tenant's public key. Private
-- keys, passwords and BankID agreements never reach Gridex. Enforcement starts at 'report'.
BEGIN;

CREATE TABLE public.tenant_customer_identity_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('oidc', 'tenant_key')),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
  issuer text NOT NULL CHECK (length(issuer) BETWEEN 1 AND 500),
  audience text NOT NULL CHECK (length(audience) BETWEEN 1 AND 200),
  jwks_uri text CHECK (jwks_uri IS NULL OR jwks_uri ~ '^https://[^\s]{3,490}$'),
  public_jwk jsonb CHECK (public_jwk IS NULL OR (jsonb_typeof(public_jwk) = 'object' AND NOT public_jwk ? 'd')),
  subject_claim text NOT NULL DEFAULT 'sub' CHECK (subject_claim ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  enforcement text NOT NULL DEFAULT 'report' CHECK (enforcement IN ('report', 'enforce')),
  is_active boolean NOT NULL DEFAULT true,
  last_tested_at timestamptz,
  last_test_result jsonb,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_customer_identity_providers_key_material CHECK (
    (kind = 'oidc' AND jwks_uri IS NOT NULL AND public_jwk IS NULL)
    OR (kind = 'tenant_key' AND public_jwk IS NOT NULL AND jwks_uri IS NULL)
  )
);

COMMENT ON TABLE public.tenant_customer_identity_providers IS
  'Tenantservice P1c: per-tenant end-customer login verification. Public key material only; a private JWK (with "d") is rejected.';

-- One active configuration per tenant keeps the rule unambiguous.
CREATE UNIQUE INDEX tenant_customer_identity_providers_active_uidx
  ON public.tenant_customer_identity_providers (company_id) WHERE is_active;

-- Replay protection: each assertion id (jti) is accepted once per tenant until it expires.
CREATE TABLE public.tenant_customer_assertion_replays (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  jti text NOT NULL CHECK (length(jti) BETWEEN 8 AND 200),
  expires_at timestamptz NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, jti)
);
CREATE INDEX tenant_customer_assertion_replays_expiry_idx
  ON public.tenant_customer_assertion_replays (expires_at);

ALTER TABLE public.tenant_customer_identity_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_customer_assertion_replays ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tenant_customer_identity_providers FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.tenant_customer_assertion_replays FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tenant_customer_identity_providers TO service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.tenant_customer_assertion_replays TO service_role;

INSERT INTO public.platform_table_classification(table_name, kind, rationale, null_company_meaning, classified_by)
VALUES
  ('tenant_customer_identity_providers', 'tenant',
   'Tenant-owned end-customer login verification settings (public key material only). Service-role-only access with RLS enabled.',
   NULL, 'migration:tenant_customer_identity_providers'),
  ('tenant_customer_assertion_replays', 'tenant',
   'Tenant-scoped one-time assertion ids for replay protection. Service-role-only access with RLS enabled.',
   NULL, 'migration:tenant_customer_identity_providers')
ON CONFLICT (table_name) DO UPDATE SET
  kind = EXCLUDED.kind, rationale = EXCLUDED.rationale, null_company_meaning = EXCLUDED.null_company_meaning,
  classified_by = EXCLUDED.classified_by, classified_at = now();

COMMIT;
