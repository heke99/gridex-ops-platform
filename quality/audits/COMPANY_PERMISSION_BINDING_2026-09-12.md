# Task 5 — Bind permissions and writability to the operated company

Date: 2026-09-12. Application baseline: `41786027`; worktree initially at replay-only `3f8be706`. Root subsequently published the unrelated request-body batch as `604b2e17`. This lane did not modify that batch.

Status: application fix implemented and locally verified with actual-source synthetic I/O; independent review and hosted Node 22 Vitest/typecheck gates pending. This is a bounded PERM-01 remediation, not closure of masterplan points 77/78/83 or acceptance of native database, override, storage or RLS behavior.

## Scope and skill routing

Read the exact task brief, confirmed permissions audit, original executable reproduction, global plan constraints, AGENTS, memory read-order files and authentication/database memory; searched decisions and known failures. Existing source, the confirmed source-to-service-write reproduction, and newly executed tests are the evidence authority. Memory/workflow/publication remain root-owned.

Applied repository systematic-debugging (trace the permission company and target), test-driven-development (actual-source RED before each implementation change), executing-plans (Task 5's approved bounded plan), and verification-before-completion. `using-superpowers` was inspected and its dispatched-subagent exemption applies. Consumer/variant analysis and false-positive verification were performed directly. No new agents were spawned. No new worktree was needed: root supplied the isolated recovery worktree. No architecture ambiguity requiring brainstorming, UI/design change, performance optimization, dependency installation, hook installation, reusable skill writing, migration authoring, production interaction, commit or push occurred. Root owns broader security-scanner and independent review gates; this report does not claim that those scanners ran in this lane.

## Confirmed findings and implemented changes

### PERM-01: explicit helper could use A permissions for B (High)

The canonical authenticated RPC already returns `GuardResult.companyId`, the company for which effective permissions were computed. The old explicit page/action helpers evaluated the requirement from this context, then accepted any appropriate membership in the submitted target. With differing company role grants, selecting A with `integrations.write` could authorize a webhook mutation in B whose permissions did not include that grant. The B-selected control denied the identical operation. The original audit executed this complete path; fresh regression reproduces it against the pinned baseline.

`lib/admin/guards.ts` now rejects ordinary explicit page/action targets unless a nonempty `base.companyId` equals the submitted company. It uses the canonical **returned** company, not the untrusted cookie. The page guard redirects using its existing denial convention; the action guard throws an instruction to select the target company first. The permission requirement, canonical RPC, request cache, membership role sets, and returned context are otherwise preserved. There is no target fallback, permission union, role-name privilege escalation, or new service-role authorization query.

### PERM-01 lifecycle companion: any writable membership enabled generic actions

The old generic action guard used `memberships.some(writable)` without binding the membership to `base.companyId`. A selected paused B could therefore pass if A was active. `requireAdminActionAccess` now requires a nonempty bound company and a writable membership whose `companyId` equals `base.companyId`. The existing active/onboarding policy and error remain unchanged.

### Confirmed company-user caller variant (bounded application authorization defect)

The consumer audit found `app/admin/companies/actions.ts::assertCanManageCompanyUsers(companyId)` implementing a separate generic-guard + target-membership check. Its three consumers are `inviteCompanyUserAction`, `removeUserFromCompanyAction`, and `setCompanyUserRoleAction`. They receive the target from form data, call this shared helper, then respectively provision an invitation, remove access through `deactivateCompanyUserAccess`, or grant access through `grantCompanyUserAccess`.

Root authorized this narrow expansion after the full path was reported. The helper now calls `requireCompanyScopedActionAccess(companyId, { anyOf: ['tenants.invite', 'users.write'] })`. Its additional original `owner/admin/company_admin` membership restriction remains intact; the broader aliases allowed by the shared guard do not newly gain user-management access. Platform short-circuit behavior remains intact.

Fresh RED/GREEN executes the actual remove-user action and actual `lib/auth/companyUserAccess.ts::deactivateCompanyUserAccess`/`readActiveMembership` functions, with only framework/auth/membership/service I/O replaced. Before the caller change, A's `users.write` permitted a B removal and reached the fake `canonical_change_tenant_user_access` RPC; afterward the action returns `ok:false` without any service RPC or mutation. The reverse A/B pair and allowed same-company RPC are covered.

SQL caveat: this is not evidence of bypassing the native access command. The original `20260802014000` command enforces target membership, owner/admin preservation, lifecycle and related constraints. The `20260802170000` wrapper separately checks `canonical_actor_is_authorized(target, actor, 'tenant.user.manage', false)` and request/idempotency identity; the `20260802203000` wrapper enforces canonical role mapping. The latest source `canonical_actor_is_authorized` in `20260810190410` checks target-company role permissions. The application permission keys (`users.write`/`tenants.invite`) and that SQL permission key differ. The fix ensures the application does not send a target command under another company's application permission; it neither changes nor claims native SQL acceptance. No SQL source was edited or executed.

## Behavior preserved or tightened

| Context | Result after change |
|---|---|
| Selected A, A grant, writable A membership, target A | Page/action allowed; webhook update and audit retain A |
| Selected A, A grant, membership B, target B | Ordinary page/action denied before target service access |
| Same case with A/B reversed | Same denial; no hardcoded company assumption |
| Both A/B have the grant but A selected and B submitted | Denied until deliberate selection of B |
| Canonical resolver returns A while cookie says B | Target B denied; target A evaluated with returned A context |
| No cookie, canonical resolver returns A | Valid A operation preserved |
| Canonical company null/empty, or no selected-company membership | Ordinary action denied; explicit page denied |
| Selected B paused/suspended/archived/closed/null-status with active A | Generic and explicit B actions denied |
| Selected A active/onboarding while B paused | A action allowed |
| Selected A paused and page read allowed by existing roles | Read preserved; write denied |
| Viewer/null membership role | Explicit action denied |
| Global authoritative platform flag true, including no selected company or memberships | Existing cross-company page/action authority preserved |
| Platform-looking company role but authoritative platform flag false | No cross-company bypass |
| Company-user helper narrower membership roles | Owner/admin/company_admin still allowed; tenant_admin/company_owner/viewer still denied |

`listOperationalCompaniesForUser` is the existing active-membership query, with visible-company filtering. The tests also feed excluded/inactive status values directly into the guard double to prove it cannot mistake them for writable status. They do not assert the database query or SQL lifecycle behavior was executed.

## Consumer audit and scope boundaries

Complete direct helper-use inventory is retained in `task-5-consumers.json`, generated by scanning application/library TypeScript function calls, excluding test code and the guard definitions. At final candidate: generic action guard has 105 direct calls across 35 files; explicit action helper has 11 calls across 7 files; explicit page helper has no external source callers. Two additional files (`ediel/agt/actions.ts`, `platform/actor-testing/actions.ts`) only reference/import the generic helper type/symbol and have no direct runtime calls. These lexical counts are an inventory, not a coverage or authorization certificate.

All explicit-helper consumer entry points and their permission/target forwarding were checked before the company-user expansion:

| Caller | Target and relevant downstream path | Effect |
|---|---|---|
| `app/admin/webhooks/actions.ts` (3 calls) | Submitted company; test event/queue/audit, resend update/audit, ignored delivery update/audit | New target binding precedes side effects; ignored-delivery path executed with fake DB |
| `app/admin/website-applications/actions.ts` (shared `authorizeForCompany`) | Loaded application company; review/energy/facility/grid-owner/repair/continuation actions forward that company | Ordinary helper now binds the loaded application's company; its existing separate platform short-circuit remains |
| `app/admin/company-settings/actions.ts` (shared `assertCanManageCompany`) | Form company; settings/legal update and responsible-user membership/access update | Both callers now require matching permission company |
| `app/admin/customers/duplicates/actions.ts` | Loaded primary customer's company; source customers must share company before merge | Target mismatch now stops before merge; existing same-tenant source check retained |
| `app/admin/customers/actions.part-3.ts` (3 calls) | Loaded import row company; create/link/reject row, graph and audit | Target bound before action writes; existing operational checks unchanged |
| `app/admin/billing/import/actions.ts` | Separately resolved operational company, then explicit helper, then batch/underlay/row writes | Resolver disagreement now fails closed at explicit guard |
| `app/admin/companies/actions.ts` (new scoped call) | Shared helper for invite/remove/role change, submitted company | Explicit target binding added, stricter local membership roles retained |

Generic caller impact was inventoried across all 35 direct-caller files. The changed generic helper has no target argument: the only new promise it makes is that **its own permission company** is writable. No caller may infer that it has authorized another submitted or loaded company. Existing callers group as follows:

- Billing, pricing, controltower, customer-cases and automation actions obtain operational scope separately; they receive the corrected selected-company writable gate. Billing import additionally uses the corrected explicit guard.
- Customer actions and entity-based actions include returned-guard/entity helpers, separately resolved operational scope, and business helpers using authenticated clients or service wrappers. Their downstream graph/RLS ownership remains independently required; this batch does not certify all customer operations from the common guard test.
- CIS and EDIEL include explicit/loaded targets passed to membership/lifecycle-only helpers. These are follow-up candidates described below, not silently covered by the generic guard change.
- `lib/contracts/permissions.ts` and `lib/ediel/actionAccess.ts` wrap the generic guard. Their existing role/permission rules are unchanged. The latter's read-named wrapper already called the writable action guard; this patch does not introduce a new read-only exception.
- Import-only generic-helper references do not acquire runtime behavior changes.

## Open follow-ups and false-positive boundaries

1. **Internal API explicit-company variant**: root independently traced `app/api/internal/invoice-exports/create/route.ts` → `requireAdminApiAccess` using cookie permissions → body company → `assertUserCanOperateCompany` membership/lifecycle check → `prepareInvoiceDraftsForReview` service writes. This patch does not change API guards, request bodies or invoice authorization. Root owns continued exact downstream review and a separate fix.
2. **Entity context re-resolution**: `lib/tenant/entityGuards.ts::TenantGuard` omits `companyId`; `assertCompanyAccessForGuard` compares loaded target against a fresh `requireOperationalCompanyId(userId)`. The latter and the canonical RPC share the cookie but have distinct default/fallback selection rules. Guard-company loss is a real contract concern; a concrete fallback disagreement/service-write fixture is still needed before calling every downstream consumer exploitable. Preserve and pass the existing guard's `companyId` in a separately reviewed change.
3. **Other membership-only explicit targets**: `app/admin/ediel/actions.part-4.ts::createEdielPortalTestCustomerAction` checks generic A permissions then calls `assertUserCanOperateCompany` on submitted `companyId` before `createEdielPortalTestCustomerGraph`. `app/admin/cis/actions.ts::assertEntityCompanyAccess` obtains a row company, then checks membership/lifecycle, called after generic action permission checks. These exact source candidates need complete downstream/RPC review and targeted negative tests; they are not repaired by the current generic lifecycle change. Customer profile helpers also use `assertUserCanOperateCompany` for loaded companies and need the same bounded review.
4. **Role-name privilege variant**: `lib/contracts/permissions.ts::isContractSuperAdmin` independently uses role names. This is outside the changed authoritative platform guard; its complete contract consumers require separate analysis before classifying exploitability.
5. **PERM-02/03 and database invariants** remain separate forward-SQL/native/storage gates. No permission override semantics, RLS policy, tenantDb owner immutability, FK, grant, migration or schema claim is made here.

A fail-closed mismatch can reject stale forms/bookmarked targets until the user deliberately selects the target company. This is the explicitly approved behavior, not a permission fallback. Platform behavior remains as before; this batch does not newly waive downstream lifecycle rules for platform operations.

## Test implementation and verification

Permanent hosted test: `__tests__/admin-company-permission-binding.test.ts`. It imports the real guards, webhook action, all three company-user actions, and the real company-access wrapper; only I/O/framework integrations are mocked. It defines 36 parameterized cases, including denied-before-service checks on invite/remove/role change. It does not mock the permission requirement, role normalization, lifecycle pure functions, or guards themselves.

Supplemental executable: `task-5-guard-regression.mjs`. Node 24 `stripTypeScriptTypes` runs the full actual module function bodies with import I/O substituted. It executes real access-model, role-key and lifecycle pure functions; real guards; actual ignored-webhook action; actual remove-user action and actual deactivation wrapper. Fake DB captures target/update/audit/RPC payloads. Error objects use a common VM Error constructor to match ordinary module catch semantics. `--baseline` loads only the two changed production files from pinned `41786027` via `git show`, without changing the worktree. The original vulnerable-behavior `permissions-guard-repro.mjs` is retained unchanged as historical evidence and is intentionally not a green regression after remediation.

| Command / step | Fresh outcome | Boundary |
|---|---|---|
| Initial actual-source regression before guard edit | RED: 10/22 passed, 12 authorization failures | Wrong-company acceptance, selected lifecycle and null/missing membership failures; controls passed |
| Same 22 cases after guard edit | GREEN: 22/22 | Guard-only fix |
| Expanded actual remove-user tests before caller edit | RED: 29/31, two wrong-target removal/RPC failures | Confirms caller bypass remains after shared guard fix |
| Same 31 after company-user helper edit | GREEN: 31/31 | Confirms narrow caller fix and role/platform controls |
| `node .superpowers/sdd/2026-09-12-current-and-plan77-85/task-5-guard-regression.mjs --baseline` | Expected RED, exit 1: 18/35 passed, 17 authorization failures | Full pinned baseline contrast, including independent page negatives and explicit selection/default controls |
| `node .superpowers/sdd/2026-09-12-current-and-plan77-85/task-5-guard-regression.mjs` | GREEN, exit 0: 35/35 | Final real-source synthetic matrix |
| Node `stripTypeScriptTypes` on all three changed TypeScript files | PASS | Syntax only; not module integration or typecheck |
| `node scripts/security-audit-rbac.mjs` | PASS: 24 checks, 0 warnings | Existing static/source audit; not runtime RBAC proof |
| `node scripts/check-service-role-tenant-ratchet.cjs` | PASS: 2399 vs baseline 2402 | Baseline unchanged; aggregate source count only |
| `git diff --check` | PASS | Includes current shared worktree diff |
| Hosted Vitest / typecheck | NOT RUN here | `node_modules` absent following root's ENOSPC install; no retry/install attempted |
| Native PostgreSQL/RLS/storage/real React request cache | NOT RUN | No production, DB, network or external mutation |

Required hosted follow-up commands (root-owned Node 22 dependency environment):

```sh
npx vitest run __tests__/admin-company-permission-binding.test.ts __tests__/tenant-context.test.ts __tests__/tenant-isolation-remediation.test.ts __tests__/tenant-rls-lifecycle-hardening.test.ts __tests__/tenant-scope-request-cache.test.ts
npm run typecheck
npm run typecheck:tests
```

The broader existing tests have the boundaries documented in the original permissions audit. Passing them does not substitute for native two-tenant permission/CRUD/storage/override evidence. The synthetic request-cache replacement is identity (`cache(fn) => fn`): no claim of real request isolation/cache correctness.

## Files owned by this lane

Publishable production/test changes:

- `lib/admin/guards.ts`
- `app/admin/companies/actions.ts`
- `__tests__/admin-company-permission-binding.test.ts`

Task audit evidence (SDD, ignored by normal Git tracking):

- `task-5-report.md`
- `task-5-guard-regression.mjs`
- `task-5-consumers.json`

No memory/workflow files, source migrations, immutable manifests, API request-body implementation, schema/generated types, replay/controller code or other agents' edits were changed. No commit, push, database mutation, invitation, email or real webhook was performed. Next action: independent reviewer inspects these exact changes; root runs/publishes the reviewed hosted gate and proceeds with separately evidenced permission variants.

Independent Task5 spec and quality review: APPROVED, no findings (2026-09-12). Hosted verification remains pending.
