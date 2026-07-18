# Canonical portfolio pricing completion — 2026-07-18

## Goal

This release completes the versioned portfolio-pricing chain used by both platform-admin contract creation and the company-specific **Skapa hemsideavtal** flow. The canonical chain is:

`admin editor → price_plan_version.snapshot_json → materialized price components/monthly prices → publication → quote/checkout → signed contract snapshot → billing run`.

No tenant, quote or invoice is allowed to select a monthly portfolio price from a different `price_plan_version_id`.

## Canonical concepts

The following values are separate and must never be conflated:

- **Portfolio share** — percentage of the customer's energy quantity priced by the portfolio source.
- **Monthly portfolio price** — the published energy price for one month and one price area, stored publicly as öre/kWh excluding VAT and materialized internally as SEK/kWh.
- **Portfolio management fee** — a separate price component that may use öre/kWh, SEK/kWh, SEK/month, SEK/invoice, a one-time SEK amount or a percentage.
- **Percentage calculation base** — the explicit monetary base used by a percentage component. Percentage values use the `0..100` representation.

## Shared administration

Both `/admin/contracts` and `/admin/companies/[id]` use the same reusable pricing controls and the same `normalizeContractPricing` function. Both paths create the same schema-v4 pricing snapshot and use the database pricing-version orchestration. The company page fixes `company_id` from the selected company context; the platform page requires an explicit tenant selection.

Every public price component has a separate **Visa på hemsidans avtalskort** choice. This choice affects only public card presentation. The full component remains in quote calculation, checkout disclosure, signed contract evidence and invoicing.

## Monthly portfolio prices

`portfolio_monthly_prices` remains the single physical table. The forward migration adds exact references to `price_plan_id` and `price_plan_version_id`; no parallel monthly-price table is introduced.

Canonical uniqueness is:

`price_plan_version_id + price_area + billing_month`

A common `ALL` row in the editor is expanded to the contract version's selected SE1–SE4 areas before hashing and publication. Duplicate area/month rows and prices outside the contract's selected areas are rejected. Monthly energy prices may be zero or negative when the market outcome requires it; this exception does not apply to fees, markups or percentage components.

Published exact-version rows are immutable. A correction to already locked evidence requires a new price-plan version and a new publication. Future months may be appended as new immutable evidence rows linked to the same exact version when the commercial contract explicitly uses monthly ex-post portfolio pricing.

## Quote and billing behavior

Binding quote and billing lookup require the exact `price_plan_version_id`. A missing exact row blocks the calculation; the engine never silently falls back to another version, another tenant or a prior month. Public readiness requires the later of the contract start month and the current Stockholm month, so an expired monthly price cannot leave checkout falsely enabled. A real published zero value is distinct from a missing row and remains valid.

Billing underlays are monthly. A commercial invoice spanning several months must therefore aggregate one underlay/pricing run per billing month. Each run stores the monthly portfolio price identifier, month, price area, unit price, version references and calculation-base evidence in line metadata. This preserves reproducibility and prevents one month's price being applied to another month.

Prices retain high precision internally. VAT is a decimal fraction in calculation snapshots; public/admin percentage input is documented as percentage points. Monetary invoice output is rounded only by the existing pricing-preview/invoice finalization rules.

## API contract

API contract version: `2026-07-18.2`.

The public contract response includes:

- `pricing.portfolio_monthly_prices[]`
- `pricing.portfolio_price` for the current/nearest published month
- `pricing.portfolio_management_fee` with amount, unit and optional `calculation_base`
- `pricing.components[].website_card_visible`
- `customer_type` plus expanded `customer_types`

Hidden card components are omitted from public card fields but remain in the locked commercial snapshot used for customer acceptance and billing.

## Database migration

`20260718010000_canonical_portfolio_pricing_versions.sql`

The migration:

1. adds percentage calculation bases to `price_components`;
2. extends the existing monthly-price table with exact plan/version references;
3. adds tenant/version validation and immutable locked-row protection;
4. materializes schema-v4 snapshot prices;
5. exposes `portfolio_monthly_price_versions_v` in öre/kWh;
6. updates pricing RPC support for percentage units;
7. updates contract-publication readiness to require the exact version's monthly price.

## Release gates

Before production deployment:

1. migration checksum verification;
2. canonical portfolio regression;
3. OpenAPI contract check;
4. full test suite;
5. lint/typecheck/build;
6. linked Supabase dry-run and migration apply;
7. staging E2E for both admin entry points;
8. quote and billing comparison for the same tenant/version/month/area;
9. public API check showing only selected card components;
10. immutability check proving an older signed contract and invoice remain unchanged.
