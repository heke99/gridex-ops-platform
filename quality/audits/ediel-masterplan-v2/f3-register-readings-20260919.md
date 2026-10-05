# Nine reading-dependent register cells: source qualification

Initial derived source checkpoint, 2026-09-19 (runtime continuation below). Analysis HEAD
`1ab03c759e1efd077b50911735e94610c53e8382`; accepted base PR341/main
`5d1e414ebcdf39f813fab91c26510046c765aee9`. Scope is PC-214/218/259 in
Z04/Z06/Z10, exactly nine first-register numeric cells. At this source checkpoint there were no runtime or prior
assertion edits, additional acceptance credit, remote action, active-memory
change, live DB/storage/send/deploy action, or PR310 content import.
PR310 remains paused at `e961135199f292b8210884f07de3b616a670161a`.

## Verdict and reviewed scope decision

No positive full-source evidence was found contradicting the frozen
first-register false-X outcomes. Preserve those outcomes; do not replace X
with O merely because a note says required-if-true without an explicit else.
The runtime overlay's optional result is a reproduced implementation divergence
from that frozen outbound target, not proof of a contradictory normative rule.
The source does not independently state a universal false-X rule for all D cells.

P15 explicitly limits section 2.2 to register 1. Root reviewed this source
boundary before runtime work: apply frozen false-X only to outbound register 1
in Z04/Z06F/Z10. Preserve existing register-2+ 214/218 nonrequired/O behavior,
plus E/G repetition controlled by this object's own first register. The later
false-O branch is preserved overlay behavior, **not newly established express
source permission**. The explicit EL259 no-readings prohibition still applies
across applicable registers. Nine-cell acceptance is not full register-source
certification or a new GAS qualification.

Existing inbound optional assertions need not change. Root specifically
confirmed retaining those assertions and the appendix composition. This audit
is the source checkpoint; runtime implementation follows root review separately.

## Evidence and skill routing

Read AGENTS; current state/task/checkpoint/handover/blockers/work-plan; domain
model, canonical flows and integrations; searched decisions and known failures;
inspected clean Git status and actual relevant paths. Read local
using-superpowers (dispatched-agent exemption), spec-to-code-compliance,
verification-before-completion, fp-check, acquire-codebase-knowledge and
quality-playbook routing. Applied bounded spec/callsite tracing and direct
module reproduction, rather than claiming a broad multi-agent/spec/security
audit. Root owns independent review; this task prohibits parallel implementers.
FP security workflow, global codebase documentation/quality generation, UI/Next,
DB changes, deployment, performance and skill authoring triggers are absent.
TDD/debugging and change-review apply at implementation. Used PDF skill for
read-only original extraction and visual inspection.

Original P26.A revision3, 140 pages, updated 2026-06-30:
`260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B`, URL
`https://www.ediel.se/Portal/Document/3338`. Root recovered historical public-source
CI artifact10512087971/run35254532103, not a replacement revision. Independently
computed PDF SHA256 `83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95`,
matching the frozen manifest. Recovery ZIP SHA256 recorded by root:
`20b580284e60405ecd72fee6ec5f44fe927a2745659d443c5c724ae9506fa5b8`.

Freshly read original PDF pages15,18,19,20,55,58,64,65,66,114,115,116;
visually inspected rendered pages15,18,19,20,114,115,116, including the split
259 note and full six-row appendix table. Also read all three retained full
field records, nine frozen conditional records, complete segment tables55/58/66,
retained appendix table116, prior `f3-register-source-map.md`, remaining-dependency
audit, and the prior323 qualification. Source originals remain unchanged.

