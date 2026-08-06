# Handover — quote integrity and OpenAPI 2026-08-05.2 completion

Triggered by main push `dbab7d1f` (nullable grid-area quote validate fix).

## Problems found beyond the push

1. Contract version `2026-08-05.2` was registered and current OpenAPI bumped, but
   immutable release JSON/routes under `docs/openapi/releases/2026-08-05.2/` and
   `app/api/v1/openapi/2026-08-05.2/` were missing. Local `verify-openapi-release`
   previously only hashed current specs, so the gap stayed green.
2. Quote integrity canonicalized `valid_until` but not top-level
   `market_data_timestamp`, so PostgREST `+00:00` vs JS `Z` could still break
   quote hash validation.
3. Grid-area comparison on the quote row remained case-sensitive after the null
   snapshot fix.
4. Finalize assigned examples after version normalization, leaving a stale
   public-contracts `contract_schema_version` and a quote example missing required
   `offer`.

## Fixes on branch

- Shared `canonicalQuoteTimestamptz` + `canonicalQuoteGridAreaCode`.
- Finalize late re-normalization + quote example `offer`.
- Materialized immutable `2026-08-05.2` artifacts/routes.
- Hardened verify/regressions and package scripts.

## Verified locally

- quote null-grid-area regression
- quote integrity/OpenAPI sync regression
- api release verify, docs version, compatibility, fixture/runtime, examples

## Do not claim yet

- deployed OPS
- full npm typecheck/test/lint/build
- live null-grid-area quote create→validate E2E
