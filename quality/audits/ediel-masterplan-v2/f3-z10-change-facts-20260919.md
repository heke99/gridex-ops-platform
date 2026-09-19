# Z10 meter-change facts: source and architecture qualification

Status: **SOURCE/ARCHITECTURE PROPOSAL; independent review pending.**
Scope is exactly PC-254-Z10 and PC-242-Z10. No runtime, legacy assertion,
original specification, acceptance ledger, schema, generated type, loader,
budget, threshold, codec or root-memory change. No external operation was run.
PR310 remains paused at `e961135199f292b8210884f07de3b616a670161a`; this
proposal neither imports it nor establishes a dependency on it.

Examined runtime: merged main `0271e118a5ab4f7adebe5e5b7a041dda01a5547a`,
with root-only memory commit `79a2bc640fc73ecb7b5ad0e8da5bf48e6f8fbe31`, on
`codex/ediel-z10-change-facts-20260919`. Root owns PR346 main receipt and all
acceptance counts; this audit changes none.
During this work root recorded its receipt in memory-only `561d3589`: PR346
actual main73/73 and all OPS passed, accepted98/110. That is root's receipt,
not a new acceptance claim from these source probes.

## Routing and evidence method

Read AGENTS.md and the prescribed `.agent-memory` README, current state/task,
checkpoint, handover, blockers, work plan, domain model, decisions and known
failures. Inspected available local skills. Applied the source-to-code evidence
method and verification-before-completion; PDF skill for rendered originals.
The spec-compliance skill normally delegates independent requirement reviews;
this worker is already the bounded implementation/source worker, and the binding
task explicitly prohibits further subagents. Root supplies independent source
and architecture review. `using-superpowers` expressly exempts dispatched
subagents. The quality-playbook and acquire-codebase-knowledge workflows were
inspected but their whole-project outputs/agents are outside this two-cell
source task. No full baseline, security scanner, DB access, performance,
UI implementation, remediation/TDD, hooks, worktree, publication or finishing
workflow is claimed. Pure scratch characterization is direct verification of
specific observations, not a security exploit or acceptance certificate.
Implementation, tenant/UI and targeted regression skills become applicable
only after source review and explicit runtime authorization.

Plan executed: verify originals; derive conditions and occurrence ownership;
trace actual producers and consumers; characterize actual modules; propose
strict independent ownership and integration; run specification integrity and
diff checks. Older `f3-remaining-dependencies-20260919.md` is orientation only.

## Original evidence and adjudication

* Original P26.A r3: `/workspace/scratch/2a201d6d5897/prodat-original-source/PRODAT-26A-r3.pdf`,
  SHA256 `83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95`.
  Hash verified. Full p20 and both p67–68 segment tables were rendered and
  visually inspected, including their notes, table components and page labels.
  Context also read at pp21–22,50,57,64–70,76,78,110,114–116,119,123.
* Exact workbook: `/workspace/scratch/2a201d6d5897/reporting-permission-probes/TGT_PRODAT_Bilaga_1-Testdata_per_testkund_version_el_4-0-5.xlsx`,
  SHA256 `475131fa17fe0b4a611bae4ecf3f42cd78c9565b963a7c7cbd918213721332c7`.
  Hash verified; read cell coordinates, test/customer mapping and surrounding
  rows directly with openpyxl, not an alternate download or current projection.
* Immutable `docs/ediel/masterplan-v2/registers/prodat_fields.json`,
  `prodat_conditional_cells.json`, and `annex/source_tables.json` retain the
  source text and derived frozen contracts. They were not rewritten.

| Cell | Exact source meaning | Source-qualified result |
|---|---|---|
| PC-254-Z10 | p20 requires settlement method if it changed for the new meter **or** the new meter is below the profiling threshold. p67 says the threshold for monthly settlement. | `settlement_method_changed OR new_meter_below_profile_threshold`; true R, proven false O, unresolved U. Neither current Z31/Z32 nor meter method nor omission proves either operand. |
| PC-242-Z10 | p20 limits this Z10 field to electricity and requires it if the aggregation time-series product changed in connection with replacement; p68 confirms. | In EL, `aggregation_product_changed`: true R, proven false O, unresolved U. Unknown market is U. The frozen boolean expression's false-O projection does not override the explicit EL qualification. |

