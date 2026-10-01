# API/UI CI recovery — 2026-10-01

## Current follow-up: genuine resumed CI and catalog seed — 2026-10-01

The first correction was published non-force as949dfe60440d5f70c713971ae26c83152bebad94 (exact local treea2623cc6e71cd5d062e75d653899278c2d02d850). Genuine merge12945f22e2fffbb2044252afa77d8b768594b215 has the same tree and parents ae56+949. OPS36871357216 finished with verify and quality-release-gates PASS (7721/532, API/RBAC/types/build/budgets), strict upgrade/actual backup-restore/schema parity PASS, separate pinned-old rollback ALL_PASS and fresh-old backfill PASS. FullE2E36871357256 smoke/coverage/PR certificate PASS; full/staging/nightly SKIPPED. Tenant/Ediel/public browser workflows PASS. These are authentic results, not local estimates.

The import blocker is cleared. Purchase15 genuinely started and failed at the same shared preparation statement: customer_sql/P0001. Accountnative4 and preceding native groups passed. Private agreement browser and subsequent native/HTTP/browser remain NOT_REACHED.

### Confirmed fixture dependency and correction

Delivery blocker in the shared disposable fixture: it SELECTs billing.write/export from public.permissions, then raises P0001 if its owned role did not receive exactly2 rows. The clean migration corpus does not seed those product keys; earlier fixtures provision their own necessary keys or roll their test transaction back. No billing catalog provision occurs before this group. Direct execution of the actual extracted catalog/grant SQL against the authentic generated permissions/roles/role_permissions DDL reproduces manual_native_permission_prerequisite_missing/P0001 with0 or1 existing billing keys. The2-existing control passes. This proves the missing-catalog dependency; full native verification is still required for all subsequent guards and effects.

Minimal second correction: INSERT just billing.write/export into the disposable catalog with ON CONFLICT(key) DO NOTHING before the unchanged role grant and unchanged count assertion. Existing catalog attributes, IDs and inactive status are preserved. Grants belong only to the fixture's unique synthetic company role. No production catalog, migration, role assignment, authority function, RLS, business assertion, native test body, provider transport, schema/type output or dependency changes. Prepared approval/capture remain modeled prerequisites, not producer qualification.

Three regression cases execute the actual shared fixture SQL with0/1/2 existing catalog rows, preserving existing complete rows including inactive flags and asserting only the owned role receives exactly the two grants. Tests are wired through the existing PostgreSQL-core CI command. RED:0/1 fail P0001,2 passes. GREEN: all3 and all29 original core controls PASS (32/32,0 skips, Node22.23.3/PGlite0.5.8,123071.98051ms). Core checks do not represent complete GoTrue/native/PostgREST/installed-guard qualification. Scripts tsc PASS; native fixture ESLint PASS; updated suite still collects all15 without import failure. Local native assertions remain0. The manual force-lint exploration uses the repo's TS require-import rule on CJS; the existing CJS suite is normally ignored. CJS syntax and lint with only that format rule disabled are checked separately; no repository rule is changed.

Corrected-native CI: PENDING for this second correction. Retain the real949 terminal FAIL; do not call all15 accepted before a genuine green changed-head run. Next: fresh ref/sole-owner check, publish this exact reviewed tree non-force over949 to existing draft422, inspect native15 and private agreement browser diagnostics, fix the first actual failure, then integrate preserved U07/claim-attempt/mounted-account packets and all original75/P0–P8 effects. No main merge or production action.

The first-correction evidence below is retained as history and applies to its explicitly named source.


Scope: resolve the first genuine #422 CI stop on source head `62e36228899a5a4c8a9dd497f06622c49ce14365`, tree `467e1e770a495253cb8113962961c28b94b0f057`. This bounded recovery does not complete the original API/tenantservice/OPS masterplan.

## Ownership and skills

