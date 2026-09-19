# PC-310-Z05/Z06/Z09: source and architecture qualification

Status: SOURCE-ONLY S310-R1 correction, awaiting scoped independent source/spec re-review and explicit root runtime authorization. Independent architecture review APPROVED the bounded Option A design, including the separately identified persisted-send holds. Runtime base `16d93f38387c203b1d277064948199fb905220aa` (PR347); root memory updates are separate. No runtime, existing test, frozen specification, schema, codec, VM loader, budget or gate edits. PR310 remains paused and is not a proved dependency. Accepted counts stay 98/110 numeric D and 10/10 parents; no acceptance follows from the probes below.

## Routing and method

Read AGENTS and required current memory, domain-model, canonical-flows, canonical-architecture, product-and-users, tenancy-and-rls, decisions and known-failures; inspected actual implementation and clean task branch. Inspected local skill inventory. Applied scoped spec-to-code-compliance evidence tracing, code-review caller/callee review and verification-before-completion; applied PDF skill for original table/process visual review. The task is an explicitly bounded source implementer assignment under root's subagent-driven workflow: no further delegation, no root memory/publication/CI ownership. Acquire-codebase-knowledge's repository mapping trigger is absent; using-superpowers explicitly exempts dispatched subagents. Full quality-playbook, repository-wide security/DB/performance audit, SQL/React/UI mutation, refactoring and implementation/TDD workflows are not activated by this three-cell source audit. Writing-plans principles inform the proposed implementation boundaries below; runtime execution remains unapproved. Source-only scratch characterizations are observations and expected RED, not changed existing assertions or acceptance tests.

## Exact authority and inspected scope

* Original PDF `/workspace/scratch/2a201d6d5897/prodat-original-source/PRODAT-26A-r3.pdf`, SHA256 `83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95`.
* Original workbook `/workspace/scratch/2a201d6d5897/reporting-permission-probes/TGT_PRODAT_Bilaga_1-Testdata_per_testkund_version_el_4-0-5.xlsx`, SHA256 `475131fa17fe0b4a611bae4ecf3f42cd78c9565b963a7c7cbd918213721332c7`.
* PDF extracted directly to scratch. Full p20 field note, p65 transaction reason table/note, p71 status table, pp109–113 complete process context, annex4 p119 and p122 read. P71, p112 and p122 rendered and visually inspected. Field310 is not gray on p122; p71's 3055 status is X despite its underlying directory classification D. Exact PDF page numbers equal printed page numbers.
* Frozen `registers/prodat_conditional_cells.json` contains death AND eligible subtype for all three cells, explicitly not general bankruptcy. It also directs deriving facts from valid received structure and says a local knowledge gap is not automatically a protocol error. Preserve the frozen file: the following is a derived qualification of that predicate, not a rewrite.

## Source facts and conflict resolution

| Original location | Source fact | Consequence |
|---|---|---|
| P20 §2.2, 310 | D for Z05/Z06/Z09; used only in connection with death | No generic status for bankruptcy, identity change or other customer masterdata |
| P71 SG14/CCI | Only after death, in Z05LK, Z06E, Z09E | All other subtypes cannot carry outgoing310; death at message/root level cannot override own subtype |
| P71 SG14/CAV | Same condition as CCI; first C889 component 7111 is Z41; 1131, 3055, both7110 positions unused | Exact pair `CCI++Z17` then `CAV+Z41`; do not use product's fourth component or fill unused qualifiers |
| P65 field223 note | E34 for death in Z06E/Z09E; other bilateral E34 use expressly names **Z06E** | Bilateral nondeath exception does not extend to Z09E |
| P109 | Grid owner may inform supplier of death with Z06E and customer status; other automatic customer information updates require bilateral agreement; only customer info plus mandatory fields | Z06E alone is not death proof. Preserve accepted bilateral nondeath/customer address rules and p109 exclusions |
| P110–111 | Z10 meter replacement; Z06F/G installation/meter information, separate from customer information | Cannot borrow physical meter event facts or make all Z06 death-capable |
| P112–113 | Z09E only for death when supplier first learns customer died; customer status Z41; grid owner responds Z06E; Z05LK may follow due to move-out | **Source-valid own Z09E/E34 establishes the death process.** No additional local death boolean is necessary to require310. Z05LK alone does not establish death; Z06E alone does not establish death |
| P119 annex4, applicability and extra-information paragraphs | Determine subtype applicability before field checks. An extra field marked X or D whose condition is false must not cause negative APERAK, even if content is bad | False first, then skip all310 content/placement/code/qualifier checks for that occurrence inbound. Do not equate every unused component with an inapplicable containing field |
| P119 annex4, qualifier paragraph | An erroneous format qualifier/code-list agency causes an APERAK error for its associated field; the example names NAD+UD 1131/3055 and field227 | Separately reconcile qualifiers of applicable310 with extra-field protection; the adopted component interpretation is explicit below |
| P122 annex4 | Valid310 code is Z41 | Applicable supplied status is checked against Z41, with its own occurrence and field310 attribution |

