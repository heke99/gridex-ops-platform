# Auth Provisioning Source Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the complete effects and safe next restoration contract for the remaining invitation and direct-account sources without reviving historical unsafe credential or tenant behavior.

**Architecture:** Reuse the verified selected foundation and existing five-source characterization. Map every complete-source unit to its actual prerequisite, data/security effect and later winner before proposing the smallest executable restoration batch. This evidence task ends in a concrete reviewed contract; source selection and production delivery are separate execution gates.

**Tech Stack:** PostgreSQL17, Supabase-compatible isolated fixtures, Python, immutable SQL migrations, JSON source/provenance manifests, GitHub Actions.

## Global Constraints

- Current verified publication is9e1223659491bb77ec2f13855189e9dd729238e1, exact tree76bd532190382312ab4698b532d448e4709d1533; OPS34470585925/auth102849298884 PASS all15 fixed commands and selected38 RBAC prefix. Quality/build102849298861 and Ediel102849298882 PASS.
-593 inputs:522 FULL_FILE_SELECTED,24 SUBSTITUTED,43 UNCLASSIFIED,4 EXPLICITLY_EXCLUDED;67 unresolved. Focused339:279/21/35/4;56 unresolved. These are input-selection counts, not final surviving-effect or production proof.
- Preserve immutable historical SQL/checksums, selected foundation82, historical fixture prefixes30/31/32/33, selected RBAC38 and all15 fixed runner commands.
- No production writes, credential generation, auth-provider mutation, email sending, real-user reads or real-data cleanup in this evidence task. User authorizes later necessary verified production delivery; no renewed permission request is implied.
- Never expose credentials, tokens or secret literals from a source. Report sensitive statements by path/line and effect, with synthetic identities only in proposed fixtures.
- No blanket exclusion, table/column excerpt substituted for unreviewed whole-source effects, weakening of guards or artifact refresh from incomplete replay.
- Preserve existing verified invitation/actor-FK reconstructions and canonical credential, tenant, membership and session invariants. Historical unsafe behavior is characterization evidence, not an approved runtime requirement.
- Root owns .agent-memory status/checkpoint/evidence and MASTER_PRODUCTION_REMEDIATION_STATE.md; delegated author owns only the named new evidence/contract documents and report.
- The user requested continuous execution. Do not pause for execution-method approval; independently review this result and continue the authorized masterplan.

---

### Task 1: Complete provisioning source effects and exact next restoration contract

**Files:**
- Create: `quality/audits/AUTH_PROVISIONING_SOURCE_EFFECTS_2026-09-10.md`.
- Create: `quality/audits/AUTH_PROVISIONING_RESTORATION_CONTRACT_2026-09-10.md`.
- Read: nine complete source files listed below, their manifest records, actual selected prerequisites, relevant canonical callers and later replacements.
- Reuse: `quality/audits/AUTH_INVITATION_CHAIN_REVIEW_2026-09-07.md`, `quality/audits/INVITATION_REPLAY_EFFECTS_2026-09-06.md`, `quality/audits/SAAS_TENANT_SOURCE_EFFECTS_2026-09-09.md`, `quality/audits/SYSTEM_DATA_INTEGRITY_ACCEPTANCE_2026-09-09.md`, `scripts/canonical-auth-invitation-chain-selftest.py`, `scripts/canonical-membership-actor-fk-selftest.py`, `scripts/sql/canonical-company-invitation-baseline.sql`.

**Interfaces:**
- Consumes verified selected foundation82/RBAC38 and preserved first33 boundary; canonical reconstruction `20260906081839_canonical_company_invitation_runtime_reconstruction.sql`, `20260907121951_canonical_membership_actor_fk_reconstruction.sql` and `20260909123000_canonical_invitation_token_prerequisite.sql` already present. Existing five-source characterization is executed, not a blanket restoration approval.
- Produces an exhaustive statement-unit effect matrix plus one exact prospective order/repair/fixture contract. The contract must state whether a safe whole-source restoration is currently possible, and if not the specific source-backed prerequisite/forward repair required before it is possible.

**Exact source scope (all under `supabase/migrations/`):**

