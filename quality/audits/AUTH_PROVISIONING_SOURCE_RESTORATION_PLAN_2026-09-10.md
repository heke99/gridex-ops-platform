# Auth Provisioning Source Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the complete effects and safe next restoration contract for the remaining invitation and direct-account sources without reviving historical unsafe credential or tenant behavior.

**Architecture:** Reuse the verified selected foundation and existing five-source characterization. Map every complete-source unit to its actual prerequisite, data/security effect and later winner before proposing the smallest executable restoration batch. This evidence task ends in a concrete reviewed contract; source selection and production delivery are separate execution gates.

**Tech Stack:** PostgreSQL17, Supabase-compatible isolated fixtures, Python, immutable SQL migrations, JSON source/provenance manifests, GitHub Actions.

## Global Constraints

- Task7 VERIFIED at4130cdd9b4ebe2dc018ec596d5c4e839cc6e5bb5, tree615de55cba5b80454dc16090f9a935b2393fdd86; OPS34501598746 original16/auth102953458828 PASS and COMPLETE standalone legacy102953458693 PASS (132502ms). Quality/build102953458698, Ediel102953458823, tenant102953458862, browser102953459131 and coverage102953459546 PASS. All five hosted defects corrected with independent reviews; current counts/selection unchanged. Task8 may now integrate the proven complete-source group; full replay/types/production remain open.
- Task8 working-tree selection:595 inputs/533 FULL_FILE_SELECTED/23 SUBSTITUTED/35 UNCLASSIFIED/4 EXPLICITLY_EXCLUDED;58 unresolved. Focused341:290/20/27/4;47 unresolved. Foundation93, unchanged first43, ABCDEFHIQ44–52 and old suffix53–93. Prior published Task7 is595/525/24/42/4 and foundation84; integration337caaa4 independently APPROVED; first hosted actual-loop attempt rejected stage permissions, correction6d2809a5 independently APPROVED and both Minor findings closed. Hosted all17/actual-loop proof pending. Earlier task-stage counts below remain historical interfaces.
- Preserve immutable historical SQL/checksums, historical fixture prefixes30/31/32/33, selected RBAC38, verified first43, former foundation84 suffix and the exact original16 runner command prefix. Any future source addition requires its own exact reviewed insertion and hosted acceptance.
- No production writes, credential generation, auth-provider mutation, email sending, real-user reads or real-data cleanup in this evidence task. User authorizes later necessary verified production delivery; no renewed permission request is implied.
- Never expose credentials, tokens or secret literals from a source. Report sensitive statements by path/line and effect, with synthetic identities only in proposed fixtures.
- No blanket exclusion, table/column excerpt substituted for unreviewed whole-source effects, weakening of guards or artifact refresh from incomplete replay.
- Preserve existing verified invitation/actor-FK reconstructions and canonical credential, tenant, membership and session invariants. Historical unsafe behavior is characterization evidence, not an approved runtime requirement.
- Root owns .agent-memory status/checkpoint/evidence and MASTER_PRODUCTION_REMEDIATION_STATE.md; each delegated author owns only the files named in its task and its report.
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

- [x] **Step 1: Add the exact preparation steps after the unchanged fixed15 command.** Preserve every existing service, job, trigger and command. Add only:

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

- [x] **Step 2: Check the bounded workflow diff and existing constructor contract.** Run:

```sh
git diff --check
python3 scripts/canonical-auth-membership-group-selftest.py
git diff -- .github/workflows/ops-hardening.yml
```

Expected: diff whitespace clean; existing group static assertions PASS with unchanged593/foundation82/15 commands; only the three new preparation steps in the workflow diff. This task does not claim SQL execution locally. A separate implementation-mirroring test is unnecessary for the temporary setup steps.

- [x] **Step 3: Commit only the workflow and write the full report.**

```sh
git add .github/workflows/ops-hardening.yml
git commit -m "ci: generate diagnostics migration skeleton with pinned Supabase CLI"
```

Report the exact commit, covering command/results and preservation checks. Independent review follows before root publishes. The hosted acceptance must show original15 PASS, CLI version/help/new success and uploaded artifact. Root records exact head/run/job/artifact and retrieves only the skeleton. No database mutation, credential generation or production call is part of this task.


### Task 3: Implement the transactional diagnostics repair and standalone execution proof

