# Gridex OPS — Test Baseline

## Execution environment

- Repository/branch verified through GitHub connector.
- No authenticated local checkout is available in this session.
- `gh` is not installed in the available container.
- The repository's prior verification notes record a package-mirror failure for `zod-validation-error@4.0.2` and earlier DNS/registry failures.
- Therefore no npm, TypeScript, lint, Vitest, build or script command is claimed as freshly passed.

## Baseline commands

All commands are intended to run from repository root.

| Command | Exit code | Status | Evidence/blocker |
|---|---:|---|---|
| `npm ci` | not run | blocked | No local checkout; known package-mirror/registry blocker |
| `npm run lint` | not run | blocked | Dependencies unavailable |
| `npm run typecheck` | not run | blocked | Dependencies unavailable |
| `npm run typecheck:scripts` | not run | blocked | Dependencies unavailable |
| `npm run typecheck:tests` | not run | blocked | Dependencies unavailable |
| `npm test` | not run | blocked | Dependencies unavailable |
| `npm run db:migrations:check` | not run | blocked | No local checkout/dependencies; live migration history was queried separately |
| `npm run security:rbac` | not run | blocked | No local checkout/dependencies |
| `npm run api:compatibility` | not run | blocked | No local checkout/dependencies |
| `npm run api:release:verify` | not run | blocked | No local checkout/dependencies |
| `npm run api:runtime:parity` | not run | blocked | No local checkout/dependencies/runtime |
| `npm run ops:hardening-regression` | not run | blocked | No local checkout/dependencies |
| `npm run gridex:production-route-readiness-regression` | not run | blocked | No local checkout/dependencies; some scenarios require EDIEL readiness |
| `npm run gridex:rls-multisite-metering-billing-regression` | not run | blocked | No local checkout/dependencies/test credentials |
| `npm run security:audit-production` | not run | blocked | No dependency tree installed |
| `npm run build` | not run | blocked | No local checkout/dependencies |

## Repository-specific controls discovered

The root scripts also expose targeted checks for:

- API error boundaries and canonical error contracts
- OpenAPI finalization, compatibility and runtime parity
- migration integrity and lock verification
- legal/POA platform hardening
- EDIEL routing, production-send guards and two-tenant isolation
- website intake/customer-number/multi-site flows
- billing readiness and area propagation
- cron idempotency and locking
- shared mailbox tenant resolution
- test/production separation

These must be selected based on changed files and rerun in the final clean environment.

## Live database checks completed

The following were executed directly against Supabase project `piidsfebjqjmnepdpnas` and are not substitutes for repository tests:

- project discovery/status
- latest migration history query
- public table/RLS catalog counts
- schema privileges for `anon`, `authenticated` and `service_role`
- policy inspection for tenant/customer/legal/EDIEL tables
- security-definer helper definitions, privileges and `search_path`
- Supabase security and performance advisors

## Historical evidence

`.agent-memory/verification-matrix.md` records prior targeted passes for migration integrity, API/OpenAPI version checks, legal package grouping, POA scope and changed-file syntax. It also records full dependency gates as blocked. These results are retained as historical evidence only and are not marked as fresh passes in this audit.
