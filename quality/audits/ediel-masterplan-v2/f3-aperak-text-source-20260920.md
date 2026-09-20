# P94/A905 text source qualification — 2026-09-20

Status: source-only proposal, ready for independent source/spec and architecture
review. No runtime implementation or F3 closure. Historical acceptance remains
98/110 numeric and 10/10 parent occurrences; PR310 remains paused/excluded.

This qualification follows merged PR351 (`b4f00ae37937502f2678738bf076c0ba8de9696b`),
starting checkout `af9e2673`, and the explicit residual in
`f3-closure-qualification-20260919.md`. Root owns publication, release gates and
memory. Root reported PR351 actual-main full73/73 and all OPS successful; those
are root's receipts, not tests performed by this author. Source review and explicit
root authorization remain required before runtime work.

## Authority and method

Original: `/workspace/scratch/2a201d6d5897/prodat-original-source/PRODAT-26A-r3.pdf`.
SHA256: `83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95`.
This is the complete 140-page original, version26.A/16.B, revision3 dated2026-06-30,
not a generated rule sheet. All 6,338 extracted lines were read in sequential
chunks; a truncated changelog chunk was reread. Rendered pages22,79,90,93,94,104,
105,106,119 were inspected, including the visual placement of the special rule
inside the41 row. Diagram-only pages were not individually visually inspected.

The original fixes field identity, text ingredients, references and capacity.
It does **not** define a software API, absent-customer recovery, a truncation
algorithm, ambiguous/multiple-value punctuation, or internal-review behavior.
Every such choice below is a **design inference for review**, not a new national
rule. Appendix5's manually edited examples may contain errors (p126); normative
body text and §2.2 take precedence over example punctuation. §2.2 also explicitly
prevails over contradictory appendix4 conditions (p15).

Applicable instructions: repository AGENTS and current task/memory/architecture
were read. Bounded source compliance, false-positive challenge, code review,
verification, PDF inspection and architecture planning were applied. The local
using-superpowers skill exempts dispatched subagents; the task's explicit
single-author/no-subdelegation instruction governs. Broad security, database,
performance, UI, deployment and full quality-playbook execution are not triggered
by this documentation-only unit. No skill approval or human confirmation was
needed. No external network, live database, storage, provider or market calls
were used; all consumer effects were recorded by synthetic mocks.

## Source contract

| Question | Original authority | Qualified result |
| --- | --- | --- |
| Field naming | pp15–23 §2.2; pp93–94 A904/A905 | Use the Swedish field name from §2.2, not an EDIFACT path or developer description. A904 takes the three-digit field number, excluding numbered suffixes. |
| Missing field41 | p94 | `<<Fältnamn>> saknas`. No missing local lookup fact grants national41 authority. |
| Invalid field42 | p94 | `Felaktigt <<fältnamn>> XXXX`, where XXXX is the submitted wrong value, not the expected value or a generic validation explanation. |
| Customer fallback | p94, examples p106 | In the41 row, if own209 and/or226 is absent, the description refers to own227. The text is not restricted to the error whose field number is209/226; the condition concerns the references absent from that object's PRODAT. There is no source instruction to append227 to42 or40. |
| Customer identity | pp22,79–80 | Field227 is NAD+UD/C082/3039, an..35, submitted by the message. It is not a tenant customer UUID, name, cached message reference, installation party or database lookup. |
| Legitimate absence | pp22,79–80 | End user is absent in Z10, Z06F/G, Z09B/D/F/G and Z14N. Do not manufacture227, a missing227 error, or a general processing hold merely to fill an unavailable suffix. Existing applicable requiredness remains its separate owner. |
| Reference scope | pp85–90; pp114–116 | ACK is per object; an APERAK cannot acknowledge multiple PRODAT messages. A209/A226 copy their corresponding supplied references. Common customer/reference data belong to that object's first register; a later register, sibling object or subsequent UNH must not supply fallback. PositiveZ13 has the documented A209 exception. |
| Text cardinality | pp95,104–105 | One FTX per ERC. Only the first C108/4440 is allowed, an..70; the four remaining components and3453 language are X. Additional components/FTX must not be used to split one long description. |
| Language/encoding | pp93–94,108 | Required templates and field names are Swedish; UNOC syntax3 uses ISO8859-1. Preserve Swedish letters. No language indicator is allowed in FTX. |
| Positive100 | p94 | Exactly `OK`. |
| Application40 | p93 | Fixed Swedish text by A903 code, listed below. A903=100 under ERC40 is distinct from positive ERC100. |
| Qualifier errors | p119 | An invalid1131/3055 qualifier maps to its owning source field, not to1131/3055 as A904. The example names owning227; it does not specify a complete text serialization algorithm for compound faults. |