The source vocabulary is substantive: settlement is monthly/profiled versus
daily, **not** measuring interval. Field254 uses `CCI++Z15` and adjacent
`CAV/C889/7111`, exactly `Z31` (monthly, including high-resolution meters where
monthly settlement applies; gas profiling in the general note) or `Z32`
(daily). Field242 is the electricity supplier-level **aggregation time-series
product**, not tariff, generic energy product or meter serial. Its locator is
`CCI++Z14` → adjacent `CAV/C889/7110[1]`, the fourth component (`CAV+:::L917`).
Field506 uses the fifth component and is not a substitute in Z10.

P69 enumerates L639Q, L640Q, L654Q, L917, L633Q, L634Q, L635Q, L636Q,
L637Q, L638Q, L641Q, L642Q, L651Q, L652Q, L653Q. L917 permits measurement
Z01 or Z04 with settlement Z31; the other listed products permit Z04/Z32.
Existing pure field parsers/validators and the accepted Z06 product policy
remain authoritative for their existing scope; do not change Z06 behavior to
implement Z10. Share a source table or add a bounded Z10 wrapper rather than
broaden Z06 guards accidentally. Supplied Z10 values still need exact slot,
length, code, adjacency, unique occurrence and compatible supplied context.

### Three-valued and optional semantics

| Settlement changed | New meter below applicable threshold | 254 |
|---|---|---|
| true | true / false / unknown | R |
| false / unknown | true | R |
| false | false | O |
| false | unknown | U |
| unknown | false / unknown | U |

No numeric threshold or effective threshold regime is specified on these pages.
Do not invent one, compute it from annual energy, or equate `Z31`, `Z01`,
single tariff, or an included254 with a below-threshold assessment. The terms
“schablon” on p20 and “månadsavräkning” on p67 describe the source condition;
they do not authorize different numeric thresholds. A known non-applicable
threshold regime may yield false only from an independently referenced
applicability assessment; unassessed applicability is unknown. A true first
operand still determines R when the second is unknown.

False means optional, never forbidden. Optional omission is valid only after
the predicate is independently known false; omission is not its proof. A
supplied optional value must equal the independently assessed new value and
satisfy field syntax. A known R with an unknown new output value remains
unrenderable. Unknown facts stay U even if a plausible value is present.

The general gas examples 6109/6113 on pp20/68 do not remove “Z10: Endast
elmarknaden.” This audit reads that as no GAS Z10 field242 authorization, not
an optional EL product on GAS. Implementation scope remains active EL only;
GAS/non-EL cannot receive a qualified sender context through this work. A
separate gas policy decision is required before activating any such producer.
Field254's original sentence itself is not EL-only; this task does not rewrite
that sentence or extrapolate an executable gas threshold assessment.

### Event, meter and occurrence identity

P110 defines replacement as a **changed meter number**, Z10M with E58, rather
than ordinary Z06F/G master-data change. It calls for old final and new initial
readings afterward; that process description is not a substitute for the
separately accepted explicit reading facts. P21/p76 require field224 new/current
meter at `RFF+MG`, field225 old meter at `RFF+Z02`, C506/1154, an..35. P123
explicitly disallows equal224/225. `RFF+LI` field226 is the object's process
reference, not a tenant key or proof of a persisted domain event. P50/p110 bind
field216 `DTM+157`, format203, to the change's effective date, 00:00 on the EL
day (06:00 GAS is out of scope). Reuse the accepted fixed UTC+1/minute handling;
generation time must not become an invented replacement time.

P114–116 make different physical meters separate unique object IDs; they are
not sibling registers sharing one physical identity. For one physical meter,
own first-register SG14 contains common254/242; common old/new meter and event
references belong to that object. Later registers may omit these common facts
and cannot satisfy a missing first occurrence or override the first value.
The policy must key on message + LIN object ID + identity agency, preserving
first-register authority and existing invalid-chain rejection. Duplicate or
misplaced first-register CCI/CAV, a pair after RFF/NAD, another object's pair,
another UNH, or a wrong slot cannot supply the selected field. Keep existing
later-repeat semantic ignoring and independent syntax/structure checks.

