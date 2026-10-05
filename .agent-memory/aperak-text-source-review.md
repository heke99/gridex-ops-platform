# Independent APERAK text source and architecture review

Candidate: `80f77d12`, base `af9e2673`, runtime baseline `b4f00ae37937502f2678738bf076c0ba8de9696b`.
Review date: 2026-09-20. Scope: completed source-only task and its proposed finite runtime contract. No implementation approval, production-conformance claim, historical acceptance increment, or PR310 dependency.

## Verdicts

| Review | Verdict | Basis |
| --- | --- | --- |
| SOURCE/SPEC | **APPROVE** | Original P94/P104 and linked §2.2, customer, reference, register and qualifier provisions support the finite text ingredients, ownership and capacity contract. Recovery and compound formatting are explicitly distinguished from national rules. |
| ARCHITECTURE | **APPROVE** | Shared typed composition before persistence, explicit readiness alongside preserved F identity, existing inbound I guard, direct506 propagation and narrow renderer transport form a bounded, coherent proposal. Legacy adapters stay outside new readiness gating. |
| TASK/SPEC | **APPROVE** | Two source audit/evidence files deliver source-backed findings, actual consumer traces, original failures, preserved controls, finite runtime scope and acceptance matrix. Runtime, old tests, frozen sources, workflows, thresholds and budgets are unchanged. |
| QUALITY | **APPROVE** | Independently reproduced all six expected red observations and six passing observations/preservation controls; three new capacity checks pass. Original PDF, all33 manifest files, embedded probe sources and reduced receipt contents verified. No blocking finding against the source candidate. |

Approval is for this source qualification and architecture proposal. Root must separately authorize runtime work and individually adjudicate concrete existing-assertion conflicts. C1 below is a nonblocking planning clarification to carry into that authorization; it is not a blanket test waiver.

## Instructions and review method

Read task brief first, then full author report, review instructions, complete source audit, evidence structure/probe sources/results, repository AGENTS and active memory context. Inspected comparison filenames/history and confirmed the author commit changes only its audit and evidence JSON. Earlier comparison commits are root-owned memory receipts; no author/runtime change is hidden there.

Applied repository code-review and verification-before-completion, direct source/spec comparison, and direct false-positive challenge. Read PDF skill for visual source inspection. `using-superpowers` exempts dispatched subagents. Differential-review explicitly excludes documentation-only changes; broad security, database, UI/performance, deployment and implementation/TDD workflows are not triggered. The spec-compliance skill's multi-agent dispatch is superseded by the explicit no-subdelegation instruction; this review directly checks the bounded source requirements and records its limits. No agents delegated, external communications, live DB/provider/storage calls, or repository implementation edits.

Read original source content for §2.2 and relevant pages15,20–22,79–80,85–90,93–94,104–106,108,114–116,119; visually inspected rendered P94 and P104. Verified PDF SHA256 `83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95`. This review independently checks the relevant provisions, not a claim to reread every unrelated page of the140-page original.

## Source findings and interpretations

1. **ERC41:** P94 requires the §2.2 field name followed by `saknas`. The special own227 reference provision is visibly inside the41 row. Its condition concerns absent209 and/or226, not just the field number of the current error. Known own227 must not be silently omitted. P106 supports the compact example punctuation; exact comma/spacing is a presentation convention, not a new normative literal.
2. **ERC42:** P94 requires the field name and erroneous submitted value. P119 keeps a qualifier error on the owning national field. Using a valid customer scalar for bad1131, a correct date scalar for bad2379, or an expected value would misdescribe the failure. The proposal's single-component evidence is reasonable; compound empty-slot preservation and ordered candidate presentation are approved as bounded design choices, not text allegedly specified by P119.
3. **Ownership:** P79–80 identifies227 as wire NAD+UD/C082/3039, up to35 characters. P22/P80 legitimately omit the whole customer group in the listed functions. P115 makes first-register common data authoritative within a valid own chain. Explicit present/known-absent/ambiguous states are needed; no cached tenant/customer lookup or first sibling/later UNH fallback is warranted. Base41 plus a local fallback-unavailable observation when no unambiguous own227 exists is an explicitly incomplete recovery of an unspecified source case, not full fallback conformance.
4. **Capacity/cardinality:** P104 permits one C108/4440 of an..70, prohibits the other text components and language field, and requires FTX per ERC. The current full draft rejects71 decoded characters. No source authority for abbreviation, truncation, invented substitute values or splitting one description was found.
5. **Concrete capacity conflict:** A complete Z01 with35-character wire227 is accepted. Removing261 and226 leaves genuine41/261 and41/226 findings. `Referens till avtal/fullmakt saknas, kundid=` plus that exact identifier is79 characters; even the base label/template plus identifier and one separator is71. Independent full-draft probing confirms preflight rejection. This justifies the bounded text-unready recovery proposal without asserting that national rules prescribe the internal state.
6. **Preservation:** P93 fixed40 descriptions and P94 `OK` remain separate. P87 per-object handling, P88 reporting all errors if possible, and P90/P105 own A209/A226 rules are preserved as source boundaries. Message-level internal review is a local recovery mechanism using the existing I boundary; it is not a claim of complete per-object protocol handling or a national waiting-queue response.

