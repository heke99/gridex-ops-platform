## 2026-09-18 — PR330 message-scope correction, LOCAL ONLY

Finding5731012182 reproduced and repaired;2502 application/851source cases,
3TS/coverage/quality pass. New28cases included, not added twice. Remote b3afa
not accepted for merge. Fresh publication/CI/review required; see current-state
and f3-d-message-scope-review-20260918. Earlier entries below remain historical.

## 2026-09-18 — PR330 recovery and review correction (current snapshot)

Original exact candidate0a89e102 published;four ordinary workflows green.
Independent reviews5730637320/5730659831 identified row-code suppression of
wire-requiredZ09:216. Refined33-case red baseline32fail/1pass;34 review cases
now pass (one additional list regression reproduced and repaired). Fresh2474
application/851retained-source cases and all3types/coverage/quality gates pass.
New-head CI/build/replay and substantive rereview are still required before
merge. See `current-state.md` and f3-d-review-remediation-20260918 audit.
Existing main70/73 certificate and automatic Vercel Git deployment are recorded,
not hidden or certified by this PR. PR310 paused;other104D/full plan unverified.

---

## Older entries below are historical

## 2026-09-18 — current D-condition local checkpoint

PR328 is verified merged as b916213e. Six subtype-derived D cells and their
canonical/row/send gates are implemented locally. 2440 application cases
(including 146 new cases), 851 retained source cases, three TS projects and
unchanged coverage/quality gates pass. Final full local build and bundle budget
pass with a 3072 MiB process cap. The first SIGKILL and second heap exhaustion
remain recorded as failed attempts. No new publication, PR, remote CI or merge.
Source audit: `quality/audits/ediel-masterplan-v2/f3-d-subtype-qualification-20260918.json`.
Next: guarded publication and exact-head CI/build/replay/review before merge.
The other 104 D cells and later masterplan phases are not certified by this unit.
PR310 remains paused; no live operations or database/schema/dependency changes.

---

## Historical entries below — not current active-state instructions

# Active verification — F3-G

|Evidence|Observed result|Boundary|
|---|---|---|
|Pristine main31b4,237 new tests|66pass/171fail|No production incident count|
|New DTM tests|267pass|Real modules, explicit in-memory DB boundaries|
|Full local Vitest|1701/1701,213files|267 included|
|Retained source regressions|848/848|Original sources unchanged|
|App/script/test TypeScript|PASS|Current implementation|
|Lint/timezones/integrity|See f3-date-qualification.json|Warnings not hidden|
|Ordinary new-head CI|REQUIRED|Old326 green not a substitute|
|Substantive review|REQUIRED|Generic skipped status not approval|
|PR310/schema/live/TGT|PAUSED/NOT_CERTIFIED|Not accepted by this unit|

Prior matrix archived unchanged under archive/20260917-before-dtm-f3g.

## PR327 review correction (prepublication)

New review tests:113/113 after45pass/68fail baseline; containing boundary143/143.
All application tests1814/1814 in213 files; retained source848/848. Three-zone
DTM suite380/380 in each zone. Counts overlap and must not be summed.
Normal exact-head CI and rereview pending. No live database certification.


## 2026-09-17 — partial register implementation checkpoint

Original PRODAT26.A revision3 PDF was retrieved from the public Ediel portal and matched the locked SHA256 83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95. The first/additional-register source table is recorded in f3-register-source-map.md/json. Local final checks passed: 146 new register cases; full Vitest 1960/1960 in217 files; 848/848 retained source cases; application, test and script TypeScript; unchanged original package integrity. These are local checks, not ordinary GitHub CI or independent review. No complete GOV-02/P-05/F3 certificate is claimed.

Implemented partial scope: distinct314/258, preserved raw and effective register data, object-isolated first-register authority, register overlays composed with the existing matrix/D engine, generic and profile builders, compatibility/staging preservation and one TGT comparison path. See the audit for exact boundaries, fail-first evidence, the retained Z06 subtype-fixture correction and CAV reader compatibility correction.

Status: PARTIAL/NOT_MERGE_READY. Source transport is not qualification. Immediate next action: actual TGT source grouping/rendering tests and integration. Evidence: `quality/audits/ediel-masterplan-v2/f3-register-progress.md`, `quality/audits/ediel-masterplan-v2/f3-register-checkpoint.json`. PR310 paused; no production changes.


## 2026-09-18 recovery checkpoint

Recovered source and reconstructed runtime are saved with fresh fail-first tests;343 register cases pass. Final qualification/publication/review pending. Evidence: `quality/audits/ediel-masterplan-v2/f3-register-recovery-20260918.md`. PR310 paused; Supabase read-only; no market sends.


## 2026-09-18 review remediation (not merged)

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
