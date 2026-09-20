# Verification matrix — PR359 actual-main accepted

- BaselineRED:9e286f86 ordinaryOPS35541596324/job106160145134:4986PASS/2FAIL/4988. Original death-status andmeter-change list regressions fail throughFTX dispatch.
- Test-firstRED:b9dcfd12 ordinaryOPS35542420917/job106162367119:5003PASS/7FAIL/5010; five new semicolon-header cases+two unchanged old failures. The other17 new security/format controls pass. Receipt5753239618.
- Finalreviewedhead:d4e784735f9d0f2d61aca334138d762fbfe8d7fa. OrdinaryOPS35542626686,PRsmoke/coverage35542626691,browser35542626700,masterplan35542626689SUCCESS. Final independent5753276222 fourPASS. Prior PRartifact identification error retracted5753267814 and independently resolved; PRsmoke15 is notfull73.
- Guardedmerge:actual71d2adf8b8b5f4305683a1399ddb5c17f0808ee8, tree653f0d8409b76a1c4b18977684a8d10424a1c742 equals reviewedtree. PR359closed/merged.
- ActualmainFULL:35543165596/job106164372691COMPLETED/SUCCESS; artifact10615935216,86287bytes,79entries,ZIP SHA2560358ad44ea13560186879e8dfe1d3a1dbc721b5450046fabe68d3d2da1620a1f matches metadata. Modefull73/73,0failed; all73rows/JUnit andhandoffcommit71d independentlychecked. Coverage106164372607SUCCESS.
- ActualmainUNIT:logs/71-unit-integration-tests.log SHA2566f6d0b3282a26ca7dfa010aaeb213c9a1144f89ccb033e5ef87da32e22df576a;317/317files,5010/5010tests. Explicit newformat22,retainedSMTP18,unchangeddeath-status11/meter-change10,nativeFTXwrapper1PASS. The wrapper's273 assertions are not added again to5010.
- ActualmainOPS:35543165613; quality106164372382,verify106164372451,replay106164372531 allSUCCESS throughcleanup.
- Rootacceptance5753333308; canonicalreceipt pr359-main-acceptance-20260921.json. No current local repository-suite execution is claimed; local work independently inspected downloaded CI bytes.
- RemainingF3: current-owner and actual-test inventory only; per-source criterionmapping/independent acceptance stillneeded. Named green suites are not blanket74-field/fullF3 evidence.

D110/110+10/10 unchanged; fullF3/masterplanNOT_COMPLETE. PR310paused/untouched. No liveDB/provider/market/settings/explicitdeployment actions. Previous pendingmatrix preserved at3ffda9ea/71d2adf8.