**Files:**
- Create from retrieved CLI artifact, then fill: `supabase/migrations/20260910121054_canonical_auth_provisioning_diagnostics_boundary.sql`. The exact empty source artifact is `.superpowers/sdd/AUTH_PROVISIONING_SOURCE_RESTORATION_PLAN_2026-09-10/20260910121054_canonical_auth_provisioning_diagnostics_boundary.sql` (0bytes, SHA256e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855). Copy that actual artifact before writing the SQL body; do not generate a different timestamp.
- Create: `scripts/canonical-auth-provisioning-diagnostics-selftest.py`.
- Create: `scripts/canonical-auth-provisioning-diagnostics-selection-selftest.py`.
- Modify: `scripts/migration-history-manifest.json`, adding only R's actual new bytes/hash.
- Modify: `scripts/canonical-governance-selftest.py` and `scripts/canonical-operations-sync-selftest.py`, only the reviewed intermediate global-count expectations.
- Modify: `.github/workflows/ops-hardening.yml`, remove Task2 skeleton preparation and add the standalone diagnostics test after the unchanged fixed15 command.
- Modify: `quality/audits/AUTH_PROVISIONING_RESTORATION_CONTRACT_2026-09-10.md`, record actual R basename/hash and correct the reviewed minor opening policy wording to exact validation/retention.
- Root-owned: active memory/count summaries advance to594/523 and focused340/280 alongside R registration; implementer coordinates that transition without editing root-owned files.

**Interfaces:**
- Consumes the independently approved complete contract and Task2's actual generated migration basename. All target catalogs, synthetic identities, native failures, transaction/admission boundaries, source order and caller limits in the contract are requirements of this task.
- Produces a whole-file transactional R, source-backed fixture and standalone hosted proof with G still UNCLASSIFIED. Current foundation82, first41 and fixed15 commands remain unchanged. Registration adds one selected timestamp input; counts become594=523/24/43/4, focused340=280/21/35/4. Unresolved67/56 remain.
- No selection JSON edit in this task. Append command16 and change foundation84 only in the subsequent separately reviewed selection task after standalone hosted proof.

- [x] **Step 1: Build the fixed-target fixture and negative-first source proof.** Reuse the repository's actual prefix constructor pattern and checksum validation. Execute the exact first41 complete inputs, then whole G; keep reduced cases explicitly labelled. At G-only state prove owner-security/no-RLS and seeded hostile client grants expose synthetic diagnostic rows. No real records or arbitrary database URL. Constructor/selection checks reject altered/truncated G, wrong order, omitted R and checksum tampering. Preserve original15 commands and historical prefix fixtures.

- [x] **Step 2: Fill the CLI-created R with the exact reviewed transaction.** Use one BEGIN/COMMIT, local lock_timeout10s and statement_timeout60s. Validate exact table/index/view/role/policy catalogs and owners before changing security. Named mismatch errors and effective inherited privilege rejection follow the contract. Security body includes:

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

- [x] **Step 3: Complete every reviewed fixture lane.** Implement the contract's exact independent empty/two-tenant/multiple-role/membership-only/role-only/profile-only/Auth-only/orphan/NULL/duplicate/timestamp/history cases, exact projection/catalog and symmetric multiset preservation. Exercise client CRUD denial and service event-count success, column/inherited ACLs, restrictive-plus-permissive policy interaction, native23502/23505/42703/42P01/42P16 failures, named dirty-shape rollback, repeat/OID retention, native G autocommit versus labelled G+R-body composite rollback, real55P03 contention and serialized retry. Never label emitted SQL as executed or a reduced schema as actual prefix. Validate the actual final RBAC helper separately as specified in the contract.

- [x] **Step 4: Register actual bytes and add standalone hosted execution.** Add only R to the normal checksum history manifest. Update only named intermediate count guards. Remove the entire temporary CLI/artifact block and add:

```yaml
      - name: Verify standalone auth provisioning diagnostics on PostgreSQL 17
        run: python3 scripts/canonical-auth-provisioning-diagnostics-selftest.py
```

It follows unchanged `Verify fixed auth and membership group on isolated PostgreSQL 17` in the same job/service. Do not append command16 yet. Root updates dynamic active-count text before its equality check.

