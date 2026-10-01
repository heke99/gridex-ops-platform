# T51 / P7: actual customer error diagnostics, 2026-10-01

This is a bounded implementation and executed local regression receipt for original T51, “Loggar innehåller inte hemligheter eller onödiga personuppgifter.” It does not qualify every application log, native database persistence, external provider delivery, physical PDF bytes, or retention policy. Root owns integration into #422 and the whole-plan qualification matrix.

## Reproduced failures and correction

The first real exported-boundary suite returned **5 RED / 3 PASS**. All data was synthetic: an email, telephone number, full name, street address, opaque provider credential and `sb_secret` canary. The HTTP handlers, Capway HTTP client, classifier, error projections and support consumers executed; their database/Auth/transport adapters were controlled local mocks. No real provider, hosted database, email, payment or document download was called.

| Actual boundary | Reproduced failure | Resulting behavior |
| --- | --- | --- |
| Guarded billing export download GET → real export loader failure | Safe HTTP500 still logged the entire database error object, including message/details/hint/nested payload. | Same controlled HTTP500 text; console retains a technical SQLSTATE and constant classification only. |
| Website application-status GET → loader failure | Correlated safe HTTP500 still logged the raw error and caller-supplied application-number path. | Same API error code/body/request correlation; diagnostic contains requestId and technical classification. Application-number path is absent from the error log. |
| Portal query diagnostic projection → actual portal-bundle GET | Raw message/details/hint passed into section failure logs. | Technical code and constant text, null details/hint. The real bundle handler still returns503 with11 independently correlated unavailable sections. Every section retains its traceId and23505 in the captured log. |
| Actual CapwayApticClient.ping with locally mocked422 response → shared invoice export classifier | Raw provider response/message copied into prospective error_payload, attempt excerpt, dead-letter/legacy diagnostic inputs used by both senders. | Outcome/errorCode/httpStatus/retryability unchanged; controlled Swedish diagnostic and null future responseExcerpt. Capway client, original captured request, GUID, immutable invoice/document graph and historical rows are unchanged. |
| Shared exported safeLogError | Regex-based free-text redaction retained telephone/name/address/opaque credentials. | Only recognized SQLSTATE/PostgREST/transport namespaces are copied; message is a constant technical class. Exact Forbidden/Unauthorized guard messages remain compatible with current safe error consumers. Arbitrary code strings are rejected. |

Following the first corrections, real `toSafeCompanyProfileError` and `toSafeContractErrorPersisted` calls reproduced **2 RED / 25 PASS**, because details/hint still bypassed the shared sanitizer. Extended tests returned **8 RED / 25 PASS** for these two sinks, free metadata, validation/domain text copied into user outcomes, and actual installed Next redirect/notFound signals swallowed by each of the three converters. A final scope/action check returned **2 RED / 35 PASS** for caller-supplied malformed diagnostic identifiers.

The shared converters now retain constant error messages, technical SQLSTATE/reference, the19 current static action names, valid UUID company/actor/offer/product/assignment references, fixed contract channel and boolean permission metadata. Unknown metadata/free details/hints are excluded from future console and insert payloads. Malformed scope/action values become null/action_error. This changes diagnostic projection only; no access policy or actor authority is derived from that projection. Actual installed `unstable_rethrow` runs before any conversion log/insert and in the thrown persistence-error catch. Known controlled lifecycle/schema/permission classifications remain available; an arbitrary P0001 or validation-looking message is never copied into the user outcome.

The actual persisted converter is exercised through a successful controlled database insert adapter, a returned secondary persistence failure and framework control flow thrown during insertion. Assertions cover the exact prospective diagnostic payload and correlation reference. This is not a native persisted-row receipt and does not rewrite existing rows.

## Executed validation

Final canary suite: **37/37 PASS**. Three original safe controls remain green: unknown support API failures retain generic response/code/trace without raw logs; protected support-file read denial retains controlled403 and no raw storage/database log; a phone-channel support command and real form consumer retain controlled output without exposing its private caller body. These controls do not claim verified phone identity, actual storage bytes or native authorization.

Related actual local suites: **104/104 PASS in9 files**:

| File | Executed cases |
| --- | ---: |
| customer-error-log-canary-20261001.test.ts | 37 |
| export-classification.test.ts | 14 |
| logging-redaction.test.ts | 5 |
| invoice-provider-request-retry.test.ts | 19 |
| invoice-purchase-conflict-outcome.test.ts | 1 |
| billing-import-action-outcome.test.ts | 17 |
| contract-lifecycle-errors.test.ts | 3 |
| customer-portal-bundle-audit.test.ts | 2 |
| company-settings-user-identity-boundary.test.ts | 6 |

The original two-sender suite still verifies stable captured payload/key across retry/live edits, create GUID retained across purchase retry, capture-failure/no-call, malformed/colliding financial/customer bindings and terminal sent no-resend. The actual409 purchase case remains needs_review/provider_conflict; accepted GUID does not become evidence of completed purchase. No sender implementation was edited in this packet. The existing prospective excerpt test was changed to assert explicit minimization; historical provider evidence was not migrated.

