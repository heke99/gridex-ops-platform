# Field 229: original-source and producer qualification, 2026-09-19

Derived audit only. Accepted code base: PR342 merge
`5549a065318f39bc4aba99f3fab0b0924a2bc91e`; inspected task HEAD
`d337a9265393a678fcb7a92b1a2e937fb68bcef3`. No runtime/test, frozen source,
schema, migration, generated type, grant, proof, gate or threshold changes.
No live database/storage/send/deployment/settings action or remote mutation.
PR310 remains PAUSED at `e961135199f292b8210884f07de3b616a670161a`;
none of its contents were imported. No new cell acceptance or live certification.
Root owns active memory and independent contract review.

## Decision

The eight field229 rules can be implemented as one bounded protocol unit using
independent, exact per-object TGT source/run assertions, a shared address-fact
validator and the existing body-binding mechanism. The live Z01 producer's
business selection is a **separate unresolved authority**, not a reason to block
all protocol work. Do not confer live authority by accepting arbitrary caller
address values. Do not silently choose an address from `customer_addresses`.

This is the source/implementation contract for root review, not authorization to
change production runtime. Ten scratch probes reproduced current behavior
through actual modules; none establishes a live customer fact.

## Routing and evidence limits

Read AGENTS, active memory/checkpoint/work-plan, domain-model, canonical-flows,
integrations, decisions/known-failures searches, the task brief, masterplan
sections2/3 and frozen field/parent/conditional records. Read local
using-superpowers (dispatched-agent exemption), implementer instructions,
acquire-codebase-knowledge, quality-playbook, spec-to-code-compliance, fp-check
and verification-before-completion routing. Applied bounded spec/call-chain
tracing, original PDF visual inspection and actual-module refutation probes.
The PDF skill was applied. This is not a full QPB or fan-out repository audit;
root independently reviews this bounded source contract. No repository mapping,
security assessment, UI/Next change, DB modification, performance work or skill
creation was requested. Runtime debugging/TDD/review gates activate if root
subsequently authorizes implementation.

The historical remaining-dependencies audit predates PR341/342; its counts are
not current acceptance evidence. This audit makes no new acceptance count.

## Original source, precedence and exact cells

Original PDF freshly hashed:
`/workspace/scratch/2a201d6d5897/prodat-original-source/PRODAT-26A-r3.pdf`
SHA256 `83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95`.
Fresh `pdftotext -layout` reading of printed pages15,22,39,79,114-118;
rendered and visually inspected pages22,79,117,118 at1600px.
The PDF page indices match printed numbering for these pages.

- P p15: section2.2 takes precedence over contradictory appendix4 conditions;
  the base table describes first register, with registers2+ governed by appendix2.
- P p22: field229 is D for exactly the eight cells below. The note says
  "När elanvändaren anges ska adressen fyllas i om den finns" and permits1-3 lines.
  UD is R for Z01/Z02/Z03/Z04/Z05/Z08; active only for E in Z06/Z09.
  The same page explicitly distinguishes installation address from end-user
  address, whether their actual values are equal or different.
- P p39: SG8 repeats per installation/object; SG17 parties belong to that object.
- P p79: `SG17/NAD[3035=UD]/C059/3042[1..3]`, each `an..35`.
  C059 occupies NAD data element5; its three3042 values are components, not
  repeated NAD parties. C058 is unused; city is element6, postcode8, country9.
  The national D rule at p22 is not replaced by the segment table's O syntax.
  UD identity C082 carries its own ID/list/agency and must not be replaced by
  LIN identity. This task selects by exact LIN209 ID+agency and verifies the
  selected UD identity too.
- P pp114-116: nonlocal NAD information belongs to the object's first register;
  optional later repetitions do not supply first-register authority. Receivers
  use first-register information and ignore later nonmandatory repetitions.
  Existing stricter outbound Z06/Z09 UD scope checks stay intact; do not add a
  universal inbound rejection of source-permitted repetitions.
