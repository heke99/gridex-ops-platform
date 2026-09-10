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

### Task 3: Establish complete sync/import prerequisites before 6D2

Read the four complete immutable originals, not just earlier cited excerpts:
20260519_operations_core_saas_sync.sql (140 lines, UNCLASSIFIED),
20260519_customer_intake_contracts_tenant_hardening.sql (272 lines, SUBSTITUTED),
20260519_final_saas_hardening.sql (634 lines, SUBSTITUTED), and
20260526_debug_step1_2f_customer_import_foundation.sql (275 lines, UNCLASSIFIED).
Total1321 lines at publishedb9afbf68. Independently verify citations/definitions;
an earlier audit's excerpt range is not authority over actual source bytes.
The first full6D now passed actual PG17; full6D2 remains unselected because the
current76-file foundation lacks customer_sync_events, customer_import_batches,
and customer_import_rows. Do not undo the verified6D restoration or repeat its
completed source/fixture work. Accounting592/516 selected/26 substituted/
46 unclassified/4 excluded, focused338/274/23/37/4 must remain unchanged here.

Write quality/audits/GOVERNANCE_SYNC_IMPORT_PREREQUISITE_EFFECTS_2026-09-09.md.
Provide statement/effect matrices for all four originals, exact actual-prefix
prerequisites and competing final shapes. Include every guarded and unguarded
DDL/DML/helper/view/policy/index/comment effect and its actual transaction unit.
Trace direct selected successors and immediate consumers only for named shape,
ownership, identity, status/validation, import execution or retention risks.
Do not select a complete source based solely on its useful table definition.

Establish required PKs and compatible references, company/customer/site/metering/
source/actor ownership, import batch-parent/row identities, row numbering,
required/default/null fields, status/check vocabularies, JSON payload/issues
semantics and exact indexes. Contrast intake/final/debug shapes; CREATE/ADD IF
NOT EXISTS can preserve older nullable columns or omit inline FKs. Preserve
existing IDs, row values, FK actions and audit history unless a later separately
approved forward contract explicitly changes them. A historical CASCADE or
nullable FK is evidence, not sufficient intended retention policy. Do not guess
missing IDs, backfill attribution, normalize dirty customer data, widen checks
or treat table-name presence as full schema agreement.

Inspect the current derived bootstraps and provenance for primary_contact_email,
contract_offer_versions and contract_offers_lifecycle: determine which exact
early prerequisites must remain and how complete-source replay can coexist.
Map all dependencies of proposed full-source restoration, not just the three
missing6D2 tables. Preserve final role-helper/identity/index repairs and the
known6D journal authorization boundary. Record any unhandled journal/import
RLS, policy composition, caller privilege or audit-delivery requirement without
claiming exploitability or executing adversarial workflows.

Propose the exact smallest safe next implementation and source order, including
any necessary evidence-backed forward shape reconstruction before immutable
sources. Prefer a coherent independently testable whole source when its effects
and prerequisites are complete. If one source can precede the rest, name that
bounded step; do not block all progress on a separate unresolved parent-retention
policy. If a policy choice is genuinely required, state the precise alternatives
and their evidence/impact instead of inventing a business rule. Design synthetic
actual-prefix/repeat/dirty/autocommit/two-tenant-reference tests with explicit
complete versus reduced lanes. No live rows, mutation, migrations/selector/
manifest/generated artifact/test changes, publication or phase closure.

Commit only this new audit. Root owns plan/status/receipts and any correction
of older audit citations. Detailed report goes to this plan's ignored SDD
Task3 report. Separate evidence review must approve the boundary before coding.
All full replay/types/schema/ledger/actual production, customer lifecycle and
final journal access gates remain open under the system integrity contract.

### Task 4: Restore the complete operations-sync prerequisite

Prerequisite: dispatch only after Task3's evidence and proposed boundary receive
separate approval. Use its approved full operations-source matrix, including any
review corrections. This task does not restore import sources or6D2.

