# Gridex Website Integration API

Current contract: **2026-08-20.1**

The canonical human-readable documentation is served at `/developers/customer-portal-api`. The machine-readable contract is published at `/api/v1/openapi/website-integration-v1.json`.

## Responsibility boundary

**Gridex platform** owns published electricity offers, authoritative price-area resolution and quotes, legal-document versions, canonical customer and contract state, idempotent processing, supplier-switch and facility-information processing, communication state, and the customer-facing data exposed by enabled services.

**Your integration** owns the customer experience, verified end-customer identity, customer and site input, server-side API calls, exact display of Gridex pricing/legal evidence, stable idempotency keys, persistence of public application references, and webhook signature verification/deduplication.

Do not send internal database identifiers. The API credential determines the organization and permissions.

For migrations from older integration guides, the canonical developer page documents the structured POA fields `powerOfAttorney`, `textVersionId` and `externally_sendable`, transitional identity aliases such as `personal_identity_number` and `organisationsnummer`, and asynchronous result fields `next_step`, `next_action` and `automatic_processing`. Their definitions and examples live only in the canonical developer guide and OpenAPI contract.

For troubleshooting, record the `request_id` returned by Gridex together with your own correlation identifier. Do not log API credentials, identity numbers or other unnecessary personal data.
