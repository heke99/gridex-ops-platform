# Independent completed runtime review — typed A905

Date: 2026-09-20. Exact reviewed candidate `9aad6a4f9a384153d34bfff2f6d558aebe5068d4`, tree `1c3c00fdfbd743e9b01aabe39449f42ef709e4e6`. Accepted runtime base `b4f00ae37937502f2678738bf076c0ba8de9696b`.

## Verdicts

| Review | Verdict | Reason |
| --- | --- | --- |
| TASK/SPEC | **REQUEST_CHANGES** | R-A905-1: some existing typed structural failures receive ready text containing only valid content and omitting the content actually rejected. This contradicts the approved exact submitted evidence contract. |
| QUALITY | **REQUEST_CHANGES** | Independent complete controls reproduce the omission through canonical decision and successful final draft under all three input alphabets. Existing passing tests do not cover these generic reader/owner cases. |
| WHOLE-BRANCH | **REQUEST_CHANGES** | One consolidated medium finding remains. No additional blocking finding in the reviewed production/test delta, codec amendment, assertion boundaries or evidence provenance. |

No merge approval. Root retains publication, exact Node22 CI and release authority. No implementation, existing-test, memory, original receipt or GitHub edits by this reviewer; only new scratch probes and this requested report. No delegation, live calls or human messages.

## Scope and method

Read Task2 brief first and separately approved tracked Task2 codec amendment; read author task report, runtime review instructions, full source qualification, independent source/architecture report, exact C1a–c/C2 old-assertion map and codec amendment review. Read repository AGENTS and active memory context. Applied local code-review, differential-review and verification-before-completion guidance; bounded source comparison and direct false-positive challenge were performed. The spec-compliance skill's fan-out conflicts with the explicit no-delegation instruction, so no subagents were used. Broad database/security-platform, UI/Next/React, performance remediation, deployment and skill authoring were not triggered.

Inspected the complete accepted-base production/test delta: 26 files (19 production, 7 tests), including all five new test files and the two existing assertion edits. Reviewed all new shared composition/evidence code and changed reader/owner transport, plus unchanged canonical validation, persistence, internal-review delivery and orchestration consumers. Whole branch has 100 changed files; repetitive raw receipts were verified structurally and by hashes rather than represented as manually reread megabytes of log lines. Root memory changes do not affect the product verdict.

Whole-branch diff SHA256: `8be528a2f7cb97ab3a07f9211d92d7399f0afb28cfa6c5ed9360d160f0964f7c` (`review-b4f00ae3..9aad6a4f.diff`). Source/test companion SHA256: `9ce5e027acad7d2fe9f17824347d548906d89119c2fc117b73cc226005b39a99` (`runtime-source-test.diff`).

## R-A905-1 — Medium: structural failure transport substitutes valid content for the rejected content

**Affected code:** `lib/ediel/prodat/prodatRegisterFields.ts:39,49`; related default CAV transport at `lib/ediel/prodat/prodatOwnedFailure.ts:27–33`, reached by `lib/ediel/rulebook/prodatDeathStatusPolicy.ts:60`. The composer and persisted qualifier accept the incomplete evidence as ready because it is a nonempty, structurally well-formed evidence record.

**Contract:** P94 requires the submitted erroneous value in42. Approved source audit “Wrong field value versus wrong component” requires actual failed scalar/component, or complete owning structural content/ordered conflicting candidates; when content cannot be identified, retain F and mark text unready. It explicitly forbids substituting a convenient correct scalar. This is a transport defect in the new implementation, not a request to add national classifications.

**Source-complete reproduction:** start with the already accepted synthetic Z10 fixture (`fixtures/prodat-identity.ts:z10`), add valid optional supplied QTY213 or register constant214 before the existing characteristics, and compare changing only the extra element shown below. All fixtures retain the same own209/226 and source-valid header/date/subtype/other data. Both controls are syntax accepted, application accepted and produce actual positive100/OK. All three existing input alphabets reproduce the same outcome.

| Submitted field | Actual canonical/final draft text | Problem |
| --- | --- | --- |
| `QTY+31:100:KWH+BAD` | `Felaktigt Uppskattad årsenergi 31:100:KWH` | Validator rejects the extra data element, while new evidence reads only C186 and omits BAD. |
| `CCI++Z02` followed by `CAV+:::1+BAD` | `Felaktigt Konstant för mätare 1` | Validator rejects extra data element, while new evidence selects valid scalar1. |

Each invalid complete fixture has syntax accepted, application rejected, a ready42 for the exact owning213/214, and a successful actual `buildAperakDraft`. The final decoded FTX omits BAD. The valid control removes only `+BAD`; it produces no national error and actual `OK`. Independent complete run: **6 PASS controls / 6 normative FAIL**, across `:+?'`, `*;!~`, `^|!%`.

