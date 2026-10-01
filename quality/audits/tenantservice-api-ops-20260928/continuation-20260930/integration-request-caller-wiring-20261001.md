# P2/T51: eight reviewed server-ID callers

Date: 2026-10-01. This separately authorized continuation adds only explicit server-request-ID arguments to eight existing route files. The previous telemetry projection/authentication code remains unchanged. The current suite's one source-evolved route expectation is updated separately; preceding source/test/report bytes are retained as historical evidence.

## Preserved chain and actual reproduction

Before any wiring edit, `integration-request-correlation-pre-wiring-20261001.jsonl.gz` captured **16 complete files** from the preceding helper4, checkout5 and public-diagnostics7 packets. Each JSONL record contains the exact path, original SHA-256 and full base64 bytes. The deterministic gzip archive is 62,822 bytes with SHA-256 `0229c8eca3846223c9c9662a236ac92e774374fd7ea75d691f6345453310bff1`. All 16 decoded hashes were verified. Their old manifests and receipts remain valid historical snapshots; they do not describe the source after this continuation.

The preceding helper4 bounded independent OPS review matched all four then-current hashes and independently ran **108/108 PASS** at 05:34:18 Europe/Berlin (+02:00). That receipt qualified the then-unbound route behavior, not subsequent caller wiring.

The new unique actual-export suite's qualified baseline was **14 genuine RED / 8 controls PASS across 22 cases**. It executed the eight exact SHA-verified pre-wiring route exports extracted from the archive through isolated scratch Vitest aliases, with the current unchanged telemetry helper and complete outer fixtures. All 14 failures were missing top-level correlation or the unverified provenance expected from unbound calls. The eight scope-denial controls already passed. Shared production source was never rolled back for this baseline.

Earlier prototype attempts included a syntax/setup failure and incomplete positive fixtures (missing canonical empty-feed visibility, complete typed integration context and API-feed RPC response). Those failures are excluded from defect evidence. Two equivalent untracked wiring prototypes were also present during root's broad preview. Both were byte-preserved in `/tmp/billing-correlation-wiring-prototypes-20261001`; only the current `integration-request-caller-wiring-20261001.test.ts` remains in the repository. The older 29-case prototype is not counted as a second independent suite or receipt.

## Exact producer and caller changes

Each route creates its own current ID with unmocked `node:crypto.randomUUID()` or the existing `publicContractApi.requestId()` helper, whose body returns `randomUUID()`. None of these eight producer chains reads the incoming request-ID header. Every telemetry call in those route functions now passes that exact function-scoped ID explicitly, including existing authorization/error, cache, replay and success calls. No separate diagnostic ID is fabricated.

| Route file | Genuine producer | Explicit bindings |
| --- | --- | --- |
| `integration/context` | Local `randomUUID()` | 3 |
| `public-contracts/diagnostics` | Local `randomUUID()` | 3 |
| `website/public-contracts/diagnostics` | Existing `requestId()` → `randomUUID()` | 3 |
| `contracts` | Local `randomUUID()` | 4 |
| `website/public-contracts` | Existing `requestId()` → `randomUUID()` | 5 |
| `website/quote` | Local `randomUUID()` | 8 |
| `website/quote/validate` | Local `randomUUID()` | 4 |
| `website/customer-applications` | Local `randomUUID()` | 6 |

The total is **36 explicit bindings in eight files**. Removing just those inserted object properties reproduces each corresponding pre-wiring source file byte for byte. No public body/header generation, Auth/scope/tenant predicates, error classifier, idempotency capture, action ordering, readiness decision, rate limits, provider transport or historical payload is changed. The helper's source hashes remain `dd37e355…` and `bef0de85…` from helper4.

Only one case in the original nine-case telemetry suite changes: its actual integration-context route now expects the reviewed explicit ID in top-level persistence and `server_explicit` provenance. The other eight cases and their helper semantics are unchanged. The preceding complete nine-case source is in the archive.

## Current actual receipts and limits

New suite: **22/22 PASS**; new suite plus current original nine-case suite: **31/31 PASS**. Final related run: **130/130 PASS across seven files** (22 new cases plus the existing 108). Its Vitest start label was **05:59:39 process-local Europe/Berlin (+02:00)**, not UTC. Cases are not added together again as unique masterplan coverage.

The new suite executes all eight actual exports and the actual authentication adapter, current tenant-context creation, parsing/readiness/idempotency helpers, classifier, public projection/response helpers and telemetry writer. Outer authentication SQL, database/business/context/quote/intake adapters and Next persistence lifecycle remain controlled. The eight actual authenticated terminal-error paths preserve their original 500 codes and prove identical current body/header/log/top-level/metadata correlation despite UUID-shaped inbound text. Five actual positive GET paths qualify read-only or canonical-empty responses under complete outer fixtures. One real integration export invoked twice proves distinct current response/persistence IDs despite the same incoming UUID. Eight current scope-denial cases precede every business loader/effect and leave the unrelated idempotency fixture intact.

