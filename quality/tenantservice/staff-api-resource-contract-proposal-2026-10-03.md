# Staff support API resource proposal — 2026-10-03

Status: the initial source-backed design below was followed by root's explicit
implementation authorization. Customer/case source and tests are now being
implemented; attachment and native verification remain in progress. No customer
data, credentials, environment or deployed configuration were changed. Source baseline:
`2c8e283e4fb6b232fe4e249352e33e8baeff14b1` in the shared OPS checkout. Existing
tests were inspected, not executed for this inventory. The authentication design
is separately owned by `staff-api-auth-contract-proposal-2026-10-03.md`.

Root froze a deliberately stricter new API policy: all customer operations need
native `customers.read`, all case/entry/assignee/attachment reads need native
`cases.read`, and mutations need `cases.write` plus active tenant staff. The
historical native console OR rules described below remain a separate source
inventory, and do not apply to this new API. Actual source owners and tests are
`lib/staff-api/resources/**`, mounted `/api/v1/staff/{customers,support}/**`,
`__tests__/staff-api-resources.test.ts` and `staff-api-resource-routes.test.ts`.
Root owns native SQL fixtures/CI; no full native qualification is claimed here.

The finite first release serves a staff customer finder and support workspace
through documented OPS APIs. The Web BFF holds the integration credential and
OPS staff proof. OPS derives tenant, native actor and resource ownership; Web
never supplies authoritative company/customer/actor UUIDs or reads OPS tables.
The published own-customer `/api/v1/customer/**` contract remains unchanged.

## Routing and evidence boundaries

Applied: source inventory and direct caller/helper/schema checks, narrow
specification comparison, false-positive checking of suspected helper gaps,
Supabase security guidance, independent attachment review, and verification
before completion. This is a finite design inventory, not a repository-wide
security audit. Implementation/TDD/branch finishing, broad scanners, hook
installation, dependency remediation, UI/performance remediation and live DB
checks are outside this read-only task. No passing runtime/native/storage test
result or production readiness is inferred from inspected source.

## Common resource boundary

Every route runs the shared staff guard before resource lookup and before
replaying a protected result. Machine authentication uses
`Authorization: Bearer <integration API key>` and personal proof uses the
proposed `X-Gridex-Staff-Authorization: Bearer <OPS staff JWT>`. Both are bound to
one company and API client; the separate Auth design defines the vault, native
session validation, MFA, account eligibility and fresh canonical permissions.

Integration scopes below are new proposals, never aliases of existing
`customer_portal.*` or `customer_support.*`. They do not themselves authorize a
person. Native read policy follows the dedicated source registry rather than
the unrelated `operations.tasks` rule used by the current case pages:

| Resource | Proposed machine scope | Fresh native permission |
| --- | --- | --- |
| Customer list/search | `staff_customers.read` | `customers.read` |
| Customer profile/detail | `staff_customers.read` | `customers.read` |
| Customer contacts/addresses/facilities, when mounted | `staff_customers.read` | `customers.read` |
| Cases, entries, assignees, attachment list/download | `staff_support.read` | `cases.read` |
| Every support mutation, including upload | `staff_support.write` | `cases.write`, active tenant-staff membership |

The customer-cases native pages currently gate reads using `operations.tasks`,
whose actual permissions are `switching.read`, `metering.read`,
`billing_underlay.read`, or `poa.read`. Reusing that rule would repeat the
confirmed page-access mismatch. The dedicated `customer.cases` registry is
`cases.read OR customers.read`. A deliberate stricter `cases.read` API policy
is possible but would be a new policy decision, not preservation of the native
registry. Native platform administration allows only this API-key tenant's
reads; all proposed staff mutations deny platform context. No cached role-name,
metadata, customer assertion or caller UUID provides a write exception.

All inaccessible, wrong-tenant, wrong-case and absent references return the
same 404. Always force a non-null company in every service-role query; do not
expose optional-tenant native helpers directly. Resource resolution binds the
actual case's current customer, including after a canonical customer merge.
No cached Web customer mapping participates.

