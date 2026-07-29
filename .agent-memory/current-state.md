# Current state

Last updated: 2026-07-28T15:08:00+02:00

- PHASE-30 canonical contract-channel permission/publication completion:
  IMPLEMENTED and LOCALLY VERIFIED, DATABASE VERIFICATION BLOCKED.
- Added one canonical grant/readiness/publish/unpublish service for internal,
  website and API across both admin surfaces.
- Rebuilt the strict admin read model with mandatory grants, channel status,
  validity and independent per-channel availability.
- Added explicit API publication permission, API scope readiness, shared
  website/API DTO mapping and schema version `2026-07-28.2`.
- Added the forward migration
  `20260728190000_contract_channel_permission_publication_completion.sql`,
  final-schema introspection and 43-control channel regression.
- TypeScript targets, 56 files/361 tests, API/OpenAPI, 212 go-live controls,
  518 lifecycle controls, lint and production build pass locally.
- The new migration checksum is registered and exact.
- Migration integrity is BLOCKED only because historical
  `20260728170000_live_schema_code_canonical_sync.sql` differs from its
  registered checksum. No attached version contains the trusted original.
- No database was available to apply the migration or execute production
  scenarios A-H. Release remains NO-GO until the historical file is restored,
  migration integrity is green, final schema inspection passes and A-H plus
  endpoint verification pass in staging.

- PHASE-29 live-schema/code canonical synchronization: IMPLEMENTED and
  LOCALLY VERIFIED.
- Compared delivery 93 with the exported active live schema, 23 live lint
  errors, active function definitions, views, triggers, grants, indexes, RLS
  and recorded remote migration history.
- Added one fail-closed forward migration:
  `20260728170000_live_schema_code_canonical_sync.sql`.
- All 41 exact active-function patches match the exported live definitions.
- All 23 live-lint function errors are covered.
- Static code/schema analysis verifies 4,759 literal writes, 3,679 query-field
  accesses and 120 literal RPC calls against live plus repair.
- Migration history now has 319 files, 223 version groups and verified
  checksums. Historical remote/local provenance remains noncanonical.
- Contract P0 regression passes 126 controls; go-live static suites pass.
- TypeScript passes.
- Full Vitest passes: 55 files, 357 tests.
- ESLint passes with 0 errors and 124 existing unused-code warnings.
- Public API/OpenAPI checks pass at `2026-07-28.1`.
- Production Next.js build completes.
- SQL parser accepts the repair migration (141 statements), preflight (12)
  and post-apply (14).
- Production database application is not performed: the workspace has no
  authorized production connection. Production remains NO-GO until preflight,
  apply, post-apply, live lint and smoke tests pass.
- Git provenance remains unavailable because the archive excludes `.git`.
