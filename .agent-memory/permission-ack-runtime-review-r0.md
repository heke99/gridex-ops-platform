# Independent completed-runtime review — incoming permission322/324

Reviewed candidate `f30bcf63633c73773c411767b920143b7ba49c31`, tree `23153129e51b5ceb0a492d62e3978a4bd4f5112f`, against accepted main `1892cf48e77d2c6cea99fdbb5d7507d51919956a`. Date: 2026-09-20. Runtime commit `f65007f840f2b0d6d80cef0ffc2e7e3aa84f4b29` has no app/lib/test delta to this candidate. Root advanced only eight memory files to `92d7074a` while review ran; those later memory updates are outside this exact-candidate verdict.

| Verdict | Result |
| --- | --- |
| TASK/SPEC | **REQUEST_CHANGES** — R-PACK-1 violates the explicit selected-policy boundary. |
| QUALITY | **REQUEST_CHANGES** — preserve the independent failing cases and fix the selected-field internal-diagnostic leak. |
| WHOLE-BRANCH | **REQUEST_CHANGES** — one medium runtime finding; one low evidence note. No other blocking finding. |

The source contract and registry-only amendment remain approved. This is not a request to reopen source, codec, grouping, prior-flow matching or permission business semantics. No full F3, production permission linkage, market eligibility or grant-safety approval is given. P-ACK-R1 remains HIGH/open; counts98/110+10 and PR310-paused status remain unchanged.

## R-PACK-1 — medium: internal findings from an unselected field escape a partial policy

**Location:** `lib/ediel/rulebook/canonicalPolicyFieldValidator.ts:92–93`, introduced by `f65007f8`; related owner creation of unattributed internal issues at `lib/ediel/prodat/prodatPermissionAckFields.ts:23,41–43`.

The canonical adapter evaluates both322 and324 whenever either appears in `policy.fieldRules`. Its result filter applies the selection only to `prodatDiagnostic.kind === 'field'`; every internal diagnostic survives. Consequently, selecting only322 still assesses ambiguous324, and selecting only324 still assesses ambiguous322.

**Actual proof:** reviewer `review-v4.test.ts`, fresh7 tests with5PASS/2FAIL, and `observations-v4.json`:

1. Source-shaped incoming Z15/S17 with valid322=A74 and324=B79; policy retains only322. Add a second own adjacent `CCI++Z25 / CAV+B79` before the first RFF. `validateCanonicalPolicyFields` returns blocking `PRODAT_PERMISSION_ACK_SCOPE_UNQUALIFIED`, with reason `Field324 has ambiguous owning CCI/CAV placement`. Expected selected-policy result is `[]`.
2. The reciprocal case, policy324-only and duplicate valid322=A74, likewise returns a blocking internal322 issue.
3. Opposing controls pass: ordinary322-only control is empty; duplicate322 under322 selection still blocks; duplicate324 under324 selection still blocks.
4. The same excluded324 input passed through the accepted-main canonical-validator function returns `[]`. The reviewer loaded that function from the exact1892cf48 Git blob, changing only relative import resolution for scratch execution; current unchanged dependencies are used. This is a bounded function comparison, not a full baseline-worktree claim.

**Contract/impact:** the review brief explicitly requires policy-specific validators to respect selected rules; the final audit also claims partial-policy preservation. The public validator's field subset now produces a false internal-review result from outside that subset. Projection can turn this into a processing hold. No live denial, unauthorized grant or current production caller selecting exactly322-only was demonstrated; the confirmed defect is the selected-policy API contract. Full policies must continue to block the ambiguous input.

**Root cause:** source ownership is assessed before field selection, while local/internal issues lack a structured association usable by the adapter. Filtering national diagnostics alone is insufficient.

**Targeted correction:** make the owner aware of the requested selected fields, or retain structured field attribution for field-specific internal issues and filter them accordingly. Preserve shared message/BGM/physical-scope failures that genuinely prevent assessment of a selected field. Do not parse the human-readable reason string, drop all internal issues, or suppress selected-field ambiguity. Keep standalone/manual/registry/direct full-field assessment unchanged. Preserve the new reviewer expectations and add durable opposing controls; no old assertion waiver is needed.

This is a verified behavior/contract bug, not a newly claimed security vulnerability. Direct execution, accepted-main comparison and opposite-direction controls eliminate the fixture/whole-policy false-positive explanations.

## R-PACK-N1 — low, nonblocking: corrected performance gate metadata retains the earlier hash

`permission-ack-runtime-20260920/corrected-final-static-gates.json` and the top-level runtime evidence `gates` entry for `performance` retain SHA256 `c58e164e88291eeb5910c2b24ad5fc633c84067f8b955e19ecde8b6c43c0d629`, which matches **final-performance.log**. The **corrected-final-performance.log** actual hash is `78bcb6957d850c6b213099fb2cc7baf9e004afe967288c2f53671b0c33b4953a`, correctly recorded in `receipt_sha256`. The corrected log omits the original final line declaring the SLO contract pass. Do not describe these hashes as one matching corrected-run record.

