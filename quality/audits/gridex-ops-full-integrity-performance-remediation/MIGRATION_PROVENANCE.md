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
Status: CONFIRMED

Closed PR #88 established a legacy-foundation replay experiment, but CI failed at `20260530123000_gridcore_active_ediel_scope_rules_and_aibi_imports.sql` because `public.ediel_message_rules.application_reference` was absent.

The live dev ledger does not contain version `20260530123000`. PR #88's legacy-foundation metadata declares `20260531075508` as `firstTrackedRemoteVersion`, while its replay script still iterates all 14-digit migration files not selected as foundation, including pre-ledger files. That mixes untracked pre-ledger history into the canonical tracked replay path.

The current live final `public.ediel_message_rules` schema also does not contain `application_reference`, so adding that column blindly to today's canonical schema is not an acceptable fix.

Next remediation must make the replay boundary explicit: selected pre-ledger foundation inputs first, then canonical tracked migrations from the verified ledger boundary onward, with any exceptional pre-ledger artifact explicitly classified rather than implicitly executed.
