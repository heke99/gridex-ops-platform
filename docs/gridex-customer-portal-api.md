# Gridex Customer Portal API

Current contract: **2026-10-04.1**

Release 2026-10-02.4 corrected the closed support-case detail schema so its existing `messages` field validates, and aligned the closed release-manifest schema with its response. Release 2026-10-04.1 adds the separate Staff API family and its manifest metadata. Customer portal request requirements and business response fields remain unchanged. Integrations using 2026-10-02.3 remain supported; strict schema snapshots must include the 2026-10-02.4 support-detail correction or a later release. Earlier immutable specifications retain their original bytes and document-version headers.

The attachment download headers introduced by 2026-10-02.3 are retained: binary responses send `X-Gridex-Contract-Version` and `X-Request-ID`. Both the 2026-10-02.2 and 2026-10-02.3 immutable releases remain unchanged.

Use the canonical developer guide at `/developers/customer-portal-api#customer-portal` and the OpenAPI specification at `/api/v1/openapi/customer-portal-v1.json`.

Customer portal access is server-to-server. Gridex resolves the organization from the API credential and limits customer data to the verified linked customer identity. Internal database identifiers are not part of the public integration contract.

## Customer support (2026-10-01.1)

The organization's own support page uses these endpoints. The same cases are handled by the organization's staff in OPS, including cases that continue over the phone.

| Method | Path | Scope |
|---|---|---|
| GET | `/api/v1/customer/support/cases` | `customer_support.read` |
| POST | `/api/v1/customer/support/cases` | `customer_support.write` |
| GET | `/api/v1/customer/support/cases/{reference}` | `customer_support.read` |
| GET | `/api/v1/customer/support/cases/{reference}/messages` | `customer_support.read` |
| POST | `/api/v1/customer/support/cases/{reference}/messages` | `customer_support.write` |

**Scopes.** `customer_support.*` must be granted explicitly. It is not implied by `customer_portal.read` or `customer_portal.write`.

**Identity.** All calls require an actively linked portal user (`x-gridex-customer-portal-user-id` / `x-gridex-auth-user-id`). A customer number or e-mail address alone is not verification: writes bound only by identifiers return `403 customer_identity_binding_required`. Reads never create or reactivate portal links.

**What the customer sees.** Only messages written by the customer, and replies a staff member explicitly sent to the customer, are returned. A call summary appears only when staff publish it, and it is marked `kind: "phone_summary"` with `author_type: "staff"`. Internal notes, phone logs and technical case events are never returned. The case status is the customer-visible vocabulary (`received`, `in_progress`, `resolved`, `closed`).

**References.** `case_reference` is an opaque public reference. It does not grant access: every lookup is bounded to the verified customer, and another customer receives `404`.

**Writes.** Both POST endpoints require `Idempotency-Key`. The same key with the same payload replays the stored result. The same key with a different payload returns `409`. A closed case rejects new messages with `409 support_case_closed`.

## Support attachments (2026-10-02.1)

| Method | Path | Scope |
|---|---|---|
| GET | `/api/v1/customer/support/cases/{reference}/attachments` | `customer_support.read` |
| POST | `/api/v1/customer/support/cases/{reference}/attachments` | `customer_support.write` |
| GET | `/api/v1/customer/support/cases/{reference}/attachments/{attachmentReference}` | `customer_support.read` |

**Upload.** Send the raw file as the request body. Do not use JSON or multipart.
- **Content-Type:** `application/pdf`, `image/png` or `image/jpeg`.
- **Size:** at most 4 MB.
- **Headers:** `Idempotency-Key` is required. `X-File-Name` (URL-encoded) is optional.
- **Name and type:** the real file type is detected from the bytes, and the file name is sanitized. The name's extension always matches the detected type.
- **Limit:** at most 20 attachments per customer per 24 hours (`429`).
- **Closed case:** a closed case returns `409 support_case_closed`.

**Quarantine.** Every file is stored privately and starts quarantined. It is released only after a content check:
- the real type must be one of PDF, PNG or JPEG;
- PDFs must contain no active content (JavaScript, launch or submit actions, embedded files, XFA);
- PDFs must not be truncated.

A rejected file returns `422 attachment_rejected` and is never served. This is a content check, not an antivirus scan.

