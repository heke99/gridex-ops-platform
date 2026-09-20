# Verification matrix — actual main and next F3 plan

| Scope | Exact evidence | Result |
|---|---|---|
| Historical D acceptance | Final independent5751354872 |110/110 numeric+10/10parents ACCEPT |
| PR357 correction review |5751469000 atc491c45f |Documentation review PASS |
| PR357 ordinary CI |35526367541/35526367525/35526367520 |All applicable SUCCESS before merge |
| PR357 actual merge |5e3cb079cf2901be42964198d79b2ceab755f28f |Treeb1f7c9ff910488c57242e171f501b033e3e103b5 matches reviewedhead |
| Actual-main full |35526699955/job106120005646, checkedout5e3cb079 |73/73,0failed,Node22.23.2 at2026-09-20T17:51:09.0886197Z |
| Actual-main coverage |106120005755 |SUCCESS; no new detailed count inferred |
| Actual-main OPS |35526699936/jobs106120005429/5506/5536 |AllSUCCESS; identifiers in JSON receipt are full |
| Actual-main Ediel/browser |35526699928/35526699997 |SUCCESS |
| Automatic Vercel workflow |35526700002/job106120005867 |Actual create/wait deployment SKIPPED; no deployment receipt |
| Main root acceptance |5751554333 |PR357 publication ACCEPTED |
| Next F3 plan |f3dcf649, independent5751554605 |Four plan verdicts PASS; execution gates retained |
| E011/ENV-04 |Static review5751514908 |Confirmed static omission; runtime RED/fix not completed |
| Original T24.A source gate |Manifest only, partial excerpts |Fresh full hash/page inspection NOT_COMPLETE |
| Complete consumer/design gate |Shared route inspected; all routes still required |TaskA NOT_COMPLETE |
| Full F3/masterplan |Criterion reconciliation still open |NOT_COMPLETE |
| PR310 |e961135199f292b8210884f07de3b616a670161a |OPEN/DRAFT/PAUSED; untouched |

Detailed actual-main receipt: pr357-main-acceptance-20260920.json. Historical artifact upload digest was read, not independently rehashed. No new local repository tests, originalPDF inspection or live operation claimed. New branch checkpoint is not certified by parent5e3cb079 CI.
