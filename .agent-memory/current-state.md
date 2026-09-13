# Current state

Updated: 2026-09-13.
Status: PARTIAL

## Active task and scope

User authorized publication of all previously local gate changes and continuation
of database blockers using GitHub and Supabase. The GitHub connector now exposes
write actions; the earlier read-only limitation is superseded. This publication
contains the true-only replay gate, source pin, regression suite, CI wiring and
status corrections from the delivered22c923bb patch. Native CI on the new commit
is pending; no main merge or production deployment is accepted yet.

Continue in order: database/types; recorded runtime faults; full RLS/permissions;
native billing; jobs including point86 starvation; paused API; review; release.
No gate is waived.

## Published integration and verification boundaries

Base code:22c923bb59cda3dbf933002b0f05c2b136c99a2f.
Native run34762374742/job103737335752 passed the selected residual continuation
and shared full foundation with original files absent from the repository, plus
owned cleanup. The seven residuals use the shared source-retaining controller.
The historical DB2 operator reconciliation is not executed or certified.
This evidence predates the true-only gate and is not native verification of it.

The previous e42090a8 run34761230264/job103734308670 passed all seven candidates,
144 foundation and513 timestamp stages with bounded role, lock, view, DB2
separation and rollback controls. These are not full caller RLS, ledger provenance,
ordinary Supabase CLI replay or generated-type acceptance.

Working-tree accounting is 600 inputs: 588 `FULL_FILE_SELECTED`, 2 `SUBSTITUTED`, 5 `UNCLASSIFIED`, and 5 `EXPLICITLY_EXCLUDED`.
The focused group contains 346 inputs: 334 selected, 2 substituted, 5 unclassified, and 5 excluded.

## True-only gate publication

The final replay query printed boolean checks but did not reject false or NULL.
The patch preserves all18 SQL predicates and requires one bounded JSON object
with exactly the known keys and each value true. Invalid/missing results and SQL
failures stop progression. The timestamp runner pin is updated to the actual
shell, not to a fabricated schema/type acceptance value. The twelve gate tests
exercise actual bash with a transport double, not PostgreSQL semantics.

The delivered patch report records156 tests plus the complete membership program.
In this publication session, the first eight suites were rerun successfully:
12 gate,20 shell-recovery,11 residual-integration,12 transition,6 DB2,13 timestamp,
9 timestamp-source and19 residual-source tests. Longer membership reruns hit the
local tool limit and are not reported as new passes. Hosted re-verification is
required. The existing membership tests are unchanged; their exact accounting
summary assertions are restored above.

Evidence:quality/audits/DB_REPLAY_TRUE_ONLY_GATE_CANDIDATE_2026-09-13.md.

## Remaining blockers and next action

Review/admit full effects for2 substituted and5 unclassified sources, preserving
source transformation and historical-operator distinctions. Finish supported
ordinary CLI/owned lifecycle and ledger provenance; regenerate and verify schema
and types only from that approved reconstruction. The normal replay still stops
at unsupported mode and type verification rejects tail20260911114443. Do not
refresh manifests to conceal this. Temporary diagnostic cleanup is not yet due.

Supabase projectpiidsfebjqjmnepdpnas is reachable but has no separate development
branch. Treat its default branch as production; do not test reset/replay there.
No production mutation has been performed in this replay-verification batch.
Push reviewed, coherent batches stepwise as requested.
Existing native tests use owned CI
containers. No independent security review or dependency remediation is claimed.

Application baseline52b2de4d81cae370bf250e5a80f12c300bbddd16/tree76e633e2c7189807ae8b7de297a6d2e6e2343234 is preserved.
quality/paused/2026-09-12-partner-price-wip.patch remains unapplied and byte-identical.
No historical SQL, accepted types, schema/type manifests or app/API source changes.
