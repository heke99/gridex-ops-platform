# T2 dedicated disposable TERM runtime

Source implementation awaiting independent final reviews. **provisioned=false**:
no environment, backend/producer allocation, integrated app/GEN source, signed
ACTIVE assignment or native acceptance is established by committing this code.
The public key in profile.requirements.json belongs to T2; its private Ed25519
key is retained outside Git by the T2 owner. No external signer or new generic
user approval is required. Never put that key in Actions secrets or logs.

## Same-host encrypted admission rendezvous (no environment administration)

The selected TERM02.03 pilot has a mandatory delivery gate: the actual dedicated
job must receive and verify its exact signed private appointment before any
backend start. Source preparation is not delivery, and delivery is not native
qualification. The inherited canonical replay/consumer lifetime still needs its
separate reviewed same-shell supervisor successor; this crypto-only source
packet is **NOT runtime-ready** and must not be dispatched before that source
and the current app/GEN/actor/pilot adapters are integrated and qualified.

T2 owns the following concrete steps under its standing mandate, after the two
independent final reviews and real source/input/backend/producer qualification:

1. Dispatch the exact reviewed integrated workflow once. No GitHub environment,
   wait-timer configuration or Actions secret administration is used. The term
   job checks its actual run/attempt1/head, current unique job and GitHub Actions
   check-run provenance through authenticated API reads. On that same disposable
   host it creates a fresh RSA4096 recipient key under RUNNER_TEMP, directory0700
   and private key0600. Unknown/reused directories are rejected. The private key
   never leaves that host; the T2 Ed25519 signing key never enters it.
2. The job emits exactly one `T2_CMS_RECIPIENT_V1` notice containing only its
   public DER certificate, certificate SHA256 and public run/head/attempt/job
   identifiers. T2 reads it through the job/check-run annotation APIs, validates
   the `github-actions` app, exact details URL, source/run/attempt/job and complete
   bounded annotation inventory. Duplicate/substituted notices fail closed.
   Artifact download and log download are not the transport. Observed annotation
   API reads work; artifact redirected download was Forbidden in the code host.
3. T2 acquires and verifies the real separate native resources, builds the exact
   private assignment described below and signs its exact bytes locally using
   its already owned private Ed25519 key. Plaintext assignment and signature stay
   owner0600 outside Git. A signed appointment for another run is never reused.
4. From a private owner0700 delivery directory outside Git, invoke the reviewed
   local publisher (it performs external writes, so only after actual pilot
   appointment/source qualification; no publication is performed by this PR):

   ```sh
   python3 -B scripts/simulation/track2/hosted/qualify-runtime.py \
     --operation publish-delivery \
     --assignment-file <private-owner-dir>/admission.json \
     --journal-file <private-owner-dir>/deliveries/run-<actual-id>.json
   ```

   The `.json.sig` sibling must already contain the pinned Ed25519 signature.
   The helper verifies it, actual source tree and current run/certificate plus
   real native/ordinary custody. Standard OpenSSL CMS encrypts the fixed JSON
   wrapper of exact signed bytes with AES-256-GCM and RSA-OAEP using SHA256 for
   both OAEP and MGF1. There is no custom hybrid format or crypto dependency.
   OpenSSL3+ is required; weaker algorithms have no fallback.
5. The helper creates ONLY a neutral GitData carrier commit and its separate
   create-if-absent tag `refs/tags/t2-private-admission/<runId>-attempt-1`.
   Public commit message is exactly `{base,files:[],operation}`. Operation starts
   `T2_CMS_ADMISSION_V1 ` followed by compact JSON with only runId, runAttempt,
   sourceCommit, jobId, recipientSHA256 and CMS ciphertext base64. Its tree equals
   the authenticated actual source/base tree, with that sole parent. No source
   branch, claim, backend or producer ref is written by this helper. The delivery
   tag is outside agent-claims; it grants no source/backend/native authority.
6. The owner-private journal fsyncs intent before each of the only two permitted
   POSTs (git/commits and the exact delivery git/refs), captures returned states
   and verifies exact commit/ref readbacks. Existing tags/journals, failures or
   ambiguous responses stop without automatic retry, replacement, force or
   rollback. Reconcile that SAME journal; never change journal path to retry an
   uncertain mutation. No private input/key is included in the public carrier.
7. The original host polls only that exact tag, at most10 minutes with30-second
   intervals. It checks neutral parent/tree and exact run/attempt/source/job/
   recipient metadata, then exclusive-consumes the appointment. OpenSSL ASN.1
   algorithm checks require authenticated-enveloped CMS, AES256-GCM and
   RSA-OAEP/SHA256/MGF1-SHA256 before private-key decryption. GCM integrity and the
   unchanged pinned Ed25519 signature must pass before installing private
   assignment files. Different recipient keys/runs, CBC/SHA1 downgrade, tamper,
   duplicate consumption or timeout fail before backend startup.
8. Existing full source/claim/GEN/expiry/budget/capacity/Auth/actor/cleanup gates
   then run unchanged. Receiving signed bytes explicitly does NOT mark runtime
   admitted. No raw private logs, key, assignment or journal is uploaded. The
   existing strictly allowlisted safe receipt remains the only exported proof.

Root GitData commit/tag operations and annotation reads are observed
capabilities. Actual rendezvous, recipient generation on a hosted job, payload
publication and native startup remain unperformed. No environment API retry or
alternate environment/secret endpoint is part of this source successor.

OpenSSL's standard CMS documentation covers supported AES-GCM AEAD and the
RSA-OAEP encryption/key options:
[OpenSSL3 CMS](https://docs.openssl.org/3.0/man1/openssl-cms/).
Actual source, all single-use native resource receipts, expiry and cleanup still
must be qualified; encrypted delivery does not substitute for any of them.

## Exact assignment contract

Retain the existing `gridex-simulation-runtime-assignment-v1` workerT2 format:
state ACTIVE only after real allocation, environmentId, future timezone-aware
expiresAt, allowedOperations up/run/down, canonical runDir/sourceCommit/simHome,
unique projectId and the nine explicit `SIM_*_PORT` keys documented in the
parent harness README. No default or example port is an allocation.

The signed operational envelope additionally requires:

- `ownedSourceFiles` is the exact sorted list of actual tracked
  scripts/simulation/track2/** paths plus this workflow, derived from git ls-files
  at the admitted checkout. Caller-empty/partial lists are rejected. Every path
  must also occur in sourceFiles, and individually authenticated ordinary source
  receipt body.files unions must cover this entire adopted runtime scope.
  Extra paths in an original receipt are readback context, never an implicit
  handoff/write grant. Positive exact handoffs remain independently required.
  Unchanged readonly app/lock/GEN inputs require frozen identities, not T2 writer
  claims; those paths do not enlarge ownedSourceFiles.
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

The workflow uses Ubuntu24.04, OpenSSL3+, reviewed pinned actions, Node22, SupabaseCLI2.101.0,
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

After the separate canonical same-shell supervisor successor is qualified,
a fresh, recorded cgroup v2 owns startup and scenario descendants, including
Next/Vitest children. Each up/run independently checks membership. Private
append-only Docker inventories are captured before and during startup, including
partial failure. Unknown locks are preserved. Startup/scenario budgets are
exclusive-created once per actual run. SKIP_REPLAY/SKIP_BUILD remain forbidden.

The existing inherited replay shell/EXIT retention seam is NOT qualified by
this delivery packet. Its successor must preserve pristine canonical cleanup
and retain its trap through actual consumers; no noop-stop patch is authorized.
Required replay evidence remains: a private source copy with exact source-bound
controls and before/after
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