Fresh reviewer `npm run quality:performance` completed **exit0**, including the final SLO success line, on the unchanged runtime; `performance.log` and `verification-final.json` retain that evidence. Thus this is provenance inconsistency, not a currently failing gate. Append a clear correction tying the gate record to the appropriate receipt and preserve both original logs. No broad gate rerun is requested.

## Review scope and skill routing

Read the runtime-review instructions fully first, AGENTS, active memory/checkpoint/decisions and failure context, complete approved plan/source audit, both independent source/amendment reviews, final task report, runtime audit/evidence and complete runtime/test diff. Applied local differential-review, code-review, find-bugs, source-to-code tracing, targeted false-positive checks and verification-before-completion. The using-superpowers dispatched-agent exemption applies. Explicit no-subdelegation governs over skill fan-out defaults. No subagents, live calls, mutations, implementation edits or commits were performed.

This is a bounded branch implementation review, not a new repository-wide baseline/security audit. Full quality-playbook regeneration, broad DB/RLS/security scanner campaigns, UI, performance optimization, dependency, deployment and implementation workflows are not triggered. Schema inspection is read-only and limited to existing nullability/upsert contracts. Prior source interpretation is independently accepted and its immutable artifacts were rehashed instead of repeating the entire source audit.

All144 changed paths are inventoried in reviewer `verification-final.json`. The branch package is accounted for as:

| Group | Review performed |
| --- | --- |
| Eight runtime files | Every changed line and relevant surrounding control flow read: actions.part-3, decisionEngine, prodatPermissionAckFields, canonicalPolicyFieldValidator, ruleProfileSelector, aperakErrorRuleRegistry, prodatPermissionAckRegistry, prodatPermissionEngine. |
| Six test/fixture files | All new permission tests and fixture read; exact old energy assertions/parser fixture compared to accepted main and root rulings. |
| Source audit, evidence and probe archives | Approved source findings/architecture read;22 original artifact hashes reverified; existing interpretations not reopened without a runtime contradiction. |
| Runtime audit, evidence, logs and captures |90 receipt hashes and14 runtime/test hashes reverified; JSON receipts parsed, failed runs preserved and totals checked; actual-consumer capture harnesses and key outcomes checked against durable tests/code. Large serialized captures were inspected structurally and by relevant scenarios, not claimed line-by-line manual reading of every repeated JSON field. |
| Memory/plan/prior review additions | Complete branch diff inspected for authorization, superseded instructions, remaining blockers and acceptance claims. Later root publication/memory progress is outside the exact candidate. |

The protected-path diff is empty for scripts, workflows, Supabase schema/types, package/dependency files, config and quality discovery. Shared tokenizer/codec/grouping/register validator, frozen source and inbound workflow remain unchanged. Archived probe/config sources use non-executable `.txt` suffixes.

## Consumer and trust-boundary conclusions

| Boundary | Evidence and conclusion |
| --- | --- |
| Own message/function/subtype | New owner uses selected message tokens, unique BGM before LIN, actual UNA and physical groups. Own223 supplies Z14 combination; cached/scenario data cannot select322/324 authority. Subsequent-UNH, header, duplicate pair and own-reference controls are present and read. |
| National values | Literal322/324 lists agree with approved P21/73/75/119/123; Z15C and E37/Z18 are accepted. Required primary absence maps41, invalid submitted scalar/qualified combination42; unused metadata/inapplicable fields and union-valid unknown subtype remain preserved. |
| Ambiguity and text | Existing typed projection/composer remains unchanged. Internal placement/text holds preserve ready F. Fresh manual mixed322 F + ambiguous324 test stops before prior lookup/event and retains322. The partial-policy exception is R-PACK-1. |
| Canonical persistence/renderer | Fresh existing actual inbound suite14/14PASS: JSON-persisted report reload, selected errors, real APERAK rendering into mocked kernel, three alphabets, Z14N/Z15C/E37 positive controls and mixed text hold. Internal review stops business invocation; ready nationalF behavior remains the approved residual. |
| Manual/helper/direct | Precheck precedes TGT/prior/event. Legacy prior lookup is unchanged. Direct preserves ready field errors and internal-review disposition; fresh unknown-union control adds no322 and E37/Z18 adds no324 while retaining the generic agreement error. No unrelated209/261 filter was introduced. |
| Registry and system selector | Source-owned issues precede scenario shortcuts and all DB writes. Typed ERC/text bypass mutable rules; legacy selected-field mappings alone are removed. Actual system selector consumes registry errors before positive fallback and does not catch readiness into success. Existing actual-consumer tests cover scenario/positive/DB override/unavailable history. |
| Physical persistence | Read both actual unique indexes and nullable error_rule_id definitions/generated types. Fresh unique-index simulation executes real upsert code: four errors on two equal-reference LINs produce four distinct issue rows plus four detail rows; replay retains the same eight keys and returned typed errors. No sourceOrder-only inference. |
| Narrow derivative258 guard | Exact incoming ownZ14/Z15/Z18, all-C829-omitted, typed258missing and physical structured cause checked in code. Fresh explicit-empty C829 control preserves register hold, two ready324 errors in exception evidence and zero writes. Existing nonpermission/outbound314/209/readings/ambiguous-BGM/populated-scenario controls remain. Shared/canonical258 is untouched. |
| Tenant/business authority | No tenant filter/auth/role/grant/schema boundary changed. Existing P-ACK-R1 unscoped prior query remains HIGH/open and blocks production-linkage claims. Caller authentication does not cure that residual. |

