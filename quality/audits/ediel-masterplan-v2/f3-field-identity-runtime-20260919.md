# Bounded F3 field identity runtime candidate — 2026-09-19

## Runtime review correction round 1 — current candidate

The initial candidate was **REQUEST_CHANGES** under R-F3-RT1–RT4. Its broad green receipts did not establish the four contracts below. The source/architecture approval remains unchanged; this wave corrects implementation only. Current status: correction implemented, new local evidence below; scoped independent rereview and exact Node22 CI remain required. Earlier sections are the initial candidate's historical record and are superseded where these corrections apply.

| Finding | Bounded correction | Direct proof |
| --- | --- | --- |
| RT1: I plus registry failure emitted generic negative | The per-message internal-review ACK guard filters to complete source-owned numeric/special negatives with matching ERC/field. A negative outcome alone is insufficient. The existing registry catch is unchanged. | Actual persisted inbound orchestration now emits technical-only for I+registry failure; F+I+registry retains41/226; qualified special40/109 remains deliverable beside I. U still proceeds normally. |
| RT2: absent IV child emitted42 | Supplied IV child findings use the existing child field-state presence, distinguishing absent mandatory value from supplied-invalid content. Numeric source ownership is retained for the whole child path, without making absent optional parents mandatory. | Actual qualified Z03 missing251 emits41/251. Additional250/251/253/317/318 absence/invalid controls retain41/42 respectively. |
| RT3: subtype fragment lost original occurrence | Validation remains scoped to the selected subtype fragment; emitted field metadata is rebound to the original message and its physical register group using original token position. | Second-object217 retains UNH M, physical lineIndex1, LIN2, own object/agency/register/LI in canonical issue and application plan; real draft contains LI B, never A. |
| RT4: incomplete metadata qualified | One finite qualifier checks numeric descriptor locator/group and all required component metadata, source rule, valid occurrence integer ranges and header/absent-object shape. Special109 also requires its source rule and valid occurrence. The same qualifier guards I-negative delivery. | Missing/empty/wrong component, negative index/register, zero register and absent-line-with-object mutations become I. Complete field and special109 controls remain qualified; blank special source does not. |

No changes to general registry/policy catches, source catalogs, schema, shared codecs/loaders, workflows/gates/budgets or old assertions. The initial author inbound test only gains new controls and the needed registry-failure mock switch; its existing assertions remain unchanged. Two new repository review test files retain independently specified outcomes. Existing local U/L and authority behavior, exact decoded references, missing-object/header contracts and all residual exclusions remain in force.

New receipts are under `/workspace/scratch/2a201d6d5897/f3-field-identity-r1-probes/`:

- Original independent normative assertions, unchanged: **5 PASS / 5 FAIL RED → 10/10 GREEN**. Passing F+I+registry control preserved.
- Permanent repository review/inbound tests: **5 PASS / 5 FAIL RED**. Extended metadata boundary RED:2 PASS/7 FAIL (the header/object control already passed). Final focused family **48/48**.
- Final implementation full suite: **4373/4373 in293 files**, Node v24.19.0. No runtime changes after this receipt. Subsequent test-only explicit type annotations and a draft assertion were verified by final focused48/48 and tests typing. This supersedes the initial candidate's pre-final4354 limitation for local verification only; exact Node22 publication CI remains separate.
- App/scripts/tests typing, lint, source integrity33/121/231, eight Ediel scripts818/818, tenant integrity/shutdown, service-role ratchet, large-file/performance and route readiness gates pass. Exact commands, exits and hashes are in the companion JSON's correction-round entry. Initial full lint rejected six explicit-any annotations in new repository tests copied from independent probes; replacement explicit types exposed a temporary Partial occurrence typing error. Both were corrected without production changes; initial failed receipts remain, and a separate final gate ledger records PASS.

### Observation provenance incident

The first correction RED run kept the independent test files and assertions unchanged and selected a new Vitest result path. Four probes nevertheless contain hard-coded `writeFileSync` observation paths. That run regenerated `registry-observation.json`, `mixed-registry-observation.json`, `missing-component-observation.json` and `invalid-occurrence-observation.json` in the independent probe directory; timestamps/ACK IDs changed their bytes. The root/reviewer confirmed no original-byte backup exists. These four files **cannot be claimed byte-immutable or exactly restored**. Copies named `regenerated-red-*.json` preserve this rerun output separately.

