# Current task

Last updated: 2026-07-28T15:08:00+02:00  
Branch: UNVERIFIED (uploaded archive excludes `.git`)  
Last verified commit: null

## Active phase

PHASE-30 — canonical contract-channel database verification and release proof.

## Completed locally

- Implemented channel grants, common readiness, granular RBAC and one
  canonical application service for internal, website and API.
- Rebuilt strict canonical admin/publication projections and graph integrity.
- Added the public DTO allowlist and API/OpenAPI version `2026-07-28.2`.
- Added forward migration `20260728190000...`, post-apply inspection and
  targeted static/behavior regressions.
- Verified app/test/script/contract TypeScript targets, 361 tests, full
  go-live suites, API docs, lint and production build.

- Audited the active live export against delivery 93.
- Implemented `20260728170000_live_schema_code_canonical_sync.sql`.
- Added read-only preflight, rollback-only post-apply and live-schema/code
  regression.
- Repaired runtime, OpenAPI and canonical database paths.
- Verified 319 migrations / 223 groups, 357 tests, typecheck, lint, API docs,
  P0/go-live regressions, SQL parse and production build.
- Produced `GRIDEX_LIVE_SCHEMA_CODE_SYNC_REPORT_2026-07-28.md` and
  `GRIDEX_LIVE_REPAIR_RUNBOOK_2026-07-28.md`.

## Exact next action

Recover `20260728170000_live_schema_code_canonical_sync.sql` byte-for-byte from
the trusted applied source so its SHA-256 is
`881e1bc552b6a6295b6bc993cec82e55a25c56f0d5cdf525a784e33d2222d482`.
Do not update the manifest instead. After `npm run db:migrations:check` is
green, apply `20260728190000...` to staging, run
`gridex-contract-channel-publication-post-apply.sql`, scenarios A-H and both
external endpoint checks. Promote only after every result is green.

## Blockers

- The exact trusted bytes for historical migration `20260728170000...` are
  absent from the uploaded and prior available archives.
- No authorized staging/live database connection is present in this workspace.
- Provider sandbox/credentials and deployment target are unavailable.
- The uploaded archive has no Git metadata.
- Historical remote/local migrations are not a canonical chain; do not run
  `db push`.

## Do not repeat

Do not report local/static success as a production apply. Do not rewrite the
historical checksum, run `db push`, replay old migrations, mark the complete
local history as applied, restore direct core/legacy execution, or guess
missing provider environments.
