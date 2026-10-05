# 2026-08-03 — Runtime readiness reconciliation v4

- Never edit already-applied history. This repair uses forward migration
  `20260803212754_canonical_migration_readiness_reconciliation_v4.sql`.
- Authoritative live ledger versions replaced two drifted local filenames:
  `20260803152014_contract_portfolio_tenant_fk_indexes.sql` and
  `20260803152236_portfolio_superadmin_helper_service_role_only.sql`.
- The canonical manifest now maps migrations explicitly by both
  `applied_ledger_version` and `applied_ledger_name`; raw manifest/ledger count
  equality is not a valid readiness invariant when schema-effect and alias rows
  exist.
- Migration governance is audit evidence. External API availability is governed
  by `gridex_runtime_schema_capabilities_v3`, which checks actual required
  relations, columns, functions, RLS policies and ACLs.
- The migration was applied to `gridex-ops-dev` and registered in both the
  Supabase ledger and canonical manifest. The idempotent post-apply script passed
  twice.
- Live evidence after apply: manifest 38; ledger 34; missing mappings 0; unmapped
  ledger versions 0; duplicate mappings 0; invalid checksums 0; unverified
  effects 0; all readiness sources true.
- Do not run `supabase db push` blindly against the already-reconciled live
  project. Confirm the linked ledger first. For another environment, apply the
  forward migration normally and then run
  `scripts/post-apply-runtime-readiness-v4.sql`.

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

## 2026-09-04 — canonical schema baseline (`supabase/schema.sql`)

`supabase/schema.sql` and `supabase/schema.fingerprint.json` are the canonical
Fas 3 artifacts. `npm run db:schema:check` compares a fresh dump against them
byte for byte inside the `clean-migration-replay` job, so **any migration that
changes the public schema turns that gate red until the baseline is refreshed.**

Refresh procedure — read this before "fixing" a red schema check:

1. Push the migration. The job still generates `rem002-schema-snapshot/` and
   uploads it as evidence even when the comparison fails.
2. Download that artifact from the run and copy its two files over
   `supabase/schema.sql` and `supabase/schema.fingerprint.json`.
3. Commit them with the migration. The next run compares against the new
   baseline and goes green.

Do NOT regenerate the baseline locally. `npm run db:schema:snapshot` works
against any database, but only the Supabase stack in CI produces the canonical
result: a plain PostgreSQL shadow reconstructs the same relations, columns,
functions, indexes and triggers, and differs on extensions, policies and grants
(2548 policies against 714, 13307 relation grants against 5546, 8 extensions
against 5). A locally generated baseline would be wrong in exactly the places
the gate exists to watch.

`pg_dump` must match the server major. `supabase/config.toml` pins
`major_version = 17`, the job installs `postgresql-client-<major>` read from
that file and passes the explicit binary through `GRIDEX_PG_DUMP`, because
Debian's pg_wrapper does not reliably resolve to the newest installed major and
because the dump body itself is version-specific (`SET transaction_timeout` is
emitted only by 17).

First baseline: fingerprint `3b0dd50e7f5c6178b8d925c4469f1759b5a83d64e020bde1555ef5ae4c0e08f0`,
captured from run 33874550022 and verified by the check in the same job.
