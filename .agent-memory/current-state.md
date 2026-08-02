# Current state

Last updated: 2026-08-02T14:45:37+02:00

- PHASE-39 canonical security convergence is implemented and locally green; database rollout remains NO-GO pending exact A-C schema parity and staging cleanup.
- Registered migration `20260802170000_canonical_security_convergence.sql` adds actor-authenticated canonical boundaries, request-hash idempotency, one-time first-live approval, explicit profile identity, read-only readiness and least-privilege/RLS hardening.
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