`kundid = 12345` on p94 and `kundid=123` on p106 demonstrate formatting variation;
a deterministic `, kundid=<value>` is proposed, not claimed byte-for-byte mandated.
The unchanged source does not authorize shortening names to paths, abbreviating
identifiers, ellipses, hashing values, translation to English, or silent omission
of a known available required customer reference.

Source field labels central to this evidence (line wraps joined with spaces):

| Field | Swedish §2.2 label | Field | Swedish §2.2 label |
| --- | --- | --- | --- |
| 209 | Anläggnings-id | 226 | Ärendereferens |
| 227 | Kund-id | 260 | Nätområdesid |
| 210 | Avtal, startdatum | 211 | Avtal, slutdatum |
| 224 | Mätarnummer | 225 | Gammalt mätarnummer |
| 214 | Konstant för mätare | 215 | Konstant, gammal mätare |
| 242 | Produktkod | 506 | Produkt id (Energiprodukt) |
| 261 | Referens till avtal/fullmakt | 322 | Tillståndets status |
| 207 | Avsändare (Ediel-ID) | 208 | Mottagare (Ediel-ID) |
| 203 | Meddelandeidentifikation | 311 | Application Reference |

The eventual label table must transcribe all numeric descriptors admitted by the
chosen typed owner from §2.2, including row suffix normalization; this small table
is not a claim that every supported field has been implemented or accepted.
Neither English `rule.label`/segmentPath nor generic issue title is that table.

| ERC40 A903 | Required p93 text |
| --- | --- |
| 100 | Meddelandetyp/funktion är inte implementerad i applikationen |
| 102 | Meddelandehuvudet kunde inte läsas |
| 103 | Dubblett av meddelandet |
| 104 | Liknande meddelande mottaget tidigare |
| 105 | Anläggningen kan inte identifieras |
| 106 | Liknande meddelande mottaget från annan aktör |
| 107 | Aktören är inte knuten till aktuell anläggning |
| 108 | Aktören är redan knuten till aktuell anläggning |
| 109 | En period anges där endast en dag/tidpunkt förväntas |
| 110 | Okänd eller ogiltig avsändare |

### Wrong field value versus wrong component

The source demands the **wrong** value. A correct customer ID is not a substitute
for its incorrect code-list qualifier; a correct date is not a substitute for its
incorrect format code. P119 retains the owning field number in both cases.
Accordingly the observed date-format BAD should retain210 and BAD, and the
customer-qualifier BAD should retain227 and BAD. Current state readers often
return a correct primary scalar plus `malformed: true`; that is insufficient to
choose XXXX. Recovering text from prose, first matching raw segment, or expected
values is not acceptable evidence.

**Design inference:** extend the existing source-owned failure evidence with its
actual failing component(s), token location and decoded submitted content. For a
single component fault, use that component's actual submitted value. For a scalar
fault use its actual scalar. For a structural fault with no single nonempty
component, use the decoded owning field/composite contents, joining component slots with
`:` while retaining empty slots; for conflicting occurrences retain every actual
candidate in source order joined with ` / `. These separators describe the
submitted structure; they are escaped once when rendered. This is a presentation convention, not a new
classification rule. Never select the first duplicate and call it the wrong
value, and never echo an unrelated whole message. If the owner cannot identify
its failed content unambiguously, preserve its qualified field finding locally
and mark text-unready as described below; do not invent XXXX or reclassify it.
This convention requires independent review, including empty-component and
multiple-fault cases, before implementation. The original alone does not settle
all compound-case punctuation.

### Own227 and absence evidence

