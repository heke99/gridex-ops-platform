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

## Stage 6 — IN PROGRESS: clean replay without Docker (plan Fas 2, §5.1)

Context: `ops-hardening.yml` runs on `pull_request` and `push: main` only, so
pushing this branch triggered NO CI run. CI verification of anything in this
branch therefore requires a pull request. That is why unblocking local replay
mattered.

The agent container has no Docker, so `supabase start` cannot run. Plan §5.1
asks for "a new empty Supabase-compatible DB" — it does not require Docker.
So the empty database is now provisionable on plain PostgreSQL:

- `scripts/sql/gridex-supabase-compatible-bootstrap.sql` creates ONLY the
  platform surface the migration chain depends on: the Supabase roles (with
  `service_role` carrying BYPASSRLS so policies replay with real semantics),
  the `auth`, `storage`, `extensions`, `vault`, `graphql_public`, `realtime`
  and `supabase_migrations` schemas, the pgcrypto / uuid-ossp / pg_trgm
  extensions in `extensions`, GoTrue's `auth.users` (plus sessions and refresh
  tokens), `auth.uid()` / `auth.role()` / `auth.jwt()` / `auth.email()`,
  `storage.buckets` / `storage.objects`, and the Vault surface. It creates no
  Gridex object — everything in `public` still comes from the migrations.
- `scripts/gridex-aud-003-clean-replay.sh` accepts `GRIDEX_REPLAY_DB_URL`.
  When set it skips `supabase start`/`stop`, applies the bootstrap, and records
  the pinned ledger markers directly. ALL ordering, checksum pinning,
  substitution, interleaving and fingerprint logic is untouched and shared by
  both modes.

Environment work done to make this possible: `postgresql-16-postgis-3` was
installed with apt (PostGIS is required by
`20260611100000_energy_resolver_grid_area_operations.sql` and was the only
missing extension).

Two defects in my own patch were found by running it, not by reading it:

1. psql does not interpolate `:'var'` for `-c`, only for scripts. The ledger
   marker insert now goes in on stdin.
2. Supabase puts `extensions` on the search path; without that the chain dies
   on the first helper calling `digest()`. The bootstrap now sets
   `search_path` on the database and on anon/authenticated/service_role.

### Result: the whole chain replays, on plain PostgreSQL, with zero errors

All 565 replay inputs applied. No SQL error anywhere in the run. The pinned
Supabase CLI ledger verified: 48 official rows. 587 tables/views/matviews were
built in `public`. This is the first time clean replay has been shown to run
without Docker.

ONE difference remains, and it is understood:

    expected c70fa2f017f6ce3af3ff806d948f18b58a3c196e4bf94daa9304629a3926680c
    actual   324bc8e06587e5463244c4be7b6dd059a446fddd02f826cdf66bfcef0d5462bb

### The PostgreSQL-version hypothesis was TESTED AND DISPROVED

PostgreSQL 17.11 was installed from PGDG and a second full replay run on it.
It produced the SAME actual fingerprint, `324bc8e0...`, byte for byte. The
fingerprint is therefore version-independent and my replay is reproducible
across two major versions. The mismatch is real, not an artifact of PG 16.

Narrowing so far:

