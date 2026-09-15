# Task 14 fix round 1 — integrated company-authority evidence

Date: 2026-09-12
Base: `d6d15df9683fe12e78e712fc610919dee9bc1b37`
Scope: review I1 actual-policy-chain evidence and M1 unused import only

## Review response

- I1 is addressed by `__tests__/server-action-company-authority-integrated.test.ts` and the distinct source probe `task-14-fix1-integrated-probe.mjs`. They execute the real `requireAdminActionAccess`, `requireCompanyScopedActionAccess`, `listOperationalCompaniesForUser`, `assertUserCanOperateCompany`, `assertCompanyAccessForGuard`, lifecycle predicates, governance check, Ediel form parsers, and all nine changed action entries.
- The integrated tests do not mock `@/lib/admin/guards`, `@/lib/tenant/scope`, `@/lib/tenant/entityGuards`, or `@/lib/tenant/governance`. Mocks stop at request auth/canonical RPC, cookies/cache, database/service-client I/O, audit, and terminal domain mutation/provider boundaries. Other mocks allow the large action modules to load without running unrelated flows.
- M1 is addressed by removing the now-unused `getActorUserId` import from `profile-actions.part-2.ts`.
- No new production defect was found. The one test adjustment during GREEN work accepted the real guard's existing `Forbidden` permission-denial message.
- The original focused wiring test and original 67-case probe remain unchanged as historical evidence. They are useful for first-boundary wiring, but they mock policy helpers and therefore do not establish the integrated policy result.

## Integrated matrix

The supported Vitest equivalent defines 110 tests: 11 nine-action matrices, one eight-action loaded-row matrix, and three focused integrated cases. The source probe records 111 observations because the shared helper's foreign and same-company outcomes are counted separately.

Coverage includes:

- selected A to target B and reverse B to A with active memberships;
- both companies granting all relevant permission keys while selection and target differ;
- no cookie with canonical RPC company A and membership results ordered B then A;
- same-company positive controls and authoritative platform cross-company controls;
- ordinary paused canonical company and missing active membership;
- platform access to a paused target company;
- missing canonical company and missing loaded/submitted ownership;
- the shared entity helper's direct foreign and same-company results;
- actual action permission denials and Ediel's exact three-key `allOf` requirement.

Every denial asserts no terminal domain effect and no database mutation. Positive controls deliberately stop at one mocked terminal effect, proving the policy chain was traversed.

## RED / GREEN evidence

The base source fixture was created under `/tmp/task14-fix1-base-source` by writing `git show d6d15df9683fe12e78e712fc610919dee9bc1b37:<path>` for the actual role-key, lifecycle, access-model, scope, admin-guard, entity-guard, governance, CIS, profile part 1, profile part 2, Ediel part 1, and Ediel part 4 sources read by the probe.

- RED command: `TASK14_SOURCE_ROOT=/tmp/task14-fix1-base-source node --experimental-strip-types .superpowers/sdd/2026-09-12-current-and-plan77-85/task-14-fix1-integrated-probe.mjs`
  - Exit 1; 64/111 passed and 47/111 failed.
  - Failures were the four nine-action mismatch matrices (A to B, reverse, both grants, and no cookie), nine missing loaded/submitted ownership cases, and both shared-helper observations. Vulnerable actions reached terminal domain/mutation/provider boundaries.
- GREEN command: `node --experimental-strip-types .superpowers/sdd/2026-09-12-current-and-plan77-85/task-14-fix1-integrated-probe.mjs`
  - Exit 0; 111/111 passed, 0 failed.

## Other local checks

