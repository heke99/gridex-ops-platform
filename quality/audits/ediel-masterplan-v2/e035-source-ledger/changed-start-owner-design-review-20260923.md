# Changed-start owner — independent SPEC / QUALITY review

**SPEC: APPROVE the bounded network-owner Z04LK → Z04C → new Z04LK interpretation.**

**QUALITY: APPROVE revised design for bounded implementation.** CS-1 and CS-2 are resolved by revision2, as recorded below. The initial findings remain for audit history. No implementation, tests, source manifest or masterplan edits.

Read actual SDD `changed-start-owner-design.md`, supplied SHA256 `a40ca9b5a1d7e952ad7e5353d7dbe49e866919b12f1bb0cf16c6e686c57db101`, existing lifecycle/process-basis addenda and focused actual owner paths.

## Source scope

Directly reviewed Handbok26A printed pp87–88 and70, and frozen P p123 earlier in this task stream. Network-owner correction of the wrong move-in date uses Z04C then new Z04LK. A new Z04L/LK answering the original Z03 keeps that request's LI. Supplier cancellation/new request is a different lineage; Z04C withdraws start, unlike Z05 ending a started delivery. The design preserves these distinctions. Future midnight, unchanged customer/point/contract, single-message/direct/agency9 and exclusion of retroactivity are declared support bounds, not universal national restrictions. Same supply UUID is an implementation continuity choice, not a source-mandated identifier rule.

## CS-1 — explicitly close the changed-start process universe

The new typed basis names the original outbound Z03LK and excludes supplier-originated Z03C/newZ03. But it reuses only the *architecture* of the closure process-basis design and never states the required changed-start history readers/coverage that establish this distinction. The closure basis's named outbound Z08H reader is not automatically an outbound Z03C/new-request universe.

A retained original Z03, matching LI/point and a qualified document explaining a wrong move-in date do not prove that the original request has not separately been cancelled/superseded. An implementation could inspect only the selected original and new three-message sequence, overlooking a genuine dispatched supplier Z03C or conflicting request/process history. `matching.ts::findMatchingSupplierSwitchRequest` currently selects by supplied switch ID or newest reference/LI match (`limit(1)`); that path does not provide complete conflict history. The existing received-source capture is inbound-only, so naming its snapshot does not include outbound cancellation originals.

Required amendment: enumerate mandatory retained outbound original Z03LK, matching/potentially matching Z03C and new Z03 request histories with dispatch/process states, inbound original/C/new Z04 histories, and linked contract/customer correction context. Use actual tenant/environment/point/customer/party/initiator-aware LI relationships and complete bounded exact-count reads with retention-coverage start/end, available-at cutoff and explicit missing-history spans. Include partially linked/malformed potentially relevant records as uncertainty; unknown components cannot make a conflict disappear. Failed/truncated/unavailable required readers or relevant missing retention hold this positive branch even with a qualified correction document. A positively established supplier-cancel/new-request branch is not this owner. Finite database completeness is not universal real-world completeness.

Test qualified positive document plus actual conflicting outbound Z03C/newZ03; positive document plus failed/missing outbound history reader; unrelated point history remaining unaffected. Implement missing captures/readers with genuine synthetic fixtures rather than inventing a successful completeness receipt.

## CS-2 — durable pending guard before basis/withdrawal qualification

The design correctly says a raw cancellation observed before basis/replacement must become a scoped coverage blocker, and says cancellation holds prevent scheduler activation. However, its only concrete durable operational lifecycle-block write is inside Operation1, which requires the qualified basis/old root and performs `start_withdrawn`. The transition table has only withdrawn/confirmed phases. A raw unresolved Z04C can therefore exist while no transition or lifecycle block yet exists.

This is a real activation seam: `gridex_finalize_supplier_switch_activation` currently accepts an accepted request with an inbound parent Z04 and no `lifecycle_blocked`; the sweep selects accepted requests whose original effective date has arrived. It does not consult the source readset's pending-C blocker. The generic cancellation branch in `inboundBusinessStateMachineLegacy.ts` instead immediately changes switch status/source in separate writes, leaving the supply untouched. Neither behavior supplies the proposed safe interim state.

Required amendment: specify an independently durable **pending start-withdrawal guard**, separate from positive basis/transition authority, established as part of source intake/correlation before a potentially relevant C can await review while ordinary activation proceeds. It may be a source-derived pending-event registry or an activation-time authoritative source check; it must cover the exact same switch/period and serialize with activation under the same locking boundary. Unknown but potentially applicable linkage must block at a safe bounded point scope rather than choose a latest switch. Source capture/guard failure must prevent the supported processing path from claiming complete safe readiness. An in-memory callback or eventual readset classification is insufficient.

