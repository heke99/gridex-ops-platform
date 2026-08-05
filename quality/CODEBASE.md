# Gridex OPS — Codebase Map

## Scope

- Repository: `heke99/gridex-ops-platform`
- Audit branch: `audit/gridex-ops-full-integrity-review`
- Audit start commit: `3aa8309767dc4fbd58b59322082d85127c48c194`
- Current parent reviewed before this report: `3eb8445cb840d38af6068d49266ce0881a8e0157`
- Canonical Supabase project: `gridex-ops-dev` (`piidsfebjqjmnepdpnas`)
- Runtime model: root-based Next.js application. Older `.agent-memory` references to `apps/ops` are stale.

## Repository structure

| Area | Location | Responsibility |
|---|---|---|
| Next.js application | `app/` | Admin UI, authentication, developer documentation, API routes and cron/webhook entry points |
| API surface | `app/api/` | Admin, public, internal, EDIEL, cron, webhook and versioned API routes |
| Versioned external APIs | `app/api/v1/` | Website integration, customer portal, events, customer operations, OpenAPI and public contracts |
| Shared UI | `components/` | Admin, customer, contract, developer and master-data components |
| Domain/application code | `lib/` | Tenant context, integration auth, website intake, customer portal, billing, EDIEL, analytics, legal and Supabase access |
| Database | `supabase/migrations/` | Forward migrations and schema history |
| Verification | `scripts/`, `tests/` | Static regressions, runtime checks, SQL checks and Vitest suites |
| Contracts | `docs/openapi/` | Website Integration and Customer Portal OpenAPI snapshots |
| Agent instructions | `AGENTS.md`, `.agent-memory/`, `.agents/skills/` | Repository-specific operating rules, known blockers and audit skills |

## Critical entry points

- Integration authentication: `lib/integrations/apiAuth.ts`
- Tenant binding: `lib/tenant/context.ts`
- Service-role client: `lib/supabase/service.ts`
- Website customer intake: `app/api/v1/website/customer-applications/route.ts` and `lib/website/customerApplications.ts`
- Customer portal sync: `app/api/v1/customer-portal/sync/route.ts`
- Billing webhooks: `app/api/webhooks/billing/[provider]/route.ts` and `lib/billing/providerWebhooks.ts`
- Manual inbound webhook: `app/api/webhooks/manual-inbound/route.ts`
- Resend webhook: `app/api/webhooks/resend/route.ts`
- Analytics cron: `app/api/cron/analytics/daily/route.ts` and `lib/analytics/cron.ts`
- OpenAPI runtime: `app/api/v1/openapi/`

## Trust and tenant boundaries

1. External tenant API calls authenticate with an API key.
2. `requireIntegrationApiAccess` resolves the client and company server-side, validates status, scope, origin/IP and rate limit.
3. Tenant identity is taken from the authenticated API client, not from request payloads.
4. Service-role queries must include `company_id` or resolve ownership through a tenant-bound parent.
5. RLS is the database safety net for user-session access; service-role paths must enforce tenant scope in application code.
6. Webhooks are authenticated independently using provider/tenant secrets and replay windows.

## Database baseline

Direct PostgreSQL catalog checks against `piidsfebjqjmnepdpnas` showed:

- Project status: active and healthy.
- Latest registered migration: `20260805085617_api_contract_billing_tenant_hardening`.
- All current `public` base/partitioned tables found in the catalog have RLS enabled.
- `anon` and `authenticated` cannot create objects in `public`.
- Security-definer helpers reviewed use current session/membership checks and fixed `search_path`; no verified cross-tenant bypass was found.
- Some Supabase connector advisor/list output was stale compared with `pg_catalog`; catalog results are treated as authoritative.

## Test and CI surface

The root `package.json` exposes lint, three TypeScript checks, Vitest, migration integrity, RBAC, OpenAPI compatibility/release/runtime parity, hardening, EDIEL and multi-tenant regressions, production audit and build commands.

No clean checkout or dependency installation was available in this connector-only session. Commands are therefore documented as blocked unless supported by prior repository evidence, and no historical result is presented as a fresh pass.

## Known incomplete areas

- Full local command execution is blocked by the absence of an authenticated checkout and the known package-mirror failure for `zod-validation-error@4.0.2`.
- Live two-tenant legal/POA/supplier-switch validation remains deployment-dependent.
- Full file line-count enumeration is blocked by connector archive limits; verified oversized files are listed in `quality/LARGE_FILES.md`.
- Current UI review is limited to exact branch files that can be fetched; GitHub search results can point to older indexed commits and are not accepted as findings without branch verification.
