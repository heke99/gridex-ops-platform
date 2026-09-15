# Current state — PR310, 2026-09-15

Status: PARTIAL

## Active work and exact next action

Current GitHub base70ce549fa9facdec9add63f91db224ee4c2bc2bb; exact tree
039f59bd30d5625b686c3145ff5fc0a5bdc25405 was imported and verified. Preserve its
clone-NULL fix, faithful regression, composite FK qualification and column
disposition audits. The overlapping local NULL fix is superseded, not reapplied.

Active correction: complete timestamp domain snapshots and nine real detection
controls on an owned clone. Catalog includes all non-system schemas, ledger
metadata, schema ownership/ACL, extensions, types/domain constraints and event
triggers. Row fingerprints exclude only separately verified schema_migrations
rows. Native live-sync uses the same complete domain snapshot.

Three finite synthetic clone-only admin operations use the existing local
infrastructure owner connection, with same-transaction role/loopback/OID guards,
container/internal-network verification and no SQL/database input. Historical
SQL remains under postgres; provider triggers remain unchanged. Independent
review approved this scope; actual PostgreSQL execution remains mandatory.
All23 proof tests pass including the preserved upstream NULL regression.
Evidence: quality/audits/PR310_NATIVE_TIMESTAMP_SNAPSHOT_2026-09-15.md.

Next: publish reviewed snapshot correction, inspect actual current-head native
SQL and qualify ledger-dependent readinessT257/T262/T275/T351 without synthetic
ledger aliases or asserting readiness when truth is blocked. Complete genuine
full native/schema/types/mandatoryCI/E2E/review before whole-PR merge and main
verification. Preserved evidence from the immediately preceding publication:

Publication base 61d6748e7ef1b538e6df0833fe2637f0c4e6ea1f preserves the
335f987f retained514 native integration and all approved auth corrections.
The prior ledger fixture and exact601/347 continuity fixes are published; on
f5a5fa88 OPS34964141901 verify104364493403 passes inventory and isolated SQL
fixtures and now stops at the unchanged generated-types migration-tail guard.

Ordinary native335f987f OPS34963346262/job104361913858 passes all144 foundation
inputs, all7 residual controls, and timestamp1–7 with real CLI ledger entries.
Timestamp8 source executes and its ledger row is verified, but the first source
restoration clone identity read raises JSONDecodeError: SQL NULL from to_json
is emitted by psql as an empty field. It is not a source8 SQL error. The new
bounded COALESCE emits explicit JSON null; original database ownership/OID
and clone protections remain. Faithful SQL-NULL reproduction5 errors; corrected
native proof16 and runtime12 tests PASS. Actual re-execution remains required.
Ordinary artifact10395480303; diagnostic10394374227 ZIP SHA256
9c14aab272826678adf7bc4f3b3dfed9f1d99f36eb9246fac275694eced90112 verified.

Full schema335f987f artifact10394485748 retains the same reference/replay hashes
as the earlier independent comparison. Four type differences now have a pinned
source/application disposition (PR310_SCHEMA_COLUMN_DISPOSITIONS audit).
Seven composite customer FKs are validated alternate NO ACTION definitions,
not missing tenant protection; reviewed bounded behavior qualification is wired
to the existing isolated PG17 job, native SQL pending. Exact single-key repairs
pass actual335f987f job104361913617; forward candidate is not promoted yet.
No schema/type/full-PR acceptance. Next: collect native timestamp continuation
and composite FK SQL receipts, resolve remaining deltas and integrate actual
final gates/type generation before whole-PR merge. User authorized full merge.
Receipt: quality/audits/PR310_NATIVE_CLONE_NULL_2026-09-15.md.

Two concurrent published descendants are retained:82cb5d00 supplies explicit
psql -f - for transaction stdin;61d6748e admits complete source/control/ledger
foundation proofs before timestamp execution. Their audits and all regression
tests remain. Remaining OPEN review findings from that continuation: complete
timestamp catalog/row coverage for private schemas/extensions/types/events,
and real execution of LEDGER_DEPENDENT_READINESS qualifications. Verify ledger
truth without inventing historical aliases or assuming deployment readiness.
See PR310_NATIVE_TIMESTAMP_TRANSPORT and PR310_NATIVE_FOUNDATION_ADMISSION.

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
