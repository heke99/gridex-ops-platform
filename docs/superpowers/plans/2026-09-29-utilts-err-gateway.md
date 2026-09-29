# UTILTS ERR gateway and requirement reconciliation implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Reconcile all 121 rule cards and 231 acceptance contracts without overstating acceptance, then prove and correct the bounded ACK-08 ERR gateway failures.

**Architecture:** The canonical policy remains the owner of ERR business semantics. Real runtime dispositions flow through the existing durable transaction reservation, ACK gateway and finalizer; transaction ACK identity uses the full original IDE. No new SQL authority or transport is introduced.

**Tech Stack:** TypeScript, Vitest, existing local Supabase/PostgreSQL CI replay, GitHub draft PR #421.

## Global constraints

- Same branch `codex/ediel-v2-identity-e035-owner-20260928`; no force push; preserve later work.
- #310 untouched. Real Ediel traffic remains held. No staging, TGT/AGT, counterparty trial or real transmission.
- Historical 203/505 issuer/history/retention, positive LOC175 ownership and complete E035 remain blocked on authentic external evidence.
- E72 and E73 are already corrected. Last fully verified head: `0b6ea32ad7e284fc3eca30e827b16aab64614a31`, five workflows successful, native 407/407.
- No claim of whole-masterplan acceptance from path existence, ordinary tests or a green CI run. No unchanged-head reruns.

## Routing and files

Activated: using-superpowers, writing-plans, executing-plans, spec-to-code-compliance, systematic-debugging, test-driven-development, fp-check, verification-before-completion. The compliance skill requires independent per-requirement reads and refutation; those agents are read-only and the root owns every edit. Supabase applies to the native database test; code-review/differential-review apply before delivery.

The 352-row reconciliation is a reference/evidence inventory with five bounded fresh semantic reviews, not a new whole-repository baseline or a formal acceptance run. General security scans, supply-chain checks, UI/performance and refactoring skills have no changed trigger. No dependencies, schema, authentication policy or UI are changed. Existing mandatory release gates still apply.

- `quality/audits/ediel-masterplan-v2/masterplan-v2-reconciliation-20260929.{json,md}`: every requirement ID, inherited status, current reference hashes, changed references and bounded review/next-proof status.
- `__tests__/helpers/utiltsErrGatewayFixture.ts`: physical synthetic IDE fixtures, shared by ordinary and native tests; no historical evidence or expected inventory.
- `__tests__/ediel-utilts-err-gateway.test.ts`: real runtime, builder, canonical validator, gateway and finalizer, with database IO only in memory.
- `scripts/ediel-utilts-err-gateway-native.test.ts` and native config: actual local database consumers, durable ACKs/reservations, interruption/retry, positive/guide-negative/function-negative scope and zero forbidden effects.
- `lib/ediel/ack.ts`, `lib/ediel/core/kernel.ts`: minimal correction only after RED.
- ACK-08 audit, activation matrix, PR description and canonical agent-memory: bounded evidence and next action.

## Task 1 — Reconcile and reproduce

- [x] Verify local/remote refs, clean status, unpublished commits, existing five exact-head workflows and writing ownership.
- [x] Read frozen masterplan/registers, inherited traceability, UTILTS sources, canonical policy and actual CALL consumers.
- [x] Independently review U-02, U-03, U-14, ACK-03 and ACK-08; refute the selected ERR finding.
- [x] Save all 352 IDs and 346 current reference hashes; preserve inherited semantic and formal statuses explicitly.
- [x] Add ordinary real-gateway RED tests and execute them before product changes (four expected RED; added legacy control passes).
- [x] Add local-only native proofs and publish substantive test/evidence step `a671a663`.
- [x] Read actual native a671a663:407/411; all previous407 pass, four new expected product failures.

## Task 2 — Correct the bounded ERR failure

- [x] Derive ERR process type from the canonical UTILTS profile, leaving CONTRL/APERAK semantics intact.
- [x] Key transaction-scoped ERR duplicate lookup and source operation by the full original IDE; retain unscoped legacy ERR behavior.
- [x] Execute ordinary same-code/two-IDE, mixed responses, interruption/retry and legacy controls; typecheck and lint touched files.
- [ ] Publish a coherent correction and evidence fast-forward on #421.

## Task 3 — Exact-head delivery

- [ ] Read first CI failures; require actual native database proof before reporting persistence/retry as verified.
- [ ] Verify all five mandatory workflows, OPS verify/quality/clean replay, native, case/browser, tenant invariants and type/schema parity on the exact new head.
- [ ] Review complete PR diff, review threads, local/remote refs and unpublished commits.
- [ ] Put final receipt in the PR description. Correct stale memory with the substantive commit; avoid a status-only CI commit.
- [ ] Keep draft/traffic holds and record the next source-backed candidate per requirement ID.

Local correction checks:108/108 focused tests, tests/scripts TypeScript, lint0errors/4 inherited warnings, frozen121/231 and ACK persistence/chain/engine regression PASS. Independent review approves this bounded correction pending new-head native and delivery. Retained ordinary23505 controls are synthetic IO proof, not native concurrency. Native snapshots now include full receipt/reservation and ACK timestamps; source capture uses the actual family/date evidence trigger.
