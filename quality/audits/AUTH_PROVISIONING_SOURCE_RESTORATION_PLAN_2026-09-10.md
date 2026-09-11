# Auth Provisioning Source Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the complete effects and safe next restoration contract for the remaining invitation and direct-account sources without reviving historical unsafe credential or tenant behavior.

**Architecture:** Reuse the verified selected foundation and existing five-source characterization. Map every complete-source unit to its actual prerequisite, data/security effect and later winner before proposing the smallest executable restoration batch. This evidence task ends in a concrete reviewed contract; source selection and production delivery are separate execution gates.

**Tech Stack:** PostgreSQL17, Supabase-compatible isolated fixtures, Python, immutable SQL migrations, JSON source/provenance manifests, GitHub Actions.

## Global Constraints

- Task7 VERIFIED at4130cdd9b4ebe2dc018ec596d5c4e839cc6e5bb5, tree615de55cba5b80454dc16090f9a935b2393fdd86; OPS34501598746 original16/auth102953458828 PASS and COMPLETE standalone legacy102953458693 PASS (132502ms). Quality/build102953458698, Ediel102953458823, tenant102953458862, browser102953459131 and coverage102953459546 PASS. All five hosted defects corrected with independent reviews; current counts/selection unchanged. Task8 may now integrate the proven complete-source group; full replay/types/production remain open.
- Task8 VERIFIED selection:595 inputs/533 FULL_FILE_SELECTED/23 SUBSTITUTED/35 UNCLASSIFIED/4 EXPLICITLY_EXCLUDED;58 unresolved. Focused341:290/20/27/4;47 unresolved. Foundation93, unchanged first43, ABCDEFHIQ44–52 and old suffix53–93. Prior published Task7 is595/525/24/42/4 and foundation84; integration337caaa4 independently APPROVED; first hosted actual-loop attempt rejected stage permissions, correction6d2809a5 independently APPROVED and both Minor findings closed. Hosted all17/actual-loop proof PASS at5389f2b5: OPS34506822456 original16/job102970940188 and legacy17/job102970940105, quality/build102970939833 and Ediel102970940048 PASS. Earlier task-stage counts below remain historical interfaces.
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
- [x] **Step 5: Exact-head hosted acceptance.** Require all17 with every prior lane and actual first43→whole batch→Q assertion, source execution counts and logging/rollback/contention PASS, plus relevant quality/build/Ediel gates. Generated schema/types are still blocked on complete replay/source restoration; continue the remaining masterplan without claiming final readiness.


### Task 9: Map the remaining historical user and RBAC repair family

**Prerequisite VERIFIED:** Task8 all17 and actual staged loop at5389f2b5, treeb8387fa0fef66019c6d27957f281138e45920390. No repeat of Tasks1–8 source matrices or PostgreSQL proofs.

**Files owned:** Create `quality/audits/USER_RBAC_REPAIR_SOURCE_EFFECTS_2026-09-10.md` and `quality/audits/USER_RBAC_REPAIR_ADMISSION_CONTRACT_2026-09-10.md`. Report `.superpowers/sdd/AUTH_PROVISIONING_SOURCE_RESTORATION_PLAN_2026-09-10/task-9-report.md`. No implementation, selector, SQL, manifest, workflow or root-memory edits.

**Exact complete-source scope under supabase/migrations:**
- `20260519_bootstrap_div3rsa_superadmin.sql`
- `20260525_debug_batch_2_rbac_tenant_alignment.sql`
- `20260525_debug_batch_2c_activate_afshin_nibela.sql`
- `20260525_debug_batch_2d_activate_afshin_nibela_v2.sql`
- `20260525_debug_batch_2e_verify_dashboard_user_provisioning.sql`
- `20260525_debug_batch_2f_normalize_afshin_nibela.sql`
- `20260525_debug_batch_2h_dedupe_user_roles_and_unique_guard.sql`
- `20260526_debug_batch_2_tenant_rbac_server_actions.sql`

**Interfaces:** Consume actual source bytes, history manifest/accounting, foundation93 and relevant existing RBAC/governance/provisioning contracts and canonical callers. Produce exhaustive line-ranged statement-unit effects and one executable safe next restoration contract for this family, with exact dependencies and justified coherent batches. Names are scope identifiers, never authorization to inspect matching real users. Current595=533/23/35/4 and focused341=290/20/27/4 remain unchanged.

- [x] **Step 1: Pin and classify every source effect.** Privately read full files, record SHA256/line count/complete statement units and actual manifest state. Map every DDL, DML, dynamic SQL, trigger, privilege and read/diagnostic effect, including conditional branches. Never reproduce identity, credential or secret literals; use path/line and abstract effects. Reuse existing matrices only where exact complete units already covered. Resolve actual prerequisites and later winners by implicated object, without restarting repository inventory.
- [x] **Step 2: Derive safe complete-file execution conditions.** Specify exact isolated empty/seeded admission, row identities and pre/post multisets, catalog winners, role/tenant/actor ownership, session and durable-work effects. Identify hardcoded-target behavior, duplicate/NULL/orphan/multi-company/multi-role and historical privilege elevation. Unsafe effects are rollback-only characterization. Decide whether zero eligible targets suffices, or same-transaction exact preimage/forward repair is required; source-backed dependencies must justify splitting batches. Preserve immutable bytes and never turn exclusions or fragments into completion.
- [x] **Step 3: Define exact next implementation and proof contract.** Name required files/interfaces, actual insertion relative to verified first52 and later suffix, any forward migration requiring an actual CLI skeleton, exact accounting deltas, independent reference construction, safe private SQL/log execution and negative controls. Specify whole-file successful/admitted/rejected/repeat/rollback/native failure/concurrency cases only where the mapped effects warrant them. Keep native CLI/genesis/official-ledger full replay and production convergence distinct from compatible fixture proof. ADR-006 prohibits mass replay/mass marking historical migrations live. Any unresolved dependency must name its exact effect and the concrete step that resolves it.
- [x] **Step 4: Self-review and commit the two documents.** Verify complete unit coverage, hashes, cited caller/winner paths and absence of leaked literals. Run git diff --check; no synthetic documentation-mirroring tests or SQL acceptance claims. Commit only owned documents and write full report with files, checks, decisions, unresolved dependencies and implementable next tasks. Root obtains independent spec and quality review and continues implementation.


### Task 10: Obtain the actual CLI-created user/RBAC boundary skeleton

**Prerequisite VERIFIED:** Task9 commit4deefce5 independently spec+quality APPROVED, no blocking findings. Minor T9-R1 (selected39 read/write-company helper traceability) is retained for the implicated implementation and final review. This is naming preparation only, not SQL acceptance.

**Files:** Modify only `.github/workflows/ops-hardening.yml`. Report `.superpowers/sdd/AUTH_PROVISIONING_SOURCE_RESTORATION_PLAN_2026-09-10/task-10-report.md`. Read the approved `quality/audits/USER_RBAC_REPAIR_ADMISSION_CONTRACT_2026-09-10.md` for W's identity; do not implement W or change source/accounting in this task.

**Interfaces:** Current fixed runner has original16 and legacy17 partitions, disjoint union all17. Preserve all current jobs and commands verbatim. Add one independent temporary job before verify, with no database, credentials, container/service operation or needs dependency. Root retrieves actual filename/empty bytes after reviewed publication; subsequent implementation removes this job and fills only that actual member.

- [x] **Step 1: Insert this complete job before verify.**

```yaml
  user-rbac-repair-skeleton:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
        with:
          version: 2.101.0
      - name: Create user RBAC repair migration skeleton
        run: |
          supabase --version
          supabase migration new --help
          supabase migration new canonical_user_rbac_repair_boundary
      - uses: actions/upload-artifact@v4
        with:
          name: user-rbac-repair-migration-skeleton
          path: supabase/migrations/*_canonical_user_rbac_repair_boundary.sql
          if-no-files-found: error

```

- [x] **Step 2: Verify the inserted block and preserve existing workflow.** Compare changed workflow against git HEAD with exactly the above block removed: all original bytes must match. Run `python3 scripts/canonical-auth-membership-group.py --dry-run` and `git diff --check`; verify only this workflow is staged. Do not rerun SQL suites or install the absent CLI locally. Commit only the workflow; report exact commit, checks and limitations.
- [x] **Step 3: Root independently reviews, publishes and retrieves proof.** Publish the exact reviewed design/preparation/status tree. Retrieve successful job's actual artifact ZIP and sole empty member; verify filename, ZIP/member SHA256, exact emptiness and pinned CLI version. Preserve full17 and other current-head receipts separately; no schema/type/ledger or production claim follows from skeleton creation. Pass the actual member identity to the subsequent complete R2/E2/S2/W implementation and continue.


### Task 11: Implement unselected R2/E2/S2/W and its complete hosted proof

**Dispatch prerequisite:** Task9 independent approval and Task10 scoped constructor-fix approval; Task10 actual artifact already VERIFIED at published935eb5a0/treef76e8689, OPS34510573935/job102983387043 CLI2.101.0 PASS. Artifact10165602317 ZIP224/SHA2563af4016441baf2e0eb4c1dcaa3085bdfdbfba95ab38e4e973aeeef675a0f7d30; sole empty `20260910174947_canonical_user_rbac_repair_boundary.sql`, emptySHAe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855. Exact ZIP/member retained in this plan's ignored workspace. Do not invent a new timestamp or repeat preparation. Last all17 SQL baseline5389f2b5; current935eb5a0 legacy constructor fails before SQL on sibling job parsing, corrected separately before this dispatch.

**Files owned:**
- Fill only the actual CLI member copied to `supabase/migrations/20260910174947_canonical_user_rbac_repair_boundary.sql` (W).
- Create `scripts/canonical-user-rbac-repair-batch.py`, `scripts/canonical-user-rbac-repair-selftest.py`, `scripts/sql/canonical-user-rbac-repair-admission.sql`, `scripts/sql/canonical-user-rbac-repair-assertions.sql`, `scripts/sql/canonical-user-rbac-repair-catalog.sql`.
- Modify `.github/workflows/ops-hardening.yml`: remove the temporary user-rbac-repair-skeleton job; add independent owned/private PG17 proof for the new selftest, bounded20min, no needs dependency or raw service logs. Preserve original16 and legacy17 jobs/commands and all existing safety checks.
- Register W in the current history-additions manifest; modify only directly coupled dynamic accounting/selection regressions and focused-family classification needed for this one new timestamp input. No R2/E2/S2 selection in this task.
- Resolve T9-R1 in the two Task9 documents while implementing the actual first52 dependency contract: S2 binds `gridex_can_read_company(uuid)` and `gridex_can_write_company(uuid)` from selected39 `20260520_batch_6e_rbac_tenant_stats_whitelabel.sql:155–170,190–208`; write also depends on `gridex_company_is_writable(uuid)`. R2 supplies the platform helper, not those company helpers. Preserve exact definitions/options/ACLs, without re-running old39/41 source effects.
- Existing owned PostgreSQL class and legacy executor may be reused unchanged. If the actual API cannot safely support the new proof/reference/target without a change, report the exact interface mismatch before expanding those files; no duck-typed ownership, arbitrary URL or weakened source guard.
- Report `.superpowers/sdd/AUTH_PROVISIONING_SOURCE_RESTORATION_PLAN_2026-09-10/task-11-report.md`. Root owns plan/memory/evidence.

**Binding implementation contract:** Read all of `quality/audits/USER_RBAC_REPAIR_ADMISSION_CONTRACT_2026-09-10.md` and companion source-effects document. This task implements only their complete three-source batch and proof matrix; H2 and fixed-target/lifecycle tasks remain separate. Use exact source R2/E2/S2 pins from the approved document. Current595=533/23/35/4 and focused341=290/20/27/4/foundation93/all17. W registration alone predicts596=534/23/35/4 and focused342=291/20/27/4, still58 total/47 focused unresolved; independently inspect actual deltas and notify root before changing status. Future selection53–56/foundation97/all18 is a subsequent task after actual SQL acceptance.

