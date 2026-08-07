# Gridex OPS migration provenance contract

This document is the machine-verifiable bootstrap contract for a fresh Gridex OPS database.
It does not change the live migration ledger and it does not authorize editing already-applied migrations.

## 1. Legacy foundation — always before timestamped migrations

Apply in this exact order:

1. `01_db1_schema_repair_core_helpers_and_canonical_tables.sql`
2. `02_db1_operations_ediel_billing_dedupe_and_storage.sql`
3. `03_db1_backfill_functions_rls_reports_and_finish.sql`
4. `ediel_rules.sql`
5. `Batch 1+2.sql`
6. `batch 3.sql`
7. `batch 4+5+6.sql`

These files are historical immutable inputs. Do not rename or rewrite them to manufacture migration history.
Their SHA-256 values are pinned by `scripts/migration-history-manifest.json`.

## 2. Controlled legacy reconciliation

These six files are also immutable legacy inputs. They are only executed when the controlled reconciliation procedure is required, and in this exact order:

1. `01_db2_full_view_preflight_schema_and_functions.sql`
2. `02_db2_execute_controlled_reconciliation.sql`
3. `03_db2_validation_and_finish.sql`
4. `01_db2b_preflight_views.sql`
5. `02_db2b_apply_superadmin_and_membership.sql`
6. `03_db2b_validation_views.sql`

A clean empty staging database must prove whether this reconciliation phase is required before it can be omitted from a canonical replay.

## 3. Canonical timestamped set

After the required legacy phase, apply every file matching:

`^[0-9]{14}_.+\.sql$`

in ascending filename order.

Files with shorter numeric prefixes or free-form names are historical/manual artifacts unless they are explicitly listed in sections 1 or 2. They must not silently enter the canonical replay chain.

## 4. Current provenance boundary

The connected `gridex-ops-dev` migration ledger currently starts at:

`20260531075508` — `fix_customer_internal_notes_customer_fk`

The repository contains canonical 14-digit migrations older than that ledger boundary. The development schema also contains objects created by the legacy foundation, including `public.companies`.

Therefore the remote ledger alone is not a valid empty-database bootstrap source. A clean replay must start from this documented legacy foundation contract and then apply the canonical timestamped set.

## 5. Safety rules

- Never manually insert/delete/update rows in `supabase_migrations.schema_migrations` to make history appear complete.
- Never mutate already-applied migration SQL in place.
- Never infer missing historical DDL when checksum-pinned repository evidence exists.
- Never treat a failed Supabase preview branch as staging-verified.
- Any change to the legacy order, checksums, or replay classification must fail CI until this contract and its regression are deliberately updated together.

## 6. Verification gate

`node scripts/gridex-aud-003-migration-provenance-regression.cjs`

must pass on every PR that can affect migrations. A separate isolated database replay is still required before `GRIDEX-AUD-003` can be marked `DEV_VERIFIED`.
