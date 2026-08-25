# Gridex OPS admin navigation performance batch

- Base: main@453975bc7f322df96e4a15e45bf3ea24d00b2304
- Branch: perf/admin-instant-navigation-20260825
- Goal: reduce click-to-render latency without changing RBAC, tenant scope, business semantics, API contracts, EDIEL, legal evidence, writes, or production data.

## Production evidence
- Current production deployment dpl_GyfJvxCX21wwsqvFzncueqY8NVkh showed a burst of cache-miss requests for many visible admin sidebar destinations at 20:48:49–20:48:51 UTC, including customers, switches, metering, contracts, Ediel control tower, outbound and customer-info routes.
- This matches automatic viewport Link prefetch generating concurrent work for expensive authenticated dynamic routes.

## Changes
1. Admin sidebar disables automatic Link prefetch and uses router.prefetch only on pointer/focus intent.
2. Metering page reuses the already server-verified permission context for user id/email instead of calling auth.getUser again.
3. Regression assertions lock the prefetch and auth-reuse invariants.

## Verification required
- typecheck
- full Vitest
- OPS hardening
- performance/N+1/SLO gates
- production build
- bundle budget
- full E2E
- browser/quality E2E
- READY Vercel preview

Do not merge without explicit user authorization for this PR.
