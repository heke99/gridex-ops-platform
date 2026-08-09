# Handover — post-merge health follow-up after PR #90

Branch: `cursor/codebase-health-and-stability-8f9d`
Base: `main` @ `6c86e547`

## What landed on main

PR #90 merged the full integrity/performance campaign (migration provenance,
storage isolation, customer-application split, log redaction, Grid Owner
performance, OPS health 42702 fix, nanoid bump).

## What this branch fixes

Closed PR #89 never merged. Residual BL-002 variants remained:

1. Broad authenticated SELECT on contacts + lookup caches → forward migration
   `20260809123000` (GRIDEX-OPS-BL-006).
2. `/admin/network-owners` import history silent-empty path → `supabaseService`
   after `requirePlatformAdminAccess()`.
3. Log redaction missed `person_number` / `personNumber` metadata keys.

## Verified here

- Static BL-006 regression
- AUD-003 provenance regression
- Migration integrity
- Logging redaction vitest (5)

## Not verified here

- SQL two-tenant rollback against a live non-production database
- Exact-head GitHub Actions (billing-blocked)
- O-008 revoke of authenticated SELECT on `actor_readiness_status`

## Resume

1. Open/merge this PR after review.
2. Apply `20260809123000` on staging/dev.
3. Run `scripts/gridex-ops-bl-006-contacts-and-lookup-cache-read-isolation-regression.sql`.
4. Optionally open a follow-up for O-008 only.
