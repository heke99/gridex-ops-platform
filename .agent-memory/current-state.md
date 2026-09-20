# Current state — PR359 format-routing correction

PR359 remains IMPLEMENTED_NOT_VERIFIED on codex/ediel-f3-phase-closure-20260920. Source/design and first-PRODAT work at9e286f86 are retained. Actual ordinary npm test at9e286f86 failed2/4988 tests because UNH-semicolon list data entered the FTX EDIFACT tokenizer. The new bounded correction changes only that dispatch expression;22 additional tests were published first atb9dcfd12. Final exact-head CI and independent review are required, not yet claimed.

Authoritative continuation: current-task.md, checkpoint.json, and quality/audits/ediel-masterplan-v2/f3-ftx-format-routing-20260921.md. Resolve actual branch/main before writes. After green reviewed PR: guarded merge, actual-main73/73+OPS, durable receipt; then remainingF3 only.

PR358/E011 remains accepted at352fd8ee9129697b55c1d3796fb99ed04ca0d6f5 (receipt pr358-main-acceptance-20260920.json; root5752720765). D110/110+10/10 unchanged. FullF3/masterplan NOT_COMPLETE. PR310 OPEN/DRAFT/PAUSED ate961135199f292b8210884f07de3b616a670161a, untouched. No liveDB/provider/market/settings/explicitdeployment action. Prior state is preserved atb9dcfd12.
