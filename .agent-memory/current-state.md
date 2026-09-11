# Current state

Updated: 2026-09-11.
Status: IN_PROGRESS

The user authorizes necessary commits, pushes, PRs, merges, migrations and
production deployment after the relevant gates. Continue in dependency order
without renewed permission. No production action has occurred in this continuation.

## Active work

- Branch: `codex/gridex-parity-remediation-20260905`; draft PR #310.
- Published head: `5ec9b426c97549e713f162e2723c8c3eaa407593`, tree
  `00fc09bff521827bad5b6a4f27716e068027be2d`; nonforce publication/fetch and exact
  reviewed tree equality passed. OPS34620219856 has new finite failures below;
  complete actual63 continuation/fault/death/privacy passed at16:21:09Z.
- Last completely inspected CI baseline: `d060d1d2` / OPS34617768352.
- Active masterplan step: P0-C, complete schema reconstruction and provenance.
- Task22 constructor correction b3407e0e is locally complete: exact15
  required-table VALUES, all23 constructors GREEN, native guards unchanged.
  Independent spec/quality review approved with no findings. Task24 I1 correction
  1925fc9b passed scoped independent re-review with no findings. Both changes
  are published together. Hosted exact15 diagnostic binding now passes;
  alignment reaches native_cases and fails QUERY_DATATYPE (42804).
- Task24 committed91d045f: finite operational disposition of the exact31-line
  DB2 execution script, nine dependency pins, Python/JS overlap guards and
  adversarial checks. Accounting38, cleanup20, review-groups16, migration
  integrity, provenance, group runner and affected constructors pass.
  I1 correction1925fc9b includes direct interleaved artifact paths in both
  validators. Actual-validator RED/GREEN and regenerated receipt hashes pass;
  scoped independent review approved. Outer accounting already rejected that fixture.
  No SQL bypass is claimed and no historical repair SQL ran.
- Task22 correction e9d4f56c is reviewed and published in d060d1d2. All20 local
  constructors pass; independent spec/quality review approved with no findings.
  OPS34617768352 alignment103323860108 passed all20 constructors, actual63 and
  the independent catalog/source equality, then failed diagnostic_binding.
  Root reproduced the cause locally: diagnostic_source expects15 broad literal
  occurrences but its immutable view has18 (15 table rows plus three unrelated
  expressions). Reviewed correction b3407e0e addresses this; native acceptance remains
  open and historical A/B/C remain unclassified.
- Active next action: publish approved dedupe stagesfa6828b and alignment
  stages7ac14cdc as one coherent diagnostic/source-evidence batch; inspect
  hosted stages to localize alignment42804 and earlydedupe, then fix only proved
  causes. No blind retry or relaxed catalog comparisons. Regenerate schema/types
  only after full replay is authoritative.
- On 5ec9b426, alignment103332040645 passed23 constructors, actual63, catalog/
  source equality and diagnostic binding. All four bounded relation names are
  absent at actual63. QUERY_DATATYPE occurred later in native_cases; oracle DDL
  versus timestamp mutation versus behavior cases remains unlocalized.
- Dedupe103332040656 passed every constructor, then failed BoundaryError before
  any first43/SQL receipt; owned cleanup passed. Its runtime and legacy/repair
  files are unchanged from passing d060d1d2. Root traced startup/reference path;
  exact cause remains unproved. No environmental or Task24 causality claimed.
- Current auth/legacy/repair/fixed102, Ediel and quality/build jobs PASS. Tenant
  and public-browser workflows PASS. Full E2E smoke is14/15; only the same
  generated-types check fails. Coverage and executable14-scenario contract pass;
  runtime/staging/full/nightly lanes are skipped and remain unverified.
  Verify103332040464 now passes both initial
  regression stages, then fails only at the known generated-types tail; clean
  native ownership remains blocked.
- Alignment stages7ac14cdc are independently approved without findings;24
  constructors pass, four injected failures RED/GREEN. Dedupe stagesfa6828b
  pass private-payload/known-label/6failure-cleanup seams and all constructors;
  scoped independent review approved without findings. Both are diagnostic only. AST comparisons confirm
  unchanged preexisting function bodies after removing diagnostic wrappers/call,
  including unchanged SQL and guards. Neither native cause is proved.
