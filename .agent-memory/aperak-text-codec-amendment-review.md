# APERAK trailing released apostrophe — source-only amendment review

Date: 2026-09-20. Independent reviewer. No production or test edits by this reviewer; no delegation, live calls, publication, deployment or gate changes.

## Verdicts

- **SOURCE/SPEC: APPROVE** the narrowly scoped amendment to preserve released trailing apostrophes in canonical/default business-segment input. Literal source data must survive serialization; a release sequence is not a segment terminator. Original P94/P104 text fidelity/cardinality requirements remain unchanged.
- **ARCHITECTURE: APPROVE** a release-parity-aware replacement for the existing trailing-apostrophe stripping inside `edifactEnvelopeCodec.sanitizeSegment`, limited to its current canonical/default body convention. This is a shared lexical boundary correction, not authorization for a general codec, tokenizer, service-alphabet or envelope redesign.

These are source/architecture approvals for root's authorization decision. The implementation itself has not been reviewed or approved. The earlier blanket no-codec-change boundary must be amended explicitly and only for the contract below.

**Qualification:** a narrowly scoped caller alternative exists for FTX. Therefore the justification must not say that codec modification is the only possible way to deliver the text. The shared correction is preferable because the same verified defect already breaks released references in the unmodified baseline and otherwise requires payload padding at multiple callers.

## Source authority and release semantics

The original PRODAT26A-r3 PDF identity remains SHA256 `83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95`. P94 requires the erroneous value in42 and own227 where the41 rule applies. P104 permits one populated C108/4440 and prohibits populated3453. P108 specifies UNOC syntax3 and delegates general EDIFACT/service-character details to the general technical guide. PRODAT's own pages do not define a new stripping algorithm.

Primary UN/EDIFACT syntax material independently confirms that a release character protects the following service character; a literal question mark is doubled. Consequently `?'` represents an apostrophe in data, `??` represents a question mark, and an apostrophe after an even-length consecutive question-mark run is a real boundary. Release characters do not consume the decoded field-length budget. These semantics also match the already-installed `escapeEdifactValue` and release-aware tokenizer.

Primary references retrieved through search:

- UNECE, UN/EDIFACT Syntax Rules, §5.1 and §7.3: https://unece.org/fileadmin/DAM/trade/edifact/untdid/d422_s.htm
- UNECE, Application-level syntax rules, §5: https://unece.org/fileadmin/DAM/trade/untdid/sessdocs/r1157.htm
- UNECE, Syntax Implementation Guidelines, omission/truncation discussion: https://unece.org/DAM/trade/untdid/texts/d423.htm

Search returned the relevant primary text; direct full-page opens returned403. No claim is made to have downloaded the separate Swedish general-technical guide or to have re-read an entire current ISO publication. The stable lexical rule is corroborated by the project's actual serializer/parser and the baseline controls below.

## Independently reproduced baseline defect

The shared checkout contains the runtime author's ongoing changes. To avoid attributing them to baseline, this reviewer extracted commit `80f77d12` using `git archive` into a new scratch directory. All imports in the independent probe resolve into that immutable baseline snapshot. The live codec and the extracted baseline codec match byte-for-byte, SHA256:

`a4dbfe181bad40848b535d286611ddf1ecd5a2a6ed1d242025305dd43159ebca`.

Affected original code: `lib/ediel/core/edifactEnvelopeCodec.ts:72–80`, especially `.replace(/'+$/g, '')`. It strips every terminal apostrophe without checking whether the preceding release run makes that apostrophe literal data.

Actual path:

`buildAperakDraft` → `buildAckDraft` → `buildAperakSegments` → `renderAperakEdiel` → `buildEdifactEnvelope` → `EdifactEnvelopeCodec.encode` → `encodeMessage` → `sanitizeSegment` → `preflightEdielPayload`.

The already-approved serializer escape turns a final literal apostrophe into `?'`. Sanitization removes the apostrophe but leaves `?`. When encode appends its segment terminator, that terminator is released. The next segment's tag becomes part of the preceding segment rather than a new segment. Depending on position, the observed result is a missing UNT or an UNT count mismatch. This is not a claim of a successful malicious send: preflight blocks the malformed envelope.

Independent observations:

