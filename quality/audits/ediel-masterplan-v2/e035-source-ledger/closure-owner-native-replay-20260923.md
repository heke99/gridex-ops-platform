# Closure owner native qualification — in progress

## First actual owner replay: failed, not accepted

Exact candidate `2b4293b42732b0231dc00d5e43ceefe260cb4254`, tree `403087f3d4e57f21d3b13817ec85f0f1d7802dcf`.
[OPS run35858473977](https://github.com/heke99/gridex-ops-platform/actions/runs/35858473977), native job107172575044.

The new forward `20260923114703_ediel_reviewed_closure_source.sql` applied, and 54 retained native tests passed (17 source-owner and37 private wire). All seven new closure-owner tests failed before establishing their promised lifecycle proof:

- Six hit the actual legacy production `createReviewCase` writer: it inserts nonexistent `customer_cases.customer_site_id` instead of `site_id`. Investigation also found its closure case type `final_metering_and_billing` is excluded by the real CHECK constraint. This is a production integration defect exposed by native tests, not merely a fixture typo.
- The attempted unwitnessed later Z04 review failed at native test line550 with SQLSTATE23514 `source_object_owner_snapshot_changed`, before the closure case.

The final test reused stale reviewed facts after their own baseline advanced, so its SQL rejection is correct; it must obtain a fresh real review and prevent only the separate witness. The production writer needs a narrow schema-correct repair preserving review intent, title and next action; the CHECK and proof guards stay intact. No assertion or production proof guard may be weakened to manufacture green. Original implementer is assigned scoped fix round1; published migrations remain immutable.

The job stopped before typegen/schema capture. Artifact10748931154 contains only the replay log (archive digest reported by GitHub: `f98e3e3e1278d8ebd7c1fffb500c7454d837a258106ba277d6a20e43384f440c`); it cannot supply a schema/type reconciliation. Separate verify job107172575083 failed the expected stale migration-tail manifest guard. This is a genuinely failed native qualification, not merely stale generated artifacts.

Independent code review found no blocking code issue for the bounded implementation, but explicitly reserved native verification acceptance. Local5902/359 coverage results and the prior fully green private-parser checkpoint `f670fbc3` do not replace these failed actual owner tests. Full closure/E035/masterplan acceptance remains open. Main and paused PR310 are unchanged.