- P pp117-118: distinguishable street/box/c-o occupy components1/2/3. If only
  c-o is separable it stays in3; if only box is separable it stays in2. If only
  street is separable it stays in1 and the remainder goes in2. Fully unstructured
  address starts in1 and may continue through2/3. **The continuation at p118
  explicitly forbids an empty first wire field when2/3 is populated and requires
  a literal dot in1 instead.** Middle vacancies remain valid. Preserve source
  component positions; apply the documented dot representation only at the wire
  mapping boundary. The dot is not a selected street or availability evidence.
  Do not reinterpret generic `street_2` as box or c-o without producer semantics.

| Exact cell | UD applicability | Active + available | Inactive or known unavailable | Active + unknown |
| --- | --- | --- | --- | --- |
| PC-229-Z01 | R | R | X | U |
| PC-229-Z02 | R | R | X | U |
| PC-229-Z03 | R | R | X | U |
| PC-229-Z04 | R | R | X | U |
| PC-229-Z05 | R | R | X | U |
| PC-229-Z06 | E only; F/G inactive | R | X | U |
| PC-229-Z08 | R | R | X | U |
| PC-229-Z09 | E only; B/D/F/G inactive | R | X | U |

R/X/U here match every frozen `prodat_conditional_cells.json` row. U means stop
own send until business facts are known; it is not automatically an inbound
protocol failure. A missing or malformed reason cannot manufacture an inactive
UD. Resolve Z06/Z09 from exactly one source-exact field223 CCI++Z13/CAV in this
object's first register: E34 means E, E64 means F, E32 means G; retain the
existing Z09 B/D reason map. Do not substitute stale root subtype, aliases,
a reason in SG16/17, a sibling object or another message. The unrelated
reason/identity/parent guards continue to run for all eight codes.

UD is absent in Z10; address229 is unused in Z13/Z14/Z15/Z18 even where their UD
parent is present. This task must not activate it there or enlarge IV scope.
Cardinality for the qualified first-object address is one applicable UD party,
one C059 with up to three components, at least one populated component when R.
Known-unavailable forbids populated229; it does not remove the required UD
identity/name/postcode/city/country. Sparse semantic source `[,BOX,]` or `[,,c/o]` is available, but p118 requires
wire `.:BOX` or `.::c/o`. Literal leading-empty wire forms must fail outbound
qualification. A placeholder alone cannot manufacture available address data.

## Producer and consumer chain

### Live Z01 and application-domain selection

`intent/renderGateway.ts:renderAndQueueCustomerMasterdataZ01` invokes
`intent/renderers/customerMasterdataZ01.ts:buildCustomerMasterdataZ01Draft`.
That renderer loads `cis/db-shared.ts:getCustomerExportContext`, checks company
consistency, resolves `customer-operations/customerSiteProcessContext.ts`,
resolves the legal customer identity and object ID, then uses
`Boolean(clean(context.site?.street))` for both UD and IT availability. It also
copies site street/postcode/city/country into both parties. Render diagnostics
are placed in parsedPayload/validationReport.

CIS `CustomerExportContext` reads customer, contacts, site, metering point and
latest contract; it does **not** read customer addresses. Its company-consistency
check does not select an end-user address. The process resolver queries site by
company/customer/id and metering points by company/customer/site; this proves
process ownership, not equivalence of customer and installation address.

Domain counterevidence to treating site.street as universal UD authority:

1. `app/admin/customers/actions.part-2.ts` initially creates a `registered`
   address (`street_1=normalizedStreet`, `street_2=normalizedCareOf`) and a site
   with the same intake values. That is one write-time equality, not a continuing
   per-process authority. `external-contracts/intake.ts` similarly duplicates
   intake address values at creation.
2. `website/customerApplicationOnboarding.ts` separately creates a billing
   address from `customer.billing_*` and site from `siteInput.street/...`.
   The latter is explicitly an installation input; no customer-address identity
   or equality assertion accompanies it.
3. `ediel/inboundCases.ts` reads the IT party into `parsedSite.street` and writes
   that street into `customer_sites` during approved onboarding/application.
   Thus site.street can be independently updated from the installation party.