P119 remains binding for inbound: absence of *local* historical/threshold facts
does not establish a sender error or justify negative APERAK. Extra X/D data
when the condition is not fulfilled must not be rejected on that basis. Do not
route this new outbound fact-qualification failure into inbound negatives;
retain applicable syntax, date and structural validation and existing distinct
old/new meter validation.

## Workbook evidence does not prove all change predicates

All following coordinates refer to the verified workbook, not production data.

| Original selection | Evidence | Limit |
|---|---|---|
| Supplier 2.3.1, Testkund8, sheet `Testkund 1 - 20 - elleverantör`, F161–190 | F163 object `735999888000000086`; F177 E58; F181 new `XX-10150`; F182 old `M10150`; F179 Z31; F180 `-`. | The case description names meter number/digit change. Neither output Z31 nor absent242 proves old settlement, product unchanged, or below-threshold truth. |
| Supplier 2.3.2, Testkund18, C409–431 | C411 object `735999888000000185`; C418 E58; C421 `XX-18000`; C422 `M18000`; C420 Z32. Mapping sheet B27 names settlement/method change. | Semantic change description supports the scenario, but source lacks complete independent old product/threshold state. No242 row in this block is not false evidence. |
| Supplier 2.4.1, Testkund3, D47–76 | D71/D72 deliberately both `M13333`; D69 Z32, D70 L639Q. | Invalid-equal-meter fixture cannot become a qualified replacement event. E69's prior-monthly note explicitly says **before Z06F**, not before this Z10; do not borrow it as Z10 old state. |
| Supplier 2.4.2, Testkund8, E161–190 | New/old identities as above; E169 deliberately says constant missing. | Negative test labeling neither establishes missing change predicates nor bypasses protected validation. |
| Network-owner 5.2.1, Testkund47, sheet `Testkund 40 - 65 - nätägare`, D180–209 | D182 object `735999888000000116`; D195 E58; D199 `XX-52000`; D200 `M52000`; D197 blank254, D198 `-`242. | C197 Z31 belongs to neighboring Z06G, not independent old Z10 state. Blank254 alongside profile Z01 emphasizes why presence/omission cannot assess the threshold. |
| Network-owner 5.2.2, Testkund46, C148–178 | C150 object `735999888000000079`; C163 E58; C167 `ZZ-53000`; C168 `M53000`; C165 Z32; C166 blank242. Mapping B66 names settlement/method change. | Preserve the original meter numbers despite their `53000` spelling; no fabricated “46” replacement. Blank214/218/259 in this block is a further original-versus-process/readings issue for any future activation. |

Workbook “Testfallens testkunder” A26:C29 and A65:C66 explicitly establishes
these test/customer identities. It does not establish runtime role availability.
Do not silently repair original blanks, merge neighboring test columns, treat
optional omission as “unchanged”, or derive prior values by reversing output.
Any future operator assessment must retain a separate rationale/reference to
independent pre/post and threshold evidence; the workbook row digest alone is
not that evidence.

## Current producer availability: inspect the complete path

**There is reusable server TGT infrastructure, but no currently registered,
authorized gridex-outbound Z10 business step on this base.** This conclusion is
from actual registry evaluation and draft calls, not the old dependency audit.

