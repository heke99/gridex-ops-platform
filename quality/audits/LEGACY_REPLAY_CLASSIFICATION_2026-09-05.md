# Legacy replay input classification — 2026-09-05

Status: PARTIAL; candidates NOT VERIFIED CLOSED. No exclusions approved, manifests changed, SQL executed, database writes, or ledger changes.

## Scope and evidence

Read-only bounded review of the 58 unclassified inputs, prioritizing the six DB2 files and named activation/debug/provisioning scripts. This is not the parent repository-wide audit. Skill routing: Supabase for migration/security distinctions; code-review for side effects; verification-before-completion for evidence limits. Repository-wide quality-playbook/codebase documentation generation, UI, performance, implementation/TDD and exploit-oriented analysis are outside this bounded classification task. No application or schema fixes performed. Parent owns shared project memory.

Current-worktree accounting initially returned exit 2: the concurrently created `20260905141608_canonical_tenant_relationship_guards.sql` was not yet checksum-pinned. The actual checker was therefore run against a read-only `git archive HEAD scripts supabase` snapshot taken after parent commit `42031b44`, without the concurrent uncommitted migration. Its stdout was captured in process memory: **exit 1; 585 total, 494 FULL_FILE_SELECTED, 32 SUBSTITUTED, 1 EXPLICITLY_EXCLUDED, 58 UNCLASSIFIED**. This is diagnostic snapshot evidence, not permission to skip that new migration in the real gate.

All 58 inputs were scanned for direct persistent DDL. **52 contain CREATE/ALTER/DROP/GRANT/REVOKE statements; six contain no direct DDL.** The six received targeted body review, including dynamic statement kinds and the two DB2 reconciliation function bodies. DDL scanning establishes that a file cannot be called purely diagnostic; it does not prove every effect or dependency. The other 42 files beyond the 16 explicitly discussed below remain schema-bearing, object-by-object review pending.

Paths below are relative to `supabase/migrations/`. Line references identify source evidence, not execution proof. No identity values or records are reproduced.

## Prioritized actionable classification

