# T3 preparation and same-host runner contract

This is source for a producer, not an allocated backend or a native result.
The current source task does not start a stack. Preserve all 17 EDIEL scenarios,
the original oracle, historical scoped PASS, and reviewed retry/source/outbox fixes.

`up.sh` consumes prepared resources. It does not install dependencies, provision
Supabase, replay SQL, build Next, acquire reservations or download GreenMail.
The T3 runtime producer owns those prerequisites; T4's single service owns shared
GEN and serial integration. Never substitute an old GEN job for a running backend.

## Commands

On one separately allocated disposable qualified Linux runner:

```sh
python3 scripts/simulation/track3/prepare.py check --plan /private/t3/plan.json
python3 scripts/simulation/track3/prepare.py execute --plan /private/t3/plan.json
```

`check` validates inputs and observes identities/capacity read-only. It does not
write an ACTIVE receipt or acquire authority. `execute` exclusively creates a
private single-use intent, then performs backend → canonical replay → real Next
build → receipt sealing → existing up → all scenario files → down → backend
cleanup. Prepare, scenarios and cleanup must use the same host and Docker daemon.
Do not dispatch a second job to consume resources from an ended job.

There is no default adapter, project, allocation, image tag or workflow dispatch.
A missing adapter/receipt/credential/source binding is a nonzero stop, not an
instruction to improvise a stack. Supply a separately reviewed source-pinned
producer profile before executing. This packet does not assert such a profile is
already implemented, provisioned or qualified.

## Private plan `track3-runner-plan-v1`

All paths are canonical. The plan and all allocation journals stay outside Git,
owned by the runner UID, mode0600; `simHome` is fresh mode0700 outside both app
and harness checkouts. A fresh directory is required for each new input epoch.
The designated producer verifies actual source, producer and backend custody
under the existing reservation protocol before issuing the plan. Text fields
and JSON do not themselves acquire a lease.

Required fields:

| Fields | Required binding |
| --- | --- |
| `schema`, `workerId` | `track3-runner-plan-v1`, `codex-track3` |
| `producerReservation`, `backendReservation`, `inputEpoch`, `model` | Explicit verified producer/backend identities and input epoch, not a historical slot name |
| `reservationRefs` | At least the actual producer and backend reservation refs, each `{ref,sha}`; exact live `refs/tags/agent-claims/...` targets are read back |
| `exclusiveHost`, `attemptBudget`, `expiresAtUtc` | `true`, integer1, future UTC expiry; existing intent forbids retry |
| `allowedActions` | Exactly `backend,replay,build,up,run,down,cleanup` |
| `timeouts` | Integer seconds1–7200 for every allowed action |
| `appDir`, `appCommit`, `appTree` | Actual clean committed app, full Git identities, locked dependencies already installed |
| `dependencyLockSha256`, `nodeModulesLockSha256` | Actual qualified package-lock.json and node_modules/.package-lock.json bytes; installed Next must match the root lock |
| `workflow` | `{path,sha256}` of the actual reviewed tracked harness `.github/workflows/...` producer workflow; its commit/tree are the harness source |
| `harnessCommit`, `harnessTree`, `overlayRefs` | Clean reviewed harness and ordered full overlay commit IDs already in app ancestry |
| `simHome`, `nodeBin` | Fresh private output and actual canonical Node22 executable |
| `environmentId`, `projectId` | `t3-...`; unique nondefault Supabase project |
| `ports` | Seven distinct assigned integer ports: app/api/db/smtp/imapTls/imapPlain/control |
| `greenmailImage` | Already loaded `greenmail/standalone@sha256:<64hex>` |
| `adapters` | `backend`, `replay`, `cleanup`, each `{path,sha256}`; existing tracked reviewed Python source relative to app checkout |

Adapter code must be part of the clean app tree/explicit reviewed configuration
overlay. No arbitrary shell strings, downloaded programs, dirty config rewrite,
global cleanup, retry or reuse of another track's backend. The existing consumer
expects `supabase/config.toml` to contain the assigned nondefault project/ports.
This requires a separately qualified **committed config overlay**; changing it
in place and pretending the app is clean is rejected.

The producer must also bind its runner/workflow source and exact source-custody
receipt in its private allocation journal. Current Git refs alone do not attest
authority, isolation, expiry or producer ownership; review those inputs before
issuing a plan. Producer budget/epoch must be separately reserved, not borrowed
from a closed GEN capture. This runner neither acquires nor releases claims.

## Adapter ABI and genuine outputs

