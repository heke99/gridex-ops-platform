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

## Catalogue identity reads

On a fingerprint miss the catalogue uses the existing live, active-company
reference loader. It does not calculate the full integration-context readiness
object, whose automation/mail/facility diagnostics were discarded by this route.
Authentication, scope/rate-limit checks, tenant-bound fingerprint, canonical
publication graph, price-option/legal validation and diagnostics are unchanged.
The separate integration-context and customer-application readiness paths retain
their full checks. No authorization result is cached across requests.

`__tests__/website-catalogue-identity-read.test.ts` executes the real GET and
reference loader with synthetic database I/O: one identity read suffices for a
valid catalogue; suspended/archived/missing organizations and transient database
failure retain their error behavior. Existing ETag, OpenAPI, concurrent tenant
error-attribution and full website-operation regressions remain in place.

## Concurrent public quote reads

The website quote endpoint may share an already running canonical offer read
with another quote using exactly the same company, API client, offer reference
and customer type. No completed result is cached. The original resolver still
performs every publication graph, legal, price-option and invoice-fee check.
Each caller receives a separate clone; authentication, resolution binding,
calculation, idempotency and quote persistence remain per request.

Only this HTTP endpoint opts in. Final applications, default internal callers,
Partner API and legacy lookups retain their ordinary fresh resolver calls. The
pending map holds at most64 distinct keys, evicts both successes and failures,
and uses an ordinary read on overflow. This is per-process coalescing, without
a distributed lock, stale fallback, new schema, new API parameter or quota change.

The controlled four-caller regression reduces duplicate offer reads from4 to1
and still performs four independent calculations and persistence calls. This
establishes the reduction in database fanout; live latency and capacity require
the separate bounded production measurement. Earlier timed-out runs remain
failed evidence until a qualified after-run succeeds.
