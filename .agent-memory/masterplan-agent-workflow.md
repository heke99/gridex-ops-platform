# Masterplan agent workflow — next wave, 2026-10-06

Historical next-wave instructions are qualified by active `AGENTS.md` roles.
PLANAGENT finishes its packet, then selects eligible rule/acceptance-only work
(or a final single eligible ID); BLOCKERARAGENT finishes or explicitly hands over
one concrete blocker before selecting another; GRANSKARE performs the agreed
bounded independent read-only review. Keep the authorized role. All implementing
roles check the affected path, review their work and merge only when required
current-head gates are green. Record custody, actual completion and next action
before another item. Read `masterplan-reservations.md`; the continuation authorizes
work within the fixed role, not blanket HOLD/custody clearance. Older pre-dispatch
paused observations are history; a documentation update does not launch agents.

## Active board and Claude proxy update — 2026-10-08

New operational receipts go to [#673](https://github.com/heke99/gridex-ops-platform/issues/673);
#530 remains the historical archive at GitHub's comment limit. Preserve original
#530 links and evidence; the board move does not release any resource.

The [owner's proxy decision](https://github.com/heke99/gridex-ops-platform/issues/673#issuecomment-6056938983)
supersedes no-delegated-lock decision 6056709473. Claude agents may implement
within their assigned fixed role. A capable Codex proxy may execute the existing
GitData reservation operations for a documented Claude request, using Claude as
`receipt.agent` and itself as `delegatedBy`. Follow the complete
"Claude reservations through a Codex proxy" section of
`masterplan-reservations.md`: refresh custody/dependencies, obtain any foreign
source split approval, acquire sorted create-if-absent refs on actual main,
reconcile/roll back only this attempt's receipt-bound refs and verify all refs
before CLAIM/implementation clearance. Release requires the Claude owner's
documented delivery/handover request and exact original receipt-SHA checks.
There is no automatic expiry or substitute branch/comment lock. Authorization
alone proves no tag access, acquisition or release; report technical failures.
All security, negative-effect, original-evidence, review, CI and ordinary merge
gates remain. No foreign scope, platform admin or branch-protection bypass is
granted. Historical decisions and failed receipts retain their original evidence.

## Mandatory startup and packet selection

1. Read `AGENTS.md`, this memory's `README.md` and its ordered current-state,
   current-task, checkpoint, handover, blocker and work-plan files. Read your
   own checkpoint, relevant domain memory, decisions and known failures.
2. Read this workflow, `masterplan-reservations.md` and the legacy PR register. Read the latest
   ownership comments on GitHub issue #673 and relevant historical #530 receipts,
   current main, open PRs and relevant
   retained closed PRs. Local memory is not a live cross-agent ownership lock.
3. Finish your existing reservation first. Compare its branch and original PR
   requirements against current implementation and coverage before changing
   anything. Already delivered work must not be implemented or approved twice.
4. PLANAGENT chooses two executable, unapproved, unowned rule IDs and related
   acceptance contracts,
   or two remaining contract/scenario IDs for an acceptance-only packet, even
   when other rules are occupied or blocked. If only one executable eligible ID
   remains in the selection, use the final-single exception and document the
   selection rather than adding a blocked filler. Follow priority/dependencies;
   reserve IDs and exact file scope using the atomic protocol (including the
   documented Claude proxy path). Record the receipt,
   dependencies and next action in your checkpoint and CLAIM on #673 before code.
   On conflict, release your partial attempt and select other free work.
   No user assignment, coordinator acknowledgement or launch delay is needed.
   BLOCKERARAGENT instead selects one evidenced executable blocker within its
   fixed role, reserving its exact files and any IDs required by that scope.
   GRANSKARE does not acquire implementation scope through a read-only review.
5. Use a unique branch and isolated worktree/checkout. Preserve other agents'
   files, original commits and unrelated changes. Coordinate shared-file edits
   with their owners; never take over because an owner has not replied.

## Documentation gate for every agent

Use your existing per-packet `.agent-memory/masterplan-*-checkpoint.md` where
available, otherwise a uniquely named checkpoint. Before implementation, after
each meaningful subtask, failed check, blocker, review, publication or merge,
and before pause/handover, record:

- agent/session, reserved IDs, branch, worktree and exact source commit;
- owned files, relevant original PR/branch and dependencies;
- what is actually implemented and what remains;
- executed verification commands/results and evidence paths;
- status: claimed, implementing, locally verified, review-ready, CI-green,
  merged, blocked or released;
- the next concrete action and its owner.

No agent starts another packet without updating its checkpoint and #673.
Chat-only documentation does not satisfy this gate. Keep concise checkpoints
and real test/coverage evidence; preserve failed observations and avoid writing
duplicate audit narratives. Never store secrets or production customer data.

All agents own their checkpoints. Shared campaign-memory writes require both
the atomic `role-memory` lock and exact file custody; neither grants the other.
For shared current-state/current-task/checkpoint/work-plan and summaries, refresh
the latest receipts, and reconcile changes without overwriting foreign evidence.
Send concise CLAIM/READY/BLOCKED/MERGED/RELEASE receipts to #673 and record one
unique handover line per actual merge. No permanent campaign coordinator is
required. Side tracks retain their separate memory owners.

## Completion and merge gate

Complete each literal condition/on_pass/on_failure and expected/prohibited
effect in the frozen rule/acceptance register. Check the real affected chain
from input through current consumers to durable effects, including relevant
negative cases, tenant isolation, permissions, history and idempotency.

Self-review the final diff and full affected path, address findings, and satisfy
the repository's required review. Update only claimed coverage rows when the
whole ID is proved. Local green, an open PR and market acceptance are distinct.

Keep PRs small. Each implementing agent acquires `role-merge`, refreshes main/dependencies and
merges its own packet after required review and all mandatory checks are green
for the current PR head. Scope locks prevent conflicting source edits; the merge
role serializes delivery. Changed code or conflict resolution requires relevant
fresh verification. Never weaken gates or borrow old success.

The `READY` receipt means published/reviewable and `CI_GREEN` means the current PR gates passed.
Neither releases reservations or permits another item. `MERGED` requires the
actual main commit, parents/tree composition and PR receipt. Release merge-role
FIRST before memory-role acquisition or remaining file releases, then document
actual delivery and verified owner-only resource release before selecting the
next eligible packet/blocker in the fixed role. A blocked item may be retained
for a named resumption event or relinquished through explicit RELEASE/handover,
preserving completed work and remaining requirements. Finish actual release
before taking another item; absent tags do not relinquish retained whole duties.

Classify current candidates as READY, OCCUPIED, WAITING_DEPENDENCY,
EXTERNAL_DECISION or DONE in existing checkpoints; selection READY means an
executable candidate, distinct from a READY receipt. Neither is a lock, custody
transfer or coverage approval. Name each blocker/dependency's owner,
exact required output or criterion and resumption event. Do not impose a blanket
#699 dependency when only a specific SQL/GEN/private-source output is required;
refresh the actual output and criterion proof. Preserve specific HOLD boundaries
and reuse original evidence only when source, environment and assertions apply.

## Retained old PR work is checked before new work

Administrative CLOSED_UNMERGED means the old proposal is archived, not approved
or discarded. Its full original branch, commit, PR body and remaining HOLD/
PAUSED requirements remain available in `masterplan-legacy-pr-register.json`.

Before choosing a new packet, assess relevant retained work with its original
owner: map each remaining criterion to the frozen plan and current main, then
record already delivered, reusable/unverified, obsolete with evidence, blocked,
or still requiring implementation/verification. Do not infer a current product
defect merely from an old missing file or import an entire historic stack.

Resume only genuinely remaining scope you have reserved yourself. Reopen an old PR
when its scope and branch are still suitable and ownership is confirmed;
otherwise reuse the necessary unique changes in a small PR from current main,
linking the original PR and preserving its history. No automatic mass reopening
or wholesale merging is requested. Retired authentication designs, paused broad
reconstruction and external/legal/market gates retain their recorded boundaries.

Totals come from current main's coverage ledger; never sum overlapping branches.
Report approved rule/contract counts separately from effort, external acceptance
and deployment. Receiving the role-specific continuation authorizes eligible
work within that role; no new assignment is needed after verified delivery or
explicit handover and actual release. When none is executable, record the actual
blocker, owner, required deliverable and resumption event. Wait on that event
without repeated empty reports; this does not declare the whole plan complete.
