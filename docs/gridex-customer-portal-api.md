# Gridex Customer Portal API

Current contract: **2026-09-30.2** (release candidate on the API draft branch)

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
do not authorize login or legal identity changes. Billing changes require their
own explicit scope and revision, described below.

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

Send an invoice email change separately as
`{"profile":{"invoice_email":"billing@example.invalid"},"expected_billing_revision":0}`,
using the current `billing_revision`, a fresh exact-action assertion,
`customer_billing.write` and a new idempotency key. This explicit scope is not
granted by the legacy portal-write alias. The protected billing command returns
`billing_revision` and `affected_contract_count`; only contracts inheriting the
customer standard change, while explicit contract overrides remain unchanged.
The email is a billing setting, not a contact email or login identity.

Send language/timezone separately as
`{"profile":{"language_code":"sv","timezone":"Europe/Stockholm"},"expected_profile_revision":0}`
with the current `data.profile_revision` from `/me`, `customer_contact.write`
and a new idempotency key. The atomic preferences command returns
`profile_revision`. An unsupported language code or timezone is rejected.

Read `/sites` with `customer_sites.read` before an address change. Send
`{"facility_data":{"facility_reference":"<returned reference>","expected_address_revision":0,"address":{"street":"Exempelvägen 1"}}}`
with the site's current `address_revision`, `customer_facility_data.write` and
a new idempotency key. `data.address_result.status` distinguishes an applied
or unchanged address from a submitted/conflicting request; submission alone
does not prove that the address was saved. The command preserves the intake
rules and atomically persists its history, revision and durable integration
intent; external delivery runs separately.

Fresh contact/billing/preference/facility changes require their revision. A stale revision
returns 409 `profile_revision_conflict` or
`facility_address_revision_conflict`. Missing revisions return 422
`contact_revision_required`, `billing_profile_revision_required`,
`profile_revision_required` or `facility_address_revision_required`.
Exact completed legacy claims can replay without newly introduced revisions
only after current active-owner, client, relation and scope checks. Profile
replays retain their logical completion, status and time but pass through the
current closed public projection: old internal site IDs, normalization details
and private address payloads are removed. Failed or
processing legacy claims return a conflict. `/me` exposes nullable
`contact_revision`, `billing_revision` and `profile_revision`; `/sites` exposes
nullable `address_revision`. A missing legacy revision is never fabricated as
zero and cannot authorize a fresh write.

Mixed contact/billing/preferences/facility categories and fresh command
metadata return 422 without a mutation. Juridical identity fields return 422
`profile_field_not_supported`. Missing command schemas return canonical 503
`platform_schema_not_ready` with `error.retryable:true` and no database
information. Machine sync rejects every nonempty `profile` before writes.
A supplied `facility_data[].address` returns 422
`sync_facility_address_command_required` before identity lookup, claims or
effects; legacy address aliases are also rejected by the writer. Use the
separately delegated facility command with the current address revision.
Non-address facility, document and legal intake remain separately staged. See
`scripts/tenantservice/customer-api-reference.mjs` for a runnable synthetic
contact journey using an isolated in-memory issuer and customer.

## Customer support cases

The exported `runCustomerSupportReference` in
`scripts/tenantservice/customer-api-reference.mjs` provides a runnable backend
flow: create, list, read, reply, replay and readback. Supply the real backend
API credential and platform-enrolled assertion signer when integrating; its
standalone command defaults to an in-memory synthetic HTTP fixture.
The tenant backend can create and continue a case through six delegated
endpoints. `customer_cases.read` and `customer_cases.write` are explicit scopes;
legacy portal aliases do not grant them. Each call needs a current signed
assertion for its exact method and path. `GET /api/v1/customer/cases` lists only
this customer's published cases. `POST /api/v1/customer/cases` accepts exactly
`{"title":"...","body":"..."}` and an `Idempotency-Key`, returning 201 with an
opaque `case_reference`, revision, status and replay marker.

Use `GET /api/v1/customer/cases/{reference}/messages` to read that case's
customer-visible messages. Continue the same case with `POST` on that path,
`{"body":"...","expected_revision":1}` and a fresh idempotency key. The reply
returns 201 with `case_reference`, `message_reference`, revision, status and
replay marker. Stale revisions or changed same-key payloads return 409;
foreign case references return neutral 404. Reads accept `limit` (default 25,
maximum 100) and a customer/resource-bound `cursor`.

The public case projection is limited to reference, title, status, revision
and timestamps. The message projection is limited to reference, body, author
kind, channel, revision and creation time. Staff notes and internal case text
are separate records and never become public messages. Staff and portal
continuations use the same protected command under their actual current
session. A portal account with read-only rights cannot write or replay writes.
An explicitly published same-case telephone summary is staff-authored with
channel `phone` and the actual current staff session; raw telephone intake
stays internal and never automatically becomes a public customer message.
An identified telephone contact requires a real risk-policy verification
issuer; that issuer and attachment scanner enrollment remain external
configuration requirements. Identity-sensitive telephone changes fail closed
while verification is unavailable. Files remain in private quarantine while
the scanner is unavailable.
An unidentified contact cannot read customer history or change a profile.