| Original source | Exact effect on interpretation |
| --- | --- |
| P15 section2.2 | D means mandatory under stated conditions. Table covers only register1; appendix2 governs register2+. Section2.2 prevails over conflicting appendix4 conditions, not over appendix2's express register scope. |
| P18 field214 | Multiplier for a supplied reading; required in Z04/Z10 when standings sent in MSCONS/UTILTS, required in Z06F/E64 then; expressly optional in Z06E/G. No express optional else for Z04/Z06F/Z10. |
| P19 field218 | Integer digit count; same conditional-required and explicit E/G optional wording as214. |
| P19–20 field259 | Per-register tariff code, Svk code list. Same positive/E-G wording; additionally EL may send it only when readings will be sent in UTILTS. GAS expressly refers to other rules in2.4.5. |
| P55/58/66 | CCI C502/6313 is respectively Z02/Z05/Z16. Adjacent CAV first7110 (fourth C889 component) is an..35. Each CAV shares preceding CCI condition. P66 repeats explicit EL exclusion; these segment notes do not add optional false branches. |
| P64–65 field223 | CCI++Z13, adjacent CAV C889/7111: E34=Z06E, E64=Z06F, E32=Z06G; E58=Z10M. Source code and correct function matter; aliases are API compatibility, not wire authority. Existing bilateral/role restrictions remain. |
| P114–115 appendix2 | Only Z04/Z06/Z10 have multiple registers. Different physical meters require unique object IDs. Per-object register counter restarts at1; omit no actual register. Other non-mandatory common data comes from register1; later repetitions cannot overwrite it. |
| P116 appendix2 | 214/218 can vary by register;259 differs by register. Z04/Z06F/Z10 require these own values when standings sent. Z06E/G require a later value if this same field was supplied on this object's register1. First register expressly refers back to2.2. No express negative-branch prohibition for214/218 is added here. |

The prior323 audit is precedent for preserving frozen X without inventing an
optional else, not source authority for these fields. Full PDF rereading, not
that precedent or the projection alone, establishes the absence of contrary
explicit permission in the cited notes.

## Exact outcome contract

R=required own valid value; O=optional but supplied values still validated;
X=forbidden; U=undetermined outbound fact, blocks business validation.
`readings` is an independent declaration for exact object ID+agency in this
message; it is not inferred from259, root subtype/status, or a sibling object.

The following table applies to **outbound active EL, first register only**:

| Function / exact own-first reason | Fields | readings true | readings false | readings unknown |
| --- | --- | --- | --- | --- |
| Z04 / valid allowed Z04 reason |214,218,259|R|X|U|
| Z10 / valid allowed Z10 reason (M=E58) |214,218,259|R|X|U|
| Z06F / E64 |214,218,259|R|X|U|
| Z06E / E34 or Z06G / E32 |214,218|O|O|O|
| Z06E / E34 or Z06G / E32 |259|O|X|U|
| Z06 missing, duplicate, misplaced, padded, alias or unsupported reason |214,218,259|U|U*|U|

`*` Known EL false readings independently forbids supplied259 even if the reason
is invalid; reason uncertainty cannot permit it. Unknown readings for E/G259
must not become resolved O merely because259 is absent.214/218 E/G do not need
a readings predicate to determine their explicit optional requirement, but the
same object's259 business condition may still keep the full draft unresolved.

| Register2+ scope in active EL | readings true | readings false | readings unknown |
| --- | --- | --- | --- |
| Z04/Z06F/Z10,214/218 |R|O (preserved overlay)|U|
| Z04/Z06F/Z10,259 |R|X|U|
| Z06E/G,214/218, own-first same field present |R|R|R|
| Z06E/G,214/218, own-first same field absent |O|O|O|
| Z06E/G,259, own-first259 present |R|X|U|
| Z06E/G,259, own-first259 absent |O|X|U|

For E/G later-first presence, preserve the existing optional branch when absent;
it does not authorize borrowing a value or fact. Invalid topology/first register
cannot establish inheritance. Duplicate tariff259 codes remain invalid within
one object; equal214/218 values across registers are permitted, and different
own values must survive. A later first-like reason cannot repair register1.

Market limits: the table is an EL qualification, retaining current active-market
and application-reference gates. GAS259 explicitly has a different source rule
in2.4.5 and is not qualified here; do not call EL false-X a universal GAS rule or
activate GAS. Missing/contradictory market evidence must not authorize an EL259
bypass. Preserve existing GAS behavior outside this bounded change unless a
concrete cross-market bypass is reproduced and reviewed. A standalone helper's
`market:'gas'` result is not evidence of send authorization.

Inbound parse-only must not start requiring independent outgoing inventory or
readings facts. Existing callers/tests that explicitly supply facts to an inbound
canonical policy have additional legacy overlay behavior; preserve it. The frozen
outbound X target is not authority to change that inbound compatibility contract.

