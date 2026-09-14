# Current state — database reconstruction, 2026-09-14

Status: PARTIAL. Main/release and plan points85/86 are NOT accepted.
Active work: correct and qualify ordinal27's native transaction/locking boundary.

## Verified native progress

Published code30e5404ceeb73313e41dc906d7a8f415632f4813 fixes exact CLI comment-tail
verification and safe PrefixError diagnostics. Its complete tree
07cf86ee69718b605fc4563fce9c809b9e7fecdf matches the reviewed local tree.
The saved first43 patch was already published in1250a544/59313510; logging setup
was subsequently corrected through b3c371c. Do not reapply the old local ZIP.

Ordinary OPS34855261138/job104013056268/artifact10353410024 genuinely verifies
foundation inputs1 through26 using CLI2.101.0 and native Supabase PG17.6.1.106.
Original source hashes, exact programs and actual ledger statements pass for
those26. Cleanup, private historical-input disposal and workspace removal pass.
The synthetic CLI ledger/idempotence/failure rollback also passes. Local67
regression tests,601 immutable migrations and330 tamper variants pass separately.
No offline fixture is counted as native execution.

## Exact next blocker

Ordinal27: migrations/20260909120000_canonical_role_permission_uniqueness_reconstruction.sql.
Native failure NATIVE_HISTORICAL_SQL_FAILED / SQLSTATE25P01. Its derived program
removes the exact outer BEGIN/COMMIT but retains a top-level LOCK TABLE. The
implicit CLI batch does not supply the explicit transaction context this lock
requires. Preserve locking, local timeouts and atomic SQL-plus-ledger behavior;
qualify a corrected execution boundary before admitting it. This fix is NOT
implemented yet. The failed unit leaves the genuine prior ledger unchanged.

The first43 ledger is NOT verified;26 is the executed/verified boundary. Full
native144 foundation/514 timestamp replay, later atomic envelopes, full schema
parity, auth-email tests, generated types and mandatory OPS/E2E remain blocked.
Retain NATIVE_LATER_ENVELOPES_AND_FULL_ACCEPTANCE_REQUIRED even after first43.
Evidence: quality/audits/DB_NATIVE_LEDGER_TAIL_2026-09-14.md.

## Preserved scope

No hosted database mutation, reset, fabricated applied ledger, rewritten
original migration, expected schema/type baseline change, deployment or main
merge. Main remains eb9a25bc989c6de808903f41c2314d5465e9c07b at inspection.
Seven real company fields/white-label FK and existing application/API work,
including quality/paused/2026-09-12-partner-price-wip.patch, are preserved.
Prior read-only hosted ledger279/latest20260904222450 is historical evidence,
not a fresh hosted inspection. Qualified Ediel detach remains unapplied live.
Earlier bootstrap/schema and Ediel details remain in
quality/audits/DB_NATIVE_BOOTSTRAP_RECEIPT_2026-09-14.md and
quality/audits/DB_EDIEL_FORWARD_2026-09-14.md.

## Machine-checked continuity contract

Working-tree accounting is 601 inputs: 589 `FULL_FILE_SELECTED`, 2 `SUBSTITUTED`, 5 `UNCLASSIFIED`, and 5 `EXPLICITLY_EXCLUDED`.

The focused group contains 347 inputs: 335 selected, 2 substituted, 5 unclassified, and 5 excluded.

No production mutation has been performed in this replay-verification batch.
Push reviewed, coherent batches stepwise as requested.
