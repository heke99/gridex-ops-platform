# Open blockers

## BLK-021 — Canonical hardening ledger/schema drift

Status: READY_FOR_GUARDED_REPAIR. The connected `gridex-ops-dev` ledger records
only nine historical versions while canonical A-C objects exist and D-F are not
recorded. Complete read-only table, column, constraint, index, RLS, policy,
trigger, grant, function and seed parity is now verified for project
`piidsfebjqjmnepdpnas`. Use only the guarded A-C repair command; do not run a
global push first or edit the ledger table directly.

## BLK-022 — Ambiguous legacy Ediel test-run ownership

Status: RELEASE_BLOCKER. Of 232 `ediel_test_runs`, 153 have null `company_id`.
Customer and actor-setting relations resolve none of those 153 deterministically.
They must remain quarantined until manually reviewed; no default/latest tenant
assignment is permitted.

The same read-only preflight found one obsolete 21660 supplier profile in the
test environment and one live production state without a snapshot. A guarded
repair is prepared: retain 92825/test and the existing 21660/production profile,
deactivate only the unreferenced duplicate, capture a snapshot and block stale
live production. It remains a blocker until executed and verified.

## BLK-023 — Post-apply security and evidence proof

Status: BLOCKED_BY_ENVIRONMENT. D–F, `20260802160000...` and
`20260802170000...` are not applied.
Real JWT RLS, service-role cross-tenant denial, evidence-chain, idempotency and
concurrency regressions require isolated staging fixtures after controlled apply.

## Resolved in PHASE-38

- Package installation works; clean Node 22 `npm ci` passes.
- App/script/test TypeScript, 417 tests and the production build pass.
- Local migration integrity passes for 336 files/240 version groups.
- Production dependency audit has 0 high/critical findings.
- The repaired and new migrations compile against the connected schema inside
  confirmed rolled-back transactions.

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

## BLK-012 — Customer Portal/API database and deployment proof

Status: RELEASE_BLOCKER. Forward migration `20260730153000...`, strict customer
sync, public-reference DTOs, portal pagination and atomic move-out pass local
static, type, test, API and build gates. Clean/upgrade PostgreSQL apply, move-out
replay/concurrency, two-tenant denial and deployed `2026-07-30.2` manifest hash
parity require an authorized staging environment and deployment.

## BLK-013 — Canonical price-option database and deployment proof

Status: RELEASE_BLOCKER. Forward migration `20260730220000...`, publication-
bound options, default/selection policy, public DTOs, immutable commercial
assertions and release `2026-07-30.3` pass local static, type, test, API and
build gates. Clean/upgrade PostgreSQL apply, post-apply, two-tenant denial,
quote/application concurrency and deployed manifest hash parity require an
authorized staging environment, Gridex Web source and deployment.

## BLK-014 — Public Contracts historical migration checksum drift

Status: RELEASE_BLOCKER. The uploaded `20260730220000_canonical_price_option_publication_api_completion.sql` bytes hash to `978de5e9b29da9428cd138cea3e57fb1c3ea65e8f903b28b1fb6493dff4e3cd5`, while the trusted manifest remains `0ab350f0da6648a497a80aeaedc1688eb5ae88e6279d6ab486526c070ff8c505`. This task did not rewrite either historical bytes or trusted checksum. Restore the canonical file or reconcile it against the applied ledger before database release.

## BLK-015 — Dependency installation unavailable

Status: BLOCKED_BY_ENVIRONMENT. `registry.npmjs.org` cannot be resolved from this workspace. Full project typecheck, Vitest, lint and Next.js build cannot be rerun until dependencies are installed in an environment with working package-registry DNS/access.

## BLK-016 — Public Contracts parity staging proof

Status: RELEASE_BLOCKER. The `2026-08-01.1` runtime, OpenAPI, manifest, fixture and docs are locally static-verified, but the new migration/backfill and exact served response/OpenAPI/checksum parity require an authorized staging database, deployment target, API key and isolated tenant fixture.

## BLK-017 — Canonical multi-tenant database proof

Status: RELEASE_BLOCKER. Migration `20260801143000...` and all-tenant remediation scripts are additive and statically checked, but no authorized database exists for clean/upgrade apply, RLS, composite-FK validation, backfill or three-tenant isolation proof.

## BLK-018 — Incomplete package registry

Status: BLOCKED_BY_ENVIRONMENT. `npm ci` returns HTTP 404 for `zod-validation-error-4.0.2.tgz` from the configured registry. Full typecheck, Vitest, lint and Next.js build remain unclaimed.

## BLK-019 — Missing platform repositories

Status: BLOCKED_BY_INPUT. Only OPS was supplied. Tenant websites, customer portals, partner services and other workers must adopt and verify the same tenant context/API contract before platform-wide approval.

## BLK-020 — Remaining legacy tenant-specific inventory

Status: RELEASE_BLOCKER. A lexical scan finds about 886 `gridex` occurrences across 220 runtime TS/TSX files. Many are namespaces/branding/fixtures, but every occurrence must be classified and prohibited defaults/branches removed before claiming zero tenant-specific production logic.