| Current path | Observed behavior and implication |
|---|---|
| `testing/tgtRegistry.part-2.ts` + helpers in part1 + facade/part4 | Actual registry has exactly four Z10 business steps: supplier2.3.1,2.3.2,2.4.1,2.4.2, step1, portal/inbound. Their outbound steps are ACKs. No grid-owner registry cases; workbook5.2.1/5.2.2 return null. |
| `testing/tgtEdifact.part-4.ts:buildEdielTgtDraft` | Looks up that registry; rejects unknown case and any non-gridex step before calling renderer. Passing imported data does not replace the registered step actor/direction. |
| `testing/tgtEdifact.part-2.ts:getPortalDataRows`; part3 `buildPortalProdatSegments` | Pure rendering supports Z10; source columns supply output224/225/254/242 and register grouping. This is a genuine reusable builder, not independently saved change authority and not proof of a reachable authorized Z10 action. |
| `testing/tgtTestDataStore.ts` | Imports/reloads case source data using suite/role/case. Does not register new expected steps. Existing `ediel_tgt_test_data` is a shared test-source catalog, not tenant/customer replacement authority. |
| `app/admin/ediel/actions.part-2.ts:createEdielTgtDraftAction` | Authorizes company/run, selects exact registry step and requires gridex actor, obtains runtime with **definition.suite**, loads imported data and notes context, builds and checks, asserts draft before create/attach. Rejects registered Z10 portal step; ACK is not Z10 producer. |
| Same file `saveEdielTgtRegisterFactsAction` | Z10 appears in code allowlist, but registry step must be gridex/PRODAT. Pure notes helper can accept source-selected Z10 register facts in isolation; authorized action is narrower. No active UI form for this generic save was found. |
| `testing/tgtAutopilot.ts:createDraftForStep` | Same actual definition/step path. Resolves runtime from run and source family from definition.suite, builds, mutates final route if selected, reasserts existing date/reporting authority after mutation, creates, attaches exact step. Cannot manufacture an outbound Z10 registry step. |
| `actorRole.ts`, `systemTestPackages.ts`, `systemTestSettings.ts` | Operational role resolver/runtime packages support supplier/esco. `grid_owner` in broad `EdielTestRoleCode` is not active runtime capability; resolver returns null before DB reads. No implicit role alias is permitted. |
| `prodat/engine.ts` → builders/z10 → profileRenderer; `buildProdat.ts` | Pure/generic Z10 builder APIs and canonical diagnostics/evidence exist. They accept output context, not independent saved meter replacement history. |
| `prodat/compatAdapter.ts`, `flows/prodatSwitch.ts`, orchestrator manual facade | Supplier outbound Z10 remains rejected; `prepareAndQueueEdielZ10` calls `blockedSwitchFlowCode`. Do not activate it. |
| `flows/inboundProcessing.ts`, `inboundBusinessStateMachineLegacy.ts`, `safeApplyReview.ts`, lifecycle | Received Z10 can create review/safe-apply proposals, not destructive automatic meter-history replacement. Inbound parsed values and received-event labels do not constitute an independent outgoing before/after authority. |

Search of `lib` and migrations for meter-change/replacement and old/new meter
names found semantic registry/lifecycle/review paths, not a producer exporting a
versioned per-object pre/post settlement/product/threshold aggregate to Z10.
This is a bounded current-code finding, not a claim about live DB contents or
all future meter/billing implementations. No live records were inspected.

## Current consumers and concrete gaps

1. `prodatDependentConditionEngine.ts` assigns both Z10 cells to
   `explicitCellFact`. `byCell['Z10:254'|'Z10:242']` true/false controls current
   required/not_required even without an event and even with gas/unknown market.
   The accepted Z06 override in `prodatSubtypeRequirement.ts` is separate.
2. `canonicalPolicyFieldValidator.ts` skips migrated source rules but these two
   Z10 rules remain generic. Its loop consumes root condition statuses and
   `fieldRulePresent`; it has no per-object change-fact evaluator. In a scoped
   actual-module probe, both absent fields produce zero D-only errors with root
   false, and two U errors with unknown. This does **not** prove SMTP would send:
   existing date/register/role/version gates remain independently operative.
3. `prodatRegisterEvidence.ts` explicitly copies approved fact subsets and
   body-binds decoded wire content. It drops byCell and any proposed meter-change
   aggregate. Its integrity binding is not a signature or persisted authority.
4. `rulebook/validator.ts` normal path reads evidence, resolves policy, and may
   use rendered condition snapshots. In test mode generic U is downgraded unless
   protected scope. Catch path reruns protected subtype, register, address,
   invoicee, date and reporting checks. Neither path has Z10 change facts.
