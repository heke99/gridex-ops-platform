# Migration provenance

Date: 2026-08-08
Branch: `remediation/gridex-ops-full-integrity-performance`
Base: `5923b5c17fe96c0453048bdc102203efb65f7d7a`

## GRIDEX-REM-001 — dev migration history ahead of Git

Severity: P1
Status: IMPLEMENTED; remote verification pending
Area: Supabase migration provenance / tenant-isolated customer document storage

The connected `gridex-ops-dev` ledger contains AUD-001 migrations `20260806151106` and `20260806152004` that were absent from repository `main`; the remediation branch restores their exact already-applied SQL under the live ledger versions without mutating live migration history.

## GRIDEX-REM-002 — canonical clean replay

Severity: P1
Status: IMPLEMENTED / CI FAILED / NOT VERIFIED

The replay boundary is explicit: checksum-pinned reconstruction inputs, narrow derived artifacts, explicit noncanonical classification, chronological interleaved substitutions where required, deterministic remaining migration execution, and CLI-owned markers for the observed dev ledger. Historical migration SQL is not edited and clean-replay fixes do not mutate live Supabase.

The original `20260530123000_gridcore_active_ediel_scope_rules_and_aibi_imports.sql` issue remains classified rather than forced into today's schema: the live ledger does not contain that version and final live `ediel_message_rules` lacks the artifact's expected `application_reference` column.

### Security dependency gate

Resolved. `nanoid` is transitive through PostCSS and resolves to `3.3.17`; no audit gate is weakened. Relevant PR #90 heads pass `security:audit-production`.

### Replay iteration 1 — pricing component rules

At `c627f81024e9c166aab5b9189192f54e160c0190`, clean replay failed at `20260609100000_batch_1_2_5_3_capway_invoice_foundation.sql:17` because `public.pricing_component_rules` was missing.

The checksum-pinned pre-ledger source `20260520_batch_3_4_onboarding_pricing_billing_engine.sql` and live dev both confirm the relation/base indexes. Resolution: narrow derived bootstrap `20260520_pricing_component_rules_foundation.sql`.

Commit `8e678aaee387ffb15bc68072e48dc141e8947090` confirmed replay advanced beyond this migration; same-HEAD `verify` and security audit passed.

### Replay iteration 2 — communication log trace columns

At `8e678aaee387ffb15bc68072e48dc141e8947090`, replay next failed at `20260609183000_batch_8_admin_operations_website_email_webhooks.sql:67`: `public.communication_logs.customer_number` was missing.

Checksum-pinned source `20260609162000_batch_7_website_integration_foundation.sql` defines the five 7D trace columns plus `communication_logs_customer_number_idx`, all confirmed live. Because the base `communication_logs` table is created by earlier timestamped history, the narrow artifact is interleaved at the skipped source's actual boundary after `20260609143000` and before `20260609183000`.

Artifact: `20260609_communication_log_trace_foundation.sql`, SHA-256 `0554a1e68a04c7b85951cc4e49d23ae0094bd9d542ffb6407231a3c0409dc56b`.

Commit `5212e454f7c8feca30732cd9d3122bd8eaf62728` confirmed replay advanced through the Batch 8 area; same-HEAD `verify`, provenance regression, typecheck, targeted regressions and production security audit all passed.

### Replay iteration 3 — external contract intake foundation

At `5212e454f7c8feca30732cd9d3122bd8eaf62728`, replay next failed at `20260611150000_launch_readiness_security_routes_stats.sql:451`:

`ERROR: relation "public.external_contract_intakes" does not exist`

The same migration had already skipped its additive `ALTER TABLE IF EXISTS public.external_contract_intakes ...` statements because the relation did not exist, then unconditionally referenced it in `gridex_company_operations_statistics_v`.

Canonical source evidence is the checksum-pinned pre-ledger `20260521_batch_2c_end_to_end_operations.sql`, which creates `external_contract_intakes` with company scope, idempotency uniqueness, initial status constraint, base company/status index and RLS policies. Live `gridex-ops-dev` confirms this base model followed by later additive columns.

Resolution: add narrow derived foundation `supabase/bootstrap/20260521_external_contract_intakes_foundation.sql` after the RBAC helper foundation. It recreates only the source table/base index/RLS policies, seeds no intakes, edits no historical SQL and performs no live DB write.

Artifact SHA-256: `446ea8443bd4fa9f71f42016f11323feb67bab5f53d7b1bd6d890d0f16258b16`.

Status after implementation: `IMPLEMENTED_NOT_VERIFIED`; PR #90 CI on the new commit must prove the replay advances.

### Definition of VERIFIED

`GRIDEX-REM-002` remains open until the complete canonical empty-database replay, schema fingerprint, migration/provenance regression, production security audit and `verify` suite all pass on the same final HEAD, memory/report are updated, and that final commit itself is CI-verified.
