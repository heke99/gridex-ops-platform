# Current task

Last updated: 2026-08-01T14:45:00+02:00
Branch: UNVERIFIED (uploaded archive excludes `.git`)
Last verified commit: null

## Active phase

PHASE-37 — Canonical multi-tenant platform hardening for all tenants.

## Implemented locally

- Added explicit trusted `TenantContext` to integration auth and all implemented canonical onboarding channels.
- Rejected mismatching client tenant claims and removed billing webhook payload/header tenant selection.
- Added tenant-neutral onboarding, numbering and legal projection aliases while preserving legacy DB implementations only for compatibility.
- Removed runtime-generated contract/application number fallbacks and hard-coded auth/manual-mail sender defaults.
- Added fail-closed `company_capabilities`, tenant-qualified parent/child constraints and new-write tenant-not-null guards.
- Added all-tenant preflight, dry-run, deterministic audited backfill and post-verification SQL.
- Added architecture, rollout runbook and a precise NO-GO delivery report.

## Exact next action

Reconcile the two inherited migration-manifest issues from authoritative Git/database evidence. Install dependencies from a complete registry and run all typechecks, Vitest, lint and build. Apply `20260801143000...` in isolated staging, run preflight/dry-run/apply/second verification, validate constraints, execute three-tenant RLS/idempotency/concurrency/E2E, and then synchronize all external tenant website/portal/partner repositories to the same authenticated tenant contract.

## Blockers

- `20260730220000...` checksum drift remains unblessed.
- `20260731210000...` is missing from the checksum manifest.
- No authorized PostgreSQL/Supabase environment or staging deployment target.
- `npm ci` fails with registry 404 for `zod-validation-error-4.0.2.tgz`.
- Only the OPS repository was supplied; external platform repositories are absent.
- Git metadata is absent.
- Remaining legacy tenant-branded runtime inventory and distributed state/outbound paths are not fully remediated.

## Do not repeat

Do not add a fallback tenant, trust client `company_id`, restore runtime-generated business numbers, hard-code a tenant sender/domain, enable capabilities without readiness evidence, auto-move non-null cross-tenant rows, or claim database/build/platform GO without executed proof.
