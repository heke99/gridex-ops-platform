# Handover

Last updated: 2026-07-30T02:31:00+02:00

## Verified locally

- Full Vitest: 58 files / 370 tests.
- App, test and script TypeScript targets: pass.
- ESLint: zero errors (124 existing warnings).
- API/OpenAPI/docs parity and deterministic finalization: `2026-07-30.1`.
- Single-key tenant regression: 107 checks; energy resolver, idempotency, portal, webhook, error-boundary and tenant-gate regressions pass.
- Both OPS and Web production builds pass locally.
- New portal-identity migration checksum matches the manifest.

## Implemented but not database-verified

`20260730120000_atomic_website_portal_identity.sql`, the release-manifest endpoint and deployment of the `2026-07-30.1` OpenAPI/runtime/guide release. Static checks pass, but the migration and live contract have not been applied/verified.

## Active blockers

Historical `20260728170000...` checksum drift is still a release blocker. No authorized database, provider sandbox, staging API keys, deployment target or Git metadata is available. The current live release-manifest URL returns 404. PostgreSQL clean/upgrade apply, live parity and end-to-end staging are therefore not claimed.

## Exact continuation

Restore the historical migration from the trusted applied artifact, run `npm run db:migrations:check`, apply through `20260730120000...` in staging, deploy OPS with Node 22, then run Web `api:sync`/`api:check:live` plus guest/authenticated application, portal, webhook, idempotency, concurrency and two-tenant isolation scenarios.
