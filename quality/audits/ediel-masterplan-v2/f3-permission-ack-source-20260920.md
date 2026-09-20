# F3 legacy permission ACK source qualification — 2026-09-20

Source/evidence only. Runtime baseline is merged PR352,
`1892cf48e77d2c6cea99fdbb5d7507d51919956a`; task start `343a5506`.
No production code, existing test, frozen source, schema, codec, gate, loader,
workflow or count was changed. **98/110 numeric and 10/10 parents remain unchanged;
PR310 is paused/excluded; F3 and the full masterplan remain incomplete.**

The smallest coherent next unit is a **shared, incoming, source-bound owner for
322/324 and its ACK projections**, not a one-line 41→42 substitution. Four actual
paths disagree on these fields. A correct field result must reach the selected
response before permission events, legacy registry writes or ACK construction.
This proposal requires independent source/spec and architecture approval and
root authorization. It does not authorize full permission business processing.

Root independently reports PR352 main full35506222436/job106066385260
SUCCESS73/73,0failed at2026-09-20T11:00:05Z, Node22.23.2; main OPS35506222425
replay106066385034/verify106066385124/quality106066385127 allSUCCESS, main quality
4567/4567 in303files plus45/45 quality tests. These are root receipts, not fresh
execution by this author. Their acceptance does not approve this proposal.

## Method and immutable evidence

Read the task brief first, AGENTS, current task/checkpoint/memory, active plan,
canonical architecture/flows/domain/integrations and decisions/known failures.
Applied source-to-code tracing, systematic root-cause investigation, code review,
false-positive challenge and verification-before-completion; PDF skill read-only.
Local using-superpowers exempts dispatched agents. Explicit no-subdelegation
supersedes the source-compliance skill's default fan-out; root owns independent
review. This bounded source audit does not activate full-repository security,
DB/RLS, performance, UI, deployment or implementation/TDD workflows. Architecture
judgment uses the assigned most-capable author; no subagents were created.

Original complete 140-page PDF:
`/workspace/scratch/2a201d6d5897/prodat-original-source/PRODAT-26A-r3.pdf`, SHA256
`83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95`.
Fresh extraction was from that full original, not a generated rule sheet. Relevant
full sections and notes were read: pp13–17,20–23,73–75,85–95,103–105,114–116,
119,122–123,137–140; diagrams pp33–35 and rendered pp21,73,75,123 were inspected.
The tracked relevant-page extraction is a reproducible aid, not replacement
normative authority. Frozen masterplan §7.3/§18/§19 and AT-P-01, AT-P-02,
AT-ACK-01/02 were read. AT-ACK-04 is UTILTS-specific and is not PRODAT authority.
Prior closure and APERAK-text audits supply historical context only.

All execution used synthetic inputs and DB/provider/side-effect mocks. The
manual and system-test exported function bodies were extracted unchanged using
TypeScript AST; imported permission/registry/direct/canonical/renderer code is
real. The real `createAckForSourceMessage` body built drafts and reached a mocked
`createCanonicalAckMessage` boundary. Separate imported
`processInboundEdielMessage` runs persisted/reloaded validation reports using DB
mocks and selected/rendered their actual response plans. Kernel DB insertion,
route availability and external sending are not claimed tested. Source-policy,
tenant, actor, facility and provider boundaries were explicitly mocked; no live
calls, credentials or production data were used.

Recoverable files are under `permission-ack-source-20260920/`; the companion
`.evidence.json` names/hashes every receipt and relevant input. Probe source and
config archives end in `.txt` and cannot become discovered tests. Reproduce by
copying these to a fresh scratch directory, restoring `.test.ts`/`.config.mjs`
suffixes and updating scratch output/fixture paths. Run from the repository with
`node node_modules/vitest/vitest.mjs run --config <scratch>/vitest.config.mjs` and
the selected file. The saved outputs, including failures, are immutable originals.