5. `core/messageBuilder/payloadPreflight.ts` raw and row entrypoints have shared
   tokenization, source-family binding, register and existing dependent checks;
   both need the same Z10 protected policy, including catch/authority errors.
   Stale row labels must not hide actual raw Z10, nor raw/row mismatch qualify it.
6. `rulebook/sendGuards.ts:assertRulebookAllowsSend` protects `prodat_dependent`
   and `prodat_register` issues before `rulebookAllowInvalidSend`.
   `transport/sendLock.ts:assertEdielSendLock` protects the corresponding
   preflight prefixes before the general test/production send lock. New Z10
   findings must use these protections, never lower to generic test warnings.
7. `orchestrator.ts:sendQueuedEdielMessage` loads existing date/reporting context
   before row preflight. `outbox/sendOutboxItem.ts` eventually calls shared SMTP.
   Actual `transport/index.part-2.ts:sendEdielMessageViaSmtp` independently reloads
   date context for raw-or-row Z06/Z09/Z10 and reporting context for Z13; it runs
   both guards before route/provider branches and snapshot side effects. Extend
   that actual boundary with independently loaded Z10 context; testing only an
   orchestrator or mocked shared SMTP is insufficient.
8. `db.ts:attachEdielMessageToTestRun` retains generic insert/duplicate recovery,
   including by-step fallback. `system-tests/actions.part-4.ts` has exact
   association handling only for reporting Z13. Other direct sends can attach
   again; create-and-send attaches with null step. Future Z10 handling must
   validate its unique existing exact link and never create a null-step second
   association. Generic duplicate recovery is not Z10 ownership proof.

## Proposed one-owner data contract (not runtime authorization)

One pure owner, proposed `prodat/prodatMeterChangeFacts.ts`, defines parsing,
deep copying, three-valued evaluation and the selected254/242 identity contract.
Use a single `meterChange` property in `ProdatDependentConditionFacts`; do not
add booleans into byCell, root metadata, portal output data or duplicate stores.
The following is a concrete proposed **EL** shape. It is documentation, not
generated/database types, and must undergo independent architecture review.

