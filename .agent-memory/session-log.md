# Session log

Historical log preserved byte-for-byte: `archive/20260916-main-de098106/session-log.md`.

## 2026-09-16 — user-authorised pause and independent continuation

User chose to pause PR310 rather than bypass its gates. Created and verified recovery
ref e9611351, marked PR title/body PAUSED and left the existing native job intact.
Preserved exact source history and portable schema artifact in a verified user ZIP.
Started F1-A from actual main de098106. Reproduced lost selected reference and wrong
revision acceptance on real source with synthetic RPC only. Corrected both callers
and evidence identity checks. Fixed tests:14 fail before,23 pass after.
Run35133517653 additionally passed62 integration cases,1220 full tests and typechecks,
and published exact code tree as66d51ec0 to the independent branch only.
Next: final PR CI and further bounded F1 work. Main/PR310 source/hosted DB untouched.

## 2026-09-17 — continuation

Read live GitHub:318/320/321 merged; restored verified main71dc tree fromartifact10470382510. Reproduced guide immutability/calendar defects, implemented and locally tested F1-C; full CI next. PR310 untouched.

## 2026-09-17 — verified merge322; F3-C in progress

PR322 merged b1e07728 after OPS35191395738,Ediel35191395581,browser35191395542,
fullE2E35191395541 success, successful CodeRabbit and no unresolved review threads.
PR319 closed superseded. F3-C reproduced83/116 failures, now124/124 new source
cases and210/210 retained pass. Full dependency consumer16 cases and normal CI/
review/merge pending. See f3-characteristic-fields.md. PR310 untouched.


## 2026-09-17 — F3-D checkpoint

Continued from actual main5a741b2c after PR323. Implemented source-exact RFF projections and consumers, tested real source modules and synthetic DB boundary. GitHub read-only action set and unavailable npm installation block publication/full CI. Work saved locally; no live mutation or PR310 changes.