4. `types/customers.ts:CustomerAddressRow` distinguishes registered, billing,
   facility, other; has company/customer IDs, active flag and date bounds.
   `customers/getCustomerById.ts` reads a collection sorted by creation time.
   It does not enforce one applicable row, process-time validity, or designate
   which type is EDIEL UD. No unique source-selection rule was found in the
   traced outgoing paths.

Confirmed: the real renderer can emit an installation-only street as UD and IT,
without loading/selecting end-user address evidence (probe P6). Not claimed:
a real customer has received an incorrect message or any specific stored address
is authoritative. The fix must not choose newest registered, billing, or site
address by intuition. Missing `site.street` also cannot prove customer address
unavailable. This live producer remains unqualified until a separately reviewed
business mapping selects the address and its validity/ownership relation.

### TGT is a viable independent test producer

`testing/tgtProdatSource.ts:readTgtProdatSourceColumns` preserves raw values,
workbook/sheet/group/column context, function selection, exact object IDs and
agency. `groupTgtProdatSourceObjects` groups exact ID+agency and rejects ambiguous
cross-group duplicate objects. `tgtEdifact.part-2.ts:getPortalDataRows` isolates
one source group/first column per object before `getPortalData` reads field229
separately from234. Probe P8 observes USER-A/SITE-A and USER-B/SITE-B independently.

The existing `tgtRegisterFacts.ts` notes envelope binds company/run/role/case/
suite/step/code/source digest, actor and source note. Its digest includes raw229:
probe P9 changes only229 and the reader rejects the stale notes. `checkedFacts`
currently demands register inventory/count and copies only register facts, so
it does not yet transport address selection/availability. This is a reusable
source/run ownership pattern, not an existing certified address producer.

`saveEdielTgtRegisterFactsAction` requires EDIEL write access, scoped test run,
company permission, operational company, Gridex-owned PRODAT step and a
company/id/revision CAS. It currently limits codes to Z04/Z06/Z10. The manual
draft action and `tgtAutopilot.ts:createDraftForStep` both read the notes and pass
facts to `buildEdielTgtDraft`. No action was executed. Preserve these checks;
an address extension may allow the eight address codes only for already
registered, Gridex-generatable steps. Never enable a portal-owned step or a
blocked supplier facade simply to create an address test.

`buildPortalProdatSegments` emits every source object; `tgtEdifact.part-3.ts`
currently sanitizes scalar customerAddress (up to70) and interpolates one
component. It does not support a source-qualified sparse three-component
address contract. `tgtEdifact.part-4.ts` validates register facts and stores
`prodatEngine.registerEvidence`; it lacks the new address validation. The raw
source must be read before existing sanitization/truncation, with exact retained
source values. Unsupported/malformed source representations stay unknown/error;
do not turn blank/dash workbook cells into affirmative unavailable facts.

### Shared builders, row and protected transport

- `ProdatDependentConditionFacts` has root `endUserAddressAvailable`, no address
  object collection. `prodatDependentConditionEngine.ts` uses its boolean for229.
  False becomes legacy `not_required` without a forbidden229 enforcement.
- `canonicalPolicyFieldValidator.ts` has only Z06/Z09's one-object special path;
  it deliberately refuses root availability for multiple objects. Other codes
  still allow a root boolean. Neither route compares a selected source value.
- `prodat/render/segments.ts:prodatCustomerNadSegment` already preserves sparse
  addressLines, escapes values and limits each component to35 (probe P3).
  It also preserves an empty first component, which p118 disallows when2/3 is
  present; current UD syntax/policy accepts that wire (P10). Reuse the serializer
  with a UD229-specific source-to-wire mapping/validation; do not alter IT/IV
  behavior in this bounded task or concatenate/sanitize/truncate components.
- `buildProdatMessage` accepts per-object output customer fields, but its general
  validation accepts absent availability (P5), and return value has no address
  evidence for the persisted row. `buildProfiledProdatSegments` accepts scalar/
  array address input and snapshot fallback, and writes condition statuses plus
  register-only evidence. Explicit null/empty snapshot address clears must not
  silently inherit stale context address after the new contract is introduced.