- [x] **Step 1: Implement the exact context-bound full-source transaction and W.** Actual compatible bootstrap + complete first52, never a reduced replacement. Same mutex before catalog/target reads and deterministic locks; fresh READ COMMITTED admission. Empty user_roles/invitations, exact permitted role preimages/seed subset and source dependency/trigger validation. Run admission, whole R2/E2/S2, W and assertions in one psql transaction, with private exact stage/context and no standalone W. Restore old role/helper/policy/RLS preimages, preserve selected39/41, revoke new diagnostic effective direct/inherited/column privileges, keep only reviewed structural deltas. Follow every row/catalog/actor/session/durable-work obligation from the approved contract.
- [x] **Step 2: Implement independent actual-prefix and negative SQL cases.** Implement every three-source proof-matrix lane in the contract: independent expected reference, seeded/repeat/canaries, rejected data/catalog, whole-source reduced native characterization, stage/W/context/backend rollback, observed actual concurrency/55P03/fresh admission, effective security, private logs/cleanup. Build source-backed expected objects independently of W; exact complete rows/catalog, not counts alone. First52 baseline must reuse full accepted legacy envelope; no isolated fixture masquerading as actual prefix. Local constructors must prove complete source/order/hash/ownership/context and rejection controls without claiming SQL execution.
- [x] **Step 3: Integrate standalone owned hosted proof without source selection.** Remove temporary skeleton job, run the new complete selftest once in its dedicated owned/private PG17 lane. Original17 retained unchanged and required separately at exact published head. Capture expected failures privately and expose only allowlisted safe stage/SQLSTATE/numeric/hash receipts. Actual staged-loop53–56 belongs to subsequent selection task; do not claim it from standalone execution.
- [x] **Step 4: Bounded static verification, self-review and commit.** Run new constructors/negative controls, fixed-group preservation checks, changed dynamic accounting/integrity/provenance checks and syntax/diff checks. No absent local PG/CLI install/socket retry, no unrelated suites or old whole-source audit. Commit only owned files, report exact scope/pins/counts/checks and real hosted-pending limitations. Document any source-backed interface mismatch before broadening scope.
- [x] **Step 5: Root independently reviews, publishes and obtains hosted acceptance.** Require original17 and complete new R2/E2/S2/W proof at same exact head/tree, plus relevant quality/Ediel gates. Confirmed failures use scoped author correction/independent rereview. Only successful complete SQL proof permits next53–56 selection/actual-staging/all18 task. Continue all remaining sources/native full replay/types/final security/production; no artifact refresh or readiness claim from this bounded proof.


Task11 completion receipt:62d60d76915f183bc028b8d2efa0f4b6051f8ae3/tree8d7f6166fe86ff5b3fad8020865e75be42a2e370, OPS34538019180 original16/auth103074034403, legacy17/actual-loop103074034431 (144187ms), complete new103074034327 (166773ms), quality103074034377 and Ediel103074034395 all PASS. All four hosted corrections independently reviewed; T9-R1/T11-R1 closed. No source selection or production action.

### Task 12: Select the verified repair group and integrate actual staged replay

**Dispatch prerequisite:** Task11 Step5 complete on one published head, including original17, full new standalone SQL, quality and Ediel. Standalone new proof already PASS at62d60d76915f183bc028b8d2efa0f4b6051f8ae3, OPS34538019180/job103074034327 (166773ms); legacy17/actual-loop103074034431 PASS144187ms. Original16/auth103074034403, quality103074034377 and Ediel103074034395 also PASS on this head; Task11 is COMPLETE and dispatch is authorized. No new migration skeleton is needed.

**Files owned:**
- `scripts/gridex-aud-003-foundation-order.json`, `scripts/gridex-aud-003-legacy-foundation.additions.json`: select exactly the four complete sources below, no unrelated classification changes.
- `scripts/canonical-user-rbac-repair-batch.py`, `scripts/canonical-user-rbac-repair-selftest.py`: strict staged-source support, shared owned-loader identity, actual staged proof appended to existing complete standalone command; preserve all accepted SQL lanes and four hosted corrections.
- `scripts/canonical-auth-provisioning-replay.py`, `scripts/gridex-aud-003-clean-replay.sh`, `scripts/gridex-aud-003-clean-replay-selftest.py`: execute both groups exactly once on the same actual owned replay database, named scope transport and cleanup regressions.
- `scripts/canonical-auth-provisioning-legacy-selftest.py`: shared loader identity and directly affected foundation/accounting constructors only; preserve its actual historical52 proof and all accepted SQL lanes.
- `scripts/canonical-auth-membership-group.py`, `scripts/canonical-auth-membership-group-selftest.py`, `.github/workflows/ops-hardening.yml`: append command18 and exact disjoint partition coverage.
- Directly affected count/ordinal/provenance assertions in `scripts/canonical-auth-provisioning-diagnostics-selection-selftest.py`, `scripts/canonical-auth-provisioning-diagnostics-selftest.py`, `scripts/canonical-governance-selftest.py`, `scripts/canonical-operations-sync-selftest.py`, `scripts/canonical_full_governance_contract.py`, `scripts/invitation_token_prerequisite_selftest.py`, `scripts/gridex-aud-003-migration-provenance-regression.cjs`; preserve historical fixture cuts and expected SQL semantics.
- `docs/migration-provenance.md`: describe named bounded modes and full/native limitations accurately.
- Report `.superpowers/sdd/AUTH_PROVISIONING_SOURCE_RESTORATION_PLAN_2026-09-10/task-12-report.md`; root owns plan/memory/evidence. No immutable SQL, W, source hashes/history manifests, prior legacy executor or production mutation in this task. Report an evidenced interface need before expanding ownership.

**Exact selection and accounting:** Preserve first52 byte-for-byte and original historical30/31/32/33, RBAC38, G42/R43 and A44 through Q52. Insert:
- R2 at53: `20260525_debug_batch_2_rbac_tenant_alignment.sql`, SHA256cba0a78a519d84b44585133046c56117bf05674c1834467eb8b78fbc1d79cb7d,230 lines.
- E2 at54: `20260525_debug_batch_2e_verify_dashboard_user_provisioning.sql`, SHA256b1cd650eeb7e923b7fb7c761064e9269fff309d34fe3383d07764149d3abc19f,85 lines.
- S2 at55: `20260526_debug_batch_2_tenant_rbac_server_actions.sql`, SHA256f99af4186539ade7455e7241275339352a23c8572bda7cfd05aba987bac8c727,141 lines.
- W at56: `20260910174947_canonical_user_rbac_repair_boundary.sql`, SHA25651849cf92903f175c548f2a8e853282e01217a55505a9b096b7635d55ee5bbe1,58 lines.
Move unchanged old53–93 suffix to57–97. Foundation becomes97. W was already timestamp-selected; each of all four must execute exactly once, never duplicated in timestamp execution. Expected596 inputs =537 FULL_FILE_SELECTED/23 SUBSTITUTED/32 UNCLASSIFIED/4 EXPLICITLY_EXCLUDED,55 unresolved. Focused342 =294/20/24/4,44 unresolved. Inspect actual accounting before updating assertions; no blanket exclusions or excerpts.

**Binding interfaces and resolved choices:**
- Keep `--foundation-prefix-proof` as the historical52 diagnostic scope. Add exactly `--repair-prefix-proof` as the new56 scope to both parent and shell; reject both flags together, unknown flags and arbitrary cutoffs. Full mode remains no prefix flag, preserves completeness admission before owned startup/staging, and executes97 before unchanged history continuation. Both diagnostic scopes exit before artifact/type/ledger output.
- Existing exact loaders currently use three keys: legacy selftest `legacy_batch`, replay `canonical_owned_replay_batch`, repair `repair_owned_legacy_batch`. Unify these trusted consumers under `canonical_owned_replay_batch`, reusing the exact loaded source module/class. Retain exact type, active target, created owner, directory and reference checks; never accept duck-typed handles, external URLs or arbitrary registered modules as proof of ownership. Verify source module origin when reusing its key.
- Existing new `REFERENCES[target]` stores independent repair `Reference(directory,base,final)`; legacy `target.reference` remains the separate first43/final52 pair. Prepare required references before HOLD mutation. Historical52 uses the legacy expected catalog; repair56 uses the separate repair expected catalog. Never overwrite one to make an unrelated comparison pass.
- Extend new source-dependent validation/envelope/execution with optional strict `legacy.StagedSources` resolution, including all originals/W and every source/oracle dependency read after HOLD mutation. No ROOT original fallback in staged mode. Validate the whole97 order, physical identities, symlinks, pinned bytes and both batches' dependencies before first actual target SQL, including in named prefix proofs. Preserve standalone callers using unstaged reviewed paths.
- Actual `FoundationLoop` keeps first43 per-file application, complete legacy44–52 once, then complete repair53–56 once in the SAME `gridex_auth_legacy_replay` owned database for repair/full scope. Historical52 deliberately stops after legacy. Full mode then applies unchanged57–97 suffix. Keep same-connection repair envelope, mutex/locks/preimage/assertions, private socket600/HOLD700 and exact original restoration; no reference database substituted as execution target.
- Preserve the exact original17 command tuple prefix; append `('python3', 'scripts/canonical-user-rbac-repair-selftest.py')` as18. Default partition becomes `all18`; retain explicit `all17` historical prefix and `original16`/`legacy17`, add `repair18`. The three disjoint hosted partitions original16/legacy17/repair18 must cover every all18 command exactly once. Existing jobs remain partitioned; dedicated repair job runs repair18 once, including its full standalone proof plus actual staged loop. Fail-on-first-command-error and sanitized environment behavior remain.

- [x] **Step 1: Write failing integration constructors.** Establish exact97 order, original17 tuple prefix/new18 and disjoint partition union, accounting and unique execution ordinals. Verify historical52/new56/full scope transport and mutual exclusion. Exercise real trusted loader reuse and rejection of wrong-origin/unowned identities. Use retained-only readers to fail any ROOT original access after staging. Wrong source/order/hash/missing/symlink/duplicate and reference/scope mismatch must fail before actual target SQL. Do not claim mocked constructors are SQL proof.
- [x] **Step 2: Implement exact selection and owned staged interfaces.** Apply the selection/accounting and explicit interface decisions above. Preserve all existing legacy/new source boundaries and proof semantics. Complete reference construction before originals move; stage validation and actual execution operate on retained bytes. No implicit scope widening, arbitrary prefix or fake ledger/native support.
- [x] **Step 3: Exercise the real shell and both batches.** Append actual hosted repair56 proof to command18 using the parent-owned target and real clean-replay shell/HOLD/planner/transport. Prove bootstrap→first43→whole44–52→whole53–56 once in one actual replay DB, independent final rows/catalog and no source duplication. Prove standalone W rejection and trusted post-W injected failure rolls back the entire repair group to the accepted52 state with exact rows/catalog/sequence; earlier accepted52 remains intact. Confirm original restoration after success/failure, private client/server logs, exact owned cleanup and unrelated canary preservation. Preserve command17's actual historical52 proof unchanged in meaning. Full replay must still fail closed on55 unresolved before startup/staging/artifacts.
- [x] **Step 4: Bounded verification, review and commit.** Run changed selection-only/runner/cleanup/accounting/provenance/integrity and syntax/diff checks; preserve first52, all source hashes, old suffix and existing complete lanes. Check root memory markers only with current root-owned status; do not edit memory to satisfy old counters. No repeated local PG/CLI/socket probes, no unchanged whole SQL suites locally. Commit owned files, report exact interfaces/counts/test results and hosted-pending limitations. Independent spec/quality review follows; confirmed fixes get scoped rereview.
- [x] **Step 5: Root publishes and verifies all18 plus actual staging.** Require exact-head original16, legacy17 historical52, complete repair18 standalone+actual56 and quality/Ediel PASS. Inspect safe complete receipts; partial SQL or green constructors cannot close this step. Record55 unresolved and bounded selection acceptance. Continue H2/fixed-target lifecycle and all remaining source restoration/native full replay/types/security/live parity/production gates under the reviewed Task9 contract; do not mass-replay historical SQL live or refresh artifacts from incomplete replay.

Task12 implementation775af96c and packaging-only29196b20 independently spec/quality APPROVED. Minor T12-R1 stale hosted step label is deferred to the next required workflow edit; no blocker. All bounded checks PASS; actual all18/legacy52/repair56/quality/Ediel on one published head remains OPEN.


