# Gridex Website Integration API

Current contract: **2026-08-20.2**

The canonical human-readable documentation is served at `/developers/customer-portal-api`. The machine-readable contract is published at `/api/v1/openapi/website-integration-v1.json`.

## Responsibility boundary

**Gridex platform** owns published electricity offers, authoritative price-area resolution and quotes, legal-document versions, canonical customer and contract state, idempotent processing, supplier-switch and facility-information processing, communication state, final settlement/invoice calculations, and the customer-facing data exposed by enabled services.

**Your integration** owns the customer experience, verified end-customer identity, customer and site input, server-side API calls, exact display of Gridex pricing/legal evidence, stable idempotency keys, persistence of public application references, and webhook signature verification/deduplication.

Do not send internal database identifiers. The API credential determines the organization and permissions.

## Pricing, quote validity and billing

The contract version remains **2026-08-20.2**. The following fields describe different concepts and must not be treated as interchangeable:

- `valid_until` belongs to a checkout quote snapshot. It defines when that quote must be validated or renewed before submission. It is not the commercial end date of the electricity price and does not lock a variable/spot market price for future invoices.
- `valid_to` on a published price option or area price is the commercial end date of that price definition. `null` means that no commercial end date is configured.
- `market_reference` in a quote is public checkout/preview evidence. Internal source-row identifiers are intentionally excluded from the public response.
- For variable and spot products, the final energy charge is calculated from the customer's actual metered consumption and the applicable authoritative market/settlement price for the billing period and configured product resolution, together with the contract's markups, fees, taxes and other applicable pricing components.
- An integration must therefore use the quote for checkout display, validation and audit evidence, not as the authoritative market-price input for a later invoice.

For migrations from older integration guides, the canonical developer page documents the structured POA fields `powerOfAttorney`, `textVersionId` and `externally_sendable`, transitional identity aliases such as `personal_identity_number` and `organisationsnummer`, and asynchronous result fields `next_step`, `next_action` and `automatic_processing`. Their definitions and examples live only in the canonical developer guide and OpenAPI contract.

For troubleshooting, record the `request_id` returned by Gridex together with your own correlation identifier. Do not log API credentials, identity numbers or other unnecessary personal data.
