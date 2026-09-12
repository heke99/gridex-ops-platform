# Task11c implementation report

Status: IMPLEMENTED_NOT_VERIFIED — source/constructor checks passed; independent review, owned PG17 and supported Node22 application gates are pending. Frozen for root review after this report.

Base: `771e97a28205fd763cd08b99029ef63561fd9215`. Scope: sole actor-bound platform permission diagnostic, exact Task11c brief and canonical diagnostic contract. No delegation, production/external SQL, provider actions, dependency installation, generated types, migrations registration, workflow changes, index/history/commit/push, or root-memory edits.

## Skill routing and source authority

Applied repository test-driven-development (including writing-good-tests), verification-before-completion, Supabase and Postgres least-privilege guidance. Read operating contract, active memory/checkpoint, relevant decision/failure inventory, exact diagnostic contract and accepted algebra decisions; Task11a acceptance remains a prerequisite rather than a new claim. `using-superpowers` explicitly exempts dispatched subagents. The root's active SDD plan supplies orchestration; no new brainstorming/planning/delegation or full quality-playbook audit was launched for this bounded implementation. Unrelated performance, broad static-analysis, supply-chain, repository/history and deployment skill groups are outside this task. Root owns independent review/publication.

Installed Next docs/node_modules are absent; project pins Next16.2.12. Consulted official [Next server/client boundary guidance](https://nextjs.org/docs/app/getting-started/server-and-client-components), [Supabase function privilege guidance](https://supabase.com/docs/guides/database/functions), and PostgreSQL17 [GRANT](https://www.postgresql.org/docs/17/sql-grant.html)/[REVOKE](https://www.postgresql.org/docs/17/sql-revoke.html). No new Next API or caching mechanism. PG17 membership `WITH INHERIT TRUE` is explicit because the owned bootstrap API roles are NOINHERIT by default; a default role grant would not test inherited privileges.

## Implementation and preservation

- Appended `canonical_get_platform_user_permission_diagnostic(uuid,uuid)` to both genuine, unregistered `20260912052507` candidate copies. It is STABLE/SECURITY DEFINER with fixed `public, auth, pg_temp` search path, rejects null IDs, invokes unchanged canonical platform actor admission before target existence, checks nondeleted `auth.users`, delegates only `gridex_get_user_permissions(uuid)`, rejects null/malformed canonical arrays, sorts the returned array, and returns target/scope/evaluated_at. Calculation exceptions propagate.
- New ACL clears every non-owner direct grantee (including inherited custom parents) with CASCADE before the sole explicit service grant. Existing private function ACL sweep and functions/writer casts remain byte-identical. No permission algebra or actor-predicate rewrite.
- Entire accepted candidate reconstructed by removing the appended diagnostic block still hashes `ac1a2b63476e1eb509b622adbfbab924f8c143c65bac3a046a739df7ea9d4536`. New candidate and both-copy hash is `73eb8a8d89b8468783d69f2829658daeb71d7deda667b5f54a9c5650cd6c47ad`. Only `forward_candidate.sha256` changed in the source manifest; source inventory/composition/selection are unchanged. Composition hash remains `c45021afb4b8e92415166d27ce4852d792bc190c1ac2adec3a37d3a03c1597ce`.
- Existing sole page now calls `getAdminUserById(current.userId, id)` after its real canonical guard. Loader invokes the service diagnostic before auth-admin or raw target-role/override reads; validates target, scope, permission elements/duplicates and a timezone-bearing evaluation timestamp; throws one generic Swedish unavailable error for RPC/transport/malformed data. RPC logging contains bounded code/message only, with no result/details logging. Raw role/override normalization is unchanged.
- Page uses `user.effectivePermissions`. Swedish label is “Behörigheter via minst en aktiv bolagskoppling eller plattformsbehörighet”. This describes shared eligible membership/platform semantics without claiming active company lifecycle or permission in every tenant; separate operation/lifecycle authorization is unchanged.
- Pre-edit `rg` inventory found exactly one application caller/import of `getUserPermissions`, this page, and one `getAdminUserById` caller. After migration the obsolete helper was deleted. Final `app`/`lib` inventory has no helper import/call (one historical explanatory comment in apiGuards remains). `ROLE_PERMISSION_PROFILES` remains only in role-configuration recommendations/catalog functions, not a user effective-permission fallback.

## Native cases authored, not executed

Original102 P28/C32/F16/S24/SX2 cases are unchanged, with a permanent exact aggregate digest assertion: `e9f942bb0d0b5a4cbeb6bb7a747574a2d7d73c6c39ac6e1135c348087db5d527`. Baseline10 cases remain unchanged. Added D27 yields129 candidate cases /1128 fixture assertions:

| Cases | Controls |
| --- | --- |
| D01–D04 | Exact sorted result, evaluation time and unchanged rows; valid empty; null actor/target |
| D05–D13 | Nonplatform actor against existing/missing/deleted targets; inactive/disabled/missing role assignment; disabled/missing profile; banned/deleted/missing actor |
| D14–D15 | Explicit P0002 missing/deleted target |
| D16–D17 | Company-A deny/B allow retained via B; global deny defeats local allow |
| D18–D21 | Transactional test-only canonical error/null-array/null-element/blank-element injection; SQL error propagation and unchanged rows |
| D22 | Existing C26 preserved: inactive platform role definition retains canonical actor authority while the target shared grants disappear |
| D23–D24 | Real anon/authenticated wrapper rejection and anon/authenticated/service direct internal-function rejection |
| D25–D27 | Canonical admin_users platform branch, inclusive validity boundary and inactive admin assignment |

ACL poison now grants a custom parent to API roles WITH INHERIT TRUE and asserts function execution is actually inherited before recovery; recovery also poisons wrapper PUBLIC/anon/authenticated grants. Post-candidate checks assert owner-private internal ACLs and effective privileges, wrapper explicit service-only grant, definer/STABLE/search_path and owner ability to execute the internal resolver. Existing first/repeat/recovery/catalog/row/transaction rollback/owned-cleanup orchestration is retained. These are authored native controls, not a native PASS receipt.

## Executed verification

| Command / check | Actual outcome |
| --- | --- |
| `python3 -B scripts/test-canonical-permission-native-admission.py` | PASS21 constructors |
| `python3 -B scripts/test-canonical-permission-native-fixture.py` | PASS10 constructors, including full accepted candidate prefix and original102 case preservation |
| `python3 -B scripts/test-canonical-permission-native-runner.py` | PASS11 constructors/orchestration simulations; not native SQL |
| `python3 -B scripts/canonical-permission-native-runner.py --check` | Construction PASS;129 candidate /10 baseline; native NOT_RUN; exact hashes above |
| `node --experimental-vm-modules quality/audits/proofs/permission-diagnostic-regression.mjs --source-ref=771e97a28205fd763cd08b99029ef63561fd9215` | RED0/13, exit1: no diagnostic results/error rejection in old actual loader |
| Same loader source probe without `--source-ref` | GREEN13/13, exit0: positive/empty/invalid/error cases with actor binding and pre-read order |
| `node --experimental-vm-modules quality/audits/proofs/permission-diagnostic-page-regression.mjs --source-ref=771e97a28205fd763cd08b99029ef63561fd9215` | RED2/7, exit1: five expected diagnostic failures; two existing guard controls pass |
| Same page source probe without `--source-ref` | GREEN7/7, exit0: actual page orchestration, real loader, guard and policy modules; only transport/runtime I/O substituted |
| Node24 stripTypeScriptTypes on changed loader and permanent test | Syntax PASS only |
| `git diff --check` | PASS |

Node24 probes emitted only VM Modules/type-stripping experimental warnings. The page source probe stops exactly at the JSX rendering boundary; it does not claim a rendered React/Next/browser result. The permanent `__tests__/permission-diagnostic.test.ts` has38 authored cases using real page, loader, guard, catalog and imported actions with only transport/request/runtime mocks. It covers rendered element-tree counts/Swedish scope label, malformed and error responses, actor binding/order and authoritative page admission. No replacement policy/resolver mocks.

## Pending gates / concrete limits

- New native SQL: NOT_RUN. Docker/psql/Supabase CLI are absent locally; no absent-tool retries or SQL against an external target. Root must run unchanged hosted owned PG17 lane and accept all129 cases plus repeat/ACL recovery/catalog/row preservation/cleanup.
- Supported Node22 Vitest38 cases, lint, application/test typecheck and build: NOT_RUN. Dependencies/installed Next docs are absent and disk is full; no npm install. Root must accept the quality lane, including this new real-import suite. Local type stripping is not a supported compiler/typecheck or TSX render.
- Full replay/generated-types/native parity remains unestablished. This task does not change those boundaries or Task14's closed acceptance.
- Both generated-migrations receipt copy and this SDD report are ignored support artifacts in the worktree; root controls any publication. Existing root memory/master-state and unrelated RLS/Task14 receipt dirty files were preserved.

## Exact owned files

The report itself is the task deliverable; its SHA is sent to root separately to avoid a self-referential hash. Other written files:

| File | SHA256 |
| --- | --- |
| `app/admin/users/[id]/page.tsx` | `43189fa3a474b1978d7b200b7f9dd44db20c6a7f05cdf6b438bf6f2f0450aed9` |
| `lib/rbac/getAdminUserById.ts` | `51ef2a2e27dbb662ac04393c664f22fa5e24e736a191a1a458f1add25940121c` |
| `__tests__/permission-diagnostic.test.ts` | `e5e3f37c931753a0e356053f830149b1c5e7de80cd71035ef534f091c971b57c` |
| `quality/audits/proofs/permission-diagnostic-regression.mjs` | `01c95456c96140d88f6a7b96e6bc9f1619bf144c37597615c44a6e6a37675599` |
| `quality/audits/proofs/permission-diagnostic-page-regression.mjs` | `8237973d1fee8b89538a34f973838e2b1f91d2b369628816f2901b96de0fd372` |
| `scripts/canonical-permission-native-fixture.py` | `47425b626551df891f6b13c86390ac9b23239cbe26a3651558572778eceab3a8` |
| `scripts/canonical-permission-native-runner.py` | `60c81318d4a50d49570ab53784077ff078178fe6a54e21a6b180645d7dfd4a9b` |
| `scripts/test-canonical-permission-native-fixture.py` | `f4b2c7233bf2b4044aa92fa164123707b89193f185eba39ed04c76dc90da9b44` |
| `scripts/test-canonical-permission-native-runner.py` | `05f078c3a8008aec93357c18fca4b4fff5bd8bf45b638012550e2a3b5b763dee` |
| `scripts/sql/canonical-permission-native-sources.json` | `0429173e51ec878555f7bcb79c41f26b0ff92247eb009e43988c819c3097c670` |
| `scripts/sql/forward-candidates/20260912052507_canonical_permission_overrides_and_storage_write_guards.sql` | `73eb8a8d89b8468783d69f2829658daeb71d7deda667b5f54a9c5650cd6c47ad` |
| `.superpowers/sdd/2026-09-12-current-and-plan77-85/generated-migrations/20260912052507_canonical_permission_overrides_and_storage_write_guards.sql` | `73eb8a8d89b8468783d69f2829658daeb71d7deda667b5f54a9c5650cd6c47ad` |

Deleted owned file: `lib/rbac/getUserPermissions.ts` (187-line parallel diagnostic). No other file is owned by this implementation.
