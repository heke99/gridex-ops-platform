## 2026-09-18 — null-rejection rereview follow-up (not merged)

Published97f75051 fixed the initial review set and passed all four ordinary CI
workflows, including coverage/build/replay. Rereview4045597721 then identified
the omitted nullable-company rejection variant: two failing status cases were
reproduced and fixed; the38-case application suite now passes. The old PR326
active-state heading is explicitly historical. Latest same-source local checks
pass2294 application cases (480 register subset),851 retained source cases,
all3 TypeScript projects, lint, coverage and other retained quality gates.
The current follow-up still requires publication, final-head ordinary CI and
substantive rereview before guarded merge. Earlier2291/477 numbers and97f75051
CI qualify only their historical head, not this new follow-up.
Evidence: `quality/audits/ediel-masterplan-v2/f3-register-null-rejection-review-20260918.json`.
PR310 stays paused; no SQL/schema/types or live market/production changes.

---

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
