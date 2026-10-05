# Incoming field506 recovery — independent completed runtime review

Reviewed candidate **7704f4b06a1b844bb8f2f1a0c1e91f2e0cce0d9c**, tree **ab93f8a42ccbd525395003647044683b0a7ff6fc**, against accepted PR350 main **ec7646c56a5412b2d05e9a4d763d7a2ee7462bc7**. Supplied complete nonmemory diff SHA256 verified: `5c5bdb7045c7f61103b21ee64ef8baf2d5d167e7fa29f412cdf336c649308a31`.

**TASK/SPEC: APPROVE. QUALITY: APPROVE with one nonblocking evidence note. WHOLE-BRANCH: APPROVE for the bounded field506/shared242 unit.** No blocking runtime finding was confirmed. These verdicts do not replace root's exact Node22 CI, publication, guarded merge or main validation gates.

## Routing and scope

Read the dispatched recovery review brief first, AGENTS, current memory/checkpoint/handover/blockers, active plan and relevant decisions/known failures; read the final source/architecture contract, runtime brief/report/plan and receipts. Applied local code-review, differential-review, find-bugs, spec-to-code tracing and verification-before-completion. Inspected the false-positive verification skill and directly checked plausible failure paths before classification. Using-superpowers exempts dispatched agents. The explicit single-reviewer/no-delegation instruction supersedes skill delegation workflows. Acquire-codebase-knowledge and full Quality Playbook were inspected but their repository-wide mapping/audit triggers are absent. No new source audit, implementation, broad security/database/UI/performance audit, deployment, hook installation or skill-writing task was performed. Property permutations below supplement explicit source cases; this is not a claim of exhaustive property testing.

Inspected every production/test change in the complete nonmemory branch delta and all seven changed audit/evidence documents. Runtime changes are limited to eight files: `prodatEnergyProduct.ts`, `canonicalPolicyFieldValidator.ts`, `prodatProductScope.ts`, `prodatSubtypePolicy.ts`, `decisionEngine.ts`, `payloadPreflight.ts`, `aperakErrorRuleRegistry.ts`, and actual manual `actions.part-3.ts`. Test delta is four new suites, one new fixture helper, and exactly two preauthorized old assertions. The source audit is already approved, carried forward rather than re-adjudicated. Full extracted original pages20/68/119/122 were independently read for the runtime contract; fixture source qualification and provenance are explicit in the author report.

Root advanced local HEAD to memory-only `3410254b` during review. Verified zero nonmemory difference from reviewed7704f4b0; the reviewed runtime/test/audit files and supplied diff remained identical. No reviewer repository edits, live calls or delegation occurred.

## Source-to-consumer assessment

| Obligation | Actual enforcement and assessment |
| --- | --- |
| Applicability precedes content | New pure owner binds first-message BGM, preceding own UNB application reference and physical own LIN reason. False functions and own Z14N produce no506 field error or semantic value. Unknown process/reason stays U. Z13 R does not depend on own reason/local evidence. |
| Exact physical identity | Fourth C8897110 remains242 even when it resembles an energy ID; fifth is506. Canonical incoming routing removes only506 and the approved knownfalse242 cases from generic field loops. No all74-field policy rewrite. |
| Applicable506 errors | Missing/blank fifth slot becomes typed41/506. Supplied wrong code,1131/3055,length or misplaced fifth value becomes typed42/506, with source descriptor, own message/line/LI/object identity or explicit absence. Header occurrence stays header. |
| Shared242 isolation | Z06 receives actual direction. Incoming fifth-only pairs do not count as242 or become trailing242 content; applicable invalid/missing fourth242 remains independently checked. Existing Z04 behavior and Z10 owner are retained, with no new242 content certification. |
| Outgoing/syntax | Outgoing Z06/Z14 and send-preflight paths remain strict. Incoming preflight no longer calls the misleading fourth-slot energy warning. Raw wire is unchanged. Empty false C889 tests claim no national242/506 error only; no full grammar acceptance claim. |
| Canonical/direct | `validateCanonicalPolicyFields` invokes one incoming506 owner. `runtimeDecision.applyProdatPolicyDecision` projects typed diagnostics once into the plan. Direct `decideProdatAperak` projects the same owner before outcome selection. F/U/L/I disposition remains the accepted PR350 mechanism. |
| Persisted consumer | Actual `processInboundEdielMessage` calls runtime after tenant resolution, persists plan/disposition, then uses actual draft construction through `createAckIfMissing`. Tested missing/invalid506 yields own41/42 wire, and false506 yields neither negative506 nor internal hold. Real invalid242 survives beside false506. External DB/kernel/staging dependencies are mocked. |
| Manual actual entry | `resolveBackendAperakDecision` calls the shared guard after existing family/role checks and before TGT lookup, permission context/validation, success events and positive return. All three manual callers consume the result before draft/replacement progression. GenuineF stops; valid/false/U preserve existing permission outcomes, including40/105 and invalid-status41/322 warning events. |
| Registry/system test | `deriveProdatAperakValidationIssues` guards before parser/empty-issue/TGT shortcuts. `resolveAndStoreProdatAperakErrors` derives before active-rule lookup or validation/detail writes. Actual `resolveSystemTestAckDecision` PRODAT branch invokes this boundary before positive selection; its preceding runtime branch is UTILTS-only. Independent actual-body probes confirm four F cases stop without DB and validZ14 reaches positive. |
| Business/ownership | Descriptive parser still exposes raw energyProductId; new applicable semantic projection returns null for false/U. No business506 writer/producer, tenant query, schema, role, GAS activation or processing authority was added. Existing tenant resolution and write APIs remain unchanged. |

