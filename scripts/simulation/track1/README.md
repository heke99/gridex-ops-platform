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
Existing reports and legacy temporary output paths are refused before the
workload; publication uses an exclusive unpredictable temporary file and an
atomic no-overwrite link. Raw originals are never replaced. App cleanup also
verifies that the recorded process group is empty; a missing leader with live
children requires coordinator recovery and cannot produce a clean receipt.
Private environment values are parsed as data; they are never executed as shell
source. A failed startup without a complete stack receipt requires coordinator
recovery, rather than guessing which resources to stop.

For new packets, `workerId` and `model` are explicit CLI fields. Full source
SHAs are required when supplied; `--stack` copies observed build/tree/schema
identity and explicit `overlayRefs`. Historical packets remain unchanged.
`SOURCE_ONLY` and `COMPONENT` checks cannot create whole-scenario `PASS`;
eligible runtime PASS still requires the recorded independent reviewer,
commands and evidence and does not by itself certify a whole campaign.
# Hosted infrastructure smoke (prepared-v2)

This source extension adds one separately admitted startup producer. It awards
**zero campaign scenario PASS**. Its three `T1SMOKE.*` observations do not run
the 13 business scenarios, seed campaign tenants, send mail or prove physical
Storage recovery. The original world/28/1809.51/MAIN04 cohort and whole-flow
oracles remain required by their original acceptance gates.

The new workflow is deliberately unlaunchable until a separately reviewed
launch child pins `APP_COMMIT/APP_TREE` to the actual merged, GEN-qualified app
and `HARNESS_COMMIT/HARNESS_TREE` to the reviewed harness. No current source
receipt grants runtime or event authority. The only proposed trigger is one
same-repository `pull_request: opened` on head branch
`codex/t1-startup-smoke-native`, attempt 1, one 75-minute job. It has no push,
synchronize, dispatch or retry path. Publication also selects other existing
workflows; the coordinator must budget those before creating an event.

`scripts/simulation/runtime/assigned_backend.py` is the sole central owner of a
private runtime configuration overlay. It changes only `project_id` in a
Git-derived replay copy and a private CLI config. The app's tracked config is
never edited. The first producer uses the canonical replay's real
DB `54322`, API `54321`, and app `3101`; arbitrary backend ports are unsupported.
It precreates only the absent exact `supabase_network_<project>` bridge with
`com.docker.network.bridge.host_binding_ipv4=127.0.0.1`, then observes the actual
DB/API port bindings. Wildcard, extra IPv6 and foreign network bindings fail.
The existing daemon must have at least 15 GiB free with overlay2/overlayfs or
40 GiB with vfs, and 8 GiB effective memory. No daemon changes are made.

The coordinator supplies a private mode0600 JSON admission, before any service
mutation, using schema `track1-hosted-producer-admission-v1`. Required fields:

| Field | Required meaning |
| --- | --- |
| `workerId`, `exclusiveHost` | Exactly `codex-track1`, `true` |
| `admissionFile`, `simHome` | Canonical private file/home, outside all three checkouts |
| `appDir`, `appCommit`, `appTree` | Separate clean, full-SHA app checkout after real GEN gates |
| `harnessDir`, `harnessCommit`, `harnessTree` | Separate clean, reviewed harness checkout |
| `carrierDir`, `workflowCarrier`, `workflowTree`, `workflowBlob` | Actual clean carrier and exact workflow blob |
| `smokeSha256` | Actual reviewed `scenarios/smoke.test.ts` bytes |
| `projectId`, `ports` | `t1-<actual-run-id>-1`, `{db:54322,api:54321,app:3101}` |
| `expiresAtUtc`, `cleanupExpiresAtUtc` | Explicit UTC workload and later teardown deadlines |
| `event` | Exact `repository,name,action,branch,runId,job,jobId,attempt,actor`; PR opened, `startup-smoke`, attempt1 |
| `budget` | Exactly `{jobs:1,replays:1,builds:1,appStarts:1,smokes:1,retries:0}` |
| `tools` | Actual executable SHA256/version for `node,npm,supabase,supabase-go,psql,pg_dump,docker` |
| `requiredGenGates` | Coordinator-qualified actual receipt: `qualified:true,receiptSha256:<actual digest>` |
| `sourceClaims` | Each exact held source receipt, full `expectedNeutral` and `refs`, including session; together cover all nine source paths |
| `reservation` | Exact already-held runtime pair, as specified below |

