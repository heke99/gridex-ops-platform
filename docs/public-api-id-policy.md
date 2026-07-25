# Public API ID policy

Gridex public APIs may expose opaque resource identifiers only when the
resource belongs to the tenant authenticated by the API key. An identifier is
not authorization: every read and write must repeat the tenant predicate and
return `404` when the resource exists under another tenant.

## Allowed public resource IDs

The following UUID-valued fields are documented public resource IDs:

- `customer_id`
- `application_id`
- `contract_id`
- `customer_site_id` and compatibility alias `site_id`
- `metering_point_id`
- `workflow_id`
- `continuation_job_id`
- `supplier_switch.request_id`
- `resolution_id`

They are opaque, tenant-bound references without business meaning. Clients may
store them for subsequent calls inside the same authenticated tenant, but must
not parse them, derive permissions from them, show them as customer-facing
numbers or reuse them across tenants.

## IDs that are never public

Public DTOs must not expose internal pricing, publication, identity or provider
implementation keys, including:

- `price_plan_id` and `price_plan_version_id`
- `contract_price_snapshot_id`
- `public_contract_offer_id` and internal publication IDs
- `portal_identity_id`
- `provider_connection_id`
- billing-provider or automation-user database IDs

External business references such as `offer_reference`, `quote_reference`,
`customer_number`, `application_number`, `contract_number` and a tenant-owned
`external_customer_id` remain separate from public resource IDs.

## Runtime requirements

- Build public responses from explicit allowlists; never serialize database
  rows directly.
- Verify tenant ownership on every lookup, including idempotent replays and
  detail endpoints.
- Use `404`, not ownership metadata, for cross-tenant identifiers.
- Do not include forbidden IDs in errors, warnings, logs returned to clients,
  webhook payloads or cache keys visible outside OPS.
- Adding an ID to a public response requires OpenAPI documentation, tenant
  authorization tests and a review of the response sanitizer.

