# Server-action company authority — independent reviews

Final source review: APPROVED, all I1/M1/I2 addressed, 0 Critical/0 Important/0 Minor. Supported Node22 acceptance is pending for this batch. Earlier review sections below are historical findings and their resolution evidence.


---

# Task 14 independent review — package 1

## Spec Compliance

- ❌ Issues found: the implementation satisfies the bounded company-binding changes, but the required actual-source regression chain with mocked I/O only is not supplied. The new tests replace authorization and operational-policy helpers; see Important I1 below and `task-14-brief.md:7`.
- Reviewed the frozen seven-file uncommitted package against `d6d15df9683fe12e78e712fc610919dee9bc1b37`. The complete diff was read once in three consecutive ranges. No source, Git/index, memory, dependency, native, production, or provider mutation was performed.
- Routing: task-reviewer prompt and code-review checklist applied; brief-to-source compliance and verification limits assessed directly under the explicit single-reviewer/no-subagents scope. Root's Supabase/Next.js preflights remain applicable. No additional implementation, broad-audit, browser, performance, SQL-execution, publication, or delegation workflow was activated.

## Strengths

- **Canonical binding fails closed.** `lib/tenant/entityGuards.ts:32–44` validates nonempty row ownership before the platform branch and compares ordinary ownership directly with the original `guard.companyId`. The removed operational default is not re-resolved. `lib/admin/guards.ts:111–119` honors an explicit false platform flag; production guards construct the flag and company at `lib/admin/guards.ts:168–179` and `lib/admin/apiGuards.ts:126–138`.
- **All four CIS paths retain the guard.** `app/admin/cis/actions.ts:133–160` loads ownership, binds it, then performs explicit membership/lifecycle checks with the authoritative platform flag. Callers at `:384–405`, `:520–543`, `:581–599`, and `:650–664` retain their existing permission requirements and invoke that helper before their domain operations. The array requirement remains the existing any-of semantics, confirmed at `lib/admin/guards.ts:91–98`.
- **All four profile paths use the same retained context.** `app/admin/customers/[id]/profile-actions.part-1.ts:148–175` retains the complete guard and verifies the request identity agrees with it. Save/close bind the loaded row at `:297–300` and `:467–472`; test/archive do so in `profile-actions.part-2.ts:217–220` and `:369–372`. Customer, contact, site, and point writes retain company filters or explicit company payloads (`profile-actions.part-1.ts:318–330,345–369,528–560`; `profile-actions.part-2.ts:223–259`).
- **Ediel retains the exact all-of permission set.** `app/admin/ediel/actions.part-4.ts:608–639` passes the submitted company to the corrected scoped helper, rejects an empty submission, and preserves explicit operational validation before `makeServerClient` and the graph. The unchanged helper binds the canonical company and checks membership at `lib/admin/guards.ts:309–335`; the flow client is the service client at `lib/ediel/flows/shared.ts:312–314`, so this ordering is material.
- **Existing lifecycle and archive contracts remain intact in the changed paths.** Profile save's archived lock remains ahead of mutation (`profile-actions.part-1.ts:290–295`); close and archive retain their confirmation handling (`profile-actions.part-1.ts:437–458`; `profile-actions.part-2.ts:348–359`). Mandatory customer archival, the schema-shape-only fallback, and subsequent best-effort related work remain in `profile-actions.part-2.ts:283–330,383–443`. Explicit operational validation still checks ordinary membership and platform target lifecycle (`lib/tenant/scope.ts:189–237`); admin actions also check canonical-company writability (`lib/admin/guards.ts:261–268`).
- **Consumer and facade compatibility is source-supported.** The mutation-context signature already accepts the full admin guard (`app/admin/customers/[id]/actions.part-4.ts:117–124`). Switch callers obtain and pass that guard (`switch-actions.ts:52–82,153–174,199–227`; `switch-create-actions.ts:422–450`), as do email and signature actions (`email-actions.ts:20–21`; `contracts/[contractId]/signature/actions.ts:27–29`). API consumers pass `access.guard` (`app/api/admin/customer-contract-documents/[documentId]/route.ts:20–42`; `customer-documents/[documentId]/route.ts:17–38`; `customer-documents/relations/route.ts:25–29`; `customer-switch-form-options/route.ts:36–41`), whose success type is `GuardResult` (`lib/admin/apiGuards.ts:32–34`). No production caller of `guardIsPlatformAdmin` exists outside the entity helper. New profile helpers are not exposed by the unchanged server-action facade (`profile-actions.ts:1–24`); Ediel's facade continues its existing async wrapper (`app/admin/ediel/actions.ts:134–135`).
- **The new tests contain meaningful first-boundary assertions.** They execute the actual changed CIS/profile action bodies and actual entity binding, deny ordinary company mismatch before a domain/mutation boundary, and include positive controls that must reach the existing boundary. That coverage is useful, but does not satisfy the complete real-policy-chain requirement in I1.

