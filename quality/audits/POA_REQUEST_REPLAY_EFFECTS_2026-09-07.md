# POA/request source effects

Status: IN_PROGRESS; full replay and production parity remain unverified.

Skill routing continues systematic-debugging, test-driven-development, Supabase
and verification-before-completion for historical migration accounting. No UI,
performance optimization or broad security audit is part of this bounded change.

Source: 20260526_batch_3c_3d_fullmakt_data_requests.sql, unchanged.
The existing selector omits this source. It expands request statuses to 24, adds
nullable period dates, POA evidence/revocation/summary fields, and five indexes.
The proposed boundary is after customer_blockers foundation and earlier request
status normalization. No operational DML or grants occur in the source.

The test executes the entire source twice on PostgreSQL17 with pgcrypto.
Prerequisite table definitions are extracted from real historical sources;
blockers foundation and earlier request normalization run whole. Synthetic
parent tables and the preceding auth fixture provide dependencies. This is
a scoped source fixture, not full canonical execution or JWT/RLS E2E proof.

Checks cover 24 valid states and invalid-state rejection, existing rows, PK/FK/
unique constraints and policies, blocker RLS, nullable date columns, exact index
keys/order/predicates. SQL composition passes locally; hosted execution pending.
Selection has not changed.


## POA source restored — 2026-09-07

Complete source twice passed PostgreSQL17 job 101641683544, OPS 34090109671,
revision 9b67081ab7685e1dcc033982d9c7762c812356f4. All 24 status values, exact
index definitions and preserved data/keys/policies passed. The full source is
now selected immediately after customer_blockers foundation. Selection failed
UNCLASSIFIED before restoration, passes after, and rejects reversed prerequisite
order. 29 accounting tests and static provenance pass. Counts: 505 full selected,
28 unresolved substitutions, 50 unclassified, four exclusions. Whole-effects
gate remains red; no phase closed. Next: verify restoration-head PG17 CI, then
continue source accounting; authoritative replay/types/schema and live/ledger
parity remain required. No production writes or artifact hash edits.


## Published POA verification — 2026-09-07

Revision aed588c0c9c40b221eeff5ccf81812736507ab67: job 101642417324,
OPS 34090366696 PASS for selection order and whole POA/auth SQL. Verify fails
generated-types tail; clean replay remains red. Quality job 101642417302 was
still running. PR #310 records exact evidence. No phase closed.

Next active review: auth_email_templates_invite_reset_sync and the unclassified
company_invite_temp_password_sync, direct_temporary_password_auth_sync_fix,
company_delete_backfill_and_admin_layout successors. The template introduces
membership constraints and an event-read policy; later SQL changes event-status
grammar and deletes orphan membership/invitation metadata. Review the combined
prerequisites, final access policy and data semantics before isolated PG17 tests
and source restoration. All four remain UNCLASSIFIED; no external blocker is
established. Full canonical/types/schema/ledger/live parity remains open.
