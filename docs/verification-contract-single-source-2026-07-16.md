# Verification — canonical contract single source

Date: 2026-07-16

## Scope verified

This verification covers the patch built from the supplied Gridex OPS archive and the
contract/legal/publication goal for one canonical source of truth. It covers the new
migration, server actions, readiness UI, legal-template provenance, tenant-locked
mail/PDF evidence and the regression controls added for the flow.

## Results

| Check | Result |
| --- | --- |
| PostgreSQL static parse (`pglast`) | Passed, 51 statements parsed |
| Migration history integrity | Passed, 267 files / 172 version groups / checksums verified |
| New migration SHA-256 | `c2dcd7e84e5963486207a764a51e57f4830078c59e4032f1df3d8e8405bd5561` |
| Targeted ESLint on changed TS/TSX files | Passed |
| Application TypeScript | Passed |
| Test TypeScript | Passed |
| Script TypeScript | Passed |
| Full Vitest suite | Passed, 21 files / 154 tests |
| Contract single-source regression | Passed, 19 controls |
| Contract/legal publication completion regression | Passed, 32 controls |
| Canonical contract model regression | Passed |
| Platform legal templates regression | Passed |
| Website application canonical-dispatch regression | Passed |
| Next.js production build | Passed |
| Git whitespace/error check | Passed |

## Production build evidence

The final build ran after all source changes and completed all stages:

- optimized webpack compilation,
- Next.js TypeScript validation,
- page-data collection,
- static generation,
- route generation.

## Important runtime boundary

This environment did not have a linked Supabase project, `psql`, Docker or a local
PostgreSQL server. The migration was therefore syntax-parsed and checked against the
repository's migration checksum/history controls, but it was not executed against the
user's live database here.

Before production deployment, apply the migration to a database backup/staging clone,
run the verification queries in
`docs/canonical-contract-publication-single-source-2026-07-16.md`, and execute the
private/business plus contract-model E2E matrix. Production completion is only proven
after that database-backed staging check succeeds.
