# Sealed Z05 concern capture checkpoint — 2026-09-24

Status: **DONE_WITH_CONCERNS** for the parent-authorized sealed-source-only Task 2 checkpoint. This is not full Task 2, native qualification, merge readiness, correction approval, or completion of E035. Parent owns independent review, ordinary CI, authentic schema/type artifacts, memory and publication.

## Scope and behavior

`captureCorrectionConcernAction` accepts only one company ID, environment, sealed source ID and explicit record-for-review confirmation. It rejects extra/duplicate fields, checks `communication.write` using an all-of requirement, checks operational company state, and obtains the actor from the guard. No caller bytes, hash, reviewer, approval, proposed date or claimed target cross this boundary.

The service calls the append RPC and then a separate witness RPC. It validates source/company/environment/receipt/hash bindings, timestamps including PostgreSQL microseconds, and unreviewed disposition before returning a bounded allowlisted receipt. Interruption, inconsistent receipts or failed witnesses return unconfirmed. Document input explicitly returns `document_context_retention_unresolved`; no PDF bytes or invented retention category were introduced.

Forward migration `20260923231731_ediel_correction_concern_capture.sql` derives observations directly from the existing sealed original. It checks tenant/environment, insert provenance, original hash parity, insertion context, active actor/current company permission and operational company state. The original ledger's insertion trigger is the inbound EDIFACT PRODAT boundary; mutable message state and parsed payload are not evidence. Original-byte storage remains the existing ledger. Source maximum is 2 MiB; the existing bounded 256 KiB wire parser determines whether exact observations can be read, otherwise the concern is wildcard/unknown.

The private exact observational parser uses the existing UNA-aware tokenizer and checks one physical PRODAT/Z05 message, one direct agency-9 object, physical CCI/CAV Z24, envelope/counts, parties, DTM93 and optional LI. Missing LI never invents a target. Unsupported/malformed/multiple objects remain wildcard concerns. Additional text, date or unfamiliar fields keep the proposed boundary unknown. Neither parsing nor a hash authenticates the alleged legal parties or correction cause.

**Parent boundary adjudication:** a C original's DTM93 cannot establish an earlier L/LK boundary. Capture retains this as `observedSourceStop`; `oldStop` is always unknown until a later independent target owner establishes it. A bare C can have `proposedStop:not_asserted`, but the unknown old boundary still requires a whole matching interval hold. `candidateTarget` is null. Customer and supply IDs remain wildcard; mutable message links and LI are never target authority.

Both concern and witness tables have forced RLS, no direct client/service DML or SELECT, and UPDATE/DELETE/TRUNCATE rejection. Narrow service RPCs use private security-definer writers with fixed `pg_catalog` search paths and invoker role wrappers. A witness rejects the append transaction's xid and binds the committed concern/hash/scope. Same original retries return the same immutable concern and witness. V1 has only immutable source-derived facts: changed facts fail explicitly instead of overwriting or falling back to an older revision. Future enrichment/revision owners are outside this checkpoint and must append separately.

## Verification

| Gate | Executed result |
|---|---|
| Initial focused RED | 23 expected failures / 8 passes against the two stubs; null capture and missing guard/witness behavior |
| Capture/action unit suite | 31/31 PASS |
| Node 22 focused capture + Task 1 hold | 35/35 in 2 files PASS |
| Node 22 full Vitest | 6038/6038 in 374 files PASS |
| `tsc --noEmit -p tsconfig.app.json` | PASS |
| `tsc --noEmit -p tsconfig.tests.json` | PASS |
| `tsc --noEmit -p tsconfig.scripts.json` | PASS; rerun after final native additions |
| Scoped ESLint (new TS files and native config) | PASS |
| `scripts/check-migration-versions.cjs` | PASS: 608 files, 512 version groups, all checksums verified |
| `git diff --check` | PASS |
| Native PostgreSQL suite | **NOT EXECUTED** locally; no psql/Docker runtime. Mandatory isolated CI remains pending |
| Generated public RPC types/schema | **PENDING actual native artifacts**; no manual generation or schema edits |

Commands used the supported `npx --yes node@22` runtime (22.23.2). npm emitted the existing environment `http-proxy`/experimental EnvHttpProxyAgent warnings. Initial typecheck identified a receipt type-narrowing error; this was fixed and all three typechecks rerun successfully. Final SQL-only control-character check and checksum update were integrity-checked; SQL execution still awaits native CI.