The user asked to fix the stalled API/UI agent and assess progress. Recovery runs in `/workspace/scratch/a8f0d839b20b/gridex-api-ui-unblock`, local branch `codex/api-ui-unblock-20261001`, with exclusive ownership of the purchase native config, authentic generated-file adoption, and this recovery receipt. Existing account, purchase, portal-admin, U07, mounted-account and claim-attempt worktrees are preserved with their tracked and untracked source. No other worktree is edited. The existing #422 remains the integration PR, based on #418/ae56; no replacement PR or production action is authorized.

Activated: using-superpowers for routing; systematic-debugging for actual failure reproduction and working-reference comparison; test-driven-development via the existing suite collection RED/GREEN; using-git-worktrees for isolation; verification-before-completion for fresh bounded checks; Supabase for authentic generation provenance. fp-check trigger is absent (this is a test-loader error, not a vulnerability claim); direct reproduction independently confirms it. Broad security/performance/UI redesign and whole baseline audit skills are outside this narrow correction. No Next runtime API is changed. No new test duplicates the alias implementation.

## Actual preceding CI

OPS run `36863477286`, job `110373137760`, checked out merge `838da5261735ab3edf578cdff91021c6e54ff587`. Git object read confirms the merge has the same source tree as 62e, with parents #418 ae56 and #422 62e. Both additive forwards 20261001094820/account and 20261001094830/purchase actually applied.

- quality-release-gates `110373137723` genuinely PASS: ordinary 7721 tests/532 files, build, TypeScript, lint, API/RBAC and budgets. This belongs to source62e, not automatically to this changed head.
- Existing queue/contract/lifecycle/agreement native groups genuinely PASS. New account native4/4 genuinely PASS (late claim/event faults, concurrent same-user completion and a new-login replay).
- Purchase native suite FAILS at module import: `ERR_MODULE_NOT_FOUND`, cannot find package `server-only` from `lib/billing/manualPurchaseIntentReconstructed.ts`. No purchase case runs; all15 are NOT_REACHED. The later private agreement browser and following native/HTTP/browser paths are NOT_REACHED.
- Verify and full-E2E smoke FAIL on actual generated-type migration tail31→33. Full/staging/nightly E2E are skipped, not PASS.
- Upgrade and actual pg_dump/pg_restore, catalog/Auth/data/owner/ACL/current commands/session denials and zero-effects witnesses PASS, then strict comparison against old committed schema FAILS at byte180050/line2464. Keep that terminal FAIL. Separate pinned-old rollback ALL_PASS and fresh-old backfill8 PASS.
- Tenant integrity, Ediel regressions and public browser/quality PASS on62e. Public browser success does not qualify private OPS or billing journeys.

## Finding and minimal correction

Confirmed CI tooling defect, high delivery impact: the isolated purchase native config has no `server-only` alias. Its `react-server` condition cannot resolve a package absent from the dependency graph. The successful account and agreement configs already map that exact import to Next's installed `next/dist/compiled/server-only/empty.js` in their Node test environment.

Add the same exact-match alias to the purchase config. Preserve both conditions, the disposable-CI/status/loopback guards, synthetic-only credential boundary, every native test/fixture byte and the runtime import. No package/lock change, production `server-only` removal, altered business expectation, timeout or skip.

## Authentic generated-file adoption

Artifact `11163217587`, `gridex-rem-002-clean-replay`, from run36863477286/job110373137760/source62e. ZIP1059290 bytes, SHA256 `478b6933107a6024353b6702d14d7a12af56472f6ee3abe3220a409f88311f8e`, independently matches GitHub artifact digest. Generation occurs before native tests and their failure. Existing nullability postprocessing completion: `2026-10-01T12:44:38.2423702Z`; fingerprint receipt: `2026-10-01T12:44:30.7704306Z`.

