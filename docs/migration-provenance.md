# Gridex OPS migration provenance contract

This document is the machine-verifiable bootstrap contract for a fresh Gridex OPS database.
It does not change the live migration ledger and it does not authorize editing already-applied migrations.

## 1. Explicit historical foundation — always before canonical 14-digit migrations

Apply in this exact order:

1. `migrations/01_db1_schema_repair_core_helpers_and_canonical_tables.sql`
2. `migrations/02_db1_operations_ediel_billing_dedupe_and_storage.sql`
3. `migrations/03_db1_backfill_functions_rls_reports_and_finish.sql`
4. `bootstrap/20260520_metering_permissions_foundation.sql`
5. `bootstrap/20260521_ediel_test_runs_foundation.sql`
6. `migrations/20260528_batch_2_ediel_rulebook_system_tests.sql`
7. `migrations/20260529_batch_2_rulebook_hardening_sql_fix_v4.sql`
8. `migrations/ediel_rules.sql`
9. `migrations/Batch 1+2.sql`
10. `migrations/batch 3.sql`
11. `migrations/batch 4+5+6.sql`

The metering bootstrap is a derived artifact, not a rewritten migration. Its DDL is sourced from the immutable, checksum-pinned `migrations/20260520_batch_3_4_onboarding_pricing_billing_engine.sql`. A clean replay proved that `ediel_rules.sql` requires `public.metering_permissions`, while replaying the whole source after the later DB1 repair collides with the newer billing-export schema. The derived artifact therefore contains only the prerequisite table and indexes.

The Ediel test-run bootstrap is also deliberately narrow. Its DDL is sourced from immutable, checksum-pinned `migrations/20260521_actor_testing_go_live_module.sql`. The 20260528 rulebook migration references `public.ediel_test_runs` for test artifacts, but replaying the entire go-live module would pull unrelated white-label and production-go-live state into the historical bootstrap. The derived artifact therefore creates only `ediel_test_runs` and its documented index.

Both derived artifacts have independent SHA-256 pins in `scripts/gridex-aud-003-legacy-foundation.json`, and CI verifies the checksum-pinned immutable source migrations as well.

The two following historical rulebook migrations are included whole because repository evidence explicitly marks the 20260528 migration safe/idempotent and it creates `ediel_field_rules` / `ediel_code_rules`; the 20260529 v4 compatibility migration then adds the compatibility columns and list representations consumed by `ediel_rules.sql`.

The historical migration files remain immutable inputs. Do not rename or rewrite them to manufacture migration history.

## 2. Controlled legacy reconciliation

These six files are also immutable legacy inputs. They are only executed when the controlled reconciliation procedure is required, and in this exact order:

1. `migrations/01_db2_full_view_preflight_schema_and_functions.sql`
2. `migrations/02_db2_execute_controlled_reconciliation.sql`
3. `migrations/03_db2_validation_and_finish.sql`
4. `migrations/01_db2b_preflight_views.sql`
5. `migrations/02_db2b_apply_superadmin_and_membership.sql`
6. `migrations/03_db2b_validation_views.sql`

A clean empty database must prove whether this reconciliation phase is required before it can be omitted from a canonical replay.

## 3. Canonical 14-digit set

After the explicit historical foundation, apply every file matching:

`^[0-9]{14}_.+\.sql$`

in ascending filename order.

Files with shorter numeric prefixes or free-form names are historical/manual artifacts unless they are explicitly listed in sections 1 or 2. They must not silently enter the canonical replay chain. If a clean replay proves that another historical artifact is a real schema prerequisite, the source evidence must be checksum-pinned and any derived bootstrap artifact must be deliberately reviewed, independently hashed, and added to this contract.

## 4. Current provenance boundary

The connected `gridex-ops-dev` migration ledger currently starts at:

`20260531075508` — `fix_customer_internal_notes_customer_fk`

The repository contains canonical 14-digit migrations older than that ledger boundary and historical schema inputs outside the remote ledger. The development schema also contains objects created by that historical foundation, including `public.companies`, `public.metering_permissions`, `public.ediel_test_runs`, and the Ediel rulebook tables.

Therefore the remote ledger alone is not a valid empty-database bootstrap source. A clean replay must start from this documented historical foundation contract and then apply the canonical 14-digit set.

## 5. Safety rules

- Never manually insert/delete/update rows in `supabase_migrations.schema_migrations` to make history appear complete.
- Never mutate already-applied migration SQL in place.
- Never infer missing historical DDL when checksum-pinned repository evidence exists.
- A derived bootstrap artifact must be narrower than its source and may contain only evidenced prerequisites needed to make a deterministic empty-database replay possible.
- Never treat a failed Supabase preview branch as staging-verified.
- Any change to the historical order, checksums, bootstrap artifacts, or replay classification must fail CI until this contract and its regression are deliberately updated together.

## 6. Verification gates

`node scripts/gridex-aud-003-migration-provenance-regression.cjs`

verifies the static provenance contract, immutable source checksums, derived bootstrap hashes and safety constraints.

`bash scripts/gridex-aud-003-clean-replay.sh`

starts an empty local Supabase stack, applies the explicit historical foundation and then the canonical 14-digit migration set with `ON_ERROR_STOP=1`. This isolated replay must pass before `GRIDEX-AUD-003` can be marked `DEV_VERIFIED`.
