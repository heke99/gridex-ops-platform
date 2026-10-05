# Four reporting/permission context cells — BLOCKED qualification

Base: accepted main11d9e55621f422bafb2a36818e08fee4fbb93241 (PR338), plus retained
root memory checkpoint9c4a23d5. Candidate scope: PC-321-Z13, PC-321-Z14,
PC-323-Z13, PC-323-Z14. All four remain UNACCEPTED. A narrow explicit Z14N exclusion fix is included;
full positive-context qualification remains BLOCKED.
Accepted progress remains30/110 numeric D,4/10 parent occurrences. Full F3,
masterplan, release and live acceptance remain incomplete.

PR310 remains PAUSED at e961135199f292b8210884f07de3b616a670161a. No content was
imported from that branch. No migration/schema/type/grant/proof changes, active
memory edits, normative edits, prior assertion changes, gate changes, remote
mutations or live DB/storage/send/deploy/settings operations were performed.

## Skill routing and evidence-first decision

Read AGENTS, active memory, domain-model/canonical-flows/integrations and searched
decisions/known-failures. Applied systematic-debugging and test-driven-development
for actual-module RED evidence, verification-before-completion for precise claims.
The existing task brief supplies the bounded plan. Reviewed spec-to-code skill;
its broad fan-out workflow is not claimed here: root owns independent review and
requested a bounded qualification, not a new repository-wide audit. Reviewed
quality-playbook/acquire-codebase routing; new global artifact generation is out
of scope, existing unchanged quality gates retained. UI/Next.js, DB modification,
performance, infrastructure, skill authoring and deployment groups are absent.
No production change preceded the findings. Root directed retaining full-cell
BLOCKED status, then separately directed repair of the independently provable
Z14N exclusion bypass without inventing positive-context facts.

## Complete retained source notes, segment tables and precedence

Evidence read: frozen `registers/prodat_fields.json`, four rows of
`registers/prodat_conditional_cells.json`, `annex/source_tables.json` P p17 table1,
p21 table1, p49 table3, p74 tables1–2 and p121 table1, plus annexB and masterplan
§2.2/§2.4/§7.3. The full field notes, not only the projection, matter:

| Cell | Full retained source meaning | Frozen conditional projection |
| --- | --- | --- |
| PC-321-Z13 | P §2.2 p17: reporting-end timestamp is given unless reporting is intended indefinitely. P §2.6 p49: SG8 DTM91/C507/2380,203 CCYYMMDDHHmm. | bounded=>R; false=>X; note VH requires end, V indefinitely has no end |
| PC-321-Z14 | Same p17/49 rule, explicitly not sent in Z14N. | non-N AND bounded=>R; false=>X |
| PC-323-Z13 | P §2.2 p21: permission purpose must be given for private customers. P §2.6 p74: CCI C502/6313=Z24, adjacent CAV C889/7111=B71–B76. | private=>R; false=>X |
| PC-323-Z14 | Same p21/74 rule, explicitly except Z14N. | non-N AND private=>R; false=>X |

P p74 CCI unused7059 and unused6321/6155/6154 are not permission facts.
CAV coded7111 is an..3, other used/unused components follow the detailed table;
A02 in an example is not a permitted purpose code (masterplan§2.4 explicitly
records that source conflict). Supplied empty, misplaced, malformed and duplicate
values must not disappear when reducing to the object's valid value.

V/S17 is ongoing reporting, but it does NOT establish an indefinite term: a V
request may have a bounded end. An absent321 cannot prove indefinite intent.
VH/S18 means historical reporting; the frozen cell note requires an end, while
P appendix4 p121 also says Z13VH321 may not be future. The latter is a temporal
constraint, not an independent customer/permission authority or a license to
invent a missing end. No new temporal algorithm was implemented in this unit.
Only the object's exact, correctly placed, unique first-register reason can
establish V/VH/N; root subtype, aliases and later messages cannot replace it.