| Adopted path | Exact SHA256 |
| --- | --- |
| supabase/database.types.ts | 6706ca2a163263331a19c9a2b278b8d2c551ac45192433ddb985bd611448183d |
| supabase/schema.sql | 7a93276b3c528712a6f313246164370c4c752bc14907acf033c22a86fc417057 |
| supabase/schema.fingerprint.json | dead982b191865834c0a7ad6418ad02d23b217423dde943f0b3b4ec532ca7f24 |

Canonical fingerprint: `6dbfd427eb07654035b322d4dae37ef3adef301af116c47c11421f7eb2c0f216`.

All three files are copied byte-exact from the authentic ZIP. The type manifest records the actual generator/version/head/tree/job/artifact/hash/tail and retained failures. Types add94 actual CLI-generated lines for the new table and three RPCs; existing nullable return overrides are preserved. Pg_dump reorders some existing table/composite definitions due to new dependencies; the full dump is not edited by hand. This adoption establishes provenance and alignment, not changed-head replay/upgrade/native acceptance.

## Fresh bounded verification

Node22.23.3, Vitest4.1.9. Earlier runtime24 exploratory observations are superseded by these engine-correct repeats.

| Command/check | Actual result |
| --- | --- |
| Original purchase config + `vitest list --config scripts/manual-purchase-intent-reconstructed-20261001-native.config.ts --json` | RED exit1, exact server-only import failure |
| Corrected same config + identical list command | GREEN exit0, all15 original cases collected; native assertions0 |
| Targeted Vitest on account completion + purchase intent + purchase token context | 51/51 PASS in3 files |
| `npm run db:migrations:check` under Node22 | PASS686 files/590 version groups, all checksums; legal/contract checks; authentic33-tail types verified |
| `node --max-old-space-size=4096 ...tsc --noEmit -p tsconfig.app.json` | PASS |
| `node --max-old-space-size=1536 ...tsc --noEmit -p tsconfig.scripts.json` | PASS |
| Explicit ESLint on changed native config; `git diff --check` | PASS |
| Archive digest, merge/tree/parents, generated byte equality | PASS |
| Previous migration/native assertion/fixture/runtime/package/lock/workflow/original75 bytes | All unchanged |

The list command uses obviously synthetic noncredential keys and only imports/collects; no fixture hooks, database calls or business tests are run by it. No local Docker/native/provider execution is claimed. The preserved real native15 remain the necessary next CI proof.

## Progress assessment

The original matrix contains exactly75 unique T01–T55/U01–U20 rows:31 PARTIAL,44 NOT_VERIFIED,0 final acceptances. This does not mean0 functions exist. It means no whole original requirement has its complete latest evidence and final outcome. P0–P8 remain open. Implementation and integration are still underway, with substantial system qualification also pending.

Remaining internally implementable work includes full-corpus U07 integration and its operations/segments/integrity/postfilters/performance callers, rejected claim-attempt writer, mounted account journey, remaining canonical customer/site/legacy writers, invoice approval/capture/provider-status/retry operator handling, connected support and attachments, and all contextual OPS actions/unsaved navigation/keyboard/mobile/upload/download journeys. The saved gap reconciliation keeps each original requirement and actual effect chain. Real issuer/phone policy, approved malware/provider/partner/hosted consumer/DR configuration and scanner authentication have separate scoped boundaries and do not block independent internal work.

## Next concrete action

Publish this bounded reviewed source non-force to the existing #422 only if the last fresh remote head remains62e; a concurrent newer ref must cause safe rejection/reconciliation, never force overwrite. Then inspect genuine changed-head OPS: purchase15, private agreement browser diagnostics, later native/HTTP/browser, strict schema/type/restore parity and full applicable CI. Resolve the next actual first failure from its evidence. Keep all75 rows open until their own complete requirements are satisfied. After this CI unblock, integrate the saved next11 packets under sole publication ownership; do not restart previous restore/source recovery, replay old prompts or apply these33 outputs to a later migration tail.

No main merge, production migration/deployment, real provider/customer communication, credential rotation, market activation or #310/#421 change.
