# Four date/event cells — source qualification, 2026-09-19

Status: RUNTIME IMPLEMENTED under root authorization after independently approved
source/spec and architecture correction `953c9a8d`. Awaiting independent runtime
review and release receipts; no new acceptance credit. Earlier sections retain
the source reasoning and the chronology of the source-only phase.

Scope: PC-210-Z06, PC-210-Z10, PC-210-Z09, PC-211-Z09 only. Branch
`codex/ediel-date-events-20260919`; accepted base PR344 merge
`c9d795275fc22b284db51e70b25ec4ccb7d00d3a`; inspected task-start HEAD
`52b99412ea2e1c846fff1d3a7c1c0c3c4cb5add5` (root memory checkpoint).
Root owns release receipts and current counts. No historical count is promoted
here. PR310 remains paused at `e961135199f292b8210884f07de3b616a670161a`.
No paused SQL/types/grants/proof infrastructure is imported.

## Routing and method

Read AGENTS, current memory/readme/task/checkpoint/handover/blockers/work-plan,
domain-model/canonical-flows/integrations, decisions and known failures; inspected
actual implementation and clean branch before work. Read frozen masterplan v2,
its field/conditional inventory, prior date and remaining-dependency audits as
pointers, then independently re-read the original field definitions and full notes.

Applicable local workflows: subagent-driven-development (this fresh bounded
implementer; parent supplies independent review), spec-to-code-compliance
(source/call-path evidence, independent refutation delegated to parent review),
systematic-debugging (reproduce before changes), verification-before-completion.
`using-superpowers` explicitly exempts dispatched subagents. `fp-check` is
security-specific and excludes nonsecurity tasks: equivalent direct verification
and controls below satisfy AGENTS' finding-verification requirement. Inspected
acquire-codebase-knowledge and quality-playbook triggers: this is a four-cell
source qualification, not repository onboarding or a complete baseline audit;
no generated seven-document map or full quality-system regeneration. The brief
is the bounded execution plan; runtime TDD, receiving-code-review, differential
review and completion gates activate after authorization/review. Existing branch
provides isolation; no concurrent implementation or new worktree required.
No UI, performance, dependency, scanner/hook/skill installation, database change,
RLS migration or live deployment is in scope. Schema reads below are provenance
inspection, not a database/security certification. Root owns memory updates.

## Original authority and scope

Original preserved at
`/workspace/scratch/2a201d6d5897/prodat-original-source/PRODAT-26A-r3.pdf`.
Fresh SHA-256:
`83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95`.
Printed and PDF page numbers coincide. Fresh `pdftotext -layout` extraction is
`/workspace/scratch/2a201d6d5897/date-events-original.txt`. Visual inspection of
pages 17, 50, 112, 115, 116 and 121 checked continuation, table columns, event
wording and register overlay; page images are scratch evidence, not edited originals.

* P15 §2.2 defines D as conditional information, mandatory under specified
  circumstances. It says the matrix covers register 1 and §2.2 overrides conflicting
  annex 4 conditions. D does not, by definition, make every false branch forbidden.
* P16 starts field210: delivery start, not signing time, creation137 or change216.
  P17's top unnumbered continuation belongs to210 from p16.
* P17/p50 exact Z06/Z10 sentence: “Om ändring gäller en ändring som sker före
  leveransstart är ”avtal startdatum” obligatoriskt och meddelande ska skickas till
  den framtida leverantören.” P50 precedes it with “Z06/Z10:”. The date requirement
  and the future-supplier routing obligation are both present; a required-date
  implementation alone does not establish routing compliance.
* P17 exact210 Z09 note: “Används enbart i Z09D och då endast i anslutning till att
  avtal om produktion tecknas.” P17 exact211 note: “Används enbart i Z09D och då
  endast i anslutning till att avtal om produktion avslutas.” P50 independently
  describes the signing/cessation events and identifies210 as delivery start,
  211 as delivery end. The payload is the supply boundary, not event recording time.
* P109 full Z06E process says only customer information is sent; other fields
  are omitted except mandatory fields under §2.2. Thus before-start210 remains
  mandatory, but nonmandatory210 has a Z06E process exclusion. Death/bilateral
  authority is separate and not supplied by these date facts.
* P110 fixes Z10 meter-change validity216 at00:00 on the EL change day. That
  constrains the source of the comparison boundary; it does not make every
  contract date midnight or accept field216 generally in this unit. P111 says
  Z06F follow-up MSCONS/UTILTS is not sent to the future supplier. The210 message
  routing note must not be generalized to subsequent readings. Neither adds
  another cell or follow-up process to this unit's acceptance scope.
* P17 field216 says Z09 except D; D uses210 or211 instead. P112 full Z09 process
  says a producer contract is signed or ceases; on signing use Contract start date,
  on cessation use Contract stop date instead. This is production purchasing,
  not any consumption contract end, meter installation or permission event.
* P17 explicitly prohibits210 and211 together in Z09D and prescribes APERAK
  A903 code109. P121 repeats that check. This explicit §2.2 rule is not displaced
  by the generic annex 4 extra-information rule. P134 gives a signing example with
  only210; example presence is corroboration, not independent event evidence.
* P50 exact locators:210 SG8/DTM/C507, 2005=92;211 same with2005=93; values2380
  and format2379=203 `CCYYMMDDHHmm`. They belong to the LIN object's SG8, not an
  optional NAD party parent. No UD/IT/IV parent absence makes these dates inapplicable.
* P43 and field206 p16: all PRODAT times use fixed UTC+1 standard time throughout
  the year, including summer;206=`DTM+ZZZ:1:805`. P115–116: only Z04/Z06/Z10
  support registers; first-register common data is authoritative, later repeats
  cannot supply or override it.210/211 are not register-local rows in annex 2.
* P119: additional X/false-D information must not cause negative APERAK or be
  used as ordinary accepted business data. Local knowledge gaps are also not
  evidence of sender error. Format/structure checks and explicit §2.2 exclusivity
  must remain distinguished from conditional business applicability.
