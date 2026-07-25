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
