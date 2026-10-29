# Track 1 findings — run t1r1, worker claude-track1

Campaign 20261029-3f1a8ab1. Session `session_01UHTg8PHokrSpKDSXpT5Py`.
App: campaign base `1c0c088cb4ed66d0dd8b3e34c9606019342a1a56`, unchanged.
Harness overlay: `claude/sim-20261029-track1` (`scripts/simulation/track1/`).
Raw logs, env files and run directories stay private under `SIM_HOME`; this
file cites them by path and SHA256 only.

## Environment

| | |
|---|---|
| Container | own cloud container, 4 vCPU, 15 GiB RAM, no swap |
| Docker | 29.9.2, own dockerd |
| Supabase CLI | 2.101.0 (`supabase` shim + `supabase-go`), release tarball sha256 `285877ef…dbf9` |
| Postgres | `supabase/postgres:17.6.1.155` from Docker Hub, digest `sha256:3866d94d…710b` |
| Node | v22.22.0 |
| Stack | `t1-20261029T201808Z-6576e10a`, databaseIdentity `…/pg-sysid-7702186716638527527`, ports 54321/54322, app 3101 |
| Schema | clean replay of base, fingerprint `5168f69b67b1e45168ef327ecf92efec6dc7bcd9dc2cf66f48f4ea96527c782c` (partial identity: selected tables), 0 post-replay migrations |
| Oracle source | `quality/simulation-register/oracles/all-systems-scenarios.safe.json` @ PR930 `d6edd3a3`, sha256 `96518c18…9df3` verified |

## Findings

### 20261029-3f1a8ab1/claude-track1/001 — environment: CLI shim needs `supabase-go`
- Date 2026-10-29, by T1. IDs: all (stack start). Category: miljö.
- Observed: first `up.sh` (env `t1-20261029T200607Z-afcf91e1`) failed in clean replay: "Could not find the `supabase-go` binary". Only the shim had been installed.
- Fix: install both binaries from the verified release tarball; `up.sh` now checks for `supabase-go` and CLI version 2.101.0. State: verifierad rättning (later starts passed).

### 20261029-3f1a8ab1/claude-track1/002 — environment: public.ecr.aws "Data limit exceeded"
- IDs: all (stack start). Category: miljö.
- Observed: second `up.sh` (env `t1-20261029T200705Z-cb3a83e3`): every image pull from `public.ecr.aws` failed with "error from registry: Data limit exceeded".
- Fix: `INTERNAL_IMAGE_REGISTRY=docker.io` (same tags on Docker Hub); image digests recorded in `stack.json`. Replacement step: images come from Docker Hub, not the CLI's default registry; tag-identical, digest-recorded, not cross-checked against ECR digests.
- State: verifierad rättning (third and fourth replays passed). Reported to the coordinator for other tracks.

### 20261029-3f1a8ab1/claude-track1/003 — harness: `next build` OOM in type-check worker
- IDs: all (app build). Category: testharness.
- Observed: third `up.sh` (env `t1-20261029T200827Z-7e2c4ea1`): replay PASS in 220 s, then `next build` failed after ~230 s with "JavaScript heap out of memory" / "Failed to type check". The repo's build script raises the heap only for the main process.
- Fix: `NODE_OPTIONS=--max-old-space-size=6144` for the build. Fourth `up.sh` built in 303 s. Stack of attempt 3 removed by `down.sh` (cleanup.json clean: 0 containers, 0 volumes, 0 app processes).
- Not a product claim: the production build environment is not observed here.

### 20261029-3f1a8ab1/claude-track1/004 — harness (under diagnosis): Z04a supply period without contract
- IDs: MAIN03.01–.05 (fixture). Category: ännu obekräftad (fixture vs product).
- Command: `run.sh scenarios/main03.test.ts main03` → run `20261029T202904Z-main03`, exit 1, 22.2 s wall; `report.json` sha256 `8ea9ec12…7f22`, `run.log` sha256 `e052c9fd…b056`.
- Observed: fixture aborted before any scenario step (5/5 tests skipped): `fixture_supply_period_contract_unset:null`. After PRODAT Z04 (assigned supply, profile `PRODAT:Z04:A:26.A:r3`) and `processInboundEdielMessage`, exactly one `customer_supply_periods` row exists but `contract_id` is null; the underlay store requires the contract link.
- Fixture timings: tenant + contract + regulated ground 6 991 ms; assigned-supply activation 3 659 ms (n=1, warm app, cold fixture).
- Hypothesis (not established): Z04a assigned supply is the wrong process for a customer with a signed contract. Under diagnosis by sim-fixer.
- No scenario ID is affected in outcome yet; no business step reached the underlay.

## Attempt log

| Time (UTC) | Step | Result |
|---|---|---|
| 20:06 | up.sh #1 | FAIL, finding 001 |
| 20:07 | up.sh #2 | FAIL, finding 002 |
| 20:08–20:16 | up.sh #3 | replay PASS 220 s, build FAIL, finding 003; down.sh clean |
| 20:18–20:26 | up.sh #4 | PASS: replay 183 s, build 303 s, app ready |
| 20:29 | run main03 #1 | exit 1 in fixture, finding 004 |
