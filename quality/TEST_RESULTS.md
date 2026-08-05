# Gridex OPS — Test Results

## Current audit status

This report records only executed checks and explicit blockers. Evidence comes from exact-branch source inspection, direct Supabase project/catalog queries and GitHub Actions on `audit/gridex-ops-full-integrity-review`.

## Final expanded code verification

Workflow: `OPS hardening`  
Run: `31054238744`  
Job: `92468135354`  
Code commit: `20220a9b83b65148862685f3fec47bbebff64ae2`  
Conclusion: `success`

| Executed command/check | Result |
|---|---|
| `npm ci` | `passed` |
| `npm run db:migrations:check` | `passed` |
| `npm run gridex:api-billing-tenant-hardening-regression` | `passed` |
| `npm run typecheck` | `passed` |
| `npm run typecheck:scripts` | `passed` |
| `npm run typecheck:tests` | `passed` |
| `npm run lint` | `passed` |
| `node scripts/gridex-customer-portal-sync-error-contract-regression.cjs` | `passed` |
| `node scripts/gridex-quote-idempotency-multitenant-regression.cjs` | `passed` |
| targeted usage/integration idempotency Vitest | `passed` |
| full `npm test` | `passed` |
| `npm run ops:hardening-regression` | `passed` |
| `npm run ops:hardening-behavior-regression` | `passed` |
| `npm run ops:final-contract-regression` | `passed` |
| `npm run api:error-boundaries` | `passed` |
| `npm run api:compatibility` | `passed` |
| `npm run api:release:verify` | `passed` |
| `npm run security:audit-production` | `passed` |
| `npm run build` | `passed` |

The commits after `20220a9b…` update audit Markdown reports only. They do not change application source, tests, migrations, manifests or the workflow matrix.

## Defect-revealing run chronology

| Run | Failure | Evidence and correction | Final status |
|---|---|---|---|
| `31052421121` | immutable OpenAPI `2026-08-05.2` snapshots missing | exact canonical release blobs added in `c3979436…` | `fixed` |
| `31052649096` | immutable versioned OpenAPI routes missing | versioned routes added in `f5d81c72…` | `fixed` |
| `31053249461` | lint failed on two reserved `module` bindings | behavior-neutral renames in `507340ed…` and `f8ea025b…` | `fixed` |
| `31053761076` | four stale public-contract tests | modern fixtures received hashes; route test uses current contract constant; historical-null case retained | `fixed` |
| `31054238744` | no failure | complete expanded matrix passed | `verified` |

## Direct repository and platform checks

| Check | Result | Status |
|---|---|---|
| Repository/default branch | `heke99/gridex-ops-platform`, `main` | `verified` |
| Audit branch | `audit/gridex-ops-full-integrity-review` | `verified` |
| V3 start SHA | `f81126bea4fbe6bf1403496840b47d1fe02becf8` | `verified` |
| V3 default-branch baseline | `ec4ca3b63bb7c97a35755b0b393da404d67cc687` | `verified` |
| Branch divergence | audit and `main` diverged; no merge/rebase performed | `verified` |
| Supabase project | `gridex-ops-dev`, `piidsfebjqjmnepdpnas` | `verified` |
| Supabase health | `ACTIVE_HEALTHY` during V3 | `verified` |
| RLS/public privileges | prior direct catalog check found public tables RLS-enabled; client roles could not create in `public` | `verified` for queried state |
| Reviewed SECURITY DEFINER helpers | constrained search path, no anon execute, explicit identity/membership/admin/service checks | `verified` for queried functions |
| Cross-tenant exploit | none reproduced | `unverified` repository-wide; staging two-tenant run blocked |
| Installed skills | 35/35 readable; 0 mandatory V3 paths missing | `verified` |

## Finding status affected by executed tests

- `BUG-001` Customer Portal controlled input mapping: `fixed`; dedicated regression passed.
- `BUG-006` immutable OpenAPI release completeness: `fixed`; release verification passed.
- `BUG-007` lint bindings: `fixed`; lint passed.
- `BUG-008` stale legal/version fixtures: `fixed`; full tests passed.

## Checks still blocked or incomplete

| Check | Status | Exact blocker |
|---|---|---|
| `npm run api:runtime:parity` against deployed environment | `blocked` | no approved staging tenant/API-client credentials |
| deployed two-tenant auth/RLS/legal/POA/customer/billing E2E | `blocked` | no isolated deployed fixture and credentials |
| provider/email/EDIEL live-safe integration tests | `blocked` | provider test environments and approved recipients unavailable |
| Supabase leaked-password setting | `unverified` | Auth dashboard setting not readable/changeable through current tools |
| billing webhook response normalization | `unverified` | authoritative provider retry contract and safe fixture unavailable |
| general SAST | `blocked` | no repository-approved scanner run |
| full current-tree and Git-history secret scan | `blocked` | no authenticated local clone/history scanner |
| Dependabot reconciliation | `blocked` | security product/API returned 403/unavailable |
| `npm audit --json` and dependency reachability (`npm explain`) | `blocked` | not part of the approved workflow evidence captured here |
| browser accessibility, keyboard and screen-reader validation | `blocked` | no browser/test fixture run |
| production-like performance/load/query-plan validation | `blocked` | no isolated dataset, APM/RUM or `EXPLAIN ANALYZE` evidence |
| local worktree cleanliness and `git diff --check` | `blocked` | connector-backed session has no local checkout/worktree |

## Interpretation

The source and CI baseline is substantially stronger: installation, migrations, all TypeScript layers, lint, dedicated regressions, full tests, API compatibility/release checks, security script and production build all pass on the verified code commit.

This does not prove deployed configuration, production isolation, provider behavior, accessibility, performance capacity or full supply-chain security. Those areas remain explicitly blocked or unverified.
