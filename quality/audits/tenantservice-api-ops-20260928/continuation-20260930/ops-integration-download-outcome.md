# OPS integration and attachment outcome continuation

This is a bounded source/action/framework packet. It does not close the whole OPS denominator or certify U01–U20. All receipts below are for the locally reviewed candidate, not an asserted hosted #422/CI result.

## Exact operations and source corrections

| Stable operation | Actual control / command / effect | Confirmed correction | Remaining runtime boundary |
| --- | --- | --- | --- |
| SEM-OPS-INTEGRATION-002; frozen OPS-FAMILY-8fa82b9aa145b2a1 | billing/integrations `#capway-connection-test` → two-argument `testCapwayConnectionFormAction` → `testCapwayConnectionAction` → current Auth/guard/operational company → test connection/config/Ping → qualified tenant/provider/environment row update | Returned safe `{ok,message}` is rendered through the shared form; current actor/company must match; readonly disables dispatch; missing row refuses Ping; both successful and failed saved results require returned id/status/result; raw provider error is not rendered or persisted as error text. Failed persistence no longer claims saved result. After a successful Ping, save failure never rewrites provider evidence as incomplete/failed; initial connection-load failure also never produces a provider-failure update. | Actual external success Ping was never executed. Prepared native test exercises deterministic missing-header failure before any provider network. Best-effort audit is not certified atomic. |
| SEM-OPS-INTEGRATION-003; frozen OPS-FAMILY-ee05e1bfc36628ca | billing/integrations `#provider-events-reprocess` → two-argument form wrapper → real action → tenant processor, maximum100 → counts and existing audit | Same actor/company/permission controls; visible processed/review/failed counts; noninteger/negative result refuses confirmation; failed count gives failed state; thrown failures return safe outcome; Next control flow is rethrown. | Underlying claim/atomic processor is another owned packet. Mocked action tests do not certify its native race handling. |
| SEM-OPS-DOWNLOAD-001 | ReportsList report whitelist link plus forecast/deviations links → `/admin/analytics/export` GET → real `getReportRows` → scoped CSV attachment | Added only the native `download` attribute to the three exact attachment Links. The installed Next Link handler had intercepted the actual ReportsList control and dispatched app navigation; native attachment navigation now bypasses that interception. | One installed-framework/control test passes; the other two same-property variants are source reviewed. Real browser file bytes/click semantics remain unexecuted locally. |
| SEM-OPS-DOWNLOAD-002 | `/admin/billing/export-center/[id]/download` GET → real `getBillingExportRunWithItems` → real `buildBillingExportFile` → attachment | Moved load, build, Blob construction and response into existing safe catch. Real stored consumption/credit_invoice pair was rejected by builder outside catch; now returns generic500. Both attachment GETs now require fresh Auth actor equal to guard actor and nonplatform selected company equal to guard company before service reads. Authoritative platform positive paths, tenant predicates, format, filename, headers and not-found404 remain intact. | No exposed legacy-run download link was found on the current billing screen. Prepared direct native URL navigation does not qualify UI discoverability. No invoice writes occur in this route. |

Independent billing review found missing GET current-context equality and success-Ping/save-fault misclassification. Expanded actual action/GET tests reproduced9 RED/23 PASS before those fixes (three success-save/receipt cases and six actor/company/missing-Auth route cases), followed by final34 GREEN including the preserved global analytics selected-company path.

Independent read-only final correction review found no concrete new regression in the separated provider/save outcomes, safe failure-save catch or both GET actor/company bindings. The reviewer did not execute or certify the34 tests or native/browser suites.

Integration page now avoids all four service-backed list reads when the actual actor/current guard/operational company do not match or no company is selected. The previous `safeListRows(null)` call omitted the company filter. This bounded mock regression does not claim a proven modern-session cross-tenant exploit. The same page uses current billing export/pricing write permissions for enabled controls and preserves its existing read permission for viewing.

## Executed receipts and precise limits

| Receipt | Actual result | Scope |
| --- | --- | --- |
| `billing-integration-action-outcome-20260930.test.ts` | Initial13 RED, then final18/18 PASS | Actual exported actions and actual page tree; controlled Auth/DB/Ping/processor/cache boundaries. Covers qualified success/failure, missing/wrong/zero rows, failed persistence, no Ping for missing row, safe error, provider-success/save-fault classification with no false second write, permission/actor/company denial before effects, counts, cache failure after confirmed persistence, readonly wrapper, no reads for invalid page scope and Next control-flow preservation. |
| `ops-download-route-outcome-20260930.test.ts` | Actual8 cases initially7 PASS/1 RED; after catch correction and current-context tests15/15 PASS | Real GET handlers, real query/getReportRows and real builder/CSV. Only outer Auth/database responses controlled. Exact body/filename/no-store, tenant run and item filters, foreign404, no read before access denial, canonical global path and generic query/builder500. |
| `analytics-download-native-navigation-20260930.test.ts` | Actual installed framework/control1 RED →1/1 PASS | Executes the unmodified installed Next `isModifiedEvent`/`linkClicked` functions against actual ReportsList element props, with controlled outer browser/router dependencies. Before fix: preventDefault+dispatch once. After fix: both0. This is not browser HTTP evidence. |
| Combined command, Node22 | 34/34 PASS,3 files | `npx vitest run --config vitest.config.ts __tests__/analytics-download-native-navigation-20260930.test.ts __tests__/billing-integration-action-outcome-20260930.test.ts __tests__/ops-download-route-outcome-20260930.test.ts` |
| Owned scoped ESLint | exit0,0 errors/warnings | All seven owned changed source files, three new unit tests, two OPS native files, browser file, plus the isolated F7 native fixture change. |
| `tsc -p tsconfig.tests.json --incremental false`; `tsc -p tsconfig.scripts.json --incremental false` | Both exit0 | Completed for preceding packet source before final download-prop/viewer-only changes. Root owns broad current-head typechecks; no stale broad PASS is promoted here. |
| `node --check e2e/browser/ops-effect-download-local.spec.mjs`; `git diff --check` | exit0 | Syntax/whitespace only. |
| OPS native config invocation without disposable stack/env | Startup refusal `ops_effect_disposable_ci_required`, exit1 | 0 native cases executed. Fail-closed prerequisite worked; not a native PASS. `command -v docker psql` returned neither tool. |
| Playwright `--list`, Chromium | 4 listed;0 executed | Enumeration does not certify screenshots, mobile, keyboard, requests, pending/double click or downloaded bytes. |

