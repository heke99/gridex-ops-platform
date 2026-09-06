# Customer-flow original source restoration

The active source-accounting remediation uses systematic debugging, TDD,
Supabase and verification-before-completion. No runtime UI, API, production
writes, historical SQL/checksum rewrites or generated canonical changes.

The complete 917-byte source 20260528_batch_1_completion_customer_flow.sql
contains only additive column/index DDL. Its narrow route-decision bootstrap
omits five customer_sites supplier response/contract fields. customer_info_requests
received_at and blocker_reason are already present in the earlier onboarding
bootstrap; the source safely preserves them. No DML, function calls, policies,
role assignment or tenant backfill occurs in this source.

Because the file is pre-ledger (eight-digit date), preserveSourceReplay alone
cannot put it into fourteen-digit timestamp selection. It is explicitly added
to both foundation declarations/order after the route-decision prerequisite.
The customer_sites table originates in 01_db1 schema foundation; requests in
20260520_onboarding_billing_auxiliary_foundation. Both precede the selected file.

The isolated PGlite 0.3.14 test uses actual predecessor table definitions and the
actual facility normalization function, plus synthetic company/customer parents.
The entire source executes twice. Checks cover five field types/nullability,
preserved existing supplier values, unchanged request rows and the route index.
The source-selection assertion failed SUBSTITUTED before the manifest change
and passes FULL_FILE_SELECTED at foundation stage after it. Prerequisite ordering
is also asserted. The test is added to hosted isolated SQL verification.

Local SQL, source selection, 29 accounting tests, migration integrity and static
provenance pass. Hosted verification of this batch remains pending publication.
Accounting: 499 complete files selected, 29 unresolved substitutions, 55 unknown,
4 exclusions, 587 total. Selection is not SQL execution or surviving effect proof.
The global full-effects gate still fails; no phase is closed. Full authoritative
canonical replay, generated schema/types, ledger and live parity remain required.