The source texts are consistent when E34 is interpreted per function. The current `prodatSubtypeRegistry.ts` groups Z06E/Z09E together, calls both normally death/bankruptcy, permits bilateral nondeath Z09E, and rejects Z09E with absent local context. `businessSemantics.ts` repeats that description. These statements are contradicted by P65/P71/P112. A handbook citation in a source comment is not independently verified handbook evidence and cannot override the supplied exact protocol original. No supplied source supports bankruptcy as Z41. The frozen death predicate can be satisfied for Z09E by the source-defined process itself; it must not be interpreted as requiring an unavailable independent local event in every function.

## Direction and three-valued decisions

An own process is the exact BGM function plus the single canonical field223 reason in the same message/first-register object SG14, before line RFF/NAD. Aliases accepted at API inputs are not aliases allowed on wire. Neither field310 presence/value nor byCell nor an emitted output snapshot establishes the process or event.

| Own source-qualified scope | Death condition | Outgoing pure semantics | Incoming310 behavior |
|---|---|---|---|
| Z09E / E34 | True from protocol-defined process | Require exact Z41 pair; do not demand extra death fact | Missing310 is required-field error; invalid supplied Z41 code is field310 error, independent of unavailable local customer history |
| Z05LK / Z23 or Z06E / E34, independent exact death event true | True | Require exact Z41 pair | Require/check the Z41 value for this occurrence |
| Same eligible processes, independent event known nondeath | False | Omit/forbid310; valid nondeath Z06E remains subject to exact bilateral process capability | Ignore all extra310, including bad code/unused components; no negative APERAK from that extra information |
| Same eligible processes, event unknown/unavailable | Unknown | Stop unresolved own310 condition; do not infer false from absent310 | Absence is not a missing310 error; local unknown/invalid local evidence cannot itself create negative APERAK |
| Valid other own subtypes, including Z05L/C/H, Z06F/G, Z09B/D/F/G | False from subtype exclusion | Omit/forbid310, regardless of a root death hint | Ignore extra310 under p119 |
| Missing/duplicate/invalid own reason or unbound occurrence | Unknown scope, not false death | Block with protected scope diagnostic | Independent field223/syntax defects remain; do not manufacture a310 missing error or borrow another object's death |

### S310-R1: applicability before component checks

P119 has two distinct controls: its final/applicability and extra-information paragraphs protect an inapplicable **whole field**, while its qualifier paragraph assigns an erroneous qualifier/agency to the field it qualifies. P71 marks310's CAV/1131 and /3055 unused, but p119 does not provide a worked310 example resolving populated unused qualifiers. The previous blanket inbound exemption for all X components conflated these controls and is superseded by this matrix. Root adopted the reviewer's bounded interpretation; it awaits scoped source/spec re-review rather than being presented as verbatim source text.

| Field condition / component | Outgoing | Incoming adopted policy and basis |
|---|---|---|
| False by own subtype or independent nondeath | Forbid whole310 field | Ignore the whole extra field first, including bad7111 and associated1131/3055. No310 negative; p119 false-field precedence |
| True; missing or invalid7111 | Require7111=Z41 | Missing = ERC41/field310; invalid = ERC42/field310, with exact own LIN/LI. P112/P122 and applicable-field checks |
| True; nonempty CAV/1131 or /3055 | Forbid unused qualifier/agency | ERC42/field310 as an incorrect qualifier/agency of applicable310. **Adopted p119 interpretation:** extend its erroneous-qualifier rule to populated profile-unused1131/3055; the original does not spell out this310 example |
| Eligible U; absent310 | Unresolved condition blocks outgoing | No missing310 error and no negative caused merely by U or absent/malformed local evidence |
| Eligible U; supplied nonempty bad7111 | Unresolved condition blocks outgoing | ERC42/field310 after independently qualifying the own occurrence. **Approved supplied-content inference** from p122; content failure does not convert U to true |
| Eligible U; nonempty CAV/1131 or /3055 | Unresolved condition blocks outgoing | ERC42/field310 under the **root-adopted extension of the same independently scoped supplied-content inference** to erroneous qualifiers. Do not infer death, require missing310, or reject for local evidence gaps |
| True/U; residual unused CCI/7059, C502/6321/6155/6154, or either CAV/7110 text position | Forbid all nonempty unused positions | **Adopted residual-tolerance inference:** tolerate extra data when own field/value remain unambiguous. The source does not mandate negative APERAK solely from these X markings |

