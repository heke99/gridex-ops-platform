# Existing assertion map — APERAK text proposal

Read-only follow-up to source candidate `80f77d12`, 2026-09-20. No tests, runtime,
audit, evidence or source files changed; no test run. Only this preparation note
is written. Independent source/architecture review and root's individual rulings
are required before any assertion edit. The proposal is not runtime authorization.

Result: **two concrete conditional capacity conflicts**, covering thirteen existing
case executions. No existing assertion requiring the defective generic A905 prose,
omitted available own227, or plus/apostrophe loss was found in the inspected ACK/
PRODAT tests and EDIEL regression scripts. The two conflicts arise when mandated
source name plus exact wrong value exceeds70; they are not cosmetic literal swaps.

## Measured source text

Source already qualified in the committed audit: original §2.2 pp20/23 labels,
p94 `Felaktigt <<fältnamn>> XXXX`, p104 one C108/4440 an..70. Count decoded
characters; all characters in these two examples are single UTF-16 code units and
single ISO8859-1 characters, so no surrogate/byte ambiguity. `Felaktigt ` is10,
the separator before XXXX is1. Neither42 case receives a customer suffix.

| Existing branch | Exact proposed decoded source text | Arithmetic | Result |
| --- | --- | --- | --- |
|506 actual `'X'.repeat(36)` | `'Felaktigt Produkt id (Energiprodukt) ' + 'X'.repeat(36)` |10 +26 +1 +36 |73: cannot send unchanged in70 |
|317 actual `'C'.repeat(36)` | `'Felaktigt Postort-fakturamottagare ' + 'C'.repeat(36)` |10 +24 +1 +36 |71: cannot send unchanged in70 |

These are source labels, not formatter-added explanatory decoration. Removing the
space before XXXX still leaves506 at72 and is unsupported for317's required
field-name/value template. Dropping `(Energiprodukt)`, abbreviating Postort's name,
truncating the submitted value, or additional C108/FTX must not be silently adopted
to keep an old wire assertion green. The proposed local text-unready response is
a design inference for adjudication; the national F identity is source-qualified
and must remain intact.

## Exact conflicting existing assertions

| ID | File:line and existing scope | Current expectation, expanded for the affected branch | Proposed case-specific expectation if readiness design is approved |
| --- | --- | --- | --- |
| C1a | `__tests__/ediel-prodat-energy-product.test.ts:24` (selection), `:26` (assertion); only loop tuple `['X'.repeat(36),'42']` at`:22` | `p = d.responsePlan.find(p=>p.family==='APERAK')!`; `expect(p.applicationErrors??[]).toMatchObject([{ercCode:'42',fieldCode:'506',referenceNumber:code==='Z13'?null:'735123456789012345',lineItemReference:'CASE:A+B?C'}])` | Do not assume an APERAK plan for the unrenderable single506 finding. Preserve diagnostic `kind:'field',fieldNumber:'506',errorKind:'invalid'`, full36-character value and original own reference evidence locally. Persist application rejected, functional manual_review and internal_review. No506 wire error, no100 fallback. |
| C1b | Same test`:27`, same tuple only | `expect(p.applicationErrors??[]).toHaveLength(1)` | No wire-eligible506; assert its retained local F identity/value separately. In this isolated fixture no ready negative remains, so technical response only. Do not change local F count to zero. |
| C1c | Same test`:28`, same tuple only | `buildAperakDraft({sourceMessage:msg,outcome:'negative',applicationErrors:p.applicationErrors})`; `expect(draft.rawPayload).toContain('FTX+AAO++506::260')`; `expect(draft.rawPayload).toContain('RFF+LI:CASE?:A?+B??C')` | Do not construct a national506 wire error with invented/truncated text. Assert no APERAK100/506 plan/draft and no positive fallback; retain exact LI and209 evidence in local diagnostic. Existing ready-branch correlation assertions remain unchanged. A separate actual persisted-I control must guard actor/business effects. |
| C2 | `__tests__/ediel-prodat-field-identity-review-owners.test.ts:33`; only row `['317',6,'C'.repeat(36)]` at`:26` with inner invalid tuple at`:28` | `expect(d.responsePlan.find(p=>p.family==='APERAK')?.applicationErrors).toEqual(expect.arrayContaining([expect.objectContaining({fieldCode:'317',ercCode:'42'})]))` | Retain existing local317 invalid-F assertion at`:32` exactly, plus full36-character wrong city. Mark local text-unready/internal_review; do not include317 in the wire-ready list. Persist rejected/manual_review; preserve any independently ready F, suppress100, and hold actor/business effects through the existing I boundary. No blanket expectation that all errors disappear. |

C1 repeats across three fixture alphabets × Z13/Z14 × S17/S18 = **12 affected
case executions**. Within each existing test the valid13-digit value, absent value
and short `INVALID` branch remain unchanged. C2 is **one affected branch** of the
five-field × missing/invalid invoicee table. Its missing317 branch and all other
field branches remain unchanged. These counts describe specific tests, not any
protocol acceptance increase.

`ediel-prodat-energy-product.test.ts:25` already expects syntax accepted and
application rejected for the long input; that expectation remains valid. No
existing assertion pins functional accepted/continue in this specific long506
branch. `ediel-prodat-field-identity-review-owners.test.ts:32` already proves
national identity and must not be removed or weakened. This separation is the
reason to adjudicate C1/C2 individually, rather than changing42 toI or relaxing all
negative-plan checks.

## Exact nearby expectations that do not conflict

