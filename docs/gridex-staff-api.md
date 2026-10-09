# Gridex Staff API — 2026-10-04.1

Use the Staff API from your backend to manage staff accounts and handle customer service in your own application.

- Base URL: `https://app.gridex.se/api/v1/staff`
- Current OpenAPI: `https://app.gridex.se/api/v1/openapi/staff-v1.json`
- Immutable OpenAPI: `https://app.gridex.se/api/v1/openapi/2026-10-04.1/staff-v1.json`
- Release manifest: `https://app.gridex.se/api/v1/openapi/release-manifest.json`
- Public guide: `https://app.gridex.se/developers/staff-api`

## Configure staff login

Create a server-side Gridex API credential with the specific staff scopes your application needs. Existing website and customer portal scope groups do not grant staff access.

In Settings → Customer login, create an identity provider with purpose **Staff**. Choose an OIDC provider or publish the public key used by your own backend. Copy the configured issuer (`iss`) and audience (`aud`) exactly. Staff and customer login providers are configured separately. The staff provider always requires verified identity.

Your application authenticates its staff. Before every Gridex request, your backend signs a short lived JWT that identifies the person performing that operation. Never expose the Gridex API credential or signing private key to a browser. Never accept a browser supplied user UUID as proof of identity: derive the Gridex user UUID from the authenticated account mapping held by your backend.

## Sign one assertion per request

Send both headers on every staff operation:

```http
Authorization: Bearer <GRIDEX_API_KEY>
x-gridex-staff-assertion: <SIGNED_JWT>
```

The JWT must be a compact JWS signed with **RS256, PS256 or ES256**. `none` and symmetric `HS*` algorithms are rejected. Its protected header contains `alg` and, when your provider publishes multiple keys, `kid` matching the public key. Use a standard JWT library or the Node.js example below.

| Claim | Required value |
| --- | --- |
| `iss` | Exact issuer configured for staff login |
| `aud` | Configured staff audience |
| `sub` | Acting staff member's Gridex user UUID |
| `iat` | Integer Unix timestamp, in seconds |
| `exp` | Integer Unix timestamp after `iat`, at most 900 seconds later |
| `jti` | Unique unpredictable identifier for this request |
| `nbf` | Optional earliest valid Unix timestamp |

Each assertion is accepted **once**. Generate a new `jti` and sign a new assertion for reads, writes and retries. A valid signature never replaces membership or permission checks: Gridex requires an active staff membership in the organization associated with the API credential and calculates permissions from that person's role and overrides on the server.

This example uses RS256 and the built-in Node.js crypto library. Use your own configured issuer, audience and key ID. Keep the private PEM in your backend secret store.

```js
import { createPrivateKey, randomUUID, sign } from 'node:crypto'

function staffAssertion(authenticatedStaffGridexUserId) {
  const iat = Math.floor(Date.now() / 1000)
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  const header = encode({ alg: 'RS256', typ: 'JWT', kid: process.env.GRIDEX_STAFF_KEY_ID })
  const payload = encode({
    iss: process.env.GRIDEX_STAFF_ISSUER,
    aud: process.env.GRIDEX_STAFF_AUDIENCE,
    sub: authenticatedStaffGridexUserId,
    iat,
    exp: iat + 300,
    jti: randomUUID(),
  })
  const input = `${header}.${payload}`
  const signature = sign('RSA-SHA256', Buffer.from(input),
    createPrivateKey(process.env.GRIDEX_STAFF_PRIVATE_KEY_PEM))
  return `${input}.${signature.toString('base64url')}`
}

// Resolve this value from the current, authenticated staff account on your server.
const assertion = staffAssertion(authenticatedAccount.gridexUserId)
const response = await fetch('https://app.gridex.se/api/v1/staff/customers?page=1&page_size=25', {
  headers: {
    Authorization: `Bearer ${process.env.GRIDEX_API_KEY}`,
    'x-gridex-staff-assertion': assertion,
  },
  cache: 'no-store',
})
```

## Scopes and permissions

The API credential's scope and the person's permission are both required. Giving the credential a write scope does not grant that permission to staff.

| Scope | Operations | Person's permission |
| --- | --- | --- |
| `staff_users.read` | List staff and roles | `users.read` |
| `staff_users.write` | Invite, change role, disable, reactivate | `users.write` |
| `staff_customers.read` | Search and retrieve customers | `customers.read` |
| `staff_customers.write` | Change contact details | `masterdata.write` |
| `staff_customers.write` | Request identity change | `customers.write` |
| `staff_cases.read` | List and retrieve cases and attachments | `cases.read` |
| `staff_cases.write` | Create, reply, note, phone, status, assignee, upload | `cases.write` |

Staff cannot assign a role with permissions exceeding their own. Staff cannot disable themselves. The final active administrator cannot be disabled or demoted. Case assignees must be active staff in the same organization.

## Write safely and retry

Every POST and PATCH requires `Idempotency-Key`. Generate one key for each logical operation. When retrying that operation, send the **same key and unchanged body**, together with a **new signed assertion and new `jti`**. Changing the body while reusing the key produces an idempotency conflict. Do not reuse a key for a new operation or different staff member.

Contact updates require `expectedUpdatedAt`, copied from the customer's latest `updated_at`. A version conflict means you must reload the customer and reconcile changes before sending a new operation. At least one editable field must be present. Identity changes use a separate approval process; staff do not bypass the customer's approval email or required new contract acceptance.