- [x] **Step 5: Run bounded available checks, independently review and obtain hosted SQL acceptance.**

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

Task2 hosted acceptance:95a41dea, OPS34474633273/auth102862356592 PASS all15 plus CLI2.101.0 version/help/new and artifact upload. Artifact10151184576, ZIP SHA256ec04108c02c4a4c2549d3ae49768df16489737059bc09558165fcc0d4b6fea41 verified after download; one exact empty migration above. Quality/build102862356599 and Ediel102862356702 PASS; required verify/types and clean/source-completeness remain red.


### Task 4: Select verified whole diagnostics sources and integrate command16

**Prerequisite VERIFIED:** Task3 implementation3b946b1a independently APPROVED; published17984611 exact tree77e1ac320a74889911fb0ae6fcc3d34c089dc62e, OPS34478576195/auth102875334400 PASS original15 plus complete standalone diagnostics. Root reviewed executed receipts including all reduced/dirty/native/role/concurrency and actual41 lanes. G-after-R alone observed invoker=false/reloptionsNULL and not runtime-ready; final R secure boundaries PASS. R SHA256018d81e763e6134ddb3d886ef7e219d6247584a9dad14b871e2ef98014db6333; preserve those bytes.

**Files:**
- Modify: `scripts/gridex-aud-003-foundation-order.json` and `scripts/gridex-aud-003-legacy-foundation.additions.json`.
- Modify: `scripts/canonical-auth-membership-group.py` and `scripts/canonical-auth-membership-group-selftest.py`.
- Modify: `scripts/canonical-auth-provisioning-diagnostics-selftest.py` and `scripts/canonical-auth-provisioning-diagnostics-selection-selftest.py`.
- Modify: `scripts/canonical_full_governance_contract.py`, `scripts/invitation_token_prerequisite_selftest.py`, `scripts/canonical-governance-selftest.py`, `scripts/canonical-operations-sync-selftest.py`, only exact reviewed global count/order-stage assertions.
- Modify: `.github/workflows/ops-hardening.yml`, remove the standalone diagnostics step when appending command16.
- Root-owned: active594/524/42 and focused340/281/34 summaries and exact hosted receipt.

**Interfaces:**
- Consumes complete G and R bytes/hash accepted by Task3; neither source changes in this selector/integration task.
- Produces first41 unchanged, G42/R43, unchanged old42–82 suffix shifted by2, foundation84; exact original15 commands plus diagnostics as16, no duplicate standalone workflow run.
- Accounting594=524/24/42/4, unresolved66; focused340=281/21/34/4, unresolved55. Only G changes UNCLASSIFIED→FULL_FILE_SELECTED. R remains selected exactly once; no added substitution/exclusion or checksum edits.
- Task3 low-severity failure-localization finding must be addressed here with safe static diagnostics and a narrow synthetic regression; no raw stderr/SQL/provider data in receipts.

- [x] **Step 1: Assert the unchanged boundaries before editing the selection.** Use the executing fixture's exact prefix/suffix digests and immutable source checks. Add negative controls for misplaced/missing/duplicate G/R, altered first41, changed old suffix and attempted duplicate timestamp replay. The target transformation is exactly:

```python
old_order = list(order['foundation'])
assert len(old_order) == 82
assert G not in old_order and R not in old_order
new_order = old_order[:41] + [G, R] + old_order[41:]
assert len(new_order) == 84
assert new_order[:41] == old_order[:41]
assert new_order[41:43] == [G, R]
assert new_order[43:] == old_order[41:]
```

G is `migrations/20260528_auth_provisioning_runtime_guard.sql`; R is `migrations/20260910121054_canonical_auth_provisioning_diagnostics_boundary.sql`. Add these two complete inputs to additions.foundation without changing its other entries or derivedBootstrap. Save the global foundation order with only this insertion. Retain immutable base foundation manifest and every source checksum.

- [x] **Step 2: Integrate the proven SQL command once.** Append this exact tuple to the existing COMMANDS tuple:

```python
('python3', 'scripts/canonical-auth-provisioning-diagnostics-selftest.py'),
```

The original15 entries remain byte-identical/in order. Update the group's explicit command-list regression to16, and the diagnostics constructor's runner checksum to the actual new runner bytes. Remove the temporary standalone workflow step in the same commit. Assert the workflow now executes the diagnostics through the fixed group only. Keep all prior fixture constructors/boundaries30/31/32/33 and RBAC38 unchanged.

