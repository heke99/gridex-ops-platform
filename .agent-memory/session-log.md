# Session evidence log

Earlier entries are preserved byte-for-byte in [the pre-database-frontier archive](archive/pre-db-frontier-20260912/session-log.md). Current campaign status is only in [current-state.md](current-state.md).

## 2026-09-12 — database-first continuation of PR310

The user selected database/types -> two runtime faults -> full RLS -> billing transactions -> jobs/point86 -> paused API -> final review/merge/deploy. The earlier publication-only next action is superseded. Completed API work and the unapplied candidate remain intact.

Recovered the exact source tree from the hosted artifact, extended the pinned118-input foundation through508 timestamp/interleaved inputs, and published1ba0f7b. Native run34714610111 reached timestamp45 and identified missing PostGIS. Added a closed PostGIS profile retaining existing owned-target isolation and privacy; publishedeacc6d4 after21 targeted local tests and exact-tree verification.

Native run34715245340/job103611207798 verified the environment fix, passed118+228 inputs, then stopped at historical live-schema sync with42601. Source inspection and the existing forward repair identify invalid intermediate session-guard compilation; this is the next database task, not a completed fix. Accounting remains unchanged with37 unresolved source effects. No types, source-history rewrite, live SQL, main merge or deployment were performed.

Evidence and current state are recorded in DB_SELECTED_CHAIN_FRONTIER_2026-09-12.md and DB_SELECTED_CHAIN_RECEIPT_2026-09-12.json. Large prior evidence logs were moved without byte changes into archive/pre-db-frontier-20260912 and remain directly linked; no historical evidence was discarded.