## Issues

### Critical (Must Fix)

- None confirmed.

### Important (Should Fix)

- **I1 — Required integrated authorization evidence is replaced by policy mocks.** `__tests__/server-action-company-authority.test.ts:61–67` replaces the admin/scoped guards, and `:87–91` replaces operational scope/validation. The supplemental source probe repeats the same substitution at `task-14-company-authority-probe.mjs:58–66,94–97`: its scoped guard is a test-written equality check and its operational validator simply returns a company or throws a preset error. These are authorization decisions, not I/O boundaries. Consequently the paused/missing-membership cases prove propagation of an injected error, and the Ediel mismatch cases prove that the action calls a mock implementing the desired result. The probes do not exercise the real canonical-response-to-guard-to-loaded-row chain, despite `task-14-brief.md:7` explicitly requiring actual-source tests with mocked I/O only. This matters especially because changing the permission requirement, membership policy, authoritative flag handling, or canonical response consumption can escape these action tests. The prior vulnerable audit and unchanged-guard tests do not substitute for the requested fixed-path integration evidence. **Fix:** retain these focused wiring tests if useful, but add the bounded matrix using the actual admin/scoped guards, operational scope, entity helper, and all nine action entries; mock request auth/RPC responses, cookies/cache, database I/O, and terminal mutation/provider boundaries. Supply fresh source RED/GREEN for that chain and supported Vitest equivalents, covering both directions, both-grant mismatch, missing ownership, absent-cookie disagreement, same-company/platform controls, and real paused/missing-membership resolution. Do not install dependencies locally; supported execution can remain in the agreed hosted lane.

### Minor (Nice to Have)

- **M1 — Stale actor helper import.** `app/admin/customers/[id]/profile-actions.part-2.ts:12` still imports `getActorUserId`, although its callers were converted to `getActorContext` and there are no remaining uses of that import. Remove it to avoid unused-import lint noise. This is a source finding; ESLint itself was not run locally.

## Focused checks and verification boundaries

- **Named risk: losing lifecycle policy when removing operational fallback.** Checked the unchanged admin/scoped guard and explicit operational validator (`lib/admin/guards.ts:248–335`; `lib/tenant/scope.ts:107–237`). Ordinary admin-action consumers retain canonical-company lifecycle validation; changed CIS/profile/Ediel actions retain explicit target validation, including platform lifecycle restrictions. API read consumers retain their canonical RPC guard; this review does not independently establish native RPC lifecycle behavior for every read-policy scenario.
- **Named risk: `TenantGuard` type expansion or accidental public helper exposure.** Searched production helper usages and checked each direct caller's guard origin plus both public facades, as cited above. No changed consumer object lacks `companyId`; only a supported compiler/build run can accept the full module graph.
- **Named risk: authorization check followed by a different service effect.** Checked the unchanged CIS domain boundaries: export status uses the same export id (`lib/cis/db-data.ts:658–692`); outbound status uses the same request id and retains status-dependent lifecycle validation (`lib/cis/db-outbound.ts:556–607`); ingestion retains loaded graph consistency and operational validation (`lib/cis/db-data.ts:760–766,903–909`; `lib/cis/db-shared.ts:253–284`). Ediel passes the authorized company into its existing graph (`lib/ediel/portalTestCustomer.ts:1241–1279`). The unchanged id-only status writes are not a concurrency/ownership-transfer proof. CIS later synchronizes a submitted customer through a request-authenticated client (`app/admin/cis/actions.ts:166–169,570`; `lib/operations/db.part-2.ts:234–258`); complete native RLS/relationship acceptance for that pre-existing path is not established here.
- **Cut-hunk exception:** the frozen diff ends inside the entity loader, action bodies, and archival flow. Only the omitted relevant portions of those changed functions and their directly relevant helpers were read to judge first-effect ordering, ownership filters, archived behavior, and best-effort semantics. The changed tests were not separately reread. Unchanged source reads were limited to the named policy, consumer/facade, and downstream-effect risks above.
- ⚠️ **Author evidence, not independently rerun:** reported source RED `31/67`, GREEN `67/67`, syntax parsing, RBAC `24` checks, and whitespace checks. The source probe was inspected, including its policy substitutions and first-boundary stopping behavior; its counts do not prove the missing integrated-policy contract. No specific code doubt required rerunning that same probe or suite.
- ⚠️ **NOT_RUN locally:** supported Vitest, test typecheck, lint, and production build. Dependencies are absent and installation is prohibited under the disk constraint. Run the supported hosted gates after the fixed evidence batch is independently reviewed and published; do not label application acceptance complete before their actual results.
- ⚠️ **Not verified/claimed:** native PG17/RLS/Storage/trigger behavior, migration acceptance, full Ediel graph completion, external provider execution, browser/Next transport, production data, deployment, or the separately bounded historical contract-role inconsistency. No SQL/migration/generated-type/workflow changes appear in the frozen implementation diff.

