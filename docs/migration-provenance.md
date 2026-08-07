# Gridex OPS migration provenance contract

This is the machine-verifiable clean-database replay contract for Gridex OPS. It does not modify the live Supabase migration ledger and does not authorize rewriting already-applied migration files.

## 1. Explicit historical foundation

Apply these inputs before the official 14-digit ledger replay, in this order:

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
37. `bootstrap/20260721_contract_publication_revisions_foundation.sql`
38. `bootstrap/20260722_external_tenant_reference_foundation.sql`
39. `bootstrap/20260724_customer_application_continuation_schema_foundation.sql`
40. `bootstrap/20260801_company_capabilities_foundation.sql`

All derived bootstrap artifacts are intentionally narrower than their immutable historical source. Artifact SHA-256 values and source mappings are pinned in `scripts/gridex-aud-003-legacy-foundation.json` and `scripts/gridex-aud-003-legacy-foundation.additions.json`; source migration checksums are pinned by `scripts/migration-history-manifest.json`.

The foundation restores schema prerequisites only. It must not seed auth users, administrators, API clients, customer applications, workflows, jobs, contract publication revision rows, tenants, webhook deliveries, customer cases, email messages or other operational product rows. Worker/orchestration RPC behavior is excluded from derived bootstraps unless separately proven necessary.

`bootstrap/20260721_contract_publication_revisions_foundation.sql` is derived from checksum-pinned `migrations/20260721170000_contract_graph_api_revision_hardening.sql`. It restores only the historical `contract_publication_revisions` relation and fail-closed RLS required by the tracked shared public-contract snapshot schema/RPC. It does not seed revision rows or replay publication-event functions.

`bootstrap/20260722_external_tenant_reference_foundation.sql` is derived from checksum-pinned `migrations/20260722133000_external_tenant_quote_api_completion.sql`. It restores only the stable opaque external tenant reference generator, `companies.external_tenant_reference`, uniqueness index and format constraint required by tracked public-contract snapshot migrations. It creates no tenant rows or integration records.

## 2. Controlled legacy reconciliation

These immutable legacy inputs are not part of the normal foundation and may be executed only by controlled reconciliation, in this order:

1. `migrations/01_db2_full_view_preflight_schema_and_functions.sql`
2. `migrations/02_db2_execute_controlled_reconciliation.sql`
3. `migrations/03_db2_validation_and_finish.sql`
4. `migrations/01_db2b_preflight_views.sql`
5. `migrations/02_db2b_apply_superadmin_and_membership.sql`
6. `migrations/03_db2b_validation_views.sql`

## 3. Canonical ledger replay and interleaved prerequisites

After the historical foundation, replay the official development ledger represented by `scripts/gridex-aud-003-main-ledger.json`. The replay stages checksum-validated repository SQL under the official ledger version/name and uses Supabase CLI to apply it so `supabase_migrations.schema_migrations` is created and maintained by Supabase itself. Historical ledger aliases are represented by a no-op migration at the official alias version so canonical SQL executes only once.

Two historical prerequisites must be interleaved because their target/dependent objects occur inside the tracked ledger sequence rather than entirely before it.

First, apply `bootstrap/20260802_canonical_migration_manifest_verification_foundation.sql` after ledger version `20260802180000` and immediately before ledger version `20260803093000`. This artifact is derived from checksum-pinned `migrations/20260802232000_migration_truth_readiness.sql` and restores only `canonical_migration_manifest.verified_at`, `verification_source`, `release_identifier`, and `schema_fingerprint`. It creates no manifest rows and manufactures no verification evidence. The tracked `20260803093000_platform_schema_runtime_columns_v3.sql` remains responsible for later ledger/effect metadata, and `20260803093200_gridex_migration_governance_v3.sql` remains responsible for the v3 governance view.

Second, apply `bootstrap/20260716_contract_platform_readiness_foundation.sql` after ledger version `20260803100130` and immediately before `20260803131558`. Its source is checksum-pinned `migrations/20260716183000_contract_canonical_finalization.sql`, which created `gridex_contract_platform_readiness(uuid)`. The exact pre-hardening implementation is independently corroborated by the preserved `gridex_contract_platform_readiness_internal_v1(uuid)` definition in `gridex-ops-dev`: migration `20260803131558_external_api_contract_database_hardening_v1.sql` renames the historical function to that internal name before installing the tenant-authorized facade. The bootstrap restores only that RPC and seeds no product data.

Neither interleaved prerequisite inserts or updates `supabase_migrations.schema_migrations`; only Supabase CLI owns the replay ledger.

## 4. Provenance boundary

The connected `gridex-ops-dev` ledger starts at `20260531075508` (`fix_customer_internal_notes_customer_fk`). Repository history and the verified development schema contain prerequisite state older than that boundary, so the remote ledger alone is not a valid empty-database bootstrap source.

Historical Supabase ledger row `20260803081939` is an explicit alias of canonical repository migration `20260803093300_duplicate_primary_client_audit_contract_v3.sql`; replay validates the alias and records it through Supabase CLI without executing duplicate canonical SQL.

## 5. Safety rules

- Never manually edit `supabase_migrations.schema_migrations` to manufacture provenance.
- Never mutate already-applied migration SQL in place.
- Never infer missing historical DDL when checksum-pinned repository or verified schema evidence exists.
- Derived bootstrap artifacts must remain narrower than their source migration and contain only evidenced prerequisites.
- The clean replay must let Supabase CLI create/update its local official migration ledger; direct DML against the ledger is prohibited.
- A failed or missing staging target must never be represented as staging-verified.
- Any change to bootstrap order, source checksum, artifact checksum, alias mapping or interleaved boundary must fail CI until the contract and regression are updated together.

## 6. Verification gates

`node scripts/gridex-aud-003-migration-provenance-regression.cjs` verifies immutable source checksums, derived artifact hashes, foundation order, interleaved bounds, replay inclusion and safety constraints.

`bash scripts/gridex-aud-003-clean-replay.sh` starts an empty local Supabase stack, applies the explicit historical foundation, lets Supabase CLI apply and record the official dev ledger in controlled phases, injects each checksum-pinned interleaved prerequisite only at its declared boundary, compares the resulting CLI-owned ledger row-for-row against `scripts/gridex-aud-003-main-ledger.json`, and performs final schema smoke checks.

Both the full OPS verify job and clean migration replay must pass on the exact same commit before `GRIDEX-AUD-003` can be marked `DEV_VERIFIED` or merged.
