# Canonical company selection on operational pages

The read-only audit found four pages that authorized the canonical guard context but then selected another company with the legacy operational membership helper. A guard for company A could therefore drive reads from legacy membership B.

Changed only the four handed-off pages: customer intake, work queue, facility requests, and customer operation events. All now resolve the shared canonical admin scope. Work/facility queues retain authorized platform-wide reads. Intake and events retain the guard's explicitly selected company even in platform mode and prompt for a selection when it is absent. Tenant contexts without a canonical company fail closed.

The intake offer, supplier and go-live reads share that selected company. Work queue native queries and facility joined/fallback reads use the same authorized tenant filter. An unrelated legacy company's name is not shown as the active workspace.

Verification: the new actual-page suite reproduced **12 failures / 2 passes** before the source changes, then passed **14 / 14** after them. Four targeted suites passed **39 tests**, including shared scope, dashboard scope and existing work queue action-visibility regressions. Only the latter's boundary mock was adapted to the shared resolver; its visibility criteria remain unchanged. ESLint and diff checks passed. No live writes.
