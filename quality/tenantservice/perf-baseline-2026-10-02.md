# Performance baseline: tenant API (2026-10-02)

**Source.** The production request log `public.integration_api_requests` in project `piidsfebjqjmnepdpnas`. It has 11,159 requests from 2026-06-09 to 2026-10-02. Timing is server-side `duration_ms`, measured from the start of the route to its response.

**Method.**
- Read-only SQL (`percentile_cont`), per route and ISO week, with no sampling.
- Database counts at measurement time: 3 companies, 4 customers, 0 support cases.
- Query plans for the support and portal tables therefore do not show scaling. Their baseline has to be repeated once real volume exists, or with synthetic volume in staging.

## Whole period, per route (n ≥ 20)

| Route | n | p50 ms | p95 ms | p99 ms | 5xx % |
|---|---:|---:|---:|---:|---:|
| GET /api/v1/website/public-contracts | 7,428 | 1,466 | 5,889 | 7,866 | 3.7 |
| GET /api/v1/integration/context | 2,854 | 513 | 1,838 | 2,557 | 6.1 |
| GET /api/v1/website/switch-status | 394 | 456 | 625 | 844 | 0.0 |
| POST /api/v1/website/customer-applications | 90 | 3,139 | 7,652 | 13,927 | 38.9 |
| POST /api/v1/website/energy-area/resolve | 71 | 1,771 | 4,096 | 5,586 | 4.2 |
| POST /api/v1/website/quote | 61 | 1,038 | 3,798 | 4,299 | 9.8 |
| POST /api/v1/customer/portal-bundle | 55 | 3,670 | 13,688 | 14,717 | 0.0 |

## Current state (last 4 weeks, 2026-09-07 to 2026-10-02)

| Route | p50 ms | p95 ms | 5xx |
|---|---:|---:|---:|
| GET /api/v1/website/public-contracts | 866–955 | 1,489–1,981 | 0 |
| GET /api/v1/integration/context | 368–601 | 887–1,057 | 0 |
| POST /api/v1/website/customer-applications | (no traffic since 2026-09-02) | | |

## Findings

1. **The 5xx rates are historical.**
   - The 38.9 % for `customer-applications` came from 2026-08-17 to 2026-08-31.
   - The causes were missing migrations and grants: an FK on `powers_of_attorney`, an ambiguous `operation_id`, and `permission denied` on `remove_terms_accepted_from_application_response`.
   - The `public-contracts` 5xx (`api_auth_unavailable`, `PUBLIC_CONTRACTS_TEMPORARILY_UNAVAILABLE`) fell in the same week, 2026-08-17.
   - There have been no 5xx on these routes since 2026-09-01.
2. **`public-contracts` is the main latency hotspot.**
   - It is the most-called route: 66 % of all traffic.
   - It is a read of published offers that changes only on publication, yet p50 is about 0.9 s and p95 about 1.5–2 s.
   - The next step is to profile where the time goes (auth, catalog query, legal snapshot, serialization) with `observability-and-instrumentation`.
   - After that, consider a tenant-scoped response cache keyed by the publication fingerprint (`public_contract_feed_fingerprint_v1`). It must never cross tenants and must be invalidated on publish.
   - Expected effect: unverified. Measure before changing.
3. **`portal-bundle` p95 is 13.7 s**, from n = 55 with the last call on 2026-08-21. That is too little data for a current conclusion; re-measure when traffic resumes.
4. **Support API, attachments and customer assertion** have no production traffic yet. Their DB access is index-backed:
   - `customer_cases` filtered by company and customer;
   - `customer_case_attachments` on (company_id, customer_case_id, created_at);
   - the assertion replay primary key (company_id, jti);
   - a 30 s per-tenant provider cache.

## Re-measure

```sql
select route, percentile_cont(0.5) within group (order by duration_ms)::int p50,
       percentile_cont(0.95) within group (order by duration_ms)::int p95,
       sum((status_code >= 500)::int) n5xx, count(*) n
from public.integration_api_requests
where created_at > now() - interval '7 days'
group by route order by n desc;
```

