# Task7 — bounded manual-email fencing and analytics enumeration

Status: IMPLEMENTED_NOT_VERIFIED against hosted/native gates; actual-source regression GREEN. Candidate stopped for root's independent specification and quality review. No commit, push, index mutation, dependency installation, SQL, workflow or memory edits, production access, or provider delivery performed by this author.

## Scope and evidence

Read AGENTS, current memory/checkpoint/domain/API invariants, decisions/known failures, Task7 plan/brief and the complete jobs85 audit/matrix. Read the complete manual outbox (including linked-request helpers, stale recovery and explicit requeue), manual operations mailbox, provider factory/interface/Resend send boundary and tenant operation policy; inspected the manual cron route and all four analytics/forecast/data-quality driver consumers. Configuration declares `supabase/config.toml` `max_rows = 1000`. Both defects were reproduced on actual baseline source, not copied worker logic.

Skill routing: systematic-debugging and TDD for confirmed branches and RED/GREEN; verification-before-completion for exact evidence; fp-check equivalent direct actual-source interleavings for ownership findings; Supabase guidance for filtered updates/returned rows and paging. Using-superpowers explicitly exempts dispatched subagents. The existing parent plan and complete jobs matrix provide the planning/inventory prerequisite. Quality-playbook reviewed for behavior/evidence principles; its complete repository audit/delegation/artifact workflow is outside this bounded assignment and overridden by explicit no-subagents/no-other-files instructions. No new product/architecture choice requires brainstorming. UI/React, SQL changes, migration generation, dependency scans/install/hooks, deployment/branch finishing, skills authoring and unrelated refactors are absent. Root owns independent review and publication. Supabase public update documentation was reachable; its Markdown changelog and guessed gt/maybeSingle reference pages failed to render, so no complete current-docs/changelog verification is claimed. Native test-query guidance is bounded by the explicit no-native instruction.

## Files changed (exact author scope)

1. `lib/email/manualEmailOutbox.ts`
2. `lib/analytics/cron.ts`
3. `__tests__/helpers/jobs-ownership-cases.ts` (new shared scenario/fixture definitions)
4. `__tests__/jobs-ownership-and-pagination.test.ts` (new permanent Vitest suite importing both real modules)
5. `quality/audits/proofs/jobs-ownership-regression.mjs` (new dependency-free Node24 executor of the same scenarios and actual modules)
6. `.superpowers/sdd/2026-09-12-current-and-plan77-85/task-7-report.md` (this report; ignored SDD path)

Preserved existing Task13/billing/plan changes and root-owned index. Root published those unrelated changes during this task. Existing `scripts/__pycache__/` was neither created nor removed by this author.

## Behavior and ownership matrix

| Boundary | Result after this patch | Proof |
| --- | --- | --- |
| Preclaim policy exception | Observational skipped result with `preclaim` error; no row or linked-request mutation | Another worker's sending lease survives |
| Failed claim response, including response lost after commit | Never treats uncertain acknowledgement as ownership; no failure transition | Both committed/uncommitted fake response cases |
| Queued claim loses CAS | Skip plus `claim_lost_before_send`; no provider call | Zero affected row |
| Owned ordinary failure | Company + id + sending + worker filters and returned row required | Retry, fifth-attempt terminal, recipient/reserved guards |
| Ownership lost before catch or during failure write | No lease clear/retry/terminal overwrite or linked projection; skipped, explicit claim-lost error | Other sending worker and already-sent state at both boundaries |
| Failure persistence rejected | No failure-success count or linked projection; skipped plus persistence error | Failed terminal write |
| Provider accepted, sent persistence unconfirmed | Existing no-resend uncertainty behavior retained; only accepted owned uncertainty write permits linked failure projection | Owned, another sending worker, sent, and rejected uncertain write |
| Sent transition persisted, linked projection fails | Sent remains terminal; post-send projection diagnostic/recovery retained | Repeated invocation sends only once |
| Stale sending lease | Existing sending-to-uncertain recovery and linked projection retained | Stale synthetic lease, no automatic send |
| Analytics enumeration | 200-row ascending unique ID keyset, status predicate on every page; page errors propagate | 0/200/1000/1001/1603 rows, mixed governance, page1/page2 errors, deletion behind cursor |

`failed` now counts acknowledged owned retry/terminal transitions, not unclaimed/lost/error-persist cases. `deliveryUncertain` continues to describe observed provider acceptance with unconfirmed local finalization, even if uncertainty persistence itself failed; those outcomes explicitly carry `delivery-uncertain-update` errors and never claim a sent result. No public response fields were added.

