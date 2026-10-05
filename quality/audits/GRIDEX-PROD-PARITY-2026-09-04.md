# Gridex OPS — canonical/production schema parity register

Date: 2026-09-04
Production project: `piidsfebjqjmnepdpnas` (the database `app.gridex.se` actually uses)
Canonical shadow: clean replay of `main` through `scripts/gridex-aud-003-clean-replay.sh`
Plan reference: ÅTERSTÅENDE MASTERPLAN, Steg 3 (sections 3.4 and 3.5)

Secrets are deliberately absent from this document. It records project ref,
object names and measured results only.

## 1. Direction A — canonical objects missing from production: CLOSED

Every canonical relation was tested for existence in production. The result is
now **zero**:

    comm -23 canonical-relations production-relations  ->  0 rows

Three objects were missing at the start of Steg 3 and all three were closed by
applying the migrations that create them (see `.agent-memory/current-task.md`
for the per-migration preflight and verification evidence):

| object | closed by | production ledger |
| --- | --- | --- |
| `inbound_operation_events` | `gridex_inbound_operations_foundation` | 20260904221046 |
| `gridex_gate_inbound_z02_snapshot_freshness()` | `z02_snapshot_market_context_guard` | 20260904221936 |
| `gridex_finalize_admin_imported_signed_agreement_v1()` | `admin_signed_contract_import_canonicalization` | 20260904222450 |

`canonical_tenant_invariant_convergence` (ledger 20260904222045) was applied
between them to close the anonymous RPC surface on the function the Z02
migration creates.

## 2. Direction B — production objects the canonical chain does not build

Canonical builds 587 relations. Production has 662. **75 relations exist in
production that a system rebuilt from the migration chain would not have**, and
**37 of those 75 are referenced by application code**. A clean-replayed Gridex
OPS is therefore not a working Gridex OPS.

This is not drift caused by someone editing production by hand. It is a
property of how the replay selects its inputs.

### 2.1 Root cause — the replay silently ignores 84 repository migrations

`scripts/gridex-aud-003-clean-replay.sh` collects canonical timestamped
migrations with

    re.match(r'^\d{14}_.+\.sql$', path.name)

so only 14-digit-prefixed files are executed. Everything else runs only if it is
named in `scripts/gridex-aud-003-legacy-foundation.json`. Of the repository's
585 migration files:

* 492 carry a 14-digit prefix and are executed;
* 9 non-timestamped files are named in the foundation plan and are executed;
* **84 are neither, and are executed by nothing.** They are not classified as
  noncanonical either — `scripts/gridex-aud-003-noncanonical-artifacts.json`
  contains exactly one entry.

Those 84 are the `YYYYMMDD_*` legacy migrations from 2026-05-13 to 2026-06-15
plus the `0N_db2*` reconciliation files. They created real production tables:
`customer_import_batches`, `customer_case_events`, `white_label_platforms`,
`tenant_governance_events`, `grid_owner_access_agreements` and 38 more.

### 2.2 Second cause — derived bootstrap substitutions drop the rest

The foundation plan declares 26 `derivedBootstrap` artifacts. Each one
*replaces its entire source migration* — the source name goes into
`skip_timestamp_names` and is never executed. The replacement is a narrow
reconstruction that creates only the objects the replay needed.

Example: `bootstrap/20260531_integration_api_clients_foundation.sql` substitutes
`migrations/20260531111600_system_readiness_foundation.sql`. The reconstruction
creates `integration_api_clients`. The original also created
`tenant_email_domains`, `tenant_email_sender_profiles`, `status_transition_rules`,
`page_performance_budgets`, `data_quality_findings`, `customer_timeline_events`
and `customer_data_quality_open_issues` — none of which the canonical chain now
builds, all of which production has.

The clean-replay gate is green because it never runs the statements that would
have to succeed.

### 2.3 Register — 75 production-only relations

Classified by why the canonical chain does not build them.

#### B1 — created only by one of the 84 never-executed legacy migrations (43 objects, 23 used by app code)