Select complete migrations/20260519_operations_core_saas_sync.sql immediately
after existing full6D and before membership-role-key foundation. Preserve all
existing first31 files and their order, including full6D at31; operations becomes
32 and role-key33. Foundation77, actual RBAC prefix33. This explicitly refines
the earlier governance boundary: approved prerequisites may lie between6D and
future6D2, while6D2 must remain before6E. No source is appended after hardening.
Pin source SHA256e5863b15ec8c25794912b50c36eda6a370f3fb288800339a0bcfb16f2a3bb619
against the existing immutable manifest. No historical SQL/checksum/manifest,
bootstrap bytes, generated artifact or production schema change is authorized
by this bounded task. No additional forward reconstruction unless separately
specified after evidence review.

Expected global accounting592/517 selected/26 substituted/45 unclassified/
4 excluded, unresolved71. The operations source is not itself a direct member
of auth_membership_tenant: expected focused338/274 selected/23 substituted/
37 unclassified/4 excluded, still60 unresolved. Verify exact path membership and
actual tool output rather than broad substring searches through dependency hints.
Notify root on selection changes so exact current-state markers update before
its covering test. Keep prior status/archive contracts intact.

Add a focused scripts/canonical-operations-sync-selftest.py using the existing
fixed localhost55440 disposable PG17/managed bootstrap and scrubbed PG environment.
Add it as command12 after existing11; adapt only named selection/adjacency and
prefix-size assertions for the approved new sequence. Existing governance main
lane still has30 predecessors and full6D at31; do not change its historical
coverage. Existing actual RBAC prefix must include new operations source and
continue through all reviewed6E/helper/identity assertions. Keep exact source
selection/provenance checks instead of weakening them to unordered membership.

Main SQL lane: execute actual first31 selected files then all140 original lines.
Verify all19 ownership-loop tables/guards, their actual company column shapes,
all six search-index branches, and the new19-column sync journal with exact
PK/backing index/defaults/nullability/check/comment and all three journal indexes.
Compare every source index definition with the approved matrix; retained same-name
mismatches must be reported, not silently accepted as correct. Preserve existing
company-column types/nullability/defaults, PK/FK actions/OIDs, prior indexes and
seeded row IDs/references/unrelated fields. Source ADD IF NOT EXISTS does not
reconcile them. Source creates no journal FK or RLS/policy; explicitly retain
that boundary pending real later constraints/governance, not fake grants/guards.

Use two synthetic companies with representative referenced customer/site/metering
and journal records, source repeat checks and baseline snapshots over every
actual target. Verify required journal fields, UUID PK uniqueness and all five
match statuses with exact appropriate SQLSTATE failures. Repeat must preserve
journal IDs/payload/actor references and source/index identities where promised.
These are schema/source-effect tests, not final tenant authorization or measured
performance claims.

Characterize relevant reduced absent-table/missing-column/existing-wrong-shape
and same-name-index cases separately. Test a precise late journal-index failure
under the actual unwrapped ON_ERROR_STOP file semantics, with earlier committed
units and the failed unit explicitly checked; no invented all-file rollback.
Include finite real lock contention only at the actual source transaction unit,
with deterministic release and preserved reference/catalog assertions. No
simulation by raising a fake timeout. Follow established fixture safety and
fresh disposable state after expected failure. Do not widen source constraints,
fill guessed identities, rewrite dirty rows or copy6D2 policies.

Run targeted static selection/emit, accounting, provenance/integrity and fixed
runner/status checks locally; all new SQL remains NOT EXECUTED until reviewed
and run in the existing hosted PG17 workflow. Separate task review plus integrated
coherent-batch review precede one root publication. Any hosted defect is an
internal fix; full replay/types/ledger/live parity and every masterplan phase
remain open. Actor/tenant/FK completeness, final journal access, import retention,
customer deletion and measured index coverage are not completed by this test.

Author owns only necessary fixture/runner/selector scripts and task4 ignored
report; root owns all audit/plan/status/catalog files and publication. Preserve
root dirty changes and commit only owned code. Return exact commit, targeted
checks and concerns. No new package, infrastructure, production row access,
external SQL, deployment or merge.

### Task 5: Resolve import prerequisite contracts before further selection

Dispatch only after Task4's reviewed implementation passes its bounded hosted
verification. Use Task3's approved complete-source matrix as the starting point;
do not repeat its1321-line audit or rerun Task4's unchanged SQL. This is a
targeted design/evidence task, not authorization to select I/F/D/6D2 yet.