| Fresh execution | Result and meaning |
| --- | --- |
| First observation probe | 4/4 harness PASS, 82 observations; two registry rows have a test-fixture `group.columns` TypeError, retained and excluded from registry findings. |
| Qualified observation v2 | 5/5 harness PASS,105 observations through manual/draft, direct, canonical and registry. Corrected synthetic testData includes block/columns. Harness PASS is observation capture, not conformance. |
| Independent literal source oracles | 20 tests:7 PASS /13 RED. Fifteen manual/draft cases, exact P94 text case, four canonical controls/rejections. All20 expectations are independent literals; no expected value comes from a runtime code list. |
| Actual inbound processing | 14/14 harness PASS:13 persisted report/response records plus archive check. |
| Actual system selector and prior lookup | v1 12/12; v2 13/13, adding six finite boundary observations. v1 preserved. |
| Frozen source integrity | `node scripts/check-ediel-masterplan-v2.cjs`:33 original files,121 rules,231 contracts; application/production conformance explicitly not asserted. |

Self-review verified32/32 tracked input hashes and22/22 artifact hashes. Existing
production/tests/frozen inputs are unchanged from task start. Staged diff-check
reports exactly six new blank-at-EOF observations in immutable raw Vitest logs;
those original bytes were retained. Audit/JSON/probe text has no whitespace
finding; no whole-evidence whitespace-clean claim is made.

Fixture and interpretation disclosures: v1 missing testData columns was a probe
error, not a runtime defect. v2 `component-*` exploratory expectations of42 for
metadata-only or unused metadata are **not qualified normative expectations**;
the scalar-missing41/ignore-X contract below governs. v1/v2 `subsequent-unh-donor`
reused UNH/BGM IDs and is only adversarial evidence; boundary-v2 `distinct-unh-0..2`
corrects them to M/M2 and D/D2 for three alphabets. The boundary row named
`invalid322-noLI-next-object-donor` actually still has missing322: its fixture's
`set()` only replaces an existing pair. It is missing322 scope evidence, not an
invalid322 proof. Original records and misleading original IDs were retained.
No failed fixture was silently overwritten or counted as a confirmed defect.

## Qualified source contract

| Question | Source | Result |
| --- | --- | --- |
| Field identity | P21,73,75 | 322 = Tillståndets status, SG14 CCI++Z23/CAV C889/7111 (component0); 324 = Orsak till tillståndets upphörande, CCI++Z25/CAV component0. Neither is field223's transaction reason nor a free-text CAV component. |
| Requiredness | P21,73,75 | 322 required in Z14 (including N) and Z15. 324 required in Z15 and Z18. They are unused in other functions; missing previous local flow does not make a wire field missing. |
| 322 code set | P73,123 | A74,A75,A76,A13. P73 narrows positiveZ14 to A74, Z14N to A76/A13, Z15 to A74/A75. Z96 is field223=N, never a valid322. Do not infer N from status alone. |
| 324 code set | P75,123 | B77,B78,B79,B80,E37. Z15C example P139 specifically uses A74/E37. No source restricts Z15 to A75 or B79/B80. |
| Applicability | P14,21,119,122 | Own BGM supplies function; own field223 supplies subtype (Z14 S17/S18/Z96; Z15 S17/S18/Z24; Z18 S17). Inapplicable national322/324 is ignored inbound and raw is retained. True syntax excess remains syntax authority. |
| Missing/invalid | P85,91,103 | Absent required scalar7111 →41; supplied wrong scalar/code combination →42. Null/unavailable local context is not41/42 evidence. |
| Text | P21,93–94,104 | A904 exactly322/324. A905 uses exact Swedish field label and actual decoded wrong value; missing uses `<label> saknas`, with own227 fallback where own209/226 is absent. One text component, at most70 decoded characters. |
| References | P87,90,103,105 | Own object/LI, ACW to own BGM; errors of every erroneous object, correct objects remain approved. One APERAK cannot acknowledge multiple PRODAT messages. Never borrow another LIN, later UNH or cached DB reference. |
| Scope | P15,114–116 | First-register common fields; multi-register messages only Z04/Z06/Z10. Permission LINs are separate objects; duplicate IDs do not grant register inheritance. |

**Source interpretation requiring independent adjudication:** P35's Z18 diagram
lists B77–B80, while the exact shared CAV definition P75 and non-gray incoming
code list P123 include E37 without a Z18 exception. The proposal uses the explicit
numbered segment/control list (all five) for incoming324, consistent with frozen
masterplan §7.3. P15's explicit precedence applies to §2.2 versus appendix4 and must not be
misrepresented as a blanket diagrams rule. If review disagrees, qualify this one
cell separately before implementation; do not silently invent E37 rejection or
pretend the source difference is absent. No E37/Z18 normative test is claimed here.