The runner calls `python3 <tracked-adapter> <backend|replay|cleanup> <plan-path>`
without a shell and with only an explicit minimal environment. The adapter reads
the private plan and `simHome/env/track3.json`; credentials must never enter
argv/public output. Logs are private. Every phase runs at most once.

Before fixture work, provide existing private CA/server certificate/key, local
SMTP password file and the whitelisted `env/track3.json` documented in README.
Both cron secrets must exist; the full E01 cohort is28. No TLS-disable variables,
provider credentials or invented actors. Runtime helpers perform actual fixture
actor checks and bind resulting process identity. The runner uses Node22 and
records the actual host; preparation requires Python3.11+, PostgreSQL17 client,
Supabase CLI2.101.0, pinned project dependencies, Docker and existing mail image.

`backend` creates only the allocated disposable resources and writes
`producer-backend.json`, mode0600:

- `planSha256`, `appCommit`, `appTree` bind exact input bytes/source.
- `backendAssignment` is the existing version1 T3 receipt: environment/project,
  DB container full ID, loopback host/assigned DB port, database `postgres`,
  actual PostgreSQL system identifier.
- `apiContainerId`, `storageContainerId` are observed full IDs. Preserve complete
  owned container/network/volume birth and cleanup records privately.

`replay` writes `producer-replay.json` and the genuine `producer-replay.log`:

- `schema:track3-canonical-replay-v1`, `kind:canonical_supabase_cli`, exact
  `planSha256`, `appCommit`, `appTree`, `replayCommit` equal the app source.
- `officialLedgerVerified:true`, integer `postReplayAppliedMigrations:0`, and
  `logSha256` of the actual private replay log.
- The adapter must retain or restore the **same owned replayed backend** through
  scenario cleanup, preserve canonical provenance, and restore the clean app
  tree. The runner independently compares the official ledger, partial schema
  fingerprint, then the existing consumer checks PostgreSQL17/system ID,
  containers/ports, build, schema and environment immediately before fixture.

The canonical clean replay script stops its stack in EXIT and uses DB port54322.
It can be sourced and consumed in the **same shell**, as the existing
`.github/workflows/ediel-db05-native.yml` demonstrates. A successful source returns
while its original EXIT trap remains installed; no shared replay edit, stop shim
or trap replacement is needed. Its external-DB mode still explicitly lacks
official ledger provenance and is not a substitute.

Replay temporarily replaces its own migration files and restores them only in
EXIT cleanup. Therefore the replay checkout must be separate from the clean app
and harness checkouts, with the same original app commit/tree. Do not weaken
clean-source checks or restore/reset a foreign checkout to make them pass.

## Same-shell source supervisor

`same-shell.py` extends the actual `prepare.Packet` input checks. The additional
private plan fields are `replayDir`, `replayScriptSha256`, `consumer:{path,sha256}`
and `sameShellTimeoutSeconds`. Replay must use the exact tracked canonical script;
the consumer is an explicit tracked reviewed Python file in the clean harness.
There is no default consumer, dispatch, producer or backend allocation.

```sh
python3 scripts/simulation/track3/same-shell.py check --plan /private/t3/plan.json
python3 scripts/simulation/track3/same-shell.py execute --plan /private/t3/plan.json
```

The supervisor sources replay unconditionally under `errexit`, then invokes the
consumer in that same shell. It clears supervisor positional arguments before
sourcing and reserves only `T3_SS_` variables; canonical variables/functions and
EXIT cleanup remain untouched. The explicit local Docker selector is preserved.
Timeouts and signals affect only the supervisor's newly created process group.
The execution deadline is capped by the plan expiry immediately before spawn.
The first cancellation starts a fixed shutdown grace period; repeated signals
cannot extend it. Forced termination may prevent canonical EXIT cleanup.
Private boundary events distinguish replay entry/return and consumer entry/return;
raw canonical output remains private. No failed or ambiguous attempt is retried.

Immediately before source, the pinned local daemon must contain no containers or
volumes. The supervisor records its network IDs and independently checks after
shell termination that containers/volumes are absent and those IDs are unchanged.
A dirty initial inventory, observation failure or terminal discrepancy stops or
holds the attempt. `resultDockerRestored` records this inventory comparison only;
it does not prove process cleanup, resource birth ownership or replay provenance.

The consumer owns real build/scenario/app-mail cleanup, backend observations and
its independent primary-result/resource receipts. Calling standalone
`prepare.py execute` as the consumer is rejected: it has its own producer lock
and backend lifecycle. A dedicated source-reviewed consumer must bind the genuine
canonical backend and stop app/mail before returning to canonical EXIT cleanup.
An allocated profile, that consumer, its actual resource evidence and private
original inputs are still prerequisites; this supervisor alone is not a completed
or provisioned runtime producer.