* Active scope remains EL. GAS examples (including p39 06:00 gas switching) do
  not establish EL start times or activate GAS. Original codes are decoded through
  existing registry: Z06 E34/E64/E32, Z10 E58, Z09D Z70. Root subtype, code label,
  sibling reason and later-register reason cannot supply the object's actual223.

### Source tension and proposed outcome table

The frozen `prodat_conditional_cells.json` marks false outcomes X for the two
Z06/Z10 timing cells. No universal exclusion of210 at/after
supply start across all Z06 subtypes and Z10 was found in its full p16–17 note, p50 definition, p109–112 process,
p115–116 register continuation or p121 check. In contrast, the Z09 notes explicitly
say “enbart”/“endast”. Therefore do not turn frozen false=X into a new prohibition.
Retain originals and register the tension here. Proposed source interpretation:
known not-before means **not mandatory** at the date-field level. For Z06F/G and
Z10, supplied valid210 is permitted subject to correct independently sourced supply
date and process scope; for Z06E the p109 process overlay omits nonmandatory210. This is a proposed
bounded interpretation for review, not a rewritten original or certified routing rule.

| Cell/context | Required inclusion | Prohibition/other branch | Unknown |
| --- | --- | --- | --- |
|210 Z06/Z10, exact change before exact relevant supply start |210 with the relevant supply start; future legal supplier recipient required |At/after:210 not mandatory; no blanket prohibition. Z06E p109 omits nonmandatory210. If otherwise supplied, do not accept a different contract's date. |Missing/ambiguous process, temporal or supplier evidence stays unknown; never false from absent210. |
|210 Z09, own223=Z70 and signed production-contract event |210 equals that contract's supply start |211 forbidden for that event; non-D210 excluded outbound |Own D with missing event cannot choose signing from presence210. |
|211 Z09, own223=Z70 and production-contract cessation event |211 equals that contract's supply end |210 forbidden for that event; non-D211 excluded outbound |Own D with missing event cannot choose cessation from presence211. |
|Z09D wire invariant |Exactly one of210/211 (p17/p112; masterplan §8 explicitly XOR) |Both is explicit code109 case;216 cannot substitute |Knowing XOR does not establish which real event occurred or authorize a mutation. |

Inbound non-D extra dates follow the source's ignore rule rather than the outbound
prohibition. For own D, explicit wire XOR and supplied-date syntax can be checked
without local event evidence; a valid single date is a sender assertion, not proof
of the local production-contract lifecycle. Unknown independent evidence must not
by itself produce negative APERAK. No new external error code is invented here.
Handbook-specific valid-day/deadline rules are not freshly qualified by this PDF
pass; calendar validity and minute precision are not full business-date validity.

## Actual producers and consumers

| Boundary | Inspected implementation and actual behavior |
| --- | --- |
|Value codec and date builder |`prodat/render/dates.ts`, `dateSegments.ts`: strict calendar203, fixed-offset instant conversion, explicit-null alias precedence. Builder omits subtype-inapplicable dates and throws for both Z09D dates. It does not know the business event or supply/change comparison. |
|D engine |`prodatDependentConditionEngine.ts` GROUPS210/211 still call `explicitCellFact`; source notes are merely “Giltigt … enligt Handboken”. Four cells accept root `byCell` true/false, not per-object provenance. These cells have no source subtype requirement entry. |
|Generic builder |`buildProdat.ts`: per-object dates/identity, but `dateSubtype` uses root `transactionSubtype` except Z14. Its own223 already determines UD scope for Z09; date selection still uses root. OwnD/rootF silently omits supplied210, reproduced below. This is separate from event evidence. |
|Profile builder |`builders/profileRenderer.ts` + `builders/z09.ts`: date inputs from context/snapshot; resolved dependent facts enter policy; diagnostics persist statuses and register evidence. A root false status can accompany a rendered210. Snapshot clear behavior and existing date exclusions must remain. |
|Canonical field validation |`canonicalPolicyFieldValidator.ts`: base validation in parse mode, then unmigrated D status loop. `fieldMatrix.ts` checks actual own223/date exclusions and first-register scopes; present required dates must exist for every applicable object. No raw210/211 XOR check found. Unknown generic D produces a blocking issue even on the direct inbound canonical path. |
|TGT source selection |`tgtProdatSource.ts` and `tgtEdifact.part-2.ts:getPortalDataRows`: original function columns grouped by exact209+agency, first-register object scope; dates selected by field number, not field-name search. `agreementStartDateTime` is a value, not a signing event. |
|Authorized TGT notes |`actions.part-2.ts:saveEdielTgtRegisterFactsAction` checks write access, scoped run/company, operational company, exact expected outbound Gridex PRODAT step; optimistic updated_at write. `tgtRegisterFacts.ts` binds run/company/role/case/suite/step/code and original-source digest. Current allowlist has no date-event facts; proposed object is dropped, reproduced below. |
|TGT draft/persistence |`createEdielTgtDraftAction` and `tgtAutopilot.ts` read notes; `tgtEdifact.part-3/4.ts` build/validate and persist `prodatEngine.registerEvidence` plus portal rows. Synthetic2.5.3 with210 but no independent event currently returns `draft_ready`. Rows, labels, expected segments and “ready” cannot establish the event. |
|Persisted evidence |`prodatRegisterEvidence.ts`: allowlist market, readings, registerObjects, endUserAddressObjects, invoiceeObjects; body binding is integrity only. No date-event source survives. Root rendered statuses are still accepted for these unmigrated D cells by `validator.ts:canonicalizeRenderedDependentSnapshot`. |
|Preflight and send guards |`payloadPreflight.ts`, `rulebook/validator.ts`, `sendGuards.ts`, `transport/sendLock.ts`: source-migrated defects get protected scopes before intentional-invalid-test escape. The four cells have no such dedicated policy. Missing-snapshot catch rechecks subtype/register/address/invoicee but no210/211 event/XOR. Test unknown generic D is downgraded. Existing real production readiness remains separate. |
|Legacy context projection |`core/messagePolicy.ts` reads root/nested `byCell`; it does not resolve date/event objects from authoritative lifecycle records. It is not a live producer. |
|Compatibility adapter |`compatAdapter.ts:renderProdatSegments`: portal agreementStartDateTime → requested_start_date → site.move_in_date supplies `startDate`; role-specific aliasing later decides meaning. No independent date-event producer. Z06/Z10 outbound direction is rejected; switch construction is not production-event authority. |
|Live orchestration |`flows/prodatSwitch.ts:prepareAndQueueEdielZ06/Z09/Z10` all call `blockedSwitchFlowCode`. `operations/businessActions/endAgreement.ts` and `operations/edielAutomation.ts` call the blocked Z09 facade, without a typed production-contract cessation event. Do not enable them as part of a field correction. |

