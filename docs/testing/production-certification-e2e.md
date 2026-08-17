# Gridex production certification E2E

This suite certifies the real Gridex production surfaces without turning ordinary CI into a production mutation mechanism.

## Targets

- OPS: `https://app.gridex.se`
- Gridex tenant website: `https://gridex.se`
- Synthetic tenant onboarding: a uniquely named `GRIDEX E2E Certification ...` tenant created by the dedicated E2E superadmin.
- Live customer certification: the existing Gridex tenant receives an explicitly authorized real customer through the real website flow. The quote preflight is enabled separately from the later identity/signing/market phases.

## Safety invariants

The workflow `.github/workflows/production-certification-e2e.yml` is `workflow_dispatch` only. It must never have `push`, `pull_request`, or `schedule` triggers.

Every production run requires `confirm_production=PRODUCTION`. Synthetic tenant creation additionally requires `confirm_synthetic_tenant=CREATE_SYNTHETIC_TENANT`. A real-customer quote preflight additionally requires `confirm_live_customer=AUTHORIZED_LIVE_CUSTOMER`.

Production Playwright runs have traces, screenshots and video disabled because browser state may contain credentials or personal data. Evidence must contain identifiers or fingerprints only and must never serialize passwords, person numbers, raw customer email addresses, invite tokens or signed links.

A real customer is real business data. The customer, legal acceptances, power of attorney, contract and market history must never be deleted as E2E cleanup. Only clearly synthetic E2E tenants may enter the canonical test/tombstone cleanup lifecycle.

## Current phases

### `preflight`

Read-only browser certification:

1. opens the real OPS login surface;
2. logs in with the dedicated E2E superadmin;
3. proves access to the platform-only company administration surface;
4. opens the real Gridex `/teckna-avtal` customer journey;
5. writes sanitized evidence.

### `tenant-bootstrap`

Explicitly mutating synthetic production certification:

1. logs in as the dedicated E2E superadmin;
2. creates a uniquely named synthetic electricity retailer through the real superadmin UI;
3. sets a unique customer-number prefix;
4. requests the real initial `company_admin` Auth invitation;
5. verifies the canonical company UUID and tenant-scoped user-management link;
6. records `WAITING_EXTERNAL` for the invitation email verification step.

The flow deliberately does not bypass the Auth invitation token. The next phase must obtain the actual email through an approved mailbox/provider integration, open the verification URL, set the configured tenant-admin password, accept the invitation and then prove company-admin RBAC.

### `live-customer-preflight`

Authorized real-customer quote certification, with no contract submission:

1. opens the real `https://gridex.se/teckna-avtal` flow;
2. enters the customer's real address, postal code and city;
3. enters the customer's real annual consumption;
4. proves at least one published Gridex contract is selectable;
5. asks the live website for a canonical price;
6. proves an SE1-SE4 area and customer-facing monthly price are returned;
7. follows the non-binding UI continuation to `Slutför teckningen`;
8. stops before authentication, identity fields, legal acceptance, customer creation or any market outbound.

Evidence contains only an address fingerprint and annual consumption, never the raw address.

## Required secrets for the current phases

- `GRIDEX_E2E_PROD_BASE_URL`
- `GRIDEX_E2E_TENANT_WEBSITE_URL`
- `GRIDEX_E2E_SUPERADMIN_EMAIL`
- `GRIDEX_E2E_SUPERADMIN_PASSWORD`
- `GRIDEX_E2E_TENANT_ADMIN_EMAIL`
- `GRIDEX_E2E_TENANT_ADMIN_PASSWORD`
- `GRIDEX_E2E_CUSTOMER_ADDRESS`
- `GRIDEX_E2E_CUSTOMER_POSTAL_CODE`
- `GRIDEX_E2E_CUSTOMER_CITY`
- `GRIDEX_E2E_CUSTOMER_ANNUAL_KWH`

The already-configured identity/contact/legal customer secrets remain intentionally outside the current workflow. They will only be injected when the separately gated real-contract phase is complete.

## Planned real-contract customer certification

The real-contract phase must continue from `https://gridex.se/teckna-avtal`, not through a service-role insert or an OPS admin form. It will verify the whole real path:

`website -> canonical pricing -> authenticated portal customer -> legal/POA -> application -> OPS customer/site/contract -> confirmation delivery -> facility/grid owner -> market process -> metering -> billing -> portal`

The website currently requires an authenticated customer-portal identity before application submission. The real-contract phase therefore also needs a protected customer portal password plus a way to consume the real verification email without logging its signed URL.

External market replies are asynchronous. A production run must therefore support durable states such as `WAITING_EXTERNAL` and resume from the recorded correlation/run identity rather than keeping a GitHub runner open.

The real-contract phase must have a stronger explicit confirmation for final contract submission and another separate gate before any real market outbound/supplier-switch action. It must never be added to automatic CI.

## Regression rule

`scripts/gridex-production-certification-e2e-regression.cjs` locks these safety properties. The standard open-source E2E tooling regression invokes it, so a PR that removes the manual-only trigger, production confirmations, PII-safe browser settings or the preflight no-submit guarantees must fail ordinary CI before merge.
