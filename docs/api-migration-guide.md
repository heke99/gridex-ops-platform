# Gridex API migration guide

You do not need to match the latest documentation revision exactly to use a supported API version.

This guide explains what changes between documentation revisions of the V1 contract family and how to adopt optional additions at your own pace. The rules behind it are in the [API compatibility policy](api-compatibility-policy.md).

## V1 has no breaking changes

Every documentation revision of V1 (Website, Customer Portal, Staff, Staff onboarding and Partner) is backward-compatible:

- existing endpoints, required request fields, field types, units, idempotency and business semantics are unchanged;
- no new header, query parameter or body field is required;
- an API credential and a V1 endpoint remain enough; there is no mandatory version header;
- the minimum supported revision is `2026-10-02.3`. A documentation-only release never raises it.

Supported revisions per surface:

| Surface | Supported revisions |
|---|---|
| Website | `2026-10-02.3` (minimum), `2026-10-04.1`, `2026-10-09.1` (current) |
| Customer Portal | `2026-10-02.3`, `2026-10-04.1`, `2026-10-09.1` |
| Staff | `2026-10-04.1`, `2026-10-09.1` |
| Staff onboarding | `2026-10-04.1`, `2026-10-09.1` |

Responses carry `X-Gridex-Contract-Version` and `contract_schema_version` with the revision that produced the representation. Accept any well-formed V1 revision (`YYYY-MM-DD.N`) and validate the business payload; do not reject a response only because its revision is newer than the one you generated your client from. Immutable OpenAPI documents for each revision stay available under `/api/v1/openapi/<revision>/` and are never rewritten.

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