The disposable support proof creates cases over real HTTP, continues the same
case using an actual seeded staff session at the native command boundary,
checks public replies/internal privacy, read-only denial and current
revocation, and rereads the resulting messages over HTTP. It is a server and
database proof, not an interactive browser proof. A distinct interactive suite
uses a separate synthetic portal customer: it clicks create/reply, retries a
lost response after server commit with the same form key, continues the same
case in OPS with separate internal/public messages, reloads both views, and
checks portal/OPS read-only controls. Its screenshots contain only synthetic
data. Prepared suites become execution evidence only after their exact-version
CI markers and native postchecks pass. The repository's runnable
reference client and these proofs do not mean an external tenant website is
implemented; the real frontend must still integrate its authenticated backend
with the platform-enrolled assertion issuer and these six endpoints.

For attachment intake, POST multipart/form-data to
`/api/v1/customer/cases/{reference}/attachments` with exactly `file` and
`expected_revision`, explicit `customer_cases.write`, exact-path delegation
and an idempotency key. Send one nonempty PDF, PNG, JPEG or valid UTF-8 plain
text file, up to 5 MiB. Declared type and content must agree. The 201 result
contains only `attachment_reference`, revision, `scan_status:"quarantined"`
and replay marker. An identical retry returns the same attachment; a changed
payload conflicts. Unknown or duplicate multipart fields, including a
client-supplied clean flag, are rejected. Excess size returns 413
`support_attachment_too_large`; storage/schema failure returns safe retryable
503 `support_attachment_unavailable`.

GET on the same path with `customer_cases.read` returns only the attachment
reference, file name, media type, byte size, quarantine status and creation
time, with the support page metadata. No object path, download URL or clean
status is returned. Storage stays private and the protected command records
the scan request; intake success does not authorize file release. The exported
`runCustomerAttachmentReference` performs upload, identical replay and metadata
read-back using the caller's enrolled signer. Its synthetic fixture checks the
multipart contract and clean-flag denial; it is not scanner or deployed storage
evidence.

The reference CLI also provides an explicit read against a real configured
backend:

```sh
node scripts/tenantservice/customer-api-reference.mjs --real /absolute/private/customer-api-options.mjs /api/v1/customer/me
```

The private module must export `customerApiOptions` with `baseUrl`, backend
`apiKey`, linked `customerNumber` and `signAssertion(action)`. Supply the existing
platform-enrolled issuer; this mode creates no identity, session or mandate.
Keep the module and credentials outside the repository and browser. HTTPS is
required except for the explicit loopback test server. The client validates
the normalized customer path before signing, refuses traversal and redirects,
and signs the exact method/path sent. It prints only status, row count, request
ID, contract version and error code. Real frontend/issuer integration still
needs to be executed in its authorized environment.

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
This synthetic client is contract characterization, not native SQL/RLS or full
phase acceptance. The separate disposable-CI legal fixture constructs actual
product/version/bundle/document and legacy legal-text relations, then the
HTTP suite checks three customers, microsecond ties, cursor replay, public
fields and current authority. Source immutability is checked after HTTP.
These new suites are prepared for execution; their existence is not an
executed native result or proof of a deployed customer integration.

If all compatible legal read models are unavailable, GET returns canonical
HTTP 503 `platform_schema_not_ready` with `error.retryable:true`. Database
diagnostics are not public. Legacy-schema fallbacks are characterized
separately, without changing the shared current-schema replay database.

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
qualified by that client. The separate disposable-CI fixture constructs owned
customer/site/metering-point relations with non-null quantities and valid
periods. Its real HTTP suite checks inclusive microsecond bounds, facility
filters, filter-bound cursor replay, three customers, public fields and
revocation; a native postcheck verifies unchanged source rows and customer
attribution. These suites require execution on the frozen candidate before
their result can be called verified. Missing canonical metering schema returns
HTTP 503 `platform_schema_not_ready` and `error.retryable:true` using the safe
canonical error envelope.

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
The service-only command resolves the entire indexed reference set, rechecks
current authority, mutates unread rows, completes idempotency and writes
canonical audit in one local transaction. A late completion or audit failure
rolls back every command effect. Marking read has no external delivery effect.
The existing compact ordered payload hash and tenant/client/customer/route/key
namespace remain unchanged. Completed legacy claims replay their stored data
after current authorization; old failed or processing claims retain their
safe 409 result because their prior effects cannot be assumed rolled back.
The runnable synthetic client shows two pages of each list, mark-read,
replay, read-back, changed-payload conflict and mixed-reference denial.
Actual transaction, concurrency, rollback and index evidence comes from the
separate native suites and real HTTP GET→POST→replay→GET suite, once executed
on the frozen candidate. HTTP-request Playwright evidence is server/database
evidence and does not count as interactive UI verification.

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
page returns the stored positive domain-event version; customer events use
version 1. JSON null remains the defensive representation for an unavailable
or invalid version, rather than inventing a version. Each event reference now
identifies one item across both feeds, including items sharing an internal ID.
References from earlier draft releases can change; refresh the event list when
adopting this contract. Occurrence times retain the stored precision, and
equal-time items retain a deterministic order across page boundaries.
If the event read model is unavailable, the route returns HTTP 503 with the
canonical error envelope: `error.code` is `platform_schema_not_ready` and
`error.retryable` is `true`. Retry later; the response exposes no database
diagnostics and does not substitute an earlier event read model.

Powers of attorney return an opaque authority reference, nullable public
contract/facility references, scope, status and the available date fields.
The list grants no power to sign or change an authority. The synthetic client
follows two pages of each resource and checks a foreign event cursor error;
it uses a local issuer and synthetic records, not a deployed customer feed.