## Update 2026-10-02: instrumentation of public-contracts

- **No conditional requests:** during the last 14 days there were 698 calls, all `200` and none `304`. Clients do not send `If-None-Match`, so the cheap fingerprint path is never used. Recommendation: the tenant website sends `If-None-Match: <ETag>`. Unchanged feeds then cost only `auth` and `fingerprint`, with no catalog query. This is a client-side change; the server already supports it.
- **Phase timings:** the route now writes `metadata.timings_ms = {auth, fingerprint, load, build}` to `integration_api_requests`. It goes to the log only and never into the response. Read after a few days of traffic:

```sql
select percentile_cont(0.5) within group (order by (metadata->'timings_ms'->>'auth')::int) auth_p50,
       percentile_cont(0.5) within group (order by (metadata->'timings_ms'->>'fingerprint')::int) fp_p50,
       percentile_cont(0.5) within group (order by (metadata->'timings_ms'->>'load')::int) load_p50,
       percentile_cont(0.95) within group (order by (metadata->'timings_ms'->>'load')::int) load_p95,
       percentile_cont(0.5) within group (order by (metadata->'timings_ms'->>'build')::int) build_p50
from public.integration_api_requests
where route like '%public-contracts%' and metadata ? 'timings_ms' and created_at > now() - interval '7 days';
```

- **No optimization yet:** none has been made, because the slowest phase has not been measured. Response logging and the usage event run after `duration_ms` is captured, so they are not included in that figure.

## Follow-up 2026-10-03 (production, 36 logged requests 2026-10-02 10:12 → 2026-10-03 09:28 UTC)

| Phase | p50 ms | p95 ms |
|---|---|---|
| auth | 44 | 147 |
| fingerprint | 41 | — |
| load | 437 | 708 |
| build | 9.5 | — |
| total (duration_ms) | 533 | 917 |

- **Slowest phase: `load`** (~82 % of p50). The parallel reads from #436 lowered `load` from ~550 ms (hours before the deploy) to ~430 ms (after); total p50 went from ~650 ms to ~530 ms.
- **Not the database.** `EXPLAIN ANALYZE` for the tenant with traffic: `canonical_visible_public_contracts_v` plans in ~38 ms and executes in ~7 ms (warm); `canonical_public_contract_delivery_readiness_v` ~34 ms + 17 ms. Planning of the large views is the biggest database cost but still ~50 ms per query.
- **Not region latency.** Vercel functions run in `arn1` and Supabase in `eu-north-1` (both Stockholm).
- **Likely cause: serial round trips inside the three parallel branches.** `loadExternalTenantContext` reads the tenant reference and then the readiness checks; `listPublicContractOffers` makes two rounds, and its price-option loader reads options and then area prices. The critical path is therefore 3+ round trips, but which branch dominates is not yet measured.
- **Next measurement (deployed with this change):** `timings_ms` now also has `load_revision`, `load_tenant` and `load_offers` (log only). Query after traffic:

```sql
select percentile_cont(0.5) within group (order by (metadata->'timings_ms'->>'load_revision')::int) revision_p50,
       percentile_cont(0.5) within group (order by (metadata->'timings_ms'->>'load_tenant')::int) tenant_p50,
       percentile_cont(0.5) within group (order by (metadata->'timings_ms'->>'load_offers')::int) offers_p50
from public.integration_api_requests
where route like '%public-contracts%' and metadata->'timings_ms' ? 'load_offers' and created_at > now() - interval '7 days';
```

- **Candidate optimizations, to be applied only to the branch the measurement points at:** (a) read the tenant reference and the readiness checks together; (b) fetch area prices together with price options; (c) move the offer feed into one database function (removes a round trip and repeat view planning). Each is kept only if the branch's p50 drops.
