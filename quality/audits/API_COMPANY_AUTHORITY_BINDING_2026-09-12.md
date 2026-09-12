# Task 9 report — API company authority binding

Date: 2026-09-12
Base: `e5ad80eeea48ce42c450c0ca69e76cee7ac48569`
Status: implementation candidate ready for independent review; hosted Node 22 verification pending.

## Scope and skill routing

Implemented only P84-COMPANY-001/002 for the six requested write routes. TDD, systematic debugging, tenant security, variant analysis, specification comparison, and verification-before-completion guidance applied. Database/RLS, SQL, provider, notification, workflow, dependency, UI, Task 10 body/schema, and Task 14 server-action/entity work were not applicable to this bounded change. No subagent was used.

## Root cause and remediation

- The five invoice/export routes resolved `billing.*` permissions for canonical company A, then accepted submitted company B through membership/lifecycle-only `assertUserCanOperateCompany`. `assertAdminApiCompanyAccess` now compares the submitted/fallback company with the permission-bearing `GuardResult.companyId` before any membership lookup, item lookup, provider helper, RPC-like business helper, or mutation. It then preserves the existing company existence/membership and writable-lifecycle checks.
- The Ediel route resolved `ediel.write` for A but called a helper whose initial `ediel_messages` lookup used only the global message ID. Ordinary requests now validate the canonical company lifecycle first and pass it into the real helper. Its first lookup adds `company_id = A`, and it independently rejects a returned row whose `company_id` is not A before payload parsing, child lookup, decision upsert, or manual-review upsert.
- The Ediel route omits this optional lookup scope only for `GuardResult.isPlatformAdmin === true`. Direct trusted worker/helper callers that omit `companyId` retain their prior global lookup contract. Current source inventory found one application consumer of `evaluateInboundEdielRequest`, the changed API route.
- Platform authority is taken from the canonical guard flag. `assertUserCanOperateCompany` gained an optional explicit `{ isPlatformAdmin }` input so the verified API guard does not re-derive authority from a role name. Of 33 source matches, one is the definition, one is its recursive fallback, one is the new verified API caller, and the 30 existing app/lib call sites still pass two arguments and retain their existing behavior. The recursive fallback forwards the explicit authority when present. Explicit platform authority retains the existing company-exists and writable-lifecycle checks; explicit ordinary authority retains active membership and writable-lifecycle checks. A company-scoped `super_admin` role name with canonical `is_platform_admin: false` cannot bypass the company comparison.
- Authentication remains before request-body parsing. Existing success/error envelopes and route catch boundaries remain in place; cross-company errors continue through each route's existing `internalApiError` response rather than introducing a new response shape.

## Exact changed files

Production implementation:

1. `lib/admin/apiGuards.ts`
2. `lib/tenant/scope.ts`
3. `lib/ediel/inboundRequestAutomation.ts`
4. `app/api/internal/ediel/inbound-request-automation/route.ts`
5. `app/api/internal/invoice-exports/create/route.ts`
6. `app/api/internal/invoice-exports/[id]/retry/route.ts`
7. `app/api/internal/invoice-exports/[id]/send/route.ts`
8. `app/api/internal/invoices/[id]/dispute/route.ts`
9. `app/api/internal/invoices/[id]/purchase/route.ts`

Permanent evidence:

10. `__tests__/api-company-authority-binding.test.ts`
11. `quality/audits/proofs/api-company-authority-regression.mjs`
12. `.superpowers/sdd/2026-09-12-current-and-plan77-85/task-9-report.md`

No existing unrelated dirty file or index entry was changed for Task 9.

## Permanent Vitest matrix

`__tests__/api-company-authority-binding.test.ts` contains 47 generated cases and imports the actual six route modules, actual `requireAdminApiAccess`/company binding, actual tenant scope helper, and actual `evaluateInboundEdielRequest` body. Boundary I/O is mocked with explicitly typed object/query mocks; no `unknown`-inferred mock factory was introduced.

| Cases | Coverage |
|---:|---|
| 12 | Every route with A selected/B target and B selected/A target; both companies grant the permission, so mismatched deliberate selection is the only denying condition |
| 6 | B membership with no B grant; asserts the real guard rejects before `request.json()` |
| 6 | Canonical context returns no company; asserts no service/helper/provider/mutation I/O |
| 6 | Selected company paused; asserts lifecycle denial before business effects and before Ediel message loading |
| 1 | Ediel boundary returns a B row despite an A filter; asserts returned-row verification and zero writes |
| 6 | Same-company positive controls for every route; asserts target arguments, item/message filters, and Ediel decision/review company payloads |
| 6 | Authoritative platform cross-company positive controls for every route; asserts no role-derived service RPC and an intentionally global Ediel message lookup |
| 1 | Canonical platform flag false with `super_admin` role name; asserts no cross-company authority |
| 3 | Direct helper contract: explicitly blank scope fails before I/O, omitted trusted scope remains global, and trimmed valid scope filters the initial lookup |

