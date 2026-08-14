# Runtime Contract Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reconstruct the verified runtime hardening changes from production schema evidence and the recovered requirements, without repeating or mutating already-applied production work.

**Architecture:** Treat current `main` as the code baseline and the live Supabase catalog as the authority for the already-applied forward migration. Restore the migration and its request-path consumers, then restore contract/runtime tests and CI gates before any push or merge.

**Tech Stack:** Next.js 16, TypeScript, Vitest, Supabase/PostgreSQL, GitHub Actions, Vercel.

## Global Constraints

- Preserve tenant derivation from authenticated server-side context.
- Preserve fail-closed readiness and authorization behavior.
- Do not apply further production DDL during recovery.
- Node major remains 22 in repository and CI.
- Only merge after required hosted checks pass.

---

### Task 1: Restore persisted database/runtime contract

**Files:** migration, generated types, readiness runtime and tests.

- [ ] Restore the forward migration from live catalog definitions.
- [ ] Change request readiness from dynamic capability view to the persisted singleton.
- [ ] Restore distributed dependency-circuit and batch-geodata consumers.
- [ ] Run targeted database/runtime tests.

### Task 2: Restore API security and resilience contract

**Files:** shared dependency classifier, auth parser, idempotency validator, telemetry and tests.

- [ ] Add shared dependency error classification tests and implementation.
- [ ] Add canonical Idempotency-Key tests and implementation.
- [ ] Make Bearer parsing strict and case-insensitive; reject malformed Authorization without fallback.
- [ ] Record legacy x-api-key usage through the service-only RPC.

### Task 3: Restore operational gates and evidence

**Files:** cron configuration, timing metadata, CI workflow, audit evidence and project memory.

- [ ] Stagger cron starts without changing intended cadence.
- [ ] Add deployment/region/request identifiers to structured timing.
- [ ] Gate the recovered behavior and migration in hosted CI.
- [ ] Run full tests, typechecks, lint, migration integrity and build.
- [ ] Push, open PR, wait for green CI, squash merge and verify production.
