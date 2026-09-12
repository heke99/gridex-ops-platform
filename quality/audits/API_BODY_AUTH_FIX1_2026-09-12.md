# Task 10a fix round 1 report

Date: 2026-09-12
Base: `8f8d33119542a0b3cfd489eeb89107f8e686db33`
Status: **IMPLEMENTED_NOT_VERIFIED** pending the supported Node 22 / installed-SDK gates owned by root. Scope remains Task 10a only.

## Review finding disposition

### T10A-R1 — addressed

The plural create handler's pre-policy `startsWith('https://')` branch was the exact cause of the contract drift. A RED actual-source case returned `422 webhook_https_required` with `api_version` for the plural HTTP target while the preserved contract requires `422 webhook_target_not_public` with only `error` and `request_id` in the body.

`lib/partner-api/core.ts` now retains its missing-target `webhook_https_required` behavior but sends every nonempty target through `assertPublicWebhookTarget`. The existing catch maps HTTP, malformed URL and HTTPS-private failures to the preserved public-target response. The catch-all preflight remains removed: singular and plural still authenticate once, read once and do not cache authorization.

Permanent and source cases cover both route shapes with all three target classes. They assert exact 422 envelope and headers, one `authenticate_integration_request_v1` call, zero subscription-create RPCs, and zero `customer_portal_write_idempotency` writes.

### T10A-R2 — addressed within the source-harness boundary

The source harness now loads and executes the actual implementations of:

- `isValidIdempotencyKey`;
- platform readiness evaluation and `assertPlatformSchemaReady`;
- integration secret hashing;
- trusted-IP and IP-rule policy using real `node:net.isIP`;
- `tenantContextForIntegration`;
- `publicRouteCost`;
- public response payload safety;
- public webhook URL/address policy;
- business, simple, canonical and core partner dispatch; and
- configured Ediel actor UUID/profile/auth-user/active-membership policy.

The harness substitutes only database/RPC results, DNS lookup, the Next `after` scheduling boundary, and terminal worker/provider operations. Its Resend cases are deliberately pre-verification checks: they load the actual header/secret policy and use an unreachable verifier sentinel to prove missing-secret and oversize ordering. They are not SDK acceptance.

The permanent Vitest suite no longer mocks `@/lib/ediel/automationActor`. It supplies the valid synthetic actor UUID `00000000-0000-4000-8000-000000000001`, a missing profile row, an existing auth user and an active membership through mocked service I/O. Generic and company routes therefore execute the real identity policy before terminal worker I/O. The company maintenance positive control uses `company-A`, reason `maintenance`, environment `test`, and asserts the exact actor/company worker input plus the audit payload.

### T10A-R3 — authored; actual SDK result pending hosted execution

The permanent suite now builds valid metadata-shaped signed Resend raw JSON at exactly 2,000,000 and 2,000,001 UTF-8 bytes. Both fixtures contain `Å🙂`, intentional indentation and spaces around separators, so parse/reserialize changes the signed bytes. The exact-cap request places the first stream boundary between the two bytes of `Å`. The test requires exact-cap acceptance under absent and false (`Content-Length: 2`) declarations and cap+1 rejection with 413 and cancellation under both declarations; those SDK-backed assertions remain pending hosted execution.

The existing signed `email.sent`, `email.bounced`, `email.clicked` and stored-unknown `email.received` metadata controls remain. The received fixture contains attachment metadata only. The exact-cap fixture uses an inert metadata `padding` string and contains no attachment bytes. This remains the selected 2,000,000-byte Gridex application cap, not a claimed Resend provider maximum.

No verifier is mocked in the permanent test. The actual route calls `verifyResendWebhook`, which calls the installed Resend SDK. Local dependencies are absent, so the real `resend@6.12.4` acceptance result remains pending the supported hosted gate.

## Reviewer coverage notes addressed

