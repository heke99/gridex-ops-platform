# Handover

Last updated: 2026-08-01T01:25:00+02:00

## Implemented and statically verified

- Public Contracts contract version `2026-08-01.1`.
- Strict canonical price-option/legal model shared by Website and API DTOs.
- Canonical `is_default`, identical deprecated `default`, strict mismatch/default-count checks and valid variable `area_prices: []` semantics.
- Exact locked `legal_bundle_version_id` on legal and module rows, UUID/immutability/module consistency checks and public-safe diagnostics.
- Forward migration `20260801003000...`, dry-run-first exact-relation backfill and service-role/audit controls.
- Website OpenAPI SHA `e15a170a...`; portal SHA `72fe1479...`; canonical fixture, release manifest and developer page are synchronized.
- Static parity/compatibility/docs/release gates, migration semantic gate and focused domain regressions pass.
- Changed TS/TSX syntax/transpile and isolated canonical-core strict TypeScript check pass.

## Unverified

- Complete dependency installation, all project TypeScript targets, Vitest, lint and Next.js production build.
- PostgreSQL migration apply, real backfill counts/idempotency and database transaction behavior.
- Deployed runtime/OpenAPI/manifest/docs bytes and staging tenant behavior.
- Gridex Web type/AJV regeneration and production client behavior.

## Blocking evidence

- `registry.npmjs.org` cannot be resolved in this environment.
- Historical `20260730220000...` expected SHA remains `0ab350f0...`; uploaded file hashes to `978de5e9...`. The trusted manifest entry was not rewritten.
- No authorized DB/staging/deployment credentials or Git provenance are available.

## Exact continuation

Recover the trusted historical migration from canonical Git or reconcile against the applied ledger. With Node 22 and a working registry, run `npm ci`, lint, all typechecks, tests and build. Apply the new migration in isolated staging, run preview/apply/second dry-run, deploy, execute served-response-to-served-OpenAPI validation and verify exact release-manifest checksums. Then synchronize current Gridex Web source and rerun its generated type/AJV/build/E2E gates.
