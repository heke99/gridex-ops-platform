# Independent review: SC071 native feedback invoker

Base/unchanged HEAD: `af760c048fb07b0232e304ec2facd565e6b5951a`.
Reviewed uncommitted workflow SHA-256:
`b263a24933f8fd77595ee13809800b5c4396611fa7a0ff2de81f80cfec7f40c5`.
**One actionable feedback defect; correct it before publishing this invoker.**
No native execution, CI approval or whole-SC071 approval is claimed.

## Finding

**P2 — retain safe diagnostics when canonical setup/replay fails.**
`.github/workflows/ediel-sc071-native.yml:70` redirects the sole canonical replay
to a private RUNNER_TEMP log under `set -euo pipefail`. A replay failure exits
before receipt creation (lines 80–124), redaction (127–128) and artifact-directory
promotion (130). The always-running upload at lines 134–140 consequently finds
no evidence directory and reports only a warning. The first actual setup/SQL
failure remains hidden in an ephemeral private log, preventing the requested
native feedback from identifying the failed replay boundary. The SC003/SC005
example inherits the same omission; it does not remove this new invoker's gap.

Preserve the canonical script and its EXIT cleanup, but add a fail-closed
diagnostic collection path that records the failing stage/exit and retains only
proven-redacted diagnostics. Never print/upload the raw replay/status files.
Do not catch `source` with `if`, `!` or `||`: Bash would disable the sourced
script's errexit behavior. Any diagnosis path must continue to fail the job and
must not report that replay or the three native cases passed.

## Scope, custody and remaining checks

- Actual PR head is checked out at lines 37–39; permissions are read-only.
  The new workflow invokes the unchanged canonical clean replay, rather than
  introducing another schema/database harness. Native config/fixtures/helper
  bodies are unchanged. The optional shared include patch remains a text
  proposal; the canonical config and ordinary OPS workflow have no changes.
- Shell errors fail closed. The sourced canonical owner installs its EXIT
  cleanup (`gridex-aud-003-clean-replay.sh:62–79`), restoring migrations/seed and
  stopping its disposable stack. Native failure is captured solely so evidence
  can be collected; the final step still exits nonzero.
- JUnit completion requires exactly three testcase elements, zero skipped,
  failures and errors, plus Vitest exit zero in the receipt (lines 100–125).
  Missing JUnit/zero cases cannot produce a passing job. Canonical status guards
  still require the real local API and keys; no fabricated status is introduced.
- Native logs/JUnit/receipt enter the upload directory only after the existing
  local-secret/JWT redactor succeeds (127–130). Private raw replay/status files
  are excluded; the status file is removed on the normal path. No hosted
  secrets or private credential artifact path was found. Native failures after
  replay can retain safe feedback; the finding concerns earlier failure only.
- All sixteen receipt input files exist. Checkout commit/tree/run identity and
  input hashes identify the reviewed source. Receipt explicitly preserves
  `ordinary_required_gates=NOT_REPLACED`, `whole_sc071=UNAPPROVED` and
  `leased_export_consumer=NOT_PROVEN`; it makes no browser/upgrade/market claim.

## Read-only export inventory

All ten `export-path-inventory.json` source hashes independently match current
bytes. The claimed sole beneficiary production caller remains the synchronous
series GET → projection adapter → beneficiary RPC. The examined exclusions are
accurately distinct: customer life-event projection reads approved customer
masterdata (`customerLifeEventExport.ts:26–58`); billing export builds underlay,
pricing and invoice snapshots (`exportCenter.ts:321–375,805–915`); invoice sends
use company/run IDs and an automation lock (`invoiceExportCore.ts:779–811`);
invoice cron dispatches approved invoice/provider retries (route lines 30–41).
Customer-operation dispatch is a fixed branch set (automation.part-3.ts:299–353),
including lifecycle notification and application continuation as well as the
listed switch/info/inbound-response branches. Tenant provisioning supports
invitation/readiness jobs (provisioningWorker.ts:84–97,169–182); spot jobs import
price-area/date data; automation locks provide mutual exclusion, not grant
authority. No grant-scoped E66 beneficiary export branch or consumer was found
in those candidates. This bounded exclusion is not a security qualification or
vulnerability claim against their unrelated behavior.

Verification was read-only: HEAD, relevant tracked diffs, targeted caller/body
reads and searches, input existence and inventory/test/config SHA-256 checks.
Native test remains `6407877b57576c7b3dac3db2c3847935ef4941b71b5f5efd36c6e4b5f0fb1ef0`;
selected config remains `dfd7ae4e5b278d0c86904cda781ae4b8c1232d2aa1033022f4bb075d11853d1b`.
Native is NOT_RUN until the actual CI invoker executes. SC010 ownership remains
with #570; absent queued/leased export work and whole SC071 remain unapproved.
Only this review file was written by the reviewer.

## Corrected final static review — 2026-10-05

