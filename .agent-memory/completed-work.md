# Verified progress — PR359 continuation

Retained: source5752810321, design/oracle5752868541, clarification5752898014; published FTX/first-PRODAT revision9e286f86. Independent5753117905 passed TASK/SPEC,QUALITY,TENANT-BOUNDARY at9e but explicitly withheld WHOLE-PR pendingCI. This is historical review evidence, not approval of the format correction.

Observed: ordinaryOPS35541596324/job106160145134 actually ran4988 tests:4986PASS,2FAIL in unchanged list-routing regressions. Traced both failures to the FTX dispatch expression accepting arbitrary punctuation. Published22 additional direct/preflight/actual-SMTP tests atb9dcfd12. Supporting isolated Node expression experiment:5 old false positives;18 candidate classifications passed. No repository-suite GREEN is inferred from that experiment.

The bounded production correction, its final ordinaryCI, independent review, merge and actual-main73/OPS acceptance are not yet entered as completed work. See current-task.md and f3-ftx-format-routing-20260921.md for exact gates. Earlier snapshot remains atb9dcfd12 and archive/pr359-before-runtime/completed-work.md.

Acceptedmain remains352fd8ee/PR358 (pr358-main-acceptance-20260920.json; root5752720765). D110/110+10/10 unchanged. FullF3/masterplanNOT_COMPLETE; PR310OPEN/DRAFT/PAUSED and untouched.
