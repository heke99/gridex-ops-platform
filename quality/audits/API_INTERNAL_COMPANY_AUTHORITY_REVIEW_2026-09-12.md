# Spec Compliance

**Spec compliant for this bounded task correction.** I1 and I2 from `task-10b2auth-review-1.md` are addressed. The original production review remains applicable; no production source is changed by fix1.

**Task quality: Approved.** Zero remaining Critical, Important or Minor findings in this correction. This is approval of the reviewed task candidate for the controller's next gates, not supported-runtime, native, branch-merge or production acceptance.

## Frozen review inputs and boundary

- Same supplied base/HEAD: `d731b76dd3dbd027cbbea4ebaf81d92faeeece73`, tree `cc25b413410613dc833e6a863b26aea00990407e`.
- Prior review: `task-10b2auth-review-1.md`, SHA-256 `a707b17288d245a1f60300ca51ae6a84df788f307c8249745bdf38cf03b2f545`.
- Fix1 report independently hashed: `f6e52f9635068c9e316e80e680d69990b26bba85cff84c92578e4718adb485f4`.
- Two-path delta independently hashed and read once: `1fa5403eed00c7ca3ae323adfac28da7208a757796a41b7c64543a75b453d683`.
- Full 13-path package independently hashed, not rereviewed: `93a653c946d078f20533a018e648edaf93a919cc54cb231c83694b31007db6b5`.
- Manifest independently hashed: `f031f739ab6f2efd24853c7849fde5bfdde0c85c51c1b1d2c92189f6f4953f48`.
- Controller independently verified all 16 artifact/path rows and the three unchanged original aggregates before dispatch. The correction delta changes only the permanent test and legacy source proof; all nine production paths and both newly introduced supplemental proofs remain the originally reviewed bytes. Original reports and packages are retained.

## Strengths and finding dispositions

### I1 — Addressed: actual ordinary null-company binder regression

`__tests__/api-default-company-authority-binding.test.ts:45,362,391–409,516–533` adds an explicitly identified malformed ordinary canonical-RPC fault fixture and eight permanent route cases. The flag resets before every test; the existing valid SQL-shaped fixture branch is retained when the flag is false.

With the fault enabled and cookie null, the RPC response supplies `authorized:true`, `is_platform_admin:false`, null selected company and sufficient billing/pricing permissions. Under the unchanged real guard reviewed at `lib/admin/apiGuards.ts:143–176`, those permissions make the ordinary guard succeed. The real read/write binder then receives the null company. Both invoice variants additionally supply explicit companyB.

The assertions require403 **and the endpoint-specific sanitized error code** (`test:527–528`, endpoint codes at `306–326`). The ordinary permission-guard denial envelope has no such code, so these cases cannot pass by returning an earlier ordinary permission denial. The remaining assertions require no body parse, no service query/RPC, and no provider fetch (`529–532`). The added cases therefore close the precise gap in I1 without replacing the guard, binder, lifecycle or receiver policy with mocks. The resulting permanent count is the original63 plus8, or71 cases authored; execution remains unverified here.

### I2 — Addressed: real error-class dependency and error-specific assertion

`quality/audits/proofs/api-company-authority-regression.mjs:97` now exposes the actual `CompanyAccessError` from the existing real scope VM. The existing `...tenantScope` injection into the guard VM carries that same class into the loaded binder.

The new direct mismatch assertion at `143–150` calls the actual loaded binder with canonicalA/requestedB and requires `error instanceof tenantScope.CompanyAccessError`. A missing dependency ReferenceError cannot satisfy this assertion. The preceding load and existing retry-route generic500/no-effects assertions remain otherwise unchanged; no production envelope or authorization policy was altered.

This directly corrects the focused ReferenceError reproduced in the initial review. The implementer reports the bounded legacy proof now passes, including the new class assertion and existing retry/Ediel contracts. The reviewer did not rerun it because the correction is explicit in the diff and the reported focused execution answers the earlier doubt.

## Issues and correction-caused regressions

- Critical: none.
- Important: none remaining.
- Minor: none raised.
- The added fixture flag is reset in `beforeEach`; normal A/B, permission, lifecycle and platform scenarios retain their previous branches.
- Endpoint additions are expected error-code metadata only. Existing invocation functions and their company alias behavior are retained.
- The legacy proof changes only dependency exposure, an error-specific assertion, and its success description. It introduces no replacement policy helper, receiver change, or extra external boundary.

## Review method and limits

- Applied the same repository task-reviewer/requesting-code-review, code-quality, differential and verification-before-completion instructions as the original review. Scope was only I1/I2, correction-caused regressions and package boundaries. No broad audit, subagent, installation, SQL/provider/network action, Git action, source mutation or suite repetition occurred.
- Independently executed only the four fix1 artifact SHA-256 checks and creation/hash of this new private report. The delta supplied complete correction context; no additional source read or focused runtime experiment was needed.
- Implementer-reported, not independently rerun: focused legacy proof exit0; test strip-types syntax and proof syntax exit0; bounded loader compatibility search; unchanged production hashes; whitespace and full/prior-plus-delta package reconstruction passes. The report preserves the failed initial temporary full-archive reconstruction due to exhausted overlay space and the successful bounded retry. This is an explicit tooling limit, not hidden application-test failure.
- The permanent71-case Vitest suite remains NOT_RUN locally after the original dependency-boundary failure (`vitest: not found`, exit127). No claim of pristine permanent-suite output or supported execution is made.
- Supported candidate Node22 ESLint, app/script/test typechecks, focused/full Vitest, API contracts/RBAC, Next build/budgets and required hosted gates remain controller-owned and unverified for this candidate. Prior1604-test/build acceptance belongs to the base, not this working-tree package. Original136 actual-source cases were not rerun during this correction review.
- Full native RLS, complete masterplan77–85, replay/generated types/parity, production binding and rollout remain open. This approval does not waive those gates or authorize work beyond85.