### Candidate lifecycle evidence: present records are not a qualified producer

`customerSiteProcessContext.ts:isContractOperationallyReadyForSite` queries company,
customer and site, signed/active contracts; optional contractId otherwise latest
signed/limit1. It returns requested_start_date or date-only starts_at. This establishes
readiness for its caller, not the exact affected production contract, change event,
minute boundary or future supplier for these cells. Reusing its first/latest selection
would be unsound for multiple contracts and energy directions.

`20260725120000_billing_readiness_and_supply_activation_v1.sql` shows exact-company
switch lookup, contract references, confirmed/requested/actual start DATE and supply
period creation. The current activation sweep in
`20260903090000_atomic_supplier_switch_activation_sweep.sql` separates confirmed
future start from effective activation. These records are candidates for supply
provenance, not proof of a Z06/Z10 change-effective timestamp or future supplier
routing decision. No local/live schema equivalence is asserted from migration text.

`20260829140500_operations_foundation_contract_lifecycle_v1.sql` detects the edge to
signed and explicitly skips non-consumption contracts, recording
`contract.signed.lifecycle_skipped` with contract/energy-direction identity. That is
not a production Z09D event producer, nor a cessation event. `deadlinePolicy.ts`
has the named `production_purchase_contract_start_or_end` anchor but no producer
of the four facts is established by that name.

Missing live authority is specific: exact tenant/legal actor/role/environment;
object+agency and energy direction; exact process and contract/version; active,
not superseded/cancelled signing/cessation or change event; authoritative effective
minute/boundary semantics; and (before-supply Z06/Z10) future supplier relation
plus legal/technical route mapping. Do not infer from customer status, newest
contract, field presence, source digest, selected output, SMTP or successful TGT.
This audit finds no demonstrated requirement to import PR310 to implement pure
field policy or authorized TGT evidence. A live producer remains separately
unqualified; PR310 is not presumed to be its only dependency or solution.

## Fresh actual-module probes and refutations

Scratch suite: `/workspace/scratch/2a201d6d5897/date-events-source-probe.test.ts`.
Config, JSON observations and run logs share `date-events-probe` prefix. No copied
runtime implementation; actual modules execute. DB boundary throws
`NO_EXTERNAL_DB`; no credentials, database/storage/network send or mutations.
The proposed `dateEventObjects` probe input is deliberately not an existing API:
its disappearance demonstrates absence of a producer/evidence contract, not a
claim that callers previously had such an API.

Nineteen characterization cases pass against unchanged runtime. They assert the
observed baseline, including defects; they are NOT green regression/fix evidence.

| Cases | Observation and classification |
| --- | --- |
|Z06/Z10 root false (2) |Missing210 accepted by selected date rules despite supplied synthetic before-start context; context is ignored and root byCell controls decision. Confirmed contract gap, not proof of a supported live producer being bypassed. |
|Z09 root both true; raw both supplied (2) |Two missing-date errors when both true; with both dates present no selected date-rule error. Confirmed mutually inconsistent byCell decisions and absent raw XOR validation. |
|Builder exclusivity (1) |Actual date builder throws with both. Refutes a blanket claim that every entry point accepts both. |
|Direct canonical inbound unknown (1) |Two blocking unknown-condition issues for one valid210 without local event. Direct function path only; no complete ingress/ACK run claimed. |
|Own non-D reason (1) |Actual ownZ27 excludes210 even with rootD. Existing outbound validation protection retained. |
|Evidence copy + TGT notes (2) |Independent event shape does not survive existing allowlists. Both boundaries need an explicit contract. |
|Sibling missing (1) |A210 does not satisfy B's required210. Existing all-object presence protection retained. |
|Date/time normalization (1) |July local date→midnight; +02:00 instant shifts to previous day's23:00 standard time; equivalent Z instant matches; DST-fold instants remain distinct standard minutes. |
|Generic / profile value-only (2) |Render210 without independently sourced signing event; profile persists rootfalse status. These outputs are not lifecycle proofs. |
|Generic rootF/ownD (1) |Valid ownD210 silently omitted due to root dateSubtype. Confirmed source-scope mismatch. |
|Actual TGT2.5.3 draft (1) |Synthetic source210 becomes outgoing92 and returns draft_ready with no independent event facts. No portal or live approval inferred. |
|Normal test guards (1) |With a complete rendered-status snapshot of not_required and intentional-invalid flag, both actual send guards allow synthetic raw simultaneous210/211. Unrelated missing ordinary fields are present in this minimal probe and explicitly bypassed by that test mechanism. |
|Production missing snapshot (1) |Rulebook reports missing snapshot, then rulebook guard returns under allowInvalid; no protected date finding. Transport guard DOES block unrelated production metadata/profile/readiness errors. This is not a proven production transport bypass. |
|Later-register supply / first sufficient (2) |Later210 cannot fill first's missing required210; first210 with later omission passes. Preserve existing first-register semantics. |

Initial14-case discovery run:13 pass/1 failed because the probe expected both
production guards to allow; observed transport production blockers refuted that
hypothesis. Probe was corrected to record/assert the actual blocked transport
boundary, then extended to19 cases. No old assertion or production code changed.
Material findings above are medium field-correctness/incomplete-authority findings;
raw XOR lacks defense at external entry paths, while live impact remains bounded
by existing capability and production guards. No tenant compromise is claimed.

## Proposed smallest implementation contract (not implemented)

