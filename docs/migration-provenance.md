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
10. `bootstrap/20260528_inbound_email_messages_foundation.sql`
11. `migrations/batch 3.sql`
12. `migrations/batch 4+5+6.sql`
13. `bootstrap/20260522_set_updated_at_timestamp_foundation.sql`
14. `bootstrap/20260605_ediel_outbox_foundation.sql`

The metering bootstrap is a derived artifact sourced from immutable, checksum-pinned `migrations/20260520_batch_3_4_onboarding_pricing_billing_engine.sql`. It contains only `metering_permissions`, because replaying the whole historical source after the later DB1 repair collides with the newer billing-export schema.

The Ediel test-run bootstrap is sourced from immutable, checksum-pinned `migrations/20260521_actor_testing_go_live_module.sql` and creates only `ediel_test_runs`, which the 20260528 rulebook migration references.

The inbound-mail bootstrap is sourced from immutable, checksum-pinned `migrations/20260528_batch_7a_route_inbound_mail_platform_ui.sql`. `Batch 1+2.sql` already creates `ediel_mailboxes`; this artifact adds only `inbound_email_messages`, which `batch 3.sql` immediately updates and indexes.

The updated-at trigger bootstrap restores `public.set_updated_at_timestamp()` exactly as recovered with `pg_get_functiondef` from `gridex-ops-dev` on 2026-08-07. The checksum-pinned `migrations/20260522_batch4f_rbac_database_lint_hardening.sql` corroborates that the helper already existed historically by hardening its search path. The derived artifact contains only that trigger helper and is applied before the tracked EDIEL intent migration that references it.

The Ediel outbox bootstrap is sourced from immutable, checksum-pinned `migrations/20260605160000_ediel_backend_automation_foundation.sql`. It contains only the original `public.ediel_outbox` base table and `ediel_outbox_lock_key_uidx`. The base columns match the prefix of the current `gridex-ops-dev` table; later tracked migrations remain responsible for intent, locking, transport, certificate, route-contract and rule-pack additions.

All derived artifacts have independent SHA-256 pins in `scripts/gridex-aud-003-legacy-foundation.json`; CI also verifies the immutable source migration checksums. The 20260528 Ediel rulebook migration and 20260529 v4 compatibility migration are included whole because they are idempotent historical prerequisites for `ediel_rules.sql`.

Historical migration files remain immutable. Do not rename or rewrite them to manufacture migration history.

## 2. Controlled legacy reconciliation

These six files are immutable legacy inputs and are executed only when controlled reconciliation is required, in this order:

1. `migrations/01_db2_full_view_preflight_schema_and_functions.sql`
2. `migrations/02_db2_execute_controlled_reconciliation.sql`
3. `migrations/03_db2_validation_and_finish.sql`
4. `migrations/01_db2b_preflight_views.sql`
5. `migrations/02_db2b_apply_superadmin_and_membership.sql`
6. `migrations/03_db2b_validation_views.sql`

## 3. Canonical 14-digit set

After the explicit historical foundation, replay the official dev ledger through the commit represented by `main`. Historical ledger aliases are checksum-validated against their canonical repository migration and are not executed twice.

Other short-date or free-form files do not silently enter the bootstrap. If clean replay proves another prerequisite, its source must be checksum-pinned and any derived bootstrap artifact must be narrowly scoped, independently hashed and deliberately added to this contract.

## 4. Current provenance boundary

The connected `gridex-ops-dev` ledger currently starts at `20260531075508` — `fix_customer_internal_notes_customer_fk`. Repository history and the live development schema contain required state older than that remote ledger boundary, so the remote ledger alone is not an empty-database bootstrap source.

A historical Supabase MCP ledger row at `20260803081939` is an alias of canonical repository migration `20260803093300_duplicate_primary_client_audit_contract_v3.sql`; both are tied to the same recorded SHA-256. Clean replay validates the alias but executes the canonical SQL only once.

## 5. Safety rules

- Never manually edit `supabase_migrations.schema_migrations` to manufacture provenance.
- Never mutate already-applied migration SQL in place.
- Never infer missing historical DDL when checksum-pinned repository or live-schema evidence exists.
- Derived bootstrap artifacts may contain only evidenced prerequisites and must remain narrower than their source migrations.
- Never treat a failed Supabase preview branch as staging-verified.
- Changes to bootstrap order, checksums, artifacts or classification must fail CI until this contract and regression are deliberately updated together.

## 6. Verification gates

`node scripts/gridex-aud-003-migration-provenance-regression.cjs` verifies source checksums, derived hashes, order and safety constraints.

`bash scripts/gridex-aud-003-clean-replay.sh` starts an empty local Supabase stack and applies the explicit historical foundation followed by the main-aligned official dev ledger with `ON_ERROR_STOP=1`. It must pass before `GRIDEX-AUD-003` can be marked `DEV_VERIFIED`.
