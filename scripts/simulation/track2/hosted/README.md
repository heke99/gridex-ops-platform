# T2 dedicated disposable TERM runtime

Source implementation awaiting independent final reviews. **provisioned=false**:
no environment, backend/producer allocation, integrated app/GEN source, signed
ACTIVE assignment or native acceptance is established by committing this code.
The public key in profile.requirements.json belongs to T2; its private Ed25519
key is retained outside Git by the T2 owner. No external signer or new generic
user approval is required. Never put that key in Actions secrets or logs.

## Two-stage invocation and private admission transport

T2 performs the following under its standing mandate only after actual current
app/harness/workflow/GEN source qualification, authenticated backend/producer
custody, execution budget and two independent final reviews:

1. Provision the T2-owned GitHub environment `t2-qualified-disposable`, with a
   **10-minute wait timer and no required reviewers**. Use the official REST PUT
   `repos/heke99/gridex-ops-platform/environments/t2-qualified-disposable` with a
   private JSON body containing `{"wait_timer":10,"reviewers":[],
   "deployment_branch_policy":null}`. Read it back with GET; verify the only
   protection rule is `type=wait_timer, wait_timer=10`, with no required-reviewer
   or custom-app rule. This environment/timer is not assumed to exist already;
   reconcile any existing foreign allocation before changing it.
2. Dispatch the reviewed workflow once. Its allocation job exposes only actual
   run ID and source head, explicitly without claiming a backend. Observe that
   exact run and the `term` job waiting on the verified environment timer.
3. During that timer, T2 binds actual run ID/attempt1, full source vector,
   genuine GEN/input epoch and actual separately acquired backend/producer
   claims into a private assignment. Sign its exact bytes locally:

   ```sh
   openssl pkeyutl -sign -rawin -inkey <private-owner-dir>/admission.pem \
     -in <private-owner-dir>/admission.json -out <private-owner-dir>/admission.json.sig
   base64 -w0 <private-owner-dir>/admission.json | \
     gh secret set T2_ADMISSION_B64 --env t2-qualified-disposable
   base64 -w0 <private-owner-dir>/admission.json.sig | \
     gh secret set T2_ADMISSION_SIGNATURE_B64 --env t2-qualified-disposable
   ```

   Both files are owner0600 outside Git. The assignment's base64 representation
   must fit GitHub's 48KB secret limit (raw JSON at most 36KiB). Group source
   refs sharing a receipt using the `refs` field instead of duplicating capsules.
   Check each secret update succeeded, without printing its body. Do not use
   repository secrets for this transport: those are read at workflow queue time.
4. GitHub reads environment secrets when the referencing job starts, after the
   wait timer. Stale/missing/missed-window signatures or a different run/head/
   attempt fail before any runtime resource start. Attempt2 is forbidden; an
   expired/failed invocation requires actual reconciliation and a newly
   qualified source/input budget, never a blind rerun. Environment secret removal
   later requires matching this owner's exact run/admission custody; no blanket
   deletion of shared settings or another run's secrets.

