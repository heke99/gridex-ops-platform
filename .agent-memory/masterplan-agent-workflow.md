# Masterplan agent workflow — next wave, 2026-10-06

Owner instruction: each agent completes a two-rule packet, checks the affected
system path, reviews its work and merges only when the required gates are green.
Every agent records ownership, completed work and the exact next action before
starting another task. Owner clarification: agents choose and atomically reserve
their own pairs, then continue after delivery without new assignments. Read
`masterplan-reservations.md`. Receiving the shared prompt starts that agent's
wave; this documentation update does not launch agents or clear external gates.

## Mandatory startup and packet selection

1. Read `AGENTS.md`, this memory's `README.md` and its ordered current-state,
   current-task, checkpoint, handover, blocker and work-plan files. Read your
   own checkpoint, relevant domain memory, decisions and known failures.
2. Read this workflow, `masterplan-reservations.md` and the legacy PR register. Read the latest
   ownership comments on GitHub issue #530, current main, open PRs and relevant
   retained closed PRs. Local memory is not a live cross-agent ownership lock.
3. Finish your existing reservation first. Compare its branch and original PR
   requirements against current implementation and coverage before changing
   anything. Already delivered work must not be implemented or approved twice.
4. Choose two eligible unowned rule IDs and related acceptance contracts yourself,
   or two remaining contract/scenario IDs when work is acceptance-only. A final
   single eligible ID is allowed. Follow current priority and dependencies;
   reserve IDs and exact file scope using the atomic protocol. Record the receipt,
   dependencies and next action in your checkpoint and CLAIM on #530 before code.
   On conflict, release your partial attempt and select other free work.
   No user assignment, coordinator acknowledgement or launch delay is needed.
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

No agent starts another packet without updating its checkpoint and #530.
Chat-only documentation does not satisfy this gate. Keep concise checkpoints
and real test/coverage evidence; preserve failed observations and avoid writing
duplicate audit narratives. Never store secrets or production customer data.

All agents own their checkpoints. Agents acquire the atomic `role-memory` lock
for shared current-state/current-task/checkpoint/work-plan and summaries, refresh
the latest receipts, and reconcile changes without overwriting foreign evidence.
Send concise CLAIM/READY/BLOCKED/MERGED/RELEASE receipts to #530 and record one
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

Keep PRs small. Each agent acquires `role-merge`, refreshes main/dependencies and
merges its own packet after required review and all mandatory checks are green
for the current PR head. Scope locks prevent conflicting source edits; the merge
role serializes delivery. Changed code or conflict resolution requires relevant
fresh verification. Never weaken gates or borrow old success.

`READY` means reviewable and `CI_GREEN` means the current PR gates passed.
Neither releases the reservation or permits taking a new pair. `MERGED` requires
the actual main commit and PR receipt. Only then read current ownership again
and select/reserve the next pair yourself. A blocked packet can be relinquished only through
explicit RELEASE/handover, retaining completed work and remaining requirements.

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
and deployment. The shared prompt is the next-wave dispatch; after receiving it,
continue through eligible packets without requesting another assignment. When
none are eligible, report actual completion, occupied work and blockers.
