# Current state

Last updated: 2026-08-03T23:37:05+02:00

## PHASE-41 runtime API readiness

- Root cause of the Website/Public Contracts `503 platform_schema_not_ready` is
  verified in OPS: runtime code required one obsolete exact whole-schema hash
  even though `gridex_runtime_schema_capabilities_v3` reported every required
  capability present.
- `lib/platform/schemaReadiness.ts` now gates external traffic on the versioned
  capability view's `is_ready=true` result and valid SHA-256 evidence. Compatible
  additive columns no longer cause an outage; missing capabilities or malformed
  evidence still fail closed.
- Live Supabase project `gridex-ops-dev` has forward migration
  `20260803212754_canonical_migration_readiness_reconciliation_v4` applied.
- Live verified state:
  - runtime capability readiness: true, zero blocking issues;
  - canonical migration readiness: true, zero blockers;
  - migration governance: true, zero missing/unmapped/duplicate mappings;
  - compatibility state: `20260803-runtime-capability-compatible-v4`, ready.
- Canonical manifest now contains 38 verified rows mapped to 34 authoritative
  ledger rows. The difference is intentional because schema-effect records and
  ledger aliases are first-class evidence; readiness no longer assumes raw
  manifest and ledger counts must be equal.
- Two local portfolio migration filenames now match the authoritative live
  ledger versions `20260803152014` and `20260803152236`.
- Official API/runtime documentation and generated OpenAPI remain aligned at
  `2026-08-03.1`; public contracts, application idempotency, single-key tenant
  isolation and multi-site Customer Portal static/runtime checks pass.

## Deployment state

- Database repair: APPLIED AND VERIFIED.
- Repository code repair: IMPLEMENTED AND STATIC/CONTRACT VERIFIED.
- Running OPS application: PENDING REDEPLOY.
- Gridex Web: previously typechecked, fully tested and built; must sync its local
  OpenAPI snapshot after OPS deploy.

## Verification limitation

The sandbox package mirror cannot provide one indirect npm tarball, so a clean
install/full TypeScript/build rerun is not claimed here. The operator must run
`npm ci`, all three TypeScript targets and `npm run build` under Node 22 before
merging/deploying.

## Unrelated inherited blockers

PHASE-40 emergency-access and legacy Ediel/data-quality blockers remain in
`open-blockers.md`. They do not explain this API `503` and were not silently
resolved by the v4 readiness repair.
