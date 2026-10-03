# Gridex Staff Support API

Independent contract: **2026-10-03.1** (`staff-support-v1`). Website and Customer
Portal **2026-10-02.4**, their release manifest and historical immutable files
retain their existing bytes. Preparing this release does not establish that it
has been deployed, its database prerequisites applied, or real staff sessions
verified.

Use the unified developer guide at `/developers/customer-portal-api#staff-support`.
The current document is `/api/v1/openapi/staff-support-v1.json`; the immutable
document is `/api/v1/openapi/2026-10-03.1/staff-support-v1.json`.
`/api/v1/openapi/staff-release-manifest.json` publishes the independent version,
minimum staff client version, immutable/current document URLs and SHA-256 of
the exact serialized document bytes. Its `capabilities` describe implemented
protocol methods, never an employee's grants. Draft artifacts expose no protocol
capabilities; immutable materialization requires every first-release route.

## Authenticate the integration and the employee

The trusted Web BFF keeps the integration key and staff credentials on its
server. Resource requests require both credentials:

```http
Authorization: Bearer <tenant integration API key>
X-Gridex-Staff-Authorization: Bearer <OPS-issued staff proof>
```

The key determines the organization and required machine scopes. OPS verifies
the separate staff proof, its session/API-client/organization binding, current
native session and account eligibility, assurance level and fresh permissions.
Ordinary customer identity headers, customer assertions, Web roles and a caller's
staff/company/customer UUID cannot authorize staff. Native Auth access and
refresh credentials remain inside OPS.

Create the dedicated key in native OPS platform administration at
`/admin/platform/api-clients`, using the separate staff-client form. It creates
an independent `custom` client marked `staff_support_v1`, with the five staff
scopes and origin `https://support123.gridex.se`. The credential is displayed
once, after its creation audit and activation succeed; only its hash is stored.
Creation and staff-client lifecycle changes require current, unexpired platform
administration authority. The website permission editor cannot convert it to a
website client. Staff machine authentication retains the native credential,
tenant, scope, IP, origin and traffic checks, and uses its own route policy;
website installation receipts and `api_sales` readiness do not authorize staff.

`POST /api/v1/staff/sessions` accepts JSON `{email,password}` and returns a
server-only session receipt: `status`, `staff_access_token`, opaque
`refresh_token`, `token_type`, `expires_in`, `expires_at`, `refresh_expires_at`,
`session_reference`, `staff_reference`, `organization_reference` and safe TOTP
factor references. Proof lifetime is five minutes. Keep credentials in a
host-only Secure/HttpOnly cookie at the BFF; never expose the receipt to browser
JavaScript, URLs or logs.

`mfa_required` and `password_change_required` sessions have no customer-data
capabilities. Complete the required native TOTP/password steps before resource
access. Unsupported MFA methods are refused with a documented 403 blocker.
Recovery returns a generic 202 without disclosing whether an account exists.
Its recovery token is verified by an explicit server request; recovery sessions
remain restricted until password change and any required MFA succeed.

Session refresh authenticates its client-bound opaque refresh credential.
Logout requires either the current personal proof or the same client's refresh
credential in the request body; the machine key alone cannot revoke a session.
Login and recovery bootstraps are explicit exceptions to personal-proof headers.
All exceptions and request bounds are enumerated in OpenAPI. Authentication JSON
is limited to 16 KiB, rejects unknown fields and requires `application/json`.
Session commands except logout additionally use independent per-command
authentication budgets: 10 attempts per target identity and 30 per
API-client/trusted IP in a 15-minute window. `staff_auth_rate_limited` is
retryable 429 with `Retry-After: 900`.

## Permissions and customer data

Machine scopes are `staff_sessions.write`, `staff_context.read`,
`staff_customers.read`, `staff_support.read` and `staff_support.write`. None is an
alias of a customer-portal/support scope. OPS intersects those scopes with the
employee's current authority on every operation.
Permission revocation takes effect on the next request. A read already
authorized before the revocation may finish; the API does not promise to cancel
in-flight reads. Native write guards recheck authority in their transaction.

- Customer search/profile/related reads require **`customers.read`**.
- Case/entry/assignee/attachment reads require **`cases.read`**.
- Support mutations require **`cases.write`** and active eligible tenant staff.
- Platform administrators may read only the API-key organization and have no
  staff write exception.

These are deliberately stricter API read rules than the native console's
combined customer/case rules. `GET /api/v1/staff/me` returns the staff reference,
nullable display name, organization reference, platform flag, fresh permissions
and effective resource capabilities. Protocol manifest capabilities do not
replace this authenticated result or the operation's server guard.

The staff customer finder and support workspace consume `/api/v1/staff/**`
through the BFF. They do not query OPS tables, duplicate OPS customer data in Web,
use a native-console domain alias, or impersonate a customer through the
own-customer API. Native UUIDs, full personal identity numbers, arbitrary source
metadata, storage paths and provider diagnostics are excluded from public DTOs.
Missing optional values are null. Personal numbers use a masked projection.

## Lists, writes and attachments

The machine document and generated endpoint index list the mounted methods.
The resource families are `/staff/customers` and `/staff/support/cases`, with
separate paged contact/address/facility, entry, assignee and attachment reads.
No silently capped related arrays are embedded in customer detail.

List requests accept only their documented filters and `limit`/`cursor`.
`limit` defaults to 50 and must be an integer from 1 through 100. Nonempty search
text is 2–120 characters. Unknown/duplicate query fields and invalid filters are
refused. Filtering occurs before the database limit. Ordering uses
`created_at DESC, id DESC`; opaque cursors bind the tenant, integration client,
staff actor, resource and normalized filters. Changed/tampered scope returns
400. Continuation does not promise a snapshot across concurrent edits.

