# Bounded Z05C cancellation design

Read-only extension of closure-design.md including mandatory section3A. No code or acceptance change. Scope only: one genuine received Z05C retracting one previously qualified Z05L/LK closure of the same post-ledger supply. No general market replacement engine, changed-start, agency89, delegation, multi-message or pre-ledger extension.

## Verified source and actual owner

Directly re-read frozen P text: p123 field226 requires Z0xC/Z1xC LI to equal the corresponding original being cancelled. P14 distinguishes subtype in CCI/CAV from BGM function, and recommends ordering originals before cancellations. P42 (BGM table; page locator retained from frozen source) defines function9 original and5 replacement; it does not identify a predecessor. P50 requires DTM93 field211 in Z05, precise format203. Registry prodatSubtypeRegistry permits Z24/C in Z05. Therefore C and BGM5 are separate axes; BGM5 is not how cancellation is recognized, and matching LI alone is not globally unique source identity. No prior Z08 is required.

Legacy `continueSupplyPeriodFromZ05C` reads only latest three periods by start for company/customer/point. If any apparently active row exists it returns changed=false/review=false; otherwise it matches mutable payload calendar-date fallbacks (or any ended row if date missing), reopens exactly one candidate, sets status active/end_date null/source_message_id=C. It does not validate original LI, exact DTM93, original closure identity, ledger witnesses or namespace. `supply_continuation_confirmed` then records the result. This function is an operational owner, not sufficient cancellation evidence. In particular the active-row no-op must never mint acceptance or establish source attribution.

## Minimal reviewed cancellation owner

Add separate closed marker `reviewed-received-closure-cancellation-v1` in existing object assessment/witness storage, with businessDisposition reviewed and explicit reviewStatement `original_supply_closure_cancellation`. It conveys only cancellation of a named closure edge. No inventory, new start, new period or automatic activation is inferred.

Require current genuine canonical acceptance, physical membership, authenticated company reviewer, live legal/facility owners and SQL checks retained from closure design. Require immutable, witnessed accepted target closure marker as-of saved review snapshot, with its real committed Z04 root and reviewed coverage ancestor intact. Link:

`cancels:{sourceMessageId,payloadHash,assessmentId,factsHash}`

Also store immutable baseline/coverage references and same customer/point/site/switch/supply identities, original cancellation wire, reviewer/time/snapshot and explicit `restoration:'remove_named_closure_only'`. Distinguish a cancellation edge from an assessment revision and from BGM5 source replacement. Target source must differ from C source and have L/LK reason, not another cancellation.

Minimal wire support: Z05, subtypeC/reasonZ24, BGM9 or omitted, exact original LI, exact original DTM93, same complete object/agency/FR/DO and direct transport policy. Require exact equality between cancellation DTM93 and target closure DTM93. This equality is a bounded safe-support rule, **not a claim P123 alone mandates timestamp equality**. A changed date cannot safely identify the intended exact stop in this slice and remains held pending a separately evidenced correction process. Cancellation document ID must differ from target original ID. The explicitly selected target must be the sole eligible matching closure; reviewer UUID input cannot override ambiguity.

Target and cancellation must share immutable coverage/supply and exact tenant/environment/customer graph binding. Fresh bounded exact-count reads check all potentially conflicting same-point/customer supply periods, not the legacy limit3 window. A conflicting current active interval or another unmatched closure prevents acceptance. No newest-created/start-date tie-breaker.

## Retain actual successful reopening without manufacturing it

The simplest review path runs **after** actual legacy reopening and requires current same-ID supply status active, end_date null and source_message_id exactly equal this C original. Require unchanged start/customer/point/source-switch relation and same accepted switch/original Z04/outbound lineage. SQL compares these live facts in its one validation MVCC statement. Immutable target closure proves that this same supply really had the qualified end; do not ask the now-mutated row to prove its former state.

An unrelated already-active row, the legacy changed=false path, a source pointer still at Z04/another C, or a copied successful return cannot meet those conditions. Retry after a successfully witnessed assessment may reuse its historical evidence through the existing idempotent/readset path, but must not invent another new approval from arbitrary active status. If the operational source has advanced to another lifecycle event, immutable evidence remains available for historical cutoffs while new re-review holds pending explicit event-chain support.

