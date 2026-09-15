# Task 10b1 implementation report

Date: 2026-09-12
Base: `4d4fe075198ad61b9df85aa456e40965668549dc`
Scope: P84-SCHEMA-001/003 only: notification unknown root fields, website quote consumption/site-count JSON-number boundaries, and the actual selected partner `POST /price` consumption boundary.

Task 10a body/auth behavior was preserved. Root reported its supported hosted acceptance GREEN on this base: OPS34695431202 quality job 103557991297 passed 207 files / 1,593 tests, all 40 API body/auth cases including the installed Resend SDK, lint, script/test types, contracts, RBAC, build and budgets; Native129 also repeated PASS.

## Implemented behavior

- `POST /api/v1/customer/notifications/read` now rejects every root key other than `notification_references` immediately after bounded object parsing. Rejection happens before canonical payload construction and before `customer_portal_write_idempotency` claim, so changed ignored values cannot share one canonical hash. Existing verified customer/company/client resolution, public notification references, pagination, success, and canonical replay remain in the actual route.
- Website quote create and validate now require `annual_consumption_kwh` to be an actual JSON number that is finite and greater than zero. Numeric strings, comma strings, booleans, null, arrays, objects, zero, negatives, and literal JSON `1e309` are rejected before create claim/pricing or validation business I/O.
- Website quote create and validate now require `site_count` to be an actual JSON number, `Number.isSafeInteger`, and at least one. Strings, booleans, null, arrays, objects, zero, negatives, fractions, unsafe integers, and literal JSON `1e309` are rejected at the route boundary.
- The create route retains `invalid_quote_input` for missing/invalid consumption and `invalid_site_count` for site count. Its existing commercial missing-field block remains authoritative for absent `site_count`. The validate route retains its existing required assertion block for absent values and returns `invalid_quote_assertion` for present malformed numbers.
- The actual selected partner `POST /price` implementation now reads `annual_consumption_kwh` directly and requires a finite positive JSON number. It retains status 422, code `annual_consumption_invalid`, field `annual_consumption_kwh`, the existing public partner envelope, the 256,000-byte body cap, one integration authentication, selected outer dispatch, and credential-derived company binding.
- Shared pricing coercion behavior was not changed. No new consumption ceiling or commercial bound was introduced.

No partner price idempotency, admin route schema expansion, move-out release behavior, SQL/schema/generated types, dependency/workflow, or current/immutable OpenAPI release change is included.

## RED and GREEN evidence

The dependency-free proof loads the actual four production modules from either the base commit or working tree. It also loads the actual `lib/api/strictRequest.ts` and `lib/integrations/writeIdempotency.ts` implementations. It substitutes framework objects, authorization context, database/RPC, and downstream quote/resolution service I/O so it can run without Next or installed packages.

RED against the exact base source:

```text
node --experimental-strip-types .superpowers/sdd/2026-09-12-current-and-plan77-85/task-10b1-strict-schema-proof.mjs --baseline
mode: baseline
cases: 52
passed: 10
failed: 42
exit 1
```

The 42 failures are causal: notification unknown-field input returned 200 instead of 400; all 19 quote-create malformed numeric cases returned 201 instead of 400; all 19 quote-validate malformed assertion cases returned 200 instead of 400; and partner numeric string, comma string, and array inputs returned 200 instead of 422. The remaining partner malformed types already failed through downstream coercion behavior, which is why the baseline had ten passing cases. The new boundary still covers those representations explicitly and before resolution/pricing.

GREEN on the working tree:

```text
node --experimental-strip-types .superpowers/sdd/2026-09-12-current-and-plan77-85/task-10b1-strict-schema-proof.mjs
mode: working-tree
cases: 52
passed: 52
failed: 0
exit 0
```

The proof uses the runtime's experimental TypeScript stripping and VM evaluation under local Node `v24.19.0`. Import removal and injected framework/service values mean it is supplemental source evidence, not supported acceptance, compilation, or a substitute for Vitest/Next execution.

## Permanent coverage

`__tests__/api-strict-schema-boundaries.test.ts` imports the actual notification route, website quote create route, website quote validate route, and outer partner catch-all route. Its eleven test blocks issue 58 serialized requests/controls when loop expansions and the create-then-validate control are counted:

- changed notification unknown values (`true` and `false`) under the same idempotency key, with exact canonical 400 envelope and no claim/update;
- valid tenant-bound notification read, pagination, idempotency completion, and canonical replay;
- all 19 create numeric representations, exact status/code/message/field, and no publication, quote, or idempotency write before rejection;
- valid numerical quote creation through actual authentication, integration idempotency, canonical publication resolution/readiness, commercial selection, pricing configuration/calculation, resolution readiness, quote persistence/hash, projection, and audit append;
- three missing-field role controls;
- all 19 validate assertion representations with no publication or quote I/O;
- create-then-validate using the real immutable quote row/hash, actual publication and resolution policies, no validation idempotency, no quote mutation, and the expected append-only `quote.validated` canonical audit event;
- nine partner consumption representations through the supported outer `/price` dispatch, each with one actual integration authentication and no resolution/publication/quote effect;
- valid partner dispatch with credential company `company-A`, actual publication/commercial/pricing/quote path, and persisted numeric consumption.

The permanent test replaces `supabaseService` at the DB/RPC boundary and supplies canonical publication, legal, price-option, resolution, customer, idempotency, and quote rows. Authentication, customer identity resolution, both idempotency implementations, canonical publication/readiness selection, legal/price-option checks, commercial selection, pricing configuration, price-source policy, calculators, quote persistence/hash validation, resolution-binding readiness, projection, outer partner dispatch, and partner `ensurePricingReady` remain actual.

The precise remaining behavioral helper seam is `resolveEnergyContext` in the valid partner control. That upstream resolver combines geodata/database I/O with resolution policy and is substituted with a controlled verified SE3 result; therefore the permanent test does not re-prove the internals of postal/geodata resolution. Invalid partner cases assert rejection before this seam, and the returned resolution ID then passes through actual `ensurePricingReady` and actual `loadQuoteEnergyResolution` readiness/tenant binding. `scheduleUsageEvent` is also replaced only as terminal asynchronous audit-usage I/O; canonical energy-event persistence remains actual against the fake DB.

## Additional executed checks

```text
node scripts/check-public-api-contract.cjs
Public API contract OK (67 route files).
exit 0

node scripts/check-api-compatibility.cjs
OpenAPI compatibility gate passed for 2026-08-22.2.
exit 0

node scripts/check-openapi-runtime-parity.cjs
OpenAPI/runtime parity OK (69 registry routes, 83 OpenAPI operations, 58 reachable schemas).
exit 0

node --experimental-strip-types --check __tests__/api-strict-schema-boundaries.test.ts
exit 0

node --check .superpowers/sdd/2026-09-12-current-and-plan77-85/task-10b1-strict-schema-proof.mjs
exit 0

git diff --check
exit 0
```

Local Vitest, TypeScript compilation, ESLint, and Next build were not run: the isolated worktree has no `node_modules`, the task prohibits installs, and the local Node version is 24 rather than the supported Node 22 gate. The permanent suite and repository-wide supported gates remain pending for root-hosted execution.

## Frozen owned files and SHA-256

| File | SHA-256 |
|---|---|
| `app/api/v1/customer/notifications/read/route.ts` | `ab99c0e45c994b5980bcd7bbc4ac8a29a29229177c11803790875bab656462b4` |
| `app/api/v1/website/quote/route.ts` | `9e952ee044fdb854a24a61859364f38e7132f78224bf3f3db91a9ddbee681c7f` |
| `app/api/v1/website/quote/validate/route.ts` | `6b333b16e9ebc6ee0ae7a9a6ee104d0fc773de95fe5a22d33faf141ddf599690` |
| `lib/partner-api/business.ts` | `1dcfc0cba8f678e5e2632c0252e720f199624ec3e9ff0aad3ae4af6f9c581100` |
| `__tests__/api-strict-schema-boundaries.test.ts` | `712a868ae6e9f8b0d2e059a2714320630f2fdebade173eaadfe2a18017170585` |
| `.superpowers/sdd/2026-09-12-current-and-plan77-85/task-10b1-strict-schema-proof.mjs` | `8a57723c04d5d8c01710343ee8730e3d3ad02576d26070366d69b7fb3f14e98b` |

The exact frozen path manifest is `task-10b1-owned-files.json`; the reviewable base-to-working-tree package is `task-10b1-review-package.diff`. Both sit beside this report. The report is an additional coordination artifact whose digest is intentionally reported out of band because it cannot contain its own final digest.

## Pending gates and concerns

- Root-hosted supported Node 22 focused Vitest for the permanent file, full Vitest, script/test typechecks, ESLint, Next build, RBAC, and budgets remain required before publication.
- Root should disposition the explicit valid-partner `resolveEnergyContext` seam during independent review. Its inner geodata/resolution algorithm is outside this boundary fix; all post-resolution quote policies are actual.
- Partner price idempotency remains open for Task 10c exactly as required.
- Pre-existing and concurrently updated memory/audit coordination files, the Task 10a acceptance artifact, and `scripts/__pycache__/` were preserved outside the owned manifest. No commit or push was made.
