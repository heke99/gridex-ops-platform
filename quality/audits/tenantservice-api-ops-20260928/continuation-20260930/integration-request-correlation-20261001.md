# P2/T51: authoritative integration request correlation and bounded metadata

Date: 2026-10-01. Root reserved only the diagnostic signature/projection in `lib/integrations/apiAuth.ts`, the new projection module, the unique actual-caller suite and this report. Previously frozen website, checkout and public-contract routes are unchanged. No authentication, token, tenant, permission, rate policy, SQL, public response, provider transport or historical diagnostic row changes.

## Actual RED and resulting behavior

The actual helper previously copied inbound `X-Request-ID` into the persisted top-level `request_id` and persisted arbitrary caller metadata unchanged. Its genuine baseline was **7 RED / 2 controls PASS across nine cases**. Synthetic email, phone, full name, street and provider/Supabase credential canaries reproduced the inbound-ID and free-metadata propagation. Deferred persistence also retained the caller's mutable metadata object. The two passing controls were no manufactured identifier for an unbound caller and the existing anonymous-401 no-target behavior.

The helper now accepts an optional explicit `serverRequestId`, supplied only by source-reviewed server code that genuinely generated the current request identifier. Strict UUID syntax is a format boundary, not proof of generation, uniqueness, identity or tenant authority. Headers and metadata are never promoted into that argument or into authoritative top-level correlation. An invalid explicit argument leaves the top-level field null; it never falls back to inbound text or creates an unrelated identifier.

| Input available | Persisted top-level `request_id` | Diagnostic metadata |
| --- | --- | --- |
| Valid explicit server argument | That exact argument | Same `request_id`; fixed `request_id_source=server_explicit` |
| No valid explicit argument; UUID-shaped metadata ID | null | Original opaque ID; fixed `request_id_source=unverified_metadata` |
| Neither | null | Fixed `request_id_source=unavailable`; no manufactured metadata ID |

A valid explicit argument overrides contradictory metadata. Caller-provided provenance is ignored. Retained UUID-shaped metadata identifiers provide diagnostic correlation only, without attesting their origin, ownership or authority. Existing UUID metadata readers keep the same `request_id` key; no field is renamed.

The new projection copies only a bounded scalar technical whitelist before `after()` schedules the write: safe nonnegative integer counts (or existing null count semantics), booleans, strict UUID diagnostic identifiers, closed source-traced enums and operation labels, existing known public error codes and the previously reviewed technical database-code namespace. Known keys also reject arbitrary free strings. Tenant/client authority, status and error taxonomy still come from the existing helper inputs and existing authorization flow. Metadata cannot replace those fields.

Producer trace found 33 closed operation labels: the four partner modules' literal labels, the `contract.get`/`contract.status` conditional labels and the catchall's `webhook.create.preflight`. The two current bundle access modes are also closed labels. Unknown keys, free error detail/path, source offer/quote/application references, portal-sync error text and customer-provided external identifiers are omitted from new diagnostic metadata. Structured metadata and unreviewed fingerprint/ETag/time/provider labels are not inferred safe. This is a deliberate bounded diagnostic projection, not a new public API policy.

## Actual receipts and execution limits

Final unique suite: **9/9 PASS**. Final related command: **108/108 PASS across six files**, including the nine new cases, four existing actual portal-telemetry cases, four IP-policy cases and the 91 frozen website/checkout/public-terminal canary cases. The final Vitest start label was **05:27:39 process-local Europe/Berlin (+02:00)**; it is not labeled UTC. A contemporaneous explicit clock check returned `2026-10-01T03:28:08.776063+00:00`.

The unique suite executes the actual exported telemetry writer. One case also executes the frozen real `GET /api/v1/integration/context`, actual current API-access adapter, tenant-context binding, classifier and canonical body/header helper. Authentication RPC, schema/business-context boundaries, outer database persistence and the Next scheduling lifecycle are controlled. The frozen route's actual generated body/header/log/metadata ID remains the same while its unbound top-level telemetry ID is null. A separate direct helper case uses `randomUUID()` in its server caller and the actual canonical response helper to prove explicit body/header/persistence agreement despite contradictory header/metadata UUIDs. That direct helper case does not qualify any existing production caller as wired.