Paged JSON has a top-level `page` containing `limit`, `returned`, `has_more` and
nullable `next_cursor`. Every successful JSON response has `data`, `request_id`,
`correlation_id` and `contract_schema_version: "2026-10-03.1"`. The independent
version also appears in `X-Gridex-Contract-Version`. Staff responses are private,
no-store. Measured API budgets use the standard `X-RateLimit-*` headers.
Staff reads additionally permit 60 requests per minute for the verified
organization/API-client/actor. New support mutations permit 20 per minute for
the same bound actor; an authorized exact idempotent replay consumes no extra
command budget. `staff_rate_limited` returns retryable 429 and `Retry-After: 60`.

Every support POST requires a stable `Idempotency-Key`: 16–128 characters from
letters, digits, dot, underscore, colon and hyphen. Refresh, logout, MFA verify
and password change also require it. Preserve the exact operation/body/key after
a lost response. Changed content conflicts; an uncertain provider result does
not authorize blind refresh/password/OTP replay or inventing a new key.

Create/reply/note/status/assignment derive actor and customer ownership in OPS.
Their strict JSON request bodies are limited to 48,000 bytes. Null optional
description/category/facility/status-message fields are accepted; required
text cannot be blank or contain NUL. `Idempotency-Replayed` reports whether the
authorized response reused the original persisted command result.
Support creation does not stop billing, onboarding, metering, switches or other
operational processes. Replies are customer-visible; internal notes remain
internal. `phone_summary` is an explicitly published staff reply, not a customer
message. Status and assignment require the preceding `expected_updated_at`;
stale writes fail with 409. Replies, notes and uploads are refused for closed
cases. An explicit status command may reopen a case. A stored reply does not
promise an email delivery.

Attachment upload accepts exactly one multipart `file`, with optional
`visibility: internal|customer` (default **internal**). File size is at most
4 MiB. Existing approved attachments up to 10 MiB remain downloadable. Uploads
also obey the shared limit of 20 attachments per customer per rolling 24 hours,
including concurrent customer/staff uploads. The shared daily limit returns
retryable `attachment_quota_exceeded` 429 with `Retry-After: 86400` on the staff
API. The persisted 201 DTO includes `scan_status: released|rejected|quarantined`;
201 alone does not mean a file is downloadable. Only released, hash-verified
PDF/PNG/JPEG bytes are downloaded. Staff content checks additionally refuse
encoded/encrypted PDF streams, including historical released PDFs; scan status
records these finite content checks. Unapproved/corrupt files return 409. Internal
and rejected staff files never become customer-visible merely because the staff
can inspect their outcomes. Actual storage/recovery qualification is a separate
release gate.

## Errors, release preparation and verification

Errors contain safe `code`, `message`, `retryable`, nullable `field` and finite
blockers, together with request/correlation IDs and the staff version. Blockers
exclude native resource IDs and arbitrary diagnostic metadata. Missing personal
proof is 401; authority/stage denial is 403; inaccessible references are uniform
404; conflicts are 409. Organization lifecycle failures include 410/423, rate
limits 429 plus `Retry-After`, and unavailable authority/provider/storage 503.
An active native session lease can return retryable `staff_session_busy` 409
with `Retry-After: 1`; permission revocation remains a 403 authority denial.

Deployment configuration is independent from customer-portal authentication:

| Runtime | Required configuration | Meaning |
| --- | --- | --- |
| OPS | `GRIDEX_STAFF_SIGNING_KEY` | Canonical base64 signing material of at least 32 bytes. |
| OPS | `GRIDEX_STAFF_VAULT_KEY` | Distinct canonical base64 key of exactly 32 bytes for the native-session vault. |
| OPS | `GRIDEX_STAFF_RECOVERY_ORIGIN` | Exactly `https://support123.gridex.se`; native recovery allowlist and transactional SMTP must be ready. |
| Web BFF | `GRIDEX_STAFF_OPS_API_URL` | Explicit HTTPS OPS `/api/v1` base with no credentials/query/fragment. |
| Web BFF | `GRIDEX_STAFF_API_KEY` | Separate tenant integration credential with the required staff scopes. |
| Web BFF | `GRIDEX_STAFF_SESSION_COOKIE_SECRET` | Independent canonical base64 key of exactly 32 bytes for the encrypted staff cookie. |

These values remain server-side. Customer configuration does not supply staff
credentials. The staff session, resource-command and attachment-command database
prerequisites require separate qualification and deployment; source preparation
does not apply them. Fresh role-expiry/catalog/native-platform checks remain
authoritative after deployment.

Generate current documentation/types/registry with `npm run api:staff:generate`.
After the auth/resource implementations and schemas are frozen, materialize the
immutable release with `npm run api:staff:materialize`. It refuses missing
first-release methods and refuses changing an existing immutable artifact.
`npm run api:staff:check` validates generated provenance, request/response
examples, route inventory, independent release bytes and preserved legacy `.4`
fingerprints. `api:docs` includes this gate.

Before enabling the staff frontend, approve the exact standalone document SHA
and verify live manifest/current/immutable bytes with
`GRIDEX_API_BASE_URL=https://app.gridex.se npm run api:staff:release:verify`.
Require fresh native auth/tenant/permission/transaction/storage tests, ordinary
OPS/Web CI and real preview staff login/MFA/reset/session and two-tenant role
journeys. Missing documentation, fingerprint mismatch, unavailable authority or
missing deployment prerequisites must keep the staff frontend unavailable.

Existing Customer Portal invoice-reference, granular-pagination and metering
relation gaps are listed in [the API gap report](gridex-api-contract-gaps-2026-10-03.md). This staff
release does not fix or reclassify those gaps.
