# Isolated integration ownership and bounded core receipt

The active implementation is isolated from `852b03dcb1e4ff384543a0d31aeb18b086745bf7` on `codex/ediel-master-v2-integration-20261001`. Existing #421/#423 publishers remain owners of their refs; source kernelLegacy changed after the first preservation snapshot. No other root, branch, worktree or PR was modified. #418/#422 and paused #310 remain separate.

A byte-preserved 15-file owner snapshot and later kernelLegacy snapshot are held outside the working tree. Root imports scoped dedupe/kernelLegacy, transportRetry, free-text fixture and the original FINAL_TEST_PHASE; other files have explicit isolated transport/mixed owners. Recovery ed3f5159 is undergoing semantic integration against later source authority. Its historic results are not fresh evidence.

Skills routed: using-git-worktrees (isolation already authorized), dispatching-parallel-agents (six named disjoint workstreams), systematic-debugging and TDD (confirmed runtime faults), verification-before-completion (receipt claims), Supabase (forward SQL/replay), and source-contract compliance (literal per-ID review). Full audit orchestration, unrelated performance refactoring, skill creation, hook installation and external deployment do not apply to this implementation continuation.

Current bounded checks: original inbound dedupe 9/9 tests FAIL, current scoped lookup 9/9 PASS; switch reuse regression original 1 FAIL/7 PASS, corrected 8/8 PASS; combined core targeted 33/33 PASS; scoped2-file check17/17 PASS; changed core lint and browser spec syntax/discovery PASS. Initial app TypeScript default 2GiB stopped with OOM; 4GiB reached a genuine missing OutboundRequestRow.environment field. The actual model persists payload.environment; the corrected own operation read is covered by the regression. Whole app TypeScript awaits the integrated package rerun.

Browser spec now tests keyboard activation of the real form, exact once event, persisted reload, own read-only mobile and 200% CSS layout zoom with screenshot attachments. The three tests are discovered, not executed here; genuine browser qualification remains pending disposable native CI. Layout zoom is not a claim of desktop browser-chrome zoom.

Next action: integrate protected ACK replay, fresh generic/sealed source evidence, full-own mixed PRODAT facet/consumer and genuine E/F/G producers; authenticate clean+upgrade replay and generated schema/types on the frozen candidate, then independently review every literal contract. No main merge, hosted migration, real communication or Ediel/TGT/AGT traffic.

## Additional current integration checks

Transport `6d745b2c` was reviewed and integrated as `8ecb1386`. The own integrated transport/scope run passed 42/42 in six files. App TypeScript completed successfully with Node 22 and 4GiB on that source. Scripts TypeScript first failed only the pre-existing `resolveClosureCoverage` native fixture missing the current reviewer argument; its source-owner fixture writer has explicit ownership to correct the argument and rebuild the actual producer/actor/contract chain. Later composite checks remain required.

A compatibility ACK export still contained its own unprotected duplicate path even though current production imports use the facade. Its real entry regression first failed by returning an old ACK for a revoked actor; lazy delegation to the canonical gateway now passes, with zero legacy duplicate reads, message writes or events. This is one mechanical entry proof, not a native grant proof. Current legacy source changes and regression have zero lint errors.

All five required workflow files now bind checkout to the exact pull-request head (push/schedule fallback remains `github.sha`). YAML and every checkout ref were mechanically inspected. The original staging/production schedules, permission requirements and acceptance gates are preserved; this continuation publishes only an isolated draft candidate.

The additive AST consumer inventory spans related app/component files plus Ediel/inbound runtime. Current bounded inventory: 836 source files, 1,792 static sites (293 buttons, 51 change handlers, 283 forms, 24 HTTP handlers, 331 links, 139 RPC calls, 253 server actions, 418 table-write sites). Shared files can contain other-domain sites. Dynamic rendered instances and actual SQL catalog triggers are outside this static count. Every row explicitly says it was not executed by the inventory; none of these counts imply browser or contract acceptance.
