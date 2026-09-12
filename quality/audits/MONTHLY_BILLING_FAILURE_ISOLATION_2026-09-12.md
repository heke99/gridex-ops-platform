# Task 4 — Monthly company failure isolation and stale cron regression repair

Date: 2026-09-12. Baseline used for RED contrast: `41786027`.

Status: bounded source fix implemented and locally verified with a dependency-free Node 24 actual-source harness. The focused hosted Vitest and typecheck gates remain pending because this worktree has no `node_modules` after the recorded ENOSPC install failure. This report does not close masterplan points 77–85 or claim native database, production, workflow, or deployment verification.

## Scope and skill routing

Read the Task 4 brief, `AGENTS.md`, current memory/read-order files, billing audit, complete monthly automation, automation lock helper, billing cron route, stale regression, facade, full affected worker catch, and relevant existing tests. Applied systematic debugging to trace every escaping failure boundary, TDD for actual-source RED/GREEN, code-security correctness/race review around lock cleanup and tenant scope, and verification-before-completion. The repository-wide acquisition skill was inspected but not activated because this is a narrow bug fix, not codebase documentation. No brainstorming was needed because the brief defines the behavior and boundary. No subagents, dependency installation, SQL/schema/type generation, memory/workflow edits, production interaction, commit, or push occurred.

## Root cause and change

`runMonthlyBillingAutomation` previously awaited each tenant directly. `validateCompany`, lock acquisition, run insertion, failed-run finalization, and lock release can all throw outside the per-company function's inner catch. Any such exception aborted the scheduled multi-company loop and skipped all later tenants. The function also resolved a default month separately in each per-company call and again in the summary, permitting cross-tenant month drift at a Stockholm month boundary. An invalid supplied month was not rejected until after schema/list work began.

The outer function now canonicalizes the billing month once before schema/list side effects and passes that exact month to every tenant. Its loop catches an individual tenant failure only for the scheduled multi-company path, records a `failed` result containing the exact tenant, canonical month, `automationRunId: null`, and useful error text, then continues. Explicit-company invocations rethrow the same operational failures. Global month validation, schema readiness, and company-list failures remain rejecting operations. Existing inner handling, locked-period no-op behavior, preparation-only flow, tenant arguments, and summary status counts remain intact. No export send/create path was added.

Database-style thrown objects with a string `message` retain that message in the scheduled failure result; other thrown values receive the existing generic Swedish fallback.

The cron idempotency regression now reads `lib/customer-operations/automation.part-3.ts`, where the worker implementation and all ten telemetry fields live. Its ten assertions, terminal-state check, resume/lock/migration checks, and cron authentication check are unchanged. The public `automation.ts` facade remains unchanged.

## Permanent focused test

`__tests__/monthly-billing-automation-isolation.test.ts` imports the real `monthlyAutomation.ts` module and replaces only database, lock, schema, clock-default, metering, underlay, and preparation I/O. Twelve cases cover:

- invalid tenant configuration, held lock, run insertion, run finalization, and lock-release failures followed by a successful second tenant;
- explicit-company failure propagation;
- invalid global month before side effects plus global schema and list failure propagation;
- locked-period successful no-op without downstream preparation;
- exact tenant/month forwarding and completed/blocked/failed summary counts;
- a default month resolved exactly once for the invocation.

The insertion fixture throws a plain `{ message }` database-style error so the useful-error contract is not limited to native `Error` instances.

## Verification evidence