The original SHA256 manifest is untouched and continues to show the original hashes. Original probe source files, original result receipts, review report, owner observation artifact and all other manifest entries remain unchanged. The independent RED assertions and original reviewer result receipts remain the original evidence. A separate external Vitest setup now redirects only `node:fs.writeFileSync` observation destinations into the R1 evidence directory; it changes no oracle input/assertion or production behavior. The redirected unchanged probes pass10/10. The companion JSON records both original manifest hashes and regenerated hashes without replacing original evidence identities.

The current local result is ready for scoped rereview, not accepted F3 closure. Historical **98/110 numeric +10/10 parents** remains unchanged. General506/p119, P94 fullA905/customer227 text, full grammar, positive persisted/live producer eligibility and PR310 remain outside this correction.

---

## Initial candidate record (historical)

Status: implemented and locally verified; independent runtime review and exact Node22 CI remain with root. This is derived evidence, not an acceptance-count change or full F3/P-APERAK/live-producer claim. Historical counts remain **98/110 numeric cells and 10/10 parents**, with 12 bounded numeric cells still lacking full acceptance.

## Authority and source boundary

The independently approved corrected source contract is `ed45d5322d6ba2c881537a42dcdd80247c989876`, published by root as source checkpoint `af86e7f8994eaea4f32c5d5214253d65df82def9`. Its `f3-closure-qualification-20260919.md/.json` contains the 14 producer rows and four compositions. Root explicitly authorized this bounded implementation after all four source reviewers approved. Accepted runtime base remains `51c6c06b5fd7f56f447c0bd907373dc3a76d4676`.

Source: original PRODAT 26.A r3, P103/119 missing-versus-invalid rules, source field definitions, P93/121 special application109, and AT-P-01's prohibition on field inference. Original PDF, frozen masterplan, conditional-cell register, and original author/reviewer observation probes were rehashed unchanged; exact hashes are in the companion JSON. Original observation PASS receipts characterize defects and are not reclassified as normative conformance.

Skill routing: source qualification and approved plan carried forward; receiving-code-review, systematic-debugging, test-driven-development, bounded refactor and verification-before-completion applied. Supabase guidance applies only to existing JSON persistence: no schema, query, tenant/auth/RLS or external API changes; external persistence is mocked under the explicit no-live-call boundary. Parent owns subagent reviews, memory and publication. UI, dependency, migration, infrastructure, performance optimization and broad security-audit skill groups have no implementation trigger here; existing tenant/performance gates were retained.

## Implemented path

Owners now attach a typed numeric field, missing/invalid kind, source rule, source locator/group/component and own header/object/register occurrence. Actual matrix, subtype, product/reference, readings/register, meter-change, death, GAS, reporting, date and invoicee owners preserve their existing conditions while supplying identity at the finding. Known register314/258/209 and invoicee253 child errors stay numeric; aggregate-only findings do not choose a child. Original definition locators carry P45 header-party SG4, P46 sender-reference SG6, and P54 quantity SG12.

`prodatDiagnosticProjection.ts` consumes owner classification; the runtime no longer extracts three digits from paths/codes or guesses missing from an issue suffix. Existing registry composition preserves the result. Existing validation-report/parsed-payload JSON carries the typed disposition and response plan. The actual inbound consumer checks genuine internal review before actor automatic response/send and PRODAT business processing. Audit events record that disposition as a warning.

| Producer composition | Application / functional | ACK and downstream result |
| --- | --- | --- |
| No findings or U/L only | accepted / accepted | Ordinary prescribed ACKs; U/L persisted as warnings with original severity; normal guarded staging, no authority inference |
| F with optional U/L | rejected / accepted | Qualified missing41 or invalid42 with exact numeric field; existing downstream guards/staging retained |
| I with optional U/L | manual_review / not_applicable | Required technical ACK; no application-positive fallback; this message's automatic actor/business effects held |
| F + I with optional U/L | rejected / manual_review | Real F negative and technical ACK retained; no invented ERC for I; same narrow internal hold |

F is a qualified wire finding; U is unknown local condition; L is local evidence/authority; I is an unrepresented aggregate or missing/invalid expected metadata. U/L never causes this hold. Both Z09D dates use explicit40/A903109; the unrepresented zero-date alternative remains I. Supplied invalid254/310 and GAS320 still reject even where requiredness is unknown; independently false extras retain their already qualified ignore behavior.