- Each of the four worker routes has a missing-configuration case that removes every accepted fallback secret, expects 503, and asserts zero body pulls, terminal worker calls and Ediel actor resolution.
- Authorized oversize cases explicitly assert one cancellation and zero worker execution, including the company-specific route.
- Company-specific Ediel has a positive valid actor/company/reason/environment control and audit assertion.
- Singular and plural public-target tests assert the exact body and complete response-header map plus zero idempotency writes.
- The heterogeneous Resend pre-read table is replaced by explicitly typed case objects with exact expected statuses.
- Authorized empty/malformed POST and GET query/default compatibility remains covered for the three shared worker routes; generic Ediel still blocks submitted company override by passing `companyId: null`.

## Test inventory

The permanent Vitest file defines 40 expanded cases:

- 13 partner cases: two valid route shapes at the exact quota boundary; six exact public-target rejections; two unknown/false-length oversize cancellations; scope and rate rejection before body read; and the partner-price cap.
- 13 signed-webhook cases: unchanged multibyte billing raw body; billing and manual exact/cap+1 under absent/false length; four legitimate Resend metadata shapes; Resend exact/cap+1 noncanonical multibyte raw fixtures under absent/false length; and exact missing-header/missing-secret pre-read cases.
- 14 worker cases: four all-fallback-secrets-absent cases; three unauthorized pre-read cases; three authorized oversize/no-worker cases; three empty/malformed/GET compatibility cases; and one company maintenance matrix including unauthorized, oversize, empty and valid controls.

The source harness reports 32 actual-source cases: 11 partner, 4 signed pre-verification boundaries and 17 worker boundaries. It is a Node VM/source harness, not a Next server, native DB proof or Resend SDK acceptance.

## RED / GREEN and local checks

RED before the production fix:

```text
node --experimental-strip-types quality/audits/proofs/api-body-auth-regression.mjs
exit 1
actual plural HTTP body: webhook_https_required / endpoint_url must use HTTPS. / api_version present
expected: webhook_target_not_public / target_url must be a publicly routable HTTPS endpoint. / error+request_id only
```

GREEN after the production fix and fidelity corrections:

```text
node --experimental-strip-types quality/audits/proofs/api-body-auth-regression.mjs
PASS 32 actual-source cases: 11 partner auth/body/public-target/price, 4 signed upper-body/pre-read, 17 worker secret/body/empty/company with real Ediel actor policy
exit 0
```

The command emits only Node 24's known `stripTypeScriptTypes` ExperimentalWarning after the PASS line.

Other executed checks:

- `node scripts/check-public-api-contract.cjs` — exit 0, `Public API contract OK (67 route files).`
- `node scripts/check-api-compatibility.cjs` — exit 0, compatibility passed for `2026-08-22.2`.
- `node --experimental-strip-types --check` for all 12 TypeScript owned paths — exit 0.
- `node --check quality/audits/proofs/api-body-auth-regression.mjs` — exit 0.
- Standalone extraction of the permanent Resend fixture helper — exit 0; both sizes are exact, both parse as JSON, noncanonical whitespace is present and the selected boundary splits `Å` bytes `c3|85`.
- Replacement-policy guard search for the nine reviewer-named partner/Ediel substitutes — no matches.
- `git diff --check` — exit 0.
- Corrected full package application to a base snapshot and frozen-initial-plus-delta application to a second snapshot both reconstruct all 13 current owned source/evidence files byte-for-byte — exit 0.

Supported Node 22 ESLint, script/test typechecks, the 40 permanent Vitest cases, full Vitest, Next build and actual `resend@6.12.4` execution are **NOT_RUN**. This worktree has no `node_modules`; the task prohibits dependency installation/retry after the recorded ENOSPC condition. Root's hosted gates remain required. No source harness, HMAC fixture builder or verifier sentinel is presented as that acceptance.

## Frozen packages

- Initial immutable review package: `task-10a-review-package-1.diff`, 64,449 bytes, SHA-256 `9486bfe0e5647577d7b2e710f0c0abfdafef8ddfc7f83047210597f14cd52bfd`.
- Corrected full 13-path package: `task-10a-fix1-review-package.diff`, 76,367 bytes, SHA-256 `74c133e60724b2135419a759cbe13180fe0bb534232023a855347694fbd55d5c`.
- Scoped correction against the frozen initial package: `task-10a-fix1-delta.diff`, 35,795 bytes, SHA-256 `0a79756b5527b93f5b771e2ad6370f9a3846a61c406935c4b09d4b631eba449a`.

