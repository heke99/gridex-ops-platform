# Current task

Last updated: 2026-08-09T09:45:00Z
Branch: `cursor/codebase-health-and-stability-8f9d`
Base: `main` @ `6c86e547` (PR #90 merged)

## Active item

GRIDEX-OPS-BL-006 — isolate platform-global contact and lookup-cache reads
(residual BL-002 variants O-005/O-006 plus O-007 import-history silent-empty path).

Also included: log-redaction gap for `person_number` / `personNumber` metadata keys.

## Status

`IMPLEMENTED_NOT_VERIFIED` for staging SQL matrix / exact-head CI.
Static verification on this branch is green:

- `npm run gridex:ops-bl-006-contacts-lookup-cache-isolation-regression` PASS
- `node scripts/gridex-aud-003-migration-provenance-regression.cjs` PASS
- `npm run db:migrations:integrity` PASS
- `npx vitest run __tests__/logging-redaction.test.ts` PASS (5 tests)

## Skill routing

- Activated: `using-superpowers`, `find-bugs`, `code-review`, `code-security`,
  `systematic-debugging`, `test-driven-development`, `supabase`,
  `supabase-postgres-best-practices`, `verification-before-completion`,
  `scan-secrets` (attempt)
- Conditional later: `fp-check` if O-008 contested; staging apply for BL-006 SQL
- Skipped: threat-model / quality-playbook full suite (not a repo-wide audit
  request); `install-hooks` (no consent); UI guidelines (no UI redesign)

## Next action

Open PR from `cursor/codebase-health-and-stability-8f9d`, then apply
`20260809123000` on a non-production database and run the SQL rollback
regression. O-008 remains intentionally out of scope for this PR.
