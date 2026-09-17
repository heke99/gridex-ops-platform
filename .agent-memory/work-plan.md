# Active state — F3-G PRODAT DTM fields

Main `31b4dbeb764874e252e8b6b510bf1fa78832f148` includes completed PR326. The one active unit is the twelve mapped
PRODAT DTM fields and identified builders/readers/consumers, branch `codex/ediel-v2-prodat-date-fields-20260917`.
Implementation and local tests complete; new ordinary exact-head CI, substantive
review and guarded merge REQUIRED. Do not use old #326 green status as approval.

Local full suite1701/1701 in213files; new267 included. Pristine-base237 tests
reproduced66pass/171fail. Retained source848/848. Application/script/test types pass.
See quality/audits/ediel-masterplan-v2/f3-date-fields.md and qualification summary.
No live certification; no SQL/generated types/grants or external Ediel message.

Next: publish candidate, run all ordinary CI, resolve review, merge exact green
head. Only then register/dependent rules. Keep PR310 paused at e9611351; no import
of its schema/replay/types. This checkpoint is pre-publication, not a merge record.