The provider payload, stable idempotency key, recipient checks, both tenant-operation gates, retry/backoff/attempt cap and stale recovery remain intact. Lifecycle authority remains `companies.status IN (active, onboarding)`; the stale `is_active` flag does not govern analytics. All four consumer contracts remain `Promise<string[]>`, and consumer source is unchanged.

## Executed commands and outcomes

Executed from repository root with Node `v24.19.0`:

```sh
node quality/audits/proofs/jobs-ownership-regression.mjs
```

Before source edits: 32 cases, **21 failures** (13 manual ownership/observability failures and 8 pagination/completeness failures), 11 compatibility/control cases pass. One initial test hook erroneously intercepted stale recovery; that test-only hook was corrected to target the worker-owned uncertainty transition, then RED reran with all 21 failures attributable to the intended defects. After source edits: **32 cases, 0 failures** (23 manual, 9 analytics). The same case definitions are consumed by permanent Vitest using `vi.mock` only at external DB/provider/policy/schema boundaries. No real provider method executes.

Independent RED rerun after GREEN against immutable baseline, without reverting working-tree changes:

```sh
task7_red_dir=$(mktemp -d /tmp/gridex-task7-red.XXXXXX)
git show 19d6fd40:lib/email/manualEmailOutbox.ts > "$task7_red_dir/manualEmailOutbox.ts"
git show 19d6fd40:lib/analytics/cron.ts > "$task7_red_dir/cron.ts"
JOBS_MANUAL_SOURCE="$task7_red_dir/manualEmailOutbox.ts" JOBS_ANALYTICS_SOURCE="$task7_red_dir/cron.ts" node quality/audits/proofs/jobs-ownership-regression.mjs
```

Outcome: same **32 cases, 21 failures**, exit1 expected. Node emitted only its normal experimental `stripTypeScriptTypes` warning in these harness executions.

```sh
node scripts/gridex-manual-email-recipient-resolution-regression.cjs
node scripts/gridex-cron-idempotency-and-locking-regression.cjs
git diff --check
```

All PASS/exit0. These two existing scripts are source regressions, not native/provider concurrency proof.

```sh
node node_modules/vitest/vitest.mjs run __tests__/jobs-ownership-and-pagination.test.ts
```

BLOCKED: `MODULE_NOT_FOUND` for local Vitest; no install retried. Local Vitest/TypeScript executables are absent. Do not interpret the Node harness as a completed supported Node22 Vitest/typecheck/lint/build gate.

## Remaining gates and limits

- Independent scoped specification and quality review is required before publication.
- Supported Node22 hosted `npx vitest run __tests__/jobs-ownership-and-pagination.test.ts`, whole quality suite, `npm run typecheck:tests`, script typecheck, lint/build and relevant hardening checks remain required. The new `vi.mock` factories return explicit module object literals, avoiding the separately reported billing `() => unknown` namespace typing issue.
- Isolated PG17/PostgREST proof remains: two-session claim exclusion and old-worker/reclaim interleavings; actual returned-row semantics; tenant negative mutations and linked-request attribution; ambiguous claim/finalization response and recovery; atomicity, retry eligibility/exhaustion and rollback. No native concurrency, RLS or two-session acceptance is claimed.
- Query fixture executes the actual predicates over synthetic state; it does not emulate PostgreSQL transactions, isolation, locks, RLS, REST marshalling or provider guarantees.
- Provider acceptance with missing/ambiguous transport evidence remains the existing provider-boundary contract; no new transport reconciliation or real idempotency guarantee is invented. The patch does not resolve cross-request linked projection concurrency after an already accepted owned transition.
- Keyset enumeration covers a stable eligible population completely and avoids offset deletion shifts; it is not a consistent database snapshot under concurrent insertion/status changes. Newly eligible IDs behind the cursor await a later invocation. The deployment's actual eligible population/cap is unverified.
- Complete job fairness, tenant candidate-window starvation, total execution budgets, cancellation/resume/checkpoints and per-company analytics child-query completeness remain open. This pagination patch does not add a route deadline or per-company failure isolation to the four drivers.

Next action: root independently reviews this exact six-file candidate, then performs authorized publication and hosted checks. Do not call point85 or plan77–85 complete from this bounded result.

## Independent review

Specification and quality APPROVED for the bounded application task, no blocking findings. Minor: the supplemental Node24 runner emits its experimental TypeScript-stripping warning; this is recorded runtime noise and does not imply pristine hosted output. Supported Node22 and native/PostgREST gates remain pending.
