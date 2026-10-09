# Gridex Website Integration API

Current contract: **2026-10-04.1**

Release 2026-10-04.1 adds the separate Staff API family and its manifest metadata. Website request requirements and business response fields remain unchanged from 2026-10-02.4; existing immutable specifications retain their original bytes.

The canonical human-readable documentation is served at `/developers/customer-portal-api`. The machine-readable website contract is published at `/api/v1/openapi/website-integration-v1.json`.

## Responsibilities

**Gridex platform** owns published electricity offers, authoritative pricing and settlement rules, legal document versions, application processing and downstream electricity-market operations.

**Your integration** owns the customer experience, presentation, customer-entered data, controlled retries and secure handling of the API credential.

The API credential determines the organization and permissions. Integrations send public business data and public references only; internal platform identifiers are not part of the website contract.

## Production endpoints

Base URL: `https://app.gridex.se`

Use `Authorization: Bearer <GRIDEX_API_KEY>` for authenticated calls. Keep the credential server-side and never expose it in browser JavaScript, logs, analytics, URLs, screenshots or client-side error messages.

## Recommended checkout flow

Use the API in this order:

1. `GET /api/v1/website/public-contracts` — load the currently published offers and their public references.
2. `POST /api/v1/website/energy-area/resolve` — resolve the Swedish price area, `SE1`–`SE4`, for pricing.
3. `GET /api/v1/website/legal-bundle` — retrieve the exact legal documents and versions that must be accepted.
4. `POST /api/v1/website/quote` — create the authoritative checkout quote from the selected published offer.
5. `POST /api/v1/website/quote/validate` — validate the accepted quote before final submission when the checkout flow requires a fresh integrity check.
6. `POST /api/v1/website/customer-applications` — submit the accepted offer, quote, legal evidence, customer data and site data.
7. `GET /api/v1/website/customer-applications/{application_number}` — follow the authoritative application and downstream processing status.

Persist the public offer, quote and application references returned by Gridex. Do not reconstruct them client-side.

## Price-area and grid-owner boundary

`POST /api/v1/website/energy-area/resolve` is a **website pricing endpoint**. Its public responsibility is to resolve the applicable Swedish price area for the checkout experience.

A website integration must not treat a postcode result, coordinate, candidate owner or other provisional geography as authority for an external grid-owner operation. Canonical grid-area and grid-owner determination after intake is handled internally by Gridex and can use additional verification without changing the public website contract.

Send a full address (`street` + `city`), a `postal_code` or a `grid_area_code`. `facility_id` and `metering_point_id` are accepted only as references stored with the request; they never resolve a price area on their own. A request that contains only those identifiers is rejected with `422` and error code `energy_area_address_required`.

A postal-code centroid that lies close to a price-area boundary is never returned as price-ready; send a full address in that case.

This separation keeps checkout fast while preventing a provisional website lookup from becoming an external-send routing decision.

Invoicing never re-resolves the price area. Billing uses the locked `price_area` from the quote/contract price snapshot, and the database also rejects direct writes of a billing underlay whose price area is missing or differs from that snapshot (`billing_contract_price_area_missing`, `billing_underlay_price_area_mismatch`).

## Idempotency and retries

Use stable idempotency keys for logical write operations. Send a stable `Idempotency-Key` on every endpoint documented as idempotent, especially quote creation and customer-application submission. Reuse the same key only when retrying the same logical operation with the same intent.

For network failures or retryable server responses, retry with bounded exponential backoff and preserve the original idempotency key. Do not automatically retry validation errors or other responses explicitly marked non-retryable.

Record the Gridex `request_id` and your own correlation identifier for troubleshooting. Do not log API credentials, identity numbers or unnecessary personal data.

## Conditional requests for public contracts

`GET /api/v1/website/public-contracts` returns an `ETag`. Send it back in `If-None-Match` to receive `304 Not Modified` when nothing changed.

- The ETag identifies the representation for exactly your credential's organization, the requested `customer_type`, the channel, the selected V1 contract profile and the server's representation revision. A release that changes the response body for the same publication produces a new ETag, so an old body is never confirmed with `304`. A documentation-only release does not change it.
- Matching follows RFC 9110 for GET: weak comparison (`W/"…"` matches the same tag), comma-separated lists and `*` are supported.
- `If-None-Match` is evaluated only after authentication and scope checks; an invalid credential gets the normal error, never `304`.
- Responses are `Cache-Control: private, no-store` with `Vary: Authorization`. Keep your own verified snapshot per organization; never reuse a snapshot or ETag across organizations or customer types. Validate the organization reference, count and feed state on every `200`.

## Pricing acceptance and settlement

The `settlement` object on a website quote is the canonical interpretation of what the customer accepts:

- `fixed_price` — the energy price is locked at signup. The invoice still uses actual metered consumption, so the total amount can vary with kWh.
- `market_monthly` — final energy settlement uses actual metered monthly consumption and the authoritative market price for the billing period.
- `market_hourly` — final settlement uses actual hourly consumption and the applicable hourly market prices.
- `market_quarter_hour` — final settlement uses actual 15-minute consumption and the applicable quarter-hour market prices.
- `portfolio` — final settlement uses the authoritative portfolio settlement for the period and actual metered consumption.
- `mixed` — each published component is settled according to its configured pricing source and resolution.