| object | kind | app refs | created by |
| --- | --- | --- | --- |
| `auth_provisioning_events` | table | 1 | `20260528_auth_provisioning_runtime_guard.sql` |
| `billing_readiness_flags` | view | 0 | `20260519_batch_6c_metering_billing_readiness.sql` |
| `company_billing_volume_overview` | view | 0 | `20260520_batch_6e_rbac_tenant_stats_whitelabel.sql` |
| `company_go_live_reviews` | table | 0 | `20260521_actor_testing_go_live_module.sql` |
| `customer_case_events` | table | 3 | `20260520_batch_5_cases_audit_email_ux.sql` |
| `customer_import_batches` | table | 3 | `20260519_customer_intake_contracts_tenant_hardening.sql` |
| `customer_import_rows` | table | 3 | `20260519_customer_intake_contracts_tenant_hardening.sql` |
| `customer_lifecycle_events` | table | 2 | `20260519_customer_move_out_lifecycle.sql` |
| `customer_sync_events` | table | 1 | `20260519_operations_core_saas_sync.sql` |
| `document_parse_jobs` | table | 1 | `20260615_multitenant_integrity_and_claim_locks.sql` |
| `ediel_test_customers` | table | 1 | `20260529_batch_2_rulebook_hardening_and_systemtest_ui.sql` |
| `ediel_test_expected_acks` | table | 1 | `20260529_batch_2_rulebook_hardening_and_systemtest_ui.sql` |
| `ediel_test_expected_values` | table | 1 | `20260529_batch_2_rulebook_hardening_and_systemtest_ui.sql` |
| `ediel_test_facilities` | table | 1 | `20260529_batch_2_rulebook_hardening_and_systemtest_ui.sql` |
| `ediel_test_field_values` | table | 1 | `20260529_batch_2_rulebook_hardening_and_systemtest_ui.sql` |
| `ediel_test_metering_points` | table | 1 | `20260529_batch_2_rulebook_hardening_and_systemtest_ui.sql` |
| `grid_owner_access_agreements` | table | 2 | `20260528_batch_7a_route_inbound_mail_platform_ui.sql` |
| `gridex_archived_customer_registry_rows` | table | 0 | `20260525_db4b_customer_registry_ediel_test_cleanup.sql` |
| `gridex_batch3_role_action_security_v` | view | 1 | `20260521_batch3_pricing_billing_audit_roles_completion.sql` |
| `gridex_batch4c_role_action_security_v` | view | 1 | `20260522_batch4c_billing_export_audit_quality_ai.sql` |
| `gridex_batch7a_foundation_readiness_v` | view | 0 | `20260528_batch_7a_route_inbound_mail_platform_ui.sql` |
| `gridex_batch_2b_rls_status_v` | view | 0 | `20260521_batch_2b_full_automation_and_live_ops.sql` |
| `gridex_batch_2c_rls_policy_report_v` | view | 2 | `20260521_batch_2c_end_to_end_operations.sql` |
| `gridex_customer_intake_security_report_v` | view | 1 | `20260521_batch_customer_intake_batch2_hardening.sql` |
| `gridex_db3_final_readiness_v` | view | 0 | `20260523_db3_tenant_isolation_rbac_enforcement.sql` |
| `gridex_db3_rbac_snapshot_v` | view | 0 | `20260523_db3_tenant_isolation_rbac_enforcement.sql` |
| `gridex_db3_tenant_data_gaps_v` | view | 0 | `20260523_db3_tenant_isolation_rbac_enforcement.sql` |
| `gridex_db3_tenant_policy_gaps_v` | view | 0 | `20260523_db3_tenant_isolation_rbac_enforcement.sql` |
| `gridex_db4b_customer_registry_visibility_v` | view | 0 | `20260525_db4b_customer_registry_ediel_test_cleanup.sql` |
| `gridex_debug_batch2_rbac_v` | view | 0 | `20260525_debug_batch_2_rbac_tenant_alignment.sql` |
| `gridex_debug_batch2_tenant_policy_gaps_v` | view | 1 | `20260526_debug_batch_2_tenant_rbac_server_actions.sql` |
| `gridex_debug_step1_2_schema_alignment_v` | view | 0 | `20260526_debug_step1_2c_full_schema_code_alignment.sql` |
| `gridex_rbac_tenant_audit_summary` | view | 0 | `20260520_batch_6e_fix_rbac_backfill_security.sql` |
| `gridex_sensitive_action_audit_coverage_v` | view | 0 | `20260522_batch4e_switch_pdf_audit_rbac_completion.sql` |
| `gridex_tenant_runtime_readiness` | view | 0 | `20260520_batch_1_2_saas_ediel_control_center.sql` |
| `gridex_user_auth_integrity_v` | view | 0 | `20260528_auth_provisioning_runtime_guard.sql` |
| `metering_billing_audit_overview` | view | 0 | `20260519_batch_6d2_runtime_governance_completion.sql` |
| `platform_session_revocations` | table | 0 | `20260519_batch_6d2_runtime_governance_completion.sql` |
| `platform_tenant_governance_overview` | view | 0 | `20260519_batch_6d_superadmin_tenant_governance.sql` |
| `production_route_wizard_runs` | table | 2 | `20260521_batch_2b_full_automation_and_live_ops.sql` |
| `tenant_governance_events` | table | 1 | `20260519_batch_6d_superadmin_tenant_governance.sql` |
| `white_label_platform_memberships` | table | 1 | `20260521_actor_testing_go_live_module.sql` |
| `white_label_platforms` | table | 1 | `20260521_actor_testing_go_live_module.sql` |

