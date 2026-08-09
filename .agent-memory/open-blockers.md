# Open blockers

Last updated: 2026-08-09T09:45:00Z

## Active code residual after PR #90

### 1. GRIDEX-OPS-BL-006 staging verification pending

Code and static regressions are implemented on
`cursor/codebase-health-and-stability-8f9d`. The two-tenant SQL rollback
regression still needs an isolated/non-production database apply.

### 2. O-008 actor_readiness_status authenticated SELECT

`actor_readiness_status` remains granted to `authenticated` with
`security_invoker=true`, so non-admin JWTs can under-count conflicts via RLS on
`actor_registry_conflicts`. Known app consumers use service role. Intentionally
not bundled into BL-006.

## External configuration gaps (unchanged from PR #90)

1. GitHub Actions hosted runners account/billing blocked.
2. `main` reported unprotected; no connector write for branch protection.
3. Supabase Leaked Password Protection disabled; no connector Auth write.
4. No isolated Supabase preview database for destructive final replay.
