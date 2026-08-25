---
name: performance-optimization
description: Optimizes application performance across frontend, backend, queries, and databases. Use when performance requirements exist, when you suspect performance regressions, when load times need improvement, when N+1 query patterns need fixing, or when profiling reveals bottlenecks.
metadata:
  upstream: addyosmani/agent-skills
---

# Performance Optimization

## Principle

Measure before optimizing. A performance change is a hypothesis until the same baseline measurement is repeated after the change. Keep only changes that produce a measurable improvement without weakening correctness.

## Workflow

1. **MEASURE** — establish a reproducible baseline.
2. **IDENTIFY** — prove the bottleneck rather than inferring it from file size or intuition.
3. **FIX** — make the smallest change that addresses that bottleneck.
4. **VERIFY** — repeat the same measurement under comparable conditions.
5. **GUARD** — add a regression budget, test, metric, or documented benchmark where useful.

## What to inspect in Gridex OPS

### First navigation / dashboard load
- server response and auth/RBAC latency;
- sequential Supabase/API calls that can safely run in parallel;
- oversized React client boundaries;
- heavy components loaded before the user opens them;
- duplicated data serialized from Server Components to Client Components;
- unnecessary request-bound rendering;
- large lists rendered without pagination/virtualization.

### Interaction latency
- unnecessary React re-renders;
- expensive derived calculations on every keystroke/render;
- synchronous filtering/sorting of large datasets;
- non-urgent updates that can use transitions/deferred values;
- repeated client fetches for identical data.

### Backend / API
- independent I/O executed sequentially;
- N+1 database access;
- unbounded reads or oversized payloads;
- duplicate tenant/auth/context lookups in the same request;
- external calls on the critical response path that can safely be deferred;
- missing safe caching for immutable/reference data.

### Database
- slow queries proven by timing or query statistics;
- missing/selectively useful indexes;
- sequential scans on large hot tables;
- repeated round trips that should become a set-based query/RPC;
- expensive count/aggregation work repeated unnecessarily.

## Performance budgets

Budgets should be route-specific, but use these as initial investigation thresholds rather than promises:
- interactive dashboard navigation should feel immediate after shell load;
- API p95 should be tracked per critical endpoint;
- initial client JavaScript must not grow without justification;
- list routes must remain bounded/paginated;
- no new N+1 query pattern is acceptable.

## Gridex OPS non-negotiable safety boundary

Never obtain a performance win by skipping or weakening:
- tenant/company scoping;
- RLS or authorization;
- RBAC/permission resolution required for access decisions;
- canonical customer/site/grid-owner ownership checks;
- pricing or contract invariants;
- EDIEL/supplier-switch state-machine validation;
- audit logging required for business events;
- idempotency/dedupe rules;
- legal/customer evidence validation;
- write-path consistency or transaction boundaries.

Do not cache tenant-sensitive or permission-sensitive data across security boundaries. Do not move authoritative server validation to the browser for speed.

## Measurement discipline

Use comparable cold/warm conditions. Record enough samples to distinguish an actual improvement from noise. Prefer p50/p95/p99 over averages for latency. For frontend work, compare route payload/client JS and interaction traces. For database work, compare query plans/buffers and representative timings.

If the result is neutral, worse, or requires a regression to pass, revert it.

## Verification checklist

- [ ] baseline exists before implementation;
- [ ] bottleneck is evidenced;
- [ ] optimization does not change business semantics;
- [ ] tenant/RBAC/RLS invariants are preserved;
- [ ] relevant regression tests remain green;
- [ ] typecheck/build remain green;
- [ ] same measurement is repeated after the change;
- [ ] change is kept only when improvement is meaningful;
- [ ] before/after evidence is recorded in the PR or performance ledger.