These rows make the “no text-literal replacement found” result reviewable. A
source-derived new text assertion may supplement them in authorized runtime work;
it is not a reason to replace an existing identity/reference/guard assertion.

| File:line | Current literal/assertion or fixture value | Source-based proposed text/behavior | Ruling preparation |
| --- | --- | --- | --- |
| `__tests__/ediel-prodat-field-identity.test.ts:18` | Contains `FTX+AAO++226::260`; exact own209; excludes RFF+LI, sibling209 and `CACHED-UNRELATED` | New decoded41 text `Ärendereferens saknas, kundid=001` using fixture own227 (`fixtures/prodat-identity.ts:4`) | All current assertions remain; no old text literal to replace. |
| Same`:23` | Contains `FTX+AAO++207::260`; excludes own-object/LI refs for header | New text `Felaktigt Avsändare (Ediel-ID) SWE` from fixture's wrong country (`fixtures/prodat-identity.ts:5`); field-vs-component rendering follows proposed convention | All current assertions remain. |
| Same`:27–28` | Supplied untyped fixture `text:'invalid'`; assertion only `RFF+LI:CASE?:A?+B??C` and decoded LI `CASE:A+B?C` | Exact reference escaping remains. Qualified source-text changes must not invent national authority for this supplied untyped fixture | `invalid` is input, not an expected A905 literal; no replacement authorized. |
| Same`:39`; `ediel-prodat-field-identity-review-metadata.test.ts:26` | Missing226 Z10 retains rejected/functional accepted and ready41/226; metadata control expects `continue` | `Ärendereferens saknas`, no fabricated227 and no new I for forbidden/absent customer | Preserve; a new hold here would be an implementation regression. |
| `__tests__/ediel-prodat-energy-product.test.ts:26–28`, short `INVALID` branch | One42/506, exact209/LI, FTX506 | `Felaktigt Produkt id (Energiprodukt) INVALID`:10+26+1+7=44 | Ready; preserve all current assertions. |
| Same missing506 branch | One41/506, exact source refs | Z13: `Produkt id (Energiprodukt) saknas, kundid=001` (26+7+9+3=45); Z14: `Produkt id (Energiprodukt) saknas` (33) | Ready. Z13's legitimate absent209 triggers suffix for existing41, not a new209 error. |
| Same`:14–17` | False/inapplicable506 extras includingX×36 on Z01 remain accepted with onlyCONTRL | No national506 or text hold under false applicability | Preserve; C1 must not spill into this branch. |
| `__tests__/ediel-prodat-field-identity-review-owners.test.ts:33`,251/N×36 | Requires42/251 in wire-ready list | `Felaktigt Namn-fakturamottagare ` +N×36:10+21+1+36=68 | Ready; preserve. |
| `__tests__/ediel-prodat-field-identity-owners.test.ts:25`,320/X×36 | Requires42/320 in wire-ready list | `Felaktigt Värmevärdesområde ` +X×36:10+17+1+36=64 | Ready; preserve; no GAS activation is authorized. |
| `__tests__/ediel-prodat-field-identity-review-metadata.test.ts:42–43` | Input description `Both contract dates`; assertions concern sourceRule, continue/internal_review and count1/0 | Typed40/109 text `En period anges där endast en dag/tidpunkt förväntas` | Input prose is not asserted output; keep assertions. |
| `__tests__/ediel-masterplan-protocol-regression.test.ts:45–46` | Local issue titles `installation_id saknas`, `end_user_country saknas` | Local titles remain; only qualified wire composer uses source names | No conflict; rewriting validator titles would exceed proposal. |
| Same`:70` and`:78–82` | Untyped UTILTS_ERR fixture text `MISSING`; expectations validate U-profile/BGM/DOC, not P-text | U-family behavior unchanged | Not an APERAK P-text assertion; do not rewrite. |
| `__tests__/ediel-prodat-register-source-selection.test.ts:119–123` | Scenario input `Konstant saknas` selects`2.4.2`; `Samma mätarnummer` selects`2.4.1` | Scenario input classification unchanged | Not wire output. No source-based substitution authorized. |
| `__tests__/ediel-prodat-energy-product-consumers.test.ts:52,:56`; `scripts/ediel-rule-regression.cjs:282` | Legacy `{ercCode:'41',fieldCode:'322'}` | Existing legacy classification residual explicitly outside typed text unit | No text-unit authority to replace41 with42. |
| `scripts/test-ediel-component-escaping.cjs:101,:105,:114` | Exact decoded token shape, dangling-release rejection and actual component arrays | Existing release-aware codec semantics unchanged; new text uses existing serializer | Preserve; renderer loss does not justify rewriting codec assertions. |

## Search/read boundary and verification

Read existing PRODAT/APERAK assertion sites and their existing fixture definitions;
searched `__tests__` and `scripts` for APERAK/canonical projection/FTX, text/freeText,
Swedish expected descriptions, multiline assertions and snapshots. Read candidate
ACK/profile/persistence regression scripts and exact capacity-bearing assertions.
No snapshot file was found in those test/script roots. Local issue-description
assertions were distinguished from wire text. No new national source, mapping,
fixture or test run was added. The same already-qualified original §2.2 label
extract was used solely to verify label spelling/length.

Measurements were a read-only Python string-length calculation. Counts use exact
source spellings (including spaces and parentheses), not estimated widths. The
tracked working tree was clean at the end of this follow-up. This map is a finite
preparation receipt, not proof that every future implementation failure is an old
assertion conflict. Any further conflict must be reported with its exact case
before root adjudicates an edit.