## Assessment

**Task quality: Needs fixes.** Counts: **0 Critical, 1 Important, 1 Minor**.

The implementation makes the intended narrow company-authority correction, preserves the reviewed call ordering and existing contracts, and introduces no confirmed new authority bypass. The required real-policy regression chain remains missing, so source review approval and supported acceptance should wait for I1; M1 is a small cleanup.

---

# Task 14 fix1 independent review

## Spec Compliance

- ❌ Issues found: I1's policy-mock defect is resolved, but nine new supported Vitest cases have an assertion inconsistent with the real guard and do not reach their intended named-permission check. New Important I2 below must be fixed before approval.
- Scope: I1/M1 and consequences only. The production-path assessment in `task-14-review-1.md` is preserved. The complete new integrated Vitest module and distinct source probe were read; the unchanged production diff was not re-reviewed. The only production edit under this round is the M1 import removal.
- Frozen identity verified with `sha256sum`: integrated test `7d94b1f98b478db78cfe86d3c22dc7c9eded4b1d7c5aec47752a87cd374d8069`; probe `e0b835929fb920b2e63dc69ec37923e167b61ec9827d7ad4a513264e2569cc87`; fix report `292535470d1dc0505769d9487b83127ba98aaa4e97d94b76e7531140e403b3e0`; profile part 2 `b436b32299125a80c1520e289a8ed2a2cf436c71a1875a0fb759bf8ab9e0a0f8`.

## Strengths and resolved findings

- **I1 resolved at its root: actual policy chain now executes.** `__tests__/server-action-company-authority-integrated.test.ts:1–18` imports the real actions, admin guard and entity helper. Its mocks at `:67–185` leave admin/scoped guards, operational scope, entity guards, governance, lifecycle predicates, and Ediel form parsers intact. Auth/canonical RPC responses are injected at `:76–93,370–392`, with membership/company rows at `:209–240`; these are I/O fixtures rather than replacement policy decisions. Domain/graph mocks at `:103–115,171–177,395–403` are the intentional terminal effect boundaries.
- **The source harness also uses real policy bodies.** `task-14-fix1-integrated-probe.mjs:101–114` loads the actual role, lifecycle, access-model, scope, admin/scoped guard, entity, and governance sources. `:116–143` connects them to all nine action bodies and actual Ediel form parsers. It no longer supplies the test-written scoped equality check or preset operational denial from review 1. The governance concurrency adapter does not replace the company policy; no concurrent governance workflow is exercised by these first-boundary cases.
- **The matrix reaches the intended scope.** The nine-action table is explicit at `server-action-company-authority-integrated.test.ts:291–352`. Cases at `:418–450,466–518` cover both directions, both-grant mismatch, absent-cookie B-first operational rows versus canonical A, positive/platform controls, ordinary and platform paused-company denial, missing membership, missing loaded/submitted ownership, missing canonical ownership, and the direct shared helper. The missing communication permission checks the real Ediel all-of behavior at `:459–464`. Denials require both zero effects and zero DB mutations at `:406–410`; positive controls must reach exactly one deliberate terminal boundary at `:412–415`.
- **Counts are correctly distinguished.** The file defines 11 nine-action matrices, one eight-action matrix, and three focused cases: 110 Vitest tests. The probe's `:176–211` represents the same coverage with the direct helper's two outcomes counted separately, yielding 111 observations. These are defined/inspected counts, not a claim that supported Vitest ran.
- **M1 resolved.** `app/admin/customers/[id]/profile-actions.part-2.ts:12` no longer imports `getActorUserId`; `getActorContext` and the company-binding helper remain imported. No behavior change is required for this cleanup.

