# PHASE-45 handover — Complete OpenAPI 2026-08-05.2 and quote integrity

Main push `ec4ca3b6` bumped the public contract to `2026-08-05.2` but left the
release incomplete. This branch finishes materialization and closes the related
integrity/docs gaps.

## What was wrong

1. Immutable release artifacts/routes for `2026-08-05.2` were missing while the
   registry already advertised them.
2. Local verify/regression gates did not fail on missing materialization.
3. Website public-contracts OpenAPI example retained `2026-08-05.1`.
4. Quote response example omitted required `offer`.
5. Developer guide still hard-coded prior contract versions in examples.
6. Quote integrity hashed `valid_until` canonically but not
   `market_data_timestamp`, so PostgREST `+00:00` vs JS `Z` could diverge.

## What changed

- `canonicalQuoteTimestamptz` now normalizes both top-level hashed timestamps.
- Finalize re-normalizes contract versions before write and fills quote `offer`.
- Materialized `docs/openapi/releases/2026-08-05.2/*` and matching API routes.
- Verify/regression scripts assert current OpenAPI, release bytes, registry and
  quote example completeness.
- Developer guide examples use `documentationVersion`.

## Verification completed

- finalize / materialize / verify-openapi-release
- website quote integrity regression
- API docs version, examples, compatibility, public-contract runtime
- customer legal package regression

## Resume

Deploy the branch. Confirm `/api/v1/openapi/2026-08-05.2/*.json` and the release
manifest serve the materialized bytes, then continue the pending private/business
legal-bundle -> acceptance -> POA -> supplier-switch smoke.

## Do not claim yet

- deployed OPS source;
- clean npm install/full typecheck/test/lint/build;
- live private/business two-tenant E2E completion.
