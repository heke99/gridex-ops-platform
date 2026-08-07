# Gridex OPS migration provenance contract

This document is the machine-verifiable bootstrap contract for a fresh Gridex OPS database.
It does not change the live migration ledger and it does not authorize editing already-applied migrations.

## 1. Explicit historical foundation — always before canonical 14-digit migrations

Apply in this exact order:

1. `migrations/01_db1_schema_repair_core_helpers_and_canonical_tables.sql`
2. `migrations/02_db1_operations_ediel_billing_dedupe_and_storage.sql`
3. `migrations/03_db1_backfill_functions_rls_reports_and_finish.sql`
4. `bootstrap/20260520_metering_permissions_foundation.sql`
5. `bootstrap/20260521_company_ediel_production_profile_foundation.sql`
6. `bootstrap/20260521_actor_test_results_foundation.sql`
7. `bootstrap/20260521_ediel_test_runs_foundation.sql`
8. `migrations/20260528_batch_2_ediel_rulebook_system_tests.sql`
9. `migrations/20260529_batch_2_rulebook_hardening_sql_fix_v4.sql`
10. `migrations/ediel_rules.sql`
11. `migrations/Batch 1+2.sql`
12. `bootstrap/20260528_inbound_email_messages_foundation.sql`
13. `migrations/batch 3.sql`
14. `migrations/batch 4+5+6.sql`
15. `bootstrap/20260522_set_updated_at_timestamp_foundation.sql`
16. `bootstrap/20260601_ediel_production_readiness_foundation.sql`
17. `bootstrap/20260605_ediel_outbox_foundation.sql`
18. `bootstrap/20260611_grid_owner_information_request_foundation.sql`
19. `bootstrap/20260613_powers_of_attorney_customer_site_foundation.sql`
20. `bootstrap/20260801_company_capabilities_foundation.sql`

The metering bootstrap is a derived artifact sourced from immutable, checksum-pinned `migrations/20260520_batch_3_4_onboarding_pricing_billing_engine.sql`. It contains only `metering_permissions`, because replaying the whole historical source after the later DB1 repair collides with the newer billing-export schema.

The company Ediel production-profile, actor-test-result and Ediel test-run bootstraps are sourced from immutable, checksum-pinned `migrations/20260521_actor_testing_go_live_module.sql`. They restore only the legacy production projection fields still read by canonical Ediel state, the historical `actor_test_results` ledger and its original indexes, and `ediel_test_runs`. Later canonical migrations remain responsible for configuration snapshot and staleness fields.

The inbound-mail bootstrap is sourced from immutable, checksum-pinned `migrations/20260528_batch_7a_route_inbound_mail_platform_ui.sql`. `Batch 1+2.sql` already creates `ediel_mailboxes`; this artifact adds only `inbound_email_messages`, which `batch 3.sql` immediately updates and indexes.

The updated-at trigger bootstrap restores `public.set_updated_at_timestamp()` exactly as recovered with `pg_get_functiondef` from `gridex-ops-dev` on 2026-08-07. The checksum-pinned `migrations/20260522_batch4f_rbac_database_lint_hardening.sql` corroborates that the helper already existed historically by hardening its search path. The derived artifact contains only that trigger helper and is applied before the tracked EDIEL intent migration that references it.

The Ediel production-readiness bootstrap is sourced from immutable, checksum-pinned `migrations/20260601070000_ediel_production_readiness_hardening.sql`. It restores the canonical precursor fields on `companies`, the `ediel_production_readiness_checks` and `ediel_go_live_events` evidence tables, their original indexes, and tenant-safe RLS policies. It deliberately excludes mailbox, send-lock and unrelated hardening changes. The tracked `20260802011000_canonical_ediel_production_state.sql` requires these relations and fields before it can add snapshot metadata and compile the canonical transition function.

The Ediel outbox bootstrap is sourced from immutable, checksum-pinned `migrations/20260605160000_ediel_backend_automation_foundation.sql`. It contains only the original `public.ediel_outbox` base table and `ediel_outbox_lock_key_uidx`. The base columns match the prefix of the current `gridex-ops-dev` table; later tracked migrations remain responsible for intent, locking, transport, certificate, route-contract and rule-pack additions.

The grid-owner request bootstrap is sourced from immutable, checksum-pinned `migrations/20260611100000_energy_resolver_grid_area_operations.sql`. It restores the original, directly connected `grid_owner_contact_routes`, `customer_site_resolution` and `grid_owner_information_requests` relations plus their original indexes. This preserves the historical foreign-key chain while deliberately excluding unrelated PostGIS geometry, shared master-data and import/cache objects from that larger source migration. The tracked 20260626 manual grid-owner communication migration requires `grid_owner_information_requests` to exist before it can attach outreach foreign keys.

The POA customer-site bootstrap is sourced from immutable, checksum-pinned `migrations/20260613090000_batch_m_ops_master_legal_readiness.sql`. It restores only nullable `powers_of_attorney.customer_site_id`, its `customer_sites(id)` foreign key with `ON DELETE SET NULL`, and the historical `customer_site_id = coalesce(customer_site_id, site_id)` backfill. This is required before the tracked 20260626 manual grid-owner migration indexes `customer_site_id`.

The company-capabilities bootstrap is sourced from immutable, checksum-pinned `migrations/20260801143000_canonical_multitenant_platform_hardening.sql`, which exists in repository history but is absent from the connected dev ledger sequence used by clean replay. It restores the fail-closed `company_capabilities` registry, its constraints/index, RLS policies/grants, historical disabled capability seeds and `canonical_company_capability_enabled` lookup helper. The tracked `20260802010000_canonical_tenant_operation_policy_lifecycle.sql` requires this registry before inserting canonical operation capabilities and compiling its tenant-operation decision function.

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
