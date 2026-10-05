# Retained source-input seams and remaining probes

Prepared after publishing initial PR #588 candidate `58ee11ef80a754ae31266f8440c555e4359a2723`. Its concrete new source-input finding requires a comment/records correction; the initial candidate and CI remain historical. This is a proposal, not an implemented helper API or executed test. Native is NOT_RUN and both whole contracts remain HELD.

The retained helper `scripts/helpers/ediel-z06f-reading-followup-native-fixture.ts` has a private capture at line 40, hardcodes stored inbound direction, asserts canonical acceptance at line 51 and accepted owner review at line 56, then performs first apply at line 58. Deferring apply alone cannot exercise rejected ingress. #503 retains this helper, its existing capture, native config, schema and stack; no additional harness or capture implementation is proposed.

Two optional additions inside that same helper would support the remaining probes:

```ts
// Proposed shape only. Retained owner chooses its final compatible API.
captureChange(kind, document, {
  beforeCapture?: (raw: string) => string,
  direction?: 'inbound' | 'outbound'
}): Promise<EdielMessageRow>

change(kind, document, {
  beforeCapture?: (raw: string) => string,
  deferFirstApply?: boolean
}): Promise<{ message: EdielMessageRow; apply: () => Promise<unknown> }>
```

The first reuses current private capture and exposes the real message before the helper asserts acceptance. The second retains genuine canonical validation, frozen rule evidence and owner review, while optionally deferring only its first apply. A raw modifier runs before actual admission/stamping and preserves syntax and recalculates UNT. Existing callers retain current defaults. Rejected source must follow the actual owner's disposition; an arbitrary assertion or synthetic approved assessment cannot authorize it.

| Probe | Physical input and required evidence |
| --- | --- |
| Intact F | Own inbound DSO→supplier/DDQ/BGM Z06 with own 223 E64. Existing wire supplies DTM+354, Z04 measurement method, multiplier and digits. First case approval must establish the versioned structure and the source-bound pending reading expectation. |
| Intact G | Same parties/object/supply scope with own 223 E32. Existing wire omits multiplier/digits while including optional 508/217/259. First approval must establish structure without inventing an F reading expectation. |
| Physical UD, F and G | Insert syntactically valid SG17 NAD+UD before own NAD+IT, keeping own point, LI, parties and dates. Original bytes/hash must retain it, committed canonical ignored-field evidence must bind its actual occurrence, and actual application/ACK must preserve customer identity/address. |
| Representative required deletion | F: delete only own DTM+354 (frozen PC-508 is R for F). G: delete only paired own CCI Z07/CAV (PC-306 is R for G). Rebuild syntax and preserve intact controls. No first structural receipt, business write, reading expectation or positive application ACK for the rejected object. Permitted negative responses are separate. These examples do not exhaust the 25 conditional cells. |
| Role/party | Reverse real UNB parties and NAD FR/DO together; separately mismatch the legal receiver while retaining the correct transport receiver. Test genuine supplier/facility ownership, separately from caller authorization. |
| Direction | Admit stored outbound direction through the retained capture option. Raw bytes alone cannot change the fixture's hardcoded stored direction. |
| Correlation/scope | Remove required own RFF LI; separately use a known foreign point consistently in LIN and NAD IT under the original company. An arbitrary different LI is not presumed invalid without source-owner qualification. |
| Original mutation | Use an existing qualified public mutation path after genuine capture/review and before first apply. Protected originals must remain unchanged and changed input must create no first effect/positive application ACK. If the real public guard rejects the write, assert that actual rejection and an intact control; do not bypass it or catch-and-pass. |

Incoming UD ignore selection is in `lib/ediel/rulebook/fieldMatrix.ts:635–654`; the inbound path in `canonicalPolicyFieldValidator.ts` excludes the outbound end-user overlay. `lib/ediel/core/receivedProdatIgnoredFieldBinding.ts` binds actual physical occurrences to that same fresh canonical owner decision before the existing ledger commits it. Standalone outbound UD validation is not incoming-ignore proof. Actual legal/facility review and original parity/first-effect SQL stay authoritative.

Source value finding: frozen annex B field 306 at lines 412–420 states installationsstatus Z11/Z12 at CCI Z07/CAV, while the existing retained `__tests__/helpers/structuralOwnerFixtures.ts` supplies Z07/E22. Retained original P26.A page 122 extracts in `permission-prior-flow-source-20260920/original-pdf-relevant-pages.txt:1445` and `permission-ack-source-20260920/original-relevant-pages.txt:1502` explicitly say valid codes Z11/Z12; their hashes match the historical evidence manifests whose original P PDF SHA256 matches the frozen source manifest. P page 60 table 2 agrees: Z11 Closed / Z12 Active. The original PDF bytes are absent; only the retained page text and recorded provenance were verified. No applicable supplement authorizing E22 was found.

Current canonical matrix field 306 has the correct locator but no allowedValues; current fieldMatrix skips code-list validation when that list is empty. The subtype overlay establishes requiredness, not an alternative code list. This is a documented inherited fixture/source-code-list qualification gap, not a reproduced native failure. The source owner must qualify the available original witnesses and any applicable later source, then address its existing fixture and canonical value checks with genuine valid and invalid-code contrasts. No source value is silently substituted in these new files. The independent reviewer narrowed static APPROVE to the proposal/design; the inherited fixture is not approved as a guide-valid positive control. Exact witnesses/pins are in field-306-source-qualification.json.

Future shared dependency: #503 comment 5995220684 documents the IMP05 owner's proposed single forward migration for original mailbox birth-address binding in the existing reception writer and configured-reply selector. It is not current-main evidence. Once published/integrated, the retained native owner must qualify genuine original reception and current route prerequisites at that exact source. Missing historical evidence must remain held; public SMTP input cannot fabricate original reception or authorize an ACK. Our authored files remain unchanged and NOT_RUN.

F's complete subsequent UTILTS/meter-value chain remains a separate whole-contract gap. Existing E66 fulfillment tests were not duplicated. Source-bound observations, consumers, own object/time/version correlations and prohibited writes require the retained owner's legitimate current execution evidence.
