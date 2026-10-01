# U12: separate redelivery decision draft and navigation

This is a bounded continuation for U12 on the real invoice redelivery page and its exported client form. It does not change the decision command, provider boundary, permissions, financial data, shared navigation implementation, or published semantic snapshot.

The actual page binds `RedeliveryDecisionForm` and the `← Till fakturan` Next link. Previously, selecting an owner relationship or typing a reason did not register a dirty form. Following that link therefore discarded the controlled draft without the shared confirmation. The new actual provider/hook/form test reproduced **4 failures and 2 clean/saved positive controls** before the source change.

The form now uses the existing `useUnsavedChanges` hook. An unfinished account/reason draft registers with the existing capture listener and before-unload protection. Cancelling the confirmation keeps both controlled fields. Confirmed discard resets both fields. `data-dirty-form` lets its own submission reach the existing server action without incorrectly requesting navigation discard. Pending and returned errors keep the draft and its navigation protection. Current read-only props disable submission and retain protection for an already existing draft; an additional actual-export test reproduced **1 RED / 6 controls** against a write-permission-dependent dirty expression before that condition was removed. A fresh reader has no draft and no navigation trap. The existing qualified server `status: success` clears dirty registration and retains the completed form lock.

The server success used here is the existing action result after `recordInvoiceRedeliveryDecision` validates the actual RPC receipt's company, customer, invoice and expected revisions. Neither a browser click nor a pending request clears dirty state. The decision remains `verified_delivery_decision` / `blocked_provider_adapter`; no actual partner delivery is claimed.

## Executed evidence

| Check | Actual receipt | Limits |
|---|---:|---|
| New exported provider + hook + form suite | 7/7 PASS after 4 RED / 2 initial controls and 1 further RED / 6 controls | The actual shared hook and capture handlers execute. React hooks, server result and DOM events use controlled adapters; this is not a mounted React DOM/browser run. |
| New suite + preserved original form/page suite + actual decision action/service suite | 23/23 PASS, three files | Existing six UI cases and expectations remain intact. Their old direct-call harness adds a mock-only shared-hook/useCallback seam; it supplies no navigation qualification. |
| Scoped source/test/native TypeScript | PASS | Includes the real component, both UI tests, new native/config and their imported source. |
| Scoped ESLint and browser syntax | PASS | Only this packet's owned files. |
| Playwright discovery | 2 scenarios listed | Discovery is not execution. |
| Independent billing-owner form/hook review | PASS, bounded read-only | No concrete new source defect found; fixture/browser qualification is separate. |
| Independent billing-owner final fixture/browser review | PASS, bounded read-only | Real new GoTrue identities, current role/destination prerequisites, actual Next path and exact postcheck inspected; no runtime execution inferred. |
| New local Auth/PostgREST/native seed + durable postcheck | **NOT_EXECUTED (0)** | Prepared for the isolated local CI stack; Docker and psql are unavailable in this workspace. |
| Real Next/React browser navigation, returned failure, pending and persisted completion | **NOT_EXECUTED (0)** | Prepared two genuine Playwright scenarios, with no UI/action/Auth mocks. |

Commands run with Node 22 on PATH:

```sh
npx vitest run __tests__/invoice-redelivery-unsaved-navigation-20261001.test.ts __tests__/invoice-redelivery-ui-20260930.test.ts __tests__/invoice-redelivery-decision-20260930.test.ts
npx eslint 'app/admin/billing/invoices/[id]/redelivery/RedeliveryDecisionForm.tsx' __tests__/invoice-redelivery-ui-20260930.test.ts __tests__/invoice-redelivery-unsaved-navigation-20261001.test.ts scripts/invoice-redelivery-unsaved-navigation-20261001-native.test.ts scripts/invoice-redelivery-unsaved-navigation-20261001-native.config.ts e2e/browser/invoice-redelivery-unsaved-navigation-20261001.spec.mjs
npx tsc -p /tmp/gridex-ops-redelivery-navigation-tsconfig-20261001.json
node --check e2e/browser/invoice-redelivery-unsaved-navigation-20261001.spec.mjs
npx playwright test e2e/browser/invoice-redelivery-unsaved-navigation-20261001.spec.mjs --list
```

The temporary narrow type config extends the repository `tsconfig.json`, sets `incremental: false`, clears excludes and includes `next-env.d.ts`, the real component, both UI tests, the new native test and its config. No broad gate is represented by this scoped receipt.

