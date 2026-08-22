# Gridex Website Integration API

Current contract: **2026-08-22.1**

The canonical human-readable documentation is served at `/developers/customer-portal-api`. The machine-readable contract is published at `/api/v1/openapi/website-integration-v1.json`.

## Responsibility boundary

**Gridex platform** owns published electricity offers, organization-scoped pricing configuration, authoritative price-area resolution, immutable checkout quotes, legal-document versions, customer and contract state, supplier-switch processing, facility-information processing, communication state, and final settlement/invoice calculations.

**Your integration** owns the customer experience, verified end-customer identity and input, server-side API calls, exact display of pricing/legal evidence, stable idempotency keys, persistence of public references, and webhook signature verification/deduplication. The API credential determines the organization and permissions. Never send internal organization identifiers or organization selectors.

## Pricing acceptance and settlement

The `settlement` object on a website quote is the canonical interpretation of what the customer accepts:

- `fixed_price`: the energy price is locked at signup. The invoice still uses actual metered consumption, so the total amount can vary with kWh.
- `market_monthly`: the customer accepts the monthly market-price model. Final energy settlement uses actual metered monthly consumption and the authoritative market price for the billing period.
- `market_hourly`: the customer accepts the hourly market-price model. Final settlement uses actual hourly consumption and the applicable hourly market prices.
- `market_quarter_hour`: the customer accepts the quarter-hour market-price model. Final settlement uses actual 15-minute consumption and the applicable quarter-hour market prices.
- `portfolio`: the customer accepts the portfolio pricing model. Final settlement uses the authoritative portfolio settlement for the period and actual metered consumption.
- `mixed`: the customer accepts the published mixture and its component rules; each component is settled according to its configured source and resolution.

For every non-fixed model, checkout market data is **indicative preview/audit evidence only** and never becomes the future invoice market price. Agreed markups, fees, taxes and other immutable commercial components remain part of the accepted contract.

`valid_until` remains in V1-compatible quote payloads as compatibility and immutable audit metadata. Gridex does **not** expire a customer-visible website quote merely because wall-clock time passes. Explicit revocation, organization mismatch, integrity mismatch or a commercially unavailable/withdrawn offer can still block submission.

`valid_to` on a published price option or area price is a commercial validity boundary. `null` means no commercial end date is configured.

Public `market_reference` contains public pricing evidence only. Internal source-row identifiers are never part of the public contract.

## Structured power of attorney and asynchronous processing

When a published agreement requires power of attorney, send the structured `powerOfAttorney` object documented by the canonical developer guide and OpenAPI contract. Bind the acceptance to the authoritative legal text with `textVersionId`; do not send or trust client-authored legal text as the contract source. The resulting public `power_of_attorney` status exposes whether the acceptance is `externally_sendable` and whether completion is still required.

For migration compatibility, identity input may use documented transitional aliases such as `personal_identity_number` and `organisationsnummer`, but integrations should normalize to the canonical public contract and must not infer or submit internal database identifiers.

Application responses are asynchronous where the Gridex platform owns downstream work. Persist the public application reference and follow the documented `next_step` and `next_action` values. `automatic_processing` means the Gridex platform has accepted responsibility for the continuation; it does not mean every supplier-switch, facility-information, communication, or settlement step has already completed.

For troubleshooting, record Gridex `request_id` and your correlation identifier. Do not log API credentials, identity numbers or other unnecessary personal data.
