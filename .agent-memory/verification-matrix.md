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
