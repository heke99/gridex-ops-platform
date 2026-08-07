# Gridex OPS migration provenance contract

This is the machine-verifiable empty-database replay contract for Gridex OPS. It does not modify any live Supabase migration ledger and does not authorize rewriting already-applied migration files.

## 1. Repository history is the schema source

The production runbook is authoritative for a fresh database:

1. apply the DB1 legacy foundation first;
2. apply `ediel_rules.sql` and the historical batch files;
3. then apply **all 14-digit timestamped migrations in order**.

The normal clean-replay foundation is therefore exactly:

1. `migrations/01_db1_schema_repair_core_helpers_and_canonical_tables.sql`
2. `migrations/02_db1_operations_ediel_billing_dedupe_and_storage.sql`
3. `migrations/03_db1_backfill_functions_rls_reports_and_finish.sql`
4. `migrations/ediel_rules.sql`
5. `migrations/Batch 1+2.sql`
6. `migrations/batch 3.sql`
7. `migrations/batch 4+5+6.sql`

The db2/db2b files remain outside normal bootstrap and may be used only through their controlled reconciliation procedure.

After the foundation, `scripts/gridex-aud-003-clean-replay.sh` discovers every `YYYYMMDDHHMMSS_*.sql` file directly from `supabase/migrations`, verifies its SHA-256 against `scripts/migration-history-manifest.json`, sorts by full filename, and executes the complete timestamped history with `ON_ERROR_STOP=1`.

This is not a blind replay. The order is explicitly required by `docs/production-runbook.md`, every replayed source is repository-owned and checksum-pinned, allowed historical version collisions are recorded in the manifest, and any unpinned or modified migration fails CI before SQL is applied.

## 2. Why the connected Supabase ledger is insufficient

The connected `gridex-ops-dev` ledger starts at `20260531075508` (`fix_customer_internal_notes_customer_fk`) and is compact relative to repository history. The verified development schema contains historical effects that are not represented by that compact ledger.

This was independently reproduced during AUD-003:

- ledger-only replay first failed because `public.companies` did not exist;
- after restoring the legacy foundation, it later failed because the historical `gridex_contract_platform_readiness(uuid)` implementation was absent;
- after restoring that function, it later failed because historical pricing objects such as `public.price_plans` were absent.

The missing objects are not speculative. Their source migrations are present and checksum-pinned in the repository. For example, the pricing engine is created by `20260608120000_metering_billing_pricing_engine.sql`, portfolio settlement state by `20260718161000_portfolio_monthly_settlements_rbac.sql`, and commercial price-option state by `20260729200000_contract_commercial_selection_completion.sql`.

Therefore the compact remote ledger must not be treated as an empty-database schema source.

## 3. Compact ledger parity without direct ledger DML

`scripts/gridex-aud-003-main-ledger.json` records the exact compact ledger observed in `gridex-ops-dev`.

After repository SQL has reconstructed the historical schema locally, clean replay creates no-op marker migration files using those exact official versions/names and lets **Supabase CLI** record them with `supabase db push --local`. This reproduces compact ledger metadata for comparison without directly inserting, updating or deleting `supabase_migrations.schema_migrations`.

The resulting local CLI-owned ledger must match `scripts/gridex-aud-003-main-ledger.json` row-for-row.

These local marker files are verification artifacts generated in a temporary directory. They are not production migrations and are never committed into `supabase/migrations`.

## 4. Immutability and safety rules

- Never manually edit `supabase_migrations.schema_migrations`.
- Never mutate an already-applied repository migration in place.
- Never infer historical DDL when a checksum-pinned repository migration exists.
- Normal empty-database replay must follow the production runbook order.
- Every normal replay input must be checksum-pinned before execution.
- Allowed same-version historical collisions must match `allowedLegacyCollisions` exactly and are ordered by full filename.
- db2/db2b reconciliation is not part of normal bootstrap.
- `gridex-ops-dev` is development evidence, not staging.
- A failed or unavailable staging target must never be represented as staging-verified.

## 5. Verification gates

`node scripts/gridex-aud-003-migration-provenance-regression.cjs` verifies:

- foundation presence and checksums;
- every timestamped migration checksum;
- allowed historical version collisions;
- the production-runbook full timestamped replay rule;
- deterministic full-filename ordering;
- the prohibition on direct migration-ledger DML;
- ordered compact-ledger metadata;
- critical historical replay smoke gates.

`bash scripts/gridex-aud-003-clean-replay.sh` then starts an empty local Supabase stack, executes the runbook foundation and all checksum-pinned timestamped migrations, recreates the compact dev ledger through Supabase CLI markers, compares that ledger row-for-row, and fails closed if critical historical objects or runtime dependencies are missing.

`GRIDEX-AUD-003` may be marked `DEV_VERIFIED` only when both the normal OPS verification job and clean migration replay pass on the exact same commit. Merge additionally requires the schema-fingerprint gate documented in the remediation report to be satisfied.
