# Permission ACK registry/register-boundary amendment review

2026-09-20. Scoped independent amendment to the approved322/324 source proposal. Reviewed current register/registry code, original PDF P47/114–116, the author's duplicate-reference fixture and diagnostic receipt, and fresh independent controls. No implementation edit or guard change was made by this reviewer.

| Verdict | Result |
| --- | --- |
| SOURCE/SPEC | **APPROVE**, for the exact registry-only scope below. |
| ARCHITECTURE | **APPROVE**, as a narrowly qualified consumer guard correction; shared grouping and national258 classification remain unchanged. |

Root must separately authorize the amendment. This is not completed-runtime approval or broader register/permission workflow acceptance.

## Source and independently reproduced baseline

The original PDF already verified in the parent source review has SHA256 `83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95`. Fresh rereading of P47 says C829 is used only in Z04/Z06/Z10 and required when a meter has multiple registers; field314 instead increments per SG8 repetition. P114 likewise restricts register reporting to those three functions and describes C829 as its indicator. P116 says258 is omitted for a single register.

Therefore equal decoded209/agency, even with equal LI, does not itself establish a register chain in incoming Z14/Z15/Z18. Nor does this source establish that duplicate business references prove two valid grants, two distinct facilities or an authorized repeated business transaction. The bounded conclusion is that missing258 must not be inferred from equality alone when assessing these independent physical permission-LIN occurrences. Their322/324 field errors remain separately observable.

`prodatRegisterGroups.ts:53–75` groups by messageIndex/itemId/agency and, for two equal identities in a non-register function, emits `per_object_register_sequence_invalid`258 for each LIN even with no C829. `fieldMatrix.ts:574–581` turns those into `PRODAT_REGISTER_STRUCTURE_INVALID` typed258/missing diagnostics. `validateProdatRegisterPayload` passes them to the registry's unconditional hold. None of that branch tests for an actual C829 before deriving the unsupported multiple-register interpretation.

The author's receipt is `/workspace/scratch/2a201d6d5897/permission-ack-register-boundary.json`; the relevant pending consumer test is `__tests__/ediel-prodat-permission-ack-consumers.test.ts`, `equal references retain distinct stable physical issue and detail upsert keys`.

Reviewer independently constructed two Z15 LINs with valid global sequence1/2, identical209/agency/LI, own X99/324 in each and omitted C829. Fresh actual `validateProdatRegisterPayload` produced exactly two258/missing diagnostics at physical lineIndex0/1; actual `resolveAndStoreProdatAperakErrors` threw `PRODAT_REGISTER_ACK_REVIEW_REQUIRED` before the mocked DB could be reached. This confirms the author's diagnosis and that the earlier approved two-row persistence assertion cannot currently reach its write boundary.

## Exact approved scope

Keep the existing registry validation and exclude only the causally identified derivative missing258 issues from **this registry hold**, under all of these conditions:

1. The message is inbound PRODAT and the selected wire PRODAT message has a unique own BGM with exact function Z14, Z15 or Z18. Cached message code, scenario and testData cannot authorize the exclusion. Missing/ambiguous own function does not qualify.
2. C829 is entirely omitted in the selected permission message. Use the existing structural field-state reader, which treats an explicitly empty fourth LIN element as present/malformed. An empty, malformed, populated or extra-element C829 retains the existing hold. Conservatively requiring omission in every selected LIN is acceptable and keeps mixed-message logic finite.
3. The excluded issue is exactly `PRODAT_REGISTER_STRUCTURE_INVALID`, typed field258 with errorKind `missing`, and its own physical lineIndex corresponds to an equal209/agency sibling group's structured `per_object_register_sequence_invalid` problem. Do not filter all258 errors, all register errors, or infer authority from human-readable description text. If association cannot be proved, preserve the hold. Reusing the structured `prodatRegisterGroups(...).problems` evidence for this narrow predicate is appropriate; do not alter its grouping output.
4. Every other issue remains. Global314 errors, invalid209, explicit C829/index errors, reading/format/scope errors, and all gas/death/meter guards retain their existing behavior. Ready322/324 projection cannot turn a remaining structural/internal failure into a positive response.