1. `20260519_company_invite_temp_password_sync.sql` (415 lines)
2. `20260520_direct_account_temporary_password_flow.sql` (98 lines)
3. `20260520_direct_temporary_password_auth_sync_fix.sql` (183 lines)
4. `20260527_debug_user_invites_role_flow.sql` (80 lines)
5. `20260527_fix_company_user_creation_schema_safe_backfill.sql` (222 lines)
6. `20260527_fix_company_user_invite_runtime_columns.sql` (160 lines)
7. `20260528_auth_provisioning_runtime_guard.sql` (51 lines)
8. `20260528_final_user_access_schema_safe_repair.sql` (296 lines)
9. `20260528_fix_user_roles_without_role_column_and_compact_users.sql` (190 lines)

The list is a bounded investigation scope, not proof that all nine are one replay batch. Additional sources may be read only when a specific changed object, prerequisite or later winner requires them; document that dependency without restarting the entire repository audit.

- [x] **Step 1: Pin provenance and reuse executed evidence.** Compute SHA256/line counts and match manifest/accounting records for each scoped original; read the prior reports and existing fixture code. Distinguish historical report claims from the latest executed all15 receipt above. Record known losses: completed→sent event normalization, cleared profile action, invitation acceptance with expired issued-password metadata, skipped membership actor REFERENCES when columns preexist, and orphan-delete branches not exercised by the FK-constrained fixture.

Use exact immutable-byte inspection, without printing source contents or secrets:

```python
from pathlib import Path
import hashlib
scoped_names = {
    '20260519_company_invite_temp_password_sync.sql',
    '20260520_direct_account_temporary_password_flow.sql',
    '20260520_direct_temporary_password_auth_sync_fix.sql',
    '20260527_debug_user_invites_role_flow.sql',
    '20260527_fix_company_user_creation_schema_safe_backfill.sql',
    '20260527_fix_company_user_invite_runtime_columns.sql',
    '20260528_auth_provisioning_runtime_guard.sql',
    '20260528_final_user_access_schema_safe_repair.sql',
    '20260528_fix_user_roles_without_role_column_and_compact_users.sql',
}
for path in sorted(Path('supabase/migrations').glob('*.sql')):
    if path.name in scoped_names:
        raw = path.read_bytes()
        print(path.name, len(raw.splitlines()), hashlib.sha256(raw).hexdigest())
```

`scoped_names` is the exact nine filenames above. Validate against `scripts/migration-history-manifest*.json`; inventory is read-only. No SQL execution is implied by this command.

- [x] **Step 2: Map every complete statement unit.** For each CREATE/ALTER/function/policy/grant/trigger/DO/DML/delete unit, record exact source path/lines, prerequisites, guards and skipped effects, affected row identities/fields, tenant/actor attribution, constraints/indexes, function signature/return/security/search-path/ACL, transaction/autocommit boundary, native failure modes and later winning definition. Include zero/one/multiple-row, NULL/orphan/duplicate/conflicting-tenant shapes and safe rollback/retry implications where the actual statement supports them. Mark non-mutating diagnostics separately. Do not infer whole-file equivalence from one derived bootstrap or table shape.

- [x] **Step 3: Resolve actual dependency and consumer boundaries.** Trace only implicated objects through selected sources, forward reconstructions, auth-provider schema assumptions and current canonical callers. Distinguish UUID token, token hash, invitation-token aliases and password metadata. Preserve active canonical invitation acceptance/delivery/revocation semantics, tenant/member/role checks and inactive-user denial. Identify whether later definitions remove or retain unsafe historical routines/policies and whether a complete chain restores or regresses RLS/ACLs. Full later-chain acceptance remains a separate gate unless actually proved.

- [x] **Step 4: Write the exact next executable contract.** State the smallest coherent complete-source/forward-repair unit, exact order and insertion boundary with hashes, every needed existing/new schema prerequisite and immutable preservation condition, required canonical caller behavior, seed identities and allowed data transitions, full expected catalogs/ACLs/policies, clean/dirty/native-failure/concurrency/repeat tests and rollback boundaries. Use synthetic-only credentials/identities. Distinguish actual selected-prefix and deliberately reduced fixtures. If a design decision is not resolvable from the user goal/source/canonical consumer evidence, record the precise unresolved decision and its consequence; do not invent approval or manufacture a passing weaker requirement. State exact accounting/provenance changes only for a proposed separately reviewed selection. Include concrete subsequent implementation files/commands/test cases based on the established source evidence, not placeholders.

