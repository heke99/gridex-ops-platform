# Role-permission identity and ownership evidence — 2026-09-09

Status: EVIDENCE COMPLETE WITH OPEN PARENT-LIFECYCLE CONTRACT; implementation and synthetic execution NOT PERFORMED.
Baseline: `fac58faee7db406a556c3bde44978e972545964b`.
Scope: `role_permissions` identity, its two parent relationships, immediate
writers/readers and user-role removal lifecycle. No whole-system parity claim.

## Decision

The supported final contract is a grant joining one existing role UUID to one
existing permission UUID. Both references must be mandatory. The grant's own
UUID remains its row identity; the already reconstructed unique UUID pair is
its semantic identity. Text keys remain compatibility metadata, not a second
independent identity that makes a key-only grant a valid final mapping.

Historical foundation and live catalog support CASCADE for the two join FKs,
but **safe parent deletion is not verified**. The selected schema leaves
same-parent user assignments dangling, while live CASCADE deletes those
assignments, including disabled rows. Assignment removal source preserves rows
and records audit history; it does not specify role-definition hard deletion.
Neither behavior establishes an approved retention policy. The safe next repair
is mandatory grant UUID references and deterministic compatibility preflight
only, preserving every existing FK action and OID. Deletion semantics remain a
separate internal design dependency, not an external blocker to this ID repair.

## Evidence ledger

All paths below are repository-relative. Line references describe this baseline.

| Evidence | Source and lines | Consequence |
| --- | --- | --- |
| Parent UUID primary keys; join UUID primary key, nullable references and RESTRICT | `supabase/migrations/01_db1_schema_repair_core_helpers_and_canonical_tables.sql:423-453` | Selected core defines real parent identity but conflicts with final reference mandatory/ownership requirements. |
| Historical foundation explicitly defines both join FKs CASCADE | `supabase/migrations/20260522_db1_schema_repair_backfill_foundation.sql:441-449` | Independent source evidence for owned-join deletion; references remain nullable there, so this alone does not prove NOT NULL. |
| SaaS grant seed obtains role and permission IDs from parent rows | `supabase/migrations/20260519_saas_ui_tenant_admin.sql:202-218,227-238` | Missing role means skip; grant writes use existing IDs, not text-only identity. |
| Contract grant seeds write IDs and keys together from parents | `supabase/migrations/20260726090000_contract_create_delete_runtime_alignment.sql:45-79,82-108` | Key aliases coexist with canonical IDs; compatibility checks recognize existing legacy mappings. |
| Owner role seed copies an existing permission reference | `supabase/migrations/20260810185155_gridex_canonical_architecture_p0.sql:58-78` and duplicate `20260810190410_gridex_canonical_architecture_p0.sql:58-78` | Copy can propagate a null permission ID in a dirty legacy prefix; `IS NOT DISTINCT FROM` handles nullable prior state. Not proof that null grants are valid final state. |
| Admin page expects string IDs and builds maps entirely by IDs | `app/admin/roles/page.tsx:27-30,57-82,95-104` | A key-only permission mapping is skipped; role-only text does not appear under the correct role. TS assertions alone do not enforce DB integrity. |
| Current company/global permission engines join both parents by IDs | `supabase/migrations/20260902091000_company_scoped_permission_engine.sql:105-117,159-167` | Key-only grants are not a uniformly supported current authorization representation. |
| Canonical actor permission path joins both parent IDs | `supabase/migrations/20260810185155_gridex_canonical_architecture_p0.sql:234-247` | UUID-backed identity is used beyond the admin display. |
| Legacy helper can resolve role by ID OR key and prefer permission_key over parent key | `supabase/migrations/01_db1_schema_repair_core_helpers_and_canonical_tables.sql:703-715`; retained in `supabase/schema.sql:13425-13437` | Fallback is executable compatibility, not dead comments. Non-null IDs alone do not eliminate inconsistent text/ID resolution. |
| Historical grant revocation deletes only matching join rows | `supabase/migrations/20260520_batch_6e_hard_platform_roles_only.sql:21-35` | Removing a grant preserves roles/permissions and unrelated mappings. |
| User remove-role action submits a canonical access command | `app/admin/users/[id]/actions.ts:285-305,344-359` | Removing a user's assignment is distinct from deleting a role definition. |
| Command disables selected user-role rows, records before/after audit and result | `supabase/migrations/20260802203000_canonical_runtime_consistency_hardening.sql:615-624,694-729` | Preserve assignment history and audits; join FK repair must not convert this lifecycle into deletion. |
| Generated snapshot still has RESTRICT and nullable generated types | `supabase/schema.sql:90022-90033`; `supabase/database.types.ts:67293-67319` | Generated artifacts are conflicting/stale evidence, not instructions to retain broken final behavior. Refresh is outside this task. |
| Unique pair reconstruction deliberately excludes nullability/FK repairs | `supabase/migrations/20260909120000_canonical_role_permission_uniqueness_reconstruction.sql:1-4,23-53` | Preserve existing valid unique constraint and backing index; do not fold unrelated repairs into this decision. |
| Existing per-reference indexes | `supabase/schema.sql:79192-79201` | Preserve both indexes; pair uniqueness is not permission-leading coverage. No index drop is warranted here. |

