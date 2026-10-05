# F3 phase-closure plan after completed D acceptance

Date: 2026-09-20. Repository: heke99/gridex-ops-platform.
Baseline: PR357 actual merge `5e3cb079cf2901be42964198d79b2ceab755f28f`, tree `b1f7c9ff910488c57242e171f501b033e3e103b5`.
Work branch: `codex/ediel-f3-phase-closure-20260920`.
Plan status: proposed for independent SOURCE/SPEC, ARCHITECTURE, TASK/QUALITY and ACCEPTANCE review. Plan approval is not implementation or full-F3 approval.

## Fixed acceptance boundary

Numeric D110/110 and parent occurrences10/10 are accepted by independent final PR356 comment5751354872. Runtime922a660 was accepted; PR357 publishes its final ledger and consistent handoffs. PR357 reviewer5751469000 approved the documentation correction; its ordinary exact-head PR CI passed before guarded merge. Actual-main publication verification must be read separately; the old922a660 certificate does not certify5e3cb079 or this new plan commit.

Full F3 and full masterplan remain NOT_COMPLETE. No evidence-backed overall percentage is available. PR310 stays OPEN/DRAFT/PAUSED at `e961135199f292b8210884f07de3b616a670161a`: no write, restart, import, merge or dependency promotion. No live DB/provider/market sends, role/guide activation, settings or explicit deployment. Do not create optional producers merely to increase a protocol counter.

## Criterion ledger and execution order

The frozen authority is MASTERMASTERPLAN_v2 sections7,10,18(F3),18.1,19,20 and Annex D. This table is a work inventory, not a fresh phase certificate.

| ID | F3 criterion | Existing evidence / current disposition | Required closure |
|---|---|---|---|
| F3C-01 | 110 numeric D and10 parent occurrences | ACCEPTED: final5751354872, PR356 runtime and PR357 ledger | Retain; do not reopen without a specific counterexample. |
| F3C-02 | 74 PRODAT fields and register composition | Accepted field-family/register audits exist; f3-closure-qualification-20260919.md distinguishes these from full composition proof | Reconcile each field family and first/later-register overlay to actual owner, consumer, source oracle and executed positive/rejection evidence. Missing inspection is not a confirmed bug. |
| F3C-03 | UNB0031, CONTRL and separate0035 | E011 remains a confirmed STATIC omission, independently corroborated by PR357 comment5751514908 | First finite task below: one ACK-policy decision, exact0031 placement, no CONTRL loop, unchanged0035. Fresh behavioral RED is still required. |
| F3C-04 | P/U APERAK and UTILTS-ERR | Accepted350–356 typed-field,506,escaped-text,322/324,prior-flow and selected-ACK corrections; existing protocol regressions | Map each remaining family/header/object/transaction error code, reference and final response criterion. Do not reintroduce superseded F3-Q1/Q2 findings. |
| F3C-05 | Guide-before-function, per-object/IDE and persisted ACK disposition | Runtime/transaction tests exist; this continuation has not established complete phase-level evidence | Trace guide rejection versus ERR versus successful storage/ACK, sibling preservation and internal failures. Identify exact missing evidence or a reproducible defect, not a global assumption. |
| F3C-06 | Full UNSM grammar and G06 | Full grammar plus release-SHA consumer/schema/RPC inventory remains unqualified at phase level | Determine existing grammar coverage and missing source-backed checks; no broad parser rewrite merely because one syntax module is small. PR310-dependent parity remains deferred. |
| F3C-07 | E001–E013 and E034–E037 old reproductions | Historical findings include already-fixed work; E011 is the specifically reconfirmed residual | One disposition per original finding: accepted receipt and current path, superseded false finding, unverified criterion, or confirmed defect with a minimal witness. |

Order: qualify F3C-03, implement/verify its finite fix, then reconcile F3C-02/04/05/06/07 in source-dependent batches. The phase closes only when every applicable criterion has an independent evidence-backed decision. Partial approval never promotes all F3 or later phases.

## Task A — source and consumer qualification for E011 / ENV-04

**Only active subtask initially.** Read source and actual code before test or runtime edits.

The exact rule is **ENV-04 / AT-ENV-04**, not ENV-05. ENV-05 / AT-ENV-05 concerns test indicator0035 and is an opposing regression. The earlier review request's ENV-05 label was a locator mistake, not a source change.

Already read: A_Regelkort.md ENV-04 and ENV-05; D_Acceptanskontrakt.md complete AT-ENV-04/05; frozen E011 and CALL-04. ENV-04 requires0031=1 when CONTRL is requested, omission for CONTRL, and the same decision in envelope and monitoring. BGM/AB is separate. National-required behavior must not be recast as an unsupported syntax rejection.

Original-source entry gate: inspect the full applicable T24.A revision6 sections2.1 and4.2 (including printed12 and25), relevant exceptions and addressing/CONTRL examples. Frozen source_manifest.json records SHA256 `5204d4514774b04b8eedb039e1f4799ed447c7fef14554577935e2d7bd93f951`. That is a prior manifest value, NOT a fresh byte-hash verification by this continuation. Only partial File Library excerpts were retrieved. Record actual access/hash/page evidence and any conflict; do not claim a fresh original inspection or change frozen sources based on summaries. This limits the affected source gate, not unrelated work.

