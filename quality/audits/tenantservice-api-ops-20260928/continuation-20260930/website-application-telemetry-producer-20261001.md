# P2/T51/P7: application diagnostic metadata minimization

Date: 2026-10-01. Root authorized removal of exactly `external_customer_id` and `customer_number` from this existing diagnostic producer after capturing its prior bytes in immutable tree `7235e532de9afa4282cdfdcfd71246d206fe4fb8`. This package is separate from the frozen eight-route request-ID wiring and inner-mapping log correction. It does not rewrite their historical receipts or claim a new general privacy/security defect.

## Exact producer and separate sink trace

`applicationMetadata` feeds both `logIntegrationApiRequest` and `scheduleUsageEvent`. The already closed generic integration-request metadata projection drops these two free customer-label fields. The separate usage helper's `usageRow` previously retained that metadata object in `platform_usage_events`; it does not use the generic request whitelist. Therefore the prior inventory's already-filtered qualification applies to the generic request sink only, and must not be extended to the separate usage sink.

The exact production change is deletion of those two metadata fields. Count, application UUID and original technical outcome fields remain. Request parsing, current Auth/tenant/readiness, raw intake payload, idempotency key, actual customer/resource IDs, billing semantics and authorized public customer references remain unchanged. No helper, historical row, customer/domain payload or API contract is edited.

The qualified **producer-minimization baseline was 2 RED / 4 controls PASS across six actual-export cases** at **06:51:54 Europe/Berlin (+02:00)**. Success and controlled failure both retained the unnecessary label keys in the actual usage writer's payload while the generic request payload was already filtered. These are structural diagnostic-minimization assertions with synthetic customer references, not evidence of a hosted disclosure, a new generic-request PII leak or a native privacy test.

An initial missing test-function closing brace executed zero cases. A subsequent fixture assertion incorrectly expected foreign-payload rejection before current-company readiness; it was corrected to the existing order, which performs current-company readiness before rejecting the foreign payload and never invokes intake. Those setup/assertion errors are excluded from the two qualified RED cases. Production order is unchanged.

## Actually executed receipts

New suite: **6/6 PASS**. Final related command: **62/62 PASS across four files** at **06:54:05 process-local Europe/Berlin (+02:00)**, duration 4.05 seconds. Scoped TypeScript, scoped ESLint with zero permitted warnings and scoped whitespace check exit 0. The temporary TypeScript config extends the current root, disables plugins/incremental, and includes this actual suite plus transitive source. Receipt preparation read system UTC `2026-10-01T04:54:26Z`.

The actual exported POST, API access adapter/context, current readiness builder, strict application parser, tenant binder, public DTO/response, integration request writer/projection, `scheduleUsageEvent`, `logUsageEvent` and `usageRow` execute. Current Auth RPC, configuration/policy/automation results, intake and database are explicit controlled outer adapters. The usage scheduling/writer implementation is not mocked. Outside-request `after` failure intentionally exercises the existing awaited fallback for both secondary sinks. No actual customer signup or database/provider call occurs.

The positive case preserves full canonical public DTO equality and the original customer number/external reference. The intake sees the unchanged raw payload, current client/company and original idempotency key. Both diagnostic sinks omit the two labels. The usage event retains authoritative customer/application UUID columns, current company/client, original created event/billing unit and billable status; the request event retains count/application UUID and matching reviewed server-generated body/header/top-level request ID. The controlled failed-intake case retains HTTP 422, canonical error code, nonbillable failed event, null resource IDs and original technical stage/field/code.

Current missing scope and paused-company adapters deny before readiness/intake/usage persistence. Missing API credentials deny before the Auth RPC or any read/write. A foreign payload is rejected before intake after current-company readiness, with the diagnostic company/client remaining canonical and no usage event. These adapter cases are not native enforcement of the SQL Auth/policy/readiness boundary.

```sh
NODE_PATH=/tmp/ediel-service-check/node_modules /tmp/ediel-toolchain/node_modules/node/bin/node node_modules/vitest/vitest.mjs run __tests__/website-application-telemetry-producer-20261001.test.ts __tests__/website-checkout-log-canary-20261001.test.ts __tests__/integration-request-caller-wiring-20261001.test.ts __tests__/integration-request-correlation-20261001.test.ts
/tmp/ediel-toolchain/node_modules/node/bin/node node_modules/eslint/bin/eslint.js app/api/v1/website/customer-applications/route.ts __tests__/website-application-telemetry-producer-20261001.test.ts --max-warnings 0
/tmp/ediel-toolchain/node_modules/node/bin/node node_modules/typescript/bin/tsc --noEmit -p /tmp/website-application-telemetry-producer-20261001.tsconfig.json
```

Removing precisely those two fields from the actual source1 route blob (SHA `275388b8adfdf9d20690119e564fa8b5203ddbbb019768802442855ec3653f92`) yields the entire current route byte for byte. The frozen generic helper hashes remain `dd37e355…` and `bef0de85…`; no Auth prefix or request-ID binding changed.

## Frozen manifest and remaining work

| Path | SHA-256 |
| --- | --- |
| `app/api/v1/website/customer-applications/route.ts` | `77203eeac9a41140b200591bbbdbe46b3d1a4d80742ecba24baf29e5d9a9486c` |
| `__tests__/website-application-telemetry-producer-20261001.test.ts` | `512c4fcb65f8c3ed7b8d429cab16bbbd33b58323569ee5ef67a8fe24eac06d35` |

This report is the third file; its hash is sent separately. Source/test bytes are frozen for bounded independent review. Native persistence, real browser, hosted Auth/customer issuer/API and provider execution counts are **0**. No broad app/build/CI, complete signup, historical telemetry cleanup or whole T51/P7/P2 acceptance is claimed.

Other `applicationMetadata` technical fields remain derived from the existing intake outcome. The generic request projection bounds them; their separate usage-sink producer bounds remain a distinct internal review task. Likewise, `actionLogger.ts` still has source-visible raw returned/thrown database error console/failure-queue paths; this package does not reserve or edit that helper. Remaining producer/request-correlation, log necessity, native durability and all other original masterplan requirements retain their individual OPEN/external boundaries.
