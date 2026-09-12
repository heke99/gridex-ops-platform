# Task 10b1 fix1 implementation report

Date: 2026-09-12
Base: `4d4fe075198ad61b9df85aa456e40965668549dc`
Purpose: remove the declared partner energy-resolution policy seam before independent review. No production behavior changed after the original Task 10b1 freeze.

## Fix1 result

The permanent `__tests__/api-strict-schema-boundaries.test.ts` no longer mocks `resolveEnergyContext` or any publication, commercial, pricing, authorization, customer-identity, idempotency, or resolution policy helper. Its only module substitutions are:

1. `supabaseService`, the DB/RPC boundary;
2. `scheduleUsageEvent`, terminal asynchronous usage-log I/O.

The valid partner `POST /price` control now runs the actual resolver against a minimal coherent database catalog:

- one active `11122` postal mapping with SE3 and confidence 1;
- one active STH grid-area master row mapped to one OPS grid owner;
- one actual verified-grid-owner view result with PRODAT/UTILTS/customer-flow readiness;
- actual postal candidate classification, grid-area/master consistency, grid-owner verification, price-area assurance, resolver persistence, and canonical energy-event append.

The resolver produces and persists an `estimated` SE3 `postal_suggested` resolution with confidence 0.85 and the credential company `company-A`. The partner handler then runs actual `ensurePricingReady`; quote creation reloads the saved ID through actual tenant-bound `loadQuoteEnergyResolution`, recalculates quote readiness, and continues through the actual publication, legal, price-option, commercial, pricing, persistence/hash, projection, and audit path.

Malformed partner numeric cases reset the fake DB/RPC journal and assert zero reads or writes against the resolver tables before checking zero publication and quote effects. The valid control asserts the postal catalog read, verified grid-owner read, tenant-bound `customer_site_resolution` insert, `energy_area.resolved` canonical event, subsequent quote-resolution read, and tenant-bound website quote insert.

Production source is byte-identical to the original Task 10b1 freeze. The original report, manifest, and review package were also preserved byte-identically.

## Supplemental source proof alignment

The supplemental proof now loads these actual policy implementations in addition to the original four production paths and strict/idempotency helpers:

- integration API credential parsing, secret hashing, platform readiness, trusted-IP policy, scope evaluation, tenant context, route cost/quota authentication, and response context;
- portal request identifier parsing, tenant portal link resolution, tenant-bound customer/profile resolution, customer API context, canonical API error formatting, public-payload checks, and public reference generation/validation;
- energy resolver postal classification, grid-area master consistency, grid-owner verification, resolution materialization, and canonical energy audit persistence.

Every source-proof request now reaches actual integration authorization backed by the fake authentication RPC. The notification cases also resolve the actual linked portal customer for `company-A` before route validation. Assertions cover exact scopes, one authentication for each quote/validate/partner request, two authentications for the two notification-unknown requests, and credential company propagation.

The valid supplemental partner case uses the actual energy resolver and observes its database and canonical-event effects. Its downstream `calculateOfferQuote` remains a terminal service substitute. Quote-create and quote-validate valid controls likewise stop at substituted downstream quote/validation services; their purpose is independent route-boundary/auth/idempotency evidence. The permanent suite, pending supported execution, carries the full actual quote engine/persistence/hash controls.

The proof remains a local Node VM harness. It removes static imports, injects framework/DB/RPC/terminal service values, and performs a narrow source compatibility rewrite for TypeScript parameter properties in error-only constructors because Node strip-only mode does not lower them. Those constructors are not reached by the successful resolver fixture. This source proof is supplemental evidence rather than compilation or supported acceptance.

## RED/GREEN and checks

The original causal RED remains unchanged after proof alignment:

```text
node --experimental-strip-types .superpowers/sdd/2026-09-12-current-and-plan77-85/task-10b1-strict-schema-proof.mjs --baseline
mode: baseline
cases: 52
passed: 10
failed: 42
exit 1
```

The aligned working-tree proof is GREEN:

```text
node --experimental-strip-types .superpowers/sdd/2026-09-12-current-and-plan77-85/task-10b1-strict-schema-proof.mjs
mode: working-tree
cases: 52
passed: 52
failed: 0
exit 0
```

Additional checks:

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

## Fix1 frozen owned files and SHA-256

| File | SHA-256 |
|---|---|
| `app/api/v1/customer/notifications/read/route.ts` | `ab99c0e45c994b5980bcd7bbc4ac8a29a29229177c11803790875bab656462b4` |
| `app/api/v1/website/quote/route.ts` | `9e952ee044fdb854a24a61859364f38e7132f78224bf3f3db91a9ddbee681c7f` |
| `app/api/v1/website/quote/validate/route.ts` | `6b333b16e9ebc6ee0ae7a9a6ee104d0fc773de95fe5a22d33faf141ddf599690` |
| `lib/partner-api/business.ts` | `1dcfc0cba8f678e5e2632c0252e720f199624ec3e9ff0aad3ae4af6f9c581100` |
| `__tests__/api-strict-schema-boundaries.test.ts` | `bc24b0d09bbba692d46d2ad3332a96a34163d9702fab54b629ca8529a54fe43d` |
| `.superpowers/sdd/2026-09-12-current-and-plan77-85/task-10b1-strict-schema-proof.mjs` | `21f59d99ef579d0e423a1329bd4737f36489cef2e38ba312d676f5c935621345` |

Frozen fix1 artifacts:

| Artifact | SHA-256 |
|---|---|
| `task-10b1-fix1-owned-files.json` | `2a75d1157c7a604ce733c6742d4f5da28491375703ce998945a82fdcaf3df128` |
| `task-10b1-fix1-review-package.diff` | `0a19e185b8e67bd35d891a9c9de33c2a0d8dcdea8fd602c83332094ca8f5526d` |
| `task-10b1-fix1-delta.diff` | `e25ff81057106ad36b62c0a0bc29f51a87aa3c3873e73cffca064a4a9da4e145` |

The full review package contains all six current author paths relative to the exact base. The delta contains only the permanent-test and supplemental-proof changes from the original frozen package; there is no production delta.

Original frozen coordination artifacts preserved:

| Artifact | SHA-256 |
|---|---|
| `task-10b1-owned-files.json` | `2a75d1157c7a604ce733c6742d4f5da28491375703ce998945a82fdcaf3df128` |
| `task-10b1-review-package.diff` | `069ed2aa78858e750f5f6a77a28c858e6d4da4f5ea39d1e1f8490b9009717089` |
| `task-10b1-report.md` | `8664635cc48ad1047299cfb872b630ee04cc2b84a503025995f06c758423f4e1` |

This fix1 report is an additional coordination artifact whose digest is reported out of band because it cannot contain its own final digest.

## Remaining limits

- The isolated worktree still has no `node_modules`; no install was attempted. Permanent Vitest, TypeScript compilation, ESLint, Next build, RBAC, and budgets remain pending for root's reviewed push and supported hosted Node 22 acceptance.
- The source proof runs on local Node `v24.19.0` and does not establish framework compilation. Its injected downstream quote/validate services are explicitly independent supplemental checks; supported permanent execution is required for the actual full-engine controls.
- Partner price idempotency remains open for Task 10c. No SQL, dependency, workflow, generated type, memory/index, commit, push, provider, or external action occurred.