**Related same-root variant, narrower proof:** existing310 owner with `CCI++Z17`, `CAV+Z41`, then adjacent `CAV+BAD` correctly classifies the pair/cardinality defect. Default evidence takes only the first CAV scalar and renders `Felaktigt Kundstatus Z41`. `validateProdatDeathStatus` → typed projection → actual draft succeeds with this wrong text; removing the extra CAV is a passing owner control. **1 PASS / 1 normative FAIL.** This fixture proves the selected owner and renderer, not a complete canonical Z06 acceptance control. It is consolidated with the transport finding, not reported as a separate national death-policy defect.

**Root cause:** register `malformed` explicitly includes `segmentElementCount(...) !== 1`, but `failureEvidence` ignores those same additional elements. Scalar selection is permitted merely by populated scalar/component length. The default non-register CAV transporter likewise selects the first adjacent CAV, without carrying the second candidate rejected by the death owner. The added product/meter specialized evidence branches already recognize analogous structural cases; equivalent knowledge is missing from these existing generic-reader/310 paths.

**Impact:** source-correct F identity and rejection remain, but the outgoing national explanation blames valid data and hides the actual submitted fault. Capacity can also be assessed using incomplete content rather than the full owned failure evidence. No extra-segment injection, live send, tenant leak or positive-acceptance bypass is alleged.

**Smallest coherent correction:** carry the already-rejected structural elements/candidates from the existing reader/owner, preserve decoded slots and order, and reserve scalar selection for a proven single-component fault. For the generic register reader include submitted extra QTY/CAV elements when that is the structural failure. For310's adjacency/cardinality branch explicitly carry all implicated own CAV candidates, or use an equivalent bounded shared transport that does not guess the first scalar. If the exact owned content is genuinely unavailable, retain its F and use existing text-unready recovery. Do not alter national requiredness, p119 false/U rules, field identity, existing budgets or source tables. Add regression coverage at the real canonical/draft boundary for the complete213/214 controls and at least the selected310 path; keep the present original probes/receipts immutable and replay copied probes to new output names after correction.

**False-positive challenge:** the primary finding does not rely on the first incomplete Z04 exploration. Complete Z10 controls exclude unrelated missing-field contamination; removing only BAD passes. Canonical syntax and full draft preflight do not block the faulty text. The numeric field classifications existed before this unit and remain unchanged. Presence of BAD in local `raw` does not cure its absence from the newly wire-ready `content`/FTX. The problem is not invented alternative punctuation: any exact structural rendering must retain the rejected data, or explicitly stay unready.310's narrower evidence limit is disclosed above.

## Other runtime and branch conclusions

- Shared `prodatAperakText` owns 74 source labels,41/42 templates and fixed40/109. No field classification is derived from prose, labels or numeric strings. Composer decoded70 readiness precedes persistence; no typed truncation or abbreviation. The register/310 transport finding is the remaining exception to truthful ready42 evidence.
- Own227 is selected within the same physical object/valid first-register chain. Present/absent/unavailable reference states, header/no-object behavior, duplicate own227 ambiguity, later UNH and sibling isolation are explicit. Missing optional/forbidden/unavailable227 alone keeps base41 with fallback observation, rather than introducing a blanket hold.
- National F identity and readiness are separate. `projectProdatDiagnostics.hasNationalError` retains rejected application outcome even if all F text is unready. Mixed ready/unready keeps all observations and only ready wire negatives. The persisted actual inbound guard remains ahead of actor auto-send, facility/link/case/business work. The new actual inbound tests mock external dependencies around `processInboundEdielMessage`, not merely the composer.
- `isQualifiedProdatApplicationError` recomposes text, checks readiness/fallback, field/ERC, complete own-reference state, physical occurrence and correlation. Stale/missing ready metadata, mismatched text and malformed failure arrays are ineligible. Renderer throws on unqualified typed metadata. This validation cannot recover missing source content that the producer falsely labeled ready: R-A905-1 must be corrected upstream.
- Direct shared506 explicitly throws on text-review disposition before empty-positive fallback. Manual/registry energy guard now uses retained national F, so overflow cannot disappear when no ready wire error exists. Existing legacy manual/TGT/AGT mapping surfaces remain outside typed readiness; actual TGT224 is preserved. No full authenticated manual action or live market acceptance is claimed.
- Serializer is used once for ready text. Lexical amendment changes only terminal canonical-apostrophe normalization after the old newline/trim step; release-run parity, repeated terminator removal and stop-at-released behavior match the approved exception. No tokenizer/interface/header/count/UNA/profile rewrite. Tests cover the original9 boundary assertions, empty/envelope tags, parity/middle/repetition, partialUNA and actual ownLI ending apostrophe. A valid empty-language FTX workaround exists; shared repair is not described as the sole possible alternative. General custom-separator encode remains pre-existing and unqualified.
- Only C1 X×36/506 twelve executions and C2 invalid317 C×36 wire expectations changed. Existing national identity, full values, own references, rejection/review and no-positive assertions are retained/added for these cases. Short, missing, valid and false506 cases, missing317 and independently ready fields remain outside the conditional edits. No blanket old-assertion waiver, tests/budgets/workflow/schema/frozen-source changes or new producer/role/GAS/PR310 work was found.
- Historical98/110 numeric and10/10 parent acceptance is not increased. Neither source audit nor runtime tests establish whole-F3/masterplan or live conformance.