Resolve the outstanding StepB choices in
GOVERNANCE_SYNC_IMPORT_PREREQUISITE_EFFECTS_2026-09-09.md against the masterplan,
current import/invitation consumers and the system data integrity contract.
Produce an explicit proposed table/column/key/ownership/index/retention matrix
for customer_import_batches, customer_import_rows and their immediate references,
including retained early contract_offer_versions shape. Distinguish the empty
canonical reconstruction from existing-row compatibility and final runtime
acceptance. Preserve stable IDs, legitimate keys, existing FK actions and tenant
attribution; catalog observations alone do not select intended retention.

The observed company action is a terminal tombstone, not physical deletion
(app/admin/companies/actions.ts:407–545; lib/tenant/lifecycle.ts). It does not
settle the competing historical import FK delete actions. Trace only immediate
consumers needed to establish the proposed contract; do not broaden this into
the full customer lifecycle implementation. Explicitly identify any retention
decision that cannot be established from existing requirements, and its exact
impact, while progressing all independent prerequisites.

Specify the narrow invitation-token prerequisite before F, including existing
column/type/value/default/unique-index admission rules and later runtime-source
interaction. Never derive token values from invitation_token or accept_token_hash,
mint missing historical credentials, or assert mandatory-token convergence from
a nullable compatibility column. State precisely whether each proposed shape is
only replay compatibility or satisfies the final consumer contract.

Define preflights for I/F ownership updates, competing import table shapes,
mandatory parent/row references, version ownership and F role/permission seeds.
Use Task3's exact source transaction boundaries to specify rollback versus prior
committed effects. Required tests must preserve IDs/rows/FK actions, cover two
synthetic tenants and exact dirty-state failures, and distinguish reduced cases
from the complete selected prefix. No guessed parent/row values, silent cleanup,
blanket CASCADE, invented uniqueness or weakened constraints.

Deliver one focused prerequisite design audit with the proposed exact source
order, narrowly justified forward prerequisites, complete acceptance conditions
and a bounded next implementation brief. Separate independent review must assess
the proposal before any SQL/selector change. Record unresolved internal work
honestly; no phase/parity/access/deletion closure. Root owns plan/status/receipts;
the future author owns only the assigned new audit and ignored task report.

### Task 6: Implement the independent invitation-token prerequisite

Prerequisite: Task5 design receives separate approval. Its independent next
batch is split into this token prerequisite and Task7 import/ownership/seed
admission; neither task selects I/F/D/6D2. This split does not drop any gate.
Use GOVERNANCE_IMPORT_PREREQUISITE_CONTRACT_2026-09-09.md:151–188 as the binding
token contract, including the empty/compatibility/final distinction.

Add a new transactional forward migration
migrations/20260909123000_canonical_invitation_token_prerequisite.sql and focused
scripts/invitation_token_prerequisite_selftest.py. Register the new source using
the existing canonical provenance/manifest mechanism; append its new checksum
without changing existing historical entries or bytes. Place it after operations
entry32 and before role-key foundation: new prerequisite33, role-key34,
foundation78, actual RBAC prefix34. Preserve the first32 existing files. Keep
the new source selected once, before any future F; do not append it after final
hardening or select token fragments from F. Add fixed runner command13 after12.

Before mutation, require the correct ordinary public invitation relation and
its stable UUID identity. Under a relation lock in the same transaction, validate
token-column/default/index/duplicate admission. Use bounded5s lock_timeout and
30s statement_timeout, with no secret/token values in errors. An absent token on
an empty relation gets source-defined UUID NOT NULL DEFAULT gen_random_uuid().
An absent token on a nonempty relation gets only a nullable UUID column without
default/backfill in the explicitly characterized compatibility path. Existing
UUID values, NULLs, nullability and admitted defaults are preserved; no casts,
copies from invitation_token/accept_token_hash, generated historical tokens or
new acceptance/delivery intent. Reject wrong types, duplicate nonnull tokens and
incompatible defaults before committing any change. Existing NULLs/nullable shape
are compatibility only and must remain an explicit failed final-readiness gate.