A stronger later implementation could capture a one-use genuine before/after reopening handoff and atomic lifecycle write; it is not necessary to create an honest explicit-review owner with these exact checks. Do not silently harden or broaden legacy lifecycle selection as part of the bounded evidence slice without a separately tested finding/fix.

## Bitemporal selection: remove one edge only when known

Never modify/delete target closure assessment or original baseline. Keep close and cancel evidence append-only with separate witnessed availability. Selection first builds the normal baseline and structural-change inventory chain; then computes effective closure edges visible at the requested immutable knowledge cutoff.

- Before C source receipt/assessment witness is visible: previously qualified target closure still bounds coverage. A later C cannot change an already saved earlier decision, final ACK or persisted quantity.
- C received but unreviewed/rejected/unwitnessed: preserve it as scoped unresolved cancellation, holding affected object/party intervals from the target stop boundary onward; never reopen. Earlier pre-stop interval remains unaffected.
- C fully witnessed by cutoff: mark only the explicitly named target closure inactive for this projection, restoring its *prior immutable coverage bound* (often null, possibly an earlier known bound). Do not assign validFrom=C receipt, do not replace original start, and do not remove another closure. A new cutoff may legitimately assess a past period differently; the old persisted receipt must remain unchanged and existing committed-retry guard must reject changed finalized outcomes.
- Apply every remaining qualified structural change and every remaining closure under ordinary effective-time rules. No resetting meter/register state to the initial Z04. A Z06/Z10 effective after the original closure is not ignored because reopening exists: it must have its own valid owner/coverage or cause a hold.
- If existing review owner cannot qualify such a post-closure change due to status active or source=C, record that as implementation work for lifecycle-aware coverage requalification. Do not bypass current review SQL. The cancellation slice can succeed only on intervals already fully evidenced by the retained complete source universe; it is not permission to infer a missing interval inventory.
- A later closure of the same supply is still effective. Multiple C sources for one target, cancellation cycles, conflicting active endings or unknown replacement chains are unresolved in this slice; no receipt/UUID ordering.

At exact target stop, the existing closing/current-point distinction remains. Once named close is genuinely cancelled, the boundary loses its closure effect, but an independent meter transition at that same instant still selects its correct side. Unknown/unapproved C remains conservative at exact stop. For pending C with a known target, affected lower bound is target stop; if target cannot be identified, use earliest plausible matching closure stop, or whole matching object interval when no lower bound can be proved. Unknown object remains global hold, known object with missing party/date is a wildcard-scoped hold. C must never be added to an ignored-source list.

## BGM5, changed date and ordering

A Z05/Z24 with BGM5 is a replacement of a cancellation message as well as a cancellation subtype; supporting its predecessor/reversal consequences needs a separately specified correction graph. This slice holds it. Do not treat BGM5 as permission to remove a matching closure.

A BGM5 correction to the target closure, especially moving the stop later, can invalidate the old cancellation link. Until an explicit qualified replacement edge and cancellation applicability are known, hold from the earliest possibly affected stop, not just the proposed new date. A newer unwitnessed target assessment blocks fallback to an earlier accepted target. A later accepted correction of the cancellation itself must not be represented by silently retargeting an old market edge.

C arriving before original closure: retain source and scoped hold. It can be reviewed only after the exact target closure and its real closure owner/witness exist; never synthesize the missing original, acknowledge business completion from LI alone, or reopen the latest ended period. P14 ordering recommendation supports preserving order, but does not authorize deleting out-of-order messages.

## SQL original binding and append contract

Reuse section3A's bounded UNA/release-aware SQL lexer. Extend only the closure projection mode to recognize Z24/C. SQL reads sealed cancellation `sources.raw_payload`, reconstructs BGM/document/function, header parties/zone, physical LIN geometry, own DTM93, CCI/CAVZ24 and own RFFLI. Compare exact marker wire; no caller-provided hash/token cache can replace this step.