The source-reviewed 36 bindings also cover existing branches not individually executed by this new suite, such as cache 304 and some checkout success/replay branches. Those bindings are supported by exact source equality and the existing related tests, not relabeled as new native or complete branch-runtime receipts. The related frozen canary suites retain their actual paused-company/revoked/missing-token and installed early-Next controls.

```sh
NODE_PATH=/tmp/ediel-service-check/node_modules /tmp/ediel-toolchain/node_modules/node/bin/node node_modules/vitest/vitest.mjs run __tests__/integration-request-caller-wiring-20261001.test.ts __tests__/integration-request-correlation-20261001.test.ts __tests__/customer-portal-api-telemetry.test.ts __tests__/integration-ip-policy.test.ts __tests__/website-checkout-log-canary-20261001.test.ts __tests__/website-route-log-canary-20261001.test.ts __tests__/public-contract-diagnostics-log-canary-20261001.test.ts
/tmp/ediel-toolchain/node_modules/node/bin/node node_modules/typescript/bin/tsc --project /tmp/integration-request-caller-wiring-20261001.tsconfig.json
```

Focused TypeScript: exit 0 using a temporary root-extending config with plugins/incremental disabled and the two actual suites plus transitive sources. Scoped ESLint on eight routes plus two suites: exit 0, zero errors/warnings. Scoped whitespace check: exit 0. Snapshot integrity and exact source-only-binding reconstruction: PASS. No broad build or exact published-head CI receipt is claimed. Native durable telemetry, real browser, hosted API and provider execution counts here are **0**.

## Remaining internal and external boundaries

The current production AST inventory remains **80 direct telemetry calls**: **36 explicitly bound** by these eight reviewed producers and **44 unbound**. The previous report's zero-bound inventory is preserved as historical evidence. The 18 portal-telemetry wrapper calls and 25 success-wrapper calls still require their own producer/caller review; those counts are not silently added to or closed by this eight-route proof.

The partner modules and catchall reuse inbound IDs and are unchanged. UUID-shaped metadata remains opaque/unverified there; inbound values are never marked server-generated by this package. Other generated route/trace producers remain internal wiring work. Technical-metadata producer necessity, top-level route/IP/user-agent/idempotency/error-code bounds, inner malformed-publication diagnostics and automation/supplier-switch diagnostics remain separate internal review/proof work. No entire P2/T51/P7 closure is claimed. Historical diagnostics, invoice/document evidence and public contract bytes remain unchanged. Physical PDFs and actual external provider delivery remain their distinct external evidence boundaries.

## Current frozen continuation manifest

| Path | SHA-256 |
| --- | --- |
| `app/api/v1/integration/context/route.ts` | `1a1bcd79ff3924295378f1b7f9aed1206244d782ef6100eb475c1b4fdbe8caa9` |
| `app/api/v1/public-contracts/diagnostics/route.ts` | `d3b87893dc31cd38a0e74bf3e0ebe329df6662750058001e4dfac0d63bba5e44` |
| `app/api/v1/website/public-contracts/diagnostics/route.ts` | `a15a2358dd4888595a4966b85ac7ff6529d5cc81fd3055570ae7558b8a80671f` |
| `app/api/v1/contracts/route.ts` | `b3aeecef120c6c417eb82037db35e3789d82fbfa4d38ad8f964bcaf5746d12bd` |
| `app/api/v1/website/public-contracts/route.ts` | `b48a0e463e684ed8430fd30c3862e2d6444cba221bf253167393a2514288df4b` |
| `app/api/v1/website/quote/route.ts` | `b6b52c462d014ced25aaead931289e9e2c0a95365be5dd105925794fd51e3c6a` |
| `app/api/v1/website/quote/validate/route.ts` | `13794b5d80e63edfb6e39576c352938895c2ab05bde0f8cd70025675b4e029e4` |
| `app/api/v1/website/customer-applications/route.ts` | `275388b8adfdf9d20690119e564fa8b5203ddbbb019768802442855ec3653f92` |
| `__tests__/integration-request-correlation-20261001.test.ts` | `617ce57fb345f136fed7c50c75d294bb06d0997197f64900a0f629229ef29f5b` |
| `__tests__/integration-request-caller-wiring-20261001.test.ts` | `db24a6c930b30510977fdd81c64cb7569283e7c517f575f759bf7217370459bf` |
| `quality/audits/tenantservice-api-ops-20260928/continuation-20260930/integration-request-correlation-pre-wiring-20261001.jsonl.gz` | `0229c8eca3846223c9c9662a236ac92e774374fd7ea75d691f6345453310bff1` |

This report is the twelfth continuation file; its SHA is sent separately. Current bytes are frozen for bounded independent review, which is not yet counted as PASS.
