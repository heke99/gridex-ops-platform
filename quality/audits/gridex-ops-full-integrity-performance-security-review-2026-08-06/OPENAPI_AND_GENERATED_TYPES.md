# OpenAPI and generated types

## Repository state

The reviewed tree contains:

- current `docs/openapi/website-integration-v1.json` and `customer-portal-v1.json`;
- immutable release directory `docs/openapi/releases/2026-08-05.2/`;
- current and versioned App Router serving routes under `app/api/v1/openapi/`;
- release manifest route;
- generated website/customer portal TypeScript declarations;
- runtime contract/version constants and developer documentation referring to `2026-08-05.2`.

At the **artifact-presence level**, the latest version is consistent. This audit did not regenerate artifacts or run a deployed tenant against them.

## Drift risks

| Layer pair | Status | Evidence / gap |
|---|---|---|
| Runtime version constant -> current OpenAPI | Repository-consistent | Search found `2026-08-05.2` across runtime and current artifacts. |
| Current OpenAPI -> immutable release | Present | Both immutable files/routes exist; byte-equivalence script not executed here. |
| OpenAPI -> generated `.d.ts` | `NOT_VERIFIED` | Generator/check exists, but exact-head generation was not run in the connected environment. |
| Generated types -> external website/portal | `NOT_VERIFIED` | Tenant repositories/installed client versions were not connected. |
| Route response mapper -> OpenAPI | Partial | Quote semantic drift is confirmed; full operation-by-operation runtime tests were not run. |
| Documentation examples -> schemas | `NOT_VERIFIED` exact head | Scripts exist but are not complete CI gates. |
| Deployed immutable routes/cache headers | `NOT_VERIFIED` | No deployment/browser/runtime access. |

## Confirmed semantic issue

OpenAPI can describe both timestamp strings correctly while runtime hash semantics remain wrong. `market_data_timestamp` is not canonicalized with `valid_until`, so contract/schema validity does not prove quote integrity. This demonstrates why schema checks and live round trips are both required.

## Required CI gates

1. Generate current OpenAPI and generated TypeScript declarations from exact head.
2. Fail on dirty diff after generation.
3. Verify current artifact equals immutable release when version is unchanged.
4. Validate all route methods, status codes, request and response schemas.
5. Run backward-compatibility classification for removed/required/enum/nullability changes.
6. Test API manifest, immutable cache headers and no mutation of published versions.
7. Test public error envelope, request ID and correlation ID.
8. Execute external tenant and portal compilation against exported declarations.

No OpenAPI or generated file was changed during this audit.