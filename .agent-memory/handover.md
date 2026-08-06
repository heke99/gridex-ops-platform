# PHASE-45 handover — OpenAPI 2026-08-05.2 health completion

Main push `daaeca19` published immutable OpenAPI `2026-08-05.2` artifacts, but
left quote integrity and release-verification gaps that PR #77 had already
identified on a sibling branch. This branch ports and completes those fixes on
top of the published main artifacts.

## What changed

- `canonicalQuoteTimestamptz` canonicalizes top-level quote timestamptz fields
  so PostgREST `+00:00` and JS `Z` cannot diverge hashes.
- `canonicalQuoteGridAreaCode` normalizes nullable/blank/case grid-area compares
  across resolution snapshot and quote-row checks.
- Finalize seeds required quote example `offer` and re-normalizes contract
  versions after late example assignment.
- Immutable website release JSON for `2026-08-05.2` was rematerialized to match
  current OpenAPI (required `offer` included).
- `verify-openapi-release` now requires matching immutable JSON/routes and
  registry entries.
- Quote integrity regressions assert real OpenAPI JSON, release artifacts,
  registry routes and quote example `offer`.

## Verification completed

- `node scripts/gridex-quote-null-grid-area-regression.mjs`
- `node scripts/gridex-website-quote-integrity-regression.mjs`
- `node scripts/verify-openapi-release.cjs`
- API documentation version / compatibility / public-contract runtime checks

## Resume

Merge and deploy. Create one website quote, reload it through PostgREST, and
validate with:

1. matching hash despite `Z` vs `+00:00` timestamptz serialization;
2. null/absent `grid_area_code` accepted when only price area is resolved;
3. immutable `/api/v1/openapi/2026-08-05.2/...` routes serving the rematerialized
   bytes including quote example `offer`.

## Do not claim yet

- merged/deployed OPS source;
- clean npm install/full typecheck/test/lint/build;
- live quote create → validate E2E completion.
