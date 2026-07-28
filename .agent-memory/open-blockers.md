# Open blockers

## BLK-001 — Repository provenance

Status: BLOCKED. The uploaded ZIP excludes `.git`; branch, commit and original
dirty-tree state cannot be established. Diff evidence is against the exact
uploaded archive and its SHA-256.

## BLK-002 — Production apply and postflight

Status: READY_FOR_AUTHORIZED_OPERATOR. The single forward migration, preflight
and post-apply are implemented and statically verified, but this workspace has
no authorized production database connection. Production remains NO-GO.

## BLK-003 — Noncanonical historical migration chain

Status: REQUIRES_POST_APPLY_BASELINE. Remote history contains only nine
historical entries with versions/content that do not match the current local
files, while newer objects exist live. Do not run `db push`. Build a fresh
baseline from the verified post-apply schema.

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
- Typecheck, tests, API docs, migration integrity and production build pass.
