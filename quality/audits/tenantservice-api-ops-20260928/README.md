# Tenantservice/API/OPS — checkpoint 2026-09-28

This directory tracks the independent tenantservice initiative. It does not supersede the Ediel checkpoint in `.agent-memory/` or import paused PR #310. Base: remote `main` `d7eaa4b0b880b7280d8f164630a6cdb51baabba8`; branch: `codex/tenantservice-api-ops-20260928`.

## Status

**P0 incomplete. P1 and P5 partial. No phase accepted.** The 75 supplied acceptance IDs are in `requirements.csv`; none is fully accepted. T04/T05 have only mocked server-boundary evidence for the bounded resolver fix. T53 has a mocked PostgREST boundary regression. U01/U02 have static discovery evidence only. The other 70 entries are unverified.

`manifest.json` and its JSONL files contain 147 OPS page files, 3,439 lexical UI control candidates across `app/admin`, `components/admin`, `components/tenant`, `components/customer`, 121 API route files and 101 admin action files. Regenerate with `node scripts/tenantservice/inventory.mjs`. The scanner does not execute a control, resolve dynamic imports, infer roles, prove a server mutation, or establish browser behavior. IDs are stable for the same file/control order. Every row remains `STATIC_CANDIDATE` until traced and tested. Some controls are inputs rather than distinct business actions; shared components need context-specific review. The inventory is a seed, not U01/U02 completion.

## Verified code path and bounded change

`lib/customer-portal/customerResolver.ts` previously called `ensureCustomerPortalUserLink` during ordinary `resolvePortalCustomer`. That writer set `role: 'owner'`, `status: 'active'`, `is_active: true`, and `verified_at` on an existing account. When its active-account query excluded a disabled row, it could try inserting a new active account. A read request could therefore alter authorization state. This is a source-confirmed defect; the regression reproduced attempted mutations with an in-memory service adapter, not a real database.

The resolver now reads an existing active account or identity for a presented user ID, rejects conflicting presented identifiers and does not invoke the link writer. An absent or disabled link cannot fall through to weaker customer attributes. The separate website application writer retains its existing call sites; a repeat on an existing account now refuses an inactive account and cannot rewrite its role, active status, or verification timestamp. New link issuance and the website application's actual identity proof are **not** accepted by this change.

The native Mina sidor context in `lib/customer-portal/db.ts` had an independent stale-flag path: it queried `is_active=true` without requiring `status='active'`. A second RED/GREEN test reproduced customer data loading for a disabled status and now requires both flags in the query and returned row before reading customer data. This is still mocked service-boundary evidence, not a native DB/RLS result.

Evidence: `__tests__/customer-portal-resolver-read-only.test.ts` (three original RED cases, then six PASS with the fix), `__tests__/customer-portal-context-status.test.ts` (one original RED case, then two PASS), app and test typecheck, scoped ESLint, `scripts/gridex-multitenant-website-application-flow-regression.cjs`. Native database, deployed runtime, provider/issuer binding, sync retry and browser tests remain outstanding. No production data or environment was changed.

The broader local Vitest run on Node 24 returned **6,222 passed / 2 failed** in 387 files. The two Ediel wrapper tests parse Node's `# tests` TAP lines, while Node 24 printed `ℹ tests`; both underlying Node test scripts exited successfully. The project pins Node 22 in `.nvmrc` and CI. This is an environment-specific local failure, not a passing full-suite claim; exact-head CI on Node 22 remains required. App and test TypeScript projects and scoped ESLint passed locally.

`listTenantSupportCases` now applies its support predicate in PostgREST before limit/offset. The predicate uses typed JSON metadata truth or an anchored source regex with literal underscores; the service still checks the exact predicate on returned rows. `__tests__/tenant-support-list-pagination.test.ts` first failed with 250 newer ordinary cases, then passed for two pages of matching cases with tenant/customer/status constraints. A read-only SQL `VALUES` fixture confirmed that JSON boolean `true` and the exact source prefix match while string `"true"` and a wildcard-like prefix do not. This is still a mocked PostgREST boundary test, not an end-to-end query against the actual table; the public route/UI and full T53 acceptance remain open.

## Open paths, classified by current evidence