- [x] **Step 5: Self-check and commit only the two documents.** Verify all1695 source lines are assigned to complete effect units or explicit non-mutating comments/diagnostics, every claimed source/hash/consumer reference exists, all proposed aliases/interfaces are defined and source-selection counts remain unchanged. Run `git diff --check`; inspect `git diff --name-only` to ensure immutable SQL, selectors and root-owned status are untouched. Commit the two documents. Write the full report to the task's ignored SDD report file with commands/results, coverage mapping, scope decisions and any genuinely blocked requirement. Independent review follows; no local SQL or production claim is permitted.


### Task 2: Prepare the actual CLI migration skeleton on the isolated hosted runner

**Files:**
- Modify: `.github/workflows/ops-hardening.yml`, only `jobs.auth-email-source-effects.steps` after the existing fixed-group command.
- Consume: `quality/audits/AUTH_PROVISIONING_RESTORATION_CONTRACT_2026-09-10.md`, independently approved Task1 revision.
- Report: `.superpowers/sdd/AUTH_PROVISIONING_SOURCE_RESTORATION_PLAN_2026-09-10/task-2-report.md`.

**Interfaces:**
- Requires Task1 independent approval. Existing local CLI is absent and the bounded pinned installation probe was blocked; reuse hosted `supabase/setup-cli@v1`, version2.101.0, already used by this repository.
- Produces one downloadable empty migration skeleton from actual CLI execution, not a hand-authored timestamp. No SQL, manifest, selector or accounting changes in this preparation commit.
- Root publishes the independently reviewed workflow plus Task1 evidence/status batch, retrieves the artifact and supplies its exact generated basename to Task3. Task3 removes these temporary steps before publication of the filled migration and standalone SQL test.

- [ ] **Step 1: Add the exact preparation steps after the unchanged fixed15 command.** Preserve every existing service, job, trigger and command. Add only:

```yaml
      - uses: supabase/setup-cli@v1
        with:
          version: 2.101.0
      - name: Create diagnostics migration skeleton
        run: |
          supabase --version
          supabase migration new --help
          supabase migration new canonical_auth_provisioning_diagnostics_boundary
      - uses: actions/upload-artifact@v4
        with:
          name: auth-provisioning-migration-skeleton
          path: supabase/migrations/*_canonical_auth_provisioning_diagnostics_boundary.sql
          if-no-files-found: error
```

- [ ] **Step 2: Check the bounded workflow diff and existing constructor contract.** Run:

```sh
git diff --check
python3 scripts/canonical-auth-membership-group-selftest.py
git diff -- .github/workflows/ops-hardening.yml
```

Expected: diff whitespace clean; existing group static assertions PASS with unchanged593/foundation82/15 commands; only the three new preparation steps in the workflow diff. This task does not claim SQL execution locally. A separate implementation-mirroring test is unnecessary for the temporary setup steps.

- [ ] **Step 3: Commit only the workflow and write the full report.**

```sh
git add .github/workflows/ops-hardening.yml
git commit -m "ci: generate diagnostics migration skeleton with pinned Supabase CLI"
```

Report the exact commit, covering command/results and preservation checks. Independent review follows before root publishes. The hosted acceptance must show original15 PASS, CLI version/help/new success and uploaded artifact. Root records exact head/run/job/artifact and retrieves only the skeleton. No database mutation, credential generation or production call is part of this task.


### Task 3: Implement the transactional diagnostics repair and standalone execution proof

**Files:**
- Fill: the exact CLI-created `supabase/migrations/*_canonical_auth_provisioning_diagnostics_boundary.sql` artifact from Task2; root records its concrete basename in this task before dispatch.
- Create: `scripts/canonical-auth-provisioning-diagnostics-selftest.py`.
- Create: `scripts/canonical-auth-provisioning-diagnostics-selection-selftest.py`.
- Modify: the normal migration history checksum manifest, adding only R's actual new bytes/hash.
- Modify: `scripts/canonical-governance-selftest.py` and `scripts/canonical-operations-sync-selftest.py`, only the reviewed intermediate global-count expectations.
- Modify: `.github/workflows/ops-hardening.yml`, remove Task2 skeleton preparation and add the standalone diagnostics test after the unchanged fixed15 command.
- Modify: `quality/audits/AUTH_PROVISIONING_RESTORATION_CONTRACT_2026-09-10.md`, record actual R basename/hash and correct the reviewed minor opening policy wording to exact validation/retention.
- Root-owned: active memory/count summaries advance to594/523 and focused340/280 alongside R registration; implementer coordinates that transition without editing root-owned files.

