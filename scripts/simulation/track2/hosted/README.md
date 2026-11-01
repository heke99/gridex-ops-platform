# T2 disposable runtime preparation contract

**SOURCE_ONLY_NOT_ADMITTED; provisioned=false.** This package measures a host and
captures requirements. It does not provision, create ACTIVE assignments, verify
reservations, execute scenarios, or clean backends. Green source contracts are
component evidence, never runtime or TERM acceptance.

The Ubuntu24.04 workflow runs offline contracts only. It intentionally has no
workflow_dispatch, push, schedule, write permissions, secret inputs or scenario
step. Operational prepare → qualify → scenario → always-cleanup remains blocked
until all gates below have reviewed implementations. Do not dispatch another
workflow as a substitute for these missing gates.

## Safe local commands

```sh
python3 -B scripts/simulation/track2/hosted/qualification.test.py
bash scripts/simulation/track2/hosted/prepare.sh --observe-host
```

Observation exits 78 (HOLD), including on a large host. It selects non-secret
Docker info fields, records cgroup/physical RAM and CPU quota, and socket device /
inode. Unknown drivers fail; overlay2/overlayfs require 15 GiB and vfs 40 GiB free
at the **actual DockerRootDir filesystem**; effective RAM must be at least 8 GiB.
A local root path from a remote/namespaced daemon is not filesystem proof. This
observer deliberately leaves namespace qualification false and free bytes unknown.
Capacity checks accept synthetic input in component tests; they authenticate no
input and must never serve as admission.

## Required operational successor

1. Freeze exact current app commit/tree, harness commit/tree and workflow blob;
   bind source claims plus actual authenticated backend/producer receipt/ref
   readbacks. Source custody alone is insufficient. Use separate owned host,
   Docker daemon/backend and nine unique assigned ports. Different app ports do
   not isolate fixed DB/API ports. No actual allocation is implied here.
2. Bind current GEN/source epoch, ordered dependencies 964 → 972 → 998 → reviewed
   audit19 successor, execution budget, expiration, allowed operations, synthetic
   actors, UTC/market clock policy and exact retention/cleanup resources. P1 from
   1006 is closed with budget zero. Do not repeat it.
3. Install only reviewed Node22, SupabaseCLI2.101.0 with adjacent supabase-go,
   PostgreSQL17 matching clients, Python3.11+ and exact app lock dependencies;
   record actual versions. Keep proxy/CA trust; do not print environment or keys.
4. Verify actual daemon/socket namespace and DockerRootDir free space, inherited
   memory constraints, CPU quota, and fresh container/network/volume identities.
   Materialize private assignment0600/home0700 only after real qualification.
5. Preserve existing guarded up/run/down/common. Qualify controlled replay-copy
   patches against exact source bytes, restoration of source/index/migrations/
   seed/TOML, actual installed ordered migration ledger and DB/server identity.
   Existing up creates an **empty** applied-migrations.tsv: it is not a ledger.
   Build/replay commit text files alone do not attest actual execution/artifacts.
6. Bind actual build outputs, API/Auth/mail/counterpart endpoints and fresh private
   fixtures to that backend. Observe ordinary signup/signin, active company,
   role/license and contracts/history required by the selected TERM scenario.
   Reject SKIP_REPLAY/SKIP_BUILD, stale assignments and reused project resources.
7. Run prepare, scenario and unconditional cleanup on the same owned ephemeral
   host. Consume the authorized attempt budget atomically. Implement exact-ID
   backend/container/network/volume and descendant cleanup with partial-start
   reconciliation and retained private receipts. Existing down --processes-only
   excludes these resources; it cannot substantiate full teardown. Never prune,
   signal by name/port or touch foreign resources. This package's cleanup exits
   HOLD without mutations; it must not be used after creating resources.

Missing authentication, migration, build, cleanup or single-use budget proof is
HOLD, not a caller-authored boolean. These gaps require reviewed source before
operational workflow activation and fresh independent final reviews. Private
assignments, synthetic credentials, logs, allocation/custody journals and full
receipts stay outside Git and public comments; publish only minimal code status.