| Input/control | Baseline result |
| --- | --- |
| Plain FTX body, with no terminator, one terminator or several ordinary terminal apostrophes | Preserves plain data and one actual UNT; declared count3. |
| Body ending `END?'`, `END?''`, or `END???'` | Absorbs the following UNT into FTX text; UNT disappears. |
| Body ending `END??'` or `END??` | Decodes `END?` correctly and retains UNT. |
| Released apostrophe in the middle of a value | Preserved correctly. This isolates the defect to trailing normalization. |
| Actual baseline renderer's complete APERAK skeleton, ordinary field260 text | Full build/preflight passes. |
| Same skeleton with source-correct escaped `Felaktigt Nätområdesid BAD:+?'ERC+100::260'` in its FTX value | FTX absorbs the following RFF tag; full preflight reports `UNT_COUNT_MISMATCH`,12 declared versus11 actual. No extra ERC is created. |
| Existing unmodified `buildAperakDraft`, valid raw ownLI=`OWN'`, matching explicit error reference | Full actual draft fails `MISSING_UNT` and required trailer checks. Thus a baseline consumer already exposes the same defect independently of the proposed text composer. |
| Empty, whitespace-only, or only ordinary terminators | Existing `edifact_empty_business_segment` rejection. |
| Canonical `UNH+BAD`/`UNB+BAD` supplied as business segments | Existing envelope-tag rejection. |

The complete-skeleton FTX observation deliberately replaces only the renderer's known lossy FTX text with the approved serializer output **in probe input**. This isolates the codec boundary without pretending the old renderer already implements exact text. No extracted production module was patched. The separate ownLI probe runs the complete unmodified baseline draft as-is.

The author's new boundary receipt independently records9 cases:5 passing controls and4 expected failures. Those results were inspected, not regenerated or overwritten.

## Caller alternatives: what was actually tested

1. Extra terminal apostrophe: fails; the current regex strips both the extra terminator and the released literal apostrophe.
2. Trailing ordinary space: fails; `.trim()` removes it before the regex runs. Adding a visible sentinel or punctuation would alter the required actual text.
3. Extra trailing C108 component separator: preflight currently accepts it, but it produces a second empty component. It is outside the approved single-component acceptance contract and is not the recommended alternative.
4. **An empty final language position:** `FTX+AAO++260::260+<escaped text>+` passes the actual full baseline envelope/preflight and decodes one C108 value exactly. There is no populated3453 value. UNECE's omission/truncation rules permit empty trailing data-element positions; the syntax implementation guidance prefers truncation but explicitly describes the empty-position alternative. P104 prohibits a language value, which this form does not supply. This is a defensible source-compatible FTX-only workaround, not an extra FTX or a longer decoded text.

Thus “no source-compliant caller alternative exists” is refuted. However, the workaround encodes a codec accommodation into every affected segment builder and does not fix the verified ownLI path. A small shared boundary correction avoids that coupling and preserves the existing compact wire form. No padding or source-value rewriting is needed if root authorizes the amendment.

## Actual UNA interface and bounded applicability

`EdifactEnvelopeEncodeInput.una` is real. `encode` merges it with `DEFAULT_UNA`, emits the selected advice, and appends the selected segment terminator. It is incorrect to describe the codec as having no custom-UNA option.

It is equally incorrect to claim complete custom-UNA serialization: `serializeUnb`, `encodeMessage`, party/message composites and existing business builders use canonical `+` and `:`; `sanitizeSegment` and `escapeEdifactValue` use canonical apostrophe/question-mark conventions. No general body transcoding occurs.

The independent probe confirms both sides:

- A release/terminator-only override (`!`/`~`) with unchanged `+`/`:` can frame ordinary compatible input; escaped `!~` remains a literal tilde. Preserve these established cases.
- Overriding data-element/component separators to`;`/`*` emits that UNA but leaves generated UNB/UNH/UNT/UNZ in `+`/`:` form. The actual parser consequently does not recognize those headers as the expected tags. This is an existing interface limitation, not introduced by the proposed amendment.

The current APERAK path `buildEdifactEnvelope` does not pass a custom UNA; its output is the default alphabet regardless of the inbound alphabet. The small reviewed fix may therefore retain the existing canonical/default **business-input** convention and distinguish released apostrophes using the canonical release character. It must not opportunistically reinterpret all body syntax according to selected UNA while the rest of encoding remains canonical.

No new custom-UNA rejection policy, generalized transcoder or claim of full custom encoding is authorized. Characterize ordinary existing partial-UNA behavior and preserve it; record the existing general custom-encode limitation separately. The finite guarantee of this amendment is the actual canonical/default APERAK path.

