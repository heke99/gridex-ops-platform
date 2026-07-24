# Gridex OPS – implementation report for market-price API 2026-07-24.2

## Goal

The implementation makes Gridex OPS the canonical source for the complete chain:

`Elpriset Just Nu → normalized intervals → verified daily evidence → market previews → canonical SE1–SE4 resolution → quote/current-price API → OpenAPI and developer portal`.

A tenant continues to need only its ordinary Gridex API key. Tenant context is derived from the key. No new tenant ID, provider URL, price-area mapping, or pricing environment variable is required.

## Root causes corrected

1. The spot-price cron ran every six hours while previews could expire after three hours.
2. The routine imported the previous Stockholm day but did not maintain the current day for a true current-interval API.
3. `rolling_30_days` could be published from only one eligible day without strongly typed completeness fields.
4. Historical `complete` summaries were not promoted after local interval evidence had become verifiable.
5. Preview freshness could be renewed by recalculation rather than by new provider evidence.
6. Tenant fallback policy and tenant-specific maximum age were not applied consistently to preview selection.
7. Provider priority was not part of the canonical preview selection order.
8. Quote `market_reference` exposed provenance but not the direct numeric price used by the quote engine.
9. There was no tenant-facing endpoint for the current interval tied to canonical `resolution_id`.
10. Runtime routes, scopes, OpenAPI, developer documentation, and examples could drift independently.

## Implemented architecture

### Import and evidence

- The cron runs hourly at minute 15.
- It processes previous and current Stockholm dates and may prefetch the next date after publication time.
- Existing complete local evidence is validated before any provider request is made.
- Validation is duration based and supports Swedish 23-, 24-, and 25-hour days.
- Missing coverage can be repaired with the idempotent service-role backfill script.
- Locked settlement evidence is never rewritten by the repair path.

### Preview lifecycle

The canonical builder publishes:

- `latest_complete_day`
- `rolling_7_days`
- `rolling_30_days`
- `month_to_date`

Every preview carries requested/included days, source timestamps, generated timestamp, checksum, source resolution, and explicit fallback status. The V2 publication RPC returns an unchanged result when the source evidence is unchanged, so recalculation cannot manufacture freshness.

### Tenant selection policy

Selection now applies, in order:

1. configured provider priority;
2. canonical price area;
3. supported contract resolution;
4. requested reference period;
5. complete window before fallback;
6. `allow_indicative_latest`;
7. the stricter of global and tenant-specific freshness;
8. source evidence timestamp.

### Current market price

`POST /api/v1/website/market-price/current` accepts a tenant-bound `resolution_id`. OPS loads the canonical SE1–SE4 area from the resolution and selects the interval where `time_start <= now < time_end`.

The response contains the direct price in SEK/kWh and öre/kWh. It explicitly states that VAT, supplier fees, and grid fees are not included. It is not a settlement endpoint and not a replacement for the complete quote.

### Quote market reference

A variable quote now exposes the exact source value used by the energy line:

- `price_sek_per_kwh`
- `price_ore_per_kwh`
- ex-VAT equivalents
- requested/included days
- source/generated/freshness timestamps
- fallback metadata

The value is produced by the same resolver used by the quote engine rather than recalculated in the API route.

### Readiness and health

OPS health V3 includes blockers for:

- missing current day;
- missing previous day;
- incomplete rolling-30 window;
- stale preview;
- tenant fallback-policy conflict;
- a freshness policy stricter than available evidence.

The admin System Health page displays these market-price checks separately.

## Database delivery

Migration:

`supabase/migrations/20260724223000_market_price_api_documentation_completion.sql`

The migration is additive and idempotent. It does not call external providers. It adds preview evidence fields, a versioned publication RPC, the new API scope, scope backfill for website API clients, coverage/readiness views, and health V3.

A new RPC name is used rather than changing an existing function return type. This avoids PostgreSQL error `42P13`.

## API contract and documentation

Contract version: `2026-07-24.2`.

The same release updates:

- runtime route;
- public route registry;
- scope registry and API-client profiles;
- Website Integration OpenAPI;
- Customer Portal OpenAPI responsibility boundary;
- developer portal;
- Markdown integration guides;
- public changelog;
- route/OpenAPI/version/example parity checks.

`public-contracts`, `market-price/current`, and `quote` are documented as three different operations:

- `public-contracts`: product selection feed;
- `market-price/current`: current raw market interval before VAT and contract fees;
- `quote`: complete canonical customer calculation.

## Validation completed in the delivery environment

The following checks passed:

- TypeScript syntax/transpilation for all changed TS/TSX files.
- `git diff --check`.
- JSON parsing for both OpenAPI specifications and `package.json`.
- migration integrity: 298 migration files and 203 version groups;
- market-price regression: 19 controls;
- canonical market/resolution/quote/billing regression: 35 controls;
- single-API-key tenant integration regression: 107 controls;
- public API registry check: 34 runtime route files;
- route/OpenAPI parity: 36 registry routes and 38 OpenAPI operations;
- documentation version parity: `2026-07-24.2`;
- documentation example validation;
- OpenAPI responsibility-boundary validation.

Canonical static command:

```bash
npm run verify:market-price-api:static
```

## Validation limitation

A clean `npm ci` could not complete in the delivery environment because the package registry repeatedly returned HTTP 503. Consequently the full dependency-backed `typecheck`, Vitest suite, and Next.js production build could not be completed here. No code failure was observed in the checks that could run without dependency installation.

Run the full command after dependencies are available:

```bash
npm ci
npm run verify:market-price-api
```

## Required deployment order

1. Sync the patch into the repository.
2. Install dependencies and run static verification.
3. Apply the Supabase migration.
4. Run the historical coverage backfill.
5. Run the production SQL verification.
6. Run full typecheck/tests/build.
7. Deploy the application and hourly cron together.
8. Smoke test SE1, SE2, SE3, and SE4 through resolver → current price → quote.

The migration must be applied before deploying code that calls health V3 or reads the new preview fields.

## Backfill command

```bash
SUPABASE_URL="$SUPABASE_URL" \
SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
npm run spot:backfill -- \
  --start-date=2026-06-24 \
  --end-date=2026-07-24 \
  --areas=SE1,SE2,SE3,SE4
```

The script is safe to rerun. Verified/locked dates are skipped, valid local complete evidence is promoted, missing dates are imported, and previews are rebuilt after each area.

## Final acceptance checks

The release is ready for live traffic only when:

- all four areas have current and previous day evidence;
- each rolling-30 preview has `requested_days=30`, `included_days=30`, and no fallback for tenants that forbid fallback;
- current-price responses use the same area as the resolution;
- quote market reference and quote energy line contain the same source price;
- health V3 has no blocking `spot_*` rows;
- OpenAPI headers and body version are `2026-07-24.2`;
- `npm run verify:market-price-api` and the production smoke test are green.