**The initial P2 above is resolved. APPROVE the corrected supplemental CI
invoker statically; this is not native/CI execution or whole-contract approval.**
The initial failed review and its workflow hash remain historical.

Current workflow SHA-256:
`415504aba370073521c904b3d397b7d1106276f30d23b307d935bf1967a663c3`.
HEAD remains `af760c048fb07b0232e304ec2facd565e6b5951a`. Native test and selected
config hashes remain exactly `6407877b57576c7b3dac3db2c3847935ef4941b71b5f5efd36c6e4b5f0fb1ef0`
and `dfd7ae4e5b278d0c86904cda781ae4b8c1232d2aa1033022f4bb075d11853d1b`.

Lines 73–86 launch a fresh Bash process whose unconditional canonical `source`
runs under its own `set -euo pipefail`. Catching the external process result in
the parent does not suppress child errexit. The child's existing canonical EXIT
cleanup completes before parent collection. Replay/status/native stage markers
and session/replay logs now survive an early replay failure; lines 114–146
record failure stage, exit and missing/malformed JUnit honestly. Native is
`NOT_RUN` when replay/status fails. Exactly three non-skipped/non-failing cases
and component exit zero remain necessary for a passing receipt and job.

Lines 150–159 redact logs/JUnit/receipt with the unchanged redactor, refuse
leftover JWT or `sb_secret_` bytes, and only then promote the upload directory.
Raw status stays private. Missing/malformed status or redaction refusal can
prevent artifact publication, preserving fail-closed custody rather than
exposing unvalidated credentials. No raw credential output, alternate database
harness, canonical/shared-file edit or ordinary gate weakening was introduced.

The bounded `export-integration-gap.md` retains frozen enqueue/lease/current
rights/disclosure requirements and explicit owner/architecture assignment as
PENDING. It does not establish a producer or approve a design/whole SC071.
The test-only projection scope, SC010 #570 ownership and prior read-only
inventory conclusions remain unchanged.

This follow-up read the current workflow/gap document and independently checked
the three hashes, HEAD and tracked diff. It did not rerun native or unchanged
test/source qualification. Parent-reported actionlint/syntax checks and finite
wrapper-control probe are not independent native evidence. Native/CI feedback
is still pending actual execution; whole SC071 stays unapproved. Only this
review file was updated.

## Format-input correction after actual credential refusal — 2026-10-05

Owner-reported actual run `37293845384`, job `111710327615`, on
`f75cdd7d7c785a4ee28351d5819a82cae849a05e` failed the retained credential refusal.
Zero artifacts were published; native counts remain unqualified. The earlier
static review is historical and does not turn that failed execution into PASS.

**APPROVE the new bounded credential-input correction statically.** Current
workflow SHA-256 is `a92013e90ef1e2c8030625b100e5a9e278792d9f4cbb18705d87ea2707d44038`;
HEAD is still the exact failed-run source above. The sole reviewed workflow
diff (lines 153–166) imports the unchanged canonical redactor and passes detected
`sb_secret_` format bytes through its existing `scrub(data, secrets=...)` input.
The canonical CLI's legacy SENSITIVE key-name list does not include SECRET_KEY;
providing literal extra-secret bytes covers that omitted local output format.
This supplies an existing input port; it does not create a second scrubbing
algorithm or mutate the shared redactor/status/native authority.

The existing CLI redaction still precedes the additional input. The same
leftover JWT/`sb_secret_` refusal remains unchanged before directory promotion,
artifact upload or printing. Missing/malformed status and import/scrub/refusal
errors remain fail closed. Only the known top-level working log/XML/JSON files
are processed; no native status file enters that directory. No actual token
was read, printed or copied into this review's artifacts.

Independently verified unchanged hashes: canonical redactor
`db285c16dc62542028d497e805a5d8315ed6183ead8d9564982ea1a80164fb74`, native test
`6407877b57576c7b3dac3db2c3847935ef4941b71b5f5efd36c6e4b5f0fb1ef0`, selected
config `dfd7ae4e5b278d0c86904cda781ae4b8c1232d2aa1033022f4bb075d11853d1b`.
Relevant shared replay/config/fixture/helper/native diffs against `f75cdd7d` are
empty. No checkout/index/HEAD or implementation changes were made by reviewer.

Independent `python3 -B` finite in-memory input check: **3 formats PASS**
(plaintext, JSON SECRET_KEY and XML), using declared synthetic format bytes
only. The existing scrub with extra-secret inputs removes both legacy JWT and
`sb_secret_` bytes while preserving stage/count/failure diagnostics. No files
were written; no live credentials, native database or native tests were used.
Parent wrapper/actionlint checks are separate verification, not native proof.

The corrected workflow has no actual CI/native result yet. Whole SC071 remains
unapproved, with native counts unqualified until new-head real feedback passes.
The reported sole exporter claim on #530 assigns future production work; it
does not itself qualify that producer or authorize a competing implementation.
Only this existing review file was updated by this reviewer.