**Design inference:** retain explicit states for own209/226/227: present,
known-absent, and unavailable/ambiguous. A null reference alone currently conflates
these states. Trigger the41 suffix only for a known-absent own209 or226 and one
unambiguously submitted own227. Header/no-object errors have no customer owner;
unknown is not proof of absence. A valid repeated-register chain resolves common
customer data to its own first register. Conflicting NAD+UD identifiers are not
resolved through a sibling, later message, database or arbitrary first match.

If227 is absent, forbidden, undecodable or ambiguous, emit the source-named base41
and retain a local fallback-unavailable observation; do not invent a customer or
hold solely because optional/forbidden227 is absent. This recovery is an explicit
source gap, not full customer-fallback conformance credit. Required227 errors, if
already source-qualified, remain independently classified. Likewise, legitimate
absence209 in Z13 does not itself authorize a missing209 error, although a genuine
41 elsewhere meets the literal p94 missing-reference condition when own227 exists.

### Capacity and unavoidable conflict

The actual full-draft path already rejects decoded FTX values of71 or more
characters. This is working preflight protection, **not** an oversize-wire bypass.
A standalone renderer is not proof that an oversized ACK can be persisted/sent.
Counting must apply to decoded text before escaping, not escaped wire bytes.

There is nevertheless a finite source conflict, not just a hypothetical unlimited
input: remove required261 (p22) from a complete Z01 and supply a source-permitted
35-character227. The required label `Referens till avtal/fullmakt` has28 characters;
` saknas` adds7, already35. Appending the customer identifier alone would reach70
with no separation or customer indicator; one separator makes71. The shortest
reviewed source example style `, kundid=` adds9, making79. Both209/226 can also be
absent in that same national-error fixture. Shortening spaces around `=` cannot
solve this. Retaining only a partial customer identifier, abbreviating the source
field name, dropping `saknas`, or using extra FTX/C108 violates or lacks support
from the original. More generally a malformed submitted value may exceed its own
allowed field length; the error response does not gain a truncation exception.

**Design inference:** try compact source-compatible punctuation first; if exact
required ingredients still cannot fit70, retain qualified national identity and
full evidence locally, suppress only that unrenderable wire error, and mark the
message for internal review before positive-response selection and business
mutation. This is not a new national ERC or a claim that source requires our
particular internal state. Independent review may choose a different recovery,
but may not certify silent truncation as source-compliant. No production readiness
behavior has been added by this source task.

## Actual call sites and observations

All paths below were traced in the current checkout. The companion evidence JSON
contains recoverable scratch probe sources, reduced observations, original run
results and SHA256s. No old assertions or production files were edited.

| Actual consumer/owner | Active path and text behavior | Evidence/qualification |
| --- | --- | --- |
| Canonical typed fields | `rulebook/*` and `prodatEnergyProduct` → `prodatFieldDiagnostic` → `prodatDiagnosticProjection.projectProdatDiagnostics` | Valid typed F retains41/42 identity/own references, but text is `item.description.slice(0,70)`. No227 or wrong-value failure evidence exists in typed metadata. |
| Canonical disposition | `core/runtimeDecision.applyProdatPolicyDecision` → `buildDecision` report/plan | U/L remain observations. F becomes negative; I suppresses positive and holds. This is the correct pre-persistence place for proposed text-readiness composition. |
| Actual persisted inbound | `flows/inboundProcessing.processInboundEdielMessage` → canonical decision → `updateEdielMessageStatus` → ACK plan → `createAckIfMissing` → `buildAperakDraft` → kernel draft | Corrected Z01 probe persisted41/226 developer text and rendered it without own227. Existing F-only path continued recorded business hooks; this is existing behavior, not a newly alleged authorization defect. Existing I guard is before actor-auto/facility/business effects. |
| Direct decision | `decisionEngine.decideProdatAperak` → legacy business mapper plus shared energy projection → draft | Missing/invalid506 in otherwise qualified Z13 uses shared generic/truncated506 text. Legacy extra missing209 on Z13 remains separate classification residual, not new text-unit authority. |
| Manual backend | Actual function `app/admin/ediel/actions.part-3.ts:resolveBackendAperakDecision` extracted with TypeScript AST, real permission engine and final draft; event/context/DB edges mocked | Invalid permission status produces41/322 with `Felaktigt tillståndets status INVALID`. Wrong ERC is a separately unqualified legacy mapping; it cannot be repaired by changing a string. Actual function may record validation event before returning to caller. |
| Registry/non-TGT | `testing/aperakErrorRuleRegistry.resolveAndStoreProdatAperakErrors` → derive → active rules/builtins → format → stored details/errors → draft | Builtin missing226 gives correct base `Ärendereferens saknas`; Z10 has no227 by design. Extra missing214 is a legacy requiredness residual. Issue API lacks physical occurrence/own227 despite fieldValue and object/reference strings. |
| Actual TGT comparison/registry | Same registry with `{testCaseCode:'AUTO',groups:[]}` → `deriveTgtAperakValidationIssues` → comparison → builtin mapping → draft | Complete Z10 with distinct new/old meters has no issue; same actual value NEW yields42/224 `Felaktigt mätarnummer NEW`, exact own refs. Existing correct text/value path refutes a blanket claim that all producers fail. |
| Other legacy generators | `testing/prodatPermissionEngine`, `agtEngine`, `tgtEdifact.part-2`, `tgtAutopilot`, portal-feedback path in `decisionEngine` | Separate permission/scenario/simulation/40 mappings; no automatic national qualification from their numeric strings. Do not bundle their classification repair into canonical text work. |
| Final renderer | `ack.buildAperakDraft` → `buildAckDraft` → `buildAperakSegments` → `aperakEngine.renderAperakEdiel` → envelope/preflight | Active text sanitizer replaces literal apostrophe/plus with spaces, escapes colon/question mark and has140-character normalization. Own references use existing `escapeEdifactValue`. The similarly named normalization helpers earlier in `ack.ts` have no callers and are not the active defect. |

