# Gridex OPS — Deployment, CI/CD and Observability

## Overall status

- Deployment configuration: `verified` by source inspection.
- Expanded CI quality gate: `in_progress` until the final branch HEAD completes.
- Deployed preview/staging behavior: `blocked` without approved environment credentials and fixtures.
- Production readiness: not established by this report.

## Deployment profile

| Area | Observed configuration | Status |
|---|---|---|
| Hosting target | Vercel configuration present | `verified` |
| Build command | `npm run build` | `verified` |
| Node runtime | Node.js 22 in deployment/CI configuration | `verified` |
| Scheduled jobs | multiple cron routes declared in `vercel.json` | `verified` |
| Database platform | Supabase/PostgreSQL | `verified` |
| Production environment schema | broad prose checklist exists; central machine-enforced schema and generated `.env.example` absent | `partially_fixed` documentation only |
| Preview/staging validation | no safe deployed fixture used in V3 | `blocked` |
| Rollback exercise | no deployment rollback was executed | `blocked` |

## CI workflow

The `OPS hardening` workflow uses npm with Node.js 22 and runs on pull requests. During V3 it was expanded to cover:

- clean dependency installation,
- migration integrity,
- Gridex API/billing/tenant regression,
- application, script and test typechecking,
- lint,
- dedicated customer-portal sync error regression,
- multitenant quote idempotency,
- targeted and full Vitest execution,
- OPS hardening/behavior/final-contract regressions,
- API error boundaries,
- API compatibility,
- API release verification,
- production dependency security audit,
- production build.

The timeout was raised from 20 to 30 minutes to accommodate the broader deterministic matrix. No test was skipped or weakened.

### CI supply-chain observation

The workflow still references:

- `actions/checkout@v4`
- `actions/setup-node@v4`

Status: `unverified` supply-chain hardening gap. Mutable major tags are common but do not provide immutable provenance. The safest follow-up is to pin reviewed action commits after the expanded workflow is green. No compromise is alleged.

## Release and migration sequencing

Verified release controls include:

- immutable versioned OpenAPI snapshots,
- immutable versioned HTTP routes,
- release manifest/finalization checks,
- migration integrity scripts,
- generated contract/type checks in repository scripts.

V3 reproduced a release-line defect where contract version `2026-08-05.2` lacked immutable release files and routes on the audit branch. Focused commits materialized both without changing the canonical contract content. The existing hardening workflow then passed on `f5d81c726dbe3f023f00e3f99c3a33829e5a9ac1`.

The audit branch remains diverged from `main`; no automatic merge/rebase was performed. A human must reconcile branch history before merge while preserving the verified release material.

## Health and readiness

`app/api/internal/system/health/route.ts` is protected by scheduled-request authentication and inspects multiple operational dependencies, including:

- Supabase admin health,
- deployment environment,
- auth admin client,
- cron configuration,
- Next.js technology version,
- email readiness,
- operational mailbox readiness.

Strengths:

- health access is not public by default,
- missing accepted cron secret fails closed,
- checks return structured status suitable for operations.

Blocked validation:

- no deployed health endpoint was invoked,
- no incident alert was triggered,
- no readiness/rollback decision was exercised.

## Logging and correlation

`lib/http/apiError.ts` provides a consistent API error envelope with:

- stable machine-readable `code`,
- safe `message`,
- `request_id`,
- optional bounded details,
- structured logging context,
- generic handling of unexpected 500 errors.

Observed strengths:

- request IDs are propagated or generated server-side,
- internal unexpected messages are not automatically returned to clients,
- route logging can include relevant context.

Remaining observability gaps:

| Gap | Status | Evidence needed |
|---|---|---|
| Central log sink and retention | `unverified` | deployed logging configuration |
| PII redaction across all modules | `unverified` | repository-wide/runtime log sample audit |
| Metrics and dashboards | `unverified` | monitoring configuration/dashboard inventory |
| Distributed traces | `unverified` | tracing instrumentation and live trace |
| Alerts/SLOs | `unverified` | alert rules, ownership and test notification |
| Cron missed-run detection | `unverified` | scheduler/monitoring evidence |
| Queue/dead-letter operational runbook | `unverified` | verified runbook and exercise |

## Environment and secrets

Verified repository behavior:

- secret-bearing values are intended for server-only variables,
- scheduled authentication fails closed when no accepted secret is configured,
- Supabase runtime helpers validate required values outside the production-build placeholder phase.

Risks/gaps:

- build-time Supabase placeholders mean a green build does not prove deploy-time credentials are valid,
- `.env.example` is absent,
- the environment checklist identifies itself as a point-in-time grep and can drift,
- live Vercel/Supabase/email/EDIEL secret presence and rotation were not inspected.

No secret value was written to reports or commits.

## Rollback and change safety

No destructive database operation, force push, automatic merge, production deployment or external message was performed. The OpenAPI fix is additive and rollbackable by reverting its focused commits before publication; already published immutable release URLs should not be deleted after external consumption.

## Required staging validation

Before advancing readiness:

1. Complete the expanded CI matrix on the final audit HEAD.
2. Reconcile audit/main divergence through human review without rewriting published release history.
3. Deploy to an explicitly isolated preview/staging environment.
4. Run system-health checks with approved secrets.
5. Execute two-tenant auth/RLS/API/customer/contract/billing flows.
6. Exercise cron, webhook retry/idempotency, email and EDIEL test paths without external production recipients.
7. Confirm logs redact PII/secrets and include request/correlation IDs.
8. Verify alert ownership and rollback procedures.