Independently read and parse the **target sealed original** as L/LK using the same helper, even though its previous assessment was valid. Compare original LI, exact original stop, object and parties between these two database-owned projections. Validate target source ID/hash, latest accepted assessment/factsHash/witness/snapshot membership, root/coverage chain, and absence of competing supported target candidate or unresolved matching replacement. Date projection equality is insufficient: same-day minute mutation must be rejected by original-byte binding.

New private `review_closure_cancellation_proof_consistent` validates permissions, company state, exact source/target snapshots, immutable references, live restored supply graph and all temporal predicates in the append owner SELECT. Add an explicit fourth owner CASE branch and narrowly named bypass of the Z04-only current-source join. Retain canonical accepted/all-object validation, generic party owner_rows_match, source locks, serial assessment predecessor and separate committed witness. Reject direct unauthenticated/private-helper execution using existing grant patterns. Do not alter existing helpers' accepted shapes or make arbitrary owner strings bypass checks.

The snapshot must contain both target closure evidence and C original. Availability must be <=snapshot cutoff<=assessedAt; append must not accept a latest target revision absent from snapshot. Normal source received/owner clock bounds remain. Native concurrent revision tests must show an intervening target assessment cannot be silently replaced by fallback.

## TS and targeted verification

Add cancellation wire/marker and review owner (may share safe primitives with closure); extend timeline accepted-marker validation, readset cancellation edge/scoped-blocker projection and coverage-edge selection. Thread diagnostics containing target closure and cancellation provenance through UTILTS qualification. No expected registers from UTILTS itself. No market send, ACK generation or quantity mutation occurs in the review action.

Required red/green native cases use real canonical originals, committed Z04 root, reviewed baseline, actual closure write/qualified closure/witness, actual legacy reopening, fresh authenticated C review and witness:

1. Exact LI/date/object/parties cancels named close, no Z08, same supply ID and immutable original start; no new period.
2. Earlier cutoff still closed; receipt-before-witness cutoff held; later witness projects restoration; previously saved result/finalized ACK/quantities remain immutable.
3. Changed LI, changed same-day minute plus consistent UTC, wrong target hash/assessment/source, document/function/reason mutation and another-LIN values fail SQL append.
4. Legacy active no-op, wrong reopened supply, source attribution not C, cross tenant/environment/reviewer, ambiguous histories beyond third row and changed party owner rows fail.
5. BGM5/C, changed end, C-before-original, duplicate C, target correction, later unwitnessed target revision, cancellation cycle and target not L/LK remain holds.
6. Intervening qualified Z06/Z10 remains selected after restoration; unqualified applicable changes hold; independent later closure still closes; unaffected object/pre-stop query succeeds.
7. Retain release/custom-UNA original-binding fixtures, microsecond availability, boundary sides, real E61/E62-only-on-proven-mismatch and all existing retry tests.

Forward migration via actual CLI; native schema/type artifacts and ordinary replay wiring; final exact-head CI and independent review remain required. Unit JSON mocks cannot establish this lifecycle owner.

## Genuine missing evidence versus engineering

All storage, parser, exact-count, marker, lineage and timeline work above is implementable. A legacy reopened row without a previously qualified closure/root is missing historical qualification; it is not a need for another user permission. Authentic retained originals/committed lineage may support later bounded requalification. If the original/closure or its history was never retained, no code or approval can manufacture it. Nonmatching date/LI, BGM5 ambiguity and bilateral target types require actual correction/process evidence before expansion; this design does not reinterpret the source to accept them. No broader E035/masterplan completion is claimed.

Reviewer clarification accepted: remove only the named closure edge; restore exactly the previously stored coverage bound, including an identical prior validTo if present. Never compute a new prior boundary.

## Later source amendment — prior design approval limited

Recovered official Handbok26A and `handbook-lifecycle-design-addendum.md` reveal missing lawful process-basis ownership. The prior design-level concurrence does NOT authorize activating positive C acceptance from target lineage plus an active legacy row alone. A separate evidence-backed process-basis design must be independently reviewed and implemented first; currently under design. Preserve all original target/original-wire/witness/coverage constraints. Corrected new closure is a separate original/case; do not retarget the cancelled edge. See `handbook-source-scope-20260923.md`. No positive C owner is active.