## Evidence and verification

Independent scratch root: `/workspace/scratch/2a201d6d5897/aperak-text-runtime-review-20260920`.

| Independent check | Result |
| --- | --- |
| Manifest source hashes |26/26 match current files. |
| Manifest receipt hashes |57/57 match. |
| Original immutable source/reviewer artifacts |41/41 match, including original PDF and earlier source/codec receipts. |
| Seventeen reported Vitest receipts | All counts/files/success/pending fields match raw JSON. Final full receipt4539/4539 in302 files and focused485/485 in22 files. These are verified author receipts, not a new reviewer full-suite run. |
| Required gates |13 entries, all recorded exit0, final-gates ledger equals runtime manifest. Includes818 strip-only regressions, tenant ratchet2401/unchanged2402, source33/121/231, types/lint/route/budgets. |
| Full-tested runtime vs reviewed candidate | `git diff 64b3dfb2 9aad6a4f -- lib __tests__` empty. |
| Current source/test vs reviewed candidate | `git diff 9aad6a4f -- lib __tests__` empty at review close. Root memory changes are allowed separately. |
| Initial structural scratch run | Setup failure before tests: missing required Supabase URL because reviewer config omitted repository setup. Zero tests; preserved as an honest harness failure. |
| Corrected exploratory structural run |1 PASS /2 normative FAIL; incomplete Z04 exploration, not the source-complete proof. |
| Complete Z10 canonical/draft run |6 PASS /6 normative FAIL. Primary R-A905-1 evidence. |
| Related310 owner/draft run |1 PASS /1 normative FAIL. Narrower same-root transport proof. |

Exact independent commands (from repository root), each redirected to a distinct corresponding `.log`:

```sh
node node_modules/vitest/vitest.mjs run --config /workspace/scratch/2a201d6d5897/aperak-text-runtime-review-20260920/vitest.config.mjs --reporter=json --outputFile=/workspace/scratch/2a201d6d5897/aperak-text-runtime-review-20260920/structural-results.json
node node_modules/vitest/vitest.mjs run --config /workspace/scratch/2a201d6d5897/aperak-text-runtime-review-20260920/vitest-with-setup.config.mjs --reporter=json --outputFile=/workspace/scratch/2a201d6d5897/aperak-text-runtime-review-20260920/structural-results-with-setup.json
node node_modules/vitest/vitest.mjs run /workspace/scratch/2a201d6d5897/aperak-text-runtime-review-20260920/complete-controls.test.ts --config /workspace/scratch/2a201d6d5897/aperak-text-runtime-review-20260920/vitest-with-setup.config.mjs --reporter=json --outputFile=/workspace/scratch/2a201d6d5897/aperak-text-runtime-review-20260920/complete-results.json
node node_modules/vitest/vitest.mjs run /workspace/scratch/2a201d6d5897/aperak-text-runtime-review-20260920/related-owner.test.ts --config /workspace/scratch/2a201d6d5897/aperak-text-runtime-review-20260920/vitest-with-setup.config.mjs --reporter=json --outputFile=/workspace/scratch/2a201d6d5897/aperak-text-runtime-review-20260920/related-owner-results.json
```

`verification.json` stores the independently calculated hash/count comparisons and diff hashes. `review-receipt-hashes.json` records SHA256 for every new reviewer artifact. Original author/source/reviewer observations were not overwritten. The initial no-UNA comment is still archived byte-for-byte and corrected/disclosed in the author report, as required. Initial8RED/3PASS, codec5PASS/4RED and intermediate fixture/setup failures remain honestly represented.

One nonblocking receipt-format observation: whole-branch `git diff --check b4f00ae3 9aad6a4f` reports trailing blank EOF lines in eight immutable raw lint/typecheck log files. No source/test whitespace error was reported. The author's final-diffcheck log is an empty working-tree command receipt, not proof of a whitespace-clean entire raw-log branch. This does not justify rewriting original logs or weaken R-A905-1; it is disclosed so whole-branch verification is not overstated.

## Limits and next action

No optional full-suite rerun was performed. Exact Node22 CI is root's parallel release evidence, not independently verified here. Synthetic actual consumers do not establish live DB/provider/send behavior. Three alphabets do not exhaust arbitrary UNA configurations. The existing general custom-separator interface limitation and legacy classification/per-object/positive producer residuals remain outside this unit.

Original runtime author should correct R-A905-1 in one bounded transport/test wave, retain the reviewed classifications and all old assertion boundaries, replay copies of these immutable normative probes, and verify the changed final runtime with required gates. Then request scoped independent re-review and exact candidate CI before any merge. Source and architecture approvals remain valid; this is an implementation correction within their authorized contract.