#### B2 — created by a migration that IS replayed, but lost to a derived-bootstrap substitution (13 objects, 8 used by app code)

| object | kind | app refs | created by |
| --- | --- | --- | --- |
| `billing_disputes` | table | 1 | `20260609162000_batch_7_website_integration_foundation.sql` |
| `billing_partner_customers` | table | 3 | `20260609162000_batch_7_website_integration_foundation.sql` |
| `canonical_tenant_effective_legal_sources_v` | view | 3 | `20260801143000_canonical_multitenant_platform_hardening.sql` |
| `customer_data_quality_open_issues` | view | 1 | `20260531111600_system_readiness_foundation.sql` |
| `customer_timeline_events` | view | 0 | `20260531111600_system_readiness_foundation.sql` |
| `data_quality_findings` | table | 0 | `20260531111600_system_readiness_foundation.sql` |
| `ediel_agt_readiness` | table | 5 | `20260602143000_ediel_environment_business_action_locks.sql` |
| `ediel_test_run_locks` | table | 4 | `20260602143000_ediel_environment_business_action_locks.sql` |
| `ediel_unlinked_test_messages` | table | 0 | `20260602143000_ediel_environment_business_action_locks.sql` |
| `page_performance_budgets` | table | 0 | `20260531111600_system_readiness_foundation.sql` |
| `status_transition_rules` | table | 0 | `20260531111600_system_readiness_foundation.sql` |
| `tenant_email_domains` | table | 1 | `20260531111600_system_readiness_foundation.sql` |
| `tenant_email_sender_profiles` | table | 1 | `20260531111600_system_readiness_foundation.sql` |

#### B3 — no CREATE statement exists anywhere in the repository (19 objects, 6 used by app code)

These were created outside the migration chain entirely — dashboard, ad-hoc SQL,
or a pre-migration era. The chain has no record of them at all.

| object | kind | app refs | created by |
| --- | --- | --- | --- |
| `access_logs` | table | 0 | — (nothing in the repository creates it) |
| `customer_external_auth_links` | table | 1 | — (nothing in the repository creates it) |
| `customer_notes` | table | 0 | — (nothing in the repository creates it) |
| `ediel_ai_list_jobs` | table | 0 | — (nothing in the repository creates it) |
| `ediel_file_exchange_runs` | table | 0 | — (nothing in the repository creates it) |
| `ediel_instruction_runtime_scope_v` | view | 0 | — (nothing in the repository creates it) |
| `ediel_message_rules_cleanup_audit` | table | 0 | — (nothing in the repository creates it) |
| `ediel_messages_ack_overdue_v` | view | 0 | — (nothing in the repository creates it) |
| `ediel_outbound_route_candidates_v` | view | 0 | — (nothing in the repository creates it) |
| `ediel_retry_candidates_v` | view | 0 | — (nothing in the repository creates it) |
| `ediel_unresolved_outbound_v` | view | 0 | — (nothing in the repository creates it) |
| `gridex_runtime_capabilities_v` | view | 0 | — (nothing in the repository creates it) |
| `gridex_wrong_project_cleanup_backup` | table | 0 | — (nothing in the repository creates it) |
| `masterdata_audit_log` | table | 0 | — (nothing in the repository creates it) |
| `onboarding_choices` | table | 1 | — (nothing in the repository creates it) |
| `onboarding_sessions` | table | 1 | — (nothing in the repository creates it) |
| `onboarding_steps` | table | 1 | — (nothing in the repository creates it) |
| `platform_grid_owner_readiness_v` | view | 1 | — (nothing in the repository creates it) |
| `sites` | table | 125 | — (nothing in the repository creates it) |

