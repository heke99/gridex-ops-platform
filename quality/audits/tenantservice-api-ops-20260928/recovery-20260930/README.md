# Tenantservice recovery handoff — 2026-09-30

## Purpose and boundary

This is a documentation-only recovery package for a new agent, requested by the user after repeated stalls. It is NOT a runtime fix, not an integration of the two active PRs, and not certification of P0–P8. The handoff commit is based on the published API commit solely to retain the existing master instructions. Do not use the handoff branch as a replacement implementation branch or merge its whole tree into OPS.

Continue the existing draft structure: #418 owns shared OPS/database work; #422 owns the dependent API work. Read NEXT-AGENT-PROMPT.md in this directory, then the existing ../masteruppdrag.md and ../requirements.csv. The original T01–T55 and U01–U20 requirements remain authoritative and unchanged.

## Freshly observed remote state

| Surface | Ref / SHA | Evidence |
| --- | --- | --- |
| main | 53bf989b0ad402bb2ce151c186eea31f1ec9cf03 | Direct Git ref read |
| OPS #418 | codex/tenantservice-api-ops-20260928 @ ae56ee0a1e0e8adbce9d5f4d92da75cdcb8010c8 | Direct Git ref; NOT the old 7afb3dca summary |
| API #422 | codex/tenantservice-api-structure-20260929 @ cc90678d45602d37db7f8edf9713597c66fee28a | Direct Git ref and PR metadata |
| API's recorded tested base | 7afb3dcac62376edc5cab24c83ebcce80cb06e9a | #422 metadata/check evidence; newer OPS must be reconciled separately |

Newer OPS work was published as ac57248b5db52d67b71013156cb97e00f7a640d2 (atomic notification read command), followed by ae56ee0a (generated schema/types adoption). It must not be lost by using the stale PR-body headline as the latest head. ae56ee0a parent is ac57248b; its tree is 074d6dad73df47d25e097a5bf523d70c4a3a0946. API cc90678d tree is ae26888d6170c0439bbcaa0a8cad71b8870bb187.

## CI checked during recovery

- OPS run 36737320079, head ae56ee0a: verify 109962310920 SUCCESS, quality-release-gates 109962310464 SUCCESS, clean-migration-replay 109962310742 SUCCESS. Replay completed 2026-09-30T15:42:00Z.
- API head cc90678d: clean-migration-replay 109889422728 in run 36716141163 SUCCESS, completed 2026-09-30T12:50:28Z. PR records verify 109889422824 and quality 109889422495 as successful as well; their detailed outputs were not re-downloaded in this recovery.
- These are individual published-candidate checks, NOT evidence for unpublished local changes or the as-yet reconciled pair of current branches.
- Full raw logs and artifact ZIP bytes were not downloaded or rehashed by this recovery. Historical artifact hashes in prior receipts are preserved references, not newly certified hashes.
- No manual rerun was started. No CI/security threshold or workflow was altered.

## Backups created

- backup/tenantservice-ops-20260930-ae56ee0a pins the observed OPS commit.
- backup/tenantservice-api-20260930-cc90678d pins the observed API commit.

Keep these snapshot refs unchanged. The active implementation branches and PR bases were not modified by this recovery.

## Important unknown: previous agent's local work

The current recovery container contains earlier planning attachments but no mounted gridex-ops-platform Git checkout. Therefore it could not inspect, stop, commit, or save the previous agent's working tree, subagents, or unpushed history. Do NOT claim those files are backed up by the refs above.

Recent ownership comments mention one integrator and six file owners (notification SQL/native, API/profile, OPS UI, support/portal, billing, HTTP/contracts). The user's recent transcript reports a Next.js 16.3.8 patch, session/RPC hardening, post-lock owner rechecks, customer-card tests and release finalization. These later changes have NOT been matched to accessible commits in this recovery. The prior published API package declares 16.3.5; do not infer that the reported patch is present or absent in an inaccessible local checkout. Verify the official advisory and package/lock/installed version before a dependency decision; do not hard-code an unverified patch release.

Preserve the original agent environment. The next agent must inspect available worktrees and recover/compare local changes before replacing or rebuilding the same work. If that workspace is not available, record the missing work explicitly, avoid destructive actions and competing publication, and proceed only with a deliberate clean continuation from accessible commits after ownership is clear. A PR comment does not mechanically terminate the previous agent.

## Concrete next operation

1. Secure exclusive publication ownership; inventory recoverable local work without deleting anything.
2. Compare OPS ae56ee0a, API cc90678d, and newer recovered work. Do not reimplement existing contact, delegation or event-v2 foundations blindly.
3. Integrate the already published notification prerequisite into the API candidate using a reviewed non-destructive history-preserving approach after ownership is established. Do not rewrite schema artifacts from a different migration set.
4. Recover or finish the notification API adapter and actual GET → POST mark-read → replay → GET → native readback, including current authorization and post-lock checks. Existing SQL proof does not prove this HTTP chain.
5. Reconcile the reported local security/UI/billing work, settle runtime inputs once, then finalize and verify OpenAPI deterministically.
6. Continue ALL remaining P0–P8 work; a green intermediate packet is a checkpoint, not the end of the assignment.

## Source locations

- https://github.com/heke99/gridex-ops-platform/pull/418
- https://github.com/heke99/gridex-ops-platform/pull/422
- https://github.com/heke99/gridex-ops-platform/pull/418#issuecomment-5913321051
- https://github.com/heke99/gridex-ops-platform/pull/422#issuecomment-5913321345
- https://github.com/heke99/gridex-ops-platform/pull/418#issuecomment-5914108584
- https://github.com/heke99/gridex-ops-platform/actions/runs/36737320079
- https://github.com/heke99/gridex-ops-platform/actions/runs/36716141163
- OPS ae56ee0a: quality/audits/tenantservice-api-ops-20260928/notification-command-candidate-20260930.md
- API cc90678d: quality/audits/tenantservice-api-ops-20260928/api-event-v2-evidence-20260930.md

Read current refs and new comments again before any write. Older README/handover sections contain superseded next steps; preserve their evidence history without treating them as current instructions.
