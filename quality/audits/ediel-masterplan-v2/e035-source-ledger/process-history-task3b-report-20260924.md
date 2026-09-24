# E035 Task3b process facts — implementation checkpoint

Status: IN_PROGRESS; prerequisite catalog probe only. Runtime not implemented. BASE `155fe17e9db8a4c189634468e73dd86f615cee02`; accepted Task3a runtime `d7cbab18`. Sole author working only in the isolated worktree. Parent owns publication, genuine native CI, generated contracts and project memory.

## Skill routing

Activated test-driven-development (native-first behavioral tests), supabase and supabase-postgres-best-practices (private schema/trigger/security ownership), executing-plans (approved finite brief), verification-before-completion (executed/pending distinction). using-superpowers explicitly exempts dispatched subagents. No subdelegation per dispatch. Existing worktree is verified; no new worktree needed. Broad audit/static-analysis, UI, frontend/performance, skill authoring and dependency-change groups are outside this finite implementation. Independent review and final branch delivery are parent-owned. Relevant guidance and repository memory inspected; no repository memory edited by this author.

## Evidence and decisions

Read task-3b-brief, finite inventory, fixture preflight and prepared Task3 report. Accepted replay schema is `/workspace/scratch/4b1d39503015/e035-pr372-outbound-final/rem002-schema-snapshot/schema.sql`. It identifies generated site/point columns, signed DELETE guard, restrictive switch-event FK and normalization functions. Source/catalog DDL is not a genuine live pg_trigger observation.

Parent requested a probe-only commit before migration implementation. Added one observational native test for exactly twelve tables, reporting ordered noninternal trigger definitions/enabled flags/type/function, all table constraints, column types/nullability/default/generated expressions, and seven named normalization/signed-delete function definitions. Assertions preserve actual existing table identities, generated fields, absence of invented operation/event columns and business deletion gates. No future-feature failing tests included in this prerequisite CI checkpoint.

## Changed files

- `scripts/ediel-correction-context-native.test.ts`: bounded catalog probe.
- `quality/audits/ediel-masterplan-v2/e035-source-ledger/process-history-task3b-report-20260924.md`: tracked report.
- `.superpowers/sdd/2026-09-24-e035-correction-context/task-3b-report.md`: local checkpoint mirror.

## Executed verification

- `npx -y -p node@22.23.2 node node_modules/typescript/bin/tsc --noEmit -p tsconfig.scripts.json`: PASS, exit 0.
- `npx -y -p node@22.23.2 node node_modules/eslint/bin/eslint.js scripts/ediel-correction-context-native.test.ts`: PASS, exit 0 (environment proxy warnings only).
- `git diff --check`: PASS, exit 0.

## Pending / exact next action

Parent publishes probe-only commit and runs genuine native CI on full replay. No local PostgreSQL/Docker execution; native probe NOT EXECUTED locally. Inspect returned actual catalog before native RED feature tests and CLI-created forward migration. All published migrations remain immutable. Then implement facts/gaps/epochs/witnesses, bounded owner adapter, direct/route/cascade/SET NULL/archive/native tests and exact bounds; report remaining qualification/inception/swallowed-event gaps without claiming completeness. Task4 and broad producers remain out of scope. Third set must remain complete:false.

## 2026-09-24 continuation: native catalog and RED candidate

The previously pending native replay is now complete: OPS `35959802582`, clean-migration-replay job `107505735997` succeeded on `725856255fedda166af354577aabe56fee05d0c1`. The job log contains `E035_TASK3B_NATIVE_CATALOG` for all twelve tables and `E035_TASK3B_NATIVE_NORMALIZER` for all seven named functions. It confirms nullable company scope on older event/task/site/point/switch rows, generated normalized site/point IDs, signature and contract normalization before writes, and restrictive switch-event deletion. This proves the catalog probe only; no process-fact capture existed on that head.

A new native behavioral test was published on the same PR as `716912cf8b634849e6f8175da99163e4ed955484`. It requires immutable task INSERT/UPDATE/DELETE facts, OLD scope on DELETE, rollback disappearance, and both enabled triggers on every named table. OPS run `35970235871` supplied the intended RED: native 302/303 passed; the new test failed on absent `gridex_correction_process.facts`. Verify and quality succeeded. This is behavioral test evidence, not a database acceptance.

CLI-created forward `20260924073337_correction_process_facts_v1.sql` now contains prospective private table-level facts, scoped gaps, immutable epochs and triggers. Captured rows are deliberately incomplete for historical coverage, and no consumer or positive correction authority uses them. Local Node 22 scripts typecheck and migration integrity (615 files, 519 groups) pass. The migration and its expanded native fixture have **not** passed clean replay yet. Required remaining coverage includes the other eleven CRUD/route/cascade cases, committed witnesses, budgeted snapshot reader, source-only event gaps, tenant checks, authentic generated contracts, then Task4 composition and whole-PR review. Do not merge PR372 from this checkpoint.

## Native rerun and authentic generated contracts

On published `6ac92a93`, first OPS35971121783 attempt applied the forward and passed the new fact test but failed one retained document-reference interruption case (expected committed unwitnessed outcome, actual null). The same-commit retry completed **303/303 native cases in five files**, followed by case1/browser2/postbrowser1. This supports a transient first-attempt result; the first failure is retained as evidence. The replay proceeded to typegen (SHA256 `32ae2f06418bfb57bd3da0361f856bb544a360782967f33b962f9b9765518940`, byte-identical to tracked), tenant/parity stages and schema snapshot. It stopped at the expected old committed schema fingerprint.

Artifact `10797140467` ZIP SHA256 `fd5d87fd17970748961d008b1fb821dfc6ba828a25c11bad84d5210fb1482a66` contains canonical `schema.sql` SHA256 `a691636ddf744d44b204e210184c9e29b12ee8a97aa52cb1f34eeadf882adb6a` and `schema.fingerprint.json` SHA256 `580a9dfee0cd80c8da27b8b66cd1d108cc62e05c4d67597545473b63eb8ef9b9`, fingerprint `77cc9b7902b22e0b933ec93deaa33d1f90b3ebdff8d6af040a47ba055073f1cd`. These files were copied byte-for-byte; the diff adds exactly the 36 public triggers. The canonical fingerprint covers public and gridex_received_sources, so it does not attest the private process schema. Local `npm run db:migrations:check` now passes, including unchanged authentic generated types and the new tail. Same-head ordinary CI after this reconciliation and expanded Task3b evidence remain pending.
