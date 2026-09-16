# SaaS tenant source effects and bounded restoration design

Date: 2026-09-09. Reviewed baseline: `01e31ed8`. Task: evidence/design only.
No SQL was executed; no source, fixture, selection, schema, manifest checksum,
production or publishing changes were made. Source facts below are static evidence;
expected database outcomes require the proposed isolated PostgreSQL 17 checks.
Root owns active plan and memory. Existing memory describes an earlier hosted state;
this document does not replace its status or claim hosted verification.

## Skill routing

Activated `code-review` for complete relevant execution paths, `verification-before-completion`
for evidence boundaries, and `supabase` for RLS/grant distinctions. Reviewed
`using-superpowers` (explicit subagent exemption). Reviewed `fp-check`; no exploit
claim or reproduction is made, and direct source verification below is the equivalent
check for fixture/order defects. `acquire-codebase-knowledge` and `quality-playbook`
were inspected and skipped: their repository-wide documentation/audit triggers are
absent in this explicitly bounded source inventory. No implementation, broad security
assessment, performance work, UI, SDK, deployment, hooks, scanner output or skill edits:
corresponding implementation/TDD/refactor, security-scanner, performance, UI, deployment,
SARIF and skill-authoring groups are out of scope. Plan/delegation handled by root.

## Evidence aliases

All paths are repository-relative. `S` =
`supabase/migrations/20260519_saas_ui_tenant_admin.sql` (all 269 lines read).
`C1` = `supabase/migrations/01_db1_schema_repair_core_helpers_and_canonical_tables.sql`.
`C2` = `supabase/migrations/02_db1_operations_ediel_billing_dedupe_and_storage.sql`.
`O` = `scripts/gridex-aud-003-foundation-order.json`.
`A` = `scripts/gridex-aud-003-legacy-foundation.additions.json`.
`P` = `scripts/canonical-rbac-prefix-selftest.py`.
`F` = `scripts/canonical-rbac-tenant-selftest.py`.
`T` = `scripts/canonical-rbac-prefix-selection-selftest.py`.
Aliases followed by line ranges are file:line evidence, not runtime receipts.

## Complete statement/effect inventory

