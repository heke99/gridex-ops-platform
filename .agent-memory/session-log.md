# Session evidence log

Earlier entries are preserved byte-for-byte in [the pre-database-frontier archive](archive/pre-db-frontier-20260912/session-log.md). Current campaign status is only in [current-state.md](current-state.md).

## 2026-09-12 — database-first continuation of PR310

The user selected database/types -> two runtime faults -> full RLS -> billing transactions -> jobs/point86 -> paused API -> final review/merge/deploy. The earlier publication-only next action is superseded. Completed API work and the unapplied candidate remain intact.

Recovered the exact source tree from the hosted artifact, extended the pinned118-input foundation through508 timestamp/interleaved inputs, and published1ba0f7b. Native run34714610111 reached timestamp45 and identified missing PostGIS. Added a closed PostGIS profile retaining existing owned-target isolation and privacy; publishedeacc6d4 after21 targeted local tests and exact-tree verification.

Native run34715245340/job103611207798 verified the environment fix, passed118+228 inputs, then stopped at historical live-schema sync with42601. Source inspection and the existing forward repair identify invalid intermediate session-guard compilation; this is the next database task, not a completed fix. Accounting remains unchanged with37 unresolved source effects. No types, source-history rewrite, live SQL, main merge or deployment were performed.

Evidence and current state are recorded in DB_SELECTED_CHAIN_FRONTIER_2026-09-12.md and DB_SELECTED_CHAIN_RECEIPT_2026-09-12.json. Large prior evidence logs were moved without byte changes into archive/pre-db-frontier-20260912 and remain directly linked; no historical evidence was discarded.

## 2026-09-12 — native session reconstruction completed, source acceptance still open

The user explicitly asked to resolve42601 and verify continuation, not reopen API work. Reconstructed only the invalid session block using the complete pinned forward-repair function. Native admission exposed an incorrect assumed security preimage; the June11 hardening source proved the actual invoker predecessor, now pinned and enforced. The invoker-to-definer transition follows the versioned repair; function OID/owner/ACL and effective execute rights are verified retained.

Published8cacda, temporary diagnosis0b6f328, corrected0bdd572, and cleanup1d40e33 without force. The final shared executor is restored to its original bytes. Both0bdd572 and1d40e33 passed118+508 native stages,35 constructor tests and six boundary proof groups. Final run34718792993/job103620685321 and cleanup completed successfully. Fourteen new tests passed locally. Only individual changed blobs, not a full current local tree, were verified in this session; CI checked out the exact published head.

Current state/checkpoint now supersede the solved timestamp229 blocker and point to the37 unverified source dispositions, reconstruction review, supported canonical CLI integration and then accepted types. The normal clean-replay/type job remains failed. No source-history rewrite, API change, generated types, managed SQL, merge or deployment occurred. Evidence is in DB_SESSION_RECONSTRUCTION_2026-09-12.md and its companion JSON.