## 2A. The same gap in functions and triggers — and it reaches tenant isolation

Canonical builds 569 distinct function names. Production has 626. The direction
check matches the relations exactly:

* canonical functions missing from production: **0**
* production functions the canonical chain does not build: **57**, of which
  **21 are referenced by application code**

Same three causes:

| bucket | count | app-referenced |
| --- | --- | --- |
| created only by one of the 84 never-executed migrations | 24 | 15 |
| created by a replayed file but lost to a bootstrap substitution | 6 | 3 |
| no CREATE statement anywhere in the repository | 27 | 3 |

### 2A.1 F-PARITY-4 (critical) — a rebuilt system has no tenant guards on six core tables

`supabase/migrations/20260615_multitenant_integrity_and_claim_locks.sql` is one
of the 84 files the replay never executes. It creates the tenant-attribution
guards, and production has all six of them attached as live BEFORE ROW triggers:

| table | trigger | guard function |
| --- | --- | --- |
| `customer_contracts` | `gridex_customer_contracts_company_guard_tg` | `gridex_customer_contracts_company_guard` |
| `customer_sites` | `gridex_customer_sites_company_guard_tg` | `gridex_customer_sites_company_guard` |
| `metering_points` | `gridex_metering_points_company_guard_tg` | `gridex_metering_points_company_guard` |
| `powers_of_attorney` | `gridex_powers_of_attorney_company_guard_tg` | `gridex_powers_of_attorney_company_guard` |
| `billing_underlays` | `gridex_billing_underlays_company_guard_tg` | `gridex_billing_underlays_company_guard` |
| `customer_legal_acceptances` | `gridex_customer_legal_acceptances_company_guard_tg` | `gridex_customer_legal_acceptances_company_guard` |

The same file creates `gridex_assert_same_company`, which the application also
references.

**A Gridex OPS rebuilt from the canonical migration chain would enforce none of
these.** Tenant attribution on contracts, sites, metering points, powers of
attorney, billing underlays and legal acceptances would be application-level
only. This is the project's declared non-negotiable invariant, and the chain
does not carry it.

It also corrects an earlier recorded claim. A previous, structurally limited
harness reported that "relations, columns, functions, indexes and triggers match
canonical exactly". They do not: triggers differ, and the difference is the
tenant guards.

### 2A.2 Other consequential losses

* `canonical_next_customer_number`, `canonical_next_contract_number` and
  `canonical_next_application_number` come from
  `20260801143000_canonical_multitenant_platform_hardening.sql`, which IS
  replayed but is substituted by `bootstrap/20260801_company_capabilities_foundation.sql`.
  A rebuilt system cannot allocate customer, contract or application numbers.
* `log_masterdata_change` (4 audit triggers on `customer_sites`, `grid_owners`,
  `metering_points`, `customer_internal_notes`) and `set_updated_at` (6 triggers)
  have no CREATE statement anywhere in the repository. A rebuilt system loses
  masterdata audit logging and `updated_at` maintenance on those tables.

### 2A.3 Register — 57 production-only functions

#### created only by a never-executed migration (24)