For every non-fixed model, checkout market data is **indicative preview/audit evidence only**. It does not become the future invoice market price. Agreed markups, fees, taxes and other immutable commercial components remain part of the accepted contract.

### Pricing components and website visibility

`calculation_components` is the authoritative calculation set. Every applicable calculated component must remain in that set even when the website chooses not to render the component as a separate row.

`website_visibility=hidden` controls presentation only. It does not remove a fee, markup, tax or other applicable component from the Gridex calculation. Dolda komponenter filtreras inte bort från den auktoritativa beräkningen; an integration must never recalculate the contract by using only the visible/display subset.

Use `display_components` and the component visibility metadata for presentation. Use the authoritative quote totals and complete calculation data for acceptance, reconciliation and later audit.

`valid_until` remains in V1-compatible quote payloads as compatibility and immutable audit metadata. Gridex does not expire a customer-visible website quote merely because wall-clock time passes. Explicit revocation, integrity mismatch or a commercially unavailable or withdrawn offer can still block submission.

`valid_to` on a published price option or area price is a commercial validity boundary. `null` means no commercial end date is configured.

Public `market_reference` contains public pricing evidence only. Internal source-row identifiers are never part of the public contract.

## Legal acceptance, identity and power of attorney

When a published agreement requires power of attorney, send the structured `powerOfAttorney` object documented by the canonical developer guide and OpenAPI contract.

Bind acceptance to the authoritative legal text through `textVersionId`. It must be the `primary_document_id` of the `power_of_attorney` requirement in the same accepted legal bundle as `offer_reference`, or be omitted so Gridex binds that document. Another document id returns `409 power_of_attorney_offer_version_mismatch` and nothing is stored; the database enforces the same rule. The legal document version is unrelated to the API documentation revision: integrations do not need to follow documentation releases, but the signed legal document must match exactly. Do not submit client-authored legal text as the contractual source. The resulting public `power_of_attorney` block exposes `externally_sendable` so the integration can distinguish a complete authorization from one that still requires customer completion.

During migration from older website integrations, accepted customer-identity aliases can include `personal_identity_number` and `organisationsnummer`. These are transitional compatibility aliases; new implementations should use the canonical customer fields defined by the current OpenAPI specification rather than inventing additional aliases.

Transitional public aliases may remain documented for migration compatibility, but new integrations should use the canonical fields from the current OpenAPI specification.

Swedish identity numbers are validated before anything is stored. `customer.personal_number` must be a real personnummer or samordningsnummer (valid date and check digit) as 10 or 12 digits, with or without `-` or `+`; otherwise the request is rejected with `422` and error code `personal_number_invalid`. `customer.org_number` must be a valid organisationsnummer (a sole trader may send the owner's personnummer); otherwise the request is rejected with `422` and error code `org_number_invalid`. Both errors name the field in `field` and are not retryable: correct the value and submit again. Accepted values are normalized, so `811218-9876` and `198112189876` identify the same customer; a 10-digit personnummer gets its century from the birth date, and the `+` separator marks a person aged 100 or more.

## Asynchronous processing

A successful customer-application response confirms what the response explicitly states; it does not imply that every downstream market operation has already completed.

Persist the public application reference and follow the documented `next_step`, `next_action`, checkout state and application-status endpoint. `automatic_processing` means Gridex has accepted responsibility for the continuation. Supplier-switch, facility-information, communication and settlement work can complete asynchronously.

Agreement state and message-delivery state are separate. A signed agreement can be valid while confirmation delivery or another downstream operation is still pending.

## Errors

Treat the documented error envelope as the source of truth. Use the error `code`, `message`, `retryable`, optional field information and blockers to decide whether to retry, correct input or surface a controlled customer message.

Never branch business logic on free-form error text when a structured code is available.

## Contract release verification

Before deploying an integration update, read:

`GET /api/v1/openapi/release-manifest.json`

Verify that the release version, minimum supported integration version and SHA-256 digests match the OpenAPI documents you generated your client from. Immutable release URLs in the manifest can be retained for audit and reproducible builds.

For contract **2026-10-04.1**, the production integration must use the current V1 OpenAPI contract rather than assumptions copied from older examples.

## Production checklist

- API credential is server-side only.
- Current release manifest and OpenAPI SHA-256 digests are verified during build or release.
- Public offer, quote and legal references are persisted exactly as returned.
- `Idempotency-Key` is stable for retries of the same logical write.
- Website price-area resolution is not reused as grid-owner routing authority.
- Customer identity and site input are validated before submission.
- Legal acceptance uses the authoritative published document versions.
- Application status is treated as asynchronous until the API reports the relevant downstream state.
- Structured error codes and `request_id` are retained for support and observability.
- No secrets or unnecessary personal data are written to logs.