| Source lines | Statement/effect | Actual prefix and repeat interpretation |
|---|---|---|
| S:1-5 | Header asserts guarded/idempotent; extension pgcrypto IF NOT EXISTS | Existing managed/core prerequisite. Header is not proof of grant idempotency. |
| S:7-23 | CREATE companies: UUID PK/default; name; unique slug; org number; status/default/check; contact fields; phone/website; industry default; metadata; creator auth FK SET NULL; timestamps | Table already exists (C1:339-359). Entire CREATE is a no-op, not additive schema reconciliation. In particular source does not add industry, slug uniqueness or creator FK to existing table. |
| S:25-30 | companies_status_created_idx(status, created_at DESC); partial companies_org_number_idx(org_number) WHERE nonnull | Add indexes if names absent; same name existing does not validate definition. |
| S:32-47 | CREATE memberships: PK; company/auth FKs CASCADE; membership_role default/check; status default/check; invited_email/by/at; accepted/suspended timestamps; metadata; unique company/user | No-op against C1:387-403. Existing company FK stays RESTRICT, user remains without source auth FK; source does not supply missing columns/checks. |
| S:49-53 | memberships user/status and company/status indexes | First creates as needed; membership foundation later repeats company/status index by name. |
| S:55-73 | CREATE invitations: PK; company CASCADE FK; email/full_name; membership_role/check; role_key; status/check; UUID token/default; inviter/invited-user SET NULL FKs; expiry/accept/revoke timestamps; metadata/created_at | No-op against C1:405-421: source does not convert existing text invitation_token, add token, full_name, membership_role, role_key, revoked_at or auth FKs. Other sources own later additions. |
| S:75-79 | invitation company/status/created DESC and lower(email)/status indexes | All referenced columns exist in C1. Repeat by name. |
| S:81-87 | If user_profiles exists, add nullable active_company_id FK SET NULL and index | Already supplied by early derived bootstrap; source is still executed but this branch does not reconstruct or change existing FK. |
| S:89-106 | For user_profiles, user_roles, user_permissions, audit_logs: if relation exists, add nullable company_id FK SET NULL; create table-specific company_id index | All four exist. user_roles/user_permissions company_id already exist without FK (C1:455-477); audit_logs existing FK default deletion behavior survives (C2:751-762). Existing column prevents FK repair. Profile column is added if absent; index attempts apply to all four. No backfill/NOT NULL/RLS changes here. |
| S:108-121 | If permissions exists, upsert tenants.read/write/invite with exact Swedish name/description | Key conflict updates only name/description, preserves existing ID, category, active flag, timestamps. Empty authentic prefix yields three keys. Repeat preserves IDs and restores those two fields. |
| S:123-160 | If roles exists, detect is_system; upsert company_admin with name/description and is_system=true only in that branch | C1:423-433 has is_system_role, not is_system; selected prefix does not add is_system. ELSE branch executes, preserving is_system_role=false and scope=company defaults. Do not confuse the two column names. Existing IDs/other attributes preserved. |
| S:162-219 | Guard three RBAC tables; find company_admin; insert role_permissions for existing keys in 34-key allowlist | Allowlist: users read/write; tenants read/invite; customers read/write; contracts read/write; documents read/write; communication read/send; cases read/write; switching read/write; metering read/write; metering_points read/write; sites read/write; masterdata read/write; billing_underlay read/export; partner_exports read/write; poa read/write; pricing read/write; reports.read; audit.read. Does not seed missing permission keys; excludes tenants.write. Actual empty selected prefix has only newly seeded tenants.read/invite matches: two grants. See repeat caveat below. |
| S:221-241 | Guard RBAC tables; each existing super_admin/admin receives each existing tenant permission | Does not create those roles. Authentic prefix has neither, so zero grants there; deliberately seeded characterization must cover both roles and missing-role no-op. Legacy admin receives tenants.write before later cleanup. |
| S:243-246 | ENABLE RLS on all three tenant tables | Does not FORCE RLS, remove other policies, or grant table access. Existing RLS remains enabled. |
| S:248-264 | Three DROP IF EXISTS/CREATE service_role_all policies, one per tenant table, ALL, USING and WITH CHECK auth.role()='service_role' | Default policy role is PUBLIC; predicate restricts JWT role. Replaces only exact policy names; does not delete existing tenant policies. Repeat replaces catalog objects; compare definitions rather than OIDs. |
| S:266-269 | Three table comments plus companies.status comment | Exact source strings replace prior comments on each execution. Text lists only original statuses despite later expanded allowed statuses; comments are not constraints. |

No function, trigger, table privilege GRANT, tenant/member/invitation row seed,
transaction wrapper or user-role assignment appears in S. Role grants are reference
DML, not SQL privilege GRANTs. Failure atomicity depends on runner transaction/error
handling, not S's header.

## Actual prerequisites and canonical position

| Dependency | Existing evidence | Required design |
|---|---|---|
| Managed auth and UUID support | P:156-158 managed bootstrap and session search path; C1 table defaults/FKs | Reuse existing PG17 runner bootstrap. |
| Company/membership/invitation indexed columns and RBAC key constraints | C1:339-477 | Do not recreate source's unused table shapes in fixture. Key uniqueness exists for roles/permissions; role_permissions only has id PK. |
| Profiles + early active company | O:8-12; bootstrap/20260519_user_profiles_foundation.sql:7-14; bootstrap/20260519_user_profiles_active_company_foundation.sql:7-17 | Preserve callback → normalize → template adjacency AND active-company immediately after template. |
| Primary contacts | O:13; A:289-292; bootstrap/20260519_companies_primary_contact_email_foundation.sql:1-8 | Provenance is final_saas_hardening, NOT S. Retain this derived artifact: S's CREATE companies is a no-op. |
| Expanded company lifecycle | O:14; bootstrap/20260519_companies_governance_foundation.sql:5-28 | S's skipped CREATE does not narrow the existing lifecycle check. |
| Membership shape | O:31; bootstrap/20260527_company_memberships_role_key_foundation.sql:9-54 | Retain source-derived wider role/status domains; S indexes need only core status/user/company fields. |
| RBAC sequence and final helper | O:31-34; P:17-23,152-169 | Keep membership boundary followed immediately by original three RBAC sources in their reviewed order; final helper remains after historical replay. |

