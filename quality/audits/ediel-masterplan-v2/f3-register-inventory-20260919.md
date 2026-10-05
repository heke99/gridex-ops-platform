# Field 258 independent register inventory — 2026-09-19

Implementation and verification evidence against start HEAD
`edac1710dcc8cb33fcd5d65ed4c448761ca42f24` on
`codex/ediel-remaining-dependencies-20260919`.

Scope is limited to PC-258-Z04, PC-258-Z06 and PC-258-Z10. PR310 remains
paused at `e961135199f292b8210884f07de3b616a670161a`; no content from it was
imported. No database, storage, live send, deployment, settings, remote,
normative-source or active-memory change was made. This audit records a bounded
implementation and local verification. It is not an acceptance, conformance,
production-readiness, publication or merge claim.

## Source and authority

Read the retained P26.A revision 3 source and existing source map. Field-note
page 16 requires field 258 for a physical meter with multiple registers and
forbids it for a singleton. Segment-table page 47 defines `C829/5495=1` and
`1082 n..6`; ordinary line number 314 is distinct. Pages 114–116 retain the
first/later-register rules. The frozen source package and earlier
`f3-register-source-map.md` remain normative evidence. The dependency analysis
in `f3-remaining-dependencies-20260919.md/json/py` is derived analysis and was
not used as runtime authority.

No prior assertion contradicted the retained source. Existing structural,
inbound and TGT missing-tail assertions were preserved. The implementation does
not modify the frozen ledger or claim another D cell.

The applicable local skill routing was reviewed before work: codebase knowledge
and quality-playbook for callsite and gate discovery; spec-to-code compliance and
false-positive checking for the source/runtime distinction; systematic debugging
and test-driven development for RED/GREEN; verification-before-completion for
the final evidence. Database, UI, architecture, deployment, security-audit and
skill-authoring triggers were outside this bounded task.

## Reproduced defect

An actual-module RED suite was added before runtime edits. On the unchanged
runtime it ran 19 cases: 3 passed and 16 failed. The enforcement failures
established that:

- absent or null inventory was accepted using an observed singleton;
- root `multipleMeterRegisters` and `byCell` could decide direct field-258 status;
- generic and profile builders derived topology from their rendered register
  arrays; and
- missing-count body-bound evidence did not block all preflight/guard paths.

Two other RED expectations were diagnostic-completeness findings rather than
newly accepted unsafe sends. An expected count greater than one with an omitted
trailing register was already blocked by `PRODAT_REGISTER_COUNT_MISMATCH`, but
did not also express the precise missing field-258 requirement for the expected
index. A wire object absent from supplied inventory could already be accompanied
by an expected-object-missing blocker, but lacked the matching unexpected-wire-
object issue. The implementation adds those exact semantics without treating a
different issue name as a separate safety defect.

The unchanged implementation already rejected malformed, repeated and skipped
C829 structures, accepted valid singleton/multiple/mixed topology, and isolated
parse-only inbound validation. Those pass cases were preserved rather than
reported as defects.

## Implementation

`prodatDependentConditionEngine.ts` now resolves field 258 only from a complete
independent `registerObjects` inventory. Every entry must have an exact object
ID, identity agency 9 or 89, a unique object/agency key and an integer
`expectedRegisterCount` from 1 through 999999. Missing, null, partial, duplicate
or invalid inventory is undetermined. A count above one is required; one is
forbidden. Root topology booleans and `byCell` cannot decide this field.

`prodatRegisterPolicy.ts` keeps wire structure separate from business inventory.
For outbound Z04/Z06/Z10 it checks exact object and agency matching, expected
objects absent from the wire, wire objects absent from evidence, duplicate or
ambiguous evidence, invalid/missing counts and observed-versus-expected count.
The per-register resolver receives the independent expected count, so omitted
later indexes are required through the existing field rule. Inbound parse-only
validation still runs structural checks without demanding local physical
inventory. Other message codes retain their previous register behavior.

`canonicalPolicyFieldValidator.ts` requests the independent-inventory check for
outbound policies. `engine.ts` and `profileRenderer.ts` no longer manufacture
`multipleMeterRegisters` from the rendered register array, so missing inventory
remains unknown at both builder boundaries.

The concrete persisted-row provenance path is:

`preflightEdielMessageRow` → `preflightEdielPayload(parsedPayload)` →
`validateEdifactPayload` → `validateRulebookMessage(parsedPayload)` →
`readProdatRegisterEvidence(actual body)`.

