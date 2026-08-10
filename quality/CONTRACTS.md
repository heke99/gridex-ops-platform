# Behavioral Contract Extraction — Gridex OPS external boundary

Generated: 2026-08-10
Scope: 221 focused source, route, schema, test, workflow and migration files recorded in exploration_role_map.json. The full repository is larger than 500 source files, so this remediation run intentionally covers the user-specified external API, Customer Portal, integration, webhook, database and release boundary.

## Summary by category

- METHOD: 10
- ERROR: 6
- INVARIANT: 11
- COMPAT: 5
- ORDER: 3
- LIFECYCLE: 5
- SECURITY: 10
- CONFIG: 3

## Public DTO and response boundary

1. [SECURITY] Public DTO mappers expose documented fields only and never serialize database rows by spreading or passthrough.
2. [INVARIANT] Stable public references are tenant-bound and do not reveal an internal UUID or foreign key.
3. [ERROR] The final external serializer rejects forbidden keys and non-allowlisted UUID-like values before emitting response bytes.
4. [COMPAT] Public DTO versions, not database columns, define the V1 wire contract.
5. [METHOD] Developer fixtures exercise the same mappers and schemas used by runtime routes.

## Portal pagination and lookup

6. [ORDER] Each list uses a deterministic domain sort key plus a unique tie-breaker.
7. [METHOD] A list query applies the tenant/customer predicate and keyset cursor in PostgreSQL and reads requested limit plus one.
8. [INVARIANT] Full cursor traversal returns every eligible row exactly once, including at positions 1, 101 and 1001.
9. [ERROR] A malformed, expired or cross-resource cursor is rejected with the canonical client error and is never silently reset.
10. [METHOD] Invoice detail performs one direct lookup by company, customer and canonical public invoice reference.
11. [SECURITY] Cross-tenant and missing detail lookups are externally indistinguishable neutral 404 responses.

## Schema readiness and errors

12. [ERROR] Missing required table, view, column, function or migration maps to platform_schema_not_ready with HTTP 503.
13. [INVARIANT] Empty success is possible only after a successful query returns zero rows.
14. [METHOD] All documented errors use the canonical envelope with request, correlation and contract metadata, retryability and structured blockers or fields.
15. [COMPAT] Authentication, authorization, not-found, conflict, validation, quota and infrastructure failures retain their canonical status semantics.

## Writes and idempotency

16. [LIFECYCLE] Every registry-declared idempotent write claims, executes, audits and completes one durable lifecycle.
17. [INVARIANT] Idempotency identity includes tenant, API client, operation, relevant resource/customer, key and canonical request hash.
18. [METHOD] Same identity and body replays the exact stored response; a different body conflicts without another mutation.
19. [SECURITY] Identical keys used by two tenants or API clients never share lifecycle state.
20. [ERROR] A critical lifecycle, legal evidence, permission or ledger write failure prevents a success response; best-effort telemetry does not.

## Canonical operation and release registry

21. [CONFIG] Each operation declares method, path, operationId, auth, scopes/mode, rate class/cost, idempotency, schemas, cache and public-ID policy once.
22. [INVARIANT] Generated OpenAPI has one route per registry operation and no unimplemented operation.
23. [INVARIANT] operationIds match the identifier grammar and are globally unique.
24. [COMPAT] A single current contract constant controls runtime, OpenAPI, manifest, docs, examples, generated clients and immutable release URL.
25. [METHOD] Actual route responses and fixture examples validate against exact public schemas with unknown properties rejected by default.
26. [COMPAT] Compatibility and deprecation values come from shared closed enums and include replacement/sunset metadata where applicable.
27. [CONFIG] Bearer API key authenticates; Gridex required scopes authorize and are not presented as OAuth scopes.

## Bootstrap, auth, identity and readiness

28. [METHOD] Integration context returns tenant/client public references, contract/base/OpenAPI URLs, auth model, capabilities and readiness without internal company identifiers.
29. [SECURITY] New tenants receive granular scopes; legacy scope aliases are accepted only through an explicit sunset policy and are not provisioned anew.
30. [SECURITY] Authentication atomically verifies token, client and tenant state, expiry/revocation, scope, IP policy and rate cost in the database and fails closed.
31. [CONFIG] Browser Origin participates only in CORS policy; token, tenant, scopes, quota and optional network policy decide server authentication.
32. [SECURITY] Portal identity resolution is tenant-bound, reports ambiguity, follows one strong/weak/manual policy and never treats an identifier alone as authorization.
33. [METHOD] Readiness is one decision covering active client/tenant, granular scopes, public references, portal setup, contract compatibility and optional verified webhook.
34. [METHOD] Provisioning produces an integration pack and executes a harmless tenant smoke flow with the real API client.

## Public reads and performance

35. [METHOD] Hot external reads use explicit projections or public read models; select-star is forbidden.
36. [ORDER] Public-contract fingerprint/revision is read before the full feed and enables immediate 304.
37. [METHOD] Independent reads may execute concurrently; reads composing one authorization or domain decision use one atomic RPC/read model.
38. [SECURITY] Authorization, revocation, tenant state, economic and legal decisions are never served from stale caches.
39. [LIFECYCLE] Performance evidence records p50/p95/p99 and separates database, compute and external dependency time for named operations.

## Webhooks

40. [INVARIANT] A closed webhook registry declares event name/version, public schema, required fields, description, lifecycle and mapper.
41. [SECURITY] Event payload mappers use explicit per-event allowlists and reject unknown events or properties.
42. [SECURITY] Every production subscription has its own active secret reference/version and a bounded previous-secret rotation window; no global fallback signs new deliveries.
43. [LIFECYCLE] Delivery remains durable and idempotent per subscription/event with retry/backoff, stale-lock recovery and dead-letter/paused states.
44. [INVARIANT] Each delivery exposes an opaque public reference and a signature timestamp covered by the signature.

## Database and release integrity

45. [LIFECYCLE] Historical applied migrations are immutable; missing official ledger statements are restored exactly and fixes use new forward migrations.
46. [INVARIANT] Clean replay matches connected schema functions, columns, constraints, indexes, RLS and code/generated-type expectations.
47. [SECURITY] Duplicate index removal occurs only after dependency checks and retains the canonical invoice keyset index.
48. [INVARIANT] NOT VALID constraints are validated only after zero-violation probes; dev and production are evidenced separately.
49. [SECURITY] Existing verified RLS and SECURITY DEFINER boundaries are preserved; intended zero-policy service tables are documented rather than opened.
50. [LIFECYCLE] Geodata staging and log families have explicit batch, promote, cleanup, retention and partition policies appropriate to legal and technical data.
51. [METHOD] Index decisions use representative query plans and write-amplification measurement after duplicate cleanup.
52. [LIFECYCLE] Mandatory CI runs type, lint, unit, contract, response, pagination, isolation, webhook, migration, security, replay and build gates for every main merge.
53. [INVARIANT] A production release ties source, merged CI and deployment to the same immutable SHA and records environment-specific database and latency evidence.