`prodatFieldDiagnostic` is already the shared occurrence owner. Existing typed
producers are finite: `rulebook/fieldMatrix`, `canonicalPolicyFieldValidator`,
`prodatRegisterPolicy`, `prodatSubtypePolicy`, `prodatMeterChangePolicy`,
`prodatDeathStatusPolicy`, `prodatGasApplicabilityPolicy`, `prodatDateEventPolicy`,
`prodatReportingPermissionPolicy`, `prodatInvoiceePolicy`, `prodatProductScope`,
`prodatDependentReferenceScope`, and `prodat/prodatEnergyProduct`. Parent-only and
outbound-authority diagnostics remain I/U/L as qualified by PR350/351. Metadata
transport edits must not reopen their national field or applicability decisions.

### Expected versus observed

45 observations in `observations-v2.json`, plus corrected persisted and actual TGT
consumer probes. Input alphabets `:+?'`, `*;!~`, `^|!%` are all three existing
fixture alphabets. They exercise the generic UNA parser but do not exhaust every
possible accepted service-character combination. Output uses the existing default
APERAK alphabet; the source does not require echoing the inbound UNA.

| Case | Source expectation | Actual evidence |
| --- | --- | --- |
| Complete Z01 ×3 alphabets | No field error | Accepted/accepted, no APERAK required. |
| Missing209 or226 with OWN-A ×3 | Source name + `saknas` + own227 | `LIN krävs för PRODAT Z01.` / `RFF LI krävs för PRODAT Z01.`; customer omitted. |
| Both missing ×3 | Both41 identities; each own-customer description | Correct two41 identities, no209/226 borrowed; both texts remain developer prose. |
| Missing260 ×3 | `Nätområdesid saknas` | `RFF Z05 krävs för PRODAT Z01.` |
| Date format BAD ×3 | Field210 name and actual BAD | Generic `DTM 92: kontrollera C507, format, kalender, tidszon och entydighet enl`; noBAD, no source field name. |
| Customer qualifier BAD ×3 | Field227 name and actual BAD | Generic `NAD UD/C082/3039: kontrollera komponent, kodlista, längd och part enli`; noBAD. Correct227 identity already survives. |
| Second object missing226 ×3 | OWN-B, neverOWN-A | Correct second object's209; text includes neither customer. No observed sibling reference leak. |
| Second object absent227 / duplicate own227 ×3 | No invented/borrowed customer | Current text includes no customer. Empty ID's legacy malformed classification and duplicate handling are not requalified here. |
| Later UNH customer | First message's own data only | First-message missing226 remains own; later customer not used. |
| Malicious supplied text ×3 | Exact decoded value, oneERC/oneFTX | Input `Felaktigt Nätområdesid BAD:+?'ERC+100::260'` loses `+` and `'`; still exactly oneERC42. Escaping loss reproduced; segment injection refuted. |
| Positive Z10 U-only | ERC100/OK, no I | Accepted and OK. Existing cached LI on this positive control is a separate reference residual; no reference-conformance claim. |
| Supplied source40/105 | Fixed Swedish description | Preserved exactly; classification generator not exercised by this supplied control. |
| Text lengths69/70 | Single allowed value accepted | Actual full draft accepted. |
| Text lengths71/140/141 | Oversize rejected | Actual full draft raises `PROFILE_FIELD_LENGTH_EXCEEDED`;141 is normalized to140 first. No oversized draft emitted. |
| Actual persisted missing226 | Same P94 contract survives report and draft | Both persisted and actual draft retain generic description, no227; reproduced through orchestration. |
| Actual TGT224 | Named wrong value, own correlation | Correct field/value ingredients and references. Lowercase name after Felaktigt is not treated as a substantive defect. |