- `prodatRegisterEvidence.ts` copies market/readings/registerObjects and binds
  decoded first-message body; it drops address properties (P7). This is integrity,
  not authentication or proof that the supplied business source is correct.
- `rulebook/validator.ts:policyForValidation` rehydrates register facts, then
  replaces unmigrated229 status with rendered snapshot status. P4 shows a
  required229 snapshot is trusted despite absent address source evidence. Remove
  that authority for these eight migrated cells. Without snapshot, test-mode
  unknown229 becomes warning with no protected `prodat_dependent` scope.
- `core/messagePolicy.ts` can read root booleans from parsed/report fields; this
  is a consumer, not a producer. It must not reinstate root address authority.
- `payloadPreflight.ts` rehydrates and protects register facts plus subtype
  violations, not availability229. `sendGuards.ts` protects register/dependent
  scopes before invalid-test override; `transport/sendLock.ts` protects their
  preflight prefixes before production-lock evaluation. P4 reaches both test
  guards successfully with unknown229. Production send was not attempted.
  Preserve catch/fallback guard paths when canonical snapshot is missing/invalid.

## Confirmed findings and refutations

| ID | Severity / affected paths | Direct observation | Root cause / bounded remedy |
| --- | --- | --- | --- |
| A1 | High protocol qualification; condition engine/validator | P1: all eight false + populated address produce no229issue | Legacy not_required lacks X enforcement; use exact object R/X/U policy |
| A2 | High source correctness; six-code policy/generic builder | P2: root true accepts six multiobject payloads; P5 generic accepts unknown | No independent object/UD/source value selection; add qualified per-object contract |
| A3 | High send gate consistency; profile/evidence/row/preflight/guards | P4/P7: facts dropped, snapshot trusted; absent snapshot unknown not protected | Shared persisted address evidence and protected normal/catch/preflight paths |
| A4 | High live producer selection; Z01 renderer/CIS | P6: installation-only context emits same UD and IT street | No independent end-user selector; live source remains unknown until separately qualified |
| A6 | Medium protocol representation; UD renderer/party syntax/229 policy | P10: blank first wire component with box/c-o accepted | p118 requires dot; add UD229-specific mapping and outbound validation |
| A5 | Current reusable source path, not defect certification | P8/P9: own TGT229 values distinct from234;229 edit invalidates notes | Extend existing authorized source/run pattern; do not equate a hash with authority |

False-positive limitations: Z06/Z09 multiobject root leakage is already prevented;
P2 explicitly verifies Z06 remains U. Shared C059 serialization preserves positions (P3), but p118 reveals the
leading-empty acceptance defect (P10); empty-middle behavior remains correct.
A wholesale shared renderer replacement is not justified. Existing body binding
rejects source/body changes, but cannot establish ownership by itself. A1/P2
use a policy filtered to229 to isolate this rule, so they do not claim that an
otherwise incomplete message passes full production validation. P4 executes the
actual test row gates, not live transport. No existing assertion was modified;
no contradiction requiring frozen-original correction was found.

## Proposed smallest implementation contract for root review

1. Add **one optional independent `endUserAddressObjects` collection** alongside
   existing `registerObjects`, not inside physical-register inventory. Address
   knowledge must not require an expected register count for Z01/02/03/05/08/09.
   Reuse the current body-binding/copy/read and authorized TGT notes pattern;
   avoid a new schema, rule store or paused310 proof mechanism. An additive
   optional collection can preserve existing version1 register semantics;
   absent collection means address U, never false or root fallback.
2. Each selected record carries exact decoded LIN209 ID and agency9/89,
   independently selected UD identity tuple (ID/list/agency), and selected
   process/source locator. Available records carry the **three positional decoded
   C059 components**. A source adapter, not the validator, maps known street/box/
   c-o semantics. Keep leading/middle empty slots in **selected source data**;
   map only the leading slot to dot for outbound UD when later slots exist, as
   p118 requires. Preserve an empty middle wire slot. Compare the wire to this
   documented projection, not to the unprojected source tuple. Never feed the
   wire dot back into the availability/selection fact. Normalize only deliberately
   defined outer text whitespace, never case, punctuation, releases,
   order or internal spaces. No fourth component; no component over35 decoded
   characters; no truncation. Compare each projected populated/empty position to
   the actual own-first-register wire address after EDIFACT decoding. Output presence cannot
   generate this record. A boolean true without selected values is insufficient.
