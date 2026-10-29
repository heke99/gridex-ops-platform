# Track 1 simulation harness (campaign 20261029-3f1a8ab1)

Separate per-track harness for MAIN03.01–.05, MAIN04.01/.03/.04 and
SITE01.01–.05. It runs the unchanged campaign base
`1c0c088cb4ed66d0dd8b3e34c9606019342a1a56`; nothing here changes app code.
Track-local by design: other tracks copy it, they do not share it.

| Script | Does |
|---|---|
| `up.sh` | Refuses with `BLOCKED: stacken upptagen` if any `supabase_db_*` container runs (unless `SKIP_REPLAY=1`). Otherwise clean replay (sourced in a subshell, stack kept), builds (`SKIP_BUILD=1` reuses) and starts the app on 127.0.0.1:${TRACK1_APP_PORT:-3101}. `SKIP_REPLAY=1` reuses the running stack and only restarts the app. Writes `stack.json`, private `app.env`, and top-level markers in `SIM_HOME` after each successful step: `replay-commit`, `replay-at`, `applied-migrations.tsv` (empty), `fingerprint` (new replay only, taken from the replay log), `db-url`, `built-commit`. |
| `down.sh` | Takes `run.lock`, stops app and stack (containers and volumes), verifies nothing remains, writes `cleanup.json`, removes the markers. |
| `run.sh <scenario.test.ts> [label]` | Needs `SIM_REPORT=<path>`. Takes `SIM_HOME/run.lock` atomically (PID + start time), removed on exit; an existing lock (even stale) makes it refuse, only sim-runner removes it. Runs vitest; writes `SIM_REPORT` (per step: scenarioId from the leading ID of the test name, status passed/failed/skipped; per-ID rollup; vitest totals) plus run-dir `report.json` (raw), `run.log` (ends in `exit <code>`), `run-meta.json`. |

`up.sh` also holds `run.lock` while it runs.

Requirements: Docker daemon, Supabase CLI 2.101.0 **with** its `supabase-go`
companion binary, `psql`, `python3`, Node 22 and `npm ci` in the run directory
(`TRACK1_APP_DIR`, default `/root/sim-run/app`, a detached checkout of the base).
Images are pulled from Docker Hub (`INTERNAL_IMAGE_REGISTRY=docker.io`) because
public.ecr.aws answered "Data limit exceeded" here; digests go into `stack.json`.
The harness checkout needs `node_modules` symlinked to the run directory's.

`SIM_HOME` (default `$HOME/sim-home/track1`; per-environment dir `t1-<ts>-<id>/`, symlink `current`) holds raw logs and the private env
file. Never commit anything from it; only safe packet files (`status.json`,
`FINDINGS.md`) go to `quality/simulation-campaign/20261029-3f1a8ab1/runs/`.

`fixtures/` and `scenarios/` hold the synthetic fixture and scenario files.
Every step that replaces a normal entry point is listed in
`fixtures/substitutions.ts` and written to the run's `substitutions.json`.
