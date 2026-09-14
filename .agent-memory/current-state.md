# Current state — database reconstruction, 2026-09-14

Status: PARTIAL. Main/release and plan points85/86 are NOT accepted.
Active work: verify the corrected first43 historical CLI ledger on native CI.

## Actual published baseline

Saved first43 implementation is published in1250a544/59313510 and wired to the
ordinary OPS clean-migration-replay. Do not reapply the old local ZIP. Logging
role/local connection corrections culminate in b3c371c852be3d1838e093bb7fd5698bbd56063a.
That native run reaches ordinal1 but its ledger verifier rejects the CLI's
retained comment-only EOF fragment. OPS34848295774/artifact10349061715 has zero
verified historical inputs and verified cleanup/private-input disposal.

## Current correction and verification boundary

Require the exact pinned trailing comment at the final ledger position; preserve
all executable-statement, source, private-file and transaction checks. Expose only
finite trusted PrefixError codes instead of hiding them behind the class name.
Local67 tests and601 immutable migrations pass; CLI/database calls are simulated.
New native CI execution is required. Full prefix and full replay are NOT accepted.
Evidence: quality/audits/DB_NATIVE_LEDGER_TAIL_2026-09-14.md.

## Next action and remaining blockers

Read the new ordinary OPS native artifact. Resolve its exact failure, or on
first43 success continue with later atomic envelopes and the full144 foundation/
514 timestamp chain and truthful CLI ledger. First43 alone must retain the
NATIVE_LATER_ENVELOPES_AND_FULL_ACCEPTANCE_REQUIRED stop. Full schema parity,
auth-email source tests, generated types and mandatory OPS/E2E remain open.
Do not waive them or mark a generated ledger as original hosted applied history.

Verified prior baseline:48 Supabase initial privilege checks and synthetic CLI
ledger/idempotence/failed rollback. Corrected portable defaults reduced missing
reference grants7761->24, policies1886->59, constraints38->11; full equality
still fails including added/changed objects. Preserve the original reference,
seven legitimate company fields and white-label FK. Prior details remain in
quality/audits/DB_NATIVE_BOOTSTRAP_RECEIPT_2026-09-14.md and
quality/audits/DB_EDIEL_FORWARD_2026-09-14.md.

Hosted project piidsfebjqjmnepdpnas is unchanged. Prior read-only ledger279 rows,
latest20260904222450; no current inspection is claimed here. Qualified Ediel
customer-only detach remains unapplied live. Existing application/API work and
quality/paused/2026-09-12-partner-price-wip.patch are preserved. No main merge.

## Machine-checked continuity contract

Working-tree accounting is 601 inputs: 589 `FULL_FILE_SELECTED`, 2 `SUBSTITUTED`, 5 `UNCLASSIFIED`, and 5 `EXPLICITLY_EXCLUDED`.

The focused group contains 347 inputs: 335 selected, 2 substituted, 5 unclassified, and 5 excluded.

No production mutation has been performed in this replay-verification batch.
Push reviewed, coherent batches stepwise as requested.
