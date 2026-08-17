# Gridex production certification E2E

This suite certifies the real Gridex production surfaces without turning ordinary CI into a production mutation mechanism.

## Targets

- OPS: `https://app.gridex.se`
- Gridex tenant website: `https://gridex.se`
- Synthetic tenant onboarding: a uniquely named `GRIDEX E2E Certification ...` tenant created by the dedicated E2E superadmin.
- Live customer certification: the existing Gridex tenant receives an explicitly authorized real customer through the real website flow. This phase is intentionally not enabled until mailbox verification and explicit live-market guards are implemented.

## Safety invariants

The workflow `.github/workflows/production-certification-e2e.yml` is `workflow_dispatch` only. It must never have `push`, `pull_request`, or `schedule` triggers.

Every production run requires `confirm_production=PRODUCTION`. Synthetic tenant creation additionally requires `confirm_synthetic_tenant=CREATE_SYNTHETIC_TENANT`.

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

## Required secrets for the current phases

- `GRIDEX_E2E_PROD_BASE_URL`
- `GRIDEX_E2E_TENANT_WEBSITE_URL`
- `GRIDEX_E2E_SUPERADMIN_EMAIL`
- `GRIDEX_E2E_SUPERADMIN_PASSWORD`
- `GRIDEX_E2E_TENANT_ADMIN_EMAIL`
- `GRIDEX_E2E_TENANT_ADMIN_PASSWORD`

The customer secrets may already be configured, but they are intentionally not injected into the current workflow until the live-customer phase is complete and explicitly guarded.

## Planned live customer certification

The live phase must begin at `https://gridex.se/teckna-avtal`, not through a service-role insert or an OPS admin form. It will verify the whole real path:

`website -> canonical pricing -> authenticated portal customer -> legal/POA -> application -> OPS customer/site/contract -> confirmation delivery -> facility/grid owner -> market process -> metering -> billing -> portal`

External market replies are asynchronous. A production run must therefore support durable states such as `WAITING_EXTERNAL` and resume from the recorded correlation/run identity rather than keeping a GitHub runner open.

The live phase must have a separate explicit confirmation gate for an authorized real customer and another gate before any real market outbound/supplier-switch action. It must never be added to automatic CI.

## Regression rule

`scripts/gridex-production-certification-e2e-regression.cjs` locks these safety properties. The standard open-source E2E tooling regression invokes it, so a PR that removes the manual-only trigger, production confirmations or PII-safe browser settings must fail ordinary CI before merge.
