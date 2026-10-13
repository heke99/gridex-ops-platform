# Gridex OPS platform

## Aktuellt Ediel-arbete

[Starta här](.agent-memory/masterplan-current-start.md). [Coverage på faktisk main](quality/audits/ediel-masterplan-v2/coverage.json) är enda godkännandeledgern; senaste [#766](https://github.com/heke99/gridex-ops-platform/issues/766) och verifierade claims styr ägarskap och nästa steg. [Gemensam Claude-/Codex-prompt](.agent-memory/masterplan-five-agent-prompt-20261012.md) gäller både nya granskare och fortsättande agenter. Tidigare baslinjer, antal och rollprompter är historik. Befintliga ägare behåller sina scopes; extra granskare hjälper read-only och rättar först efter avgränsad filöverlämning.

Gridex OPS is the multi-tenant operations platform for electricity companies:
customer, contract, pricing, customer-portal, customer-service and staff
workflows, exposed to tenants through versioned HTTP APIs.

## Current API contract inventory

The release manifest is the authority for the current contract version and the
checksum of every published specification:
`https://app.gridex.se/api/v1/openapi/release-manifest.json`
(documentation `2026-10-12.1`, default wire `2026-10-09.1`, source `docs/openapi/`). Documentation-only updates do not change the wire representation. Frozen release bytes live in
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

[API operation inventory and verification boundaries](docs/api-index.md) maps the public
API families to their handlers and database dependencies. Internal administration,
scheduled jobs and signed provider webhooks have separate authorization boundaries;
they are not tenant-facing API credentials.

## Development

Node 22. Install with `npm ci`, then run `npm run typecheck` and tests with
`node node_modules/vitest/vitest.mjs run <files>`. API documentation gates:
`npm run api:docs`, `npm run api:compatibility`, `npm run api:release:verify`,
`npm run api:error-registry`. Agent workflow: [AGENTS.md](AGENTS.md).

## Historical patch notes

Dated patch instructions are archived, not current guidance:
[docs/archive/2026-07-22-contract-hotfix-README.md](docs/archive/2026-07-22-contract-hotfix-README.md).