Installed primary framework sources consulted locally: `node_modules/next/dist/client/app-dir/link.js` and bundled Next Link docs `node_modules/next/dist/docs/01-app/03-api-reference/02-components/link.md` (download attribute native navigation). No web/provider request was performed to investigate this behavior.

## Prepared isolated native/browser lifecycle (NOT_EXECUTED)

New unique files: `scripts/ops-effect-browser-native.config.ts`, `scripts/ops-effect-browser-native.test.ts`, `e2e/browser/ops-effect-download-local.spec.mjs`. Parent owns existing workflow integration. No workflow was edited in this packet.

Use Node22 PATH prefix `/tmp/gridex-event-v2-node22-cache/_npx/52027bd8fc0022aa/node_modules/node/bin` locally (CI's supported Node22 equivalently). Existing native stack status file must describe API `http://127.0.0.1:54321`, Auth/Data API and PostgreSQL `54322`; the full clean/upgrade migration lifecycle must already be complete. Set `CI=true`, `GRIDEX_NATIVE_STATUS` to that status JSON, `RUNNER_TEMP` to the private runner directory, `GRIDEX_OPS_EFFECT_FIXTURE_PATH=$RUNNER_TEMP/ops-effect-browser-fixture.json`, and a new random private `GRIDEX_OPS_EFFECT_PASSWORD`. Do not log the password. Browser/Next server must already receive the local Supabase URL/anon/service keys from the established harness.

1. Seed: `npx vitest run --config scripts/ops-effect-browser-native.config.ts`.
2. Browser: set `GRIDEX_OPS_EFFECT_LOCAL_E2E=1`, run `npx playwright test e2e/browser/ops-effect-download-local.spec.mjs --config=playwright.config.mjs --project=chromium`.
3. Independent DB postcheck: set `GRIDEX_OPS_EFFECT_VERIFY_AFTER_BROWSER=1`, run the native command again.
4. Remove the private fixture and unset the new password/lifecycle variables using the parent harness cleanup.

The seed creates real GoTrue writer/read/denied users, active exact-company memberships/roles and canonical tenant-context assertions in two isolated test companies. It stores no password in the private mode0600 fixture. A and B have separate connection/event/export/metric rows; expected attachment bytes are independently derived from seeded SQL/literal business fields, not the production CSV builder. B's entire fixture graph is snapshotted and compared after browser work. Missing `api_key_header` has no environment fallback and deterministically rejects before constructing a Capway client or token/Ping request; no external dispatch is needed. All operating environments remain test.

Four authored browser cases check: real visible saved integration failure + exactly one POST after double click +0/1/0 reprocess counts/reload; readonly0 POST/mobile/keyboard/overflow; actual ReportsList click download plus direct billing URL exact filename/bytes/hash and foreign404; actual denied signed-in actor receives no attachment. Sanitized artifacts contain request paths/status/counts, error names, filenames/length/hash and screenshots, never passwords or response bodies. Native postcheck requires persisted safe A failure, A event attempt/review status/audit, unchanged B graph and test environments. These claims remain prepared until an actual harness receipt exists.

## F7 fixture-only continuation

Only `scripts/contract-authority-continuation-native.test.ts` changed in the already reviewed five-file F7 SQL packet: added a new permissionless company viewer role and actual ordinary-B/reverse-A `user_roles` rows. Canonical selected tenant context requires membership plus active role; membership alone could not establish the selected B context. The prepared test now explicitly verifies both selected contexts and absence of `contracts.archive` there before exact-target denied RPC/effect assertions. The other four F7 source/proof/report files and its independent PostgreSQL-core9/9 receipt are unchanged. This is a prepared-native prerequisite repair, not a native qualification.

Open terminal gaps: native/full clean history; real Next/RSC/browser pending/mobile/keyboard/download bytes and runtime consoles; external Ping success (not authorized/executed here); current billing legacy-download discoverability; full semantic denominator and all original U acceptance coverage. No static source family count closes any of these.

## Frozen fourteen-file integration/download packet manifest

- `app/admin/analytics/_components.tsx`
- `app/admin/analytics/deviations/page.tsx`
- `app/admin/analytics/forecast/page.tsx`
- `app/admin/analytics/export/route.ts`
- `app/admin/billing/integrations/actions.ts`
- `app/admin/billing/integrations/page.tsx`
- `app/admin/billing/export-center/[id]/download/route.ts`
- `__tests__/analytics-download-native-navigation-20260930.test.ts`
- `__tests__/billing-integration-action-outcome-20260930.test.ts`
- `__tests__/ops-download-route-outcome-20260930.test.ts`
- `scripts/ops-effect-browser-native.config.ts`
- `scripts/ops-effect-browser-native.test.ts`
- `e2e/browser/ops-effect-download-local.spec.mjs`
- `quality/audits/tenantservice-api-ops-20260928/continuation-20260930/ops-integration-download-outcome.md`

The separate five-file F7 SQL packet is not counted in this manifest. Shared form/pricing sources and all original frozen inventories were left untouched by this packet.