Field-owner loops were checked for own-object/later-message/reason/qualifier leakage. New independent tests cover physical-order permutations of false/required/U objects and later-invalid messages after a valid first message. No confirmed new bypass or cross-object attribution defect remained. Z13 repeated-register usage is not newly granted; existing structural314/258 checks remain separate.

## Verification

Local reviewer runtime is Node24.19.0. All reviewer outputs are new files under `/workspace/scratch/2a201d6d5897/field506-recovery-reviewer/`; no original author observation or result path was overwritten.

1. Ran `node node_modules/vitest/vitest.mjs run __tests__/ediel-prodat-energy-product.test.ts __tests__/ediel-prodat-energy-product-scope.test.ts __tests__/ediel-prodat-energy-product-consumers.test.ts __tests__/ediel-prodat-energy-product-inbound.test.ts __tests__/ediel-prodat-dependent-z06-product.test.ts __tests__/ediel-prodat-dependent-z14.test.ts __tests__/ediel-prodat-characteristic-preflight.test.ts --reporter=json --outputFile=/workspace/scratch/2a201d6d5897/field506-recovery-reviewer/replay.json`: **363/363 PASS**, seven files, exit0.
2. Ran `node node_modules/vitest/vitest.mjs run --config /workspace/scratch/2a201d6d5897/field506-recovery-reviewer/vitest-r2.config.mjs --reporter=json --outputFile=/workspace/scratch/2a201d6d5897/field506-recovery-reviewer/independent-r2.json`: **11/11 PASS**, exit0. Tests execute real owner, registry, selector and actual system-test resolver/local helper bodies. External DB is a throwing sentinel. First independent harness attempt failed before collection because Vitest's mocks API was imported by absolute package path; original config/test/result/log remain retained, zero tests and no production conclusion. R2 uses the package-name import and explicit alias; no runtime/oracle change was made.
3. `git diff --check ec7646c56a5412b2d05e9a4d763d7a2ee7462bc7 7704f4b06a1b844bb8f2f1a0c1e91f2e0cce0d9c -- ':!.agent-memory'`: PASS. Working tree remains clean.
4. Independently recomputed the author's ledger hashes: **50/50 receipt hashes match;17/18 task-file hashes match**. The sole mismatch is the documentation plan, described below. Runtime/test file hashes match. Verified supplied complete diff SHA256.

Reviewed, rather than reran, the author's retained fresh RED5PASS/21FAIL, consumer7PASS/12FAIL, final focused295/295, thirteen pre-final gates, and final types/scoped-lint evidence. The full4464/4464 receipt is honestly identified as preceding the final one-line own-reason correction and fixture refinements. It is not exact-final/full-Node22 evidence. No optional broad rerun was performed after targeted proof was sufficient.

## Findings and false-positive register

**C506-N1 — Low, nonblocking: final plan hash is stale.** `quality/audits/ediel-masterplan-v2/recovery-506/runtime-evidence.json` lists `runtime-plan.md` as `8ee43e339287158389b9a2329b40d01ccafe34882a9f27ab5f4514185f6a9f61`, while the final checklist-completed file hashes to `801f99e0649324c4b1fe24550420e0a164659bd422fb01b2a7d5e4703427cabf`. Git history shows the plan changed in final evidence commit7704f4b0 after the ledger's runtime candidatee64d132d. Impact is evidence-verifier mismatch only; no runtime/test receipt mismatch. Minimal correction: refresh this one document hash or explicitly label the ledger's plan hash as pre-final. Preserve original receipts. This does not require runtime retesting or block the bounded runtime approval.

Rejected concerns/limits:

- Registry-only guard would miss permission success: disproved by actual manual entry placement and real permission-body replay. The guard also independently protects registry/system-test paths.
- U/false would gain a blanket manual hold: disproved by pass-through controls; valid506 independently unmatched/status-negative outcomes remain negative with warning events. No forced-positive assertion is used for the Z14N A76 control.
- Fifth506 would erase required242 or weaken outgoing validation: explicit applicable242 and outgoing suites pass; code takes the actual direction rather than parse mode.
- Final full4464 claim is stale: not a misrepresentation; report explicitly limits its applicability and records final focused/types/lint checks.
- Missing historical probes after rollback are not reconstructed; all current RED/green receipts are new and setup mistakes are separately disclosed.
- Manual and system-test probes execute AST-extracted actual resolver bodies, not full Next action modules. Static import/call-site inspection complements this proof, but no live DB/action integration is claimed. Persisted tests execute actual inbound processing and draft construction, with external persistence/kernel/staging edges mocked.
- No source-conformance claim for blank mandatoryC889, full F3, production readiness, live delivery or broader parser grammar. Existing idlessZ13 legacy facility negative and unrelated positive fallback references remain outside this unit.

## Differential risk and next action

Untrusted input is incoming EDIFACT. Its data passes through existing tokenizer/grouping and typed error construction; no new SQL, shell, browser rendering, credentials, cryptography or external call was introduced. Existing auth/role/tenant boundaries are preserved. New checks execute before mutation, with no new asynchronous race boundary. No evidence of injection, cross-tenant access, authorization bypass, session/CSRF change or newly unbounded external work was found in this branch. This is a bounded differential assessment, not a repository-wide security certification.

Only the two authorized incoming506 assertion lines changed; all adjacent242 controls remain. No frozen source, codec, schema, loader, workflow, budget or threshold change. No new producer. Historical98/110 plus10/10 parent counts and paused PR310 remain unchanged.

Root will preserve this report and the corrected C506-N1 document hash in the next durable checkpoint; no mutation of the reviewed candidate is needed. Root retains exact-candidate Node22 CI, publication and guarded merge/main gates. No additional runtime remediation is required by this review.
