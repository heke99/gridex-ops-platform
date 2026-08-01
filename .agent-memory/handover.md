# Handover

PHASE-37 is implemented in the supplied OPS archive but not environment-verified.

Start with `docs/canonical-multitenant-delivery-2026-08-01.md` and `docs/canonical-multitenant-runbook.md`.

Key implementation:

- `lib/tenant/context.ts` and `lib/tenant/capabilities.ts`.
- `20260801143000_canonical_multitenant_platform_hardening.sql`.
- `scripts/canonical-multitenant-{preflight,backfill-dry-run,backfill-apply,post-verification}.sql`.
- Integration API routes and all implemented onboarding channels now use trusted context.
- Billing webhook ignores client tenant hints; sender and number fallbacks fail closed.

Exact continuation:

1. Reconcile `20260730220000...` checksum drift and the missing `20260731210000...` manifest entry from authoritative Git/applied-ledger evidence.
2. Run `npm ci` in an environment with a complete registry, then all typechecks, tests, lint and build.
3. Apply `20260801143000...` in isolated staging.
4. Run preflight, dry-run, reviewed deterministic apply, second preflight/post-verification and validate clean `mt_*` constraints.
5. Execute three-tenant RLS, API manipulation, idempotency, concurrency, worker and E2E tests.
6. Inspect and synchronize every external tenant website/portal/partner repository.
7. Classify the remaining legacy tenant-branded runtime inventory and eliminate prohibited logic.

Do not change historical checksums by assumption, add fallback tenants, trust client company IDs, or claim GO without database and cross-repository evidence.