Nonprivate323 interpretation needs care. Frozen PC323 explicitly says falseX.
P p21 does not contain an explicit nonprivate optional branch. Masterplan§7.3
says falseD is not GENERALLY X (its example is Z06), but neither does it make
all falseD optional. The P§2.2-over-appendix4 precedence rule is not authority to
replace an explicit frozen PC323X with O based on silence. An initial exploratory
statement that business323 was optional was withdrawn BEFORE runtime changes;
no test or artifact endorses it. The retained original note alone does not settle
an independent universal nonprivate prohibition. This qualification preserves
the frozen X target; any proposed departure needs positive source evidence and
an explicit interpretation decision. Unknown customer kind remains unknown.

## Complete relevant execution path and confirmed gaps before repair

| Actual path read | Evidence and consequence |
| --- | --- |
| `prodat/buildProdat.ts` | accepts root dependentConditionFacts and several objects; only register validation consumes those facts. Its additional Z14 helper covers the prior twelve cells, not321/323. No per-object reporting/customer fact contract. |
| `prodat/types.ts`, `builders/z13.ts`, `builders/z14.ts`, `builders/profileRenderer.ts`, `prodat/engine.ts` | context contains permissionPurpose/report dates plus root condition facts; renderer resolves one root policy and copies diagnostics/statuses. A supplied field is output data, not an independent factual source. |
| `prodat/prodatDependentConditionEngine.ts` |321 uses arbitrary root byCell;323 uses root customerKind with loose non-N evaluation. Neither joins a fact to each object. |
| `rulebook/canonicalEdielPolicy.ts`, `canonicalPolicyFieldValidator.ts` | old statuses still decide321/323; unlike migrated cells they do not recompute from each object's own source reason and independent facts. A rootN may suppress the actual positive object's knowledge requirement. |
| `prodat/prodatRegisterGroups.ts`, `rulebook/prodatEndUserPolicy.ts`, `prodatZ14Policy.ts`, `prodatSubtypePolicy.ts` | accepted object/register grouping and strict reason machinery exist. Z14 protected selection is the twelve prior fields/parents, excluding321/323. Must retain source-exact UNA tokenization and first-message boundaries. |
| `prodat/prodatRegisterEvidence.ts` | copies only market/readings/registerObjects. customerKind/byCell are deliberately not transported. Its body binding is integrity only, explicitly NOT authorization. Rebranding it as permission authority would be wrong. |
| `rulebook/validator.ts` | send rehydrates register facts only, then may replace root statuses from diagnostics. Catch path protects migrated dependent payload rules. These four still lack an independent per-object fact source. |
| `core/messageBuilder/payloadPreflight.ts`, `rulebook/sendGuards.ts`, `transport/sendLock.ts` | row preflight invokes subtype overlay and register evidence. Both guards protect corresponding issue classes before test overrides. The four cells are absent from that protected overlay. Actual probe proves N323 escapes both guards. |
| `prodat/validateProdat.ts`, `render/validate.ts` | structural/date checking exists; Z13VH context requires start/end. Neither carries independent per-object reporting intent/customer classification. No inbound enforcement expansion is justified. |
| `core/messagePolicy.ts` | additional root parsed/report customerKind and byCell projection exists, but it is not a server-authorized per-object producer. |
| `prodat/compatAdapter.ts` renderProdatSegments | copies purpose/end from portalData, with no independently sourced reporting-term or customer-kind fact. Arbitrary portalData must not be upgraded into authority. |
| `permissions/z13RequestAccess.ts` → `orchestrator.ts` → `flows/prodatSwitch.ts` | prepareAndQueueEdielZ13 and Z14 both return blockedSwitchFlowCode. No authorized production permission-fact producer is implemented there. |
| `permissions/z14HandleResponse.ts`, `flows/prodatPermissionLifecycle.ts` | response state transitions and inbound Z15 persistence do not provide authoritative outgoing Z13/Z14 per-object facts. The Z15 handler's matching is not an outbound permission producer. |