Public references reuse the existing organization-scoped derivation for
`customer`, `support_case`, `support_message`, `facility`, `customer_contact`,
`customer_address` and `staff`; native IDs remain inside OPS. Attachment
references reuse their existing persisted `support_attachment_…` value.
`publicReference()` only generates a hash: it is not a resolver. The current
customer-case resolver needs a known customer and falls back to a newest-500
scan. Native staff-created cases do not consistently store a support public
reference. The new API therefore needs tenant-scoped indexed reference lookup
for current and historic customers/cases/facilities/staff, verified to match
the existing JS derivation. Choose a forward reference column/index or an
indexed SQL derivation before implementing handlers; never scan only a capped
subset and advertise complete access.

## Finite endpoint matrix

Paths are relative to `/api/v1/staff`. Every POST requires `Idempotency-Key`
except Auth operations governed by their own separate contract. Unknown JSON
keys, unsupported enum values, malformed references and duplicate query fields
are rejected. Successful JSON responses include `request_id`, `correlation_id`
and the separate staff `contract_schema_version`.

| Method/path | Request | Successful data | Native implementation map |
| --- | --- | --- | --- |
| `GET /customers` | `q`, `status`, `customer_type`, `limit`, `cursor` | Paged `StaffCustomerSummary[]` | Reuse source field/status/name rules from `getCustomers.ts`; new tenant-forced database search/keyset read |
| `GET /customers/{customerReference}` | Reference only | `StaffCustomerDetail` | New scoped explicit-select profile read; native customer-card normalization rules |
| `GET /customers/{customerReference}/contacts` | `limit`, `cursor` | Paged `StaffCustomerContact[]` | New scoped projection over `customer_contacts` |
| `GET /customers/{customerReference}/addresses` | `limit`, `cursor` | Paged `StaffCustomerAddress[]` | New scoped projection over `customer_addresses` |
| `GET /customers/{customerReference}/facilities` | `limit`, `cursor` | Paged `StaffCustomerFacility[]` | Native `customer_sites` semantics; new paged projection |
| `GET /support/cases` | `q`, `customer_reference`, `status`, `priority`, `assignee_reference`, `limit`, `cursor` | Paged `StaffSupportCase[]` | New scoped DB page over support cases only |
| `POST /support/cases` | `customer_reference`, `title`, optional `description`, `category`, `priority`, `facility_reference` | 201 `StaffCaseCreatedReceipt` | `createTenantSupportCase` graph/no-operational-impact semantics, made durable and atomic with creation/event/audit receipt |
| `GET /support/cases/{caseReference}` | Reference only | `StaffSupportCase`; links to paged entries/attachments | Scoped case lookup and explicit staff mapper |
| `GET /support/cases/{caseReference}/entries` | `limit`, `cursor` | Paged `StaffSupportEntry[]` | New scoped DB page over allowed event kinds; no raw payload spread |
| `POST /support/cases/{caseReference}/replies` | `message`, optional `kind=message|phone_summary` | 201 `StaffSupportEntry` | Preserve `replyToCustomer` fixed customer visibility and staff attribution; atomic actor-authorized event/audit/receipt |
| `POST /support/cases/{caseReference}/internal-notes` | `message` only | 201 `StaffSupportEntry` | Preserve `addInternalNote` fixed internal visibility; atomic event/audit/receipt |
| `POST /support/cases/{caseReference}/status` | `status`, optional `message`, required `expected_updated_at` | 200 `StaffCaseMutationReceipt` | Reuse atomic `gridex_update_customer_case_status` semantics; add expected version and durable receipt within transaction |
| `POST /support/cases/{caseReference}/assignment` | `assignee_reference` or null; required `expected_updated_at` | 200 `StaffCaseMutationReceipt` | New atomic eligible-assignee operation; no existing native assignment updater found |
| `GET /support/assignees` | `q`, `limit`, `cursor` | Paged `StaffAssignee[]` | New scoped active eligible staff query; authoritative native permission resolver |
| `GET /support/cases/{caseReference}/attachments` | `limit`, `cursor` | Paged `StaffSupportAttachment[]` | Extend staff-audience attachment list with DB keyset paging |
| `POST /support/cases/{caseReference}/attachments` | Exactly one multipart `file`; optional `visibility=internal|customer`, default internal | 201 `StaffSupportAttachment`, including rejected scan outcome | `addSupportAttachment` content/filename semantics with actor-bound reservation and recoverable single-object outcome |
| `GET /support/cases/{caseReference}/attachments/{attachmentReference}` | References only | 200 verified binary bytes | `downloadSupportAttachment`, `audience:'staff'`, current case/customer scope |