## Finite amendment contract for root authorization

1. Permit only the necessary change to `sanitizeSegment`'s terminal-apostrophe normalization in `lib/ediel/core/edifactEnvelopeCodec.ts`, plus focused regression tests/evidence. Keep the public interface and default output alphabet unchanged.
2. After the existing newline removal and trim, remove terminal **unreleased** canonical apostrophes. Determine release status by the parity of the immediately preceding consecutive canonical question marks. Stop when the terminal apostrophe is released. Re-evaluate when stripping another ordinary terminator exposes an earlier apostrophe. Do not use a simple “previous character is question mark” check, which fails doubled-release cases.
3. Preserve `?'`, `???'`, repeated released apostrophes, and released data followed by one or several ordinary terminators. Preserve existing handling of plain input, `??'`/`????'`, CR/LF/outer whitespace, empty segments, and canonical envelope-tag rejection. Do not repair dangling release sequences, guess new tags or silently manufacture empty content.
4. Keep UNB/UNH/UNT/UNZ generation, counts, environment/test indicators, message references, sender/receiver identity, tokenizer/serializer ownership and all envelope/profile preflight checks unchanged. No swallowing exceptions or lowering thresholds.
5. Require the existing original9-case red boundary suite to pass unchanged. Add controls for empty/terminator-only input, each prohibited canonical envelope tag, doubled/tripled release parity, released apostrophe inside a value, and compatible partial-UNA framing. Existing general custom-separator behavior is characterized as a residual, not “fixed” by test weakening.
6. Verify actual APERAK text through the final draft: default output under all three supported inbound fixture alphabets, exact final literal apostrophe, one ERC/FTX and one C108 value, correct UNT/UNZ, unchanged own references. Include the pre-existing ownLI-ending-apostrophe draft so the shared boundary's effect is concrete. Keep69/70/71 decoded-capacity and positive100/fixed40 preservation gates.
7. Run focused codec/envelope/tokenizer/ACK regressions and all already-required runtime/repository release gates. This review grants no waiver of existing assertions, counts, gates, budgets, source integrity or independent completed-runtime review.

A release-parity loop is sufficient for this finite boundary. Replacing the codec, widening producer authority, adding a new parser, changing frozen profiles or generalizing all service characters is not necessary to satisfy the evidence and is not approved here.

## Verification and receipts

Scratch root: `/workspace/scratch/2a201d6d5897/aperak-codec-review-20260920`.

Executed from repository root:

```sh
node node_modules/vitest/vitest.mjs run /workspace/scratch/2a201d6d5897/aperak-codec-review-20260920/codec-baseline.test.ts --config /workspace/scratch/2a201d6d5897/aperak-codec-review-20260920/vitest.config.mjs --reporter=json --outputFile=/workspace/scratch/2a201d6d5897/aperak-codec-review-20260920/run-codec-baseline.json
npm run ediel:masterplan-v2:integrity
git diff -- lib/ediel/core/edifactEnvelopeCodec.ts
```

The probe command redirected stdout/stderr to its unique `run-codec-baseline.log`. Result: **2/2 observation tests PASS,27 recorded observations**, including explicitly asserted existing failures. This does not imply a repaired codec. Source integrity PASS33 originals/121 rules/231 contracts with application conformance and production readiness explicitly false. Codec diff is empty; snapshot/live/blob equality verified. The runtime author's unrelated working changes were left untouched.

SHA256:

| Reviewer artifact | Hash |
| --- | --- |
| `codec-baseline.test.ts` | `006c00042ae5bc0c1f1d7cab0ee1763297aa83ff09484de0c3dd2437d7f84425` |
| `codec-observations.json` | `0496ec8ddfb01f8186dc00f1a4ac9c04f6bfb3ae3c69d2fe54bd187bb1aee122` |
| `run-codec-baseline.json` | `81926790b75d8e7a586582f8d86ce3444a45b8221c2a2880ead2048a0f81081c` |
| `vitest.config.mjs` | `38d5c464395594c8aa0b7ab79ae76c422fa4ff08dd0945805b2fdc4afb472bf6` |

Only this requested review report was written inside the repository's ignored review directory. No original author receipt was overwritten. Root may now decide the narrow authorization; runtime implementation and its verification remain the author's responsibility.
