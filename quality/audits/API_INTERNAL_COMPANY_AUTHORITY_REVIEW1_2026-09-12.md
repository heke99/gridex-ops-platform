# Spec Compliance

**Issues found — required proof is incomplete (I1).** The reviewed production implementation satisfies the bounded company-authority behavior; the task gate needs the missing ordinary-null binding regression and the shared source-harness compatibility correction below. This is a task-level review, not approval of the branch or of masterplan77–85.

**Task quality: Needs fixes.** Two Important findings; zero Critical findings; no demonstrated production authorization bypass in this candidate.

## Frozen inputs

- Base/HEAD supplied by controller: `d731b76dd3dbd027cbbea4ebaf81d92faeeece73`, tree `cc25b413410613dc833e6a863b26aea00990407e`. Candidate is the working-tree 12-path package, not a new commit.
- Brief: `.superpowers/sdd/2026-09-12-current-and-plan77-85/task-10b2auth-brief.md` (including the seven-route/eight-handler extension and resumed base from controller/report).
- Report SHA-256 independently rechecked: `9327539d155f35090e92ea78d69bf44ae88d750b75eaedbbe1a3fece0fed7932`.
- Owned manifest SHA-256 independently rechecked: `7ab93a7943389563f1a325fece5cf15f3a78a7b8fe9f468ac7d2f2b84431c062`.
- Full package read once, in three sequential nonoverlapping ranges; 92,058 bytes, SHA-256 independently rechecked: `2d2a3feb8b88d0df88e36447b096b4e4798a687faf94d3356c5bd549785bec87`.
- Controller independently verified all 14 path/artifact hashes before dispatch. This reviewer rechecked the three aggregate input hashes above, not all 14 again.

## Strengths and implemented requirements

- `lib/admin/apiGuards.ts:62–103` uses one binder for read and write paths. Ordinary explicit targets must equal the canonical company from the permission-bearing guard; null/blank canonical selection does not reach the operational fallback. Authoritative `isPlatformAdmin` is passed explicitly into the real scope helpers, so a platform-looking role string cannot create the bypass.
- All eight handlers bind before their business receiver; the five body-bearing writer exports bind before `request.json()`: `app/api/internal/billing/generate-underlay/route.ts:18–19`, `billing/period-locks/route.ts:18–23,35–36`, `pricing/preview/route.ts:18–19`, `pricing/reprice/route.ts:14–15`, `pricing/lock-preview/route.ts:14–15`, `invoice-exports/[id]/route.ts:17–19`, `invoices/[id]/provider-status/route.ts:24–31` (all route paths under `app/api/internal/`).
- `lib/tenant/scope.ts:192–231` checks readable membership/company visibility, and the existing writable helper at `234–282` retains writable lifecycle policy. `lib/tenant/lifecycle.ts:25–34` allows active/onboarding/paused reads and active/onboarding writes. Period-lock GET and export GET therefore preserve paused history; the six effectful handlers, including provider-status GET, use writable authority.
- `lib/tenant/scope.ts:202–223,245–268` validates an explicitly selected platform company's existence and lifecycle without ordinary membership. `apiGuards.ts:65–74` deliberately rejects platform no-selection. New permanent tests at `553–614` cover selected platform access, explicit invoice company without a cookie, paused platform read/write differences, and platform no-selection.
- Both invoice query aliases and `companyId ?? company_id` precedence remain at the route boundaries. Provider-status retains `billing.read`, GET, four provider commands, company/id filters and local update at `provider-status/route.ts:18–49`. The diff does not change financial, billing lock, pricing evidence, provider normalization, or SQL contracts.
- `CompanyAccessError` remains an `Error`; its classifier is limited to that type (`apiGuards.ts:80–82`). New authority denials reach sanitized `internalApiError` with403, while ordinary receiver/domain errors keep the existing500/409/400 behavior. `lib/http/apiError.ts:42–57` confirms undefined status still defaults to500. Existing external callers' message-based or generic error handling does not depend on exact Error constructor identity.
- The new permanent suite imports all actual routes and actual guard/binder/lifecycle/receivers (`__tests__/api-default-company-authority-binding.test.ts:285–294`). Mocks are DB/auth/RPC, React cache, Next cookies and provider fetch boundaries (`271–283,376–428`), not permission/binder/lifecycle functions. The A/B fixtures model nonowner membership creation order and active assignments. The relevant SQL selects by active membership/assignment and creation time (`20260810193450_canonical_access_provisioning_runtime_v1.sql:621–637`); the current wrapper delegates to that scoped function (`20260902091000_company_scoped_permission_engine.sql:28–41`). This is a bounded SQL-shaped fixture, not execution of SQL.
- Receiver fixtures do reach meaningful domain paths: underlay generation stores a blocked pending segment when values are absent (`lib/billing/underlayEngine.ts:620–670`), production pricing still runs its real evidence and settlement path (`lib/pricing/engine.ts:325–421`), pricing locking invokes evidence before RPC (`670–681`), export loads company/id-bound run/items (`invoiceExportCore.ts:904–911`), and provider configuration is resolved through the real client. Supplemental proofs assert the write/RPC and four-command provider effects, not only HTTP success. The permanent suite does not mock those receivers.