Confirmed findings (major, local protocol/send boundary): arbitrary byCell321
manufactures a resolved condition; stale rootN/customer kind hides missing
per-object facts; supplied323 on N escapes protected preflight and guards,
including malformed header sibling values beside a valid-looking B71 value.
Impact: intentional-invalid test send overrides can bypass these missing bounded
protocol checks. This evidence does NOT demonstrate a live production send or
that the independent production readiness guards are ineffective.

## Actual-module RED evidence, before any fix

`f3-reporting-context-probe-20260919.ts` is an explicitly archived RED reproducer,
not a green regression or a weakened mandatory test. It is outside the existing
Vitest include pattern; no config was altered. To reproduce, copy it unchanged
to `__tests__/f3-reporting-context-probe-20260919.test.ts`, run
`npx vitest run __tests__/f3-reporting-context-probe-20260919.test.ts`, then remove
only that temporary copy. It uses actual application modules and existing
independent EDIFACT fixture encoding; no DB/network/provider mocking.

Observed:29 cases,19 FAILED defect expectations and10 passed controls. Machine
summary retained in `f3-reporting-context-probe-20260919.json`.

- Four RED cases:321 byCell true/false resolves required/not_required for both codes,
  despite no independent bounded-reporting fact.
- Three alphabets each cover five RED cases: N323 through transport guard; N323
  through rulebook guard; malformed A02 header sibling plus B71 object purpose;
  mixed V/N objects with stale rootN/private facts; supplied Z13 date/purpose
  without independent facts. Unknown remains the desired result, not authority
  inferred from presence. N323 exclusion itself requires no customer-kind guess.
- Ten GREEN controls: minimalN passes protected transport in each UNA alphabet;
  inbound parse does not acquire outbound knowledge rejection in each alphabet;
  later message is blocked in each alphabet; register evidence omits customerKind
  and byCell, confirming the contract gap rather than calling that omission a bug.

No test presumes a nonprivate optional branch. Existing assertions are unchanged.
After the narrow repair, this same probe has19 passed/10 failed. The remaining
10 failures are the four byCell321 cases, three stale-root mixed-object cases
and three Z13 supplied-field authority cases. The nine N323/protected-scope
failures now pass. Full-cell authority expectations remain unresolved.

## Bounded safe integration design required before implementation

1. A server-owned permission/request producer must resolve the legal process and
   the exact tenant/customer/installation association for EACH object. The
   producer must supply reporting-term intent (`bounded`/`indefinite`/unknown)
   and canonical customer classification from independent domain records. An
   explicit indefinite declaration is required; null end-date is not proof.
   Purpose code, date presence, personal-looking identifiers and parsed inbound
   claims cannot supply customer kind or authorization.
2. Resolve and evidence the producer's actual domain source before adding a type.
   `customers.customer_type` appears in an unrelated Z03/Z04 candidate reader,
   but merely finding that column does not establish the permission/customer
   relationship. No production schema change is proposed or required by this
   qualification; if existing records lack explicit indefinite intent, preserve
   unknown until an authorized producer/contract can represent it.
3. Bind each fact to the exact message/process revision and object scope. LIN id
   plus agency is useful when present, but Z13 can legitimately omit identity;
   an approved contract must also handle identity-less objects without requiring
   forbidden identifiers or borrowing another object's facts. A stable server
   object association plus exact serialized object/body binding can preserve
   provenance. Duplicates, missing matches, wrong company/customer/process,
   changed body, and stale revisions must fail closed. A hash alone proves no
   authorization. Do not import pausedPR310 proof machinery.
4. Carry checked facts through generic/profiled builder → canonical validation →
   persisted server-owned message evidence → row preflight → both protected send
   guards. Read facts only from that verified producer/evidence, never arbitrary
   request flags/status snapshots. The generic builder needs a deliberate
   trusted internal input contract; the payload-only validator cannot invent
   facts and must remain unknown where external facts are necessary.
5. Evaluate own exact reason first; apply N exclusions before other facts. Apply
   qualified bounded/indefinite and customer branches per object. Scan all
   supplied321/323 before scope narrowing for exact qualifiers, components,
   code vocabulary, lengths, date semantics, duplicates and placement, including
   valid siblings. Preserve protected unknown rejection in test and production,
   and the separate inbound parse-only contract.
