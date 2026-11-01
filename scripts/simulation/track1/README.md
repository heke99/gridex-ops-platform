# Track 1 simulation harness (campaign 20261029-3f1a8ab1)

Separate per-track harness for MAIN03.01–.05, MAIN04.01/.03/.04 and
SITE01.01–.05. The historical oracle base is
`1c0c088cb4ed66d0dd8b3e34c9606019342a1a56`. New runs record the explicitly
assigned, observed application commit/tree, build, replay and overlays;
they do not inherit equivalence to that old source. Nothing here changes app code.
Track-local by design: other tracks copy it, they do not share it.

| Script | Does |
|---|---|
| `up.sh` | Requires coordinator runtime admission before Docker or any write. Refuses with `BLOCKED: stacken upptagen` if any `supabase_db_*` container runs. Performs a fresh clean replay and build; `SKIP_REPLAY=1` and `SKIP_BUILD=1` are refused until reuse is separately qualified. Starts an owned process session on the assigned loopback app port. Writes observed `stack.json`, private `app.env`, source/build/partial-schema markers and build ID. |
| `down.sh` | Requires the same assigned project, exact DB container and PostgreSQL system identifier. Takes `run.lock`; stops only the recorded app PID/session after checking start time and cwd, then the assigned Supabase project. Checks that project's containers/volumes only and writes `cleanup.json`. No name/port-based process killing or global volume cleanup. |
| `run.sh <scenario.test.ts> [label]` | Needs `SIM_REPORT=<path>`. Takes `SIM_HOME/run.lock` atomically (PID + start time), removed on exit; an existing lock (even stale) makes it refuse, only sim-runner removes it. Runs vitest; writes `SIM_REPORT` (per step: scenarioId from the leading ID of the test name, status passed/failed/skipped; per-ID rollup; vitest totals) plus run-dir `report.json` (raw), `run.log` (ends in `exit <code>`), `run-meta.json`. |

`up.sh` also holds `run.lock` while it runs.

Requirements: Docker daemon, Supabase CLI 2.101.0 **with** its `supabase-go`
companion binary, `psql`, `python3`, Node 22 and `npm ci` in the run directory
(`TRACK1_APP_DIR`, an explicit clean checkout of `TRACK1_APP_COMMIT`, a full SHA).
Images are pulled from Docker Hub (`INTERNAL_IMAGE_REGISTRY=docker.io`) because
public.ecr.aws answered "Data limit exceeded" here; digests go into `stack.json`.
The harness checkout needs `node_modules` symlinked to the run directory's.

`SIM_HOME` (explicit canonical path owned by the current uid with mode 0700,
outside both checkouts; assigned `t1-.../` environment, symlink `current`) holds raw logs and the private env
file. Never commit anything from it; only safe packet files (`status.json`,
`FINDINGS.md`) go to `quality/simulation-campaign/20261029-3f1a8ab1/runs/`.

`fixtures/` and `scenarios/` hold the synthetic fixture and scenario files.
Every step that replaces a normal entry point is listed in
`fixtures/substitutions.ts` and written to the run's `substitutions.json`.

Before any real `up`, `run` or `down`, the coordinator must qualify and reserve
the backend/producer and provide a private mode-0600 `TRACK1_ASSIGNMENT_FILE`.
Creating this file does not acquire a lease. No runtime was assigned or started
by the source takeover or controlled CLI tests. The assignment has this shape
(values are illustrative, not a usable allocation):

```json
{
  "schema": "track1-runtime-assignment-v1",
  "workerId": "codex-track1",
  "environmentId": "t1-ASSIGNED",
  "appDir": "/absolute/assigned/app",
  "appCommit": "FULL_40_CHARACTER_ASSIGNED_SOURCE_SHA",
  "simHome": "/absolute/private/assigned-home",
  "appPort": 3101,
  "dbPort": 54322,
  "apiPort": 54321,
  "projectId": "MATCHES_ASSIGNED_APP_CONFIG",
  "backendReservation": "COORDINATOR_VERIFIED_CURRENT_RESERVATION",
  "exclusiveHost": true,
  "allowedActions": ["up", "run", "down"],
  "expiresAtUtc": "ASSIGNED_FUTURE_UTC_TIME",
  "overlayRefs": []
}
```

Export `TRACK1_APP_DIR`, `TRACK1_APP_COMMIT`, `SIM_HOME`, `TRACK1_DB_URL`,
`TRACK1_APP_PORT` and `TRACK1_ASSIGNMENT_FILE` explicitly. The DB URL must name
`127.0.0.1:<assigned-db-port>/postgres` without query/fragment overrides.
The preserved replay script itself hardcodes 54322/54321; fresh startup therefore
requires those ports on a coordinator-assigned exclusive host. Worktrees alone
provide no backend isolation. Do not run the six stacks concurrently here.

`run.sh` admits the stack before locking or invoking Vitest. It compares the
clean app SHA/tree, replay/build source and actual build ID, exact DB container
and system identifier, current migration ledger, declared overlays and actual
partial schema fingerprint against the recorded assignment/stack. The partial
fingerprint remains partial; the source `schema.sql` hash is recorded separately.
Post-replay migrations and reused builds/replays need new qualification.
`SIM_REPORT` must be an absolute canonical private path under `SIM_HOME`.
Private environment values are parsed as data; they are never executed as shell
source. A failed startup without a complete stack receipt requires coordinator
recovery, rather than guessing which resources to stop.

For new packets, `workerId` and `model` are explicit CLI fields. Full source
SHAs are required when supplied; `--stack` copies observed build/tree/schema
identity and explicit `overlayRefs`. Historical packets remain unchanged.
`SOURCE_ONLY` and `COMPONENT` checks cannot create whole-scenario `PASS`;
eligible runtime PASS still requires the recorded independent reviewer,
commands and evidence and does not by itself certify a whole campaign.