## Issues

### Critical

None confirmed.

### Important I1 — Missing required ordinary null-company binding regression

**Evidence:** `__tests__/api-default-company-authority-binding.test.ts:376–395,505–526,597–614`; corresponding source proofs `quality/audits/proofs/api-default-company-authority-regression.mjs:46–76,268–294` and `api-invoice-get-company-authority-regression.mjs:34–61,255–279`.

The permanent RPC fixture assigns ordinary permissions exclusively through the selected company (`permissions[companyId ?? '']`, with no empty-key permission set). Its ordinary inactive-membership/assignment cases therefore remove both selection and permissions and are rejected by `requireAdminApiAccess` before the new binder (`lib/admin/apiGuards.ts:143–172`). Its explicit no-selection cases set `platform=true`. The supplemental proofs have the same limitation. No case exercises a successful **ordinary** guard with missing canonical company, despite that being explicitly required by the brief and claimed in the report's coverage summary.

**Impact/root cause:** The central ordinary fail-closed invariant is checked in code but not independently guarded by the required permanent regression. A future ordinary-null operational fallback can remain unexercised by all these null-selection tests. This is an unmet proof requirement, not evidence that the current production binder allows such access.

**Targeted fix:** Add permanent cases through the real guard/binder/routes for ordinary missing canonical binding with sufficient permission to get past the guard. A separately labelled malformed canonical-RPC response/fault fixture is appropriate for this defensive boundary; do not silently present it as a valid SQL selection fixture. Assert403 and zero request-body/business/provider effects, including explicit-company invoice variants. Preserve the existing valid SQL-shaped A/B controls and ordinary inactive/permission-denial cases. Alternatively use an evidenced valid canonical source state that produces this result, with its source constraints explicit.

### Important I2 — Shared error import breaks an existing source proof's dependency graph while its assertion still accepts the wrong exception

**Changed source:** `lib/admin/apiGuards.ts:11,70–74` now needs `CompanyAccessError` from tenant scope.

**Affected caller:** `quality/audits/proofs/api-company-authority-regression.mjs:96–115` exposes only `assertUserCanOperateCompany` and `requireOperationalCompanyId` from its scope VM and injects only those into the guard VM. Its loader strips imports (`6–14`). Thus the newly used class is absent from the loaded guard. The retry route receives this guard (`134–140`), and its foreign-company case accepts a generic500 with no reads/effects (`159–165`). That assertion cannot distinguish the intended authority denial from this harness ReferenceError.

**Focused reproduction executed:** Read the existing proof, execute only its setup prefix before `const retryRoute =` through a data-URL module, and call the loaded real `apiGuards.assertAdminApiCompanyAccess({ userId: 'actor', companyId: 'A', isPlatformAdmin: false }, 'B')`. Command: `node --disable-warning=ExperimentalWarning --input-type=module` with the read-only inline script. Exit0 printed exactly:

