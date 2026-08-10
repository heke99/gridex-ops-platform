# Handover

Updated: 2026-08-10

## Context

`main` advanced via `#104` (75-point remediation) to `e8586c1b`. Draft `#102`
still held the O-008 PUBLIC privilege residual on timestamp `20260809151500`,
which is now behind later `#104` migrations and must not be applied as-is on
databases that already include `20260810110829`.

## This branch

`cursor/codebase-health-and-stability-94a3` re-lands the residual with forward
timestamp `20260810121500` and also closes the related `#104` hygiene gap where
`platform_schema_state` was revoked from anon/authenticated only.

## Verified locally

- `node scripts/gridex-ops-o008-public-privilege-hardening-regression.cjs` PASS
- `node scripts/check-migration-versions.cjs` PASS
- `node scripts/gridex-ops-o008-actor-readiness-conflict-count-visibility-regression.cjs` PASS
- `node scripts/gridex-ops-bl-001-write-permission-hardening-regression.cjs` PASS
- `node scripts/gridex-ops-v3-bug-001-portal-sync-controlled-errors-regression.cjs` PASS
- `node scripts/gridex-customer-portal-sync-error-contract-regression.cjs` PASS

## Not verified

- Staging/live privilege matrix (`has_table_privilege` for anon/authenticated)
- Full npm/vitest suite (`node_modules` absent)
- ggshield (CLI unavailable in environment)

## Next

1. Open PR from this branch; treat draft `#102` as superseded.
2. After merge/apply, run staging SQL privilege checks for readiness views and
   `platform_schema_state`.
3. Do not reopen portal parse / BL-001 / BL-006 work already on main.
