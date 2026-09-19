# Reporting term and permission purpose: approved contract and bounded runtime

Date: 2026-09-19. Scope: PC-321-Z13, PC-321-Z14, PC-323-Z13, PC-323-Z14.
Source/architecture approval is complete; the bounded runtime authorized by root is
implemented and locally verified below. **No accepted-cell increment is claimed.**
Application base is merged main `0a82c9ce51ef5c95868ed9c25907f1e10819d079`
(PR345), with source-contract corrections `410a73a4`, `3ab45d02`, `49604a2`
and root-owned memory through `75133c97` before runtime handoff.
Root separately verified main345 full 73/73 and OPS; current aggregate 96/110
numeric and 10/10 parent occurrences does not include these four cells.

## Approved source decision and runtime scope

The bounded implementation supports per-object pure policy for both codes and
extends the already authorized, server-owned ESCO **outbound Z13 test process**.
There is no current registered Gridex outbound Z14 test producer. Positive Z14
persisted qualification therefore remains blocked even if its pure policy is
implemented and tested. Existing inbound Z14 processing is not outbound authority.
No live producer is qualified by this audit.

The original official workbook supplies new positive evidence missing from the
prior audit: an explicit business customer sends B72 in Z13 and receives B72 in
Z14. Root and the independent reviewer have now **approved the bounded source
interpretation**: private => required; independently classified nonprivate Z13
=> assessed inclusion or omission; positive Z14 => strict independently correlated
request presence/value equality; unknown => unresolved; exact Z14N => forbidden.
Private Z14 with absent request purpose is inconsistent. Frozen false=>X remains
unchanged as an explicitly adjudicated projection tension; no blanket old-assertion
rewrite is approved. Independent final source/architecture review approved `49604a2`
and closed R1, R2 and R2.1; root then explicitly authorized runtime. Five exact
legacy-test exceptions were individually adjudicated during implementation and
are recorded in the runtime section below.

PR310 stays PAUSED at `e961135199f292b8210884f07de3b616a670161a`; nothing was
imported. Originals/projections, schemas, gates, thresholds, loaders and budgets
remain unchanged. Runtime and the five authorized test files changed; root memory
was maintained only by root. No live database/provider/send,
settings or deployment operation was performed. Read-only retrieval of the exact
official workbook was explicitly authorized by root.

## Routing and source identity

Read AGENTS, required active memory and relevant domain-model, canonical-flows,
integrations; searched decisions and known-failures. Used the dispatched-subagent
workflow with root owning independent review, publication and acceptance. Applied
spec-to-code-compliance, false-positive checking and verification-before-completion;
reviewed acquire-codebase-knowledge/quality-playbook routing. The supplied brief is
the bounded plan. PDF and spreadsheet reading skills support original table
inspection; Supabase routing covers the typed tenant-reader/writer boundary, with
no live DB execution. After explicit runtime approval, applied TDD, receiving-code-review,
writing-good-tests and verification-before-completion to the approved contract.
Read installed Next.js forms/authentication guidance before the active form/action.
The web-design-guidelines fetch was blocked by the available web transport; local
Next guidance and existing accessible labeled native controls were used. Global
audit regeneration/fan-out, infrastructure, skill authoring and deployment remain
out of scope. Performance work here is the unchanged required regression gate.

