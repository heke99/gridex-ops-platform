# Scoped APERAK A905 runtime re-review — R1

Date: 2026-09-20. Reviewed candidate `591131280604a569d26a88fca5dc29792c082c8f`, tree `12fec60f8e166af5b6e0ff7ac5850d35f8c3b016`. Previous completed review: `9aad6a4f9a384153d34bfff2f6d558aebe5068d4`. Accepted runtime base remains `b4f00ae37937502f2678738bf076c0ba8de9696b`.

## Verdicts

| Item | Verdict | Basis |
| --- | --- | --- |
| R-A905-1 | **ADDRESSED** | Complete register213/214 controls now retain rejected extra-element content through canonical decision and final draft;310 retains adjacent candidates in order. Original14 independent probes pass without assertion changes. |
| TASK/SPEC | **APPROVE** | Bounded evidence transport correction meets the approved exact-content contract without national predicate, requiredness, applicability, source table or old-assertion changes. |
| QUALITY | **APPROVE** | Independent14/14 PASS; new28-case suite and covering/full/gate receipts verified. No new blocking defect found in the fix delta. |
| WHOLE-BRANCH | **APPROVE** | Prior completed review plus this scoped correction closes its sole blocking finding. One nonblocking report/hash-snapshot clarification is recorded below. |

This is a completed code-review verdict, not authorization to skip root's exact-candidate Node22 CI, guarded merge or actual-main verification. No live acceptance or historical acceptance-count increase is implied.

## Scope and method

Read R1 instructions, original R-A905-1 report, appended Task2 fix-round report and both complete fix diffs. Applied the same code-review, differential-review and verification-before-completion routing as the original review. No new whole-repository audit, delegation, live calls, GitHub messages or implementation edits. Only fresh independent scratch receipts and this requested report were written.

The source/test delta is exactly two modified production files (`prodatRegisterFields.ts`, `prodatOwnedFailure.ts`) and one new28-case test (`ediel-prodat-aperak-text-structural.test.ts`). No existing assertions changed in R1. Original C1/C2 boundaries, codec exception, typed composer/readiness/persistence, source matrix and producer authority remain as previously reviewed. Other changed branch files are root memory and fix reports/receipts.

Diff SHA256:

- Complete `review-9aad6a4f..59113128.diff`: `cad94498c9c0eebbcf9e7b8916ecbf4ae440c32b2bbdfb77b69f232c1a8e0cfb`.
- `runtime-r1-source-test.diff`: `35d2ce9e68147b8e9690fb919089dfba881b25a92ffae3f7b3bb97017073311a`.

## R-A905-1 correction and regression challenge

The register reader now gathers every decoded submitted element for213/214 and requires a single data element before selecting a scalar fault. Existing258 evidence gathers C829 plus already-rejected later LIN elements. The `present`, `value`, `malformed` and classification predicates are unchanged. Component slots, including empty ones, and candidate order survive into the existing evidence type. This fixes the mismatch between the structural predicate and its former incomplete content projection.

Default non-register CAV transport now collects the contiguous own CAV candidates after each matching CCI. It includes structural CCI content when applicable, stops at the next non-CAV token, and chooses a scalar only for one unambiguous candidate with no conflicting structural/other populated content. No new field error or ownership scope is introduced. Explicit specialized owner evidence remains authoritative at the existing diagnostic entry point.

Independent observations from copied original probes:

| Case | Corrected outcome |
| --- | --- |
| Complete Z10 with valid QTY213, three alphabets | Accepted, continue, actual positive100/OK. |
| Same message with `QTY+31:100:KWH+BAD` | Rejected, continue, decoded final text `Felaktigt Uppskattad årsenergi 31:100:KWH:BAD`. |
| Complete Z10 with valid214 constant, three alphabets | Accepted, continue, actual positive100/OK. |
| Same message with `CAV+:::1+BAD` | Rejected, continue, decoded final text `Felaktigt Konstant för mätare :::1:BAD`. |
| Selected310 owner, `CAV+Z41` without extra candidate | No national error. |
| Selected310 owner, `CAV+Z41` then `CAV+BAD` | One42/310, exact `Felaktigt Kundstatus Z41 / BAD`, successful actual draft. |

Result: **14/14 independent PASS**. The two original test sources and setup config were copied into a new reviewer directory; byte comparison after reversing only the absolute output-directory replacement proves the normative assertions unchanged. The original failed receipts remain intact. The310 proof remains intentionally owner/projection/draft scoped; it does not claim complete canonical Z06 acceptance.

Reviewed all28 new regression cases. They cover the complete three-alphabet controls and failures,310 adjacency controls under three alphabets, decoded empty slots for213/214/258, already-rejected310 CCI/CAV structural variants, complete canonical capacity overflow, and ordered conflicting register candidates including their extra elements. The full/covering receipts include all28, not merely the earlier24-test RED checkpoint. Short scalar behavior is preserved by the single-element branch; full structural content can now correctly exceed capacity, retaining F and invoking existing rejected/manual_review recovery rather than relying on incomplete short content.