Inspect actual owners and callers:
- `lib/ediel/ack/canonicalAckEngine.ts` and its public projections in `lib/ediel/rulebook/canonicalEdielFacade.ts`;
- `lib/ediel/core/edifactEnvelopeCodec.ts`, `lib/ediel/messages.ts`, legacy delegates `core/unb.ts` and `core/edifactSerializer.ts`;
- real PRODAT profile/TGT builders, family-specific APERAK and CONTRL builders, UTILTS and ERR envelope callers;
- preflight, immutable persisted-payload handling and ACK expectation/monitoring consumers selected from the actual call graph, not guessed new modules.

Observed exact blobs at baseline: codec6200c6da8af1a04c67b9c3b2dc52238ce8eb3fe0 reserves ACK_REQUEST index9 but never assigns it; messages63b0f419aacfde2e59aceed262a4f4210d7a6c94 returns encoded raw after preflight. Independent5751514908 confirms the static omission and no inspected downstream repair. Neither reviewer nor this continuation executed a fresh repository counterexample. Do not report this as a runtime reproduction.

Deliver `f3-unb0031-source-20260920.md/.json` with family applicability, exact source clauses, current owners/callers, independent oracle and the permitted minimal diff. Inspect the existing canonical policy rather than inventing a second matrix. Independent source/design/oracle approval is required before Task B; substantive conditions must be resolved, not merely relabeled approved.

## Task B — finite ACK decision propagation and meaningful TDD

After Task A approval and actual-main publication verification, record root authorization for this bounded runtime task under the user's standing masterplan instruction. No new user permission is needed for the already requested code/CI/merge scope; source/review gates still apply.

1. Add durable RED tests with literal expected UNB element positions and a contrary control. Prove the observed omission through the codec AND at least a real PRODAT and applicable APERAK builder; keep CONTRL as the no-request control. Preserve RED command, exact source SHA, exit and output under a unique audit path. Setup/import failures are not meaningful RED.
2. Project one explicit immutable acknowledgement-request decision from the canonical ACK-policy owner to the common envelope input and serializer. Reuse existing context/policy; no independent generic family-to-boolean table, caller JSON authority, BGM inference or ambient DB flag. Do not guess unsupported or mixed-family decisions.
3. Serialize0031=1 at the defined slot only when that qualified decision requests CONTRL. CONTRL must not request another CONTRL. Preserve application reference, parties, qualifiers, optional subaddresses, timestamp rules, escaping, exact UNT/UNZ references/counts and0035 test/prod semantics.
4. Make expectation/monitoring use the same canonical decision. Inventory real wrappers and callers so an alternate builder cannot silently retain the old omission. Do not reconstruct decisions from rendered strings. No queued-payload mass rewriting, resending, provider operation or new business mutation.
5. Preserve incoming missing-request semantics and existing negative/positive ACK obligations. A missing optional request must not become a new rejection without direct source support. Preserve family-specific association/codes; do not broaden E011 into an ACK-profile rewrite.

Planned new focused file: `__tests__/ediel-unb-ack-request.test.ts`; integration controls can be in a separate small consumer test if needed. Existing canonical-envelope and masterplan-protocol tests remain intact. Every old-assertion conflict requires a named source-backed decision, not a blanket waiver.

Test matrix: required request versus CONTRL omission; qualified applicable P/U/AP families; BGM/AB independence and Z01 exception; production0035 absent versus test0035=1 at its separate slot; three service alphabets and released separators; final real-builder output, counts/references; missing/malformed policy input; monitoring consistency; no route/provider/DB side effects. Decide any exceptional family from Task A, not assumptions in this draft.

Expected focused command: `npx vitest run __tests__/ediel-unb-ack-request.test.ts __tests__/ediel-canonical-envelope.test.ts __tests__/ediel-masterplan-protocol-regression.test.ts` plus the qualified actual-consumer tests. GREEN means literal requested/omitted positions and all opposing controls pass, not a shared-parser roundtrip alone.

## Task C — verification, review, publication, remaining F3

For the final changed runtime: focused GREEN; npm test; npm run typecheck, typecheck:scripts, typecheck:tests and lint; frozen specification integrity; existing required Ediel, tenant-integrity/shutdown/ratchet, route-readiness, large-file/performance and packaged quality gates. Use the repository's current commands and the accepted runtime gate manifest with fresh output paths. Do not weaken workflows, thresholds, source baselines or loader behavior. Use the existing NODE_OPTIONS/static-read preloader where its established gates require it. Node22 ordinary CI is required; another local Node version must be disclosed rather than substituted.

Obtain independent TASK/SPEC, QUALITY, TENANT-BOUNDARY and whole-branch review on the exact candidate. Resolve concrete findings with narrow counterexamples and their controls. Run applicable ordinary CI, merge only the reviewed green expected head, verify merged-tree identity and actual-main73/73 plus allOPS. No automatic merge or bypass. Save durable receipts and consistent current memory without overwriting original evidence.

Then continue the criterion ledger: each remaining F3 item gets source/consumer/oracle/execution evidence and an independent disposition. Only a concrete gap becomes the next bounded TDD batch. A missing formal role, transport proof or PR310 dependency stays attached to its affected capability; it neither makes tested protocol work incomplete by fiat nor permits full production approval.

## Limitations and completion statements

Current plan is source/evidence planning, not executed implementation. No new local repository tests, full original PDF reinspection, production mutation or external send occurred. CodeRabbit5751514908 explicitly could not run the requested ephemeral test. Container clone failed DNS; connected GitHub and ordinary CI remain available. Do not confuse tool availability with normative evidence.

A plan-review PASS authorizes its sequenced work subject to the named entry gates. E011 closes only after the behavioral fix and exact review/CI/main receipts. F3 closes only after its complete criterion ledger is independently accepted. The masterplan remains NOT_COMPLETE until its other applicable phase gates are independently satisfied.