The original EXIT trap can affect shell status, so the supervisor does not invent
a separately observed primary exit code or certify cleanup from shell exit0.
It records shell/boundary/signal/timeout evidence separately and explicitly leaves
cleanup acceptance unverified. Genuine terminal container/network/volume/process
observations remain mandatory before runtime acceptance. A timeout/forced kill or
ambiguous cleanup stays HOLD for the assigned producer's bounded recovery.

The DB05 producer identity, claims and old workflow branch are not borrowed by this
T3 wrapper. The pattern is reused as source evidence only. No backend, event
budget, GEN capture or whole-scenario PASS follows from these source checks.

The runner itself invokes the project's actual Next build with6144MiB heap and
`--webpack`, from preinstalled locked dependencies and the checked private build
environment. A pre-existing BUILD_ID is refused. It emits new legacy backend,
prepared and runtime assignments only after actual phase completion/observation.
`preparation-run.json` binds the phase history, replay receipt, plan and host;
the existing admission checks its hash and fresh host capacity before up/run.
No post-replay SQL migrations are applied by this runner.

## Capacity, failure and cleanup

Require effective physical/cgroup RAM≥8GiB; observe CPU count/quota. Inspect the
actual local Unix Docker socket, daemon ID, driver and DockerRootDir filesystem:
free space≥40GiB for vfs, ≥15GiB for overlay2/overlayfs. Unknown driver or remote
daemon stops. A host filesystem being overlay is not evidence of Docker's driver.

Same boot/daemon/socket device+inode/root/driver are checked at each phase.
Cleanup still runs after expiry or capacity loss, but never against a different
daemon. No default broad stop, purge, resource discovery or claim release.

The backend cleanup adapter independently reconciles only its exact recorded
resources, including partial/unknown prepare attempts; it must preserve foreign
resources and stop on ambiguity. It writes private `producer-cleanup.json` with
exact `planSha256`, `clean:true`, `unknownResources:[]` only after actual disposal.
The runner separately preserves the original failure and cleanup outcome.

`down.sh` only owns app/mail. If up failed before its exact cleanup assignment
existed, or down cannot verify all targets, backend cleanup is **not** attempted:
result `HOLD_UNKNOWN_APP_MAIL` requires the designated producer's bounded recovery
or disposal of its exclusively assigned disposable host. No synthetic cleanup
assignment is created from container names/pending PIDs. Preserve those originals.

## Evidence and remaining gates

Runner success requires all scenario processes to exit0, no harnessError, positive
Vitest counts, no skipped/todo/failed steps, all17 EDIEL IDs, the exact assignment
hash and intact private evidence manifests. Missing JSON cannot become exit0.
Source/component tests and a completed runner still require independent business
review; they do not themselves add scenario PASS or claim production readiness.

Keep E02's injected-MIME/source/ACK/outbox receipts and E03's explicit fixture
bindings at each worker admission. Initial active outbox must be empty before
fixture; tenancy or an inventory query never grants ownership of a queue row.
Do not broaden global drain authority or replay an uncertain submission. The
E01 intake/drain path still needs its own complete ordinary-flow applicability
review before a producer treats this full suite as natively qualified.

The EDIEL03.03 source path explicitly requests physical reception: one MIME
APPEND followed by one ordinary HTTP intake for the private fixture's assigned
mailbox. Immutable returned email/source IDs, independently extracted MIME and
payload hashes, and the causal CONTRL/outbox receipt must agree before transport.
An ambiguous intake or dispatch remains held; another prefix is not retry
authority. The second dispatch is solely the original known-uncertain no-resend
probe. Both drop-after-DATA and hang cases retain their complete physical-copy
and direct-resend assertions.

The ordinary intake also invokes global inbound/customer job workers and overdue
monitoring. Its qualified producer must retain an exclusive quiescent phase;
mailbox selection alone does not restrict those workers. Missing prerequisites
or foreign pending work must stop the pilot. This physical path is scoped to
EDIEL03.03; other E03 fixtures retain their existing explicit substitute paths
and have no new native qualification from this change. The capacity, producer,
consumer/profile and genuine-input gates above still apply.

The producer needs: a frozen integrated app plus config overlay; reviewed
backend/canonical-replay/cleanup adapters; real reserved resources; original
cohort/MIME/actor applicability; complete private plan and mail inputs. This
source packet supplies the executable consumer/orchestrator and rejection checks,
not those currently unallocated resources or adapter authority.

Offline component verification:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 scripts/simulation/track3/prepare.test.py
```
