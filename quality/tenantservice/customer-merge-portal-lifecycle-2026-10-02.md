# Customer merge: portal and support lifecycle

## Scope

This change preserves the existing authorized, same-company customer merge model. A merge moves portal accounts, identities, tenant links, history, idempotency records, support attachments, and required site-owned rows to the primary customer. It preserves each subject, provider namespace, status, role, and attachment storage path. It rejects ambiguous active subjects and uniqueness collisions before moving the graph. It does not change the customer portal wire contract.

Verified bindings may follow a bounded, same-company `merged_into` chain. Identifier-only discovery cannot use an archived source as a new binding. Sync keeps a verified existing binding when its historic customer number belongs to a merged source and returns the surviving customer's current number. A blocked account remains blocked.

The migration defers only the fourteen named composite ownership constraints during the merge transaction and validates them before returning. Signed-contract immutability remains enabled. Guards prevent late writes against a merged source. Insert guards wait for the customer lock and recheck; update guards return a controlled conflict instead of creating an inverse-lock deadlock. Atomic and fallback contact updates reject a merged source before any mutation or audit/outbox write.

## Local native evidence

The synthetic PostgreSQL 16 fixture was built from the current canonical schema at base `55bb4e83b58230eb811ba2cc78f9c9ae04604231`, with 54 affected public tables and 213 actual foreign keys. It includes the canonical contract state machine, signed/locked-contract immutability guard, and authorization immutability guard. It is not a full Supabase migration replay: unrelated operational triggers, RLS, and outside-graph dependencies remain the responsibility of the mandatory CI replay.

- The previous merge RPC reproduced `customer_case_attachments_case_owner_fk` failure and transaction rollback.
- The previous contact RPC reproduced a write, audit, domain event, and queued outbox on a merged source even when its post-merge version matched. The proof transaction rolled back.
- The new native lifecycle regression passed: composite support/site ownership, portal mappings/history, disjoint users and preserved roles/statuses, alias ambiguity, cross-company refusal, uniqueness rollback, locked-contract immutability and refusal of incomplete signed insertion, late-write refusal, and atomic contact rollback.
- The two-session concurrency regression passed: stale identity INSERT and contact update wait/recheck after merge; child UPDATE fails safely without a deadlock; all committed synthetic fixtures are removed.
- No live OPS database or production settings were changed.

## Source checks

- 107 tests across 12 focused files passed, including real resolver/sync route tests, support routes/attachments, identity transitions, assertion, bundle, and controlled-error mapping.
- `typecheck` and `typecheck:tests` passed.
- Scoped ESLint with zero warnings passed.
- Customer portal API docs and both error contract checks passed.
- Migration integrity, legal guards, hardening, and type provenance checks passed; 671 migration files, 575 version groups after the #455 rebase.
- Tenant-service ratchet passed: 2335 against baseline 2353.
- `git diff --check` passed.

Logs are in `/tmp/gridex-ops-merge-native-final.log`, `/tmp/gridex-ops-merge-concurrency-final.log`, and `/tmp/gridex-ops-merge-targeted-final.log`. Local fixture and concurrency commands use `/workspace/scratch/ea40179ae827/with-local-postgres.sh`; only localhost is accepted by the concurrency script.

## Current-main rebase and identity composition

The candidate is rebased onto `c1fdf06c6735d193a9bb2529811b0f3339ac1360`. Invoice atomicity PR #455 and its canonical generated schema/types are preserved. Its new 224000 migration required renaming only this lifecycle migration to 230000; the SQL body/hash are unchanged. The native proof above used the identical body on the affected 55bb schema. In a separate disposable worktree, the previous candidate composed with identity PR #454 passes all 119 tests in 14 files, both TypeScript checks, scoped lint, and API docs. Its two sync conflicts were additive helpers/imports; both lifecycle and unique-match checks were retained.

## First exact-head replay and fixture correction

Draft PR #458 published head `be8433fed256ea9e8ee222577a51081c701bf406`, tree `53bf8fd3b163b75d9d1a6ed90376edd88099b410`. OPS run [37054206156](https://github.com/heke99/gridex-ops-platform/actions/runs/37054206156), replay job `110994759170`, actually checked out synthetic merge `728617d283f38c0c02fcfe926a63e5053c8e1ab4`, whose Git tree equals that candidate tree. Full clean migration reset succeeded. The new native fixture stopped on `customer_contract_signed_insert_requires_import_command`: its incomplete signed seed correctly failed a canonical state-machine guard omitted by the original local subset. No production guard was weakened.

The fixture now asserts that incomplete signed insertion fails, then creates a valid locked draft with explicit customer/contract numbers. The unchanged `gridex_lock_signed_customer_contract` protects this through exactly the same immutable-owner branch as signed/active/terminal contracts. Source ownership reassignment fails with `55000 / signed_customer_contract_immutable:customer_id`. The expanded native fixture has the exact canonical state-machine function/trigger; its complete lifecycle regression passes. A fully signed product/legal/price publication graph is not fabricated or claimed.

