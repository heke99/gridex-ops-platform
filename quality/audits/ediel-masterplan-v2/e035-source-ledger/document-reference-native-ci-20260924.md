# Task2b native qualification

## 2026-09-24 — Task2b first native result; fix round 2 active

Published head `7a28b9ab086da88d320d7da96c54c503bcdafc75`, OPS35945973907. Quality/release/build job107463863631 SUCCESS. Clean replay job107463863699 applies migrations and runs all five native files: **228 passed, 33 failed, 261 total**. All 33 failures stop in document fixture seed line67: actual registry has communication.send and documents.read but lacks customers.read. This is a concrete registry prerequisite failure; document DB/Storage assertions behind that seed are not qualified. Generated types/schema stages were not reached. Verify job107463863393 fails the expected stale generated migration tail. Artifact10786519020 contains replay log only (ZIP SHA256 7db649f5e0269d01ddad11acc8cb20fa873b09392aa36aa539b87a659b084262).

Original Task2b author owns fix round2/5 from published7a28b9ab. Trace the actual migration chain and canonical key before correction; do not weaken authorization or insert a test-only substitute. Published SQL is immutable; any production repair needs a new CLI forward. Parent owns independent review, publication and authentic generated contracts. Task3 remains PREPARED only. Its approved sequential partition is 3a outbound reservation/provider fence and immutable receipts, then 3b finite twelve-table process facts; each requires independent review and real native acceptance before Task4 composition. Full E035 remains PARTIAL; PR372 draft; PR310 excluded.

Next: review the bounded fix, publish from API parent7a28b9ab, execute actual native qualification, reconcile generated artifacts, then accept Task2b only with evidence. No further user approval is needed for the authorized continuation.


Quality job107463863631 log inspected: full **6062 tests / 376 files** and quality **45 / 2** PASS, lint/scripts types/test types/API/RBAC/build/budget gates SUCCESS. These do not replace failed native qualification.

Root re-read actual job logs after recovery: quality107463863631 confirms full **6062 tests / 376 files**, build and bundle gates PASS. Native107463863699 confirms **228 PASS / 33 FAIL / 261**, all 33 seed registry assertions. Previous runtime agents were no longer live; replacement document_fix2_recovery resumes the existing round2 and existing CLI-created forward without increasing the fix counter.

## 2026-09-24 — Task2b native261/262; fix round3 active

Published9e28bc1d / OPS35947668822 / native107469127017: **261 PASS,1 FAIL,262 total**. Canonical customers.read materialization and repeat-preservation test pass. Sole failure is same-company wrong supply graph native test line158: expected unavailable but got verified_at_observation. Root cause is under investigation; do not classify fixture versus runtime defect before evidence. Generated types/schema stages not reached. Artifact10787592388 ZIP digest e1b061b7b3e8ccd37f476b61a3650d0a2f3d58dd244ee18261e83c9480193b46. Browser/Ediel/tenant pass; E2E14/15 only stale generated migration tail. Task2b not accepted.

Author document_fix2_recovery resumes fixround3 from9e28bc1d. Preserve unresolved graph/no Storage I/O requirement; published SQL immutable. Next: diagnose bounded root cause, fix, independent scoped review, publish and actual native rerun, then authentic generated contracts. Task3 prepared only. PR372 draft; full E035 partial.


Artifact10787592388 downloaded and ZIP SHA256 verified exactly against GitHub metadata; archive contains only rem002-clean-replay.log (no generated contracts). Quality/release/build107469127188 terminal SUCCESS on9e28bc1d.
