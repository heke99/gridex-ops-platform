# T51/P7: inner malformed-publication log boundaries

Date: 2026-10-01. This is a separate successor to the frozen terminal-diagnostic and eight-route server-correlation packages. Root captured their original bytes in immutable alternate-index tree `7235e532de9afa4282cdfdcfd71246d206fe4fb8` before authorizing these two inner-catch changes. The earlier manifests remain historical and are not rewritten or restaged as this newer source.

## Reproduced caller defect and correction

The actual API and website feed exports still passed a malformed publication's raw offer reference directly to their `console.error` inner rejection log. The already fixed terminal catches and generic request-metadata whitelist do not filter that independent console sink.

The qualified baseline was **2 RED / 8 controls PASS across ten actual-export cases**. Real API DTO price-option serialization rejects the malformed row with the existing HTTP 409 `PUBLICATION_RUNTIME_SCHEMA_MISMATCH`. Real website response/legal serialization rejects the malformed offer and the existing consistency wrapper returns HTTP 503 `PUBLIC_CONTRACT_FEED_INCONSISTENT`. Both reached the actual inner rejection console sink with the original combined customer/contact/credential canaries in `offerReference`. No mapper/classifier or console projection implementation was mocked. Auth/RPC/current configuration/publication readers are declared controlled outer boundaries.

The baseline first incorrectly expected the website's existing authorized affected-contract error details to omit its source reference. After correcting that assertion to preserve the exact existing response, the qualified run at **06:42:42 Europe/Berlin (+02:00)** failed only the two actual console-sink canary assertions. That initial incorrect public-response expectation is not an additional product defect or RED count.

Each inner log now omits its direct offer label, uses the frozen `technicalErrorDiagnostic` for a constant error name and strict technical database code, and uses the existing closed `classifyPublicContractsError` result for the structured public error code. `errorPath` is null. The known publication failure codes remain observable; they are not wrongly treated as SQLSTATE. All mapper/control-flow, rejected-row accounting, current tenant/actor permissions, source data, publication revision, cache/ETag and public payload behavior remain unchanged. The website's business `mappingIssues` object, including its original affected-contract references and diagnostic codes, is unchanged.

## Actual local receipts and qualifications

New suite: **10/10 PASS**. Related final command: **88/88 PASS across five files** at **06:46:50 process-local Europe/Berlin (+02:00)**, duration 5.36 seconds. Scoped TypeScript, ESLint with zero permitted warnings and scoped whitespace check exit 0. The temporary TypeScript config extends the current root, disables plugins/incremental, and includes this actual suite plus transitive source. The initial fixture typing of JSON enum strings was corrected to use the real typed price-option serializer before the final checks; no source behavior correction or fabricated runtime success is attributed to that test-only type failure.

Both positive controls use the actual mapper and canonical current fixture, retain full public DTO equality, publication revision/count, and matching generated response/header/top-level request correlation. Existing malformed-row HTTP classifications are independently asserted before the diagnostic sink assertions. Current missing scope and paused-company cases deny before tenant/revision/publication readers or console logging; missing credentials precede the Auth RPC and any persistence. Exact authenticated company/client and required route scopes are checked at the controlled adapter boundary, and current publication-revision reads remain company/channel filtered.

```sh
NODE_PATH=/tmp/ediel-service-check/node_modules /tmp/ediel-toolchain/node_modules/node/bin/node node_modules/vitest/vitest.mjs run __tests__/public-contract-mapping-log-canary-20261001.test.ts __tests__/public-contract-diagnostics-log-canary-20261001.test.ts __tests__/public-contract-canonical-model.test.ts __tests__/public-contract-route-openapi-regression.test.ts __tests__/integration-request-caller-wiring-20261001.test.ts
/tmp/ediel-toolchain/node_modules/node/bin/node node_modules/eslint/bin/eslint.js app/api/v1/contracts/route.ts app/api/v1/website/public-contracts/route.ts __tests__/public-contract-mapping-log-canary-20261001.test.ts --max-warnings 0
/tmp/ediel-toolchain/node_modules/node/bin/node node_modules/typescript/bin/tsc --noEmit -p /tmp/public-contract-mapping-log-canary-20261001.tsconfig.json
```

The exact source1 baseline route hashes were `b3aeecef120c6c417eb82037db35e3789d82fbfa4d38ad8f964bcaf5746d12bd` (API) and `b48a0e463e684ed8430fd30c3862e2d6444cba221bf253167393a2514288df4b` (website). Comparing those actual Git blobs with this candidate shows only the two inner console projection corrections; all other route bytes remain preserved. The generic telemetry/error helpers, request-ID producers, public contracts/generated artifacts and historical evidence are untouched.

## Frozen manifest and remaining boundaries

| Path | SHA-256 |
| --- | --- |
| `app/api/v1/contracts/route.ts` | `25a017043c10771fc8a2b6513abc215c606c58c18f0cdd50048a7dfdbb82c45d` |
| `app/api/v1/website/public-contracts/route.ts` | `1efc5ff12584dd3ca9204676e196a5fff339f5e89cf2a6f6da51e6acade0c6a0` |
| `__tests__/public-contract-mapping-log-canary-20261001.test.ts` | `c7f77efaf550a6471a1bb95e3072e1b5dc69b4fdc13ba6483b514e103a10b085` |

This report is the fourth file; its hash is sent separately. Source/test bytes are frozen for bounded independent review. Native database/Auth persistence, hosted API/browser and provider execution counts for this packet are **0**. No live provider, authority grant, invoice/document graph or historical row is changed.

The website's existing authorized response still returns `error.details.affected_contracts` with the malformed source reference in this synthetic boundary fixture. This package intentionally preserves and explicitly checks that response; it does not claim complete PII safety of public affected-contract diagnostics or qualifying those source references. Any stricter source-reference validation/public response revision is a separate internal proof/contract boundary. Other usage/request telemetry fields, original T51/P7 callers, native log durability and the remaining full masterplan stay individually OPEN or externally blocked as previously documented; these two corrected console sinks do not collectively close them.