Supplied fresh catalog evidence (not re-queried by this subtask): task brief
`.superpowers/sdd/SAAS_TENANT_SOURCE_RESTORATION_PLAN_2026-09-09/task-3-brief.md:8-16`
reports project `piidsfebjqjmnepdpnas`, 2026-09-09, UUID NOT NULL on both IDs,
`role_permissions_role_id_fkey` → `roles(id)` and
`role_permissions_permission_id_fkey` → `permissions(id)`, both validated,
ON DELETE CASCADE, ON UPDATE NO ACTION, MATCH SIMPLE, not deferrable and not
initially deferred. Runtime-to-project binding remains unverified.

## Conflicts and limits

1. **Confirmed identity gap:** core nullable references differ from the
   supported UUID-backed final identity. Business impact: inconsistent key-only
   visibility across consumers. Cause: selected repair-core shape does not
   enforce mandatory references. RESTRICT versus CASCADE is a confirmed
   structural difference whose intended parent-lifecycle policy remains open.
   Targeted fix is the forward migration below; this is not a demonstrated
   production incident or authorization bypass.
2. **Compatibility risk:** the fallback helper still accepts key-only state,
   and seed deduplication can treat such state as existing grants. No inspected
   writer establishes text-only mappings as the intended new durable model;
   the owner copy tolerates inherited dirty state. Do not remove fallback or
   guess IDs here. Reject incompatible rows and require separately reviewed,
   evidence-based reconciliation before rerunning the repair.
3. **Ambiguous text/ID states:** a role key that points to another role, or a
   permission key that disagrees with its referenced parent, can make fallback
   and ID readers disagree. Mandatory references do not fix that. Preflight
   must reject these conflicts; it must not rewrite keys or IDs. Absent text
   keys are compatible only when the deterministic predicates below pass. The
   exact folded comparisons and NULL/empty behavior below replace the original
   unresolved normalization requirement; no arbitrary alias choice is allowed.
4. No hard-delete role/permission application endpoint was found in the bounded
   `app`, `lib`, and migration searches. This prevents claiming a verified safe
   parent-delete contract or end-user parent-delete flow.
   The supplied catalog does not establish all deployed triggers/inbound
   dependencies; final delete isolation must be exercised on the actual
   selected synthetic schema before implementation is considered verified.
5. Existing ten-command PG17 PASS is prior baseline evidence, not execution of
   a future FK/NOT NULL migration. Full replay, generated parity, runtime
   binding, customer deletion and full system integrity remain open.

## Review correction: same-parent assignment and audit lifecycle

Selected `01_db1_schema_repair_core_helpers_and_canonical_tables.sql:455-465`
defines `user_roles.role_id` without a parent FK. Thus a role delete can leave
an active **or disabled** row with a dangling UUID once the grant RESTRICT is
removed. The original synthetic case only tested unrelated assignments and
missed this dependency.