`ediel-correction-context-native.test.ts` adds **20** cases to the required native config (166 retained + 20 expected = 186). They exercise the real SQL parser and real service append/witness RPCs with synthetic sealed originals: C date cannot narrow an unknown old boundary, no LI, malformed envelope/date/agency, release/UNA behavior, unknown changed date, tenant/environment/actor/permission checks, idempotency, separate transaction witness, forged hash, client/direct DML denial, append-only mutation/truncate, same bytes with distinct provenance, immutable byte/hash protection and operational source deletion/ID reuse. The saved-cutoff cases include a real immutable source snapshot: a committed concern with deliberately omitted witness leaves its original raw C discoverable at a newer cutoff while the saved older readset text/hash stays identical. These are written/typechecked cases, not execution evidence.

Migration SHA-256: `e3c58c78966e88dbf182936ae29df76b25289ffc33bc08a8bf7041cb8cd32e19`.

## Remaining owners

- Document context remains explicitly unresolved in this checkpoint; the independently approved reference-only design is a separate Task 2b.
- No independent original L/LK target is asserted; no positive cause/provenance/reopening owner exists here.
- Task 3 owns bounded process/outbound history; Task 4 owns combined one-MVCC cutoff composition and actual UTILTS hold consumption. This capture checkpoint does not claim that integration.
- Current raw ledger visibility survives a lost witness. No historical backfill, complete old retention claim, market send, hosted database write, deployment or positive C acceptance occurred.

## Skill routing

Applied test-driven-development and writing-good-tests to the service/action boundary, Supabase and Postgres least-privilege/RLS guidance to the forward migration, installed Next `use server` documentation to the authenticated action, and verification-before-completion to the evidence above. Parent-provided written plan/brief and platform-preflight supplied approved source, CLI and current-doc routing. Independent request/receive review and branch completion remain parent gates. Repository-wide mapping/audit, performance, UI/accessibility, supply-chain/static-analysis, skill writing and unrelated refactoring were not triggered by this narrow source-capture implementation. No subagents were spawned.

## Review correction round 1 — I1 and I2

Base `facae00db64cc80dd0377d0ba70d29504476305d`. The independent review found that the correction parser accepted unsupported UNH namespace shapes as exact scope, and that it duplicated the substantial closure structural decoder. Both findings were confirmed by inspecting the actual predicates before editing. Native RED/GREEN execution is unavailable locally; the `PRODAT:BOGUS` counterexample is a static proof, not a claimed executed test.

I1: the correction gate now compares the complete syntax composite to `UNOC:3` and the complete message-type composite to `PRODAT:D:97A:UN:E2SE6A`. Missing, extra, empty or different directory/version/agency/association components return the existing wildcard observation. Twelve added native mutations cover each unsupported tuple/shape and the UNB syntax identifier/version/shape without altering segment counts.

I2: the unpublished forward migration now installs one private `z05_wire_structure_v1` decoder for the common envelope, parties, physical objects, groups and date. It returns structural observations and raw syntax/count metadata, not subtype or approval. A forward `CREATE OR REPLACE` rewires the existing closure projection to this decoder with its unchanged Z22/Z23 and exactly-one-LI policy and unchanged output shape. The C gate independently checks its supported namespace, singleton object, direct receiver and Z24; LI remains optional. Published migration files and TypeScript closure authority were not modified. Six added native policy cases preserve L/LK results against the existing TypeScript oracle and exercise C denial, missing LI, multiple objects and delegated transport. Existing native ACL assertions now cover the neutral decoder and both correction functions.

Final round-1 commands and outcomes (all using Node 22.23.2):

| Command | Result |
|---|---|
| `npx --yes node@22 node_modules/vitest/vitest.mjs run __tests__/ediel-correction-context-capture.test.ts __tests__/ediel-correction-context-hold.test.ts __tests__/ediel-closure-*.test.ts __tests__/ediel-structural-*.test.ts __tests__/ediel-reviewed-closure-source.test.ts __tests__/ediel-received-structural-qualification.test.ts __tests__/ediel-utilts-structural-comparison.test.ts __tests__/ediel-canonical-runtime-closure.test.ts` | PASS 273 tests / 16 files |
| `npx --yes node@22 node_modules/typescript/bin/tsc --noEmit -p tsconfig.app.json` | PASS |
| `npx --yes node@22 node_modules/typescript/bin/tsc --noEmit -p tsconfig.tests.json` | PASS |
| `npx --yes node@22 node_modules/typescript/bin/tsc --noEmit -p tsconfig.scripts.json` | PASS |
| `npx --yes node@22 node_modules/eslint/bin/eslint.js scripts/ediel-correction-context-native.test.ts scripts/ediel-closure-wire-native.test.ts` | PASS |
| `npx --yes node@22 scripts/check-migration-versions.cjs` | PASS 608 files / 512 version groups |
| `git diff --check` | PASS |