Contacts/addresses/facilities are required when the Web staff customer card
shows those data. They avoid embedding silently capped arrays in detail. If
the first UI displays only profile scalars, those three routes can be explicitly
deferred in capabilities. The first release does not include customer profile
edits, general customer notes, contracts/invoices, legal authorization files,
Ediel diagnostics, portal claims or provider credentials. These require their
own operation permissions and documented endpoints; a customer-read grant
does not advertise the entire native customer-card bundle as one API.

## Query and pagination contract

Use `limit=50` by default, integer 1–100; invalid values return 400 rather than
silently becoming another value. `q` is trimmed, maximum 120 characters;
nonempty search requires at least two. The finite customer search covers
display/name, customer number, email and phone; it does not export or search
raw personal numbers by default. Case search covers title and category, not
arbitrary internal payloads. Filters are exact documented enums/references.
Bound/escape search values through typed SQL or a reviewed parameterized
query, never concatenate raw user grammar into PostgREST `.or()`.

All filtering, support-case eligibility and pagination run in the DB before
the limit. Eligible support rows have `metadata.support_case=true` or the
existing recognized `tenant_support_` source; do not expose arbitrary
operational cases through this family. List order is `created_at DESC, id DESC`
and the query fetches `limit+1`. A page is:

```ts
{ data: T[], page: { limit: number, returned: number,
  has_more: boolean, next_cursor: string | null },
  request_id: string, correlation_id: string, contract_schema_version: string }
```

The opaque authenticated/encrypted staff cursor binds company, API client,
native staff subject, resource/case/customer scope, normalized filter hash,
fixed order and last tuple. Native UUID/order tuple never appears as cleartext.
Reusing the existing portal encryption mechanics is reasonable, but its
current payload binds company/customer/resource only, not staff actor/client
or filters. A staff cursor needs a separate payload/version/domain and strict
tuple validation. Invalid/tampered/wrong-scope/filter-changed cursors return
400 `invalid_cursor`. Pagination is continuation, not a promise of a snapshot
across concurrent edits. No misleading total count is required.

Existing native helpers cannot guarantee completeness unchanged:
`listTenantSupportCases` filters after a capped 200-row result;
`listCustomerCaseEvents` loads all rows; native customer text search loads at
most 1,000 and then filters in JS; sites cap at 100; attachments return the
oldest maximum 100. The published own-customer message helper caps at 500.
These are source facts, not evidence of a production-size incident.

## Explicit response DTOs

All fields below are explicitly projected from canonical OPS data. Missing
optional source values are null; never substitute submitted Web values for an
authoritative read. No raw native rows, UUIDs, arbitrary metadata, raw event
payloads, storage paths, provider errors, secrets or JWT claims are returned.

| DTO | Allowed fields |
| --- | --- |
| `StaffCustomerSummary` | `customer_reference`, `customer_number`, `customer_type`, `status`, `display_name`, `email`, `phone`, `created_at` |
| `StaffCustomerDetail` | Summary plus `first_name`, `last_name`, `company_name`, `masked_personal_number`, `org_number` for business/association, `apartment_number`, `preferred_language` when present, `updated_at`, `moved_out_at`, `lifecycle_closed_at`; explicit related-resource links |
| `StaffCustomerContact` | `contact_reference`, `type`, `name`, `email`, `phone`, `title`, `is_primary`, `created_at` |
| `StaffCustomerAddress` | `address_reference`, `type`, `street_1`, `street_2`, `postal_code`, `city`, `country`, `municipality`, `moved_in_at`, `moved_out_at`, `is_active`, `created_at` |
| `StaffCustomerFacility` | `facility_reference`, `site_name`, `facility_id`, `site_type`, `status`, `street`, `care_of`, `postal_code`, `city`, `country`, `grid_area_code`, `price_area_code`, `move_in_date`, `move_out_date`, `created_at`, `updated_at` |
| `StaffSupportCase` | `case_reference`, `customer_reference`, `customer_number`, `customer_display_name`, optional `facility_reference`, `title`, `description`, `description_visibility`, `category`, native `status`, customer-facing `public_status`, `priority`, safe `channel`, `assigned_to` as `StaffAssignee` or null, `next_action`, `next_action_due_at`, `created_at`, `updated_at`, `resolved_at`, `closed_at` |
| `StaffSupportEntry` | `entry_reference` (existing support-message derivation for existing events), `case_reference`, explicit `kind`, `visibility`, `author_type=customer|staff|system`, `author` as safe staff reference/display name or null, `body`, `created_at`; kind-specific safe data below |
| `StaffAssignee` | `staff_reference`, `display_name`; no native ID, email, role/member dump or permissions list |
| `StaffCaseCreatedReceipt` | `case_reference`, `customer_reference`, `status`, `priority`, `created_at`, `updated_at` |
| `StaffCaseMutationReceipt` | `case_reference`, `status`, `assigned_to` reference or null, `updated_at`, `entry_reference` for recorded status/assignment change |
| `StaffSupportAttachment` | `case_reference`, `attachment_reference`, `file_name`, detected `mime_type` or null, `byte_size`, `sha256`, `visibility`, `uploaded_by=staff|customer`, `scan_status=quarantined|released|rejected`, safe `scan_reason` or null, `created_at` |

