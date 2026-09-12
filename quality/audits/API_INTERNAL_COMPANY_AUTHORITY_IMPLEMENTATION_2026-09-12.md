# Task 10b2auth report — canonical company authority for remaining internal operations

**Result: DONE_WITH_CONCERNS.** The seven-route/eight-handler authority patch, two controlled actual-source proofs, and one permanent real-import suite are complete and frozen for independent review. The only concern is execution infrastructure: this isolated worktree has no `node_modules`, installation is prohibited, and therefore the permanent Vitest suite and supported Node 22 repository gates remain for root-hosted execution.

## Scope and base

Implementation was resumed on published `HEAD` `d731b76dd3dbd027cbbea4ebaf81d92faeeece73` (tree `cc25b413410613dc833e6a863b26aea00990407e`) after Task 10b1 CI acceptance. The earlier dispatch base was superseded before this package was frozen. No Task 10b1 path was changed.

The patch covers exactly these route exports:

1. billing period locks `GET` and `POST`;
2. billing generate-underlay `POST`;
3. pricing preview `POST`;
4. pricing reprice `POST`;
5. pricing lock-preview `POST`;
6. invoice export `[id]` `GET`;
7. invoice provider-status `[id]` `GET`.

## Implemented behavior

- `bindAdminApiCompany` binds ordinary callers to the canonical `guard.companyId` returned by the same successful `requireAdminApiAccess` decision. An ordinary explicit company must equal that canonical company. A missing canonical company fails closed. No route calls the independent operational-company fallback.
- Authoritative `guard.isPlatformAdmin` remains the only platform bypass signal. A platform caller may explicitly target a legitimate company without membership after an actual `companies` existence/lifecycle query. A platform caller with no selected or explicit company deliberately fails closed.
- `assertAdminApiCompanyReadAccess` uses visible-company lifecycle policy. Period-lock `GET` and invoice-export `GET` can read paused-company history.
- The six effectful handlers use writable lifecycle policy. Provider-status remains a `GET`, but its provider reads and local update make it a write-policy operation; paused companies are rejected before provider/configuration effects.
- A typed `CompanyAccessError` distinguishes binding, membership, and lifecycle denials only for route status classification. The seven route catches map that class to the existing sanitized `internalApiError` envelope with HTTP 403. This prevents an authority rejection from being reported as an internal 500 while preserving the established public code/message fields.
- Existing non-authority dispositions remain unchanged: omitted foreign record IDs are queried only under the canonical company and retain the receiver's not-found/internal 500 envelope; provider missing GUID remains 400; billing-period lock remains 409; pricing evidence rejection remains 500; other provider/domain failures retain their prior envelopes.
- Existing permission names, body aliases/schema behavior, entity/company filters, actor attribution, billing locks, evidence checks, pricing/financial calculations, provider commands, provider response shaping, and `companyId ?? company_id` precedence are unchanged.

## RED/GREEN causality

The first new proof was created from the accepted actual-source finding harness, with expectations changed to the required canonical receiver. It was run before production edits against the then-current published source:

```text
node --disable-warning=ExperimentalWarning quality/audits/proofs/api-default-company-authority-regression.mjs
exit 1
AssertionError: actual 'B' !== expected 'A'
```

The first failing observation was the real period-lock `GET` receiver company filter in the valid no-cookie fixture: canonical SQL selected older company A, while the route's independent operational fallback selected B. This demonstrates that the production change, rather than a fixture-only change, caused GREEN.

Fresh GREEN after the final source and denial-status changes:

```text
node --disable-warning=ExperimentalWarning quality/audits/proofs/api-default-company-authority-regression.mjs
exit 0; passed 93

node --disable-warning=ExperimentalWarning quality/audits/proofs/api-invoice-get-company-authority-regression.mjs
exit 0; passed 43
```

Both proofs execute the actual route, guard, canonical SQL-selection interpretation, lifecycle, scope, and named receiver source through controlled Node VM loading. Substitutions stop at Supabase DB/RPC clients, framework cookie/response terminals, environment lookup, and provider `fetch`. They do not replace permission, authority, lifecycle, scoping, billing-lock, pricing-evidence, financial, provider-selection, or receiver policy. All hostnames are synthetic `.invalid`; no SQL, RPC, provider, network, or production action occurred.

The 93-case proof covers the five billing/pricing route files and six handlers, including A/B SQL ordering, cookie selection, permission denial, inactive membership/role assignment, missing binding, paused read/write differences, platform selected/no-selection branches, record mismatch under canonical filters, billing locks, evidence blockers, and write/RPC receivers. The 43-case invoice proof covers both GET handlers, both explicit aliases and precedence, canonical record filtering, all provider reads/local update, missing provider GUID/configuration, rejection behavior, test environment, authoritative platform false/true, and ordinary/platform lifecycle branches.

## Permanent coverage

`__tests__/api-default-company-authority-binding.test.ts` directly imports all seven real route modules/eight handler exports and their real guard/selection/lifecycle/receiver dependency graph. Its table expansion defines 63 permanent route cases. Controlled boundaries are React cache, Next cookies, Supabase server/service DB and RPC clients, provider `fetch`, and the synthetic provider secret environment value.

