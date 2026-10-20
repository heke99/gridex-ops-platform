# Gridex Customer Portal API

## Power-of-attorney evidence and archive

The structured `power_of_attorney` consent in organization customer sync uses `ip_address` for the customer's IP recorded by the tenant backend at the original `accepted_at`; website checkout uses `powerOfAttorney.ipAddress`. Include signer identity, method and the exact accepted document/scopes. OPS generates its own stable verification number, saves the accepted text and evidence, and includes the number on every PDF page and in external request/follow-up emails. Tenant users can retrieve their own PDFs under **Fullmakter**; superadmins can filter by tenant, customer or verification number.

BankID is optional. A form click and a client-supplied `method`/metadata value do not prove BankID verification. No live BankID integration is enabled. API intake remains compatible with older payloads; external email is held when signer IP or verification evidence is missing. Completing evidence for an existing acceptance cannot change its signer, original timestamp, legal document or scopes. Existing uploaded PDFs are copied byte-for-byte into the private archive. See the [manual POA mail runbook](manual-poa-mail-runbook.md) for routing, rejections and follow-up behavior.

Current documentation: **2026-10-12.1**. Default response contract: **2026-10-09.1**.

Documentation-only revisions leave the default wire contract unchanged. Business requests need no documentation-version header. An older supported representation can be pinned on the credential in OPS; the tenant does not need to copy the latest documentation to keep using the API.

You do not need to match the latest documentation revision exactly to use a supported API version. See the [compatibility policy](api-compatibility-policy.md) and the [migration guide](api-migration-guide.md).

Release 2026-10-09.1 is documentation-only: the OpenAPI document now describes support message and attachment continuation (`X-Gridex-Next-Cursor` / `cursor`), closure-versus-replay precedence, `503 idempotency_completion_uncertain`, `409 idempotency_reconciliation_required` and that metering values are a bounded detail list rather than complete-month totals. Request requirements and response fields are unchanged.

Release 2026-10-02.4 corrected the contradictory closed support-case detail schema so its existing `messages` field validates, and aligned the closed release-manifest schema with its response. Release 2026-10-04.1 adds the separate Staff API family and its manifest metadata. Integrations using 2026-10-02.3 keep their V1 business requests; credential pinning projects closed object fields where the historical schema is coherent. The contradictory support-detail validator requires its specific schema correction, as described in the compatibility policy. Earlier immutable specifications retain their original bytes and document-version headers.

The 2026-10-12.1 documentation records pagination on resource envelopes and the existing `submitted_at` field on move-out results. `authenticated_user_reference` is your tenant login account/user subject. It resolves an existing active same-organization portal account; it is not a central database resource UUID and never creates an implicit email-based grant. Customer support always requires that active account binding, including on reads. Customer assertions require integer `iat`, a short permitted lifetime and a fresh `jti`.

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

**Writes.** Both POST endpoints require `Idempotency-Key`. The same key with the same payload replays the stored result. The same key with a different payload returns `409`. A closed case rejects new messages with `409 support_case_closed`. `503 idempotency_completion_uncertain` means the write may already be saved but its receipt could not be confirmed: retry with the same key and payload, never with a new key. A stored success is never turned into a failure by a later retry.

**Message history continuation.** `GET …/messages` and the case detail return the customer-visible history oldest first, at most 500 messages per response. Without `cursor` the response is the same first page as before. When later messages exist the response carries the header `X-Gridex-Next-Cursor`; call `GET …/messages?cursor=<value>` to read the next 500 (repeat until the header is absent). The response body shape is unchanged. The cursor is opaque and bound to the tenant, the verified customer and the case; a modified cursor, or one from another case, customer or tenant, returns `400 invalid_cursor`.

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
- **Closed case:** a new upload on a closed case returns `409 support_case_closed`. Precedence: authentication, scope and case ownership are always checked first; then a retry with the same `Idempotency-Key` and the same bytes of an upload that already succeeded replays the original `201` result (`Idempotency-Replayed: true`, no new file) even if the case was closed in between. The same key with different bytes returns `409`.

**Quarantine.** Every file is stored privately and starts quarantined. It is released only after a content check:
- the real type must be one of PDF, PNG or JPEG;
- PDFs must contain no active content (JavaScript, launch or submit actions, embedded files, XFA);
- PDFs must not be truncated.

A rejected file returns `422 attachment_rejected` and is never served. This is a content check, not an antivirus scan.

**List continuation.** The list returns released attachments oldest first, at most 100 per response. Without `cursor` the response is the same first page as before. When more exist the response carries `X-Gridex-Next-Cursor`; send it as `?cursor=` to continue. The cursor is bound to the tenant, customer and case; invalid or foreign cursors return `400 invalid_cursor`.

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

## Metering values and month totals

`metering_values` in the portal bundle and `GET /api/v1/customer/metering-values` are bounded detail lists of the latest values. Do not sum a detail page into a month total: a complete month of hourly values has 672–745 intervals per metering point, depending on month length, leap year and Europe/Stockholm daylight-saving transitions; quarter-hour data has four times as many. The OPS-hosted customer portal computes its month cards with a native aggregation over the complete Europe/Stockholm calendar month, bounded to the tenant and the verified customer, counting only the current revision of each value (corrected values are never counted twice) and only gross consumption. A month with missing intervals is shown as incomplete instead of as a complete total.