Only nonempty unused positions are prohibited outbound; an empty optional component is not a fabricated required value. Known false precedes every component test, including qualifiers, and a310 error must never be a proxy for unknown scope. If malformed wire placement prevents qualification of the own occurrence, keep genuine syntax/field223/occurrence concerns separate. Independently malformed EDIFACT syntax is outside the tolerant310 content decision. Missing or malformed local evidence remains diagnostic-only inbound and cannot turn false or U into true.

The U supplied-content and residual-tolerance rows are bounded engineering interpretations adopted for310; they do not authorize changes to unrelated506. The confirmed existing unused-component gap below remains specifically outgoing enforcement. The new applicable/U qualifier policy is an explicit source interpretation to verify during runtime, not a claim that an inbound qualifier gap was already tested by the outgoing characterization.

No source here defines a separate death-date field or says death date equals DTM157. Reuse the accepted date owners for existing applicable DTM dates; do not add an invented mandatory death date or midnight constraint to310. Z05's contract end, Z06's change effective date and Z09's validity date describe their own process and must not be exchanged. The independent event key/revision binds a Z05LK/Z06E assessment, not a synthesized date comparison.

## Current registered producers and source availability

Actual `EDIEL_TGT_TEST_CASES` execution, not union types or helper names, gives:

| Current case | Registered role / business direction | Exact process and effect on this unit |
|---|---|---|
| 2.1.1, 2.1.2 | supplier; Gridex outbound Z06 | F/E64, not E34; registered fixture direction is not a new operational grid-owner role |
| 2.1.3 | supplier; Gridex outbound Z06 | G/E32, not E34 |
| 2.2.1, 2.2.2 | supplier; portal inbound Z06 | F negative cases; not a death producer |
| 2.5.1, 2.5.2, 2.5.3 | supplier; Gridex outbound Z09 | F/E64, G/E32, D/Z70 respectively; none E34 |
| 3.1.1 | supplier; portal inbound Z05 | L |
| 3.1.2, 3.2.1 | supplier; portal inbound Z05 | LK, latter invalid object; no death evidence |
| ESCO/DGI | Active own cases are permission processes | No registered Z05/Z06/Z09 death producer found; broad PRODAT unions do not grant one |

Registry sources are `tgtRegistry.part-2.ts` and `tgtRegistry.part-3.ts`; `buildTgtProdatTransactionType` in `tgtEdifact.part-2.ts` maps actual outbound cases. Original workbook has no Z09E, Z06E, Z41, death or bankruptcy label in any cell. Exact eligible columns are supplier Testkund8 G162/G177/G186 (case3.1.2), Testkund7 F126/F140/F148 (case3.2.1); their case header is G161/F125, their object field is G163/F127. Neither contains a death fact. The separate grid-owner Testkund49 column D253/D267 corresponds to case6.1.2 in `Testfallens testkunder!A74:C74`; workbook existence is not registered current role authority. No customer identity is copied into this audit.

### Actual server paths, including broad manual facades

