# Verification matrix

Historical matrix: `archive/20260916-main-de098106/verification-matrix.md` (identical bytes).

## 2026-09-16 — independent F1-A

Scope/source: code commit66d51ec087e8855e1c672c09e13764f6c008d921,
tree f851b9dd04c4e0b784ed2d131d66f4b37b5551f5, main parentde098106.
Run35133517653 SUCCESS; artifact10462311090 ZIP SHA256
`8fbfda03a3788f8b070db46768afb7077bf9ad0dac08ff86979e1c89b12b20a9`.

- Direct actual-source Node tests:23 pass. Same fixed tests against pristine main:14 fail/9 pass.
- Actual runtime/public-validator integration and retained regressions:62/62 pass in7 files.
- Full Vitest:1220/1220 pass in201 files (1216 baseline).
- Application and tests TypeScript:pass. Changed TypeScript lint:0 errors.
- Existing ESLint ignores the CJS harness; not reported as CJS lint coverage.
- Immutable source package:33 files,121 rules,231 contracts verified, not application conformity.
- Final normal PR CI, build, live DB/transport and release:NOT asserted here.
- PR310 native/schema/types:PAUSED, not accepted by these independent results.

## 2026-09-17 — F1-C

Before19/98; after98/98 underUTC,Europe/Stockholm,Pacific/Apia. Existing112/112 pass. APERAK guard/spec integrity/diff check pass. Full CI pending; npm local ENOTCACHED.

## 2026-09-17 — verified merge322; F3-C in progress

PR322 merged b1e07728 after OPS35191395738,Ediel35191395581,browser35191395542,
fullE2E35191395541 success, successful CodeRabbit and no unresolved review threads.
PR319 closed superseded. F3-C reproduced83/116 failures, now124/124 new source
cases and210/210 retained pass. Full dependency consumer16 cases and normal CI/
review/merge pending. See f3-characteristic-fields.md. PR310 untouched.


## 2026-09-17 — F3-D checkpoint

F3-D source-only:105 new cases (base23pass/82fail) +334 retained =>439pass. 21 Vitest consumer cases added, not executed. Full typecheck/build/CI/merge NOT verified.

## 2026-09-17 — F3-E checkpoint

F3-E129source cases129pass, corrected base62pass/67fail;439retained pass.19Vitest cases pending normal CI. Audit:f3-document-fields.md.

## F3-F local checkpoint

Final264NAD cases: base30pass/234fail, candidate264pass. Combined848source casespass; immutable33/121/231 and unchanged large-source-file budgetpass. Real Vitest/full TS/lint/build/ordinary CIpending. Pure boundary mocks, no live DB or market acceptance.

## PR326 publication and qualification correction

Initialaadcd597/treee3b2a640 published; ordinary initial CI not qualified.
Verified locked dependency artifact10496783500 enabled actual local Vitest:
initial1334pass/6fail; corrected1347/1347pass in209files, including50NAD cases.
848source cases/integrity/budget pass. See f3-party-qualification.md for genuine
UNA reader failures and documented synthetic fixture corrections. Final
ordinary CI/review/merge remain required. PR310 paused, no production changes.