Known environment noise remains npm's `http-proxy` warning and Node's experimental EnvHttpProxyAgent warning; no environment/configuration mutation was made. No needless full-suite rerun: prior full6038/374 is historical evidence, while the final SQL/native delta has the focused gates above and still requires actual PostgreSQL execution.

Updated native expectation: **204 total** (166 retained, initial 20 correction cases, 12 namespace mutations, 6 policy-separation cases). The required native config still includes the old closure-wire and source-owner suites plus the correction suite. All are **pending genuine isolated CI**, including migration application, real RPC/RLS/transaction behavior and generated schema/types. No native acceptance is claimed.

Round-1 migration SHA-256 supersedes the initial checksum above: `3d8e2e154c4cf95355a6d81724400af6dd687bd80c26a5f1509ae3f0a91794b1`.

Applied receiving-code-review to verify the findings, then bounded regression/refactor and verification-before-completion. No subdelegation, new document support, target authority, positive C approval, hosted operation or parent-owned memory/plan edit occurred.

## Native fixture correction round 2

Base published `18debd5c57a00bbe26893d8535c75d369bb7df96`. Genuine OPS `35935812643`, native job `107432473768`, ran **204 cases: 195 passed / 9 failed**. All nine failures occurred inside the new `seed()` INSERT before any capture assertion, with `canonical_inbound_rule_profile_resolution_failed:PRODAT:Z05:2026-09-23:3` from `gridex_bind_inbound_ediel_rule_pack_evidence`. The retained three native suites and the new parser/policy cases passed. The nine capture/role/witness/source-snapshot cases did **not** establish their intended behavior. Artifact `10783390496` contains the failure log only; type/schema generation was not reached.

Root cause: the fixture supplied no complete canonical profile binding. The actual inbound trigger resolves only family, message code and receipt date; its query does not filter by parsed subtype. L, LK and C therefore yield three enabled Z05 candidates and the guard correctly fails ambiguous inference. The retained `insertClosure` fixture supplies its exact subtype profile and the six registry binding fields from the genuine `ediel_message_profiles`/`ediel_rule_packs` join.

Minimal fix: the new C fixture now uses the same registry-backed insertion pattern, selecting the enabled `PRODAT:Z05:C:26.A:r3` profile and actual pack ID, profile key/ID, version, source hash and profile snapshot. The receipt timestamp remains `clock_timestamp()`. No registry row, synthetic acceptance marker, trigger setting, production function, migration or guard was changed. The existing source-count assertion still fails if that real profile cannot be selected. Published SQL remains byte-identical and immutable.

| Final command | Result |
|---|---|
| `npx --yes node@22 node_modules/typescript/bin/tsc --noEmit -p tsconfig.scripts.json` | PASS |
| `npx --yes node@22 node_modules/eslint/bin/eslint.js scripts/ediel-correction-context-native.test.ts` | PASS |
| `npx --yes node@22 node_modules/vitest/vitest.mjs run __tests__/ediel-correction-context-capture.test.ts __tests__/ediel-correction-context-hold.test.ts __tests__/ediel-closure-owner-fixtures.test.ts __tests__/ediel-closure-source-wire.test.ts` | PASS 71 tests / 4 files |
| `git diff --check` | PASS |
| `git diff --name-only -- supabase/migrations` | Empty: no migration edits |

Known npm/EnvHttpProxyAgent environment warnings remain disclosed. Systematic debugging followed the failing insertion boundary and compared the working retained fixture before changing this fixture. These local checks do not execute PostgreSQL. Expected native count remains **204**; parent must publish, rerun genuine native CI and inspect the nine previously unreached assertions, followed by authentic generated contracts. No final native acceptance or full Task 2 completion is claimed.

## Native authorization correction round 3

Base published `90a9bd63326dffd2bf5f37568e093a4fd4d349d6`. Genuine OPS `35936657744`, native job `107435085499`, ran **204 cases: 196 passed / 8 failed**. Profile binding now succeeds. Seven capture/witness positives fail at `correction_capture_actor_unavailable` or its unconfirmed wrapper result; the permission-negative fixture fails earlier at `last_functioning_admin_cannot_be_removed_or_downgraded`. Artifact `10783054143` SHA-256 `f3667866b25ffb3c133e56c3b0a3fb514aa451ce6846ab12cc3eaf942ea568c3` contains the failing run; generated contracts were not reached.

