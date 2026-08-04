# Price-area assurance and pricing readiness

**Release:** `2026-08-04.2`  
**Migration:** `20260804173000_price_area_assurance_and_pricing_readiness.sql`

## Purpose

This release separates the evidence required to calculate and quote an electricity price from the evidence required to identify the grid owner, request facility data, create a supplier switch and dispatch EDIFACT.

OPS remains the only source of truth for:

- canonical SE1-SE4 resolution;
- price and quote readiness;
- published offer and area-price selection;
- spot, fixed, portfolio and mixed-price calculation;
- immutable quote and contract pricing snapshots.

Tenant websites must consume `capabilities` and must not interpret `resolution_status` as a readiness decision.

## Readiness model

`price_area_assurance` has four states:

- `verified`: facility data, grid-area master or a current address polygon verifies one SE area;
- `estimated`: bounded postal/city consensus identifies exactly one SE area with confidence of at least `0.80`;
- `ambiguous`: candidates span more than one SE area, or a postal mapping contradicts canonical grid-area masterdata;
- `unresolved`: evidence is missing, incomplete, stale or below policy.

An `estimated` postal result may set `pricing_ready=true` and `quote_ready=true`. It never sets facility lookup, switch creation or EDIFACT dispatch ready.

## Database behavior

The migration adds durable assurance provenance to `customer_site_resolution`, including status, source, confidence, candidate counts, source version and evidence JSON.

Existing rows are handled conservatively:

- verified lifecycle states with a canonical `price_area` are backfilled as `verified`;
- historical `postal_suggested` rows are backfilled as `unresolved` and must be resolved again;
- no historical postal row is silently promoted to pricing-ready.

## API behavior

`POST /api/v1/website/energy-area/resolve` now returns `price_area_assurance`.

The immutable OpenAPI documents are available at:

- `/api/v1/openapi/2026-08-04.2/website-integration-v1.json`
- `/api/v1/openapi/2026-08-04.2/customer-portal-v1.json`

This is an additive response-field release with a readiness correction. Tenant clients that already follow `capabilities.pricing_ready` and `capabilities.quote_ready` remain compatible.

## Deployment order

1. Deploy the database migration.
2. Run `scripts/sql/verify-price-area-assurance.sql` in the target database.
3. Deploy OPS runtime and OpenAPI release together.
4. Run `npm run gridex:price-area-assurance-regression`.
5. Run `npm run api:release:verify` locally and against production with `GRIDEX_API_BASE_URL=https://app.gridex.se`.
6. Resolve a real postal/city address and confirm that a single-area consensus can quote while EDIFACT remains blocked.