| Filename | Persistent DDL objects / exact statement evidence | Data mutation nature | Safe canonical treatment / evidence status |
|---|---|---|---|
| `01_db2_full_view_preflight_schema_and_functions.sql` | `CREATE EXTENSION ... pgcrypto` (12); 12 `gridex_db2_v4_*` functions (35–798), 9 views (378–1054); columns on `companies`, `company_memberships`, `company_invitations`, `user_profiles` (201–364); four checks (292,305,341,354); four index statements passed to `gridex_db1_try_exec` (366–373). | Repair-run upsert (14); broad company/membership/invitation normalization (242,272,321); “dry-run” function invocations (1074–1075) still write backfill logs through `gridex_db1_start_backfill_run`, `gridex_db2_v4_log_backfill_item`, finish helper. | **Mixed schema/repair; do not exclude wholesale.** Separate needed schema/constraints from repair execution. No `gridex_db2*` definition/reference found in current schema snapshot, bootstrap, app/lib/scripts search. Later canonical equivalence of columns/checks/indexes NOT established. |
| `01_db2b_preflight_views.sql` | `CREATE OR REPLACE VIEW public.gridex_db2b_superadmin_target_v` (33), `gridex_db2b_preflight_v` (85). | No DML; preflight `DO` assertion and views embed a fixed operator/tenant target. | Diagnostic intent but persistent schema. Candidate archival only after explicit disposition of these two views; no later definitions found. Do not classify as no-schema. |
| `02_db2_execute_controlled_reconciliation.sql` | No direct DDL; calls `gridex_db2_v4_assert_ready()` (8), `gridex_db2_v4_run_membership_reconciliation(true)` (24), `gridex_db2_v4_run_customer_profile_backfill(true)` (25). | Repair-run UPDATE (10); invoked bodies upsert memberships, profiles, customers, canonical links and audit/backfill records (01 file: 719–978). Customer backfill chooses a company only when exactly one exists (165–194,826). | **Data-repair exclusion candidate, NOT CLOSED.** Preserve historical repair evidence separately; do not auto-run dataset reconciliation in clean replay. No new DDL needing replacement, but trigger/helper effects and required reference-data assumptions remain unverified. |
| `02_db2b_apply_superadmin_and_membership.sql` | No DDL; anonymous `DO` block only. | Fixed-target `admin_users` INSERT/UPDATE to superadmin (80,95); company admin membership INSERT/UPDATE (137,175); backfill/audit writes (38,104,192,221,258). | **Data-repair exclusion candidate, NOT CLOSED.** No schema definitions to preserve; never convert this into a universal administrator seed. Requires explicit historical operational classification and dependency/reference-data review. |
| `03_db2_validation_and_finish.sql` | `CREATE OR REPLACE VIEW public.gridex_db2_v4_backfill_run_summary_v` (7), `gridex_db2_v4_final_readiness_v` (35). | Updates repair-run status/summary (89), serializing diagnostic views. Readiness includes historical single-company assumptions. | Mixed diagnostic DDL/repair metadata. No later definitions found. Explicitly archive/replace these views after dependency review; not a diagnostic-only exclusion yet. Header's “only ... metadata” does not describe its full effects. |
| `03_db2b_validation_views.sql` | `CREATE OR REPLACE VIEW` for `gridex_db2b_superadmin_membership_v` (5), `gridex_db2b_final_readiness_v` (59), `gridex_db2b_rbac_snapshot_v` (127). | SELECT-only data access; first two views embed historical fixed targets; third spans platform admins and memberships. | Persistent diagnostic views, not no-schema. No later definitions found; each needs retention/hardening or approved retirement disposition. |
| `20260525_debug_batch_2c_activate_afshin_nibela.sql` | No DDL; dynamic `EXECUTE format` statements are membership UPDATE/INSERT (99,126). | Fixed-identity activation: companies/profile/membership/user-role/invitation writes; conditionally inserts `company_admin` role (51). | **Data-repair exclusion candidate, NOT CLOSED.** Do not replay historical activation. Separately prove generic `company_admin` role seed is canonically supplied; no assumption that DML is irrelevant. |
| `20260525_debug_batch_2d_activate_afshin_nibela_v2.sql` | No DDL; dynamic statements update/insert memberships and update invitations (117,146,221). | Fixed-target company upsert, profile/membership/role/invitation activation; generic roles UPDATE (42,60), optional role INSERT (56). | **Data-repair exclusion candidate, NOT CLOSED.** Same historical-data separation as 2c, with explicit generic role-data review because role normalization is not exclusively fixed-target. |
| `20260525_debug_batch_2e_verify_dashboard_user_provisioning.sql` | `ALTER TABLE public.company_invitations ADD COLUMN IF NOT EXISTS email text` (7) and `invited_email text` (8). | Broad invitation email synchronization UPDATEs (10,15); then target-specific verification SELECT. | **Mixed schema/data, not diagnostic-only.** Later source contains same additions, but is substituted and does not establish coverage (see below). |
| `20260525_debug_batch_2f_normalize_afshin_nibela.sql` | Same two invitation column additions (25–26). | Broad invitation email synchronization (28,33), then fixed-identity reassignment and membership/role/invitation normalization (92–201), optional company/role seeds. | **Mixed schema/data, not whole-file exclusion.** Extract/reconcile schema first; historical identity mutations must not be recreated as bootstrap data. Later source is not proof of canonical equivalence. |
| `20260525_debug_batch_2h_dedupe_user_roles_and_unique_guard.sql` | `CREATE UNIQUE INDEX IF NOT EXISTS user_roles_active_unique_role_text_idx` (54), `user_roles_active_unique_role_id_idx` (65): keys include user, coalesced company, role text/ID; predicates restrict active rows. | Two **global** duplicate-removal DELETEs from `user_roles` (25,48), not only the identity in the concluding SELECT. | **Schema-bearing invariant migration, not named-user repair exclusion.** Index names occur only in this source across migrations/bootstrap; absent from committed schema snapshot. Need canonical forward uniqueness decision and safe duplicate preflight, not blind replay or omission. |
| `20260525_debug_batch_2j_verify_no_old_afshin_id.sql` | None; SELECT/UNION only (5–72). | None; compares historical identity references across auth, memberships, roles and invitations. | **Read-only diagnostic exclusion candidate, NOT CLOSED.** No schema replacement needed. Explicit historical classification and checksum pin still required. |
| `20260525_verify_company_user_provisioning_flow.sql` | None; CTE SELECT/UNION only (3–87). | None; target-specific dashboard provisioning inspection. | **Read-only diagnostic exclusion candidate, NOT CLOSED.** No schema replacement needed; do not execute merely to claim schema coverage. |
| `20260519_bootstrap_div3rsa_superadmin.sql` | Extension (10); DROP/ADD `company_memberships_role_check` (15–20); ADD `user_profiles.active_company_id` with FK (293–294). | Generic roles, permissions and role-permission seeds plus named operator/company bootstrap (72–327). | **Mixed schema/reference data/operator repair.** Not an exclusion candidate as a whole; generic authorization data and constraints require separate canonical mapping. |
| `20260527_debug_user_invites_role_flow.sql` | Adds role key/scope/system columns (12–14), membership/invitation role_key/metadata (52–53,67–68), replaces four role/status checks (55–78). | Generic role normalization/seeding (34–42). | **Schema/reference-data migration despite debug name.** Keep unclassified pending forward canonical definitions/constraint equality, not exclusion. |
| `20260525_db4b_customer_registry_ediel_test_cleanup.sql` | `CREATE TABLE public.gridex_archived_customer_registry_rows` (10), view `gridex_db4b_customer_registry_visibility_v` (21), function `gridex_db4b_archive_customer_registry_row` (44). | Archive INSERT and customer UPDATE in helper, plus top-level profile archive/deletion (151–176). | **Mixed persistent archive capability and cleanup.** Not a data-only cleanup exclusion; resolve archive table/function/view independently. |

