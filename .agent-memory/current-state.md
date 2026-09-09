# Current state

Updated: 2026-09-09
Status: IN_PROGRESS

Active branch: `codex/gridex-parity-remediation-20260905`; [draft PR #310](https://github.com/heke99/gridex-ops-platform/pull/310).
Active group: `auth_membership_tenant`. Published baseline:
`c990dfb20b297b1beb3d6fa81bcbbab0b2e1132d`, exact reviewed tree
`662cf3efa6161636e87bdbdac4515efeab13e7dc`. No masterplan phase is closed.

Working-tree accounting is 593 inputs: 518 `FULL_FILE_SELECTED`, 26 `SUBSTITUTED`, 45 `UNCLASSIFIED`, and 4 `EXPLICITLY_EXCLUDED`.
The focused group contains 339 inputs: 275 selected, 23 substituted, 37 unclassified, and 4 excluded.
Seventy-one total
inputs and60 focused candidates remain unresolved. Selection is not proof of
surviving effects. Full replay, artifacts and production parity remain open.

Current corrective run: OPS34409325084 on c990dfb2.
SQL correction5ecefd1f independently approved, published with status evidence as
c990dfb20b297b1beb3d6fa81bcbbab0b2e1132d; exact tree662cf3efa6161636e87bdbdac4515efeab13e7dc
verified after fetch. Local source history retained at
archive/gridex-import-sql-fix-bfd4fca4. No local tracked edits were discarded.
Auth102659793781 now passes actual first33/empty observation and six reduced
compatibility shapes; fails dirty would_change_supplier_switch_events because
its synthetic parent supplier_switch_requests lacks customer_id. Checker emits
exact intended ownership blockers plus two valid join_columns blockers.
Fixture correctiona0465abb adds only the missing synthetic customer_id; a
regression sweeps all ten ownership joins. Separate scoped review APPROVED;
corrected hosted rerun pending;
do not weaken expected-category equality or claim
all58 cases complete. Previous boolean/regclass error is resolved in actual PG17.
Ediel102659793808, tenant102659793567 and browser-public102659794217 PASS.
Quality102659793836 PASS including app build.56 of58 dirty cases passed before
the fixture failure; final gate/read-only/concurrent-observation cases not reached.
Full replay/types gates remain open; staging/load skipped, not verified.

Current hosted verification — OPS34408542348 on1b37fe86:

- GitHub connector publication access RESTORED. Published the exact previously
  reviewed local6e3c3046 tree81a9eb4e9e73ebf30812b0b0ec3de2b3d6597393 as
  1b37fe863b6710fc4fde622c17b28023f328b352 parent17da3243. Non-force ref update
  succeeded; fetched tree equality verified. Local reviewed history retained at
  archive/gridex-import-reviewed-6e3c3046; working-tree memory edits preserved.
- Auth102657264584 FAILED in new command14, after all previous13 commands PASS.
  Exact PostgreSQL failure: operator does not exist: boolean <> regclass.
  Generated condition combines unparenthesized IS NOT NULL predicates with <>.
  Failure occurs in first actual-prefix observation, so no new Task7 acceptance
  or58-case execution claim is supported. Correction5ecefd1f groups both predicates;
  focused regression demonstrates RED then GREEN. Separate scoped review APPROVED;
  corrected hosted run pending.
- Ediel102657264526 PASS. Verify102657264574 passes isolated fixtures and fails
  generated-types migration tail20260909123000. Clean102657264267 fails before
  full replay; accounting artifact10126300748 retained. No baseline refreshed.
- Quality102657264491 PASS, including app build and release-quality gates.
  Other CI tracked separately.
- Fresh local Task7 selection and fixed runner/status regressions PASS. These
  are static evidence, not PostgreSQL acceptance.

Next active action: inspect corrected Task7 hosted PG17 run34409325084,
fix any actual remaining failure and review before publishing the next batch.
Task8 remains after Task7 hosted acceptance. Full-effects restoration remains
internal remediation work; GitHub access is no longer an external blocker.

Task6 bounded implementation and isolated verification passed. Task5 contract
and exact index-name correction are reviewed; reuse the existing1321-line source
matrix. Token compatibility remains partial where shape/credentials are missing.
Task7 takes a consistent observation only; it does not freeze later writes or
make historical source invocation atomic. Task8 retains that application boundary.
Task7 precedes any I/F/D/6D2 selection and does not decide physical-retention or
stronger version contracts. Final journal ACL/RLS/access, later hardening,
session revocation and durable delivery remain open. No masterplan phase is closed.
The mandatory-reference task's isolated execution is verified, not full lifecycle
or parity. Same-parent assignments, key-only references, permission overrides,
FK actions and customer deletion remain separate internal work. No FK action or
retention policy changed. No production write, merge or deployment occurred.

[The SaaS restoration plan](../quality/audits/SAAS_TENANT_SOURCE_RESTORATION_PLAN_2026-09-09.md)
contains the corrected Task3 contract and bounded Task4 scope. The
[system data integrity contract](../quality/audits/SYSTEM_DATA_INTEGRITY_ACCEPTANCE_2026-09-09.md)
retains systemwide PK/FK/index/ownership/consistency and customer-deletion gates.
Catalog-only customer evidence:175 direct FKs across100 child tables; all100
have PKs. A fresh all-public-table catalog check also finds502/502 ordinary or
partitioned tables with PKs; key suitability and consumer compatibility remain
unverified. Fourteen composite SET NULL relations target mandatory columns.
Forty incomplete-leading-key index candidates are not proven missing indexes.
Full transitive/logical/storage graphs, tenant ownership, delete recovery and
workload performance remain unverified; no customer rows were read or deleted.

Environment evidence: Supabase project access is working. Connected catalog is
piidsfebjqjmnepdpnas; last observed ledger279 entries/latest20260904222450.
Fresh Vercel project/deployment reads confirm production deployment
 dpl_6qevcw57wT7X2p5yd5rQA7hzRq8c READY at app.gridex.se, main
 eb9a25bc989c6de808903f41c2314d5465e9c07b. Runtime-to-database binding is still
unproven; project name or connected catalog is not sufficient evidence.
Fresh reads on this continuation confirm the same deployment/main, connected
DB ledger279/latest20260904222450,502 tables/160 views/632 functions/332 triggers.
Public login returns200. Server runtime database binding remains an open gate;
Vercel project/deployment tools do not expose server environment binding, and
no authenticated application health token is available in this shell.

Continue internal replay/effects, generated artifacts and bidirectional ledger/live
parity after the bounded verification converges. Never regenerate types/schema
from incomplete replay or weaken gates to produce green checks. Publish once per
reviewed batch. Do not publish per file or subtask. Other current-task/handover files are pointers here;
archive entries and earlier receipts are historical context, not current proof.

The prior workflow-tooling batch retains its scoped authorization statement:
"For this workflow-tooling batch, no production mutation is authorized or performed."
This historical batch boundary does not revoke the user's broader authorization
for subsequent necessary work.