3. Model `available` (selected usable components), `unavailable` (explicit
   authoritative source assertion of no end-user address), and `unknown` (no
   selection, ambiguity, absent/null knowledge). Unavailable has no address
   values; available requires at least one populated component. Inactive is a
   **wire parent result**, not an operator fact. Resolve it first; F/G and
   Z09B/D do not require availability facts. Invalid/missing own reason remains
   U/error and cannot be masked by a false address assertion.
4. Exact first-message/first-register scope and UD identity must match. Duplicate,
   missing, extra or wrong-agency selected objects must fail instead of taking
   the first match; an expected active object absent from the body must not pass
   vacuously. Unknown active records stop sending. Root/byCell/status snapshots,
   sibling objects, later registers/messages, IT/IV and raw address values are
   never address-authority fallbacks. Preserve existing structural/parent guards.
5. TGT address producer: keep run/company/role/case/suite/step/source binding and
   actor/source-note authorization. Select own raw field229/229-1..3 plus own
   identity227 from the exact object/function/first-register source column.
   Reject conflicting aggregate/component representations. Existing unsplit229
   is one line only when <=35 and genuinely unstructured; longer/multiline text
   needs an explicit lossless source mapping, not a70-character truncation.
   Structured component columns must retain empty slots and be included in the
   digest. Available selections must agree with original selected values;
   known unavailable requires an explicit source assertion and cannot override
   nonempty source229. Blank/dash/absent workbook field alone is unknown.
6. Extend the existing notes authorization boundary narrowly for these eight
   source-backed address codes, preserving Gridex-owned allowed steps and CAS.
   Both manual and autopilot readers validate source/run context. Copy qualified
   selections into persisted evidence with source provenance and company/run/
   step association. Validate row ownership at the consumer boundary; an external
   caller cannot nominate a source ID to make it authorized. The hash binds
   selected evidence and body, not permission. TGT is a test source only.
7. Generic and profile builders take the same independent selection collection,
   use the existing positional NAD renderer, and invoke the same229 validator.
   Generic output must expose the shared persisted evidence, just as profile
   diagnostics/TGT do; no fabricated evidence from just-rendered customer values.
   Snapshot clearing is explicit; malformed overrides throw, and null/empty
   clears do not borrow stale context. Recompute per-object229 decisions after
   rendering; status snapshots may describe but never authorize them.
8. Run the shared policy in canonical validation, TGT validation, row rulebook,
   preflight and both protected guards, including missing/invalid snapshot catch
   paths. Failures carry protected dependent scope/prefix before invalid-test
   overrides. Body/source mismatches fail closed. Keep inbound parse-only behavior
   independent of unavailable local address knowledge; wire syntax still applies.
9. Live Z01 cannot create this new evidence from site.street. Until a business
   source selection is independently approved, it remains U and the shared send
   guard blocks it; document that operational limitation. A later producer task
   may use an existing typed customer-address record **only after** proving exact
   company/customer/process/time relation and selection semantics. Arbitrary
   caller input, a collection, or a `registered` label is not that proof.

This permits eight-cell protocol qualification with a real source/run-bound test
producer while explicitly withholding live Z01 certification. It neither opens
blocked roles/markets nor imports paused310. No IV or other numeric cells gain
acceptance credit.

## Required implementation verification (not yet run)

After root review: actual-module RED/GREEN for each eight-cell R/X/U branch,
Z06E/F/G and Z09E/B/D/F/G own reasons, duplicate/missing/wrong-scope UD, selected
source values missing/swapped/altered with newly rebound body, exact ID/agency/
UD identity, one/multiple objects/registers/messages, missing expected object,
p118 dot projection, leading-empty wire rejection, empty-middle positions,35/36 lengths, fourth component, releases and supported UNA
alphabets, inactive records, contradictory false values, absent/null/empty
snapshot clears, stale run/source/body/tenant, manual/autopilot/generic/profile,
normal and snapshot-catch row paths, both guards with invalid-test override,
and inbound parse isolation. Preserve existing assertions/gates; report any
source contradiction before correcting one. No unrelated full suite for this
documentation-only phase.

