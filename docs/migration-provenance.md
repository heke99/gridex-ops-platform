# Gridex OPS migration provenance contract

This document is the machine-verifiable bootstrap contract for a fresh Gridex OPS database. It does not change the live migration ledger and it does not authorize editing already-applied migrations.

## 1. Explicit historical foundation — always before canonical 14-digit migrations

Apply in this exact order:

1. `migrations/01_db1_schema_repair_core_helpers_and_canonical_tables.sql`
2. `migrations/02_db1_operations_ediel_billing_dedupe_and_storage.sql`
3. `migrations/03_db1_backfill_functions_rls_reports_and_finish.sql`
4. `bootstrap/20260519_user_profiles_foundation.sql`
5. `bootstrap/20260520_metering_permissions_foundation.sql`
6. `bootstrap/20260520_customer_cases_email_outbox_foundation.sql`
7. `bootstrap/20260521_company_ediel_production_profile_foundation.sql`
8. `bootstrap/20260521_actor_test_results_foundation.sql`
9. `bootstrap/20260521_ediel_test_runs_foundation.sql`
10. `bootstrap/20260521_ediel_test_run_messages_foundation.sql`
11. `bootstrap/20260522_admin_users_foundation.sql`
12. `bootstrap/20260523_rbac_permission_helpers_foundation.sql`
13. `bootstrap/20260528_ediel_test_run_steps_foundation.sql`
14. `migrations/20260528_batch_2_ediel_rulebook_system_tests.sql`
15. `migrations/20260529_batch_2_rulebook_hardening_sql_fix_v4.sql`
16. `bootstrap/20260529_ediel_test_artifact_message_foundation.sql`
17. `migrations/ediel_rules.sql`
18. `migrations/Batch 1+2.sql`
19. `bootstrap/20260528_inbound_email_messages_foundation.sql`
20. `migrations/batch 3.sql`
21. `migrations/batch 4+5+6.sql`
22. `bootstrap/20260522_set_updated_at_timestamp_foundation.sql`
23. `bootstrap/20260531_integration_api_clients_foundation.sql`
24. `bootstrap/20260601_ediel_production_readiness_foundation.sql`
25. `bootstrap/20260602_ediel_certificates_foundation.sql`
26. `bootstrap/20260602_ediel_environment_type_foundation.sql`
27. `bootstrap/20260605_ediel_outbox_foundation.sql`
28. `bootstrap/20260609_integration_api_client_origins_foundation.sql`
29. `bootstrap/20260609_webhook_email_readiness_foundation.sql`
30. `bootstrap/20260609_website_customer_applications_foundation.sql`
31. `bootstrap/20260611_grid_owner_information_request_foundation.sql`
32. `bootstrap/20260612_integration_api_client_lifecycle_foundation.sql`
33. `bootstrap/20260613_powers_of_attorney_customer_site_foundation.sql`
34. `bootstrap/20260614_integration_api_client_readiness_foundation.sql`
35. `bootstrap/20260618_customer_operation_jobs_foundation.sql`
36. `bootstrap/20260618_customer_application_workflows_foundation.sql`
37. `bootstrap/20260724_customer_application_continuation_schema_foundation.sql`
38. `bootstrap/20260801_company_capabilities_foundation.sql`

Every derived bootstrap artifact is deliberately narrower than its immutable source and is independently SHA-256 pinned in `scripts/gridex-aud-003-legacy-foundation.json` or the machine-verified `scripts/gridex-aud-003-legacy-foundation.additions.json`. CI also verifies each source migration checksum from `scripts/migration-history-manifest.json`.

### Derived prerequisite evidence

`bootstrap/20260519_user_profiles_foundation.sql` is sourced from checksum-pinned `migrations/20260519_auth_callback_email_reset_sync.sql`. It restores only the historical `user_profiles` relation, auth-state columns, constraint and indexes required by canonical actor authorization. It creates no auth users or profiles and does not replay the unrelated auth-email event ledger or backfill.

