# CI/CD and test coverage

## Current workflow

Only one workflow was present: `.github/workflows/ops-hardening.yml`. The exact-head run for reviewed `main` succeeded for its configured jobs. `main` is not protected, so the workflow is not an enforceable merge/deploy boundary.

## Coverage matrix

| Control | Exists in repo | Runs on PR/current workflow | Runs on main | Current evidence | Gap / recommendation |
|---|---|---|---|---|---|
| Locked install (`npm ci`) | Yes | Yes | Yes | Exact-head run succeeded | Keep and cache safely. |
| Main TypeScript check | Yes | Yes | Yes | Succeeded | Add scripts/tests typecheck. |
| Migration integrity | Yes | Yes | Yes | Succeeded | Extend to full ledger/manifest/replay parity. |
| Focused tenant/idempotency regressions | Yes | Yes | Yes | Succeeded | Add storage and complete role matrix. |
| Focused hardening/API error regressions | Yes | Yes | Yes | Succeeded | Keep exact-head requirement. |
| Production dependency audit | Yes | Yes | Yes | Succeeded | Add dev/build tooling audit and policy. |
| ESLint | Yes | No | No | Not run | Required PR gate. |
| Production build | Yes | No | No | Not run | Required PR gate. |
| Full Vitest suite | Yes | No | No | Not run | Required PR gate. |
| Script/test typechecks | Scripts exist | No | No | Not run | Required. |
| OpenAPI release/current/immutable verification | Scripts exist | Incomplete/not in workflow | No | Not run | Required public API gate. |
| Generated type consistency | Scripts/files exist | No | No | Not run | Generate and fail on diff. |
| Database/pgTAP full suite | Partial scripts | No complete suite | No | Not run | Add isolated Supabase branch job. |
| Two-tenant storage/API/browser | Partial | No complete suite | No | Not run | Required for tenant-owned flows. |
| Concurrency/idempotency load tests | Partial | No | No | Not run | Add bounded non-production tests. |
| SAST | No enforceable gate found | No | No | Not verified | Add CodeQL/approved scanner. |
| Current-tree secret scan | No enforceable gate found | No | No | Manual narrow search only | Add gitleaks/trufflehog equivalent. |
| Git-history secret scan | No | No | No | Not verified | Scheduled and pre-release gate. |
| Bundle analysis/budget | No gate | No | No | Not verified | Add build artifact/budget. |
| Browser E2E/Lighthouse | No complete gate | No | No | Not verified | Add role and critical-flow suite. |
| Deployment/migration post-check | Docs/scripts partial | No enforced end-to-end | No | Production unavailable | Verify runtime schema/OpenAPI/health after deploy. |
| Branch protection | Repository capability | No | No | `main` unprotected | Require PR, reviews, status checks and no force/direct push. |

## Exact-head rule

Checks must run on the actual PR head after all code, migration and evidence commits. A prior green run, mergeability flag or successful Vercel build cannot substitute for database migration and post-deploy proof.

## Recommended workflow split

1. Fast correctness: install, lint, all typechecks, unit/contract/regression tests.
2. Build/API: production build, OpenAPI generation/release compatibility, generated-type diff, bundle report.
3. Security: dependency/SAST/current/history secret checks.
4. Database: fresh branch replay, schema diff, RLS/role/two-tenant/pgTAP.
5. Non-production E2E: website quote/application, portal, admin, webhooks/workers.
6. Deployment verification: schema fingerprint, immutable APIs, logs and rollback/forward-fix readiness.