Fresh read-only catalog supplied by root on 2026-09-09 for
`piidsfebjqjmnepdpnas` reports `user_roles_role_id_fkey` referencing `roles(id)`
ON DELETE CASCADE, validated, not deferrable/not initially deferred. It also
reports `user_permission_overrides_permission_id_fkey` referencing
`permissions(id)` ON DELETE CASCADE; these and the two join FKs are the reported
inbound role/permission FKs. Live user-role statuses include active, disabled,
removed_from_company, invitation_revoked and locked_security. This is catalog
evidence only: no assignment data was read and runtime binding is still open.
Live deletion can therefore remove same-parent assignments in every status;
keeping only unrelated assignment sentinels does not demonstrate retention.

Source `20260802203000_canonical_runtime_consistency_hardening.sql:574-592`
disables prior assignments and can reactivate an existing row. Lines 615-624
also disable rather than delete, and 720-729 persist before/after audit and
idempotent command result. Confirmed: assignment removal preserves records.
Unverified: whether role-definition deletion is forbidden while any active,
disabled or previously audited assignment refers to it, or deliberately removes
assignments while retaining audit snapshots. Audit snapshots retaining the old
UUID are not equivalent to retaining the assignment/parent row. Key-only
`user_roles.role` linkage and permission overrides are additional dependencies.
No cascade or RESTRICT retention policy can be inferred as approved here.

A future independent restrictive guard is a possible design, not this task's
recommendation for implementation. Before choosing it, establish retention for
all statuses and audit references, enumerate key-only and UUID-linked
assignments/overrides, define how legacy links participate, and check existing
orphans without mutation. An ID-only `user_roles.role_id` FK cannot guard
key-only links. Do not add that FK or change its live CASCADE action in this
repair. Do not delete, null or reassociate assignments to manufacture clean data.

## Deterministic key compatibility preflight

