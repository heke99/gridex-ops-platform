# Installed site guard during sourced clean replay

Status: bounded HOLD-path repair VERIFIED in PostgreSQL-core; full disposable Supabase native execution remains pending OPS. No production function, migration, checksum, workflow, contract artifact or delivery behavior changed.

The existing native parser case read `supabase/migrations/20260930192831_customer_site_registry_atomic_command.sql`. Sourced clean replay applies those files and holds them outside the checkout; the literal source read therefore raises ENOENT before reaching its parser checks. An independent read-only audit identified this concrete fixture defect.

`scripts/customer-site-installed-guard-hold-20261001.postgres.test.cjs` installs the entire actual production function with actual canonical rowtype tables and their existing normalization/reference dependencies in PGlite. It creates a temporary checkout with an empty migration directory and calls the exact checked-in native callback, transpiled without changing its guard logic. Before the correction, actual RED was 0/1 pass, exit 1, ENOENT for that migration path (`/tmp/gridex-site-native-hold-red.log`). Earlier missing core-bootstrap dependencies were harness setup failures, not defect evidence.

The narrow native correction obtains `pg_get_functiondef('public.gridex_save_customer_site_v1(jsonb)'::regprocedure)` directly from the applied disposable database. The exact schema/name/argument signature is mandatory; a missing owner fails instead of falling back to repository or HOLD files. The original literal guard extraction, real temporary PL/pgSQL compilation and five assertions are unchanged: complete valid postal data, incomplete invalid postal data, incomplete null postal data, forged postal mismatch denial, and forged completeness denial.

The core harness lets that actual callback reach its synchronous psql boundary, captures the exact SQL it constructed, then compiles and executes that SQL using PostgreSQL. It supplies no canned successful parser result. The actual installed definition is read through PostgreSQL and remains byte-identical before and after the probe. This qualifies applied-source acquisition and whole-function/guard grammar with five real outcomes; it does not execute the complete site's authority/audit/business transaction or certify full native Supabase behavior.

Final local results: core 1/1 PASS with 5/5 semantic outcomes; scoped native TypeScript PASS; scoped ESLint zero errors; scoped diff whitespace PASS. Commands (Node22.23.3):

```sh
NODE_PATH=/tmp/ediel-service-check/node_modules node --test scripts/customer-site-installed-guard-hold-20261001.postgres.test.cjs
node --max-old-space-size=3072 node_modules/typescript/bin/tsc -p /tmp/gridex-site-native-hold-tsconfig.json --noEmit --incremental false
node node_modules/eslint/bin/eslint.js scripts/customer-site-continuation-20260930.native.test.ts
```

The existing OPS command remains `npx vitest run --config scripts/customer-site-continuation-20260930.native.config.ts`. Its genuine native marker `SITE_CANDIDATE_POSTAL_PARSER_NATIVE_PASS` can be claimed only after an actual successful disposable run. Locally no Docker/psql are available and zero native cases executed. The new atomic ACK and positive-site packages remain separate unpublished work and are not included in this repair receipt.
