# Task 14 — Remaining server-action company authority

Date: 2026-09-12
Base: `d6d15df9683fe12e78e712fc610919dee9bc1b37`
Status: `IMPLEMENTED_NOT_HOSTED_VERIFIED`; frozen for independent review

## Scope and routing

This bounded implementation follows `task-14-brief.md`, the Global Constraints in
`quality/plans/2026-09-12-current-and-plan77-85.md`, and the complete actual-source
analysis in `quality/audits/PERMISSION_APPLICATION_VARIANTS_2026-09-12.md`.

Activated skills:

- `using-superpowers`: repository-required skill routing.
- `spec-to-code-compliance`: the task brief is the exact behavioral contract.
- `variant-analysis`: four paths share the confirmed lost-canonical-company defect.
- `systematic-debugging`: the prior 29-case proof establishes the root cause and first
  unsafe boundaries.
- `test-driven-development`: new actual-action regressions are written before source
  changes.
- `verification-before-completion` and `quality-playbook`: exact commands, outcomes,
  changed files, and verification limits are retained here.
- installed `vercel:nextjs`: the changed `app/**` modules are Server Actions. Its
  Server Action, directive, and error-handling guidance was read before edits.

Conditional skills: `receiving-code-review` applies only if root returns review
findings. Database, Supabase, SQL, migration, performance, UI, browser, workflow,
deployment, reusable-skill, and parallel-agent workflows are excluded because this is
an application-only server-action fix and the brief forbids SQL, workflow changes,
provider calls, and subagents.

The repository-required `node_modules/next/dist/docs/` tree is absent because the
checkout has no installed dependencies. No dependency install is permitted. The
installed current Next.js skill was therefore the available version guidance; the
supported Node 22 hosted lane remains root's acceptance gate.

## Source evidence checkpoint

- `app/admin/cis/actions.ts::assertEntityCompanyAccess` receives only the separately
  loaded actor id. Its four callers discard `requireAdminActionAccess(...)` and then
  accept a loaded company through membership/lifecycle-only resolution.
- `app/admin/customers/[id]/profile-actions.part-1.ts::getActorUserId` discards the
  complete guard. Save and close, plus mark-test and archive in part 2, load a customer
  and pass only the actor id and row company into the operational membership helper.
- `app/admin/ediel/actions.part-4.ts::createEdielPortalTestCustomerAction` checks the
  three-key `allOf` requirement for the canonical company, then applies only the
  membership/lifecycle helper to the submitted company before the service graph.
- `lib/tenant/entityGuards.ts::TenantGuard` omits `companyId` and re-resolves an
  operational default. With no cookie, this can disagree with the company selected by
  the canonical permission context.
- All direct `assertCompanyAccessForGuard` / `loadCustomerTenantContext` production
  consumers pass the full `GuardResult` returned by admin action/API guards; adding
  `companyId` to the existing `Pick` is source-compatible at those call sites.

The existing dirty memory, master status, native receipt, and `scripts/__pycache__`
files belong to root's accepted Task 11a work and are not owned or modified here.

## Verification log

| Phase | Command | Outcome |
| --- | --- | --- |
| Baseline | `git rev-parse HEAD` | `d6d15df9683fe12e78e712fc610919dee9bc1b37` |
| Environment | `node --version`; dependency check | Node `v24.19.0`; Vitest and installed Next docs absent |
| Prior actual-source proof | Complete 29-case appendix in the source audit | Vulnerable baseline established; not reclassified as native/provider acceptance |
| Fresh initial RED | `node --experimental-strip-types /tmp/task14-company-authority-probe.mjs` | Expected exit 1: `0/10` safe denials. The actual entity helper and all nine changed action entries reached the mocked domain/mutation/graph boundary (the entity helper returned B) |
| Reproducible 67-case RED | Extract the five base files with `git show d6d15df9683fe12e78e712fc610919dee9bc1b37:<path>` beneath `/tmp/task14-base-source`, then run `TASK14_SOURCE_ROOT=/tmp/task14-base-source node --experimental-strip-types .superpowers/sdd/2026-09-12-current-and-plan77-85/task-14-company-authority-probe.mjs` | Expected exit 1: `31/67` pass, `36` authorization cases fail. A→B and B→A reach every mocked action effect boundary; missing canonical/row ownership also reaches CIS/profile boundaries |
| Reproducible 67-case GREEN | `node --experimental-strip-types .superpowers/sdd/2026-09-12-current-and-plan77-85/task-14-company-authority-probe.mjs` | Exit 0: `67/67` pass. Same-company and authoritative platform controls reach only their expected boundary; ordinary mismatch, missing ownership and paused cases reach none |
| Structural closure | Inline Node assertions over the five source files | PASS: canonical entity binding, exactly four CIS callers, exactly four profile callers, and Ediel's exact three-key `allOf` scoped guard |
| Source syntax | Node 24 `stripTypeScriptTypes` over five implementation and two Vitest files | PASS: all seven parse |
| Existing RBAC static gate | `node scripts/security-audit-rbac.mjs` | PASS: `24` checks, `0` warnings |
| Whitespace | `git diff --check` | PASS |
| Targeted Vitest | `npm test -- __tests__/tenant-entity-canonical-company.test.ts __tests__/server-action-company-authority.test.ts` | Not run: exit 127, `vitest: not found` because `node_modules` is absent |
| Test typecheck | `npm run typecheck:tests -- --pretty false` | Not run: exit 127, `tsc: not found` because `node_modules` is absent |
| Targeted lint | `npm run lint -- <five implementation files> <two test files>` | Not run: exit 127, `eslint: not found` because `node_modules` is absent |