| function | app refs | created by |
| --- | --- | --- |
| `admin_customer_ids_by_latest_contract` | 1 | `20260519_final_saas_hardening.sql` |
| `admin_customer_latest_contract_counts` | 1 | `20260525_debug_fix_batch_1b_schema_code_alignment.sql` |
| `ediel_resolve_inbound_message_rules` | 1 | `20260525_debug_fix_batch_1b_schema_code_alignment.sql` |
| `ediel_resolve_message_rule` | 1 | `20260525_debug_fix_batch_1b_schema_code_alignment.sql` |
| `gridex_assert_company_operational_for_write` | 0 | `20260519_batch_6d2_runtime_governance_completion.sql` |
| `gridex_assert_same_company` | 1 | `20260615_multitenant_integrity_and_claim_locks.sql` |
| `gridex_audit_critical_row_change` | 0 | `20260520_batch_5_final_quality_handbook_alignment.sql` |
| `gridex_auth_has_any_role` | 0 | `20260519_batch_6d2_runtime_governance_completion.sql` |
| `gridex_auth_has_role` | 0 | `20260519_final_saas_hardening.sql` |
| `gridex_billing_underlays_company_guard` | 1 | `20260615_multitenant_integrity_and_claim_locks.sql` |
| `gridex_companies_missing_ediel_profile` | 1 | `20260519_batch_6d2_runtime_governance_completion.sql` |
| `gridex_companies_missing_route_setup` | 1 | `20260519_batch_6d2_runtime_governance_completion.sql` |
| `gridex_company_is_writable` | 0 | `20260520_batch_6e_rbac_tenant_stats_whitelabel.sql` |
| `gridex_company_status_is_writable` | 0 | `20260519_batch_6d2_runtime_governance_completion.sql` |
| `gridex_customer_contracts_company_guard` | 1 | `20260615_multitenant_integrity_and_claim_locks.sql` |
| `gridex_customer_legal_acceptances_company_guard` | 1 | `20260615_multitenant_integrity_and_claim_locks.sql` |
| `gridex_customer_sites_company_guard` | 1 | `20260615_multitenant_integrity_and_claim_locks.sql` |
| `gridex_debug_column_exists` | 0 | `20260525_debug_step2b_tenant_scope_and_customer_card_performance.sql` |
| `gridex_get_user_permission_overrides` | 1 | `20260525_debug_fix_batch_1b_schema_code_alignment.sql` |
| `gridex_get_user_roles` | 5 | `20260525_debug_batch_2_rbac_tenant_alignment.sql` |
| `gridex_metering_points_company_guard` | 1 | `20260615_multitenant_integrity_and_claim_locks.sql` |
| `gridex_powers_of_attorney_company_guard` | 1 | `20260615_multitenant_integrity_and_claim_locks.sql` |
| `gridex_table_has_company_id` | 0 | `20260526_debug_batch_2_tenant_rbac_server_actions.sql` |
| `gridex_user_is_super_admin` | 0 | `20260519_final_saas_hardening.sql` |

#### created by a replayed file, lost to a bootstrap substitution (6)

| function | app refs | created by |
| --- | --- | --- |
| `canonical_next_application_number` | 2 | `20260801143000_canonical_multitenant_platform_hardening.sql` |
| `canonical_next_contract_number` | 2 | `20260801143000_canonical_multitenant_platform_hardening.sql` |
| `canonical_next_customer_number` | 2 | `20260801143000_canonical_multitenant_platform_hardening.sql` |
| `gridex_emit_domain_event` | 0 | `20260531111600_system_readiness_foundation.sql` |
| `gridex_refresh_platform_schema_state_v2` | 0 | `20260802232000_migration_truth_readiness.sql` |
| `gridex_user_has_white_label_admin_membership` | 0 | `20260829194612_white_label_membership_rls_recursion_fix.sql` |

#### no CREATE statement anywhere in the repository (27)

