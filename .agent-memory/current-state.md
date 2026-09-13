# Current state

Updated: 2026-09-13.
Status: PARTIAL

## Active task

Database/types only: resolve CI execution, complete migration effects, ordinary
replay/ledger, then regenerate accepted types. User authorized coherent commits
and pushes to PR310. No production reset, main merge or deployment during proofs.

## Latest verified baseline

Base d47bfb0fb482d3e986de3abae98a8a0c7bafac56 already removes the one-time
publication workflow. The CI action_required blocker is superseded: OPS34771242285
ran, former status/repair-constructor faults and quality/build passed. Its verify
job103761119007 fails db:migrations:check; clean replay103761119014 fails. Native
residual34771242282 and frontier34771242291 pass. These are not canonical acceptance.

## Active retained timestamp increment

The old staging proof restored originals before513 timestamp stages. Retain all
selected bytes and session authorities first; execute the whole native tail while
original SQL remains absent, preserving source hashes, transactions and existing
negative controls. 11 new tests plus68 existing tests pass locally. Native result
on this increment is pending. Evidence:
quality/audits/DB_RETAINED_TIMESTAMP_INTEGRATION_2026-09-13.md.

Working-tree accounting is 600 inputs: 588 `FULL_FILE_SELECTED`, 2 `SUBSTITUTED`, 5 `UNCLASSIFIED`, and 5 `EXPLICITLY_EXCLUDED`.
The focused group contains 346 inputs: 334 selected, 2 substituted, 5 unclassified, and 5 excluded.

## Remaining acceptance

Source-effect admission for the seven residuals is still open. The ordinary
clean-replay target/lifecycle, ledger and generated-type gates remain blocking;
no accepted types were regenerated and tail20260911114443 was not fabricated.
After native retained-tail verification, integrate complete reviewed source-effect
accounting and the supported ordinary lifecycle. Only then capture schema/types.

No production mutation has been performed in this replay-verification batch.
Push reviewed, coherent batches stepwise as requested.
The accessible Supabase default branch is not a disposable test database.
App/API baseline52b2de4d81cae370bf250e5a80f12c300bbddd16 is preserved, and
quality/paused/2026-09-12-partner-price-wip.patch remains unapplied. After database:
runtime event_scope/DQ defects, RLS, billing, jobs including86, paused API, review.