## Canonical coverage traps confirmed by source comparison

1. `20260527_fix_company_user_invite_runtime_columns.sql:77–78` repeats the `company_invitations.email` and `invited_email` additions found in 2e/2f. However `scripts/gridex-aud-003-legacy-foundation.additions.json:166–169` maps it to `bootstrap/20260527_company_memberships_role_key_foundation.sql`, a **membership-only** replacement. That bootstrap has no `company_invitations` statement. The committed `supabase/schema.sql:52516–52534` has invitation `email text NOT NULL` but no `invited_email`. Therefore “a later migration already defines it” is insufficient and full replacement coverage is **not proven**. Snapshot absence is repository evidence, not a fresh database assertion.
2. Searching migrations/bootstrap for `user_roles_active_unique_role_text_idx` and `user_roles_active_unique_role_id_idx` finds only 2h. Neither appears in `supabase/schema.sql`. Equivalent differently named indexes were not exhaustively disproven; exact historical effects cannot be marked preserved.
3. Searching `app`, `lib`, `scripts`, `supabase/bootstrap` and `supabase/schema.sql` for `gridex_db2` produced no matches. This supports a diagnostic-retirement investigation but does not prove absence of external consumers or production dependencies. All 7 views in the three small DB2 preflight/validation files remain explicit object-disposition work; 01 DB2 adds another 9 views and 12 functions.

## Verification and next action

| Check | Outcome |
|---|---|
| Current worktree `python3 scripts/gridex-replay-input-accounting.py` at review start | Exit 2: concurrent migration not checksum-pinned; no gate bypass. |
| Same checker on committed scripts+supabase archive | Actual exit 1 captured: 585 inputs; 58 UNCLASSIFIED, 32 SUBSTITUTED. |
| All 58 paths, direct DDL scan plus selected body review | 52 contain direct persistent DDL; six candidates above lack direct DDL. Not a SQL parser or dynamic execution proof. |
| Later invitation source vs effective bootstrap vs committed snapshot | Partial replacement confirmed; invitation schema coverage not established. |
| DB2/index definitions and local consumers search | Unique DB2 definitions and 2h index definitions remain unresolved; no local app/lib/script matches for DB2. |
| Live database / replay execution / trigger effects / role seed sufficiency | NOT RUN / NOT VERIFIED. |

Next: review and approve individual metadata classifications for the two pure SELECT diagnostics and four DML repair candidates, retaining hash-pinned historical provenance and generic role-data requirements. Independently inventory the remaining 52 schema-bearing inputs and 32 partial substitutions by object/effect, then introduce only targeted forward canonical definitions with replay/upgrade verification. **Zero inputs are verified closed by this report. Keep the blocking accounting gate red until genuine classification and effect evidence exists.**

## Bounded diagnostic disposition — 2026-09-05 follow-up

Supersedes the two pure SELECT rows' candidate status only. The rest of this
report remains PARTIAL; no replay, production parity, schema phase or partial
substitution is closed. Parent owns shared memory and the full remediation.
Skill routing: systematic-debugging for selector/provenance root cause; TDD for
real-selector fixture coverage; verification-before-completion for exact results.
Using-superpowers exempts dispatched subagents. UI, performance, production SQL,
new skill creation and broad audit workflows are outside this bounded subtask.

The two exact historical sources now use the distinct status
`historical_read_only_diagnostic`, without asserting undeployed lineage:

| Source basename | Immutable SHA-256 |
|---|---|
| `20260525_debug_batch_2j_verify_no_old_afshin_id.sql` | `10874b4600763f89d7e0f1c9e4c3e1e57c9e5ea50928d1af97b9d43185ec0da9` |
| `20260525_verify_company_user_provisioning_flow.sql` | `b0e38917e7e5ec00310b0246f306ec4614808ed16964b6488c845b107ec7403f` |

