# Task 14 fix round 2 — permission-branch fixture correction

Date: 2026-09-12
Base: `d6d15df9683fe12e78e712fc610919dee9bc1b37`
Review read: `task-14-fix1-review.md` in full
Scope: I2 test/probe fixture correction only

## Change

- `__tests__/server-action-company-authority-integrated.test.ts` now gives the selected company the valid but unrelated `customers.read` permission in the nine-action named-permission denial matrix. All nine real guards therefore retain `isAdmin: true` and reach their action requirement checks. The expectation is exactly `^Forbidden$`.
- The Ediel missing-`communication.write` case also expects exactly `^Forbidden$`.
- `task-14-fix2-integrated-probe.mjs` carries the same fixtures and exact expectations. Its `TASK14_FIX2_EMPTY_PERMISSION_RED=1` switch reproduces the reviewed broken fixture without changing production source.
- No empty-permission control was added: the reviewed defect concerned the named-key branch, and the existing missing-canonical/authorization cases already cover earlier guard denial. No production file changed in this round.

`customers.read` was checked against all nine action requirements. It is unrelated to CIS outbound's existing any-of set (`switching.write`, `metering.write`, `billing_underlay.write`), partner export (`partner_exports.write`), metering (`metering.write`), billing underlay (`billing_underlay.write`), all four profile actions (`masterdata.write`), and Ediel's all-of set (`masterdata.write`, `switching.write`, `communication.write`).

## Actual-source RED / GREEN

- Fixture RED: `TASK14_FIX2_EMPTY_PERMISSION_RED=1 node --experimental-strip-types .superpowers/sdd/2026-09-12-current-and-plan77-85/task-14-fix2-integrated-probe.mjs`
  - Exit 1; 102/111 passed, 9 failed.
  - Every failed action returned exactly `Unauthorized` with zero effects, reproducing I2 and proving that the empty permission fixture did not reach the named requirement.
- Corrected GREEN: `node --experimental-strip-types .superpowers/sdd/2026-09-12-current-and-plan77-85/task-14-fix2-integrated-probe.mjs`
  - Exit 0; 111/111 passed, 0 failed. This includes the nine exact `Forbidden` results and Ediel's exact all-of result.
- Vulnerable base RED: `TASK14_SOURCE_ROOT=/tmp/task14-fix1-base-source node --experimental-strip-types .superpowers/sdd/2026-09-12-current-and-plan77-85/task-14-fix2-integrated-probe.mjs`
  - Exit 1; 64/111 passed, 47 failed.
  - Failure scenarios remain A-to-B, reverse B-to-A, both-grants mismatch, absent-cookie mismatch, missing loaded/submitted ownership, and both shared-helper observations.

The base fixture is the same complete `git show d6d15df9683fe12e78e712fc610919dee9bc1b37:<path>` source tree described in the fix1 report, including actual guards, scope, lifecycle, governance, entity helper, Ediel parsers, and all nine action entries.

## Other checks

- `node --experimental-strip-types --check __tests__/server-action-company-authority-integrated.test.ts && node --experimental-strip-types --check .superpowers/sdd/2026-09-12-current-and-plan77-85/task-14-fix2-integrated-probe.mjs` — exit 0.
- `node scripts/security-audit-rbac.mjs` — exit 0; 24 checks, 0 warnings.
- `git diff --check` — exit 0.
- Supported Node 22 targeted Vitest, test typecheck, lint, and production build — **NOT_RUN**. Dependencies remain absent/incomplete and installation is prohibited. The corrected supported test remains pending the hosted gate and is not claimed passing.
- Native PGlite/SQL — not run and not applicable to this test-only correction. Existing Supabase source/RLS/privacy preflight remains relevant to the unchanged application service-role paths.

## Exact frozen hashes

Fix-round files before this report:

- `__tests__/server-action-company-authority-integrated.test.ts` — `2ea04dd0cef6746f82be34c9b616fdf74a90c63d47f6d4d2a4f88da37f240ddf`
- `.superpowers/sdd/2026-09-12-current-and-plan77-85/task-14-fix2-integrated-probe.mjs` — `e620edacbde41dadcf9ae6e4faca6b64e497b8718b08978829281ae300539b65`

Preserved historical files:

- `.superpowers/sdd/2026-09-12-current-and-plan77-85/task-14-fix1-integrated-probe.mjs` — `e0b835929fb920b2e63dc69ec37923e167b61ec9827d7ad4a513264e2569cc87`
- `.superpowers/sdd/2026-09-12-current-and-plan77-85/task-14-fix1-report.md` — `292535470d1dc0505769d9487b83127ba98aaa4e97d94b76e7531140e403b3e0`
- `.superpowers/sdd/2026-09-12-current-and-plan77-85/task-14-fix1-review.md` — `49e5a08a517701b2e9a3283666786f925abb468b62a5291cf38b9b7560a83388`
- `app/admin/customers/[id]/profile-actions.part-2.ts` — `b436b32299125a80c1520e289a8ed2a2cf436c71a1875a0fb759bf8ab9e0a0f8` (unchanged this round)

The report hash is recorded in the author handoff because a self-digest would change this file.

## Boundaries

- The fix changes fixture semantics and assertions only. It does not alter company authority, permission requirements, lifecycle behavior, mutation ordering, archival behavior, or provider boundaries.
- The integrated source probe remains first-boundary evidence. It does not establish native RLS/Storage behavior, full domain/provider completion, browser transport, production data, or deployment behavior.
- No dependency, SQL, migration, workflow, generated type, memory, index, commit, provider, or unrelated dirty-file mutation was made.
