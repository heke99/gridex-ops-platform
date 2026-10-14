# Gridex API migration guide

You do not need to match the latest documentation revision exactly to use a supported API version.

This guide explains what changes between documentation revisions of the V1 contract family and how to adopt optional additions at your own pace. The rules behind it are in the [API compatibility policy](api-compatibility-policy.md).

## Stable V1 requests and supported representations

### Representation corrections and older validator errata (2026-10-14)

A credential pinned to a supported older profile receives matching declared wire markers in the integration context and Website callbacks. The default Website, Customer and Staff representation stays `2026-10-09.1`; Staff onboarding stays `2026-10-05.2`. No new incoming version header or request field is required. Only an authorized platform operator selects metadata.api_contract_profiles; an API caller cannot override the profile, organization scope, permissions or accepted legal and price evidence.

Closed Website callback bodies follow their selected schema. Delivery IDs remain available in every callback header; publication callbacks also retain their required body delivery ID. Publication revision tokens come from the original durable event. Queued source payloads and previous attempt hashes are preserved; a retry that would change an already recorded body requires reconciliation before transport. Partner and HTTP event-feed representations retain their own existing fields. See the [compatibility policy](api-compatibility-policy.md#website-webhook-representations).

Strict validators copied from Customer `2026-10-02.3` support detail or Website `2026-10-02.3`/`2026-10-04.1` fixed-quote validation need a narrow schema correction. The original Customer detail schema cannot mathematically accept any response: its closed base forbids `messages`, while its extension requires them. A fixed quote legitimately has no market-reference object. Keep the immutable original and apply the appropriate [checksum-bound RFC6902 erratum](api-validator-errata/README.md) to a separate validator document. The platform does not remove required messages or fabricate market data to satisfy an inaccurate schema.

### Documentation 2026-10-12.1

Documentation and wire revisions are now independent. The default Website, Customer Portal and Staff response revision remains `2026-10-09.1`; this documentation publication does not require a request header or client upgrade. Staff onboarding retains its independent `2026-10-05.2` representation. Older qualified response profiles can be pinned on the credential by the platform operator, including the older closed response field sets and version constants.

This publication corrects descriptions of existing pagination, move-out `submitted_at`, fixed-quote absence of a market reference, lifecycle `410`/`423`, and JSON payload `413` errors. It also distinguishes central account revocation from the integration backend's local-login checks. Previously published immutable documents retain their bytes.

The accompanying implementation corrections enforce the documented authorization and input rules, preserve complete contract and measurement results, and make retry/audit behavior truthful. They do not grant additional permissions or accept stale legal evidence. See [the operation inventory](api-index.md) for the source and database verification boundaries.

Documentation updates do not require a date-matching request header or a business-flow upgrade. Supported V1 representations keep the following rules; this does not certify every frozen strict validator, and the specific errata above still apply:

- existing endpoints, required request fields, field types, units, idempotency and business semantics are unchanged;
- no new header, query parameter or body field is required;
- the existing API credential and surface-specific authentication requirements remain unchanged; no documentation-version header is required;
- the Website and Customer Portal minimum supported revision is `2026-10-02.3`; Staff and independent onboarding have their own support matrices. A documentation-only release never raises a surface's minimum.

Supported revisions per surface:

| Surface | Supported revisions |
|---|---|
| Website | `2026-10-02.3` (minimum), `2026-10-04.1`, `2026-10-09.1` (current) |
| Customer Portal | `2026-10-02.3`, `2026-10-04.1`, `2026-10-09.1` |
| Staff | `2026-10-04.1`, `2026-10-09.1` |
| Staff onboarding | `2026-10-05.2` (separate identity contract) |

Responses carry `X-Gridex-Contract-Version` and `contract_schema_version` with the selected representation. A tolerant V1 client can accept a well-formed newer revision (`YYYY-MM-DD.N`) while validating the business payload. A generated validator that requires an older exact constant must use a supported operator-pinned profile and the applicable schema errata; ignoring only the header does not correct a contradictory schema. Immutable OpenAPI documents for each revision stay available under `/api/v1/openapi/<revision>/` and are never rewritten.

Legal and price versions are a different thing: the exact legal document the customer accepted (for example `textVersionId`), its hash and the selected offer and quote must still match exactly.

## Release 2026-10-09.1 (documentation only)

This release publishes the OpenAPI text for behaviour that already applies in production. Nothing has to change in an existing integration.

### Website

- `powerOfAttorney.textVersionId` must be the power-of-attorney document of the accepted legal bundle; another id returns `409 power_of_attorney_offer_version_mismatch` and nothing is stored.
- `GET /api/v1/website/public-contracts`: the `ETag` is bound to the credential's organization, customer type, channel and representation. `If-None-Match` is evaluated after authentication; responses send `Vary: Authorization`. Keep one snapshot per credential and customer type.
- `POST /api/v1/website/energy-area/resolve`: a request with only `facility_id`/`metering_point_id` returns `422 energy_area_address_required`. A postal-code centroid near a price-area boundary is provisional and never price-ready.

### Customer Portal

- Support message and attachment lists continue with `X-Gridex-Next-Cursor`. The first page without `cursor` is unchanged.
- Closure versus replay: a retry with the same `Idempotency-Key` and payload of a write that already succeeded is replayed even after the case was closed; a new write on a closed case returns `409 support_case_closed`.
- `503 idempotency_completion_uncertain`: retry with the same key and payload. `409 idempotency_reconciliation_required`: check the resource before using a new key.
- `GET /api/v1/customer/metering-values` is a bounded detail list, not a complete-month aggregate.

### Staff

- Optional `x-gridex-expected-project-ref` request header; `X-Gridex-Project-Ref` response header; `412 storage_project_mismatch` before any write.
- `Idempotency-Replayed` on every write, including staff-user invite, role change, disable and enable.
- Optional `x-gridex-query-parsing: strict` profile for list endpoints.
- `X-Request-ID` is always server-issued and equals `request_id` in the body; an inbound `x-request-id` is kept only as a separate client correlation value.

## Adopting the new optional headers and cursors

All additions are opt-in. Adopt them when convenient:

1. **Continuation cursors.** After a list call, read `X-Gridex-Next-Cursor`. If present, call the same endpoint with `?cursor=<value>` (unchanged, opaque) and repeat until the header is absent. Never build or modify a cursor; a modified or foreign cursor returns `400 invalid_cursor`.
2. **Conditional feed reads.** Store the `ETag` of `GET /api/v1/website/public-contracts` together with the snapshot for that credential and customer type, and send it as `If-None-Match`. On `304` keep the stored snapshot.
3. **Staff storage pinning.** Send `x-gridex-expected-project-ref` and compare `X-Gridex-Project-Ref` in responses. Treat `412 storage_project_mismatch` as a configuration error; nothing was executed.
4. **Strict Staff query parsing.** Send `x-gridex-query-parsing: strict` to have duplicated or non-decimal list parameters rejected with `422 invalid_field`. Recommended for new integrations.
5. **Idempotency outcomes.** Always retry a write with the same `Idempotency-Key` and payload. Use `Idempotency-Replayed` to tell a replay from a new execution.

## Breaking changes in the future

A breaking change is introduced only in a new major contract family, in parallel with V1, with at least 180 days of announced migration window and a migration section in this guide. See the [API compatibility policy](api-compatibility-policy.md).