ACK normalizers retain exact decoded object/LI identity and typed occurrence. Rendering escapes identities through the existing serializer. Explicit header/known absent references suppress row/first-object fallback. Shared codecs, loaders, source catalogs, schema, registry/policy catch paths, tenant/send/idempotency guards and frozen gates remain unchanged. Legacy rows without the marker retain their old behavior.

## Normative proof and fixture provenance

Three new test files plus a synthetic fixture exercise actual policy/runtime/registry, persisted inbound response plan, draft construction and rendering. External DB/kernel effects are mocked; runtime, registry and draft behavior remain real. Orchestration proof covers persisted U with ordinary guarded staging/positive Z10, I before actor/business with technical-only ACK, and mixed I+missing226 retaining41/226 with no positive fallback. No live service or producer qualification is claimed.

Final **29/29** covers clean two-object Z01, missing226, header207 rather than C082, missing327 rather than DTM164, no borrowed second-object/header references, exact escaped LI in three alphabets, supplied invalid254 under U, characteristic310 own identity/qualifier and false-extra behavior, GAS320 missing/invalid, reporting321, invoicee aggregate plus253, repeated-register258/314 identity, and identical object IDs in separate messages with distinct LI/message references. Special40/109 and zero-date I are separate controls.

Failure history is retained under `/workspace/scratch/2a201d6d5897/f3-field-identity-probes/` and hash-indexed in the companion JSON:

- Initial normative RED: 11 failures, 3 controls passed (14 total); first GREEN14/14.
- Owners/inbound RED14/19; intermediate17/19 exposed an injection fixture accidentally affecting outgoing ACK validation. Injection was restricted to PRODAT source validation; these two fixture failures are not counted as production defects.
- Specialized initial0/5 included both behavioral failures and fixture qualification. GAS invalid input was changed to an actual overlength an35 violation (the word WRONG is valid); Z13 uses V/S17; Z15 uses DGI. These are fixture corrections, not relaxed product assertions.
- Qualified intermediate24/24; contract controls and final focused receipt29/29.
- Initial test typecheck exit2 was optional `draft.validationReport` access in a new test; corrected optional access passes. Initial receipt remains unchanged; `gates/gate-results-final.json` records the replacement PASS separately.

Only one old assertion repair was individually authorized by root: `scripts/ediel-rule-regression.cjs` now uses the qualified inbound Z03-minus-LI wire (UNT17; complete control UNT18), asserts typed field226/missing rather than the obsolete static alias, and strengthens the existing negative plan to41/226. During qualification the complete control needed field262/NAD+Z02; that fixture correction is retained separately. The actual script passes. Its loaders, imported custom-rule assertions, downstream Z03 row and remainder are unchanged. No production `RFF_LI_MISSING` alias or existing test-file assertion edit was added.

## Verification and exact candidate limit

Local Node **v24.19.0**, with required static-read preload and 4096MB heap for gated commands. Exact command arrays, exits, receipt hashes and failure history are in the companion JSON.

| Check | Result |
| --- | --- |
| Affected consumers | 3129/3129, 91 files |
| Full suite before final metadata refinements | 4354/4354, 291 files |
| Final focused identity/owner/inbound suite | 29/29, 3 files |
| App, scripts and tests typechecks | PASS; app/tests final receipts retained |
| Full lint, then final scoped lint | PASS |
| Eight Ediel scripts | 818/818 |
| Frozen specification integrity | 33 originals, 121 rules, 231 acceptance contracts; no application-conformance claim |
| Tenant integrity/shutdown, service-role ratchet | PASS |
| Large-file budget, performance, route readiness | PASS |
| Actual ediel:rule-regression | PASS |
| Diff whitespace check | PASS |

Three implementation details changed after the full4354 receipt: source locator/group/component specificity, finite typed-occurrence validation, and internal-review audit-event warning/disposition payload. Final29/29 plus final app/test typing and scoped lint verify these changes. The full4354 result must not be described as testing the final exact tree. Root will run exact Node22 publication CI after independent review; no optional local full rerun was requested.

## Residuals and next action

General506/p119 applicability, P94 A905 full wording/customer227 fallback, full multi-message grammar, and general policy-resolution/registry-evidence catch redesign are outside this unit. It does not change ordinary application-rejected business staging. Existing outgoing authority/send owners stay blocking; no new positive persisted/live producer, GAS/DSO activation, release permission or accepted cell is inferred.

Root next: independent task/spec, quality and whole-branch runtime review against this exact candidate; author fixes any findings; then exact Node22 CI/publication/main gates. PR310 remains paused. The source audit's acceptance reconciliation remains authoritative and unchanged.
