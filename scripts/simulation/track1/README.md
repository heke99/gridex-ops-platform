# Track 1 simulation harness (campaign 20261029-3f1a8ab1)

Separate per-track harness for MAIN03.01–.05, MAIN04.01/.03/.04 and
SITE01.01–.05. It runs the unchanged campaign base
`1c0c088cb4ed66d0dd8b3e34c9606019342a1a56`; nothing here changes app code.
Track-local by design: other tracks copy it, they do not share it.

| Script | Does |
|---|---|
| `up.sh` | Clean replay of the base migrations into a fresh local Supabase (`scripts/gridex-aud-003-clean-replay.sh`, sourced as in CI), checks the verified fingerprint, builds and starts the app on 127.0.0.1:3101, writes `stack.json` (public-safe identity) and a private env file under `SIM_HOME`. Refuses if a stack already exists. |
| `down.sh` | Stops the app and the stack, verifies no containers, volumes or app processes remain, writes `cleanup.json`. Refuses while a run holds the lock. |
| `run.sh <scenario.test.ts> [label]` | Runs one whole scenario file with vitest against the active stack, one run at a time (flock). Writes `report.json`, `run.log` (ending in `exit <code>`) and the scenario's own artefacts into a new run directory. |

Requirements: Docker daemon, Supabase CLI 2.101.0 **with** its `supabase-go`
companion binary, `psql`, `python3`, Node 22 and `npm ci` in the run directory
(`TRACK1_APP_DIR`, default `/root/sim-run/app`, a detached checkout of the base).
Images are pulled from Docker Hub (`INTERNAL_IMAGE_REGISTRY=docker.io`) because
public.ecr.aws answered "Data limit exceeded" here; digests go into `stack.json`.
The harness checkout needs `node_modules` symlinked to the run directory's.

`SIM_HOME` (default `/root/sim-home/track1`) holds raw logs and the private env
file. Never commit anything from it; only safe packet files (`status.json`,
`FINDINGS.md`) go to `quality/simulation-campaign/20261029-3f1a8ab1/runs/`.

`fixtures/` and `scenarios/` hold the synthetic fixture and scenario files.
Every step that replaces a normal entry point is listed in
`fixtures/substitutions.ts` and written to the run's `substitutions.json`.
