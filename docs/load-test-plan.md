# Load / Performance Test Plan

Goal: confirm the launch-scale load (first weeks: a handful of tenants,
hundreds–thousands of customers, tens of thousands of metering values/day)
does not degrade page loads or exhaust the Supabase connection pool.

## Environments

Run against **staging** with production-like data volumes. Never load-test
production Ediel routes (counterparties are real market actors).

## Data volume seed (staging)

- 5 companies, 2 live
- 5,000 customers / 6,000 sites / 6,500 metering points (largest tenant: 3,000)
- 50,000 `ediel_messages`, 200,000 `metering_values`, 10,000 emails,
  5,000 website applications

## Scenarios and targets

| # | Scenario | Load | Target |
| --- | --- | --- | --- |
| 1 | `GET /api/v1/website/public-contracts` | 50 rps for 5 min | p95 < 300 ms, 0 errors |
| 2 | `POST /api/v1/website/customer-applications` (unique keys) | 5 rps for 5 min | p95 < 2 s, 0 duplicate rows, 0 false 500 |
| 3 | Same, 20% duplicate idempotency keys | 5 rps | duplicates return 200 `idempotent:true` |
| 4 | `POST /api/v1/customer/portal-bundle` | 20 rps | p95 < 800 ms |
| 5 | Admin dashboard `/admin` (platform admin) | 5 concurrent users | p95 < 3 s (RPC summary path) |
| 6 | `/admin/customers?q=…` search (slow path) | 3 concurrent | p95 < 4 s, no pool exhaustion |
| 7 | Email outbox drain | enqueue 500 rows, run cron | all sent/retried, no duplicates (Resend idempotency) |
| 8 | Inbound poll with 200 queued messages | run cron loop | steady drain, no stuck locks |
| 9 | Metering ingestion (UTILTS batch) | 10k observations | dedupe holds, no duplicate periods |

Rate limiting note: per-client `rate_limit_per_minute` on API keys will 429
above the configured limit — set the test client's limit accordingly and verify
429 behavior as part of scenario 1.

## Tooling

`k6` or `autocannon` from a separate host; Supabase dashboard for DB
CPU/connections; Vercel analytics for function duration. Do not add load-test
tooling to the repo.

## Pass criteria

- No 5xx bursts, no Supabase connection exhaustion (< 80% pool)
- No unbounded query appears in slow-query log (> 5 s)
- Verify the new bounded fan-outs hold: `/admin/companies` and go-live list
  pages stay < 3 s with 200 companies

## Post-launch

Re-run scenarios 1–4 monthly or before any pricing/tenant-count milestone.