Task12 completion:6681ca3d79da9edfada5c01925edb2a54461e658/tree7e0bca400037f4214f96a8bc8a2a2c611eb3f814, OPS34540658066 original16/auth103082327371, legacy17/actual52 job103082327393151856ms, repair18/actual56 job103082327314169659ms, quality103082327385 and Ediel103082327231 all PASS. Full all18 union and actual staged56 acceptance verified;55 unresolved.

### Task 13: Prove complete H2 effects in an unpublished owned database

**Dispatch prerequisite SATISFIED:** Task12 complete at6681ca3d79da9edfada5c01925edb2a54461e658, OPS34540658066 original16/auth103082327371, legacy17/actual52 job103082327393151856ms, repair18/actual56 job103082327314169659ms, quality103082327385 and Ediel103082327231 all PASS. H2 is independent of B0/C2/D2/F2; reuse the approved Task9 admission contract121–131 and lifecycle boundaries133–142. Do not restart their source-effects audit or select H2 in this task.

**Files owned:**
- Create `scripts/canonical-user-rbac-dedupe-selftest.py` and, only if needed to keep coherent SQL support separate, `scripts/sql/canonical-user-rbac-dedupe-admission.sql` and `scripts/sql/canonical-user-rbac-dedupe-assertions.sql`.
- Modify `.github/workflows/ops-hardening.yml` only to add independent `user-rbac-dedupe-proof`, timeout20min, private owned PG17, and close Minor T12-R1 by renaming the existing repair step to `Verify command18 standalone and actual staged repair56 on private owned PostgreSQL 17`. Preserve that step's command and all existing jobs/gates.
- Read/reuse accepted replay/repair/legacy helpers unchanged. Report any actual API deficiency before expanding ownership; no generic URL/duck-typed target/reference replacement.
- Full report `.superpowers/sdd/AUTH_PROVISIONING_SOURCE_RESTORATION_PLAN_2026-09-10/task-13-report.md` stays ignored/local and MUST NOT be staged or committed. Root owns plan/memory/evidence. Commit only owned production/test/workflow files.

**CLI/workflow interface:** New selftest default runs the complete owned proof;
`--selection-only` runs constructors without SQL; `--cleanup-owned` delegates to
the existing exact owner/name/label cleanup. Reject unknown/combined modes. The
new independent workflow job sets GRIDEX_LEGACY_CONTAINER_NAME to
`gridex-auth-legacy-dedupe-${{ github.run_id }}-${{ github.run_attempt }}`, runs
`python3 scripts/canonical-user-rbac-dedupe-selftest.py`, and an `if: always()` step
runs the same script with `--cleanup-owned`. No services, needs dependency,
artifact upload, raw docker logs, CLI installation or fixed-group command19 yet.

**Exact source and invariants:** H2 is complete `supabase/migrations/20260525_debug_batch_2h_dedupe_user_roles_and_unique_guard.sql`,96 lines/SHA25698522e209332c44c804d7acccf831f25fb13b75b048fbe3613c8d69fcb373a9b. Pin the original manifest record and bytes before all use. H2.1 BEGIN, H2.2 text-key deletion, H2.3 role-id deletion on those survivors, H2.4/H2.5 two expression indexes, H2.6 COMMIT, H2.7 fixed-target diagnostic must execute unchanged. No source editing, selection, boundary migration, timestamp generation, source-hash/history change or input-count delta. Expected baseline after Task12 remains596=537/23/32/4,focused342=294/20/24/4,foundation97/all18,55/44 unresolved.

**Owned prefix/reference interface:** Use accepted `canonical-auth-provisioning-replay.py` trusted `load_batch()`/`load_repair()` and `serve_child(legacy,h,command,'repair56')` or the exact same accepted full bootstrap/first43/legacy44–52/repair53–56 construction. Prefer the real named shell scope to establish actual56 once, then private clones for cases. Prepare legacy and separate repair reference before staging; preserve module/OwnedPostgres/reference identities. Reuse exact owned database names/lifecycle without widening external targets. No reference database may substitute for actual whole-source execution. Build the expected H2 catalog delta independently from the two pinned original index declarations in a separate owned reference; compare complete portable catalogs, not only names/counts. Full row snapshots include explicit sequence last_value/log_cnt/is_called; sequences are not composite rows.

**Admission versus characterization:** The prospective clean lane requires empty user_roles (all rows, including inactive/NULL/unrelated users), correct actual56 relation/constraint/index/trigger shapes, and no wrong same-name index before H2. No data may be deleted/moved to satisfy admission. Other synthetic Auth/company/profile/membership/role/session/audit canaries remain exact full rows. Profile canaries must be explicitly inserted through actual existing columns; no assumed profile is_active or implicit Auth INSERT trigger. The fixed diagnostic identity need not be created for clean H2; do not read any real account or expose its source constants. All admitted targets are newly owned, unpublished, provider-free and isolated. No canonical source selection or reusable published-handle gate is claimed from this proof alone.

- [x] **Step 1: Pin complete source and write failing constructors.** Reject missing/reordered/substituted/wrong-hash/symlink source, unowned/external/stale target, and any source truncation or suppression of internal COMMIT. Verify separate actual56/reference construction, private safe receipts and independent expected index declarations. Constructors must distinguish actual database proof from mocked dispatch. Add an independent hosted workflow without changing fixed all18 coverage.
- [x] **Step 2: Prove actual56 empty, canaries and repeat.** Execute complete H2 with its native transaction control, successfully and unchanged, on actual accepted56. Assert user_roles stays empty; exact valid/ready unique expression indexes and predicate/opclass/NULL semantics; all unrelated full rows/catalog/sequence state preserved. Repeat whole H2 with exact preservation. Dirty same-name index/wrong-kind/shape/trigger and populated-role inputs reject before clean-lane submission; also characterize native IF NOT EXISTS behavior privately where relevant. Never drop a canonical guard to make an admitted actual-prefix fixture pass.
- [x] **Step 3: Characterize both sequential destructive passes.** In separate disposable cases, compute expected survivors independently in text pass then role-id pass: different IDs/text/role_id, case versus whitespace, equal timestamps with UUID tie-break, NULL timestamp ordering, NULL/inactive status/is_active, NULL role text/id/user/company, sentinel-company collision, two real companies, two legitimate roles, orphan shapes and dependent cascade/restrict/trigger history. Compare complete original PK rows and every dependent effect, not counts. Test unique-index NULL user semantics separately from window partitions. If actual56 constraints reject a historical dirty shape, record that native constraint result and use an explicitly named reduced fixture only for the otherwise unreachable characterization. Reduced fixtures never become clean-admitted targets. No fixed identity/password/provider fixture or real-user read is needed.
- [x] **Step 4: Prove commit/failure/concurrency/privacy boundaries.** Use original H2 COMMIT, not an outer transaction pretending to span it. Evidence actual pre-COMMIT failure rollback and actual post-COMMIT failure with committed deletion/index state retained privately, then destroy only the exact owned database. Use source-backed native failures or trusted external test hooks, not edited historical SQL. Separate-session writer/index contention must observe real blocking/55P03 or native uniqueness failure; unverified/partial databases never become externally published handles. Demonstrate exact owned cleanup on failure/process death and unrelated canary survival. Preserve private client/server/DETAIL/HINT/statement/parameter streams and allowlisted stage/SQLSTATE/numeric receipts. Characterized committed deletes are never authorized live cleanup.
- [x] **Step 5: Bounded verification, complete report and owned commit.** Run new constructors with regression red/green, workflow partition/cleanup checks, unchanged selection/accounting/hash checks and syntax/diff; avoid rerunning accepted unchanged SQL suites or blocked local PG/socket/CLI probes. Report exact actual/reduced/native cases and unresolved dependency if any; do not manufacture a passing weaker contract. Keep55 unresolved and H2 UNCLASSIFIED. Independent spec/quality review follows. Root requires exact-head original18, complete H2 proof, quality and Ediel before acceptance; confirmed failures get scoped correction/review.
- [x] **Step 6: Root acceptance and next lifecycle/selection gate.** Only after complete hosted proof may root plan the separately reviewed owned-database publication lifecycle and H2 selection57/foundation98. That future no-new-input selection predicts596=538/23/31/4 (54 unresolved),focused342=295/20/23/4 (43 unresolved), but these are not this task's counts. If a repair is actually necessary, obtain an actual CLI skeleton first and recompute. Continue fixed-target characterization/lossless restoration and all remaining masterplan gates; no historical replay or mass ledger marking in production.

Task13 implementation5801c68d is independently spec/quality APPROVED, no findings.
New constructors/static checks PASS; actual SQL steps remain pending hosted proof.
T12-R1 label CLOSED in required workflow edit. No H2 selection/count change.

Task13 hosted8448b577/tree5c5ad457: OPS34543272605 H2 job103090355261
complete proof PASS69083ms: actual56 clean/repeat/index/full-row/sequence canaries,
admission/native guards, actual and reduced sequential/dependent effects, native
pre/post COMMIT errors, real55P03/backend death, controller SIGKILL/private cleanup.
Original16/auth103090355254, repair18/actual56 job103090355020180653ms, quality103090355308
and Ediel103090355311 PASS. Legacy17 early opaque BoundaryError retry103092259593
is pending; no source defect confirmed, no task completion before union acceptance.

Task13 COMPLETE at8448b57736cba0ae96eb1fe38e0257bdda4aa8c6/tree5c5ad4575770e805b7ea32ea1ce2b729a4452a82: OPS34543272605 original16/auth103090355254, legacy17 retry103092259593 PASS151107ms, repair18/actual56 job103090355020 PASS180653ms, full H2 job103090355261 PASS69083ms, quality103090355308 and Ediel103090355311 all PASS. Exact-head acceptance union across targeted retry. Original legacy17 early BoundaryError did not recur on unchanged code; no source defect confirmed. Full native/types gates remain red; no full replay/production closure.55 unresolved/H2 UNCLASSIFIED.

### Task 14: Integrate verified H2 with a terminal owned-database lifecycle

**Dispatch prerequisite SATISFIED:** Task13 independently approved and complete at8448b577 with original16/auth103090355254, legacy17 retry103092259593151107ms, repair18/actual56 job103090355020180653ms, fullH2 job10309035526169083ms, quality103090355308 and Ediel103090355311 all PASS on same head. No repair migration is needed by the actual56 clean/index oracle result. H2 is still unselected until this task.

**Files owned:**
- Create `scripts/canonical-user-rbac-dedupe-batch.py` for strict reusable source/reference/admission/native execution/postcheck/lifecycle support. Optional coherent SQL support under `scripts/sql/canonical-user-rbac-dedupe-*.sql` only if needed. No production module may import a selftest for its authority.
- `scripts/canonical-user-rbac-dedupe-selftest.py`: use shared trusted helper where appropriate, preserve complete accepted standalone SQL lanes and append actual57 integration/failure tests to command19. No lost native/reduced/NULL/sequence/dependent/privacy/death evidence.
- `scripts/canonical-auth-provisioning-replay.py`, `scripts/gridex-aud-003-clean-replay.sh`, `scripts/gridex-aud-003-clean-replay-selftest.py`: strict named57 scope and terminal lifecycle, retained reads and restoration.
- `scripts/gridex-aud-003-foundation-order.json`, `scripts/gridex-aud-003-legacy-foundation.additions.json`: select only complete H2 at57.
- `scripts/canonical-auth-membership-group.py`, `scripts/canonical-auth-membership-group-selftest.py`, `.github/workflows/ops-hardening.yml`: append19/disjoint partitions, retain existing H2 job with command19 including whole standalone+actual integration.
- Directly affected source-count/digest/ordinal constructors in legacy/repair/diagnostics selection+proof/governance/operations/invitation selftests, `scripts/canonical_full_governance_contract.py`, `scripts/gridex-aud-003-migration-provenance-regression.cjs`, and `docs/migration-provenance.md`. Do not alter their existing accepted SQL semantics.
- Report task-14-report.md stays ignored/local, never staged/committed. Root owns plan/memory/evidence. No historical SQL/history checksum edits, new migration/timestamp, arbitrary external target or prior legacy envelope changes. Report any evidenced ownership expansion need first.

