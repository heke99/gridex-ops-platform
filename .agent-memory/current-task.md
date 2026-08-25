# Current task

Updated: 2026-08-25

Status: `IMPLEMENTED_NOT_VERIFIED`

Active work item: improve Gridex OPS runtime performance without changing tenant isolation, RBAC/RLS, pricing, customer/site ownership, EDIEL/supplier-switch behavior, legal evidence, API contracts, or write semantics.

## Current batch

1. Install and lock the focused performance skill set.
2. Deduplicate the dashboard's repeated server-verified `auth.getUser()` lookup with request-scoped React cache.
3. Start the independent platform-role and operational-company-scope reads in parallel after verified authentication.
4. Keep `/dashboard`, `/admin`, `/portal`, and other authenticated surfaces dynamic.

## Exact next action

Run the branch through targeted regression, typecheck, full Vitest, production build, existing performance/N+1/bundle guards, and Vercel preview. Keep only verified improvements; do not merge until explicitly requested.