## Confirmed existing defects

These are pre-existing runtime defects evidenced by the source task, not regressions introduced by its documentation commit.

| Defect | Direct evidence and impact | Smallest proposed correction |
| --- | --- | --- |
| Missing-field41 text is developer prose and omits available own227 | `prodatDiagnosticProjection.ts:18` slices `item.description`; missing226 produces `RFF LI krävs för PRODAT Z01.` under each fixture alphabet. Actual `processInboundEdielMessage` persists and renders the same incomplete description. Recipient loses prescribed field/customer correlation. | Pure source-name/template composer with owned customer/reference state, used at existing typed projection. |
| Invalid-field42 text omits the actual failure value | Date2379=BAD and customer1131=BAD yield generic, truncated diagnostic explanations despite correct210/227 identity. `ProdatDiagnostic` has locator/occurrence, not owned failure content. | Carry already-validated scalar/component/compound evidence from existing readers/producers; do not infer it from prose, expected values or a generic first segment. |
| Final sanitizer destroys literal data | `aperakEngine.ts:62–84,135–144` replaces apostrophe/plus before escaping. The malicious-text probe preserves one ERC42 but loses those literal characters. | Ready decoded typed text through the existing serializer escape exactly once, with decoded capacity checked first. Preserve envelope preflight. |

Current71-character rejection is working protection, not an oversized-wire bypass. No extra-segment injection or sibling-customer leak is demonstrated. Actual TGT224 already names the erroneous submitted meter value and owns its references. Supplied40/105 and positive100 controls pass. These facts refute the broader claims explicitly rejected by the author.

## Architecture and call-site assessment

- `prodatFieldDiagnostic` already owns physical message/object/register occurrence. Its existing first-register selection is the appropriate place to add strictly local reference/customer states; missing customer alone must not become a new F or I.
- `projectProdatDiagnostics` is the shared typed wire projection. Its current national identity checks must remain separate from text readiness. Unready F stays a field diagnostic, with a separate local review reason and no invented ERC.
- `runtimeDecision.applyProdatPolicyDecision` currently chooses negative/positive responses from projected errors. Therefore readiness must be integrated there before `buildDecision` and `applyCanonicalRuntimeDecision` persist decisions. In particular, zero renderable errors must not change a genuine F into application acceptance or the current I-only `manual_review/not_applicable` outcome: the proposal explicitly preserves application rejected and functional manual_review.
- `inboundProcessing` persists the plan, filters mixed internal-review negatives through `isQualifiedProdatApplicationError`, and returns at the I guard before actor testing/facility/business paths. Updating the persisted eligibility contract is necessary so stale or incomplete ready metadata cannot bypass the boundary. Partial ready F must survive, while positive fallback and effects remain suppressed on the existing I path.
- `decisionEngine.decideProdatAperak:337` currently discards the shared energy projection's disposition and consumes only errors. Its explicit proposed review propagation is necessary before the empty-error positive path. The finite proposal recognizes this rather than relying on a final renderer exception.
- The manual backend checks existing energy review before permission success/event handling; its permission-engine negative mapping and registry/TGT outputs are legacy surfaces without this typed evidence. New readiness must not be applied indiscriminately there. The audit correctly documents their future event/storage boundaries and does not claim strings alone qualify their national mappings.
- The thirteen named typed producers correspond to actual imports/use sites. Four existing readers are a plausible finite metadata transport boundary. No new DB dependency, validator, schema, frozen matrix or authority is needed. Implementation still must demonstrate that every admitted ready error has actual failure evidence, including existing compound/empty/repeated cases.

Approve the proposed compact compound conventions provided they preserve submitted order/empty slots and remain attached to owned source locations. Their ambiguity is handled by the existing proposed unready result, not guessed first values. No blanket new hold is authorized for optional/forbidden customer absence, local U/L facts, or unrelated legacy output.

## C1 — Nonblocking compatibility clarification before runtime

Severity: **Low (planning/documentation)**. Affected audit: `Existing assertion boundaries before future edits`, particularly its energy-product compatibility row. Relevant existing tests:

- `__tests__/ediel-prodat-energy-product.test.ts:22–28`: X×36 is expected to produce exactly one wire42/506 and an actual draft across three alphabets and Z13/Z14 S17/S18. Exact source text is73 decoded characters.
- `__tests__/ediel-prodat-field-identity-review-owners.test.ts:26–33`: invalid317 C×36 is expected in `responsePlan.applicationErrors`; exact source text is71 characters. This suite is not explicitly named in the audit's existing-suite table.

Proof: inspected the exact existing assertions and independently passed a capacity probe showing current qualified506 F,73-character exact text, and actual preflight rejection; checked source field317 label and71-character arithmetic. National F classification remains valid, but unconditional preservation of those *wire* error counts is incompatible with the proposed capacity readiness.

