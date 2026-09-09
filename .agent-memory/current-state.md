# Current state

Updated: 2026-09-09
Status: IN_PROGRESS

Active branch: `codex/gridex-parity-remediation-20260905`; [draft PR #310](https://github.com/heke99/gridex-ops-platform/pull/310).
Active group: `auth_membership_tenant`. Published baseline:
`5fb7fc7486285eb6527d0b55a1fd95f5409937af`, exact reviewed tree
`7f4bde69a4a70c52250abb4ac2d7a9e2cbe07f61`. No masterplan phase is closed.

Working-tree accounting is 592 inputs: 516 `FULL_FILE_SELECTED`, 26 `SUBSTITUTED`, 46 `UNCLASSIFIED`, and 4 `EXPLICITLY_EXCLUDED`.
The focused group contains 338 inputs: 274 selected, 23 substituted, 37 unclassified, and 4 excluded.
Seventy-two total
inputs and60 focused candidates remain unresolved. Selection is not proof of
surviving effects. Full replay, artifacts and production parity remain open.

Current hosted verification — OPS34354458938 on5fb7fc74 (before pending6D changes):

- Auth102475481933 PASS: all ten commands, actual selected RBAC/SaaS prefix,
  stable source repeats and all61 reduced identity cases. The corrected
  owner-copy enforcement, mandatory IDs, strict FK/uniqueness failures,
  preservation/repeats, forced rollback and real lock timeout all passed.
- Ediel102475482183 and quality102475482179 PASS.
- Verify102475482295 FAILED generated types at tail20260909120200.
  Clean102475482328 FAILED before full replay; no generated baseline produced.
  Full-effects accounting independently remains unresolved; do not refresh
  artifacts from incomplete replay or label this an external blocker.
- Static accounting29, selection/emit, runner/status, provenance75/49/20/4/499
  and integrity592/496 passed. Historical migration bytes/checksums are intact.
- Earlier4d851ee8 auth failed after50 cases due to a multirow enforcement fixture
  collision (23505 before23503). Reviewed single-grant correction3f861459 is
  included in5fb7fc74 and the hosted failure is resolved. Do not redo that fix.
- Prior helper preservation20260908120000, role-pair uniqueness and invitation
  index repairs remain selected and tested. Earlier receipts are historical in
  verification-matrix/session-log and Git, not current-task instructions.

Next active action: integrated review and one hosted PG17 publication of
separately approved implementation670c8a4c under Task2 of
[the governance restoration plan](../quality/audits/TENANT_GOVERNANCE_SOURCE_RESTORATION_PLAN_2026-09-09.md).
The pending implementation selects full6D and adds the eleventh fixed command.
Static selection/emit, runner/status, accounting29, provenance76/49/20/4/499
and integrity592/496 passed. All new SQL remains NOT EXECUTED; separate task review approved the bounded
implementation, and integrated batch review is pending. Evidence audit38b8a81b and independent review confirm all17 required targets and
view columns at the after-SaaS boundary. Full6D2 remains unselected pending three
complete sync/import table prerequisites. The final journal ACL/RLS/policy
contract remains open; source restoration is not production runtime approval.
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
