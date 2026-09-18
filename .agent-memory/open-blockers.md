# PR328 remaining acceptance gates

Recovery and the previously reported14 local register errors are not the current
blocker. The continuation is published as06493a26; review corrections atop it
are locally green, awaiting publication, exact-head CI and independent rereview.
Do not merge merely because local coverage now passes. All nine old review
threads must be substantively rechecked and new findings handled.

# PR328 register review remediation — single active task

Status: LOCAL_PASS_PENDING_NEW_HEAD_CI_AND_REVIEW.
Branch: `codex/ediel-v2-prodat-register-rules-20260917`. PR328 is open and ready
for review, not merged. Base for these fixes is `06493a26d4cb320ed31f38de8e308bf87b50bb1c`
(tree `f0a60721506c92171e2a15df9e5d8ac8a56e702d`), not old2c11f27.
The recovered implementation is already in GitHub; do not restart recovery.

Nine review findings and three additional source-selection/dependency findings
were addressed. Real admin-to-orchestrator tests now prove multi-object approval
and B-only retry after A committed; per-company write permission is enforced
before facts are stored. Both builders reject invalid runtime agency; unsupported
coded attributes reject; null-company CAS, Z05 source identity and source-message
marker identity are corrected. Historical source qualification is explicitly
corrected rather than rewriting failed exit1. Read the review audit for details.

Fresh same-source local qualification: 2291/2291 application tests in233 files,
477 register cases in20 files (subset of2291), 851/851 unchanged retained source
tests, all three TypeScript projects, lint, integrity, mechanical, quality tests,
RBAC and size budgets pass. Coverage passes unchanged thresholds. New source
manifest and command/log digests are in the review JSON; source drift is empty.
No claim of new-head ordinary GitHub CI or completed independent rereview yet.

Next action: publish exactly this candidate, re-read the actual head, request
substantive rereview of all nine threads, run all four ordinary workflows including
build/replay/coverage, fix any real findings and requalify before guarded merge.
Evidence: `quality/audits/ediel-masterplan-v2/f3-register-review-20260918.md`
and `.json`. Old local/CI evidence is historical, not new-head acceptance.

PR310 remains PAUSED at e961135199f292b8210884f07de3b616a670161a and excluded.
PR327 remains MERGED as51c73950515d771d2c2edcb97fde28ab087437a3.
No schema/SQL/generated types, original specification, dependencies, production
data/storage, explicit deployment or real market messages changed. Existing
per-object atomicity, original-actor retry and legacy-namespace blocks remain.
The separate original110D condition review starts only after register merge.
