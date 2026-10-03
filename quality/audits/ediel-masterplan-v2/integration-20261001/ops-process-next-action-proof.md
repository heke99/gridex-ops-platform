# OPS02 process-specific next action

Implementation base `2e2c5f19513990043b5e0eb3020fda945608ad8f`; preceding fixture commit `03566df26a4316ab63338f72c131cc1d66791a0a`. This package changes no SMTP entry, native authority producer, generated artifact or native projection facade. Later atomic `projectSentSources.ts` must remain intact when integrating.

The source-owner business-expectation RPC is read before tenant-scoped actual message rows. Exact requested message IDs avoid an arbitrary first100-watch window. Foreign, absent or duplicate actual sources and ambiguous watches fail closed. Z01/Z02, Z13/Z14 and untimed Z18/Z15 derive different waits from the actual persisted business outcome, independently of technical CONTRL/APERAK. A positive CONTRL does not fulfil a business watch. Rejected, held or expired sender watches produce review; they never claim a remote protocol breach, provider permission or automatic resend. The actual accepted-SMTP anchor stays distinct from remote receipt, effective date and current evaluation time.

The customer-information view now shows waiting response, responsibility, blocker, source clock and visible next actions. Already-sent/pending/terminal requests cannot display a new Z01 preparation button; existing source watches also prevent a repeat while public sent status is awaiting repair. Current selected-company membership and operation permissions govern form visibility; the server actions continue to repeat their own authorization. No display DTO grants permission.

The actual inbound review-case producer writes an immutable display decision using only `message_received_at`. The operational-case page checks the persisted decision against the actual tenant source ID and actual admission time. Another source, changed clock or forged operation flag cannot provide the process panel. Missing time is held rather than reconstructed from case creation, document time or wall clock. Current active-company `cases.write` controls status triage independently of stored review candidates. Existing case/browser/source fields are preserved.

Verification on this package: 37/37 tests pass across the reducer, real private-owner port adapter, sweep and actual server-rendered customer-request/operational-case consumers plus existing route and Control Tower suites. Application and tests TypeScript pass; scoped ESLint has zero diagnostics; diff check passes. The private RPC/tenant-row/authentication ports in these local tests are declared synthetic unit boundaries. No native Supabase replay, interactive browser, legal issuer qualification or final frozen-candidate CI is claimed by this receipt. Those exact-candidate proofs remain required for OPS02 and AT-OPS02 acceptance.

Commands:

```sh
node node_modules/vitest/vitest.mjs run __tests__/ediel-process-next-action.test.ts __tests__/ediel-process-next-action-owner-port.test.ts __tests__/ediel-process-next-action-view.test.ts __tests__/ediel-process-review-view.test.ts __tests__/ediel-business-expectation-sweep.test.ts __tests__/ediel-operational-case-route.test.ts __tests__/ediel-operational-cases-view.test.ts
node --max-old-space-size=4096 node_modules/typescript/bin/tsc --noEmit -p tsconfig.app.json
node --max-old-space-size=4096 node_modules/typescript/bin/tsc --noEmit -p tsconfig.tests.json
```
