# Successful retry native fixture actor — round 3

Actual published327ba7af213064d52d6d6c79e414a04fd24714cb native OPS35884310774/job107260421275: 114 PASS / 10 FAIL of124, 34.30s. Forward154221 applied. The real readiness refresh succeeded: prior snapshot false/August, live catalog true/no issues, refreshed snapshot true/tail154221, matching fingerprint847a5728e6fd50db8e302917801e749febfc016cd7f96c58444513faf6b8b35a. Log-only artifact10762266897 SHA256eb1e1928f68eefe909ebf61e977084a52f259c49709d073dc72e6c066f2f5a6e. Root receipt: retry-fix2-native-20260923.md.

All ten remaining positive/completion-gap cases now reached actual domain-event writes and failed domain_events_actor_user_id_fkey. The native test passed a customer UUID as actorUserId. The real schema requires actor_user_id to reference auth.users(id); the customer identity is unrelated. No production defect is established by this failure.

The isolated fixture now seeds a separate random actor in local auth.users and an active public.user_profiles row, following the existing native reviewer fixture shape. All19 processor/sink actorUserId arguments use that actor. Customer attribution remains unchanged. Real event writes and the foreign key are retained. Direct atomic RPC tests that intentionally supply optional null actor remain unchanged. No schema/migration/production code changes, no new cases, no weakened or dropped assertions.

Local verification using /tmp/e035-node22/node_modules/node/bin/node:

- `node_modules/typescript/bin/tsc --noEmit -p tsconfig.scripts.json --incremental false`: PASS, exit0.
- `node_modules/eslint/bin/eslint.js scripts/ediel-utilts-consumption-native.test.ts`: PASS, zero errors/warnings.
- `git diff --check`: PASS.
- Exact comparison of all code from beforeEach onward against HEAD, reversing only19 actor argument substitutions: byte-identical. All124 native cases retained.

Native rerun remains pending: no local PostgreSQL/Docker, no claim of local native GREEN. No extra full unit suite was run for this isolated fixture edit. Published migration154221 and all earlier migrations remain immutable. Freeze own commit, pause for root publication/same-tree sync/native124, then authentic artifacts and final review as required. No hosted writes, deployment or remote changes.