Treat all four as one bounded date-field policy unit with **two distinct business
fact variants**, shared object scoping and evidence transport. They are not one
live lifecycle process. Keep protocol selection in canonical policy and central
field validation; do not make a second independent rule store.

1. Add an optional, strictly validated `dateEventObjects` collection to existing
   dependent facts and the existing server-owned persisted evidence envelope.
   Each entry owns only exact decoded `meteringPointId` + `identityAgency`
   (`9`/`89`) and a discriminated business fact below. Company, environment,
   market=`electricity`, function and legal actors belong to the canonical
   build/row context, not independently writable copies on each object. A single
   `dateEventSource` beside the collection owns provenance as specified below;
   necessary overlaps with existing evidence/notes envelopes must compare equal.
   Bind context to company/environment and legal actor(s); enforce exact object
   set, duplicates, missing/extra objects, namespace mismatches, invalid register
   chains and cross-message boundaries. First-register own223 determines subtype.
   Root facts/statuses are diagnostics only and cannot select these four outcomes.
2. `change_before_supply` variant for Z06/Z10: independent source reference for the
   exact change event and process/version, exact supply relation/contract/version,
   `changeEffectiveAt`, `supplyStartsAt`, and the relation's legal supplier identity.
   Call that supplier “future” only when before-start is true; equality/after
   does not require an invented future relation. Temporal knowledge and route
   readiness are separate results: unknown route does not erase a known comparison.
   Compute strict `<`; equality is not “before”. Compare actual216 to sourced
   change boundary and supplied210 to sourced supply boundary. Missing time or
   ambiguous relation is unknown, never false. Known false makes210 not mandatory at the field level; apply the p109 Z06E
   exclusion of nonmandatory noncustomer fields. Do not generalize that exclusion
   to Z06F/G or Z10. Supplied210 still needs the correct source value; it must not
   self-prove the supply relationship. For the required before-start future-supplier message, compare legal NAD+DO
   to the independently sourced future supplier, not merely UNB technical receiver.
   This proves that required routing leg only; the note does not establish a
   blanket ban on other separately authorized copies or a complete routing rewrite.
   Require separately established routing/mandate before live send. The initial
   scope has no live producer. Only the authorized TGT mapping specified below
   permits a simulated recipient; source.kind alone is never an exemption.
3. `production_contract` variant for Z09: independent event kind
   `signed` or `ceased`, exact production contract/process/event revision and
   selected `supplyBoundaryAt`. Record source event's occurrence time separately
   if available: signing/recording time is not the210 supply start, and a termination
   notice creation time is not211. Reject incompatible consumption direction and
   simultaneous/conflicting events; never choose latest. Own non-D dates excluded
   outbound regardless of injected facts. OwnD selects required210/forbidden211
   for signed, inverse for ceased; unknown event blocks outbound readiness without
   fabricating “no event”. Wire XOR is independently checked for ownD.
4. `caller_selection` is an assumption for pure/test evaluation only. Generic or
   profile builder success, serialization, persistence, matching company or body
   equality cannot promote it to real lifecycle authority. Its common source has
   only kind and reference; canonical context supplies its owner. Persisted send
   readiness never accepts caller_selection as an authorized date-event producer,
   even in test. A pure evaluation may report field outcomes but must retain its
   unqualified source/readiness result. There is no initial production source kind,
   authority flag or live event loader; both TGT and caller sources remain incapable
   of satisfying production lifecycle readiness. Keep live facades blocked.
5. Domain copying and source stamping are separate operations. A strict copier
   validates/deep-copies the object keys, discriminated facts, nested event/process/
   contract references, supplier identity and timestamps; it does not add/change
   a source kind. The authorized server TGT constructor below alone stamps the
   TGT source after checking the independent operator assertion and source selection.
   Operator date-event JSON contains domain assertions only; reject supplied source,
   route, environment or authority keys rather than overwriting them as trusted TGT.
   On persisted reads reject source-kind, ownership and scope conflicts, including
   caller→TGT relabeling compared with independently loaded authorized notes.
   Missing event/boundary is unknown, never fabricated `none` or false. Copy every
   nested domain/source/route value at construction, snapshot resolution and read
   boundaries so later input mutation cannot alter retained facts. Snapshot absent/
   undefined permits established fallback; explicit null or empty clear does not
   resurrect context facts. Invalid asserted structure is an evidence failure,
   not a quietly dropped optional property.
6. Share one pure per-object evaluator across profile and generic builders,
   diagnostics, canonical validation, persisted-rulebook normal and fallback
   validation, preflight and both protected send guards. Fix generic own223 date
   selection for Z09 rather than using root subtype. Do not delete source-present
   contradictory data silently: report issues or throw as appropriate. Missing,
   stale, forged-status, body-changed or wrong-company evidence cannot bypass a
   migrated cell through `rulebookAllowInvalidSend` or a missing policy snapshot.
   Malformed/duplicate reasons and dates must not become trusted event selectors.
7. Inbound policy keeps source-visible syntax/XOR and existing receive semantics
   separate from local lifecycle readiness. Ignore source-inapplicable extra
   dates under p119; do not turn an unknown local event into sender-invalid.
   The imported date may describe a claimed event; actual mutation still requires
   independently authorized correlation. Do not alter ACK generation or import
   lifecycle SQL in this bounded unit.

### R1/R2: one authorized TGT source and route contract

This subsection replaces the former unspecified test substitution. It is a
proposed extension of existing server boundaries, not an implemented authority.