## Actual implementation and direct observations

| Path inspected | Present behavior and bounded implication |
| --- | --- |
| `prodat/prodatDependentConditionEngine.ts:83–91,270–388` | First-reading predicate uses root boolean and normalized root subtype. No readings phase marker; independent object truths do not determine these aggregate statuses. Register resolver returns O for false214/218 and for absent E/G259 with unknown readings.258's independent-count aggregate and phase markers already exist and must remain. |
| `rulebook/prodatRegisterPolicy.ts:44–121` | Exact object+agency fact lookup; partial/duplicate evidence cannot borrow root when registerObjects supplied. Without registerObjects, readings still use root fallback. Outbound independent count protection already blocks absent inventory. Reads own-first223 via compatibility alias helper; later223 cannot override first. EL259 false and duplicate tariffs already enforced. |
| `prodat/prodatRegisterGroups.ts` | Exact tuple grouping, valid first index, own local measurements, common first-register inheritance. `prodatRegisterMessageSegments` selects first actual message; later messages cannot become its registers/facts. Preserve these boundaries and topology checks. |
| `prodat/prodatRegisterFields.ts`, `prodatCharacteristicFields.ts`, `prodat26AFieldMatrix.ts` | Own local CCI/CAV readers and source component descriptors exist. General characteristic reader trims/normalizes qualifier and value, and returns first reason; it is insufficient to prove unique source-exact wire223. Do not confuse that API with strict wire authority. |
| `rulebook/canonicalPolicyFieldValidator.ts` | Runs structural parse checks, then register policy and skips handled fields in legacy D loop. Direction currently controls independent inventory only. New outbound first-register semantics must have an explicit boundary so inbound optional tests remain valid. |
| `rulebook/canonicalEdielPolicy.ts:218–227` | Composes root subtype/business facts; send mode asserts all root conditions determined before rendered object validation. Per-object readings need honest prewire diagnostics without masking mixed-object unknowns or prematurely demanding another object's root fact. |
| `prodat/buildProdat.ts`, `validateProdat.ts`, `render/registers.ts` | Generic builder accepts several objects and root fact envelope; validates with requireRegisterConditions. Serializer emits own214/218/259 at source component3 and independent register values, without fabricating readings. Generic validation returns issues rather than introducing an evidence source. |
| `prodat/builders/profileRenderer.ts` | Context/snapshot fact resolution, serialization, then canonical register validation. Currently reconciles only258's rendered inventory diagnostic; readings remain root statuses. Persisted `registerEvidence` already exists. Keep explicit prewire/rendered phase meaning and never export root status as every object's decision. |
| `testing/tgtProdatSource.ts`, `tgtRegisterFacts.ts` | Original source/raw columns and exact identity/agency/count are independently checked. Operator declaration of readings is allowed, including null; field259 is not the producer. Envelope binds tenant/run/role/case/suite/step/function/source digest and requires actor/source note. This is authorized test-source evidence, not a live production grid-owner fact authority. |
| `app/admin/ediel/actions.part-2.ts:894–922` | Fact writer requires write access, scoped run, company permission, operational company, allowed gridex PRODAT step, source checking and company/id/revision CAS. No action executed. |
| Manual draft at actions part2:850; `testing/tgtAutopilot.ts:394`; `tgtEdifact.part-4.ts:452,526` | Both real draft paths read those facts; draft validation consumes them and persists body-bound register evidence. They must transport null/missing as unknown, never auto-fill from workbook measurement values. |
| `prodat/prodatRegisterEvidence.ts` | Allows only market, root readings and per-object counts/readings; validates types, duplicates and identity. Body binding is integrity, not authentication or independent authority. Preserve existing source/run and body binding. |
| `core/messageBuilder/payloadPreflight.ts:710–750`; `rulebook/validator.ts:295,359–392` | Send rehydrates evidence and invokes register policy; parse-only preflight does structural validation. Register-scope unknown errors are protected from test warning downgrade. Catch/fallback paths and actual wire market/function must remain protected. |
| `rulebook/sendGuards.ts`, `transport/sendLock.ts` | Register errors are checked before intentional-invalid-test overrides/production lock exceptions. Verify both boundaries with persisted row evidence, rather than relying only on helper outcomes. |

