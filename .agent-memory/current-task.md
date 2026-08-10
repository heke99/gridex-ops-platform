# Current task

Updated: 2026-08-10

Status: `IN_PROGRESS`

Active work item: post-`#105` codebase health residual remediation on
`cursor/codebase-health-and-stability-ee51`.

## Active subtask

Land tip-based O-008 PUBLIC privilege hardening and repair the `#105` C28
control drift, then open a PR that supersedes stale residual `#102`.

## Confirmed findings in this pass

1. **C28 control drift (TRUE POSITIVE)** — 57-point regression asserted
   `platform_release_receipts_deployed_by_idx`, but the schema FK/index use
   `recorded_by` / `platform_release_receipts_recorded_by_idx`. The merge
   message claimed 57/57, but OPS hardening CI did not run the script and the
   local control failed on `main@09edc18f`.
2. **O-008 PUBLIC residual (TRUE POSITIVE)** — `20260809131500` revokes from
   `anon`/`authenticated` only; PUBLIC grants can still re-expose readiness
   SELECT. Unmerged tip residual `#102` used pre-`#105` timestamp
   `20260809151500`; replay as `20260810230000` after the new migration tip.

## Exact next action

PR `#106` opened from `ee51`. After CI is green: apply `20260810230000` on
`gridex-ops-dev`, supersede/close stale `#102`, then continue external release
evidence gates.