- Root status shortening omitted exact existing memory-test markers; restored
  them and reran canonical-auth-membership-group-selftest.py successfully. The
  original CI failure is retained; no test expectation was weakened.

## Verified starting evidence

Immutable snapshot: `quality/audits/PRODUCTION_BASELINE_2026-09-11T152632Z.json`.

OPS run 34611459551 on the starting commit:
- PASS: auth16, legacy17/actual52, repair18/actual56, dedupe19/actual57,
  fixed-target102, complete actual63 continuation, Ediel, quality/build.
- FAIL: alignment job103302722719 at independent catalog equality.
- FAIL: verify job103302722717 because generated types omit migration tail
  `20260911114443`.
- FAIL: clean replay job103302722838 because native CLI ownership/reference and
  private logging are not implemented; rejected before SQL.
- Separate tenant and browser-public workflows passed. Skipped full runtime,
  authenticated domain and production lanes remain unverified.

Working-tree accounting is 600 inputs: 546 `FULL_FILE_SELECTED`, 23 `SUBSTITUTED`,
26 `UNCLASSIFIED`, and 5 `EXPLICITLY_EXCLUDED`.
The focused group contains 346 inputs: 303 selected, 20 substituted,
18 unclassified, and 5 excluded.
Forty-nine historical inputs remain unresolved; focused group unresolved38.
Foundation104/actual63 and all immutable source pins remain binding.
Selection is not proof of successful full SQL replay or production parity.

## Production and access

Fresh Vercel inspection confirms `app.gridex.se` belongs to project
`prj_xA3EDI1xztkkyx21e3LY4UhgYrWt`, deployment
`dpl_6qevcw57wT7X2p5yd5rQA7hzRq8c`, READY/production, SHA
`eb9a25bc989c6de808903f41c2314d5465e9c07b`, equal to current main.

Fresh read-only connected Supabase inspection: `piidsfebjqjmnepdpnas`, PostgreSQL
17.6, 279 ledger entries/tail20260904222450, 502 tables/160 views/632 functions.
Direct runtime-to-database binding is still unproved. Separate connector
identities are not binding or parity evidence. No customer rows were inspected.

This fresh workspace has Git/Node/Python, but no Docker/PostgreSQL/Supabase CLI.
Use existing isolated hosted PG17 gates for native proofs. Git fetch works;
Git push dry-run fails for missing shell credentials. Authenticated GitHub tree,
commit and nonforce ref tools are available; publish through those, then fetch
and verify exact tree equality. Preserve any unrelated changes.

## Continuity and next steps

The prior unpushed529b824e object was unavailable in this workspace. Task24 was
reconstructed from published whole-source evidence in91d045f/1925fc9b and is now
independently approved. Do not restart that work or claim the older object was
recovered. Historical receipts remain in Git and in the evidence files.

Next-source static preparation is preserved in
`quality/audits/TIMESTAMPED_DB1_SOURCE_MAP_2026-09-11.md`; independent scoped
review approved documentation only with no findings. The source is schema/
reference-bearing with four verified differences from the selected split sources.
No disposition or ordering change is authorized by that map alone.

After each bounded fix: test, independent review, publish a coherent batch,
inspect relevant CI, record exact evidence and continue. Do not repeat accepted
old matrices without a concrete affected dependency.

Do not publish per file or subtask; publish a coherent reviewed batch.
For this workflow-tooling batch, no production mutation is authorized or performed.
This batch boundary does not change the user's authorization for later delivery
after the relevant production gates pass.

Remaining masterplan: finish source disposition and full native replay/genesis/
ledger/schema/types; verify production parity; then readiness, Ediel, typed
clients, inbound mail, tenant/RLS/customer/switch/billing/API/jobs/recovery,
observability, domain/failure/load tests and production canary. No phase is
closed by a bounded source proof. ADR006 bars mass historical replay or ledger
marking in production. Never bypass a red gate to merge.