Validate any existing company_invitations_token_key as the correct public
relation's unique B-tree, exact single token key, ordinary NULL-distinct/immediate
semantics, default key ordering/operator class, no predicate/expression/INCLUDE
keys, valid/ready/live. Reject schema-name collisions and incompatible objects;
do not drop/replace them. Missing index is admitted for the real later source
to create. Preserve all existing row IDs/values, table/constraint/index OIDs,
FK actions, policies/grants/triggers and unrelated fields. Do not mutate existing
nullability/defaults merely to normalize catalog rendering.

Test on the existing disposable localhost55440 managed PG17 surface, with the
actual first32 selected files before the complete new prerequisite. Use two
synthetic companies and representative invitation/actor references. Empty and
existing-row lanes must verify exact admission, preservation, repeat and final
readiness distinction. Include the complete existing later invitation runtime
source in a separately labelled compatibility lane to prove that ADD IF NOT
EXISTS does not repair nullable tokens; this is not the intervening full replay.
F's future index/default effects, if characterized, must be explicitly reduced
source-derived statements, never labelled complete F execution or selected as
source substitutes. All earlier source/helper/identity checks must survive.

Require exact dirty-state failure diagnostics and transaction rollback for wrong
relation/type/default/index, duplicate tokens and name collisions. Include
nullable/all-nonnull and nullable/NULL values, correct existing index/absent index,
no leaked credential values, source repeat, forced rollback and real finite lock
contention with deterministic release. Assert the emptiness/admission check cannot
race a concurrent writer; use actual locks, not fake timeout exceptions. No
destructive production or adversarial access test. Preserve source FK actions;
do not expand this task into invitation business-flow or customer-deletion repair.

Run only targeted local selection/emit, accounting/provenance/integrity and fixed
runner/status checks. Notify root of actual global/focused counts before the
status gate; do not infer group membership from dependency substrings. New SQL
remains NOT EXECUTED until separate and integrated review then one hosted batch.
No generated artifacts, production SQL, deployment or merge. Author owns only
necessary new migration/fixture and registration/runner/selection files plus
ignored task report; root owns audit/plan/status/receipts. Return exact commit,
targeted evidence and concerns. All final token/runtime/replay/parity gates remain
open wherever only nullable compatibility has been established.

### Task 7: Establish import ownership and seed admission before source selection

Prerequisite: Task6 bounded hosted verification passes. Use Task5's independently
reviewed admission matrix, exact index inventory and source-unit evidence. Add
scripts/canonical-import-admission-selftest.py and, if needed to avoid duplicating
SQL, scripts/sql/canonical-import-admission.sql. This is a read-only admission
checker and isolated synthetic verification, not a new migration or source
selection. Add fixed runner command14 after13; retain foundation78 and actual
RBAC prefix34. Source accounting remains593/518/26/45/4 and focused339/275/23/37/4.
Existing historical SQL/checksums, generated artifacts and selectors stay intact.

Cover all Task5 admission categories: relation/PK/reference/default/index/check
shape, competing I/F/D/union import shapes, parent/row IDs and same-company
agreement, retained early versions, would-change I/F ownership rows, required
join/DDL columns, D status/confidence checks, and F role/permission seed arbiters.
Use its exact source-defined column/index/check identities, not inferred names.
Compare current sources only where needed to resolve a concrete predicate; reuse
Task3's complete effects audit. Unknown or incompatible shapes must not silently
receive eligibility. Missing both imports is the explicit empty-reconstruction
case; incomplete mixed shapes require an explicit supported classification or
rejection, never guessed columns/parents. Source effects are still unselected.

The checker must produce safe named blocking categories and separate compatibility
or unresolved-final-gate results. Do not print customer payloads, tokens or other
row values. Take a consistent read-only transaction snapshot; any locking is for
that bounded observation. This check does not freeze subsequent writers or make
historical source execution atomic. No production application or ongoing lock
claim follows from an admission result. The later source-application contract
must separately establish its transactional/maintenance and revalidation boundary.
Do not introduce persistent helper objects, mutate schema/rows or invoke any
historical ownership UPDATE/role seed in the admission checker.

