# Gridex API release test alignment — 2026-08-04

## Problem

The runtime, current OpenAPI documents and release manifest use contract version `2026-08-04.2`, while four regression test files and one response fixture still pinned expectations to `2026-08-04.1`. This caused six false-negative test failures after the quote adapter fix, despite the targeted quote and contract tests passing.

## Fix

- Current release tests now compare runtime and OpenAPI against `WEBSITE_INTEGRATION_CONTRACT_VERSION` instead of a stale hard-coded version.
- The canonical release test now verifies the current `2026-08-04.2` compatibility classification in the release-manifest test, rather than mixing the old `2026-08-04.1` release classification into the pre-authentication behavior test.
- The contract channel test verifies both the runtime response schema constant and current OpenAPI info version against the canonical contract constant.
- A current public-contract response fixture for `2026-08-04.2` has been added and the route/OpenAPI regression test uses it.
- Immutable archived `2026-08-04.1` OpenAPI routes and release documents remain unchanged.

## Database impact

None. No migration is included.

## Verification

Run:

```bash
npm run typecheck
npx vitest run \
  __tests__/api-canonical-release.test.ts \
  __tests__/contract-channel-publication-completion.test.ts \
  __tests__/market-price-api-contract.test.ts \
  __tests__/public-contract-route-openapi-regression.test.ts
npm test
npm run build
```

The sandbox could not install dependencies because its internal npm mirror does not contain `zod-validation-error@4.0.2`. Static validation confirmed that runtime, current OpenAPI and the new fixture all resolve to `2026-08-04.2`, and that the six stale assertions are removed.
