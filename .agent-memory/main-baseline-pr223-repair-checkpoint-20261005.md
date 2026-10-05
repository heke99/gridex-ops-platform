# Current-main public contract error attribution (#223 residual)

REVIEWED_READY_FOR_PUBLICATION. Isolated base
0e4248c78054b63bf99f0854af2fb3f57431bfff; branch
codex/main-baseline-pr223-repair-20261005. Root claim #223 comment5999116870.
The historical branch and all unrelated source/coverage remain untouched.

Skills: systematic debugging, test-driven development, scoped differential
review and verification before completion. Installed Next route-handler guide
and behavioral-test guidance were read. No database/performance/schema change.

Confirmed defect: a tenant lookup resolves but the independent offer lookup
throws PublicContractFeedConsistencyError before Promise.all completes. The
real GET route then returns503 with tenant_reference:null. Capture the resolved
reference inside the existing tenant promise, preserving concurrent reads,
per-branch timing, auth, ETag and the existing error schema.

Test-first on unchanged current source: 2FAILED/1PASS. Known-reference and
concurrent request isolation tests reproduced null references; unknown/pending
tenant correctly remained null. After the four-line route correction, all3
new tests and7 retained public-contract OpenAPI/API tests PASS (10total).
Tests execute the real GET, actual classifier/consistency error and canonical
public error envelope. Integration-auth/feed/tenant/revision persistence ports
are finite doubles; hosted auth, database, deployment and native are NOT_RUN.

Supported Node22, exact existing lockfile SHA
93ab57ed8646227fbfd7e45b3df908c3a6411729d0170c3fcca2c02b54f48627;
ignored node_modules symlink reuses installed dependencies without install.
Verification: Vitest three selected public-contract files PASS10; scoped ESLint
and git diff --check PASS. App/tests TypeScript verification PASS. Independent
non-writer review confirmed authenticated company lookup, request isolation,
unchanged concurrent reads/timing and early304 behavior; independently PASS10.
No automatic reset email, provider invocation or real customer/tenant write.

Next: publish narrow replacement
PR and require exact-head CI before expected-head merge. Close old223 and its
duplicate216/214 merge vehicles only after this residual actually reaches main,
preserving their branches and historical evidence. Do not restore already
integrated old auth/layout changes.
