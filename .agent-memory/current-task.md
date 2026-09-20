# Active task — PR359 FTX format-routing CI correction

Only active item: PR359, branch codex/ediel-f3-phase-closure-20260920. Continue published9e286f86; source/design and first-PRODAT review are retained, not restarted. Status: IMPLEMENTED_NOT_VERIFIED.

Ordinary9e286f86 OPS35541596324/job106160145134 npm test actually failed2/4988 existing list-routing tests through prodatFreeTextSendIssues. New test-first commit b9dcfd12da7dcdfa90b20b8a2f994ce57f1d4423 adds22 direct/preflight/actual-SMTP controls. This revision narrowly requires the real default '+' delimiter instead of arbitrary punctuation, preserving UNA/custom alphabets and real syntax failures. No old assertion is changed.

NEXT: read quality/audits/ediel-masterplan-v2/f3-ftx-format-routing-20260921.md and fetch actual branch/head/main. Verify unchanged ordinary CI on the final revision, including both existing failing suites,22 new tests,18 prior actual-SMTP tests, both native harnesses, all typechecks and fullE2E/OPS. Request independent exact-head TASK/SPEC,QUALITY,TENANT-BOUNDARY,WHOLE-PR review. Prior review5753117905 was not whole-PR acceptance. Merge only with terminal required checks and final review satisfied, using expected_head_sha. Then verify actual merge commit73/73 plus allOPS and save receipt before remainingF3.

Last accepted main remains352fd8ee/PR358. D110/110+parents10/10 unchanged; fullF3/masterplan NOT_COMPLETE. PR310 stays OPEN/DRAFT/PAUSED ate961135199f292b8210884f07de3b616a670161a; no import/restart/write/merge or liveDB/provider/market/settings/explicitdeployment. Previous task snapshot remains in Git atb9dcfd12.
