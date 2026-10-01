# Source-owner unit persistence adapters after the switch atomic owner

Date: 2026-10-01. Status: bounded real TypeScript integration **VERIFIED**, three suites **41/41 PASS**. No production/SQL/shared-helper change. Genuine database/Auth/transport/native behavior is not qualified by these unit adapters.

The existing tests exercised `applyInboundBusinessStateMachine`, the canonical source-owner producers and `processInboundEdielMessage` through controlled outer database boundaries. After the new switch transaction owner, the runtime/processor memory database returned a validation-assessment shape for `gridex_apply_inbound_switch_lifecycle_v1`; the commit-observer memory database exposed no RPC method. Their older row-write adapters no longer represented the production persistence boundary.

Actual local pre-correction two-suite RED: **31 failed, 6 passed, 37 total** (`/tmp/gridex-source-observer-atomic-adapter-red.log`). A combined three-suite local RED had the same 31/6 plus processor collection failure: a concurrently added, unrelated defensive document module imported the Next `server-only` marker, which was not independently resolvable in this test runtime (`/tmp/gridex-source-observer-atomic-three-adapter-red.log`). The parent separately reported its immutable full-suite receipt of **34 failures / 7141 passes / 7175 total across 500 files**, including three processor RPC-shape failures. That full-suite receipt belongs to the parent; it is not misrepresented here as this reviewer's combined local execution.

Only these existing unit persistence boundaries changed:

| File | Correction and retained assertions |
|---|---|
| `__tests__/ediel-source-owner-runtime.test.ts` | Wraps the existing memory database only for the exact lifecycle command. Checks the two actual arguments, models committed switch/period rows before a valid command result, and returns the injected supply failure before any effects. Existing canonical, party, tenant, facility, immutable source, truncated reads, foreign receipts, one-use handoff and timeline assertions remain. Expected RPC order now includes the actual lifecycle command; failed supply also explicitly retains both draft states. |
| `__tests__/ediel-source-owner-processor.test.ts` | Preserves the real processor, canonical and source-owner code. Its existing link persistence mock now stores the actual switch correlation, so the lifecycle memory command inspects that stored result. A missing stored switch/customer returns `inbound_switch_resource_scope_mismatch`; no accepted rows are added. The existing processor `finally` still records unavailable source evidence. Existing ACK bytes/business outcome equality when evidence storage fails remains. |
| `__tests__/ediel-source-switch-commit-observer.test.ts` | Adds the actual two-argument RPC persistence boundary, models update/insert period paths, supply errors with zero effects, and permanent replay without new writes. Both successful existing/new-period observer assertions remain. The new replay case proves only one transient observation after two calls. The unavailable evidence sink comparison now uses two independent fresh memory scenarios, rather than incorrectly using a permanent replay as a fresh observation. |

The previous uncorrelated/missing-customer Z04 tests expected a resolved legacy call and no observation. The actual new command requires stored source/resource binding and raises `inbound_switch_resource_scope_mismatch` (23503) when it is absent. Those negative cases now expect that canonical command error while retaining no observer/no accepted effect assertions; they were not converted into fabricated ignored/accepted receipts. The processor likewise rejects the uncorrelated command while its real finally path retains unavailable evidence. No production semantics were changed to accommodate a test.

The returned unit command receipt is explicitly the controlled database result after the modeled writes, not evidence that PostgreSQL ran. The production adapter validates its real command shape and the real business wrapper publishes only a fresh successful result. The already independent 28-case SQL plus three-case identity-core packet remains separate proof of its own exact candidate bytes; its native four-case execution remains pending. No broader legacy authority, role, Auth or security test was executed as part of this compatibility correction.

## Exact executed checks

- Final command: Node22 `npx vitest run --config /tmp/gridex-source-observer-unit.config.mts __tests__/ediel-source-owner-runtime.test.ts __tests__/ediel-source-switch-commit-observer.test.ts __tests__/ediel-source-owner-processor.test.ts`.
- Final receipt: `/tmp/gridex-source-observer-atomic-three-adapter-green.log`, exit 0, three suites / **41 tests PASS** (runtime 31, processor 3, observer 7).
- The scratch-only config extends the real default Vitest config and maps the import marker to the installed pinned Next `require.resolve('next/dist/compiled/server-only/empty.js')`. It supplies no domain/Auth/service behavior. No marker mock or new alias exists in the committed unit files or shared default config.
- Exact three-file ESLint: exit 0, no lint errors or warnings (`/tmp/gridex-source-observer-adapters-lint.log`). Scoped `git diff --check`: PASS.
- No additional TypeScript compilation was launched while the parent ran its full gate. Parent integration owns the applicable current tests/scripts/application type gates; they are not claimed by this receipt.
- No test skips/removals, production edits, SQL/checksum/immutable artifact changes, shared helper changes or default workflow/config changes.

## Frozen implementation manifest

| Path | SHA256 |
|---|---|
| `__tests__/ediel-source-owner-runtime.test.ts` | `9ccbcf22810f7fe3056d805f889c9c2f1ca64e439eb3d0983dbe3ec9c7caaeb6` |
| `__tests__/ediel-source-owner-processor.test.ts` | `830cc2086934423ea8f2b75407981a5896efe8ffd21ec7e1428833ae0272db3d` |
| `__tests__/ediel-source-switch-commit-observer.test.ts` | `aec03ce7bdec1c8a1453a7c0b3d04c3545a1d6d774ccba8654b1fdc2391e0138` |

The separate read-only older source inventory retains **BLOCKED_AUTO_REVIEW / NOT_EXECUTED** for its prohibited deeper testing. This bounded compatibility work does not resume or replace that blocked work. Frozen switch eleven paths, positive six paths and their earlier proofs remain preserved.
