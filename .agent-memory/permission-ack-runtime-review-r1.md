# Independent scoped R1 review — permission322/324

Reviewed exact candidate `3188d465eb2aa7e59b0712d0f813865e4d7567ba`, tree `3457d10bc12026850f91157b5ffab925dfa28d1d`, against prior reviewed `f30bcf63633c73773c411767b920143b7ba49c31`. Runtime correction: `69b0ce52060898c799449458e50a755af12b6895`. Date:2026-09-20.

| Verdict | Result |
| --- | --- |
| TASK/SPEC | **APPROVE** — R-PACK-1 is fixed within the authorized selected-policy scope. |
| QUALITY | **APPROVE** — unchanged reviewer oracles pass, opposing controls remain, final-runtime receipts and preservation checks are consistent. |
| WHOLE-BRANCH | **APPROVE** — the prior whole-branch review plus this complete correction/package delta has no remaining blocking finding. |

**R-PACK-1 closed. R-PACK-N1 addressed by the append-only provenance clarification.** No new blocking or nonblocking finding. Root still owns exact published Node22 CI, guarded merge and actual-main gates. These verdicts approve the bounded incoming322/324 migration; they do not approve full permission linkage, grant safety, live eligibility or full F3/masterplan completion.

## Fix verification

Read both changed runtime files, the complete new test file, the R1 audit/manifest/appended task report and correction package, plus the root memory/review changes since f30bcf63. Reused the prior review's differential-review, code-review, source-to-code, false-positive and verification guidance. Explicit no-subdelegation and no-source-edit instructions remained in force. No subagents, live calls, mutations, source/test changes or commits were made by this reviewer.

`canonicalPolicyFieldValidator.ts` now passes the selected322/324 field numbers into the pure owner instead of evaluating both and post-filtering only national issues. `prodatPermissionAckFields.ts` intersects that selection with own-function applicability **before** header, physical-object and value assessment. It neither parses reason strings nor discards internal diagnostics after generation.

The shared unique-own-BGM guard remains before field selection. An applicable selected field with no owning LIN still blocks. Selected-field header/duplicate/late ambiguity and text failure remain blocking; full callers omit `selectedFields` and retain their former complete assessment. Field classification/code sets, own223 logic, physical identity, typed diagnostics, national projection/text and registry258 predicate are unchanged. Only two runtime files and one new test file differ from f30bcf63; no old assertion changed in R1.

Fresh execution combined the original independent reviewer-v4 seven tests with the fourteen durable correction cases: **21/21 PASS**. The original seven assertions were copied byte-for-byte; only their observation output destination was changed. The accepted-main function copy remains byte-identical. Original reviewer sources and failed outputs were not executed as writers or overwritten.

The fourteen durable cases cover both reciprocal selections, each with duplicate/header/late/text variants; selected-field and full-owner opposing controls; ordinary valid partial policies; and shared ambiguous-BGM/no-LIN preservation. The seven original probes additionally reconfirm manual pre-prior/event stopping with independently ready322, actual registry unique-key replay for four physical errors/eight rows, explicit-empty-C829 hold with zero writes, direct unknown/E37 preservation with independent generic error, and the accepted-main comparison.

## N1 and evidence preservation

The R1 audit and manifest explicitly distinguish the historical performance gate hash `c58e164e…` from corrected-log hash `78bcb695…`, disclose the missing final SLO line in the old corrected log, and preserve both original logs and ledger. The earlier erroneous corrected-run attribution is explicitly superseded. This satisfies the requested append-only clarification.

The new R1 `final-performance.json` names its own actual log, exit0 and correct hash. The log contains the final SLO success line. All14 R1 gate entries (full test plus13 required checks) have exit0 and matching actual log hashes. The archived runner computes each record only after `subprocess.run` completes and the log closes; its prescribed NODE_OPTIONS are explicit. Equal successful log hashes across runs are correctly not treated as proof of equal executions.

Fresh independent verification:

| Item | Result |
| --- | --- |
| R1 runtime/test input hashes |3/3 match. |
| New receipt hashes |77/77 match. |
| R1 audit hash |Matches manifest. |
| Prior121-file snapshot |120 complete files unchanged; only authorized task-report append differs. |
| Original task-report prefix |Exact2814bytes, SHA256 `18bad091405f9bb1db5062ce62eeaa9e4b68226a62647a7747a1e1e1b7e23e29`. |
| Appended report recovery copy |Byte-identical to current ignored task report. Original tracked report unchanged. |
| Original source artifacts |22/22 still match. |
| Archive-map entries |34/34 source/archive/hash matches; executable source/config archives retain `.txt` suffixes. |
| Prior independent review |Original report and root's tracked R0 copy both exact15607bytes/SHA256 `5486534d30a11aff3740cc13ff32ad422d98504c449c73fb795c488e42e48d7c`. |
| Runtime69b0ce52→candidate3188d465 |No app/lib/__tests__ delta. |
| Implementation diff check |`git diff --check f30bcf63..3188d465 -- lib app __tests__`:exit0. |

The new source/test delta is confined to `prodatPermissionAckFields.ts`, `canonicalPolicyFieldValidator.ts` and `ediel-prodat-permission-ack-policy-selection.test.ts`. No source, schema, codec, shared grouping, registry guard, inbound workflow, loader, dependency, gate, budget or quality-discovery change was found. Root memory records keep R0's request-changes and initial4689 Node22 CI historical; they do not falsely accept the corrected runtime. Original failures, fixture-error disclosures and raw log whitespace remain preserved.

## Exact fresh command and attributed final receipts

Executed from `/workspace/scratch/2a201d6d5897/gridex-next`:

```sh
node node_modules/vitest/vitest.mjs run --config /workspace/scratch/2a201d6d5897/permission-runtime-r1-review-20260920/vitest.config.mjs --reporter=json --outputFile=/workspace/scratch/2a201d6d5897/permission-runtime-r1-review-20260920/result.json
```

Fresh result: **exit0,21/21 tests in2files**, Node24.19.0. Reviewer scratch contains original-oracle replay, fresh observations, result/log, verification inventory and hashes. No optional full/broad rerun was performed.

The author receipts were read and rehashed, not relabeled as reviewer executions:

| Receipt | Verified contents |
| --- | --- |
| R1 RED |14tests:8PASS/6FAIL, reciprocal duplicate/header/late cases. |
| Affected suite |136/136PASS in4files. |
| Author unchanged reviewer replay |7/7PASS. |
| Final full |4703/4703PASS in307files, covering final runtime and test annotation correction. |
| Packaged quality |45/45PASS in2files. |
| Final gates |Full plus13 checks all recorded exit0;14/14 log hashes match, including818 Ediel regressions. |

## Preserved limitations

The prior review's source and actual-consumer conclusions remain in force. Mocked DB/provider/kernel boundaries do not establish live persistence, transport, concurrency or tenant authorization. The accepted-main function comparison uses current dependencies and is not a complete old-worktree replay. Exact final Node22 CI and acceptance remain root responsibilities.

P-ACK-R1 remains **HIGH/open**, and generic209/261, registry40/105, canonical equal-reference258, populated-scenario comparator holds and ready-nationalF business invocation remain explicit residuals. No grant/state transition, business linkage or full-workflow correction is claimed. Counts98/110+10 and PR310-paused status remain unchanged.