## Issues

### Critical (Must Fix)

- None confirmed.

### Important (Should Fix)

- **I2 — Nine Vitest cases fail, while the source probe accepts an earlier denial.** `__tests__/server-action-company-authority-integrated.test.ts:452–456` clears the selected company's permissions and expects `/behörighet|Forbidden/i`. The canonical fixture still returns `roles: ['custom_role']` (`:380–383`). In the real guard, empty permissions plus that nonplatform role makes `isAdmin` false (`lib/admin/guards.ts:164–166`), so `requireAdminActionAccess` throws `Unauthorized` at `:253–255`, before checking the required action keys at `:271–274`. The probe uses the same empty permission fixture (`task-14-fix1-integrated-probe.mjs:185–187`) but its broad accepted-error regex includes `Unauthorized` (`:174`), so its reported GREEN masks the supported-test mismatch. **Focused execution confirmed all nine actions throw exactly `Unauthorized`, match the Vitest regex in zero cases, and produce zero effects.** This is both a supported-test failure and a coverage error: the cases titled “real action permission denial” never evaluate the named requirement. **Fix:** give the selected company a nonempty, unrelated valid permission such as `customers.read` in both integrated fixtures, ensuring the account passes the admin-context gate but lacks each action's required keys; assert the intended `Forbidden` requirement denial consistently in Vitest and the source probe. An empty-permission/`Unauthorized` control can be kept separately if desired. Do not fix this merely by broadening the shared regex, which would preserve the missed policy branch.

### Minor (Nice to Have)

- None newly confirmed; M1 is resolved.

## Focused verification and limits

- **Named concrete doubt tested:** whether the source probe's broad accepted-error pattern hides a failure in the supported permission-denial matrix. One `node --experimental-strip-types --input-type=module` command loaded the actual probe definitions preceding the first `await matrix('A-to-B-memberships'...)`, reset each of the nine actions to same-company A with `permissions.A = []`, invoked it, and printed the thrown message, the exact Vitest-regex match, and effects. Result: nine `Unauthorized`, nine `vitestPatternMatches: false`, nine empty effect arrays. Exit 0 reflects successful diagnostic execution, not passing Vitest assertions. The Node runtime emitted its standard `stripTypeScriptTypes` ExperimentalWarning; this check's output is not described as pristine or as supported acceptance.
- No author suite or full source matrix was rerun. The reported RED `64/111` and GREEN `111/111` remain author evidence for the frozen probe; the focused check establishes why that GREEN does not accept the current supported test file.
- Focused unchanged-source checks addressed real parser/governance loading and the admin-context versus permission-denial branch. No unrelated production audit or new source implementation review was opened.
- ⚠️ Supported Node 22 Vitest, test typecheck, lint, and production build remain **NOT_RUN locally**. Dependencies are absent/incomplete and installation remains prohibited. After I2 is corrected and reviewed, run the agreed hosted gates on the published exact batch before claiming application acceptance.
- ⚠️ Native PG17/RLS/Storage/trigger behavior, migration acceptance, complete domain/provider completion, browser transport, production and deployment remain outside this application first-boundary evidence. Review 1's unchanged downstream and native acceptance limits remain in force.
- No dependency install, production/provider call, SQL execution, source/index/memory mutation, publication, or subagent work was performed. Only this review report was written.

## Assessment

**Task quality: Needs fixes.** Resolved: **I1 and M1**. New findings: **0 Critical, 1 Important, 0 Minor**.

The integrated fixtures now meet the real-policy-chain requirement and preserve the bounded production change. Correct the permission-denial fixture and align its assertions across both harnesses before accepting this evidence batch.

