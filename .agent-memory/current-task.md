# Current task

Last updated: 2026-08-05T22:40:00Z
Branch: `cursor/codebase-health-and-stability-33d5`

## Active phase

PHASE-45 — Complete unfinished OpenAPI `2026-08-05.2` release and quote integrity.

## Goal

Close the incomplete main push that bumped the public contract to
`2026-08-05.2` without immutable release artifacts, with stale docs/examples and
incomplete quote timestamptz hashing.

## Implemented

- Canonicalized top-level `market_data_timestamp` alongside `valid_until` for
  website quote integrity hashing and persistence.
- Fixed stale website public-contracts example version via late finalize
  normalization.
- Added required `offer` to the website quote response example.
- Materialized immutable OpenAPI release `2026-08-05.2` JSON and route handlers.
- Pointed developer guide examples at `documentationVersion` instead of a
  hardcoded prior contract version.
- Strengthened `verify-openapi-release` and quote-integrity regression to assert
  real OpenAPI JSON, release artifacts, registry routes and quote `offer`.

## Verification

- `node scripts/finalize-openapi-release.cjs`: PASS
- `node scripts/materialize-openapi-release.cjs`: PASS
- `node scripts/verify-openapi-release.cjs`: PASS
- `node scripts/gridex-website-quote-integrity-regression.mjs`: PASS
- `node scripts/check-api-documentation-version.cjs`: PASS
- `node scripts/check-api-documentation-examples.cjs`: PASS
- `node scripts/check-public-contract-runtime-openapi.cjs`: PASS
- `node scripts/check-api-compatibility.cjs`: PASS
- `node scripts/gridex-customer-legal-package-regression.cjs`: PASS
- Full dependency-backed typecheck/test/lint/build: NOT RUN (no node_modules)

## Exact next action

Open/merge the health PR, deploy OPS with materialized `2026-08-05.2` routes,
then run one private/business legal-bundle -> acceptance -> POA -> supplier-switch
smoke flow.