Only the existing body-bound register evidence can supply facts. Bare public
`preflightEdielPayload(..., mode: 'send')` without that metadata still reports
unknown inventory and blocks. The existing evidence reader continues to reject
stale body binding; this change adds no raw-fact or hash authority.

The first broader register run had 6 failures out of 513 tests: three generic
builder fixtures lacked explicit counts, Z03 was incorrectly subjected to the
new check, and two persisted-row TGT paths lacked metadata at public preflight.
During repair, a general structural-only business-fact bypass was proposed.
Root static review identified that its early return also skipped unrelated
dependent-field validation. That bypass was removed completely before the
continued GREEN work. The final change scopes 258 to Z04/Z06/Z10 and transports
body-bound metadata through the real row preflight call instead. The existing
protected Z04:319 suite supplies an actual unrelated D-field regression: its
original assertions continue to pass.

## Fixture inventory additions

The full and broader runs identified fixtures that described complete explicit
business facts or actual outbound persisted rows but omitted the newly required
independent register inventory. Their original assertions were retained. The
following synthetic inventories were added explicitly; none is derived in
production code from observed LIN rows.

| Fixture | Explicit inventory and reason |
| --- | --- |
| `ediel-canonical-policy-batch-regression.test.ts` | The existing “complete explicit facts” catalog case now declares synthetic `CATALOG-OBJECT/89` count 2 in both matching fact constructions. |
| `ediel-prodat-register-builders.test.ts` | Shared two-register object declares count 2; the multi-object case declares A count 1 and B count 2; the singleton case declares count 1. These are the test's intended source topology. |
| `ediel-prodat-dependent-subtype-z04-reference.test.ts` | Actual Z04 object A/89 declares count 1, except the existing later-register case declares count 2. This lets the protected 319 assertions continue to test their stated boundary. |
| `ediel-prodat-dependent-subtype-ud-boundaries.test.ts` | Persisted row A/89 and generic object A/9 declare count 1; the existing multi-object A/B case declares one each. |
| `ediel-prodat-dependent-z06-product.test.ts` | Actual outbound row A/89 declares count 1 in its body-bound evidence. |
| `ediel-prodat-dependent-subtype-message-scope.test.ts` | Actual row A/89 declares count 1 in body-bound evidence; the released-separator identity case explicitly uses its intended exact object ID. |
| `ediel-prodat-dependent-subtype-review.test.ts` | Actual Z06/Z09 helper declares the existing object A/89 as singleton in body-bound evidence. Z09 is not newly subjected to the 258 business rule. |

The authorized TGT source-backed omitted-tail test remains unchanged: its
independent `sourceTestData` still produces the expected
`PRODAT_REGISTER_COUNT_MISMATCH` without requiring an added `registerFacts`
fixture. This preserves the distinction between an independent workbook source
and observed rendered wire.

## Tests and intermediate regressions

The new focused suite covers all three codes and all three supported UNA
alphabets for missing inventory; direct root/byCell bypass attempts; explicit
single, multiple and mixed objects; omitted trailing register; missing/null
counts; wrong agency; swapped counts; missing/extra objects; duplicates;
malformed, repeated and skipped C829; inbound isolation; generic/profile
builders; bare public send preflight; body-bound row preflight; and both protected
guards.

Development verification, in order where it explains a correction:

- initial actual-module RED: 19 tests, 3 passed / 16 failed;
- first focused GREEN after central implementation: 109/109 passed;
- first broader register run: 513 tests, 507 passed / 6 failed, exposing missing
  explicit fixture inventories, incorrect Z03 scope and missing persisted-row
  preflight metadata; the subsequently proposed broad bypass was rejected by
  static review before continued GREEN verification;
- corrected broader register run: 513/513 passed;
- broader dependent/source-bound run initially exposed two remaining fixture
  families, 269 passed / 128 failed; after explicit body-bound inventories,
  397/397 passed;
- first full application run exposed the same final two fixture helpers:
  250 files, 3422 passed / 9 failed; after correcting their explicit evidence,
  the final full run passed 250 files and 3431/3431 tests;
- post-final-fixture focused run passed 3 files and 137/137 tests, including the
  new inventory suite, builder regressions and protected Z04:319 assertions.

No prior expectation was changed to obtain GREEN. Failures were resolved only by
correcting runtime boundaries or adding explicit synthetic inventory to fixtures
whose existing purpose already asserted complete business facts.

## Final local verification

Executed on the final implementation and test tree before commit:

- `npm run typecheck`: pass;
- `npm run typecheck:scripts`: pass;
- `npm run typecheck:tests`: pass;
- `npm run ediel:masterplan-v2:integrity`: pass — 33 originals, 121 rules,
  231 contracts, with application conformance and production readiness false;
- `npm run quality:large-file-budget`: pass;
- `npm run quality:performance`: pass — API tenant gates, N+1 budget and SLO
  contract;
- `npx vitest run __tests__/ediel-prodat-register-inventory.test.ts
  __tests__/ediel-prodat-register-builders.test.ts
  __tests__/ediel-prodat-dependent-subtype-z04-reference.test.ts`: 137/137 pass;
- `npm test`: final full application result 250 files, 3431/3431 pass;
- `git diff --check`: pass before staging; repeated against the commit below.

## Boundaries still unresolved

This unit provides no new live-production grid-owner inventory producer. The TGT
producer remains source/run-bound test evidence for manual and autopilot draft
paths. Generic/profile builders require their caller to supply independent facts
and deliberately preserve unknown when it does not. No other numeric D cell,
parent occurrence, GAS path, role/capability expansion or market activation is
included. Root review, exact-head CI, publication, merge and any later acceptance
accounting remain pending.

## Round 1 review remediation — rendered diagnostic scope

Independent task and whole-branch review found one Important diagnostic-scope
defect at reviewed head `e248b596f6a3eef820ba8e9629048d4952ec99f9`.
Canonical register enforcement already blocked object/agency inventory gaps,
but the profile renderer copied the pre-wire aggregate field-258 status into its
rendered diagnostics. For example, rendered B/89 with two registers and facts
only for A/89 count 1 exported `not_required` while register policy reported the
expected/missing object errors. This was a diagnostic/spec defect, not a newly
demonstrated unsafe-send bypass.

The pre-wire aggregate now carries
`decisionPhase: pre_wire_inventory_aggregate`. After the renderer has actual
wire scope, it uses the canonical register-policy issue result to reconcile
field 258. `PRODAT_REGISTER_EVIDENCE_UNDETERMINED`,
`PRODAT_REGISTER_EXPECTED_OBJECT_MISSING` or
`PRODAT_REGISTER_UNEXPECTED_OBJECT` makes the rendered status `undetermined`
and tags `decisionPhase: rendered_wire_inventory`. The issue-to-scope helper
lives beside `validateProdatRegisterPolicy`; it interprets that validator's
result and adds no independent count, object or business-rule authority.

Complete exact singleton and multiple inventories retain `not_required` and
`required`. A complete pre-wire mixed A=1/B=2 inventory retains its scoped
aggregate meaning of `required`. Observed wire count is never promoted into an
expected count. Duplicate evidence remains rejected by the evidence envelope;
its direct pre-wire diagnostic is explicitly undetermined.

### Round 1 RED/GREEN evidence

- First focused RED on unchanged runtime:
  `npx vitest run __tests__/ediel-prodat-register-inventory.test.ts` ran
  21 tests, 17 passed / 4 failed. The first version established the missing
  phase qualification but short-circuited before independently proving every
  semantic mismatch.
- The suite was split into independent status cases and rerun against the
  original runtime before the fix: 27 tests, 16 passed / 11 failed. It directly
  reproduced the wrong rendered results for a different object (`not_required`),
  wrong agency (`not_required`) and an extra mixed object (`required`) where
  exact rendered scope had to remain `undetermined`. Separate cases covered
  missing entry, null count, duplicate evidence, complete singleton/multiple
  controls and complete mixed aggregate scope.
- Focused GREEN after the fix: the same inventory test passed 27/27.
- Consumer verification:
  `npx vitest run __tests__/ediel-prodat-register-inventory.test.ts
  __tests__/ediel-prodat-register-builders.test.ts
  __tests__/ediel-prodat-register-preflight.test.ts
  __tests__/ediel-prodat-register-snapshot-facts.test.ts
  __tests__/ediel-prodat-optional-installation.test.ts
  __tests__/ediel-prodat-dependent-subtype-ud-boundaries.test.ts` passed
  6 files and 246/246 tests.
- `npm run typecheck`: pass.
- `npm run typecheck:tests`: pass.
- `git diff --check`: pass after the audit/report update and again against the
  remediation commit.

The full application suite and unchanged broad gates were not repeated for this
focused diagnostic correction. The preceding candidate evidence remains recorded
above; updated exact-head CI owns the new full run. No normative, memory,
database, live-action, remote, role, market or acceptance-accounting change is
part of this remediation.