Precise proposed position: insert S once immediately BEFORE
`bootstrap/20260527_company_memberships_role_key_foundation.sql`, after
`bootstrap/20260523_rbac_permission_helpers_foundation.sql` (O:30-31).
This gives the actual prefix all source effects before synthetic seeding, keeps the
existing RBAC boundary adjacency, and precedes hard-platform cleanup. The proposed
prefix grows from 27 to 28 files. Add S once to additions foundation; set
`preserveSourceReplay:true` on the existing active-company derived record (A:405-408),
retaining its artifact checksum and early position. Update only the corresponding
selection/provenance/accounting assertions (T:39-49,115), not immutable source bytes.

Expected accounting delta, conditional on no other changes: one SUBSTITUTED becomes
FULL_FILE_SELECTED; total inputs unchanged; unresolved decreases by one. Exact counts
must be freshly calculated by implementation, not copied from stale memory.

## Later effects and repeat behavior

`supabase/migrations/20260520_batch_6e_hard_platform_roles_only.sql:21-36`
removes tenants.write, permissions.manage and roles.manage from every role except
super_admin/superadmin/platform_admin. This is an intentional later cleanup of S's
legacy-admin grant. Never replay S after that source without replaying cleanup again.
`supabase/migrations/20260520_batch_6e_rbac_tenant_stats_whitelabel.sql:270-326`
replaces its own tenant policy names, leaving the three S service-role policy names
intact at this bounded RBAC endpoint. Membership foundation replaces broader checks
and repeats an index (lines 37-54). These facts do not prove all-history surviving
policies/comments/grants; later full canonical replay remains open.

Confirmed repeat caveat: C1:445-453 defines no role_id/permission_id unique pair;
inspection of the actual selected 27-file prefix found no such constraint/index.
S:214-218 and S:236-238 insert generated IDs with ON CONFLICT DO NOTHING. A second
execution can insert another row for an existing semantic grant. Do not invent a
fixture-only unique constraint or delete baseline duplicates. At the pristine prefix
plus S endpoint, predicted repeat delta is two additional company_admin grants (read,
invite), four total grant rows after two S executions; role count stays one and
permission count stays three. With seeded permissions/legacy roles, derive the exact
additional rows from the 34-key intersection and existing super_admin/admin roles.
This is source-level proof of a non-idempotent design, not an executed SQL receipt.
Duplicate handling at a later canonical endpoint remains OPEN; no unrelated migration
has been claimed to deduplicate it.

## Fixture collision and exact adaptation

Confirmed high-priority test blocker (not a production vulnerability claim):
F:128-136 unconditionally inserts synthetic company_admin and tenants.write IDs despite
existing UNIQUE(key). P:42-56 reuses that seed, so selecting S before the boundary
causes conflicts. Simply ON CONFLICT DO NOTHING on reference rows is insufficient:
F:137-147 and P:52-53 still reference absent synthetic IDs.

Minimal adaptation: make the shared seed data-driven by inserting reference keys only
when absent, preserving existing records unchanged, then resolve every grant/user-role
foreign key through roles.key/permissions.key. Apply the same lookup to the extra
inactive company-admin row in P:52-53. Keep synthetic IDs for rows actually inserted;
do not update reference IDs/names/flags, clear tables, or assume an existing key has a
specific ID. Snapshot authentic roles/permissions/grants BEFORE fixture seeding, then
retain the existing post-seed exact role/permission preservation assertions
(P:120-121). Verify original rows/IDs/fields still exist after seeding and both RBAC
cycles. Use exact set/multiset comparisons, not only counts or permissive lower bounds.

