# E035 — bounded comparison of prior/current UTILTS sources

Read-only source/code comparison, 2026-09-23. Scope: E61/E62 meter/register comparison, observation and closing-point semantics, and the policy boundary before 2026-10-01. No code, tests, manifest or repository files changed. This is not whole-guide/G01 qualification.

## Evidence identity

Independently recomputed PDF hashes:

- Prior English `251001_Ediel_UTILTS-APERAK_User_Guide_Version_25-A-3.pdf`: `fad5cf4f775f86258ab9d5827426d54e57881b6298836110359cf0e41706a798`, 142 numbered pages. Cover/introduction pp1/4 say valid from **2025-06-01**, published/translated 2025-10-01. Introduction p4 identifies bracketed material as translator comments. Its contents page has stale section numbering: use the actual body headings/pages below.
- Frozen current Swedish `260331_Ediel_UTILTS-APERAK_Anvisning_version_25-A-4.pdf`: `0524c18f38864ebe081dec9d3d53f1797b224ef0af7b01986627e895f47d99be`, 135 numbered pages. Cover/current revision is 25-A-4; running document footers say 25-A-5. Cover/introduction pp1/4 give **2026-10-01** effective date. Preserve this identity discrepancy; do not silently rename the frozen source.

Read supplied full text extractions. Page numbers below are printed body page numbers, also matching PDF page positions for these passages. The English publication is a primary published guide, not an automatic language-based blocker. It does not silently supersede Swedish precedence or qualify unrelated parts of 25-A-3. No actual conflicting Swedish/English rule was identified in the bounded comparison below; the corresponding prior Swedish edition was not supplied for a word-for-word same-revision comparison.

## Clause comparison

| Topic | Prior 25-A-3 English | Frozen current Swedish | Finding / E035 effect |
|---|---|---|---|
| Meter comparison/E61 | Appendix 2 p138, field224 `SG8/RFF+MG alt SE/C506/1154`: compare meter number with master data; E61 on non-identifiable meter | Appendix 2 p132, same field/path and E61, comparison against received structural information | **Comparison and code unchanged; source terminology clarified.** The prior source does not say there was no comparison until October 2026. |
| Register comparison/E62 | Appendix 2 p138, field527 `SG8/RFF+AES/C506/1154`: compare with master data; missing or excess registers uses E62; examples explicitly compare PRODAT register count with UTILTS count | Appendix 2 p132, same field/path/code and the same missing/excess PRODAT examples, using received structural information terminology | **Unchanged substantive mismatch/count rule.** E62 is not newly introduced by the later guide. |
| Expected register provenance | Actual §3.6.8 p38: register ID sent in E66 also sent in Z04 and, as applicable, Z06/Z10 | §3.6.8 p37: same named PRODAT sources | **Unchanged.** Supports an authentic PRODAT comparison source before October; does not authorize an invented historic coverage anchor. |
| Register/observation grouping | §3.6.8 p38: chronological readings per register, all registers in E30/E66/S07, meter number once per register | §3.6.8 p37: same | **Unchanged.** Count register membership, not reading observations or energy SEQs. |
| High-resolution energy-only case | §3.6.8 p38: hourly or 15-minute points specify RegisterId only when meter readings are sent | §3.6.8 p37: wording narrowed to quarter-hour points | **Changed scope wording.** The existing hourly-or-shorter energy-only exemption has affirmative prior-source support. This does not certify every post-October resolution combination. |
| Time and singleton reading | §§3.6.1–3.6.2 p36: Swedish standard UTC+1 year-round; nonzero delivery period; E30 single reading uses no delivery period and reading time is an instant | §§3.6.1–3.6.2 p35: same | **Unchanged.** No fabricated one-day interval for a point reading. |
| Closing versus starting readings | §3.6.11 pp41–42, particularly p42: E30 readings without energy use E20 for end of supply, E77 for end of metering, E24 for last reading of a two-reading Z06F change; E67/E25 are corresponding meter/characteristic starts, E03 supplier start | §3.6.11 pp40–41, particularly p41: same rules | **Unchanged.** Existing E20/E77/E24 closing-side and E25/E67 current-side treatment has prior support. This is a semantic inference from end/start reading roles, not a new national “closing_point” field. |
| Delivery period and observations | §3.6.18 pp48–49, core text p48: period if more than one observation, readings/energy in contiguous groups, chronological per register, no repeated identical reading/date, no resolution for reading-only E30; single corrected reading allowed | §3.6.18 p47: same core rules | **Unchanged.** Keep canonical observation validation; do not infer period solely from convenient expected inventory. |
| Change explanation | Prior Appendix 2 already contains comparisons | §1.8 p7, revision25-A-4: adds comment that meter/register checks use received structure; says masterdata terminology was generally changed/complemented | **Terminology/explicit provenance clarification, not evidence for disabling prior E61/E62 altogether.** |

The current guide also changes energy-volume validation and removes E19, but those changes are outside this scoped amendment and must retain their date-specific policies.

## Concrete current implementation gap

`lib/ediel/rulebook/utilts25A4.ts` sets `UTILTS_25_A_3_POLICY.validateMeterAndRegisterAgainstStructuralInformation=false` for reference dates 2025-06-01 through 2026-09-30 and true from 2026-10-01. `lib/ediel/utilts/qualifyReceivedStructure.ts` checks that flag before acquiring a source snapshot or classifying accepted E30/E66/S07 transactions.

Consequently, a pre-October **policy reference date** returns the original runtime unchanged with qualification status `not_applicable`: this owner performs neither E61/E62 comparison nor its `internal_review`/no-response hold when comparison evidence is missing. This is a concrete missing qualification for prior-applicable transactions, not proof that every such transaction is ultimately acknowledged elsewhere. The policy date must not be confused with the meter-reading date, source knowledge cutoff, or ledger start. No alternative general E61/E62 source-comparison owner was found in the bounded code search.