The suite asserts both canonical orders across all eight handlers; explicit foreign camel/snake selection returns 403 before business/provider I/O; alias precedence; permission, missing-selection, inactive-membership, inactive-assignment, and paused-write denials return 403 before body/effects; paused read handlers return 200; authoritative platform explicit active companies work without membership; explicit paused platform reads work while provider writes return 403; platform no-selection returns 403; a platform-looking role string cannot replace the authoritative boolean; billing lock remains 409; pricing evidence failure remains 500.

Local execution was attempted exactly once and stopped at the known dependency boundary:

```text
npm test -- --run __tests__/api-default-company-authority-binding.test.ts
exit 127
sh: 1: vitest: not found
```

No install or dependency mutation was attempted.

## Other executed verification

- `node scripts/security-audit-rbac.mjs` — exit 0, 24 checks, 0 warnings.
- `node scripts/check-api-error-boundaries.cjs` — exit 0, 121 routes scanned.
- `node --experimental-strip-types --check` on the nine production TypeScript paths and the permanent test — exit 0.
- `node --check` on both proof files — exit 0.
- Search of the seven routes confirms no remaining direct `requireOperationalCompanyId` or `assertUserCanOperateCompany`; each uses the read/write canonical admin binder and denial-status classifier.
- `git diff --check` — exit 0.
- Frozen package application to an archived base snapshot reconstructs all 12 manifest paths byte-for-byte — exit 0.

Supported Node 22 focused/full Vitest, app/test/script typechecks, ESLint, Next build, API contracts, and broader gates are **NOT_RUN** here and remain root-owned. The actual-source proofs are bounded source verification, not native database or production acceptance.

## Frozen owned paths and SHA-256

| Path | SHA-256 |
|---|---|
| `lib/admin/apiGuards.ts` | `b7781270dc0c7510ce955546d3d7cd00848191ebc1cb9527196921e3ddf73ce1` |
| `lib/tenant/scope.ts` | `970d65586514860f8092dcc06e18fccdc56ffdb6746257e7b3f909c2a3afc98a` |
| `app/api/internal/billing/period-locks/route.ts` | `d72d503c60e0f94d8f8dee30b4ba7acdb40b90234e61aeb7bd6cfee62ad23172` |
| `app/api/internal/billing/generate-underlay/route.ts` | `1373d0f2b7624d8da7de8567ba3d119426b42124e1ac17c5f8336c72decbccb8` |
| `app/api/internal/pricing/preview/route.ts` | `763e435f94f4e6744f4ebd5f27abe31f30194678f480dd8bfd286cef3c674803` |
| `app/api/internal/pricing/reprice/route.ts` | `c61f88c8d5537abcb8e5daf24cdca2349f2ab58166b9b2b645da5d8c98a20d6c` |
| `app/api/internal/pricing/lock-preview/route.ts` | `aa031f3699ab980550a137ffb5cc87408791a6d292d7078a774a5fddc775249f` |
| `app/api/internal/invoice-exports/[id]/route.ts` | `2210e913195041aada81d401be825578b075df7821ec09c17b79fb51b981ba0f` |
| `app/api/internal/invoices/[id]/provider-status/route.ts` | `8e5a6d3c1ebb6805cad6936a312072fe688a46ecb997a551b02c893b6ffc25c0` |
| `__tests__/api-default-company-authority-binding.test.ts` | `fb2b9f54e45e9e2379cfbe6443a5cd3c57fa381647b717867a89e04437aa331f` |
| `quality/audits/proofs/api-default-company-authority-regression.mjs` | `b2d9706154692a0df3524bcf074f3909a2f186a22b7f8c349b8ebce5d1f73775` |
| `quality/audits/proofs/api-invoice-get-company-authority-regression.mjs` | `e84d5d0423a2a7ae793fa2843adb77f45f0b8dfd60377586d9c6b32de04e7c81` |
| `.superpowers/sdd/2026-09-12-current-and-plan77-85/task-10b2auth-owned-files.json` | `7ab93a7943389563f1a325fece5cf15f3a78a7b8fe9f468ac7d2f2b84431c062` |
| `.superpowers/sdd/2026-09-12-current-and-plan77-85/task-10b2auth-review-package.diff` | `2d2a3feb8b88d0df88e36447b096b4e4798a687faf94d3356c5bd549785bec87` |

The review package is 92,058 bytes and contains the complete base-to-working-tree diff for all 12 implementation/test/proof manifest paths, including all three new files. Root coordination metadata and unrelated concurrent audit artifacts are excluded. This report is the remaining owned path; its final digest is reported out of band because it cannot contain its own digest.

## Process and boundaries

Applied systematic debugging, TDD/writing-good-tests, fp-check, variant analysis, code security, spec-to-code compliance, and verification-before-completion instructions. No subagent was used per the assignment. No dependency/lockfile, workflow, migration/SQL, generated type, Task 10b1 file, root memory, billing-catalog artifact, Git index/history, commit, push, external request, or production action was changed or performed.