Reproduced findings, bounded to the observed paths:

1. **A905 missing-field text and own-customer reference are incomplete.** Shared
   canonical projection sends developer paths/prose; real persisted draft confirms
   exposure. It is not enough to preserve41/226 identity.
2. **A905 invalid-field text omits the actual wrong value.** The shared diagnostic
   currently carries identity/location, not failure-value evidence; truncating a
   generic explanation cannot meet42. Main scalar extraction would misdescribe
   the demonstrated qualifier/format cases.
3. **Final text sanitization changes actual data.** Literal `+`/`'` are replaced
   instead of release-escaped. This matters for both XXXX and future own227.
   It is data fidelity, not demonstrated segment injection or source-length bypass.

Do not count the long-value preflight rejection, already-correct TGT224,
source40/positive100 preservation, missing227 on Z10, or a hypothetical
cross-message/customer leak as additional findings. Partial correct behavior does
not certify all application40 producers, all references or all national mappings.

## Smallest proposed runtime unit — review required

The next implementable unit is **typed canonical A905 composition and exact final
text escaping**, including direct consumers of that same typed projection. It is
not full manual/TGT/AGT classification closure. Preserve all PR350 F/U/L/I and
PR351 incoming506 ownership/applicability; no labels or numeric strings can create
a new national error. No database lookup or migration is needed.

Finite edit boundary proposed:

1. A small `prodat/prodatAperakText.ts` owner: source-named immutable label map,
   pure decoded composer, fixed typed109 text, 70-character readiness result.
   Input is existing typed diagnostic plus owned failure/reference evidence;
   output is ready text or an explicit local reason. No catch-all national code,
   English-prose parsing, expected-value substitution or new validation engine.
2. Extend `prodatFieldDiagnostic`/occurrence with own227 and explicit
   absence/ambiguity evidence, using existing token/message/register grouping.
   Extend existing party/date/document/register state readers and each listed
   typed producer only where necessary to carry the **already validated** failure
   content. Relevant readers: `prodatPartyFields`, `prodatDateFields`,
   `prodatDocumentFields`, `prodatRegisterFields`; reference/product/energy owners
   already holding actual values pass them explicitly. This is a finite metadata
   audit of the thirteen producers above, not an instruction to edit every file
   blindly or duplicate their validators. Frozen matrices stay unchanged.
3. `prodatDiagnosticProjection`: compose instead of slicing developer description;
   keep original full descriptions/evidence as local observations. Ready F retains
   exact field/kind/occurrence. Text-unready F retains its national identity in
   persisted diagnostics; add a local internal-review reason, not a national code.
4. `core/runtimeDecision`: combine readiness **inside**
   `applyProdatPolicyDecision`, before `buildDecision` creates the response plan
   and before `inboundProcessing` persists it. A late render exception is too late
   to decide persisted acceptance or suppress actor/business hooks. Retain the
   existing early persisted-I guard in actual inbound orchestration; exercise it
   through the real mocked consumer, not only a pure composer.