The workflow prints public tool version/digest observations, then waits at most
400 seconds for a coordinator-created commit at
`refs/tags/agent-runtime-admissions/t1-<actual-run-id>-1`. That commit's JSON
message contains the admission. This input-delivery ref is **not** a runtime
reservation. The helper never creates, replaces or releases any remote ref.

`reservation` contains `refs:[<exact backend ref>,<exact producer ref>]`,
`receipt:<actual full commit SHA>` and `expectedNeutral`. Both refs must freshly
resolve to that same receipt. Its JSON message is exactly
`{base:<full SHA>,files:[],operation:<string>}`, with the base as its sole parent
and the base tree unchanged. Operation is exactly this ordered string:

```text
simulation-t1-startup-smoke-v1; resources-sha256=<R>; inputs-sha256=<I>; admission-core-sha256=<C>; appCommit=<A>; appTree=<AT>; harnessCommit=<H>; harnessTree=<HT>; workflowCarrier=<W>; workflowBlob=<WB>
```

`R` hashes the sorted exact refs joined with newlines, including a final newline.
`C` hashes the admission excluding only `reservation`. `I` hashes exactly
`event,appCommit,appTree,harnessCommit,harnessTree,workflowCarrier,workflowBlob`.
JSON hashes use sorted keys, compact separators and one final newline. No source
or session receipt, old native pair, matching arbitrary hash or planned receipt
can satisfy this operation. The coordinator provisions it after the real job
and its tool observations exist; no such reservation is supplied by this source.

Commands, with the explicit descriptor/assignment paths:

```bash
python3 "$H/scripts/simulation/runtime/assigned_backend.py" preflight --admission "$ADMISSION"
python3 "$H/scripts/simulation/runtime/assigned_backend.py" materialize-config --admission "$ADMISSION"
python3 "$H/scripts/simulation/runtime/assigned_backend.py" prepare --admission "$ADMISSION" --assignment-output "$SIM_HOME/assignment.json"
export TRACK1_ASSIGNMENT_FILE="$SIM_HOME/assignment.json"
bash "$H/scripts/simulation/track1/up.sh"
SIM_REPORT="$SIM_HOME/reports/startup-smoke.json" bash "$H/scripts/simulation/track1/run.sh" "$H/scripts/simulation/track1/scenarios/smoke.test.ts" startup-smoke
bash "$H/scripts/simulation/track1/down.sh"
```

The immutable admission precedes preparation. Only successful actual replay,
source byte/mode restoration, official status/DB/API/Storage observations and
a fresh complete dependency install/build seal `track1-prepared-runtime-v2`.
Only then is `track1-runtime-assignment-v2` exclusively created, binding that
prepared receipt's actual hash. Later app/stack receipts bind the assignment;
there is no hash cycle and no usable pending assignment. The prepared branch
precedes all legacy collision/replay/build/stop paths. It accepts only the exact
reviewed smoke file and `startup-smoke` label, never generic SKIP flags or
business scenarios. Legacy fresh mode remains separate.

Build/app/Vitest use a private empty tool home and an allowlisted environment;
ignored Next dotenv inputs are refused. The harness gets an explicit recorded
dependency symlink to the app's complete `npm ci` installation. No GitHub token
enters those children. The parent checks live custody before/after Vitest;
read-only child observations require that actual live parent's birth identity
and ancestry. Local HTTP observations use no proxies and refuse redirects.