1. `createEdielTgtDraftAction` (`app/admin/ediel/actions.part-2.ts:807ff`) resolves company/run, checks exact registry step actor, loads system-test runtime and test data, then calls `buildEdielTgtDraft`, source assertions, persistence and run association. `tgtAutopilot.ts:createDraftForStep` follows the same runtime/data/builder pattern. Neither can select a new death process merely because a helper understands it.
2. `saveEdielTgtRegisterFactsAction` (same actions file, 910ff) requires a registered Gridex step, server run/company authorization and writes notes with company/id/updated_at CAS. `tgtRegisterFacts.ts` copies the approved fact subset; `prodatRegisterEvidence.ts:copyProdatRegisterFacts` drops legacy businessContext/byCell. Existing saved notes therefore do not create a310 event producer. Their saved state UI and date/reporting source envelopes must not be claimed as death authority.
3. Existing exact-association/runtime pattern: `tgtDateEventContext.ts:loadTgtDateEventValidationContext` uses `tenantDb(company)` for message→run link (limit2, exactly one), run and route reads, exact code/family/direction/step, runtime role and fresh test data. This is reusable boundary architecture only, not proof of a death source.
4. `createProdatDraftAction` (`actions.part-4.ts:420ff`) and `getProdatDraftBuilder` route broad code Z05/Z06/Z09 into legacy `compatAdapter.ts` draft builders. They read the switch `validation_snapshot.portalData` and forward `reasonForTransaction`. However `portalTestCustomer.ts:normalizeReasonForTransaction` accepts only Z22/Z23/E64/E32/Z70; the active edit `normalizeProdatReason` in actions.part-4 accepts Z22/Z23 only. E34 is not an independently selectable saved process there. A forged historic JSON E34 or arbitrary raw upload is not a newly qualified producer.
5. The switch detail UI exposes “prepare Z09”, but its `prepareSwitchZ09Action`→`prepareSwitchProdatAction`→`flows/prodatSwitch.ts:prepareAndQueueEdielZ09` **unconditionally calls blockedSwitchFlowCode**. Z05/Z06 prepare facades likewise block. `endAgreement.ts` and `edielAutomation.ts` call that same blocked Z09 facade. Do not infer live producer existence from the UI label or these imports; do not unlock those facades.
6. Pure `engine.ts`/`buildProfiledProdatSegments`, `buildZ09Segments`, generic `buildProdat.ts` and TGT segment helpers can accept/render fragments or generic characteristics. Pure caller input is useful for protocol correctness but is not saved server authority. Current profile renderer has no dedicated310 projection. Generic characteristics may emit Z17; existing unknown facts or emitted Z41 cannot certify that choice.

**Availability conclusion:** no current source-supported positive death producer was qualified. A broad manual draft API exists and must be protected, but no current authorized selection/notes lifecycle establishes Z05LK/Z06E death or a selected Z09E process. No PR310 dependency is proved. This is a bounded Option A candidate; a future source producer is a separate task and cannot gain acceptance from these pure tests.

## Consumer map and proven gaps

| Actual surface | Existing behavior / required proposed integration |
|---|---|
| `prodatDependentConditionEngine.ts` | All310 cells use only root businessContext==death, independent of own subtype. Replace the semantic owner, not the frozen matrix. Pre-wire diagnostics cannot certify all objects |
| `prodatSubtypeRegistry.ts`, `businessSemantics.ts`, `canonicalEdielPolicy.ts` | Correct function-specific E34 semantics; do not reject source-valid incoming Z09E for missing local context. Preserve valid Z06E nondeath bilateral behavior and source-first address/IV owners |
| `profileRenderer.ts`, `buildProdat.ts`, `tgtEdifact.part-3.ts` | Project310 from selected process/event through a shared pure owner before encoding. Validate emitted components against own source selection; generic Z17 must not bypass it |
| `prodatRegisterEvidence.ts`, TGT notes and builders | Strict copy/clear semantics for pure facts; persisted unqualified caller facts must not acquire server authority via bodyBinding. It is integrity binding, not authorization |
| `canonicalPolicyFieldValidator.ts` |310 remains in legacy root-condition loop. It detects one missing object when root required, but does not reject unused310 CAV components. Route through the owner and remove duplicate generic310 checks |
| `rulebook/validator.ts` | Both normal and catch paths, sync and registry, actual wire-vs-row function, intentional-invalid-test bypass and snapshot handling must include protected310 checks. Parse unknown local context must not fall into blanket negative failure |
| `core/messageBuilder/payloadPreflight.ts` | Raw and row preflight, early-return metadata and custom UNA paths need the same bounded guard; preserve existing accepted protections |
| `rulebook/sendGuards.ts`, `transport/sendLock.ts`, shared `transport/index.part-2.ts:sendEdielMessageViaSmtp` | Both guards must protect310 before allowInvalid/test bypass; shared SMTP must run bounded guard before transport/provider dependencies. Raw OR metadata mismatch cannot hide a selected death process; do not block other valid subtypes |
| `decisionEngine.ts:decideProdatAperak` | Actual production protocol decision currently only merges generic business, known permission and meter-change errors; selected310 absent/bad returns positive in characterization. Add field310 with exact own LIN and LI, ERC41 required /42 invalid under source rules |
| `inbound/productionInboundDecisionEngine.ts`, `orchestrator/edielProcessingPipeline.ts`, `prodat/prodatAperak.ts` | Call real decisionEngine. Thread explicit receiver facts only where source-qualified; payload metadata is not receiver authority; wrapper must not turn local unknown into automatic negative |
| `testing/ackDecisionEngine.ts` and `actions.part-3.ts:resolveBackendAperakDecision` | UI defers PRODAT APERAK to backend; manual/test backend uses `aperakErrorRuleRegistry.ts:resolveAndStoreProdatAperakErrors` and actions/system-tests equivalent. Add the same selected310 gate there; absent valid mapping means review-required, not silent positive or fabricated mapping |
| `core/ackPolicy.ts` and `stateMachines/prodatLifecycle.ts` | Re-resolve canonical business context from parsed hints when a snapshot is absent. Correct source-valid Z09E context resolution without making ACK bookkeeping perform death-state mutation |