The first artifact `11248021302`, `gridex-rem-002-clean-replay`, contains the initial authentic canonical schema snapshot and replay log, but no generated types because the fixture stopped before typegen. Its ZIP SHA-256 is `119e743091db48bacef27d4e9d14d9ea2a45eb900ac58735646e62445c25b359`. Both snapshot files were copied byte-for-byte: dump SHA-256 `de058b4793049cb206093d798267abae7662d49617695dd39ba239caca1bec8c`; fingerprint-file SHA-256 `af351e72552bb0df1ee9172983e985ba9906144bbc1fb85ea58533ac6e98377b`, canonical section fingerprint `e170398075931d95622055a92b0eb58d127793fefa1386abc01f77bffd4b45c8`. Only the expected 14 FK deferral modes, 13 triggers, trigger guard/grants, and existing RPC bodies differ from #455's baseline.

The source is now rebased onto `d9dda64a19e5733e0324600ce072c36b38c716c7` (#457, API .3 headers/release). That upstream change has no migrations or generated-schema changes, so this initial snapshot remains applicable. The type manifest deliberately retains #455's actual prior capture provenance/hash until the corrected exact-head replay produces the type file. Replay acceptance remains pending until the corrected fixture, concurrency, typegen, tenant invariants, and final schema comparison all pass.

## Mandatory exact-head replay

The new migration is `20261002230000_customer_merge_portal_lifecycle.sql`, SHA-256 `836c083fad0f231a145cf4117527057a20bdc2f73d094c3fbaa53fbab525a4c9`. It changes constraint deferrability and function/trigger bodies, without changing RPC signatures or table columns. The type manifest retains the prior generated artifact's provenance and records the new migration tail; it does not claim that a new full generation has already run.

Before merge, run the `ops-hardening` clean Supabase replay at the published candidate head. Its always-uploaded artifact is `gridex-rem-002-clean-replay`, containing `rem002-clean-replay.log`, `rem002-database.types.ts`, and `rem002-schema-snapshot/`. Import the canonical replay snapshot and any generated type changes, update the type manifest using structured JSON, then run the repository checks, and rerun the exact-head checks. The old committed fingerprint is expected to differ until this canonical artifact is imported. Local subset proof does not replace that gate.

The separately published portal identity fix (PR #454) must be composed in a disposable validation worktree before activation. This PR deliberately leaves that independent fix's first-link uniqueness and public-reference changes in its own branch.

## Complete replay and final dependency composition

PR458 head `f65f3fbc3b05e72b9bbf8358b7c2b0a04ccdc044` passed every applicable workflow: OPS37060952835 (verify/quality/build/clean-migration-replay), tenant37060952746, browser37060952794 and full-E2E37060952783. The production crawler was intentionally skipped. The native job111017192071 passes lifecycle SQL and all three races,382 native owner tests, the precise case-owner assertions, browser/recheck, type generation, tenant invariants, all injected-drift selftests and final canonical schema comparison.

Its actual GitHub checkout is synthetic merge `8841add6171be0872044feb54fc4536d1a2fb713`, tree `8bc61df8cd6e33b85dce6b817b08a319db3040be`, combining main61fc46fe and that PR head. Relative to the PR head tree27dd50b8 it adds only two upstream memory files and the metering-regression follow-up; SQL and generated artifact inputs match. This distinction is retained in structured type provenance.

Authentic artifact11250727412 ZIP SHA-256 `d39f650b1387c8245bb20d0c7c50cfd9a5588940a690a406a3501887e82ff2a2` was downloaded and verified. Generated types SHA-256 `58bcc698c17fb45495f6e99cc07c03126dbeb88addc0044709b58a2267871180`, schema dump `de058b4793049cb206093d798267abae7662d49617695dd39ba239caca1bec8c` and fingerprint file `af351e72552bb0df1ee9172983e985ba9906144bbc1fb85ea58533ac6e98377b` were imported byte-for-byte and match the committed files. Canonical fingerprint remains `e170398075931d95622055a92b0eb58d127793fefa1386abc01f77bffd4b45c8`. No generated file was hand edited; the manifest records the complete actual capture. Earlier partial-replay status is SUPERSEDED.

Root merged identity PR454 as766fdd42 and closed obsolete PR456 unmerged with its original head preserved. PR462 then advanced main to `b9764ffce249eb8775af3f4c0b7d2a8d59e5877e`; its tenant/company fail-closed behavior is preserved. Replacement schema PR461 head `5977e4574dcb6521d9e80815db10a00199dc72f5` passed every applicable exact-head workflow and85 affected current-main composition tests/types/API gates, then root merged it as `472d703e7580fdaa49374f4d7aa202da74751057`.

The final lifecycle candidate composes this actual identity/schema/admin main. Only additive sync helpers/imports and the append-only tenantservice checkpoint required resolution. Both canonical merged-alias behavior and unique/saturated-match refusal are retained; .2/.3/.4 archives and the lifecycle SQL body are unchanged. Fresh Node22.23.3:151 tests across19 affected/adjacent suites, all three TypeScript checks, scoped lint, all API documentation/compatibility/immutable release/runtime-parity checks, migration checks, tenant ratchet, generated-type provenance and diff checks pass. New published-head CI remains required before root can merge this final composition.

This work performs no production DDL, rollout flag change or deployment. Earlier repository/status tables in this report are historical observations.
