# Public API identifier policy

Gridex customer and business APIs use business references and tenant-bound public resource
references. Database row identifiers are internal join keys. The Staff API explicitly
uses central staff user UUIDs for its documented staff-account operations and signed
identity claims. The separate onboarding proof also contains operator-verified identity
and binding fields; none of these fields grants access by itself.

Supported V1 legal-evidence compatibility fields retain their documented immutable
legal bundle/document version UUIDs. They are accepted only at the explicit published
feed and legal-bundle paths in the response guard, including the legal requirements
and module/document evidence lists. New resource boundaries should use public references;
these narrow legacy fields do not permit arbitrary database IDs in a response.

The documented event list also exposes `event_id`, a derived opaque reference
with the format `event_` followed by 32 lowercase hexadecimal characters. The
response guard accepts it only at `data[n].event_id` in the event list envelope;
this exception does not allow raw UUIDs or other `_id` fields.

An identifier is never authorization. Every read and write repeats the
server-resolved `company_id` predicate and returns a neutral `404` when the
resource cannot be found inside the API key's tenant.

## Canonical public identifiers

Use these identifiers at external boundaries:

- `application_number` for website application creation and status lookup;
- `customer_number` and tenant-owned `external_customer_id` for customer linking;
- `offer_reference` and `quote_reference` for the published sales flow;
- `contract_number`, invoice number and other documented business references;
- derived opaque references such as `customer_reference`,
  `application_reference`, `facility_reference`, `metering_point_reference`,
  `contract_reference`, `completion_reference`, `event_resource_reference` and
  `supplier_switch.request_reference`.

Derived references are stable within the authenticated tenant but cannot be
reversed into a database ID. Clients may store and display only references that
the relevant operation documents.

## Internal identifiers that are never public

Public DTOs must not expose database or implementation keys, including:

- `customer_id`, `application_id`, `contract_id`, `customer_site_id`, `site_id`
  and `metering_point_id`;
- `workflow_id`, `continuation_job_id`, `supplier_switch_request_id` and raw
  request/job IDs;
- `price_plan_id`, `price_plan_version_id`, `contract_price_snapshot_id` and
  publication-row IDs;
- `portal_identity_id`, provider connection IDs, automation actor IDs and
  storage object IDs;
- `company_id` supplied by a client. Tenant is always derived from the verified
  API client or portal identity.

Internal IDs may appear in tenant-scoped audit logs and worker payloads, but
must be removed before an external response or webhook is serialized.

## Runtime requirements

- Build public responses from explicit allowlists; never serialize database rows
  directly.
- Resolve every public reference together with the authenticated tenant.
- Use `404`, not ownership metadata, for cross-tenant lookups.
- Do not include internal IDs in errors, blockers, warnings, externally visible
  logs, webhook payloads or cache keys.
- Bind idempotency to tenant, API client, operation, customer where applicable,
  key and normalized payload hash.
- Adding a public identifier requires synchronized runtime DTO, OpenAPI,
  documentation and route-to-OpenAPI regression coverage.