Additional cases prove unknown/free known-field rejection, authenticated client/company/status preservation, invalid-ID handling, capture before delayed persistence/caller mutation, and anonymous 401 skip before any schedule/write. The related frozen suites execute their existing current scope, paused company, revoked token and missing-credential denial controls. Their native or provider qualification does not increase from this run.

Commands from repository root with cached Node 22:

```sh
NODE_PATH=/tmp/ediel-service-check/node_modules /tmp/ediel-toolchain/node_modules/node/bin/node node_modules/vitest/vitest.mjs run __tests__/integration-request-correlation-20261001.test.ts __tests__/customer-portal-api-telemetry.test.ts __tests__/integration-ip-policy.test.ts __tests__/website-checkout-log-canary-20261001.test.ts __tests__/website-route-log-canary-20261001.test.ts __tests__/public-contract-diagnostics-log-canary-20261001.test.ts
/tmp/ediel-toolchain/node_modules/node/bin/node node_modules/eslint/bin/eslint.js lib/integrations/apiAuth.ts lib/integrations/integrationRequestTelemetry.ts __tests__/integration-request-correlation-20261001.test.ts
/tmp/ediel-toolchain/node_modules/node/bin/node node_modules/typescript/bin/tsc --project /tmp/integration-request-correlation-20261001.tsconfig.json
```

Focused TypeScript: exit 0, temporary config extends the current root config, disables plugins/incremental and includes `next-env.d.ts` plus the unique suite's transitive actual source. Scoped ESLint: exit 0, **zero errors and three existing unused-function warnings** in unchanged `apiAuth.ts` authentication helpers. Scoped whitespace check: exit 0. The complete authentication prefix before `logIntegrationApiRequest` is byte-equal to HEAD after excluding only the new projection import. All eight preceding frozen route hashes were independently recomputed and equal their recorded manifests. No whole-app build or exact published-head CI result is claimed. Native database, real browser, hosted API and provider execution counts for this packet are **0**.

## Exact existing-caller boundary

A current TypeScript-AST inventory of `app/` and `lib/` found **80 direct production call expressions** to `logIntegrationApiRequest`; the often reported 81 textual matches include its declaration. **Zero** current production calls provide an explicit `serverRequestId`. Among these calls, 46 contain a literal metadata `request_id`, one contains only a literal `trace_id`, and 33 have no literal request-ID binding (including variable metadata/input). There are also 18 `logPortalRequestTelemetry` calls and 25 `logCustomerPortalSuccess` calls; these wrapper counts are not additional proven server-ID bindings.

Accordingly, current production top-level telemetry correlation remains intentionally unbound/null until each real producer and caller is reviewed and explicitly wired. Existing generated route IDs retained in metadata are marked unverified at this generic boundary. The four partner request-ID helpers can reuse inbound text, and the webhook-preflight caller does the same; their public body/header policy remains untouched and separately unverified. No parent provenance marker or UUID shape establishes generation for those callers.

Top-level route, IP, user agent, idempotency key and the existing `input.errorCode` are unchanged. Their necessity, source bounds and any raw-PII/error taxonomy risk remain separate internal review/proof work. The unchanged telemetry writer still treats persistence as secondary and does not establish native durable success here. No historical row is rewritten. The earlier automation/supplier-switch and inner malformed-publication diagnostics remain separate internal work. This four-file packet does not close all P2/T51/P7 or the masterplan; real provider delivery and physical PDF-byte boundaries remain distinct.

## Frozen source/test manifest

| Path | SHA-256 |
| --- | --- |
| `lib/integrations/apiAuth.ts` | `dd37e355065a302f3ed18f75639111a552e8f27a564c59b178b0e855f3a2ea69` |
| `lib/integrations/integrationRequestTelemetry.ts` | `bef0de85e2f342399670739b942d3b06e27617c3648f0745f213884cadb66af9` |
| `__tests__/integration-request-correlation-20261001.test.ts` | `3618dbc8af5fe47a9b21b1623074ad26728cb44daebc7e4b11d6cec7b47a7156` |

This report is the fourth file; its SHA is sent separately. These source/test bytes are frozen for bounded independent review. Pending review is not an independent PASS receipt.
