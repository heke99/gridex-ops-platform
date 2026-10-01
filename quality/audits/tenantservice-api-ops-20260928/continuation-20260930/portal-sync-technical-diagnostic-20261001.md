# P2/T51: portal-sync technical diagnostic producer

Date: 2026-10-01. Root authorized this separate, previously untouched portal-sync route, a unique actual-export regression suite and this report. The frozen count3, eight-route wiring, checkout/public-diagnostic packets and generic telemetry/error helpers remain unchanged. This is a correction to technical observability and removal of unnecessary raw producer metadata that the existing sink already filtered; it is **not a newly established PII leak**.

## Actual reproduction and bounded change

The actual `POST /api/v1/customer-portal/sync` catch serialized the original error's free name/message/code/details/hint into `metadata.portal_sync_error`. The closed telemetry projection already dropped that entire structured field. It consequently also lost a genuine SQLSTATE/PostgREST code that the existing projection permits under `database_code`.

The qualified actual-export baseline was **5 RED / 13 controls PASS across 18 cases**. Three failures lost `42P01`, `42703` or `PGRST204` after current API authorization and the actual idempotency helper's insert failed. Two failures lost the primary `42P01` after a real claim succeeded and a current-company subject read failed, with either a successful or failed subsequent own-record failure update. Each RED was the missing technical code in the actual integration-request writer payload. An earlier setup pass incorrectly expected the old mocked response shape and paused status; those assertions were corrected to the actual canonical nested error and existing HTTP 423 before the qualified baseline. Those initial setup failures are excluded from the defect count.

Production changes are one import of the already frozen `technicalErrorDiagnostic`, removal of the now-unused raw serializer, and replacement of that catch's structured metadata with `database_code: diagnostic.code`. The generic sink remains closed and unchanged. Free provider labels, customer/credential canaries and embedded SQLSTATE text yield no technical code. Already filtered raw messages/details/hints are no longer unnecessarily constructed at this producer. No public message, HTTP/error taxonomy, source identity metadata, customer matching/revocation behavior, idempotency semantics or authorization policy changes.

The prior full route SHA is `7db24fc31ad097d70fb242b6050f04bafc03fa38e0ef59b39253d514baaf149e`. Reversing only the import, removed serializer and two catch projection lines reproduces that full HEAD route byte for byte. The preceding source-only inventory remains historical, rather than being relabeled as current after this correction.

## Actual receipts and limits

New suite: **18/18 PASS**. Related command: **40/40 PASS across five files**, including existing sync revocation, controlled input errors, header parity and current request-correlation cases. Final Vitest start: **06:34:33 process-local Europe/Berlin (+02:00)**. Focused TypeScript, scoped ESLint with zero permitted warnings and scoped whitespace check all exit 0. Receipt preparation observed `2026-10-01T04:34:57Z` from the system UTC clock.

The new suite invokes the actual exported route, actual API-access adapter and tenant-context builder, strict JSON/header validation, real claim/replay/failure/completion idempotency helpers, real tenant-bound query wrapper, canonical public response and actual telemetry projection/writer. Current Auth/RPC and database results are controlled outer adapters. The actual RPC call is checked for the existing `customer_sync.write` requirement and exact route; synthetic current company/client values come from that returned adapter row. All subject reads check current company and exact portal identity/account predicates. This does not establish native RPC authorization or database durability.

The qualified cases check the actual idempotency insert's authenticated company/client, null customer, existing route/key, real canonical payload SHA-256 and processing state. After a claimed subject-read fault, failure updates retain exact own record/company and the original public error code. A secondary failure-save fault preserves the primary classification. No identity upsert occurs in these fault cases. Canary-absence controls also passed before the correction, consistent with the already closed sink.

Other controls retain the existing database-revocation-to-409 classification, current subject revalidation before completed linked replay, no replay identity/completion rewrite, and genuine rejected/access-denied result plus the matched completed idempotency receipt for insufficient identity factors. Current missing scope, paused tenant and revoked client adapters deny before idempotency/identity access. Missing credentials deny before Auth RPC or any persistence. Header/payload subject mismatch and malformed JSON retain existing status/code and precede idempotency writes. Framework control-flow behavior and the Auth prefix are untouched; no new inner-catch control-flow acceptance is claimed.

```sh
NODE_PATH=/tmp/ediel-service-check/node_modules /tmp/ediel-toolchain/node_modules/node/bin/node node_modules/vitest/vitest.mjs run __tests__/portal-sync-technical-diagnostic-20261001.test.ts __tests__/customer-portal-sync-revocation.test.ts __tests__/portal-controlled-input-errors.test.ts __tests__/customer-portal-sync-header-parity.test.ts __tests__/integration-request-correlation-20261001.test.ts
/tmp/ediel-toolchain/node_modules/node/bin/node node_modules/eslint/bin/eslint.js app/api/v1/customer-portal/sync/route.ts __tests__/portal-sync-technical-diagnostic-20261001.test.ts --max-warnings 0
/tmp/ediel-toolchain/node_modules/node/bin/node node_modules/typescript/bin/tsc --noEmit -p /tmp/portal-sync-technical-diagnostic-20261001.tsconfig.json
```

The temporary TypeScript configuration extends the current root, disables plugins/incremental and includes the actual suite plus transitive source. Generic telemetry helper hashes remain `dd37e355…` and `bef0de85…`. Native persistence, full-stack/browser, real customer issuer, hosted API and provider execution counts for this packet are **0**. No sender, provider/GUID, invoice/financial graph, historical row, public contract/generated artifact, grant or global Auth change is included.

## Frozen manifest and exact remaining boundaries

| Path | SHA-256 |
| --- | --- |
| `app/api/v1/customer-portal/sync/route.ts` | `ad4ff87f7214919a559b7794064cb65e9f2206618b3b0cba2e0b021eac491fb1` |
| `__tests__/portal-sync-technical-diagnostic-20261001.test.ts` | `2ba56940ef42ed155089873ae77b50661aff84d9931dbb5f96deb7213eb26696` |

This report is the third file; its hash is sent separately. Source/test bytes are frozen for independent review. This route's telemetry still has no reviewed explicit server UUID binding; its existing response ID is not promoted from an inbound header or invented at the logging sink. That request-correlation gap stays internal OPEN. Applications producer cleanup remains separate and its frozen route is untouched. Other T51/P7 callers, native diagnostic durability and the remaining P2/masterplan scope remain independently tracked; this packet does not close them collectively.
