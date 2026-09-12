### Spec Compliance

- ✅ Spec compliant for the bounded Task10b1 implementation gate. Notification unknown root keys are rejected before reference normalization, canonical payload construction and the claim (`app/api/v1/customer/notifications/read/route.ts:85–106`). Quote create and validate enforce actual finite positive numbers and safe positive integer site counts before the respective claim/business calls (`app/api/v1/website/quote/route.ts:41–69,195–254`; `app/api/v1/website/quote/validate/route.ts:44–74,176–240`). Partner price checks the actual JSON value before resolution/pricing and retains its existing 422 field/error envelope (`lib/partner-api/business.ts:542–602`). No new consumption ceiling or shared-pricing change appears in the six-path package.
- ✅ Required-field roles are preserved: create's commercial missing-field block precedes the strict validators; validate's existing missing-assertion block also precedes them. The permanent missing-field controls assert the exact original envelopes (`__tests__/api-strict-schema-boundaries.test.ts:836–880`).
- ✅ The correction removes the permanent resolver-policy substitution. Its two module substitutions are the Supabase DB/RPC boundary and terminal `scheduleUsageEvent` only; real routes and the outer partner dispatcher are imported (`__tests__/api-strict-schema-boundaries.test.ts:506–519`). Controlled authentication, customer, publication, commercial, quote and resolver rows exercise actual policies; valid controls assert credential company/client propagation, quote persistence and read-only quote validation with the existing append-only audit event (`__tests__/api-strict-schema-boundaries.test.ts:672–734,804–834,925–964,1006–1061`).
- ✅ Genuine serialized invalid representations include literal `1e309`, strings, comma strings, booleans, null, arrays, objects, nonpositive values, fractional site counts and unsafe integers. Exact error assertions and zero claim/publication/quote effects accompany the invalid cases; partner cases also assert zero resolver I/O and exactly one authentication (`__tests__/api-strict-schema-boundaries.test.ts:736–802,882–923,966–1004`).
- ⚠️ Supported execution is pending. The reported aligned source evidence is 52 cases, baseline 10 pass/42 causal failures and working tree 52 pass/0 failures; this review did not repeat it. The supplemental VM harness substitutes framework/body readers and downstream quote/validation services, so it does not prove real full-engine integration or accepted Task10a body limits (`task-10b1-strict-schema-proof.mjs:20–61,289–305,474–552`; `task-10b1-fix1-report.md:39–103`). Permanent actual-module tests carry those integration controls but remain unrun locally.
- ⚠️ This is a task gate, not merge, native or production acceptance. Partner price idempotency remains Task10c; move-out, authenticated admin schemas, OpenAPI release work, SQL, full replay/types and wider RLS remain outside this package.

### Strengths

- The source change is small and local, with existing error classes rather than a new shared parser abstraction. `Number.isSafeInteger` closes both fractional truncation and unsafe integer representations without imposing a consumption ceiling (`app/api/v1/website/quote/route.ts:41–69`; `app/api/v1/website/quote/validate/route.ts:44–74`).
- Notification enforcement is placed before the canonical hash input rather than merely filtering ignored fields. Valid reference resolution and updates retain company/customer filters (`app/api/v1/customer/notifications/read/route.ts:87–106,108–127`).
- Permanent tests exercise the real resolver and quote engine with DB fixtures, including the resulting resolution and canonical event writes. This addresses the original report's explicit resolver seam instead of hiding it (`__tests__/api-strict-schema-boundaries.test.ts:243–348,506–519,1006–1061`).
- Test claims are bounded: eleven test blocks expand to 58 requests/controls, not 58 independent Vitest tests; the source proof and supported acceptance are explicitly distinguished (`task-10b1-report.md:64–88`; `task-10b1-fix1-report.md:129–134`).

### Issues

#### Critical (Must Fix)

None.

#### Important (Should Fix)

None.

#### Minor (Nice to Have)

None.

### Named focused checks and review boundaries