The guard cannot claim lawful cancellation or mutate the supply start/end. It blocks positive activation only, persists for rejected/unwitnessed/incomplete basis states, and is cleared only by the qualified transition/resolution that addresses that particular source concern. Both direct activation RPC and scheduled activation must honor it; no generic Z04C write before qualification. Separate this operational safety fact from later witnessed comparison authority. If activation already won the serialized race, retain the raw concern but hold the correction as outside this pre-start slice; never backdate success.

Add an actual intake→missing-basis→old-date scheduler/direct-RPC test, and a concurrent raw-C capture/activation test, in addition to the existing qualified-operation race. Verify no activation before human basis review, no false positive withdrawal owner, and no source-only guard for an unrelated point. This closes the gap without adding a third positive lifecycle phase or broadening the owner.

## Sound aspects retained

- The actual legacy C branch only changes switch status/source. The accepted Z04 branch uses `ensureSupplyPeriodFromSwitch`, whose covering-period search can retain the wrong start or insert another period. Replacing those writes with two scoped atomic transactions is justified.
- Same supply UUID, preserved original root, a dedicated non-delivering state and complete consumer qualification avoid masquerading as a Z05 end or erasing history. Every relevant activation/billing readiness consumer must understand the state; the design already makes that an activation prerequisite.
- A new commit owner referencing an immutable withdrawal and authentic basis is preferable to weakening v1 start/live equalities. `reviewReceivedStructuralSource.ts::resolveCoverage` currently relies on original source/start equality, so the explicit descendant lineage is necessary.
- Independent SQL parsing of actual original Z03/old Z04/C/new Z04 avoids borrowing caller LI/dates or treating field210 as automatically required on C. Exact source-binding mutations remain useful separately from midnight support checks.
- Requiring both old/new dates future and no activation/billing consequence keeps the two-transaction correction bounded. Atomic conflicts, rollback, idempotency, actual commit capability and separate witnesses are appropriately specified.
- After withdrawal the old root supplies no positive interval; after reconfirmation only the new root/inventory can cover its interval. Old Z06/Z10 cannot be silently reparented, other endings remain bound, and finalized quantities/ACKs and saved cutoffs stay immutable.
- The documentary basis is honestly described as a qualified human interpretation of immutable, independently sourced evidence. It does not claim SQL proves natural-language truth or that an EDIFACT party ID authenticates correspondence.

## Gate

Amend CS-1 and CS-2, then rerun a scoped design review. No other concrete blocking source/design defect is asserted. This does not block the independent closure native diagnostics or certify whole changed-start/E035 readiness.


## Revision2 scoped rereview — CS-1 / CS-2 resolved

Read actual revision2, 30,760 bytes, SHA256 `2a4f47eb11e8edce1ec97d364e7e2a3127ac72f085cd34df8b820fc947794828`. Scope: the requested amendments and any newly introduced breakage only.

**SPEC: APPROVE. QUALITY: APPROVE the revised bounded design.** No new blocking defect identified.

CS-1 now specifies its own required history universe: original outbound Z03LK; potentially corresponding outbound Z03C and different-LI new requests with actual/uncertain dispatch states; inbound Z04/C/new originals; and linked initiator/customer/contract/process history. Closed reader receipts identify exact count, cutoff, retention coverage and missing spans. The design explicitly rejects an inbound-only snapshot or a positive explanatory document as a replacement for unavailable outbound history. Ambiguous linkage is preserved and both qualified operations require fresh eligible history. The added conflict/failed-reader/retention-gap proofs address the prior authority gap.

CS-2 now provides an actual durable negative-safety owner independent of the positive process basis: a source-bound pending concern captured within the intake commit boundary. It blocks ambiguous affected starts at the known point, with an enclosing unresolved-scope barrier where necessary. Intake, direct activation, scheduled mutation and both transition operations share deterministic locks; activation must read current concerns after acquiring the lock instead of reusing pre-lock state. The required implementation must ensure its transaction isolation really provides that current post-lock visibility; the specified both-order concurrency proof is the acceptance oracle.

The concern persists through missing/rejected/unwitnessed qualification and has no TTL. Source-specific evidence-backed resolution, or an atomic transfer to the qualified withdrawn state, is required; one resolution does not clear another concern. Guard/capture failure cannot publish a successfully safe unguarded intake. If activation won first, the correction is held outside the pre-start slice rather than retroactively fabricated. These changes close the previously unguarded wait for basis review without claiming that the guard is positive cancellation authority or adding a third positive lifecycle phase.

Actual intake→missing-basis→scheduler/both-RPC proofs, race orderings, unrelated-point controls and capture failure checks are now explicit. The revised design preserves the original immutable source/lineage and saved-cutoff/quantity boundaries. Implementation and native results still require independent verification; this is not pre-approval of their correctness or a whole-E035 status change.
