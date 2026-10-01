# T51/P7: actual website error callers, continuation

Date: 2026-10-01. This separate packet extends the frozen `customer-error-log-canary.md` correction. Its original ten file hashes remain unchanged. Root authorized precisely these five existing routes after actual exported-boundary RED evidence. No historical contract, generated artifact, SQL, workflow, provider transport or reference was changed.

## Reproduced defects and correction

The original exported handlers logged an entire unknown database/provider object. Synthetic email, phone, full name, street, opaque provider key and Supabase-secret canaries reached `console.error`, although their HTTP error messages were already controlled. The new test first reproduced five leaking callers plus an independent portfolio correlation defect: **6 RED / 5 existing denial controls PASS**. The portfolio route created a trace for its log and telemetry, while the actual canonical response helper generated a different request ID because the route supplied only `error.trace_id`.

Each unknown-error log now uses the already reviewed `technicalErrorDiagnostic` projection. Valid technical SQLSTATE remains available (`23505` in the canary); free message/details/hint and nested customer/provider material never enter these diagnostic calls. Existing controlled public code, message and HTTP status remain intact. Portfolio's current error response supplies the same server-created trace as canonical `request_id` and `correlation_id`, retaining its existing `error.trace_id`; the actual response helper's `X-Request-ID` and request telemetry now agree. No caller-provided identifier is promoted to a trusted trace.

| Actual exported caller | Unknown-error HTTP/code | Current permission checked by the real adapter |
| --- | --- | --- |
| `GET /api/v1/website/switch-status` | 500 / `switch_status_unavailable` | `website_switch_status.read` |
| `GET /api/v1/website/legal-bundle` | 503 / `legal_bundle_unavailable` | either `website_legal.read` or `website_contracts.read` |
| `GET /api/v1/website/portfolio-prices` | 500 / `portfolio_prices_unavailable` | `website_contracts.read` |
| `POST /api/v1/website/market-price/current` | 500 / `market_price_provider_unavailable` | `website_market_prices.read` |
| `POST /api/v1/website/energy-area/resolve` | 500 / `energy_area_resolution_failed` | `website_energy_area.resolve` |

## Actual local receipts

Final unique suite: **26/26 PASS** after the final test-only type annotation. Each of five real exported handlers runs the actual `requireIntegrationApiAccess`, response context, tenant-context binding and `customerPortalJson`. Its Supabase authentication RPC/schema-readiness and business loader are controlled outer boundaries. The positive fault case verifies the exact current scope RPC arguments and that the invoked loader receives the company from authenticated client authority. Four separate cases per route verify scope denial (403), current paused-tenant denial (423), missing credential rejection before Auth RPC/telemetry/loader (401), and current revoked-token denial from the real Auth adapter (401), all before loader or unknown-error logging. The additional portfolio case compares actual body request/correlation ID, header, log and persisted-telemetry input.

The expanded suite and five related existing real-export/contract suites passed **42/42 across six files**. Scope checks are not implemented by an API-auth mock. The allowed/denied decision is still supplied at the database RPC boundary: this does not qualify native Auth SQL, a browser, a provider connection or physical delivery. The canaries are synthetic only.

Commands, from repository root with cached Node 22:

```sh
/tmp/ediel-toolchain/node_modules/node/bin/node node_modules/vitest/vitest.mjs run __tests__/website-route-log-canary-20261001.test.ts
/tmp/ediel-toolchain/node_modules/node/bin/node node_modules/vitest/vitest.mjs run __tests__/website-route-log-canary-20261001.test.ts __tests__/external-pricing-boundary.test.ts __tests__/portal-supplier-switch-status.test.ts __tests__/market-price-api-contract.test.ts __tests__/website-legal-reference-contract.test.ts __tests__/public-contract-route-openapi-regression.test.ts
/tmp/ediel-toolchain/node_modules/node/bin/node node_modules/eslint/bin/eslint.js app/api/v1/website/switch-status/route.ts app/api/v1/website/legal-bundle/route.ts app/api/v1/website/portfolio-prices/route.ts app/api/v1/website/market-price/current/route.ts app/api/v1/website/energy-area/resolve/route.ts __tests__/website-route-log-canary-20261001.test.ts
```

Scoped ESLint: exit 0. Focused TypeScript: exit 0 using a temporary config extending current `tsconfig.json`, disabling plugins/incremental and including `next-env.d.ts` plus the unique test and its transitive actual source. `git diff --check`: exit 0. This is not a whole-app type/build or exact published-head CI receipt. No native/browser/provider case ran for this packet.

## Frozen source/test manifest

| Path | SHA-256 |
| --- | --- |
| `app/api/v1/website/switch-status/route.ts` | `4eed3def194d94271f119a9169a9b6584daf5df66efe27f3661b07b56680eb07` |
| `app/api/v1/website/legal-bundle/route.ts` | `edfd07bae9050dd455d2d09e661567505850b3b0780134a5d2c4404d344c5ca0` |
| `app/api/v1/website/portfolio-prices/route.ts` | `4e75ef8a705f3c1c4cd042133da3b7f642a9eba67216569125328cea90d92c3f` |
| `app/api/v1/website/market-price/current/route.ts` | `3ec417b9a192c58bb2ae34c22a7f3b5db3fc69fcbb2854d4c2440e9ddedf2377` |
| `app/api/v1/website/energy-area/resolve/route.ts` | `67b583abac51e46e21b04cbc068ad5820a14ee5fb51e380ac60826e8adf77108` |
| `__tests__/website-route-log-canary-20261001.test.ts` | `b05aede07c32b2080d0cd7034c1b22ccbb78eb013bc7186e935a0b15e845399f` |

This report is the seventh file; its hash is provided separately to root to avoid a self-referential hash. These six source/test bytes are frozen pending independent review. No independent execution is inferred from review scheduling.

Independent review completed by OPS UI owner on these six exact source/test hashes: bounded source/authority/error/correlation review PASS and independently executed the above six-file command **42/42 PASS**, including all 26 new cases. This is a separate execution receipt, not additional unique cases. Its precise telemetry qualification is `metadata.trace_id` consistency with body/header/log; the generic telemetry writer's top-level `request_id` still derives from inbound `x-request-id`. The route correction does not claim to rewrite that existing field. No native/browser/provider or whole-T51 acceptance follows from this review.

## Exact remaining boundary

This qualifies only these five unknown-error diagnostic paths and their current local adapter ordering. T51/P7 is not globally closed: the preceding report retains the explicit inventory of other raw invoice/export, automation/supplier-switch and generic-metadata callers. This correction does not retroactively scrub historical diagnostic rows, change financial/GUID/captured request evidence, or qualify remote provider logs, physical PDF bytes, native diagnostic persistence, real identified-phone authority or external delivery.
