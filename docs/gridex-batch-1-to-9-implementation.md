# Gridex Batch 1–9 structured implementation

This batch is intentionally split into production-safe foundations instead of one risky rewrite.

## Batch 1 — Pricing unit selector and conversion

- Pricing now uses `unit` as source of truth.
- `ore_per_kwh` is converted to SEK/kWh by dividing by 100.
- `sek_per_kwh` is used directly.
- `sek_month`/fixed monthly fees are used directly and can be periodized.
- Pricing preview lines store input amount/unit metadata so invoice lines can explain the original admin-entered unit.

## Batch 2 — Billing and invoice readiness

- Existing normalized-metering billing source remains the primary source.
- Billing underlay status stays DB-safe: `validated`, `pending`, `failed`.
- Business readiness remains in `readiness_status`.
- Added provider webhook storage for invoice/factoring status reconciliation.

## Batch 3 — Actor registry and customer intake

- Tenant admins should select verified grid owners/suppliers from the central actor register.
- Technical actor creation, Ediel IDs, subaddresses, certificates and routes remain platform-admin tasks.
- This batch adds supporting indexes for customer/site/metering-point lookup.

## Batch 4 — Incoming Ediel business request automation

- Inbound operational processing now records a business decision log.
- The decision log stores tenant, sender/receiver, family/code, matched customer/site/metering point and recommended action.
- If tenant or object match is unsafe, the record is kept for manual review rather than guessing.

## Batch 5 — Integration core and billing provider adapters

- Added provider-neutral billing webhook intake.
- Capway can be configured as a provider without hardcoding Capway-specific business logic into billing core.
- Webhooks are stored idempotently and can emit domain events.

## Batch 6 — Tenant customer portal API

- Added API endpoint for tenant websites to sync customer portal identities.
- It only auto-links when there is a strong match: email plus customer number, identity/org number, facility or metering point.
- Weak matches become pending review and do not expose customer data.

## Batch 7 — Dashboard and statistics

- Added dashboard snapshot foundation and helper for cached company metrics.
- Metrics include customers, sites, metering points, active contracts, mätvärden, billing readiness and Ediel blockers.
- Dashboards should read cached snapshots or paginated summaries, not raw payloads on every page load.

## Batch 8 — UI simplification and performance

- Navigation remains split between tenant business views and platform technical views.
- Company users should primarily see Kunder, Avtal, Mätvärden, Fakturaunderlag, Avvikelser and Rapporter.
- Platform admins keep Ediel raw payloads, routes, certs and test center.

## Batch 9 — Ediel cleanup and admin tools

- Added controlled Ediel cleanup run audit table.
- The message cleanup action is limited to test/certification data and requires typed confirmation.
- Production Ediel history should be archived/retained, not hard-deleted.

## Required environment variables

- `BILLING_WEBHOOK_SECRET_CAPWAY` or `BILLING_WEBHOOK_SECRET_FALLBACK` for provider webhook verification.
- Existing `CRON_SECRET` / `EVENTS_CRON_SECRET` for cron-driven dispatch.

## New endpoints

- `POST /api/webhooks/billing/[provider]`
- `POST /api/v1/customer-portal/sync`

## New regression scripts

- `npm run pricing:unit-conversion-regression`
- `npm run gridex:batch-1-9-regression`