| function | app refs | created by |
| --- | --- | --- |
| `canonical_sync_ediel_production_capability_v1` | 0 | — (nothing in the repository creates it) |
| `check_email_exists` | 1 | — (nothing in the repository creates it) |
| `complete_core_onboarding` | 1 | — (nothing in the repository creates it) |
| `ediel_derive_ack_outcome` | 0 | — (nothing in the repository creates it) |
| `ediel_messages_set_ack_outcome` | 0 | — (nothing in the repository creates it) |
| `gridex_add_months_timestamptz` | 0 | — (nothing in the repository creates it) |
| `gridex_apply_public_contract_backfill_v2` | 0 | — (nothing in the repository creates it) |
| `gridex_clear_stale_manual_request_blocker_metadata` | 0 | — (nothing in the repository creates it) |
| `gridex_ediel_runtime_summary` | 0 | — (nothing in the repository creates it) |
| `gridex_ediel_unresolved_summary` | 0 | — (nothing in the repository creates it) |
| `gridex_generate_customer_number` | 0 | — (nothing in the repository creates it) |
| `gridex_has_effective_permission` | 0 | — (nothing in the repository creates it) |
| `gridex_jsonb_text` | 0 | — (nothing in the repository creates it) |
| `gridex_normalize_power_of_attorney_legal_reference` | 0 | — (nothing in the repository creates it) |
| `gridex_outbound_requests_guard` | 0 | — (nothing in the repository creates it) |
| `gridex_partner_exports_guard` | 0 | — (nothing in the repository creates it) |
| `gridex_partner_exports_status_guard_2` | 0 | — (nothing in the repository creates it) |
| `gridex_preview_public_contract_backfill_v2` | 0 | — (nothing in the repository creates it) |
| `gridex_publication_invoice_fee_evidence_v1` | 0 | — (nothing in the repository creates it) |
| `gridex_validate_partner_export_payload` | 0 | — (nothing in the repository creates it) |
| `log_masterdata_change` | 0 | — (nothing in the repository creates it) |
| `select_onboarding_start_path` | 1 | — (nothing in the repository creates it) |
| `set_current_timestamp_updated_at` | 0 | — (nothing in the repository creates it) |
| `set_ediel_inbound_cases_updated_at` | 0 | — (nothing in the repository creates it) |
| `set_ediel_tgt_test_data_updated_at` | 0 | — (nothing in the repository creates it) |
| `set_updated_at` | 0 | — (nothing in the repository creates it) |
| `sync_metering_points_identifiers` | 0 | — (nothing in the repository creates it) |

## 3. Tenant and safety posture of the production-only tables

Measured, not assumed. All 44 production-only *tables* have `relrowsecurity =
true`. Row counts are near zero except:

| table | rows | company_id | policies | note |
| --- | --- | --- | --- | --- |
| `masterdata_audit_log` | 37390 | no | 1 | read policy requires `masterdata.audit.read` or `masterdata.write`, but the table has no tenant column, so the permission is the only boundary |
| `tenant_governance_events` | 34 | yes | 12 | tenant-scoped |
| `status_transition_rules` | 23 | no | 1 | service_role only |
| `gridex_data_retention_policies` | 14 | no | 8 | platform-level |
| `gridex_wrong_project_cleanup_backup` | 40 | no | 4 | platform-admin only; a cleanup backup, removal candidate |
| `ediel_message_rules_cleanup_audit` | 9 | no | 4 | audit remnant |
| `page_performance_budgets` | 5 | no | 1 | service_role only |
| `production_route_wizard_runs` | 4 | yes | 9 | tenant-scoped |
| `ediel_agt_readiness` | 2 | yes | 5 | tenant-scoped |
| `company_go_live_reviews` | 1 | yes | 12 | tenant-scoped |

No production-only table was found readable by `anon`. `masterdata_audit_log` is
the one worth a decision: 37k audit rows with no tenant column, gated only by a
permission check.

## 4. Findings

**F-PARITY-1 (critical, confirmed).** The canonical migration chain cannot
rebuild a working system. 84 repository migrations are executed by nothing, 26
more are replaced by narrow reconstructions, and the result is missing 75
relations of which 37 are referenced by application code. The `clean-migration-replay`
gate passes because those statements never run, so the gate does not currently
prove what the master plan requires it to prove.

**F-PARITY-2 (high, confirmed).** 19 production relations have no CREATE
statement anywhere in the repository, 6 of them referenced by application code
(`sites`, `onboarding_sessions`, `onboarding_steps`, `onboarding_choices`,
`customer_external_auth_links`, `platform_grid_owner_readiness_v`). Their schema
exists only in production.

