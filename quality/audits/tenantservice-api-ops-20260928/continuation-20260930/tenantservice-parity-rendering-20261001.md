# PostgreSQL restore parity: bounded catalog mechanism proof

Date: 2026-10-01. Root owns the canonical introspection query, restore scripts, diagnosis and publication. This subpacket owns only the new actual PostgreSQL core test and this report. No comparison category was skipped and no arbitrary SQL expression was normalized.

## Actual local result

`scripts/tenantservice-parity-rendering-20261001.postgres.test.cjs`: **17/17 PASS**, actual PostgreSQL 17.5 through PGlite 0.3.14, Node 22. The test executes both the exact old production SQL and the current production query; it compares complete returned catalog documents, rather than canned output or a JavaScript approximation of the query.

The OLD SQL bytes were captured with `git show 9e620d0:scripts/sql/gridex-db-parity-introspect.sql`, embedded as a portable base64 snapshot and checked by SHA-256 at execution: `806c845eca6827104b6aa0177b87db1563e91115fe3c2246944778ad2d3be256`. This requires no old Git object in a shallow CI checkout. The NEW SQL is read directly from the current checked-in file, hash `b856899dcb1b0ee3aae0aa3225efe819c8e3ce9cf3e1b8bacb9b61e03c53763d` for this run. Only the exact psql `\set QUIET on/off` metacommand is removed for the SQL runtime; the actual `SET search_path` and complete catalog query are executed unchanged. The fixed schema-list literal selects two synthetic namespaces. Every query must return exactly one JSON document.

| Actual controlled mechanism | OLD production query | NEW production query |
| --- | --- | --- |
| DROP a middle column, then rebuild the same visible ordered columns | `columns` differs solely because physical attnum is `[1,3,4]` versus `[1,2,3]` | Complete documents equal; visible order/type/default/nullability remain represented |
| Same schema, different initial session `search_path` | Only `columns,policies` differ: `uid()` versus `auth_probe.uid()` and qualified relation names in the policy | Complete documents equal because the query pins its own catalog-only path; actual expressions remain compared |
| Non-pretty `pg_get_expr(...,false)` policy text reapplied to the visible rebuild | Physical attnum alone still differs; policy expressions are equal under a fixed session | Complete documents equal |
| Same policy role set, reversed actual role creation and `ALTER POLICY ... TO` input order | Actual role arrays differ while all other categories are equal; isolated `ORDER BY 1` aggregate preserves input order | Exact role-name sort produces complete document equality |

The isolated aggregate probes are executed as separate SQL statements: putting a constant-order aggregate and a sorted aggregate in the same statement can expose shared sorted input and mask the first aggregate's ordering defect. Raw policy role-name arrays must differ in the fixture before the complete-query equality assertion is accepted.

## Real drift remains visible

Thirteen separate cases start from equal complete NEW documents, then perform genuine PostgreSQL DDL changes. The actual query must return different complete documents with the relevant category still present:

- Column type, default, nullability and visible column order.
- Policy body, removed policy role and added policy role.
- RLS enabled and RLS forced flags.
- Relation, schema and function grants.
- Function `SECURITY DEFINER` state.

All thirteen passed. No test deletes `columns`, `policies`, a privilege category, a default or an expression before comparison. Column identity/generated fields and all other existing categories remain in the production document; this receipt does not claim a dedicated mutation case for every possible field.

## Reproduction and frozen subpacket

```sh
NODE_PATH=/tmp/ediel-service-check/node_modules /tmp/ediel-toolchain/node_modules/node/bin/node --test scripts/tenantservice-parity-rendering-20261001.postgres.test.cjs
/tmp/ediel-toolchain/node_modules/node/bin/node --check scripts/tenantservice-parity-rendering-20261001.postgres.test.cjs
```

The core command requires the installed PGlite package; the checked-in test has no dependency on these particular temporary install paths. Core execution exited 0 with 17 cases passed, zero failed/skipped. Node syntax check exited 0. `git diff --check` exited 0. The repository's default ESLint invocation ignores this CJS script (one explicit ignored-file warning), so it is not represented as a scoped lint PASS or a whole-app/type/build receipt.

Frozen owned paths:

| Path | SHA-256 |
| --- | --- |
| `scripts/tenantservice-parity-rendering-20261001.postgres.test.cjs` | `a519986212d81df12c9377e338e3b0ad843e85b260a008a09a4e4ec8edab4358` |
| This unique report | Supplied separately to root; no self-referential hash |

## Exact qualification limit

These are controlled actual PostgreSQL catalog mechanisms. No real `pg_dump` archive or full Supabase stack was executed by this core test. The repository contains genuine DROP/ADD `scope_point` history on `gridex_received_sources.sources` (including migrations 20260925101500, 20260925110000 and 20260925113000), which makes physical numbering a grounded hypothesis. It does not identify the actual remaining CI rows. Root's latest genuine restore reports `columns,policies` mismatch after archive/bootstrap ACL/data/owner/column-ACL/default-ACL checks, but its private source/target diagnostic rows were not available here. The actual native mismatch cause remains unconfirmed until bounded diagnostics or a successful genuine restore establishes it. This proof is not a native restore, data/RLS-authority, provider, browser or physical-document acceptance receipt.