- [x] **Step 3: Advance only selected-stage global guards.** The diagnostics loader still constructs actual first41 and wholeG/R, now validating order84, exactG42/R43 and unchanged suffix43 onward. Change foundation82→84 only in the named global guards from the approved contract; preserve prefix33 digest and DOWNSTREAM indexes37–40, existing source-path/hash and RBAC adjacency assertions. Advance selected523→524/unclassified43→42 and focused selected280→281/unclassified35→34. Total594/focused340/substituted/excluded remain unchanged. Notify root before dynamic memory equality tests. Keep all errors and negative controls; never weaken a count equality to an inequality.

- [x] **Step 4: Preserve safe failure-localization evidence.** Implement the Task3 reviewed low-severity improvement in the diagnostics harness: on unexpected SQL failure retain a known static assertion/rejection label or verified source/fixture stage plus numeric location. Validate labels against known generated fixture/source labels; do not expose arbitrary PostgreSQL error text, SQL statements, provider-shaped data or private file contents. Add a database-free regression with two synthetic failures sharing SQLSTATEP0001 and distinct permitted labels/locations; assert distinct actionable receipts and exclusion of a synthetic forbidden payload. Successful SQL and expected-native-failure behavior must stay unchanged. This is a narrow observability correction, not relaxed acceptance.

- [x] **Step 5: Verify, commit only owned paths and obtain independent/hosted acceptance.**

```sh
python3 scripts/canonical-auth-provisioning-diagnostics-selection-selftest.py
python3 scripts/canonical-auth-membership-group.py --dry-run
python3 scripts/canonical-auth-membership-group-selftest.py
python3 scripts/gridex-replay-input-accounting-selftest.py
node scripts/check-migration-versions.cjs
node scripts/gridex-aud-003-migration-provenance-regression.cjs
git diff --check
```

Require exact new accounting/order/provenance and16-command dry-run; scope any failures to the new selected stage rather than modifying historical semantics. Commit only named paths; full report task-4-report.md includes checks and unresolved SQL boundary. Root independently reviews selection/integration/safe diagnostics, publishes the exact tree, runs the complete16-command group in hosted PostgreSQL17 and fixes confirmed failures through the review loop. Only actual all16 PASS closes this bounded selection task. Full selected later-chain security, remaining66 sources, schema/types, parity and production delivery remain mandatory subsequent work; no final readiness or phase closure follows merely from selecting G.


### Task 5: Design lossless restoration of the eight remaining provisioning originals

**Prerequisite VERIFIED:** Task4 fdc8cab9 independently APPROVED; published194fd0cf exact tree80b28b18d51da671b9a9754c3698181db04e2d9f, OPS34482627601/auth102888925544 PASS complete fixed16. No restart of completed Task1 effects or Task3/4 SQL proof.

**Files:**
- Create: `quality/audits/AUTH_PROVISIONING_LEGACY_ADMISSION_CONTRACT_2026-09-10.md`.
- Reuse: `quality/audits/AUTH_PROVISIONING_SOURCE_EFFECTS_2026-09-10.md`, `quality/audits/AUTH_PROVISIONING_RESTORATION_CONTRACT_2026-09-10.md`, `quality/audits/AUTH_INVITATION_CHAIN_REVIEW_2026-09-07.md`, `quality/audits/INVITATION_REPLAY_EFFECTS_2026-09-06.md`, `quality/audits/SYSTEM_DATA_INTEGRITY_ACCEPTANCE_2026-09-09.md`.
- Read only as required by an implicated effect: actual selected prerequisites, existing invitation/actor-FK reconstructions, canonical callers and later winning definitions, existing five-source characterization.
- Report: `.superpowers/sdd/AUTH_PROVISIONING_SOURCE_RESTORATION_PLAN_2026-09-10/task-5-report.md`.

