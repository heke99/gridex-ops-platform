---
name: observability-and-instrumentation
description: Instruments code so production behavior is visible and diagnosable. Use when adding logging, metrics, tracing, latency evidence, or alerting, and when performance work needs production evidence.
metadata:
  upstream: addyosmani/agent-skills
---

# Observability and Instrumentation

Performance work must be observable. Instrument only signals that answer a concrete operational question.

## Signals

Use the right signal for the question:
- **Metrics** tell you that something is slow or failing.
- **Traces/timings** tell you where time is spent.
- **Structured logs** tell you why a specific execution behaved that way.

Track latency distributions (p50/p95/p99), not averages alone.

## Gridex OPS performance instrumentation

For a route, action, background job, or external dependency that is proven slow, capture bounded structured timing for the meaningful stages, for example:
- auth / tenant context;
- RBAC permission resolution;
- Supabase/database reads;
- OPS service/RPC calls;
- external network calls;
- transformation/serialization;
- total duration.

Use stable event names and bounded fields. Reuse request/correlation IDs already present in the platform when available.

## Cardinality and data safety

Never place user IDs, emails, personnummer, raw customer identifiers, access tokens, full URLs with sensitive query data, or arbitrary error messages into metric labels.

Never log secrets, credentials, session tokens, raw signed documents, full production customer payloads, or sensitive identity data. Prefer allowlisted diagnostic fields and existing redaction helpers.

Tenant/company IDs may only be used in logs/traces where the repository's existing telemetry/privacy conventions allow them; do not turn them into unbounded metric dimensions.

## External dependency visibility

When an external or cross-service call is on the critical path, capture enough evidence to distinguish:
- application processing time;
- database time;
- remote/network time;
- retry/fallback time;
- timeout/error classification.

Do not add retries or change timeout semantics solely for performance without a separately verified reliability reason.

## Alerting / guardrails

Prefer user-visible symptoms and SLO-style thresholds over noisy infrastructure symptoms. For performance regressions, useful guards include:
- endpoint p95/p99 latency;
- error/timeout rate;
- queue age where applicable;
- route/client bundle growth;
- database query latency for known hot paths.

## Verification

- [ ] the telemetry answers a named operational question;
- [ ] fields are structured and bounded;
- [ ] no secret or sensitive payload is exposed;
- [ ] correlation works across the measured path;
- [ ] timing instrumentation itself is low overhead;
- [ ] before/after performance evidence is comparable;
- [ ] instrumentation does not alter authorization, tenant isolation, business state, or write behavior.