External focused actual-module probes (no repository test/assertion changes):
`/workspace/scratch/2a201d6d5897/register-readings-probes/source.test.ts`, config
and `results.log` alongside. Six observation tests passed at analysis HEAD:

1. 45 first-register resolver combinations recorded; false214/218 are currently
   O, while false EL259 is X; E/G absent259 unknown is currently O.
2. Outbound `validateProdatRegisterPolicy` with exact A/9 count1, readings=false,
   E64 and own214=1 returns no issue: concrete frozen-first-X divergence.
3. Same actual policy with E34, absent fields, missing readings returns no issue:
   the known-fact requirement for E/G259 is not represented.
4. Complete readings-positive local values and first reason E64, F, Z06F,
   padded E64 or lowercase e64 all return no register-policy issue. This proves
   permissive reason interpretation in this module, **not a demonstrated full
   transport bypass**, since wider field/subtype checks can add errors.
5. Complete count but absent per-object readings, with root=true, yields three
   undetermined issues for E64: this boundary is already correct.
6. Prewire evaluator with E64/F and complete independent A/9 readings=true but
   no root boolean reports all three readings cells undetermined with no phase.
   This is the reproduced aggregate-versus-object diagnostic mismatch.

No new claimed defect for mixed-message grouping, tariff duplication, values,
source/run binding, either full guard, or GAS was inferred from static inspection.
Those are preservation obligations for implementation tests.

## Existing assertion review, before runtime changes

`__tests__/ediel-prodat-register-conditions.test.ts:30–32` explicitly expects
false-readings214/218 allowed in Z04/Z06F/Z10. Its helper at line12 uses
**direction=inbound, mode=parse**, so retaining that assertion is compatible with
outbound-first-X tightening. It tests both first and later values together;
do not relabel it as an outbound proof or change expected booleans to get green.

The same file:42–44 preserves E/G no-first-value/later-value optional behavior;
37–40 checks own-first repetition,55–57 own-first subtype,59–63 tariff uniqueness.
Keep these assertions. Its fixture maps M to Z70 at line9, whereas source p65
maps Z10M to **E58**. This does not establish a new source conflict: add correct
E58 controls for this unit; any existing fixture/assertion correction needs
separate root review, not silent rewriting. No prior assertion was modified.

## Next bounded implementation contract

1. Nine first-register cells only, active EL and authorized roles/capabilities.
   Add outbound-specific frozen requirement resolution in the canonical engine,
   composed with existing appendix overlay. Keep inbound and later214/218 false
   optional behavior, own E/G repetition, EL259 exclusion, all258 count semantics.
2. Match independent per-object readings to exact observed object+agency. Missing,
   null, partial, duplicate, extra or wrong-agency facts never borrow root/byCell,
   another object, a local259 value, a later register or a later message. Only
   predicates needing readings become U; E/G214/218 stay explicitly optional.
3. Strictly recognize the unique, correctly placed own-first223 reason, exact
   E34/E64/E32 for Z06, correct function codes for Z04/Z10. A padded qualifier,
   padded reason, duplicate/dangling pair or compatibility alias must not grant
   business authority. Use raw decoded tokens before trimming. Reject supplied
   forbidden malformed/padded214/218/259 pairs without treating malformed values
   as absent. Preserve ordinary length/component and UNA checks.
4. Reuse source/run-bound TGT facts and body-bound row evidence; no schema or
   alternate rule store. Preserve null/unknown through manual/autopilot, generic
   and profiled builders, canonical validation, preflight and both guards.
   Existing test producer is not new production authority.
5. Make prewire versus rendered readings diagnostics explicit, including mixed
   objects and partially missing facts. Retain PR341's separate inventory phase
   markers and reconciliation. A resolved aggregate cannot certify a missing
   rendered object; a root boolean cannot dictate individual statuses.
