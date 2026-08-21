-- Customer identity consistency + canonical tenant webhook safety.
--
-- A tenant customer is one stable legal identity. Additional facilities and
-- contracts must attach to that customer; they must not create a duplicate
-- customer row. Private customers already have a tenant-scoped unique index on
-- normalized personal number. This migration adds the equivalent invariant for
-- business customers.
--
-- Canonical tenant website provisioning resolves a webhook subscription by
-- company + API client + endpoint. Enforce the same identity in PostgreSQL so
-- concurrent/repeated provisioning cannot create ambiguous subscriptions.
-- The AUD-003 reconstructed replay intentionally restores a narrower historical
-- webhook shape, so webhook enforcement is applied only when api_client_id is
-- present. Canonical/live schemas have that column from the website integration
-- foundation and therefore always receive this invariant.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.customers
    WHERE normalized_org_number IS NOT NULL
    GROUP BY company_id, normalized_org_number
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'customer_identity_consistency_blocked: duplicate normalized org numbers exist within a tenant';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_customers_company_org_number
  ON public.customers (company_id, normalized_org_number)
  WHERE normalized_org_number IS NOT NULL;

DO $$
DECLARE
  v_has_api_client_id boolean;
  v_has_duplicates boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'webhook_subscriptions'
      AND column_name = 'api_client_id'
  )
  INTO v_has_api_client_id;

  IF v_has_api_client_id THEN
    EXECUTE $sql$
      SELECT EXISTS (
        SELECT 1
        FROM public.webhook_subscriptions
        WHERE api_client_id IS NOT NULL
          AND status <> 'revoked'
        GROUP BY company_id, api_client_id, endpoint_url
        HAVING count(*) > 1
      )
    $sql$
    INTO v_has_duplicates;

    IF v_has_duplicates THEN
      RAISE EXCEPTION 'tenant_webhook_consistency_blocked: duplicate non-revoked canonical subscriptions exist';
    END IF;

    EXECUTE $sql$
      CREATE UNIQUE INDEX IF NOT EXISTS webhook_subscriptions_company_client_endpoint_uidx
        ON public.webhook_subscriptions (company_id, api_client_id, endpoint_url)
        WHERE api_client_id IS NOT NULL
          AND status <> 'revoked'
    $sql$;
  ELSE
    RAISE NOTICE 'tenant_webhook_consistency_not_applicable: webhook_subscriptions.api_client_id is absent in reconstructed legacy replay';
  END IF;
END
$$;
