# T51/P7: actual public-contract terminal diagnostic callers

Date: 2026-10-01. Root reserved the five existing API routes, this new actual-export suite and this report. The preceding logging and checkout packets remain frozen. Scope is future terminal-error diagnostics; no shared classifier, API authentication, public contract, generated evidence, SQL, provider transport or historical row is changed.

## Actual reproduction and correction

The genuine initial reproduction was **15 RED / 25 controls PASS across 40 cases**: each of five real exported GET handlers was exercised with a `23505` fault, a `42P01` schema fault and an arbitrary provider-code fault after its actual current API-access adapter and tenant binding. The context loader is a controlled outer business boundary. Three handlers logged the entire error object; the two contract-feed handlers logged its arbitrary name/path. The real classifier also forwards an arbitrary `record.code` as `databaseCode`, so every affected caller could persist that free text in diagnostic telemetry. Synthetic email, phone, full name, street and opaque provider/Supabase credential canaries reproduced these leaks. Public error status/code/message remained controlled.

An earlier setup attempt failed because its test database adapter lacked the actual authentication adapter's `last_used_at` update. That setup failure was corrected and is not counted as RED evidence. The adapter now explicitly permits only the real current client-ID update, publication revision reads and diagnostic telemetry inserts before the genuine above reproduction.

Each terminal catch now computes the previously reviewed `technicalErrorDiagnostic`. Its `databaseCode` and persisted `metadata.database_code` use only that strict technical namespace. The three raw objects are replaced by this bounded diagnostic. The two contract feeds retain their existing diagnostic keys with null error path and fixed technical classification in the error-name field; `metadata.error_path` is also null. Arbitrary names, paths and provider codes are not inferred safe from their syntax. Valid SQLSTATE remains available.

The actual public classifier still determines the existing HTTP status, public error code and message. It is unchanged. No response ID, trace/correlation field, scope, query parser, revision predicate, canonical feed/DTO decision, action order or cached-response behavior is changed by this packet.

| Actual exported handler | Current scope | Classified controls preserved |
| --- | --- | --- |
| `GET /api/v1/integration/context` | `integration_context.read` | 500 generic fault / 503 schema fault |
| `GET /api/v1/public-contracts/diagnostics` | `api_contracts.diagnostics` | 500 generic fault / 503 schema fault |
| `GET /api/v1/website/public-contracts/diagnostics` | `website_contracts.diagnostics` | 500 generic fault / 503 schema fault |
| `GET /api/v1/contracts` | `api_contracts.read` | 500 generic fault / 503 schema fault |
| `GET /api/v1/website/public-contracts` | `website_contracts.read` | 500 generic fault / 503 schema fault |

The generic public code remains `PUBLIC_CONTRACTS_TEMPORARILY_UNAVAILABLE`; the actual schema classifier retains `PUBLIC_CONTRACT_SCHEMA_OUTDATED`. Its schema case also retains `42P01` in the technical diagnostic while removing free error contents.

## Actual local receipts and boundaries

Final new suite: **40/40 PASS**. Related command: **81/81 PASS across five files**, including all 40 new cases and 41 existing canonical serialization, publication graph/error-classification, query/ETag and actual route/OpenAPI cases. These related cases retain their original execution boundaries; static checks are not relabeled as native tests.

The unique suite uses all five actual exported GETs and the actual API-access adapter, current tenant-context creation, public-contract classifier, canonical JSON response helper and telemetry writer. Native authentication SQL and the outer context/diagnostic/feed/database adapters are controlled. Revision reads execute the actual revision helper and are asserted against the current company and correct website/API channel; the website feed's fingerprint RPC receives the authenticated company. The failing context loader receives the current authenticated client/company. This is runtime source qualification, not native tenant-policy or successful external publication evidence.

Five cases per handler additionally exercise current scope denial (403), current paused-company denial (423), revoked token (401), missing credentials before Auth RPC or any tenant read/write (401), and an installed Next redirect signal from real early authorization. Denials precede context/revision/feed business reads. Installed signals propagate unchanged without diagnostics. These signals originate before the business `try` blocks; inner business-catch control flow is unchanged and is not independently qualified here.

Actual canonical body request ID, `X-Request-ID`, log and `metadata.request_id` agree. The website feed retains its separate existing server trace in its log/error/telemetry. The generic telemetry writer's top-level `request_id` remains inbound-header-derived; this report does not claim its repair. No real provider, browser, native diagnostic persistence or physical document-byte case ran. Those execution counts for this packet are **0**.

Commands from repository root with cached Node 22:

```sh
/tmp/ediel-toolchain/node_modules/node/bin/node node_modules/vitest/vitest.mjs run __tests__/public-contract-diagnostics-log-canary-20261001.test.ts __tests__/public-contract-canonical-model.test.ts __tests__/public-contract-publication-graph-repair.test.ts __tests__/public-contract-api-hardening.test.ts __tests__/public-contract-route-openapi-regression.test.ts
/tmp/ediel-toolchain/node_modules/node/bin/node node_modules/eslint/bin/eslint.js app/api/v1/integration/context/route.ts app/api/v1/public-contracts/diagnostics/route.ts app/api/v1/website/public-contracts/diagnostics/route.ts app/api/v1/contracts/route.ts app/api/v1/website/public-contracts/route.ts __tests__/public-contract-diagnostics-log-canary-20261001.test.ts
```

Scoped ESLint: exit 0. Focused TypeScript: exit 0 with a temporary config extending current `tsconfig.json`, disabling plugins/incremental and including `next-env.d.ts` plus the unique suite's transitive actual source. Scoped diff whitespace check: exit 0. This is not a broad app/build or exact published-head CI receipt.

## Frozen source/test manifest

| Path | SHA-256 |
| --- | --- |
| `app/api/v1/integration/context/route.ts` | `7c5244fcae4d23eec0f592e7cb19b47161cd834435772c30aad4410217cb7e20` |
| `app/api/v1/public-contracts/diagnostics/route.ts` | `a0b921807ef24ed68bd7207944da1eecf88a621c33f809c49fa469bcd16c028c` |
| `app/api/v1/website/public-contracts/diagnostics/route.ts` | `a4b5e018ab4ad702776b9b2d04a682c6cf2c4ecd28abb8ca405360deaef214b5` |
| `app/api/v1/contracts/route.ts` | `c132d4c67eac69c4e65316857003f5c8663a474109d690725d37598e716683d6` |
| `app/api/v1/website/public-contracts/route.ts` | `0858948f002f36ce24e3dfbf03c0a4e7ad2c23213afe557bea956ca6d241d6e8` |
| `__tests__/public-contract-diagnostics-log-canary-20261001.test.ts` | `d9a28b2022c46227df4471938b19e170fc7f0ac4bc33d990e17ed3dfdd4379d4` |

This report is the seventh file; its hash is sent separately to root. The six source/test bytes are frozen for bounded independent review. A pending review is not an independent successful receipt.

## Exact remaining work

This qualifies the five terminal catches and their reproduced free-code/name/path diagnostic propagation. The earlier inventory of generic telemetry header identifiers/metadata, automation and supplier-switch callers and native new-diagnostic persistence remains internal work. The two feeds' separate inner malformed-publication diagnostic calls still carry source-derived offer references and mapper name/code/path; their actual producer/validation chain and necessity remain a separate explicit internal review/proof boundary, not a claim of leakage or safety from this terminal-fault suite. No entire T51/P7 or masterplan closure follows from this seven-file packet. Historical diagnostics remain untouched. Remote provider diagnostics, actual delivery and physical PDF-byte evidence require their respective external adapters/evidence and are separately qualified.