```ts
type Id = string; // nonempty bounded identity; UUID only for internal keys
type Minute = string; // canonical 12 digits, real calendar minute, fixed UTC+1
type Settlement = 'Z31' | 'Z32';
type Product = 'L639Q'|'L640Q'|'L654Q'|'L917'|'L633Q'|'L634Q'|'L635Q'
  |'L636Q'|'L637Q'|'L638Q'|'L641Q'|'L642Q'|'L651Q'|'L652Q'|'L653Q';
type Party = {id: Id; qualifier: string; agency: string};
type Ref = {key: Id; revision: Id; eventKey: Id; reference: string};
type Known<T> = {kind:'unknown'} | {kind:'known'; value:T; evidence:Ref};
type Selector = {workbookSha256:string; sheet:string; entityLabel:string;
  blockIndex:number; columnName:string; columnIndex:number};
type CustomerScope = {kind:'test_customer'; selector:Selector}
  | {kind:'domain_customer'; customerKey:Id; revision:Id};
type Threshold = {kind:'unknown'}
  | {kind:'applicable'; below:boolean; regime:Ref; assessment:Ref}
  | {kind:'not_applicable'; regime:Ref; assessment:Ref};
type MeterChangeObject = {
  objectKey:Id; event:Ref; customer:CustomerScope;
  installation:{id:Id; agency:'9'|'89'};
  legalGridOwner:Party; legalSupplier:Party;
  reason:'E58'; effectiveMinute:Minute; li:Id;
  oldMeter:{number:Id; settlement:Known<Settlement>; product:Known<Product>};
  newMeter:{number:Id; settlement:Known<Settlement>; product:Known<Product>};
  newMeterThreshold:Threshold;
};
type Route = {settingsId:Id; actorSettingId:Id; routeProfileId:Id|null;
  communicationRouteId:Id|null; transportProfileId:Id|null;
  sender:Party; recipient:Party; senderId:Id; receiverId:Id;
  senderQualifier:string; receiverQualifier:string;
  senderSubaddress:string|null; receiverSubaddress:string|null;
  applicationReference:'23-DDQ-PRODAT'; transportType:'manual_upload';
  mailbox:string; receiverEmail:string|null};
type SourceSelection = {kind:'builtin'|'dynamic'; id:Id; revision:Id;
  digest:string; selectors:Selector[]};
type TestScope = {companyId:Id; runId:Id; suite:'PRODAT';
  runtimeSuite:'TGT'; caseCode:'5.2.1'|'5.2.2'; roleCode:'grid_owner';
  stepNo:1; code:'Z10'; actor:'gridex'; direction:'outbound'; environment:'test'};
type CallerSelection = {source:{kind:'caller_selection'; reference:string};
  market:'electricity'; objects:MeterChangeObject[]};
type SavedTestSelection = {source:{kind:'tgt'; scope:TestScope;
  selection:SourceSelection; factsRevision:Id; actorId:Id;
  sourceNote:string; recordedAtUtcMs:number; route:Route};
  market:'electricity'; objects:MeterChangeObject[]};
type Selection = CallerSelection | SavedTestSelection;
type ExpectedContext = {source:SavedTestSelection['source'];
  market:'electricity'; objects:MeterChangeObject[]};
type StepEntry = {state:'active'; value:SavedTestSelection}
  | {state:'cleared'; factsRevision:Id; actorId:Id; sourceNote:string;
     recordedAtUtcMs:number};
type Notes = {version:1; companyId:Id; runId:Id; steps:Record<string,StepEntry>};
type EvidenceInput = {reference:string; rationale:string};
type Observation<T> = {kind:'unknown'}
  | {kind:'known'; value:T; evidence:EvidenceInput};
type Assertion = {selector:Selector; oldMeterNumber:Id; newMeterNumber:Id;
  effectiveMinute:Minute; oldSettlement:Observation<Settlement>;
  newSettlement:Observation<Settlement>; oldProduct:Observation<Product>;
  newProduct:Observation<Product>; threshold:{kind:'unknown'}
    | {kind:'applicable'; below:boolean; regime:EvidenceInput; assessment:EvidenceInput}
    | {kind:'not_applicable'; regime:EvidenceInput; assessment:EvidenceInput}};
type Command = {operation:'set'; sourceNote:string; objects:Assertion[]}
  | {operation:'clear'; sourceNote:string};
```

This test scope names actual **original** network-owner case identities for a
future proposal. They are not in the current runtime registry and cannot be
accepted by a save/build/send API now. No active supplier case is relabeled as
network owner. A future domain source is deliberately not included in `Selection`
until an independently persisted domain producer and ownership resolver exist.

Strict decoder rules: all discriminant-specific keys mandatory, exact key sets,
no unknown keys, missing nested structures, undefined-as-false, coercion, arrays
as objects, excess slots, duplicate object/installation/event/selector or LI
identities. Parse and deep-copy every nested value at each public boundary;
never shallow spread unvalidated input into facts/notes. Allow `unknown` only
through the explicit union branches. Missing entire selection remains U for a
pure caller and unqualified for sender; null clear invalidates old authority,
not “both predicates false”. Preserve unrelated existing note fields.

All refs must carry the same eventKey and current fact revision for their
object; old/new meter numbers are different, nonblank an..35 original business
identities, never invented UUID substitutions. Installation agency9/89 and
value must match own wire LIN, E58 and LI must match own first occurrence, and
effectiveMinute must match field216. Technical event/object keys may be
server-generated once, stable across unchanged saves; revision changes on
material reassessment or clear. Technical keys never fill meter, legal party,
customer or source identity. Test customer identity comes from the exact workbook
entity selector; Z10's absent NAD+UD is not permission to fabricate a customer
party ID. Legal sender/recipient come from separately authorized role/runtime
and source case, not caller-selected NAD or a supplier-to-grid reversal.

Compute changes by comparing independently known old and new values for this
event; missing either side yields U. Never compare output to itself. Threshold
assessment records its regime and applicability provenance, not a locally
invented numerical limit. Assessment source/reference must be separate from the
wire body and must not merely assert “field present” or “test green”. Source
columns may constrain expected new output or explicitly declared scenario
semantics, but cannot by themselves establish all before values or threshold.

