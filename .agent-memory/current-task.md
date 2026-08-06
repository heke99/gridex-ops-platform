# Current task

Last updated: 2026-08-06T07:55:00Z
Branch: `cursor/codebase-health-and-stability-f0c7`

## Active work item

WP-HEALTH — Complete incomplete OpenAPI `2026-08-05.2` release and harden
website quote integrity after main push `dbab7d1f`.

## Goal

Prevent future quote validation and API-contract breakage by finishing the
published `2026-08-05.2` contract package and making nullable grid-area /
timestamptz quote comparisons deterministic.

## Implemented this session

- Canonicalized top-level quote timestamptz fields (`valid_until` and
  `market_data_timestamp`) and nullable grid-area comparisons.
- Re-finalized and materialized immutable OpenAPI `2026-08-05.2` JSON + routes.
- Fixed stale public-contracts example version and missing quote example `offer`.
- Strengthened `verify-openapi-release` and quote regressions; registered
  `api:materialize` and `gridex:quote-null-grid-area-regression`.

## Verification

- `gridex:quote-null-grid-area-regression`: PASS
- `gridex:website-quote-integrity-regression`: PASS
- `api:release:verify`: PASS (local immutable artifacts)
- `check-api-documentation-version`: PASS
- `check-api-compatibility`: PASS
- `check-public-contract-runtime-openapi`: PASS
- `check-api-documentation-examples`: PASS
- Full npm install/typecheck/test/lint/build: NOT RUN in this sandbox

## Exact next action

Open/update PR for this branch, then deploy and prove one live quote create →
validate cycle where resolution `grid_area_code` is null and
`market_data_timestamp` round-trips through PostgREST.