**Exact selection:** H2 `20260525_debug_batch_2h_dedupe_user_roles_and_unique_guard.sql`,96 lines, SHA25698522e209332c44c804d7acccf831f25fb13b75b048fbe3613c8d69fcb373a9b. Whole BEGIN/two sequential deletes/two indexes/COMMIT/diagnostic executes unchanged. Preserve first56exact; insert H2at57, shift unchanged old57–97 suffix to58–98. Foundation98. Expected596=538 FULL_FILE_SELECTED/23 SUBSTITUTED/31 UNCLASSIFIED/4 EXPLICITLY_EXCLUDED=54 unresolved; focused342=295/20/23/4=43 unresolved. Compute actual accounting/digest rather than patching guessed values; no timestamp duplicate or extra selection.

**Interfaces:**
- `load_dedupe()` in replay uses trusted canonical key `user_rbac_dedupe_batch`, same origin/global-identity discipline as accepted loaders. Dedupe consumes accepted shared `canonical_owned_replay_batch` and `user_rbac_repair_batch`; exact OwnedPostgres type/active owner/name/directory and legacy+repair reference identities stay binding. Its own references/preimages remain separate and cannot overwrite legacy/repair authority.
- Prepare independent first56→H2-final index oracle before HOLD staging using accepted full source/reference construction and pinned H2 index declarations only. Full portable catalog plus explicit index validity/readiness/uniqueness/opclass/predicate/NULL properties must be independent of actual target output. Preserve explicit full-row/sequence snapshot semantics without importing selftests.
- Optional exact legacy.StagedSources for all new source reads; no ROOT original fallback after HOLD. Validate full98/pins/dependencies before target SQL even for named52/56/57 proofs. Every actual selected source executes exactly once in the same owned `gridex_auth_legacy_replay`.
- Preserve `--foundation-prefix-proof`/legacy52 and `--repair-prefix-proof`/repair56. Add exactly `--dedupe-prefix-proof`/dedupe57 in parent and shell; reject combined/unknown/abbreviated flags and arbitrary cutoffs. Full noflag mode retains completeness gate before owned startup/staging, then foundation98 and unchanged history continuation. All named prefix modes exit before ledger/types/artifacts.
- FoundationLoop applies first43, legacy44–52, repair53–56, native H2at57 only for dedupe57/full, then unchanged58–98 suffix only for full. H2 executes without --single-transaction; its own COMMIT is never described as rollback-safe. Controller-owned private preimages span that commit.
- Keep original18 command tuples exact; append19 `('python3','scripts/canonical-user-rbac-dedupe-selftest.py')`. Default all19; preserve explicit all18/all17 and original16/legacy17/repair18; add dedupe19. Four disjoint hosted partitions cover all19 exactly once. Existing H2 job runs dedupe19 once, retaining20min/private owner/always cleanup. No duplicate standalone job or weakened gates.

**Admission and terminal lifecycle:**
- Newly owned unpublished target only; actual accepted56 complete, empty user_roles ALL rows, exact base or approved repeat-final catalog, independently expected two-index delta, private server settings. No row deletion/movement, canonical guard removal, fixed identity/account/provider or live target to satisfy admission.
- Admission/preimage/native whole-file/final validation is one synchronous parent-controlled operation. Capture complete public/Auth/storage rows and explicit sequence last_value/log_cnt/is_called; require final catalog exactly independent H2-final and all preexisting rows/sequences unchanged. Do not release successful continuation before these checks.
- Introduce explicit terminal failure/quarantine state for the actual replay target in the new dedupe57/full routes. Historical legacy52/repair56 diagnostic routes retain their accepted transactional rollback and private post-failure snapshot inspection; do not dispose those old-scope databases before their existing assertions. In dedupe57/full, any failure after foundation begins, including native source failure before/after COMMIT, final assertion, subsequent suffix/child transport/restore failure, must deny further context/validation/foundation/SQL operations and never return a usable successful target. A validated boolean, shell set-e, socket disconnection or exception alone is insufficient.
- Destroy only the exact owned replay database (or exact owned container when database disposal cannot be verified) before final failed operation returns. Never drop references or unrelated canary by broad name/prefix. On disposal failure retain terminal denial and report sanitized failure; no clean-ready claim. Next attempt starts freshly owned/rebuilds accepted prefix, never reuses partial committed state. Controller/process death has exact existing workflow name+label cleanup; test it. Successful historical52/56 scope behavior and its rollback assertions remain valid.
- Fresh trusted target construction, reference installation and terminal-state transitions must not be externally replaceable/duck-typed. No arbitrary SQL/URL escape, new public handle release or exposed diagnostics. Full artifact publication remains gated by complete full-mode success, not H2 success.

- [x] **Step 1:** Failing constructors for exact pin/staged identity, separate references, all98 ordering, named modes, lifecycle state/RPC rejection and all19 partition/preservation. Reuse executed Task13 semantics, no source audit restart.
- [x] **Step 2:** Implement strict reusable H2 boundary and terminal parent lifecycle; independently verified full preimage/index oracle survives native COMMIT. Preserve original whole SQL and accepted helper identity/privacy/cleanup.
- [x] **Step 3:** Select exactly H2at57 and integrate real named shell/HOLD/bootstrap/first43/legacy/repair/H2 once. Preserve all originals including seed bytes/modes/timestamps/privateHOLD700/socket600 and restoration on success/failure. No reference DB substitutes for actual target.
- [x] **Step 4:** Actual hosted command19 includes full standalone proof plus actual57 success and independent rows/catalog/sequence checks. Negative cases cover missing/reordered/substituted staged bytes before SQL; wrong catalog and any populated role admission; trusted post-H2-COMMIT error/final-check failure; malicious follow-up SQL/context/validate/foundation after terminal failure; failed shell/restoration/transport; backend/controller death. Prove committed effects are privately observable only to test controller before exact disposal, no successful handle/artifact/ledger release, independent canary intact, then fresh reconstruction succeeds. Use trusted external hooks and pinned whole source, not edited SQL or mocked promotion.
- [x] **Step 5:** Bounded red/green constructor/cleanup/runner/accounting/provenance/hash/syntax verification and complete ignored report/owned commit. Independent spec/quality review. Root requires same-head all19 including actual52/56/57, quality and Ediel before acceptance. Fix confirmed failures through scoped review, not weakened assertions.
- [x] **Step 6:** Root records54 unresolved and proceeds to approved fixed-target B0/C2/D2/F2 characterization/restoration, remaining sources and full native replay/types/security/live parity/E2E/load/production gates. No historical mass replay or mass ledger marking live.

Task14 implementation39e14a98 plus scoped correction4e086e04 independently
APPROVED. Initial two Important test defects T14-R1 staged file/HOLD metadata
and T14-R2 transport OSError are CLOSED with bounded mutation-red/green regression
and independent scoped review; no new findings. Static constructors/runner19/cleanup20/
accounting/provenance98/integrity596/500/syntax PASS. Actual all19/57 pending hosted
acceptance. Working54/43 unresolved; no full replay/types/production closure.

Task14 COMPLETE at536906f3b6af4400fda8b1a4d20954987f583a47/tree1498199b949dfdd459d28eb7a943bb94cfd2d42d: OPS34549538480 original16/auth103109350028, legacy17/actual52 job103109350023151663ms, repair18/actual56 job103109350011184433ms, command19/job103109349875 complete standalone62235ms +20 actual57 modes +actual controller SIGKILL, quality103109349980 and Ediel103109349997 all PASS. Source selection/lifecycle actual accepted; T14-R1/R2 independently and hosted CLOSED.54 total/43 focused unresolved, foundation98/all19. Full native/types gates still red; no production mutation/merge/deployment.

### Task 15: Prove complete fixed-target B0/C2/D2/F2 effects privately

**Dispatch prerequisite SATISFIED:** Task14 COMPLETE at536906f3b6af4400fda8b1a4d20954987f583a47/tree1498199b949dfdd459d28eb7a943bb94cfd2d42d. OPS34549538480 original16/auth103109350028, legacy17/actual52 job103109350023151663ms, repair18/actual56 job103109350011184433ms, command19/full standalone62235ms plus20 actual57 modes and actual57 controller SIGKILL job103109349875, quality103109349980 and Ediel103109349997 all PASS. H2/lifecycle/selection are verified; reuse rather than rerun their audit. Task9 already mapped these four complete sources and approved the exact private fixture protocol below.

**Files owned:**
- Create `scripts/canonical-user-rbac-fixed-target-selftest.py`. Coherent optional private fixture/assertion support may be separated under `scripts/sql/canonical-user-rbac-fixed-target-*.sql` or source-specific sibling Python test modules if needed to keep files below2000lines and responsibilities clear. No new runtime authority imports selftests.
- Modify `.github/workflows/ops-hardening.yml` only to add independent `user-rbac-fixed-target-proof`, timeout20min, exact private owner `gridex-auth-legacy-fixed-${{ github.run_id }}-${{ github.run_attempt }}`, default selftest execution and `if: always()` exact --cleanup-owned invocation. Preserve all19 jobs/commands; no fixed command20, services, needs, artifacts, raw logs or CLI installation.
- Read/reuse accepted trusted replay/legacy/repair/dedupe helpers unchanged. Report concrete required API expansion before edits. No new external URL/host/role/process target or widened database name list.
- Ignored report task-15-report.md MUST NOT be committed. Root owns plan/memory/evidence. No immutable SQL/history, source selection/count, migration/timestamp, production/provider/user mutation.

**Exact sources:** all under supabase/migrations, whole unchanged bytes/pinned original manifest/canonical physical non-symlink file checked before every use:
- B0 `20260519_bootstrap_div3rsa_superadmin.sql`,344lines, SHA256bd9e06fc4b0244bc3bf6d9fc64924552766edf303168d4e2e11f0b8abe0334c0.
- C2 `20260525_debug_batch_2c_activate_afshin_nibela.sql`,249lines, SHA256b92f043727f2e5699a277c7d649dd583b8f04b1bdcd759840a2d0d1e52953659.
- D2 `20260525_debug_batch_2d_activate_afshin_nibela_v2.sql`,287lines, SHA256048bf0d47d0ae0e996517b770ac4d4591726a2b8e029a91348c8a031acf37dd7.
- F2 `20260525_debug_batch_2f_normalize_afshin_nibela.sql`,245lines, SHA2569fcf47f11a881c01a670f7858af5a297a2a49fb5033fdc256a024c8ae979e35b.
All four remain UNCLASSIFIED. Current accounting596=538/23/31/4 (54 unresolved),focused342=295/20/23/4 (43 unresolved),foundation98/all19 unchanged. Foundation digest271142f607da58484518cc870366802aa36fb3f3b6b9688c40188cf180d6ce08.

**Current interfaces and resolved choices:**
- New selftest default runs complete private proof; --selection-only only constructors; --cleanup-owned delegates exact existing name/label cleanup. Reject unknown/combined modes.
- Use trusted replay.load_batch/load_repair/load_dedupe identities. Establish actual accepted57 through real named shell `serve_child(legacy,h,command,'dedupe57')` once, then independent private clones/cases using accepted closed names. Capture true actual target, not reference DB substitution. Preserve exact original migration/seed bytes/modes/mtimes after staging. Reference registries never overwrite each other. An existing terminal handle must not be reset to fresh/reused; respect the accepted lifecycle API.
- The copied Task9 cases below mention then-current52/56. Their required actual-prefix lane NOW uses verified57 with H2 indexes and all actual canonical guards. Old prefixes may be explicitly named diagnostic/reduced characterizations only. Do not silently back off to52/56 to make actual success pass.
- H2 indexes/actual NOT NULL/FK/unique/enum/trigger rules may reject historical dirty shapes. Assert native actual rejection and use an explicitly named reduced fixture for otherwise unreachable branches; never drop actual canonical guards for admitted fixture success. Reduced success never proves actual canonical compatibility.
- Keep four source effects in independent disposable targets. B0/C2 may use genuine outer rollback; D2/F2 retain original BEGIN/COMMIT and native post-COMMIT durability. No ON COMMIT DROP preimage or outer rollback claim spanning them. Controller/private store holds full before/after rows/catalog/sequences.
- Fixed literals are loaded only from pinned source into private memory and bound to freshly reserved synthetic fixture slots. No literal copy into authored test/SQL files, tool arguments, logs, receipts or artifacts. No provider/password/credential generation or real-account read. Source snippets or extracted DO children never substitute for whole-source execution. Use no customer data.
- Exact full-row/PK oracle includes all constructor and source trigger/dependent work. Preserve original IDs/fields; capture genuinely generated synthetic IDs privately and validate allowed effects, not indiscriminate UUID normalization. Time-dependent fields may use independently captured execution bounds/source-defined equality relations; do not treat all postimage values as their own oracle.
- No production/canonical cleanup is implemented here. Characterization is not source-selection acceptance. Future lossless boundaries require actual CLI-created forward migration and independent complete preimage restoration under verified terminal lifecycle; cannot blanket-exclude a difficult source.


