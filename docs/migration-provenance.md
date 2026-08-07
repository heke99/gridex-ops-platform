# Gridex OPS migration provenance contract

This document is the machine-verifiable bootstrap contract for a fresh Gridex OPS database. It does not change the live migration ledger and it does not authorize editing already-applied migrations.

## 1. Explicit historical foundation — always before canonical 14-digit migrations

Apply in this exact order:

1. `migrations/01_db1_schema_repair_core_helpers_and_canonical_tables.sql`
2. `migrations/02_db1_operations_ediel_billing_dedupe_and_storage.sql`
3. `migrations/03_db1_backfill_functions_rls_reports_and_finish.sql`
4. `bootstrap/20260520_metering_permissions_foundation.sql`
5. `bootstrap/20260520_customer_cases_email_outbox_foundation.sql`
6. `bootstrap/20260521_company_ediel_production_profile_foundation.sql`
7. `bootstrap/20260521_actor_test_results_foundation.sql`
8. `bootstrap/20260521_ediel_test_runs_foundation.sql`
9. `bootstrap/20260521_ediel_test_run_messages_foundation.sql`
10. `bootstrap/20260522_admin_users_foundation.sql`
11. `bootstrap/20260523_rbac_permission_helpers_foundation.sql`
12. `bootstrap/20260528_ediel_test_run_steps_foundation.sql`
13. `migrations/20260528_batch_2_ediel_rulebook_system_tests.sql`
14. `migrations/20260529_batch_2_rulebook_hardening_sql_fix_v4.sql`
15. `bootstrap/20260529_ediel_test_artifact_message_foundation.sql`
16. `migrations/ediel_rules.sql`
17. `migrations/Batch 1+2.sql`
18. `bootstrap/20260528_inbound_email_messages_foundation.sql`
19. `migrations/batch 3.sql`
20. `migrations/batch 4+5+6.sql`
21. `bootstrap/20260522_set_updated_at_timestamp_foundation.sql`
22. `bootstrap/20260531_integration_api_clients_foundation.sql`
23. `bootstrap/20260601_ediel_production_readiness_foundation.sql`
24. `bootstrap/20260602_ediel_certificates_foundation.sql`
25. `bootstrap/20260602_ediel_environment_type_foundation.sql`
26. `bootstrap/20260605_ediel_outbox_foundation.sql`
27. `bootstrap/20260609_webhook_email_readiness_foundation.sql`
28. `bootstrap/20260609_website_customer_applications_foundation.sql`
29. `bootstrap/20260611_grid_owner_information_request_foundation.sql`
30. `bootstrap/20260613_powers_of_attorney_customer_site_foundation.sql`
31. `bootstrap/20260618_customer_application_workflows_foundation.sql`
32. `bootstrap/20260724_customer_application_continuation_schema_foundation.sql`
33. `bootstrap/20260801_company_capabilities_foundation.sql`

Every derived bootstrap artifact is deliberately narrower than its immutable source and is independently SHA-256 pinned in `scripts/gridex-aud-003-legacy-foundation.json`. CI also verifies the source migration checksum from `scripts/migration-history-manifest.json`.

`bootstrap/20260520_customer_cases_email_outbox_foundation.sql` is sourced from checksum-pinned `migrations/20260520_batch_5_cases_audit_email_ux.sql`. It restores only the directly connected historical `customer_cases` and `tenant_email_outbox` relations, their original indexes and fail-closed service-role RLS. It seeds no cases, messages or other product data. The canonical queue hardening migration remains responsible for the later blocked-tenant-state fields and status constraint.

The 20260521 artifacts restore only the legacy company Ediel production projection, actor-test result ledger, test-run base, and original test-run message relation from checksum-pinned `migrations/20260521_actor_testing_go_live_module.sql`.

`bootstrap/20260522_admin_users_foundation.sql` restores the historical platform-admin projection shape verified from `gridex-ops-dev` on 2026-08-07. Immutable DB1/RBAC history corroborates the `user_id`, `role`, and `is_active` semantics. The bootstrap creates no administrator rows and therefore cannot manufacture privileged access in a clean database.

`bootstrap/20260523_rbac_permission_helpers_foundation.sql` is sourced from checksum-pinned `migrations/20260523_db3_tenant_isolation_rbac_enforcement.sql` and restores only `gridex_get_user_permissions(uuid)` plus `gridex_has_permission(uuid,text)`. The helpers preserve the historical role/direct-permission lookup and only grant execution to authenticated users; no new permissions or roles are seeded.

`bootstrap/20260528_ediel_test_run_steps_foundation.sql` is sourced from checksum-pinned `migrations/20260528_batch_2_completion_rulebook_actions_regression.sql` and restores the original test-run step relation, prerequisite run metadata, indexes and RLS. `bootstrap/20260529_ediel_test_artifact_message_foundation.sql` is sourced from checksum-pinned `migrations/20260529_batch_2_rulebook_hardening_and_systemtest_ui.sql` and restores only `ediel_test_artifacts.ediel_message_id` with its historical message FK. Tenant ownership and composite tenant FKs remain the responsibility of tracked `20260802013000_ediel_test_evidence_v2.sql`.

`bootstrap/20260531_integration_api_clients_foundation.sql` is sourced from checksum-pinned `migrations/20260531111600_system_readiness_foundation.sql`. It restores only the historical `integration_api_clients` relation and indexes needed by the website-application foreign key. It creates no API clients and seeds no secrets.

`bootstrap/20260602_ediel_environment_type_foundation.sql` is sourced from checksum-pinned `migrations/20260602143000_ediel_environment_business_action_locks.sql` and restores only the historical enum values `tgt_test`, `agt_test`, `bilateral_test`, and `production`. Canonical evidence migrations depend on the type but remain responsible for later environment-qualified records and constraints.

`bootstrap/20260609_webhook_email_readiness_foundation.sql` and `bootstrap/20260609_website_customer_applications_foundation.sql` are sourced from checksum-pinned `migrations/20260609162000_batch_7_website_integration_foundation.sql`. Together they restore only the source-defined domain-event/webhook/email-readiness relations and the historical `website_customer_applications` relation required by later workflow provenance. They seed no webhook subscriptions, deliveries, events, email settings or customer applications.

`bootstrap/20260618_customer_application_workflows_foundation.sql` is sourced from checksum-pinned `migrations/20260618213000_ops_completion_workflows_health.sql` and restores the original durable `customer_application_workflows` relation, indexes and fail-closed RLS without workflow rows.

`bootstrap/20260724_customer_application_continuation_schema_foundation.sql` is sourced from checksum-pinned `migrations/20260724210000_customer_application_continuation_orchestrator.sql`. It restores only the continuation workflow columns, `customer_application_workflow_events` ledger, queue linkage, indexes and foreign key required by later canonical event projection. It deliberately omits orchestration RPC behavior and seeds no workflows, jobs or events.

The metering, inbound-mail, updated-at trigger, Ediel production readiness, Ediel certificate, Ediel outbox, webhook/email readiness, website-application/workflow, grid-owner request, POA customer-site and company-capabilities artifacts similarly restore only prerequisites proven necessary by clean replay. They do not replay unrelated historical product behavior.

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
