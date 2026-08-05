# Gridex OPS — Discovered Project Profile

This profile records repository facts discovered from code, configuration and connected platform metadata. Only `verified` facts are used as hard audit assumptions.

## Identity and architecture

| Fact | Value | Source | Confidence |
|---|---|---|---|
| Repository | `heke99/gridex-ops-platform` | GitHub repository metadata | `verified` |
| Application type | Full-stack web operations platform | Next.js routes, UI, server code and database integrations | `verified` |
| Framework | Next.js App Router | `next` dependency and `app/**` structure | `verified` |
| Language | TypeScript/JavaScript | `package.json`, `.ts`/`.tsx` sources | `verified` |
| UI runtime | React 19 | `package.json` | `verified` |
| Package manager | npm | `package-lock.json`, `npm ci` in CI | `verified` |
| Primary deployment target | Vercel | `vercel.json`, Vercel-oriented environment/runtime code | `verified` |
| Server runtime in CI/deploy configuration | Node.js 22 | workflow and `vercel.json` | `verified` |
| Primary database/platform | Supabase/PostgreSQL | Supabase clients, migrations and connected project | `verified` |
| Connected Supabase project | `gridex-ops-dev` (`piidsfebjqjmnepdpnas`) | Supabase connector | `verified` |
| Connected database health during V3 | `ACTIVE_HEALTHY`, PostgreSQL 17.6.1.084 | Supabase project metadata | `verified` |

## Repository shape

| Area | Observed role | Source | Confidence |
|---|---|---|---|
| `app/` | App Router pages, layouts and HTTP routes | repository tree | `verified` |
| `components/` | reusable UI and feature components | repository tree | `verified` |
| `lib/` | domain, integration, auth, database and orchestration logic | repository tree | `verified` |
| `supabase/` | migrations, database tests/configuration | repository tree | `verified` |
| `scripts/` | contract, migration, security and regression checks | `package.json`, repository tree | `verified` |
| `docs/openapi/` | current OpenAPI snapshots, manifests and immutable releases | repository tree and release scripts | `verified` |
| `.github/workflows/` | CI verification | workflow files | `verified` |
| `.agent-memory/`, `.agents/` | agent instructions, memory and installed skills | repository tree | `verified` |

The repository is not organized as the historical `apps/ops` path found in older memory references. Current source roots are at repository root.

## Domain and critical entities

| Domain area | Evidence | Confidence |
|---|---|---|
| Multi-tenant company/organization operations | company membership, tenant-bound API clients, RLS and company-scoped queries | `verified` |
| Electricity customer onboarding | website application/customer/site/metering logic | `verified` |
| Contracts, pricing and legal evidence | contract/pricing/legal modules and OpenAPI schemas | `verified` |
| Powers of attorney and supplier switching | POA, supplier-switch and outbound/EDIEL modules | `verified` |
| Customer portal integration | `/api/v1/customer-portal/**` and customer-portal OpenAPI | `verified` |
| Public website integration | website API routes and website-integration OpenAPI | `verified` |
| Billing/provider webhooks | billing webhook routes and provider processing | `verified` |
| Email delivery and inbound mail | Resend/email provider, SMTP/IMAP/manual inbound modules | `verified` |
| Scheduled operations | extensive Vercel cron configuration and protected cron routes | `verified` |
| Analytics/health/readiness | analytics cron and internal system health route | `verified` |

## Authentication, authorization and isolation

| Control | Observed design | Confidence |
|---|---|---|
| User authentication | Supabase Auth/session helpers | `verified` |
| API clients | bearer/API-key authentication with server-derived company context | `verified` |
| Authorization | roles, memberships, scopes and permission functions | `verified` |
| Database isolation | RLS plus explicit company filters/service-role controls | `verified` |
| Scheduled route authentication | dedicated secret and optionally `CRON_SECRET`, timing-safe compare | `verified` |
| Webhook authentication | provider-specific signature/timestamp verification in inspected paths | `verified` |
| Full two-tenant runtime isolation | not executed in V3 | `unknown` |

## APIs and contracts

| Surface | Contract/source of truth | Confidence |
|---|---|---|
| Website integration API | `docs/openapi/website-integration-v1.json` plus manifest/generated types | `verified` |
| Customer portal API | `docs/openapi/customer-portal-v1.json` plus manifest/generated types | `verified` |
| Versioned immutable API documents | `docs/openapi/releases/<version>/**` and versioned routes | `verified` |
| Current contract version in V3 branch | `2026-08-05.2` | OpenAPI documents/release checks | `verified` |
| Deployed runtime parity | no safe live fixture/credential run | `unknown` |

## Workers, cron, queues and external boundaries

| Boundary | Repository evidence | Confidence |
|---|---|---|
| Vercel cron jobs | `vercel.json` schedules and protected route handlers | `verified` |
| EDIEL transport | SMTP/IMAP/S-MIME/outbox/inbound modules | `verified` |
| Email provider | Resend plus internal provider abstraction | `verified` |
| External price/geography data | configured provider clients documented in env checklist/code | `verified` |
| Webhook delivery | internal and provider webhook modules | `verified` |
| Payment processing | billing records/provider webhooks exist; no direct card-processing platform verified | `likely` |
| Dedicated queue vendor | no separate external queue product established from reviewed sources | `unknown` |

## Test and quality system

| Capability | Evidence | Confidence |
|---|---|---|
| Type checking | application, script and test typecheck scripts | `verified` |
| Unit/integration tests | Vitest and repository tests | `verified` |
| Browser/E2E tests | Playwright dependency/configuration | `verified` |
| Migration validation | migration check scripts and CI gate | `verified` |
| API compatibility/release checks | compatibility, release and runtime-parity scripts | `verified` |
| Security regression scripts | RBAC/hardening/production security scripts | `verified` |
| Full staging E2E execution in this audit | unavailable | `unknown` |

## Regulatory and business constraints

The repository clearly handles contracts, customer identity/contact data, legal documents, powers of attorney, billing and electricity-market operations. These make tenant isolation, actor attribution, immutable contract evidence, reliable outbound processing and privacy/security high-impact controls. Specific legal compliance conclusions are not inferred solely from code and remain outside this technical audit unless explicitly documented and tested.
