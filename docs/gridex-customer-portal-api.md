# Gridex Customer Portal API

Current contract: **2026-09-29.4** (release candidate on the API draft branch)

Use the canonical developer guide at `/developers/customer-portal-api#customer-portal` and the OpenAPI specification at `/api/v1/openapi/customer-portal-v1.json`.

Customer portal access is server-to-server. Gridex resolves the organization from the API credential and limits customer data to the verified linked customer identity. Internal database identifiers are not part of the public integration contract.

Customer-delegated `/api/v1/customer/*` reads and writes (except tenant-machine
`POST /api/v1/customer/sync`)
require a second header, `x-gridex-customer-assertion`, issued by a platform-pinned
identity provider for the exact method and path. The token must carry the active
subject, tenant, API client and customer relation; an API key and a customer
number alone do not authorize an end user. If no issuer and subject binding
has been configured by the platform, these routes deny access. The tenant
machine `POST /api/v1/customer/sync` has a separate, exact
`customer_sync.write` scope. No real issuer or customer binding is configured by
this candidate. A tenant integration needs platform-managed enrollment before
delegated requests can succeed.

## Contact update contract

Keep the machine key on the tenant backend. A separately issued RS256 customer
assertion must bind `iss`, `aud`, `sub`, `iat`, `exp` and the signed
organization, API client, customer and action claims to the authenticated
client, currently active portal account, and exact `POST /api/v1/customer/profile-update`
path. It expires within five minutes. A customer number, email or API key alone
does not prove the customer's identity. Assertions are not one-time tokens and
do not authorize login, billing-recipient or legal identity changes.

First read `GET /api/v1/customer/me` with a fresh assertion for that exact
action and the `customer_profile.read` scope. Use `data.contact_revision` from
the response. The contact-only POST requires `customer_contact.write`, a new
`Idempotency-Key` and `expected_contact_revision` with either `profile.email`
or `profile.phone` (or both). No other profile or facility field may accompany
the contact change. A stale revision returns 409 `contact_revision_conflict`;
the same key with a different change returns 409
`contact_idempotency_conflict`. Reusing the same key and payload returns the
stored completion and revision without another contact mutation, after current
client and customer authority is checked again. The completed command persists
the customer/contact projection, revision, audit, completion and internal
outbox in one local database transaction. It does not synchronously deliver an
external message. `data.status` is `accepted`, and
`data.completion_reference` is an opaque public reference.

Other profile fields currently use `customer_contact.write`; facility address
changes use `customer_facility_data.write`. Send them in separate POST requests.
These legacy writers do not have the contact command's atomic audit/outbox and
replay guarantee. The machine sync rejects `profile.phone`; its other profile,
document, legal and facility writers also remain separately staged. Do not
infer the contact guarantee for these paths. See
`scripts/tenantservice/customer-api-reference.mjs` for a runnable synthetic
contact journey using an isolated in-memory issuer and customer.

## Paginated support reads

Use a new signed assertion for each exact GET path. `customer_contracts.read`
allows `GET /api/v1/customer/contracts`, and `customer_sites.read` allows
`GET /api/v1/customer/sites`. Each route accepts `limit` (default 50,
maximum 100) and an opaque `cursor` from its own previous `page.next_cursor`.
The cursor is bound to the current organization, customer and resource;
another customer's cursor or a malformed cursor returns 400 `invalid_cursor`.
Contracts return a public `data` array and `page`; sites return
`data.sites`, `data.metering_points` for those sites, and `page.sites`.
Missing contract fields remain JSON null where the canonical or legacy read
model has no value. These reads do not grant any write scope. The synthetic
reference client exercises both resources and their pagination shape.

## Invoice reads

With `customer_invoices.read` and a fresh assertion for each exact GET path,
`GET /api/v1/customer/invoices?limit=1` returns `data` as public invoice
objects and an opaque `page.next_cursor`. `limit` defaults to 50 and is capped
at 100. Use a returned cursor only for the same organization, customer and
resource; malformed or foreign cursors return 400 `invalid_cursor`. Only
issued, sent, paid, overdue, cancelled and credited invoices are listed.

Use an invoice's `invoice_reference` (for example,
`invoice_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee`) in
`GET /api/v1/customer/invoices/{id}`. The path takes this opaque reference,
not a database UUID or an invoice number. Its `data` contains `invoice`,
`lines` and `documents`. Each item exposes only its public fields and
references. An invoice outside the verified customer's view returns 404
`invoice_not_found` without its lines or documents. Unknown amounts and
quantities remain JSON null; zero means an actual zero value. The synthetic
reference client runs two list pages, a detail lookup and a 404 example.
These reads do not prove a complete billing or document-delivery workflow.

## Documents and notifications

Use `customer_documents.read` for `GET /api/v1/customer/documents` and
`customer_notifications.read` for `GET /api/v1/customer/notifications`.
Each exact GET path needs its own signed customer assertion. Both return an
allowlisted `data` array and `page`; `limit` defaults to 50 and is capped
at 100. Follow only the opaque `page.next_cursor` returned for the same
organization, customer and resource. An invalid or foreign cursor returns
400 `invalid_cursor`. Document rows include an opaque
`document_reference`, type, title, file metadata, status, nullable
`secure_url`, version and creation time. The list does not itself provide
a document download endpoint or a signed storage URL. Notification rows include
`notification_reference`, type, title, nullable message, status and creation
time; `read_at` is optional for the legacy read model.

With `customer_notifications.write`, a separate POST assertion for
`/api/v1/customer/notifications/read`, and an `Idempotency-Key`, send
`{"notification_references":["notification_..."]}` with one to 100 distinct
opaque references from the customer's list. Extra fields, duplicates and
invalid references return 422; a reference outside the verified customer's
view returns neutral 404 `notification_reference_not_found`. The response
contains `updated_count`, the submitted references and `read_at`.
Already read rows retain their first read timestamp and do not increase
`updated_count` under a new key; the response `read_at` is the request's
attempt time, so read the list again for a row's persisted timestamp.
An identical retry under the same key returns the stored completion after
current authority is checked; a changed payload under that key conflicts.
The current route resolves references, updates rows and completes idempotency
in separate database steps. It does not yet have the contact command's atomic
mutation/completion/audit/outbox guarantee. The runnable synthetic client
shows two pages of each list, mark-read, replay, read-back and a 404.