**Isolated token-fixture clarification (root, established accepted test scope):**
The credential prohibition bars passwords, signed authentication/API tokens,
provider-issued/live or redeemable credentials and real-account actions. It does
not bar opaque nonredeemable invitation-token UUID test values inside the freshly
owned network-none/provider-free database, including the actual canonical
`token uuid NOT NULL DEFAULT gen_random_uuid()` value produced by unchanged C2.
This uses the already accepted synthetic default proof in
`scripts/invitation_token_prerequisite_selftest.py:177–201` and token-shape cases
235–256, retained in verified all19. Keep actual NOT NULL/default/index unchanged;
no synthetic-schema prerequisite is needed merely to avoid this default. No app,
live issuer, redemption endpoint, provider, delivery or external connection may
receive these values. Keep them only in private memory/oracles, never emitted,
exported or submitted for authentication, and destroy the exact test database.
Source-derived fixed identity literals retain the stricter private binding rules.
If a fixture actually requires a live/redeemable credential/provider effect, the
original stop-and-report-prerequisite instruction still applies. This clarifies
nonredeemable test data already within the authorized fixture scope; it does not
authorize credential provisioning or weaken actual canonical token guards.

**Binding source-specific proof cases from the approved Task9 contract (current-prefix clarification above governs):**

## Private fixed-identity characterization: B0/C2/D2/F2

Create `scripts/canonical-user-rbac-fixed-target-selftest.py` and private fixture support under `scripts/sql/` in a **separate subsequent reviewed implementation**. Four independent owned databases/cases prevent B0's global grants or D2/F2's internal commits contaminating another result. Use the accepted managed-compatible Auth schema and actual first52 plus the proven three-source safe boundary when its helper/catalog dependencies are needed. Reduced fixtures are additional named branches; they never stand in for this complete actual-prefix lane.

Fixture identity protocol: the test code defines only symbolic U_boot/U_target/U_old/U_actor/C_target slots and synthetic unrelated identities. In the private disposable database, bind the fixed slots from the already pinned source constants in memory; where exact email equality is required, use that source-bound value solely on a newly created provider-free synthetic Auth fixture row. Never copy these literals to test code, logs, reports, artifacts or command arguments; no lookup to a real account verifies them. These database rows are fabricated test stand-ins, not imported users. Use no password/credential value or email provider; Auth sessions remain absent unless unrelated synthetic session preservation is explicitly tested. Reject any target that was not freshly created/owned or already contains one of the reserved fixture slots. If fixture defaults require credentials or unreviewed provider effects, stop that case with the exact dependency; do not fabricate credentials or alter auth-provider behavior.

| Source | Executable independent next cases and required postimage |
| --- | --- |
| B0 | Start with no U_boot and execute whole file inside genuine outer transaction: expect guard failure and verify extension/CHECK rollback. For successful characterization seed synthetic U_boot with non-NULL email; canonical role-key/permission-key/link arbiters, legal company status, membership pair uniqueness and profile/audit shape must exist. Exercise no matching company→insert; one slug/organization match→update; conflicting two matches/equal timestamps→characterize ambiguous winner without approving it. Exercise optional roles.is_system, each of four user_roles status/is_active shapes, optional permissions/link/profile/audit relations and audit company_id column. Assert two unscoped role assignments, all-permission super link, exact20-key company-admin links, CHECK narrowing, profile/active-company change and explicit audit row plus actual trigger effects. Repeat retains assigned IDs but adds audit/history as source dictates. Entire populated result rolls back or database is destroyed. |
| C2 | Seed synthetic exact U_target/email, U_actor and C_target; verify actor FK subjects are actually created, with no inference that fixed actor is authorized. Existing membership success→exact updates; no-membership with membership_role column→whole-file success may still leave membership absent due stale FOUND; this is a characterized defect, not a repaired successful activation. Column-absent branch tests actual INSERT. Test supported enum fallback, missing label/type failure, role key/name ties, target-user vs invited-email collision, target/NULL/other-company role rows, expired/revoked/conflicting aliases, each invitation email-column branch, missing token/default/actor FK and existing accepted row. Full multisets include company/profile/role/membership/invitation/trigger work; rollback all. |
| D2 | Seed exact U_target/email and U_actor; C_target may be absent because source upserts it. Run whole file with its BEGIN/COMMIT preserved using dedicated unpublished database. Verify ROW_COUNT insertion succeeds where C2 skipped; test unrelated blank role-key updates and NULL role-text overwrite with differing role_id. Test both aliases/email-only success; invited-email-only malformed predicate native failure; missing expires_at; mismatched invitation-vs-membership enum type; optional metadata/actor/key/time columns and no invitation insertion when none match. Run whole file twice and compare source-defined timestamps/notice counts privately. After internal commit, deliberately fail appended diagnostics/assertions and kill backend; committed effects remain inside disposable DB and **must be observed then destroyed**, never called rolled back. |
| F2 | Seed correct synthetic Auth identity and C_target/company-admin dependencies; seed U_old/U_actor only where required by actual FKs/rows. Test no old rows; old-only membership→retarget; both old+correct membership→native unique failure before upsert; old invitation retarget; other-company old rows preserved; NULL-company target roles moved; old-company roles disabled; inconsistent role_id preserved; missing role_id on inserted membership; all email-alias combinations and enum heuristic/fallback/no-label cases. Test missing memberships at early regclass cast separately from later optional guard. Whole file retains internal COMMIT. Postcommit sentinel/backend death must show committed private state before owned DB destruction. Never accept canonical invitation/role semantics from this source's success. |

For each successful characterization obtain exact pre/post multisets keyed by original PK, not just counts: Auth/company/profile, role/permission/link IDs, membership actor/time/role fields, invitation status/token/expiry/revocation/actor, audit/domain/journal/outbox/job rows, and sequence state when implicated. Source-generated UUIDs are captured privately and related to explicit source effects, not normalized away indiscriminately. Errors on dirty fixtures remain native-source characterization, not preflight success. No fixed-target execution can be authorized by an observation taken in another database/session.

Before-source rejection cases apply to every fixture runner: wrong database owner/name/host/port/socket, nonfresh fixture reservation, unpinned source, public logs, active network/external trigger or unreviewed FK/trigger target. Reject before sending source bytes. Source-derived sensitive literals never flow through the original16 cleanup path.


- [ ] **Step 1: Pin sources and reject unsafe constructors.** Red/green missing/substituted/symlink/hash/whole-source/COMMIT controls, exact owned/fresh/reserved-slot checks, wrong helper/reference identity, unsafe logs/external write graph. Derive and validate a closed constructor/source FK/trigger write graph from actual57; no real-user lookup or credential placeholder. Distinguish constructor-only evidence from actual SQL.
- [ ] **Step 2: Build actual57 and independent fixtures/oracles.** Real accepted57 once then independent disposable cases, exact private snapshots of full rows/catalog/sequences, minimum synthetic source-bound reservations and unrelated synthetic canaries. Explicit profiles use actual columns and no assumed Auth INSERT callback. Reject reserved collisions before fixture/source bytes. Validate source-defined grants/actor/tenant/dependent effects independently.
- [ ] **Step 3: Execute all four complete sources and mapped branches.** Cover the copied B0/C2/D2/F2 requirements, actual successful/failed/repeat cases and explicitly reduced branches. Native actual constraints must remain. A successful C2 with missing membership is an evidenced defect, not repaired activation. Native D2/F2 errors cannot count as selected source success. Record exact stage/SQLSTATE privately without forcing guessed codes or weakening a fixture to green.
- [ ] **Step 4: Prove rollback versus durable private failure and exact cleanup.** Whole B0/C2 rollback, D2/F2 pre/post native COMMIT failure and backend/controller death; inspect committed private effects before exact disposal. Separate source/case targets and canary survive correctly; no output handle/artifact/ledger/permission/session/durable work released to real application. Client/server DETAIL/HINT/statement/parameters and source-derived fixture literals remain private. No raw cleanup logs.
- [ ] **Step 5: Complete bounded verification/report/commit and independent review.** New constructors/CLI/workflow/cleanup/source/accounting/provenance/syntax, targeted red/green only; no accepted unchanged SQL reruns or local PG/Docker/socket/CLI probes. Full ignored report maps each authored actual/reduced/source unit and unresolved prerequisite, exact static results and no SQL overclaim. Root publishes reviewed coherent batch and requires same-head all19, complete fixed-target proof, quality and Ediel. Confirmed failures get scoped fixes/review.
- [ ] **Step 6: Use actual evidence to implement lossless canonical continuation next.** Root plans exact minimum constructor/prerequisite and actual CLI-created cleanup/reconstruction boundary or boundaries for these sources; retain exact original catalogs/role-permission identities/full rows/trigger graph/sequences and remove only captured synthetic PKs in FK-safe order. No TRUNCATE/CASCADE/disabled guards/dump substitution/broad email deletes or guessed timestamps/counts. Leave all four UNCLASSIFIED until that whole-source successful lossless path is actually proved and individually selected. Continue all remaining54 sources/full replay/types/security/live parity/E2E/load/production gates.


Task15 B0 actual-versus-reduced clarification (2026-09-11): actual57 lacks
public.companies.industry and public.company_memberships.suspended_at. Require
whole-B0 native missing-column rejection and exact rollback/preimage evidence;
record actual catalog absence separately from the first observed native error.
Use an explicitly reduced industry-only lane for the next dependency if reachable,
and both-column reduced success/history lanes. Source declarations require industry
text NOT NULL with its original source-defined default, suspended_at nullable
timestamptz without default. Reduced success is neither actual compatibility nor
selected completion. Report whole source-backed prerequisite candidates for the
next step; otherwise use an actual CLI-created forward migration later. No
canonical schema/helper/history/selection/count changes in Task15.


Task15 status-shape clarification (2026-09-11, fix3): retained actual57
user_roles_status_check permits active/disabled/removed_from_company/
invitation_revoked/locked_security, not inactive. Synthetic inactive preimages
must use valid disabled. Where immutable F2 writes inactive into existing old-user
roles, preserve actual guard and characterize native CHECK rejection with exact
rollback. Otherwise unreachable historical success may use explicitly named
reduced status-shape fixtures only. Document exact affected case mapping and
source/check evidence; no canonical constraint/source/helper/count edits or
actual compatibility/selection inference. This applies the existing actual-vs-
reduced rule and informs later lossless prerequisite work.


Task15 D2 dependent-column clarification (2026-09-11, fix4): absence of
company_memberships.membership_role leaves v_membership_role_type NULL; a present
company_invitations.membership_role makes later dynamic invitation UPDATE use that
uninitialized cast type. Current reduced_membership_column_absent must characterize
native42601 and exact rollback/preimage. Add a clearly named reduced both-column-
absence whole-source success/repeat lane if source-supported, preserving native
BEGIN/COMMIT and independent effects. No guessed private error substring or
canonical schema/source/helper/count changes;102 private characterization cases.
Bounded same-mechanism audit covers type initialization/use in existing optional
column branches, not a fresh source-effects audit.


### Task15 accepted-input/privacy transport clarification (fix5 recovery)
At published2bbcdab8 all102 native cases PASS; final privacy rejects retained
accepted preparation files. This clarification restores the authorized fix5
contract lost with the disconnected workspace; it does not change source semantics.

