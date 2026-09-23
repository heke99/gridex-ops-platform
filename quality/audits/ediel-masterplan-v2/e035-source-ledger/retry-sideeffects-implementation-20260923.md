# E035 persistence side-effects fix — 2026-09-23

Status: implemented; bounded local verification passed, independent review/CI pending. Baseline `95b5e391159e3164869ddabd8ec96b8f69189fe2`. Commit: the implementation commit containing the tracked copy of this report; exact SHA recorded in the final handoff and SDD copy after commit.

## Finding and root cause

Confirmed HIGH: SQL can return `failed/processability_rejected/utilts_err` after quantity insertion fails. The processor updated transaction dispositions, but retained accepted runtime validation; the legacy sinks flattened all original transaction quantities and billing could additionally fall back to message-level quantity. Rejected energy therefore reached metering/billing and an entirely failed response could mark a data request received.

Evidence: actual exported sink tests reproduced failed/held/ambiguous consumption; actual processor tests exercised parsing, runtime, structure qualification, RPC payload construction, sinks, and ACK drafts with only external IO mocked. A failed 500 kWh first transaction originally reached sinks, including alongside an accepted 7 kWh sibling. No live writes or native DB execution occurred.

## Changes and boundaries

- Both quantity sinks require the runtime transaction contract. Each physical transaction must have a unique identity, one accepted/positive_aperak disposition and one matching accepted/positive_aperak/persisted result. Duplicate, missing, contradictory, rejected, held, and failed evidence authorizes no quantity.
- Common extraction applies the gate before flattening. Runtime payloads cannot recover excluded values through message totals, scalar quantity, or fallback series. Synthetic transaction IDs use the existing persistence/ACK identity resolver.
- Repository-wide caller search found only the real part-2 processor calling the two write sinks. Thus there is no proved legacy production writer exempted from evidence. Pure extraction utilities retain pre-runtime scalar/series compatibility, but that format alone cannot authorize sink writes. The real processor supplies both arrays even when empty, and runtime engine/source markers also prevent accidental fallback.
- Processor validates complete, unique, coherent RPC outcomes before ACK or completion. Missing/ambiguous evidence is an internal error, not an invented national ERR. All-failed persistence changes the effective validation and takes the rejection path before outbound acknowledgment/data-request completion. Mixed accepted/failed siblings retain eligible consumption and their respective positive/ERR ACKs.
- Existing mixed-held early return is preserved: accepted siblings persist durable series and receive ACKs; held siblings carry empty quantities and no positive/ERR ACK. No new partial-request completion or legacy billing behavior is introduced.
- ACK reservation/finalization SQL, immutable non-held retry response plan, ERR crash reservation and migrations are unchanged. Positive_aperak is the sole accepted response in both the runtime disposition builder and successful persistence SQL.

## Skill routing and source review

Read AGENTS, memory/checkpoint/handover/blockers/work-plan and domain flow memory; searched decisions/known failures. Applied systematic-debugging, test-driven-development (including writing-good-tests), verification-before-completion and bounded code-simplifier review. using-superpowers explicitly excludes dispatched subagents. No worktree needed: sole implementation owner. No UI/Next API changes, database migration or hosted Supabase actions, hooks, supply-chain change, performance optimization, broad audit or reusable skill modification; those workflows are outside this task. Reviewed the relevant whole processor/matching/extraction/sink/ACK/persistence path, not only the patch.

## Executed verification

1. `node node_modules/vitest/vitest.mjs run __tests__/ediel-utilts-persistence-sideeffects.test.ts`: initial fixture omitted a required metering period (18 failures; not valid red). Corrected fixture before production edits. Valid baseline RED: **17 failed / 1 accepted control passed**. Failure assertions showed rejected quantities/underlays and missing synthetic identity.
2. Same suite after common guard: **18 passed**. Added no-contract sink case: **1 failed / 18 passed**, then guard: **19 passed**.
3. Processor regression with actual baseline part-1 restored temporarily under a Python try/finally, then restored patch: **3 failed / 1 passed** (failed singleton, mixed failure, absent results; held characterization remained passing). Green with gate: **4 passed**.
4. Expanded processor completion/evidence negatives before part-2 changes: **5 failed / 2 passed**. After effective-decision/RPC validation fix: new suites **26 passed**.
5. Earlier Node22 targeted run before effective-decision expansion: **74 passed / 6 files**. This is superseded by final verification below, not a final-head claim.
6. Seven existing external-IO diagnostic fixtures used invalid successful `[]` RPC results. Initial strict-contract run: **137 failed / 2 passed**, two rejection errors. Replaced only fake IO response configuration with typed `successfulUtiltsPersistenceIo`, which returns each supplied input transaction's documented outcome. At this stage no original assertions changed. Result: **137 passed / 2 failed**. With explicit task-owner approval, moved the two incompatible invalid-contract diagnostic cases to direct reader calls with identical inputs: absent company and duplicated physical messages. Retained no-query, status, authority/selection and no-national-error diagnostic expectations. Their former normal-return/ACK characterization cannot coexist with fail-closed processing; new real-processor cases require an internal exception before ACK, sinks or completion. All other original assertions remain unchanged.

