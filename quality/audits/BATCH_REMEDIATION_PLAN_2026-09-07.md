# Dependency-group remediation workflow

## Global Constraints

- No production writes, merge, deployment, migration/source-selection changes or
  generated schema/types edits in this workflow-tooling change.
- Existing replay accounting, parity, types, integrity and CI gates must not be
  weakened, skipped or converted to advisory checks.
- Automatic mapping is review evidence only: never infer complete SQL effects,
  safe replay/exclusion, verification or phase closure from lexical hints.
- Preserve every unresolved input and all existing history. Archive superseded
  status losslessly. Maintain one current status source and one active group.
- No phase is complete until code, canonical replay, generated types, migration
  ledger and actual production database have verified parity.
- One combined publication after reviewed local work. No external publication by
  implementation/review agents. Work on the existing remediation branch.

### Task 1: Conservative group mapper and regression tests

Implement scripts/gridex-replay-review-groups.py and its selftest. Consume the
existing accounting module's real account(root) report. Verify its API first.
Map every input, prioritizing unresolved inputs, to one or more review domains
(auth_membership_tenant, ediel, billing, customer_lifecycle, integrations,
manual_review). Filename routing may propose domains; public/auth qualified
object references may propose shared-object adjacency. Include SHA, current
classification, existing execution/derived provenance, lexical DDL/DML/policy/
function/trigger/dynamic-SQL hints, and cross-domain shared-object candidates.
Clearly distinguish review hints from proven read/write dependencies; do not
call a regex a SQL parser. Unmatched, dynamic or unresolved SQL never disappears.
Deterministic JSON stdout, no SQL execution or external writes. Hard fail if the
underlying accounting fails validation; unresolved inputs stay a nonzero exit,
not a pass. A focused group option may limit display but must expose global
unresolved counts and retain cross-group references. Keep script focused, no new
dependency. Tests first: full coverage/no missing input, cross-group overlap,
unmatched/dynamic input preservation, deterministic output, corrupt accounting
failure, and no changes to selection/classification from grouping.
Commit locally and report red/green evidence. Do not edit project memory yet.

### Task 2: Single status, batch runner and publication discipline

Archive current-state.md/current-task.md/handover.md/open-blockers.md/work-plan.md
and checkpoint.json losslessly under .agent-memory/archive/pre-batch-20260907/.
Replace current-state.md with the sole concise authoritative status: branch/PR,
active auth_membership_tenant group, existing scoped PG17 evidence, counts
(derive using accounting), explicit implementation/isolated/canonical/production
verification distinctions, open internal work versus unproven external blockers,
next action, and grouped execution/publication contract. Other replaced Markdown
files point to it and their archives rather than duplicate progress. checkpoint
is a small pointer/continuity record without competing old green claims.
README and AGENTS instructions must resolve to this status without weakening
their checks. Archive is historical, never active evidence.
Add a single group fixture runner, fixed allowlisted commands only, wrapping
existing auth, POA, auth invitation and membership-FK scripts in the already
isolated PG17 service. It must fail on any child failure and not accept arbitrary
commands or production connection targets. Dry-run prints exact ordered commands
without SQL/network calls. Existing Ediel job and all global gates remain.
Wire mapper selftests and this runner into existing OPS workflow without adding
extra publication-triggering workflows or skipping CI for docs. Add focused
runner/status consistency tests, including child failure and archive equivalence.
Run focused checks plus existing accounting/integrity/provenance once. Update
current-state with real evidence only. Commit locally, no publication.

### Task 3: Auth group review map and integrated handoff

Use mapper to inventory the complete active group (selected and unresolved).
Record prerequisite chains, suspected overwrite/IF NOT EXISTS omissions,
operational DML needing separate review, missing coverage in existing fixtures,
and the next coherent group test expansion. No automatic replay decisions.
Review tasks 1/2, resolve findings, publish one combined update to draft PR 310,
inspect scoped CI, and record evidence in the single status. Global parity and
the larger masterplan remain IN_PROGRESS unless independently proven complete.