The attack-surface review found no new SQL/command/template injection, rendering/XSS sink, authentication/CSRF/session/crypto operation, external service or dependency change in this delta. Database payload additions are structured existing upserts. No concurrency or tenant-safety claim is extrapolated from mocked persistence. Resource use and broad service behavior were not benchmarked beyond the existing/fresh performance contract gate.

## Fresh verification and receipt truth

Scratch: `/workspace/scratch/2a201d6d5897/permission-runtime-review-20260920/`. Commands executed from the repository root.

| Check | Exact fresh result |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run --config /workspace/scratch/2a201d6d5897/permission-runtime-review-20260920/vitest-v4.config.mjs --reporter=json --outputFile=/workspace/scratch/2a201d6d5897/permission-runtime-review-20260920/result-v4.json` |7 tests:5PASS/2FAIL; both failures establish R-PACK-1. |
| `node node_modules/vitest/vitest.mjs run __tests__/ediel-prodat-permission-ack-inbound.test.ts --reporter=json --outputFile=/workspace/scratch/2a201d6d5897/permission-runtime-review-20260920/inbound-result.json` |14/14PASS. |
| `npm run quality:performance` |exit0; all constituent contracts complete, including final SLO success line. |
| SHA256 verification |14/14 runtime/test inputs,2/2 reports,90/90 runtime receipts,22/22 immutable source artifacts match. |
| Candidate/runtime comparison |f65007f8→f30bcf63 app/lib/__tests__ delta empty. |
| Protected-path comparison |1892cf48→f30bcf63 protected-path delta empty. |
| JSON/package validation |39 changed JSON files parse;144 paths inventoried;14 `.txt` archives accounted for. |
| `git diff --check 1892cf48..f30bcf63 -- lib app __tests__` |exit0. |
| Whole-branch whitespace |exit2 with20 blank-at-EOF observations:17 preserved source/runtime logs and3 root memory files. No whole-branch whitespace-clean claim; do not rewrite original receipt logs. |

Author results were verified from their stored JSON, not relabeled as fresh reviewer executions: original RED56=15PASS/41FAIL; corrected isolated baseline67=16PASS/51FAIL; initial full4688=4679PASS/9FAIL; final full4689/4689 in306 files; final affected160/160; packaged quality45/45 in2 files. The final full receipt covers the unchanged final runtime and parser amendment. Node here is24.19.0; root owns exact published Node22 CI and merge/main gates.

Reviewer v1 partial-policy probe lacked required policy subtype and threw `prodat_subtype_unknown:missing`; that was a reviewer fixture error, not a runtime finding. V2 supplies explicit subtypeV; V3 adds opposite-direction/preservation controls; V4 adds accepted-main function comparison. All original probe sources/results/logs/observations remain separate and unchanged. `receipt-hashes.json` hashes fresh artifacts. The first hash inspection command also ended with a reviewer Python list/dict display error after completing hash/test checks; the complete final verification record supersedes that display-only failure.

## Required next action and limits

One consolidated correction wave should address R-PACK-1 and append the N1 provenance clarification. Reuse the unchanged reviewer oracles, verify affected consumers, obtain the final candidate's required local/Node22 gates and return for scoped independent rereview. Do not change old assertions, source authority, shared diagnostic/text schemas, registry258 scope or the preserved ambiguous selected-field stops to make the cases pass.

Manual/system probes use unchanged AST-extracted action bodies with supplied collaborators; registry/direct/canonical/projection/renderer modules are real. Persistence and side-effect boundaries are synthetic mocks; no live DB/provider/market/kernel insertion was tested. The source owner is otherwise coherent with the approved bounded proposal. Generic209/261, registry40/105, canonical equal-reference258, populated-scenario comparator holds and ready-nationalF business invocation remain explicit residuals. No new broad workflow acceptance is implied.