Masking uses the current native customer-card convention (retain last four
characters, mask preceding characters). Full personal numbers, internal notes,
source diagnostic metadata and retention notes are omitted from the finite
profile response. Facility internal notes and supplier/provider diagnostic
records are omitted. No readiness value is fabricated from the few selected
fields: `buildCustomerCardSnapshot` is a pure builder needing canonical
multi-resource inputs, not a DB loader or an authoritative status RPC.

Case title is customer-visible under the existing public mapper. Staff-created
description is internal by default; unknown `description_visibility` resolves
to internal. Creation fixes server metadata to `support_case=true`,
`support_channel=admin`, `opened_by=staff` and internal description visibility.
Metadata supplied by the request is rejected. The native create helper spreads
caller metadata last, so a new API must never forward an arbitrary object that
could override reserved classification/idempotency/visibility fields.

Entry kinds are a closed union: customer message, staff reply, internal note,
phone interaction, created, status changed and assignment changed. Map the
native support event types rather than exposing unknown technical events.
Replies have `visibility=customer` and `kind=message|phone_summary`; internal
notes/phone entries have `visibility=internal`. Status entries add only native
status; assignment entries add safe prior/new staff references. Existing phone
records may expose direction and verification method/time as safe typed staff
fields; verification evidence references and representative mandate identifiers
are outside this finite DTO. No new phone-write endpoint is required by the
assigned scope. Unknown raw events/payloads are not silently converted into
public conversation entries. Keep own-customer visibility checks exactly as
they are: event allowlist AND explicit customer visibility.

## Mutation semantics, actors and conflicts

Creation validates `title` 1–180, description/message 1–8,000 when supplied,
category up to 120, priority `low|normal|high|urgent`. Reject oversize strings
rather than accepting a truncated different body. Optional facility must belong
to the authenticated tenant and resolved customer; it is converted to native
site ID only inside OPS. New support cases use `case_type=other` and
`operationalImpact=none`, preserving the native regression that support does
not block billing, onboarding, metering, outbound, exports or switches. Plain
support creates do not select the native withdrawal/cancellation email template.

Replies/notes/upload require the locked current case to be a support case and
not `resolved|closed|cancelled`. Native UI hides these forms on closed cases,
but the current helper/action paths do not enforce closure. The new API must
enforce it at the actual write transaction/reservation boundary, including races
with status change. Replies never accept an author/visibility override; notes
never accept a public flag. A public reply means it is stored for customer
display; current helpers do not promise an email or asynchronous notification.
Do not advertise delivery unless a canonical durable notification operation is
added and verified separately.

Status accepts only the existing staff action set:
`open|action_required|awaiting_external_response|manual_follow_up|resolved|closed`.
Historic native `billing_blocked`/`cancelled` rows remain readable, but this
support API is not a billing/cancellation command. Status changes can explicitly
reopen closed support cases. `expected_updated_at` is the canonical timestamp
returned by the preceding read; compare it under the case row lock and return
409 `support_case_version_conflict` before effects on stale edits.

Assignment accepts null to unassign, or an opaque staff reference. Resolve only
currently active eligible staff of the API-key tenant, whose fresh native Auth
account/profile/membership/role and effective `cases.write` permission permit
case handling. Customer-only actors, inactive/revoked members, another tenant's
staff and platform context are ineligible. Do not assume any UUID with an Auth
row is assignable. A new atomic helper/RPC is needed: `assigned_to` presently
exists on create/type/schema, but no native customer-case assignment updater
was found by function-name and assigned-to searches. Revalidate assignee
eligibility and expected case version in the same command as update, event and
audit; a concurrent membership/permission revocation must not leave a newly
ineligible assignment. Record verified caller as actor and assignee separately.
Deleted historical assignees may display null; that does not authorize reuse.

