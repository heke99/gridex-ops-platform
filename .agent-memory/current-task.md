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

## Stage 3 — DONE: parity engine is now guarded by CI

- `scripts/gridex-db-parity-selftest.sh` builds two throwaway databases from
  one schema, asserts they compare clean in `blocking` mode, injects one drift
  of every required class, and asserts each class is reported by exact
  substring. It drops both databases on exit (verified: no leftovers).
- `npm run db:parity:selftest` wraps it; it takes the admin Postgres URL as
  its first argument and defaults to the local Supabase stack on 54322.
- Added `--no-ignore` to the engine so a CI gate cannot be quietly widened by
  editing `gridex-db-parity-ignore.json`. The self-test always uses it.
- Wired into `.github/workflows/ops-hardening.yml`, job `clean-migration-replay`,
  as a step after typegen verification and before evidence upload. That job is
  the right host: the local Supabase stack from the replay script is still
  running and `psql` is present. Its log is uploaded as
  `rem002-db-parity-selftest.log`.
- Verified through the exact CI invocation
  (`npm run db:parity:selftest -- <url>`), not just by running the script
  directly. Workflow YAML re-parsed clean; jobs unchanged
  (verify, quality-release-gates, clean-migration-replay).

Rationale worth keeping: a comparator that stops detecting drift is worse than
no comparator, because a green run then reads as proven parity.

## Stage 4 — DONE: F-P0C-4 closed

`db:types:gen` was `supabase gen types typescript --linked --schema public`.
It is now `supabase gen types typescript --local`, byte-identical to the CI
command in `.github/workflows/ops-hardening.yml`.

Two divergences from CI were fixed, not one:

- `--linked` generated the canonical type file from whatever Supabase project
  happened to be linked on the developer's machine, which plan §6.3 and
  absolute rule §36 forbid outright.
- `--schema public` was an extra flag CI does not pass, so even a correctly
  sourced local run could have produced a file CI would then reject.

`npm run db:types:check` still passes on the committed file (3339422 bytes,
tail migration `20260904103000_z01_sla_watchdog_candidate_convergence.sql`).
That check is the backstop: it pins the generated-types hash to the migration
tail, so a wrong-source regeneration fails rather than landing silently.

## Stage 5 — DONE (tooling): F-P0C-2 and F-P0C-3 addressed, baseline pending

`scripts/gridex-schema-snapshot.cjs` + `npm run db:schema:snapshot` /
`npm run db:schema:check` produce the two Fas 3 artifacts:

- `schema.sql` — normalized structure-only `pg_dump` (§6.1).
- `schema.fingerprint.json` — per-section sha256 plus one overall hash (§6.2).

The fingerprint is computed from the SAME introspection document the parity
engine compares, so the two tools cannot disagree about what "the schema" is.
It covers relations, columns, enums, constraints, indexes, functions,
triggers, policies, grants, RLS state and extensions — replacing the
hand-picked 13-table scope of `gridex-aud-003-schema-fingerprint.sql`.

Two normalizations were required to make the dump byte-stable, both found by
running it twice rather than by assuming:

- the `-- Dumped from/by ... version` banner lines are dropped;
- `pg_dump` randomizes its `\restrict` / `\unrestrict` psql guard tokens on
  every run. They are rewritten to one fixed literal rather than deleted, so
  the artifact stays deterministic AND remains a valid psql script.

### Verification actually executed

- Two writes from the same database produce byte-identical `schema.sql` and
  `schema.fingerprint.json` (canon fingerprint
  `e6a28665b9e3a59a24324098a72d0539214fc4dd9952549ca6aab379b587cdd4`).
- `--mode check` against its own baseline passes (exit 0).
- `--mode check` against the drifted database fails (exit 1) and names the
  drifted sections individually: columns, constraints, enums, indexes,
  triggers, relation_grants, functions, policies, relations, function_grants.
- `--mode check` with no committed baseline fails closed (exit 2) instead of
  passing by default.
- Both were run through the exact npm/CI invocation, and `supabase/` stayed
  clean (no stray artifacts).

### Wired into CI, and WHY the gate is not yet active

`.github/workflows/ops-hardening.yml`, job `clean-migration-replay`:

1. "Capture canonical schema artifacts from the replayed shadow" always runs
   and writes `rem002-schema-snapshot/`, uploaded with the other evidence.
2. "Verify committed canonical schema artifacts" is guarded by
   `if: hashFiles('supabase/schema.fingerprint.json') != ''`.

There is NO committed baseline yet, and one cannot be produced in this
container: the Supabase CLI is not installed here, so clean replay cannot run
and any locally generated artifact would not be canonical. The guarded step
means the gate turns itself on the moment a real baseline is committed.

## Exact next action

1. Download `rem002-schema-snapshot/` from a green `clean-migration-replay`
   run on this branch, commit its two files as `supabase/schema.sql` and
   `supabase/schema.fingerprint.json`, and confirm the guarded CI step then
   runs and passes. That is the last step of Fas 3 and it needs CI, not a
   local machine.
2. Once that baseline exists, consider retiring the narrow
   `scripts/gridex-aud-003-schema-fingerprint.sql` and its pinned
   `EXPECTED_FINGERPRINT` in `scripts/gridex-aud-003-clean-replay.sh` in favour
   of the schema-wide fingerprint. Do NOT do this blind: that expected hash can
   only be recomputed by a real clean replay.
3. Production parity (§7 pointed at live, `blocking` mode) remains BLOCKED by
   open blocker #1 — no production Supabase project is visible from this
   session. The engine and the artifacts are the prerequisites; pointing them
   at production is a separate step that needs credentials this session does
   not have.
4. Nothing in Fas 5 onwards (typed Supabase clients, tenant architecture,
   inbound mail, Ediel, readiness, billing) was touched this session.

## Environment note for the next session

The local PostgreSQL cluster used for verification is NOT part of the repo and
will not survive this container:
`/var/lib/postgresql/gridex-parity`, port 55432, trust auth, started with
`pg_ctl -o '-p 55432 -k /tmp'` as the `postgres` OS user. Recreate it with
`initdb` if you need to re-verify locally, or run the self-test against any
Postgres where the connecting role may create databases. The Supabase CLI is
NOT installed in this container; anything requiring clean replay must run in
CI.