App birth is sealed before readiness. Cleanup reuses the reviewed process-group
stopper and verifies an empty group. Backend cleanup preflights full recorded
container IDs, immutable volume/network identities, daemon identity and exact
inventories before deleting only those resources. Unknown resources are retained
with a nonzero, unqualified outcome. In particular, canonical CLI failure before
a genuine resource observation is sealed can leave unknown partial resources;
this source does not infer their ownership from names or labels and cannot
certify successful cleanup in that case. The disposable host must then retire.
Cleanup intents are single-use: an interrupted or failed cleanup is not retried
blindly. The canonical replay's literal `trap cleanup EXIT` alone is delegated;
its cleanup runs once for source restoration, with backend stop disabled.

The workflow's exit owner records the actual primary exit. Publication requires
all named actual stage receipts, complete three-case Vitest output, unchanged
source and successful cleanup. It exports only a constructed, credential/path
checked infrastructure summary, with `scenarios:{}` and
`new105ScenarioPassAttestations:0`. Missing, skipped, failed, unknown or unsafe
proof produces only a constructed `qualified:false` incident summary and a
nonzero publisher; uploading that summary cannot change the failed producer
step. It contains fixed phase labels, bounded exit codes and admitted source
SHAs, with no copied raw diagnostic fields. Raw logs/status/env remain private.

## Versionerad fasadapter: källa klar först, körning fortfarande HOLD

Den separata `phased-cohort`-jobben får bara väljas av en ny, samordnaradmitterad
`pull_request: opened` från `codex/t1-phased-cohort-native`, samma repo och försök 1.
Det ursprungliga `startup-smoke`-jobbet och dess tre infrastrukturfall behåller
sin egen gren, budget och städning. Inget dispatch, matrix, CI-omtag eller vanlig
källbranch ger verksamhetsmandat. `ROOT_TO_PIN` måste ersättas i en separat
slutgranskad leverans; app C, harness H och workflow-carrier W är skilda identiteter.

Fasläget kräver **`track1-hosted-phased-admission-v2`**, ett uttryckligt
`track1-sameC-phase-contract-v1`, **`track1-runtime-assignment-v3`** och
`track1-prepared-runtime-v3`. Verksamhetsbarnet kräver därefter
`track1-cohort-business-admission-v2`. V1/v2-infrastruktur eller fristående
cohort-v1 får aldrig utökas genom en miljöflagga eller generisk SKIP/reuse.
Samma observerade rena replay, build, app, backend, fulla kataloger,
migrationsledger och resurs-ID:n måste behållas genom hela kedjan.

Den fasta kedjan är `STARTUP_OBSERVED → MAIN03_RUNNING → BEFORE_RETRY →
RETRY_PERMITTED → MAIN03_TERMINAL → SEALED → MAIN04_RUNNING → MAIN04_TERMINAL`.
MAIN03 kör originalets fem steg i befintlig ordning. MAIN04 kör bara .01/.03;
.04 är fortfarande **HOLD_UNADMITTED**, utan approve/send/providerdispatch.
Fasföräldern väntar faktiskt in sina barn, kräver fullständiga rårapporter utan
hook/globalfel och lämnar inga godkända scenario-ID:n i fasresultatet.

`phase-start`, `phase-checkpoint --ordinal 0..4`, `phase-accept --ordinal 0..4`
och den enda avslutande `phase-finish` är fasta ingångar. Checkpoint 0 uppstår
först efter faktiska fulla runtime-/build-/process-/capture-observationer. Två
externa, från producenten skilda granskare granskar den faktiska artifacten.
Samordnaren levererar sedan oföränderliga, platta refs:
`agent-runtime-admissions/t1-R-1-phase-N` och
`agent-runtime-admissions/t1-R-1-review-N-0`/`...-review-N-1`.
Varje nästa input binder verklig artifact-ID/arkivdigest, checkpoint, föregående
input, C/H/W, körning/jobb/försök, exakta granskar-/sessionsidentiteter, en enda
förutbestämd nästa åtgärd och en absolut deadline. Saknad/nekad/lokal/förfalskad,
inaktuell, duplicerad eller tvetydig input ger HOLD. Föräldern läser om de
verkliga autentiserade refsen före effekt; en lokal APPROVE-fil räcker aldrig.
Föräldern kan materialisera exakt de redan autentiserade granskarpayloadernas
bytes men får inte skapa eller märka om ett granskningsbeslut.