```http
PATCH /api/v1/staff/customers/<customer_reference>/contact
Authorization: Bearer <GRIDEX_API_KEY>
x-gridex-staff-assertion: <FRESH_SIGNED_JWT>
Idempotency-Key: contact-20261004-001
Content-Type: application/json

{
  "expectedUpdatedAt": "2026-10-04T08:30:00.000Z",
  "email": "customer@example.com"
}
```

Customer and case paths use opaque references returned by Gridex. Staff account operations use Gridex user UUIDs. Customer identity numbers are masked in responses. Internal notes and phone logs are available only through authorized staff calls. Every write records the staff actor, API credential and `staff_api` channel in the audit trail.

Attachments use a raw PDF, PNG or JPEG body of at most 4 MiB, plus an optional `x-file-name`. Set `x-attachment-visibility: internal` or `customer`; the default is `internal`. Uploaded content enters inspection. Only released attachments can be downloaded. Download responses use an attachment disposition and verify the stored SHA-256.

## Replay, request IDs and storage project

Every Staff write response, including staff-user invite, role change, disable and enable, carries `Idempotency-Replayed: true` when the stored result of an earlier identical operation is returned, and `false` for a new execution. Current authentication, scopes, permission and active membership are always checked before a stored result is replayed.

Gridex issues one server request ID per call. The same value is returned in `request_id`, the `X-Request-ID` response header and the request log, on success and on error. Quote it to support. An inbound `X-Request-ID` is never used as the server ID; when it matches `^[A-Za-z0-9._:-]{1,128}$` it is retained only as a separate client correlation value.

Send the optional `x-gridex-expected-project-ref: <20-character project ref>` header to make sure the call is served by the storage project you expect. A mismatch, or a malformed value, returns `412 storage_project_mismatch` before authentication, rate limiting, audit or any write. Responses from an identified project carry `X-Gridex-Project-Ref`. The OpenAPI text for these headers and the strict query profile follows in the next contract release; the runtime behaviour applies now.

## Query parameters

List endpoints (`/users`, `/customers`, `/cases`, case `/events` and `/attachments`) reject unknown parameters with 422. By default each endpoint keeps the parsing it has always accepted, so existing integrations are unaffected. Send `x-gridex-query-parsing: strict` to opt in to one rule for all of them: every parameter at most once, and `page`, `page_size` and `limit` only as plain decimal digits (no sign, whitespace, exponent, fraction, hexadecimal prefix or leading zero). Violations return `422 invalid_field` with `error.field` naming the parameter. New integrations should use the strict profile. Defaults: `page=1`, `page_size=25` (max 100); `limit` is 1–100. Organization selector fields such as `company_id` are never accepted; the organization always comes from the credential.

## Read complete case history

Case detail contains initial events and attachments plus `events_page` and `attachments_page`. When `has_more` is true, call `GET /api/v1/staff/cases/{reference}/events` or `GET /api/v1/staff/cases/{reference}/attachments` with `cursor=next_cursor`. Each collection accepts `limit` from 1 to 100 (default 50). Follow the returned cursor until `has_more` is false; sign a fresh assertion for every page. Cursors are bound to the organization, customer and case and cannot select another resource.

Customer detail explicitly marks its initial contacts, addresses and sites with `contacts_page`, `addresses_page` and `sites_page`: `limit` is 100, `returned` is the included count, and `has_more` identifies additional records beyond the initial collection.

## Errors

Errors use the same closed envelope throughout this API:

```json
{
  "error": {
    "code": "staff_permission_denied",
    "message": "The acting staff does not have the required permission.",
    "retryable": false,
    "field": null,
    "blockers": []
  },
  "request_id": "request-reference",
  "correlation_id": "request-reference",
  "contract_schema_version": "2026-10-04.1"
}
```

| HTTP | Code examples | Action |
| --- | --- | --- |
| 400 / 422 | `idempotency_key_required`, `idempotency_key_invalid`, request validation | Correct the headers or fields; follow `error.field` when present |
| 401 | `staff_assertion_missing`, `staff_assertion_signature_invalid`, `staff_assertion_issuer_mismatch`, `staff_assertion_audience_mismatch`, `staff_assertion_expired`, `staff_assertion_replayed` | Correct identity configuration or sign a fresh assertion; never fall back to another account |
| 403 | `api_scope_missing`, `staff_provider_missing`, `staff_provider_invalid`, `staff_membership_inactive`, `staff_permission_denied`, `staff_role_ceiling_exceeded` | Correct configuration, active membership or authorized role |
| 404 | `staff_user_not_found`, `customer_not_found`, case or attachment missing | Use a current reference from the same organization |
| 412 | `storage_project_mismatch` | Call the deployment that serves the expected storage project; nothing was executed |
| 409 | `version_conflict`, `staff_self_disable_forbidden`, `staff_last_admin_required`, `staff_invalid_user_state, staff_self_role_change_forbidden`, idempotency conflict | Reload state and reconcile the operation; preserve administrator safeguards |
| 413 / 415 | Attachment size or content type | Use a supported file within the size limit |
| 429 | Rate limit | Observe `Retry-After`, then use the same operation key with a fresh assertion |
| 500 / 503 | Processing or required service unavailable | Retain the request ID; retry only when safe and indicated by `retryable` |

The OpenAPI document specifies each request, response field, HTTP status and required scope. Discover the active release and document checksums through the release manifest. Existing website and customer portal operations keep their existing behavior.