**Interfaces:**
- Consumes the independently approved complete contract and Task2's actual generated migration basename. All target catalogs, synthetic identities, native failures, transaction/admission boundaries, source order and caller limits in the contract are requirements of this task.
- Produces a whole-file transactional R, source-backed fixture and standalone hosted proof with G still UNCLASSIFIED. Current foundation82, first41 and fixed15 commands remain unchanged. Registration adds one selected timestamp input; counts become594=523/24/43/4, focused340=280/21/35/4. Unresolved67/56 remain.
- No selection JSON edit in this task. Append command16 and change foundation84 only in the subsequent separately reviewed selection task after standalone hosted proof.

- [ ] **Step 1: Build the fixed-target fixture and negative-first source proof.** Reuse the repository's actual prefix constructor pattern and checksum validation. Execute the exact first41 complete inputs, then whole G; keep reduced cases explicitly labelled. At G-only state prove owner-security/no-RLS and seeded hostile client grants expose synthetic diagnostic rows. No real records or arbitrary database URL. Constructor/selection checks reject altered/truncated G, wrong order, omitted R and checksum tampering. Preserve original15 commands and historical prefix fixtures.

- [ ] **Step 2: Fill the CLI-created R with the exact reviewed transaction.** Use one BEGIN/COMMIT, local lock_timeout10s and statement_timeout60s. Validate exact table/index/view/role/policy catalogs and owners before changing security. Named mismatch errors and effective inherited privilege rejection follow the contract. Security body includes:

```sql
alter table public.auth_provisioning_events enable row level security;
alter view public.gridex_user_auth_integrity_v set (security_invoker = true);
revoke all on table public.auth_provisioning_events
  from public, anon, authenticated, authenticator;
revoke all on table public.gridex_user_auth_integrity_v
  from public, anon, authenticated, authenticator;
grant select on table public.auth_provisioning_events to service_role;
```

Add the restrictive false ALL policy only if absent; otherwise validate and retain its OID. Revoke SELECT/INSERT/UPDATE/REFERENCES column grants using catalog-enumerated identifier-safe SQL. Do not grant service view/Auth/base-table privileges, change default privileges or role memberships, rewrite historical migrations, or mutate invitation/access/Auth/event history.

- [ ] **Step 3: Complete every reviewed fixture lane.** Implement the contract's exact independent empty/two-tenant/multiple-role/membership-only/role-only/profile-only/Auth-only/orphan/NULL/duplicate/timestamp/history cases, exact projection/catalog and symmetric multiset preservation. Exercise client CRUD denial and service event-count success, column/inherited ACLs, restrictive-plus-permissive policy interaction, native23502/23505/42703/42P01/42P16 failures, named dirty-shape rollback, repeat/OID retention, native G autocommit versus labelled G+R-body composite rollback, real55P03 contention and serialized retry. Never label emitted SQL as executed or a reduced schema as actual prefix. Validate the actual final RBAC helper separately as specified in the contract.

- [ ] **Step 4: Register actual bytes and add standalone hosted execution.** Add only R to the normal checksum history manifest. Update only named intermediate count guards. Remove the entire temporary CLI/artifact block and add:

```yaml
      - name: Verify standalone auth provisioning diagnostics on PostgreSQL 17
        run: python3 scripts/canonical-auth-provisioning-diagnostics-selftest.py
```

It follows unchanged `Verify fixed auth and membership group on isolated PostgreSQL 17` in the same job/service. Do not append command16 yet. Root updates dynamic active-count text before its equality check.

- [ ] **Step 5: Run bounded available checks, independently review and obtain hosted SQL acceptance.**

```sh
python3 scripts/canonical-auth-provisioning-diagnostics-selection-selftest.py
python3 scripts/canonical-auth-membership-group.py --dry-run
python3 scripts/canonical-auth-membership-group-selftest.py
python3 scripts/gridex-replay-input-accounting-selftest.py
node scripts/check-migration-versions.cjs
node scripts/gridex-aud-003-migration-provenance-regression.cjs
git diff --check
```

Run local SQL only if fixed disposable PostgreSQL is actually available; otherwise report it pending. Commit only owned implementation paths after inspecting the complete diff. Report exact command outputs and outstanding execution to task-3-report.md. Root obtains independent code/security review, publishes the exact reviewed tree, requires unchanged15 and standalone diagnostics PASS on that head, fixes confirmed failures through the author/review loop, and records the receipt before the selection task. Required global source/types gates remain red until the remaining masterplan work resolves them.
