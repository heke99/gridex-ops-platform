# Verification matrix

| Area | Repository/current SHA | Dev database | Separate staging | Production | Result |
|---|---|---|---|---|---|
| Source identity | Exact `bb877506...` | N/A | N/A | Deployed SHA not verified | Verified source only |
| Audit branch isolation | Created from exact main | N/A | N/A | N/A | Verified |
| Production code unchanged | Audit tree contains reports only | N/A | N/A | N/A | Verify again by PR diff |
| Migration latest version | `20260806122255` present | Applied/registered | NOT_VERIFIED | NOT_VERIFIED | Dev/main latest consistent |
| Full migration replay | Repo inventory partial across controls | 46-row official ledger + 94-row manifest | NOT_VERIFIED | NOT_VERIFIED | Failed provenance proof |
| Tables/RLS | Source migrations inspected partially | 489/489 RLS enabled | NOT_VERIFIED | NOT_VERIFIED | Dev verified |
| Tenant table RLS | Source helpers/policies inspected | 358/358 enabled | NOT_VERIFIED | NOT_VERIFIED | Dev verified enablement |
| Storage tenant isolation | Policy source/live catalog | Cross-tenant gap confirmed | NOT_VERIFIED | NOT_VERIFIED | Failed |
| `SECURITY DEFINER` grants/path | Source/migrations partial | 299; 0 anon; 11 authenticated; pinned paths | NOT_VERIFIED | NOT_VERIFIED | Dev reviewed |
| BL-002 global reads | Migration on main | Policies/dev tests reported and catalog consistent | NOT_VERIFIED | NOT_VERIFIED | Code/dev remediated |
| Security Advisor | N/A | OTP issue checked | NOT_VERIFIED | NOT_VERIFIED | Dev only |
| Performance Advisor | N/A | Current/stale rows differentiated | NOT_VERIFIED | NOT_VERIFIED | Dev only |
| Query performance | Source consumers partial | `pg_stat_statements` measured | NOT_VERIFIED | NOT_VERIFIED | Dev signal only |
| Quote integrity | Current source proves incomplete canonicalization | Live quote E2E not run | NOT_VERIFIED | NOT_VERIFIED | Defect confirmed/source |
| OpenAPI artifacts | `2026-08-05.2` present/current/immutable | N/A | Deployed route not verified | Deployed route not verified | Repository presence consistent |
| Generated types | Files present | N/A | Consumer compile not run | Consumer compile not run | NOT_VERIFIED exact parity |
| Customer portal | Routes/artifacts present | Data objects present | Live portal not connected | Live portal not connected | NOT_VERIFIED E2E |
| EDIEL certificate refresh | Source/integration paths present | NOT NULL failure in logs | NOT_VERIFIED | NOT_VERIFIED | Defect confirmed/dev |
| Auth configuration | Source clients | OTP advisor/logs | NOT_VERIFIED | NOT_VERIFIED | Partial |
| Error/log model | Source partial | Auth/Postgres logs inspected; API logs unavailable | NOT_VERIFIED | NOT_VERIFIED | Partial |
| CI exact head | Workflow inspected; current run succeeded | N/A | N/A | Deploy gate not proven | Configured checks pass; coverage incomplete |
| Branch protection | `main` unprotected | N/A | N/A | N/A | Failed |
| Dependency audit | Production audit in workflow passed | N/A | N/A | Runtime SBOM not verified | Partial |
| SAST/secret history | No enforced gate | N/A | N/A | N/A | NOT_VERIFIED |
| Build/lint/full tests | Scripts exist, absent from workflow | N/A | N/A | N/A | NOT_VERIFIED current head |
| Browser/bundle/Core Web Vitals | Source only | N/A | unavailable | unavailable | BLOCKED |
| External providers/webhooks | Source only | partial internal tables/logs | unavailable | unavailable | BLOCKED |

## Closure rule

No finding may become `VERIFIED_CLOSED` without exact-head code review/CI, negative and positive test, two-tenant coverage where relevant, non-production verification, deployment evidence and post-deploy production test/log inspection.