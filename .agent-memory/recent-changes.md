# Recent changes

## 2026-08-03 — Runtime schema readiness v4

- Removed the stale exact whole-schema fingerprint pin from the OPS runtime
  readiness gate.
- Added fail-closed capability-evidence evaluation and unit tests.
- Renamed two local portfolio migrations to authoritative live ledger versions.
- Added/applied `20260803212754_canonical_migration_readiness_reconciliation_v4.sql`.
- Reconciled six portfolio ledger rows into the canonical manifest.
- Replaced raw count/version/staleness migration readiness with explicit ledger
  mappings and effect verification.
- Added and live-replayed an idempotent post-apply verifier.
- Verified live Supabase readiness/governance and local API contract/OpenAPI
  version `2026-08-03.1`.
- Remaining incident action: redeploy OPS app and execute authenticated endpoint
  smoke tests; then sync Gridex Web OpenAPI.
