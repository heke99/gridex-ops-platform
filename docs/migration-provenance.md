# Gridex OPS migration provenance contract

This document is the machine-verifiable bootstrap contract for a fresh Gridex OPS database. It does not change the live migration ledger and it does not authorize editing already-applied migrations.

## 1. Explicit historical foundation — always before canonical 14-digit migrations

Apply in this exact order:

1. `migrations/01_db1_schema_repair_core_helpers_and_canonical_tables.sql`
2. `migrations/02_db1_operations_ediel_billing_dedupe_and_storage.sql`
3. `migrations/03_db1_backfill_functions_rls_reports_and_finish.sql`
4. `bootstrap/20260520_metering_permissions_foundation.sql`
5. `bootstrap/20260521_company_ediel_production_profile_foundation.sql`
6. `bootstrap/20260521_actor_test_results_foundation.sql`
7. `bootstrap/20260521_ediel_test_runs_foundation.sql`
8. `bootstrap/20260521_ediel_test_run_messages_foundation.sql`
9. `bootstrap/20260528_ediel_test_run_steps_foundation.sql`
10. `migrations/20260528_batch_2_ediel_rulebook_system_tests.sql`
11. `migrations/20260529_batch_2_rulebook_hardening_sql_fix_v4.sql`
12. `bootstrap/20260529_ediel_test_artifact_message_foundation.sql`
13. `migrations/ediel_rules.sql`
14. `migrations/Batch 1+2.sql`
15. `bootstrap/20260528_inbound_email_messages_foundation.sql`
16. `migrations/batch 3.sql`
17. `migrations/batch 4+5+6.sql`
18. `bootstrap/20260522_set_updated_at_timestamp_foundation.sql`
19. `bootstrap/20260601_ediel_production_readiness_foundation.sql`
20. `bootstrap/20260602_ediel_certificates_foundation.sql`
21. `bootstrap/20260605_ediel_outbox_foundation.sql`
22. `bootstrap/20260611_grid_owner_information_request_foundation.sql`
23. `bootstrap/20260613_powers_of_attorney_customer_site_foundation.sql`
24. `bootstrap/20260801_company_capabilities_foundation.sql`

Every derived bootstrap artifact is deliberately narrower than its immutable source and is independently SHA-256 pinned in `scripts/gridex-aud-003-legacy-foundation.json`. CI also verifies the source migration checksum from `scripts/migration-history-manifest.json`.

The 20260521 artifacts restore only the legacy company Ediel production projection, actor-test result ledger, test-run base, and original test-run message relation from checksum-pinned `migrations/20260521_actor_testing_go_live_module.sql`.

`bootstrap/20260528_ediel_test_run_steps_foundation.sql` is sourced from checksum-pinned `migrations/20260528_batch_2_completion_rulebook_actions_regression.sql` and restores the original test-run step relation, prerequisite run metadata, indexes and RLS. `bootstrap/20260529_ediel_test_artifact_message_foundation.sql` is sourced from checksum-pinned `migrations/20260529_batch_2_rulebook_hardening_and_systemtest_ui.sql` and restores only `ediel_test_artifacts.ediel_message_id` with its historical message FK. Tenant ownership and composite tenant FKs remain the responsibility of tracked `20260802013000_ediel_test_evidence_v2.sql`.

The metering, inbound-mail, updated-at trigger, Ediel production readiness, Ediel certificate, Ediel outbox, grid-owner request, POA customer-site and company-capabilities artifacts similarly restore only prerequisites proven necessary by clean replay. They do not replay unrelated historical product behavior.

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

After the explicit historical foundation, replay the official dev ledger through the commit represented by `main`. Historical ledger aliases are checksum-validated against their canonical repository migration and are not executed twice. Other short-date or free-form files do not silently enter the bootstrap.

## 4. Current provenance boundary

The connected `gridex-ops-dev` ledger currently starts at `20260531075508` — `fix_customer_internal_notes_customer_fk`. Repository history and the live development schema contain required state older than that remote ledger boundary, so the remote ledger alone is not an empty-database bootstrap source.

Historical Supabase MCP ledger row `20260803081939` is an alias of canonical repository migration `20260803093300_duplicate_primary_client_audit_contract_v3.sql`; clean replay validates the alias but executes canonical SQL once.

## 5. Safety rules

- Never manually edit `supabase_migrations.schema_migrations` to manufacture provenance.
- Never mutate already-applied migration SQL in place.
- Never infer missing historical DDL when checksum-pinned repository or live-schema evidence exists.
- Derived bootstrap artifacts may contain only evidenced prerequisites and must remain narrower than source migrations.
- Never treat a failed Supabase preview branch as staging-verified.
- Changes to bootstrap order, checksums, artifacts or classification must fail CI until contract and regression are deliberately updated together.

## 6. Verification gates

`node scripts/gridex-aud-003-migration-provenance-regression.cjs` verifies source checksums, derived hashes, order and safety constraints.

`bash scripts/gridex-aud-003-clean-replay.sh` starts an empty local Supabase stack and applies the explicit historical foundation followed by the main-aligned official dev ledger with `ON_ERROR_STOP=1`. It must pass before `GRIDEX-AUD-003` can be marked `DEV_VERIFIED`.