**Interfaces:**
- Consumes the already complete1644-line/103-unit matrix for A/B/C/D/E/F/H/I; G's7 units are restored and are outside the new source scope. No repeated whole-repository inventory or new source-effect matrix is needed.
- Exact remaining files under `supabase/migrations/`: `20260519_company_invite_temp_password_sync.sql`; `20260520_direct_account_temporary_password_flow.sql`; `20260520_direct_temporary_password_auth_sync_fix.sql`; `20260527_debug_user_invites_role_flow.sql`; `20260527_fix_company_user_creation_schema_safe_backfill.sql`; `20260527_fix_company_user_invite_runtime_columns.sql`; `20260528_final_user_access_schema_safe_repair.sql`; `20260528_fix_user_roles_without_role_column_and_compact_users.sql`.
- Produces one concrete independently reviewable admission/transaction/forward-repair contract for the coherent next unit(s), covering the dependencies of all eight. Prefer a complete coherent batch where safety can be proved; split only where actual effect/transaction dependencies require separate acceptance. Do not choose one file merely to avoid resolving the already mapped coupled effects.
- Current594=524/24/42/4 (66 unresolved), focused340=281/21/34/4 (55 unresolved), foundation84/first43 including G/R, original16 commands. This evidence task changes none of them.

- [x] **Step 1: Reuse the exact source evidence and expose the actual remaining blockers.** Verify the eight current source hashes against the existing matrix/manifest without logging their contents. Reuse executed losses (event/status normalization, cleared profile action, expired-password invitation acceptance, skipped conditional REFERENCES) as unsafe historical characterization. For each remaining effect, state whether the next execution is an empty canonical replay, seeded compatibility proof, dirty-state admission, or eventual live forward convergence. These are distinct acceptance boundaries. ADR-006 forbids blindly replaying or mass-marking the noncanonical history live; do not reinterpret offline source execution as production authorization or rewrite that decision in this task.

- [x] **Step 2: Resolve a lossless, safe application boundary from the actual source and canonical behavior.** For all affected profile/membership/invitation/event/role/user-role/Auth and triggered durable-work fields, specify exact identities and before/after allowed multisets, inactive/NULL/orphan/conflicting-tenant/multi-role cases and catalog constraints. Evaluate coherent transaction/admission with complete immutable source bytes and exact forward reconstruction, or precise zero-eligible-row/source-backed preconditions where that is the only safe route. Never approve expired-metadata acceptance, default company_admin grants, all-role reactivation, nondeterministic ownership, audit loss or guessed token aliases. No provider operation, credential generation, real-user read, outgoing message or production mutation is needed for this design. Account for PostgreSQL service/cleanup logs as well as Python receipts: current hosted cleanup prints SQL STATEMENT lines on expected database errors. Do not claim a secret leak without evidence, but the next sensitive legacy-source fixture must define how to prevent raw source/credential/provider content escaping via server logs while preserving SQLSTATE and safe failure diagnostics.

- [x] **Step 3: Specify complete source order and forward repairs.** Preserve verified first43, existing G/R secure final boundary and canonical invitation/actor/token invariants unless a concrete reviewed prerequisite requires a separately described insertion; no silent historical fixture renumbering. Identify every old definition/constraint/trigger/ACL that a complete source would replace, the exact canonical later winner and any necessary immediate forward repair. Distinguish transactional DML restoration from later DDL replacement, which cannot undo committed lost history. Include inherited privilege/session/durable-intent consequences, and do not disable tenant guards or triggers merely to make a fixture pass. No source fragments, blanket exclusions or checksum rewrites.

- [x] **Step 4: Write exact implementation/verification tasks for the proved next unit.** Name existing/new files and interfaces, source/hash/order boundaries, CLI-created future migration naming operation if needed, exact count deltas, complete actual-prefix versus explicitly reduced fixture lanes, dirty/native/concurrency/repeat/rollback cases and hosted command integration. Specify independent review before source selection and exact-head SQL acceptance before any downstream readiness claim. State any truly unresolved source-backed decision with its consequence; do not manufacture a blocker or ask execution-method permission. If all eight cannot safely share a batch, identify the precise dependency that separates them and the ordered remaining units, not a generic future-work list.

- [x] **Step 5: Self-check, commit only the contract and report.** Check that every one of the103 existing units is either covered by the next contract or has a specific retained dependency/admission condition, with no dropped unsafe effect. Verify referenced files/hashes/callers and current counts remain unchanged; `git diff --check` passes. Commit the one document and write task-5-report.md with design decisions, provenance/reference checks, concrete next actions and limitations. No local SQL or production claim follows from a documentation commit. Root independently reviews, then derives and executes the next concrete implementation tasks continuously.


