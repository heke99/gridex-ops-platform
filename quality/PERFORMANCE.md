# Gridex OPS — Performance Review

## Verdict

`unverified` at production scale.

No Critical or High performance defect was verified. Source review identifies risk areas, but the V3 `performance-optimization` and `sql-optimization-patterns` rules require measurements or query plans before an optimization is implemented or called successful.

## Evidence available

- source inspection of API, website application, Customer Portal, webhook and cron paths;
- Supabase advisor/catalog access;
- CI type/lint/test/build controls;
- known module sizes and orchestration structure.

Not available:

- production/staging p50/p95/p99 latency;
- `EXPLAIN (ANALYZE, BUFFERS)` for critical queries;
- database CPU/IO/lock/connection metrics;
- browser traces, Core Web Vitals or bundle analysis;
- controlled load/concurrency tests;
- RUM/APM evidence.

## Source-level risks

### PERF-001 — Oversized website orchestration module

- Status: `open`
- File: `lib/website/customerApplications.ts`
- Evidence: more than 8,400 lines and multiple critical responsibilities.
- Risk: expensive review/change surface, duplicated work and difficult profiling.
- Not proven: no runtime latency is inferred from line count.
- Next step: characterize endpoints and measure before extracting stable responsibilities.

### PERF-002 — Portal-sync repeated lookups/writes

- Status: `unverified`
- Area: `lib/customer-portal/tenantSync.ts`
- Source observation: sequential legal acceptance, document and facility processing can perform multiple scoped queries/writes per item.
- Risk: request latency grows with payload size and may create N+1-like patterns.
- Required evidence: representative payload trace, query count and `EXPLAIN` for dominant statements.
- Safety: tenant/company filters must remain intact; do not introduce cross-tenant shared caches.

### PERF-003 — Serial analytics/cron scaling

- Status: `unverified`
- Source observation: scheduled jobs may process bounded units serially.
- Risk: execution duration can approach scheduler limits as tenants/data grow.
- Required evidence: per-run item counts, duration, retry/lock data and backlog metrics.

### PERF-004 — Frontend runtime and bundle performance

- Status: `blocked`
- Evidence missing: browser/Lighthouse traces, bundle report, representative authenticated page measurements.
- Required checks: LCP, INP, CLS, route waterfalls, main-thread long tasks and table/list rendering.

## PostgreSQL and indexes

Fresh Supabase performance-advisor output was reviewed as a signal, not proof. Advisor suggestions alone do not establish that an index is missing or useful.

Before changing an index or query:

1. capture the exact production-like statement and parameters;
2. run `EXPLAIN (ANALYZE, BUFFERS)` in a safe non-production dataset;
3. record row estimates versus actual rows, scan/join type, buffers and time;
4. inspect existing indexes and write frequency;
5. add only the narrowest justified index/query change;
6. repeat the same measurement and keep the change only when the improvement exceeds variance and correctness tests remain green.

No `VACUUM FULL`, destructive maintenance or live index creation was executed.

## Caching and isolation

No new cache was added. Any future cache must include tenant/company, identity/permission context and relevant version/revision in its key. Public contract caching must continue to honor immutable version routes and private/no-store behavior for tenant-bound feeds where required.

## CI and build

The expanded V3 workflow includes lint, all typechecks, full tests, API checks and production build. These are correctness gates, not performance benchmarks. A green build does not prove Core Web Vitals, query latency or capacity.

## Performance budget proposal

A repository-approved budget does not yet exist. Establish one from product requirements and measured baseline, for example:

- API p95 per critical route;
- cron maximum duration/backlog;
- maximum query count per onboarding/sync payload;
- browser LCP/INP/CLS for critical pages;
- initial JavaScript size and route chunk growth;
- database connection and lock thresholds.

The numbers must be agreed and measured rather than copied from generic guidance.

## Required next steps

1. Instrument and sample critical website, portal, billing and cron flows in isolated staging.
2. Capture query counts and `EXPLAIN (ANALYZE, BUFFERS)` for dominant SQL.
3. Run browser traces and Lighthouse/Playwright on representative roles and data sizes.
4. Run bounded concurrency/idempotency/load tests without external production effects.
5. Record every attempted optimization with baseline, result, variance and keep/revert decision.
6. Split large modules only after characterization tests and measurements show a safe boundary.

## Readiness impact

Performance supports code review but remains `unverified` for staging scale and production capacity.