Own only scripts/canonical-user-rbac-fixed-target-selftest.py and
scripts/canonical-user-rbac-fixed-target-controls.py. Keep accepted helpers unchanged.
Four finite whole-input paths can contain source literals: prefix-1.sql,
replay-source-1.sql (both canonical accepted prefix item1), repair-whole-E2.sql
(repair source item2), dedupe-whole-H2.sql. Distinguish these from generated
artifacts ONLY with actual trusted writer/path provenance, independent canonical
physical non-symlink source validation, manifest hash and exact complete bytes.
No filename/suffix-only exception, copied/foreign/lookalike/symlink/mutated/missing
source escape. Collector and all other retained files stay scanned unchanged.

A fifth match is generated repair-admission.sql, from unchanged repair.envelope_files
and diagnostic_guard(E2). It MUST NOT be written physically or excepted from scan.
Use a Task15-only per-exact-owned-handle context adapter during accepted preparation:
private returns an opaque in-memory input for this exact generated name; ordinary
writes delegate unchanged. Preserve complete unchanged admission bytes. Adapt only
its exact repair envelope run_files route: validate same handle/owner/database,
closed ordered files, one exact virtual identity, expected stage/transaction/result.
Use h.command unchanged and replace only the matching -f argument value with '-';
pass unchanged admission via stdin. Preserve all other whole-file positions,
ON_ERROR_STOP, source order/transactions, safe_receipt/result guards, lifecycle and
reference identities. Raw adapted results stay in memory. No global monkeypatch or
helper source/API/class changes. Restore instance methods and invalidate/clear all
private buffers on every success/failure path, including unexpected method removal.
Physical generated admission must fail final privacy even with no matching literal.
Do not delete or write-then-delete evidence to pass privacy.

Previous author reported a passing fix43b90fd0 (24adapter/41privacy controls), but
that local object and ignored report are unavailable after environment restoration.
Recreate this bounded fix from source and this confirmed mechanism; do not claim
those lost tests as evidence for new code. Keep meaningful real unchanged writers
and repair.execute with mocked process/SQL for targeted RED/GREEN; check routing,
result failures, owner/phase, restoration and privacy provenance negatives.
Prior119-file constructor audit matched the four complete inputs plus generated
admission; actual catalog output is hosted-only. No speculative client output leak
was confirmed: final client-last.out comes from dedupe index_details. No generic
output adapter or accepted proof rewrite. If new evidence contradicts this, report
concrete mechanism. No SQL locally, no installs/probes. Hosted full102/final privacy
plus unchanged mandatory all19/quality/Ediel remains acceptance gate.

Fix5 staging clarification: the accepted shell moves canonical migration files into
private HOLD during replay. Validate canonical physical source/pin at adapter entry
and after staging restoration/final scan; during HOLD use the actual trusted
StagedSources physical input and identity through accepted staging APIs, verifying
the same pinned whole bytes. Canonical absence during this bounded accepted phase
is expected, not a bypass. Reject arbitrary copied/symlink/substituted/missing staged
inputs; no helper change or filename-only provenance exception.


### Task 16: Resolve the exact lossless fixed-target continuation interface

This bounded design consumes Task9 complete source effects/admission and Task15
actual102 native evidence; it does not repeat source characterization. Final Task15
privacy acceptance is required before executing its continuation, but design may
use already verified native semantics while that gate runs.

Own one document quality/audits/USER_RBAC_FIXED_TARGET_CONTINUATION_2026-09-11.md.
Root owns this plan and memory. No runtime/source/helper/selection/workflow changes.
Use the existing lossless empty canonical continuation contract verbatim as the
boundary: fresh unpublished owned database, empty business writes, independent
complete preimages, minimum provider-free synthetic slots, whole original sources
with native COMMIT, exact captured-PK/seed/catalog/sequence restoration, terminal
failure/disposal before release. Do not add optional characterization cases.

Resolve only decisions necessary for implementation:
1. Smallest coherent source ordering/group and forward prerequisite/cleanup files,
   each original/new migration executed whole exactly once. State exact logical
   suffixes for actual CLI generation; do not invent timestamps or counts. Explain
   whether a single group cleanup preserves every source and preimage obligation;
   split only where concrete dependencies require. Include B0 missing industry and
   membership suspended_at using whole compatible prerequisites or forward schema
   migration justified by original declarations. Do not extract broad existing
   migration fragments and claim selection. F2 old-role CHECK rejection is avoided
   only by an admitted minimum constructor with no old role row, not weakened CHECK.
2. Exact minimal constructor/write graph and per-source successful actual-prefix
   path based on existing oracles. Original seeds, permissions/link identities and
   source/constructor-created trigger work all need exact reversal. Identify any
   nonconvergent trigger/sequence restoration with concrete evidence and remedy.
3. Narrow accepted lifecycle extension before final H2 SUCCEEDED release; cannot
   reset/reuse terminal/succeeded handle or use test modules as runtime authority.
   Private whole input/output transport retains Task15 fix5 boundaries. Preserve
   existing legacy52/repair56/dedupe57 proofs and original19 command union.
4. Specify implementation-owned files, actual staged-loop insertion, independent
   final reference, essential success/repeat/dirty/native-COMMIT-crash/cleanup tests
   and final selected accounting formula once actual skeleton count is known.
   No docs-mirroring tests; provide path/line evidence for new dependency decisions.

Read Task9's named lossless section and existing source-effect matrix, Task15
oracles/fixtures/lifecycle code only as needed. Do not re-audit all migration sources,
retest accepted cases, inspect real users/providers or execute SQL. Preserve later
R2 text[] versus alignment RETURNS TABLE dependency for its proper downstream task.
Write concise actionable contract, git diff --check, commit only owned document and
full ignored task-16-report.md. Independent review checks feasibility and exact
lossless/lifecycle constraints. Then batch actual CLI skeleton generation in one
hosted job and implement the reviewed boundary without another open-ended audit.


### Task 17: Generate both actual fixed-target migration skeletons together

Prerequisite: Task16 contract independently approved. This is empty-file preparation,
not continuation SQL; Task15 final privacy remains required before execution.
Own only .github/workflows/ops-hardening.yml and ignored task-17-report.md. Preserve
all existing jobs/commands/owners, timeout, cleanup and mandatory gates. Root owns
plan/memory, artifact retrieval and later actual source registration.

Add one temporary user-rbac-fixed-target-skeletons job, ubuntu-latest, timeout5min,
checkoutv4 and supabase/setup-cli@v1 pinned2.101.0. Follow prior Task10 job at935eb5a0.
Run supabase --version and supabase migration new --help, then exactly:
supabase migration new canonical_user_rbac_fixed_target_prerequisites
sleep 1
supabase migration new canonical_user_rbac_fixed_target_restoration
The one-second separation avoids duplicate actual CLI versions; never rename files
or invent timestamps. Fail before generation if either exact suffix already exists.
After generation verify exactly one empty regular non-symlink file per suffix and
two distinct fourteen-digit versions. Upload only those two empty members as one
artifact user-rbac-fixed-target-migration-skeletons with if-no-files-found:error.
Use explicit two suffix paths; no blanket SQL/log artifact or credentials. Include
an absent-suffix job guard so authored files can never be uploaded on later pushes;
root removes this temporary job when actual identities are registered.

No SQL application, database/provider/network configuration or live Supabase action.
No local CLI install/probe. Verify changed YAML and embedded bash/Python syntax,
git diff --check and relevant existing workflow constructor check only if it covers
the insertion boundary. Do not add docs/YAML-mirroring tests or rerun accepted SQL.
Full ignored report names exact static commands/output and no hosted/SQL overclaim.
Commit only owned workflow; independent scoped review then root publishes this
alongside reviewed contract and any separately reviewed necessary privacy diagnosis.
Root retrieves actual ZIP/members, validates names/empty bytes/hashes, records exact
identities and continues implementation after privacy acceptance. No repeated CLI
creation supersedes the first accepted artifact identity.


### Task15 additional populated-reference transport correction

New native evidence atfe0379e4: all102source cases and all19/quality/Ediel PASS;
final retained-artifact privacy still fails. Pinned prefix1's stored function
public.gridex_db1_default_company_id contains two B0 matcher values. Existing full
catalog projections retain its definition; actual unchanged legacy/repair envelope
writers serialize that reference into envelope-context.sql and repair-context.sql.
A source-pinned nonempty-reference reproduction proves both matches and rejection.
Prior empty-reference constructor fixture did not cover this data-dependent path.
Full ignored evidence: task-15-post-fix5-privacy-diagnosis.md. This is an additional
confirmed input path; retain the prior fix history and do not waive final privacy.

Authorized narrow expansion of the prior one-input adapter contract: own only the
two existing Task15 selftest/controls scripts. Virtualize exactly envelope-context.sql
and repair-context.sql in addition to repair-admission.sql. No generated-file scan
exception, encoding-to-evade-scan, file deletion or helper/source rewrite. Keep four
whole-input provenance exceptions and every ordinary file/collector check unchanged.

Legacy route: unchanged legacy.envelope_files/execute, reference preparation's two
calls (owned reference database, dedupe state absent) and actual staged replay
(owned replay database, FRESH). Bind each envelope to exact current reference identity,
trusted writer/handle, file order, database/phase, transaction/expected result and
completion checks. Legitimate reference replacement BETWEEN completed preparation
calls remains allowed; replacement inside an envelope rejects. Replace only first
context -f value with '-', send its complete unchanged bytes in memory.

Repair route: context and admission are adjacent first/second generated controls.
Combine ONLY these complete unchanged generated byte strings in original order with
one separating newline into the single stdin stream. With unchanged h.command output,
replace first generated-context -f value by '-' and remove only the second generated
admission -f/value pair. Every original migration stays an independent whole -f input
with exact bytes, unchanged relative order, original transaction/COMMIT, flags and
ON_ERROR_STOP. No original-source concatenation, excerpts or rewrite. This precisely
supersedes the former one-value-only argument rule for these TWO generated inputs;
it does not authorize generic concatenation or arbitrary command adaptation.

Keep native safe_receipt/SQLSTATE/nonzero-result guards and unchanged legacy/repair
completion validation. No extra subprocess/FIFO/network target/global monkeypatch.
Restore methods and clear/invalidate all generated buffers on every completion/error.
Explicitly forbid physical versions of all three generated names at final scan.

Targeted meaningful RED/GREEN must use populated source-pinned reference and actual
unchanged legacy/repair writers/execute. Cover reference first/repeat and actual
staged legacy routes, repair exact two-control byte/argv equivalence, wrong phase,
reference change/foreign virtual/physical input rejection, failure cleanup. Retain
existing controls; do not rebuild the102native matrix or add unrelated tests. Verify
no whole source/helper/workflow/count changes, syntax/diff and constructor mode.
Full ignored task-15-reference-privacy-report.md with commands/results and limitations;
commit only two owned scripts. Independent scoped review then coherent publication
with approved Task16 and CLI-only Task17 preparation. Require same-head full102/final
privacy/all19/quality/Ediel before continuation execution. No local SQL/install/probes.

Task17 guard clarification: evaluate absent-suffix eligibility AFTER checkout (step
output or guarded job steps), not a hashFiles expression at job level before a
workspace exists. Guard setup/generation/upload consistently. The generation step
still asserts no preexisting suffix files immediately before invoking CLI, catching
an inconsistent/raced eligibility result. Registered/authored files cause skipped
generation/upload, never an authored-SQL artifact. Preserve existing workflow triggers.

2026-09-11 fe0379e4 OPS34581892193 reconfirms all19/actual52+56+57,
quality/Ediel and all102 native cases PASS; final privacy103207157878 stillFAIL.
Populated source-pinned reference contexts identify the additional retained
generated inputs. Correction5b083ba7 independently spec/quality APPROVED with
no findings: three generated controls stay in memory, only two adjacent generated
repair controls coalesce, all original whole arguments/source bytes unchanged.
Four executor routes/11 reference failures under mocked SQL/process, constructors
and strict physical-name privacy controls PASS. New-head native final privacy
remains required; no source-selection or production acceptance inferred.
Task16 lossless continuation contract385335d0 independently APPROVED. Task17
CLI-only two-empty-skeleton workflowb19bb54f independently APPROVED, staticPASS.
Publish this coherent batch once, retrieve actual CLI identities, require mandatory
same-head gates, then implement approved continuation.54 unresolved/full replay/
types and complete production plan remain OPEN; no merge/migration/deployment.