| Part | Single owner and required contents |
| --- | --- |
|Domain objects |`dateEventObjects`: exact object+agency and one domain variant. Supply-relation supplier identity stays here, independent of portal identity. Event occurrence time is provenance only; `supplyBoundaryAt` is the selected rendered boundary. Production direction must be asserted/sourced independently, never inferred from Z70. |
|Canonical operation context |Company, actual environment, market, function, direction, own wire reasons and legal parties. Draft caller supplies server-resolved context; persisted consumers receive row context from the server-loaded row. Environment is never read from date facts or inferred from TGT kind/test labels. |
|Common source |One `dateEventSource`: `caller_selection` with reference for pure evaluation, or TGT with exact company/run/role/case/suite/step/code/sourceDigest, asserting actor/reference and route mapping below. Existing outer notes/code/company fields are necessary duplicates and must compare equal; none overrides another. |
|TGT route mapping |Server-selected settings ID, actor-setting ID, selected run/settings route-profile ID, communication-route ID when attached, expected legal sender/recipient tuples, technical UNB sender/receiver+qualifiers+subaddresses, row transport type/receiver email and explicit application reference. Null subaddresses remain null. Per-object mappings bind each required scenario supplier to the one authorized test-document recipient, never another object's supplier. |

`EdielSystemTestRuntimeContext` exposes actorSettingId and settings.id,
settings.routeProfileId/transportProfileId plus exact actor/portal/subaddress/email
values. It does not expose a typed configuration version. Bind those actual IDs
and resolved values; include a version only if an actual selected authoritative
record exposes it. A deterministic configuration binding can detect changed values,
but neither it nor the source/body digest grants authority or replaces current
route validation. No invented version, route ID or live mandate is permitted.

Concrete producer sequence and extension points:

1. Extend `saveEdielTgtRegisterFactsAction` in `actions.part-2.ts` after its existing
   write authorization, company-scoped run lookup, expected-step check and source
   selection. Resolve `requireEdielSystemTestRuntimeContext` for that run's company,
   runtime suite and role (with the applicable PRODAT selector), and resolve its
   selected route profile with exact company ownership. Reuse the existing test
   route selection; contradictory run/settings selections fail rather than choose
   first. Require an actual test configuration. The operator supplies independent
   domain events/dates and scenario supplier identities, not portal mapping fields.
2. Extend `tgtRegisterFacts.ts` with one server constructor, proposed name
   `buildTgtDateEventSource`, receiving the authorized run/step/source selection
   and resolved runtime/route records separately from operator JSON. It validates
   all source objects, asserts exact-minute precision before date normalization,
   stamps actor/reference and maps each selected simulated supplier to the resolved
   portal legal recipient. Store this one common source alongside the copied facts
   in the existing notes entry; preserve raw workbook rows and existing optimistic
   updated_at write. Cross-check source dates/reasons when present, but do not
   derive event truth from 210/211, column titles, case numbers or expected output.
   Preserve intentionally missing negative-test inputs and report mismatches;
   never invent a date to make the case pass. Reject source conflicts instead of
   silently relabeling facts.
   Existing step/actor permissions still apply: this adds no new outbound Z06/Z10
   role, expected step, run permission or production capability.
3. Prebuild: both `createEdielTgtDraftAction` and
   `tgtAutopilot.ts:createDraftForStep` resolve the same selected test route before
   calling `buildEdielTgtDraft`. Extend `readTgtRegisterFacts` to cross-check stored
   source against the independently loaded run/source/runtime selection. Pass the
   validated source context separately to the draft; `tgtEdifact.part-4.ts` checks
   it before rendering and after building raw wire. Neither imported portalData
   nor arbitrary parsed payload is a substitute for this context.
4. Final row: autopilot currently attaches communicationRouteId/mailbox and
   lockedSendContext after building. Recheck the final draft messageInput after
   that attachment and before `createEdielMessage`; the manual action performs
   the same final check. A changed route cannot inherit prebuild approval.
   For a manual-upload draft, bind that exact transport and explicit null route ID;
   a later switch to a routed send requires fresh authorized resolution/stamping,
   not an exemption because the earlier draft was for manual upload.
5. Persisted consumers: add a bounded read-only TGT context resolver at the server
   row boundary (proposed `loadTgtDateEventValidationContext`). It loads the exact
   company-owned run/step association and notes, original selected source, and
   current test runtime/route, then compares the stored date-event source and
   domain facts to that authorized entry. Resolve once per operation and pass the
   result separately to synchronous evidence/validation/guard functions. Never
   construct this expected context from the evidence being checked. A direct
   pure guard/preflight call without trusted context cannot certify a persisted
   TGT date-event source; it returns the protected missing-source/readiness issue.
   `orchestrator.ts:sendQueuedEdielMessage`, which already loads the server row
   before row preflight, is a concrete async extension point. Existing current
   route/transport validation remains required after the snapshot comparison.

No live lifecycle loader is introduced by this TGT-only resolver. It reads existing
test records and returns typed context, not a new authorization table or parallel
policy. Source selection/digest change invalidates the context and requires a new
operator assertion where the independent scenario changed. Route-only change
requires explicit server remapping/rebuild, not changing the domain event silently.

Checks at every draft, normal persisted, fallback, preflight and send boundary:

* Independently supplied actual row/build environment must equal `test`; unknown
  or production cannot use TGT mapping. Cross-check company/run/role/case/suite/
  step/function/source selection with the trusted context and authorized notes.
* Decode raw legal NAD+DO and NAD+FR tuples and compare with the server mapping.
  For every own-object before-start condition, require its own supply-relation
  supplier mapping; a mapped sibling never fills a missing one. All required
  recipient mappings must resolve to this document's one legal recipient.
* Separately decode UNB technical sender/receiver, qualifiers and subaddresses;
  compare with the server-bound mapping and independently supplied row sender/
  receiver/subaddress fields, application reference, transport type, attached
  communication-route/profile IDs and applicable receiver email. Optional parsed
  UNB projections cannot override raw wire or row values. No date bodyBinding
  proof covers UNB, environment or an attached route: check them explicitly.
* Mismatch, missing/stale mapping or source-kind change produces a protected
  failure even with a root not_required snapshot or intentional-invalid label.
  No `testSubstitution`, `isAuthorized`, or caller-controlled route-bypass flag is
  accepted. TGT kind merely selects which complete checks must succeed.

Concrete consumer extensions and protected failure mapping:

| Existing entry point | Required bounded extension |
| --- | --- |
|`prodatRegisterEvidence.ts` copier/create/read/resolve |Deep-copy the common source and domain objects; never stamp authority here. Read receives independent actual environment and row route plus trusted TGT context, compares authorized notes/source/domain binding and body. Explicit-null snapshot remains a clear. |
|`buildProdat.ts`, `builders/profileRenderer.ts` |Separate pure assumed-fact evaluation from send readiness; carry context and copied facts without upgrading caller_selection. Profile diagnostics must record unqualified authority even when field outcomes are determined. |
|`tgtEdifact.part-4.ts` and TGT callers above |Validate the complete common source, generated raw parties/UNB and final row. Source-presence or successful construction does not replace producer authority. |
|`rulebook/validator.ts` normal policy and catch/fallback |Pass the same independent row/test context into evidence reader and per-object date evaluator in both paths. Missing/stale policy snapshots cannot hide source/route/event/XOR checks. Unknown local inbound evidence does not run this outbound-readiness branch. |
|`payloadPreflight.ts:preflightEdielMessageRow` and send-mode raw payload path |Thread actual environment/route/trusted source context explicitly; absent context cannot certify outbound date-event readiness. Run date checks independently of root policy success and raw/row label consistency. Preserve parse/inbound semantics. |
|`sendGuards.ts` / `transport/sendLock.ts` |Reuse protected categories before intentional-invalid handling in both guards. No additional escape for TGT or caller source. |

Use `scope: 'prodat_dependent'` on date applicability/event/route/source-authority
findings, with bounded codes such as `PRODAT_DATE_EVENT_SOURCE_UNQUALIFIED`,
`PRODAT_DATE_EVENT_ROUTE_MISMATCH`, and `PRODAT_DATE_EVENT_EVIDENCE_INVALID`.
Map them to `PRODAT_DEPENDENT_PREFLIGHT_<code>` errors in preflight so the existing
transport prefix gate catches them. Structurally corrupt shared evidence may retain
`scope: 'prodat_register'` / `PRODAT_REGISTER_EVIDENCE_INVALID`; its existing
preflight protected prefix also blocks. Catch paths must preserve these protected
classifications, not collapse them to an unscoped canonical-policy error or test
warning. `assertRulebookAllowsSend` checks both protected scopes before its override;
`assertEdielSendLock` checks protected preflight errors before production lock.
These internal codes are not new APERAK error codes.

Inbound remains a separate evaluation mode: own-D XOR is source-visible,
inapplicable extras follow p119, and unknown local events do not become outbound
source/route-readiness errors. No local source assertion authorizes mutation merely
because the incoming field matches it.

### Exact time semantics for that contract

Validate source precision and boundary meaning before invoking the existing codec.
It intentionally accepts date-only values and truncates ISO seconds for other
callers; do not globally change those established inputs. The existing codec converts offset-bearing ISO instants to fixed UTC+1;
compact203 and offset-free ISO timestamps represent standard-time wall minutes.
A date-only storage column does **not** prove midnight: the current generic codec
allows that convenience, but the new producer must supply an explicit sourced
market-boundary rule before expanding a date to a minute. Otherwise unknown.
For the EL Z10 change-effective boundary specifically, p110 supplies00:00 on the
authoritatively identified change day; actual physical replacement/recording time
is separate. It does not supply the contract's start-day semantics.
Do not compare date-only slices, host-local Dates, raw differently offset strings,
created_at, receipt time or now. Normalize both qualified boundaries to valid fixed
UTC+1 minute values, then compare exact canonical strings/ordinal minutes.
Do not silently truncate seconds for a strict before comparison: require exact
minute-boundary facts (seconds/fractions zero), or separately retain/compare full
instants with an explicitly qualified rounding policy. The smallest initial
contract is exact-minute facts; nonzero subminute inputs are unsupported/unknown.
Test equal/minute-before/minute-after, midnight/month/year/leap-day boundaries,
instant-equivalent offsets, summer and autumn DST folds, explicit-null snapshots,
invalid dates, and host TZ invariance. Do not apply GAS06:00 or Europe/Stockholm DST
to EL standard-time fields. Reuse dates.ts encoding without changing its established
unrelated date inputs.

### Scope to authorize after independent review

First implement source-bound pure date/event policy and protected validation,
then explicit producer/evidence plumbing through existing TGT notes/builders.
Use new failing tests before runtime edits, retaining old tests and frozen source.
Required cases include all four true/false/unknown states, own-reason conflicts,
XOR, values disagreeing with evidence, exact first-object/register/agency matching,
pure-caller facts persisted without gaining send/production authority, authorized
TGT positive mapping, raw legal DO/technical UNB/row-route mutations, missing or
wrong run/source mapping, test→production environment mutation,
custom UNA/escaped identities, source selection/clear semantics, input mutation,
company/run/step/code/body tampering, normal/missing/stale snapshots and both
intentional-invalid guards. Include real module TGT draft and persisted consumers.
Read-only/static live producer candidates above do not authorize enabling
`prepareAndQueueEdielZ06/Z09/Z10` or changing lifecycle/schema/role permissions.

## Executed verification and handoff

Commands (repository cwd unless absolute paths shown):

```sh
sha256sum /workspace/scratch/2a201d6d5897/prodat-original-source/PRODAT-26A-r3.pdf
pdftotext -layout /workspace/scratch/2a201d6d5897/prodat-original-source/PRODAT-26A-r3.pdf /workspace/scratch/2a201d6d5897/date-events-original.txt
./node_modules/.bin/vitest run --config /workspace/scratch/2a201d6d5897/date-events-probe.config.mjs
```

Original hash matches supplied digest. Extraction/rendering succeeded. Initial
14-case discovery result13/14 and final19/19 characterization result are distinguished
above. The same19 cases also pass under `TZ=UTC`, `TZ=Europe/Stockholm`
and `TZ=Pacific/Apia` (19 distinct cases, not57). Probe log and JSON contain final
observations; the failed discovery hypothesis is explained here. No full application suite/build/CI is claimed for this
source-only artifact. Root monitors prior PR344 main acceptance independently.
`git diff --check` passed; `node scripts/check-ediel-masterplan-v2.cjs` passed
for33 original files,121 rules and231 acceptance contracts, explicitly without
application-conformance or production-readiness assertions. Results are also in
the scratch task report. This audit changes no application,
old test, frozen original, workflow/gate/threshold, schema, generated type or memory.

