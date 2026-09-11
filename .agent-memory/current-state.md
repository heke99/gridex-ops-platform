# Current state

Updated: 2026-09-11.
Status: IN_PROGRESS

The user authorizes necessary commits, pushes, PRs, merges, migrations and
production deployment after the relevant gates. Continue in dependency order
without renewed permission. No production action has occurred in this continuation.

## Active work

- Branch: `codex/gridex-parity-remediation-20260905`; draft PR #310.
- Published baseline: `87135839bee0b4bf8fb251dfa6685a2d4fe29d89`.
- Active masterplan step: P0-C, complete schema reconstruction and provenance.
- The source-scoped HOT correction passed native32-case SQL controls and nine
  behavior cases before guard_sources. OPS34645977547/alignment103416745939
  then measured all43 setup variants:17 fail with dependency2BP01,26 succeed;
  every attempt preserves the exact original catalog+rows. CleanupPASS.
- Failing ordinals:0,2,4,6,8,10,12,13,15,17,20,23,25,29,31,33,39.
  This matches source-established company_id policies/triggers/views and one
  metering_values.created_at view dependency. No migration-source failure in
  these variants has yet been measured because setup blocks first.
- Correction independently APPROVED: exact per-variant fixture-only removal map, globally
  11views+87policies+13triggers from five pinned predecessor sources. Require
  complete before=immutable-origin equality and named preimages; explicit
  RESTRICT drops in reviewed order. Tenant-delete policies remain. Same setup
  runs on preflight, disposable target and independent source oracle.
- Native negative control adds one unknown dependent after planning, requires
  2BP01 and full rollback, then removes that probe and verifies original state.
  All43 prepared setups must pass; no skip or catch-and-continue acceptance.
  New constructor observedRED->GREEN;27constructors+6diagnosticsPASS.
  Independent scoped review APPROVED; corrected native acceptance pending.
- Next: publish reviewed fixture correction, require full native alignment, then
  proceed with source disposition/native replay/schema/types.
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

Continue from the new hosted alignment receipt after publishing this batch.
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