Material findings (each Medium protocol-correctness severity within this source-only scope): (D310-1) source contradiction in context and predicates; (D310-2) missing exact unused-component enforcement; (D310-3) actual APERAK missing selected310 enforcement. Business impact is false death status, rejected valid death processes, or positive acknowledgements of missing/invalid required310. These are protocol correctness gaps, not a claim of demonstrated production data exposure. Each has direct source/module evidence above. Current snapshot/bypass paths are architecture risks to cover, not independently proven exploits in this audit.

## Proposed strict owner and Option A boundary

Proposed new pure module `lib/ediel/prodat/prodatDeathStatus.ts` owns only source decisions, exact nested input copying, occurrence selection and independent event equality. Proposed `rulebook/prodatDeathStatusPolicy.ts` adapts tokenized wire and returns diagnostics; `prodatDeathStatusAuthority.ts` owns the separate persisted-boundary decision. No backend/Zod import or TS parameter properties in pure VM-consumed modules.

Core distinction: own source-defined Z09E gives true with **no event-fact requirement**; Z05LK/Z06E need independent death assessment. Pre-wire Z09E uses the caller's separately selected process, not the emitted CAV to prove itself. Inbound validation may derive the process from its own authorized wire structure per source. Persisted producer qualification is a different question.

Proposed exact pure contract (names are design, no runtime has been added):

```ts
type DeathRef = { key:string; revision:string; eventKey:string; reference:string }
type DeathActor = { id:string; qualifier:string; agency:string }
type DeathCustomer =
  | { kind:'domain_customer'; key:string; revision:string; id:string; qualifier:string; agency:string }
  | { kind:'test_customer'; workbookSha256:string; sheet:string; entityLabel:string;
      blockIndex:number; columnName:string; columnIndex:number; id:string; qualifier:string; agency:string }
type DeathAssessment = { kind:'unknown' }
  | { kind:'known'; value:'death'|'not_death'; evidence:DeathRef }
type DeathEventObject = {
  objectKey:string; installation:{id:string;agency:'9'|'89'};
  customer:DeathCustomer; legalSupplier:DeathActor; legalGridOwner:DeathActor;
  process:{code:'Z05';reason:'Z23'}|{code:'Z06';reason:'E34'};
  event:DeathRef; assessment:DeathAssessment;
  lineItemReference:string;
}
type DeathSelection = {
  source:{kind:'caller_selection';reference:string};
  objects:DeathEventObject[];
}
```

All shown keys are mandatory when their branch exists; reject unknown keys at every nesting level, arrays where records are expected, undefined mandatory values, coercion, whitespace/overlength/control characters, malformed workbook hashes or index values, duplicates and incomplete actors. Deep-copy every nested record/array. `assessment.evidence.eventKey` and revision must bind independently to `event`; event key self-binding and exact object/customer/agency/actor/LI equality are enforced. Select by exact decoded identity tuple in its own message, never first match or punctuation-stripped identity; supplied evidence for a different scope remains unusable. A source reference string alone is not event evidence, and self-consistent caller facts are still only pure input.

Missing selection, absent own object or `{kind:'unknown'}` yields unknown for eligible Z05LK/Z06E. Explicit clear remains clear; missing optional API property may inherit current context, explicit null must clear it, and empty arrays cannot fall back to root businessContext/byCell. Known false is an independent assessment, not absent status. No `deathEvent` object is mandatory for Z09E. Own customer identity can come from its required UD party while status physically belongs to the object's SG14, not under NAD+UD. Source-defined parent applicability and annex2 first-register inheritance must stay with existing grouping owners.

