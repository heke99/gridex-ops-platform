# Current state

Updated: 2026-09-04

- Active branch: `claude/gridex-ops-production-hardening-lrknxa`, based on main
  `62272e9` ("Prevent resolved Z01 SLA history from starving watchdog batches
  (#306)").
- The repository now has a canonical/live database parity engine,
  `npm run db:parity`, comparing two databases in both directions over
  schemas, relations, columns, enums, constraints, indexes, functions,
  triggers, policies, grants, RLS state and extensions, with report-only,
  warning and blocking modes. Report-only is the default.
- The parity engine is itself guarded by `npm run db:parity:selftest`, which
  runs in the `clean-migration-replay` CI job and asserts that fifteen classes
  of injected drift are each detected.
- `npm run db:schema:snapshot` / `db:schema:check` produce and verify the two
  canonical Fas 3 artifacts, `schema.sql` and `schema.fingerprint.json`. The
  fingerprint covers the whole compared schema, not the thirteen hand-picked
  tables of the older audit fingerprint.
- No canonical schema baseline is committed yet. CI captures one on every
  clean-replay run; the verification step is guarded on the baseline existing
  and activates automatically once it is committed.
- `db:types:gen` now generates from the local shadow (`--local`), identical to
  CI. It previously generated from `--linked`, i.e. an arbitrary project.
- Clean replay, migration integrity (584 files), generated-types pinning and
  the tenant invariant gate all remain in place and unchanged.
- Production database parity and production promotion remain blocked: no
  production Supabase project is visible from this environment.
- This session added no migration, changed no runtime or application code, and
  mutated no database.