**F-PARITY-4 (critical, confirmed).** The six tenant-attribution guard triggers
live in production but are absent from the canonical chain, because the file
that creates them is one of the 84 the replay never executes. See 2A.1. Also
lost: customer/contract/application number allocation, masterdata audit logging
and `updated_at` maintenance.

**F-PARITY-3 (medium, confirmed).** `masterdata_audit_log` holds 37,390 rows
with no `company_id` and a single read policy gated on a permission rather than
on tenant membership.

**Not a finding.** The 12 ledger version/name mismatches between the repository
filenames and `supabase_migrations.schema_migrations` are the documented
reconciliation model: names match, versions differ.

## 5. Remediation plan (small, independently reviewable changes)

Do not make `db:parity production` blocking before this is done — it would turn
every build red on drift nobody has triaged.

1. **Decide the classification of the 84 never-executed migrations.** For each:
   move into the canonical chain, or record it in
   `gridex-aud-003-noncanonical-artifacts.json` with evidence. The current state
   — neither — is what hides the gap.
2. **Fail the replay closed on unclassified inputs.** Any `.sql` under
   `supabase/migrations/` that is neither executed nor explicitly classified must
   abort the replay. This is the single change that stops the gap reopening, and
   it should land before the reclassification so the count can only go down.
3. **Reconcile the 26 derived-bootstrap substitutions.** For each, list what the
   original migration created that the reconstruction does not, and either widen
   the reconstruction or add a forward migration.
4. **Adopt the 19 orphan relations into the chain** with a forward migration
   generated from their production definitions, starting with the 6 the
   application queries.
5. **Then** re-run full parity, expect zero, and make `db:parity production`
   blocking (Steg 4).
6. Separately decide `masterdata_audit_log` (F-PARITY-3) and whether
   `gridex_wrong_project_cleanup_backup` can be dropped.

## 6. Verification matrix

| check | command / method | result |
| --- | --- | --- |
| canonical objects missing from production | `comm -23` canonical vs production relation lists | 0 |
| production-only relations | `comm -13` of the same lists | 75 |
| canonical functions missing from production | `comm -23` on function names | 0 |
| production-only functions | `comm -13` on function names | 57 (21 app-referenced) |
| tenant guard triggers in production | `pg_trigger` join `pg_proc` | 6, none built by the chain |
| application references | `grep -rlw` over `app lib components scripts hooks types` | 37 of 75 |
| replay input selection | read of `scripts/gridex-aud-003-clean-replay.sh` | 14-digit regex + 9 foundation entries |
| never-executed migrations | set difference over `supabase/migrations` | 84 of 585 |
| noncanonical classifications | `scripts/gridex-aud-003-noncanonical-artifacts.json` | 1 |
| derived-bootstrap substitutions | `scripts/gridex-aud-003-legacy-foundation.json` | 26 |
| RLS on production-only tables | `pg_class.relrowsecurity` | 44 of 44 true |
| anon reachability | `information_schema.role_table_grants` + policy roles | none found |