6. Add actual-module positive cases using genuinely sourced synthetic producer
   fixtures plus negatives for absence/unknown, stale/swapped facts, multiple
   objects/registers/messages, malformed siblings, all UNA alphabets, both
   builders and send guards. Then run the existing mandatory verification and
   independent review before claiming any accepted cell.

This is a MISSING AUTHORITATIVE PRODUCER dependency, concretely shown by current
call paths. It is NOT evidence that merging PR310 is necessary. No paused branch
was inspected/imported and no claim is made that its contracts solve the gap.
Enabling blocked production flows or designing new permission authority is a
separate process/authority work item, potentially related to F2, not a silent
extension of this four-cell field patch.

## Verification

### Narrow verified implementation (no accepted-cell increment)

`prodatZ14Policy.ts` selects321/323 rules only for explicit N exclusions and
source placement. `isZ14DependentField` is unchanged: positive321/323 condition
resolution still follows the old path and remains BLOCKED for qualification.
All tokens are scanned for unowned/header/late SG8/SG14 data before object
selection; that is a placement failure, not a customer or reporting fact borrowed
from a neighboring object. Each N object's exact wire reason then forbids any
supplied321/323, including empty/padded/malformed siblings. Recognition of padded
qualifiers is only for rejection. No normalization makes an invalid reason valid.
The existing protected helper already serves generic/profiled builders, canonical
policy, preflight and both guards. `canonicalPolicyFieldValidator.ts` explicitly
keeps these new outbound checks out of inbound subtype validation.

New `ediel-prodat-z14-negative-context.test.ts`: initial40 cases yielded34 RED/
6 GREEN before repair. The first implementation exposed an inbound-isolation
regression when a direct canonical test was added (1 RED/40 GREEN); excluding
the new checks from inbound policy repaired it. Final41/41 GREEN. Includes three
UNA alphabets, minimalN/positive controls,321/323 supplied and malformed values,
header placement, mixed V/N objects, aliases/padded/foreign reasons, both guards,
all/dependent-only canonical scopes, both builders and direct inbound canonical
isolation. This does not assert that positive context now has authoritative facts.

Initial baseline before repair:1320 targeted,3335 application,3 typechecks,
integrity and unchanged large-file/performance gates all passed. The archived
probe also typechecked when temporarily placed under the existing tests include.
Final post-fix checks recorded below.


| Final check | Outcome |
| --- | --- |
| Dedicated negative-context suite |41/41 PASS; test and production protected guards|
| Targeted prior+new suites |1361/1361 PASS in19 files|
| Full `npm test` |3376/3376 PASS in248 files|
| `npm run typecheck` |PASS|
| `npm run typecheck:scripts` |PASS|
| `npm run typecheck:tests` |PASS|
| `npm run ediel:masterplan-v2:integrity` |PASS33 originals/121 rules/231 contracts; not application/live acceptance|
| `npm run quality:large-file-budget` |PASS unchanged1800 default/0 grandfathered|
| `npm run quality:performance` |PASS existing API tenant/performance, N+1, SLO gates|
| `git diff --check` |PASS|

Final targeted command:
`npx vitest run __tests__/ediel-prodat-z14-negative-context.test.ts __tests__/ediel-prodat-dependent*.test.ts __tests__/prodat-dependent-condition-engine.test.ts __tests__/ediel-prodat-date-boundaries.test.ts __tests__/ediel-prodat-party*.test.ts __tests__/ediel-masterplan-protocol-regression.test.ts __tests__/ediel-canonical-policy-batch-regression.test.ts`.

Local runtimeNode24.19.0; independent review and root-owned exact-head Node22 CI
remain pending. No local full certificate was rerun, per root instruction to use
ordinary exact-head CI and postmerge automatic full certificate. The41-test
suite was rerun after adding explicit production guard assertions; runtime source
was unchanged from the full application run. Full four-cell positive-authority
completion remains BLOCKED. Do not promote30/110 accepted cells from this fix.
