# Task 10a implementation report

Date: 2026-09-12
Base: `8f8d33119542a0b3cfd489eeb89107f8e686db33`
Scope: external upper body limits, secret-before-body ordering, and partner webhook single authentication/quota only. Task 10b schema work and Task 10c partner-price idempotency remain untouched.

## Implemented contracts

- Removed the catch-all partner webhook preflight that cloned and parsed the request before dispatch. The actual selected singular and plural handlers now each authenticate once, consume the body once through `readJsonObject` at 256,000 received bytes, and validate the public HTTPS target before idempotency or subscription creation.
- Retained the credential-resolved `company_id`, `api_client_id`, exact `partner_webhooks.manage` scope, existing route-cost calculation, and per-request authentication behavior. No request or cross-request authorization cache was introduced.
- Retained singular and plural `webhook_target_not_public` status 422 behavior. The plural path now performs the same DNS/IP public-target validation as the singular path and returns the prior catch-all error envelope (`error` plus `request_id`, no internal identifiers) before any write.
- Changed partner `POST /price` from unbounded `request.json()` to `readJsonObject(request, 256_000)`. `ApiInputError` status/code/field now survive the business route error mapper, including 413 `payload_too_large`.
- Moved the effective billing 512,000-byte and manual-inbound 2,000,000-byte limits to their route stream readers. Both pass the decoded raw text unchanged to the existing signature verifier/provider contract. The existing downstream billing size defense remains in place.
- Added an explicit 2,000,000 received-byte Resend application cap after the existing missing-header and missing-secret checks and before SDK verification. This is a Gridex application limit selected for remediation, not a Resend provider maximum. Unknown signed event handling within the limit remains unchanged.
- Added 256,000 received-byte optional JSON caps to tenant-email, manual-email, generic Ediel, and company-specific Ediel worker POSTs. Every route checks configured secrets and performs timing-safe authorization before reading. Oversize returns 413 and cannot fall through to `{}` or execute a default queue run.
- Preserved authorized empty and malformed JSON compatibility as `{}` for the three shared GET/POST workers; retained GET query/default options. Generic Ediel still submits `companyId: null` and reports a supplied override as `blocked_on_generic_cron`. Company-specific Ediel retains required `companyId`/`reason`, its separate secret set, and its empty-body 400 response.

## Test evidence

RED, before implementation:

```text
node --experimental-strip-types quality/audits/proofs/api-body-auth-regression.mjs
AssertionError: webhook/subscription must consume one auth/quota unit
2 !== 1
exit 1
```

GREEN, after implementation:

```text
node --experimental-strip-types quality/audits/proofs/api-body-auth-regression.mjs
PASS 21 actual-source cases: 5 partner auth/body/price, 4 signed upper-body/pre-read, 12 secret-worker auth/body/empty compatibility
exit 0
```

The source proof loads the real catch-all, partner handlers, authentication helper, shared bounded readers, signed routes, and worker routes. It substitutes RPC/database/DNS/terminal-worker I/O. The webhook quota assertion observes real `requireIntegrationApiAccess` calls reaching the fake `authenticate_integration_request_v1` RPC and does not replace the authorization helper.

Permanent Vitest: `__tests__/api-body-auth-contracts.test.ts`, 32 cases when table expansions are counted:

- 9 partner cases: singular/plural valid at the quota boundary; company/client/scope binding; singular/plural private-target rejection; unknown and false Content-Length cancellation; scope and rate rejection before body read; partner-price cap.
- 13 signed-webhook cases: unchanged multibyte billing signature body; billing/manual/Resend exact-cap acceptance and cap+1 rejection with absent and false Content-Length; one-byte UTF-8 chunks; sent/bounced/clicked/received-metadata Resend shapes; missing Resend headers/secret before read.
- 10 worker cases: all three shared routes reject secrets before read, return 413/cancel before terminal execution, retain empty/malformed POST and GET query/default behavior; company-specific Ediel retains the same ordering/cap/required-body behavior.

The Resend cases import the actual route and `verifyResendWebhook`, which invokes the installed Resend SDK verifier. The tests construct signed fixtures but do not replace or reimplement verifier acceptance. Supported Node 22 CI with installed `resend@6.12.4` must provide the SDK result; local dependencies are absent.