| ID | Status | Source trace and remaining proof |
| --- | --- | --- |
| F01 | Bounded source defect corrected; native unverified | Resolver read formerly invoked the website link writer. Explicit writer still has separate trust and transaction questions. |
| F02 | Source-confirmed divergence; behavior unverified | `app/admin/customers/[id]/profile-actions.part-1.ts` writes a full customer row, then primary contact, then audit; `app/api/v1/customer/profile-update/route.ts` writes the customer directly and records completion separately. No shared atomic contact command or revision is established. |
| F03 | Source-confirmed exposure path; runtime unverified | `lib/customer-portal/db.ts:listPortalCases` selects all customer cases including `description` and `next_action`; `lib/customer-cases/support.ts:publicSupportCase` emits `next_action`. The latter also creates internal next actions. Classify case/message fields and close every API/UI/webhook path before customer release. |
| F04 | Bounded query correction; native unverified | `listTenantSupportCases` previously filtered after the limit; it now passes `supportOnly` and offset into `listCustomerCases` so the database filters first. Mocked paging regression passes. Public route/UI and native pagination proof remain open (T53). |
| F05 | Suspected revocation bypass; reproduce in native DB | `app/api/v1/customer-portal/sync/route.ts:upsertIdentity` writes `status` through an upsert keyed by tenant/provider/external ID. `lib/website/customerApplicationCommunication.ts:upsertPortalIdentity` also upserts active. Check disabled identity preservation, ownership and concurrent retries. |
| F06 | Architecture gap; proof pending | `externalApi.ts` uses API-client scope and client-presented customer identifiers. The API client alone does not prove the end user's delegated customer authority. Specify independent issuer-bound assertion and per-action proof before claiming T02/T06/T07/T30/T54. |
| F07 | Source-confirmed non-atomic writes; failure behavior unverified | `lib/api/strictRequest.ts` claims idempotency before the callback, then completes it after separate writes. A crash between business commit and idempotency completion cannot be declared safe. |
| F08 | Scope pending | Billing resolver parity, tenant RBAC, RLS/grants/RPC, UI controls, support attachments and the end-to-end journey have not been verified. |
| F09 | Dev catalog observed; current deployment unknown | A read-only catalog review found `authenticated` table grants and tenant write policies for portal accounts in the older dev schema. Restrictive SELECT guards make its permissive `true` SELECT policy tenant-bound; there is no permissive authenticated identity write policy in that snapshot. Staging has no portal tables. See `db-catalog-snapshot.md`; do not infer production exposure or current behavior. |

Do not interpret a source-confirmed path as proof of an exploitable production condition. Verify actual grants, active schema, tenant data contracts and isolated runtime before assigning final severity or completion.

## Next implementation sequence

1. Reproduce F05 with a native isolated schema and verified blocked-account fixtures. Trace the website application and sync call chains, including provider and issuer; ensure revocation cannot be undone by normal retry.
2. Define the tenant/customer/field policy and delegated customer proof before widening customer-facing API calls. Test direct DB/RPC alternatives and active grants.
3. Implement the shared atomic contact command for OPS and API, with resource revision, audit, idempotency and outbox in one local transaction. Do not route a Server Action over loopback HTTP.
4. Complete F03/F04 support visibility/listing with explicit public DTOs, native database pagination proof, negative tenant/customer tests, and public route/UI coverage.
5. Complete manual UI action classification and browser coverage from the static inventory; carry the full P0–P8 matrix forward.

## Skill routing and boundaries

Applied: repository worktree isolation; installed Next.js route documentation for the pinned Next 16.3.5; Supabase auth/RLS/grant guidance; TDD red/green, verification-before-completion, source-grounded threat modeling. Conditional: database and performance optimization only after isolated schema and measured baseline; React/UI review when actions are traced. Parallel-agent skills skipped because this task has one active bounded implementation and no delegation request. The repository-wide Quality Playbook and codebase-document generator describe larger independent workflows; their full deliverables are not claimed here. User's requested code delivery takes priority over their phase-pause instructions.

Supabase's current [API security guidance](https://supabase.com/docs/guides/api/securing-your-api) distinguishes grants from RLS; both require inspection in the actual exposed database. The threat model maps to [OWASP ASVS 5.0.0](https://owasp.org/projects/asvs/) level 2 as a verification target, not a certification claim.