Investigation disproved a suspected inactive-company default: the actual schema declares `companies.is_active boolean DEFAULT true NOT NULL`, and the fixture explicitly uses active company/user/membership states. The concrete authorization mismatch is `communication.write`: it is absent from `lib/rbac/catalog.ts` and the permission-seeding migrations. `communication.send` is the canonical high-risk communication capability (catalog lines 318–322; seeded in `20260519_saas_ui_tenant_admin.sql`). Consequently the fixture's `INSERT ... SELECT ... WHERE key='communication.write'` silently inserts zero permission rows; the capture SQL's sole permission check cannot authorize an ordinary actor. Retained closure fixtures succeed through their separately allowed `ediel_testing.write` capability; that test-only alternative is intentionally not allowed for correction capture.

The negative fixture independently violated the tenant's last-admin invariant by deleting/downgrading its only administrator. It now creates a distinct active viewer, grants that viewer the existing test-only capability, and preserves the functioning administrator. The test explicitly queries the real permission RPC for test-only presence and capture capability absence before attempting capture.

The parent obtained independent SPEC/QUALITY approval for the bounded canonical-capability amendment in `correction-capture-permission-amendment-review-20260924.md`. This supersedes earlier references in this report to `communication.write`: **the authenticated action and capture SQL now both require `communication.send`**. No permission, alias, role policy/grant or test-only fallback is introduced. Existing send-capability holders may record this unreviewed concern; capture still performs no send or semantic review.

The pinned Supabase 2.101.0 CLI (`migration new --help` inspected, then `npx --yes supabase@2.101.0 migration new ediel_correction_capture_canonical_permission`) created forward `20260924001447_ediel_correction_capture_canonical_permission.sql`. It replaces only the private capture owner; the body is exactly the published body except its permission literal and `CREATE OR REPLACE`. All source/hash/size/actor/company/witness checks remain. Published `20260923231731` bytes were not edited. New forward SHA-256: `1da1232dd18209471ca41d9143c450effc84cdc6bb61560ee104d5d8e0fee071`.

Native fixture setup now asserts exactly one canonical `communication.send` permission exists, verifies effective selected-company permission through the real RPC, and checks actual active company/user/membership state. Separate non-admin viewer cases verify test-only or read-only capability is present while send is absent, then require unconfirmed capture and zero concern/witness rows. Wrong-company effective permission is explicitly false; inactive-user behavior is retained. A new paused-company case reads the persisted status before invoking capture and checks zero writes. Schema inspection confirmed `paused` is in `companies_status_check`, active→paused is an allowed canonical lifecycle transition, and `viewer`/`active` are valid membership role/status values. No last administrator is deleted/downgraded. Existing actual successful capture/separate witness assertions remain unchanged.

| Final command / proof | Result |
|---|---|
| Change action test to expect `communication.send`, then `npx --yes node@22 node_modules/vitest/vitest.mjs run __tests__/ediel-correction-context-capture.test.ts` before action change | RED: 1 expected failure / 30 passes; action still requested nonexistent write capability |
| `npx --yes node@22 node_modules/vitest/vitest.mjs run __tests__/ediel-correction-context-capture.test.ts __tests__/ediel-correction-context-hold.test.ts __tests__/ediel-closure-owner-fixtures.test.ts __tests__/ediel-closure-source-wire.test.ts` after fix | GREEN: 71 tests / 4 files |
| `npx --yes node@22 node_modules/typescript/bin/tsc --noEmit -p tsconfig.app.json` | PASS |
| `npx --yes node@22 node_modules/typescript/bin/tsc --noEmit -p tsconfig.tests.json` | PASS |
| `npx --yes node@22 node_modules/typescript/bin/tsc --noEmit -p tsconfig.scripts.json` | PASS; rerun after paused-state readback assertion |
| `npx --yes node@22 node_modules/eslint/bin/eslint.js scripts/ediel-correction-context-native.test.ts app/admin/ediel/correction-actions.ts __tests__/ediel-correction-context-capture.test.ts` | PASS; rerun after final native edit |
| `npx --yes node@22 scripts/check-migration-versions.cjs` | PASS: 609 files / 513 version groups |
| `git diff --check` | PASS |
| `git diff --name-only -- supabase/migrations/20260923231731_ediel_correction_concern_capture.sql` | Empty; published migration untouched |

