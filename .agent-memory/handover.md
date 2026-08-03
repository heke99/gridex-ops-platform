# PHASE-41 handover — runtime schema readiness v4

The specific Website/Public Contracts `503 platform_schema_not_ready` incident
is repaired in source and in the connected Supabase database. The database is
ready; the modified OPS application has not yet been redeployed.

Root cause: `lib/platform/schemaReadiness.ts` compared the live database against
one obsolete exact whole-schema fingerprint. The live versioned capability view
already reported every required runtime capability present, so legitimate
additive schema changes incorrectly caused an outage.

Current authoritative live evidence:

- runtime capabilities: ready, zero blockers;
- migration governance: ready, zero missing/unmapped/duplicate mappings;
- canonical readiness: ready, zero blockers;
- compatibility state: `20260803-runtime-capability-compatible-v4`, ready;
- v4 ledger version: `20260803212754`.

Next operator action:

1. Sync this patch into the Git-backed OPS checkout.
2. Run Node 22 clean install, typechecks, tests and build.
3. Commit/push so Vercel redeploys the OPS application.
4. Wait at least 30 seconds for the old readiness cache/process to disappear.
5. Run authenticated `integration/context` and `website/public-contracts` smoke
   tests and require HTTP 200 with contract version `2026-08-03.1`.
6. Sync Gridex Web's OpenAPI snapshot and rerun its launch/build gates.

Do not reapply the live migration blindly. It is already present and verified.
For another environment, apply the forward migration once and run the supplied
idempotent post-apply verifier.

Older PHASE-40 security/data blockers remain tracked below and are not erased by
this incident repair.

---

# Handover

PHASE-40 is paused at the V2 emergency-lockdown apply boundary. Release remains **NO-GO**.

The registered forward migration is `20260802190000_canonical_emergency_access_lockdown.sql` with SHA-256 `9f5071e87c0689feb84f8701cbbeef72f65fb1c227862fb1ba628da47bb40d43`. Local emergency-access regression, 339-file/243-group migration integrity and the 24-check RBAC audit pass. The authoritative remote ledger is current through `20260802180000`; do not execute the stale A-C ledger repair described in older history.

The migration has not been applied. The safety review requires explicit user approval because it persistently revokes privileges, changes four view security modes, forces RLS on two system tables, replaces an authorization helper and adds a role-scope trigger. Do not split or work around that approval gate. If approved, apply only `20260802190000`, run `scripts/sql/05_emergency_access_lockdown_verification.sql`, rerun advisors and exercise real JWT/service-role runtime smoke tests before any later phase.

Current local gates after a clean 446-package install: all TypeScript targets; 62 files/417 tests; ESLint 0 errors/125 inherited warnings; production audit 0 vulnerabilities; full Next.js build. These ran on available Node 24.14.0, while package engines require Node 22. PostgreSQL parse/compile of the new migration is NOT VERIFIED and must not be simulated remotely around the apply approval gate.

Remote read-only blockers: 153 unscoped Ediel test runs; 11 passed actor results without canonical snapshot/run evidence; three active owner memberships without active roles; 96 NOT VALID constraints; no active Ediel test configuration. GitHub repo `heke99/gridex-ops-platform` and `main` head `8374b70ef902caac1510b85d1f01f3630629a09e` were observed, but the archive excludes `.git` and exact parity is unproven. No remote database or GitHub mutation occurred.

---

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