Every support write produces a fail-closed business audit with verified actor,
company/client, canonical customer/case, operation, old/new change, request and
correlation IDs. Avoid duplicating reply/note bodies, identity numbers, binary
content or credential/header material into telemetry. The native status RPC
already commits case update + event + audit atomically; native creation/event
helpers use separate calls, and replies/notes/uploads do not currently add a
business audit. Async `logIntegrationApiRequest` is best-effort telemetry and
does not substitute for the transaction's required audit.

## Durable idempotency and rate protection

Reuse canonical key validation and canonical JSON/body hashing mechanics, but
use a staff-bound durable ledger/reservation. Uniqueness includes company,
API client, verified native actor, operation/resource and key. Include resolved
resource and all accepted body fields in the hash. Same key/body returns the
same stored successful receipt; same key/different body returns 409
`idempotency_conflict`; a concurrent live reservation returns 409
`idempotency_in_progress`. Reauthorize current account/session/tenant/resource
and operation before replay. Never expose another actor's or tenant's stored
response, even if they reuse a key. No client-chosen actor or body spread can
replace the server hash/resource binding.

The existing portal wrapper is a claim, business call and complete sequence of
separate transactions. It has no actor namespace; after business success and
receipt-write failure it records failed and refuses a later retry for replies,
status or attachments. Merely wrapping a staff helper does not prove exactly
once. JSON business writes require mutation/event/audit/receipt in one DB
transaction or an equivalent repeatable keyed business operation that recovers
its result after interruption. Do not automatically retry a possibly committed
unkeyed event under a fresh key. Existing support-case uniqueness is scoped to
company/customer/key; a staff operation key derived from actor/client/operation
must prevent two actors' identical local keys from colliding there.

Uploads need a durable single attachment/reference/object reservation keyed by
the same staff tuple, fingerprinting case, visibility, filename, declared MIME,
size and actual SHA-256. Recover object/row/scan-state/receipt interruptions;
do not generate a second object on a lost response. Storage and Postgres cannot
be made one ordinary SQL transaction. Define retryable states and reconciliation
before advertising recovery. Rejected persisted outcomes are replayed, too.

Register every staff method/path in its own authoritative catalogue with rate
class and exact scopes, then feed the existing atomic integration API limiter.
Current `publicRouteCost` defaults unknown paths to expensive (10), with known
read/write costs 1/3; do not accidentally leave the entire new family at that
fallback. Root froze independent per-company/client/verified-actor budgets of
60 reads/minute and 20 new mutations/minute across commands and attachment
reservations. Authorized exact-body replay does not consume another mutation.
The mutation budget runs atomically in the command transaction, with fresh
authorization repeated after its blocking row lock. A refusal is 429
`staff_rate_limited`, `retryable:true`, `Retry-After:60`; limiter outage fails
closed. Existing customer message/case quotas are separate. The existing
attachment quota is 20 records per rolling 24h per company/customer, shared
across cases/staff/customer and all scan states, and is enforced by a serialized
BEFORE INSERT trigger in the forward attachment migration.

## Attachment transport and content boundaries

Multipart upload is bounded before parsing, allowing a file of at most
4,194,304 bytes and at most 32 KiB of multipart overhead.
Reject unknown/duplicate parts, invalid visibility, wrong outer content type,
and unsupported declared MIME. Allow only PDF/PNG/JPEG, then use native magic
byte/PDF inspection for detected MIME and the sanitized 120-character filename.
Empty input is 422. Inspection is not antivirus or image decoding. A persisted
rejected attachment returns 201 with rejected state and is never downloadable;
this follows native staff behavior. An alternative 422 contract must still
include safe persisted references and replay the same rejection.

The new staff transport conservatively rejects PDF filters, object streams,
cross-reference streams and encrypted content that the native token check
cannot inspect, returning `pdf_encoded_content`. This also applies when staff
download a historic released record. It does not claim antivirus protection.