No new unjustified hold, dropped classified F, altered false/U applicability, positive fallback, field identity change or source-scope expansion was found in the correction. The same-root258 addition follows an existing explicit extra-element predicate and is within the authorized transport fix. Existing producer, schema, database, role, GAS and PR310 boundaries remain unchanged.

## Verification and provenance

Independent scratch root: `/workspace/scratch/2a201d6d5897/aperak-text-runtime-r1-review-20260920`.

Executed from repository root:

```sh
node node_modules/vitest/vitest.mjs run --config /workspace/scratch/2a201d6d5897/aperak-text-runtime-r1-review-20260920/vitest-with-setup.config.mjs --reporter=json --outputFile=/workspace/scratch/2a201d6d5897/aperak-text-runtime-r1-review-20260920/reviewer-replay.json
```

Stdout/stderr went to the new `reviewer-replay.log`; exit0,14 total/14 passed/0 failed. `copy-verification.json` records original/copy hashes and confirms output-path-only changes. `verification.json` records independent source/receipt/count checks, diff identities, source/test equality and reduced actual outcomes. `review-receipt-hashes.json` hashes all new reviewer artifacts.

| Check | Result |
| --- | --- |
| Fix source hashes |3/3 match candidate. |
| Fix receipt hashes |38/38 match. |
| Seven fix test records | All reported passed/failed/file counts and SHA256 match the underlying JSON. |
| Final full suite receipt |4567/4567 in303 files, zero failed/pending, success true. Verified author receipt; not rerun by reviewer. |
| Final covering receipt |731/731 in32 files; verified author receipt. |
| Author original-probe replay receipt |14/14 in2 files; separately corroborated by fresh independent14/14 run. |
| Final required gates |13 entries, all recorded exit0; final-gates and fix-evidence agree.818 strip-only regressions remain; source integrity33/121/231 and tenant ratchet2401 against unchanged2402 remain. |
| Full-tested runtime vs exact reviewed candidate | `git diff 90154eec 59113128 -- lib __tests__` empty. |
| Current source/test vs candidate | `git diff 59113128 -- lib __tests__` empty at close. Root memory changes are excluded. |
| Source/test whitespace | `git diff --check 9aad6a4f 59113128 -- lib __tests__` exit0. |

Fix evidence SHA256 is exactly the reported `497f988eaa63794a1ad19e8e700df2a4518e5a69222ed4873bb5e5f0c5e50146`. The RED checkpoint history is honest: the first258 assertion assumed only one issue, and the first added outbound310 fixture used invalid E03; corrected qualified RED remains9PASS/15FAIL. Later green/full receipts show the completed28-case test. No red receipt was rewritten.

### R1-N1 — Low, nonblocking: immutable count predates the authorized report append

The final-tree assertion “116/116 unchanged” needs a snapshot qualification. Fresh verification finds **115/116 whole-file hashes match**. The one mismatch is the tracked prior `aperak-text-runtime-20260920/runtime-task-report.md`, to which the authorized fix-round appendix was subsequently added. This is not lost or rewritten original evidence: the entire original13,946 bytes remain an exact prefix of the current25,031-byte file.

- Recorded historical report SHA256 and actual report at9aad6a4f both equal `449899276903ebb7dfabe15816d3efa359869bb374c9ccd3fa6f69344b0365e0`.
- Current appended report SHA256 is `ce769b6ecec8a9dcd3dde0e56eedd795842fe4fb21941b8cfcfffefb163a04b6`.
- `report-prefix-verification.json` proves exact prefix preservation. All original reviewer probes/results, source artifacts and other listed historical receipts match their hashes.

Describe116/116 as the pre-append snapshot, with final115 unchanged files plus an exact preserved report prefix; do not rewrite the historical receipt. This report records the clarification and it does not block the runtime fix approval.

Raw log EOF observations remain openly disclosed. The full-branch diffcheck receipt records12 raw-log blank EOF observations (eight old and four new); the working-tree empty diffcheck receipt is not represented as a clean entire branch. No original raw logs were reformatted.

The first reviewer provenance script looked for unsuffixed test-record keys as filenames and failed before writing its verification output. The manifest uses keys such as `red-structural` with `.json` files; the corrected schema-aware comparison above succeeds. This was a reviewer lookup mistake, not candidate evidence loss.

## Limits and next action

This scoped review combines the previous completed whole-branch assessment with closure of R-A905-1; it does not reopen unrelated historical areas. No optional full-suite rerun. Local runtime is Node24.19.0; root owns exact Node22.23.2 CI and later release/main verification. Synthetic consumers do not certify live sends, database operations, arbitrary UNA combinations, legacy mapping closure or full-masterplan acceptance. Historical98/110 numeric and10/10 parent counts remain unchanged.

No blocking finding remains from the original completed review or the R1 fix delta. Root may proceed with the already-required exact-candidate CI and guarded release sequence, carrying R1-N1's snapshot clarification in provenance reporting.
