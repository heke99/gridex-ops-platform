# Verification matrix — completed PR356 runtime

| Evidence | Exact binding | Result and limit |
|---|---|---|
| User resume | ac53b020e430a2ffa87c09579180355055793393 | Matched live requested branch; handoff read first |
| Resume docs | 92cbc423332e8b2203f65bddc6fcba1390a65493 | 21changedpaths, allagent-memory; runtime unchanged |
| Independent runtime review | PR356 comments5751116589 +5751166277, exact92cbc | Four verdictsPASS after terminal CI; no confirmed blocking defect |
| PR Ediel/browser/full/OPS | 35523069844 /35523069841 /35523069828 /35523069893 | AllSUCCESS, exact92cbc candidate |
| PR actual coverage log | job106110404675 | Node22.23.2,313files,4968/4968; coverage ratchetPASS |
| PR synthetic merge | d1a52660d87ffb6999c59a9d1f1ce4762d1be33a | Tree882156 matches92cbc; not actualmain acceptance |
| Guarded actual merge | PR356 →922a66003abe2f2622a13ed58fd24e57ac95ef5f | Expected-head92cbc; no rule bypass; actualtree882156 matches reviewed tree |
| Actual-main full certificate | run35523710967,job106112104489,checkout922a660 | Node22.23.2,73/73,0failed; timestamp2026-09-20T16:54:24.7997700Z |
| Actual-main full artifact | 10609164187 | 79files;85928bytes; reported ZIPsha2561f14ef0c0a4386f6552455b94a1412d962729a129f9246f8f375faf0780a587b; not independently recomputed |
| Actual-main coverage | job106112104627,run35523710967 | SUCCESS; detailed4968 count above is independently read from PRcoverage log, not inferred from this status |
| Actual-main OPS | run35523710964; jobs106112104279/433/445 | AllSUCCESS, including clean replay, types, quality, production dependency audit and build |
| Actual-main Ediel/browser | 35523711038 /35523710974 | SUCCESS; unrelated staging/load/live jobs skipped, not certified |
| Vercel workflow | 35523710972,job106112104373 | WorkflowSUCCESS, actual create/wait deployment stepsSKIPPED; no deployment receipt |
| Twelve-cell bounded review | comments5751200193 + controlling5751228735 | All12boundedPASS/no new defect; historicalcounter PENDING, not a uniform producer/live blocker |
| PR310 | e961135199f292b8210884f07de3b616a670161a | OPEN/DRAFT/PAUSED, no write |

Root inspected actual GitHub execution logs/metadata; no local repository test execution or originalPDF reinspection is claimed. Historical authorNode24 15gate/4968 receipts remain unchanged and do not substitute for Node22CI. Final docs-only continuation is a new branch checkpoint based on922a660, NOT a new exact-head CI certificate or merged runtime change. Prior matrices remain at92cbc423 and archive/gas-identity-ac53b020/verification-matrix.md.