Command:

```sh
/tmp/ediel-toolchain/node_modules/node/bin/node node_modules/vitest/vitest.mjs run __tests__/customer-error-log-canary-20261001.test.ts __tests__/export-classification.test.ts __tests__/logging-redaction.test.ts __tests__/invoice-provider-request-retry.test.ts __tests__/invoice-purchase-conflict-outcome.test.ts __tests__/billing-import-action-outcome.test.ts __tests__/contract-lifecycle-errors.test.ts __tests__/customer-portal-bundle-audit.test.ts __tests__/company-settings-user-identity-boundary.test.ts
```

Scoped ESLint: **0 errors / 0 warnings** across the9 source/test files. Focused TypeScript with current repository options and the two changed test entrypoints: **PASS**, including transitive imports. Initial two implicit-any callback diagnostics in the new test were corrected with explicit unknown[] types. No broad app/test/scripts tsc or workflow/source registration was modified. `git diff --check`: **PASS**.

## Current residual inventory

These are concrete internal continuation surfaces, not an external-only block or a claim of whole-T51 completion:

| Source | Remaining inventory item |
| --- | --- |
| lib/integrations/billing/invoiceExportCore.ts | Raw database objects in failed-attempt/task/missing-run console calls at342/403/843; original frozen sender source was not released for this correction. Exercise these secondary failures through actual sender functions before a separate narrow patch. |
| lib/billing/exportCenter.ts | Blocker-task creation console warning still accepts raw error at296. |
| Website quote/validate, quote, market-price/current, energy-area/resolve, legal-bundle, portfolio-prices, switch-status and customer-applications routes | Other unknown-failure catches still contain raw error logging. They require actual route input/dependency proofs and separate reserved edits. This packet covers only application-status. |
| lib/customer-operations/automation.part-2.ts and supplierSwitchOrchestration.ts | Raw secondary link/blocker/orchestration diagnostics remain source inventory. No unexecuted sink is labeled verified. |
| lib/ediel/intent/resumeStuckIntents.ts | Queue continuation owner was notified that free resume/sweep error messages appear in the returned errors[] array; its actual cron/log consumer must be qualified separately. |
| redaction.sanitizeLogMetadata / redactLogText and their other consumers | Existing general pattern redaction remains a compatibility utility. It is not proof that arbitrary free text, success metadata or every caller is PII-safe. The corrected strict error projection does not broaden that claim. |

Real provider/physical-storage/hosted log retention and formal scanner credentials remain separate exact environment boundaries. Local remaining sink tests and minimization are implementable work. Native and browser execution count for this logging packet: **0**; no such acceptance is inferred from unit or source review.

## Frozen integration manifest

Production changes are only these7 paths; tests2; report1. No SQL, migration ledger/checksum, generated contracts/schema/types, release bytes, workflow, memory, Git ref or provider request/GUID source was changed by this packet.

| Path | SHA256 independently verified on frozen candidate |
| --- | --- |
| lib/logging/technicalError.ts | 604fb35cdf12fc69e15733b350a6f7d6c5310e8f48dfcf11ace1a49158436530 |
| lib/logging/redaction.ts | 6894c20f893fc4fc2ae02fc200b35befe3c9daddc0a13a1cedd26ab284ddd47f |
| lib/errors/safeActionErrors.ts | d47c47d73918934c81f6470bbc38697b784529bf89b7b24c2c1b61a0854daf06 |
| lib/customer-portal/apiData.ts | e36f448004afde11f56812096be6955c24e906dd61449e0eb494bf08b4bb7d66 |
| app/admin/billing/export-center/[id]/download/route.ts | 0cf64a265e8ce501a2bbefff291437c5e4581d5400ab1cd5b0762418acade4cb |
| app/api/v1/website/customer-applications/[applicationId]/route.ts | d5b19329eef104c3432337af1178e729b4a1dd8e86f1367b014b30062a765268 |
| lib/integrations/billing/exportErrorClassification.ts | 649ad6a0f188fcfbbd7d95dbaec8cb3dbe7ec786a5f2e3389deb0c16f01ed06b |
| __tests__/customer-error-log-canary-20261001.test.ts | ffdaf6f8d9ef847a88bab76df6f17ba71f101b983b6f90e65dd7f3d43732cbc8 |
| __tests__/export-classification.test.ts | b263376e10c0ba34e0fec46d1b4975f20a371898d7ec6e5448c4c7034cc6cc1c |

Independent read-only review by ops_ui: **PASS** on all9 frozen source/test hashes. The reviewer independently executed the full9-suite command: **104/104 PASS**, including canary37, classifier14, provider retry19 and current caller controls. The review checked technical namespace/constant-message projection, null raw details/hints, exact current19-action/UUID/metadata allowlist, installed Next control flow before log/insert and in persistence catch, unchanged taxonomy/status/retry and unchanged guard/tenant/data bindings. No concrete new source/caller regression was found. Review does not imply native persistence/browser/provider/whole-T51 execution; residual internal surfaces stay OPEN. Portal_address was also informed; no second review is inferred. Root receives the report's final hash separately to avoid a self-referential hash.