7. Forced-positive TGT regression: removing only the dominant `allTransactionsFailedPersistence` branch produced **1 failed / 9 skipped** because completion was reached; restoring the branch passed all10 processor cases. Failed persistence must dominate `forcedPositiveTgtAckPlan`. Stored effective validation is `ok:false/classification:functional_rejected`, failureReason `utilts_transaction_persistence_failed`; the original ACK plan remains untouched, while authoritative transaction dispositions produce ERR. No response-plan rewrite.

Final commands (working directory repository root):

```sh
/tmp/e035-node22/node_modules/node/bin/node node_modules/vitest/vitest.mjs run __tests__/ediel-utilts-*.test.ts __tests__/ediel-received-structural-qualification.test.ts __tests__/ediel-received-context-reader.test.ts __tests__/ediel-received-structure-reader.test.ts __tests__/ediel-received-context-outcomes.test.ts __tests__/ediel-received-structure-reader-boundaries.test.ts __tests__/ediel-received-structure-reader-deadline.test.ts __tests__/ediel-durable-source-business-outcomes.test.ts
npm run typecheck
npm run typecheck:tests
node node_modules/eslint/bin/eslint.js lib/ediel/flows/utiltsDataRequest.part-1.ts lib/ediel/flows/utiltsDataRequest.part-2.ts __tests__/ediel-utilts-persistence-sideeffects.test.ts __tests__/ediel-utilts-persistence-processor.test.ts __tests__/helpers/utiltsPersistenceIo.ts
git diff --check
```

Final outcomes: **365 tests / 25 files PASS** on Node22 (29 new sink/processor cases); application typecheck **exit 0**; tests typecheck **exit 0**; targeted ESLint **exit 0**; `git diff --check` **exit 0**. Environment emits npm unknown `http-proxy` configuration and Node22 experimental proxy warnings; no test/runtime failures hidden as warnings.

## Files

Production: `lib/ediel/flows/utiltsDataRequest.part-1.ts`, `lib/ediel/flows/utiltsDataRequest.part-2.ts`.
New tests: `__tests__/ediel-utilts-persistence-sideeffects.test.ts`, `__tests__/ediel-utilts-persistence-processor.test.ts`; external IO helper `__tests__/helpers/utiltsPersistenceIo.ts`.
External mock fixture setup corrected in: `ediel-durable-source-business-outcomes`, `ediel-received-context-outcomes`, `ediel-received-context-reader`, `ediel-received-structure-reader-boundaries`, `ediel-received-structure-reader-deadline`, `ediel-received-structure-reader`, `ediel-utilts-observation-processor-handoff` (all under `__tests__/*.test.ts`). The two reader files additionally migrate only the explicitly approved invalid-contract cases as described above. Tracked report: `quality/audits/ediel-masterplan-v2/e035-source-ledger/retry-sideeffects-implementation-20260923.md`.

## Remaining scope / limitations

No whole E035/masterplan completion, whole-PR approval, CI/native replay, hosted DB verification, migration rewrite, deploy, publish or market send is claimed. Real matching tenant arguments are retained and tested; no tenant policy changed.

Successful persistence results attest transaction outcome, not the quantities/hash themselves. Inbound UTILTS payload immutability is not universally established by the inspected DB trigger: auto-sealing applies to outbound canonical messages and inbound PRODAT. Changing raw UTILTS bytes under the same already-persisted source ID could therefore require a separate quantity/hash binding or stored-series consumption contract. This patch fixes failed/rejected/held/ambiguous authority; it does not establish that adjacent successful-replay immutability contract.