6. Test actual modules RED then GREEN: true/false/unknown first-register cases;
   E/G explicit optional and259 unknown even absent; independent counts plus
   complete/partial readings; mixed E/F/G and multiple agencies; own-first versus
   later reasons; distinct per-register values; duplicate tariffs; padded/alias/
   duplicate/misplaced reason and supplied fields; several supported UNA alphabets;
   later-message isolation; both builders/TGT paths; stale source/run/body; both
   protected guards and inbound controls. Keep original assertions and mandatory
   gates/thresholds; escalate only a concrete source/assertion contradiction.

Residual limits: later214/218 false-O is preserved, not newly source-certified;
GAS positive outcomes and a live grid-owner producer are outside this unit.
Full branch/CI acceptance, main341 certificate and numeric acceptance are root
verification decisions. This qualification makes none of those claims.

## Verification

Fresh focused probes: `node node_modules/vitest/vitest.mjs run --config
/workspace/scratch/2a201d6d5897/register-readings-probes/vitest.config.mjs
--reporter=verbose`: 6/6 observation tests, one file. Original PDF SHA256 matched;
source page text and rendered-page review completed as above. No full suite or
broad audit run for this source-only checkpoint. `git diff --check` and unchanged
normative-package/prior-test checks are recorded in the external task report.

## Runtime implementation (root-approved continuation)

Runtime base `e8b386ba97c55fe3ea9b6a069d84f5c4c17ba199` includes root's source
approval and main341 certificate receipt. No changes to the normative package,
PR310, active memory, migrations/types/grants, production facts, roles or
capabilities are part of this implementation. Local runtime is Node24.19.0;
root owns independent exact-head Node22 CI and publication.

The canonical register resolver now has an explicit outbound-reading context.
The policy joins independent readings to exact object/agency, obtains the actual
own-first wire reason for Z06, and validates supplied source-qualified CCI/CAV
fields before normalizing values. It retains the inbound overlay and the
appendix2 negative/repetition boundaries approved above. Wire/policy market
context, not `facts.market`, decides the EL259 exclusion. Prewire diagnostics
identify independent readings aggregates; rendered diagnostics report the actual
object decisions and preserve258's distinct inventory phases.

`prodatRegisterReadings.ts` is an adapter for exact wire tokens, not a second
business rule registry: field qualifiers come from the existing matrix, reasons
from the existing subtype registry, and requirements from the existing condition
engine. Source/run and body evidence contracts and TGT producer stay unchanged.
Profiled/generic builders, canonical validation, TGT drafts, preflight and both
send guards consume that same policy. The rulebook catch path also rechecks all
applicable register-local rules so missing production snapshots cannot bypass
readings or accepted258 inventory checks under an intentional-invalid-test flag.

### RED/GREEN evidence and qualification limits

Initial runtime RED, before production edits: 62 new actual-module tests,
44 failing and18 passing controls. Failures covered false first214/218 in three
functions/three UNA alphabets, E/G259 unknown while absent, GAS fact versus actual
EL, padded/alias/duplicate/misplaced own-first reason, supplied malformed/header
fields, generic builder, diagnostics, and nine independently asserted persisted
row preflight/rulebook/transport boundaries. Both send guards actually returned
without throwing for the synthetic false-reading first214 with valid213 and the
intentional-invalid-test flag; this is a reproduced guarded-path defect.

First focused GREEN: 575/575 in23 register/condition files, including62 new tests.
Further source-path review reproduced a production-missing-snapshot bypass:
the rulebook guard again returned under the test override. One additional RED
preceded the catch-policy fix. Root then identified that a reading-only catch
rule selection could omit accepted258 checks. Three additional RED tests with
complete reading values and undefined/null/mismatched expected counts confirmed
that omission before the catch selection was widened to all register-local rules.
These changes claim no new numeric258 acceptance credit.

Two initial **new** test expectations were corrected, without touching old
assertions: generic builder rejection is a throw, not a returned `ok:false`;
trailing whitespace at a segment boundary is removed by the unchanged tokenizer.
The latter raw-boundary expectation was withdrawn after reproduction and root
review. Tests instead use leading padding and trailing padding inside C889 with
an explicit empty following component, which survives tokenization. No claim
is made that every original-raw padding form is rejected by the new reader.
Original raw payload evidence and broader syntax validation remain separate;
there is no global tokenizer refactor in this unit.