Require stable UUID keys/reference types and appropriate existing validated
parents while preserving every existing FK action/OID. Detect null mandatory
parents/numbers, orphans and mismatched row/batch/customer/candidate ownership;
never infer missing parents or row numbers. Duplicate row numbers or nonpositive/
duplicate version numbers are not invented new uniqueness/check failures where
the source permits them: report the stronger-contract gate separately. Preserve
nullable version ownership/history and report final ownership incompleteness.
Inventory actual extra constraints, policies and triggers rather than discarding
them because names differ. An absent possible-customer FK on an admitted I-first
shape remains an explicit final enforcement gap, not proof of ownership safety.

Enumerate every would-change I/F ownership join using their precise NULL-parent/
nonnull-child and orphan semantics. Preserve-values eligibility requires zero
would-change rows; existing nonnull ownership conflicts are also rejected. Include
I-only powers_of_attorney and F-only billing_underlays. Identify existing6D guards
and relevant source statement units. For F seeds, require correct role/permission
keys, defaults and immediate unique arbiters, mandatory unique role pairs and
unambiguous existing keys; record the exact proposed metadata/three-permission/
six-pair effects without applying them. Missing super_admin is a labelled reduced
branch, not complete seed coverage or an automatic new-role insertion.

Use existing fixed localhost55440 disposable managed PG17. The main lane executes
the actual first33 selected files through token prerequisite, then checker only.
Use two synthetic tenants, customers, offers and auth/role identities; capture
before/after row and public-catalog snapshots to prove the checker does not mutate
anything. Reduced I/F/D/union and dirty fixtures may use source-derived table
shapes solely as labelled synthetic setup, not whole-source replay evidence.
Cover every named blocking category with exact expected diagnostics and preserved
rows/catalog; verify successful empty and supported compatible shapes, repeat,
read-only enforcement and coherent snapshot behavior. Reuse existing setup code
where appropriate; avoid a large verbatim fixture copy. No vulnerability
reproduction, destructive production test or unmeasured index tuning.

Run targeted local selection/emit, fixed runner/status and integrity/provenance
checks; static emission is not SQL execution. New SQL requires separate task and
integrated review followed by one hosted publication. Do not rerun unchanged
broad suites without a concrete gate need. Author owns only admission/checker/
runner files and ignored report; root owns plan/status/receipts. No production
SQL, migration registration, generated artifact, I/F/D/6D2 selection, release,
retention decision or phase closure. Return exact owned commit and evidence.

### Task 8: Prospective complete import/governance source verification

After Task7, define and separately review exact prerequisite/whole-source
order and source-application boundary before implementation. The resulting
GOVERNANCE_FULL_SOURCE_EXECUTION_CONTRACT_2026-09-09.md is independently approved
at3986a755+87b45d8d; execution acceptance remains a separate Task9 gate. Carry all Task3/5
complete effects, intentional skips, ownership/seed effects, repeated sources,
actual unwrapped failure units and later helper/policy composition forward.
An admission snapshot alone cannot authorize concurrent production application.
No source selection or final retention decision is implied by contract approval.

### Task 9: Isolated whole-source execution proof before selection

Requires Task8 contract approval. Implement the complete synthetic PG17 contract in
GOVERNANCE_FULL_SOURCE_EXECUTION_CONTRACT_2026-09-09.md through one fixed15th
runner command. Preserve existing14 commands and all prior admission cases.
Execute actual first33, whole I/F/D/6D2, retained role-key/all6E; prove complete
bounded effects, preservation/repeat, dirty admission, native partial failure and
concurrency. Explicitly label reduced/later-hardening residuals. No selector,
historical SQL, generated-artifact or production changes in this execution stage.
Separate and integrated implementation review precede hosted verification.

### Task 10: Reviewed canonical selection and preserved fixture boundaries

Requires Task9 complete bounded hosted acceptance. Insert all four originals
immediately after current33 with exact provenance/order/accounting transition
from the approved Task8 contract. Retain early extracts, historical fixture
prefixes, all previous test coverage and later hardening. Independently review
selection and re-run hosted group before continuing remaining source restoration.
No incomplete replay artifact refresh or masterplan phase closure.
