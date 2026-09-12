# Task 10b1 supported-CI correction report

Date: 2026-09-12
Published base: `589eda875a3a00f1889a82d87b9f6ef90ae88c9c`
Independent approval: `task-10b1-review-1.md`, SHA-256 `2108f6633626d37108556ca453c4fa412ada350326cd158960b136134ed609cb`

## Supported RED

GitHub run OPS34698160723, quality job 103565128134, used Node `v22.23.2`. Lint, script typecheck, test typecheck, mechanical checks, and the 45-test quality gate passed. Full Vitest then reported 207 passing files plus one failing file, with 1,601 passing and three failing tests out of 1,604.

All eight invalid/boundary blocks in the new permanent file passed. The three valid quote controls failed:

```text
keeps valid website quote numbers tenant-bound through claim and pricing
expected 201, received 422 at line 810

keeps valid quote validation numerical, tenant-bound and non-idempotent
initial create expected 201, received 422 at line 930

keeps valid partner price dispatch and credential company binding
expected 200, received 422 at line 1016
```

Exact hosted excerpt: `task-10b1-ci1-failure-excerpt.txt`.

Build did not run after the Vitest failure. This is the authoritative RED for the correction.

## Causal diagnosis

The production routes and engines are correct. The shared valid fixture supplied:

```text
price_row_reference: area-price-SE3
```

The real policy path preserves that value through these steps:

1. `loadPublishedPriceOptions` publishes the DB row as `area_price_reference`.
2. `internalPriceOptionForQuote` maps it back to the strict v6 `price_row_reference`.
3. `commercialModelFromSnapshot` validates the adapted option with `priceOptionAreaPriceSchema`.
4. That schema uses `stableReference`, whose production regex is `^[a-z0-9][a-z0-9_-]*$`.
5. Uppercase `SE3` fails the actual stable-reference policy. `commercialModelFromSnapshot` returns null, and the v6 quote branch throws `commercial_model_invalid` with status 422 before pricing.

The same published option fixture feeds direct quote creation, the create step of create-then-validate, and partner quote creation, explaining the identical 422 across all three controls. Invalid numeric tests reject before publication/commercial policy and therefore passed.

A dependency-free causal probe extracted the stable-reference regex from the actual `lib/pricing/commercialModel.ts` source, then compared the published-CI fixture with the corrected working tree:

```text
published-ci1: area-price-SE3: stable_reference=False
working-tree: area-price-se3: stable_reference=True
```

No production regression or scope expansion is evidenced.

## Smallest correction

Only `__tests__/api-strict-schema-boundaries.test.ts` changed:

- `area-price-SE3` became `area-price-se3`, preserving the same stable semantic reference while satisfying the actual v6 policy.
- Each of the three valid controls now clones and parses the response before the status assertion and supplies the serialized body as the assertion message. The expected success statuses and all subsequent actual-policy assertions remain unchanged. Cloning preserves the original response body for the existing validation flow.

No guard/helper was substituted, no success expectation was weakened, and no accepted evidence was fabricated. The permanent suite still mocks only Supabase DB/RPC I/O and terminal `scheduleUsageEvent`; all authorization, identity, publication, commercial, resolver, quote, persistence/hash, projection, and audit policies remain actual.

Production and the relocated supplemental proof remain byte-identical to the independently approved published package.

## Local GREEN and limits

The existing actual-source regression remains GREEN:

```text
node --experimental-strip-types quality/audits/proofs/api-strict-schema-regression.mjs
mode: working-tree
cases: 52
passed: 52
failed: 0
exit 0
```

Additional checks:

```text
node --experimental-strip-types --check __tests__/api-strict-schema-boundaries.test.ts
exit 0

node --check quality/audits/proofs/api-strict-schema-regression.mjs
exit 0

git diff --check
exit 0
```

The source proof uses downstream quote/validate terminal substitutes and does not execute Zod or the full quote engine. The causal probe proves that the corrected fixture now satisfies the exact production reference regex; it does not substitute for supported Vitest. The worktree has no local `node_modules`, and no install was attempted.

## Frozen correction

Sole correction path:

| File | SHA-256 |
|---|---|
| `__tests__/api-strict-schema-boundaries.test.ts` | `374e1a5d3155609fab5ebb09169e29e6f7f7b103de4e90550024ab172685a6d1` |

Frozen correction artifacts:

| Artifact | SHA-256 |
|---|---|
| `task-10b1-ci1-owned-files.json` | `3db4816f81d2d57f7acdf2b1f82439cd6e5df9933450a616416f15787e9b8cd0` |
| `task-10b1-ci1-delta.diff` | `aa31574523abd30ac3005f3adcc10a6b97131ae46dd24989a30838fb47a59666` |
| `task-10b1-ci1-review-package.diff` | `396c5b3caaab227811ad27a66194c9ea0c7bcb8a63c2ad09e96faaec9f17e5e7` |

The delta is relative to published base `589eda875a3a00f1889a82d87b9f6ef90ae88c9c`. The full-file package contains the complete corrected test for independent review. This report is an additional coordination artifact whose digest is reported out of band.

Frozen upstream implementation hashes, unchanged:

| File | SHA-256 |
|---|---|
| `app/api/v1/customer/notifications/read/route.ts` | `ab99c0e45c994b5980bcd7bbc4ac8a29a29229177c11803790875bab656462b4` |
| `app/api/v1/website/quote/route.ts` | `9e952ee044fdb854a24a61859364f38e7132f78224bf3f3db91a9ddbee681c7f` |
| `app/api/v1/website/quote/validate/route.ts` | `6b333b16e9ebc6ee0ae7a9a6ee104d0fc773de95fe5a22d33faf141ddf599690` |
| `lib/partner-api/business.ts` | `1dcfc0cba8f678e5e2632c0252e720f199624ec3e9ff0aad3ae4af6f9c581100` |
| `quality/audits/proofs/api-strict-schema-regression.mjs` | `21f59d99ef579d0e423a1329bd4737f36489cef2e38ba312d676f5c935621345` |

## Pending gates

- Scoped independent review of the one-file correction is required before root publication.
- After reviewed publication, root owns supported Node 22 focused permanent Vitest, full Vitest, and the previously skipped build. The previously passing lint/type/mechanical/quality gates must also remain green in that acceptance run.
- Partner price idempotency remains Task 10c. No dependency, workflow, SQL, generated type, root memory, Git, external, or other-task change was made.
