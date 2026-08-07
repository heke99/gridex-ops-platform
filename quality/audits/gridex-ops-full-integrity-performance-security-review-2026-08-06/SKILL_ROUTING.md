# Skill routing

Inventory source: `skills-lock.json` on reviewed `main`. Every locked skill was read through its repository path or applied through its documented method. Status describes this audit, not future remediation.

| Skill | Status | Motivering | Konkret användning | Evidens |
|---|---|---|---|---|
| architecture-patterns | ACTIVATED | Whole-system layer alignment required. | Mapped database-to-UI flows and ownership boundaries. | `ARCHITECTURE_AND_DATA_FLOW.md` |
| api-design-principles | ACTIVATED | Public API contract integrity is central. | Checked versioning, errors, idempotency, units and compatibility. | `API_CONTRACT_COMPLIANCE.md` |
| api-implementation | ACTIVATED | Route/runtime behavior had to be tied to schemas. | Inventoried `app/api/v1` route handlers and quote implementation. | API matrix and `GRIDEX-AUD-002` |
| audit-context-building | ACTIVATED | Multiple divergent audits and PRs existed. | Fixed source identity to exact SHA and separated historical evidence. | `README.md` |
| bundle-size-optimization | CONDITIONAL | No production bundle output was available. | Defined required bundle measurements; no optimization claimed. | `CLIENT_PERFORMANCE.md` |
| database-audit-implementation | ACTIVATED | Live catalog and ledger verification required. | Queried RLS, grants, functions, views, policies, migrations and sizes. | DB/RLS reports |
| data-consistency | ACTIVATED | Quote hashes and migration truth diverged. | Traced canonical timestamps and migration ledgers. | Findings 002/003 |
| debug-like-expert | ACTIVATED | User-visible quote and EDIEL failures needed root cause. | Correlated source, PR patches and database logs. | Findings 002/006 |
| debug-strategies | ACTIVATED | Required reproducible negative/positive paths. | Defined exact regression and staging tests for each finding. | `FINDINGS.md` |
| dependency-management | ACTIVATED | Dependency and CI gates were in scope. | Reviewed lockfile-driven install, audit gate and missing checks. | `CI_CD_AND_TEST_COVERAGE.md` |
| error-handling-implementation | ACTIVATED | Error contracts and hidden causes were in scope. | Reviewed quote failure semantics, IDs and log behavior. | observability/API reports |
| frontend-testing | CONDITIONAL | Browser runtime was unavailable. | Specified role-based Playwright/Lighthouse scenarios. | client/verification reports |
| javascript-testing-patterns | ACTIVATED | Test design and current scripts were evaluated. | Classified unit, regression, contract and E2E gaps. | CI matrix |
| nextjs-app-router-patterns | ACTIVATED | Application uses Next.js App Router. | Inventoried route handlers, server/client boundaries and route sizes. | system/client reports |
| nodejs-backend-patterns | ACTIVATED | Server routes, workers and cron behavior were reviewed. | Assessed retries, batching, service clients and orchestration. | server/integration reports |
| performance-profiling | ACTIVATED | Measured evidence was required before claims. | Used `pg_stat_statements`, relation sizes and call timing. | server performance report |
| postgresql-optimization | ACTIVATED | SQL/RLS/index behavior is central. | Checked catalog, table statistics, advisor signals and query hotspots. | performance advisor report |
| production-code-audit | ACTIVATED | Full codebase integrity review requested. | Classified findings with exact source/database evidence. | `FINDINGS.md` |
| python-testing-patterns | SKIPPED_WITH_REASON | No material Python production/test surface was identified. | No Python-specific test recommendation added. | Repository stack inventory |
| react-best-practices | ACTIVATED | UI/client architecture and hydration risk were in scope. | Reviewed client-performance evidence and required browser checks. | `CLIENT_PERFORMANCE.md` |
| react-performance-optimization | CONDITIONAL | No browser trace/bundle baseline was available. | Avoided unsupported optimization claims; supplied measurement plan. | client report |
| secure-code-guardian | ACTIVATED | Cross-tenant and secrets risks were central. | Threat modeled storage, APIs, service role and auth. | security/threat reports |
| session-handoff | ACTIVATED | Existing `.agent-memory` state affected operational truth. | Compared memory state to current main/PR/database state. | `GRIDEX-AUD-011` |
| supabase-postgres-best-practices | ACTIVATED | Supabase/RLS/SQL review required. | Used direct advisors plus catalog verification; rejected stale advice. | advisor/RLS reports |
| tailwind-design-system | SKIPPED_WITH_REASON | Visual design consistency was not an audit objective and no UI artifact was modified. | None. | Scope statement |
| test-driven-development | ACTIVATED | Remediation must be test-first. | Every finding includes failing and passing test requirements. | `FINDINGS.md` |
| testing-patterns | ACTIVATED | Broad test architecture had to be evaluated. | Produced CI coverage and verification matrices. | CI/verification reports |
| testing-strategies | ACTIVATED | Risk-based negative, positive and two-tenant coverage required. | Prioritized tests by severity and blast radius. | remediation plan |
| ui-ux-pro-max | CONDITIONAL | Functional browser access was unavailable. | Limited review to source/runtime evidence; browser UX marked blocked. | client report |
| vercel-deploy-best-practices | ACTIVATED | Deployment parity and branch gates are material. | Assessed deployment proof gap and unprotected main. | CI/security reports |
| webapp-testing | CONDITIONAL | Connected browser/test environment was unavailable. | Specified E2E role, quote, portal and admin scenarios. | verification plan |
| website-performance | CONDITIONAL | No Lighthouse/RUM data was available. | Defined LCP/INP/CLS and route-waterfall measurements. | client report |

Conditional skills become mandatory in remediation branches when the required runtime, bundle or browser environment is available.