Pure callers can use a validated `CallerSelection` to render/validate fixtures.
Body-bound serialization must omit any caller claim to persisted authority,
and persisted read/send rejects caller_selection outright. `ExpectedContext`
is separately constructed from tenant-loaded run, current notes, exact source
revision and runtime route; equality to caller-created parsed metadata is not
authority. Even a caller-forged `kind:'tgt'` envelope cannot bypass that reload.
Operator commands accept only the strict `Assertion` shape above: no caller
event keys/revisions, legal parties, customer authority, route, persisted kind,
LI or trusted-context override. The owner assembles those separately from
source/run/runtime and stable server-assigned technical keys; it verifies
asserted old/new IDs and event time against original source constraints.

## Concrete future integration and lifecycle, subject to the blocker

1. Add a bounded Z10 predicate/field policy consuming only `meterChange`, with
   per-first-register identity selection and the truth tables above. Route both
   cells out of the legacy condition loop; no root snapshots/byCell override.
   Keep Z06 and all pure field validators unchanged. Outbound unknown/invalid
   source gets protected D issues. Inbound uses p119 semantics separately.
2. Extend canonical builder/profile renderer and generic `buildProdat.ts`, TGT
   renderer and `validateEdielTgtDraft`, fact copying/evidence, normal/catch
   rulebook, raw/row preflight and both protected guards consistently. Reuse
   shared tokenizer/encoder at every integration boundary. In particular the
   TGT non-reporting envelope still uses `parseEdifactSegments`; do not trust
   literal quote splitting when references contain released code-looking data.
   Test default and custom UNA; strings containing `CCI`, `RFF` or `UNH` remain
   data. Do not replace the shared codec or weaken grammar/structure gates.
3. If and only if a source-backed test producer is separately approved, use
   strict notes under `prodatMeterChange`, one canonical owner for all source
   assertions. A `saveTgtMeterChange` action must authorize write/company/run,
   validate exact registry step plus approved actor/runtime, reload source
   identity and route, validate all assertions, and CAS on current `updated_at`
   **and** old notes. Every new tenant read and write must call actual
   `tenantDb(companyId)`; do not copy the older service-client register-note
   write or alter the2402 ratchet. Shared source catalog reads are source
   selection, never tenant/customer authority.
4. Save request carries displayed expectedRunUpdatedAt and expectedFactsRevision;
   null expected revision allowed only for a genuinely missing entry. Reject
   stale save/clear, compare both expectations after reload, then assign a fresh
   revision. Cleared tombstone remains visible and prevents older evidence
   from reviving. Source/route/actor/old-new meter/event changes make saved
   assessment stale. Reassessment requires explicit set; no silent fallback
   from changed imported data to built-in source. No automatic send.
5. Form must be mounted in the actual imported-case/run page, analogous to
   `system-tests/cases/[id]/page.tsx` and `EdielReportingPermissionForm`.
   Show exact source selection, old/new meter and event, independent old/new
   assessments and threshold/applicability rationale; show saved assessment,
   revision, missing/stale/cleared state and explicit clear. Unknown selections
   are allowed to save as incomplete but cannot authorize a send. Do not expose
   a generic loose JSON payload as a replacement for the assessment flow.
6. Manual create and actual autopilot load current typed facts/context from the
   same owner; source-family runtime comes from actual definition.suite, never
   ACK wire family. Reassert body/row/source/route after final autopilot route
   mutation, before create. Creation is not send authorization. After exact
   attachment, reload and assert one unique company+message association before
   marking the draft ready or sending; zero/two links, null/wrong step, wrong
   case/role/family/direction/run or label mismatch fail closed. Do not rely on
   generic attach's by-step duplicate fallback or accept returned wrong message.