Task17 actual CLI artifact VERIFIED: job103222123610, OPS34586595826 at
e2bb1a9b, artifact10193838307, ZIP466bytes SHA256
44b153f2f69f135bd28a0835cbc24a9dbdcbff669a027965c3a83bd507918d06.
Exactly two empty regular non-symlink members, distinct actual14digitversions:
20260911095503_canonical_user_rbac_fixed_target_prerequisites.sql
20260911095505_canonical_user_rbac_fixed_target_restoration.sql
Both0bytes SHA256e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855.
ZIP/member validationPASS. First accepted actual identities pinned in ignored
task-17-artifact-receipt.json; no timestamp invention or migration registration yet.
Task15 same-head native final privacy still pending before continuation SQL.

### Task 18: Implement the approved lossless fixed-target continuation


## Prerequisites and exact identities
Dispatch only after root records e2bb1a9b same-head Task15full102/final privacy and all19/quality/Ediel accepted. Do not reinterpret a code review as native acceptance. Task16 independent review approved the complete contract in quality/audits/USER_RBAC_FIXED_TARGET_CONTINUATION_2026-09-11.md; read it in full as the binding requirements, plus task-16-review.md and task-18-preparation-notes.md here. Use that contract instead of restarting Task9/15 source audit. Task15 expanded populated-reference memory correction5b083ba7 is also reviewed and must survive runtime extraction.

Task17 actual CLI artifact10193838307 at e2bb1a9becc07989181405ddccdbdcae173d36d4, OPS34586595826/job103222123610, ZIP466 SHA25644b153f2f69f135bd28a0835cbc24a9dbdcbff669a027965c3a83bd507918d06. task-17-artifact-receipt.json and the two original empty members are here. Copy each actual empty file to supabase/migrations before authoring (do not regenerate/rename):
P = 20260911095503_canonical_user_rbac_fixed_target_prerequisites.sql
X = 20260911095505_canonical_user_rbac_fixed_target_restoration.sql
Both original members0bytes SHA256e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855.

## Binding outcomes
Implement whole once P→B0→C2→D2→F2→X after exact complete first57, before unchanged old58–98 suffix. P adds only the two approved source-backed declarations. Fresh provider-free3Auth+1company graph, no old user or extra memberships/seeds; preserve actual CHECKs/FKs/triggers/RLS/ACL/defaults. Per-source native success and independent complete postimage, C2 absence/D2 insertion/F2 update. Preserve B0/C2 successful commit and original D2/F2 internal COMMIT. X exact captured-PK child-first deletion, original full seed rows and IDs restoration, membership CHECK attributes, no incidental cascade/broad deletion/disabled guard/dump. S1 independently S0+P declarations, all rows/catalog/sequences exact including log_cnt; no setval. Incoming FK actions/statement hooks/default graph checked before writes. No persistent support or synthetic grants/session/provider work remains.

Frozen trusted continuation-required mode before execution, H2_COMPLETE→FIXED_NATIVE→FIXED_COMPLETE→SUCCEEDED; success only through sole final release after exact child/HOLD/private cleanup. Historical52/56/57 unchanged. No reset/rearm/caller-provided reference/SQL bypass. Every failure terminally disposes before next request; canary untouched. Runtime must not import selftest as authority. Narrowly extract accepted memory transport and any necessary existing complete oracle semantics into trusted runtime modules, preserve existing tests/semantics; no broad refactor.

## Owned files
- Two exact P/X SQL files above.
- scripts/canonical-user-rbac-fixed-target-batch.py and scripts/canonical-user-rbac-private-inputs.py.
- scripts/canonical-auth-provisioning-replay.py, scripts/canonical-user-rbac-dedupe-batch.py, scripts/gridex-aud-003-clean-replay.sh: only approved frozen scope/pre-release once-only integration.
- scripts/canonical-user-rbac-fixed-target-selftest.py and scripts/canonical-user-rbac-fixed-target-controls.py: only narrow runtime extraction/import adaptation preserving102 cases and accepted controls.
- scripts/canonical-user-rbac-fixed-target-continuation-selftest.py: one separate essential proof and exact-owner cleanup.
- Existing foundation-order/additions/history-additions and focused classification/accounting assertion files strictly needed for actual two identities/four original full-source selection. List exact touched paths in report; no immutable historical SQL/hash rewrites.
- .github/workflows/ops-hardening.yml: remove temporary skeleton job when registering actual files, add one separately owned bounded continuation proof/always cleanup. Preserve original19 tuple/union and all prior9 jobs.
- Full ignored task-18-report.md. Root owns all plan/memory/master/PR/publication; preserve dirty root changes/untracked/other worktree.

After actual registration verify exactly598=544selected/23substituted/27unclassified/4excluded,50unresolved; focused344=301/20/19/4,39unresolved. Foundation104/endpoint63, old suffix shifted6. First57/hash/order intact, old58–98 relative order intact, fixture30–33/RBAC38/first43 unchanged. Root updates active accounting before tests requiring memory equality; notify root exact actual count transition. Registration alone is IMPLEMENTED_NOT_VERIFIED, no source acceptance until hosted proof.

## Essential verification and report
No local SQL/CLI/container/socket install/probes: environment absence already established. Use targeted meaningful RED/GREEN constructors/static tests for changed ownership/lifecycle/admission/transport and preservation. Essential new hosted proof: standalone+actual staged success and fresh repeat; each6inputs whole once; independent per-source/final equality; dirty graph/catalog/default/incoming-FK/owner/hash/stage pre-write rejection; D2/F2 postCOMMIT failure and backend/controller death; X/captured-row/seed-ID/catalog/sequence/release mismatch; cleanupCOMMIT-before-release death; finalprivacy and canary/disposal. Reuse existing accepted helpers/harness where trusted, avoid duplicated102 branch matrix or optional fixtures. Do not run unchanged full102 locally or add tests mirroring docs/YAML.

Full report exact changes/owned paths/commits, targeted commands and actual output, source/pin/order/count preservation, self-review and explicit native-pending limitations. Finish complete coherent code with tests and commit only owned files; independent scoped review follows. No push/live operations. Surface concrete dependency/safety blocker with evidence; never weaken the contract to make green. Files over2000lines require safe bounded split. User explicitly requires efficient continuous completion, no unnecessary audits or confirmation pauses.

2026-09-11 Task15 FINAL NATIVE ACCEPTED at e2bb1a9becc07989181405ddccdbdcae173d36d4,
reviewed treeaa7fbe284635d7fdbb9b0ed858e9fc1476d276f5, OPS34586595826.
Fixed-target103222123596 PASS full102 (B0=18/C2=25/D2=28/F2=31), exact log
PASS complete private fixed-target characterization; selection unchanged at10:02:00,
ownedcleanupPASS. This final success is after strict artifact+collector scan.
Same-head original16/auth103222123215, legacy17/actual52 103222123500,
repair18/actual56 103222123422, dedupe19/actual57 103222123516, quality/build
103222123483 and Ediel103222123485 allPASS. No mandatory bounded gate outstanding.
Task17 actual2CLI empty identities/artifact verified. Task16 design approved.
Task18 may now implement the exact approved continuation; no remaining54source,
full native/types or production gate is closed by this bounded acceptance.

Task18 ownership clarification: scripts/canonical-user-rbac-fixed-target-oracles.py
is additionally owned solely for a compatibility import/re-export shim when its
unchanged pure Oracle/activate/bootstrap/normalize semantics are narrowly extracted
to trusted runtime authority, as Task16 explicitly permits. No oracle semantics
or102case changes. Preserve one canonical trusted replay-controller module identity
through runtime and characterization imports, retaining exact caller-code/handle/
staging provenance. No broad sys.modules/global monkeypatch or generic adapter.
Targeted import/provenance controls cover this concrete extraction risk.

## Downstream alignment preparation — no source acceptance
Root bounded read of20260526_debug_step1_2c_full_schema_code_alignment.sql169–374
confirms the whole source drops gridex_debug_batch2_rbac_v169 and
gridex_get_user_roles(uuid)170 before its table-return replacement172. Therefore
the isolated CREATE OR REPLACE return-type warning does not alone require another
forward migration. Check exact additional dependents/whole-source execution first;
do not invent an extra boundary from an isolated declaration. The role helper203
explicitly grants anon/authenticated/service_role while body186–200 lacks actor/
company binding; permission overrides223–238 and contract counts240–283 likewise
need complete final runtime/caller/ACL/tenant review. This is source-level evidence,
not live exploit or production grant verification. Caller search found
lib/rbac/getUserPermissions.ts, app/dashboard/page.tsx, lib/tenant/scope.ts and
lib/customer-contracts/db.ts; full traces/later winners remain open. No selection,
SQL execution or current Task18 scope expansion. Detailed bounded routing stays
in ignored next-alignment-source-routing.md until the downstream task.

### Task 19: Complete three alignment-source effects and dependency contract


Read task-19-preparation-notes.md and next-alignment-source-routing.md here first as context; verify every claim against the whole original files. Those root notes are source-read preparation, not independent review, SQL evidence or permission to omit effects. Read the relevant approved Task9/16 private-runtime boundaries only where a named dependency needs them; do not read the whole masterplan or redo accepted102/first57 audits.

Own only quality/audits/USER_RBAC_CUSTOMER_ALIGNMENT_SOURCE_EFFECTS_2026-09-11.md and ignored task-19-report.md. This is a read-only code/schema task with one document; no SQL/migration/selector/fixture/helper/workflow/memory edits, no live/provider/customer/credential/network action or local install/probe. Root owns active memory/plan/PR and all later registration. Preserve current Task18 files and dirty root work. Its native acceptance remains independent/pending until root records it; this task does not implement a continuation.

Scope exactly three immutable unresolved sources under supabase/migrations:
- 20260525_debug_step2_code_schema_alignment.sql,87lines,SHA256e7be5cf935817846dcbe65e64c3b3d558d5e442c9bf7f7af5863f2180f108f04
- 20260525_debug_step2b_tenant_scope_and_customer_card_performance.sql,280lines,SHA256afd5c2693cbb1a9f9bd40055cd993189e0118d4871bbb2bfcfb18e4124c2fcb2
- 20260526_debug_step1_2c_full_schema_code_alignment.sql,374lines,SHA2565a4a2326232ab847d23fed32af2be13a046ee3e3a2dae41dead6f5b4eba16472

Map complete statement units and exact line ranges, direct/trigger/helper/FK effects, admission conditions/guard gaps/native failures, transaction control, columns/default/nullability/index keys/predicates/order/NULL behavior, function return/body/actor/tenant/security/grants and view dependencies. Keep source semantics distinct from approved production behavior. No table/index extraction or empty no-op alone equals full source coverage; immutable SQL cannot be fixed in place.

Specifically verify87line global TGT DELETE (no company/is_active in partition; NULLwindow grouping versus uniqueNULL-distinct); payload preservation; all9index declarations/table/columnDDL. Verify280line16guarded updates,16relation/17index declarations, timecolumn guard gaps and preserved/coalesced customer IDs. Verify374line5backfills with differing metering overwrite,31indexes,14tablecatalogview, explicit DROPview/function169–170 before table-return replacement, role/override/count definer helpers with unbound supplied user/tenant,2EdielRPC filters. Do not repeat a return-type conflict solely from CREATE OR REPLACE when the complete source drops its known predecessor. Exact remaining dependents and caller contracts still need evaluation.

Trace only relevant actual app/lib callers and exact selected/bootstrap/whole-source authorities needed for the dependency map. Check current role helper codepaths found in lib/rbac/getUserPermissions.ts, app/dashboard/page.tsx, lib/tenant/scope.ts and contract-count caller lib/customer-contracts/db.ts. Identify last known selected/function winners/ACL boundary where provable from current code, distinguishing source-backed shape from unexecuted actual63 catalog. No fresh production queries. A missing exact predecessor (such as substituted debug_fix_batch_1b) must be justified by a named column/function/constraint statement; no speculative file-family expansion or whole inventory scan.