```json
{"name":"ReferenceError","message":"CompanyAccessError is not defined"}
```

No source/proof was changed and the prior or new full suites were not rerun. The loaded predicate still denies the mismatch, so this is not a demonstrated production bypass. However the previously admitted actual-source proof no longer executes the real denial dependency graph; it silently treats a harness error as the intended result. This is a direct compatibility consequence of the shared import change, not an unrelated branch audit.

**Targeted fix:** Expose the actual `CompanyAccessError` from the existing tenantScope loader and pass it into the existing guard VM. Add a focused assertion that the mismatch rejects with that actual authority error rather than an arbitrary exception (retain the route's existing500 compatibility expectation if required by its unchanged envelope). No mock policy replacement is needed. The two new proofs already inject the actual class correctly.

### Minor

No additional finding raised. Wider coverage, alternative helper factoring, and pre-existing provider-update error handling are outside these supported defects.

## Focused reads and scope discipline

- Activated repository task-reviewer/requesting-code-review and code-review/differential-review methods for the single frozen candidate; verification-before-completion for claims. FP-check principles/direct verification were used to distinguish a harness error and a missing defensive proof from a production exploit. Spec-to-code requirements were evaluated under the explicitly assigned single-reviewer gate; its general fan-out workflow was not run because this assignment prohibits subagents.
- Read AGENTS, memory README/current-state/checkpoint, auth/RBAC and API domain memory, and relevant decisions/known-failure search results. `using-superpowers` explicitly excludes dispatched subagents. Broad inventory/native DB/security scanners/performance/UI/implementation/publication skills and suites were not activated: this is a bounded read-only task review with no native, UI, performance, mutation or publication authority.
- The package has ordinary three-line hunks that cut relevant functions. Focused reads completed `scope.ts` membership filtering and writable function, `apiGuards.ts` permission guard/error handling, and complete period/provider handlers to establish ordering and unchanged effects. These were the documented cut-function exception, not separate rereads of every changed file.
- Named unchanged-dependency risks checked: readable/writable semantics and undefined error status (`lifecycle.ts`, `apiError.ts`); shared callable/error compatibility (the six pre-existing API callers, direct-call search, existing source proof loader); canonical fixture fidelity (the scoped SQL selection and wrapper/rename); receiver and terminal-fixture fidelity (targeted billing generation/pricing/export/provider functions and imports); permanent test initialization (Vitest config/setup). No broad crawl, source modification, Git mutation, suite repetition, provider call, DB action or subagent occurred.
- Initial `git status --short` was read for AGENTS continuity. The supplied package was the only diff read; no git/package suite or Git-state command was subsequently rerun. Only this new private review file was written.

## Verification boundaries

- **Independently executed here:** three frozen aggregate hashes; the one focused legacy-harness ReferenceError reproduction above. No production behavior test suite was rerun.
- **Implementer-reported, not rerun here:** actual-source RED (period GET usedB instead of expected canonicalA), GREEN93 billing/pricing +43 invoice cases, RBAC24/0 warnings, API boundaries121, strip-types syntax, diff whitespace, and package reconstruction. The code/fixture claims were assessed against the diff; these remain bounded source evidence, not native execution.
- **Permanent suite:** 63 cases authored; local attempt exited127 because `vitest` was unavailable. No dependency installation was attempted. Runtime execution and pristine output of this permanent suite are unverified; no warning-free permanent-test claim is made.
- **Supported candidate acceptance remains NOT_RUN:** Node22 ESLint, application/script/test typechecks, focused/full Vitest, API contracts/RBAC/build/budgets and any required hosted repository gates. The prior1604-test/build success belongs to base `d731b76d`, not this candidate. Controller owns reviewed publication and supported acceptance after fixes.
- Full native RLS, complete77–85, full replay/generated types/parity, production binding and rollout remain open. This verdict does not waive those gates or authorize work beyond85.
