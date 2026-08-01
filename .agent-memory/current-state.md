# Current state

Last updated: 2026-08-01T01:25:00+02:00

- PHASE-36 Public Contracts runtime/OpenAPI/legal parity is IMPLEMENTED and STATICALLY VERIFIED; dependency-based full build, PostgreSQL apply and staging E2E remain blocked.
- Contract version is `2026-08-01.1` across the canonical runtime constant, response metadata/headers, integration context, both OpenAPI releases, release manifest, fixtures, tests and `/developers/customer-portal-api`.
- `price_options[].is_default` is canonical. `default` is emitted only as an always-identical deprecated compatibility alias. Strict serializers reject conflicting values and require exactly one default option.
- The exact locked `legal_bundle_version_id` is emitted on `legal` and every module row. Bundle mismatch, duplicate modules, mutable snapshots and missing new-publication IDs fail closed with structured codes.
- Website and API feeds share the same external DTO boundary. The API RPC now includes canonical legal data.
- Forward migration `20260801003000_public_contract_runtime_openapi_legal_parity.sql` has SHA-256 `19bbfbb56f3b150835e873200962d490dd043c7d2de51ded83e4460061659850` and an exact-relation, dry-run-first, idempotent audited backfill.
- Website OpenAPI SHA-256 is `e15a170a38b0cecadb2b815c1387c2336f02da7a69c96af418acca3999952f5f`; Customer Portal OpenAPI SHA-256 is `72fe14799c971f34e172782972ae510c9817cc6e4b981fb5ec8a71326f49e628`.
- Static API/docs/OpenAPI/release/migration semantic checks and focused domain regressions pass. All 16 changed TS/TSX files pass syntax/transpile validation; the canonical model/DTO/error boundary pass an isolated strict TypeScript check.
- Full `npm ci`, Vitest, lint, complete typecheck and Next.js build were not rerun because this environment cannot resolve `registry.npmjs.org`.
- Release remains NO-GO: the uploaded archive has an inherited checksum mismatch for historical migration `20260730220000...`; no historical checksum was silently rewritten. No authorized database, staging origin/API key, Gridex Web source or deployment target was supplied.
