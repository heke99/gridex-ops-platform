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
