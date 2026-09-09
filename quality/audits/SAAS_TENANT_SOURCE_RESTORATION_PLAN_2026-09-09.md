# SaaS tenant source restoration

Status: IN_PROGRESS. Plan origin baseline01e31ed89255ba829e24a7bd8ce324d36c475add.
SaaS source and uniqueness/index repairs were published at fac58fae with all ten
isolated PG17 commands passing (OPS34348338877, auth102455180423). Tasks3–4
address the next verified identity gap with parent-lifecycle dependencies explicit.
No masterplan phase is closed. Active status remains .agent-memory/current-state.md;
this plan does not approve the remaining auth-group/full-history candidates.

## Global Constraints

- Keep immutable historical SQL/checksums unchanged; no production writes, merge or deployment in this batch.
- Preserve authentic prerequisites, reference data, old auth/template adjacency, all accounting and parity gates.
- Full-file selection is not surviving-effect proof. No schema/types regeneration from incomplete replay.
- Use complete selected prefix with the canonical managed bootstrap for isolated PostgreSQL17 checks; no reduced schema presented as canonical.
- Preserve later helper/ACL and role-permission hardening. No phase closure without code/full replay/generated types/ledger/production parity.

### Task 1: Evidence and bounded restoration design

Read the complete immutable migrations/20260519_saas_ui_tenant_admin.sql
(269lines), current core01 company/membership/invitation/RBAC definitions, its
derived active-company/primary-contact bootstrap provenance and actual selected
RBAC prefix. Inventory every source statement/effect: CREATE IF NOT EXISTS
no-op shapes, indexes, conditional owner columns, permission/role upserts, role
grants, RLS policies, comments, repeat behavior and later overwrites.

Propose the precise safe canonical position and existing fixture changes needed
to preserve real seeded reference rows. The source grants tenants.write to
legacy admin, while the subsequent hard-platform source removes it from
non-platform roles; ordering must preserve that cleanup. The source also seeds
company_admin and tenant permission keys, whereas the current RBAC fixture
uses hardcoded synthetic IDs for those keys. Do not delete baseline data or
weaken expectations to avoid conflicts. Determine a minimal data-driven fixture
adaptation and exact expected deltas. Preserve existing callback→normalize→
template adjacency and active-company early prerequisite provenance.

Write a statement/effect and prerequisite matrix with file:line evidence in
quality/audits/SAAS_TENANT_SOURCE_EFFECTS_2026-09-09.md. Provide a concrete next
implementation scope and targeted tests; distinguish actual source facts from
execution-unverified assumptions. This task is read-only on production and
implementation files; commit only this audit. Root owns current-state/checkpoint
and plan. Do not reclassify source, change fixtures or execute SQL in this task.
Use no raw production data or credentials.

### Task 2: Restore complete SaaS source and verify actual effects

Use the separately reviewed SAAS_TENANT_SOURCE_EFFECTS_2026-09-09.md as the
statement-level evidence and exact fixture delta specification. Read it first
along with Task1 review/report. Resolve confirmed Important review findings
before implementation. Preserve all Global Constraints above.

Select complete immutable migrations/20260519_saas_ui_tenant_admin.sql once,
immediately before bootstrap/20260527_company_memberships_role_key_foundation.sql
and after bootstrap/20260523_rbac_permission_helpers_foundation.sql. Preserve
all auth/template and membership→three-RBAC-source adjacency contracts. Retain
early active-company derived artifact; set its preserveSourceReplay true with
unchanged checksum/source. Preserve primary-contact bootstrap's actual distinct
source provenance. Calculate fresh accounting counts; source selection alone
does not establish execution or all-history effects.

Adapt shared synthetic role/permission seeds to preserve existing records and
resolve FK references by key. Existing references must survive with exact IDs
and unrelated attributes; no deletes, ID replacement or fixture-only uniqueness.
Adapt full-prefix pre-seed/post-seed snapshots and exact grant multiset assertions
to baseline + intended additions - exact cleanup removals. Expected static
post-RBAC grant count is six with this source, versus four in reduced fixture;
verify baseline/deltas rather than copy flat counts. Preserve existing profile,
membership, policy/index/view, final-helper and twice-RBAC assertions.