### Task 6: Obtain the actual CLI skeleton for the reviewed legacy batch

**Prerequisite:** Task5 independent design approval; do not dispatch until review closes.

**Files:**
- Modify only `.github/workflows/ops-hardening.yml`.
- Consume `quality/audits/AUTH_PROVISIONING_LEGACY_ADMISSION_CONTRACT_2026-09-10.md`.
- Report `.superpowers/sdd/AUTH_PROVISIONING_SOURCE_RESTORATION_PLAN_2026-09-10/task-6-report.md`.

**Interfaces:** No database/service/production connection. Preserve all existing jobs and fixed16 commands exactly. This temporary job produces only an actual CLI-created empty file; no selector, immutable SQL or manifest changes. Subsequent implementation removes the preparation job before publishing Q. Root retrieves and verifies the exact artifact before assigning Q's filename.

- [x] **Step 1: Add this independent preparation job before verify.** No needs dependency, so naming does not wait for the eight-minute existing SQL group. Use the already verified pinned CLI/artifact protocol:

```yaml
  auth-provisioning-legacy-skeleton:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
        with:
          version: 2.101.0
      - name: Create legacy provisioning migration skeleton
        run: |
          supabase --version
          supabase migration new --help
          supabase migration new canonical_auth_provisioning_legacy_boundary
      - uses: actions/upload-artifact@v4
        with:
          name: auth-provisioning-legacy-migration-skeleton
          path: supabase/migrations/*_canonical_auth_provisioning_legacy_boundary.sql
          if-no-files-found: error
```

- [x] **Step 2: Verify only the new workflow boundary.** Check exact inserted block, original jobs unchanged, fixed16 group selftest and git diff --check. Do not run unrelated suites, install the absent CLI locally, or invent a timestamp. Commit only the workflow and write the report. Independent review follows.
- [x] **Step 3: Root publishes the reviewed design/preparation/status batch and retrieves proof.** Record exact head/tree/run/job/artifact, ZIP SHA256 and sole empty member's actual filename/hash. Verify original16 and other relevant hosted receipts separately; skeleton success is not SQL acceptance. Give the resulting exact basename/bytes to the next implementation task and continue.


### Task 7: Implement the unselected whole-source envelope and hosted proof

**Prerequisite VERIFIED:** Task6 published e37bc25b8de9eec93036ac8138b5b6efb778234a (tree09a371e01a42972a5c80d9ecfa3d7d79c2e119b6), OPS34486254854/job102901182147 PASS CLI2.101.0. Artifact10155731061 ZIP240 bytes/SHA25698f7eb64e7cb29a1c420f9380ac5ddc6819336e96214eac7ff2695822f6aa9a5, sole empty `20260910140053_canonical_auth_provisioning_legacy_boundary.sql`, SHA256e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855. Exact ZIP/member retained in this plan’s ignored SDD workspace; copy the member into migrations and fill that file. Original16 on this head is still running; previous194fd0cf full16 receipt remains authoritative until complete. Task5 contract66c56c70/9a6eb324 is independently APPROVED with no open findings.

**Files and ownership:**
- Fill the actual CLI-created `supabase/migrations/20260910140053_canonical_auth_provisioning_legacy_boundary.sql` (Q); no invented timestamp.
- Create `scripts/canonical-auth-provisioning-legacy-batch.py`, `scripts/canonical-auth-provisioning-legacy-selftest.py`, and narrowly named source-controlled admission/assertion support in `scripts/sql/` where justified by the contract.
- Modify the current history manifest to register Q and only the existing dynamic accounting checks directly coupled to the added source.
- Modify `.github/workflows/ops-hardening.yml`: remove Task6's temporary job, add the reviewed isolated legacy proof job with private owned-container logging and20min budget. Keep fixed16 commands and their job unchanged. After initial prerequisite16 is verified, independent diagnostic jobs may run concurrently; BOTH current-head successes remain mandatory for acceptance/selection. Removing an unnecessary scheduling dependency does not waive any gate.
- Contract corrections only if implementation exposes a concrete source-backed mismatch; report it before broadening source scope. Root owns plan/status/memory and dynamic memory markers.
- Report `.superpowers/sdd/AUTH_PROVISIONING_SOURCE_RESTORATION_PLAN_2026-09-10/task-7-report.md`.