C889/1131,3055 and both7110 are marked X for322/324 (P73/75). Applying P119's
unused-extra rule, a correct own7111 with supplied unused metadata remains a
preservation control. A value only in an unused component does not fill missing
7111. Do not copy field506's qualifier enforcement without independent source
qualification; accepted506 behavior is unchanged. No new national rejection of
unused metadata is proposed. Duplicate conflicting owning pairs, pair adjacency
and misplaced header evidence require explicit typed structure/occurrence handling,
not selecting the first usable value or borrowing a later CAV. These software
handling details below are design inferences, not new national codes.

## Actual consumer inventory

| Path | Actual selection and persistence boundary |
| --- | --- |
| Manual | `actions.part-3.ts:295–505 resolveBackendAperakDecision`: existing506 guard; TGT resolution; prior context; `validateProdatPermissionMessage`; handled result writes manual event and returns before registry. Callers at596,735,971 feed createAckDraftForMessage. First caller can fall back to submitted applicationErrors when backend returns null, so retain tests for explicit selected errors. |
| Permission helper | `testing/prodatPermissionEngine.ts:434–547`: firstPermissionLine only; normalizes case/punctuation; Z14 no missing check and invalid→41; Z15 A75/B79/B80 only; Z13/Z18 unconditional handled-positive. `resolveProdatPermissionAperakValidationIssues` has only test callers (rg across lib/app); its separate tenant-scoped candidate matching does not protect the manual path. |
| Direct | `decisionEngine.ts:222–258,316–405`: buildKnownPermissionErrors selects first characteristic across whole token stream; classification influences Z14 requiredness; narrowed Z15 sets; Z18 presence only; untyped text. Called by prodat/prodatAperak facade, productionInboundDecisionEngine and edielProcessingPipeline; pipeline feeds autoAckOrchestrator. |
| Classifier | `rulebook/ruleProfileSelector.ts:194–225`: Z14 uses global scalar tokens/status A75/Z96 as N, A13 as positive; Z15 validity uses A75 and B79/B80. These are independent conflicting interpretations, not national field authority. |
| Registry | `testing/aperakErrorRuleRegistry.ts:1084,1508`: generic no-testData branch does not inspect322/324; testData bypasses to scenario logic; 9.2.1 creates permission fault from testData value starting Z at967–980. Built-in322 rule is Z15-only/41;324 is wildcard/41. DB rules can override built-ins. Issue/detail writes occur before returning errors. |
| System-test selection | `system-tests/actions.part-2.ts:296,409–494`: real registry(null testData), then classifier, then `prodatPermissionLooksApplicationValid`; probes show invalid/missing selected fields still choose positive. Its callers create/send ACKs; provider not exercised. |
| Canonical persisted inbound | `canonicalPolicyFieldValidator` delegates base322/324 to generic fieldMatrix (presence/unused handling), no source code sets. `runtimeDecision` projects typed errors; `inboundProcessing` persists responsePlan/canonicalRuntime, reloads it for ACK selection, then real builder reaches mocked kernel. Invalid codes pass and produce ERC100; missing codes correctly produce typed41. |
| ACK construction | `orchestrator.createAckDraftForMessage` loads source, calls real createAckForSourceMessage→buildAckDraftForSource→buildAperakDraft and kernel. Kernel checks source rule snapshot/company/route, duplicate ACK and outbound policy, then createEdielMessage; it does not revalidate incoming322/324 semantics. Existing typed renderer/text readiness from PR350–352 remains the intended sink. |

## Findings and false-positive challenges

All selected findings are **confirmed, medium** protocol defects: wrong approval
or rejection of submitted permission data and/or misleading ACK content. They
are not claims of a live send or end-to-end permission authorization exploit.

**P-ACK-1 — wrong status/requiredness/code combinations.** Complete source-shaped
Z14V A74 control has no canonical errors and all relevant paths accept. Its single
scalar X99 replacement yields manual41/322 and a persisted-boundary draft41,
while direct/canonical/registry/system select positive. Removing322 yields
manual/system positive while canonical correctly emits41/322. Z96-as322 and
A13-in-positiveZ14 also pass the manual shortcut. Valid Z14N A76 is rejected by
manual41, although canonical persisted inbound accepts. Z15C A74/E37 and
Z15 B77/B78 are rejected by manual and direct narrowed sets; canonical accepts.
Source: P21/73/75/123/139. Fix the shared source interpretation, not expected
outcomes to match the shortcut.