Verksamhetsbarnet använder en privat Unix-socket, med kernelns PID/UID och
observerad födelse, session, härkomst, cwd, exe, boot, nonce och admission-bindning.
Det har ingen GitHub-/kontroll-/providercredential. Endast faktiska syntetiska
aktörssessioner och den uttryckligen versionsadmitterade isolerade backendens
lokala service-rollnyckel får finnas privat; nyckelns digest måste stämma med
den verkligt cachade SDK-klienten. Ingen credential får finnas i publika
checkpointar, fel eller artefakter.

Originalanropet får `X-Request-ID` och behåller 400 ms-stimulansen. Stabil graf,
timeout, waitpid eller frånvaro av SQL-aktivitet frigör aldrig återförsöket.
Den källbundna producenten måste faktiskt avge `billing_underlay_operation_v1`:
`started/pending → client_disconnected/pending/abortWhilePending=true →
terminal/fulfilled/200/thrown=false`, samma korrelation, attempt, modulboot och
verkligt ägd app-worker. Workern behöver inte vara lyssnarens PID. Redan avbruten
request, missad/duplicerad signal, not_entered, rejected, tekniskt fel eller
responsekonstruktionsfel förblir HOLD. Privat råcapture och processhärkomst måste
stämma; två verkliga BEFORE_RETRY-granskningar krävs innan det levande barnet
får göra sitt enda återförsök. Nya, separata granskningar av **redan existerande**
kandidat, terminal och rapporter krävs före den skrivskyddade förseglingen.

Producentens granskade källkontrakt, faktisk startup-readiness och originalets
senare native-resolution är tre skilda steg. Inget framtida event-/rapporthash
kan förhandsberäknas. Verklig UTC/monoton tid, ändliga HOLD-budgetar, konfigurerad
Auth-livslängd och faktiska sessionsmarginaler kontrolleras; ingen klockflytt,
TTL-förlängning eller tyst tokenrefresh införs. Okänd städning eller förlorad
förälder/barnprocess är okvalificerad, inte ett påstått rent avslut.

**Nuvarande startgräns:** originalunderlaget 1809.51, faktisk slutlig C med
kvalificerad observation, runtimeparet/producenten, tids-/Auth-budget och verkliga
nativefakta är ännu inte körkvalificerade. Dessa käll- och komponentkontroller
startar ingen stack och ger **0 nya 105-PASS**. Historiska 26 PASS påverkas inte.

`businessBudgetSeconds` mäter verklig monoton aktiv tid från MAIN03-start genom
MAIN04; enbart faktiskt uppmätt väntan på de fem explicita granskningsgrindarna
räknas som separat HOLD-tid. En senare absolut deadline utökar aldrig budgeten.
Varje konsumerad input får en append-only observation med verklig UTC/monoton
tid, föräldrafödelse och inputhash. Nästa checkpoint visar den redan accepterade
inputens hash och observation, så samordnaren behöver inte gissa en framtida hash.
Framtida effektstarter och det enda återförsöket kräver fortfarande en levande
inputdeadline. Slutgranskningen återautentiserar historiska refs/payloads vid den
verkligt observerade acceptanstiden; den kräver inte att gamla starttillstånd
fortfarande är levande. Städning använder sin separata `cleanupExpiresAtUtc`,
behåller käll-/resurs-/custody-kontroller och kan utföras efter verksamhetsdeadline.
Ett observerat rent avslut redovisas separat även när verksamhetskedjan förblir
okvalificerad. Missad processfödelse, kvarvarande barn eller okända resurser ger
fortsatt okänd städning, aldrig ett påstått rent avslut.
