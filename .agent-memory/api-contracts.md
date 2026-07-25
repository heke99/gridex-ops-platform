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
