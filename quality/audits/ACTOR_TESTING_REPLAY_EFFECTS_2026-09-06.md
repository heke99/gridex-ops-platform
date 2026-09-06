# Actor-testing original source restoration

Continues the active systematic debugging, TDD, Supabase and verification
workflow. Full source 20260521_actor_testing_engine_automation.sql was unclassified.
Direct review of all 1,222 bytes confirms only additive columns and five regular
indexes; no DML, role grants, trigger/function definitions or business seeds.

The five columns are already present in the actor-test-results foundation. The
full file additionally defines message-reference, run, case, test-run-message
and Ediel-message lookup indexes. It is now explicitly selected after the three
actor/test-run foundation tables; the Ediel message table is defined earlier in
02_db1 operations foundation. Original SQL and checksum pins are unchanged.

An isolated PGlite 0.3.14 test executes actual predecessor table definitions,
then the complete source twice. It confirms all five indexes were absent in the
fixture, validates ordered index columns and valid/nonunique/nonpartial flags,
and verifies unchanged rows across all four affected tables. The test then
checks actual source selection and prerequisite ordering. Selection was red
UNCLASSIFIED before the fix and green FULL_FILE_SELECTED after. This is scoped
source evidence, not canonical surviving-effects or tenant/provider E2E proof.

Local checks: SQL/idempotency, selection, 29 accounting regressions, static
provenance and 587-file integrity pass. Hosted execution is pending publication.
Accounting is 500 full selected, 29 unresolved substitutions, 54 unclassified,
4 exclusions, 587 total. Full-effects remains failing. No production writes,
manual types hashes or phase closure; canonical/ledger/live parity remains open.
