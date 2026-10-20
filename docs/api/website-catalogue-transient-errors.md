# Temporary website catalogue failures

`GET /api/v1/website/public-contracts` returns the existing documented
`PUBLIC_CONTRACTS_TEMPORARILY_UNAVAILABLE` error when a transient database,
PostgREST or gateway dependency cannot produce a trustworthy result:

```http
HTTP/1.1 503 Service Unavailable
Retry-After: 2
Cache-Control: no-store
```

The canonical `error` envelope contains `code`, `message` and `retryable: true`.
The response carries top-level `request_id` and `correlation_id`; its request ID
also identifies the server log entry containing the internal trace ID. The
internal trace ID is not exposed in the canonical response. Clients should
respect `Retry-After` and their existing bounded read-retry budget. This change
introduces no server-side retry loop and returns no partial catalogue.

Some supabase-js gateway failures lose their original HTTP status and surface
only as a message such as “An invalid response was received from the upstream
server”. These are classified with the existing transient connection failures
instead of becoming nonretryable HTTP500 responses.

Typed authorization, tenant, schema, legal/serialization and publication errors
keep their previous precedence and response codes. A schema-related HTTP503 does
not acquire `retryable:true` or `Retry-After` through this change. Unknown errors
remain HTTP500 with the existing nonretryable canonical envelope. Successful
catalogue responses, tenant-bound ETags and bodyless conditional HTTP304 are
unchanged.

The API schema/version and error registry are unchanged: HTTP503 and the canonical
retry fields already exist in the contract. The implementation now follows that
documented behavior. No database migration, permission change or secret rotation
is required. The three production changes reuse the catalogue-only subset of
`25a842b88576786fdbae0f8e82a402e7be9bbff2`; the separate customer-application POST
change is excluded. This note does not authorize retries of mutating operations.

Regression coverage: `__tests__/website-public-contracts-transient-errors.test.ts`
executes the real GET wrapper, canonical envelope and Next response handling with
synthetic upstream reads. It covers transport shapes, existing timeout/lock errors,
typed failures, query/auth rejection before data access and successful conditional
HTTP304. Native verification uses read-only catalogue/price flows, never an
original signing replay or a new agreement.
