# Migration provenance

Date: 2026-08-08
Branch: `remediation/gridex-ops-full-integrity-performance`
Base: `5923b5c17fe96c0453048bdc102203efb65f7d7a`

## GRIDEX-REM-001 — dev migration history ahead of Git

Severity: P1
Status: IMPLEMENTED; remote verification pending
Area: Supabase migration provenance / tenant-isolated customer document storage

### Evidence

The connected `gridex-ops-dev` migration ledger contains two applied AUD-001 migrations absent from repository `main`:

- `20260806151106` — `gridex_aud_001_customer_document_storage_isolation`
- `20260806152004` — `gridex_aud_001_storage_helper_private_schema`

Closed, unmerged PR #87 contains the same AUD-001 SQL under later repository versions (`20260806165000` and `20260806172000`). Its immutable source-file checksums are:

- storage isolation SQL: `0d51528c3d7dcb8e2bd2c92cb8d83eea9212438232d25bb5422158be43d46d16`
- private-schema follow-up SQL: `ae8274a9a37a1ecf672ae1257ee225619fbc48369aaf929af5f07f63e8241d5f`

Live schema inspection confirms the private helper is the final storage authorization form. No database write is required for this reconciliation.

### Root cause

AUD-001 was applied to dev before its repository remediation was merged. PR #87 later recorded equivalent source files under different migration versions and was closed unmerged, leaving the live migration ledger ahead of Git.

### Canonical resolution

Restore the already-applied SQL to Git using the exact versions and names recorded by the live Supabase ledger while preserving the PR source contents byte-for-byte. Record those source-file hashes in `scripts/migration-history-manifest.additions.json`.

This work intentionally does **not** reapply either migration to dev, edit applied SQL, rename/delete a live ledger entry, mark a migration applied manually, or mutate `supabase_migrations.schema_migrations`.

## GRIDEX-REM-002 — canonical clean replay

Severity: P1
Status: IMPLEMENTED / CI FAILED / NOT VERIFIED

The branch makes the replay boundary explicit with checksum-pinned reconstructed foundation inputs, narrow derived bootstrap artifacts, explicit noncanonical classification, chronological interleaved substitutions, deterministic remaining migration execution, and Supabase CLI-owned markers for the observed dev ledger.

The original `20260530123000_gridcore_active_ediel_scope_rules_and_aibi_imports.sql` failure is classified rather than repaired by changing today's live schema: the live ledger does not contain that version and final live `ediel_message_rules` does not contain its expected `application_reference` column.

### NanoID blocker

Resolved. `nanoid` is not direct. The production path is Next/PostCSS -> `nanoid`; the current lock resolves `nanoid` to `3.3.17`. No audit gate was weakened. PR #90 `verify` including `security:audit-production` passes on the relevant replay commits.

### Replay iteration 1 — pricing component rules

At HEAD `c627f81024e9c166aab5b9189192f54e160c0190`, CI first failed at:

`20260609100000_batch_1_2_5_3_capway_invoice_foundation.sql:17`

with `ERROR: relation "public.pricing_component_rules" does not exist`.

The checksum-pinned pre-ledger source `20260520_batch_3_4_onboarding_pricing_billing_engine.sql` defines that relation and base indexes, and live `gridex-ops-dev` confirms the same base model plus the three columns later added by `20260609100000`.

Resolution: add narrow derived bootstrap `20260520_pricing_component_rules_foundation.sql`; no rows seeded, no historical SQL edited, no live DB write.

Commit `8e678aaee387ffb15bc68072e48dc141e8947090` verifies that this moved clean replay past `20260609100000`. On that same HEAD, `verify`, migrations integrity, provenance regression, typecheck, targeted tests and `security:audit-production` all PASS.

### Replay iteration 2 — communication log trace columns

On HEAD `8e678aaee387ffb15bc68072e48dc141e8947090`, the next clean-replay failure is:

`20260609183000_batch_8_admin_operations_website_email_webhooks.sql:67`

with `ERROR: column "customer_number" does not exist` while creating `communication_logs_customer_number_created_idx` on `public.communication_logs(company_id, customer_number, created_at desc)`.

The missing column is `communication_logs.customer_number` (not `customers.customer_number`). The checksum-pinned source `20260609162000_batch_7_website_integration_foundation.sql` defines the canonical 7D communication-log additions:

- `customer_number text`
- `external_customer_id text`
- `contract_id uuid`
- `template_version_id uuid`
- `metadata jsonb not null default '{}'::jsonb`
- index `communication_logs_customer_number_idx`

Live `gridex-ops-dev` confirms all five columns and the source index. The older `20260531213000_resend_tenant_email_engine.sql` creates the base `communication_logs` relation without those fields.

Because the `20260609162000` source is intentionally replaced by narrow derived artifacts and the base table exists only after timestamped history begins, this 7D reconstruction must **not** run in the pre-history foundation. It is interleaved at the source's chronological boundary after `20260609143000` and before `20260609183000`.

Artifact: `supabase/bootstrap/20260609_communication_log_trace_foundation.sql`

Artifact SHA-256: `0554a1e68a04c7b85951cc4e49d23ae0094bd9d542ffb6407231a3c0409dc56b`

Status after implementation: `IMPLEMENTED_NOT_VERIFIED`; real PR #90 CI must confirm the replay advances.

### Definition of VERIFIED

`GRIDEX-REM-002` remains open until the entire canonical empty-database replay, provenance regression, production security audit and `verify` suite all pass on the same final HEAD, the final schema fingerprint matches, memory/report are updated, and that final commit itself is CI-verified.