Next action: parent independent source review, adjudicate proposed false-branch,
Z06E p109 overlay, inbound XOR/ignore and producer/route/time contract, then explicit root runtime
scope. No acceptance credit from inventory, source audit or characterization counts.


## Source-document review correction R1/R2

Independent review of `f4f9235d` approved source/specification and requested two
architecture changes before runtime. This document correction preserves that
semantic interpretation, including p109 overlay and inbound XOR/ignore distinction.
R1 is addressed by the named authorized TGT producer, one common run/source/route
mapping, prebuild resolution, final post-attachment recheck, independent test-row
context and raw legal/technical checks in every protected consumer. R2 is addressed
by pure caller assumptions never granting persisted/live authority, separate
copy/stamp operations, exact common ownership, deep-copy/clear semantics and
explicit protected normal/fallback error mapping. No live producer, source exception,
new role, schema, source original, gate or runtime change is included.
Receiving-code-review was activated and actual existing extension points were
re-read to verify the corrections. No new broad characterization was needed;
the previous19 observations remain baseline receipts only. Exact correction
verification commands/results are appended to the same scratch task report.

## Authorized runtime implementation and verification

Root authorized all four cells after independent approval of `953c9a8d`; the
runtime remains bounded to those cells. The accepted baseline remains 92/110
numeric and 10/10 parents, with 18 remaining until root records review/release.
This section supersedes the earlier source-only implementation status, not the
source evidence or qualified semantics above.

### Implementation boundaries

* `prodatDateEvents.ts` copies strict, explicitly enumerated object/source/route
  structures without external runtime dependencies. Nested values are copied;
  unknown keys, wrong discriminants/types, duplicate identities and imprecise
  dates fail. Undefined fallback and explicit null/empty clearing remain distinct.
  The existing global date codec is unchanged.
* `prodatDateEventPolicy.ts` evaluates the first register of each exact object
  and its own reason. It implements strict before-start, the Z06E p109 exclusion,
  optional matching actual210 for false Z06F/G/Z10, own-Z09D signed/ceased and
  wire XOR. Root/byCell hints cannot determine these four conditions. P110's
  Z10 effective midnight is checked without accepting another216 cell or process.
  Signing occurrence cannot replace the supply boundary. A missing route does
  not erase a known temporal field requirement. Inbound local uncertainty is
  separate; ownD XOR/syntax remains checked while nonD extras retain p119 behavior.
* `prodatDateEventAuthority.ts` checks independently supplied test environment,
  scope, notes facts, raw legal FR/DO, technical UNB and the actual row route.
  The source snapshot includes only named IDs/party/transport values, never whole
  settings records. Body binding remains integrity, not authority.
* `tgtDateEventContext.ts` reloads company-owned run/message association, run,
  expected step, original imported/static data, authorized notes and current test
  settings/route. `tgtDateEventSource.ts` separates server stamping from domain
  copying. Selected routes must remain enabled and test scoped. There is no
  production source loader or production substitution.
* Authorized save/manual draft and autopilot resolve scope before build and
  check the final row after route attachment. Generic/profile builders expose
  unqualified caller assumptions separately from persisted-send readiness.
  Persisted evidence, normal/catch rulebook, raw/row preflight and both guards
  reuse protected dependent/register failures before intentional-invalid escape.
* Orchestrator preflight resolves expected context. The actual shared SMTP
  boundary resolves it again, including callers from outbox and direct send.
  Actual wire family/function also selects the bounded check, so stale row labels
  do not skip it. Existing transport family, route, readiness, security and outcome
  behavior remains in place for other families and after this bounded check.

The SMTP RED test reached a **mocked mail-readiness boundary**, not a real provider
or network. It demonstrates that this exact date protection was absent at that
boundary, not that all prior transport validation was absent or exploitable.
The positive actual-module test traverses authorized notes, draft, independent
resolver and shared SMTP into a mocked provider exactly once. Source/route/env/
missing-association negatives call neither archive nor provider. No live send,
DB/storage operation, deployment or production lifecycle assertion was performed.

### Five explicit root-authorized legacy assertion corrections

These are exceptions approved by root after inspecting actual conflicts; they
must be reviewed separately from fixture additions. No other old assertions were
weakened and no compatibility bypass was added.

1. `prodat-dependent-condition-engine.test.ts`: the final two Z06:210 root-byCell
   true/false expectations become undetermined; no-facts and other cells remain.
2. `ediel-prodat-dependent-z06-product.test.ts`: bounded production Z06 positives
   retain targeted242 success, add exact protected date-source failure and both
   guard rejections, and independently retain the old production-readiness issue.
3. `ediel-prodat-dependent-subtype-ud-boundaries.test.ts`: the same narrow change
   for production Z06 UD positives; targeted UD success and old readiness issue
   remain. Z09 nonD production nonapplicability is preserved.
4. `ediel-prodat-dependent-subtype-review.test.ts`: actual Z06 wire still has no
   invented Z09:216 finding; stale Z09 row metadata produces exact protected
   source/function scope mismatch and both guards reject. A correctly labeled
   row with the same qualified context passes, so the negative is not merely
   missing source authority.
5. `ediel-canonical-policy-batch-regression.test.ts`: the root-byCell catalog
   fixture's entire unknown-ID set is the literal four date IDs; registry equality
   and determined non-date conditions remain. No prewire aggregate was invented.

Test-environment positives receive fixed independent synthetic facts/context;
none are inferred from the rendered result. Existing action/autopilot mocks use
partial imports to retain the new real helpers; existing assertions remain.

### TDD and required gate receipts

The local TDD, planning/execution, systematic-debugging, verification and
spec-to-code workflows guided implementation. Supabase skill was applied to the
bounded client reads, with external reads/writes mocked and no live query. Root
owns independent reviews; no broad architecture/UI/security/performance rewrite
or new schema/proof infrastructure was needed.