The scoped delta contains exactly `lib/partner-api/core.ts`, `__tests__/api-body-auth-contracts.test.ts`, and `quality/audits/proofs/api-body-auth-regression.mjs`.

## Frozen owned path SHA-256 values

| Path | SHA-256 |
|---|---|
| `app/api/partner/v1/[[...path]]/route.ts` | `a2fa210ee8d13365447148f5abd8dc3ef95e593beb68a8ad0aed8cdd2bf04bee` |
| `lib/partner-api/simple.ts` | `c2ae35fe8eef1e67fcd98e6933859ea38545e0e7c6af486234a32d102d03f052` |
| `lib/partner-api/core.ts` | `a46bc11fbf3bbda14c328057e603aa453d1f0e81165a15784dfe196ac3f23740` |
| `lib/partner-api/business.ts` | `a63d7bf3a478c1bdf22fc4907190c053abf77bc179b62f5eda6ab0634be4c57a` |
| `app/api/webhooks/billing/[provider]/route.ts` | `9255d4a26732a07d3dccfa8f632da09916a8f5c5bb9662de7167e33bac4bf709` |
| `app/api/webhooks/manual-inbound/route.ts` | `0bad42279f46dd87a4da33cac16c5c1c618dc355eb7623e0a7a74a7e25a51afc` |
| `app/api/webhooks/resend/route.ts` | `82cb4ef9c5976cde23ba5feb0462987adb5f071718dfa816aeb9a4ef23b1569b` |
| `app/api/internal/email/outbox/process/route.ts` | `9e1d2f35864d91878b5d42af73ea272cefd801aadd43d7f7d306b629deed57e2` |
| `app/api/internal/manual-email/outbox/process/route.ts` | `6f698fe795aaeccdcde2ea3383cd944220e8fd1aed201175ea6e0106e39ef030` |
| `app/api/ediel/outbox/process/route.ts` | `396eb101ba0c3333bc19ae68968461f60c2b950dfdba902e4bd03d692f992686` |
| `app/api/ediel/outbox/process-company/route.ts` | `75b23b61e48ae27703714b9891ed8eec1a527932ee0c9b9495ac5259722612bf` |
| `__tests__/api-body-auth-contracts.test.ts` | `bae405e84c302d5249d39083baad65fbb95b053f4780b01ff54d6512abec7a19` |
| `quality/audits/proofs/api-body-auth-regression.mjs` | `67ad52bd8d5a9527ad25745bc0deee5dbfa390a464f179b38844c4f484c1c2cd` |
| `.superpowers/sdd/2026-09-12-current-and-plan77-85/task-10a-fix1-review-package.diff` | `74c133e60724b2135419a759cbe13180fe0bb534232023a855347694fbd55d5c` |
| `.superpowers/sdd/2026-09-12-current-and-plan77-85/task-10a-fix1-delta.diff` | `0a79756b5527b93f5b771e2ad6370f9a3846a61c406935c4b09d4b631eba449a` |

This report is the remaining owned path. Its final digest is reported out of band because embedding its own digest would change the file.

## Routing and boundaries

Activated `receiving-code-review`, `systematic-debugging`, `test-driven-development`, spec-to-code comparison against the frozen Task 10a brief/prep/review, and `verification-before-completion`. Database/Supabase, UI, performance, dependency installation, worktree creation, publication and branch-finishing skills were skipped because this bounded correction changes no SQL/UI/dependency/worktree/history/publication artifact. No subagents were used per the assignment.

No Task 10b/10c behavior, SQL, migration, generated type, dependency, lockfile, workflow, root memory/audit, Git index/history, commit, push, provider call, external request or production action was performed. Unrelated dirty files were preserved.
