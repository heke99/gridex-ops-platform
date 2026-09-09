# Current state

Updated: 2026-09-09
Status: IN_PROGRESS

Active branch: `codex/gridex-parity-remediation-20260905`; [draft PR #310](https://github.com/heke99/gridex-ops-platform/pull/310).
Active group: `auth_membership_tenant`. Published baseline:
`17da324350891d8dd9a3a4b35684bf4423d335ed`, exact reviewed tree
`c9e42a8100c6c681e52fe3cca931688900f90dac`. No masterplan phase is closed.

Working-tree accounting is 593 inputs: 518 `FULL_FILE_SELECTED`, 26 `SUBSTITUTED`, 45 `UNCLASSIFIED`, and 4 `EXPLICITLY_EXCLUDED`.
The focused group contains 339 inputs: 275 selected, 23 substituted, 37 unclassified, and 4 excluded.
Seventy-one total
inputs and60 focused candidates remain unresolved. Selection is not proof of
surviving effects. Full replay, artifacts and production parity remain open.

Current hosted verification — OPS34373283798 on17da3243:

- Auth102539602494 PASS: all thirteen commands, actual RBAC prefix34,
  all61 identity cases and existing governance/operations coverage. New token
  prerequisite passed empty schema,8 populated variants,20 exact dirty failures,
  preservation/repeat/forced rollback and real lock timeout/both writer orders.
  Six complete later-runtime compatibility lanes retain nullable token shape and
  correctly fail the final mandatory-readiness gate; no historical token repair.
- Ediel102539600728 and quality102539600224 PASS, including app build,
  195 test files/1162 tests and release-quality checks.
- Verify102539599786 FAILED generated types at tail20260909123000.
  Clean102539599407 FAILED before full replay; no generated baseline produced.
  Full-effects accounting remains unresolved; no incomplete artifact regeneration.
- Static runner13/status, selection/emit, integrity593/497, provenance78/49/20/4/500
  and replay14/accounting29/group15 checks passed. Separate task, scoped fix and
  integrated review approved the exact tree. Fetched refs/tree and clean tracked
  state verified before alignment. Existing historical SQL/checksums preserved.
- The under-lock relation-shape admission finding is resolved at760f472e and
  independently re-reviewed before publication. No outstanding bounded SQL failure.
- Other17da3243 CI: tenant-integrity102539601083 and browser-public102539601127
  PASS (four public tests). Smoke102539600003 failed only generated-types tail
  20260909123000 (14/15 checks); PR certificate102540129920 follows smoke failure.
  Full/staging/production certifications were skipped, not verified.

Next active action: publish the reviewed Task7 import admission batch for
isolated hosted PostgreSQL verification under
[the governance restoration plan](../quality/audits/TENANT_GOVERNANCE_SOURCE_RESTORATION_PLAN_2026-09-09.md).
The author corrected both Important seed-admission findings: additional grant
constraints/unique indexes and source-exact permission INSERT/default admission.
Four isolated regression fixtures were added. Independent scoped re-review
resolved both original Important findings and the Minor comment issue.
Integrated review identified additional roles/permissions unique-index and
metadata-FK admission gaps. Original author corrected both in6511c457 with four
checker-only fixtures. Integrated scoped re-review resolved the finding with no
new breakage; final documentation/tree confirmation precedes publication.
Pending checker/runner14 passes local selection/emit, runner/status, integrity
593/497 and provenance78/49/20/4/500. Its new SQL is NOT EXECUTED. Fifty-eight dirty
cases and snapshot/compatibility lanes are authored, not verified runtime evidence.
Two infrastructure diagnostics lack dedicated injected tests and remain explicit.
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
