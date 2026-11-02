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
qualification. This source packet implements the canonical same-shell lifetime successor,
but is **NOT native-qualified**. Do not dispatch before its two independent
whole-candidate reviews and actual integration/qualification of current
app/GEN/actor/mailbox/pilot adapters and resource appointments.

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
     --materials-file <private-owner-dir>/materials.json \
     --journal-file <private-owner-dir>/deliveries/run-<actual-id>.json
   ```

   The `.json.sig` sibling must already contain the pinned Ed25519 signature.
   The helper verifies it, actual source tree and current run/certificate plus
   real native/ordinary custody. Standard OpenSSL CMS encrypts the fixed JSON
   wrapper of exact signed bytes plus the private assignment-bound materials
   packet with AES-256-GCM and RSA-OAEP using SHA256 for
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
   assignment and materials files. The receiver exports ONLY the canonical
   materials path through GITHUB_ENV, never material/credential contents. Different recipient keys/runs, CBC/SHA1 downgrade, tamper,
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

## Bound materials: mandatory before backend allocation

The CMS plaintext wrapper has exactly assignment/signature/materials base64
fields. The publisher requires --materials-file, a canonical owner0600 file in
an owner0700 private directory outside source output. Assignment is at most64KiB,
material packet at most128KiB, CMS at most512KiB; oversize fails locally before
API publication. The scenario's broader8MiB read limit is not a transport promise.

Prepare the typed specification first and bind its SHA256 of UTF-8
JSON.stringify(specification) in signed
assignment.pilotTerm0203.materialSpecificationSha256. Sign the exact assignment
bytes, then build the packet with exactly schema, assignmentSha256, sourceCommit,
environmentId and specification. Schema is gridex-t2-term0203-materials-v1;
assignmentSha256 hashes the exact signed assignment bytes. Packet bytes are
preserved unchanged through CMS. Its raw digest is retained privately and
rechecked after receipt, so even whitespace tampering between receive/prepare
fails closed. No new issuer/trust/history operation is added by delivery.

Specification has the exact frozen scenario's string fields, authority/network
objects and nonempty e66 string array. Unknown fields/numbers/floats are rejected;
property order is preserved, allowing compact UTF-8 JSON to match the actual
JavaScript consumer hash without numeric-key/float ambiguity. This validates the
transport contract, not legal acceptance or wire/business correctness. Existing
ordinary issuer/source/archive/history gates remain authoritative.

The receiver installs RUNNER_TEMP/t2-admission-rendezvous/materials.json
(directory0700/file0600) only after signature, appointment expiry, schema,
assignment/source/environment and specification-hash checks. It appends only
SIM_TERM0203_MATERIALS_FILE=<absolute canonical private path> to the actual owned
GITHUB_ENV file; raw material, keys, PDFs and credentials never enter environment,
logs, artifacts or Git. Missing/unsafe paths and expired appointments fail closed.

The workflow explicitly checks the bound material before dependency/backend
steps. Actual prepare_attempt and up/run authentication independently revalidate
that installed packet and private receipt digest, including direct manual CLI
entry and tampering after receive. The unchanged pilot scenario then performs
its existing assignment/specification/private-file checks before consumption.

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
- `github={runId,runAttempt:1}`; scenario exactly `scenarios/pilot-term0203.test.ts`, pilotId `TERM02.03`; `budget={startup:1,scenario:1}`;
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
- `canonicalReplaySHA256` must equal the actual app source and untouched private
  copy of scripts/gridex-aud-003-clean-replay.sh. No stop, exclude, URL, pin or
  other replay-script rewriting is permitted. Only the private config may change
  projectId and the exact seven assigned port fields; its parsed projection is
  checked against the original config and all other values must match. The
  signed SIM_DB_PORT is explicitly54322; this is not a default allocation.
- `mailCapabilities` exactly `{mode:'GREENMAIL_TLS_ONLY',smtps:'VERIFIED_TLS',
  imaps:'VERIFIED_TLS',legacySmtp:'RESERVED_NOT_USED',mailHttp:'RESERVED_NOT_USED'}`.
  `pilotMailbox` binds the reviewed digest-pinned GreenMail image, containerName
  projectId+'-pilot-mailbox', synthetic mailboxAddress and two explicit unique
  smtps/imaps ports, disjoint from the nine original assigned ports. Legacy
  SMTP/HTTP ports remain reserved and are checked unbound; no HTTP service READY
  is claimed. Other modes, including legacy smoke, fail closed unsupported until
  separately qualified; their HTTP expectation is not silently bypassed.
- schemaFingerprint remains the exact source-qualified actual database oracle.


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

The qualified T6 bare-source design is reused from PR1018 at
1e35af8cf72f088b0f143101f5d35bb89e2412c4, prepare.sh/lib/prepare.mjs. PR1021's
subsequent business/custody changes confer no T2 acceptance. The T2 supervisor
uses the same essential boundary: an unconditional top-level bare `source`,
then real consumers in that SAME shell, then original canonical cleanup.
No conditional source/child replay shell may suppress errexit or close EXIT
before consumers. An exact bounded Supabase stop wrapper retains canonical
argv/function behavior; it never replaces cleanup with a noop.

One source-bound PID/start-time/session and pidfd track the real supervisor
child. Startup and consumers remain in its owned cgroup, including detached
Next/Vitest descendants. The controller consumes one startup attempt and waits
for actual child exit; TERM goes only to that captured, still-live exclusive
session, with bounded grace. It does not SIGKILL an unrestored canonical shell.
If the controller is lost, cleanup can gracefully reconcile that exact child,
observe exit through pidfd and verify restoration, but never infer a successful
consumer status from that recovery. Unknown/reused identities remain HOLD.

Before replay the app source is copied, canonical bytes verified identical,
private config projection checked, and scripts/supabase source bytes/modes,
Postgres version-pin state and semantic source index captured. The original
canonical EXIT cleanup stays live through app build, admitted scenario and
per-case actor-proof collection. While consumers run, restoration is explicitly
PENDING_CANONICAL_EXIT, never asserted prematurely. Original cleanup then stops
the local stack and restores its own migrations/seed/pin. Actual child exit and
matching source/index restoration are required BEFORE full resource teardown;
current private copy is rechecked to reject late drift. Replay failures before
wrapper trap replacement retain the canonical original EXIT cleanup.

Installed version/name rows are observed and compared to the existing
scripts/gridex-aud-003-main-ledger.json, alongside real database system ID,
PostgreSQL major and source-qualified fingerprint. The TSV records actual rows.
Build ID/manifest/log hashes, genuine replay log completion, exact source and
resource identities remain required. A live-source receipt is not a restoration
receipt or whole-scenario PASS.

The separately owned frozen mailbox module (51d4ad237047afd4fe6482bc4d6b196d45cc26fe)
starts once after up/attempt/cgroup admission and canonical replay, before app
build. Actual TLS SMTP/IMAP logins and container/pin/mount/loopback bindings are
verified. Its private descriptor supplies SMTP secure=true, real generated
credentials, SIM_PILOT_MAILBOX_PASSWORD and NODE_EXTRA_CA_CERTS containing the
existing proxy trust PLUS mailbox CA. No plaintext legacy SMTP fallback or
NODE_TLS_REJECT_UNAUTHORIZED=0 is accepted. Descriptor/probe gates replace the
legacy HTTP probe only for the exact signed selected GreenMail-only profile.
The nine old ports remain explicitly assigned; unused SMTP/HTTP roles are
reserved/unbound, with two additional signed TLS mail ports.

`down.sh --full` first requires actual supervisor exit and restored source,
preflights all identities, kills only the recorded cgroup's remaining descendants,
then removes only recorded container/network/volume IDs. Unknown resources,
failed restoration, still-live shell, expired authority or identity drift preserve
private evidence and fail closed. No prune, blanket deletion or blind rerun.
The workflow keeps prepare→scenario→canonical cleanup in one supervised step
on one disposable host, followed by exact full cleanup and safe summary.

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
format and its independent review remain an acceptance requirement. Current
ordinary E66 issuer/history qualification and the nonselectable file_export
source path remain concrete pilot business blockers; infrastructure/component
verification cannot turn those HOLD results into native PASS. Raw runner
disk is ephemeral; do not claim it as retained/reviewable after job teardown.

### Measured bootstrap before private admission

The workflow now defaults manual dispatch to `mode=bootstrap`. This mode checks
out the exact source, reads actual boot/machine/mount/daemon identities, measures
RAM and free space at the daemon root, verifies an empty dedicated daemon, and
emits one `T2_BOOTSTRAP_PROOF_V1` notice. It does not install tools/dependencies,
pull images, allocate backend resources, accept business inputs, or claim ACTIVE.
The same-repository trusted PR `bootstrap-probe` job provides the first executable
precursor while this workflow is absent from default branch. A fork is refused.
PR observations apply to that PR host only; they never qualify a later term host.
No `pull_request_target`, environment administration or new service is used.

The fixed public notice contains run/source identity, measured capacity, explicit
`runtimeActive:false` / `wholeScenarioPass:false`, private proof SHA256, and CMS
ciphertext only. Raw host/boot/machine/socket identities stay in the owner0600
private proof. The root RSA4096 recipient certificate is pinned in requirements;
its private key remains root-owned outside Git. Expired/changed certificates fail
before notice publication. Encryption uses the existing OpenSSL CMS AES256-GCM
and RSA-OAEP-SHA256/MGF1-SHA256 checks. Certificate expiration requires a reviewed
public-certificate source update, never logging or exporting its private key.

For `mode=admitted`, this **same term host** observes itself before the recipient
announcement. While its bounded rendezvous waits, root uses actual run/job/check
APIs and `--operation read-bootstrap --run-id RUN --source-commit SHA
--bootstrap-key /private/root.key --bootstrap-proof-file /private/host-proof.json`
to read the unique term notice, decrypt privately and verify the exact digest/run.
The output is create-only owner0600 in an owner0700 directory. Root qualifies the
actual source, host, input, tool distributions and complete image inventory, then
signs the existing Ed25519 assignment containing `bootstrapProofSHA256` and
`installationPolicy`. Both actual backend and producer full-v1 private receipts
must repeat these fields; source custody is never a substitute. Root publishes
only the existing encrypted assignment/signature/material packet carrier.
The receiver revalidates the locally measured proof before installing input.
A PR proof, stale proof (>45min), another boot/daemon/source, absent/mismatched
signed digest, missing materials or inadequate capacity cannot reach installation.

`installationPolicy` has exactly `tools`, `packageLockSHA256`, `images`,
`imageSelectors`, and `provenanceSHA256`. `tools` maps node/npm/supabase/psql/pg_dump
to exact `version` and resolved executable `executableSHA256`; root must qualify
these from genuine distribution/package provenance, not approve a newly observed
hash merely because it was observed. Node is source-pinned22.22.0, CLI2.101.0 and
Postgres clients17.11. The workflow downloads exact SHA256-pinned PG17.11 and
libpq18.6 ABI dependency packages (libpq is not the database server version),
source-qualified via signed PGDG Release→Packages→deb proof. OS dependency packages
remain supplied by Ubuntu's signed repositories. npm10.9.2 uses exact archive
SHA256/SRI-qualified bytes with lifecycle scripts disabled; upstream npm signature
was not independently verified. Resolved final executables must equal source-pinned
qualified hashes, not merely signed caller-selected hashes.
`provenanceSHA256` binds root's independently qualified private distribution/image
proof, not an automatically generated approval. Actual qualification/acquisition
of that proof is still required before admitted execution.

After full admission, exact tool/lock checks precede the one-shot bounded
`npm ci`; its raw log stays private. Receipt pins source, bootstrap proof, tool
bytes, source lock and actual installed lock. `prime-images` then performs only
signed `name@sha256:digest` pulls, checks actual image IDs/RepoDigests, and installs
only signed local selector aliases for canonical CLI compatibility. It never
pulls mutable network tags or edits canonical source. Priming is one-shot with
32-image/900-second limits and a private journal; ambiguous/failed attempts are
not silently retried. Prepare checks unchanged tool/dependency/priming receipts,
all cached digest/selector identities (the complete source-pinned seven Supabase
images plus GreenMail, including postgres-meta), current capacity, original boot/daemon,
source, assignment and materials before home/cgroup/backend allocation. Owned
container inventory subsequently refuses image IDs outside the signed lock.

Actual delivery sequence under T2's standing mandate: finish independent source
reviews; publish the reviewed PR through the serial delivery owner; execute its
read-only PR probe and retain exact source/run/check/notice digest; merge the
reviewed workflow if using manual dispatch; alternatively use the strictly bound
`codex/t2-native-UUIDv4` push entry point only after actual source/GEN, event budget,
producer and backend qualification. A source tag or ordinary source branch is
not a native invocation. No authority follows from publication. For manual
dispatch, execute `mode=bootstrap` to observe
an actual term host without issuer materials; then use a **new** `mode=admitted`
invocation only once genuine business/input/native/tool/image qualification is
available, and sign that invocation's fresh proof. Root handles publication and
dispatch; this source author has performed neither. Successful bootstrap remains
source/host observation only. E66/history/issuer, ordinary application gates,
actor observations and independent business-effect acceptance remain mandatory.

The same root read command also consumes a completed trusted PR observation with
`--bootstrap-job bootstrap-probe --source-commit CHECKED_OUT_MERGE_SHA`. It verifies
actual run event/attempt/workflow path, unique job, GitHub Actions check provenance,
actual head as a parent of the checked-out merge commit, and commit tree readback.
It never confuses API PR head with checkout merge SHA. Private/public run, mode,
proof digest and checkout tree must match. Term uses `--bootstrap-job term` and
requires actual invocation head equality; a native push also binds its exact
UUID branch through the actual API and signed role/assignment input. PR proof and bootstrap-only mode cannot satisfy
admitted delivery, regardless of passing capacity.

### GitHub annotation framing

Actual PR run41337521434/job124940375018 completed its read-only probe, but GitHub
truncated the original single proof annotation to exactly4096bytes. That run did
not deliver a consumable private proof and does not establish backend readiness.
The root consumer intentionally refuses that incomplete legacy notice.

The corrected transport emits one `T2_BOOTSTRAP_PROOF_V1` header and indexed
`T2_BOOTSTRAP_CIPHER_V1` ciphertext chunks. Every UTF8 message is checked at
≤3500bytes before **any** notice is printed; base64 chunks contain ≤2400characters.
The header binds exact run/attempt/checkout source/API-head/job label/mode, private
proof SHA256, whole ciphertext SHA256/length, and chunk count. Each chunk binds the
canonical complete header SHA256, its unique index and the same count. Actual
numeric job/check identity is independently obtained and authenticated through
GitHub's run/job/check APIs; no fabricated job ID is inserted into the proof.

The consumer requires complete annotation inventory ≤100, one header, exactly the
specified unique indexed chunk set, exact header binding, bounded messages/cipher,
and whole ciphertext digest before algorithm validation/decryption. API ordering
may differ: reconstruction uses indices and accepts a complete reversed list.
Missing/duplicate/mixed-run/changed/truncated/oversized frames fail closed; it never
reads raw logs, alternate artifacts or partial ciphertext. Existing CMS algorithm,
private proof digest and exact source/tree/run checks remain unchanged. No private
payload, host identity or key is put in these public notices. Actual corrected
source must still be independently reviewed, published once and probed on GitHub;
local truncation controls are not a replacement for consuming that real proof.


The native push entry point does not require this workflow on default main. It
uses the actual pushed workflow source, admitted mode, one actual run/attempt,
and an exact UUID branch bound in the signed assignment and role proofs. Both
the host-proof and business-evidence consumers verify actual GitHub provenance;
ordinary push branches are refused. Prior budgets stay closed.

Capacity qualification covers the worker and the actual shared Docker container
parent. The existing 8 GiB floor applies to those aggregate budgets, not every
individual daemon or container leaf. Socket activation must identify the real
dockerd through its listener descriptor; PID1 is not a daemon-memory proxy.
Unknown configuration, process or parent mappings HOLD before heavy work.
Individual limits are recorded; owned process and parent bindings are checked
again before backend qualification and scenario execution. Safe exact cleanup
remains available when capacity is lost. Older worker-only observations retain
their historical meaning and do not admit a new backend.
