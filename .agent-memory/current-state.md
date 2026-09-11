# Current state

Updated: 2026-09-11.
Status: IN_PROGRESS

The user authorizes necessary commits, pushes, PRs, merges, migrations and
production deployment after the relevant gates. Continue in dependency order
without renewed permission.
Push reviewed, coherent batches stepwise as requested. No production action has occurred in this continuation.
No production mutation has been performed in this replay-verification batch.

## Active work

- Branch: `codex/gridex-parity-remediation-20260905`; draft PR #310.
- Published implementation baseline: `0ca45764960662c07fbb51393cf9f2f17be55390`.
- Active masterplan step: P0-C, complete schema reconstruction and provenance.
- Six reviewed batches pushed. The directional HOT correction passed native32
  SQL controls and nine behavior cases. All43 raw omission setups were measured:
  17 reject2BP01,26 succeed; exact rollback preservation and cleanupPASS.
- Source-bound omission fixture correction is published61bc1fe5. It uses exact
  per-variant maps from five pinned sources, globally11views+87policies+13triggers,
  full origin equality and RESTRICT. Unknown-dependency negative control and
  all43 corrected native preflights and FULL native suite PASS in
  OPS34646873072/job103419655635 on61bc1fe5. Whole-source16case suitePASS
  at21:09:28Z; both controller-death/rollback/privacy/exact-cleanup probesPASS
  and final cleanupPASS at21:10:42Z. Job conclusionSUCCESS.
  Published staged-read559f70e8 native follow-up also PASS: OPS34647918467,
  alignment103423027097 and fixed continuation103423027208 bothSUCCESS.
- Next staged-source prerequisite independently APPROVED: optional exact
  StagedSources flows through source validation, diagnostic DDL, expected DDL,
  index selection and generated prelude. Physical ownership, canonical path,
  no-symlink, private HOLD and source pins retained. No live-path fallback.
  New regression observedRED->GREEN;28constructors+6diagnosticsPASS, diffcheckPASS.
  Direct bytes/DDL/prelude outputs unchanged. No source/selector/state changes.
- Actual68 native SUCCESS on0ca45764: OPS34650841849/job103432379255.
  Three actual-shell success runs/fresh repeats, rejected closed-handle reuse,
  extended storage drift, rows/owner/stage/database/hash/private-copy faults,
  exact22012/57P01 rollback, postcommit catalog/row drift, failed child and
  post-COMMIT controller death all PASS. Canary, source/HOLD restoration,
  private collector boundaries and exact owner cleanup all PASS by21:54:51Z.
- Source registration64–68 now has native evidence. Global accounting remains
  INPUT_SELECTION_ONLY: foundation109/timestamp508;600=549selected,
  23substituted,23unclassified,5excluded. Full46dispositions unresolved.
- Next bounded P0-C group: complete original customer_move_out_lifecycle,
  ediel_tenant_profile_runtime_sync and operations_customers_ux (20260519).
  All244source lines and prerequisites independently reviewed. Private
  standalone characterization prepared at frozen accepted actual68;9constructors
  PASS. Complete final review, push candidate and resolve hosted native gate
  before registration.
  No additional source selection/order change or actual71 claim has occurred.
- Local affected constructors/accounting/provenance/readiness and native
  auth/legacy/repair/dedupe/fixed/Ediel/quality gates PASS. Full types still FAIL
  on migration tail20260911114443; native CLI still unsupported beforeSQL.
- Main/app.gridex.se remains eb9a25bc; connected ledger tail20260904222450.
  No production writes; full plan and production parity remain incomplete.

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

Working-tree accounting is 600 inputs: 549 `FULL_FILE_SELECTED`, 23 `SUBSTITUTED`,
23 `UNCLASSIFIED`, and 5 `EXPLICITLY_EXCLUDED`.
The focused group contains 346 inputs: 306 selected, 20 substituted,
15 unclassified, and 5 excluded.
Forty-six historical inputs remain unresolved; focused group unresolved35.
Foundation109 / native actual68 and all immutable source pins remain binding.
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

Continue with the next three original customer/Ediel/operations sources from accepted actual68.
Independent review is required by AGENTS.md and requesting-code-review; do not
repeat accepted matrices without an affected dependency. The new diagnostics
are independently implemented from complete published source, not reconstructed
from partial chat or represented as recovered prior commits.

The reviewed static `quality/audits/TIMESTAMPED_DB1_SOURCE_MAP_2026-09-11.md`
remains documentation only; source T is still unclassified. A rollback-only
characterization cannot prove commit/deferred/durability/original-runner behavior.

Remaining masterplan: finish source disposition and full native replay/genesis/
ledger/schema/types; verify production parity; then readiness, Ediel, typed
clients, inbound mail, tenant/RLS/customer/switch/billing/API/jobs/recovery,
observability, domain/failure/load tests and production canary. ADR006 bars mass
historical replay or ledger marking in production. User authorization covers
necessary staged delivery after relevant gates; never merge through red gates.