**P-ACK-2 — 324 coverage gap.** Complete Z18 B79 control is canonical accepted.
Deleting324 or replacing only its scalar with X99 still yields manual/system
positive; canonical rejects missing but accepts X99 and persists ERC100. Z15
invalid324 maps42 in the manual/direct path, proving the error-class distinction
already exists elsewhere. The registry has no wire-driven selected-field check.

**P-ACK-3 — lost occurrence/value/text readiness.** Second independent Z15 object
with X99/324 produces manual positive, direct positive and canonical persisted
ERC100. Released wrong322 `X:+?'` becomes only `X` in manual A905 for each of three
alphabets; the renderer faithfully renders that already-lost value. Missing322
with no ownLI and own227=001 yields `Tillståndets status saknas` without required
customer fallback. Overlong324 emits a warning event first, then draft preflight
fails at84 characters; persistence count0. Thus existing codec/preflight is not
permission-decision readiness. Distinct later UNH supplies missing first-message324
in the direct whole-stream reader; manual first-message scope correctly retains41.
Do not blame codec or reopen PR352; permission errors are still untyped.

**P-ACK-4 — registry scenario authority and premature writes.** Corrected testData
9.2.1 with Z99/322 or Z99/324 against otherwise valid Z15 wire persists issue/detail
records and returns41/322 or41/324 for the selected value that was never submitted.
For Z14/Z18 a selected322 records an unmapped issue (Z15-only rule); selected324
uses the wildcard mapping, including false324-in-Z14. Real manual permission
handling returns before this path, so registry defects do not explain its41.
Independent exported registry consumers and system selector still need protection.
No broad registry/TGT/AGT rewrite is authorized by this finding.

**P-ACK-5 — incoming unused322/324 rejects.** Complete Z13 control plus only unused
322/324 X99 retains valid syntax but canonical creates two typed42s and persisted
negative APERAK. Equivalent selected false324-in-Z14/false322-in-Z18 observations
are recorded. Correct unused metadata is a different preservation case; absent
mandatory primary scalar still rejects. Source: P21/119 and AT-P-02.

False-positive/exclusion register:

- Z14N is a negative *business* decision, not an erroneous message; legitimate
  missing209/UD/506 is not grounds for322 rejection. Canonical positive control
  proves its legitimacy independently of the legacy shortcut.
- Z15 missing322/324 already maps41 in manual/direct; retain those expectations.
- Existing draft preflight correctly refuses overlong A905. The defect is the
  earlier unqualified event/text decision, not absence of any length check.
- Punctuation survives three input alphabets in decoded raw evidence. Manual
  normalization, rather than failed parsing/escaping, loses it.
- Unknown own subtype does not establish positive/N combination. Universal invalid
  scalar (outside all four322 codes) can still be42; valid union code under unknown
  subtype is U for the combination, not fabricated322 error or a new blanket hold.
  Existing223/506 behavior and manual unknown-subtype preservation are not waived.
- No prior-candidate query error is converted to national41/42: real lookup throws
  before permission event/draft. Preserve that internal-unavailable distinction.

## Explicit residuals and acceptance limits

Direct `prodatBusinessRules` wrongly requires209 for source-valid Z13/Z14N and261
for source-valid Z18 (P16/22; complete examples138/140). Registry generic object
identification also rejects Z13/Z14N absent209. These adjacent baseline faults are
recorded by complete controls; adding forbidden fields to make a test green would
be invalid. They remain outside this322/324 implementation proposal and prevent
claiming every direct/system permission workflow is source-correct after it.
Selected-field migration can be independently accepted without certifying those
whole workflows, provided acceptance reports explicitly retain those failing
baseline controls and separate selected322/324 errors from them. No full F3 closure.

