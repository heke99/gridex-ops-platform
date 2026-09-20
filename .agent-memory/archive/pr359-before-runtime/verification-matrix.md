# Verification matrix — accepted PR358 and bounded next inventory

| Scope | Evidence | Disposition |
|---|---|---|
| D/parents |5751354872|110/110+10/10 accepted|
| PR357 main |5e3cb079;pr357-main-acceptance-20260920.json|Historical accepted baseline retained|
| PR358 source/design |5752177628;5752208557|Corrected Task A and bounded amendments approved|
| Earlier RED |5752201323|42cases:7pass/35fail;original record preserved|
| Final-oracle baseline recheck |Root5752578522,base9d87|64cases:23pass/41fail;distinct from original RED|
| Final native UNB |Root4058075155|64/64 pass,0skip on localNode22.16.0|
| Wrapper report controls |4058069931 fixed92d31ff;resolution4058076533|Before3/8correct,after8/8;actual callback with shim,not a Vitest rerun|
| Existing source-family regressions |Root5752660031|672/672 pass;not all74-field acceptance|
| Final independent review |5752664226 at92d31ff|TASK/SPEC,QUALITY,TENANT-BOUNDARY,WHOLE-PR PASS|
| Final PR CI |OPS35537287880,Ediel35537287835,full35537287827,browser35537287843|All SUCCESS before guarded merge|
| Actual merged tree |352fd8ee ->71342c9704fbaab3117172e7b63f38440a182727|Exactly equals reviewed final tree|
| Actual-main full |35537694406/job106149566172;artifact10613434626|73/73,0fail;ZIP digest independently recomputed;report/JUnit inspected|
| Actual-main unit suite |Artifact log71-unit-integration-tests.log|314files;4969/4969tests passed|
| Actual-main OPS |35537694345/jobs106149565685,106149565753,106149565763|Replay,verify,quality allSUCCESS|
| Actual-main Ediel/browser/coverage |35537694353/35537694441/35537694406|Applicable jobs SUCCESS|
| Deployment/staging/load/nightly |Existing conditional jobs|Skipped steps NOT counted as execution/live approval|
| Root main acceptance |5752720765;pr358-main-acceptance-20260920.json|Bounded E011 VERIFIED|
| Next field inventory |Probe/output under field-inventory-20260920;independent5752706986|74IDs/962base-usage equal;NOT behavioral acceptance|
| Next FTX301/303 |Original-source/scoped consumers/oracle|IN_PROGRESS;no confirmed new defect or runtime approval|
| Full F3/masterplan |Remaining criteria|NOT_COMPLETE|
| PR310 |e961135199f292b8210884f07de3b616a670161a|OPEN/DRAFT/PAUSED;unchanged|

Earlier pre-acceptance state remains in Git92d31ff. Main receipt is specific to352fd8ee, not a CI certificate for this later documentation checkpoint. No unsupported total-progress percentage.