Persisted Option A guard scope **approved by independent architecture review**; implementation still requires scoped source/spec approval and explicit root runtime authorization:

* Valid own Z05LK or Z06E currently has no qualified persisted independent death/nondeath source. Block unresolved eligible outbound310 rather than silently treating it false, even if310 absent. This can affect legacy manual drafts; it does not block Z05L/C/H or Z06F/G. Valid explicit future nondeath Z06E authority must remain possible with proper bilateral capability.
* Z09E has a known required310 predicate, but no qualified current saved producer selection. Approved Option A holds persisted Z09E sends at a separate SOURCE_UNQUALIFIED boundary, not a DEATH_UNKNOWN condition. This is intentionally stronger than field310's pure rule and is approved as producer policy; it must never bleed into inbound/pure validity or be claimed as certification of a current saved positive producer.
* An exact source-excluded subtype with emitted310 is rejected outbound by ordinary protected policy; do not widen SOURCE_UNQUALIFIED to all Z05/Z06/Z09. Missing/contradictory reason or body metadata cannot choose the excluded branch to bypass validation.
* Guard tokenizes actual UNA/raw message boundaries before xml/ai_list early returns; metadata claims require consistency. Decoded text like `A'CCI++Z17` is data, not a segment. Test three service-character alphabets and released tags at every integration boundary; do not modify shared codecs.

There is no authorized current producer to extend with a made-up saved death checkbox. Consequently this Option A changes no UI, tenant state, actor role, live data, provider or operational facade. A later separately qualified producer must specify actual tenantDb **reads and writes**, versioned source envelope, CAS on original revision, explicit clear, saved-state UI, current role/registry selection, and exact unique run/message association only for TGT cases that truly own outbound steps. Existing notes CAS is an architectural example, not proof those requirements already hold for death. No schema/PR310 import is justified by this audit.

## Verification and evidence limits

Scratch: `/workspace/scratch/2a201d6d5897/death-status-probes/` contains original extraction, rendered p71/p112/p122, fixed characterization source, observations JSON, source-contract RED tests/results and isolated Vitest config. No scratch probe modifies a runtime module.

| Command / observation | Result |
|---|---|
| `sha256sum` exact PDF/workbook | Both match brief |
| `node_modules/.bin/vitest run --config /workspace/scratch/2a201d6d5897/death-status-probes/vitest.config.mjs current-source.test.ts` |10/10 observations PASS (three alphabets for selected field and actual APERAK) |
| Same config, `source-contract-red.test.ts`, JSON reporter |4/4 expected RED: source Z09E requires310 without local fact; Z05L excludes310 despite root death; bilateral does not authorize nondeath Z09E; actual APERAK misses310 |
| Current actual field validation, two objects / only first carries310 | Correctly detects missing status; initial global-borrowing suspicion refuted, not reported as defect |
| Current supplied310 `CAV+Z41::9` | No selected310 error in all three alphabets; confirms unused-component gap |
| Actual APERAK, Z09E missing/BAD310 | Returns positive; gap confirmed. Minimal messages isolate this decision consumer, not whole-message conformance |
| Actual registry | Z06 outbound F/F/G exists; initial all-inbound assumption refuted. No E34 case |
| `npm run ediel:masterplan-v2:integrity` | PASS 33 original files /121 rules /231 acceptance contracts; conformance and readiness explicitly false |
| `git diff --check` | PASS before audit commit |

Initial scratch config import resolution was corrected without repository loader/config changes. First observations intentionally tested hypotheses; four assertions failed (registry direction and three alleged global-borrowing checks), then expected observations were corrected to the actual evidence. They are distinct from the four retained normative expected-RED tests, which all still fail on unchanged runtime.

No full suites, build, remote CI, live DB/storage/provider or deployment operations were run by this source implementer. Root separately verified PR347 main73/73 and all OPS; it does not certify this new unit. No existing assertion was changed. Before runtime, root must individually adjudicate legacy expectations including `prodat-dependent-condition-engine.test.ts:63` (unscoped root death required), semantic-hardening bilateral-E expectations and canonical-policy batch fixtures. Preserve previous accepted units and the separate unresolved general inbound506/p119 question.

## Review handoff