These are conservative admission rules for the next ID repair, not a claim
that all rejected legacy states are invalid business data. Rejection requires
separate reconciliation; no canonicalization or guessed ID writes occur.
Evaluate under the database's actual text collation. Define `F(x) =
lower(coalesce(x, ''))`; do not trim whitespace, use name aliases other than the
explicit seed expression below, apply Unicode normalization, or equate NULL
with an omitted predicate. SQL `coalesce` selects empty strings as real values.

For every grant `g`, after validating both non-null UUID parent references:

1. Let `R` and `P` be the referenced role/permission. Require `F(R.key)` and
   `F(P.key)` nonempty. Require exactly one role ID in the entire roles table
   with `F(key)=F(R.key)`, namely `R.id`, and exactly one permission ID with
   `F(key)=F(P.key)`, namely `P.id`. Case-only duplicate parent keys therefore
   reject even when their case-sensitive unique constraints allow them. A
   referenced NULL or empty parent key rejects; whitespace is not empty.
2. If `g.role_key IS NOT NULL`, require `F(g.role_key)=F(R.key)` and require
   the set of role IDs satisfying either `F(role.key)=F(g.role_key)` or
   `lower(coalesce(role.key,role.name,''))=F(g.role_key)` to equal `{R.id}`.
   This accounts for the helper's key match and contract seed's key/name
   fallback (`20260726090000_contract_create_delete_runtime_alignment.sql:77,106`).
   An empty present role_key rejects because the parent key must be nonempty.
   A NULL role_key bypasses this metadata comparison, but not rule 4.
3. If `g.permission_key IS NOT NULL`, require
   `F(g.permission_key)=F(P.key)`; rule 1 guarantees a unique folded target.
   Empty present permission_key rejects. NULL uses the referenced parent key
   exactly as helper `lower(coalesce(rp.permission_key,p.key,''))` does.
   Contract seed permission-key equality is case-sensitive (lines 78,107), but
   its OR-by-ID resolves this same validated parent; no additional textual
   permission alias or case-sensitive rejection is needed.
4. Model the actual helper's OR join, including NULL/empty effects. For **every**
   user_roles row `u`, form `C(u) = { r | r.id=u.role_id OR
   F(r.key)=F(u.role) }`. If empty, use the single NULL-extended role row, as
   LEFT JOIN does. For every `r` in that result and every grant `g`, if
   `g.role_id=r.id OR F(g.role_key)=lower(coalesce(u.role,r.key,''))` is true,
   require `r.id IS NOT NULL` and `g.role_id=r.id`. For each non-null `r`, also
   require `u.role_id IS NULL OR u.role_id=r.id`. Reject violations. Apply this
   admission check to all statuses and effects so enabling a disabled row or
   grant cannot silently activate an already stored conflicting resolution.
   This is deliberately stricter than the helper's active/allow filtering.
   It covers missing parent joins, different-ID matches, and NULL role_key
   matching an empty `u.role` even though keys were not supplied. Do not
   replace it with a simple present-key equality test.

All four rules are deterministic set/equality predicates; case-fold duplicate
candidates, missing matches, empty strings and NULL behavior have explicit
outcomes. They do not claim to solve key-only assignment deletion: admitting a
currently unambiguous key-only assignment does not install a parent dependency
constraint. This preflight is a snapshot under locks, not a new permanent
text/UUID consistency constraint. Future conflicting writes remain outside the
NOT NULL repair's guarantee.

## Exact safe next migration scope for separate review

Create one forward transaction that adds NOT NULL to role_permissions.role_id
and permission_id only when absent. Keep historical migrations immutable. Lock
the join, roles, permissions and user_roles in one documented consistent order
with bounded timeouts to stabilize all preflight predicates. Check UUID types,
parent identity, unique pair, null/orphan/duplicate rows, rules 1-4 above and
complete definitions of the two existing named join FKs. Recognize only the
verified RESTRICT/CASCADE variants, including a mixed pair, with correct parents,
columns, validation, MATCH SIMPLE, ON UPDATE NO ACTION and immediate nondeferrable
behavior. Reject missing/unrecognized/competing relationship definitions.

**Preserve both FK actions and OIDs in every recognized starting state.** No FK
replacement, assignment guard, trigger, index change, fallback change, backfill,
row mutation or deletion belongs in this repair. Preserve join identity,
metadata, pair uniqueness, indexes, RLS/grants, assignments and audits. On clean
already-NOT-NULL state, repeat is a semantic no-op. On any failure, retain original
nullability, constraints, indexes and all data. This scope can progress while
same-parent lifecycle design remains open; it does not establish deletion parity.

## Required isolated synthetic acceptance cases (proposed, not executed)

Parent-delete cases below characterize isolated fixtures only; they are not
acceptance claims for safe parent deletion or permission to change FK actions.
For the narrow repair, compare before/after behavior under each original action.

| Case | Required assertions |
| --- | --- |
| Clean selected legacy prefix | Apply repair after the actual selected prerequisite boundary; assert both UUID NOT NULL and unchanged original FK actions/OIDs, pair uniqueness and both reference indexes. All existing rows byte-for-byte unchanged. |
| Already correct / mixed | Run twice; preserve already correct FK OIDs and existing index OIDs/definitions; change only nullable reference attributes; preserve both FKs, including RESTRICT/CASCADE/mixed states. No row changes. |
| Dirty states | Separate null-role, null-permission, both-null/key-only, role orphan, permission orphan, duplicate pair and text/ID conflict cases each abort without choosing IDs, deleting data or partially changing DDL. |
| Owner-copy compatibility | Construct inherited null permission state at the legacy boundary; demonstrate the actual owner-copy source can propagate it; repair rejects all such rows atomically. Clean ID-backed copy remains accepted. |
| Catalog conflicts | Wrong parent/schema/column/action/deferral/validation, missing named FK, additional competing FK and name collision each fail closed with original data and schema intact. |
| Mandatory references | After repair, null and nonexistent parent references fail on insert and update; duplicate pair fails; valid IDs with absent optional keys succeed in a fixture passing the key preflight. |
| Delete one grant | Delete a single synthetic join row; both parents, other grants, all user assignments and audit sentinels remain identical. |
| Final role-parent delete | Seed roles R1/R2, permissions P1/P2, all four grants, unrelated assignment/audit sentinels. With original CASCADE and no same-parent assignments, delete R1: only R1 and its two join rows disappear; original RESTRICT with grants must still reject; P1/P2, R2 and R2 grants remain. Check all unrelated assignments/audits unchanged. Any independent parent restriction must remain effective. |
| Final permission-parent delete | Fresh analogous fixture: with original CASCADE and no same-parent overrides, delete P1; only P1 and its two join rows disappear; original RESTRICT with grants must still reject; R1/R2, P2 and P2 grants remain; unrelated assignments/audits unchanged. |
| Delete repeat | Repeat each parent DELETE by the same UUID: zero additional changes; no unrelated row loss. Re-run migration after final delete: same valid shape, no recreated grants or parents. |
| Delete rollback | Perform each parent delete in a transaction then roll back; parent and all exact join rows return, all unrelated rows remain. |
| Repair rollback | Force a failure after the first NOT NULL DDL and before commit; verify original FK definitions, nullability, indexes and all data restored. Timeout also leaves no partial repair. |
| Assignment removal regression | Existing canonical remove-role flow still disables only the addressed assignment and records audit/result; role definitions and shared grants survive. |

Verification performed: targeted `rg` discovery plus numbered reads of the paths
above, comparison to the supplied catalog and existing unique repair. No SQL,
production mutation, test execution, customer deletion or generated refresh was
performed. Document-only validation is `git diff --check`.

Skill routing: Supabase and Postgres best practices for schema/ownership review;
verification-before-completion for evidence boundaries. `fp-check` inspected:
no security vulnerability claim is made, so its exploit-validation workflow is
not applicable; direct code/counterexample evidence is used instead. Broad
security scanning, UI design/performance, refactoring, TDD and property-based
execution are outside this bounded evidence task. Implementation/test skills
activate only in the separately reviewed next task. Root owns plan and memory.

### Additional review-mandated synthetic cases

- Same-parent active and disabled assignments, each with historical audit/result
  snapshots: independently seed and attempt role deletion before/after repair.
  On selected no-user-role-FK shape plus original grant RESTRICT, deletion with
  grants stays blocked and all rows remain. With no grant and no assignment FK,
  document the existing dangling-ID outcome; do not call it safe. In the live
  CASCADE-shaped fixture document assignment loss across both statuses while
  snapshots survive; do not call that an approved retention contract. Include
  all reported non-active statuses and assert unchanged behavior after ID repair.
- Same-parent key-only assignment (`role_id NULL`, matching `role`) and a
  same-parent permission override: characterize each dependency separately,
  including disabled/audited records. Distinguish existing SQL behavior from
  unresolved intended retention. No new guard/cascade is part of acceptance.
- Key cases: exact match; case-only metadata match with unique folded parent;
  case-only duplicate parent keys; NULL/empty referenced parent key; NULL optional
  keys; empty present optional keys; whitespace-preserving keys; different-ID
  text match; ambiguous role name-fallback candidate. Assert each outcome by
  rules 1-3, not arbitrary normalization.
- Helper edge cases: empty versus NULL user_roles.role with NULL grant role_key;
  empty candidate sets yielding the LEFT JOIN null row; user-role ID/text
  disagreement; key-only unique assignment; disabled conflicting assignment and
  deny-effect conflicting grant. Assert rule 4 outcomes and unchanged data on
  rejection. A NULL grant role_key is accepted only when no offending edge exists.
- On every failing preflight assert no NOT NULL attribute or FK/index OID change.
  On every successful RESTRICT, CASCADE or mixed starting state assert exact FK
  action/OID preservation. Parent rollback/repeat tests characterize original
  actions only. No proposed retention guard is silently installed by a fixture.
