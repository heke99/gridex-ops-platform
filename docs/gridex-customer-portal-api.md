# Gridex Customer Portal API

Current contract: **2026-10-01.1**

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

**Side effects.** Opening a support case does not stop billing, onboarding, metering requests or switches.