Independent review supported the Z09E/nondeath Z06E qualification, producer availability and U supplied7111 inference, and APPROVED the bounded architecture/eligible holds and separate persisted Z09E producer boundary. Source/spec requested one correction, S310-R1. This doc-only revision reconciles both p119 paragraphs and records the root-adopted qualifier/U/residual matrix. Scoped independent source/spec re-review and explicit root runtime instruction remain required; architecture approval alone is not runtime authorization or full-cell acceptance. No runtime/test/memory changes or broad suite reruns form part of this correction. `git diff --check` must pass for the correction commit; the earlier10/10 observations,4 expected RED and33/121/231 integrity results above remain historical unchanged-runtime evidence. Runtime verification must cover owner truth table, strict copies/clear and per-object/agency/customer/event provenance; render and validation under all service alphabets; every normal/catch/preflight/guard/SMTP path; actual APERAK including false-whole-field/qualifier precedence, U-absent, true/U supplied7111 and qualifier errors, residual tolerance, Z09E-required and exact LIN/LI attribution; and nondeath accepted-process regressions. Counts remain unchanged even if bounded Option A later passes.


## Authorized bounded Option A runtime implementation

Root dispatched runtime after independent SOURCE/SPEC and ARCHITECTURE APPROVE of `6b95f6de02e5854953dddef1a5b26b384854173a`. This section supersedes the earlier pending-runtime status, while preserving the source-only receipts. No positive persisted producer or full-cell acceptance follows:98/110 numeric D and10 parents remain unchanged; PR310 remains paused.

Implemented `prodatDeathStatus.ts` as the strict pure assessment/copy/projection owner, `prodatDeathStatusPolicy.ts` as the own-message/first-register directional policy and shared ERC41/42 mapper, and `prodatDeathStatusAuthority.ts` as the separate persisted producer boundary. Z09E requires Z41 without independent assessment; eligible Z05LK/Z06E remains U unless exact independent object/agency/customer/legal-party/LI/process/event-revision facts bind. Root businessContext/byCell, emitted status, body evidence and saved caller selections do not establish persisted authority. Explicit clear/empty stays clear; unused components and qualifiers follow the independently approved R1 matrix. Ambiguous repeated status/CAV occurrences remain separate from content; known false retains whole-field precedence. No death date or equality with DTM157 is invented.

Dependent status, canonical normal/catch/sync/registry paths, profile/generic/TGT pure rendering and draft validation, body evidence copies, raw/row preflight, both existing protected send guards, shared SMTP, actual decisionEngine and legacy APERAK wrappers consume the selected rule. Pure projection uses source input; final wire validation checks complete bindings. Eligible reference rendering preserves/escapes service characters rather than compacting identity. Manual/TGT ACK resolution raises `PRODAT_DEATH_STATUS_ACK_REVIEW_REQUIRED` before positive shortcuts or writes because no selected310 registry mapping is qualified. No lifecycle customer-state mutation, producer/UI/role/registry activation, frozen source, schema, codec, VM loader or gate change.

Persisted unresolved Z05LK/Z06E and separate Z09E source qualification are held even without310. Existing independent register/subtype/product/date diagnostics are composed with that hold before send exemptions; an early death-only implementation obscured these diagnostics and was corrected against the unchanged protected-boundary tests. Registry validation avoids registry I/O for held rows; actual SMTP rejects before any mocked DB/provider/event/status effect. Excluded source-valid processes remain outside the producer hold, with extra310 ordinarily forbidden.

### Individually authorized legacy updates

Root inspected and approved each exact change before implementation; no blanket test rewrite permission was used:

- `prodat-dependent-condition-engine.test.ts`: retain both unscoped Z05 root businessContext inputs and expect U; neither death nor bankruptcy establishes own scoped evidence.
- `prodat-26a-semantic-hardening.test.ts`: both nondeath Z09E contexts reject with bilateralRequired false; p112 death-only and p65 exception only Z06E.
- `ediel-canonical-policy-batch-regression.test.ts`: add only Z05:310 to invalid-subtype-V unknowns; retain complete110-cell equality.
- `ediel-prodat-dependent-z06-product.test.ts`: only test-environment E34 positive branch now expects the producer hold; preserve field242 assertions, F/G and the entire production date-authority branch.
- `ediel-prodat-dependent-subtype-message-scope.test.ts`: single-message and released-UNH-looking E34 controls retain message-scope assertions and now expect the producer hold.
- `ediel-prodat-dependent-subtype-review.test.ts`: actual Z06E pre-mismatch control now expects the hold; wrong-code date-scope mismatch assertions remain unchanged.
- `ediel-prodat-dependent-subtype-ud-boundaries.test.ts`: bounded E controls retain all UD checks and the entire Z06 production-date branch; other eligible persisted controls expect the hold. Its two generic pure builder tests retain every assertion and receive fixed independent A/agency9/customer00-CUSTOMER89/legal12345→54321(160/SVK)/Z06E34 nondeath facts with own LI CASE or CASE-A. No fact is supplied for excluded B/E64; no source is derived from output or persisted.

