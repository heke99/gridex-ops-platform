# Handover

PHASE-39 is implemented and locally verified but not applied. Release remains **NO-GO**.

The registered forward migration is `20260802170000_canonical_security_convergence.sql` with SHA-256 `8ef36f7d8c5b8bc3913d3a739d631de6e8f609594e70e320336233ac87935dfd`. It adds actor-authenticated canonical wrappers, request-hash idempotency, one-time first-live approval, actor-role-qualified profile identity, read-only readiness and least-privilege/RLS hardening. The checksum includes the PostgreSQL 17-compatible replacement of unsupported `min(uuid)`. Runtime provisioning, invitation, lifecycle, production, profile and route writers use those canonical boundaries.

Local proof under Node 22: PostgreSQL parser; app/script/test typechecks; 62 Vitest files and 417 tests; 337 migration files/241 version groups; canonical, tenant and RBAC regressions; zero production vulnerabilities; full Next.js 16.2.12 build. ESLint has 0 errors and 126 inherited unused-variable warnings.

Remote facts are read-only: A-C principal function bodies match, but complete table/constraint/index/policy/trigger/grant parity is not proven. Preflight found 153 null-tenant runs, one duplicate active profile group and one production state without a snapshot. No remote mutation was performed.

Continue in this order:

1. Run `scripts/sync-canonical-hardening.sh plan` only against isolated staging/dev.
2. Complete and sign off exact A-C catalog parity before any ledger repair.
3. Resolve all three preflight blocker classes without fallback/default values.
4. Use the guarded script to repair the ledger, review the new dry-run, then apply D-F, `20260802160000` and `20260802170000` in isolated staging.
5. Run the documented DB/JWT/RLS/service-role/concurrency/worker verification protocol and repeat Node 22 gates.

Never guess a tenant/profile/snapshot, use a temporary password, grant access before invitation acceptance, or perform the first apply against production.
