# Customer consumption supplement 2026-11-13.1

This additive contract uses `/api/v1/customer/consumption/sites` and
`/api/v1/customer/consumption/metering-values`. The unchanged historical
Customer Portal and Website releases do not advertise this capability.
The machine-readable contract is served at
`/api/v1/openapi/customer-consumption-v1.json`.

Use ordinary installed service authentication with **both** `customer_sites.read`
and `customer_metering.read` and the ordinary linked, verified portal identity.
Keep all credentials and customer assertions on the portal server. Customer
selection comes from the resolved identity; unknown/repeated query parameters
are rejected. Supply and meter queries are bounded to that company/customer.

Sites return `delivery_access.version = customer-supply-periods-v1`,
`complete = true`, and the complete windows for that page. Only confirmed
`actual_start_date` together with a canonical `market_start_at` can grant access.
A confirmed period lacking either authoritative start fails closed. Allowed period statuses are `active`,
`confirmed_by_grid_owner`, `ending` and `ended`; ended periods require
`actual_end_date`. Actual end dates are inclusive Swedish calendar dates and
become the next local midnight in the half-open UTC interval. This preserves
23/25-hour DST days. Market instants and a planned end may narrow the range;
planned starts, move-in dates and contract dates never grant access. An authority
read exceeding 1,000 rows, missing canonical columns, or failed reads returns a
sanitized 503 instead of a partial `complete` assertion.

Metering requests require `facility_id`, `from`, and `to` (RFC3339 instants,
maximum 32 physical days), plus optional `limit` (1–100) and opaque `cursor`.
The facility must belong to the linked customer. Only that customer's stored
canonical rows with direction `consumption` and unit `kWh` are considered; each
returned interval must fit entirely inside a confirmed window for its exact
meter. Revision status is authoritative and is returned explicitly. Consumers
must discard `replaced`, `superseded`, and `void` revisions and fail closed on
unsupported current state or overlapping current values.

Pagination advances over **scanned** rows, so an empty filtered page may still
have `has_more = true`. Follow its cursor. Cursors bind company, customer,
resource, facility and selection bounds. Site and metering pages are separate.
All authenticated success and error responses use `Cache-Control: private,
no-store` and `X-Gridex-Consumption-Version: 2026-11-13.1`.

No migration, generated database output, existing contract release or production
activation is part of this supplement. Component tests are not a substitute for
fresh positive Web → OPS consumption verification on the composed source.
