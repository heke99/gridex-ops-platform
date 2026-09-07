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