Add fixed isolated PostgreSQL17 SaaS characterization using the complete actual
selected prefix through the source boundary, same managed bootstrap, clean fixed
localhost database and ON_ERROR_STOP. Inspect all source-defined executed
indexes, conditional ownership column/index effects, source RLS policy definitions,
comments, role/permission upsert effects and preserved authentic FK/constraint
shapes where CREATE IF NOT EXISTS is a no-op. Explicitly assert no semantic
role_permissions pair uniqueness at this actual boundary; second source execution
must characterize expected duplicate grant rows rather than falsely claim
idempotence. Test existing-key sentinel fields and legacy admin/super_admin
grants followed by real hard-platform cleanup, preserving unrelated grants.
Cover is_system present/absent and missing guarded-table cases in separately
labeled disposable reduced branch scenarios, not as canonical evidence.

Keep SaaS repeat characterization separate from existing RBAC repeat-stability
checks. Add database-free emit/selection assertions. Integrate exactly one new
fixed command into auth-membership runner and update its regression; preserve
old command order, stop-on-failure and inherited PG environment isolation.
Root coordinates the new ten-command count/status text before status tests.
No production target options, external mutation or generated artifact refresh.

Run targeted covering selection/emit, runner/status, provenance/accounting and
immutable integrity checks. Report exact commands/output and outstanding SQL
boundary. Commit only owned scripts, selector/provenance and new selftest files.
Root owns memory/plan/publication/receipts. Separate task review and final
integrated review precede one combined publication to existing draftPR310.
Actual hosted PG17 must pass; fix concrete CI failures before any execution claim.

## User correction and live integrity evidence — supersedes duplicate endpoint design

On 2026-09-09 the user required alignment with the intended system behavior.
Fresh catalog-only reads on piidsfebjqjmnepdpnas prove the live role_permissions
table has UNIQUE(role_id,permission_id), named
role_permissions_role_id_permission_id_key, backed by its unique btree index.
The canonical core prefix lacks it. Historical ON CONFLICT DO NOTHING assumes
this integrity boundary; duplicate grants are not an acceptable canonical end
state. Earlier predicted duplicate-repeat counts describe the broken prefix,
not desired behavior or a approved canonical design.

The same read found live role_id and permission_id NOT NULL and both FKs ON
DELETE CASCADE, while core has nullable IDs and RESTRICT FKs. Record these as
additional open parity differences; do not silently change deletion behavior
or claim complete role_permissions parity from the uniqueness correction.
This is a catalog read from the connected Gridex project; independently proving
runtime-to-database binding remains open. No production mutation was performed.

Amended Task2: add a narrow, checksum-pinned forward reconstruction migration
20260909120000_canonical_role_permission_uniqueness_reconstruction.sql and
select its complete file in foundation immediately before the restored SaaS
source. Register it in normal history/provenance and execute exactly once in
canonical selection. It must restore the observed unique constraint by complete
definition, validate an existing namesake rather than trusting name alone, be
idempotent, use bounded transaction timeouts, and abort on conflicting existing
definitions or duplicate data without deleting or reassigning any records.
No automatic deduplication, arbitrary survivor choice, reference ID changes,
or disabling constraints. Unchanged historical source must execute against the
corrected real prerequisite.

Canonical SaaS first/repeat tests must now assert stable exact grant multisets
under the reconstructed uniqueness boundary, existing sentinel record
preservation, and intended final platform-grant cleanup. Retain an explicitly
separate reduced legacy-missing-constraint scenario only to characterize the
original prerequisite failure. Add isolated reconstruction scenarios: missing,
matching, dirty duplicate pairs, conflicting definition and repeated apply;
prove failed repairs preserve data and roll back. Do not execute these against
production. Preserve all old RBAC/helper/tenant gates. The new migration changes
the lexical migration tail; adapt that obsolete latest-filename assertion to
verify the actual selected final helper behavior/order remains intact. Do not
regenerate types from the partial prefix.

