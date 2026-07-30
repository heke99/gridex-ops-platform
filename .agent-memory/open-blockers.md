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

Status: RESOLVED LOCALLY. The file was restored byte-for-byte from the trusted
prior synchronized artifact and now hashes to its immutable manifest value
`881e1bc552b6a6295b6bc993cec82e55a25c56f0d5cdf525a784e33d2222d482`.
The intended delta is in registered forward migration `20260730130000...`.
Database replay proof remains covered by BLK-002/BLK-010.

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

## BLK-007 — Commercial selection database proof

Status: BLOCKED_BY_ENVIRONMENT. The forward-only option/component migration,
quote-v3 immutability, atomic internal selection and snapshot guards are
implemented and locally verified. Clean/upgraded apply, post-apply,
concurrency and tenant isolation require an authorized staging database after
BLK-003 is resolved.

## BLK-008 — Canonical API release deployment proof

Status: RELEASE_BLOCKER. The local runtime, guide, OpenAPI documents and Web
contract are synchronized at `2026-07-30.1`. The live release-manifest endpoint
now returns HTTP 200, but its advertised hashes do not match the raw served
OpenAPI files. Deploy this OPS patch, then require exact live
manifest/version/SHA parity before Web compatibility can be marked ready.

## BLK-009 — Full OPS/Web staging proof

Status: BLOCKED_BY_ENVIRONMENT. No authorized staging API keys, two isolated
tenant fixtures, webhook secret/provider sandbox or deployment SHA are
available. Guest/authenticated onboarding, database atomicity, portal runtime,
webhook retry/dead-letter, concurrency and cross-tenant denial remain unclaimed.

## BLK-010 — Duplicate migration timestamps and replay proof

Status: RELEASE_BLOCKER. Version groups `20260612193000`, `20260616123000` and
`20260727150000` contain multiple immutable files and are currently explicitly
allowlisted. Renaming a migration that may already be applied is unsafe without
the authoritative database migration ledger. A clean replay also needs to prove
the restored `20260728170000...` intermediate function-rewrite sequence.

## BLK-011 — Missing Gridex Web source

Status: BLOCKED_BY_INPUT. The supplied archive contains only Gridex Ops. No Web
patch, type generation, build or live client synchronization is claimed until
the current Gridex Web repository/archive is supplied.