**Interfaces:** Implement the approved legacy admission contract's complete transaction, rows/catalogs, forward winners,103-unit discharge and required SQL/infrastructure cases. Preserve first43 and foundation84, all existing source selectors, P38 metadata, original16 and immutable historical bytes. Do not select A–I in this task. Q registration is an input-accounting transition only; source-selection/executor integration follows reviewed hosted proof. Notify root of exact new count behavior when Q is registered so memory markers remain consistent; do not infer counts from SQL success.

- [x] **Step 1: Implement the exact envelope and Q.** One same-connection psql --single-transaction envelope runs admission, all eight complete sources in exact order, transaction-free context-bound Q and final assertions. Require isolated owned targets, lock before fresh admission, five empty business relations, exact arbitrary role preimages and only source-defined missing seeds. Implement the contract's precise CHECK/FK/index winners, preserved G/R security and no access/history/session/trigger side effects. No nested R transaction, standalone Q fallback, source fragments, trigger disabling or weakened guards.
- [x] **Step 2: Implement meaningful isolated cases.** All actual-first43, separate downstream helper, admitted/rejected/native/reduced-characterization, rollback/repeat/connection-death/contention and logging cases in the approved contract are required. Reuse prior executed characterization where explicitly allowed; do not repeat the entire effects audit. Emit only allowlisted SQLSTATE/stage/static categories and safe numeric/hash receipts. The owned PostgreSQL container must isolate server logs, use0700 directory/0600 files, suppress raw teardown output and reliably remove only its own resources.
- [x] **Step 3: Integrate an unselected standalone hosted lane.** Remove the temporary CLI job. Preserve existing16 and run the new proof in a dedicated owned-container job with bounded timeout; no production credentials or service operations. Constructor/selection-only mode validates byte/order/context and negative controls locally; it does not claim SQL acceptance. No absent local DB/CLI installation retry.
- [x] **Step 4: Run bounded static checks, selfreview and commit.** Run relevant constructor/negative controls, existing fixed-group selftest, accounting/integrity/provenance checks and syntax/diff checks for changed files. Report exact files/counts/hashes, justified limitations and hosted pending boundary. Commit owned files only; root independently reviews before publication.
- [x] **Step 5: Root publishes exact reviewed batch and obtains SQL receipts.** Require unchanged16 plus complete standalone legacy proof PASS at exact head/tree. Any failure gets scoped diagnosis/author fix/independent rereview. Only successful execution allows subsequent full-source selection and real clean-replay grouping. Generated types/full replay and production remain gated.


### Task 8: Select the eight sources and integrate real transactional replay

**Prerequisite VERIFIED:** Task7 independent review and complete exact-head standalone PostgreSQL proof102953458693 PASS at4130cdd9/tree615de55c, with unchanged original16/auth102953458828 PASS. Derive the exact implementation file list from Task7 before generating this brief; do not dispatch from predicted source accounting.

**Files/interfaces:** Existing foundation order/additional selectors, P38 derived metadata, shared batch source/hash declaration from Task7, `scripts/gridex-aud-003-clean-replay.sh` and its scoped selftest, fixed-group runner/selftest, accounting/provenance/selection checks directly coupled to insertion. Preserve first43 and every former44–84 suffix entry in order. Root owns status/plan/evidence.

**Actual Task7 implementation interfaces now verified:** `scripts/canonical-auth-provisioning-legacy-batch.py`, `scripts/canonical-auth-provisioning-legacy-selftest.py`, `scripts/sql/canonical-auth-provisioning-legacy-admission.sql`, `scripts/sql/canonical-auth-provisioning-legacy-assertions.sql`, `scripts/sql/canonical-auth-provisioning-legacy-catalog.sql`, and Q `20260910140053_canonical_auth_provisioning_legacy_boundary.sql`. Complete standalone proof102953458693 at4130cdd9/tree615de55c PASS; same-head original16/auth102953458828 now also PASS, satisfying dispatch prerequisite. Existing selectors are `scripts/gridex-aud-003-legacy-foundation.additions.json` / `scripts/gridex-aud-003-foundation-order.json`; actual fixed runner is `scripts/canonical-auth-membership-group.py`. Directly coupled dynamic checks include group-selftest, diagnostics-selftest/diagnostics-selection-selftest, governance-selftest, operations-sync-selftest, invitation_token_prerequisite_selftest and accounting/provenance/clean-replay checks. Update only current insertion/count assertions; preserve historical prefixes and executed cases. The bootstrap at `scripts/sql/gridex-supabase-compatible-bootstrap.sql` already supplies auth.sessions; only journal in the optional test is synthetic. Do not recreate sessions or equate that compatible shape with provider/CLI Auth.


