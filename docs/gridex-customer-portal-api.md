# Gridex Customer Portal API

Current contract: **2026-09-29.8** (release candidate on the API draft branch)

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

## Legal acceptance reads

`GET /api/v1/customer/legal-acceptances` requires `customer_legal.read` and
a fresh signed assertion for exactly `GET /api/v1/customer/legal-acceptances`.
This is read-only: no write scope or `Idempotency-Key` is required. Follow the
opaque `page.next_cursor` with the same organization and verified customer.
Foreign customer, tenant, resource or tampered cursors return 400
`invalid_cursor` before the list read. `limit` defaults to 50 and is capped at
100; missing, non-positive, fractional or non-numeric values use the default.
The existing read filters organization and customer before an `accepted_at`
descending page, breaking timestamp ties with the descending row key.

The `data` array contains exactly `acceptance_reference`, `acceptance_type`,
`document_reference`, `document_code`, `document_version`, `document_hash`,
`accepted_at`, `source` and `created_at`. Acceptance references are opaque;
document references derive from the bundle document or legacy legal text.
Unavailable fields remain JSON null, including the document reference when
neither source exists. Internal IDs, snapshots, metadata, trace/request IDs,
contract relations and signatures are not item fields. The synthetic client
follows two legal pages and rejects wrong signed actions and foreign cursors.
This local evidence is PARTIAL, not native SQL/RLS or full phase acceptance.
No external support/case/message/attachment endpoint exists in this package.

## Metering value reads

With `customer_metering.read` and a fresh assertion for the exact GET path,
`GET /api/v1/customer/metering-values` reads normalized values for the verified
customer. It returns an allowlisted `data` array and `page`, ordered by
`period_start` and a stable row key. `limit` defaults to 50 and is capped at 100;
follow `page.next_cursor` only with the same organization, customer and filter
values. Invalid or foreign cursors return 400 `invalid_cursor`.

Optional `from` includes rows whose `period_start` is on or after the supplied
ISO date or timestamp. Optional `to` includes rows whose `period_end` is on or
before it. A date without a time means midnight UTC, including for `to`.
Malformed dates and timestamps return 400 `invalid_time_filter`. Optional
`facility_id` is normalized to digits; a supplied value with no digits returns
400 `invalid_facility_id` instead of removing the filter. The response exposes
only opaque value and metering-point references, the period, resolution,
quantity, quality/status and creation time; unavailable values remain null.
The synthetic reference client follows two filtered pages and checks a bad
cursor. Native multi-customer SQL and a deployed customer integration are not
qualified by that client.

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

## Events and powers of attorney

Use `customer_events.read` for `GET /api/v1/customer/events` and
`customer_power_of_attorney.read` for `GET /api/v1/customer/powers-of-attorney`.
Sign a fresh assertion for each exact GET path. Both return a public `data`
array with `page`; `limit` defaults to 50 and is capped at 100. Follow
`page.next_cursor` only within the same organization, customer and resource.
Malformed or foreign cursors return 400 `invalid_cursor`.

The event list combines customer events and customer-bound domain events in a
stable keyset page, exposing only an opaque `event_reference`, type, version,
occurrence time and source. It does not return an event payload or prove that
every event type is suitable for a customer-facing notification. The current
page RPC does not project the stored domain `event_version`, so the response
reports JSON null until the read model can supply a verified positive version.
Treat this field as unavailable until the read model is corrected.

Powers of attorney return an opaque authority reference, nullable public
contract/facility references, scope, status and the available date fields.
The list grants no power to sign or change an authority. The synthetic client
follows two pages of each resource and checks a foreign event cursor error;
it uses a local issuer and synthetic records, not a deployed customer feed.