---

# Task 14 fix2 independent review

## Spec Compliance

- ✅ Spec compliant for the scoped I2 correction. I2 is resolved; I1/M1 remain resolved under the preceding review. The accepted bounded production-path assessment is unchanged.
- Review scope was the three-line integrated-test correction, the distinct fix2 probe's delta from the reviewed fix1 probe, and their report. No unchanged implementation or full suite was re-reviewed.

## Strengths and resolved finding

- **I2 resolved: the fixture reaches the named-permission branch.** `__tests__/server-action-company-authority-integrated.test.ts:452–456` now supplies the nonempty unrelated `customers.read` permission and requires exactly `Forbidden`. With this permission the real guard satisfies the initial `isAdmin` predicate (`lib/admin/guards.ts:164–166`), while none of the nine action requirements is granted; the real requirement check therefore rejects at `:271–274`. The fixture no longer relies on the earlier `Unauthorized` branch.
- **Both harnesses assert the same outcome.** `task-14-fix2-integrated-probe.mjs:175–177,188–190` uses that same default permission fixture and exact `/^Forbidden$/` expectation. The optional environment switch restores the reviewed empty fixture solely for reproducible RED evidence; it does not change production policy. The Ediel partial-all-of case likewise expects exact `Forbidden` in both files (`server-action-company-authority-integrated.test.ts:459–463`; probe `:191–192`). The previously broad error regex no longer hides an early authorization failure in these cases.
- **The evidence change is narrow and history is preserved.** Reversing only the three stated test-line changes in memory reproduces the reviewed fix1 test SHA-256 exactly: `7d94b1f98b478db78cfe86d3c22dc7c9eded4b1d7c5aec47752a87cd374d8069`. A direct diff between the probes contains only the new fixture selector and the corresponding fixture/exact-assertion changes. The fix1 probe retains its reviewed hash.
- **Existing coverage remains intact.** The correction does not alter the 110 defined Vitest cases, 111 source-probe observations, real guard/scope/entity/action integration, zero-effect denial assertions, or first-boundary positive controls accepted in fix1 review. No new production change is part of this round.

## Issues

### Critical (Must Fix)

- None.

### Important (Should Fix)

- None; I2 is resolved.

### Minor (Nice to Have)

- None.

## Verification and limits

- Verified frozen hashes with `sha256sum`: integrated test `2ea04dd0cef6746f82be34c9b616fdf74a90c63d47f6d4d2a4f88da37f240ddf`; fix2 probe `e620edacbde41dadcf9ae6e4faca6b64e497b8718b08978829281ae300539b65`; fix2 report `45fda5e7337c0ccb70f227f7a694c4376dca4c8f265d1b5cc02790e5e7ae3e7b`; unchanged fix1 probe `e0b835929fb920b2e63dc69ec37923e167b61ec9827d7ad4a513264e2569cc87`.
- The in-memory inverse-delta hash check exited 0 and confirmed the exact previously reviewed test bytes. No file was written by that check.
- Author evidence reports broken-fixture RED `102/111` with nine exact `Unauthorized` failures and zero effects, corrected GREEN `111/111`, and vulnerable-base RED `64/111`. The inspected exact assertion now rejects precisely the failure independently observed in fix1 review. No remaining concrete doubt justified repeating the source matrix or suite.
- ⚠️ Supported Node 22 Vitest, test typecheck, lint, and production build remain **pending / NOT_RUN locally**. This is source-review approval, not supported application acceptance. Run the agreed hosted gates on the exact reviewed published batch before claiming that acceptance.
- ⚠️ Native PG17/RLS/Storage/trigger behavior, migration acceptance, full domain/provider completion, browser transport, production and deployment remain outside these first-boundary tests. Prior review limits remain in force.
- No source/index/memory changes, dependency installation, native or provider execution, publication, or subagent work was performed. Only this review report was written.

## Assessment

**Task quality: Approved for the scoped fix2 review.** Findings: **0 Critical, 0 Important, 0 Minor**. All review findings I1, M1, and I2 are resolved.

The corrected fixture and matching exact assertions now verify the intended real named-permission denial without weakening the guards or masking an earlier rejection. Supported hosted acceptance remains required.