`bootstrap/20260520_customer_cases_email_outbox_foundation.sql` is sourced from checksum-pinned `migrations/20260520_batch_5_cases_audit_email_ux.sql`. It restores only the connected historical `customer_cases` and `tenant_email_outbox` relations, indexes and fail-closed service-role RLS. It seeds no cases, messages or other product data.

The 20260521 Ediel artifacts restore only the legacy company production projection, actor-test result ledger, test-run base and original test-run message relation from checksum-pinned `migrations/20260521_actor_testing_go_live_module.sql`.

`bootstrap/20260522_admin_users_foundation.sql` restores the historical platform-admin projection shape verified from `gridex-ops-dev`; it creates no administrator rows. `bootstrap/20260523_rbac_permission_helpers_foundation.sql` restores only the historical permission lookup helpers and grants no new roles or permissions.

`bootstrap/20260528_ediel_test_run_steps_foundation.sql` and `bootstrap/20260529_ediel_test_artifact_message_foundation.sql` restore only the historical Ediel evidence prerequisites required before tracked tenant-qualified evidence migrations.

`bootstrap/20260531_integration_api_clients_foundation.sql` restores the base `integration_api_clients` relation from checksum-pinned `migrations/20260531111600_system_readiness_foundation.sql`; it creates no API clients or credential material.

`bootstrap/20260609_integration_api_client_origins_foundation.sql` is sourced from checksum-pinned `migrations/20260609150000_batch_6_sync_status_origin_fix.sql` and restores only `allowed_origins` plus the historical API-client runtime fields/indexes needed by later checks.

`bootstrap/20260612_integration_api_client_lifecycle_foundation.sql` is sourced from checksum-pinned `migrations/20260612193000_platform_tenant_contracts_api_mail.sql` and restores only lifecycle columns including `deleted_at`.

`bootstrap/20260614_integration_api_client_readiness_foundation.sql` is sourced from checksum-pinned `migrations/20260614140000_ops_production_multitenant_readiness.sql` and restores only `profile_key`, `launch_ready` and `launch_blockers`. These three API-client artifacts seed no clients and exist solely to reproduce the historical runtime shape required by later canonical capability migrations.

`bootstrap/20260602_ediel_environment_type_foundation.sql`, `bootstrap/20260605_ediel_outbox_foundation.sql`, `bootstrap/20260609_webhook_email_readiness_foundation.sql`, `bootstrap/20260609_website_customer_applications_foundation.sql`, `bootstrap/20260611_grid_owner_information_request_foundation.sql`, and `bootstrap/20260613_powers_of_attorney_customer_site_foundation.sql` similarly restore only source-evidenced prerequisites and seed no operational product rows.

`bootstrap/20260618_customer_operation_jobs_foundation.sql` restores only the historical `customer_operation_jobs` relation, indexes and RLS from checksum-pinned `migrations/20260618110000_customer_operation_automation_jobs.sql`; it deliberately does not replay worker-claim RPC behavior.

`bootstrap/20260618_customer_application_workflows_foundation.sql` restores the durable application workflow relation from checksum-pinned `migrations/20260618213000_ops_completion_workflows_health.sql` without workflow rows.

`bootstrap/20260724_customer_application_continuation_schema_foundation.sql` restores only continuation workflow columns, the `customer_application_workflow_events` ledger, queue linkage, indexes and foreign key from checksum-pinned `migrations/20260724210000_customer_application_continuation_orchestrator.sql`. It omits orchestration RPC behavior and seeds no workflows, jobs or events.

`bootstrap/20260801_company_capabilities_foundation.sql` restores only the historical fail-closed company capability registry needed by tracked canonical tenant-operation migrations.

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

`node scripts/gridex-aud-003-migration-provenance-regression.cjs` verifies source checksums, derived hashes, order and safety constraints across the primary provenance plan and its machine-verified additions file.

`bash scripts/gridex-aud-003-clean-replay.sh` starts an empty local Supabase stack and applies the explicit historical foundation followed by the main-aligned official dev ledger with `ON_ERROR_STOP=1`. It must pass before `GRIDEX-AUD-003` can be marked `DEV_VERIFIED`.