Superseded requirements: canonical-boundary absence of pair uniqueness and
expected duplicate second-source grants in Task2 and the original audit. Those
are negative legacy characterization only. All other data-preservation, source
provenance, source effect coverage and review/hosted gates continue to apply.

## Verified invitation index convergence — Task2 amendment

The earlier auth-template source lines206-207 creates
company_invitations_company_status_idx(company_id,status); SaaS lines75-76
requests the same name with (company_id,status,created_at DESC), so IF NOT EXISTS
silently preserves the old2-column shape. Fresh catalog-only read on Gridex
2026-09-09 confirms live uses the intended3-column btree definition. This is a
concrete source+live parity defect, not merely an unmeasured index recommendation.

Add separate narrow forward migration
20260909120100_canonical_invitation_status_index_reconstruction.sql, selected
complete before SaaS (after uniqueness reconstruction), with normal checksum and
provenance. Preserve data and all unrelated indexes. Missing index: create exact
intended3-column definition. Matching3-column definition: idempotent no-op.
Recognized authentic older2-column definition: atomically replace with intended3.
Unexpected namesake/table/key/type/partial/expression/unique definition: fail
closed; do not silently drop it. Use bounded transaction/lock timeouts. No
production execution in this batch. Source history remains immutable.

Update canonical SaaS index assertion to intended3-column result; characterize
the old2-column source collision separately. Include missing/matching/recognized
legacy/conflicting/repeated reconstruction tests, proving unrelated indexes and
rows survive and conflicts abort transaction. Update counts and manifest
integrity; rerun only covering changed checks. The shared ten-command runner can
exercise these cases through the existing newSaaSharness without a newcommand.

This supersedes any test/audit expectation accepting the known2-column canonical
endpoint. It does not close all indexing, PK/FK/nullability, deletion or parity
work. Additional discovered differences remain tracked under fullmasterplan.

### Task 3: Verify role-permission identity and ownership contract

Baselinefac58fae has actualten-command PG17PASS with uniqueness/index fixes.
Before changing the remaining role_permissions NOT NULL/FK semantics, verify
intended system behavior from current code, source definitions and catalog
evidence. This is a bounded evidence/design task; do not modify runtime SQL,
fixtures, selector or application code. Root owns plan/memory.

Fresh live catalog on piidsfebjqjmnepdpnas2026-09-09: role_id and permission_id
are UUID NOT NULL; both named FKs target parent id and ON DELETE CASCADE,
validated, not deferrable, not initially deferred, ON UPDATE NO ACTION, MATCH
SIMPLE. Names role_permissions_role_id_fkey and
role_permissions_permission_id_fkey. Core01:445-453 and current generated
schema.sql instead use nullable IDs and RESTRICT FKs. Existing unique pair
constraint is already reconstructed. Runtime-to-database binding remains open.

Read actual role/permission grant writers/readers and parent lifecycle paths;
app/admin/roles/page.tsx:26-29 expects string IDs, SQL source grant inserts
provide role_id/permission_id, while some canonical readers retain role_key/
permission_key fallback. Determine whether fallback means legacy migration
compatibility or intentionally valid key-only persistent mappings. Determine
precise owned-join deletion behavior, preservation of unrelated roles,
permissions, user assignments and audits. Live shape alone is not proof that
every production choice is correct; resolve against the application contract.

Write quality/audits/ROLE_PERMISSION_IDENTITY_OWNERSHIP_EVIDENCE_2026-09-09.md
with confirmed requirements, source:line evidence, conflicts/unverified
assumptions, exact safe next migration scope and synthetic tests. No broad
repository audit, production mutation, customer deletion or generated artifact
refresh. A proposed migration must reject dirty null/orphan/conflicting states
without guessing IDs or deleting rows, preserve correct definitions, and replace
only specifically verified legacy constraints atomically. No blanket CASCADE
changes. Include explicit final delete/repeat/rollback behavior tests if the
owned-join contract is confirmed. Commit only this audit; report at SDD
task-3-report.md. Separate review precedes any implementation.

