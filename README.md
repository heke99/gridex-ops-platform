# Gridex OPS platform

Gridex OPS is the multi-tenant operations platform for electricity companies:
customer, contract, pricing, customer-portal, customer-service and staff
workflows, exposed to tenants through versioned HTTP APIs.

## Current API contract inventory

The release manifest is the authority for the current contract version and the
checksum of every published specification:
`https://app.gridex.se/api/v1/openapi/release-manifest.json`
(currently `2026-10-09.1`, source `docs/openapi/`). Frozen release bytes live in
`docs/openapi/releases/<version>/` and are never rewritten.

| API | Current OpenAPI | Guide | Developer page |
| --- | --- | --- | --- |
| Website integration | `docs/openapi/website-integration-v1.json` | [docs/external-website-api-integration-guide.md](docs/external-website-api-integration-guide.md) | `/developers` |
| Customer portal | `docs/openapi/customer-portal-v1.json` | [docs/gridex-customer-portal-api.md](docs/gridex-customer-portal-api.md) | `/developers/customer-portal-api` |
| Staff | `docs/openapi/staff-v1.json` | [docs/gridex-staff-api.md](docs/gridex-staff-api.md) | `/developers/staff-api` |
| Staff onboarding | `docs/openapi/staff-onboarding-v1.json` | [docs/staff-api/independent-onboarding.md](docs/staff-api/independent-onboarding.md) | `/developers/staff-api` |
| Partner | served by `lib/partner-api/openApi.ts` | — | `/developers/partner-api` |

Tenant onboarding and credentials:
[docs/single-api-key-tenant-integration.md](docs/single-api-key-tenant-integration.md),
[docs/electricity-company-onboarding-production-readiness.md](docs/electricity-company-onboarding-production-readiness.md),
[docs/public-api-id-policy.md](docs/public-api-id-policy.md).

## Development

Node 22. Install with `npm ci`, then run `npm run typecheck` and tests with
`node node_modules/vitest/vitest.mjs run <files>`. API documentation gates:
`npm run api:docs`, `npm run api:compatibility`, `npm run api:release:verify`,
`npm run api:error-registry`. Agent workflow: [AGENTS.md](AGENTS.md).

## Historical patch notes

Dated patch instructions are archived, not current guidance:
[docs/archive/2026-07-22-contract-hotfix-README.md](docs/archive/2026-07-22-contract-hotfix-README.md).
