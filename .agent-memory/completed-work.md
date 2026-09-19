# Completed work — acceptance boundary

Previously accepted on main: PR330 six numeric cells,331 Z04:319,334 Z06:242.
In this execution only LOCAL implementation/qualification is complete: source
UD parent and ten children, actual row/preflight/send/builder tests, fixed
postcode/city retention, object-subtype omission and decoded-width guards.
This section is not a new GitHub acceptance or masterplan completion.

Base main `dcd0e5fa0f6e8949d614bd09b941b22d70acdd1f` / tree `8764838fa530791cfb82403f5c97a0c44f43e675` after accepted330/331/334.
UD candidate tested code tree `fd360cb45d5976b818f0e36f636de6080faa6357`. Local application3093/3093,
302new (subset), source919/919 (913retained+6new), all3types, lint0errors/99warnings,
source integrity, RBAC/quality/budgets and unchanged coverage ratchet passed.
No remote candidate commit/PR/CI/independent review/merge. GitHub tool discovery
is read-only; local Git DNS fails. This is not a repository-permission diagnosis.

Eight accepted numeric D cells +ten candidates +92other=110. Two UD parent
occurrences are candidates, eight others remain. Do not count eighteen accepted
until ordinary exact-head CI, substantive independent review and guarded merge.
Full field229 evidence, F3–F7/masterplan/liveTGT/release are incomplete. PR310 stays
paused/excluded; issue332 historical70/73 stays open/unwaived. No SQL/grants/types,
threshold/dependency/normative changes, liveDB/storage/market sends or deployment.

Evidence: `quality/audits/ediel-masterplan-v2/f3-d-ud-20260919.md` and `.json`.
Prior base memory: `archive/2026-09-19-pr334-final-merged/README.md` (byte-identical).
The archive workbench root is synthetic and MUST NOT be published as repo ancestry.

## 2026-09-19 issue332 local checkpoint

Current main base fda3420e471862b58b55f9beec948ca9efc38f3b includes merged PR336.
18/110 numeric D cells and2/10 parent occurrences accepted in bounded units;92numeric and8parent occurrences remain. Full field229, F3–F7, live TGT and release incomplete.
PR310 remains paused/excluded at e961135199f292b8210884f07de3b616a670161a.
Issue332 is an issue, not a PR. Its three retained failures were reproduced and locally repaired: existing runtime checksum source omitted by inventory; stale Z18/installation source-text checks replaced by actual renderer assertions. No SQL/hash manifests/generated types/thresholds changed. Local23targeted and3116application tests passed. Test typecheck initially failed on two fixture types, then corrected and passed. Node24 local runtime differs from required CI Node22; remote CI is required.
PR335 overlaps336 and contains an unmerged receiving-direction correction that must be reconciled before further D work.
Full73step/remoteCI/merge pending. Scoped independent reviewer found no blocking issue; added distinct production contract dates following minor feedback.