5. `aperakEngine`: for composed decoded text, use existing serializer escaping
   once, preserving plus/apostrophe/colon/release. Validate capacity before wire
   escaping; retain actual envelope preflight. Use a narrow qualified-text path
   if changing the generic sanitizer would alter unqualified legacy behavior.
   Keep positive100 and fixed40 text, own reference semantics and default output
   alphabet. `ack` needs only any necessary type transport, not duplicated logic.
6. Direct `decisionEngine` shared506 projection must propagate text-unready as
   an explicit local review/error before a caller assumes positive/sendable.
   Do not silently drop its F and permit positive fallback. Typed40/109 uses its
   fixed p93 text. Legacy manual/registry/TGT/AGT errors without owned typed
   evidence remain outside this unit; no adapter grants authority by inspecting
   `ercCode`, `fieldCode`, `fallbackText` or a TGT expected value.

Concrete proposed composer result (design inference):
`{kind:'ready', text, fallback:'not_needed'|'included'|'unavailable'}` or
`{kind:'unready', reason:'capacity'|'failure_evidence_unavailable'|'label_unavailable'}`.
The input retains `ProdatDiagnostic.kind='field'`, its exact field/error kind and
occurrence, plus failure content and explicit reference/customer states. An
unready result adds local reason `PRODAT_APERAK_TEXT_UNREADY`; it does not replace
that diagnostic with `kind:'internal'`. `label_unavailable` is an implementation
invariant, not a new reason to hold optional data. The qualified typed renderer
must receive a ready result; direct callers receive an explicit review failure
if no ready result can be produced, never an empty error list masquerading as
success. No schema change is proposed: the existing diagnostic/report JSON carries
this bounded metadata.

The manual backend's event-before-return and registry detail writes are explicit
future adapter boundaries: any later expansion needs readiness **before** success
logging/resolution storage/ACK creation, plus source-qualified classification and
physical ownership. Existing labels/value strings are insufficient. The correct
TGT224 observation is a preservation control, not authority to route all TGT
errors through this new composer. No new “unready” state is applied wholesale to
legacy errors by this unit.

### Composition of classification and readiness (design inference)

| Existing facts | Text readiness | Proposed persisted outcome/plan and effects |
| --- | --- | --- |
| U/L only, noF/I | Not applicable | Existing accepted/accepted; prescribed positive100 remains; no added hold. |
| F only | All ready | Existing rejected behavior and exact qualified negative; no new business-policy restriction. |
| F with overflow/unrecoverable owned value | None ready | Keep F metadata and applicationDecision rejected; functional manual_review, internal_review disposition; no APERAK100 and no invented negative text; technical ACK may remain. |
| F ready + F text-unready | Partial | Persist both national findings; rejected/manual_review/internal_review; send only ready qualified negative errors where ACK policy permits; no100, no business/actor-auto hooks. Source says report all if possible (pp85–88); partial recovery is design inference. |
| Existing I plus readyF | Ready subset | Preserve existing PR350 mixedF+I behavior and qualified negatives. |
|41 with absent/forbidden/ambiguous227 | Base41 fits | Base source-named41 plus local fallback-unavailable observation; no additional hold solely for unavailable customer. Existing F/I requiredness remains unchanged. |
| Supplied source40 / positive100 | Existing fixed text | Preserve; do not add customer suffix or derive new classifications. |

`isQualifiedProdatApplicationError` currently checks identity, not text. If the
new readiness contract is persisted, qualify that contract at the existing
persisted internal-review delivery boundary too, so a stale typed error cannot
bypass readiness. This is about eligibility for a text-bearing wire error, not
removal of the source-qualified F from the local diagnostic record. Direct callers
must use the same result; a final renderer alone cannot protect prior business
mutation. Review must approve this finite interface before runtime.

## Finite acceptance matrix for the authorized implementation

