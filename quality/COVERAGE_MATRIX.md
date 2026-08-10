# Contract Coverage Matrix

Generated: 2026-08-10
Total contracts: 53
Covered: 53 (100%)
Uncovered: 0 (0%)
Partially covered: 0 (0%)

## Fully covered contracts

| Contract range | Behavioral concern | Requirement and condition |
|---|---|---|
| 1–5 | DTO allowlists, public references, final gate, versioning, fixtures | REQ-001 — all conditions |
| 6–9 | deterministic database keysets and cursor behavior | REQ-002 — conditions 1–5 |
| 10–11 | direct invoice lookup and neutral tenant errors | REQ-003 — conditions 1–4 |
| 12–15 | schema readiness, empty truth, envelope/status semantics | REQ-004 — conditions 1–4 |
| 16–20 | durable, bound, replayable idempotency and critical logging | REQ-005 — conditions 1–5 |
| 21–27 | canonical registry, generated OpenAPI, versions and security semantics | REQ-006 — conditions 1–6 |
| 28–29 | safe bootstrap and granular scope lifecycle | REQ-007 — conditions 1–3 |
| 30–32 | atomic authentication, CORS separation and identity policy | REQ-008 — conditions 1–5 |
| 33–34 | readiness, integration pack and smoke flow | REQ-007 — conditions 2–3 |
| 35–39 | public projections, early fingerprint, read composition and performance | REQ-009 — conditions 1–4 |
| 40–44 | webhook registry, DTO, secrets and reliable delivery | REQ-010 — conditions 1–5 |
| 45–52 | migrations, catalog integrity, RLS, lifecycle and CI | REQ-011 — conditions 1–6 |
| 53 | exact-SHA, environment-specific closure | REQ-012 — all conditions |

## Coverage loop

Iteration 1 found that provisioning/readiness contracts 33–34 were split between bootstrap and runtime requirements. REQ-007 conditions were sharpened to cover both. Iteration 2 found no orphan contract. The 75-point master traceability table in REQUIREMENTS.md provides a second, independent specification-to-requirement check.

## Pattern cardinality

| Pattern | Requirements | Required use-case coverage |
|---|---|---|
| whitelist | REQ-001, REQ-006, REQ-007, REQ-009, REQ-010 | explicit positive and forbidden/unknown variants |
| parity | REQ-002, REQ-003, REQ-004, REQ-005, REQ-011 | canonical/legacy or parallel-resource equivalence |
| compensation | REQ-008, REQ-012 | dependency failure and unavailable-environment behavior |
