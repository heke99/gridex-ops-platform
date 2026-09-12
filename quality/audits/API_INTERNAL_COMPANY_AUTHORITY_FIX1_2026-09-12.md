# Task 10b2auth fix1 report — review findings I1 and I2

**Result: DONE_WITH_CONCERNS.** Both Important findings from `task-10b2auth-review-1.md` (SHA-256 `a707b17288d245a1f60300ca51ae6a84df788f307c8249745bdf38cf03b2f545`) are addressed. Production code and behavior are byte-for-byte unchanged from the first frozen candidate. The permanent Vitest suite remains unexecuted locally because this worktree has no dependencies and installs are prohibited.

## Corrections

### I1 — ordinary missing canonical binding

The permanent real-import suite now has eight additional cases, one for every in-scope handler. The fixture is explicitly named and commented as a malformed canonical-RPC response/fault injection, not a valid SQL state. It returns:

- `authorized: true`;
- `is_platform_admin: false`;
- `selected_company_id: null`;
- all required `billing.read`, `billing.write`, and `pricing.write` permissions.

This lets the actual `requireAdminApiAccess` permission guard succeed before the actual route and company binder execute. Every handler must then return 403 with its route-specific sanitized internal error code, without parsing a request body or reaching DB, RPC, business, or provider I/O. Invoice-export and provider-status cases supply explicit company B while canonical company remains null, covering the requested explicit-company variants.

The prior valid SQL-shaped A/B/reversed/cookie cases, ordinary inactive membership/assignment cases, permission denials, lifecycle cases, and platform cases remain intact. The permanent suite now expands to **71 cases**: the original 63 plus eight malformed-context defensive cases.

### I2 — legacy actual-source loader compatibility

`quality/audits/proofs/api-company-authority-regression.mjs` now exposes the actual `CompanyAccessError` class from the loaded `lib/tenant/scope.ts` source and injects it into the actual `lib/admin/apiGuards.ts` VM. A focused assertion directly calls the loaded `assertAdminApiCompanyAccess` mismatch path and requires rejection with `error instanceof tenantScope.CompanyAccessError`. An arbitrary `ReferenceError` can no longer satisfy the authority-error proof.

The unchanged legacy retry route still returns its established generic 500 envelope and reaches no reads/effects for the mismatch. This correction changes proof fidelity only.

A bounded manual-loader search found four loaders reaching `apiGuards.ts`: the two new Task 10b2auth proofs already expose/inject the actual class; the legacy proof was fixed; the two SDD probe loaders expose and call only `requireAdminApiAccess`, whose execution does not reach `CompanyAccessError`. No additional evidenced loader break existed, so no other file was changed.

## Verification

```text
node --disable-warning=ExperimentalWarning quality/audits/proofs/api-company-authority-regression.mjs
exit 0
PASS actual CompanyAccessError dependency, retry route and Ediel route/helper deny A/B effects; blank/omitted/scoped helper contracts hold
```

Other focused checks:

- `node --experimental-strip-types --check __tests__/api-default-company-authority-binding.test.ts` — exit 0.
- `node --check quality/audits/proofs/api-company-authority-regression.mjs` — exit 0.
- Bounded `rg` search over `quality/audits/proofs`, the task SDD directory, and scripts for manual `apiGuards`/tenant-scope loaders and authority symbols — exit 0; disposition recorded above.
- All nine production SHA-256 values exactly match the original frozen report — confirmed.
- Original report/package/manifest SHA-256 values remain exactly `9327539d...`, `2d2a3feb...`, and `7ab93a79...` — confirmed before packaging.
- `git diff --check` — exit 0.
- Full-package application to exact base blobs reconstructs all 13 candidate paths byte-for-byte — exit 0.
- Original package followed by the scoped fix1 delta reconstructs both corrected paths byte-for-byte — exit 0.

The permanent suite was not retried: the original local attempt already established `vitest: not found`, and the assignment prohibits installs. Root owns supported Node 22 focused/full Vitest, typechecks, lint, build, and broader acceptance after review.

The first package-reconstruction attempt tried to expand the entire repository archive under `/tmp` and stopped before applying the package because the shared overlay had no free space. A bounded retry used `/dev/shm` and seeded only the exact base blobs named by the manifests; both reconstruction checks passed. No repository file was affected by the failed temporary attempt.

## Frozen full candidate paths and SHA-256

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
| `__tests__/api-default-company-authority-binding.test.ts` | `3cdcb49fad73e5138e457c252ff9235a5263119ad21580f4558621cf2934c1f1` |
| `quality/audits/proofs/api-default-company-authority-regression.mjs` | `b2d9706154692a0df3524bcf074f3909a2f186a22b7f8c349b8ebce5d1f73775` |
| `quality/audits/proofs/api-invoice-get-company-authority-regression.mjs` | `e84d5d0423a2a7ae793fa2843adb77f45f0b8dfd60377586d9c6b32de04e7c81` |
| `quality/audits/proofs/api-company-authority-regression.mjs` | `18d098c5d511b9a6e9d5175e8027eed4e5f88953548e0d8048362729482d0d06` |

## Frozen fix1 artifacts

| Path | Bytes | SHA-256 |
|---|---:|---|
| `task-10b2auth-fix1-owned-files.json` | — | `f031f739ab6f2efd24853c7849fde5bfdde0c85c51c1b1d2c92189f6f4953f48` |
| `task-10b2auth-fix1-review-package.diff` | 95,334 | `93a653c946d078f20533a018e648edaf93a919cc54cb231c83694b31007db6b5` |
| `task-10b2auth-fix1-delta.diff` | 8,333 | `1fa5403eed00c7ca3ae323adfac28da7208a757796a41b7c64543a75b453d683` |

The full package is the base-to-current 13-path candidate. The delta contains only the permanent test and legacy proof changes relative to original package `2d2a3feb...`. This report is the remaining fix1 artifact; its digest is reported out of band because it cannot contain its own final digest.

No production, dependency/lockfile, SQL/migration, generated type, workflow, root memory, Git/index/history, provider/network, Task 10b1, billing-catalog, or unrelated task file was changed. No subagent was used.
