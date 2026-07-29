# Database and migrations

- Verified local migration files: 299 in 204 version groups.
- Applied production state: UNVERIFIED in this archive.
- Never edit an already-applied migration; add a forward migration.
- Return-type changes require dropping the exact old function signature or a
  newly versioned function.
- Every customer/lifecycle relation must be tenant-safe.
- Schema work requires preflight, migration, backfill, postflight and recovery
  notes.
- New pending forward migration:
  `20260725120000_billing_readiness_and_supply_activation_v1.sql`.
- Local checksum/history validation passes. PostgreSQL apply, rollback-on-error,
  idempotent replay and two-tenant isolation remain required in staging.

## 2026-07-29 commercial selection

- New pending forward migration:
  `20260729200000_contract_commercial_selection_completion.sql`.
- Registered SHA-256:
  `59c19820866d186567914b12fcf831cc94c769ba200038034fbc4e172603d80c`.
- Adds option/area rows, component selection fields, quote v3, exact contract
  binding, atomic internal selection, backfill/review and invoice trace columns
  without rewriting historical snapshots.
- Current history validation is blocked by the pre-existing immutable
  `20260728170000...` mismatch. Do not change the manifest.