`structuralComparison.ts` and `structuralSourceSelection.ts` already separate observed values from expected PRODAT structure and distinguish an interval from a current/closing point. The recovered clauses do not require another historical structure engine. They do require that the existing genuine-evidence qualification path be applicable to the prior window instead of unconditionally skipped.

## Minimal source-backed amendment and test oracle

An explicit scoped source amendment plus source review can qualify these particular prior rules now; the mere fact that the recovered source is English is not an external-permission blocker. Record the exact prior PDF/hash and body clauses in the established source/manifest process (including existing UE identity/precedence conventions), state the prior effective window, and change only the prior meter/register-comparison capability to run the existing owner. Do not use this to certify the whole A3 profile or toggle unrelated energy checks. The current policy’s source annotation referring only to §1.8 should be supplemented by the actual Appendix2/§3.6.8/point-reading clauses for this capability.

Concrete acceptance oracles for that bounded implementation:

1. With policy reference date **2026-09-30**, a genuine post-ledger committed Z04 root and separately reviewed/witnessed applicable structure must produce `matched` for exact meter plus complete registers; wrong observed meter produces only E61; wrong/missing/excess complete register membership produces E62. Repeat at **2026-10-01** to prove no accidental inversion at the policy boundary.
2. The same prior-window applicable transaction with missing original, missing genuine root, unwitnessed/latest-unavailable assessment or incomplete readset must become the existing internal-review/no-national-error hold. Never synthesize a 2025 historical owner to obtain a green result. A 2025/other pre-ledger delivery interval remains unavailable even though the guide is applicable.
3. At a witnessed structure transition, prior-window E30 **E24/E77/E20** singleton reading uses the pre-transition/closing side; E25/E67 uses the new/current side. Preserve original start and cutoff semantics. Unknown point-side or unqualified transition remains hold; the source comparison does not newly authorize closure/cancellation owners.
4. Multiple readings of one register still count as one expected register; energy observations add none. Prior hourly/15-minute energy-only transactions without meter/register observations retain the documented exemption. Canonical restrictions on single versus multiple observations remain required before the comparator can be used.
5. Verify independently that genuine source-unavailability produces no positive ACK/quantity path and that genuine proven E61/E62 mismatch produces the existing national mismatch result. Retain immutable saved-cutoff/finalized-retry behavior; changing policy applicability must not rewrite committed historical results.

These are proposed test oracles only; I ran no tests and changed no implementation.

## Remaining qualification, narrowly stated

The missing prior policy qualification is implementable with recovered source evidence and the existing genuine Z04/history owner. Registering and reviewing the scoped source amendment, activating this capability, and proving the above real-source runtime/native cases remain work. Authentic missing pre-ledger originals or historical owner evidence remains missing data, not a reason to invent an anchor. No finding here establishes whole G01 readiness, resolves the frozen current footer discrepancy, or qualifies unrelated guide revisions/rules.

## Addendum — DTM735 offset mutation and retry-binding oracle

**Finding:** `+0200` is not a Swedish summertime alternative to `+0100` under these guides. It is also not universally forbidden: the validation appendix explicitly allows another offset for messages from another time zone/country. A test must identify which claim it is proving.

Exact scope and sources:

- Prior English §3.6.1 p36 and current Swedish §3.6.1 p35 require Swedish standard time, UTC+1, throughout the year for reporting within Ediel in Sweden. Swedish daylight-saving time does not authorize a Swedish domestic `+0200` message.
- Prior header DTM segment notes p75 and current Swedish header DTM notes p73 define qualifier735, **field206**, as the offset for all dates/times in the message, with one offset per message. Format406 is signed ZHHMM; plus must be released under the default EDIFACT separators. Both state that Sweden uses `+0100`.
- Prior Appendix1 field206 row p127 explicitly says `+0100` applies for the same time zone as Sweden and a UTILTS message from another time zone should state the corresponding offset. Current Swedish Appendix1 field206 row p122 explicitly allows a different offset in messages from other countries. These are contextual exceptions, not a blanket permission for domestic Swedish DST offsets. The English “other time zone” and Swedish “other countries” wording should retain its scope; neither makes current parser acceptance alone authoritative.

The existing `__tests__/ediel-e66-monthly-billing-resolution.test.ts` genuinely demonstrates **current runtime behavior**: its `DTM+735:?+0200:406` fixture is classified accepted for reference date2026-08-31, preserves `edifactTimezoneOffset:'+0200'`, and normalizes local July boundaries to `2026-06-30T22:00:00Z` / `2026-07-31T22:00:00Z`. That is not proof that the fixture establishes an eligible foreign-origin context or is nationally conformant as a domestic Swedish message. I did not run or modify it.

For the proposed retry-binding test, changing `+0200` to `+0100` while keeping the same local timestamps changes the interpreted instants by one hour. This is a valid **normalization/retry-binding mutation oracle against the runtime’s currently accepted input surface**: a different source interpretation must not inherit the first finalized result merely because other normalized values/IDs coincide. Label it explicitly as that regression surface; do not describe both forms as nationally valid Swedish market originals.

If the proof requires two nationally conformant domestic Swedish originals, keep `DTM735=+0100` in both and mutate a supported own observation/period timestamp (consistently preserving canonical transaction constraints). The same binding invariant can then be proved without relying on the offset exception. Alternatively, a normative non-Swedish-offset test needs an independently established applicable foreign-origin context; the number `+0200` itself does not establish one.

No broad timezone rewrite follows from this finding. Preserve the old runtime regression, keep source-conformance and retry-integrity claims distinct, and avoid treating either generic parser range acceptance or a previous accepted fixture as the national test oracle.
