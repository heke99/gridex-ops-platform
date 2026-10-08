# Autonomous Masterplan reservations

Historical owner decision, 2026-10-06: use a shared continuation prompt.
Active `AGENTS.md` roles qualify that older dispatch wording: PLANAGENT selects
eligible plan packets, BLOCKERARAGENT resolves consecutive concrete blockers,
and GRANSKARE performs bounded independent read-only reviews. Keep the role
authorized for the chat; neither the user nor a coordinator assigns plan IDs.
Issue #673 carries new progress and handovers; #530 is the historical archive
at its 2,500-comment limit. Preserve all original #530 receipts and links.
Atomic GitHub refs decide
current ownership across separate chats, machines and worktrees.

Owner update, 2026-10-08: [Claude implementation and reservation through proxy](https://github.com/heke99/gridex-ops-platform/issues/673#issuecomment-6056938983)
supersedes the older no-delegated-lock decision 6056709473. Claude agents may
implement within their fixed role and the existing security/review/CI/merge
contract. A capable Codex agent may perform the original GitData reservation
operations on a requesting Claude owner's behalf, as specified below. This
authorization is not evidence of technical access or an acquired reservation.

Older pre-dispatch `paused` observations are dated history, not a current blanket
stop. Receiving the owner's continuation authorizes work within that fixed role;
specific HOLD/PAUSED criteria, external decisions and retained custody remain.
A documentation update itself does not launch agents or clear those boundaries.

## Select from current evidence

Fetch current main and read the frozen registers, current coverage, memory,
#673, relevant historical #530 receipts, open PRs and retained legacy PRs.
Finish your existing reservation first.
Reconcile older active claims/PRs before taking overlapping work; an idle chat
or a CLOSED_UNMERGED PR alone is not a release or completed criterion.

For PLANAGENT, choose two unapproved, unowned rule IDs with executable dependencies
and file scope, in AGENTS.md priority order. Include the associated contract/scenario
IDs you will implement or approve. For an acceptance-only packet, choose two
unapproved contract/scenario IDs even when other rules are occupied or blocked.
If only one executable eligible ID remains in the selection, use the final-single
exception and document selection rather than adding a blocked filler.
Assess reusable old PR changes first. Already approved rows are not new work.
Record criteria needing outstanding external permission as blocked and choose
another eligible packet. No eligible work means a completion/blocker handover.

BLOCKERARAGENT finishes or explicitly hands over its existing blocker, then
chooses the next concrete executable blocker; do not select unrelated plan pairs.
Reserve its exact files and any IDs required by that scope before implementation.
GRANSKARE stays within the agreed read-only source/path/evidence review; review
does not acquire implementation custody or approve unproved whole criteria.

Use READY, OCCUPIED, WAITING_DEPENDENCY, EXTERNAL_DECISION or DONE as selection
aids, not locks or coverage statuses. Selection READY means an executable candidate;
a READY receipt means published/reviewable. Neither transfers custody or approves
coverage. A blocked entry names the responsible owner,
exact required output/criterion and resumption event. A dependency on a particular
SQL/GEN/private-source output is not a blanket stop until every part of #699 is
delivered. Refresh the criterion's actual implementation and proof separately.
Absent tags do not release retained whole-duty custody; require its documented
release/handover before taking that remaining duty.

## Atomic lock protocol

Use authenticated GitHub Git Data API calls on
`repos/heke99/gridex-ops-platform/`. `gh api --input <json-file>` or equivalent
structured tools send JSON; never print tokens or embed them in memory.

1. Generate a unique packet UUID and agent/session identifier automatically.
   Record branch, checkpoint path, current main SHA, selected IDs, exact owned
   paths, prior claim/PR assessment, and next action in your checkpoint.
2. Create an unreferenced commit via `POST git/commits`, using current main's
   exact tree and a single parent of current main. Its message is a JSON receipt
   with `protocol: "masterplan-reservation-v1"`, `packet`, `agent`, `branch`,
   `checkpoint`, `ids`, `files`, `base`, `createdAt`, and `nextAction`. No files
   change on main. Save the receipt commit's SHA.
3. Resource refs are lightweight tags under
   `refs/tags/agent-claims/masterplan/`:
   - `id-<ID>` for every selected rule and associated contract/scenario row;
   - `file-<sha256>` for each exact repository-relative implementation/test path
     (SHA-256 of its UTF-8 POSIX path, without a trailing newline).
   Expand directories into exact paths; overlapping edits to the same file
   require the same resource. Acquire additional paths before editing them.
   Own uniquely named checkpoints need no shared file lock. `coverage.json`
   uses ID locks: edit only owned rows, preserve others, reconcile during merge.
4. Sort all resource names lexicographically. For each, call `POST git/refs`
   with `{"ref": "refs/tags/agent-claims/masterplan/<resource>",
   "sha": "<receipt-commit>"}`. GitHub creates a ref only if absent.
   An existing ref is occupied even if absent locally. Never update, force-push,
   or overwrite another reservation.
5. On conflict, read the ref and its commit message; release only this attempt's
   refs whose SHA still equals your receipt, refresh ownership, and select
   different work. On an ambiguous timeout, GET the exact ref and treat it as
   acquired only if its SHA equals your receipt. Errors never imply success.
6. Re-read every required ref and verify its receipt SHA. Post
   `CLAIM <IDs> — <agent> — packet <UUID> — branch <branch>` on #673 with
   resource refs, file scope, checkpoint and next action. Save the comment URL.
   Start code only after all resources and documentation are confirmed.
   No coordinator acknowledgement or user assignment is required.

Discover locks using `GET git/matching-refs/tags/agent-claims/masterplan/`
(follow pagination), then read each referenced commit message. Check remote
ownership before extending scope or taking another packet. Local memory,
elapsed time and a CLAIM comment alone are not atomic locks.

Reservations survive pauses with no automatic expiry. Resume only your recorded
session/packet. Never delete another owner's lock. Abandoned ownership requires
an explicit RELEASE/authorized handover recording the branch, checkpoint,
original criteria and next action.

## Claude reservations through a Codex proxy

Use the same `masterplan-reservation-v1` receipt, GitData endpoints, lightweight
tag namespace and sorted create-if-absent operations above. Comments, branches
and coordinator acknowledgements never replace resource refs.

1. Read the Claude owner's documented request and refresh actual main, live
   refs, original custody, open/retained PR scope and dependencies. Require
   exact IDs, files, branch, packet and checkpoint. An absent ref, idle chat or
   closed PR is not a custody release. A requested split of foreign source
   work requires that source owner's explicit approval before acquisition.
2. Create the receipt on actual main's exact tree with main as its single
   parent. `receipt.agent` is the requesting Claude work owner, not the proxy;
   add `delegatedBy` identifying the executing Codex agent. Preserve the other
   receipt fields and the requested packet/scope. The proxy acquires no
   implementation ownership through this operation.
3. Acquire every sorted resource using `POST git/refs`, never update/force an
   existing resource. On conflict or failed acquisition, reconcile ambiguous
   outcomes with exact GETs and roll back only refs whose SHA equals this
   attempt's receipt. A ref with a different SHA is foreign and must remain.
   Document failed or unresolved rollback; partial acquisition is not clearance.
4. Re-read every required ref and verify the exact receipt SHA before posting
   the reservation receipt/CLAIM or telling Claude to implement. Include the
   work owner, proxy, complete resources, receipt SHA, checkpoint and next
   action on #673. Claude also verifies the remote refs before implementation.
   Report any denied/unavailable GitData operation concretely; permission in
   this document does not establish working credentials or platform access.
5. Reservations have no automatic expiry. Release on behalf of Claude only
   after that work owner's documented delivery/handover release request,
   recording remaining criteria and checkpoint. GET each requested resource,
   require its SHA to equal the exact original receipt SHA, then DELETE only
   those resources and confirm absence. A mismatch or unverified delete stays
   unresolved; neither elapsed time nor proxy discretion permits release.

This proxy authority does not permit foreign lock takeover, unclaimed edits,
test/security weakening, bypassing review/CI/merge gates, platform administration
or branch-protection bypass. The owner update changes no session proxy policy.
Requests [P-08](https://github.com/heke99/gridex-ops-platform/issues/673#issuecomment-6056828417)
and [conditional #699 fixture help](https://github.com/heke99/gridex-ops-platform/issues/673#issuecomment-6056854240)
are historical request examples, not current queue statuses or custody grants.
Later actual handover/CLAIM/withdrawal/release receipts and live refs determine
current status. Fresh custody/dependency checks and verified refs remain required;
any still-requested #699 source split needs that source owner's explicit approval.

## Merge, shared memory, and release

Two single-resource roles use the same create-if-absent protocol: `role-merge`
serializes main merges; `role-memory` serializes shared campaign-memory writes.
Acquire a role only for that operation, with its own unique receipt commit.
Agents maintain their own checkpoints and #673 while roles are occupied; no
permanent coordinator is required. Release checks the role's exact receipt SHA.

Acquire `role-merge` after review and required current-head checks are green.
Refresh main; verify the PR's current head, dependencies and owned coverage
rows. Rebase/conflict resolution needs fresh affected checks. Merge with the
expected head. Authenticate actual PR/main SHA, parents and reviewed composition;
release the merge role FIRST with its exact receipt-SHA/DELETE/absence checks,
then record MERGED and remaining resource release in your checkpoint and #673.
Reconcile ambiguous outcomes with actual PR/main state before claiming completion.

For shared campaign-memory writes, acquire both `role-memory` and exact file
custody; the role never grants another writer's reserved paths. Read latest shared
files and receipts, and publish a small reconciled update preserving foreign evidence
and history. Retain the role until delivery or explicit handover. Never wait
for either role while holding the other: release `role-merge` before acquiring
`role-memory`; acquire `role-merge` only if immediately free when delivering a
memory update, otherwise release `role-memory`, refresh and retry later. This
avoids deadlock. Your own checkpoint and #673 receipt remain mandatory first.

After actual delivery or an explicit BLOCKED/RELEASE handover, post RELEASE
with remaining work and checkpoint. GET each owned resource SHA and DELETE
`git/refs/tags/agent-claims/masterplan/<resource>` only when it still equals
your receipt. Failed documentation/release remains unresolved ownership;
finish reconciliation before starting another work item. A blocked item may be
retained for its named resumption event; retaining it is not RELEASE or permission
to start a new packet. After actual delivery or an explicit relinquishment, finish
verified owner-only resource release first. Then refresh main, coverage, memory,
#673, relevant historical #530 receipts and locks, and select the next eligible
plan packet or executable blocker within the chat's fixed role.
