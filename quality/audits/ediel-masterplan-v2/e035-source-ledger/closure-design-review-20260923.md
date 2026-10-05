# Independent closure design review — 2026-09-23

Verdict: **one blocking design omission; otherwise the bounded Z05L/LK architecture is coherent.** This is a read-only review of `quality/audits/ediel-masterplan-v2/e035-source-ledger/closure-design-20260923.md` against the existing owners/readset/selection and frozen P source, not implementation acceptance or full E035 acceptance.

## Blocking finding: append-time exact source binding is unspecified

Design sections 2–3 require SQL to reconstruct UTC from caller-supplied `wire.effectiveTo.marketMinute`, compare that with caller-supplied `wire.effectiveTo.utc`, and compare the market calendar date with the live legacy DATE. They also preserve source/payload hash bindings. These checks establish internally consistent claims about one known original, but do **not** establish that the claimed minute came from that original's own DTM93. The design promises native rejection of a forged closure timestamp/case/source/hash; the described predicates cannot deliver the timestamp/case part.

Concrete counterexample: genuine raw Z05L contains `DTM+93:202609231234:203`, baseline starts earlier and has `validTo:null`, and the genuine ended supply has `end_date='2026-09-23'`, attributed to this source. Submit a marker with the same genuine source ID/hash, identities, baseline, review snapshot and permissions, but `marketMinute:'202609231235'` and the correctly converted `utc:'2026-09-23T11:35:00Z'`. All specified SQL conversion, stop-after-start and DATE predicates pass. Replacing LI/document reference is likewise not stopped merely by retaining the original payload hash. No collision or changed stored source is necessary.

This is demonstrated by existing boundaries, not an assumption about an unimplemented function:

- `20260922205926_ediel_reviewed_structural_source.sql`, `append_object_assessment`, binds business source ID/hash and canonical physical object membership; its canonical register fact contains object/register scope, not independently extracted DTM93/LI/document claims.
- `20260923074910_ediel_z06e_context_owner_gate.sql`, `review_business_proof_consistent`, reconstructs time from marker JSON. Reusing that strategy plus a DATE cannot independently bind a new sub-day field211 claim.
- Stored `sources.raw_payload` is available and hash constrained (`20260922095911_ediel_received_source_ledger.sql`), so a source-derived comparison is possible.

Required design correction: explicitly bind every authoritative closure wire claim to the persisted original at the append authority boundary, using an escape/UNA-aware, own-object source projection or a genuinely independently issued source-bound projection capability. Compare exact DTM93/203/ZZZ, message/function/subtype, own LI/document identity and party/scope claims; fail closed on ambiguity. A second caller-supplied JSON object, hash of that object, or SQL UTC recomputation does not independently establish the relationship. For this narrow slice an explicitly constrained source syntax is acceptable if all unsupported originals are held and that limit is visible.

Keep the TS original reparsing and timeline gate as defense in depth. They currently prevent a false marker from becoming positive selector authority when the new owner follows the existing `isReviewedStructuralBusiness` pattern. That means this finding is specifically a contradiction in the promised **SQL-validated immutable exact owner/native append rejection**, not a demonstrated complete end-to-end positive bypass. Alternatively, explicitly weaken the authority claim and tests to describe producer/consumer-only raw binding; that would change the proposed contract and is not my recommended resolution.

## Reviewed foundations that do not block this slice

- Verified original PDF SHA256: `83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95`, from `/workspace/scratch/db7cad0629c3/sources/Start av elbolag/260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B(6).pdf`. Direct P text pp13/50/65/123 supports inbound Z05, L/Z22 and LK/Z23, field211 as own SG8 DTM93/203, optional corresponding Z08H for Z05L LI, cancellation LI matching the cancelled message, and a bilateral requirement for Z25 outside Z08. I found no incorrect source interpretation in the minimal slice. The p130-era example shown in extracted text is expressly gas; it should not be repurposed as the canonical electricity fixture.
- Exact original stop plus an independently reviewed immutable marker can define **structural coverage** despite a legacy DATE mirror. DATE corroborates only market-day projection and selected legacy business attribution. The design says this clearly and does not claim downstream billing gained minute precision. No forced legacy schema precision rewrite is necessary for that bounded claim.
- `receivedSourceOwnerSession.ts` genuinely retains accepted switch/supply identity/start/source in immutable committed owner facts. `endActiveSupplyPeriod` overwrites live `status`, `end_date`, and `source_message_id`; requiring the preexisting reviewed coverage assessment avoids pretending the retained committed root alone contains outbound Z03/epoch coverage proof.
- `StructuralCoverage` contains the immutable root references and outbound/switch times needed by the proposed closure anchor; a separate closure version is appropriate. Closure must not enter `StructuralVersion` inventory/replacement processing.
- The design correctly identifies that `owner_rows_match` does not validate live switch/supply/outbound rows and explicitly requires those additional joins. Reusing only the generic checker would be insufficient, but the design already forbids it.
- Current `inspectStructuralReadset` globally holds Z05; classifying closures before that branch and preserving every physical object's unavailable/rejected observations can safely reduce the hold's scope. Missing party components must remain wildcards. Unsupported cancellation/correction must never reopen coverage or become no-effect skips.

## Precise implementation checks to retain

These are already substantially required by the design, not additional blocking design findings:

1. Preserve latest-revision semantics at both boundaries. The saved snapshot's selected baseline assessment must be its latest assessment by cutoff, with a timely witness; never choose an older accepted reviewed assessment behind an unavailable/rejected/unwitnessed successor. At fresh append, verify the intended current baseline is still current. A successor after an old saved selection cutoff must not retroactively change that saved selection.
2. Closure source rereview must use its own fresh canonical receipt and its source's current revision chain. If a newer closure revision exists by a consumer cutoff without a timely witness, the earlier accepted closure must become a scoped hold, not survive as an available fallback.
3. Match logical baseline identity without demanding identical physical register arrays between Z04 and Z05. Physical membership remains exact within each original; a Z05 does not supply an inventory.
4. In native tests alter the raw-bound market minute and UTC together while preserving the same legacy DATE. A test that alters UTC alone exercises conversion consistency and does not cover the blocking finding.
5. Use exact-stop tests for current point, closing point and interval ending/crossing stop. For unreviewed/rejected closure, preserve the proposed conservative hold at equality.

No code or repository files were changed by this review.

## Addendum — revised section 3A

**Verdict: the blocking design omission is resolved at design level.** I reviewed only the newly specified independent SQL original-wire binding, supported UNA/release grammar, and targeted native negatives, as requested.

Section 3A now requires the owner helper to obtain `src.raw_payload` from the sealed source row itself and independently reconstruct the authoritative wire projection before comparing it with marker claims. It derives physical boundaries and original DTM93, LI, document/function/reason and party/object identities rather than trusting caller offsets, tokens or a supplied digest. The lexical contract explicitly preserves released delimiters and physical grouping, bounds work, and holds unsupported grammar. This addresses the precise same-date forged-minute counterexample.

The required native negative changes minute **and** UTC together while preserving DATE, and separately changes LI/document/function/reason/identity claims. Red-then-green append assertions and hand-written expected values make these tests meaningful rather than self-consistency checks. Keeping TS original reparsing and canonical acceptance preserves the independent consumer boundary.

No design blocker remains from my original finding. This is approval of the revised design contract only; actual SQL parser correctness, append rejection and supported grammar must still be established by implementation review/native results. No broader scope was reopened and no code was changed.
