# Actual native parity engine qualification

Status: IMPLEMENTED_NOT_VERIFIED against native PostgreSQL. Production comparator
code remains unchanged. This adds an executable prerequisite, not another schema
status wrapper or acceptance override.

Confirmed missing execution: after owned lifecycle disposal, the old workflow
still calls `db:parity:selftest` against localhost 54322. The native final SQL
checks do not exercise that production comparison engine. Native snapshots do
already capture owners, default ACLs and event triggers, and contain mutation
detection controls; this preservation coverage must not be confused with an
independent source-backed approval of their final values. The dump comparison
explicitly excludes ownership because its reference was emitted with no-owner.

Implementation retains exact hashes of the existing shell selftest, production
JS comparator, introspection SQL and shared schema document validator. Its two
original SQL heredocs and enum mutation execute in two empty owned native clones.
Actual captured catalog JSON is supplied through a private psql subprocess seam
to the unchanged production JS engine, matching the approach already used in
the repository's catalog semantics test. No comparator function is copied or
replaced. No external SQL connection is possible through that seam: it accepts
only the two fixed fixture URLs and exact introspection arguments.

Identical native catalogs must exit zero; injected native SQL drift must exit
one and contain every one of the original twenty finding strings. Invalid
metadata exit two does not count as successful drift detection. Both owned clones
are disposed, including attempted disposal of the second if the first drop fails.
Parent catalog, rows, provider events and actual ledger must remain unchanged.
Only then does a source-pinned receipt become available. That receipt is now
required before application candidate generation.

The runtime invokes qualification after the post-cleanup schema comparison and
before candidate generation. Common chain admission stays separate from the
candidate-only parity gate to avoid a circular prerequisite. Candidate admission
also binds the newly added five changed-view witness to the same second schema
comparison.

Fresh local checks:

- `python3 -B scripts/test-canonical-native-parity-engine.py`: 6 PASS.
- `python3 -B scripts/test-canonical-native-application-typegen.py`: 8 PASS.
- `python3 -B scripts/canonical-native-supabase-lifecycle-selftest.py`: 15 PASS.
- `git diff --check`: PASS.

Coverage includes real unchanged Node comparator execution for equal catalogs,
grant-option drift and missing schema section; all-twenty-expectation enforcement,
source hash rejection, parent preservation, clone failure cleanup and actual
combined parity-before-candidate function ordering without a preexisting receipt.
No actual PostgreSQL execution is claimed from mocked native target tests.

Acceptance still requires: actual complete native qualification, reviewed exact
schema dispositions/source evidence (including final values outside no-owner
reference coverage), genuine candidate bytes and a manifest bound to the approved
migration inventory, committed byte equality and final-head CI. No schema
reference or generated-types manifest was changed. The ordinary wrapper remains
fail-closed. Root integrates the new selftest into the ordinary native CI job.
