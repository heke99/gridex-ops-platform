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

## Historical baseline evidence

The missing historical DDL is not absent from the repository. A legacy core SQL file exists at:

`supabase/migrations/01_db1_schema_repair_core_helpers_and_canonical_tables.sql`

Its own header states that it is `DB1 / 01 of 03`, must run first, performs no destructive data operation, and is intended to be idempotent. It creates the tenant/RBAC/customer foundation, including:

```sql
create table if not exists public.companies (...)
```

and subsequent company membership/RBAC tables.

`scripts/migration-history-manifest.json` checksum-pins this exact legacy file as:

```text
85f3561be4d91cee063bbf626302de7726a09c5ce08743b250e62cee959bb5f2
```

The same manifest contains additional legacy sequence files such as `01_db2...`, `02_db1...`, `02_db2...`, `03_db1...` and explicit unversioned files including `Batch 1+2.sql`, `batch 3.sql`, `batch 4+5+6.sql`, and `ediel_rules.sql`.

This proves a distinction between two histories:

1. repository/checksum history, which retains substantial pre-ledger SQL;
2. the official Supabase migration ledger used by clean branch replay, which begins later and does not provide the prerequisite baseline state.

The immediate failure on `public.companies` is therefore the first visible symptom of a broader baseline-to-ledger reconciliation problem, not evidence that only one table is missing.

## Root cause

The live development database contains pre-ledger historical schema state. Later official migrations were authored against that already-existing state. The repository retains much of that legacy baseline SQL, but the official Supabase ledger used by branch replay does not contain an executable canonical baseline before the first dependent ledger migrations.

Supabase branch creation starts from a fresh database and replays tracked migration history. It therefore reaches a later migration that expects the historical baseline and fails before the remainder of the chain can execute.

This is schema provenance drift, not an AUD-001 Storage-policy failure.

## Safety constraints

The remediation must not:

- manually insert, delete, or rewrite rows in `supabase_migrations.schema_migrations` to make history appear complete;
- edit already-applied migrations in place;
- use `gridex-ops-dev` as a substitute for an isolated staging environment;
- blindly replay all legacy/unversioned SQL files without proving order, current applicability and side effects;
- guess historical ownership or schema definitions;
- merge AUD-003 changes into PR #87.

## Required remediation design

A valid remediation must establish a deterministic clean-replay boundary. Before implementation, compare:

1. repository migration files and checksums;
2. `supabase_migrations.schema_migrations` in `gridex-ops-dev`;
3. `canonical_migration_manifest` / repository migration manifests;
4. the legacy DB1/DB2/DB2b sequences and other unversioned files;
5. the current live schema objects required before the first replayable ledger migration;
6. historical repository commits/runbooks that establish intended execution order.

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

Establish the intended order and applicability of the checksum-pinned legacy baseline sequence, compare its output to the current dev schema, and design the forward-only baseline/reconciliation mechanism before changing any database state.
