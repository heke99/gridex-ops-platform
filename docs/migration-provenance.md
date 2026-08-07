# Gridex OPS migration provenance contract

This document is the machine-verifiable bootstrap contract for a fresh Gridex OPS database.
It does not change the live migration ledger and it does not authorize editing already-applied migrations.

## 1. Explicit historical foundation — always before canonical 14-digit migrations

Apply in this exact order:

1. `01_db1_schema_repair_core_helpers_and_canonical_tables.sql`
2. `02_db1_operations_ediel_billing_dedupe_and_storage.sql`
3. `03_db1_backfill_functions_rls_reports_and_finish.sql`
4. `20260520_batch_3_4_onboarding_pricing_billing_engine.sql`
5. `ediel_rules.sql`
6. `Batch 1+2.sql`
7. `batch 3.sql`
8. `batch 4+5+6.sql`

The fourth file is intentionally explicit even though it carries an 8-digit date prefix. A clean replay proved that `ediel_rules.sql` updates `public.metering_permissions`, while `20260520_batch_3_4_onboarding_pricing_billing_engine.sql` is the checksum-pinned idempotent migration that creates that table. Therefore it must precede `ediel_rules.sql` on an empty database.

These files are historical immutable inputs. Do not rename or rewrite them to manufacture migration history. Their SHA-256 values are pinned by `scripts/migration-history-manifest.json`.

## 2. Controlled legacy reconciliation

These six files are also immutable legacy inputs. They are only executed when the controlled reconciliation procedure is required, and in this exact order:

1. `01_db2_full_view_preflight_schema_and_functions.sql`
2. `02_db2_execute_controlled_reconciliation.sql`
3. `03_db2_validation_and_finish.sql`
4. `01_db2b_preflight_views.sql`
5. `02_db2b_apply_superadmin_and_membership.sql`
6. `03_db2b_validation_views.sql`

A clean empty staging database must prove whether this reconciliation phase is required before it can be omitted from a canonical replay.

## 3. Canonical 14-digit set

After the explicit historical foundation, apply every file matching:

`^[0-9]{14}_.+\.sql$`

in ascending filename order.

Files with shorter numeric prefixes or free-form names are historical/manual artifacts unless they are explicitly listed in sections 1 or 2. They must not silently enter the canonical replay chain. If a clean replay proves that another historical artifact is a real schema prerequisite, it must be checksum-pinned and deliberately added to this contract before it can enter the bootstrap.

## 4. Current provenance boundary

The connected `gridex-ops-dev` migration ledger currently starts at:

`20260531075508` — `fix_customer_internal_notes_customer_fk`

The repository contains canonical 14-digit migrations older than that ledger boundary and historical schema inputs outside the remote ledger. The development schema also contains objects created by that historical foundation, including `public.companies` and `public.metering_permissions`.

Therefore the remote ledger alone is not a valid empty-database bootstrap source. A clean replay must start from this documented historical foundation contract and then apply the canonical 14-digit set.

## 5. Safety rules

- Never manually insert/delete/update rows in `supabase_migrations.schema_migrations` to make history appear complete.
- Never mutate already-applied migration SQL in place.
- Never infer missing historical DDL when checksum-pinned repository evidence exists.
- Never treat a failed Supabase preview branch as staging-verified.
- Any change to the historical order, checksums, or replay classification must fail CI until this contract and its regression are deliberately updated together.

## 6. Verification gates

`node scripts/gridex-aud-003-migration-provenance-regression.cjs`

verifies the static provenance contract and checksums.

`bash scripts/gridex-aud-003-clean-replay.sh`

starts an empty local Supabase stack, applies the explicit historical foundation and then the canonical 14-digit migration set with `ON_ERROR_STOP=1`. This isolated replay must pass before `GRIDEX-AUD-003` can be marked `DEV_VERIFIED`.