Expected native count is now **206** (one additional read-only negative and one paused-company negative). Genuine replay remains pending: current 196/204 is failure evidence, not acceptance of this correction. Type/schema artifacts also remain pending. npm/experimental proxy warnings and the pinned CLI's newer-version notice are known environment/tool notices; no unrelated toolchain/configuration change was made. Parent-owned memory/plan/review artifacts remain outside this implementation commit.

## Fix round 4 — read-only diagnosis/proposal

Actual published `dba55466` replay OPS35938086638/native107439595316 is **195/206, 11 failures**, all stopped at the missing communication.send registry singleton. No new native execution or generated artifact acceptance. Fresh diagnosis confirms that communication.send and communication.read are canonical catalog keys but neither is materialized by migrations/bootstrap/empty seed; May 19/21 arrays only select existing rows when adding role links. Proposed two-key forward materialization preserves all existing rows/assignments and does not grant roles/users any authority. Published SQL remains immutable.

The actual selected-company resolver also has a load-bearing direct-grant defect: `20260902091000_company_scoped_permission_engine.sql:190-195` ignores direct grant company/status/is_active/effect. A dual-member actor can borrow company A's direct send grant when capturing B; deny-only/inactive direct rows also become positive. The current wrong-company fixture has no target membership and misses this case. Proposed shared-owner forward filters the direct branch to active allow rows in the selected company (plus existing legacy null-company semantics), preserving role/platform branches and ACL. No production edits made; parent and independent combined proposal review must resolve scope first.

Full evidence, bounded proposal, grant/idempotence proof and named downstream source/profile/witness prerequisites: `.superpowers/sdd/2026-09-24-e035-correction-context/task-2-fix4-report.md`. Capture remains source-only; Task 2b documents, Task 3 process history and Task 4 UTILTS composition are not implemented. This note is diagnostic evidence, not permission materialization, native acceptance or completion.

## Fix round 4 — approved bounded implementation, native pending

Independent `correction-capture-fix4-proposal-review-20260924.md` approved the combined proposal before production edits; parent appended the exact implementation resolution to the brief. CLI 2.101.0 created two forwards under Node 22.23.2:

- `20260924003708_communication_permission_registry_completion.sql` materializes only existing communication.read/send, using the canonical catalog metadata and `ON CONFLICT(key) DO NOTHING`. Existing IDs, metadata and disabled state are preserved. It has no role/user/override assignments. SHA-256 `83d11f7c4b5afcec905a8b161f2aa07a92fc9a2883ff65f9ca49bfcf71773f38`.
- `20260924003724_company_direct_permission_scope_repair.sql` restricts only the shared resolver's direct CTE to active allow rows, with exact company and active membership for non-null company grants. Existing null-company global direct behavior and union-of-positive-grants semantics are retained. Deny-only rows no longer grant; an independently valid role still grants. Mechanical comparison confirms the declaration, role/platform branches and result aggregation remain byte-identical outside that CTE. No owner/ACL statement or other resolver changed. SHA-256 `12f64cbba929a88e2d0b057c2e75c8a945faf4830d13b87844de2a1cf21c8a2e`.

Native tests were authored before SQL bodies and add **18** cases, for **224 expected**, not executed, native cases. They cover actual first application with zero assignments, conflict replay preserving disabled metadata/IDs and nonempty role/user/override assignment snapshots, owner/effective ACL preservation, dual-company direct grant denial, deny/removed/inactive direct rows, null requested company, legacy global grants, valid/scoped/inactive roles, deny plus independent valid role and explicit platform administration. Migration replay tests use the exact committed git blob plus manifest SHA and transaction rollback, avoiding clean-replay marker files. C profile singleton and sealed source scope/hash/context/clock prerequisites are asserted before capture. Original service/capture/witness/state/byte/cutoff negatives are retained.

Executed local verification under pinned Node 22.23.2: covering capture/hold/closure-fixture/wire unit tests **71/4 PASS**, scripts typecheck **PASS**, native-file ESLint **PASS**, migration integrity **611 files / 515 groups PASS**, published-migration byte checks and `git diff --check` **PASS**. Script types and lint were rerun after the final native edit. Known npm proxy/experimental warnings and CLI update notice persist. No full-suite repeat, hosted operation, market send or generated-file hand edit occurred.

Actual prior **195/206 remains failure evidence**. New native resolver cases have not run RED/GREEN locally; static predicate evidence and the genuine missing-registry failure motivated the repair. Parent must execute genuine native224 and obtain actual schema/types before acceptance. Source-only Task 2 remains DONE_WITH_CONCERNS; Task 2b documents, Task 3 process history and Task 4 UTILTS composition are not implemented. Parent owns independent scoped implementation review and publication/native qualification.