At the proposed pristine prefix endpoint, static expected baseline is one role,
three permissions and two grants. Existing seed adds two roles (member/platform_admin),
three permissions (permissions.manage/roles.manage/customers.read), six distinct grant
rows, and four user-role rows including P's extra inactive row. After the existing
three-source RBAC cycle: roles=3, permissions=6, role_permissions=6 (baseline two plus
six fixture rows minus exactly two disallowed fixture rows); user_roles=6, unchanged
from existing expected count. P:123's hardcoded four grant rows must become a precise
baseline-plus-six-minus-two assertion plus an exact removed-row set and preserved-row
multiset assertion. Existing customers.read grant remains exactly one because S ran
before that permission was inserted. Repeating only the current RBAC trio preserves
that six-row grant state; it does not characterize repeating S.

Company and membership audit expectations remain baseline+2 and baseline+7; two
membership backfills, one active-profile attribution, six user-role rows, 25 policy
targets/100 tenant policies, four absent targets, billing shape/values, final secure
helper and invalid-environment rejection remain unchanged. Preserve all their current
gates. Reduced characterization without S should retain its old outcomes; shared
seed lookup is compatible with both empty and authentically seeded reference tables.

## Concrete next implementation and targeted verification

1. Make the selection/provenance change at the exact position above; update T to require
   S once in actual prefix, FULL_FILE_SELECTED, retained checksum/provenance and all
   prior auth/template/boundary adjacencies. Assert existing three source repeats and
   final helper remain as before. No checksum changes to S or old migrations.
2. Adapt reference seeding and preservation snapshots as described. Add a focused
   SaaS characterization harness that executes the complete immutable S at the actual
   selected prerequisite boundary, inspects exact catalog/index/FK/comment/policy and
   reference effects, then repeats S and records the predicted semantic duplicates.
   Keep this isolated from the existing RBAC two-cycle idempotency assertions.
3. Cover existing keys with sentinel descriptions/flags to prove intended upserts and
   preservation; cover is_system present/absent and absent guarded tables only as
   clearly reduced branch characterization, not canonical evidence. Cover admin and
   super_admin source grants followed by hard-platform cleanup, preserving unrelated
   grants and showing tenants.write absent for admin at the final tested endpoint.
4. Run database-free prefix/selection checks, accounting/integrity/provenance checks,
   targeted fixture emit review, then fixed isolated PG17 SaaS and existing RBAC
   tests. Preserve nine-command group behavior unless root explicitly integrates an
   additional reviewed command. No full-suite rerun for this evidence task.
5. Independent review must check authentic row preservation, non-idempotent S repeat
   semantics, real prefix membership, exact grant deltas and later cleanup. Root owns
   status/publication decisions. Full replay, generated artifacts and live parity
   remain unverified.

## Verification record and concerns

Executed read-only inspections: complete S with line numbers; C1 company/RBAC schema;
C2 audit schema; actual O prefix and A provenance; full P emit composition; shared F
seed; T adjacency/provenance checks; hard-platform cleanup and RBAC policy statements.
A bounded Python scan of all 27 selected prefix files for role/permission seed statements,
is_system and role-permission uniqueness found only core is_system_role and no literal
reference seed/pair-unique declaration. Direct C1 schema corroborates the uniqueness
concern; runtime catalog verification is still required. Initial relative-path reads
outside the repo failed and were rerun with explicit workdir; no resulting changes.

No SQL, live reads, broad audit, source edits or full suite executed. Static expectations
are not PASS receipts. Source statement coverage is complete; legacy partial-environment
branch execution, source repeat catalog behavior, surviving all-history effects and
post-restoration hosted execution are OPEN. Documentation whitespace and commit scope
are checked separately in the task report.

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