Root had separately flagged these conflicts during review. They do not invalidate the source or architecture; the audit already requires individual adjudication of additional assertion conflicts. Before runtime edits, record each concrete conflict and authorize only the affected wire-readiness expectation. Preserve the F diagnostic, field/error kind, own references and applicability; add the prescribed persisted rejection/review and no-positive/no-effects assertions for genuine overflow. Representable existing negatives and all false-applicability controls must stay deliverable/unchanged. No blanket old-test waiver follows from this review.

## Verification and evidence preservation

Reviewer scratch: `/workspace/scratch/2a201d6d5897/aperak-text-review-20260920`.

Copied author probe/config text to that unique directory, changing only author scratch output paths to reviewer paths. Original repository aliases, test logic and imports were retained. The normative assertions were not weakened.

Commands executed from repository root:

```sh
node node_modules/vitest/vitest.mjs run /workspace/scratch/2a201d6d5897/aperak-text-review-20260920/observe-v2.test.ts /workspace/scratch/2a201d6d5897/aperak-text-review-20260920/persisted-v2.test.ts /workspace/scratch/2a201d6d5897/aperak-text-review-20260920/tgt-v2.test.ts /workspace/scratch/2a201d6d5897/aperak-text-review-20260920/normative-v1.test.ts --config /workspace/scratch/2a201d6d5897/aperak-text-review-20260920/vitest.config.mjs --reporter=json --outputFile=/workspace/scratch/2a201d6d5897/aperak-text-review-20260920/run-review.json
node node_modules/vitest/vitest.mjs run /workspace/scratch/2a201d6d5897/aperak-text-review-20260920/capacity-review.test.ts --config /workspace/scratch/2a201d6d5897/aperak-text-review-20260920/vitest.config.mjs --reporter=json --outputFile=/workspace/scratch/2a201d6d5897/aperak-text-review-20260920/run-capacity-review.json
npm run ediel:masterplan-v2:integrity
git diff --check af9e2673..80f77d12
git diff --name-only 2f7aaf9d..80f77d12
git diff --name-only b4f00ae37937502f2678738bf076c0ba8de9696b..80f77d12 -- lib __tests__ scripts docs/ediel/masterplan-v2
```

Actual test commands redirected stdout/stderr to corresponding unique reviewer `.log` files.

| Check | Outcome |
| --- | --- |
| Copied author probes |12 tests:6 PASS,6 expected RED; observation/persisted/TGT each PASS, normative3 preservation PASS and6 defect reproductions RED;45 observations recorded. Exit1 is expected, not a conformance pass. |
| Independent capacity probes |3/3 PASS: legitimate35-character227/79-character requirement; existing50673-character and31771-character conflicts;70 decoded colons accepted despite140 escaped characters,71 decoded colons rejected. |
| Source integrity | PASS33 originals,121 rules,231 contracts; applicationConformanceAsserted=false, productionReadinessAsserted=false. |
| Candidate whitespace | PASS. |
| Runtime/frozen/test diff from merged baseline | Empty for lib, __tests__, scripts and docs/ediel/masterplan-v2. |
| Author evidence | All33 manifest file byte counts/SHA256 values match;8 embedded probe/config texts match; all5 reduced run records exactly preserve original count/success/test-name/status/failure-message content. |
| Evidence preservation | All33 original author artifacts still match pre-review hashes. No original result regenerated or overwritten. |

The first reviewer equality check incorrectly compared reduced embedded receipts to the entire Vitest JSON and failed on `run-consumers-v1.json`. Inspection showed deliberate reduction, not lost outcomes: test names/status/failure messages and counts match exactly after schema-aware comparison. This is a refuted evidence-loss suspicion, not a candidate finding.

Original failed author harnesses remain honest and recoverable: uncaught71 preflight1/1 failure; raw defaultZ04/metadataZ01 persisted fixture failure; TGT wrong CAV component review-guard failure. Only corrected controls qualify the persisted/TGT claims. The normative red suite is observation evidence, not successful runtime TDD.

Reviewer receipt SHA256:

- `run-review.json`: `8f3026b6905269c83e861fc7767b06acb2cd497e7ebf64e0542803dc93e14b1d`
- `run-capacity-review.json`: `28004a5dd17337a0c000ea47170d92718692b67301cd04aa85421c33a5ac5c63`
- `capacity-review.test.ts`: `8c6f1d60ece91ddc0524327800b473c0e25cea1c4d2c12c21415a0a9f533acad`

## Limits and next action

No runtime implementation exists in this candidate, so the new composer/readiness metadata, mixed ready/unready persistence and effects, and compound formatting cannot be runtime-certified yet. All consumer effects are mocked; manual probing extracts the real function through TypeScript AST rather than exercising authenticated server-action deployment. Three fixture alphabets are representative, not exhaustive service-character enumeration. Legacy national mapping, cached positive reference, per-object completion and unrelated producer residuals remain outside this unit. No full runtime release suite or live main certificate was independently rerun here.

Root can use these four approvals to prepare the bounded runtime brief, explicitly settle C1's individual assertion cases, and separately authorize implementation. Preserve all original receipts and the finite acceptance matrix; no historical counts change.