The two permanent Vitest regression modules were written before production source
changes. They cover both A/B directions, both-grant selection mismatch, missing guard
and row ownership, the no-cookie canonical/default divergence, same-company controls,
authoritative platform authority, and paused/missing-membership restrictions. All
denial assertions require zero mutation/domain/graph calls.

Two existing PGlite SQL selftests were probed and stopped before execution because
`GRIDEX_PGLITE_MODULE` is unavailable. They are outside this application-only change;
no dependency installation or SQL fallback was attempted.

## Implementation

- `TenantGuard` now carries `companyId`. Ordinary entity access trims and compares the
  loaded row company directly with the canonical permission company; null/blank values
  fail closed. Authoritative `isPlatformAdmin` remains the only cross-company bypass.
- CIS retains each original `GuardResult` and passes it through the entity load for all
  four actions. After canonical binding, the existing membership/company lifecycle
  checks still run against that explicit company before any domain call.
- The customer-profile actor helper now returns the original guard after verifying the
  request user. Save, close, mark-test and archive bind the loaded customer ownership
  through one local helper, then run the prior operational check with the authoritative
  platform flag. Archived-profile locking, confirmation strings, mandatory archive
  update, best-effort related archival, and later ownership filters are unchanged.
- Ediel portal-test creation now applies `requireCompanyScopedActionAccess` to the
  submitted nonempty company with the same `masterdata.write`, `switching.write`, and
  `communication.write` `allOf` requirement. Its explicit lifecycle validation remains
  before `makeServerClient` and the service-backed graph.
- No permission-key union, role-name platform authority, fallback company resolution,
  SQL, generated type, workflow, memory, index, provider, or publication change was
  introduced.

## Owned files

| File | SHA-256 |
| --- | --- |
| `app/admin/cis/actions.ts` | `f14e58726a102624f0c29f41e03588a4b52b77fe125dc04d6564cc935ecfa186` |
| `app/admin/customers/[id]/profile-actions.part-1.ts` | `5c4d8b66b56ecaca7ce3126edfe7c2555b3cc8f78f5fb1e0edb88b2421372887` |
| `app/admin/customers/[id]/profile-actions.part-2.ts` | `dc92ee444206fb014d29b789d7c77a9b22d4c10030072e79dbadf38b00820b98` |
| `app/admin/ediel/actions.part-4.ts` | `cfeae8fa2e58acb54cd660e50f84b30ab94b1a4a1280fa7f776f1586c97aef88` |
| `lib/tenant/entityGuards.ts` | `d8ef8bb0feeb210e26f00f9066b508b605d7e570158b14b52a21c239a582c17e` |
| `__tests__/server-action-company-authority.test.ts` | `235e4a93b19d43a8f9ab7fee7c56865fdadd8bfeb2b5399f848287f5239e8572` |
| `__tests__/tenant-entity-canonical-company.test.ts` | `de4922735a4fcb2758256db2ed960c5b7d58df9417234e33e6242b13ff35db52` |
| `.superpowers/sdd/2026-09-12-current-and-plan77-85/task-14-company-authority-probe.mjs` | `32066f393c4e1b4c46aeeeb67a067bddf580cb6edbeb73c8f19aaff121b149f1` |
| `.superpowers/sdd/2026-09-12-current-and-plan77-85/task-14-report.md` | This report; final self-hash is recorded in the author handoff after this last edit |

The pre-existing dirty memory, master status, native acceptance receipt, SQL audit, and
Python cache files are not Task 14 files. They were preserved byte-for-byte by this
author.

## Residual limits

Supported Node 22 Vitest, test typecheck, lint, and production build are pending root's
hosted gate. Service-role access makes the application guard material, while native
RLS, PostgREST, database triggers, Storage policy/ACL behavior, and service-client
tenant enforcement remain separate security boundaries that this mocked application
proof does not verify. No external provider, browser transport, full Ediel graph,
production data, or deployment behavior is claimed. The documented contract role-name
inconsistency remains outside this bounded task because no reachable ordinary writer
was established.
