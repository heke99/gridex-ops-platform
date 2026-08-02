# Canonical hardening delivery

Date: 2026-08-02
Target inspected: Supabase project `gridex-ops-dev` (`piidsfebjqjmnepdpnas`)
Release decision: **NO-GO**

## Delivered

- Registered forward-only migration `20260802170000_canonical_security_convergence.sql`.
- Actor-authenticated canonical lifecycle, production, first-send, profile and provisioning RPC boundaries.
- Request-payload-bound idempotency and first-live-send single-use enforcement.
- Explicit Ediel profile identity, read-only canonical readiness and least-privilege/RLS hardening.
- Verified invitation flow without temporary passwords or pre-verification tenant access.
- Runtime writers routed through canonical database boundaries and ambiguous roles made fail-closed.
- Baseline, schema/ledger reconciliation, tenant/RLS/security inventories, preflight, backfill,
  quarantine, dependency, staging, rollback, cutover and verification reports.
- Guarded sync script that refuses production-labelled targets and blocks ledger repair/apply until
  explicit parity and staging approvals are supplied.

## Local evidence

| Gate | Result |
|---|---|
| PostgreSQL parser | PASS |
| ESLint | PASS: 0 errors; 126 inherited `no-unused-vars` warnings |
| TypeScript app/scripts/tests | PASS |
| Vitest | PASS: 62 files, 417 tests |
| Migration integrity | PASS: 337 files, 241 version groups/checksums |
| Canonical/behavior/tenant/security regressions | PASS |
| Production dependency audit | PASS: 0 vulnerabilities |
| Next.js production build on Node 22 | PASS |

## Release blockers

Read-only preflight found:

- 153 legacy `ediel_test_runs` without deterministic tenant ownership;
- one duplicate active actor-profile group;
- one prepared/live production state without a configuration snapshot;
- only function-body parity, not full schema parity, for ledger-missing migrations A-C.

No database mutation was performed. D-F and the new convergence migration are not claimed as
applied. Real JWT/RLS, service-role negative, concurrency, worker and external transport tests remain
required after a controlled isolated-staging apply.

## Safe synchronization sequence

```bash
export PATH=/path/to/node-22/bin:$PATH
./scripts/sync-canonical-hardening.sh verify-local

SUPABASE_PROJECT_REF=piidsfebjqjmnepdpnas \
  ./scripts/sync-canonical-hardening.sh plan
```

Stop after the dry-run until every A-C table, constraint, index, policy, trigger, function and grant
matches and a reviewer approves `docs/canonical-hardening/MIGRATION_RECONCILIATION.md`.

Only after that approval, on isolated staging:

```bash
GRIDEX_TARGET_ENVIRONMENT=staging \
SUPABASE_PROJECT_REF=piidsfebjqjmnepdpnas \
GRIDEX_SCHEMA_PARITY_APPROVED=I_HAVE_REVIEWED_EXACT_A_C_PARITY \
  ./scripts/sync-canonical-hardening.sh repair-ledger

GRIDEX_TARGET_ENVIRONMENT=staging \
SUPABASE_PROJECT_REF=piidsfebjqjmnepdpnas \
GRIDEX_SCHEMA_PARITY_APPROVED=I_HAVE_REVIEWED_EXACT_A_C_PARITY \
GRIDEX_APPLY_STAGING=I_UNDERSTAND_THIS_APPLIES_TO_STAGING \
  ./scripts/sync-canonical-hardening.sh apply-staging
```

Then execute the checks in `VERIFICATION_PROTOCOL.md`. Never use this first apply against production.
