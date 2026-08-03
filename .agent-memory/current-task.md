# Current task

Last updated: 2026-08-03T23:37:05+02:00
Branch: UNVERIFIED (uploaded archive excludes `.git`)
Last verified commit: null

## Active phase

PHASE-41 — Runtime schema readiness v4 and Customer Portal API production alignment.

## Goal

Keep the external Website/Customer Portal API available whenever all required
runtime relations, columns, functions, RLS policies and ACLs are present. Audit
migration provenance separately without allowing compatible additive schema
changes or wall-clock expiry to create a production `503
platform_schema_not_ready` outage.

## Completed in this phase

- Traced the live `503` to a stale exact whole-schema fingerprint pin in
  `lib/platform/schemaReadiness.ts`, not to Gridex Web parsing or checkout.
- Replaced the exact fingerprint equality gate with versioned runtime-capability
  evidence plus a valid SHA-256 audit fingerprint; fail-closed capability
  behavior remains intact.
- Added unit coverage proving compatible fingerprints pass only when the live
  capability view is ready and malformed evidence fails closed.
- Renamed two local portfolio migrations to their authoritative live ledger
  versions and updated all references/checksum inventory.
- Added and applied forward migration
  `20260803212754_canonical_migration_readiness_reconciliation_v4.sql`.
- Reconciled six portfolio migrations into the canonical manifest and replaced
  raw count/version/staleness readiness with explicit ledger mappings and
  schema-effect evidence.
- Added idempotent `scripts/post-apply-runtime-readiness-v4.sql` and executed it
  successfully twice against `gridex-ops-dev`.
- Verified live runtime capabilities, canonical readiness, migration governance
  and compatibility state are all ready with no blockers.
- Verified API contract/OpenAPI/docs version `2026-08-03.1`, runtime parity,
  single-key tenant isolation, idempotency and Customer Portal multi-site
  regressions.

## Exact next action

Deploy the modified OPS application code so the running service stops comparing
the live capability fingerprint with the obsolete hard-coded hash. After the
deploy and the 30-second readiness cache window, smoke-test
`/api/v1/integration/context` and `/api/v1/website/public-contracts` with the
server-side tenant API key. Then synchronize Gridex Web's local OpenAPI snapshot
to `2026-08-03.1` and rerun its full launch/build suite.

## Remaining blockers

- The running OPS application has not been redeployed from this modified
  archive, so the old fingerprint pin may continue returning `503` until app
  deployment completes.
- External authenticated HTTP smoke tests require the tenant API key in the
  operator's environment; no secret is stored in project memory.
- Full local `npm ci`, TypeScript and Next.js build could not be rerun in this
  sandbox because its configured package mirror returns 404 for an indirect
  package. Dependency-free and repository-native contract checks are green.
- Earlier unrelated PHASE-40 security/data blockers remain tracked separately;
  this phase does not claim they are resolved.

## Release decision for this incident

DATABASE READY / CODE READY FOR DEPLOY. The specific public-contract
`platform_schema_not_ready` incident remains open until the OPS application is
redeployed and both authenticated API smoke tests return HTTP 200.
