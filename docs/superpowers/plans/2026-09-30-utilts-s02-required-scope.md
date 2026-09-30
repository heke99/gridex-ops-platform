# S02 mandatory physical scope implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reject an S02 IDE missing its own required LOC172 or QTY135 before positive forecast/ACK effects, while preserving a clean sibling and stable retry.

**Architecture:** Retain the shared canonical policy and physical IDE/SEQ parser. Reproduce through the public canonical nonbilling consumer and the service-only bound SQL owner. Only after native RED, correct the smallest existing guide and prewrite SQL boundaries; forecasts retain empty actual-consumption observations.

**Tech Stack:** TypeScript/Vitest, local Supabase/PostgreSQL, canonical EDIFACT AST, native replay in OPS.

## Global constraints

- Same draft #421 and branch; fast-forward commits only. #310 untouched.
- E72/E73 are corrected and verified; do not redo them.
- No staging, TGT/AGT, counterparty trial, transport worker or real send.
- No assumed issuer mandate, synthetic historical authority, positive LOC175 ownership or full E035 approval.
- U/UE 25-A-4 pp51–52: UF-planning-209-51/505-51/514-52/515-52; CALL-09/11/12/13. U-02/U-03/U-14, ACK-03/08 and AT counterparts remain partial as whole IDs.
- Freeze source/tenant/date context and actual receipt/reservation/ACK/contract rows; no authority guard exemptions or rewritten historical migrations.

### Task 1: Publish a native reproduction before product changes

**Files:** `__tests__/helpers/utiltsS02PlanningFixture.ts`, local `__tests__/ediel-utilts-s02-required-scope.test.ts`, `scripts/ediel-utilts-s02-required-native.test.ts`, native config, audit and canonical memory.

**Interfaces:** Use `s02PlanningPair(defect, ownFirst)` and `s02PlanningFixture`; consume via `flows/utiltsDataRequest.processInboundUtiltsMessage`. Direct service attempts call raw `supabaseService.rpc('gridex_persist_utilts_consumption_v1', ...)` with physical per-IDE payloads and `allowConsumption:false` contracts.

- [x] Verify exact U/UE SHA256 against frozen manifest, read pp51–52 and fixture constraints; independent actual-module refutation.
- [x] Add clean controls and remove only own LOC172, QTY135 or both, retaining SEQ1 and recalculating UNT. Exercise both IDE orders.
- [x] Run ordinary RED: 2 clean controls PASS, 6 expected per-IDE guide refusals FAIL on dc1c9bae product code.

```ts
const source = s02PlanningFixture({company:'s02-synthetic',transactions:s02PlanningPair('missing-point',true)})
const runtime = runUtiltsRuntimeForMessage(source)
expect(runtime.transactionDispositions.find(row=>row.transactionId==='S02-OWN'))
  .toMatchObject({disposition:'guide_rejected',responseType:'negative_aperak'})
```

- [x] Add native real consumer and two direct atomic-refusal attempts; clean positive consumer/RPC controls and full retry snapshots.
- [x] Review test setup and run scripts/tests TypeScript, lint, memory/integrity/diff checks: PASS/APPROVE.
- [x] Commit test-only fixture/native/evidence; retain ordinary RED locally for the eventual correction.
- [x] Fast-forward publish; read first actual native failure. Existing 411 tests must remain green; the new source trigger/clean controls must succeed before calling the durable risk confirmed.

### Task 2: Correct only the native-confirmed boundary

**Files:** Existing `lib/ediel/utiltsEngine.ts` guide projection and, if native confirms service bypass, one new forward migration replacing `public.gridex_persist_utilts_consumption_v1`; staged ordinary test and audit/memory.

**Interfaces:** Retain canonicalEdielPolicy context and field projection. Required own LOC172 produces field209 guide-negative; missing own QTY135 produces field515 guide-negative. Functional validation must not overwrite either guide outcome. The SQL owner must independently refuse attempted accepted S02 with unsupported physical point or absent own planned quantity before receipt/reservation/series/contract insertion.

- [x] Diagnose native RED and verify its source/actor/context independently. Stop product work if a fixture or different boundary caused it.
- [x] Extend the existing point guide to S02 under canonical usage rules. Add own scoped planned-quantity presence enforcement without global sibling fallback; preserve other profiles and observed zero quantities.
- [x] Add the smallest physical prewrite SQL refusal for accepted S02 if evidenced, retaining signature, grants, source locks, tenant/environment/raw checks, membership and existing LOC175 precedence.
- [x] Run the ordinary test above plus missing QTY/both and both physical orders; require 21/21 and affected guide/ACK/consumption regressions. Stage the actual tests with the correction.
- [ ] Independent differential review; commit/publish the code/forward migration/evidence and inspect exact-head native positive/negative/atomic/retry results.

### Task 3: Final exact-head evidence and source-derived snapshot

**Files:** Replay-produced schema snapshot/fingerprint only if changed, audit, activation matrix and canonical memory. No generated types are hand-edited.

- [ ] Require native438/438 for the currently defined 27 new cases plus existing411, actual case/browser, tenant invariants, parity and public generated types.
- [ ] If schema snapshot is the first remaining failure, obtain authentic exact-head replay artifact, verify its ZIP/source provenance and copy only the new function-body evidence. Publish a substantive snapshot/evidence commit.
- [ ] Require all five mandatory workflows on the final exact head. No reruns of green unchanged heads.
- [ ] Review refs/local status/unpushed commits/full relevant diff/review threads; put final receipt in PR description. Keep formal whole-ID and external acceptance blocks explicit.

Execution receipt: test-only e1b4f897 OPS36644820963/replay109665237704 confirmed native414/426, all previous411 and3clean controls PASS; actual consumer positives and raw RPC1receipt/2accepted reservations/2forecastseries/2contracts on both malformed attempts. Local bounded correction54/54 affected ordinary tests, TypeScript/lint/migrations/types PASS; product differential rereview APPROVE; native438/final gates pending. Twelve additional native quantity-placement/zero/agency89/second-SEQ controls cover the corrected boundary.