| Gate | Required controls |
| --- | --- |
| Source labels/templates |41:209,226,260,261;42:210/format,227/qualifier,224/scalar,506/code; exact §2.2 names and actual submitted values. Keep all existing numeric/parent classifications unchanged. |
| Own227 condition |209 missing,226 missing,both missing; unrelated41 with known missing reference; both references present no suffix;42/40 no suffix. Use raw227 only. |
| Ownership | Two objects with distinct customers, second register of own valid chain, conflicting/absent227, header/no-object, laterUNH, cached/DB customer sentinels; no cross-owner fallback. Optional/forbidden227 absence must not add I. |
| Component evidence | Correct main value + bad1131/3055/2379; empty component; single scalar; conflicting values; no first-match/expected-value substitution. Preserve actual field identity. |
| Encoding | All three existing UNA alphabets, Swedish letters, literal `:+?'`, custom delimiter characters in wrong value/customer; decode final draft, assert oneERC and one allowed C108 per error, no extra segment. |
| Bounds |69/70/71 decoded chars; expansion by escaping; maximum35-character227 with missing261/209/226; overlength actual input; no abbreviation/truncation/split-C108 escape hatch. |
| Readiness/disposition | Pure projection and actual persisted inbound for F-ready,F-unready,F-ready+F-unready,I+readyF,U/L-only; assert persisted decisions and exact actor/business side-effect absence only on I paths; no positive fallback. |
| Actual consumers | Canonical→persisted→draft, direct shared506, actual manual/TGT current preservation controls, final renderer. No synthetic draft-only result substitutes for the persisted guard. |
| Preserved contracts | Source40/109 and supplied40/105, positive100/OK, PR351 energy applicability and source family boundary, existing own A209/A226; no new foreign national mapping. |
| Scope/review | Independent source/spec+architecture review and root authorization first; scoped regression after implementation; frozen integrity and required repository gates without lowering thresholds. No historical acceptance-count increment from probe count. |

### Existing assertion boundaries before future edits

No old assertion is changed in this source task. Targeted search/read found no
existing normative assertion requiring the observed generic41/42 prose or the
literal-plus/apostrophe loss. The following are explicit future compatibility
boundaries, not permission to weaken tests:

| Existing suite | Contract to preserve / conflict to resolve |
| --- | --- |
| `ediel-prodat-field-identity.test.ts` and `-inbound.test.ts` | Exact41/42 field identities, own references, U-only continuation, I-only hold and mixedF+I ready negative delivery; generic source prose is not asserted. New text-unready fixtures must be separate. |
| `ediel-prodat-field-identity-owners.test.ts` | Finite scalar, date, qualifier, repeated-register, invoicee and GAS field projections currently remain ready. New failure evidence must keep these small representable errors deliverable. Do not use missing transport metadata to convert their existing expected negatives into broad holds. |
| `ediel-prodat-field-identity-review-metadata.test.ts` | Invalid identity metadata remains I; complete missing226 in idless-customer Z10 stays ready; special109 synthetic description does not mandate generic text and can use p93 fixed text without changing the identity assertion. |
| `ediel-prodat-energy-product*.test.ts` | Preserve506 applicability, family/source guards, exact error counts and own references. Consumer assertions intentionally retain legacy41/322: correcting that national mapping would conflict with this unit's scope, so leave it for separately qualified work. |
| `ediel-prodat-register-source-selection.test.ts` | Scenario-selection strings such as `Konstant saknas` are matching inputs, not blanket authority to rewrite registry/TGT text. |

A later implementation author must enumerate any additional failing old assertion
with its source/code cause before editing it. A changed text-readiness contract is
not authority to weaken identity, applicability, no-leak or no-business-I checks.

## Evidence, initial failures and verification

Scratch root: `/workspace/scratch/2a201d6d5897/aperak-text-source-20260920`.
Companion: `f3-aperak-text-source-20260920.evidence.json`. It records exact probe
sources/results/hashes and reduced actual output so this audit is recoverable
even if scratch disappears. Full original PDF is identified above, not duplicated.
All identifiers in probes are synthetic.

Original evidence was retained, not rewritten to make the history green:

- `observe-v1.test.ts` / `run-v1.json`: failed1/1 on the uncaught71-character
  preflight rejection; output accumulation had not yet been written. This failure
  discovered working protection. `observe-v2.test.ts` only catches length-case
  outcomes for observation and writes the new `observations-v2.json`; passed1/1,
  recording45 observations. No production fix and no normatively green claim.
- `persisted.test.ts` initially used fixture `raw`'s defaultZ04 while metadata said
  Z01; actual canonical Z04 results and failed assertion are preserved in
  `persisted-observation.json`/`run-consumers-v1.json`. This is an invalid control,
  not product evidence. Fresh `persisted-v2.test.ts` passes explicit rawZ01.