**P-ACK-R1 — high, confirmed prior-flow authority/tenant defect; separate next
bounded task, not fixed or accepted by322/324.** Evidence:
`boundary-observations-v2.json` contextRows `candidate`, `empty`, `unavailable`,
`cached-nonpermission`, with exact query operations and event/draft outcomes;
source `actions.part-3.ts:214–293`. Severity reflects potential cross-company
influence on a permission decision; no live exposure or grant mutation was tested.

Real manual prior lookup uses cached message_code, first-line plus cached IDs,
substring search over up to50 candidates without company/party/direction filters.
Synthetic unrelated/other-company candidate text containing the first LI can
produce positive, empty query gives40/105, unavailable query throws, cached Z04
with wireZ14 skips the lookup and returns positive. This is **confirmed unsafe
prior-flow evidence**, not proof of valid permission or valid national40/105.
Its 40/105 mapping/text and process matching need a separate bounded authority/
tenancy task; this proposal neither legitimizes nor expands it. It blocks any
claim of safe production permission linkage. Do not use one message-wide boolean
as evidence that any specific second object was identified. Field validation must
be independent of that boolean. Preserve existing behavior outside selected fields
until root adjudicates that separate task.

The pipeline's business classification (including Z15C cancellation) is not a
permission state transition authorization. No grant/producer/actor activation or
business effect correction is proposed. Source-valid synthetic protocol controls
are not market certification, persisted grant authority or live eligibility.

## Finite implementation proposal (design inference; not authorization)

1. Add one pure incoming owner, e.g. `prodat/prodatPermissionAckFields.ts`, for
   exactly322/324. Input: rawSegments, actual UNA, optional fallback code only for
   explicitly headerless callers. For a complete wire use one selected PRODAT
   UNH and its unique ownBGM, existing prodatRegisterMessageSegments/groups and
   physical object indexes. No cached code, testData, selected case, prior-flow
   boolean or source field presence may establish function/subtype authority.
   All objects in that selected message are assessed; a subsequent UNH is never
   a donor. Existing ingestion/per-message scope remains responsible for the
   other message; do not create one ACK covering both.
2. Return object-scoped assessments plus ordinary EdielRulebookIssue entries with
   existing ProdatDiagnostic, numeric field, sourceRule P21/73/75/119/123, C889
   component0, physical location and explicit own present/absent/unavailable
   references. Required/missing →41; exact disallowed supplied scalar or qualified
   wrong Z14 combination →42. Unused fields produce no incoming national error.
   Missing/invalid code/ambiguous subtype does not manufacture a322 combination.
   Do not accept A-74 by normalization; keep decoded actual value. Adjacent CCI/CAV
   only; no later LIN/header/UNH borrowing. Conflicting pairs retain all own values
   in source order using existing failure evidence; if their national invalidity
   cannot be qualified, use internal/ambiguous disposition, not an invented42. Unsupported/ambiguous diagnostic
   identity is internal evidence, never national41/42; X components are ignored.
3. Reuse existing projectProdatDiagnostics/composeProdatAperakText unchanged. Both
   fields already have exact source names. Complete/ready typed F becomes exact
   applicationErrors; absent optional227 adds no blanket hold; missing own209/226
   adds known own227. Unready text/internal identity prevents permission success,
   permission-decision event qualification and registry writes until internal review. Keep
   national errors recorded locally and keep independently ready F; do not shorten
   values, erase F, synthesize customer IDs or add another FTX. No codec changes.
4. Wire the owner into canonicalPolicyFieldValidator, excluding only322/324 from
   its incoming generic required/forbidden/value path to avoid duplicate/inapplicable
   findings; retain outgoing matrix behavior. Existing runtimeDecision/persisted
   response machinery consumes typed issues unchanged. No source-matrix edit.
5. Replace only322/324 portions of validateProdatPermissionMessage with the shared
   assessment. Carry typed metadata through its issues/errors and assess every
   object. Preserve handled-family/direction contract, prior-flow behavior and
   existing506 guard. In resolveBackendAperakDecision, enforce selected-field
   readiness before the permission event or positive return; known F must not be
   lost to a selected-positive TGT label or fallback input.
   Evaluate field evidence before the prior lookup; a query exception retains its
   existing internal stop with no event/draft, not a guessed national outcome.
   Preserve the independently evaluated field evidence in diagnostic context.
