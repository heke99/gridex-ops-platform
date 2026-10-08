# Autonomous Masterplan reservations

Owner decision, 2026-10-06: send every agent the same prompt. Agents choose and
reserve their own next packet; neither the user nor a coordinator assigns IDs.
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

The current pre-dispatch `paused` memory state means no agents have been launched
by this documentation update. Receiving the owner's shared continuation prompt
authorizes that agent's wave and supersedes the earlier blanket new-work pause,
while specific HOLD/PAUSED criteria and external approval boundaries remain.

## Select from current evidence

Fetch current main and read the frozen registers, current coverage, memory,
#673, relevant historical #530 receipts, open PRs and retained legacy PRs.
Finish your existing reservation first.
Reconcile older active claims/PRs before taking overlapping work; an idle chat
or a CLOSED_UNMERGED PR alone is not a release or completed criterion.

Choose two unapproved, unowned rule IDs with compatible dependencies and file
scope, in AGENTS.md priority order. Include the associated contract/scenario
IDs you will implement or approve. When work is acceptance-only, choose two
unapproved contract/scenario IDs instead. A last single eligible ID is allowed.
Assess reusable old PR changes first. Already approved rows are not new work.
Record criteria needing outstanding external permission as blocked and choose
another eligible packet. No eligible work means a completion/blocker handover.

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
are requests only: fresh custody/dependency checks and verified refs remain
required; the #699 source owner must approve the proposed split.

## Merge, shared memory, and release

Two single-resource roles use the same create-if-absent protocol: `role-merge`
serializes main merges; `role-memory` serializes shared campaign-memory writes.
Acquire a role only for that operation, with its own unique receipt commit.
Agents maintain their own checkpoints and #673 while roles are occupied; no
permanent coordinator is required. Release checks the role's exact receipt SHA.

Acquire `role-merge` after review and required current-head checks are green.
Refresh main; verify the PR's current head, dependencies and owned coverage
rows. Rebase/conflict resolution needs fresh affected checks. Merge with the
expected head. Record actual PR/main SHA, update your checkpoint and post
MERGED on #673, then release the role. Reconcile ambiguous outcomes with actual
PR/main state before claiming completion.

For shared summaries, acquire `role-memory`, read latest shared files and
receipts, and publish a small reconciled update preserving foreign evidence
and history. Retain the role until delivery or explicit handover. Never wait
for either role while holding the other: release `role-merge` before acquiring
`role-memory`; acquire `role-merge` only if immediately free when delivering a
memory update, otherwise release `role-memory`, refresh and retry later. This
avoids deadlock. Your own checkpoint and #673 receipt remain mandatory first.

After actual delivery or an explicit BLOCKED/RELEASE handover, post RELEASE
with remaining work and checkpoint. GET each owned resource SHA and DELETE
`git/refs/tags/agent-claims/masterplan/<resource>` only when it still equals
your receipt. Failed documentation/release remains unresolved ownership;
finish reconciliation before starting another packet. Then refresh main,
coverage, memory, #673, relevant historical #530 receipts and locks, choose the
next free packet and continue.
