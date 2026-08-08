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

This work intentionally does **not**:

- reapply either migration to dev,
- edit an applied migration's SQL,
- rename or delete a live ledger entry,
- mark a migration as applied manually,
- mutate `supabase_migrations.schema_migrations`.

### Files restored

- `supabase/migrations/20260806151106_gridex_aud_001_customer_document_storage_isolation.sql`
- `supabase/migrations/20260806152004_gridex_aud_001_storage_helper_private_schema.sql`

### Verification required before VERIFIED

- repository migration-history integrity check,
- branch diff review,
- repository versions/names compared with live ledger,
- live helper/policy state remains present without any database mutation.

## GRIDEX-REM-002 — clean replay logic remains open

Severity: P1
Status: IMPLEMENTED / CI FAILED / NOT VERIFIED

Closed PR #88 established a legacy-foundation replay experiment, but CI failed at `20260530123000_gridcore_active_ediel_scope_rules_and_aibi_imports.sql` because `public.ediel_message_rules.application_reference` was absent.

The live dev ledger does not contain version `20260530123000`. PR #88's legacy-foundation metadata declares `20260531075508` as `firstTrackedRemoteVersion`, while its replay script still iterates all 14-digit migration files not selected as foundation, including pre-ledger files. That mixes untracked pre-ledger history into the canonical tracked replay path.

The current live final `public.ediel_message_rules` schema also does not contain `application_reference`, so adding that column blindly to today's canonical schema is not an acceptable fix.

The branch now makes the replay boundary explicit with checksum-pinned legacy foundation inputs, derived bootstrap substitutions, explicit noncanonical artifact classification, interleaved substitutions where later tracked history needs verified pre-ledger prerequisites, and the observed Supabase dev ledger recreated only through CLI-owned marker migrations.

### Current same-HEAD verification state

At PR #90 HEAD `c627f81024e9c166aab5b9189192f54e160c0190`:

- `verify`: PASS, including `security:audit-production`.
- `clean-migration-replay`: FAIL.
- `GRIDEX-REM-002`: not VERIFIED.

The previous NanoID blocker is resolved without changing `package.json`: `next@16.2.12` depends on PostCSS, the project pins/overrides PostCSS to `8.5.25`, PostCSS declares `nanoid ^3.3.16`, and the lockfile now resolves `nanoid` to `3.3.17`. This is a transitive production dependency path; CI validates `npm ci`, the production audit, typecheck and build.

### Current first replay failure

CI artifact `gridex-rem-002-clean-replay` shows the first failure at:

`20260609100000_batch_1_2_5_3_capway_invoice_foundation.sql:17`

with:

`ERROR: relation "public.pricing_component_rules" does not exist`

Immediately before the error, `ALTER TABLE IF EXISTS public.pricing_component_rules` skips because the relation is absent, but the migration then creates `pricing_component_rules_company_unit_idx` unconditionally.

The immutable pre-ledger source `20260520_batch_3_4_onboarding_pricing_billing_engine.sql` defines `pricing_component_rules`. That same source is already checksum-pinned and already supplies a narrow derived bootstrap for `metering_permissions`. Live `gridex-ops-dev` confirms `public.pricing_component_rules` exists with the same base columns/indexes plus the three columns added by `20260609100000`.

### Current reconciliation

Add a second narrow derived bootstrap from the same immutable source containing only the source-defined `pricing_component_rules` relation and its base indexes. Keep product/tenant rows empty. Do not modify the historical source migration and do not apply a new live migration.

Status after implementation: `IMPLEMENTED_NOT_VERIFIED`; real PR CI must replay from an empty database before this subtask can be marked verified.

### Definition of VERIFIED

`GRIDEX-REM-002` remains open until the entire canonical empty-database replay, provenance regression, security audit and `verify` suite all pass on the same final HEAD and the final schema fingerprint matches.