## Task 3 review correction and dependency order

Separate review of c220acd5 identified same-parent user-role assignment deletion
and unresolved legacy-key conflict predicates. Fresh read-only catalog shows
live user_roles.role_id CASCADE while selected core lacks that FK. Neither
shape establishes safe historical assignment retention. Correct the evidence
and explicitly distinguish proved join identity from unresolved general parent
lifecycle. The safe next implementation may establish mandatory references
without changing delete semantics; ownership repair remains an internal required
follow-up, not a closed finding or external blocker. This dependency order follows
masterplan section120 and the user's intended-system-correctness instruction.

### Task 4: Reconstruct mandatory role-permission references

Begin only after separate Task 3 review approves the corrected evidence and exact
predicate in ROLE_PERMISSION_IDENTITY_OWNERSHIP_EVIDENCE_2026-09-09.md. Preserve
Global Constraints. This bounded forward repair establishes mandatory references;
it does not change FK deletion actions or claim complete parent/customer lifecycle.

Add complete forward migration
20260909120200_canonical_role_permission_identity_reconstruction.sql immediately
after the existing uniqueness and invitation-index reconstructions and before
complete SaaS source in canonical foundation selection. Register the new file's
checksum only and update precise provenance/selection assertions. Old migrations
remain immutable; do not regenerate artifacts from incomplete replay.

Implement audited UUID reference identity checks under bounded consistent
parent/join locks. Reject NULL references, orphan references, duplicate UUID
pairs and conflicting/ambiguous present keys before changes, using the exact
reviewed reader-derived comparison predicate. Optional absent keys are valid.
No UPDATE, DELETE, ID guessing, backfill or invented alias normalization. Verify
UUID parent identity and the exact current RESTRICT or observed CASCADE named
FK definitions, supporting mixed state, but preserve every FK action and OID.
Missing/conflicting named FKs or unrecognized competing relation constraints
must fail closed. Set both reference columns NOT NULL only where absent; retain
all rows, unique constraint, indexes, grants, RLS, assignments and audits.
Matching state is an OID-preserving semantic no-op. No cascade reconstruction.

Add a focused identity selftest module integrated with the existing SaaS harness
command, retaining the ten-command runner and sharing setup/assertion helpers.
Actual canonical selected prefix must execute this migration before SaaS and
assert both required UUID references plus unchanged legacy FK actions. Explicitly
reduced fixtures cover matching/mixed nullability and RESTRICT/CASCADE definitions,
NULL/orphan/duplicate/conflicting/ambiguous key states, unknown FK definitions,
missing prerequisites and forced mid-repair rollback. Verify inserts/updates reject
NULL or invalid IDs after repair, valid ID-only rows work, uniqueness survives,
and row/catalog snapshots survive failure and repeats. Test inherited nullable
owner-copy compatibility using the authentic source operation as described in
the reviewed audit; prove repair fails instead of guessing IDs. Bounded lock
failure must leave no partial state. Do not remove any existing integrity tests.

Do not assert parent deletes are now safe: role assignments/key-only references
and permission overrides remain explicit prerequisite work. No deletion/DDL on
production. Fixed localhost PG17 synthetic data only. Add useful database-free
emit/selection checks; local PG17 unavailable means actual SQL remains pending
hosted review/publication. Run only covering accounting, provenance, migration
integrity, selection/emit, runner/status checks. Inspect existing assertions that
assume the old nullable endpoint. No broad suite reruns.

Commit only implementation/tests/selector/new migration/manifest files. Root owns
plan, memory, status and publication. Write task-4-report.md with exact checks,
commits and evidence limits. Separate task review and final integrated review
precede one publication for hosted PG17 execution. No masterplan phase closure.
