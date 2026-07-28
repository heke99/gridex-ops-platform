# Current task

Last updated: 2026-07-28T11:28:30+02:00  
Branch: UNVERIFIED (uploaded archive excludes `.git`)  
Last verified commit: null

## Active phase

PHASE-29 — controlled production application and post-apply proof.

## Completed locally

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

With an authorized operator and the correct production Session Pooler URL,
follow `GRIDEX_LIVE_REPAIR_RUNBOOK_2026-07-28.md`: take pre-schema export, run
preflight, verify migration checksum, apply the single forward migration, run
post-apply and live lint, export post-schema, perform critical smoke tests, and
only then register version `20260728170000` as applied.

## Blockers

- No authorized live database connection is present in this workspace.
- Provider sandbox/credentials and deployment target are unavailable.
- The uploaded archive has no Git metadata.
- Historical remote/local migrations are not a canonical chain; do not run
  `db push`.

## Do not repeat

Do not report local/static success as a production apply. Do not replay old
migrations, mark the complete local history as applied, restore direct
core/legacy execution, or guess missing provider environments.