- **Routing:** Applied the repository task-reviewer/requesting-code-review instructions, code-review, differential-review and verification-before-completion. Compared the explicit brief and P84-SCHEMA-001/003 directly. Read AGENTS, active memory/checkpoint, API/auth/tenancy domain memory and relevant decisions/known-failures. The task-specific frozen-review limits governed over broad audit/delegation workflows. No subagents, broad security/database/performance audit, browser, UI, dependency installation or remediation workflow was needed.
- **Mid-function diff context / ordering and preserved identity:** Read the complete notification route and surrounding create/validate handlers because their three-line diff context cuts the edited functions mid-body. Checked parsing/authentication, missing-field order, claim placement and catches; notification context and tenant filters remain unchanged, and quote validation rejects before offer resolution (`notifications/read/route.ts:81–155`; `quote/route.ts:119–299,351–467`; `quote/validate/route.ts:139–330`). No body/auth code was edited.
- **Error path causing a preclaim write:** Checked the unchanged `completeIntegrationWriteIdempotency` guard because the new `OfferQuoteError` reaches the existing completion catch with a null record ID. It immediately returns before DB I/O (`lib/integrations/writeIdempotency.ts:188–196`). This refutes a possible validation-error write side effect.
- **Actual partner contract and whole create path:** Read the complete `createPrice` function, including the 256,000-byte read, credential auth context, pure input preparation, resolver call, calculation, response projection and failure handling (`lib/partner-api/business.ts:542–672`). Checked the actual `PriceRequest` schema, which specifies `number` and exclusive minimum zero (`lib/partner-api/businessOpenApi.ts:198–219`). No price idempotency was added or claimed.
- **Date fixture compatibility:** Checked the unchanged quote date parser and resolution expiry/readiness checks after noticing fixed date fixtures. The start-date parser validates the calendar date rather than requiring a future date (`lib/pricing/offerQuote.ts:199–216`); the fixed resolution expiry is 2030 and currently valid (`__tests__/api-strict-schema-boundaries.test.ts:279`; `lib/energy/resolutionBinding.ts:231–240,392–422`). This inspection does not establish future-time test acceptance.
- **Proof portability and publication lint surface:** Checked `sourceFor` and module loading. Source lookup is relative to process cwd, baseline lookup uses the explicit base SHA, and there is no `import.meta`, `__dirname` or SDD-relative runtime dependency (`task-10b1-strict-schema-proof.mjs:11–25`). Retaining these exact bytes at `quality/audits/proofs/api-strict-schema-regression.mjs` is path-portable when invoked from the repository root. It exposes an executable `.mjs` file to the hosted lint/type scope; that relocated path must pass the supported gates. The Node experimental stripping/VM compatibility rewrite and substituted downstream services remain supplemental limitations, regardless of path. No relocated file was written or lint acceptance inferred here.
- **Executed integrity checks:** Python SHA-256 computation verified all six author paths and seven coordination artifacts below. A read-only unified-diff parser compared all 12 current-side hunks byte-for-byte with the checkout and verified its six paths equal the manifest. Both checks succeeded. Read the full 2,057-line frozen package once. Initial repository-required `git status --short` and `git diff --stat` were read; no further Git commands or mutations were performed. No test suite or repeated 52-case proof was run; no unanswered behavioral doubt required a new runtime probe.
- **Preservation:** Only this review report was written. Other authors' source, tests, SQL, root memory, catalog/preparation artifacts, Git state, dependencies, workflows and external systems were not edited.

### Frozen-file verification

Base: `4d4fe075198ad61b9df85aa456e40965668549dc`. Review target: the frozen six-author-path working-tree package, not a new commit.

| File | Verified SHA-256 |
|---|---|
| `app/api/v1/customer/notifications/read/route.ts` | `ab99c0e45c994b5980bcd7bbc4ac8a29a29229177c11803790875bab656462b4` |
| `app/api/v1/website/quote/route.ts` | `9e952ee044fdb854a24a61859364f38e7132f78224bf3f3db91a9ddbee681c7f` |
| `app/api/v1/website/quote/validate/route.ts` | `6b333b16e9ebc6ee0ae7a9a6ee104d0fc773de95fe5a22d33faf141ddf599690` |
| `lib/partner-api/business.ts` | `1dcfc0cba8f678e5e2632c0252e720f199624ec3e9ff0aad3ae4af6f9c581100` |
| `__tests__/api-strict-schema-boundaries.test.ts` | `bc24b0d09bbba692d46d2ad3332a96a34163d9702fab54b629ca8529a54fe43d` |
| `task-10b1-strict-schema-proof.mjs` | `21f59d99ef579d0e423a1329bd4737f36489cef2e38ba312d676f5c935621345` |
| `task-10b1-fix1-report.md` | `19aa3072b29a6cd383e4a6cd3f35f076be554639e94f546e8a740b66ababd31e` |
| `task-10b1-fix1-review-package.diff` | `0a19e185b8e67bd35d891a9c9de33c2a0d8dcdea8fd602c83332094ca8f5526d` |
| `task-10b1-fix1-owned-files.json` | `2a75d1157c7a604ce733c6742d4f5da28491375703ce998945a82fdcaf3df128` |
| `task-10b1-fix1-delta.diff` | `e25ff81057106ad36b62c0a0bc29f51a87aa3c3873e73cffca064a4a9da4e145` |
| `task-10b1-report.md` | `8664635cc48ad1047299cfb872b630ee04cc2b84a503025995f06c758423f4e1` |
| `task-10b1-owned-files.json` | `2a75d1157c7a604ce733c6742d4f5da28491375703ce998945a82fdcaf3df128` |
| `task-10b1-review-package.diff` | `069ed2aa78858e750f5f6a77a28c858e6d4da4f5ea39d1e1f8490b9009717089` |

The task-prefixed artifacts in this table are under `.superpowers/sdd/2026-09-12-current-and-plan77-85/`. Production files match the original report's hashes; corrected test/proof match fix1. Original report/package/manifest hashes also match the preservation claims.

### Assessment

**Task quality: Approved. Findings: 0 critical, 0 important, 0 minor.**

The frozen implementation meets the bounded input-boundary requirements and preserves the existing execution contracts. The permanent test design now uses real policy modules with I/O-only substitutions; reviewed publication may proceed to obtain supported execution evidence.

**Pending gates:** focused permanent Vitest and full supported Node22 Vitest, compiler/script/test typechecks, ESLint (including the retained proof path), API contract/compatibility/parity checks, RBAC, production build and budgets after reviewed publication. Local dependencies are absent and ENOSPC forbids installs. The implementer's reported syntax/contract checks and supplemental RED/GREEN are not a substitute for these gates. No native, full replay/generated-types, production, merge or deployment acceptance is granted.