The source-reading raw observation test and its45-outcome table remain historical
preimplementation evidence. They are not a conformance oracle for changed runtime.

### Root-reviewed compatibility corrections

The first full application run was3492/3505 (13 failures in3 old files); new
reading tests were passing. Root reviewed the exact source and original purposes
before any old test changes:

- `ediel-canonical-policy-batch-regression.test.ts`: both declarations inside the
  complete-explicit-facts test now include per-object readings=true, matching its
  existing root=true synthetic intent. Counts, registry coverage and every
  asserted outcome are unchanged. Root booleans cannot supply missing per-object
  truth under the new contract.
- Z04/Z10 readings predicates do not branch on reason. Exact own-first reason is
  therefore required here only to select Z06 E/F/G. Invalid/missing Z04/Z10 reason
  remains the responsibility of the existing223/function and other dependent
  policies, not an invented214/218 unknown. This removes a redundant readings
  error without changing any `z04-reference` test or repairing a reason from root.
- `ediel-prodat-dependent-z06-product.test.ts`: only the `missing market` control's
  historical zero-register-error assertion changed. It now requires the specific
  blocking259 undetermined result (`CCI++Z16/CAV`); all other cases retain the
  empty-register assertion. P20/66 require EL-specific259 applicability and the
  frozen unknown contract requires resolution, so an empty actualUNB reference
  cannot be supplied by a row label, root market fact, or absent259. Its original
  independent242 checks and both `toThrow(/Z06:242/)` assertions remain. The
  rulebook send guard reports register and dependent protected errors together
  when both exist, before the unchanged override check, so the new blocker does
  not hide the existing product proof.

There is **no fallback from present-but-empty/invalid UNB to cached EL**. Valid
actualUNB market takes precedence; genuine body fragments can use their policy
application reference. Explicit GAS wire retains its distinct existing overlay;
no positive GAS authority/capability is introduced. The root-only GAS fact on
actualEL cannot evade259, as the regression demonstrates.

All old inbound optional assertions, original M=>Z70 inbound fixture, source/run
facts assertions, independent258 tests, thresholds and required gates are retained.
No fixture was globally relabeled readings=true to silence an outbound failure.
Final focused review set (new70 tests and three previously failing old files):
338/338 in4 files. Three new inventory-fallback controls passed after their RED.

### Executed completion gates

All commands used the repository's unchanged configuration on Node24.19.0.

