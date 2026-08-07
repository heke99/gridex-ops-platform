# GRIDEX-AUD-003 Remediation Report

## Status

- Finding: `GRIDEX-AUD-003`
- Status: `ROOT_CAUSE_CONFIRMED`
- Severity: High
- Branch: `remediation/gridex-aud-003-migration-provenance`
- Base: `origin/main` at `bb877506fb176d61095eb90e7af7df968e88f432`
- Database source inspected: `gridex-ops-dev` (`piidsfebjqjmnepdpnas`)
- Production changed: No
- Development ledger edited manually: No
- Staging verified: No

`VERIFIED_CLOSED` is not used.

## Reproduction

On 2026-08-07 an isolated Supabase development branch named `staging-aud-001-2026-08-07` was created from `gridex-ops-dev` to perform the required AUD-001 staging verification.

Supabase attempted a clean migration replay into a fresh database. Replay failed.

The fresh branch official migration ledger contained only:

- `20260531075508` — `fix_customer_internal_notes_customer_fk`

The next replayed EDIEL foundation migration attempted to create `public.ediel_message_intents` with:

```sql
company_id uuid not null references public.companies(id) on delete cascade
```

PostgreSQL failed with:

```text
relation "public.companies" does not exist
```

The failed branch was deleted immediately after evidence capture to stop unnecessary hourly cost.

## Dev ledger evidence

The official `gridex-ops-dev` ledger begins at:

- `20260531075508` — `fix_customer_internal_notes_customer_fk`
- `20260625121236` — `ediel_message_intents_foundation`
- `20260625125336` — `ai_bi_reconciliation_approval_audit`
- later migrations continue from there.

However, the live development schema already contains historical objects such as `public.companies` that are required by later migrations.

Therefore the official ledger cannot, by itself, reconstruct the current schema from an empty database.

## Repository evidence

The repository contains the EDIEL foundation migration at:

`supabase/migrations/20260625110000_ediel_message_intents_foundation.sql`

That migration assumes `public.companies` already exists.

The repository migration set, official Supabase migration ledger, and canonical migration manifest do not currently form one proven checksum-verifiable replay chain from an empty database to the current schema.

## Root cause

The live development database contains pre-ledger historical schema state. Later repository migrations were authored against that already-existing state. Supabase branch creation starts from a fresh database and replays the tracked migration history, so the first migration that requires a missing historical object fails.

This is schema provenance drift, not an AUD-001 Storage-policy failure.

## Safety constraints

The remediation must not:

- manually insert, delete, or rewrite rows in `supabase_migrations.schema_migrations` to make history appear complete;
- edit already-applied migrations in place;
- use `gridex-ops-dev` as a substitute for an isolated staging environment;
- guess historical ownership or schema definitions;
- merge AUD-003 changes into PR #87.

## Required remediation design

A valid remediation must establish a deterministic clean-replay boundary. Before implementation, compare:

1. repository migration files and checksums;
2. `supabase_migrations.schema_migrations` in `gridex-ops-dev`;
3. `canonical_migration_manifest` / repository migration manifests;
4. the current live schema objects required before the first replayable ledger migration;
5. historical repository commits that may contain the missing baseline DDL.

The preferred outcome is an immutable, reviewable baseline/reconciliation mechanism that can create the required historical schema on a fresh database without changing the meaning of already-applied migrations or falsifying the live ledger.

## Verification requirements

AUD-003 cannot move to `DEV_VERIFIED` until all of the following pass:

1. clean isolated database replay succeeds from the documented baseline through every current migration;
2. resulting schema fingerprints match the expected canonical schema for security-sensitive objects;
3. migration filenames, versions, names and checksums are reconciled and documented;
4. a second clean replay is repeatable/idempotent at environment level;
5. existing `gridex-ops-dev` remains operational without manual migration-ledger manipulation;
6. CI gains a release gate that detects future loss of clean replayability.

## AUD-001 dependency

PR #87 remains `DEV_VERIFIED` and must not be marked `STAGING_VERIFIED` until AUD-003 allows a clean isolated staging environment to be created and the real authenticated Storage API E2E is executed there.

## Next implementation step

Recover the missing historical baseline from repository history and compare it to the current dev schema before creating any new migration or changing any database state.
