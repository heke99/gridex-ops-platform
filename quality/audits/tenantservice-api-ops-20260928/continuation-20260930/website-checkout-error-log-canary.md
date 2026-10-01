# T51/P7: actual website checkout diagnostic callers

Date: 2026-10-01. Root reserved precisely the three existing routes, one new actual-export test and this separate report. The preceding customer, website and secondary invoice logging packets remain frozen. This packet changes future diagnostic projections only; it does not edit API authentication, contracts, generated artifacts, SQL, provider transport, captured invoice requests or historical evidence.

## Actual defects and bounded correction

The initial actual exported-boundary suite reproduced **4 RED / 16 PASS**. Each of three valid authenticated route requests reached its current business loader, whose controlled outer database fault contained synthetic email, phone, full name, street, provider credential and Supabase-secret canaries. Each original unknown-error `console.error` logged that complete object. The fourth failure ran the actual customer-application handler through the actual intake implementation's early customer-type validation: its rejected caller value was interpolated into a free error message. The route passed that message as `errorCode` to the actual integration request telemetry writer. Its persisted-input `error_code` contained the canaries even though the canonical HTTP error was already controlled and the authoritative result code was `customer_type_invalid`.

The three unknown-error calls now project through the previously reviewed `technicalErrorDiagnostic`. Technical SQLSTATE (`23505` in these cases) and the existing server request ID remain; raw messages, details, hints and nested credential/customer objects are omitted. Application telemetry now takes the existing authoritative `result.body.code`, with fixed `website_application_error` fallback, instead of `result.body.error`. Its existing metadata/public result taxonomy, HTTP status, idempotency decisions and action order remain unchanged. This does not declare arbitrary strings safe merely because they resemble an error code.

| Actual exported handler | Unknown-error result preserved | Real current scope checked |
| --- | --- | --- |
| `POST /api/v1/website/quote` | 500 / `website_quote_failed` | `website_quotes.write` |
| `POST /api/v1/website/quote/validate` | 500 / `website_quote_validation_failed` | `website_quotes.validate` |
| `POST /api/v1/website/customer-applications` | 500 / `website_application_failed` | `website_applications.write` |

The checkout-readiness warning was separately traced and exercised through the actual readiness implementation. Its projection contains Boolean checks, fixed check names, fixed blocker codes and the existing two-value portal-identity mode. Free company metadata, branding and automation warning text do not reach it. The real blocked-readiness control passed, so that warning and its useful blocker codes were preserved.

## Actual local verification

Final new suite: **25/25 PASS**. Final related command: **56/56 PASS across eight files**, including the 25 new cases and 31 existing quote projection/persistence, application payload/settlement/readiness and telemetry/idempotency cases. Existing static contract cases remain static; their success is not promoted to native or HTTP execution.

The new suite invokes all three actual exported route functions with the real API-access adapter, current tenant-context checks, canonical response helper, payload parser and integration telemetry writer. Auth RPC results and schema readiness are controlled outer boundaries. The quote route uses the real idempotency helper against a memory database adapter implementing insert-returning and exact update predicates; its unknown fault marks the current claim failed while a foreign original row remains unchanged. Classified quote failure retains its completed 422 receipt and taxonomy. Quote-validation's classified rejection retains its code, field, status and message without entering unknown-error logging.

Each route has separate current scope, paused-company, missing-token and revoked-token controls. They deny before readiness/business loaders/idempotency effects. Missing credentials deny before Auth RPC and tenant telemetry. The actual application tenant binder rejects a foreign company claim before intake; the actual two quote parsers reject caller company fields before their loaders. Three installed Next redirect signals from actual authorization propagate unchanged without diagnostic/business effects. The application readiness implementation executes with controlled database/operation/automation adapters, and the exact submitted application fixture passes the actual schema and nested-field validators before its loader fault. Only the explicit early-validation case runs the actual intake implementation; a synthetic commercial fixture is not a claim of native legal/quote acceptance or successful application provisioning.

HTTP body request/correlation IDs and `X-Request-ID` agree with the server diagnostic ID and existing telemetry `metadata.request_id`. The generic telemetry writer's top-level `request_id` still derives from inbound `x-request-id`; this packet makes no claim to repair that separate internal gap. All canaries are synthetic. No external provider or network call ran.

Commands from the repository root with cached Node 22:

```sh
/tmp/ediel-toolchain/node_modules/node/bin/node node_modules/vitest/vitest.mjs run __tests__/website-checkout-log-canary-20261001.test.ts __tests__/public-website-quote.test.ts __tests__/website-quote-persistence-invariant.test.ts __tests__/website-application-payload-field-contract.test.ts __tests__/website-application-settlement-contract.test.ts __tests__/usage-event-and-integration-idempotency.test.ts __tests__/website-quote-validate-contract-parity.test.ts __tests__/website-application-readiness-boundary.test.ts
/tmp/ediel-toolchain/node_modules/node/bin/node node_modules/eslint/bin/eslint.js app/api/v1/website/quote/route.ts app/api/v1/website/quote/validate/route.ts app/api/v1/website/customer-applications/route.ts __tests__/website-checkout-log-canary-20261001.test.ts
```

Scoped ESLint: exit 0. Focused TypeScript: exit 0 using a temporary config extending current `tsconfig.json`, disabling plugins/incremental and including `next-env.d.ts` plus this unique test and transitive actual source. Scoped diff whitespace check: exit 0. These are local candidate receipts, not an exact published-head CI, whole-app build, native persistence or browser receipt. Native/browser/provider cases executed for this packet: **0**.

## Frozen source/test manifest

| Path | SHA-256 |
| --- | --- |
| `app/api/v1/website/quote/route.ts` | `6df6496ae0628a367aa999632c28cd5471ede25dd5d64b75ef8ec4ee71bb1652` |
| `app/api/v1/website/quote/validate/route.ts` | `6197f11bd9a54b28a0d0d7e7fcce505157af79ea1b5fa10a030d9fe14dfd6ce7` |
| `app/api/v1/website/customer-applications/route.ts` | `a08d166935e68ee9228db566fcd8573c05c7f32bdd5f284e79327bc90180e5d5` |
| `__tests__/website-checkout-log-canary-20261001.test.ts` | `95f44863b99f58d95eecdc270f8e3dd99825cb0b03b829d428f65619ca103a08` |

This is the fifth file; its hash is sent separately to root. These four source/test bytes are frozen for bounded independent source review. Scheduling a review is not a completed independent receipt.

## Remaining internal work and exact external boundaries

This correction qualifies these three unknown-error diagnostic callers and the reproduced free-message-to-error-code path. T51/P7 remains open for the previously inventoried generic telemetry identifiers/metadata, other automation and supplier-switch callers, any remaining application/quote diagnostic metadata not exercised here, and native new-diagnostic persistence. Those are separate internal implementation/proof work, not blanket external blockers. Historical rows were not rewritten. Remote provider diagnostics, physical document bytes and actual customer delivery still require their corresponding external adapters/evidence; this local correction does not qualify them or the entire original masterplan.
