# Task 2b fix round 2/5 — customer read registry prerequisite

Base: `7a28b9ab086da88d320d7da96c54c503bcdafc75` (published). Scope: the new CLI-created forward `20260924021718_customer_read_permission_registry_completion.sql`, its checksum, and native regression. No earlier migration, generated schema/types, role assignment, hosted database, deployment, or provider operation changed.

## Failure and root cause

Actual OPS35945973907 native job107463863699 replayed migrations and executed 261 native cases: 228 passed, 33 failed. All 33 failed at the document fixture's line 67 registry precondition, where `customers.read` was absent. The remaining document DB/Storage assertions did not execute. The two historical INSERT paths in `20260519_bootstrap_div3rsa_superadmin.sql` and `20260522_customer_flow_access_repair.sql` use eight-digit legacy filenames. The canonical clean replay executes declared foundation inputs and fourteen-digit timestamped files; its historical file checksum manifest preserves those legacy files, but neither is a replay foundation input. `01_db1_schema_repair_core_helpers_and_canonical_tables.sql` creates the empty permissions relation; the new 20260924013820 forward explicitly materializes `documents.read`, and 20260924003708 explicitly materializes `communication.send`. There was no later canonical `customers.read` materializer. A role's textual permission key cannot substitute for a missing registry row.

## Fix and regression

The forward inserts exactly the canonical `customers.read` key, Swedish name/description and `Kunder` category into `public.permissions`, using `ON CONFLICT(key) DO NOTHING`. It assigns no role, user, override, or inherited privilege and preserves preexisting row metadata, including disabled status. It does not change actor checks in action or SQL.

The native suite now asserts singleton active `customers.read` after actual clean replay, no implicit role grant, and the already existing per-actor effective selected-company checks for all three permissions. The new repeat test seeds an actual synthetic actor and direct assignment through the real fixture, snapshots the permission row and all three assignment tables, disables/renames the registry row inside a rollback transaction, reads the exact committed forward INSERT from Git (the replay temporarily moves migration files into HOLD), executes it twice, and asserts unchanged metadata and assignments. It then confirms the actor's real `customers.read` effective permission survived rollback. This is a native DB test, not a mock or a fixture-created catalog prerequisite. The first application on clean replay must create the row before native tests start; no test seeds the registry prerequisite.

## Verification

- RED: baseline actual native 228/261 with all 33 failing at `customers.read` line 67. Local source oracle before writing SQL failed with `RED: canonical customers.read registry missing` (exit 1). Local DB/Storage unavailable, so this is not a local native RED rerun.
- GREEN local source oracle after SQL: exit 0. `npm run db:migrations:integrity`: 613 files / 517 version groups, checksums verified. `npm run typecheck:scripts`, `npm run typecheck:tests`, and `npx eslint scripts/ediel-document-reference-native.test.ts`: exit 0. Node 22.23.2 used for these checks. No native PASS is claimed on this candidate.
- New forward SHA256 `cc91587d97507a0f3ab810de11df02ed588c49914cf164d5e1fd3a213adb1243`, registered with `scripts/register-migration-checksum.cjs` in the canonical manifest.

## Remaining gates

Parent publishes the reviewed exact commit, runs actual clean replay and all five native files (expected 262 cases: previous 261 plus one new test), verifies role/user/override invariants and document Storage assertions, and reconciles authentic generated schema/types from that replay. The stale migration-tail gate at the old head is expected until generated artifacts come from a successful native replay. Independent scoped SPEC/QUALITY review and same-head CI remain pending. This correction does not establish PDF retention, C authority, historical completeness, or whole E035 acceptance.

Skill routing: systematic-debugging and TDD for the real failed prerequisite, Supabase and Postgres practices for catalog migration, verification-before-completion and quality-playbook for evidence. Conditional review/finishing skills belong to the parent's frozen review and publication. UI, performance, broad audit, and parallel-agent skills have no trigger for this catalog-only fix.
