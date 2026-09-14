# Current state — database reconstruction, 2026-09-14

Status: PARTIAL

Ordinal27 transaction boundary: VERIFIED. Native first43 execution and its
actual CLI ledger: VERIFIED. Main/release and plan points85/86: NOT ACCEPTED.
Active work: integrate the next native atomic envelope, foundation44 through52.

## Latest verified evidence

Tested code: a7622e16c63e561cb62fc792d07c4ddf53103945.
Ordinary OPS run34860588353, clean job104031445849, artifact10354879366.
The result is NATIVE_HISTORICAL_PREFIX_VERIFIED: all43 historical foundation
inputs execute using official CLI2.101.0 and native Supabase PG17.6.1.106.
Their source/program hashes and actual ledger statements are checked. A repeat
migration up leaves the prefix ledger unchanged. No timestamp inputs execute.

The ordinal27 adapter preserves the exact LOCK TABLE in an atomic DO context
inside the CLI batch. It does not remove the lock or COMMIT before the CLI's
ledger INSERT. Four pinned sources (27,28,29,43) use this narrow adaptation;
unknown or changed lock-bearing sources are rejected. Original SQL is unchanged.
The native proof reproduces25P01 on the old execution program, then checks
rollback after the repaired body and during the CLI ledger INSERT (P2727/P2728).
The AccessExclusiveLock and original5s/30s local timeouts are present at ledger
insertion. Failed probes leave schema, rows and ledger unchanged. Temporary
helpers, owned resources and private historical inputs/workspace are disposed.

The native artifact was matched independently to all43 prepared source/program
receipts. Fresh offline tests:9 lock-boundary +30 prefix +15 lifecycle +8 ledger
regressions PASS (62 total);601 immutable files/505 version groups PASS.
Offline tests are separate from the actual native evidence above.

## Exact next action and remaining gates

Continue foundation44–52 as its reviewed atomic legacy envelope. Do not simply
increase LIMIT or strip inner transaction boundaries. Retain truthful CLI
ledger verification, source admission, locking, rollback and private cleanup.
Then integrate all remaining144-foundation/514-timestamp execution and verify
full independent schema semantics, auth-email tests, generated types and all
mandatory OPS/E2E checks before considering a merge.

The ordinary clean job remains FAILURE because the implemented native lane
intentionally ends at43 with NATIVE_LATER_ENVELOPES_AND_FULL_ACCEPTANCE_REQUIRED.
This is not an ordinal27 SQL failure. completeReplayVerified=false and
generatedTypesVerified=false remain correct. No full-PR green claim is made.
The old26-input/ordinal27 blocker is superseded, not still active.
Evidence: quality/audits/DB_NATIVE_LOCK27_VERIFIED_2026-09-14.md.

## Preserved scope

The current increment verifies already-published code and records its result;
it does not reapply or change the runtime correction. No hosted database call,
mutation/reset, fabricated applied row, original-history rewrite, schema/type
baseline refresh, deployment or main merge. Main was eb9a25bc at inspection.
Keep the seven real company fields/white-label FK and all existing app/API work,
including quality/paused/2026-09-12-partner-price-wip.patch. Prior hosted ledger
279/latest20260904222450 is historical, not a fresh inspection. Ediel detach
remains unapplied live in this work. Earlier evidence is preserved.

## Machine-checked continuity contract

Working-tree accounting is 601 inputs: 589 `FULL_FILE_SELECTED`, 2 `SUBSTITUTED`, 5 `UNCLASSIFIED`, and 5 `EXPLICITLY_EXCLUDED`.

The focused group contains 347 inputs: 335 selected, 2 substituted, 5 unclassified, and 5 excluded.

No production mutation has been performed in this replay-verification batch.
Push reviewed, coherent batches stepwise as requested.
