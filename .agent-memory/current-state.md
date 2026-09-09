# Current state

Updated: 2026-09-09
Status: IN_PROGRESS

Active branch: `codex/gridex-parity-remediation-20260905`; [draft PR #310](https://github.com/heke99/gridex-ops-platform/pull/310).
Active group: `auth_membership_tenant`. Published baseline:
`b9afbf68d4b5490f857fe5b2bd1424d3ab22217b`, exact reviewed tree
`4bb7a1778ee72b87c42d4c6d76e9dfd565811815`. No masterplan phase is closed.

Working-tree accounting is 592 inputs: 517 `FULL_FILE_SELECTED`, 26 `SUBSTITUTED`, 45 `UNCLASSIFIED`, and 4 `EXPLICITLY_EXCLUDED`.
The focused group contains 338 inputs: 274 selected, 23 substituted, 37 unclassified, and 4 excluded.
Seventy-one total
inputs and60 focused candidates remain unresolved. Selection is not proof of
surviving effects. Full replay, artifacts and production parity remain open.

Current hosted verification — OPS34359949888 onb9afbf68:

- Auth102494069650 PASS: all eleven commands, actual selected RBAC/SaaS prefix
  and all61 reduced identity cases. Full6D after the actual30-file prefix passed
  all17 guards/catalog/aggregate/repeat checks, six exact dirty-state failures,
  late view failure, real finite lock timeout and six reduced characterizations.
  Source statement boundaries and preserved row/reference IDs were verified.
- Ediel102494069894 and quality102494069708 PASS, including the app build.
- Verify102494069367 FAILED generated types at tail20260909120200.
  Clean102494069531 FAILED before full replay; no generated baseline produced.
  Full-effects accounting independently remains unresolved; do not refresh
  artifacts from incomplete replay or label this an external blocker.
- Static accounting29, selection/emit, eleven-command runner/status,
  provenance76/49/20/4/499 and integrity592/496 passed. Historical migration
  bytes/checksums are intact. Separate and integrated reviews approved the exact
  published tree; fetched tree/clean tracked state verified before alignment.
- Earlier identity fixture correction is resolved and remains tested. Preserve
  final helper20260908120000, role-pair uniqueness, required references and
  invitation index; do not redo completed bounded repairs.

Next active action: integrated batch review of Task4's independently approved
operations-sync implementation at66659b22, then isolated hosted verification under
[the governance restoration plan](../quality/audits/TENANT_GOVERNANCE_SOURCE_RESTORATION_PLAN_2026-09-09.md).
Operations selection is committed locally: foundation77, actual RBAC prefix33,
fixed runner12. Selection/emit, runner/status, replay14/accounting29 selftests,
integrity592/496 and provenance77/49/20/4/499 passed. Its new SQL is not yet
executed. Separate review approved spec compliance and quality with no findings;
integrated review remains pending. Hosted results above belong to the
publishedb9afbf68 before this change. Task3 evidence a8721a2d and independent
review account for all1321 source lines.
Whole operations sync can follow current6D without a new shape prerequisite.
Its exact path is outside the focused auth group; future selection changes
only global classification counts. Import sources/6D2 remain unselected pending
explicit shape/retention/token prerequisites. Final journal ACL/RLS/access,
later hardening, session revocation and durable delivery remain open; no
masterplan phase is closed.
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
No current external dependency blocks the active source-evidence task.

Continue internal replay/effects, generated artifacts and bidirectional ledger/live
parity after the bounded verification converges. Never regenerate types/schema
from incomplete replay or weaken gates to produce green checks. Publish once per
reviewed batch. Do not publish per file or subtask. Other current-task/handover files are pointers here;
archive entries and earlier receipts are historical context, not current proof.

The prior workflow-tooling batch retains its scoped authorization statement:
"For this workflow-tooling batch, no production mutation is authorized or performed."
This historical batch boundary does not revoke the user's broader authorization
for subsequent necessary work.
