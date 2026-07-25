# Active decisions

## ADR-001 — One progress system

Status: VERIFIED

`.agent-memory` owns active progress. `docs/ai-context` remains domain and
historical documentation. `docs/ai-context/11_CURRENT_TASK.md` is superseded.

## ADR-002 — Single API-key tenant identity

Status: VERIFIED

The integration API key resolves tenant/company/client/scopes. No additional
required tenant environment variables are allowed.

## ADR-003 — Granular energy readiness

Status: VERIFIED

Pricing/quote readiness must not depend on PRODAT/switch dispatch readiness.
Facility lookup, switch creation and switch dispatch remain separate.

## ADR-004 — Supply activation transaction

Status: IMPLEMENTED_STATIC_VERIFIED

Only versioned `activate_customer_supply_v1` may complete a confirmed supplier
switch into an active supply/contract. Domain event and durable outboxes commit
in the same transaction; runtime must not recreate sequential completion writes.

## ADR-005 — Public resource IDs

Status: VERIFIED

Documented UUIDs are opaque tenant-bound public resource identifiers, never
authorization. Internal pricing/publication/identity/provider IDs are excluded
through explicit DTO allowlists.