## Prepared genuine runtime boundary

The new fixture creates fresh confirmed writer/reader identities and sessions through the actual reused GoTrue admin/sign-in APIs. It reuses only the frozen synthetic issued-graph SQL prefix, before the first decision, with its exact SHA-256 `1be2857589eece2d915b0c916129cdc2a774682e297010f8e4e2cd53052c1cd3` and exact replacement/boundary checks. SQL-only Auth insertion is omitted for these fresh identities. The actual billing command puts this newly created owner's actual confirmed address into the new customer's current profile. Existing billing recipient/view fixtures and historical owners are not changed to make the UI eligible.

Actual canonical tenant context must admit the writer's read/export grants and the reader's read-only grants; the reader must have no export grant. The real invoice detail loader must return `dispatched`, the current profile must have no blockers, and the active owner relation must bind the same current Auth user/customer/company before the browser begins. The seed requires zero decisions.

The browser uses the actual `/login`, page, shared provider, Next link and server action. It prepares cancelled and accepted discard; an actual schema-invalid whitespace reason with preserved account/reason; an intercepted request held before dispatch to observe disabled pending controls and cancelled pending navigation; qualified saved completion with no remaining dirty prompt; and an actual current reader's disabled form. Only loopback requests are allowed. Screenshots are named `invoice-redelivery-unsaved-{cancelled,error,pending,persisted}.png` under `e2e-artifacts`.

The independent native postcheck requires exactly one separately verified decision and its exact audit event, matching the current owner, destination, actor, company/customer/invoice and revisions. Whole original invoice/item/underlay/pricing/lines/documents, current customer, Auth email/confirmation/metadata/profile and foreign company/customer/event/decision baseline must remain identical. These are stored database/document references, not physical PDF bytes or provider qualification. It asserts delivery remains blocked. Password and fixture files remain private in `RUNNER_TEMP`; they are not uploaded as evidence.

Prepared CI lifecycle, after the disposable full migration replay:

```sh
export CI=true
export GRIDEX_NATIVE_STATUS="$RUNNER_TEMP/native-status.json"
export GRIDEX_REDELIVERY_NAVIGATION_FIXTURE_PATH="$RUNNER_TEMP/redelivery-navigation-fixture.json"
# GRIDEX_REDELIVERY_NAVIGATION_PASSWORD: fresh private CI value, masked; never printed.
export GRIDEX_REDELIVERY_NAVIGATION_PHASE=browser-seed
npx vitest run --config scripts/invoice-redelivery-unsaved-navigation-20261001-native.config.ts
export GRIDEX_REDELIVERY_NAVIGATION_LOCAL_E2E=1
npx playwright test e2e/browser/invoice-redelivery-unsaved-navigation-20261001.spec.mjs
export GRIDEX_REDELIVERY_NAVIGATION_PHASE=browser-postcheck
npx vitest run --config scripts/invoice-redelivery-unsaved-navigation-20261001-native.config.ts
```

The actual local public/anon/service environment for the Next process must come from the same `GRIDEX_NATIVE_STATUS`; the native config loads it only for its own process. No external browser target is accepted. A full-history/runtime mismatch must fail and be repaired before calling the scenario qualified.

## Seven-file manifest and remaining U12 work

1. `app/admin/billing/invoices/[id]/redelivery/RedeliveryDecisionForm.tsx`
2. `__tests__/invoice-redelivery-ui-20260930.test.ts` — mock-only harness seam; all six cases/expectations preserved.
3. `__tests__/invoice-redelivery-unsaved-navigation-20261001.test.ts`
4. `scripts/invoice-redelivery-unsaved-navigation-20261001-native.test.ts`
5. `scripts/invoice-redelivery-unsaved-navigation-20261001-native.config.ts`
6. `e2e/browser/invoice-redelivery-unsaved-navigation-20261001.spec.mjs`
7. This report.

Remaining: execute the prepared real browser and native durable postcheck on these exact bytes; qualify other central dirty callers and permission/error branches across the conservative OPS command registry. The existing shared guard does not intercept browser history `popstate`; that separate U12 implementation/qualification gap remains open. This packet does not certify U12 for all pages, the conservative 302 command IDs, or the unresolved whole OPS business-action total.
