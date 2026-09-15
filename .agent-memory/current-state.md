# Current state — PR310, 2026-09-15

Status: PARTIAL

## Active work and exact next action

Current GitHub head335f987f0662da09e43eaf6cbd96158d657c9831 already publishes
all514 timestamp integration and the staged FK qualification. The retained local
batch exactly matches published tree550bdf91229481a5881a250a3f2ff3ab24476749.
Do not republish or rebuild that integration or the approved auth correction.

Active bounded correction: native lifecycle job104361913787/run34963346302
fails two ledger diagnostic tests before SQL. New timestamp preparation runs
inside the fixture's global subprocess mock, so the exact input selector never
writes its accounting files. Compile the actual plan before entering that mock,
then retain it for the diagnostic fixture. Production preflight and every failure,
privacy and cleanup assertion remain unchanged. Red reproduction2 errors; fresh
ledger8, timestamp compiler12, lifecycle15 and bootstrap14 tests PASS (49 total).
Native clean104361913858/current OPS34963346262 and older clean104354284197
remain in progress at this observation. Full native acceptance is pending.

Fixture correction published atbebe77a10dfbda76a6583b53e78372699c1836c5 with
exact local/remote treecbb1e179290e87cb0751cceb668acd704a50889f. On that head,
native lifecycle job104363322072 passed the previously failing test step.

Fresh OPS335f987f verify104361914531 revealed a separate continuity-text failure:
current-state wording no longer matches the actual-accounting assertions. Restore
the exact existing truthful601/347 summaries and required safety/next-action
markers; do not change accounting values or remove assertions.

Completed ordinary ec503fc7 run34960996690/job104354284197 proves all144
foundation inputs and all7 residuals; all7 groups have real CLI ledger statements,
negative controls, unchanged earlier ledger and no-op repeat. Group7 passes55000,
P1480/P1481/P1482 with catalog/row restoration. Artifact10393844978 ZIP SHA256
557fc15953fa17c9bcc200e8ecaaac2ea1de8a0ef3f49bfae2106bb58842c9f4 verified.
Its final rejection is NATIVE_LATER_ENVELOPES_AND_FULL_ACCEPTANCE_REQUIRED,
not a group7 failure. Native timestamp execution/current-head final gates remain
pending. Next: publish verified continuity correction, collect native/FK SQL
results, then source-causal schema reconciliation and genuine types.
Receipt: quality/audits/PR310_LEDGER_FIXTURE_2026-09-15.md.

The compiler prepares all522 possible units before creating the target. T201/202
keep separate committed phases; four LOCK sources have exact source adapters;
T232 retains its full proof and applies through the real CLI. All prior144
foundation/seven residual proof and65 real ledger rows must pass admission.
Source/ledger rollback, provider-event preservation, clone ownership, statement
identity and no-op repeat remain mandatory. No original historical versions are
marked applied through aliases. Full acceptance remains false until final gates.

The forward FK repair has genuine CLI filename20260915111458 and is staged under
scripts/sql/forward-candidates. It is not a deployed or selected historical source.
Promote only after isolated SQL qualification and truthful additional-source
registration; preserve existing514 authority as the historical prefix.

## Preserved history and access

Repository heke99/gridex-ops-platform; PR310;
branch codex/gridex-parity-remediation-20260905. Starting head a59e0ce6 is retained.
Earlier local auth patch is already published at43efaf89 and is an ancestor.
Exact journal ACL correction8130ecf3, required mutation controls d05408c2 and
ASCII-only native primary padding repair ec503fc7 are retained unchanged.
Concurrent publications were fast-forwarded; overlapping local drafts were
superseded, not rebuilt or force-pushed. Preserve and merge ALL PR changes.

Terminal/local Python/dependency installation and official CLI2.101.0 work.
Terminal git push lacks credentials; GitHub connector non-forced publication
works and tree/ref readback is mandatory. Local PostgreSQL/Docker unavailable;
package installation failed setgroups/setuid restrictions. Use Actions for SQL.
Main metadata protected=false, rulesets empty, admin-protection endpoint403;
no formal reviews/threads returned. Never infer acceptance from these facts.

## Actual evidence and remaining gates

Current-base auth diagnostic34960996805/job104354284392 is SUCCESS; actual logs
include complete fixture and all eight exact journal rejection/rollback controls.
Group7 native execution is now verified by the completed ordinary receipt above.
All144+7 source execution is proved; full source/schema acceptance is separate.
The parser repair retains single-primary/code/stage/reason matching.

Full portable schema artifact10371643836 confirms144+514 execution before red
diff. Two missing FKs are confirmed skipped-inline-reference effects. Seven
composite FK replacements have different deletion/update actions;24 anon grant
removals are source-explicit; policy equivalence remains unproved. Keep reference
unchanged. Genuine type generation and all same-head CI/E2E/reviews remain required.
No production mutation, deployment, main merge or whole-replay acceptance claimed.

## Continuity contract

Working-tree accounting is 601 inputs: 589 `FULL_FILE_SELECTED`, 2 `SUBSTITUTED`, 5 `UNCLASSIFIED`, and 5 `EXPLICITLY_EXCLUDED`.

The focused group contains 347 inputs: 335 selected, 2 substituted, 5 unclassified, and 5 excluded.

The staged FK draft remains outside the historical selector until separately admitted.
No production mutation has been performed in this replay-verification batch.
Push reviewed, coherent batches stepwise as requested.
