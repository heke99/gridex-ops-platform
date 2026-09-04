# Current task

Updated: 2026-09-04

Status: `IN_PROGRESS`

Active work item: GRIDEX OPS MASTER REMEDIATION PLAN — work order §35, item
**P0-C: DB parity engine** (plan Fas 4, `npm run db:parity`).

## Why this item

P0-A (clean replay) and P0-B (generated types) already exist in code and were
verified this session by reading the code, not the memory files:

- `scripts/gridex-aud-003-clean-replay.sh` performs empty-DB -> foundation ->
  checksum-pinned history -> CLI ledger replay and asserts a fingerprint.
- `.github/workflows/ops-hardening.yml` job `clean-migration-replay` runs that
  script, regenerates types with `supabase gen types typescript --local`
  (pinned CLI 2.101.0) and byte-compares against `supabase/database.types.ts`.
- `scripts/check-supabase-generated-types.cjs` + `supabase-types-manifest.json`
  pin the generated-types hash to the migration tail.

P0-C has no implementation at all. That makes it the first genuinely missing
item in the plan's own order.

## Code-verified findings (evidence, not memory)

- **F-P0C-1 (high, open)** — `npm run db:parity` does not exist. Verified by
  enumerating `package.json` scripts: no `db:parity`, `db:replay`,
  `db:schema:dump`, `db:schema:fingerprint`. Plan Fas 4 (§7) is unimplemented,
  so canonical-vs-live drift is undetectable in either direction.
- **F-P0C-2 (medium, open)** — No canonical `schema.sql` artifact exists
  anywhere in the repo (`find . -name schema.sql` outside node_modules returns
  nothing). Plan §6.1 unimplemented.
- **F-P0C-3 (medium, open)** — The schema fingerprint
  (`scripts/gridex-aud-003-schema-fingerprint.sql`) covers only 13 named tables
  plus 2 functions, and only their columns/constraints. Plan §6.2 requires
  indexes, triggers, RLS, policies, grants and function arguments across the
  schema. Most schema drift is therefore invisible to the current fingerprint.
- **F-P0C-4 (medium, open)** — `db:types:gen` runs
  `supabase gen types typescript --linked`, i.e. from whatever Supabase project
  happens to be linked. Plan §6.3 and absolute rule §36 forbid generating the
  canonical type file from an arbitrary DB. CI does it correctly (`--local`
  after clean replay); only the developer-facing script is wrong.

## Environment truth established this session

- Branch `claude/gridex-ops-production-hardening-lrknxa`, clean tree, HEAD
  `62272e9` ("Prevent resolved Z01 SLA history from starving watchdog batches
  (#306)"). NOTE: HEAD is newer than anything recorded in
  `completed-work.md`/`checkpoint.json`; memory was stale.
- 584 migration files in `supabase/migrations`, 72 in `supabase/bootstrap`.
- `node_modules` installed this session (`npm ci`, exit 0).
- `psql` 16.13 present; `initdb` present at `/usr/lib/postgresql/16/bin`; a
  `postgres` OS user exists, so a real local cluster can be started for
  verification. No Supabase CLI stack is assumed.
- Repo has NO `pg` npm dependency; every DB script shells out to `psql`.
  The parity engine must follow that pattern — do not add a dependency.

## Stage 2 — DONE: parity engine built and verified (F-P0C-1 closed)

Files added:

- `scripts/sql/gridex-db-parity-introspect.sql` — one deterministic JSON
  introspection document per database. Structure only, reads no table data.
- `scripts/gridex-db-parity.cjs` — both-directions comparator.
- `scripts/gridex-db-parity-ignore.json` — exception contract, empty by design.
- `package.json` script `db:parity`.

Design decisions (do not undo without reading these):

- Shells out to `psql`, matching every other DB script in the repo. NO `pg`
  npm dependency was added.
- Exit codes are deliberately distinct so "drift" can never be confused with
  "could not check" (plan §1.4 fail-closed): `0` pass/report, `1` drift in
  blocking mode, `2` operational error (bad URL, unreachable DB, malformed
  ignore file), `127` psql missing.
- Modes (§7.3): `report-only` (default), `warning`, `blocking`. Default is
  deliberately NOT blocking — live drift is not sanitized yet (§7.3 says make
  it blocking only once drift is remediated).
- Ignore entries REQUIRE `section`, `key` (regex) and a written `reason`, or
  the run fails. Undocumented exceptions are how drift becomes permanent.
- Object identity collisions abort the run rather than silently hiding drift.
- `--schemas` is validated against an identifier regex before being
  interpolated into the psql array literal.

Compared object kinds: schemas, relations (incl. relkind, RLS enabled/forced,
view definition, partition key), columns (type, udt/enum, nullability,
default, identity, generated), enum labels, constraints (PK/FK/unique/check,
definition, NOT VALID state), indexes (incl. partial, via full indexdef),
functions (identity arguments, return type, SECURITY DEFINER, volatility,
body hash), triggers, policies (command, permissive, USING, WITH CHECK,
roles), relation/function/schema grants, extensions.

### Verification actually executed (not assumed)

A real PostgreSQL 16.13 cluster was started locally on port 55432
(`/var/lib/postgresql/gridex-parity`, initdb trust auth) with two databases.

1. Identical schemas -> `PASS`, exit 0 even in `blocking`. No false positives.
2. Injected drift, every class detected:
   missing relation; extra relation; column type; nullability; column default;
   dropped unique constraint; dropped FK; dropped partial index; RLS disabled;
   rewritten policy USING expression; dropped trigger; changed function body;
   changed function argument type (overload identity); revoked grant; added
   enum label; and a VIEW whose tenant filter was silently removed.
3. The view case is why `view_definition` was added mid-build: without it a
   view that quietly drops `where company_id = ...` compares as identical.
4. Modes verified: report-only exit 0, warning exit 0, blocking exit 1.
5. Ignore contract verified: entry without `reason` aborts (exit 2); a valid
   entry suppresses exactly its own finding and is printed as ignored.
6. Error paths verified: missing URL, non-postgres URL, unreachable server,
   and a schema name containing SQL all exit 2 without running a comparison.

## Exact next action

1. Commit the parity engine.
2. Add `scripts/gridex-db-parity-selftest.sh`: a self-contained regression that
   creates two throwaway databases, injects the drift matrix above and asserts
   the engine reports each class. Wire it into the `clean-migration-replay`
   job in `.github/workflows/ops-hardening.yml`, which already has `psql` and
   a running local Postgres on 54322. Without this the engine itself is
   unguarded.
3. Fix F-P0C-4: `db:types:gen` must not use `--linked`.
4. Do NOT attempt production parity. Open blocker #1 still holds: no
   production Supabase project is visible from this session, so the canonical
   -> live comparison cannot be run and `blocking` mode cannot be turned on
   for production yet. The engine is the prerequisite, not the whole of §7.
