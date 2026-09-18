# PR330 — first-six D review remediation

Status: IN_PROGRESS. Original ZIP candidate was recovered exactly and published
as `0a89e102956fc582f879b391b3ab466d40c5f178` (treeaa624c9b), and all four ordinary
PR workflows passed. Independent reviews5730637320/5730659831 then found a real
wire-versus-row policy-selection bypass; that head is NOT merge-approved.

Branch: `codex/ediel-v2-dependent-conditions-20260918`. PR:330. Base main:
`b916213e83871e9f4d15b9fd52a2b8c19394c9ca`. This file is a prepublication snapshot
of the review correction. Read actual GitHub head/checks/comments/merge state
before continuing; once merged, do not reopen the resolved publication task.

The follow-up reparses real PRODAT bytes before choosing sync/registry policy,
so row code/family and a stale parsed cache cannot suppress Z09:216 through Z06E.
Row preflight also uses the actual wire family. The new six-rule source table,
its records and nested outcomes are frozen. Unrelated structured/list inputs
keep their existing parsing path. Detached fragments retain existing semantics.

Fresh same-source local verification:2474/2474 application tests in236 files,
including34 new review tests;851/851 retained source cases. App/scripts/tests
TypeScript, unchanged coverage thresholds, lint, integrity, mechanical checks,
quality tests, RBAC and unchanged large-file budget passed. Coverage35.52lines,
34.10statements,27.01branches,40.92functions. Lint warnings are retained. Original
prepublication qualification remains historical; fresh report/source hashes are
in `quality/audits/ediel-masterplan-v2/f3-d-review-remediation-20260918.json`.

Required next: publish the review correction, run four ordinary workflows on
that exact head including build/replay/coverage, obtain substantive independent
rereview, resolve findings, then freshly recheck main/head/rules/reviews and merge
with expected-head protection. A generic skipped bot success is not review.
Only after accepted merge continue the original D inventory and later masterplan.

Scope remains SIX numeric D cells:Z06:508/217/306/254 andZ09:216/217. The other104
numeric cells,10 additional parent-group conditions, full F3–F7, live TGT and
release certification are not closed by this unit. PR310 remains paused at
e961135199f292b8210884f07de3b616a670161a and must not be imported.

Existing main full-certificate35334649693 failed3/73 steps (migration inventory,
Z18 certification assertions, installation NAD assertion); ordinary PR smoke
success is not full-main release acceptance. Preserve those failures in issue329.
Read-only Vercel inspection confirmed Git automatically deployed mainb916 after
PR328 (dpl_FGdJHZcwuqGevG7npMdTnwu4mvBr,production,READY). A main merge can therefore
trigger automatic deployment. Do not claim that no automatic deployment occurred
merely because no explicit deploy tool was called. No deployment settings, DB,
SQL/types/grants, normative documents or actual market messages were changed here.
