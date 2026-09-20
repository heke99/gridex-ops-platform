# F3 continuation after PR359 — criterion reconciliation R1

Date: 2026-09-21. Runtime baseline: actual accepted main `71d2adf8b8b5f4305683a1399ddb5c17f0808ee8`.
Status: REVIEW_CANDIDATE_READ_ONLY. No runtime, schema, workflow, frozen-source or existing-test assertion change is made by this record.

## Retained accepted evidence

Do not reopen the accepted bounded units without a concrete counterexample: D110/110 + dependent parent occurrences10/10; PR351 incoming506/shared242; PR352 P94/A905 text/readiness and own227; PR353 permission322/324; PR354 prior-flow authority; PR355 remaining incoming cells; PR356 GAS240 and PR357 publication; PR358 E011/UNB0031; PR359 FTX301/303 and format routing. PR359 actual-main receipt is `.agent-memory/pr359-main-acceptance-20260921.json`.

## F3C-02 — register composition

Fresh current-code trace on71d:
- `prodatRegisterFields.ts` owns numeric314 global LIN sequence,209 exact object identity,258 C829 register index,213 QTY136, and the other local/common register fields.
- `prodatRegisterGroups.ts` groups by message + exact decoded object/agency; validates global314,258 sequence and explicit209 for register chains; later valid registers inherit first-register common semantic fields while local fields remain own.
- `prodatRegisterRuleScopes` enforces local versus first-register-only validation; invalid chains receive no omission/inheritance privilege.
- `fieldMatrix.ts` calls specialized register owners before generic segment-path presence.
- Actual consumers cover parser/compat, canonical facts, inbound staging, rulebook validation, TGT matching and pre-I/O structure guards.

Existing accepted-main unit log proves these suites executed green: registers50, conditions52, structure-guards36, consumers30, preflight24, source-selection33, object-projection12 and quantity24. Historical source/runtime register audits record the exact314/209/258/213 ownership, first/later-register overlay, malformed-chain behavior and consumer path. Disposition: no new counterexample found in this reconciliation; current composition evidence is consistent with the retained source decisions. This is a criterion reconciliation decision, not a claim that aggregate counts alone prove all74 fields.

## F3C-04 — P/U APERAK and UTILTS-ERR

Retained bounded units already cover typed numeric field identity, incoming p119 handling, P94/A905 text/readiness, own227, permission322/324 and prior-flow correlation. Current `utiltsEngine` keeps application and functional issues typed and transaction-referenced; `resolveUtiltsTransactionDispositions` gives guide errors negative APERAK and functional errors UTILTS_ERR per transaction. `createUtiltsRuntimeAcks` persists the corresponding transaction ACK result and keeps syntax rejection on CONTRL. Existing mixed transaction/persistence tests and actual-main5010 suite are green.

Disposition: current evidence supports the mapped response ownership already implemented. No new F3C-04 runtime defect was reproduced. This does not manufacture an ERC/field mapping for an unrepresented source condition.

## F3C-05 — guide-before-function and per-transaction persistence

Current runtime orders guide validation before processability, and transaction disposition selects guide rejection before functional rejection for the same transaction. Mixed siblings are individually classified. Persistence uses the transaction id/reference and response type; accepted siblings are not globally converted by a rejected sibling. Existing `ediel-utilts-transaction-disposition.test.ts` and `ediel-utilts-transaction-persistence.test.ts` execute in OPS verify and passed on accepted main.

Important residual: historical E035 is not closed by this. The 25-A-4 policy flag `validateMeterAndRegisterAgainstStructuralInformation=true` has no verified operational E61/E62 consumer in the current trace. Search finds the flag definition/test but no runtime consumer. Therefore this is a real remaining evidence/implementation gate, not something to mark green.

## F3C-06 — full UNSM grammar / G06

The current `syntaxValidator.ts` checks envelope presence, BGM where applicable, UNT count, UNH/UNT reference and stored syntax/runtime status. `segmentSchema.ts` has family profiles, required/forbidden coarse segment counts, order and selected field-length limits. The release-aware component correction is separately source-backed and tested.

The masterplan explicitly requires full UNSM grammar as a separate source. The frozen `source_manifest.json` contains P,T,U,UE,AI,OE,AP but no complete UNSM message grammar package. Current `syntaxValidator.ts` is visibly not a complete component/segment-cardinality grammar. Therefore F3C-06 cannot truthfully be made green by code inference. This is a source/evidence blocker; no parser rewrite is authorized without the missing authoritative grammar/version package.

## F3C-07 — old findings E001–E013 and E034–E037

E011 is accepted by PR358 and must not be reopened. The source/readiness/field/ACK corrections delivered through the accepted PR chain supersede the original observations where the exact defect has a bounded accepted receipt. E034's guide-version split is represented by effective-dated25-A-3/25-A-4 selection and runtime decision reuse tests. E036/E037 have current transaction-disposition/persistence paths and green tests.

E035 remains OPEN as described above: a policy flag is not an operational structural-information check. Do not claim the old finding closed merely because the date-policy test expects the flag to be true.

For E001–E010,E012,E013, use the retained accepted bounded receipts and current source paths when producing the final finding ledger; do not replay old observations as current defects without a present counterexample.

## Exact remaining blockers before full F3/masterplan closure

1. **E035 / structural-information runtime**: qualify the dated structure source and operational consumer for meter/register checks, then implement/test E61/E62 only if source + data authority permit it. Current tenant object matching is not sufficient evidence for meter/register structure.
2. **F3C-06 / full UNSM grammar**: obtain/qualify the authoritative full grammar/version package and bind it to parser/preflight/release evidence. The repository's frozen source package does not contain it.
3. **PR310-dependent parity** remains deliberately deferred by user decision and must not be imported to fake closure.

No other new runtime defect is asserted by this R1 reconciliation. Independent review is required before promoting the reconciled non-blocked criteria. Full F3/masterplan remain NOT_COMPLETE until the two concrete gates above are resolved or formally scoped out by authoritative source/acceptance decisions. PR310 remains OPEN/DRAFT/PAUSED at e961135199f292b8210884f07de3b616a670161a.