7. Both real system-test send actions must select the already existing exact
   link. An omitted step is resolved from that unique link; supplied conflicting
   selectors fail. No null-step reattachment. Orchestrator, outbox path and
   **actual shared SMTP** independently reload current context; a selector must
   detect raw OR row Z10. Both guards run before provider/snapshot branches.
   Changed notes revision, route, source digest, event, customer or meter identity
   invalidates existing drafts even if bodyBinding was recomputed.

The bounded next runtime option is pure/consumer work **only after
review and explicit authorization**, retaining unqualified persisted Z10 sends.
Closing both cells end-to-end with saved authority additionally requires a
separately authorized test-producer capability decision. Original5.2.1/5.2.2
give candidate test identities, but adding registry rows alone is insufficient:
network-owner role resolution, operational test package, actor settings, source
qualification and independent missing facts must be resolved without changing
the current supplier meaning. Current instructions prohibit activating those
roles/settings, and this audit performs no such work. This is a concrete
capability gap, not evidence that PR310 must be resumed. No full two-cell
acceptance can be claimed from pure caller fixtures alone.

Masterplan §§1.1–1.2/20/21 retain active product roles DDQ/DGI. A network-owner
role is not authorized just to complete the110-cell counter. Option A for the
current unit is normative pure-policy coverage, p119-preserving active inbound
handling and an explicit fail-closed persisted outbound boundary; distinguish
those results in acceptance evidence. Option B is a separately unqualified
role-specific persisted producer, requiring a product/capability decision
outside this task. Its absence does not prevent independent Option A work and
is not a recommendation to activate DSO roles. Future5.2.1/5.2.2 types above
describe the boundary that would be needed, not an implementation to start now.

## Verification and review handoff

Scratch evidence directory: `/workspace/scratch/2a201d6d5897/z10-source-probes/`.
It contains p20/p67/p68 renders, extracted PDF text, exact workbook coordinate
extract, `current-source.test.ts`, `source-contract-red.test.ts`, vitest config,
registry output and JSON results. All probes import actual current modules,
use fixed synthetic fixtures, and perform no live DB/storage/provider operation.
The immutable script `scripts/test-ediel-prodat-characteristic-fields.cjs` was
read to understand its original-source fixtures and loader; it was not changed.

| Command / check | Actual result |
|---|---|
| sha256sum on the two original files | Both exact hashes above match. |
| Visual p20,p67,p68 plus original context/cell extraction | Completed, differences/limitations recorded above. |
| `node node_modules/vitest/vitest.mjs run --config /workspace/scratch/2a201d6d5897/z10-source-probes/vitest.config.mjs current-source.test.ts --reporter=json --outputFile=/workspace/scratch/2a201d6d5897/z10-source-probes/characterization.json` | 10/10 observation tests pass. Passing observations are not protocol acceptance. |
| Same command selecting `source-contract-red.test.ts`, output `red.json` | Expected RED:0/4 pass,4/4 fail. Both true and false root flags still determine each cell without independent event facts. |
| First scratch configuration attempt | Startup failed on an absolute Vitest package-export import. Corrected only scratch config to `vitest/config`; successful characterization follows. No production/immutable loader modification. |
| `npm run ediel:masterplan-v2:integrity` | PASS:33 original files,121 rules,231 acceptance contracts; application conformance/production readiness explicitly false. |
| `git diff --check` | PASS; staged audit also checked before commit. |

Confirmed gaps are source-contract/architecture findings, not verified market
sends or security exploits. False positives ruled out: “no Z10 builder” (pure
builder exists); “notes function is server authorization” (it is not); “grid_owner
union means active role” (runtime rejects); “import creates registry steps”
(it only supplies source data); “PR310 required” (not established); “output
settlement/profile proves below threshold” (unsupported); “test missing facts
prove inbound sender error” (p119 forbids that conclusion).

Independent reviewer must adjudicate the scope/false branches and proposed
strict contract, confirm full path and absent current producer, and decide
whether to approve bounded consumer-only runtime next or hold for a separately
qualified producer. Whole-workstream completion, live readiness, changed
acceptance counts and positive persisted Z14 qualification are not asserted.
No unrelated full suite or runtime acceptance suite was run in this source
phase. Scratch observations and expected RED contracts are the entire executed
application probe scope.