- [x] **Step 1: Integrate complete-source selection.** Insert A44/B45/C46/D47/E48/F49/H50/I51/Q52 after unchanged first43; preserve old suffix, foundation93. Set only P38 preserveSourceReplay metadata needed to close F substitution while retaining P38 at38. Pin exact historical and executed Q hashes; no SQL changes or blanket exclusions. Verify exact observed global/focused counts against the contract’s predicted595/533/23/35/4 and341/290/20/27/4; do not silently accept extra deltas.
**Concrete transport/staging integration obligations found in the existing implementation:** `gridex-aud-003-clean-replay.sh` moves migration originals into HOLD before CLI startup, supports a local CLI-owned Supabase target and an external compatible-bootstrap diagnostic target, and currently invokes URL-based per-file psql. Task7’s executor instead accepts only its own network-disabled container/fixed database names and reads original ROOT paths. Before selection, implement a narrow trusted staging/target adapter that keeps execution in the actual replay database and resolves complete pinned source identities to the retained bytes. Never substitute a separate fixture database for the real target, silently weaken target ownership, accept generic URLs as ownership proof, or drop the external mode’s explicit NO ledger provenance boundary. Preserve worktree restoration and distinguish actual stack ownership from start-attempt tracking. The reference bootstrap/catalog must match the actual supported mode: compatible-bootstrap Auth/storage catalogs cannot simply be asserted equivalent to the real CLI-created Supabase catalog. Resolve and document these source-backed interfaces, prove the actual first43→group loop in supported modes with appropriate owned synthetic targets, and report any unsupported mode honestly. Do not claim full replay from a fixture-only adapter; no artifact/type refresh until full completeness. This is concrete integration scope, not a new source-effects audit.

**Supported-mode decision during implementation:** Existing native CLI startup lacks independently trusted native genesis/reference, exact ownership and private server-log proof; generic external URLs likewise do not prove ownership/log protection. Task8 may add an explicit owned-compatible diagnostic mode using the actual clean-shell staged foundation loop and actual owned replay database, with NO ledger provenance. Unsupported native CLI/generic external modes must fail before stack start/stop, staging mutation or SQL bootstrap/apply; never weaken admission to retain an unsafe path. This bounded integration does not close native CLI support or full clean replay. A later concrete gate must establish owned native Supabase genesis/reference, private logging and official CLI-ledger proof before native full-replay/production readiness can be claimed.


- [x] **Step 2: Make the real clean-replay executor use the proven batch.** Delegate exactly44–52 to Task7’s same-connection admission/originals/Q/assertions executor, complete files once, no per-file autocommit fallback or duplicate timestamp execution. Preserve all other source ordering, isolated-target safeguards, provenance and native rollback behavior. Test actual loop integration, missing/reordered/mismatched files, Q outside envelope and stage/context rejection.
- [x] **Step 3: Integrate command17 while preserving prior16.** Append the new legacy selftest without modifying original16 tuples/order. Preserve owned-container log protection and cleanup. Use the contract’s bounded runtime budgets and explicit hosted union or combined-group receipt; never label16 as17. Remove any duplicate standalone invocation only when the fixed integration actually executes its entire proof once.
- [x] **Step 4: Scoped static verification, independent review and publication.** Constructor and exact-group negative controls, accounting/integrity/provenance and executor wiring checks, syntax/diff checks. Commit only implementation-owned files and keep SDD reports ignored. Root obtains independent review before exact-tree publication.
- [ ] **Step 5: Exact-head hosted acceptance.** Require all17 with every prior lane and actual first43→whole batch→Q assertion, source execution counts and logging/rollback/contention PASS, plus relevant quality/build/Ediel gates. Generated schema/types are still blocked on complete replay/source restoration; continue the remaining masterplan without claiming final readiness.