| Original evidence | Identity and verification |
| --- | --- |
| Supplied original PRODAT PDF | `/workspace/scratch/2a201d6d5897/prodat-original-source/PRODAT-26A-r3.pdf`; 140 pages; SHA256 `83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95` independently verified. Full text extracted; complete relevant notes and tables reread, not just conditional projections. |
| Official original TGT workbook | [Official system-test listing](https://ediel.se/Info/systemtest) links [document 3300](https://ediel.se/Portal/Document/3300), `TGT_PRODAT_Bilaga_1-Testdata_per_testkund_version_el_4-0-5.xlsx`; SHA256 `475131fa17fe0b4a611bae4ecf3f42cd78c9565b963a7c7cbd918213721332c7`; downloaded read-only 2026-09-19. Version history A206 identifies 4.05. This is the original workbook version used for comparison, not a replacement PRODAT specification or a newly substituted test guide. |
| Frozen derived contract | `docs/ediel/masterplan-v2/MASTERMASTERPLAN_v2.md` §2.2, §2.4, §7.3, §8.1; registers `prodat_fields.json`, `prodat_conditional_cells.json`, annex source tables and annex B. Four frozen cells remain true R / false X / unknown stop outgoing. |
| Earlier qualification | `f3-reporting-context-20260919.md` and `f3-remaining-dependencies-20260919.md`. PR339 repaired exact N exclusions only. Its 29-case archived probe was rerun unchanged against current modules. |

Original PDF pages read include 15–23, 32–33, 43, 47, 49, 64–66, 73–74, 77–79,
90–94, 105, 114–116, 118–121, 123–124 and 137–138. Original pages 17, 21, 32,
33, 49, 74, 121 and 123 were rendered and visually inspected; scratch images are
in `reporting-permission-source-images`. Full extracted PDF text and workbook XML
cell extraction are retained beside the scratch probes for independent review.

## Source conclusions, including tensions

| Source | Consequence for the four cells |
| --- | --- |
| P §2.2 p15, field321 p17; SG8 DTM p49 | End is sent unless reporting is intended indefinitely; explicitly not Z14N. DTM C507/2005=91, 2380 end, 2379=203, CCYYMMDDHHmm. A supplied/absent date does not prove intent. The shorter example does not replace the detailed format. |
| P p49 and appendix4 p121 | Z13VH must have an end and it cannot be future. These are distinct completeness/time constraints. S17/V does not imply indefinite: bounded ongoing reporting is possible. Do not generalize the expressly Z13VH future prohibition to every Z14VH. |
| P field323 p21 | Must be sent for private customers, except Z14N. This establishes private required and N forbidden; it does not explicitly say that every nonprivate purpose is prohibited. |
| P complete CCI note p74 | Used only in Z13 (mandatory private) and Z14; Z14 purpose must be the same as the received Z13. That **request-response association is an independent fact/authority requirement**, not proof from the response's own supplied code. Not Z14N. |
| P CCI/CAV tables p74 | CCI C502/6313=Z24, unused 7059/6321/6155/6154; adjacent CAV C889/7111=B71–B76, unused 1131/3055/7110. The A02 example is a recorded source conflict (§2.4), not allowed vocabulary. Valid-looking siblings cannot erase malformed physical occurrences. |
| P field223 p22, tables p64–65 | Own exact CCI Z13 / adjacent CAV S17=V, S18=VH, Z96=N; first-register scope, unique correctly placed pair. Root subtype, padded aliases, later register/message and another object's reason cannot supply it. |
| P field209 p16, LIN p47; example p137 | Z13 excludes installation identity; LIN+1 is legitimate. Requiring 209 or copying a response installation into Z13 is not a solution to object association. Minimal Z14N likewise must remain possible (p138). |
| P field226 p22 and RFF p78, process pp32–33, appendix p123 | LI is the unique request/process reference and the response retains corresponding request LI. One customer request can yield multiple positive installation responses. Thus LI alone is not a unique Z14 installation key. ANJ authorization reference and UD identity are additional source associations, not private-customer inference. |
| P appendix p119 | Incoming non-applicable extra X/false-D information is ignored for business effect and must not cause negative APERAK. Preserve applicable syntax/date-format checks and existing structural/XOR behavior. Missing local authority does not establish sender invalidity. |

### Exact original workbook cells

Sheet **`Testkund 70 - 76 - ESCO`**:

| Test / cells | Original meaning |
| --- | --- |
| 8.1.3 C47/D47; C48/D48 | Same test's Z13VH and Z14VH columns. |
| C60/D60 (field323); C66/D66 (field228) | Both carry B72 (Avtal); both identify **Sonjas Fröhandel AB**. This is direct original business-purpose evidence, independently of current builtin output defaults. |
| C49/D49 (field209) | Request identity blank; response identity populated. |
| C51/D51 (field321) | Request historical end is prescribed; response says same as Z13VH. This scenario supports end correspondence; it is not a universal inferred end-equality rule for every response. |
| C62, C63/D63 | Request authorization reference set by sender; request LI set by sender, response LI same as Z13VH. |
| 8.1.1 C23; C35; C36/D36/E36 | Request 209 blank, authorization reference sender-defined, LI sender-defined and retained by both response columns. Current built-in projection inserts an installation into this Z13 column: it is not an authoritative copy of this original detail. |
| 8.1.2 C5/D5; C13/D13; C15/D15 | Z13V/Z14N; request B71 and response no purpose; LI retained. No request installation row supplies an identity. |

The original **`Testkund 40 - 65 - nätägare`** sheet was also examined before
concluding that current persisted Z14 coverage is missing. It contains 4.6.1
(D362/E362, Z13V/Z14V D363/E363, no request identity D365, B71 D387/E387,
LI D392/E392), 4.6.2 (C584/D584, Z13V/Z14N C585/D585, B71 C593 only,
LI C595/D595), and 4.6.3 (C600/D600, Z13VH/Z14VH C601/D601, request
identity blank C602, end C604/D604, B72 C613/D613, LI C616/D616).
These prove original DSO test scenarios exist. They do **not** register/activate
such a role or producer in this application. Actual catalog inspection finds no
Gridex outbound Z14 step, including outside ESCO.

### Explicitly adjudicated 323 interpretation

The approved source decision does not rely on silence alone. P p21 establishes
a private minimum;
p74 permits the purpose segment in these message functions and explicitly
requires response/request correspondence; original 8.1.3 positively demonstrates
nonprivate B72 in both functions. §7.3 says false D is not generally X, while
§2.2 gives the field notes precedence over conflicting appendix conditions.
Together they support distinguishing **private required** from **qualified
nonprivate Z13 include/omit**, with strict positive Z14 request correspondence.
There is no located nonprivate mandatory-purpose rule,
so omission is the adjudicated nonprivate Z13 branch; inclusion must still satisfy
placement, vocabulary, assessed source and, for Z14, original-request equality.
The workbook corroborates protocol interpretation; it is not authority to grant
a live processing basis or silently replace the frozen projection.

This proposal does not claim every B71–B76 code is legally available to every
actor. Masterplan §8.1 requires a documented assessed processing basis. Synthetic
test assertions qualify only the configured test process. Unknown classification
must remain unknown even if an identifier looks personal, the company name looks
business-like, or B71/B72 is present. A test-source adapter may explicitly select
the documented business scenario; a generic classifier may not guess from text.

## Current producer and consumer trace

Paths below are under `lib/ediel/` unless qualified otherwise.

| Current path | Actual behavior / required boundary |
| --- | --- |
| `prodat/prodatDependentConditionEngine.ts`, `rulebook/canonicalPolicyFieldValidator.ts` | 321 still uses root `byCell`; 323 still uses root customerKind/subtype. Unlike migrated cells, positive predicates are not independently resolved for each object. |
| `rulebook/prodatZ14Policy.ts` | Existing scanner protects physical 321/323 placement and exact N exclusion. `isZ14DependentField` excludes these positive predicates. Retain N behavior and minimal N without external facts. |
| `prodat/prodatRegisterGroups.ts` | Canonical exact ID/agency/message grouping, distinct identity-less line groups and first register already exist. Group index locates bytes; it does not authenticate a business object. Z13/Z14 do not gain multiple-register permission. |
| `prodat/buildProdat.ts`, `builders/z13.ts`, `builders/z14.ts`, `builders/profileRenderer.ts`, `render/dateSegments.ts`, `compatAdapter.ts` | Generic builder can render identity-less objects and own references. End/purpose/render contexts and arbitrary portalData remain output input, not independent authority. Date null/undefined precedence must be preserved. |
| `prodat/prodatRegisterEvidence.ts` | Explicit allowlisted facts now include accepted address/invoice/date families. Reporting facts do not exist. Root customerKind/byCell are deliberately omitted. Body digest binds decoded message bytes (excluding envelope/service messages); it proves integrity, not authority. |
| `testing/tgtRegistry.part-2.ts` and actual `EDIEL_TGT_TEST_CASES` | Gridex outbound Z13: E3/E4 and 8.1.1/8.1.2/8.1.3. All catalog Z14 steps are portal inbound (E5/E6, 8.1.x, 8.2.1). No current Gridex outbound Z14 registration. |
| `testing/tgtProdatSource.ts`, `tgtRegisterFacts.ts` | Raw source columns preserve identity-less Z13, but existing facts-note producer requires first-object209 and rejects them. Existing envelopes check company/run/role/case/suite/step/code/source digest; no reporting facts or customer assessment. Digest/column coordinates alone cannot authorize a request. |
| `app/admin/ediel/actions.part-2.ts` `saveEdielTgtRegisterFactsAction` | Write access, scoped run, company permission, operational checks and registered outbound step checks precede save. Code allowlist ends at Z10. Z13/Z14 are not currently supported. Existing note CAS must be retained; any new company-scoped access must use actual tenantDb, leaving tenant baseline2402 unchanged. |
| `testing/tgtEdifact.part-2.ts` | Purpose defaults to B71 or B72 from transaction label; `resolveEscoZ13MeteringPointId` can borrow a response-column ID. Neither is authority; a qualified Z13 producer must not use the borrowed ID. Source expressions/default AGT dates are not explicit independent reporting intent. |
| `testing/tgtEdifact.part-4.ts` | Literal `DTM+91:` together with `CAV+S17` produces historical-only mismatch even for legitimate bounded V; alternate UNA changes this behavior. Future bounded integration must use own parsed reason, not a message-wide substring rule. No existing assertion was changed. |
| `testing/tgtDateEventSource.ts`, `tgtDateEventContext.ts`, `prodat/prodatDateEvents.ts`, `prodatDateEventAuthority.ts` | Available pattern: strict keys, independent tenant run-message association and run/source reads, current registered actor/direction, test runtime/selected route, exact scope and current row/body/route equality, independently copied returned contexts. Reuse the pattern only after reporting source qualification; its date code scope does not cover Z13/Z14. |
| `permissions/z13RequestAccess.ts` → orchestrator → `flows/prodatSwitch.ts` | Z13/Z14 facade remains blocked; do not reactivate. |
| `lib/onboarding/infoRequests.ts`, migration `20260520_batch_3_4_onboarding_pricing_billing_engine.sql` | Real domain exists: company/customer/site/metering-point/grid-owner/authorization, requested and approved nullable dates, source Z13/Z14 IDs. Draft creation checks anchors; queueing tenant-loads permission, checks active authorization covering metering data, creates a grid-owner/outbound request and records state. It does not supply an explicit minute-precision bounded/indefinite declaration, assessed purpose, versioned customer classification or exact join to this builder/send context. Null dates are not indefinite proof. |
| `testing/prodatPermissionEngine.ts`, `permissions/z14HandleResponse.ts`, `flows/prodatPermissionLifecycle.ts` | Inbound correlation/state persistence exists; fuzzy candidate matching or a response's supplied values cannot become exact outbound facts. Inbound Z15 lifecycle does not produce Z13/Z14 authority. |
| `rulebook/validator.ts`, `core/messageBuilder/payloadPreflight.ts` | Normal and catch paths restore accepted evidence/required date authority and protected errors. Reporting must be covered in both, raw and row, with correct single-UNH scope; a caught malformed context must not bypass validation. |
| `rulebook/sendGuards.ts`, `transport/sendLock.ts` | Protected PRODAT register/dependent errors are checked before intentional-invalid/test/production escapes. New reporting errors need that same protected route. |
| `orchestrator.ts`, `outbox/sendOutboxItem.ts`, **`transport/index.part-2.ts` `sendEdielMessageViaSmtp`** | Actual shared SMTP presently independently loads and gates only the bounded date-event selector (Z06/Z09/Z10). Z13/Z14 do not enter it. Outbox/orchestrator checks alone, or mocks replacing shared SMTP, are insufficient. A reporting selector must cover row OR actual raw Z13/Z14 and reload facts before any provider branch/snapshot side effect. |

## Architecture correction R1/R2 (source-only review round 1)

Root adjudicated the 323 interpretation after independent SOURCE/SPEC approval
of `410a73a4`: private R; independently qualified nonprivate **Z13** include/omit
(with assessed basis when included); positive **Z14** strict independent request
purpose presence/value equality, including nonprivate; private plus absent request
purpose is inconsistent. N remains forbidden. Frozen originals and old assertions
are unchanged. No blanket future assertion-change approval follows. The following
contract replaces the earlier abbreviated design. R1 and core R2 were closed by
independent rereview of `3ab45d02`; only the R2.1 correction below remains pending.

### R1: exact minute and clock contract

Canonical stored business end is `MarketMinute`: exactly 12 ASCII digits
`YYYYMMDDHHmm`, valid proleptic Gregorian year0001–9999, hour00–23/minute00–59,
interpreted as **fixed UTC+1 all year** (P p43). It is not Europe/Stockholm and never
uses the host timezone. Wire is exactly this value with qualifier203 (p49).
A dedicated `reportingBusinessMinute` in proposed
`prodat/prodatReportingPermissionContext.ts` validates precision **before** calling
accepted `render/dates.ts` utilities. Accepted business inputs are compact minute
or strict `YYYY-MM-DDTHH:mm[:00[.0…]]` with optional `Z`/`±HH:mm`; fractions, when
present, contain 1–9 zero digits only and require seconds00. Nonzero seconds or
fractions, date-only, whitespace, invalid calendar/offset, missing digits and
non-string Date/numeric inputs reject. Offset hours00–23/minutes00–59 follow the
existing codec; offset-free ISO explicitly means market wall time. Offset-bearing
ISO is an instant converted to UTC+1, with out-of-range converted year rejected.
All accepted forms normalize to the same compact minute before storage; no later
renderer may truncate an unqualified end or infer midnight from a date-only value.

`ReportingClock = { nowUtcMs(): number }` is an injected server dependency, default
system UTC clock. Each operation samples once: safe-integer epoch milliseconds,
finite and convertible to an in-range market calendar minute; invalid clock
throws a protected reporting-context error (never bypass/guess). Evaluation minute
is `prodatNowDate203(new Date(sampleUtcMs))`: mathematically floor after adding
3,600,000ms, independent of DST. The business-end comparison is lexical on validated
12-digit values: **endMinute <= evaluationMinute**. Equality passes, next minute
fails. Projection of evaluation-clock seconds is intentional; business-end seconds
were already required zero. This is a minute rule, not acceptance of future end
seconds hidden by truncation. Apply the nonfuture rule only to own Z13 S18/VH.

Pure policy requires explicit `evaluationUtcMs` from its caller (a missing/invalid
clock is unresolved/error). The authorized save, manual build, autopilot build,
row/orchestrator preflight and real shared SMTP each sample their server clock at
their boundary; each pass shares its one sample across all objects and both guards.
The final SMTP invocation always samples anew after independently loading context
and before any provider/snapshot branch. It cannot reuse a prior preflight instant.
Retries repeat this current check; clock rollback can fail closed. No claimed
clock accuracy/monotonicity beyond the server clock is fabricated. Deterministic
tests inject `ReportingClock` at the server resolver/SMTP dependency boundary,
never through operator JSON or evidence. DTM137 and envelope creation timestamps
cannot select this clock. The sampled evaluation instant is not persisted authority.

`resolutionAnchorUtcMs` is different: server sampled when a request is first
created, retained in its notes entry, and used only by the versioned synthetic
source-expression adapter. Workbook relative-month/day expressions resolve against
that anchor's UTC+1 calendar; their minute must be supplied explicitly by the
synthetic assertion (or an exact minute source), not invented from a date-only
cell. `bounded_source` operator input supplies `minuteOfDay` exactly HHmm; the
adapter verifies the source's supported date expression, resolves its day, and
combines the explicit minute. Unsupported expressions remain unknown/error. The
resolved compact end and expression provenance are stored. Save/update with
`resolution:'retain'`, ordinary rebuild and retry never re-resolve against a new
month. `resolution:'refresh'` is an explicit authenticated revision operation:
server samples a new anchor, resolves again, increments factsRevision and stales
prior drafts. New scenario/customer creates a new request and anchor. Source
revision changes require save/requalification; old evidence never silently acquires
a new date. Current validation still uses current server time, not this retained
anchor. This does not modify accepted unrelated date rules.

Required later tests: equal/next minute with evaluation at :00 and :59.999;
UTC-day/year crossover, summer/winter fixed+1; equivalent Z/+01/+02 business
instants; invalid Gregorian/leap dates and offsets; date-only and nonzero
seconds/fractions; forged operator/output clock; invalid server clock and rollback;
rebuild across month retains bound, explicit refresh stales old draft. No tests or
runtime are added in this documentation correction.

### R2: one owner, complete strict shapes

Proposed modules (none created yet):

- `prodat/prodatReportingPermissionContext.ts`: types, strict parse/copy, minute
  gate, own-object matching and pure condition evaluation. It grants no authority.
- `testing/tgtReportingPermissionContext.ts`: **sole TGT source/scope owner**;
  source selection, notes creation/read/CAS inputs, key/ref lifecycle, current
  route resolution, independent build and persisted-message expected contexts.
- `prodat/prodatReportingPermissionAuthority.ts`: compare evidence with that
  independently returned expected context and actual draft/row/wire; select row
  OR raw Z13/Z14 for the protected boundary. No second source constructor.

The following is the full contract, not declarations added to runtime. Every
property shown is mandatory; only `| null` permits null. There are no optional
JSON members. A strict decoder rejects unknown keys, inherited/missing/undefined
mandatory members, wrong discriminators and invalid nested types at every level.
Strings are nonempty, unpadded and control-free unless explicitly noted; UUIDs
canonical lowercase; revisions UUIDs except declared source revision strings;
digests lowercase64hex; indexes/sizes safe positive integers (columnIndex may be0).
LI/ANJ max35, party IDs and qualifier/agency limits follow their existing exact
field contracts. Arrays are bounded by source object count and require unique
keys/selectors. Notes retain the existing 64KiB ceiling. JSON cannot smuggle refs,
route, scope, key, actor, clock or revision ownership through additional members.

```ts
type UUID = string;
type MarketMinute = string; // validated canonical twelve digits, fixed UTC+1
type PurposeCode = 'B71'|'B72'|'B73'|'B74'|'B75'|'B76';
type Party = { id: string; qualifier: string; agency: string };
type Installation = { id: string; agency: '9'|'89' };
type Selector = { workbook: string; sheet: string; entityLabel: string;
  columnName: string; columnIndex: number };
type SourceIdentity =
  | { kind: 'builtin'; id: string; revision: string; digest: string }
  | { kind: 'dynamic'; id: UUID; revision: string; digest: string };
type RunScope = { companyId: UUID; runId: UUID; roleCode: 'esco';
  caseCode: 'E3'|'E4'|'8.1.1'|'8.1.2'|'8.1.3'; suite: 'PRODAT' };
type StepScope = RunScope & { stepNo: number; code: 'Z13';
  actor: 'gridex'; direction: 'outbound'; environment: 'test';
  runtimeSuite: 'AGT'|'TGT' };
type Ref = { kind: 'process'|'authorization'|'declaration'|'classification'|'assessment';
  key: UUID; revision: UUID; requestKey: UUID };
type Term =
  | { kind: 'unknown' }
  | { kind: 'indefinite'; declaration: Ref }
  | { kind: 'bounded'; endMinute: MarketMinute; declaration: Ref };
type Classification =
  | { kind: 'unknown' }
  | { kind: 'private'|'nonprivate'; record: Ref };
type Purpose =
  | { kind: 'unknown' }
  | { kind: 'absent'; declaration: Ref }
  | { kind: 'assessed'; code: PurposeCode; assessment: Ref;
      legalActor: Party; customer: Party };
type RequestPurpose = { kind: 'unknown' } | { kind: 'absent' }
  | { kind: 'present'; code: PurposeCode };
type RequestOrigin =
  | { kind: 'pure_fixture'; reference: string }
  | { kind: 'persisted_request'; companyId: UUID; runId: UUID;
      messageId: UUID; source: SourceIdentity; bodyDigest: string };
type RequestAssociation = { kind: 'unknown' } | {
  kind: 'known'; origin: RequestOrigin; requestKey: UUID;
  requestRevision: UUID; li: string; anj: string; customer: Party;
  legalRequester: Party; process: Ref; authorization: Ref;
  reason: 'S17'|'S18'; purpose: RequestPurpose;
  allowedInstallations: Installation[];
};
type ObjectBase = { objectKey: UUID; requestKey: UUID; selector: Selector;
  process: Ref; authorization: Ref; li: string; anj: string;
  customer: Party; legalRequester: Party; expectedReason: 'S17'|'S18';
  term: Term; classification: Classification; purpose: Purpose };
type ReportingObject =
  | (ObjectBase & { code: 'Z13'; installation: null; requestAssociation: null })
  | (ObjectBase & { code: 'Z14'; installation: Installation;
      requestAssociation: RequestAssociation });
// N has no positive ReportingObject requirement; classify own wire reason first.
type OperatorTerm = { kind: 'unknown' } | { kind: 'indefinite' }
  | { kind: 'bounded'; end: string }
  | { kind: 'bounded_source'; minuteOfDay: string }; // exact HHmm
// No operator-authored reference is accepted as assessment authority.
type OperatorPurpose = { kind: 'unknown' } | { kind: 'absent' }
  | { kind: 'assessed'; code: PurposeCode; rationale: string };
type OperatorAssertion = { selector: Selector; term: OperatorTerm;
  classification: 'unknown'|'private'|'nonprivate';
  classificationRationale: string; purpose: OperatorPurpose };
type OperatorCommand =
  | { operation: 'save'; resolution: 'retain'|'refresh';
      sourceNote: string; objects: OperatorAssertion[] }
  | { operation: 'clear'; sourceNote: string };
// Action arguments outside assertion JSON are selectors/CAS tokens, not authority.
type ActionInput = { testRunId: UUID; stepNo: number;
  expectedRunUpdatedAt: string; command: OperatorCommand };
type Route = { settingsId: UUID; actorSettingId: UUID;
  routeProfileId: UUID|null; communicationRouteId: UUID|null;
  transportProfileId: UUID|null; legalSender: Party; legalRecipient: Party;
  senderId: string; receiverId: string; senderQualifier: string;
  receiverQualifier: string; senderSubaddress: string|null;
  receiverSubaddress: string|null; applicationReference: string;
  transportType: 'manual_upload'; mailbox: string|null; receiverEmail: string|null };
type StoredAssertion = { selector: Selector; assertion: OperatorAssertion;
  resolutionAnchorUtcMs: number; resolvedEndMinute: MarketMinute|null;
  sourceExpression: string|null; object: ReportingObject };
type ActiveStep = { state: 'active'; code: 'Z13'; factsRevision: UUID;
  source: SourceIdentity; routeAtApproval: Route; actorId: UUID;
  sourceNote: string; recordedAtUtcMs: number; objects: StoredAssertion[] };
type ClearedStep = { state: 'cleared'; code: 'Z13'; factsRevision: UUID;
  actorId: UUID; sourceNote: string; recordedAtUtcMs: number };
type StoredNotes = { version: 1; scope: RunScope;
  steps: Record<string, ActiveStep|ClearedStep> }; // canonical positive step string
// Stored only at top-level notes.prodatReportingPermission; no old envelope changes.
type ServerSource = { kind: 'tgt'; scope: StepScope; source: SourceIdentity;
  factsRevision: UUID; actorId: UUID; sourceNote: string; route: Route };
type TgtEvidence = { source: ServerSource; objects: ReportingObject[] };
type PureSelection = { source: { kind: 'caller_selection'; reference: string };
  objects: ReportingObject[]; evaluationUtcMs: number };
type ExpectedContext = { source: ServerSource; objects: ReportingObject[];
  evaluationUtcMs: number };
type BuildResolution = { evidence: TgtEvidence|null;
  expected: ExpectedContext|null };
```

Additional discriminator invariants are enforced, not left to TypeScript unions:
TGT ActiveStep/StoredAssertion contains only Z13 objects; Z14 persisted source is
not a supported ServerSource. `selector` equals assertion.selector and
object.selector. Bounded `resolvedEndMinute` equals object.term.endMinute; all
other terms have null resolvedEndMinute. Only bounded_source has nonnull
sourceExpression, exactly the selected source's raw321 expression. All nested
Ref kinds match their slot, requestKey equals the owning object's key and revision
equals factsRevision in current TGT objects; object.process.key=requestKey.
Purpose absent is an explicit assessed omission declaration, not unknown/null.
Private plus absent purpose rejects. Positive Z14 request unknown stays unresolved;
known absent requires independently nonprivate and response absent; known present
requires response assessed same code. A private request association without purpose
is inconsistent, including when the response tries to add one. N does not require
a fabricated positive object/association. Assessment legalActor is the original
legal requester: outgoing Z13 NAD FR; for pure positive Z14, independently joined
request sender/response recipient. It is not automatically the responding DSO.

### Server ownership and reference meaning

Only the authenticated save owner creates UUID request keys, ref keys and
factsRevision, reads actorId from access context, selects company/run/step/source/
route and samples anchors. For Z13 objectKey=requestKey; process.key=requestKey;
LI=`L` plus the request UUID without hyphens (33 chars). Authorization gets a
separate UUID and ANJ=`A` plus that UUID without hyphens (33 chars). Original
sender-set LI/ANJ cells permit this synthetic generator. If an independently
selected dynamic source prescribes a concrete LI or ANJ, use that exact source
value instead and check uniqueness; do not substitute a generated value. Never
borrow the builtin AVTALE5 fallback when the original says sender-set.
The generated alphanumeric 33-character values satisfy P p78 C506/1154 an..35;
C506/1153 is exactly LI/ANJ and unused1156/4000 remain absent. Encoding uses the
shared release-aware codec, never UUID punctuation/delimiters as wire structure.
The generated ANJ identifies only this synthetic test authorization assertion;
it cannot name or manufacture a live power of attorney.
Classification/declaration/assessment refs each get a server-created UUID for that
request and the current factsRevision. Rebuilds do not create any of these IDs.

These refs describe **bounded synthetic assertions**, not live legal approvals.
A nonempty arbitrary reference is never sufficient. The stored authenticated
actor + rationale + sourceNote, exact selected synthetic customer and legal
requester, current registered process, source identity and facts revision jointly
qualify the assertion. Known classification needs a nonempty rationale and must
not contradict an explicit source-qualified scenario class (including original
8.1.3 business). Unknown may use empty classificationRationale; known may not.
An included purpose needs a nonempty rationale, permitted code and agreement with
any prescribed source purpose; absent conflicts with a prescribed included
purpose and with private. If the selected source prescribes a concrete end, it must equal the assertion
after exact-minute qualification; if it prescribes a relative date expression,
require bounded_source and its explicit minute. Indefinite cannot override a
prescribed historical end. No generic customer-name/UD/purpose classifier is added.
Server binds `purpose.customer` to exact selected UD tuple and `legalActor` to
independently selected legal sender. Operator cannot supply either, or any ref,
LI/ANJ, key, source revision, route, actor, clock or authority flag. Operator's
selector only selects an exact current scenario column; it supplies no authority.

### Source selection, stable request lifecycle and CAS

`loadTgtReportingSourceSelection` in the sole TGT owner uses the existing global
catalog read `listEdielTgtDynamicTestData()` from `tgtTestDataStore.ts` to retain
id/updatedAt/rawText/parsedPayload. Filter exactly by suite/role/case, require at
most one record; if one exists it wins and a missing/malformed payload **fails**,
never falls back. If no dynamic record is available, only 8.1.1/8.1.2/8.1.3 may
select their explicit builtin source. E3/E4 require dynamic source and never use
label-based AGT fallback as fact. Existing shared loaders are unchanged; this
adapter treats their empty-list result (including the existing unavailable-table
case) as no dynamic source, not evidence for an AGT request. Errors propagate.
Once a request was bound to dynamic, disappearance/fallback changes source identity
and invalidates it until explicit requalification.

Dynamic SourceIdentity.id is rowid, revision is row.updatedAt, digest is SHA256
of deterministic canonical source content including rawText and full parsed case
metadata/groups/raw fields/column annotations. Builtin id is exact registered
suite/role/case; revision is a named reporting adapter version (initial
`reporting-source-v1`), digest is SHA256 of complete selected raw case plus adapter
version and original workbook hash above. Do not hash output as source. Any raw
source change is stale; even a metadata-only dynamic updatedAt revision requires
requalification. Locate source columns by complete Selector, unique across the
selected case, verify its own Z13 function and first-register-only scope. Exact
customer tuple/reason come from that source adapter; absent/ambiguous qualifier or
agency fails instead of guessing. The independently verified original workbook
supports the explicit builtin tuple mapping. Before qualification, separately fix
the 8.1.1 nonnormative source/output209 borrowing against original C23 and disable
response-ID substitution for all qualified Z13; original files remain frozen.

Creation/save/clear behavior is exact:

| Operation | Keys, revisions and consequence |
| --- | --- |
| First save or save after clear | Fresh factsRevision and request/ref UUIDs; server samples anchors; persist active entry. No key reuse from old payloads. |
| Save same source identity, selected customer tuple, source selector and legal requester | Preserve requestKey, LI, authorization/ANJ and all ref keys; fresh factsRevision for any assertion, sourceNote, actor or approval-route change. Update ref revisions consistently. Exact no-op preserves existing entry including recordedAt. |
| Source identity/revision/digest, selected customer, reason, selector set or legal requester changes | New request/ref keys and generated LI/ANJ for the step's selected objects on explicit save (source-prescribed references retain their exact source values). No automatic migration or positional matching. Previous evidence is stale. |
| Term/classification/purpose edit | Same request identity, new factsRevision; retain anchor unless explicit refresh. All earlier drafts fail revision comparison. |
| Explicit resolution refresh | New server anchor/resolved end and factsRevision; stable request IDs if other identity inputs unchanged. Earlier drafts stale, including if end happens to resolve equal. |
| Rebuild/retry or unrelated run status update | No reporting mutation or UUID generation; preserve keys/revisions/resolved values. Unrelated updated_at change alone does not invalidate reporting evidence. |
| Clear | Persist ClearedStep with fresh factsRevision and audit actor/note/time; remove active facts, refs and route from this step. All previous evidence invalid; no fallback to old envelope/evidence. |
| Run deletion or notes/key deletion | Independent read yields absent context; no resurrection from message evidence. Re-creation, if later authorized, starts fresh request identity. No deletion action is added here. |

New action `saveEdielTgtReportingPermissionAction` belongs alongside existing
`saveEdielTgtRegisterFactsAction` in `app/admin/ediel/actions.part-2.ts`; it does
not widen that old action's direct service-role write. Require write access,
scoped-run authorization, company permissions and operational status; then
**reload** `ediel_test_runs` through typed `tenantDb(companyId)` and verify the
expected CAS token and exact current registered ESCO/gridex/outbound/PRODAT/Z13
step. Resolve source-case AGT/TGT runtime and active test route on every save.
Use the fresh run's notes, preserving all other keys. Null/empty notes become
an empty object. Existing plain-text notes (as created by the current run action)
are retained byte-for-byte under `text`, as in the existing notes helper; they
supply no facts. An existing JSON object is preserved and its own reporting key
strictly decoded. JSON-looking malformed notes, wrong reporting version/scope or
invalid existing reporting value reject rather than being recast as innocuous
text or discarded. The 64KiB ceiling includes retained unrelated notes.

CAS uses ActionInput.expectedRunUpdatedAt, which must equal the freshly loaded
run.updated_at. Typed `tenantDb(companyId).from('ediel_test_runs').update(...)`
with `.eq('id',run.id).eq('updated_at',expectedRunUpdatedAt)` **and** exact old
notes equality (`.is('notes',null)` when null) writes merged notes, updated_by and
explicit server updated_at. The latter is ISO UTC milliseconds for
`max(operationUtcMs, floor(parsedOldUtcMs)+1)`; reject an invalid old token. This
strictly exceeds the loaded timestamp, including fractional database precision.
The original table migration declares a default updated_at, not an on-update
advance; do not assume a default provides CAS. Retain the returned id/updated_at
as receipt and next UI token; require one row. DB errors propagate; zero rows is
explicit concurrent-update failure, never an automatic overwrite retry. Matching
old notes also detects another notes writer that failed to advance updated_at.
This row CAS token is **not** factsRevision or SourceIdentity.revision. Unrelated
run writes may require operator refresh to save, but do not stale existing
reporting evidence. All reporting mutations use this CAS; no schema/trigger
change or live trigger inspection is proposed.

### Actual authorized operator entrypoint

The active route is `app/admin/ediel/system-tests/cases/[id]/page.tsx`, whose
registered run cards already call `createAndSendSystemTestOutboundForRunAction`
through `system-tests/actions.ts` → `actions.part-4.ts` →
`runTgtAutopilotForRun` → the normal create/link/send chain. Add only a reporting
save/clear form inside an existing ESCO outbound Z13 run/step card, wired via the
public `app/admin/ediel/actions.ts` wrapper to the dedicated save action above.
It posts testRunId, stepNo, expectedRunUpdatedAt and the strict OperatorCommand;
shows exact server-selected source selectors and current facts revision for review;
requires explicit term/classification/purpose declarations and source rationale.
It cannot offer Z14, a live/customer facade or another role. This is a bounded
form extension in the current authenticated page, not a new workbench or role.
All selectors and hidden CAS values are revalidated server-side. Save/clear
only update notes and revalidate the case/run page; they **never** create a draft,
queue, advance status or send. Existing create/send remains a separate explicit
action. Reusing an old linked draft after edits is blocked by the fresh reporting
revision comparison; an explicitly rebuilt draft must use the same saved notes.

The older `components/admin/ediel/EdielTgtWorkbenchPanel.tsx` has a register-facts
form, but no current importing route was located. An unused export/direct test
call is therefore not the reporting producer's UI completion criterion. Do not
wire or redesign that panel, nor repair other fact-family UI reachability in this
unit. Manual draft and autopilot code entrypoints still need the reporting guards
because they remain callable application paths. Later verification must exercise
the active page's form/action and existing create/send chain, in addition to pure
numeric-policy tests; neither alone is full UI/live certification.

### Exact read/match/copy and actual send boundaries

`resolveTgtReportingBuildContext` and
`loadTgtReportingValidationContext(message)` are named entry points in the sole
TGT owner. Each reads current scope/source/notes/route; neither accepts a route or
business source envelope from operator/payload. The persisted loader uses typed
`tenantDb(message.company_id)` reads for `ediel_test_run_messages` (by message.id,
limit2, require exactly one), `ediel_test_runs` (by linked run.id), and selected
`ediel_route_profiles` (by selected id). Match link company/family/code/direction/
step, run company/role/case/suite and registered actor/direction, row test/outbound
PRODAT, current source identity/revision and active factsRevision. Missing link,
run, cleared step or unqualified positiveZ14 produces unresolved protected failure;
multiple links/malformed scope produce invalid protected failure. Existing global
catalog reads are not tenant data; company-owned tables always use tenantDb with
a local typed query/result surface (no unscoped escape or `any` cast).

Resolve route from `requireEdielSystemTestRuntimeContext` using source-case suite;
settings company/id/active/test, actor setting, selected run/settings route agreement,
active/enabled test route and all exact legal FR/DO/UNB/transport/mailbox/email/
application fields must qualify as in the accepted date pattern. Compare current
route to routeAtApproval; changes need reapproval/save (new factsRevision), not
silent upgrade. No supplier array is relevant to reporting. A pure selection,
malformed evidence or fabricated `kind:'tgt'` object never substitutes for these
independent reads. The new selector inspects **row OR actual raw Z13/Z14** so stale
row labels cannot skip it; row/raw mismatch itself rejects before dispatch.

Match own first-register Z13 by exact unique LI + UD tuple + ANJ + expected
CCI Z13/CAV reason to its independently loaded request object. Require installation
null and all request/object keys unique. LI/ANJ are compared as decoded values,
never trimmed aliases; absent/malformed/duplicate physical values fail. Z14 pure
matching additionally requires exact allowed installation ID/agency and associated
requestKey/revision; repeated LI is allowed only for distinct explicitly authorized
installations of that same request. Do not require ANJ on Z14 wire where the source
excludes it: process/ANJ must instead equal the independent **original request**
association. The same distinction holds for legalRequester vs response sender.
A future persisted Z14 producer must independently read the original request by
origin company/run/message/source/revision/body binding and approved installation
scope; that reader/role is **not implemented or qualified by this unit**.

`BuildResolution.evidence` and `.expected` are separately deeply decoded/copied
from current notes; no shared mutable objects with each other, notes, route or
source. Copy every nested Ref/Party/Selector/SourceIdentity, array, purpose and
request association, including allowedInstallations and origin. At builder
snapshots, an omitted/undefined reporting slot falls back to the explicitly
supplied build selection once; an own explicit null clears the **whole** reporting
slot and suppresses fallback. Partial source-without-objects or vice versa rejects.
Evidence never stores evaluationUtcMs; each expected context gets its operation's
fresh server sample. No positive context is reconstructed from cleared evidence.
Tests must mutate nested expected.source.route.legalSender, object refs, customer,
request origin/allowedInstallations and verify both evidence and reloaded source
are independent, then reverse the mutations against evidence.

Manual `createEdielTgtDraftAction` resolves context before build and invokes
`assertTgtReportingDraft` on the final messageInput immediately before
`createEdielMessage`. Autopilot `tgtAutopilot.ts` must assert **after** its actual
communicationRouteId/mailbox/lockedSendContext attachment block (currently around
395–441), not only at build time; use the independently resolved expected route,
never redefine it to match the mutation. New/changed scoped reads in that branch
use typed tenantDb. Preserve source-case ACK family/profile. Manual/autopilot
creation attaches the exact registered draft step once. The active send actions
must retain that association through the R2.1 branch below; they must not append
a null-step link. Failed/missing attachment cannot later send because the
independent send read continues to require exactly one link.

Normal/catch validator and raw/row preflight receive the strict context; both
protected guards act before intentional-invalid escapes. Orchestrator may resolve
and preflight early, but `transport/index.part-2.ts` **real
sendEdielMessageViaSmtp** independently calls the reporting loader, samples current
clock and runs both guards again before any route/provider/snapshot side effect.
Do not reuse evidence as expected context or rely on a mock replacing sharedSMTP.
Later tests mock DB/provider edges while entering the actual shared function,
including direct outbox entry, stale row code, source change and post-autopilot
route mutation. Exact N exclusions need no positive context and inbound p119
remains separate. This source correction authorizes none of that runtime work.


### R2.1 correction: retain the exact association in active send actions

Independent round1 rereview found a concrete caller/callee mismatch, not a
hypothetical risk: `system-tests/actions.part-4.ts` create/send unconditionally
reattaches `stepNo:null` after autopilot has attached its exact step. Direct send
also reattaches with the submitted (possibly omitted) step. The duplicate resolver
in `db.ts:1341` returns early for outbound; the original unique index distinguishes
step1 from null/-1. Thus the active action can create two associations and correctly
fail the new exactly-one reader. R1 and core R2 remain closed; this correction
changes only the reporting branch's action integration contract.

**Scope selection:** apply this branch to the existing ESCO outbound Z13 test
producer, selected by row **or decoded raw Z13**, not by a caller flag, presence of
reporting notes or a root subtype. A stale non-Z13 row label cannot bypass raw Z13
selection; row/raw code mismatch rejects. No other fact-family attach behavior is
changed. This branch does not invent an outbound Z14 producer or impose positive
facts on general Z14N/pure/inbound policy. The separate shared reporting selector
and guards still cover their previously specified Z13/Z14 cases, with exact N
requiring no positive term/classification/request facts.

Name `requireTgtReportingSendAssociation` in the sole
`testing/tgtReportingPermissionContext.ts` owner. Both actual actions in
`app/admin/ediel/system-tests/actions.part-4.ts` call it before send-intent or send:

1. Retain the existing action authentication and independently authorize the
   selected company/run using the existing company-scope access gates. Treat form
   run/case/step and candidate message ID as selectors only. Reload the selected
   message through typed `tenantDb(authorizedCompanyId)`; require exact id/company,
   test/outbound/PRODAT/Z13 and row/raw agreement. A preferred-message result or
   autopilot return does not by itself prove association or company ownership.
2. Through typed tenantDb, select links by exact message.id with limit2 and
   require **exactly one** before checking its run/step. Do not narrow by submitted
   run or step to hide a second association. Require that link's company/message,
   nonnull positive step, expected family/code/direction and its independently
   loaded run's company/role/case/suite match the current registered ESCO/gridex/
   outbound/Z13 step. Reload current source/notes/route through the existing R2
   owner for subsequent authority checks. Missing, null-step, duplicate,
   wrong-run/company/step and malformed associations fail closed; never repair.
3. If the caller supplied run/case/step, each must equal the independently loaded
   association. Omitted step (or omitted optional direct-send run selector) uses
   the already validated link's exact registered value, not a payload/ordinal
   inference. It does not create a link. Return an operation-local receipt
   `{companyId,runId,messageId,caseCode,stepNo}` from those independent records.
   This receipt guides the action; it is not persisted reporting authority or a
   replacement for later fresh context reads.

In `createAndSendSystemTestOutboundForRunAction`, both branches converge on this
check: newly created autopilot messages must already have their exact attachment;
already-linked candidates must independently pass the same check. For selected
Z13, **skip the generic null-step attach call entirely**. Do not change the global
attach helper. Failure to create the exact link during draft creation is an error,
not a reason for create/send to guess or attach one. Pass the receipt's exact run,
case and step to `markSystemTestOutboundSendIntent` and audit metadata. Intent is
non-authoritative: modifying it cannot fix absent/wrong source or association.

In `sendSystemTestOutboundMessageAction`, the selected Z13 branch performs the
same check and **does not invoke the generic attach block**, even when form step
is omitted. Supplied wrong step/run fails rather than being overwritten. Existing
sendability/status rules remain; an already-sent repeat does not gain resending
permission. Unsent retry/repeated action retains one link and never appends null
or another exact link. The normal orchestrator and actual shared SMTP independently
reload context and enforce both guards after the action check; no action receipt
or intent bypasses that fresh read.

No schema/index change, global attach rewrite, newest-link choice, filtering away
null duplicates, global deduplication or old-row cleanup is part of this unit.
Existing ambiguous rows remain blocked pending separately authorized repair. Save/
clear still has no draft/attach/send effect. Positive persisted Z14 remains blocked
on its separate producer qualification; this correction grants no new role.

Required later integration tests enter the **actual public create/send and direct
send action chain**, preserving real autopilot attachment, association reader,
orchestrator and shared SMTP while mocking DB/provider edges (not replacing the
association validator or SMTP entry with success):

| Case | Required result |
| --- | --- |
| Fresh qualified Z13, create/send calls autopilot | Exactly one exact company/run/message/registered-step link created; no null link; action and real SMTP independently load it before mocked provider. |
| Already-linked unsent qualified Z13 | Retain the one exact link; no attach insert; correct step in non-authoritative intent. |
| Repeated unsent retry and already-sent repeat | Link count stays one; existing status/sendability controls still govern sending. |
| Direct send with omitted step/run selector | Existing unique registered association supplies actual step/run; no null-step attach. Missing association blocks. |
| Wrong company/run, explicit wrong step, null/unregistered step, or row/raw mismatch | Fail before send-intent/provider effects; no attach mutation or guessed replacement. |
| Exact step link plus null link, two exact links, or links to two runs | Fail ambiguity; no newest/filter/dedupe bypass and no repair. |
| Association/source changes after action validation | Orchestrator/actual SMTP fresh read blocks before provider; earlier receipt/intent cannot authorize. |

These are specified future tests, not claimed executions. Documentation-only
round2 runs integrity and diff checks; no additional runtime probe is introduced.

### Policy branches and integration

| Own object / independent fact | Proposed outgoing result |
| --- | --- |
| Exact Z14N | 321 and 323 forbidden; no customer/term/request facts needed. Preserve minimal N and physical supplied-field rejection. |
| Non-N, explicit bounded term | 321 required and equal to independent end; valid timestamp. V is allowed. |
| Non-N, explicit indefinite term | 321 forbidden. Z13VH conflicts with indefinite; reject, do not manufacture a historical end. |
| Non-N, missing/unknown term | Unresolved authority; a supplied end or S17 does not resolve it. Z13VH's structural end requirement remains separately known. |
| Z13VH | Required end also obeys source-specific nonfuture check, with an explicit evaluation clock/time interpretation. Do not silently invent a new broad time policy. |
| Non-N, private | 323 required, exact allowed assessed code; for Z14 exact independently correlated request purpose. |
| Non-N, independently nonprivate | Adjudicated Z13 include/omit; included code needs assessed basis. Positive Z14 must retain independent request presence/value, not choose independently. Private plus absent request purpose is inconsistent. |
| Missing classification or required assessment/request association | Unresolved; no root customerKind/byCell/status/output fallback. |

Builder → canonical first-register policy → deeply copied/body-bound evidence →
normal/catch validation → raw/row preflight → both protected guards → **actual
shared SMTP independent reload** is the required chain. Raw payload without
qualified facts cannot certify a positive dependent condition. Incoming parse
keeps p119 extra-information behavior and does not inherit outgoing local-fact
rejection. No ACK rewrites or lifecycle SQL are proposed.

Inspect every physical supplied 321/323 before reducing values: header/later
register/wrong parent, empty and duplicate values, malformed valid siblings,
exact qualifiers/components, date length/calendar/203, own adjacent CCI/CAV,
orphan/extra CAV and B71–B76 vocabulary. All accepted UNA alphabets and released
separators must use the shared codec. Do not trim malformed qualifier aliases
into valid authority or leak facts across messages/objects.

## Executed characterization and future verification boundary

Scratch-only actual-module probes reside at
`/workspace/scratch/2a201d6d5897/reporting-permission-probes`.
Command (from repo):

```sh
./node_modules/.bin/vitest run --config /workspace/scratch/2a201d6d5897/reporting-permission-probes/vitest.config.mjs --reporter=json --outputFile=/workspace/scratch/2a201d6d5897/reporting-permission-probes/results.json
```

Observed **40 tests: 30 passed, 10 failed, exit 1**. This is deliberately a
characterization/RED run, not a green acceptance suite. Unchanged archived PR339
probe: 19/29 pass, same 10 unresolved failures (four root byCell321, three
stale-root mixed-object, three supplied-Z13-value-as-authority cases). New 11/11
characterizations pass by confirming current behavior: catalog asymmetry;
identity-less source retained but notes rejected for two cases; business B72
builtin projection (original workbook independently checked); output default
purpose; omission of fabricated reporting facts from evidence; current shared
SMTP date selector excludes13/14; bounded V falsely rejected by literal historical
check, plus distinct identity-less groups and delimiter-dependent behavior across
three alphabets. Passing a characterization of a defect is not protocol PASS.
No database or provider method was invoked. Local Node24.19 differs from CI22.23.2.

After architecture approval and explicit runtime authorization, RED/GREEN work
must cover all typed
branches and both builder families, bounded V, explicit indefinite, historical
end/time, exact N, private/nonprivate/unknown, independent Z14 request presence
and value mismatch, source absence/staleness, swapped identities/agency/customer,
duplicate LI, identity-less requests, one request/multiple response installations,
wrong company/run/role/suite/step/route, source/body revision mismatch, all physical
malformed occurrences and UNA alphabets, strict nested-copy mutation and explicit
null clearing, normal/catch and raw/row paths. Verify both intentional-invalid
escapes cannot bypass protected errors and verify **the real shared SMTP entry**
reloads fresh context before every provider side effect. Retain inbound p119 and
existing ACK/profile behavior. Pure Z14 tests must be labelled separately from
blocked persisted Z14 coverage.

`npm run ediel:masterplan-v2:integrity` passes: **33 originals / 121 rules /
231 acceptance contracts**, applicationConformanceAsserted=false,
productionReadinessAsserted=false. No full CI or acceptance is claimed by this
source-only audit. Root owns exact-head publication and any cell acceptance.

## Review disposition requested

1. Source/SPEC is approved with the precise root323 decision recorded above;
   frozen originals and old assertions remain unchanged.
2. R1 and core R2 are closed. Independently rereview the sole R2.1 active-action
   association correction before approving the bounded producer architecture.
3. Decide runtime scope with an explicit split: both pure policies versus current
   Z13 persisted chain; **persisted positive Z14 remains a named dependency**.
4. Authorize any bounded runtime work only after independent source/architecture
   review. These four cells remain unaccepted at this audit commit.

Round 1 documentation verification: integrity remains 33/121/231 and diff check
passes; prior 40-case characterization is retained, not rerun or relabelled green.
No runtime, new broad probes, normative files or existing assertions changed.

Round 2 is scoped to R2.1 only: active create/send and direct-send retain the
independently validated unique association. R1/core R2 remain closed; no runtime,
other fact-family work, schema or existing-row repair is included.

## Runtime implementation and executed evidence (2026-09-19)

This section supersedes the historical source-only readiness statements above.
The approved contract remains the design authority; root alone owns publication,
independent completed review, exact-head CI, merge and main acceptance.

### Actual owners and consumer chain

| Boundary | Implemented owner and behavior |
| --- | --- |
| Pure strict types/copy/clock | `prodatReportingPermissionTypes.ts`, `prodatReportingPermissionStrict.ts`, `prodatReportingPermissionContext.ts`. Exact aggregate and nested keys, bounded arrays/strings, explicit null versus missing, refs/revisions/request ownership, deep independent copies. Fixed UTC+1 Gregorian minute; seconds/fractions cannot silently change a declared end. Exact empty NAD1131 is retained for legitimate `ID::89`; ID/agency stay required and TGT's original SE1/SE2:260 source requirements stay strict. |
| Per-object321/323 | `rulebook/prodatReportingPermissionPolicy.ts`. Own first-register reason, exact LI/UD/ANJ request association, explicit term/classification/assessment, physical placement/cardinality/qualifier/vocabulary, and independent Z14 request presence/value/installation correspondence. N requires no positive facts; inbound p119 does not reinterpret local unknown as sender-invalid. |
| Pure builders / diagnostics | Generic `buildProdat.ts` and profiled renderer consume the shared policy; root hints never decide these four cells. Pure results remain `reportingReadiness=unqualified`. Serialized pure evidence omits the evaluation instant and cannot authorize persisted send. |
| Evidence and protected consumers | `prodatRegisterEvidence.ts`, canonical fields, normal/catch rulebook, raw/row preflight and both send guards carry independent expected context. Whole context is not serialized. Body binding is integrity only. Intentional-invalid flags cannot bypass protected reporting failures. |
| Canonical persisted source | `testing/tgtReportingPermissionContext.ts` is the source/scope/route/read/write owner. Uses actual typed `tenantDb(companyId)` for new company-owned reads and CAS writes; current selected metadata reader is global catalog data. Dynamic malformed/mismatched/duplicate selection cannot fall back to built-in. E3/E4 need their selected dynamic source. |
| Notes and operator boundary | `tgtReportingPermissionAssertions.ts`, `tgtReportingPermissionNotes.ts`, `tgtReportingPermissionForm.ts`. Only operator declarations enter the form. Server creates stable test-only request/authorization keys, 33-character LI/ANJ, immutable source identity, facts revision and frozen source-expression anchor. Explicit refresh rotates revision/recomputes the anchor; clear creates tombstone; save uses updated_at plus previous notes CAS. No-op save still evaluates current historical-end clock. |
| Active authorized entrypoint | `app/admin/ediel/system-tests/cases/[id]/page.tsx` renders `EdielReportingPermissionForm.tsx` in each applicable run card. `reporting-permission-action.ts` authenticates, checks company permissions and operational state, reloads the run, then dispatches notes-only save/clear to the canonical owner. Swedish labeled controls show workbook/sheet/customer/reason/end/purpose source details. Generated authority is not editable. |
| Manual and autopilot production | Actual manual draft action and `tgtAutopilot.ts` independently resolve current reporting source and pass copied facts/expected context to the TGT builder. `tgtReportingPermissionDraft.ts` verifies again after actual route attachment and before message insert. Original8.1.1 projected209 borrowing and fixed ANJ are corrected against the original workbook; identityless requests retain generated stable references. |
| Active create/send and direct-send | R2.1 branch selects row OR raw Z13, authenticates company access, independently loads exactly one tenant/message association before run/step filtering, validates registered step and supplied selectors, and retains that association without null-step reattach. Omitted step resolves from the validated link. Missing/ambiguous/wrong-tenant/wrong-step rows fail; no newest/filter/dedup/repair/global-attach/schema workaround. Send intent records the independently validated step and does not establish authority. |
| Orchestrator and actual SMTP | Orchestrator reloads context for preflight. The shared `sendEdielMessageViaSmtp` reloads current source/run/step/route/association/clock independently and executes both protected guards before archive/provider edges. The existing `manual_upload` route shape remains compatible with the actual SMTP dispatch. |

Two actual-chain blockers were evidenced and fixed without guard suppression:

1. Active create/send and direct-send added a second null-step association after
   real autopilot had already inserted the exact link. Initial actual-chain RED
   rejected both with `PRODAT_REPORTING_ASSOCIATION_INVALID`; the bounded R2.1
   owner now validates and retains the one existing link.
2. Qualified TGT reporting drafts used legacy `process_type=tgt_prodat_portal_test`,
   rejected by the real canonical SMTP guard against Z13 `metering_access`.
   Qualified reporting drafts now obtain the process group from the existing
   `getCanonicalProdatProfile`; no standalone replacement map or test-row patch.

The positive original8.1.3 builder also exposed a generic coverage check demanding
contract start210 where Z13 uses report start302. The qualified Z13 branch now
checks source report-start DTM90; other codes retain existing mandatory-date
coverage. The old literal inference “DTM91 means S18” is removed: independent
bounded S17 is valid. Original historical S18 still requires its bounded nonfuture
end. Tests never manually patch produced message rows to pass the positive chain.

### Exact legacy assertion adjudications

The first full run was 4012/4027 with15 failures: two new active-chain RED cases
and13 old cases. Root read all five files and approved only these changes:

1. `ediel-canonical-policy-batch-regression.test.ts`: add exactly
   Z13/Z14:321/323 to undetermined IDs; keep full catalog and four date cells.
2. `prodat-dependent-condition-engine.test.ts`: the three root323 hints become
   undetermined. Actual own-wire N exclusions remain independently tested.
3. `ediel-prodat-dependent-z14.test.ts`: retain every older12-field/negative
   assertion and reporting diagnostic; add fixed independent request fixtures
   and fixed LI. Explicit S17/S18 fixture selection is an input, never inferred
   from the rendered response. N supplies no positive facts. No filtering away
   reporting failures was used.
4. `ediel-prodat-dependent-z14-boundaries.test.ts`: the two positive pure builder
   controls receive fixed request facts; installation assertions are unchanged.
   Fixtures remain pure and do not claim a persisted Z14 producer.
5. `ediel-prodat-dependent-z14-date-padding.test.ts`: only positive V send-lock
   control now expects explicit `SOURCE_UNQUALIFIED`, while all three date-field
   controls explicitly have zero errors. N still passes; malformed controls stay.

Basis is the approved per-object authority contract, P pp17/21/49/74, exactN and
original corporate8.1.3 plus the separately adjudicated precedence tension. Frozen
normative files, prior accepted field semantics and all other assertions remain.

### RED to GREEN and scope of execution

Retained scratch receipts are in
`/workspace/scratch/2a201d6d5897/reporting-permission-probes/`.
Initial runtime policy had8/11 failing cases; separate fabricated-TGT authority
case failed then passed. Notes producer initially failed5 positive controls;
unknown/no-op and fresh-clock lifecycle cases separately failed then passed.
The two initial real SMTP negatives previously reached the mock readiness/provider
boundary (`PROVIDER_BOUNDARY_REACHED`) and now stop before it. This is not evidence
of a real external send. Pure-clock serialization and legitimate empty NAD1131
were separately RED before their fixes. The original source40-case characterization
is retained as historical evidence; the runtime tests cover its applicable gaps
with independently supplied current-contract facts rather than rewriting probes
into acceptance certificates.

Six new suites contain100 distinct tests. The active-chain suite has37 cases:
actual active form/action, real source metadata reader and typed DAL/CAS,
manual and autopilot builders, real message/link DB functions, actual create/send
and direct-send, real orchestrator/send consistency, both guards and real shared
SMTP. Only external authentication/runtime-config/DB/archive/mail-provider/Next
navigation edges are mocked. The fake DB returns copied records and implements
filtering and CAS; no owner, guard, builder, autopilot, association or orchestrator
is mocked. Positive cases cover original private8.1.1/8.1.2 and nonprivate8.1.3.
Adversarial cases include missing/double links, wrong tenant/step, omitted step,
repeat send, stale labels, stale/cleared/changed source, changed route, changed
clock, missing/pure/altered evidence, concurrent notes write, authorization denial,
post-autopilot route mutation and deep-copy isolation.

### Acceptance limits

Pure policy for both codes is qualified by these local tests. Persisted ESCO Z13
source coverage is implemented and tested through the active original test path.
This makes only PC-321-Z13 and PC-323-Z13 candidates for later root acceptance.
No current positive persisted Z14 producer exists or was invented; PC-321-Z14 and
PC-323-Z14 still need the separately source-qualified DSO producer unit. Pure
fixtures and numeric coverage do not certify a UI/browser session, live market
workflow, external provider delivery or production authority. No live I/O occurred.
PR310 remains paused; root aggregate96/110 and10/10 parents is unchanged here.

### Final required verification receipts

Local runtime is Node24.19.0; required Node22.23.2 exact-head CI remains root-owned.
`final-gates.json` records every command, environment, duration and exit; all14
entries are exit0. `final-tz-gates.json` records all6 timezone entries, also exit0.

| Executed command | Final result |
| --- | --- |
| `NODE_OPTIONS='--max-old-space-size=4096 --require=./scripts/lib/refactor-safe-static-read.cjs' npx vitest run --reporter=json --outputFile=/workspace/scratch/2a201d6d5897/reporting-permission-probes/final-full.json` | 4096/4096 in269 files,0 failed;100 new cases over3996. |
| `npm run typecheck`; `npm run typecheck:scripts`; `npm run typecheck:tests` | Each exit0. Initial new-test literal/nullability errors fixed; no type suppressions or generated-type edits. |
| `npm run lint` | Exit0,0 errors,100 existing repository warnings; no new-module warnings retained. |
| `npm run quality:large-file-budget`; `npm run quality:performance` | Each exit0; source cap1800, API tenant/performance, N+1 and SLO budgets unchanged. |
| `node scripts/check-ediel-masterplan-v2.cjs` | Exit0:33 originals,121 rules,231 contracts; conformance/readiness flags remain false. |
| `node scripts/gridex-tenant-integrity-regression.cjs`; `node scripts/gridex-tenant-shutdown-regression.cjs`; `node scripts/check-service-role-tenant-ratchet.cjs` | Each exit0; actual call sites2401, immutable baseline2402. No suppression, alias-count workaround or schema change. |
| `node --experimental-vm-modules --test scripts/test-ediel-rule-pack-source-identity.cjs scripts/test-ediel-prodat-source-locators.cjs scripts/test-ediel-prodat-characteristic-fields.cjs scripts/test-ediel-prodat-reference-fields.cjs scripts/test-ediel-prodat-document-fields.cjs scripts/test-ediel-prodat-party-fields.cjs scripts/test-ediel-prodat-d-z04-reference.cjs scripts/test-ediel-component-escaping.cjs` | 818/818 exit0; isolated loaders/scripts unchanged. |
| `TZ=<zone> node --experimental-vm-modules --test scripts/test-ediel-guide-governance.cjs` and `TZ=<zone> npx vitest run __tests__/ediel-prodat-date*.test.ts __tests__/ediel-prodat-reporting*.test.ts --reporter=json --outputFile=<zone receipt>` | Each of UTC, Europe/Stockholm, Pacific/Apia:98/98 governance and630/630 date/reporting cases in16 files. These are repeated timezone runs, not multiplied distinct coverage. |
| `NODE_OPTIONS='--max-old-space-size=4096 --require=./scripts/lib/refactor-safe-static-read.cjs' npm run gridex:route-readiness-regression` | Exit0 with required existing preload. |
| `git diff --check` | Exit0; repeated after this derived audit update. |

No package, codec, loader, workflow, schema/SQL, generated type, frozen normative,
threshold, budget, service-role baseline or PR310 file was changed. Source audit
and runtime constitute one bounded unit; no automatic acceptance follows from
these local receipts.
