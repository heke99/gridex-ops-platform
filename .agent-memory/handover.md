# Handover — PR358 runtime exists; finish verification

Use branch codex/ediel-f3-phase-closure-20260920 and existing PR358. Read pr358-verification-resume.md, current-task.md and checkpoint.json, then fetch current refs before writes. Published runtime is3f6f1fc1db3938ab76185c34d344ae89393efa72, tree41a9df13d3b4cda604616727821567e8c34aa3ab. Do not reimplement from the old source-only snapshot.

Task A correction was independently approved5752177628 at9d87d288. RED42/7pass/35fail was recorded in5752201323. Implementation and approved execution amendments5752208557 are now published. Exact-head ordinary CI and independent runtime review remain pending; the initial bot-triggered runs35534161014/1016/1023/1017/1024 were action_required, not executed passes. See full identifiers in checkpoint.json.

PR357 main5e3cb079 retains its73/73 and OPS acceptance; it does not certify PR358. D110/110+parents10/10 remain accepted. The prior source-only active handoffs are historical and superseded; original audit records and the archived session log remain intact.

Next: current-head CI and review, narrowly fix any concrete failures, guarded merge only after all applicable gates pass, actual-main verification, then remaining F3 reconciliation. No full F3/masterplan acceptance or justified overall percentage. PR310 remains paused at e961135199f292b8210884f07de3b616a670161a; no import/restart/write/merge or live operations.
