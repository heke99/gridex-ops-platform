# Database schema and migration drift

## Current database facts

Verified project: `gridex-ops-dev` (`piidsfebjqjmnepdpnas`). Production and separate staging are `NOT_VERIFIED`.

The official `supabase_migrations.schema_migrations` ledger contains 46 rows, from `20260531045730` through `20260806122255`. All 46 rows record `created_by`; all have a null `idempotency_key`. The repository contains a much larger historical migration tree, including migrations before the ledger's first version.

`public.canonical_migration_manifest` contains 94 checksum-bearing, effect-verified rows, but its latest version is `20260612221000`; it does not cover later July/August migrations.

The latest dev migration matches current `main`:

`20260806122255_gridex_ops_bl_002_global_read_isolation.sql`

Recorded checksum in repository evidence: `ccbc18dbb7232841758830235be3e808d55b0512c72a409c6125981a5103d2d6`.

## Migration matrix

| Migration / range | Repo | Dev | Staging | Production | Checksum/provenance | Drift | Risk / action |
|---|---|---|---|---|---|---|---|
| `20260806122255_gridex_ops_bl_002_global_read_isolation` | Present | Applied/registered | NOT_VERIFIED | NOT_VERIFIED | Repository checksum recorded | Latest dev/main consistent | Verify production apply and two-tenant post-deploy test. |
| `20260805085617_api_contract_billing_tenant_hardening` | Present | Applied/registered | NOT_VERIFIED | NOT_VERIFIED | Ledger statement available; complete cross-ledger checksum not established | Top-of-ledger consistent | Include in clean replay proof. |
| Official ledger, 46 rows | Partial representation of repo history | Present | NOT_VERIFIED | NOT_VERIFIED | No ledger checksum column; statements stored | Provenance gap | Export normalized hashes and reconcile to immutable repo files. |
| Canonical manifest, 94 rows through `20260612221000` | Present as DB control | Present | NOT_VERIFIED | NOT_VERIFIED | Checksums/effect verification present | Coverage stops before later releases | Extend through current head without rewriting history. |
| Repo migrations predating `20260531045730` | Hundreds present | Not represented in official ledger | NOT_VERIFIED | NOT_VERIFIED | Some represented in canonical manifest, not one unified chain | Confirmed governance/replay gap | Establish baseline snapshot plus immutable historical manifest. |
| Duplicate timestamp prefixes `20260612193000` and `20260727150000` | Multiple files | Individual applied identity not proven from current ledger | NOT_VERIFIED | NOT_VERIFIED | Ambiguous by timestamp alone | Confirmed ambiguity | Resolve through content hashes/name mapping; never rename applied files. |

## Finding

`GRIDEX-AUD-003` is confirmed: current schema may be functional, but repository files, official ledger and canonical manifest do not prove one complete deterministic replay chain. This is a release-governance and disaster-recovery defect, not proof that the current dev schema is wrong.

## Required verification

1. Generate a complete repository migration inventory with SHA-256 for every file.
2. Export each environment's official ledger, normalized statement hash, canonical manifest and runtime schema fingerprint.
3. Map historical baseline objects to an immutable baseline record rather than retroactively inserting guessed migrations.
4. Create a fresh isolated Supabase branch and replay the declared chain from zero/baseline.
5. Compare tables, columns, constraints, indexes, views, functions, grants, RLS policies and generated database types.
6. Run negative/positive and two-tenant regressions.
7. Define forward-fix and disaster-recovery procedure.

No historical migration was modified in this audit.