# Tenant governance source restoration

Status: IN_PROGRESS. Baseline5fb7fc7486285eb6527d0b55a1fd95f5409937af.
The preceding mandatory-reference task passed actual ten-command PG17 execution,
including61 reduced identity cases. It did not close lifecycle, full replay,
generated artifacts or production parity. This is the next governance cluster
identified in AUTH_GROUP_REVIEW_MAP_2026-09-07.md after RBAC/SaaS restoration.
Active project status remains .agent-memory/current-state.md.

## Global Constraints

- Keep historical SQL and existing checksums immutable. No production writes, merge or deployment in this batch.
- No masterplan phase closes without code/full canonical replay/generated schema/types/ledger/actual production parity.
- Complete source effects must be accounted, including cross-domain DDL/DML, dynamic SQL and guarded branches. Filename hints or fragment selection are not proof.
- Preserve verified auth/template adjacency, membership actor FKs, mandatory role-permission references, uniqueness, invitation indexes and later helper/ACL/lifecycle hardening.
- No blanket CASCADE, guessed IDs, silent data cleanup or incomplete schema/types regeneration. Tenant ownership, audit history and intended system behavior govern.
- Use static direct evidence and synthetic isolated tests; no exploit reproduction or destructive production tests. Explicitly separate canonical-prefix execution from reduced branch characterization.
- Root owns status, plan, receipts and publication; authors own only assigned audit/code files. One publication after separate and integrated review of a coherent implementation batch.

### Task 1: Establish complete governance effects and safe restoration boundary

Read every statement of immutable migrations/20260519_batch_6d_superadmin_tenant_governance.sql
(236 lines) and migrations/20260519_batch_6d2_runtime_governance_completion.sql
(572 lines). Do not infer approval from their names or comments. The former is
SUBSTITUTED by early bootstrap/20260519_companies_governance_foundation.sql;
the latter is UNCLASSIFIED. Current accounting592/515 selected/27 substituted/
46 unclassified/4 excluded, group338/273 selected/24 substituted/37 unclassified/
4 excluded. This task must not change any accounting or selector.

Write quality/audits/TENANT_GOVERNANCE_SOURCE_EFFECTS_2026-09-09.md with a
statement/effect matrix, actual selected-prefix prerequisite map, object/column/
FK/index identities, executed/skipped guard conditions and operational DML.
Inspect the existing company-governance bootstrap/provenance and decide its
required early-prerequisite retention and exact later full-file position.
Cover membership/invitation/profile checks and actor references, governance and
session journals, indexes, role/company/session helpers, policy targets, control
views/functions, operational task transfer and metering/Ediel/billing effects.
Tables existing under CREATE/ADD IF NOT EXISTS may retain a different shape;
identify that precisely instead of assuming inline constraints were applied.

Follow later selected definitions and immediate runtime consumers only as needed
to establish preserved final semantics. Name any helper/view/policy overwrite or
source/runtime/catalog disagreement, with concrete evidence and impact. Already
reviewed helper/identity repairs must survive. Root's customer integrity contract
remains binding, but do not broaden this into a full customer deletion audit.
Do not infer safe parent deletion or retention from a join CASCADE definition.

Propose the exact smallest coherent implementation and synthetic verification
matrix for complete sources: real selected prefix, full cross-domain prerequisites,
correct source-ordering, preservation of existing reference IDs/rows/attributes,
repeat effects, dirty-state/transaction failure boundaries and missing-table
branches clearly labeled reduced. The source scripts are not necessarily wrapped
in one transaction: characterize real atomicity, never claim automatic rollback
for separate committed statements. Explain how later permission/lifecycle/helper
hardening will be verified without restoring unsafe historical behavior as the
final endpoint. Index decisions require actual definitions; no unmeasured tuning.

Separate confirmed facts, inference and unresolved execution. If both originals
cannot safely be restored together, specify their evidence-backed dependency
order and what must precede them. No runtime SQL, fixture, source selector,
manifest, generated artifact, production row read/write or publication change.
Commit only this audit. Report exact bounded reads/checks and concerns to the
plan's SDD task-1-report.md. Separate review must approve the evidence before
implementation. This is not complete masterplan or lifecycle evidence.

### Task 2: Restore complete 6D with isolated source-effect verification

Prerequisite: Task1 evidence must receive separate approval before this task is
dispatched. Read the approved TENANT_GOVERNANCE_SOURCE_EFFECTS_2026-09-09.md,
particularly its journal-access qualification and statement transaction boundaries.
This task restores a canonical source and verifies its bounded effects; it cannot
certify final runtime journal access or close any masterplan phase.