Exact-body review found only SELECT/UNION (and SELECT CTEs in provisioning),
`lower`, `coalesce`, and built-in text/uuid/boolean casts. No persistent DDL,
DML, SELECT INTO, locking clause, dynamic SQL or application function call is
present. This is source-level disposition of historical inspection inputs,
not proof of runtime catalog behavior or live deployment history. Their output
is not canonical schema or required reference-data initialization.

The actual replay selector and independent JS provenance validator both pin
these exact path/hash pairs in code as well as requiring their existing history
and exclusion-manifest pins. This is a **finite reviewed-content allowlist,
not a SQL parser**: refreshing both JSON hashes still cannot authorize modified
SQL. Unknown statuses and unknown diagnostic paths fail closed. No arbitrary
SELECT script is automatically trusted. Existing undeployed-artifact status
and its existing artifact are retained with their distinct lineage rationale.

Verification (no SQL execution or database connection):

- RED: `python3 scripts/gridex-replay-input-accounting-selftest.py` before selector change failed the new exact-diagnostic acceptance case with `incomplete noncanonical classification` (8 failure reports including rejection-message subtests).
- GREEN: same command, 21 tests PASS. New cases reject DDL, DML, writable CTE, function invocation, SELECT INTO and even an extra SELECT when content is modified and JSON hashes refreshed; also reject unknown status/path. Existing overlap, checksum, partial-substitution and unclassified-input behavior remains covered.
- `node scripts/gridex-aud-003-migration-provenance-regression.cjs`: PASS, `STATIC_PROVENANCE_PASS`, 3 exclusions.
- `python3 scripts/gridex-aud-003-clean-replay-selftest.py`: 11 tests PASS, including accounting failure before replay mutations and cleanup recovery.
- `bash -n scripts/gridex-aud-003-clean-replay.sh` and `git diff --check`: PASS.
- `python3 scripts/gridex-replay-input-accounting.py --require-full-effects`: **actual subprocess exit 1**, 586 inputs; 495 FULL_FILE_SELECTED, 32 SUBSTITUTED, 3 EXPLICITLY_EXCLUDED, **56 UNCLASSIFIED**. SQL execution and ledger provenance flags remain false. Count includes parent's concurrently pinned forward migration; this subtask did not alter SQL/history inventories.

Only two input-accounting dispositions are resolved by this follow-up. The 56
remaining unclassified inputs and all 32 partial substitutions still block full
effects. No blanket schema-history exclusion, SQL mutation, ledger write,
production connection, workflow change, commit or publication was performed by
this bounded subtask. Next: parent continues effect-by-effect canonical
reconstruction and full replay/upgrade/parity verification.

## Replay cleanup preflight protection — bounded follow-up

Confirmed independent defect: EXIT cleanup called `supabase stop --no-backup`
even when accounting failed before any startup. Added `STACK_START_ATTEMPTED`,
initially false and armed immediately before the existing local `supabase start`.
Cleanup stops only after a start attempt; partially failed starts still receive
cleanup and original failure status and file restoration remain intact.

RED: cleanup selftest showed two failures: accounting exit 2 emitted an unwanted
stop call, and the disposable pre-existing-stack marker was removed. GREEN:
`python3 scripts/gridex-aud-003-clean-replay-selftest.py` now passes **14 tests**;
new tests prove no Supabase call on early accounting failure, preservation of a
mock pre-existing stack on that early failure, and stop after attempted startup
fails with exit 78 while preserving exit 78. Accounting selftest remains **21
PASS**; `bash -n scripts/gridex-aud-003-clean-replay.sh` and `git diff --check`
PASS. All startup/stop behavior was tested with disposable command mocks; no
actual Supabase or database command ran.

**Scope limitation remains open:** tracking a start attempt does not prove
ownership of an existing local stack if execution reaches `supabase start`.
This patch establishes preflight safety only; no new claim of exclusive local
stack ownership, fresh database state or full replay/parity completion is made.
The local CLI binary was unavailable (`--help` exited 127). Official CLI docs
were checked: [status](https://supabase.com/docs/reference/cli/supabase-status)
requires an already started local stack; documentation does not establish that
every failed status means no stack exists. No speculative nonzero-status guard
was added. [Stop](https://supabase.com/docs/reference/cli/supabase-stop) confirms
`--no-backup` deletes data volumes, which makes avoiding preflight stop material.
A separate namespace/ownership change requires reviewing outer workflow/local
CLI dependencies and is deliberately outside this bounded repair.