## Executed verification

Scratch config/test:
`/workspace/scratch/2a201d6d5897/party-address-probes/vitest.config.mjs` and
`address.test.ts`. Synthetic data only. The actual source modules were loaded;
Z01 mocks only CIS/process boundaries, with a Supabase mock that throws on access.
No production test files were created or modified.

Command from the worktree:
`node node_modules/vitest/vitest.mjs run --config /workspace/scratch/2a201d6d5897/party-address-probes/vitest.config.mjs --reporter verbose`

Final result **10/10 passed**, Vitest4.1.9, local Node24.19.0. These are baseline
observations, not green implementation regressions and not required-CI Node22
certification. Initial scratch attempts failed due to mock import setup, an
invalid Z08 fixture subtype, a missing generic date, a missing TGT runtime stub,
and the disproved initial hypothesis that a populated profile snapshot would
produce U. The final probes use Z08H, valid date/runtime fixtures and explicitly
record the actual snapshot-trust behavior; production code was never changed.

### Source-backed correction boundary discovered during final review

The first audit draft incorrectly treated leading-empty C059 wire as legal after
reading p117 alone. Reading and visually checking its continuation p118 refuted
that claim. Root was notified before this audit was committed and before any
runtime/assertion change. P10 records actual acceptance of the nonconforming
wire and support for the correct dot representation.

Searched existing `__tests__` for addressLines, sparse/empty-first, BOX/c-o and229.
No existing assertion was found that expressly requires a leading-empty UD
address to be valid. Existing assertions to preserve:

- `ediel-prodat-party-consumers.test.ts:36,67,69,167-169` preserves an empty middle
  component and exact decoded address contents; these remain valid.
- `ediel-prodat-party-consumers.test.ts:131-133` rejects an extra UD component and
  an IT address with a missing first component; preserve both.
- `ediel-prodat-party-review-regression.test.ts:186-191` keeps generic parse-mode
  dependent229 from becoming unconditionally required; preserve it.
- `ediel-prodat-dependent-subtype-ud.test.ts:88` rejects empty first name and
  overlong/malformed name input; this is not an address assertion.

Requested correction list for the next authorized task: add UD229 source-to-wire
p118 dot projection and reject leading-empty supplied outbound UD C059; add
regressions for source `[empty,box,c-o]`, `[empty,empty,c-o]`, `[street,empty,c-o]`,
all-empty U/unavailable, and a dot that cannot establish source availability.
Parser must preserve raw/decoded source; do not silently repair inbound evidence.
Keep IT234/IV252 shared serialization and their existing tests unchanged; their
own source audit/qualification is separate. No existing assertion is authorized
for removal by this source-only phase.

Frozen package integrity and clean diff checks are recorded in the task report.


## Authorized runtime implementation, 2026-09-19

Root approved the nine-point contract at30775e1b, including the p118 correction.
This section records the implementation submitted for independent runtime review;
source approval alone is not runtime acceptance or production certification.

- `prodatEndUserAddress.ts` defines and strictly copies the optional independent
  selection collection, explicit available/unavailable/unknown states, exact
  object and UD identities, source provenance and company/run ownership.
  `prodatEndUserAddressPolicy.ts` resolves own-first wire parents and compares
  each decoded component to the selected source's UD-only p118 projection.
- Generic output exposes the existing body-bound register-evidence envelope;
  profile diagnostics and TGT persist the same additive collection. Rendered229
  diagnostics describe required/not-required/undetermined after this policy.
  The legacy root boolean API remains a labeled descriptive pre-wire hint to
  preserve old assertions; neither canonical nor protected send validation uses
  that hint, byCell, or a status snapshot to authorize229.