## Appendix — the 84 migrations the canonical replay never executes

    01_db2_full_view_preflight_schema_and_functions.sql
    01_db2b_preflight_views.sql
    02_db2_execute_controlled_reconciliation.sql
    02_db2b_apply_superadmin_and_membership.sql
    03_db2_validation_and_finish.sql
    03_db2b_validation_views.sql
    20260513_ediel_agt_saas_runtime_safe.sql
    20260519_auth_callback_email_reset_sync.sql
    20260519_auth_email_templates_invite_reset_sync.sql
    20260519_batch_6c_metering_billing_readiness.sql
    20260519_batch_6d2_runtime_governance_completion.sql
    20260519_batch_6d_superadmin_tenant_governance.sql
    20260519_bootstrap_div3rsa_superadmin.sql
    20260519_company_invite_temp_password_sync.sql
    20260519_customer_intake_contracts_tenant_hardening.sql
    20260519_customer_move_out_lifecycle.sql
    20260519_ediel_operations_engine_batch.sql
    20260519_ediel_tenant_profile_runtime_sync.sql
    20260519_final_saas_hardening.sql
    20260519_operations_core_saas_sync.sql
    20260519_operations_customers_ux.sql
    20260519_saas_ui_tenant_admin.sql
    20260520_batch_1_2_saas_ediel_control_center.sql
    20260520_batch_3_4_final_completion.sql
    20260520_batch_3_4_onboarding_pricing_billing_engine.sql
    20260520_batch_5_cases_audit_email_ux.sql
    20260520_batch_5_final_quality_handbook_alignment.sql
    20260520_batch_6e_fix_rbac_backfill_security.sql
    20260520_batch_6e_hard_platform_roles_only.sql
    20260520_batch_6e_rbac_tenant_stats_whitelabel.sql
    20260520_company_delete_backfill_and_admin_layout.sql
    20260520_direct_account_temporary_password_flow.sql
    20260520_direct_temporary_password_auth_sync_fix.sql
    20260520_final_z01_outbound_and_platform_guard.sql
    20260520_user_profiles_auth_action_constraint_hardfix.sql
    20260521_actor_testing_engine_automation.sql
    20260521_actor_testing_go_live_module.sql
    20260521_batch3_pricing_billing_audit_roles_completion.sql
    20260521_batch_1_2_live_readiness_and_automation_hardening.sql
    20260521_batch_2b_full_automation_and_live_ops.sql
    20260521_batch_2c_end_to_end_operations.sql
    20260521_batch_customer_intake_batch2_completion.sql
    20260521_batch_customer_intake_batch2_hardening.sql
    20260521_batch_customer_intake_debug_hardening.sql
    20260521_final_customer_info_request_status_check.sql
    20260522_batch4_multisite_duplicate_billing_hardening.sql
    20260522_batch4c_billing_export_audit_quality_ai.sql
    20260522_batch4d_merge_poa_lifecycle_hardening.sql
    20260522_batch4e_switch_pdf_audit_rbac_completion.sql
    20260522_batch4f_rbac_database_lint_hardening.sql
    20260522_customer_flow_access_repair.sql
    20260522_db1_schema_repair_backfill_foundation.sql
    20260523_db3_tenant_isolation_rbac_enforcement.sql
    20260525_db4b_customer_registry_ediel_test_cleanup.sql
    20260525_debug_batch_2_rbac_tenant_alignment.sql
    20260525_debug_batch_2c_activate_afshin_nibela.sql
    20260525_debug_batch_2d_activate_afshin_nibela_v2.sql
    20260525_debug_batch_2e_verify_dashboard_user_provisioning.sql
    20260525_debug_batch_2f_normalize_afshin_nibela.sql
    20260525_debug_batch_2h_dedupe_user_roles_and_unique_guard.sql
    20260525_debug_batch_2j_verify_no_old_afshin_id.sql
    20260525_debug_fix_batch_1b_schema_code_alignment.sql
    20260525_debug_step2_code_schema_alignment.sql
    20260525_debug_step2b_tenant_scope_and_customer_card_performance.sql
    20260525_verify_company_user_provisioning_flow.sql
    20260526_batch_3a_3b_customer_intake_blockers_documents.sql
    20260526_batch_3c_3d_fullmakt_data_requests.sql
    20260526_debug_batch_2_tenant_rbac_server_actions.sql
    20260526_debug_step1_2c_full_schema_code_alignment.sql
    20260526_debug_step1_2f_customer_import_foundation.sql
    20260527_debug_user_invites_role_flow.sql
    20260527_fix_company_user_creation_schema_safe_backfill.sql
    20260527_fix_company_user_invite_runtime_columns.sql
    20260528_auth_provisioning_runtime_guard.sql
    20260528_batch_1_completion_customer_flow.sql
    20260528_batch_1_customer_flow_masterdata_preflight.sql
    20260528_batch_2_completion_rulebook_actions_regression.sql
    20260528_batch_7a1_inbound_hardening.sql
    20260528_batch_7a_route_inbound_mail_platform_ui.sql
    20260528_debug_post_repair_schema_guardrails.sql
    20260528_final_user_access_schema_safe_repair.sql
    20260528_fix_user_roles_without_role_column_and_compact_users.sql
    20260529_batch_2_rulebook_hardening_and_systemtest_ui.sql
    20260615_multitenant_integrity_and_claim_locks.sql
