# Current state

Last updated: 2026-08-02T18:56:00+02:00

- PHASE-40 emergency access lockdown is implemented locally and release remains NO-GO.
- Read-only inspection of `gridex-ops-dev` proves four `security_definer` views, 63 anon/authenticated-executable SECURITY DEFINER findings, two internal system tables without RLS, broad public default privileges, and a tenant-bindable global platform-role helper/policy surface.
- Registered forward migration `20260802190000_canonical_emergency_access_lockdown.sql` sets the four readiness views to `security_invoker`, removes anon/authenticated access to them and four mutating SECURITY DEFINER functions, enables/forces RLS on the two internal tables, replaces the platform-admin helper with a global-only check, and rejects tenant-bound global platform roles.
- Local emergency-access regression, 339-file/243-group migration integrity and the 24-check RBAC audit pass. The migration SHA-256 is `9f5071e87c0689feb84f8701cbbeef72f65fb1c227862fb1ba628da47bb40d43`.
- After a clean 446-package install, app/script/test TypeScript, 62 files/417 tests, ESLint (0 errors/125 warnings), zero-vulnerability production audit and the full Next.js build pass on the available Node 24.14.0. The package declares Node `>=22 <23`, so Node 22 CI parity remains required.
- PostgreSQL parse/compile of `20260802190000` is NOT VERIFIED: local `psql` and a writable Supabase CLI home are unavailable, and remote compilation would evade the blocked persistent apply gate.
- The controlled database apply was rejected pending explicit user approval of the access-control blast radius. No workaround and no remote mutation occurred; post-apply SQL/JWT verification is therefore NOT VERIFIED.
- The remote ledger is current through `20260802180000`; earlier memory claiming only nine versions is superseded by the authoritative ledger inspection.
- Data blockers remain: 153/232 Ediel test runs have no tenant, 11 passed actor results lack canonical snapshot/run proof, three active memberships (all owners) lack active roles, 96 constraints remain NOT VALID, and active Ediel configuration is empty.
- GitHub repository `heke99/gridex-ops-platform` is connected; `main` head observed as `8374b70ef902caac1510b85d1f01f3630629a09e`. The uploaded archive has no `.git`, so exact archive-to-commit byte parity remains unproven and no GitHub write was performed.

- PHASE-39 canonical security convergence is implemented and locally green; database rollout remains NO-GO pending exact A-C schema parity and staging cleanup.
- Corrected unsupported PostgreSQL `min(uuid)` calls in the external safe preflight and the pending convergence migration; the preflight now executes read-only against `gridex-ops-dev`, and migration integrity/canonical/RBAC regressions pass with the new checksum.
- Registered migration `20260802170000_canonical_security_convergence.sql` adds actor-authenticated canonical boundaries, request-hash idempotency, one-time first-live approval, actor-role-qualified profile identity, read-only readiness and least-privilege/RLS hardening.
- Company provisioning, lifecycle, Ediel production/profile/route and invitation paths now use canonical fail-closed boundaries; temporary-password and pre-verification membership/access paths are removed.
- Read-only remote preflight passes company-status and cross-tenant message checks, but blocks on 153 unscoped test runs, one duplicate active actor-profile group and one production state without a snapshot.
- PostgreSQL parsing, all TypeScript targets, 417 tests, 337-file/241-group migration integrity, canonical/security regressions, zero-vulnerability production audit and the full Node 22 build pass.
- No remote database mutation was performed. Real JWT/RLS, service-role negative, concurrency, worker and external transport proof remain post-apply requirements.

- PHASE-38 canonical production hardening is locally green under Node 22 but database rollout is blocked by remote ledger/schema drift; release is NO-GO.
- Ediel evidence v2 now derives the result entirely in PostgreSQL and binds it to tenant, run, canonical test identity, active configuration snapshot, portal identity, exact message relations, ACK outcomes, transport, variant and rulebook.
- Terminal attempts/evidence and approved/rejected attestations are immutable; direct `passed`/`manual_verified` projections require matching canonical rows rather than a GUC flag.
- `WEBSITE_APPLICATION_COMMITTED` is atomically projected to canonical audit, domain event and outbox from `workflow.committed`.
- The five TypeScript failures are fixed. Next 16.2.12, PostCSS 8.5.25 and Sharp 0.35.3 remove all high/critical production audit findings.
- Clean Node 22 install, every TypeScript target, 417 tests, migration integrity and the full production build pass. Lint is 0 errors/126 classified unused-variable warnings.
- Both changed migrations compiled against the connected development schema inside rolled-back transactions; explicit post-checks confirmed no persistent database mutation.
- Remote ledger reconciliation, D–F apply, quarantine review, constraint validation, RLS/JWT and concurrency/E2E remain outstanding.

- PHASE-37 canonical multi-tenant hardening is implemented in the supplied OPS archive and statically verified; environment and cross-repository proof remain blocked.
- Integration authentication now returns a frozen `TenantContext`; v1 routes use `auth.context.companyId` rather than reading tenant directly from the client row.
- Canonical onboarding requires explicit tenant context. Admin, website, external-contract and Ediel inbound adapters create and pass it.
- Client tenant claims are stripped when matching and rejected when mismatching. Billing provider webhooks ignore payload/header tenant hints and resolve one persisted provider-invoice target.
- Runtime calls tenant-neutral onboarding/numbering/legal aliases. Contract/application numbering and auth-mail sender configuration fail closed when canonical configuration is missing.
- Forward migration `20260801143000_canonical_multitenant_platform_hardening.sql` has SHA-256 `4de56322077ea89f72596bd9cd2de9f2bdae67c2b74c4721779410553b3326b0`.
- Migration adds fail-closed capabilities, tenant-qualified candidate keys/FKs and new-write company guards. Constraints remain `NOT VALID` until legacy data is inspected.
- All-tenant preflight, deterministic dry-run/apply and post-verification scripts plus architecture/runbook/delivery documentation are present.
- Static multi-tenant regression, canonical onboarding regression, manual mailbox/Ediel regression, legal readiness regression and modified-file syntax checks pass.
- Full dependency gates are blocked by registry 404. Database/staging and all-repository verification were not run.
- Release decision remains NO-GO until migration history, database isolation, full build/tests and every external repository are verified.