Representative valid Resend fixtures are metadata-shaped `email.sent`, `email.bounced`, `email.clicked`, and stored-unknown `email.received` events. The large valid fixture is exactly 2,000,000 UTF-8 bytes and contains metadata plus an inert root `padding` string; no attachment content is embedded. Exact 2,000,000 is accepted and 2,000,001 is rejected. Billing fixtures exercise exact 512,000/512,001; manual-inbound fixtures exercise exact 2,000,000/2,000,001. Partner route fixtures exercise 256,001 rejection with absent and false Content-Length; the already accepted shared-reader suite separately proves exact-cap acceptance.

Additional executed checks:

```text
node scripts/check-public-api-contract.cjs
Public API contract OK (67 route files).
exit 0

node scripts/check-api-compatibility.cjs
OpenAPI compatibility gate passed for 2026-08-22.2.
exit 0

node --experimental-strip-types --check <each of 11 changed TypeScript source files and the permanent test>
exit 0

node --check quality/audits/proofs/api-body-auth-regression.mjs
exit 0

git diff --check
exit 0
```

Local lint, TypeScript compilation, Vitest, Next build, and the real Resend SDK execution were not run because this isolated worktree has no `node_modules`; the task explicitly prohibited install retries after ENOSPC. The permanent test uses explicit mock/query return types and contains no local binding named `module`, addressing the known hosted lint/type failures without suppression.

## Owned files and SHA-256

| File | SHA-256 |
|---|---|
| `app/api/partner/v1/[[...path]]/route.ts` | `a2fa210ee8d13365447148f5abd8dc3ef95e593beb68a8ad0aed8cdd2bf04bee` |
| `lib/partner-api/simple.ts` | `c2ae35fe8eef1e67fcd98e6933859ea38545e0e7c6af486234a32d102d03f052` |
| `lib/partner-api/core.ts` | `1121eab8ed57c2cc9737369baa439848bb2b834c9088097a442bda24f9156c62` |
| `lib/partner-api/business.ts` | `a63d7bf3a478c1bdf22fc4907190c053abf77bc179b62f5eda6ab0634be4c57a` |
| `app/api/webhooks/billing/[provider]/route.ts` | `9255d4a26732a07d3dccfa8f632da09916a8f5c5bb9662de7167e33bac4bf709` |
| `app/api/webhooks/manual-inbound/route.ts` | `0bad42279f46dd87a4da33cac16c5c1c618dc355eb7623e0a7a74a7e25a51afc` |
| `app/api/webhooks/resend/route.ts` | `82cb4ef9c5976cde23ba5feb0462987adb5f071718dfa816aeb9a4ef23b1569b` |
| `app/api/internal/email/outbox/process/route.ts` | `9e1d2f35864d91878b5d42af73ea272cefd801aadd43d7f7d306b629deed57e2` |
| `app/api/internal/manual-email/outbox/process/route.ts` | `6f698fe795aaeccdcde2ea3383cd944220e8fd1aed201175ea6e0106e39ef030` |
| `app/api/ediel/outbox/process/route.ts` | `396eb101ba0c3333bc19ae68968461f60c2b950dfdba902e4bd03d692f992686` |
| `app/api/ediel/outbox/process-company/route.ts` | `75b23b61e48ae27703714b9891ed8eec1a527932ee0c9b9495ac5259722612bf` |
| `__tests__/api-body-auth-contracts.test.ts` | `0b321a9c40927158df67aa2f16976e32a5aa4fc3c3152047182b17df2b4e05e8` |
| `quality/audits/proofs/api-body-auth-regression.mjs` | `86552b641c5c3cb1f5ec1ecc2ee690c56668e01b9bde676f381db61363579cfb` |

The report itself is the fourteenth owned file; its SHA-256 is intentionally reported out of band because a file cannot contain its own final digest.

## Remaining boundaries

- Hosted supported Node 22 lint, script/test typechecks, the 32 permanent Vitest cases (including actual `resend@6.12.4` verification), full Vitest, and build remain root-owned gates.
- Task 10b owns strict route-specific schema/type/identity enforcement. Task 10c owns partner-price idempotency and OpenAPI idempotency documentation. No 10b/10c behavior was implemented or claimed.
- No dependency/lockfile, SQL, generated type, workflow, memory/index/history, migration, provider configuration, database, commit, push, or production change was made by this batch. Pre-existing and concurrently updated dirty files outside the owned list were preserved.