| Command / step | Fresh result | Boundary |
|---|---|---|
| Node 24 actual-source harness against pinned `41786027` | Expected RED, exit 1: 5/12 passed | Configuration, held-lock, insertion, finalization, release, invalid-month-before-side-effects, and single-default-month cases failed; preserved controls passed |
| Same harness against working `lib/billing/monthlyAutomation.ts` | GREEN, exit 0: 12/12 | Full actual module body; only external I/O imports substituted |
| `node scripts/gridex-cron-idempotency-and-locking-regression.cjs` before path repair | Expected RED, exit 1: all ten telemetry strings missing from facade | Reproduces stale test path |
| Same cron regression after path repair | PASS, exit 0 | Every original assertion retained and executed against part 3 |
| Node 24 `--experimental-strip-types --check` on production and focused test TypeScript; `node --check` on CJS | PASS | Syntax only, not type integration |
| `git diff --check` on the three publishable files | PASS | Whitespace/patch integrity |
| `node scripts/gridex-production-masterplan-p0-regression.cjs` | PASS, 6 controls | Existing source-level P0 control only |
| Existing monthly source controls from `gridex-supplier-ombud-business-automation-regression.cjs` | PASS, 7/7 when run directly | Entry point, metering, underlay, preparation, approval, and no export creation/sending |
| `node scripts/gridex-supplier-ombud-business-automation-regression.cjs` | FAIL before reaching monthly assertions | Unrelated pre-existing customer-page source check: `app/admin/customers/[id]/page.tsx` lacks literal `Fakturering`; the same check fails at pinned `41786027` |
| Focused Vitest / typecheck | NOT RUN locally | `node_modules` and Vitest are absent; no ENOSPC install retry was attempted |

Required hosted Node 22 follow-up:

```sh
npx vitest run __tests__/monthly-billing-automation-isolation.test.ts __tests__/operations-autopilot-phase-3-4.test.ts __tests__/billing-chain-customer-card-regression.test.ts
npm run typecheck
npm run typecheck:tests
node scripts/gridex-cron-idempotency-and-locking-regression.cjs
```

## Files

Publishable source/test changes:

- `lib/billing/monthlyAutomation.ts`
- `__tests__/monthly-billing-automation-isolation.test.ts`
- `scripts/gridex-cron-idempotency-and-locking-regression.cjs`

Task evidence:

- `.superpowers/sdd/2026-09-12-current-and-plan77-85/task-4-report.md`

No other source was changed in this lane. Existing unrelated dirty files were preserved. Root owns independent review, hosted gates, publication, and memory/workflow updates.

## Fix round 1 — TASK4-R1 refreshed readiness boundary

Independent review found that the initial candidate's tenant catch enclosed the public per-company function and therefore also enclosed its repeated global `assertPlatformSchemaReady()` call. A readiness refresh after the initial invocation gate could be converted into tenant failures and an HTTP 200 summary.

The correction factors the lock/run/pipeline work into a private prepared-company runner. The scheduled loop calls `assertPlatformSchemaReady()` before entering the tenant-local catch for every company, then validates tenant configuration and runs that private function inside the catch. This preserves the same fresh preflight frequency without type-based error classification, bypass, or indefinite caching. The public `runMonthlyBillingAutomationForCompany` retains its own preflight and delegates only after month, actor, company, and environment preparation.

The focused Vitest file now has 15 cases. Two new cases let the invocation preflight succeed and the next readiness call reject with either an actual `PlatformSchemaNotReadyError` or the same raw `{ code: '08006', message }` object supplied by the test. Both assert rejection by object identity, exactly two readiness calls, and no lock or metering work. A third test proves the public single-company function still runs and propagates its readiness preflight before tenant work. All previous 12 cases remain.

Fix-round actual-source TDD evidence:

| Command / step | Fresh result | Boundary |
|---|---|---|
| `node --experimental-strip-types /tmp/task4-monthly-automation-regression.mjs` after adding TASK4-R1 cases and before the source refactor | Expected RED, exit 1: 13/15 passed | Typed and raw refreshed-readiness errors were swallowed; the previous 12 cases and direct preflight control passed |
| Same command after factoring the prepared-company runner | GREEN, exit 0: 15/15 | Loads the actual monthly module and actual `PlatformSchemaNotReadyError`; substitutes only external I/O and asserts original error identity/no tenant work |

Hosted Node 22 Vitest and typecheck remain pending for the same dependency/ENOSPC boundary recorded above. No cron regression, SQL, memory, workflow, production, publication, or other source file was changed in this fix round.

Independent scoped re-review: TASK4-R1 ADDRESSED; spec and quality APPROVED, no new findings. Hosted Node22 verification remains pending.
