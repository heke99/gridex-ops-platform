---
name: sql-optimization-patterns
description: Master SQL query optimization, indexing strategies, and EXPLAIN analysis to dramatically improve database performance and eliminate slow queries. Use when debugging slow queries, designing database schemas, or optimizing application performance.
---

# SQL Optimization Patterns

Transform slow database queries into faster operations through systematic optimization, proper indexing, and query plan analysis.

## When to Use This Skill

- Debugging slow-running queries
- Designing performant database schemas
- Optimizing application response times
- Reducing database load and costs
- Improving scalability for growing datasets
- Analyzing EXPLAIN query plans
- Implementing efficient indexes
- Resolving N+1 query problems

## Core Concepts

### 1. Query Execution Plans (EXPLAIN)

Use PostgreSQL `EXPLAIN`, `EXPLAIN ANALYZE`, and `EXPLAIN (ANALYZE, BUFFERS, VERBOSE)` to establish evidence before changing a query or index.

Watch for sequential scans on large selective reads, row-estimate errors, expensive nested loops, sort/hash spills, high buffer reads, and repeated scans. Prefer measured execution plans over assumptions.

### 2. Index Strategies

Use B-tree for common equality/range access, GIN for appropriate JSONB/array/full-text access, GiST for supported spatial/search workloads, and BRIN only where very large physically correlated tables justify it.

Composite-index column order matters. Partial and covering indexes are preferred when they match a stable high-value access pattern. Every index must justify its write/storage cost.

### 3. Query Optimization Patterns

- Select only columns needed by the caller; avoid broad `SELECT *` on hot paths.
- Eliminate N+1 query loops by batching, joins, RPCs, or set-based queries.
- Push selective predicates as early as practical.
- Avoid expressions on indexed columns unless a matching expression index exists.
- Paginate potentially unbounded lists.
- Prefer set-based operations over application loops.
- Verify tenant/company predicates remain present in every optimized query.

## Gridex OPS safety rules

Performance must never weaken tenant isolation, RLS, grants, ownership checks, canonical source-of-truth rules, auditability, idempotency, or write-path validation.

Do not add an index, rewrite a query, introduce caching, or create a database helper solely because it appears faster. Capture the relevant query plan or production-safe evidence first, implement the narrowest change, and re-measure.

For migrations:
- use forward-only migrations;
- never rewrite already-applied production migrations;
- use `CREATE INDEX CONCURRENTLY` when appropriate and operationally supported;
- account for write amplification and lock behavior;
- update repository migration/type manifests where required.

## Monitoring Queries

Use `pg_stat_statements`, table/index statistics, Supabase query performance evidence, and `EXPLAIN (ANALYZE, BUFFERS)` where production-safe. Compare p50/p95/p99 or representative execution-time distributions rather than a single run.

## Verification

After an SQL performance change:
- [ ] baseline evidence exists;
- [ ] tenant/company ownership semantics are unchanged;
- [ ] RLS/grants are unchanged unless separately required and reviewed;
- [ ] query plan improves for the proven hot path;
- [ ] write-path cost of new indexes is considered;
- [ ] targeted regressions pass;
- [ ] migration and generated-type checks pass where applicable;
- [ ] the change is reverted if improvement is within noise or correctness regresses.