Select the complete immutable
migrations/20260519_batch_6d_superadmin_tenant_governance.sql immediately after
migrations/20260519_saas_ui_tenant_admin.sql and before
bootstrap/20260527_company_memberships_role_key_foundation.sql. Preserve the
existing early companies-governance bootstrap at entry10, its exact bytes/hash,
and set its derived provenance preserveSourceReplay=true with an accurate purpose.
Update foundation additions/order and narrowly affected selection/emit assertions.
Do not select 6D2 or any sync/import source, change historical SQL/checksums,
create a forward schema repair, or regenerate types/schema in this task.

Expected accounting is592 inputs:516 FULL_FILE_SELECTED,26 SUBSTITUTED,
46 UNCLASSIFIED,4 EXPLICITLY_EXCLUDED; focused338:274 selected,23 substituted,
37 unclassified,4 excluded. Total unresolved72/focused60. Foundation76 entries;
actual RBAC prefix32 files. Derive and verify these against the accounting tool.
Root owns the matching current-state update; notify root when selectors change
so the unchanged status-marker contract can be updated before its covering test.
Never weaken that test to tolerate stale status.

Add scripts/canonical-governance-selftest.py (split helpers only if needed for
clear boundaries) using the established fixed localhost55440 disposable PG17
harness, scrubbed PG environment and actual managed Supabase bootstrap. Add it
as the eleventh fixed command after the existing ten; preserve stop-on-failure,
environment isolation, command allowlist and earlier test coverage. Update the
runner selftest to verify eleven commands and the new exact prefix length.
Provide database-free --selection-only and --emit interfaces where useful;
selection checks must prove the complete source/checksum, unique order and early
bootstrap provenance, not just count a comment marker.

Required SQL evidence:

- Execute the actual ordered first30 foundation files, then the complete6D source.
  No hand-built relation-only stand-in for the main lane. Assert every one of17
  operational guards actually exists with exact timing/events/function binding;
  inspect all source-created checks/columns, journal PK/FKs/defaults/nullability,
  exact index definitions and the governance overview shape/aggregate semantics.
  Use two synthetic companies and synthetic users/reference IDs only.
- Seed compatible existing rows and retain snapshots of row IDs, referenced IDs,
  unrelated values and existing actor/parent FK actions/OIDs. Verify source
  repeats preserve promised data and index/FK identities; recreated checks and
  triggers need not preserve OIDs. Existing companies.paused_by has no inline
  auth FK at this prefix: expose that difference without inventing a repair.
- Exercise known dirty company/member/invitation/profile checks without cleanup
  or relabeling. Run original unwrapped file semantics with ON_ERROR_STOP and
  verify actual statement-level commit/rollback boundaries, including a later
  failure after an earlier unit succeeds. Do not use a wrapping transaction as
  evidence of runner atomicity. Restore disposable tests from known clean state.
- Characterize existing-table/column and same-name-index mismatches explicitly;
  a source no-op is not proof that an incompatible shape is correct. Reduced
  missing-relation/column guard cases must be labeled reduced. Do not weaken the
  complete-prefix assertions to accommodate them.
- Include real finite lock-timeout contention on a synthetic relation, proving
  the documented committed boundary and unchanged protected row/reference IDs.
- Verify operational guard behavior for allowed and blocked company statuses
  through sanctioned synthetic writes. Document its INSERT/UPDATE OF company_id
  coverage and the fact that it is not a replacement for FKs or full RLS.
- Existing actual RBAC-prefix test must continue through all three complete6E
  sources and the final reviewed role-helper repair with its existing behavior,
  identity and ACL assertions intact. Add precise governance preservation
  assertions where necessary; do not silently remove newly conflicting checks.

Keep the final journal ACL/RLS/policy contract explicitly OPEN:6D creates it
without policies,6D2 is not yet restored, and this bounded prefix is not final
production authorization. Record the actual source boundary in assertions and
reports. Full later selected lifecycle/ACL execution with all real prerequisites,
permissive plus restrictive journal policies and effective runtime behavior must
be verified in the subsequent complete governance/parity lane before runtime
approval. This qualification prevents both unsafe completion claims and fake
full-schema fixtures; do not copy historical policies out of6D2 to make this test
green. The source audit's remaining actor-FK, sync/import, session revocation,
journal delivery and customer lifecycle concerns remain required internal work.

Run targeted database-free selection/emit/accounting/provenance/integrity and
runner tests locally. No local psql is available; report all new SQL as NOT
EXECUTED until root publishes one separately and integratively reviewed batch
for the existing hosted PG17 job. Do not launch alternate infrastructure or
claim local SQL results. Include precise expected-failure evidence for dirty
cases, not acceptance of any arbitrary error. Follow meaningful TDD for the new
contract, keeping static tests distinct from pending SQL execution.

Author owns only necessary scripts/selector metadata and this task's ignored
SDD report; root owns audit status/plan/memory/publication. Commit only owned
files. Return status, exact commit, test summary and concerns. Separate task
review and integrated batch review precede one publication. Hosted failures
remain internal fixes, and all masterplan parity/lifecycle gates stay open.