Deliver a minimal next-step admission/verification contract: which complete sources can plausibly form one group and in what dependency order; what explicit structural/security boundary would actually be needed; required independent before/after field/PK/catalog/index/sequence outcomes and meaningful native dirty/missing/duplicate/cross-tenant/FK/trigger cases. Reuse approved private owned lifecycle, existing catalog/oracle formats, known accepted prefixes and no original19/102 duplication. Avoid optional fixtures and extra boundaries. Do not author SQL, invent timestamps, declare a new selected count or claim runtime/full native/production closure. Any needed CLI boundary remains an ungenerated logical identity until later actual CLI artifact creation. Unknown exact native shapes/dependencies remain explicit blockers for implementation, not silently assumed.

Keep report concise and line-backed, with all741lines accounted in complete units and scoped caller evidence. Independent review follows. Validate pins/read coverage and document whitespace/references only; no docs-mirroring tests or unchanged suites. Commit only owned document, full ignored report exact verification/limitations/self-review, then return DONE/commit/one-line checks/concerns. The user requests efficient continuous completion; no optional audit expansion or confirmation pause.

2026-09-11 Task18 implementation28597803b7160c38c631aa1834462ae0b6520f53
independently spec-compliant and quality APPROVED, no findings. Complete4141-line
review plus named unchanged callees checked. Targeted constructors, provenance,
accounting, immutable source/first57/suffix/19tuple preservation and syntax PASS.
Actual P/X CLI identities and four whole originals registered:598=544/23/27/4,
50unresolved; focused344=301/20/19/4,39unresolved; foundation104/endpoint63.
Status IMPLEMENTED_NOT_VERIFIED: publish coherent batch, then require hosted
actual63 SQL/cleanup/death/privacy and same-head original19/full102/quality/Ediel.
No source acceptance, full-native/types closure or production mutation claimed.

Task18 fix2 contract correction required (no implementation yet): immutable first
input01_db1_schema_repair_core_helpers_and_canonical_tables.sql:513–515 inserts
an initial public.companies row. Task16's empty-companies/one-new-company
assumption conflicts with the actual accepted prefix; runtime correctly rejects
EMPTY_FIXED_BUSINESS_REQUIRED. User explicitly requests correcting the entire
plan and broken points, authorizing this factual contract correction without
renewed permission. No blanket seed exemption, deletion/recreation or second
company is approved. Author prepares exact source-bound sole-company reuse/PK/
P-materialization/S1/cleanup preservation amendment for independent review.
Private artifact cause remains separately under source-backed diagnosis.

Task19 bounded source-effects document COMPLETE: ccd5cefd independently spec/
quality APPROVED (741 complete source lines,57 index declarations, named caller/
dependency contract). No Critical/Important findings. Two Minor wording points
addressed in5a59f483: transaction row/catalog rollback vs nontransactional
sequence disposal; conditional absence across57 index declaration identities.
Root inspected exact two-line correction; no new test/review loop required.
Actual63/native catalog/ownership/security decisions remain explicit later
implementation gates. No source registration or production acceptance claimed.

Task18 fix2 factual amendment independently APPROVED with no findings. Exact
requirements in ignored task-18-fix2-contract.md and its review; tracked Task16
contract will be reconciled by the sole fix author. Preserve original C_seed PK
and exact independent S0; derive S1 with only P column effects including industry
materialization; guarded temporary slug reservation +3Auth/1fixed-company; use
B0's exact slug OR hyphen-stripped organization predicate; independently bind
company restoration, delete only generated graph, exact final S1 includinglog_cnt.
Intercept only actual synchronous trusted run_files result sink, bound bytes/
writer/handle/files/phase/reference/staging, finally cleared; no disk exception.
Author implements from5a59f483; originalSQL/19/102/pins/order retained except
reviewed authored-X content/pin if needed. Independent code review and native
acceptance remain mandatory. User authorization covers factual plan correction.

# Task20 — actual CLI skeletons for the reviewed alignment boundaries

This is a mechanical workflow-only preparation task following approved Task19 source-effects map. No source selection or SQL/production acceptance is implied. Read quality/audits/USER_RBAC_CUSTOMER_ALIGNMENT_SOURCE_EFFECTS_2026-09-11.md only dependency-order/boundaries section and this plan's task-19-review.md as context. Task18 runtime/native proof remains separate and must be accepted before alignment execution.

Own ONLY .github/workflows/ops-hardening.yml plus ignored task-20-report.md. Root supplies exact BASE after the sole Task18 author commits. Preserve all existing jobs, required original19/102 and new continuation proof unchanged. Add one temporary, bounded pinned Supabase CLI2.101.0 job that runs actual help/version and migration new commands for canonical_user_rbac_customer_alignment_prerequisites and canonical_user_rbac_customer_alignment_boundary. Reuse the exact independently reviewed Task17 two-empty-skeleton pattern available in git show e2bb1a9b:.github/workflows/ops-hardening.yml; do not invent timestamps or assume success. Generate in isolated temporary directory, sleep1 between actual CLI calls, assert exactly two distinct14digit versions, regular nonsymlink zero-byte files with intended suffixes. Upload only these two verified empty files under artifact user-rbac-customer-alignment-skeletons. All CLI/generation/upload steps must skip if either authored suffix already exists in repository migrations, including fallback always/upload behavior; checkout and guard first. Never upload authored SQL or secrets. No app deploy, DB connection, migration apply, provider/customer/credential action, package-probe/localCLI install or source-copy artifact.

Use minimal workflow timeout, existing checkout/setup pin conventions and exact same reviewed CLI behavior. No changes to replay modes, source manifests, selectors, migration files, types/fingerprints or memory. Root will download/verify actual artifact and identities before any future P/W authoring. These logical boundaries remain unselected and unimplemented.

Validate only workflow syntax/guard/artifact-path coverage, preserved existing jobs and whitespace. No unchanged suites or mocked CLI success, no broad audit. Commit sole workflow, full ignored report with exact local static commands/output and hosted-not-executed limitation. Independent scoped spec/quality review follows; no publish by author.

Task18 fix2 implementation3a16b0f8cb6acf5eedb0572bad3c82faa239cb27 complete
from5a59f483; independent exact100162-byte scoped review active. Approved factual
amendment reconciled into Task16 contract. Real writer RED/GREEN, full independent
seed/generated binding/P materialization/B0 predicate/X reservation/capture/failure
controls, existing adapter and affected H2/repair constructors PASS. Complete
oracles/original102/19/order/P/history preserved. X actualidentity unchanged,
107lines SHA256f6fbfd30b62e9529539c27c00722c89446e6ed5dd7cbed9217594f7202025ee7;
runtime/history pin agree. Foundation104/endpoint63 and598=544/23/27/4 unchanged.
Native SQL/cleanup/death/finalprivacy acceptance still pending. Task20 sole
workflow author now prepares two actual empty CLI alignment skeletons; no
production or source-selection change. One coherent publication after reviews.

Task18 fix2 code3a16b0f8 independently spec-compliant/quality APPROVED, no
findings. Complete1121-line/100162-byte diff and named reference/cleanup/writer
callees checked. Source-bound independent seed, three enumerated generated
bindings, exact B0 predicate, original-PK company restoration, real writer/result
memory path and final disposal/privacy contracts approved. No tests rerun by
reviewer. Native actual63 remains mandatory; ready for coherent publication
with separately reviewed Task19 document and Task20 CLI-only workflow.

Task20 COMPLETE actual CLI artifact at54ae6759 OPS34595483635/job103250143578.
Artifact10261507270 ZIP484bytes SHA256
7d1841830464e313509f55021ec23d91151b7e5bae02a94e67d98ce4db7a89f4 verified
against server digest. Exactly two regular nonsymlink empty members, each SHA
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855:
20260911114442_canonical_user_rbac_customer_alignment_prerequisites.sql
20260911114443_canonical_user_rbac_customer_alignment_boundary.sql.
Actual source files retained ignored with task-20-artifact-receipt.json; no SQL
or source selection. Author fix3 will remove temporary job to avoid regeneration.

Task18 54ae6759 new native continuation103250143594: standalone six whole inputs/
restoration/disposal/canary/finalprivacy PASS. Actual staged shell reaches
actual_replay_foundation63/bounded success, then test's stale-handle assertion
wrongly calls patched observation wrapper, which asserts empty submissions and
H2_COMPLETE despite SUCCEEDED/six inputs. This is a proof-wrapper defect;
original trusted stale-handle denial must be exercised. Fix3 sole author active,
no runtime/SQL/privacy changes required. All remaining native fault modes pending.

# Task21 — resolve bounded alignment ownership/runtime contracts

Read first this brief, approved quality/audits/USER_RBAC_CUSTOMER_ALIGNMENT_SOURCE_EFFECTS_2026-09-11.md, task-19-review.md and ignored alignment-ownership-preparation.md. Root preparation is current-code evidence, not independent approval; verify named claims. Task18 fix3/proof remains independent, and actual63 full acceptance is still pending.

INITIAL PHASE READ-ONLY: write only ignored task-21-draft.md and task-21-report.md. No tracked edits/index/commit/SQL/tests/CLI/probes/network/live data/provider/customer/credential action. Root later authorizes one tracked design document quality/audits/USER_RBAC_ALIGNMENT_RUNTIME_OWNERSHIP_2026-09-11.md after publication boundary. Don't reread741 source lines already reviewed or broad inventories. Work only four concrete Task19 unresolved interfaces, with named caller/guard/source authority needed to make their intended behavior precise.

1. TGT dynamic imported data: exact store four exports and callers in actions.part-1/2, tgtAutopilot and downstream action paths named in preparation. Verify tenant-authorized write actions drop company context, and scoped source-message references enter otherwise global raw_text. Resolve minimum tenant-owned imported-data versus immutable shared static definitions boundary. Propose exact company/actor/PK/unique/read/write API rules and source-backed ownership convergence. Do not infer historical NULL company from creator's current membership, guess a company, delete/de-duplicate tenant data, or declare arbitrary legacy rows shared. Ambiguous ownership must remain fail-closed pending authoritative evidence; preserve every original row/PK. This is the explicit project tenant-invariant application, not permission to silently disable a user flow. Identify exact data-proof and UX decisions still needed.

2. Ediel message-rule registry: current platform-only rule UI and guarded save/template actions vs company-filtered read projection and company column/backfills. Determine intended globally governed protocol rules versus real tenant overrides from current source/callers/target-architecture authority. Verify all actual writes (including helper call guards) and canonical Edifact bypass. Choose the minimal justified final RPC/ACL/global-or-tenant scope contract; do not create tenant overrides merely from a legacy company_id column or label all actual rows global solely from a UI heading. No live row classification or destructive migration proposal without evidence.

3. Role RPC and tenant service scope: current lib/tenant/scope.ts63–84 derives global privilege from gridex_get_user_roles output, while current lib/admin/guards.ts uses authoritative canonical_authenticated_tenant_context flag. Determine reuse of existing exact SQL/global-role authority or smallest safe interface separation. Preserve dashboard/self-role and platform-admin target-inspection contracts; company-scoped platform-looking roles must never confer global access. Read only exact role authority definitions/callers required, distinguish accepted-prefix shape from later source/live uncertainty. Do not re-report old already-fixed admin guard inference as current.

4. Dormant count helper: no app/lib caller found for getLatestContractBucketCounts. Verify reachability by exactsymbol only, make minimal complete handling of explicit all+partition rows/duplicate none/unknown statuses and tenant/ACL contract precise. No optional product redesign, new public endpoint or source mutation. Historical C body remains whole immutable characterization authority, forward/runtime corrections separate.

Deliver concise line-backed decisions, proved findings vs unresolved assumptions, exact minimal implementation file/DB boundaries, and meaningful synthetic two-company/actor/role/collision/rollback/privacy validation needed. Reuse approved Task19 P20260911114442/W20260911114443 actual empty CLI identities only if a future boundary needs them; no invented timestamps/source counts/selection. Do not edit Task18 or expand current runtime fixer. No original19/102 re-audits, docs-mirroring tests or production reads. Independent review follows before any implementation. Report source paths/ranges, limitations, static document whitespace/reference checks only; return ignored draft/report ready.
