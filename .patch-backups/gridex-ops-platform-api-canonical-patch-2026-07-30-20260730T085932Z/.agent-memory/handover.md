# Handover

Last updated: 2026-07-29T15:56:55+02:00

## Verified locally

- Canonical commercial selection unit suite: 5/5.
- Full Vitest: 57 files / 365 tests.
- App and test TypeScript targets: pass.
- Changed runtime ESLint: zero errors.
- Commercial static regression: pass.
- API/OpenAPI/docs parity: `2026-07-29.1`, all checks pass.
- Production Next.js build: pass.
- New migration checksum matches the manifest.

## Implemented but not database-verified

`20260729200000_contract_commercial_selection_completion.sql`, including option/area tables, component extensions, quote v3 immutability, atomic offer v3, atomic internal customer selection, website snapshot binding, publication guard, legacy backfill/review and invoice trace columns.

## Active blockers

Historical `20260728170000...` checksum drift is still a release blocker. No authorized database, provider sandbox, deployment target or Git metadata is available. PostgreSQL clean/upgrade apply and post-apply are therefore not claimed.

## Exact continuation

Restore the historical migration from the trusted applied artifact, run `npm run db:migrations:check`, apply through `20260729200000...` in staging, then run channel and commercial post-apply scripts plus fixed 12/24/36 × SE1–SE4, paper/e-invoice/email, manipulation, cross-tenant and internal-selection-to-invoice scenarios.