- The five migrations added after `d60626d` (the commit that last refreshed
  `EXPECTED_FINGERPRINT`, "Refresh clean replay fingerprint for Ediel readiness
  schema") touch NONE of the thirteen fingerprinted tables and NEITHER of the
  two fingerprinted functions. So the expected value ought still to be current.
- The fingerprint payload was dumped and inspected for coupling to my
  bootstrap. It references `auth.users` sixteen times and `auth.jwt` once, all
  inside foreign-key definitions and one function body, whose rendered text does
  not depend on how `auth.users` is shaped internally. `gen_random_uuid()` is a
  PostgreSQL built-in from 13 onwards, so unqualified defaults are not affected
  by the extensions search path either.

Two hypotheses remain, and they have very different consequences:

(a) my bootstrap still differs from the Supabase stack in a way that reaches
    the thirteen tables, so the harness is at fault; or
(b) `EXPECTED_FINGERPRINT` is stale, in which case the repository's own
    clean-replay gate is currently RED and would fail in CI.

### What the experiments actually showed — UNRESOLVED, do not report a verdict

1. Replaying `d60626d` ITSELF — the commit that set `c70fa2f...` — also
   produces `324bc8e0...`. So the constant is not merely stale relative to
   later migrations.
2. PostgreSQL 16.13 and 17.11 produce the identical actual fingerprint.
3. The fingerprint is NOT sensitive to `search_path`: four different settings
   all produce `324bc8e0...`.
4. The replayed shadow's public schema was compared object by object against
   the committed `supabase/database.types.ts`, which CI byte-compares against
   typegen from ITS clean replay. All 587 tables/views in the shadow exist in
   that file and every one has an identical column set. (An initial report of
   7 differing objects was my parser breaking on multi-line union types, not a
   real difference.)
5. On the shadow, every constraint on `ediel_message_intents` is VALIDATED,
   whereas memory records live carrying NOT VALID keys with 32 orphan rows
   behind them — a canonical/live divergence, but the migration chain contains
   no NOT VALID clause for that table, so this does not by itself explain the
   constant.

So the harness reproduces the canonical column-level schema, yet the pinned
fingerprint does not match. Either the constant does not correspond to a real
clean replay, or the difference sits in constraint/default/function detail that
the generated types do not capture. THIS CANNOT BE DECIDED FROM THIS CONTAINER.
It needs one CI `clean-migration-replay` run to emit the canonical value.

Do NOT change `EXPECTED_FINGERPRINT`. Do NOT commit a canonical baseline until
this is resolved. The guard is correctly refusing to certify a run it cannot
match.

## Stage 7 — CONFIRMED FINDING: the canonical shadow fails the tenant invariant gate

With clean replay runnable locally, the tenant isolation invariant gate was run
against the replayed canonical shadow for the first time:

    DATABASE_URL=<shadow> npm run tenant:invariants   ->  exit 3, FAILS

`completed-work.md` records that this same gate PASSES against the live schema
(2026-09-02). So live and canonical disagree, which is precisely the drift the
master plan exists to remove (§1.3, §5.3: a new Gridex must be creatable from
the repository without manual database intervention).

Breaches reported against the canonical shadow:

- F-6, RLS disabled on `platform_schema_state`, `price_book_lines`,
  `legal_bundle_items`, `integration_api_permission_groups`.
- F-13, three views without `security_invoker`:
  `gridex_automation_control_center_v`,
  `gridex_batch_2b_live_control_tower_v`,
  `gridex_batch_2c_control_tower_summary_v`.
- F-14, three policies targeting roles with no privileges on their table.
- F-16, six SECURITY DEFINER functions executable by `anon`, among them
  `gridex_next_customer_number(uuid)`, `canonical_onboard_customer_graph(jsonb)`
  and `gridex_company_go_live_readiness(uuid)`.

### Evidence this is real and not an artifact of my environment

For all four RLS tables, the migration chain NEVER enables row level security:
`grep -rlE "alter table (public\.)?<table> enable row level security"` over
`supabase/migrations` and `supabase/bootstrap` returns zero files, and zero
disable statements too. This is verifiable from source alone, with no database.

### Severity nuance — do not overstate this

All four tables are classified `platform_shared`, none has a `company_id`, and
none grants SELECT to `anon` or `authenticated`. They are closed by grants, so
this is missing defence in depth and a canonical/live divergence, NOT an open
cross-tenant read path. The F-16 functions executable by `anon` are the more
pointed part of the finding and deserve checking first.

NOT YET REMEDIATED. Any fix must be a forward migration that passes clean
replay (§36). That is now testable locally, which it was not before Stage 6.

## Stage 8 — remediating the invariant breaches (forward migration)

`supabase/migrations/20260904120000_canonical_tenant_invariant_convergence.sql`
closes the Stage 7 breaches. Registered in
`scripts/migration-history-manifest.json` via
`node scripts/register-migration-checksum.cjs` — the replay refuses any
migration that is not checksum-pinned, which is the provenance contract working.

Full breach list was 21, not the 15 first seen (the earlier output was tail
truncated): 11 x F-6, 3 x F-13, 1 x F-14, 6 x F-16.

What the migration does, and the evidence that each is safe:

1. Classifies `inbound_ediel_match_attempts`, `inbound_ediel_parse_results`
   and `inbound_email_attachments` as `system`, with the same rationale their
   siblings `inbound_email_messages` / `inbound_operation_events` /
   `inbound_processing_jobs` already carry.
2. Enables RLS on 8 tables: `price_areas`, `price_area_localities`,
   `gridex_performance_hardening_events`, `integration_api_permission_groups`,
   `integration_api_client_profiles`, `legal_bundle_items`, `price_book_lines`,
   `platform_schema_state`. Checked first: NONE of them grants any privilege to
   anon or authenticated, so no client can reach them either way and
   service_role bypasses RLS. Zero behavioural change.
3. Sets `security_invoker` on three control-tower views.
4. Drops three policies targeting `service_role` alone. service_role bypasses
   RLS, so they never applied.
5. Revokes EXECUTE from PUBLIC on six SECURITY DEFINER functions and grants it
   to `service_role`. Checked first: all six have a NULL ACL, i.e. they are
   reachable by `anon` only through PostgreSQL's default PUBLIC grant, no
   migration ever granted anything explicitly. The only two with application
   callers (`gridex_company_go_live_readiness`,
   `canonical_onboard_customer_graph`) are both called through the service-role
   client, and the gate's own comment notes policies reach SECURITY DEFINER
   predicates without the caller holding EXECUTE.

Severity note, so this is not overstated later: `canonical_onboard_customer_graph`
was inspected and contains no write statement — it validates a command and
returns jsonb. The F-16 items are defence in depth, not an open write path.

### Verified by re-running the real thing

First replay + gate run took the breaches from 21 to 3. The three that survived
were my own bug: I wrote `set (security_invoker = on)`, and the gate compares
the stored option to the literal string `'true'`. PostgreSQL keeps `on` as
`on`, so the views were correct in behaviour but invisible to the gate. Repo
convention is `true` (139 occurrences against 3, and those 3 were mine).
Corrected to `true`, the old checksum entry removed and the migration
re-registered.

Worth knowing: the gate's F-13 check is string equality against `'true'`, so a
future migration writing `on` will fail it for no real defect. That is
fail-closed, so it is safe, but it is fragile. Not changed here — out of scope.

Final replay + gate re-run IN PROGRESS at the time of writing.

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

## Stage 9 — provenance conflict found and resolved without weakening the guard

Running the repository's own `verify` gates against my Stage 6 work exposed a
real defect I had introduced:

    node scripts/gridex-aud-003-migration-provenance-regression.cjs
    -> [GRIDEX-REM-002] clean replay directly mutates the Supabase migration ledger

That guard (line 163 of the regression) forbids the replay script from writing
`supabase_migrations.schema_migrations`. My dockerless mode reconstructed the
pinned ledger with INSERTs so the ledger verification would pass.

The guard is RIGHT and I was wrong. In CLI mode the Supabase CLI produces those
rows independently, so verifying them against the pinned snapshot means
something. In my mode the script wrote the rows and then checked its own
writes — a circular assertion dressed up as provenance.

Resolution, chosen over weakening the regression:

- External mode now writes NOTHING to the ledger.
- The ledger verification is skipped in external mode and prints, loudly, that
  the run carries NO ledger provenance and must not be cited as canonical.
- The canonical CLI path is completely unchanged, and the provenance regression
  is untouched and passes again.

Do NOT "fix" this later by making external mode reproduce the ledger. Five
migrations read `supabase_migrations`, so the open question being tested now is
whether their behaviour changes the resulting schema. If it does, external mode
must be reported as an approximation, not as clean replay.

IMPORTANT for whoever picks this up: never edit
`gridex-aud-003-migration-provenance-regression.cjs` to make a replay change
pass. It exists precisely to catch this class of shortcut.

### Stage 9 result: the ledger turned out to be schema-irrelevant

Tested rather than assumed. Two shadows were replayed on PostgreSQL 17, one
with the reconstructed ledger and one with no ledger at all, and compared with
the parity engine built in Stage 2:

    node scripts/gridex-db-parity.cjs --canonical <with-ledger> \
      --target <no-ledger> --mode blocking --no-ignore
    -> PASS, identical across every compared object kind

So the five migrations that read `supabase_migrations` do not change the
resulting schema, and dropping the ledger reconstruction costs nothing. The
narrow pinned fingerprint is also unchanged at `324bc8e0...` either way. The
tenant invariant gate passes against the no-ledger shadow too.

Gate battery re-run locally, all green: provenance regression, migration
integrity, public-contract legal, contract hardening, generated types,
service-role ratchet, parity self-test, agent-memory git state, ops health,
contract channel publication, API billing tenant hardening.

### One follow-up created by the new migration

`scripts/check-supabase-generated-types.cjs` pins the manifest's
`latest_migration` to the newest migration file, so adding
`20260904120000_...` made it fail until the manifest was updated.

`scripts/supabase-types-manifest.json` now records the new tail with
`latest_migration_schema_effect` set to
`enables_rls_sets_view_security_invoker_drops_inert_policies_and_revokes_public_execute_no_generated_type_surface_change`,
following the same convention the previous tail migration used. The `sha256`
is deliberately unchanged.

HONEST LIMIT: I could not regenerate the types to prove that byte for byte.
The Supabase CLI 2.101.0 was installed at `/opt/supabase-cli` (co-located
`supabase` + `supabase-go`; installing only the shim fails), but
`supabase gen types --db-url` still shells out to a Docker container for
pg_meta, and there is no Docker here. The reasoning is that RLS flags, view
options, grants and a classification row are not part of the generated type
surface. CI regenerates and byte-compares, so if that reasoning is wrong CI
fails loudly rather than letting a wrong file through.

## Stage 10 — CI evidence settles the fingerprint question (my harness is the one that differs)

Queried GitHub Actions directly rather than continuing to reason about it.

Run 2450, `ops-hardening.yml`, push on `main` at `62272e9` (the current tip):

- job `clean-migration-replay`: **success**
- job `quality-release-gates`: success
- job `verify`: **failure**

So the repository's clean replay DOES produce `c70fa2f...` in CI. The earlier
hypothesis that `EXPECTED_FINGERPRINT` might be stale is DISPROVED — do not
revisit it, and do not change that constant.

What remains true: the dockerless harness reproduces a public schema whose
tables, views and columns are identical to the CI-verified generated types, and
whose narrow fingerprint is stable across PG 16/17, search_path and commits —
but it is NOT byte-equivalent to the Supabase stack for the thirteen
fingerprinted tables. The difference must sit in a column data type string,
a default, a constraint definition or one of the two readiness function bodies,
none of which the generated types capture. It is unlocated.

Consequence for how the harness may be used:

- GOOD for: reconstructing the schema, running the tenant invariant gate, the
  parity engine, and structural questions. That is how it found the 21 breaches.
- NOT VALID for: certifying canonical provenance, or producing the committed
  `supabase/schema.sql` / `schema.fingerprint.json` baseline. That baseline must
  still come from a CI `clean-migration-replay` artifact.

## Stage 11 — main is RED, and it is not a code defect

The `verify` job fails at step 29, `npm run security:audit-production`:

    > npm audit --omit=dev --audit-level=high
    npm warn audit 503 Service Unavailable - POST https://registry.npmjs.org/-/npm/v1/security/audits/quick
    npm error audit endpoint returned an error

It hung for about seven minutes and then failed. This is the npm registry being
unavailable, not a vulnerability. The gate is mandatory, so any registry hiccup
blocks every merge, and the failure text does not distinguish "found a high
severity advisory" from "could not reach the registry".

This is pre-existing on main and nothing to do with this branch.

### Stage 11 fix: the audit gate now separates "vulnerable" from "could not check"

`scripts/gridex-production-dependency-audit.cjs` replaces the bare
`npm audit --omit=dev --audit-level=high` behind `npm run security:audit-production`.

It still fails closed — an audit that did not run is not a passing audit — but
it retries the transient case with backoff, bounds each attempt (default 120s,
so it cannot hang for seven minutes), and says which of the two happened.

Verified, every path:

- registry reachable: attempt 1 actually timed out in this environment and
  attempt 2 succeeded, exit 0, `info=0 low=0 moderate=0 high=0 critical=0`.
- registry unreachable (npm pointed at a dead port): exit 1, message states
  plainly that this is not a vulnerability finding and the job should re-run,
  and carries npm's own stderr instead of an empty `{}`.
- high-severity advisories present (stubbed report through the real decision
  path): exit 1, lists the offending severities.
- only low/moderate at level `high`: exit 0.
- unknown audit level: exit 2.

Tunable through `GRIDEX_AUDIT_LEVEL`, `GRIDEX_AUDIT_ATTEMPTS`,
`GRIDEX_AUDIT_TIMEOUT_MS`. Default behaviour is unchanged from the old command.

## Stage 12 — pull request opened, CI running

PR: https://github.com/heke99/gridex-ops-platform/pull/307
(`claude/gridex-ops-production-hardening-lrknxa` -> `main`, opened after the
user explicitly approved it.)

No PR template exists in the repository, so the body follows the master plan's
own §29 impact-analysis shape: Changed, Directly affected, Indirectly affected,
Tenant impact, Data impact, Integration impact, Rollback, Verification.

This session is subscribed to PR activity and owns driving #307 to green.

Two caveats are stated in the PR body on purpose, so a reviewer is not misled:

1. No canonical schema baseline is committed; the CI verification step is
   guarded on the artifact existing and activates once a CI-captured baseline
   is committed.
2. The dockerless harness is not byte-equivalent to the Supabase stack for the
   thirteen fingerprinted tables. CI is authoritative; `EXPECTED_FINGERPRINT`
   is untouched.

Expect the three jobs: `verify`, `quality-release-gates`,
`clean-migration-replay`. The genuinely new risk is `clean-migration-replay`,
because the tenant gate, parity self-test and schema snapshot have never run
inside the real Supabase stack — only against the local PostgreSQL shadow.

## Stage 13 — CI ran, and it found what the local harness could not

Run 2451 on PR #307, head `ba0d323`:

- `verify`: **success** — including `security:audit-production`, which now
  completes in under a second instead of hanging seven minutes. The audit gate
  fix is proven in CI.
- `quality-release-gates`: **success**
- `clean-migration-replay`: **failure**, and instructively so.

Inside that job the good news came first: migration `20260904120000` applied
cleanly in the real Supabase stack (INSERT 0 3, eight ALTER TABLE, three ALTER
VIEW, three DROP POLICY, six REVOKE/GRANT pairs), and the pinned fingerprint
still verified as `c70fa2f...` WITH the migration included. So the migration
does not disturb canonical provenance.

Then `npm run tenant:invariants` failed with three F-16 breaches:

    gridex_default_customer_number_prefix(uuid)
    gridex_next_customer_number(uuid)
    gridex_db4b_archive_customer_registry_row(text,text,boolean,text)

still executable by `anon`, despite the migration revoking them.

### Root cause

`revoke execute ... from public` does not remove an explicit grant to `anon`.
Supabase's stack grants EXECUTE on newly created functions to the client roles
through DEFAULT PRIVILEGES, so those functions carry a real `anon` grant. In my
local harness the ACL was NULL — the plain PUBLIC default — so revoking PUBLIC
looked sufficient. Three of the six passed in CI only because their own
migrations already revoke explicitly.

The gate checks `has_function_privilege('anon', p.oid, 'EXECUTE')`, nothing else.

### Two fixes

1. The migration now revokes from `anon` as well as `public`, on all six, and
   the comment block says why PUBLIC alone is not enough. Checksum re-registered.
2. `gridex-supabase-compatible-bootstrap.sql` now sets
   `alter default privileges in schema public grant execute on functions to
   anon, authenticated, service_role`, so the harness reproduces this class of
   difference instead of hiding it.

Deliberately NOT replicated: default privileges on TABLES. A table's client
reachability is exactly what the F-6 checks measure, and inventing grants there
would manufacture findings rather than expose them.

This is the harness earning its limits being written down: it was right that
the migration applies and wrong about grants, and CI is what settled it.