| Command | Result |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run --reporter=dot` |3508/3508 tests in251 files: all3438 prior plus70 new. Ran after the approved fixture/assertion corrections and full-register catch fix. |
| `npm run typecheck` |Passed after nullable-subtype narrowing correction. |
| `npm run typecheck:tests` |Passed after the same correction. |
| `npm run typecheck:scripts` |Passed. |
| `npm run ediel:masterplan-v2:integrity` |33 originals,121 rules,231 contracts; integrity only, no conformance/readiness claim. |
| `npm run quality:large-file-budget` |Passed unchanged budget. |
| `npm run quality:performance` |Passed API tenant/performance, N+1 and SLO contract gates. |
| `git diff --check` |Passed. |
| Diff of normative docs, coverage baseline and workflows |Empty. |

The full3508 run preceded a behavior-preserving type fix: after making reason
knowledge conditional on Z06, TypeScript no longer narrowed `subtype` globally.
`['E','G'].includes(input.subtype ?? '')` satisfies that type contract; null
and empty are both nonmembers, so behavior is unchanged. After this final code
edit, app and test typechecks were rerun successfully, plus
`node node_modules/vitest/vitest.mjs run __tests__/ediel-prodat-register-readings.test.ts
--reporter=dot`:70/70. No claim of a second full3508 run after that type-only fix.
The first type pass also found a union rule-array type and duplicate code spread
in new tests; those were corrected before the full3508 run.

Read local code-review and requesting-code-review guidance; independent
whole-branch review is root-owned under the brief and remains required. No
remote CI, merge, numeric acceptance, live readiness or broad F3–F7 completion
is claimed by these local checks. Raw segment-boundary whitespace, preserved
later214/218 negative overlay, and unqualified positive GAS/production fact
producer remain the stated limits.


## Independent review R1 remediation — round 1/5

Base: `7a8c2a30abb22a6325031fa2b433d2e42fd53371` (same tree as published
`74fb9a40b8c6c3fd50112249b59873a951caa65c`). Root approved this bounded repair.
The review report is `/workspace/scratch/2a201d6d5897/register-readings-review-report.md`.

R1 is a confirmed inherited rulebook-boundary gap, not a nine-cell regression
or an end-to-end send bypass. The independent reviewer reproduced the global
LIN chain gap against archived runtime base `e8b386ba`; this remediation did
not rerun that baseline archive. Actual RED on the current base independently
confirmed both reported malformed chains. Transport and preflight already
blocked them in all tested contexts.

The existing matrix produces `PRODAT_REGISTER_STRUCTURE_INVALID` for invalid
global LIN numbering and own C829 register numbering. Its error previously
lacked the protected register scope, so the normal rulebook intentional-invalid
override could suppress it. The snapshot exception path reran only register
business policy, which intentionally leaves topology to the matrix. This
explains both paths without changing any source outcome.

Fix: classify the existing matrix structural error with `scope: prodat_register`
and call the existing `validateProdatRegisterPayload` (matrix plus business
policy, `requireConditions: true`) in the snapshot fallback. Body-bound facts
are still re-read and actual wire context still governs. No new rule store,
catch exemption or duplicated structure implementation is added. The existing
combined register/dependent242 guard diagnostic and protection-before-override
order are unchanged. Existing inbound syntax validation receives only the
scope annotation; no new inbound business facts are required.

Added `__tests__/ediel-prodat-register-structure-guards.test.ts`: 36 independently
asserted cases across normal test validation, production missing snapshot and
production stale snapshot. Each uses actual EL UNB, body-bound A/89 facts,
independent expected count2, readings=true, both QTY31 values, complete own
214/218/259 values with distinct111/112 tariffs, and Z22 on both registers.
Malformed variants are global LIN7,9/C8291,2 and global LIN1,2/C8291,1. Each
context/variant independently asserts protected validator output, rulebook
rejection, preflight rejection and transport rejection; no early validator
assertion hides a guard result. Valid global1,2/C8291,2 controls independently
cover all four boundaries. Production controls retain unrelated production
readiness blocks and explicitly verify the canonical snapshot failure.

| Verification (Node24.19.0, unchanged configuration) | Actual result |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run __tests__/ediel-prodat-register-structure-guards.test.ts --reporter=verbose` before runtime edits | Exit1: 12 failed,24 passed,36 total. Six protected-validator assertions and six independent rulebook-guard assertions fail. All six malformed preflight and six malformed transport assertions pass; all twelve valid controls pass. |
| `node node_modules/vitest/vitest.mjs run __tests__/ediel-prodat-register*.test.ts __tests__/ediel-prodat-dependent-z06-product.test.ts --reporter=dot` after fix | Exit0: 782 passed in24 files, including all36 new cases and unchanged readings/inventory/structural/inbound/preflight/guard/242 controls. |
| `npm run typecheck` | Exit0. |
| `npm run typecheck:tests` | Exit0. |
| `git diff --check` | Exit0. |
| `git diff --quiet -- docs/ediel/masterplan-v2 .github/workflows quality/coverage-baseline.json` | Exit0; unchanged originals/workflows/baseline. |

Retained external logs under `/workspace/scratch/2a201d6d5897/`:
`register-readings-r1-red.log`, `register-readings-r1-green.log`,
`register-readings-r1-types-app.log`, `register-readings-r1-types-tests.log`.
No old assertion, fixture, gate or threshold changed. No full-suite rerun is
claimed for R1; root requested covering tests and relevant types, and owns
updated exact-head Node22 CI and scoped independent re-review. Source limits,
39/110 numeric acceptance,4/10 parents and paused PR310 remain unchanged.
No whole-register or full-grammar certification is implied.

Skill routing: receiving-code-review for evidence-based response; the prior
systematic-debugging, test-driven-development and verification-before-completion
workflow continues. Independent public-module RED supplies direct false-positive
verification. This is a two-site validation repair, with no UI, DB, deployment,
performance or supply-chain change triggering those broader skill groups. Root
owns active memory, publication and review; its session-log edit is excluded.