- `tgt-v1.test.ts` placed the constant in the wrong CAV component and hit the
  existing register-review guard before result output. Fresh `tgt-v2.test.ts`
  uses `characteristic('Z02','1',3)`. Corrected consumer run passes2/2, including
  distinct-meter control and same-meter actualTGT negative. These fixture repairs
  did not change existing tests or production and do not erase the initial2fails.
- `normative-v1.test.ts`: expected red reproduction, six failures (three41
  alphabet cases, date/qualifier42, exact escaping), three passing preservation
  controls (100,40,71-character preflight). Chosen compact punctuation and
  single-fault component rendering are explicit design conventions above;
  observed omissions are substantive regardless of those conventions.

Reproduction commands, from repository root (redirects create the named receipts):

```sh
sha256sum /workspace/scratch/2a201d6d5897/prodat-original-source/PRODAT-26A-r3.pdf
pdftotext -layout /workspace/scratch/2a201d6d5897/prodat-original-source/PRODAT-26A-r3.pdf /workspace/scratch/2a201d6d5897/aperak-text-source-20260920/full-original.txt
pdftoppm -f 94 -l 94 -scale-to 1600 -png /workspace/scratch/2a201d6d5897/prodat-original-source/PRODAT-26A-r3.pdf /workspace/scratch/2a201d6d5897/aperak-text-source-20260920/p94
node node_modules/vitest/vitest.mjs run /workspace/scratch/2a201d6d5897/aperak-text-source-20260920/observe-v2.test.ts --config /workspace/scratch/2a201d6d5897/aperak-text-source-20260920/vitest.config.mjs --reporter=json --outputFile=/workspace/scratch/2a201d6d5897/aperak-text-source-20260920/run-v2.json > /workspace/scratch/2a201d6d5897/aperak-text-source-20260920/run-v2.log 2>&1
node node_modules/vitest/vitest.mjs run /workspace/scratch/2a201d6d5897/aperak-text-source-20260920/persisted-v2.test.ts /workspace/scratch/2a201d6d5897/aperak-text-source-20260920/tgt-v2.test.ts --config /workspace/scratch/2a201d6d5897/aperak-text-source-20260920/vitest.config.mjs --reporter=json --outputFile=/workspace/scratch/2a201d6d5897/aperak-text-source-20260920/run-consumers-v2.json > /workspace/scratch/2a201d6d5897/aperak-text-source-20260920/run-consumers-v2.log 2>&1
node node_modules/vitest/vitest.mjs run /workspace/scratch/2a201d6d5897/aperak-text-source-20260920/normative-v1.test.ts --config /workspace/scratch/2a201d6d5897/aperak-text-source-20260920/vitest.config.mjs --reporter=json --outputFile=/workspace/scratch/2a201d6d5897/aperak-text-source-20260920/run-normative-v1.json > /workspace/scratch/2a201d6d5897/aperak-text-source-20260920/run-normative-v1.log 2>&1
npm run ediel:masterplan-v2:integrity
git diff --check
```

Use new unique result names when reproducing; original receipts above must remain.
Final verification:

- Corrected actual-consumer observation run: PASS2/2. Canonical/direct/manual/
  renderer observation run: PASS1/1 with45 recorded observations.
- Normative reproduction: expected RED6, preservation controls PASS3; no claim
  of passing runtime conformance. Initial failed receipts retained and hashed.
- `npm run ediel:masterplan-v2:integrity`: PASS33 original files,121 rules,231
  contracts; application conformance and production readiness explicitly false.
- Evidence JSON parsed, embedded probe text checked against its SHA256 manifest,
  corrected consumer decisions and normative counts checked; source PDF identity
  unchanged. Source-only staged diff and whitespace check PASS.
- Self-review refuted oversize-wire/injection/sibling-leak claims, separated
  unavailable227 and legacy national-mapping residuals, and verified proposal
  placement before persisted positive/actor/business behavior. Independent review
  is still required; self-review is not its substitute.
- Only this audit and its companion evidence are committed. Runtime, old tests,
  frozen source/registers, memory, workflow, gates and budgets are unchanged by
  this author. No full runtime release suite was rerun for documentation; root
  owns the separate actual-main certificate.
