# Open blockers

## BLK-001 — Repository provenance

Status: BLOCKED. The uploaded ZIP excludes `.git`; branch, commit and original
dirty-tree state cannot be established. Diff evidence is against the exact
uploaded archive and its SHA-256.

## BLK-002 — Production apply and postflight

Status: BLOCKED. The channel-completion forward migration and post-apply are
implemented and statically verified, but this workspace has no authorized
database connection. Production remains NO-GO.

## BLK-003 — Noncanonical historical migration chain

Status: RELEASE_BLOCKER. The file
`20260728170000_live_schema_code_canonical_sync.sql` hashes to
`a743f580168fa2e5de28a9814f151ca0fdc1649517c84490afd093a72340afc4`,
but its immutable manifest value is
`881e1bc552b6a6295b6bc993cec82e55a25c56f0d5cdf525a784e33d2222d482`.
Restore the file from the trusted applied artifact. Never change the manifest
to conceal drift and do not run `db push`.

## BLK-006 — Contract-channel production scenarios

Status: BLOCKED_BY_ENVIRONMENT. Scenarios A-H, final PostgreSQL definitions,
two-tenant isolation, concurrency and external website/API feed verification
require an authorized staging database and API clients.

## BLK-004 — Provider runtime verification

Status: BLOCKED_BY_ENVIRONMENT. No provider sandbox or credentials are
available for signed invoice/webhook/idempotency round trips.

## BLK-005 — Deployment parity

Status: DEPLOYMENT_REQUIRED. Runtime and migration must deploy together, then
critical onboarding, publication, signature, invoice and provider smoke tests
must pass.

## Nonblocking debt

- ESLint: 124 existing `no-unused-vars` warnings, 0 errors. Handle as a
  behavior-tested dead-code/UI-wiring task, not a blind schema-repair cleanup.
- Release build should be repeated with declared production Node 22; the local
  Node 24 build passed.

## Resolved

- All 23 exported live-lint function errors have a repair path.
- All 41 exact active-definition patches match the live export.
- Runtime database paths, static writes, filters and literal RPC calls match
  live plus the repair migration.
- Typecheck, tests, API docs and production build pass. The new migration
  checksum is exact; the single historical drift remains explicit.
