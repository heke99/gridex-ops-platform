# Open blockers

## BLK-001 — Repository provenance

Status: BLOCKED. The uploaded ZIP excludes `.git`; branch and commit cannot be
established. Diff evidence is against the exact uploaded archive.

## BLK-002 — Database apply and concurrency verification

Status: BLOCKED_BY_ENVIRONMENT. No Supabase CLI, `psql`, database URL or
authorized staging project exists. Static history/regression checks pass, but
the six new forward migrations have not been executed against PostgreSQL.

## BLK-003 — Provider runtime verification

Status: BLOCKED_BY_ENVIRONMENT. No provider sandbox or credentials are
available for a signed invoice/event round trip.

## BLK-004 — Deployment parity

Status: DEPLOYMENT_REQUIRED. Runtime and migrations must deploy together, after
which live API/docs/provider parity must be verified.

## Resolved

- Legacy readiness fixtures are corrected; billing readiness is 52/52.
- Package install, full typecheck, test, lint, build and RBAC are no longer
  environment-blocked.
- Quote-to-customer graph is now one database transaction at runtime.
