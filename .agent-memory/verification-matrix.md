# Verification matrix — PR359 format-routing correction

- HISTORICAL REVIEW:9e286f86, independent5753117905 TASK/SPEC+QUALITY+TENANT-BOUNDARY PASS; WHOLE-PR waiting. Not final acceptance.
- OBSERVED RED:9e286f86 ordinaryOPS35541596324/job106160145134 npm test4986PASS/2FAIL/4988; death-status and meter-change format-routing tests reach edifact_dangling_release_character through FTX dispatch. Existing18 SMTP and native wrapper passed in that run.
- TEST-FIRST PUBLICATION:b9dcfd12da7dcdfa90b20b8a2f994ce57f1d4423 adds22 cases, ordinaryOPS35542420917 started; read terminal result, not inferred.
- SUPPORTING LOCAL EXPERIMENT ONLY: isolated Node old/new dispatch expression;5 old list false positives,18 candidate classifications PASS. Not an execution of the repository test suite.
- PENDING: new final-head ordinary npm test (original regression suites unchanged), both native harnesses,18 existing SMTP+22 new cases, all typechecks, fullE2E/coverage and allOPS.
- PENDING: independent final-head TASK/SPEC,QUALITY,TENANT-BOUNDARY,WHOLE-PR, guarded merge, actual-main73/73+OPS and receipt.

Current evidence: quality/audits/ediel-masterplan-v2/f3-ftx-format-routing-20260921.md. Previous matrix remains in Git atb9dcfd12 and archive/pr359-before-runtime/verification-matrix.md; previous native248/273/648 figures remain historical, not rerun claims.

PR358/main352fd8ee alreadyaccepted. D110/110+10/10 unchanged; fullF3/masterplanNOT_COMPLETE. PR310paused/untouched; no liveoperations.
