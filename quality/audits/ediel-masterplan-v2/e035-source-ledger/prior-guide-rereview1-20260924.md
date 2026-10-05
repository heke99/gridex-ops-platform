# Prior-guide scoped rereview 1 — 2026-09-24

Scope: complete `eb7d1b48..f2adeca4` fix package, appended implementation receipt, original findings and `f2adeca4..b26192bb` interruption-state cleanup. Followed the changed singleton eligibility predicate, native fixture construction, real persistence/ACK call path and SQL retry guard. No product edits, test execution, commits or publication performed.

**SPEC: original missing test matrix substantially addressed in written coverage. QUALITY: one concrete native assertion defect requires a small fix. Local implementation remains a candidate; native replay and exact-head delivery gates remain unexecuted.**

## Required correction

` scripts/ediel-source-owner-native.test.ts:432–438 ` snapshots entire ACK rows via `to_jsonb(a)` and expects complete equality after an ordinary successful matched retry. This is inconsistent with the actual finalization path: `createUtiltsRuntimeAcks` calls `finalizeUtiltsTransactionAck` again for accepted/positive transactions (`utiltsDataRequest.part-1.ts:780`), and that function writes new `finalized_at` and `updated_at` (`transactionPersistence.ts:211–212`). There is no ACK-row immutable trigger that suppresses these legitimate metadata updates. The stubbed ACK factory returns the same response id, but does not bypass real finalization.

Consequently this new native assertion should fail despite correctly preserved outcome. Compare ACK outcome/reservation/response id and all other stable fields while excluding only these legitimate finalization timestamps. Retain exact immutable series/contract equality and no-duplicate effect checks. Do not modify product persistence to satisfy this test. The later changed-knowledge conflict test's full snapshot equality remains appropriate because its exception occurs before any finalization call.

## Original findings

| Finding | Written coverage disposition |
|---|---|
| 1: genuine prior E30 point-side transition | Addressed: native case creates committed/reviewed Z04, inserts real Z10, proves pre-review hold, then reviews/witnesses Z10 and invokes canonical runtime plus qualifier for E20/E77/E24 ending and E25/E67 current sides, with E64 ambiguity held. It does not supply expected inventory from UTILTS. |
| 2: prior processor/ACK/persistence and retry | Addressed subject to correction above: actual processor operates on inserted prior-policy E66 originals, persists real transaction/series/contracts and finalizes real ACK reservations; missing/matched/E61/E62, held release, identical retry, committed/finalized and pre-ACK interrupted changed-knowledge conflicts are present. ACK creation and normalized metering sink are mocked boundaries, so these prove dispatch/absence and real reservation finalization, not authentic ACK wire generation or completed downstream metering storage. The report must retain that limit. Prior held/exempt/E19-rejected siblings are exercised through the real processor with mocked service persistence responses. |
| 3: source/membership/exemption matrix | Addressed as a bounded layered test matrix: prior native wrong/missing/excess registers, unknown root, pre-ledger interval, unavailable/unwitnessed successors and saved cutoff; canonical prior 15/60 energy-only positives; retained incomplete/corrupt readset unit boundary. The separately named latest-unavailable native case calls the comparator directly, but the changed-source retry cases exercise unavailable knowledge through the actual prior processor. No need to forge incomplete database state merely to label a test native. |

## Singleton eligibility correction

Actual prior p36 §3.6.2 permits one E30 reading with no delivery period; p48 §3.6.18 omits resolution for reading-only E30. Independently reread these source pages. The correction is necessary to reach the required prior E30 cases, rather than manufacturing an interval to evade canonical validation.

`isSingletonE30Reading` requires E30, an IDE24 observation, exactly one physical observation and QTY220, no period/resolution and a valid one-minute DTM597/203 calendar timestamp. It exempts only the missing period/resolution checks; source qualification and other canonical checks remain. Observed quantities are strings, so the presence check does not reject the valid string `0`. Second-reading, energy and invalid-calendar negatives remain tested. No load-bearing production defect was identified in this narrow correction. The source amendment documents its scope; broader reading-only profiles/resolutions are not certified by it.

The native fixtures preserve distinct prior policy date, October supply/transition times, real source receipt/review cutoff and existing database ledger epoch. SQL profile lookup follows the established native harness pattern. The b26192bb cleanup resets the simulated interruption flag between cases and is appropriate.

## Retry interpretation and verification limit

A contradictory fresh assessment may cause `utilts_committed_transaction_retry_conflict`. The approved oracle requires preserving committed outcomes and saved evidence, not guaranteed successful retry after contradictory knowledge. SQL raises before changing the reservation and the processor propagates before new ACK/sinks; the new tests correctly expect controlled rejection with unchanged committed state. No forward migration is justified.

Parent-provided local evidence is 6003/6003 Vitest in 372 files, three typechecks, scoped lint and source integrity; these were not rerun here. Native cases remain written/typechecked and **UNEXECUTED**. After the small assertion correction, written coverage is acceptable for native execution; passing native/ordinary exact-head gates and bounded delivery acceptance cannot be claimed in their absence. No full E035/G01/F3 approval follows.