Official applicability: this repository is public; wait timers are supported
for public repositories on current GitHub plans. References:
[secret read timing](https://docs.github.com/en/actions/reference/security/secrets),
[environment PUT and wait_timer](https://docs.github.com/en/rest/deployments/environments#create-or-update-an-environment),
[wait-timer semantics](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).
If actual account/environment policy cannot support this verified timer, STOP;
there is no fallback that drops the run binding or invents another secret store.

## Exact assignment contract

Retain the existing `gridex-simulation-runtime-assignment-v1` workerT2 format:
state ACTIVE only after real allocation, environmentId, future timezone-aware
expiresAt, allowedOperations up/run/down, canonical runDir/sourceCommit/simHome,
unique projectId and the nine explicit `SIM_*_PORT` keys documented in the
parent harness README. No default or example port is an allocation.

The signed operational envelope additionally requires:

- `sourceTree`; `sourceFiles` mapping actual repository paths to SHA256, including
  the workflow, lifecycle/runtime sources, lockfile, replay source/ledger and
  all three migration manifests. `genSource={commit,files}` binds actual adopted
  GEN source: commit must be an ancestor of the app; every GEN file/hash must
  occur in the source vector. No reuse of closed #1006 P1/budget0.
- `github={runId,runAttempt:1}`; scenario exactly one of
  `scenarios/{smoke,term01,term02,term03}.test.ts`; `budget={startup:1,scenario:1}`;
  inputEpoch, syntheticActors (private synthetic identities, no real customer),
  clock exactly `{jwt:'REAL_UTC',businessOracle:'EXPLICIT_FIXTURE_DATES',
  marketOffset:'+01:00',civilZone:'Europe/Stockholm',clockMutation:false}`, cleanupPolicy `exact-owned-resources`, and cleanupExpiresAt
  long enough for unconditional teardown. Expiry is still enforced for cleanup.
- startupAttempt.exclusiveHost true plus separately acquired backendReservation
  and producerReservation. Only NEW T2 refs `backend-t2-term-disposable` and
  `producer-t2-term-disposable` are accepted under the usual masterplan tag
  namespace, with their own `slot-session-<packetUUID>` targets. No legacy
  machine binding is repurposed. No native resource is acquired by source claims.
- Each native binding is `{ref,refs,receipt,base,tree,body,privateProof}`. Public
  body is exactly `{base,files,operation}`, neutral to the authenticated actual
  base commit tree with that sole parent. Operation is respectively
  `Acquire qualified T2 disposable backend; private-proof-sha256=<digest>` or
  `Produce qualified T2 TERM native proof; private-proof-sha256=<digest>`.
  Digest is SHA256 of UTF-8 JSON of the COMPLETE privateProof with sorted keys,
  compact separators and ensure_ascii=false. Root creates these new receipts
  and exact sorted ref sets with normal create-if-absent/GET_MATCH semantics;
  this runtime verifier never acquires, updates or releases them.
- PrivateProof retains the full-v1 protocol identity `protocol:
  masterplan-reservation-v1`, packet UUID, slot `session-UUID`, agent equal to
  runtimeOwner, branch/checkpoint/createdAt/nextAction, ids[], files equal to
  sorted sourceFiles paths, actual base, epoch `gridex-five-agent-20261012`,
  workerT2 and resourceKind backend/producer. It additionally binds exact
  source/sourceTree, workflowSHA256, inputEpoch, budget, expiresAt,
  cleanupExpiresAt, environmentId and github from the signed envelope. All
  targets, full neutral capsule, actual base tree and complete private digest
  are authenticated; schema/prefix markers alone confer no permission.
- SourceCustody remains separate ordinary neutral source claims. Each binding
  uses `{refs:[complete sorted target set],receipt,base,tree,body}`. All file
  hashes, the original unique session and any ID refs must be retained; the
  public `resources-sha256` operation must match that ENTIRE target set. Every
  ref gets an authenticated readback. These new T2 source-defined native
  bindings do not loosen existing machine-specific full-v1 native consumers.
- `replayPatchSha256` of the exact controlled patched replay script; and
  schemaFingerprint qualified against the exact source. Compute/review the
  deterministic patch from source plus assigned ports before signing; no broad
  patch or changed SQL is authorized by a familiar filename.

SyntheticActors is a source-bound declaration, not an observed-actor marker:
`{policy:'source-bound-synthetic-only-observed-receipts-required',ordinarySignup:
'NOT_PROVEN_ADMIN_FIXTURE_SUBSTITUTION',observedReceiptState:
'REQUIRED_AFTER_SCENARIO',sourceFiles:{path:sha256}}`, with exactly fixture.ts,
session.ts and term-fixture.ts under the track2 lib directory. Their hashes
must match top-level sourceFiles. Empty actual actors before startup are valid:
the cases genuinely create them. The separate fixture-owner successor must
collect real per-case Auth/selected-company/tenant-role receipts before each
ordinary action when SIM_REQUIRE_ACTOR_RECEIPT=1. Runtime checks the actual
private receipts after the scenario. No application license gate has yet been
identified in the reviewed guards: receipts honestly use licenseVerified=false
and licensePolicy=NO_APPLICATION_LICENSE_GATE_IDENTIFIED, never fabricated true.

Shared private collector contract: SIM_HOME/actor-receipts/UUID.json (directory
0700, files0600), schema gridex-t2-observed-actor-v1; environmentId,
assignmentSha256, sourceCommit, userId/companyId, observedAt, authVerified,
selectedCompanyVerified, tenantRoleVerified, licenseVerified/licensePolicy,
intent, requestedCompanyId, contextEvidenceSHA256. Authorized receipts require
selectedCompanyVerified=true and requestedCompanyId=companyId. The explicit
expected_denial union requires selectedCompanyVerified=false, foreign requested
company, requestedCompanyDenied=true, and positive Auth/role proof for the actor's
own company. It is counted separately and never accepted as positive selection.
The fixture helper restricts that negative path to reviewed customer GET/HEAD
probes; ordinary actions cannot opt out of proof. At least one authorized actor
receipt is required for successful whole-scenario collection. Wrong binding, unknown context or missing observations
fail closed. The current base fixture sources do NOT implement this collector;
its separately reviewed successor must be integrated before native use. The
forged-selected-company negative scenario needs its own explicitly reviewed
expected-denial integration; fixture prechecks must not replace app-denial
oracles or be silently bypassed.

The owner signs only after real full-source applicability is reviewed. JSON
booleans or text PASS markers do not authenticate native qualification.

## Prepare, scenario and cleanup on one dedicated host

The workflow uses Ubuntu24.04, reviewed pinned actions, Node22, SupabaseCLI2.101.0,
matching PostgreSQL17 clients and the exact npm lock. No application installation
script runs before signed-source authentication. Every replay/build/scenario log
is redirected privately; local keys/actors, assignments and full journals never
enter public output. Proxy/CA trust stays enabled; loopback probes bypass only
HTTP proxy forwarding to the local stack.

Prepare verifies an actual local system dockerd in the same mount namespace,
daemon/socket identity, real DockerRootDir filesystem free bytes (overlay2/
overlayfs at least15GiB; vfs at least40GiB), effective cgroup/physical/daemon RAM
at least8GiB, CPU quota, tools and nine free ports. Unknown driver/identity,
remote daemon, preexisting containers/nondefault networks/volumes or a reused
home fail closed. Different app ports do not isolate fixed DB/API resources.

A fresh, recorded cgroup v2 owns startup and scenario descendants, including
Next/Vitest children. Each up/run independently checks membership. Private
append-only Docker inventories are captured before and during startup, including
partial failure. Unknown locks are preserved. Startup/scenario budgets are
exclusive-created once per actual run. SKIP_REPLAY/SKIP_BUILD remain forbidden.

Replay runs in a private copy, with exact signed patch hash and before/after
source-restoration receipts. Installed version/name rows are observed from
supabase_migrations.schema_migrations and compared to the existing
scripts/gridex-aud-003-main-ledger.json, alongside real database system ID,
PostgreSQL major and source-qualified schema fingerprint. The nonempty TSV is
actual observed ledger evidence. Build ID/manifest/log hashes, replay log and
source receipts, resources and local Auth/app/mail/counterpart probes qualify
runtime; each scenario rechecks bindings and consumes its one attempt.

`down.sh --full` preflights all identities, accepts only resources already
recorded by the attempt, kills the exact recorded cgroup (including scenario
children), then removes exact recorded container/network/volume IDs in order.
It records successful cgroup stop before subsequent Docker cleanup, allowing
reconciled partial teardown without adopting new resources. Identity drift,
unknown resources or incomplete cleanup remain HOLD with private journals;
there is no prune, name/port process search, broad deletion or automatic retry.
Legacy --processes-only still makes no backend/descendant teardown claim.

## Evidence and verification limits

Run offline contracts with:

```sh
python3 -B scripts/simulation/track2/hosted/qualification.test.py
```

All external/kernel/service ports in operational component tests use confined
stand-ins; these are not real Docker/DB/cgroup/native qualification. Host
observation via `prepare.sh --observe-host` is read-only and exits78/HOLD.

The workflow exports only `t2-safe-receipt.json`: fixed-schema source/run,
installed-ledger/build/replay/resource hashes and counts, measured assertion
counts/exit code when present, and qualification/cleanup verdicts. No raw steps,
messages, keys, assignments or logs are copied. Qualification explicitly covers
only runtime infrastructure/source/build/replay/endpoints; wholeScenarioPass
is always false and actual actor-proof scope is separate. **Whole scenario acceptance
remains HOLD pending independent review of ordinary-flow observable effects**;
counts-only green output cannot close any TERM ID. A safe detailed effect-evidence
format and its independent review remain an acceptance requirement. Raw runner
disk is ephemeral; do not claim it as retained/reviewable after job teardown.