### Runtime verification and retained failures

Scratch receipts live under `death-status-probes/`. Initial normative source integration RED6/6 was retained, followed by four rendering/scope RED cases and legacy-wrapper/reference RED cases. An applicable repeated-CAV ambiguity RED was retained and fixed. New tests cover the approved direction/content matrix across three alphabets, provenance copies and clear, own object/message/first-register isolation, pure builders, actual canonical/preflight/APerak consumers, raw OR row authority, both real guards, and shared SMTP with only external I/O mocked. Focused178/178 and subsequent diagnostic-composition416/416 passed. Initial full4256 run exposed175 composition/intentional-positive failures; no failures were discarded. Composition was fixed and obsolete positives were individually adjudicated as above. Final full suite passes4257/4257 with the required4GB/static-read preload. Relevant event/source-governance tests pass96/96 each under UTC, Europe/Stockholm and Pacific/Apia.

The exact legacy list limitation was reproduced using a read-only `git archive` of accepted base `16d93f38387c203b1d277064948199fb905220aa`, then the same fixture against the candidate:2/2 characterization observations each. Both `UNH;A;B\n1;2;3?` and `Ver20140401;A;B\n1;?'UNH+literal;3?` preserve raw send=parse preflight; the old rulebook guard throws dangling-release on both. The first also yields a register-evidence error through sendLock, while the second passes sendLock. New death authority does not classify either as EDIFACT, and this behavior is unchanged. The initial failed expanded guard assertion is retained in the scratch receipt; no whole-guard support claim or unrelated parser/codec change is made.

Final13/13 required gates PASS: app/scripts/tests typechecks; lint0errors/100warnings; large-file/performance; original integrity33/121/231; tenant integrity/shutdown; service-role ratchet2401 actual with baseline2402 unchanged; eight Ediel scripts818/818; route readiness with the required preload; diff check. Exact commands are recorded in the implementer task report and `runtime-final-gates/gate-results.json`; independent implementation/whole-branch review and root publication/CI remain required. Local Node24 verification does not replace root's Node22 CI or actual-main verification.


## R310-2 bounded review correction

Independent runtime review of83c0c475 requested changes for one Medium defect: nonempty malformed receiver-local death evidence threw during canonical pre-wire aggregation, causing a generic blocking evidence error and bypassing ordinary field diagnostics. Root authorized this one correction; nonmaterial observations and existing assertions remain unchanged.

Canonical policy now strictly validates only the inbound death selection used for aggregation and uses null/U when that local selection is malformed. The original facts remain in the policy for the wire owner's diagnostic warning; no generic catch error is suppressed. Pure copying, outbound policy and persisted holds remain strict. Added source-focused tests for Z05LK/Z06E missing evidence, malformed null/string/missing/nonempty object shapes, missing assessment provenance and stale revision, exact preservation of every ordinary diagnostic, U/no absent310 error, supplied bad7111/qualifier negatives, outbound rejection and an unrelated generic canonical failure that must stay blocking.

Retained reviewer repro is unchanged: fresh2/2 RED (`r310-2-reviewer-confirmed-red.json`), then2/2 GREEN (`r310-2-reviewer-green.json`). New author tests initially4/5 RED (unrelated-generic control already passed); affected final suite82/82 PASS with required4GB/static-read preload. The correction changes one production file only and adds one test file; no old assertions, codec, producer, authority scan or generic catch changes. Correction gates8/8 PASS: app/scripts/tests typechecks, lint0errors/100warnings, large-file budget, integrity33/121/231, unchanged VM Ediel scripts818/818 and diff check. Exact commands are recorded separately in `r310-2-gates/gate-results.json` and the task report. The prior4257/4257 full suite is historical candidate evidence; no full local suite was repeated for this bounded inbound adapter, because affected canonical/dependent/pure/outbound consumers are covered and root CI reruns the full suite. Independent scoped re-review remains required; counts98/110+10parents and producer limits are unchanged.
