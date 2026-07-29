# API contracts

Local specifications:

- `docs/openapi/website-integration-v1.json`
- `docs/openapi/customer-portal-v1.json`

Runtime routes serve them under `app/api/v1/openapi`. Website endpoints belong
only in website OpenAPI; customer resources belong only in customer portal
OpenAPI. External request objects reject unknown fields. Runtime, schemas,
scopes, error codes, examples and documentation must change together.

Public application output uses an explicit allowlisted DTO. Internal pricing,
publication, portal-identity and provider-connection IDs are never exposed.

Current version: `2026-07-29.1`.

Public pricing exposes stable `price_options`, `commercial_components`,
selection policy and invoice methods. Quote accepts `price_option_reference`,
`invoice_delivery_method`, `selected_component_references` and `site_count`;
unknown fields remain rejected. Output freezes the exact selected option, area
row and resolved component arrays.