Initial actual-module RED: 22 cases, 16 failing/6 passing; the first GREEN attempt
also exposed a new Zod refine/max construction error, retained in the scratch log.
Further deliberate REDs: guard/source25 (2 failures), TGT producer4 (4 failures),
missing independent context5 (1), padded reason/inbound syntax31 (2), pure-builder
readiness33 (2), resolver16 (1), post-attachment mailbox30 (1), actual SMTP2 (2),
Z10 physical-time/midnight plus malformed/custom-UNA83 (1). Focused corrections
went green, with final full-suite receipts below superseding intermediate counts.

The first broader affected run had 59 failures/2584 passes; root adjudicated the
five exact legacy conflicts above. The first full run had 3936 passes/1 catalog
failure. A later pre-loader-fix full run passed3956. These are historical receipts,
not the final result. The first affected script run had 777 loader failures/41
passes because the new module imported Zod and used a TS parameter property;
these were loader compatibility failures, not777 protocol defects. The final
module uses a dependency-free strict copier and ordinary class field assignment;
no loader, test gate, threshold or workflow was altered to fix them.

Final required commands/results (full logs in the task scratch report):

* `npm test -- --reporter=dot`: 262 files, **3968/3968** tests pass.
* `npm run typecheck`, `npm run typecheck:scripts`, `npm run typecheck:tests`: pass.
* `npm run lint`: exit0; repository warnings reported separately in task report.
* `npm run quality:large-file-budget`, `npm run quality:performance`: pass with
  unchanged budgets (no awaited DB loop calls in the guarded roots).
* `node scripts/check-ediel-masterplan-v2.cjs`: 33 originals,121 rules,231 contracts;
  application conformity and production readiness flags remain false.
* Eight affected Ediel node scripts: **818/818** pass, unchanged scripts/loaders.
* Guide governance: **98/98** in each UTC, Europe/Stockholm, Pacific/Apia;
  nine date suites **502/502** in each timezone (502 unique cases, not1506).
* Required-preload route-readiness regression: pass.
* `git diff --check`: pass. Originals, schema, workflow/gates, role grants,
  live facades, root memory and paused PR310 remain outside this implementation.

No CI/main merge receipt or acceptance increase is claimed here. Independent
runtime/spec and quality review remains the next root-owned step.

Local verification used Node24.19.0 (known workspace environment); package/CI
uses Node22.23.2. Lint exit0 has100 repository warnings and0 errors. Independent
exact-head CI and main73/73 on Node22 remain required; local receipts do not
replace those root-owned acceptance gates.

### CI correction: tenant service-role ratchet

Published draft PR345 triggered Tenant integrity regression35452098502, which
reported2404 direct service calls against the unchanged2402 baseline. Reproduced
locally (exit1). The new resolver had three direct reads; accepted code was2401,
so those three exceeded the baseline by two. Route profiles, run associations and
runs now use the actual `tenantDb(companyId)` wrapper, which applies the company
predicate before caller ID filters and refuses a missing company. No unscoped
escape, client alias, baseline/loader/gate/schema change was used. Returned owner
checks and original database errors remain. External client mocks execute the real
wrapper; four additional controls test missing tenant and all three read errors.

Correction verification:70/70 tests in6 affected resolver/admin/autopilot/SMTP
suites, all3 typechecks, lint exit0 (100 warnings/0 errors), both tenant integrity
and shutdown contracts, and ratchet2401<=2402 all pass. An initial generic query
return type lost selected row inference; replaced by a bounded typed read surface,
then all types passed. No full-suite rerun is claimed for this narrow correction;
3968 was the preceding runtime receipt. Independent runtime findings received
from root remain a separate pending correction round, not resolved by this change.

### Scoped independent runtime review correction R1–R3

Root authorized the three findings in date-events-runtime-review-report.md after
review at1e69de12. The separate tenant correction remains bd4a268f, independently
approved. Original reviewer probes/config are preserved: same three assertions
reproduced RED3/3 and pass GREEN3/3 after the following scoped corrections.

R1: actual raw/row parse now passes inbound direction into the existing date-only
validator. Only210/211 DTM in a known own non-D Z09 scope is ignored by that
validator, per p119. Selection uses decoded own scope and retained token indices,
not root reason or text-wide replacement. Header dates, unknown own reason,
applicable dates, other codes/cells and outbound validation retain their existing
rules. Shared ownD XOR and malformed-date protection still runs on original wire.
No ACK behavior or global field-matrix/date codec was changed. Fourteen new raw/
row controls cover valid extra210/211, ownD both/neither/malformed dates and
outbound nonD exclusion. This fixes the observed parse finding, not an asserted
negative ACK or lifecycle effect.

R2: manual action resolves/validates the actual case and Gridex step before
runtime lookup, and run suite must match selected suite. Runtime messageFamily
comes from that validated case's source suite; thus UTILTS U2.1 CONTRL/APERAK use
UTILTS, while PRODAT dates use PRODAT. Autopilot uses the same case-suite source
profile, not the ACK wire family. Controls exercise both manual ACK steps and
actual autopilot matching of its inbound UTILTS first step, stopping at a mocked
runtime boundary and asserting the exact UTILTS selector. They do not claim ACK
emission/provider behavior. Invalid step is rejected before runtime lookup.

R3: expected context separately copies both source (including nested route) and
objects from returned mutable facts. Six event/source/route mutation controls
run in both directions, through real source resolver and draft comparison;
mutating one side leaves the peer unchanged and the subsequent draft rejects.
Existing persisted independent reload is retained; no persisted bypass was
claimed by the review or correction.

No old assertions were changed in this round. Fresh focused48/48 pass; full
3996/3996 in263 files includes the four tenant tests and24 review controls.
Affected eight node scripts818/818, date suites530/530 in10files per UTC,
Europe/Stockholm/Pacific/Apia, unchanged budgets/performance/integrity, both tenant
contracts and ratchet2401<=2402, and required-preload route gate all pass. Exact
commands, type/lint receipts and local Node24 limitation are in the same task
report. These supersede prior full3968 locally; independent scoped re-review and
exact-head Node22 CI/main receipts remain root-owned and pending.