**What the customer sees.** The list and download endpoints return only released attachments that are visible to the customer: the customer's own uploads, and files staff explicitly shared with the customer. Internal staff files are never returned.

**Download.** Files are served as `Content-Disposition: attachment` with `nosniff` and a sandboxing CSP. `X-Gridex-Sha256` carries the hash, which is re-verified on every download. A file whose stored bytes no longer match the hash is refused with `409`.


**Per-customer quotas.** In addition to the API client's rate limit, each end customer may open at most 50 new support cases per 24 hours and send at most 150 messages per hour. Above that the API returns `429 support_quota_exceeded`. Retrying an `Idempotency-Key` that already created a case is never refused by the quota.

**Verified customer login (optional, per tenant).** A tenant can let Gridex verify the end customer's login itself (OPS → Inställningar → Kundinloggning). The tenant server then sends the login's signed assertion in `x-gridex-customer-assertion`:
- Format: compact JWS signed with RS256, PS256 or ES256 (`none` and HS* are rejected).
- Claims: `iss` and `aud` as shown in OPS (both are specific to the tenant; for own-login keys `iss=gridex-tenant:<company id>` and `aud=gridex-customer-api:<company id>`), `sub` = the linked portal user id, `exp` at most 15 minutes after `iat`, and a unique `jti` (each assertion is accepted once). Optional `amr`/`acr` records the login method (for example BankID).
- Keys: an OIDC provider's published JWKS, or the tenant's own public key (generated in the browser; the private key never reaches Gridex).
- Rollout: "Logga bara" accepts calls and logs `customer_assertion_would_reject`; "Kräv verifierad kund" returns `403 customer_assertion_required` or `403 customer_assertion_invalid`. Tenants without a configuration are unaffected.

**Side effects.** Opening a support case does not stop billing, onboarding, metering requests or switches.

**Reference client.** `docs/examples/tenant-support-reference-client.mjs` is a synthetic, server-side reference integration for the support page. It is tested end to end against the mounted routes.

## Profile and facility address updates (behaviour clarification, 2026-10-09)

`POST /api/v1/customer/profile-update` (`customer_contact.write` and/or `customer_facility_data.write`). Request and response shapes are unchanged; this section documents the runtime semantics.

**Validation before mutation.** Every referenced resource is resolved before anything is written. A `facility_data.facility_reference` that does not belong to the verified customer returns `404 resource_not_found` and the `profile` part of the same call is not applied. Later database failures are not covered by a cross-resource transaction: the profile part commits in its own transaction, and `address_result` reports the facility outcome.

**Patch semantics.** Omitted profile fields stay untouched. `facility_data.address` is the complete physical address (street, postal code, city, optional country and apartment number). `care_of` is an informational recipient line; when it is omitted or empty the stored value is kept.

**Same physical address.** The physical identity of a facility address excludes `care_of`. Sending the same physical address returns `address_result.status: "unchanged"`; a changed `care_of` is still saved and audited, and `address_result.reason` is then `care_of_updated` (additive field value). Grid owner, routing and verification are not invalidated by a `care_of` change. A same-address submission from the customer portal never replaces a stronger stored source (for example a grid-owner verified address); only the receipt time is updated.

**Conflicts.** A different physical address for a facility whose address is verified by a stronger source returns `address_result.status: "conflict"` with `reason: "verified_address_conflict"`, and the completion is `submitted` for staff review instead of `accepted`. The same decision is repeated atomically when the address is committed, so a verification that lands concurrently still yields a conflict rather than an overwrite.

## Related Partner API pricing and location semantics (2026-10-09)

Documented in the Partner runtime specification (`/api/partner/v1/openapi.json`); response shapes are unchanged.

- **Spot vs. customer quote.** `GET /api/partner/v1/price/current` returns the bare market spot interval (ex VAT, no supplier or grid fees). `POST /api/partner/v1/price` returns a total customer price estimate for the credential's default offer, calculated by the Gridex pricing engine.
- **Channel.** The Partner API selects and quotes offers published on the API channel only. API-only offers are quotable; Website-only offers are never used by the Partner API.
- **Assurance.** `location.status: "resolved"` and `verified: true` require usable price-area assurance. Identifiers behind stale or unverified geodata are provisional (`status: "partial"`, `verified: false`, warning `location_identifiers_provisional`) and never produce a price. `grid_owner.verified` is geographic identity, not Ediel routing readiness.