Staff list includes internal/customer visibility and all scan states, with
paging. Download uses current `audience:staff` semantics: only released records,
tenant/customer/case/ref lookup and SHA-256 recheck. It may download historic
files up to the existing helper's 10 MiB maximum even though new uploads cap at
4 MiB. Binary response has detected MIME, actual Content-Length, attachment
Content-Disposition, `nosniff`, restrictive CSP, private/no-store cache policy,
staff contract/request headers and SHA-256; no signed public URL or storage path.
Range/streaming is not an existing capability and must not be advertised.

Confirmed source inconsistency: the private bucket migration allows only
PDF/PNG/JPEG, while `addSupportAttachment` uploads as application/octet-stream.
Official Supabase bucket documentation says MIME restriction violations reject
uploads. No live Storage failure is proven here; both existing mocks ignore
upload options. Choose a safe private quarantine MIME/bucket design that still
retains rejected staff outcomes, then exercise actual Storage enforcement.
Current best-effort cleanup after insert failure and quarantined scan-update
failure is not a recovery worker. There is no attachment business audit/event
write or demonstrated recovery of an unrecorded object.

## Error contract

Use the canonical structured error shape, but parameterize its currently
Website-version-bound type/version for the separately versioned staff family.
Do not reuse `requireCustomerPortalApiContext` or the own-customer envelope as
staff authorization. Every JSON response is private/no-store and exposes
request/contract/rate headers. Avoid raw Postgres/provider/Storage messages.

| HTTP | Code / meaning |
| --- | --- |
| 400 | Invalid query/cursor, malformed JSON; missing/invalid idempotency key |
| 401 | Missing/invalid/expired personal proof or integration credential; Auth design defines indistinguishable login failures |
| 403 | Missing machine scope/native operation permission, restricted auth stage, platform write or inactive tenant staff |
| 404 | `customer_not_found`, `support_case_not_found`, `attachment_not_found`; same response for inaccessible references |
| 409 | `support_case_closed`, `support_case_version_conflict`, `support_assignee_ineligible`, `idempotency_conflict`, `idempotency_in_progress`, indeterminate prior outcome, `attachment_unavailable` for unapproved/corrupt files |
| 413 | `payload_too_large` / `attachment_too_large` |
| 415 | `unsupported_media_type` |
| 422 | Required/invalid fields, unsupported enum/reference, `attachment_empty` |
| 429 | Distributed staff/API/attachment quota; Retry-After provided |
| 503 | Retryable Auth/context/limiter/database/Storage failure; no customer read/write when authority cannot be established |

`retryable` reflects the actual canonical outcome, not a guess from HTTP alone.
An indeterminate committed write is recoverable only through its original
keyed operation; a new key must not be suggested as a generic retry remedy.

## Executable acceptance and rollout gates

1. Execute mounted handlers with the real shared guard and real DTO/command
   path. Verify API-key-only, customer-proof-only, forged UUID/tenant/actor
   fields, wrong client/company/stage/session, revoked membership and permission
   all fail before business reads/writes. Customer-list/detail native rules and
   case-read OR rule are separately asserted; machine write never grants staff
   rights. Platform reads stay one tenant; every platform mutation is denied.
2. Seed two companies, multiple customers and two staff actors. Execute every
   list/detail/action/attachment with swapped references. Assert uniform 404,
   actual case/customer derivation after merge, no cross-company output/effect,
   strict metadata/visibility/author injection refusal and safe DTOs without
   native IDs, storage paths, provider details or raw payloads.
3. Seed more than 1,000 searchable customers, 200 mixed operational/support
   cases, 500 conversation entries and 100 attachments, including identical
   timestamps. Traverse real DB keyset pages with filters, proving complete
   eligible results and stable continuation. Reject tampered/cross-actor/client/
   tenant/resource/filter cursors. No static source-string test proves paging.
4. Execute create/reply/note/status/assignment concurrently with same and
   conflicting keys, two actors using the same local key, response/receipt
   failure and audit failure. Assert one durable effect, same replayed receipt,
   correct actor, tenant/client/customer/case audit, no operational stops and
   all-or-nothing rollback. Verify lost-response recovery under the original key.
5. Native SQL transaction tests cover current case version, non-support target,
   closed-case writes, stale edits, assignment eligibility and permission/member
   revocation races. Verify no event/audit/update when denied, and safe explicit
   reopening. Auth revocation after login is effective on the next operation.