- Snapshot scalar and component addresses are one override: explicit null/empty
  values clear the selected representation instead of reviving stale context.
  Selected source keeps its empty street; only UD wire output receives dot.
  IT234 and IV252 rendering and inbound parser behavior are unchanged.
- TGT selects positional raw229 cells before scalar sanitization. Existing
  run/company/role/case/suite/step/source digest and authorized Gridex-step/CAS
  notes boundaries remain. Saving assertions checks exact source values; reading
  and the actual draft boundary recheck source/run ownership. A caller-selection
  record cannot masquerade as TGT notes provenance. Built-in and imported source
  paths use the same selected-source lookup. The existing2000-character source
  note limit also governs the persisted provenance reference.
- Canonical, TGT, generic/profile, row preflight, normal rulebook and production
  missing/stale-snapshot catch paths invoke the common policy. Failures retain
  protected dependent scope/prefix before intentional-invalid overrides. Existing
  register topology/error protections remain.
- Raw `preflightEdielPayload(mode:send)` already called the rulebook and stays
  send-qualified. The saved-switch Z03 positive fixture exposed dropped evidence
  at `buildEdifactEnvelope`; its renderer diagnostics and independently supplied
  switch-company ID now reach preflight. Row preflight supplies row-company ID
  and independently repeats the shared policy. No structural-only mode/skip flag
  or authority derived from the checked fact was introduced.

### Existing fixture compatibility

No pre-existing assertion or parser behavior was changed. The existing fixed UD
fixture now has a separate fixed-source factory; it does not inspect output.
Bodies lacking an unrelated required UD gained the same independent synthetic UD
fixture solely to keep the old positive control valid. Affected families:

| Existing family | Independent fixture addition |
|---|---|
| date-fields | fixed USR identity, explicit unavailable source |
| dependent-subtype-message-scope / review / ud-boundaries | own A/agency and fixed UD source; generic unavailable source |
| dependent-z06-product | fixed A/UD source in persisted evidence |
| optional-installation | fixed OBJECT-A UD/source; generic unavailable source |
| party-consumers / party-review-regression | existing explicit UD identity with unavailable source |
| register-builders | fixed USR sources for default and explicit A/B objects |
| register-compat-outbound | fixed saved-switch USER/Street source passed through envelope |
| register-readings / register-structure-guards | independent UD/source beside original register facts |
| synthetic-customer-journey-pre-smtp | fixed selected customer Testgatan1 source, separate from site inputs |

### Executed verification and limits

Actual-module RED: initial core49fail/45pass; initial TGT8fail/6pass; later
strict-type/TGT drift5fail/112pass; diagnostics1fail/98pass; scalar-only snapshot
override2fail/99pass. A subsequent new snapshot expectation incorrectly expected
`[]` although the unchanged parser preserves an empty C059 as `['']`; corrected
only that new expectation. All logs are in the external task report's probe dir.

Final full Vitest:3668/3668pass; new address core104 and TGT20 tests pass. Typecheck,
frozen integrity33originals/121rules/231contracts, large-file budget, API tenant/
performance, N+1 and SLO gates pass. Node24.19.0/Vitest4.1.9 locally; independent
remote/Node22 review and publication belong to root. No external database/send
was exercised. No thresholds, workflow, schema, originals or paused310 changes.

Live Z01 remains unqualified/U: site.street is not independent customer address
authority. Caller protocol selections are not authorization. TGT is source/run-
bound test evidence only. This unit does not claim live completeness, certify
other numeric cells/parents, or complete the masterplan.

## Initial CI correction receipt

PR343 first published candidate c94df2f0 had CI failures: Ediel document-field script three missing synthetic address sources (142/145), shared route-readiness smoke14/15, and lint20 no-explicit-any errors in new tests. Coverage independently passed3668/3668Node22.23.2. Correction00ec3754 changes only three test files: fixed OBJECT/9→CUSTOMER/89 unavailable source plus explicit test types, no assertions/runtime/gates/suppressions changed. Document145/145, all downstream Ediel workflow commands (three date timezones), route-readiness, address124/124, testtypes and lint(0errors,103existingwarnings) PASS. Final delta review and newheadCI pending; acceptance48/110unchanged.