- `node --experimental-strip-types --check __tests__/server-action-company-authority-integrated.test.ts && node --experimental-strip-types --check .superpowers/sdd/2026-09-12-current-and-plan77-85/task-14-fix1-integrated-probe.mjs && node --experimental-strip-types --check app/admin/customers/'[id]'/profile-actions.part-2.ts` — exit 0.
- `node scripts/security-audit-rbac.mjs` — exit 0; 24 checks, 0 warnings.
- `if rg -n "vi\\.mock\\(['\"]@/lib/(admin/guards|tenant/(scope|governance|entityGuards))" __tests__/server-action-company-authority-integrated.test.ts; then exit 1; else echo 'named policy modules are not mocked'; fi` — exit 0.
- `if rg -n "formString:|parseEdielTestSuite:|parseEdielTestRoleCode:" __tests__/server-action-company-authority-integrated.test.ts; then exit 1; else echo 'Ediel form parsers are not replaced'; fi` — exit 0.
- `git diff --check` — exit 0.
- Supported Node 22 Vitest, test typecheck, lint, and production build: **NOT_RUN** for this fix round. Local dependencies remain incomplete under the recorded disk constraint; installation is prohibited. The prior supported gate predates this integrated test and does not validate it. Root's hosted supported gate remains required before acceptance.
- Native PGlite/SQL checks: not run because this application-only fix has no SQL, migration, Storage, trigger, or generated-type change.

## Exact frozen file hashes

Fix-round files:

- `app/admin/customers/[id]/profile-actions.part-2.ts` — `b436b32299125a80c1520e289a8ed2a2cf436c71a1875a0fb759bf8ab9e0a0f8`
- `__tests__/server-action-company-authority-integrated.test.ts` — `7d94b1f98b478db78cfe86d3c22dc7c9eded4b1d7c5aec47752a87cd374d8069`
- `.superpowers/sdd/2026-09-12-current-and-plan77-85/task-14-fix1-integrated-probe.mjs` — `e0b835929fb920b2e63dc69ec37923e167b61ec9827d7ad4a513264e2569cc87`

Retained Task 14 implementation and focused evidence at current hashes:

- `app/admin/cis/actions.ts` — `f14e58726a102624f0c29f41e03588a4b52b77fe125dc04d6564cc935ecfa186`
- `app/admin/customers/[id]/profile-actions.part-1.ts` — `5c4d8b66b56ecaca7ce3126edfe7c2555b3cc8f78f5fb1e0edb88b2421372887`
- `app/admin/ediel/actions.part-4.ts` — `cfeae8fa2e58acb54cd660e50f84b30ab94b1a4a1280fa7f776f1586c97aef88`
- `lib/tenant/entityGuards.ts` — `d8ef8bb0feeb210e26f00f9066b508b605d7e570158b14b52a21c239a582c17e`
- `__tests__/server-action-company-authority.test.ts` — `235e4a93b19d43a8f9ab7fee7c56865fdadd8bfeb2b5399f848287f5239e8572`
- `__tests__/tenant-entity-canonical-company.test.ts` — `de4922735a4fcb2758256db2ed960c5b7d58df9417234e33e6242b13ff35db52`
- `.superpowers/sdd/2026-09-12-current-and-plan77-85/task-14-company-authority-probe.mjs` — `32066f393c4e1b4c46aeeeb67a067bddf580cb6edbeb73c8f19aaff121b149f1`
- `.superpowers/sdd/2026-09-12-current-and-plan77-85/task-14-report.md` — `a44311b806e030821ee62f15883e504d5267aa01f10b030fde511eb2c0f78c35`

The hash of this fix report is recorded in the author handoff because including its own digest would change the file.

## Boundaries and residuals

- These application tests validate ordering and authority through the first DB/domain/provider boundary. They do not establish native RLS, service-role database isolation, Storage policy behavior, provider completion, browser transport, or production data behavior.
- Root's existing Supabase source/RLS/privacy preflight remains relevant to the service-role paths even though this round changes no database artifact.
- Lifecycle, archived-customer, confirmation, best-effort archive, platform-authority, and downstream ownership behavior remains unchanged by this fix round.
- No dependency, SQL, migration, workflow, generated type, memory, index, commit, provider, or unrelated dirty-file mutation was made.