6. Actual Storage integration tests cover allowed MIME versus quarantine
   options, 4 MiB transport/file boundaries, active/truncated PDF, internal and
   rejected/quarantined visibility, tampered SHA, >100 list rows, cross-case
   download, quota races, insert/update/interruption cleanup/reconciliation and
   rejected-result replay. Existing Storage stubs alone cannot qualify this.
7. Web staff BFF tests invoke the actual host-only protected routes, CSRF/cookie
   behavior, profile/queue/detail/action/upload/download and session loss. Assert
   OPS API calls only: no Web DB customer data, direct Supabase Auth, native OPS
   console alias or own-customer identifier impersonation.
8. Freeze standalone `staff-support-v1.json` candidate `2026-10-03.1` and staff
   capabilities, route catalogue, scope/UI/client mappings, examples and closed
   DTO/error schemas together. Execute mounted-route/schema parity, native
   PostgreSQL/RLS/grants, generated types/schema reconciliation, existing
   own-customer .4 byte checks and ordinary CI. Only then configure the dedicated
   staff integration client/session secrets and validate a real authorized staff
   journey on preview, followed by independently checked production rollout.

Current inspected tests provide reusable seams, not staff API qualification:
`tenantservice-support-conversation.test.ts` executes domain visibility but its
native action adapter test checks source substrings; `support-case-no-operational-stop.test.ts`
executes plain support behavior with stubs; `tenantservice-support-api-routes.test.ts`
and `tenantservice-support-attachment-api.test.ts` execute the mounted
own-customer handlers using Auth/DB/Storage stubs. The attachment domain test
whose title mentions record-write cleanup does not simulate insert failure or
assert removal. No mounted external staff resource route currently implements
the proposed matrix.

## Source proofs

All paths are relative to this OPS checkout at the baseline above.

| Source | Proof |
| --- | --- |
| `lib/admin/accessModel.ts` | Dedicated customer/case rules; actual unrelated operations.tasks gate |
| `app/admin/customer-cases/actions.ts:35` | Fresh cases.write, selected company, case-derived customer and actor; status allowlist |
| `app/admin/customer-cases/[caseId]/page.tsx:37` | UI closed-case hiding; staff attachment audience |
| `lib/customer-cases/support.ts:81` | Create uniqueness, graph binding, caller metadata spread, post-limit support filtering |
| `lib/customer-cases/db.ts:88` | Optional tenant list/detail reads and raw projections; create event/audit sequence; atomic status adapter |
| `supabase/migrations/20260923180557_restore_customer_case_events_atomic_status.sql:62` | Server-only status RPC, row lock, native actor permission, composite graph, atomic event/audit |
| `lib/customer-service/supportConversation.ts:144` | Existing keyset own-customer list, capped legacy resolver/messages, fixed visibility and unkeyed staff event writers |
| `lib/customers/getCustomers.ts:389` | Native customer search newest-1,000 JS fallback; field/status normalization |
| `lib/customers/getCustomerById.ts:5` | Unscoped service-role initial select and raw detail bundle; not a safe external staff adapter |
| `app/admin/customers/[id]/page.part-4.tsx:76` | Native profile read OR rule and separately gated native workspace data |
| `lib/customers/customerCardSnapshot.ts:355` | Pure multi-resource readiness projection, not canonical loader |
| `lib/integrations/publicReferences.ts:10` | Reference derivation only, no authorization/lookup |
| `lib/customer-portal/keysetPagination.ts:10` | Current encrypted cursor company/customer/resource binding |
| `lib/api/strictRequest.ts:86` | Portal claim/business/receipt transaction split; no staff actor namespace |
| `lib/integrations/apiAuth.ts:436` | Existing atomic machine guard plus secondary async request telemetry |
| `lib/api/publicRouteRegistry.ts:176` | Registered read/write/expensive route costs and unknown-path fallback |
| `lib/customer-service/supportAttachments.ts:96` | Non-atomic shared quota, octet-stream upload, scan/release and hash-checked staff download |
| `supabase/migrations/20261002100000_support_case_attachments.sql:10` | Private bucket MIME restrictions and persisted attachment references |
| `https://supabase.com/docs/guides/storage/buckets/creating-buckets#restricting-uploads` | Official MIME restriction behavior; not proof of actual deployed bucket state |

Read-only conclusion: the native support semantics and field models can be
reused, but the authenticated external staff surface, scoped reference lookup,
complete paging, assignment mutation, durable actor-bound writes and Storage
recovery need actual implementation and executable verification before the
staff site can claim API-first support readiness.
