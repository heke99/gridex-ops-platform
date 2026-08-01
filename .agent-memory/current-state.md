# Current state

Last updated: 2026-08-01T14:45:00+02:00

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