The only production change authorized by this review would be the small registry-side predicate/helper and its guard integration, with tests. Shared `prodatRegisterGroups`, `fieldMatrix`, `validateProdatRegisterPayload`, parser/semantic grouping, outgoing preflight, canonical national258 mapping and nonpermission consumers are outside this amendment. No schema, codec, frozen source, workflow or gate change is justified.

After the narrow exclusion, actual322/324 errors must reach the existing typed registry projection and persistence path with their stable physical occurrence keys. No new national258 error or new business authority is introduced.

## Scenario boundary and alternative

`deriveOtherProdatAperakValidationIssues` has a second guard after `resolveTgtExpectedProdatContext`/`validateParsedProdatAgainstExpected`. The comparator at `prodatValidators.ts:116–136` can emit `register_invalid` because descriptive parsed lines have `validRegisterChain=false`, or because expectation matching is ambiguous. **This amendment does not waive that separate comparison guard.** A scenario with no expected objects may pass it; a populated ambiguous expectation must retain its hold unless a later independently qualified amendment proves a narrower correction. Preserve typed322/324 evidence on that internal stop; do not fabricate a national error or write records through it. Document this limitation in runtime results.

Preserving the original hold while retaining typed field evidence would be a safe alternative if root declines any guard change. It would require narrowing the two-write acceptance claim to an internal-stop/evidence assertion for this input. The original registry hold is not necessary solely to prevent invented permission grants: the proposed exclusion only enables source-qualified ACK field reporting, while prior-flow/business authority remains separate and unaccepted. Thus the narrow consumer correction is viable without reopening the shared register architecture.

Canonical/generic register handling of equal-reference permission LINs remains unchanged and may still report258. The amendment does not certify those complete workflows or conceal that residual.

## Finite implementation acceptance matrix

| Control | Required actual result |
| --- | --- |
| Inbound own Z14/Z15/Z18; equal209/agency/LI; sequence1/2; no C829; two ready field errors | No hold solely from derivative missing258; two own typed errors survive. For the actual registry persistence path, two distinct stable issue and detail upsert keys; replay preserves keys. |
| Same input with distinct business references | Existing successful selected-field path preserved. |
| C829 present on either LIN, correct-looking `1:1`/`1:2`, empty fourth element, malformed indicator/index or extra element | Original register hold; no permission registry writes. |
| No C829 but bad global314, malformed209 or another register/reading issue | Other issue still holds; no permission registry writes. |
| Nonpermission Z04/Z06/Z10 equal IDs with omitted or bad C829 | Original checks unchanged; no exclusion. Include a valid supported register-chain preservation control. |
| Outbound or cached Z15 with different/ambiguous actual BGM | No exclusion. |
| Selected valid/positive scenario with no independent comparator failure | Wire field errors remain authoritative; expected label cannot discard them. |
| Populated scenario producing a separate ambiguous register comparison | Preserve hold and typed field evidence; no broad scenario bypass. |
| Text/internal readiness failure mixed with ready field error | Existing before-write stop remains; ready error retained in evidence. |

Run the equal-occurrence cases with the three supported alphabets; select only one own UNH and ensure a subsequent message cannot establish the exception. No old assertion changes are approved by this amendment.

## Fresh verification

Scratch artifacts are at `/workspace/scratch/2a201d6d5897/permission-register-amendment-review-20260920/`: `review.test.ts`, `vitest.config.mjs`, `observations.json`, `run.log`. The independent probe executed actual grouping, register validator and registry against synthetic inputs with a DB boundary that throws if reached. Result: **1/1 PASS,16 captured controls**, covering Z14/Z15/Z18/Z04 crossed with omitted C829, populated C829, explicitly empty C829 and invalid314. These prove the baseline and preservation distinctions, not a fix. No original receipt was overwritten and no live service was called.

Applied the same local source-compliance, code-review, false-positive and verification guidance as the parent review. The proposed change is bounded and source-supported; no broad grouping rewrite or national258 reclassification is approved. P-ACK-R1 remains HIGH/open, generic209/261 residuals remain, and counts/PR310/full-F3 status are unchanged.
