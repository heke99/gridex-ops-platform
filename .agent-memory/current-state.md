# Current state

Updated: 2026-09-09
Status: IN_PROGRESS

Active branch: `codex/gridex-parity-remediation-20260905`; [draft PR #310](https://github.com/heke99/gridex-ops-platform/pull/310).
Active group: `auth_membership_tenant`. Published baseline:
`aad37fc15e5db4e81113bf43d469c757011c5545`, exact reviewed tree
`4ce084d41c39f604c7bcea6adc5ff3a88a0e61af`. No masterplan phase is closed.

Working-tree accounting is 593 inputs: 518 `FULL_FILE_SELECTED`, 26 `SUBSTITUTED`, 45 `UNCLASSIFIED`, and 4 `EXPLICITLY_EXCLUDED`.
The focused group contains 339 inputs: 275 selected, 23 substituted, 37 unclassified, and 4 excluded.
Seventy-one total
inputs and60 focused candidates remain unresolved. Selection is not proof of
surviving effects. Full replay, artifacts and production parity remain open.

Current hosted verification — OPS34369156972 on aad37fc1:

- Auth102525577327 PASS: all twelve commands, actual RBAC prefix33,
  all61 identity cases and existing full6D coverage. Complete operations source
  after actual first31 passed all19 targets,28 exact indexes, journal schema,
  row/reference preservation and repeat, late42703 statement boundary, real55P03
  lock timeout and five reduced characterizations. No final authorization claim.
- Ediel102525578011 and quality102525577677 PASS, including app build,
  195 test files/1162 tests and release-quality checks.
- Verify102525577998 FAILED generated types at tail20260909120200.
  Clean102525577832 FAILED before full replay; no generated baseline produced.
  Full-effects accounting independently remains unresolved; do not refresh
  artifacts from incomplete replay or label this an external blocker.
- Other CI: tenant-integrity34369156960 PASS; browser-public102525578646
  PASS4 tests. Full-E2E34369156957 smoke102525600801 failed the same generated-
  types tail (14/15 smoke checks passed); PR certificate102526196220 then failed
  because smoke failed. Staging/full/production certification jobs were skipped,
  not verified. These results do not establish runtime production correctness.
- Static selection/emit, fixed12-command runner/status, replay14/accounting29
  selftests, integrity592/496 and provenance77/49/20/4/499 passed. Separate task
  and integrated reviews approved exact tree; fetched refs/tree and clean tracked
  state verified before alignment. Historical migration bytes remain intact.
- Earlier helper, identity and index repairs remain tested; do not redo these
  bounded repairs. Actual source tests do not establish systemwide parity.

Next active action: integrated review of corrected Task6 token prerequisite760f472e under
[the governance restoration plan](../quality/audits/TENANT_GOVERNANCE_SOURCE_RESTORATION_PLAN_2026-09-09.md).
Pending token source is now registered in the working tree at33; foundation78,
actual RBAC prefix34. Static selection/emit, runner13/status, integrity593/497, provenance78/49/20/4/500
passed. Separate review and scoped fix review approved the source; SQL is not executed. Hosted
results above belong to predecessor aad37fc1. Accounting includes this pending
source and its verified direct focused-group membership.
The Important under-lock relation-shape finding is resolved: full admission now
runs under the acquired lock before identity/token admission. Scoped re-review
confirmed the fix; integrated review and hosted SQL are still required.
Task5 contract audit2f424137 independently approved; literal-index-name minor
corrected at7c2ee774 for integrated review. Implement only the independent token
prerequisite and admission, preserving existing credentials and explicitly
separating nullable compatibility from final readiness. Task7 carries import/
ownership/seed admission before further complete-source selection. Task3's1321
source-line evidence remains authoritative; do not repeat completed source audits.
Import sources/6D2 remain unselected; physical retention and stronger version
contracts remain unresolved. Final journal ACL/RLS/access, later hardening,
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
No current external dependency blocks the active prerequisite work.

Continue internal replay/effects, generated artifacts and bidirectional ledger/live
parity after the bounded verification converges. Never regenerate types/schema
from incomplete replay or weaken gates to produce green checks. Publish once per
reviewed batch. Do not publish per file or subtask. Other current-task/handover files are pointers here;
archive entries and earlier receipts are historical context, not current proof.

The prior workflow-tooling batch retains its scoped authorization statement:
"For this workflow-tooling batch, no production mutation is authorized or performed."
This historical batch boundary does not revoke the user's broader authorization
for subsequent necessary work.