6. Replace only buildKnownPermissionErrors'322/324 inference with the shared
   projection. Keep other generic business, portal/AGT and production-link behavior
   separate; do not filter unrelated errors by field text. Narrow classifier
   changes may remove its duplicate322/324 validity tables and use own223 for
   Z14V/VH/N; do not let it reintroduce narrowed sets or status-derived subtype.
   Z15C business activation/termination semantics are not authorized here.
7. In deriveProdatAperakValidationIssues/resolveAndStoreProdatAperakErrors, compute
   these fields before selected-positive/scenario shortcuts and before DB writes.
   Replace only permission_status/end_reason scenario faults with actual wire
   diagnostics. For these two fields use typed projection as national ERC/text
   authority, not configurable DB/built-in rules. Persist existing issue/detail
   columns consistently from exact own value/references/sourceOrder; preserve typed
   error metadata in the returned decision/evidence without schema change. Explicit
   absent ownLI must remain absent, never filled from a cached column. Legacy
   unrelated rules keep their existing selection. System-test selector receives
   these exact errors before its positive fallback; unknown subtype alone still
   does not add a permission hold. The two literal built-in41 mappings can be
   retired/bypassed only for these source-owned diagnostics, not broadly rewritten.

This is one two-field migration through existing interfaces, not replacement of
ACK architecture. Public wrappers need not change signature unless typed issue
metadata requires an additive optional property. Any necessary new shared API
must make selected message/object and disposition explicit. Do not couple the pure
owner to DB, test case or mutable rule tables. Do not rewrite frozen source,
producer code, schema, framework/router, discovery or gate settings.

## Acceptance matrix and existing assertions

| Required independent acceptance | Evidence now; expectation after authorized runtime |
| --- | --- |
| Golden values | Z14V/VH A74; Z14N A13/A76; Z15 A74/A75, including C A74/E37; all qualified324 codes. Complete canonical/manual controls; exact E37Z18 interpretation requires review. |
| One-variable rejections | Remove322 inZ14/Z15, remove324 inZ15/Z18 →41; X99 and wrong Z14 combination →42 with exact field/text. No testData/cached-code override. |
| False/U | Extra322/324 in unused functions no negative; unknown subtype gives no invented combination error; preserve metadata-only missing7111 and scalar-with-unused-metadata controls. |
| Ownership | Each independent LIN, both invalid LINs, missing ownLI/209, correct own227 fallback, released LI, header donor, duplicate pairs, distinct subsequent UNH. First message must not borrow; do not claim subsequent-message processing unless actually selected by ingestion. |
| Actual paths | Manual before event; registry before issue/detail writes including9.2.1/positive labels/DB-rule override; direct; system fallback; canonical persisted report→response selection→real renderer→mock kernel boundary. No helper-only closure. |
| Text readiness | Raw invalid delimiter/case preserved in all three alphabets; >70 decoded characters/internal occurrence cannot reach qualified event/positive draft/persistence; readyF and independent baseline negatives remain visible. |
| Prior data | Matched/false/null/absent context has no effect on322/324 identity; query unavailable is internal and stops external effects. No claim that current prior matching grants permission. |
| Regression boundaries | PR350–352 typed behavior,506 guards and all source integrity/gates unchanged. Full permission workflow residuals remain explicit; no coverage count increase. |

Only two **specific existing assertion changes are proposed for root adjudication**:

- `__tests__/ediel-prodat-energy-product-consumers.test.ts:49–53`, test
  `valid506 preserves independent invalid-status error and warning event`:
  submitted literal `INVALID` currently expects41/322; propose42/322, retain
  warning and add exact submitted text assertion.
- Same file54–57, `false Z14N extra adds no hold and retains the existing A76 status
  negative`: source-valid A76 inZ14N must not generate322 error. With matched
  synthetic context the manual result should be positive/success and false506
  remains ignored. Rename only this test to express that source contract.

Do **not** rewrite same-file58–61 unknownZ14 reason/falseZ18 preservation;
characteristic-preflight103–104 metadata-only missing322/32441 or109 valid primary
with unused metadata; script ediel-rule-regression.cjs282's missing322→41 or287's
missing324→41. The script's word “invalid” describes a missing-status fixture,
not permission to change its ERC. Direct Z14N generic209, Z18 generic261, registry
40/105, root fallback and other existing assertions require separate concrete
adjudication if a later implementation encounters them. No blanket test waiver.