The Vitest layer imports real `next/server`, so response status and `NextResponse` behavior are not replaced. It mocks `next/headers`, Supabase auth/database boundaries, invoice/provider calls, and domain-event output. This test has not been executed locally because this isolated checkout has no `node_modules`; the brief forbids dependency installation after the known ENOSPC condition. Hosted Node 22 Vitest, lint, and test typecheck remain required. No hosted result is claimed here.

## Actual-source RED/GREEN and local verification

The dependency-free proof executes the real retry route, real API guard, real tenant scope, real Ediel route, and real Ediel helper bodies through Node 24 `vm`; only boundary I/O and a minimal proof-only response object are synthetic.

| Command | Outcome |
|---|---|
| `node --disable-warning=ExperimentalWarning quality/audits/proofs/api-company-authority-regression.mjs` before implementation | RED, exit 1: real retry route returned 200 instead of expected 500 and reached the B reset under A permissions (`200 !== 500`) |
| Same command after implementation, unchanged assertions | GREEN, exit 0: `PASS actual retry route and Ediel route/helper deny A/B effects before mutation` |
| `node scripts/security-audit-rbac.mjs` | PASS, exit 0: 24 checks, 0 warnings |
| `node scripts/check-api-error-boundaries.cjs` | PASS, exit 0: 121 routes scanned |
| `node --experimental-strip-types --check` over all nine changed TypeScript production files and the permanent Vitest file | PASS, exit 0 |
| `git diff --check` | PASS, exit 0 |

The Node proof's synthetic response object checks control flow and effect fencing only. Real Next.js `NextResponse` behavior is covered by the permanent import-real Vitest boundary and therefore remains hosted-pending.

## Explicit limits

- No SQL, migration, RLS/native database, production configuration, provider, notification, workflow, memory, dependency, commit, or push operation was performed.
- No native tenant/RLS or production deployment acceptance is inferred.
- Body size, strict schema, idempotency, replay, and rate behavior remain Task 10.
- Server actions, CIS/customer profile/Ediel portal/entity-guard variants remain Task 14.
- The read-only invoice-export detail and provider-status variants were not expanded into this write-route task.
- Existing invoice identity, approval/lifecycle, target-system, provider GUID, item/reference company filters, downstream readiness, and event behavior were not weakened.
- Foreign and unknown ordinary-user Ediel message IDs share the same scoped lookup failure path and cannot reach canonical parsing, child data queries, decision writes, or manual-review writes. The route keeps its existing generic internal-error envelope, so foreign contents are not returned.

## Fix round 1 — strict optional-scope narrowing

Independent review identified TASK9-R1: `text()` returns `string | null`, and the original compound check on `input.companyId` did not statically narrow `authorizedCompanyId` from `string | null | undefined` to the `string | undefined` accepted by `loadMessage` under `strict: true`.

The minimum correction changes that check to reject `authorizedCompanyId === null` directly. The remaining value is therefore `string | undefined`: an omitted `companyId` retains the trusted unscoped helper contract, while an explicitly blank/whitespace value is still rejected before any query. No cast, non-null assertion, or invalid-scope-to-unscoped normalization was introduced.

Focused permanent coverage imports the actual helper directly and adds three cases for explicit blank, omitted, and trimmed valid scope. The dependency-free actual-source proof now executes the same three helper modes in addition to the prior route negatives.

| Round-1 command | Outcome |
|---|---|
| `node --disable-warning=ExperimentalWarning quality/audits/proofs/api-company-authority-regression.mjs` | PASS, exit 0: `PASS actual retry route and Ediel route/helper deny A/B effects; blank/omitted/scoped helper contracts hold` |
| `node --experimental-strip-types --check lib/ediel/inboundRequestAutomation.ts` | PASS, exit 0 |
| `node --experimental-strip-types --check __tests__/api-company-authority-binding.test.ts` | PASS, exit 0 |
| `git diff --check` | PASS, exit 0 |

No local TypeScript compiler or project dependencies are available, so strict typecheck and the now-47-case permanent Vitest file remain hosted Node 22 gates; no hosted result is claimed by this fix round.

## Independent review

Initial review found TASK9-R1 at the nullable optional-scope handoff. The original author fixed it by directly rejecting derived null and added three direct helper regressions. Scoped re-review specification and quality APPROVED: finding addressed, no new breakage. Forty-seven permanent real-import Vitest cases and supported strict typecheck remain hosted-pending.

## Supported CI declaration correction

On4d3a3cc OPS34678785614/job103513359561, lint rejected one fixture query declaration with prefer-const before typechecks/Vitest. The original author replaced the separate typed let declaration and assignment with one typed const initializer. All47cases, explicitLocalQuery and deferred self-reference closures are unchanged; syntax and scoped diff passed. Independent specification/quality review APPROVED without findings. No global rules/types/application behavior changed. Supported CI remains the next gate.
