# Gridex OPS master remediation plan

1. Freeze and record baseline tests, public contracts, migration inventory, and live dev catalog.
2. Finish QPB requirement/test/review/spec/reconciliation/verification artifacts inside `quality/`.
3. Restore the ten live-but-missing forward migrations into repository source and prove checksum/catalog parity.
4. Fix confirmed P1 public DTO, keyset pagination, invoice reference, schema truthfulness, and idempotency gaps with failing tests first.
5. Consolidate registry/OpenAPI operation metadata, compatibility enum, strict schemas/examples, and runtime response/forbidden-ID validation.
6. Wire runtime to atomic auth/rate-cost/portal identity/read-model/fingerprint capabilities already present live; retain fail-closed behavior.
7. Harden webhook registry/DTO/secrets without weakening durable delivery and tenant isolation.
8. Verify live indexes/constraints/RLS/advisors/geodata/log retention; apply only reviewed forward migrations needed for confirmed dev drift.
9. Run typecheck, lint, tests, API gates, migration gates, security scans, build, targeted live SQL, advisors, and generated type parity.
10. Update agent memory/readiness/release evidence, package the complete changed repository, and explicitly record unavailable production/staging proof.

