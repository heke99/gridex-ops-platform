# Current state

Updated: 2026-09-11.
Status: IN_PROGRESS

The user authorizes necessary commits, pushes, PRs, merges, migrations and
production deployment after the relevant gates. Continue in dependency order
without renewed permission. No production action has occurred in this continuation.

## Active work

- Branch: `codex/gridex-parity-remediation-20260905`; draft PR #310.
- Published head: `17204f06fddcc2db5bcc7363e2c07e01a8448725`, tree
  `4ab252303f6e3ed718b0a8d4f9bc887ec1d3d4e9`. Exact reviewed-tree/nonforce/fetch
  checks passed; reviewed local history is in archive/proof-stages-reviewed-4e624d67.
- Active masterplan step: P0-C, complete schema reconstruction and provenance.
- Active subtask: publish approved owned-startupd89a497 and alignment139b532
  as one coherent harness batch, then inspect native acceptance. Both independent
  scoped reviews approved without findings; no active implementation author. No blind retry or
  relaxed acceptance. Regenerate schema/types only after authoritative full replay.
- Alignment139b532 is locally implemented: the hosted42804 is proved at
  timestamp_mutation in job103338041853, after24 constructors, actual63,
  independent catalog/source equality, exact15-table binding and oracle DDL pass.
  The fix copies a PG-created donor anyarray into the catalog in the existing
  disposable transaction. Exact1 drift/raw42804 rejection/preservation/disposal
  gates stay unchanged. All25 constructors pass; scoped independent review
  approved without findings. Native donor SQL acceptance remains pending.
- Shared startup has a separately source-proven gap: socket pg_isready may accept
  the official image's temporary initialization server before final exec. The
  bounded correction will require final PID1 postgres plus socket readiness under
  unchanged60s deadline/0.25s cadence/5s command limits, then logging checks.
  Actual__enter__ seam RED/GREEN, timeout/owned-cleanup and all legacy constructors
  pass. Independent review approved without findings; historical failure causality
  remains UNCLASSIFIED. Hosted native readiness and cleanup acceptance pending. No first43 receipt is not
  proof of zero SQL/process work.
- OPS34622016471 on17204f06: alignment103338041853 failed as above;
  legacy103338041773 passed constructors then BoundaryError before first43/SQL
  receipts, cleanupPASS. Auth/repair/dedupe/fixed102/Ediel/quality-build PASS;
  fullactual63 continuation/fault/death/privacy103338041627 PASS16:37:14Z. Dedupe103338041737 completed all19 modes,
  controller death/privacy/cleanup at16:35:06Z. Tenant/public-browser PASS.
  Verify/fullE2E retain known types failure; skipped runtime lanes unverified.
- Previous complete baseline:5ec9b426/OPS34620219856. Auth/legacy/repair/fixed102,
  fullactual63 continuation/fault/death/privacy, Ediel, quality/build, tenant and
  public-browser PASS. Alignment passed the corrected exact15-table binding then
  exposed42804; dedupe failed early with unknown cause and successful cleanup.
  Verify and E2E smoke fail the known types tail20260911114443 (smoke14/15).
  Coverage/P0contractPASS; runtime/staging/full/nightly skipped and unverified.
- Task24 bounded DB2 operational-script disposition is independently reviewed and
  published: exact31-line exclusion, nine pins, Python/JS direct+derived overlap
  guards. Accounting38/cleanup20/reviewgroups16/integrity600/504/provenance and
  affected constructor checks pass; I1 direct-interleaved case closed by RED/GREEN
  and scoped re-review. No historical SQL executed; schema-bearing companions
  remain unclassified. Accounting and foundation boundaries below remain binding.
- Reviewed diagnostic commits7ac14cdc/fa6828b are published in17204f06. Finite
  stages/categories preserve first captured failure and cleanup behavior; local
  privacy/seam/constructor checks and independent reviews passed. Prior timestamp
  comparison and view-binding fixes passed their formerly failing hosted stages.

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
