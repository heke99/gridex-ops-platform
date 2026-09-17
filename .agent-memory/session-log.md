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
