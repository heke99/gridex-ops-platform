# Independent permissions, tenant isolation and database integrity review

Date: 2026-09-12. Reviewed baseline: `41786027` in the recovery worktree. Scope: attached masterplan points 77, 78 and 83; these are plan numbers, not migration ordinals. This is a bounded evidence review, not acceptance of these points or production parity. No customer rows, live database, storage objects, credentials, production mutations, source migrations or application code were accessed/changed by this reviewer. Only this report is written. Root owns integration, publication and memory updates.

## Routing and evidence boundaries

- Applied the repository's `AGENTS.md` operating contract, memory read order, complete source-to-sink review, explicit false-positive checks and verification-before-completion discipline. Read the scoped Supabase/Postgres security guidance, current state, authentication/RBAC memory and database/migration memory. Historical quality tenant/RBAC reports are seeds, never fresh acceptance receipts.
- This subtask is the independently bounded review lane requested by root. No new agents, worktree, architecture change, remediation, hook installation, UI work or dependency installation was performed. Root owns the complete baseline skill/scanner/PR workflow; this report does not claim that Semgrep, CodeQL, secret scanning, dependency scanning or a complete threat model ran here. Property-based authorization/state cases are proposed below, not claimed executed.
- The latest relevant timestamped function definitions were searched across all migrations, with complete function bodies and relevant callers/policies inspected. The canonical schema snapshot is supplemental evidence; neither it nor a latest filename proves the complete source-selection/replay chain or a deployed schema. Current memory explicitly leaves full replay, generated types and runtime-to-database binding open.
- Root reported `npm ci` failed with ENOSPC and removed partial `node_modules`. No install/retry was attempted. Existing dependency-free checks and Node 24's built-in TypeScript stripping permitted limited real-function probes with mocked I/O. No PostgreSQL behavior was executed.

## Current findings register

### PERM-01 — High, confirmed application defect: explicit target company is not the permission company

Complete examined path: `app/admin/webhooks/actions.ts::markWebhookDeliveryIgnoredAction` → `lib/admin/guards.ts::requireCompanyScopedActionAccess` → `requireAdminActionAccess` → `loadBaseAdminContext` → cookie-selected `canonical_authenticated_tenant_context` → target-membership check → service-role update of `webhook_deliveries` by submitted company and delivery ID.

`loadBaseAdminContext` correctly retains the selected company in `GuardResult.companyId`. However, `requireCompanyScopedActionAccess(companyId, requirement)` checks `requireAdminActionAccess(requirement)` before checking membership in the supplied company. The permission requirement is evaluated against the cookie company. The later check only establishes writable company status and an admin-like membership in the target. It never requires `base.companyId === companyId`, nor asks the SQL resolver for target-company permissions. The corresponding page helper has the same binding gap.

Reproduction executed against the actual `guards.ts` function bodies with mocked auth/RPC/memberships:

1. Synthetic actor has active admin memberships in A and B. A's effective permissions contain `integrations.write`; B's effective permissions contain only `customers.read` (e.g. different/custom role permission configuration).
2. Select A and call `requireCompanyScopedActionAccess('B', { anyOf: ['integrations.write'] })`.
3. The call succeeds and returns `companyId: 'A'`. Only the A-scoped canonical RPC is called.
4. Select B and make the identical B-target call. It throws `Forbidden`.

The webhook caller then writes B's matching delivery using `supabaseService`; there is no second permission decision between the successful helper and that mutation. This is a confirmed guard-contract defect and concrete source-to-service-write path, not an executed real database exploit. The fixture intentionally supplies different effective permission sets; whether existing customer roles happen to share grants is not an invariant that can repair the helper.

Related paths to review before a fix is called complete: `requireCompanyScopedAdminAccess`; `lib/tenant/entityGuards.ts` (its `TenantGuard` drops `companyId` and resolves operational scope again); `assertUserCanOperateCompany` (membership/lifecycle only); internal invoice routes that first call `requireAdminApiAccess` and then accept a body/query company. Root was notified of the invoice/API variant. Do not call each a new exploitable endpoint without checking its complete downstream path.

Targeted fix: resolve and cache effective permissions for the explicitly operated company, or reject an explicit company different from the guard's bound company and require deliberate selection first. Preserve platform-admin authority separately; do not silently merge permissions. Use that same bound company through downstream service calls. Add a real-guard and action-level two-company negative test with differing roles and explicit payload targets. The generic action guard's writable-membership check also checks *any* membership, not specifically `base.companyId`; include active A + paused B in the matrix.

### PERM-02 — High, confirmed source semantics defect; native runtime reproduction pending: overrides are not enforced by canonical authorization

Complete examined mutation path: `app/admin/users/[id]/actions.ts::addUserPermissionOverrideAction` (platform-admin gated) → `lib/admin/platformUserAccess.ts::runCanonicalPlatformAccessCommand` → `20260802203000_canonical_runtime_consistency_hardening.sql::canonical_manage_platform_user_access`, especially the complete `upsert_override`/`replace_overrides` branches and their transaction/audit/idempotency context. These store active global allow/deny rows in `user_permission_overrides` for an arbitrary existing target user, including a normal tenant user. The UI says role is base access and an override is individual allow/deny.

Actual authorization reads a different relation set:

- `20260902091000_company_scoped_permission_engine.sql::canonical_authenticated_tenant_context` delegates to the original scoped implementation, renamed by `20260810224500_canonical_review_remediation_v1.sql`.
- That original function in `20260810193450_canonical_access_provisioning_runtime_v1.sql` aggregates only active `user_roles` → active `roles` → allow `role_permissions` → `permissions`. It does not consult `user_permission_overrides` or `user_permissions`.
- `gridex_get_user_permissions_in_company` in the September 2 permission migration also omits overrides; it separately unions `user_permissions`, so it already disagrees with canonical page/API authorization.
- The September 2 RPC follow-up's latest `gridex_get_user_permissions` also omits overrides.
- `lib/auth/requirePermissionServer.ts`, page/action guards and `lib/admin/apiGuards.ts` consume canonical permissions directly. A normal actor with a role grant is therefore still allowed after an active deny override; an allow-only override cannot grant a missing canonical permission.

Reproducible isolated SQL case (not run): synthetic active/confirmed user, active profile and membership, active company-scoped role granting `integrations.write`; add active global override `{permission_key: 'integrations.write', effect: 'deny'}` through the canonical command; assume the synthetic user's JWT; compare canonical context and scoped permission function against the expected denied result. Repeat allow-only, inactive/expired, global/company-specific, conflicting allow/deny and missing-override-RPC cases. Native execution must use the exact effective schema and explicitly prove command admission, not just insert an invalid fixture shape.

False-positive check: legacy `lib/rbac/getUserPermissions.ts` does apply overrides after coded role-profile fallback, but current page/API authorization no longer calls it. The sole application caller found is the platform-only user detail page displaying effective permissions. It cannot repair the canonical enforcement path. It is also company-blind, falls back to coded profiles even on RPC errors, and silently ignores override-RPC errors; treat it as misleading diagnostic output, not as the authoritative engine. The September RPC hardening revokes the base resolver from authenticated callers, which makes this display's fallback especially material.

Targeted fix: define one effective-permission algebra (company-bound roles, direct grants, override scope/activity/validity, deny precedence, intentional platform-admin behavior) and call it consistently from canonical context, RLS predicates, storage authorization and diagnostic display. Use a forward migration; preserve existing immutable sources and require SQL fixtures before claiming resolution.

### PERM-03 — High, confirmed source policy mismatch; native/storage runtime reproduction pending: paused tenants retain storage write authorization

Complete examined policy path: four `storage.objects` customer-document policies in `20260806152004_gridex_aud_001_storage_helper_private_schema.sql` → private `customer_document_path_allows(name, access)` → latest `gridex_actor_has_company_permission` in `20260902100000_rpc_surface_and_permission_scope_corrections.sql` → `gridex_get_user_permissions_in_company`.

The private helper rigorously verifies seven path segments, UUID shape, document type, filename, customer/company and optional site/customer/company. Read requires `masterdata.read` or `switching.read`; insert/update/delete require corresponding write permission. Update checks both existing and new name. These are existing fixes, not missing path guards.

However, read and write both use the same actor predicate. For a normal active member with a write grant it accepts a company with `is_active = true` and status outside `('archived','suspended','pending_deletion','deleted')`. In particular `paused` passes. It does not call `gridex_can_write_company`, `gridex_is_current_session_allowed` or an operation decision. The August lifecycle migration only adds restrictive policies to `public` company-scoped relations, not `storage.objects`. Thus its active/onboarding-only write rule does not narrow this storage path.

Synthetic SQL/storage reproduction to execute in an owned isolated fixture: valid active actor/profile and member of A, required scoped read/write grants, company A `status='paused', is_active=true`, existing A customer and valid customer-document path. Assert public `gridex_can_write_company(A)` is false and private `customer_document_path_allows(path, 'write')` is also expected false; current inspected predicate computes true. Then verify actual authenticated INSERT/UPDATE/DELETE are rejected while same-tenant SELECT is allowed. Use A/B path swaps and platform roles as independent controls. `closed` and `deleted_test_only` also are not in the predicate's deny list, but whether a real lifecycle transition leaves `is_active=true` is a separate runtime condition; do not report those as observed incidents.

Targeted fix: preserve path/ownership checks and apply the authoritative session/lifecycle read/write predicate according to `p_access`. Do not change shared permission helpers globally without reviewing their Ediel command callers. Add explicit storage lifecycle matrix; verify Storage API and SQL semantics rather than only matching policy text.

### PERM-04 — Medium hardening gap, confirmed wrapper behavior; no reachable caller exploit established

`lib/supabase/tenantDb.ts` stamps the selected company on insert/upsert and filters select/update/delete. Its `update(values)` forwards `company_id` unchanged. An executed actual-function probe confirms `tenantDb('A').from('example').update({ company_id:'B' })` constructs an old-row filter `company_id=A` while forwarding new ownership B. No database call occurred.

The wrapper therefore does not guarantee immutable tenant attribution on update, despite its broad documentation. Whether a real call can move a row depends on validated callers and table constraints; current caller search did not establish such an input path. `upsert` also stamps rows but does not itself establish that an arbitrary conflict target includes company identity. Keep both as bounded design/test gaps, not a claim that all upserts leak data.

Targeted fix: reject or overwrite conflicting company fields on update and constrain supported upsert conflict keys; add tests for exact tenant immutability. Keep the explicitly named `unscoped()` escape hatch visible and restricted by caller authorization. Aggregate direct-call ratchet success is not evidence that any individual query is scoped.

## Canonical semantics and ownership matrix

| Boundary | Current examined behavior | Limit or remaining decision |
|---|---|---|
| Identity | Canonical context derives auth.uid, requires active profile, nondeleted/unbanned confirmed user; compares returned user ID with authenticated user in TS | Direct predicates vary; global parity not proven |
| Membership | Canonical selection requires active membership and active company-scoped assignment; scoped permission RPC requires active membership | TS operational listing checks `status='active'`, but not `is_active`; no negative native membership fixture here |
| Selected company | Canonical context scopes role permissions to selected company; TS carries it in GuardResult | Explicit target-company helpers do not rebind it (PERM-01). Unknown selected-company cookie does not actually fall back in the original SQL: its predicate requires equality when nonnull, contrary to the TS comment |
| Company lifecycle | Public restrictive read: active/onboarding/paused; write: active/onboarding; removed/stopped ordinary tenants excluded | Storage and service-role paths require independent lifecycle checks |
| Roles | Active role assignments and active role rows join to allow role-permission entries; scope-consistency trigger rejects tenant-bound platform role and global company role | Legacy `gridex_get_user_roles` returns a role-name union including memberships; `scope.ts` still infers platform admin from it rather than canonical flag. No admitted escalation fixture established |
| Platform administration | Main page/API guards trust canonical boolean. Canonical platform predicate recognizes global roles or active `admin_users` with active identity | Deliberate page/action bypass means override behavior for platform admins must be expressly defined, not assumed identical to normal users |
| Permission helpers | Global resolver intentionally answers “held in any active membership” for shared data; separate company resolver exists | A company membership check plus global permission union is not a substitute for target-company permissions; inspect actual policy compositions before claims |
| Overrides/direct grants | Canonical command stores overrides; legacy display applies them; SQL enforcement omits overrides, context omits direct grants | PERM-02, explicit algebra required |
| RPC exposure | September follow-up revokes both permission resolvers from anon/authenticated/PUBLIC and allows authenticated wrapper predicates | Arbitrary-user boolean wrappers remain callable; do not claim all RBAC RPC surfaces are self-only. Fresh grants/advisor snapshot required |
| Storage | Private path helper binds company/customer/site and validates names; authenticated policies enforce read/write permissions, including both sides of update | PERM-03 lifecycle mismatch; no actual Storage API test |
| Application DB | `supabaseService` paths bypass RLS by design; wrapper applies company filter/stamps | Cross-tenant correctness still depends on authorization, row graph constraints and callers; PERM-04 |
| Entity graph | `entityGuards.ts` checks customer/company and site/contract/PoA/underlay references; relationship migration supplies seven row triggers | Same-company does not itself prove every same-customer relation; missing/null parent behavior remains separately governed by FKs/nullability |

## Point 83: present constraints, earlier fixes, remaining gates

Reviewed complete forward sources:

- `20260902090000_tenant_scoped_unique_business_keys.sql`: metering-point identifiers, customer numbers and legal hashes scoped by company; one own supplier per company; separate shared/tenant counterparty uniqueness; own-supplier requires nonnull company. Historical F-8/F-9/F-10/F-11 are not current missing-migration findings. Market-wide actor identifiers and tokens can legitimately remain global.
- `20260902095000_lock_customer_chain_with_composite_keys.sql`: validated parent `(id,company_id)` key and discovered child composites. `MATCH SIMPLE` explicitly does not check a row with a null constituent; nullable ownership needs table classification, not an automatic “cross-tenant FK solved” conclusion. The source's general CASCADE and SET NULL actions require lifecycle-specific review.
- `20260905141608_canonical_tenant_relationship_guards.sql`: seven tenant guards restored; 18 reference paths; preserves existing snapshot guard; assertion only compares when both company values are nonnull. Missing/null parents are deliberately left to FKs/RLS. This is not itself a defect where those constraints exist.
- `20260909120000_canonical_role_permission_uniqueness_reconstruction.sql` and `20260909120200_canonical_role_permission_identity_reconstruction.sql`: immediate pair uniqueness and mandatory UUID grant references; reject ambiguous/conflicting identity inputs; preserve recognized FK actions/OIDs. No justification for inventing replacement IDs or changing parent delete actions.
- `20260904120000_canonical_tenant_invariant_convergence.sql`: classification/RLS/view/ACL convergence forward source exists. It does not establish a successful full replay today.

`quality/audits/SYSTEM_DATA_INTEGRITY_ACCEPTANCE_2026-09-09.md` is the authoritative historical acceptance contract, not a new run. It records catalog-only evidence of 502 table PKs, existing FK/check validation flags, and 14 composite SET NULL/mandatory-column tensions among 23 reviewed composites. It expressly leaves customer deletion graph, protected history, partial storage cleanup and actual trigger ordering unresolved. This review neither queried those rows/catalogs nor re-executed deletion. Preserve those gaps rather than turning validated constraint flags into a point-83 pass.

The tenant invariant gate is useful but narrower than the requested matrix: it checks catalog shape/classification, selected data null counts, lexical unique-index exemptions and role-scope rows. It does not execute CRUD denials, prove all `WITH CHECK` meanings, enforce override semantics, cover storage, or assess whether every exempt transitive key is genuinely bound. Its row-count checks mean it must not be casually run against customer production data in this read-only subtask.

## Point 77: required two-tenant negative matrix versus existing evidence

| Surface | Existing examined evidence | Still required |
|---|---|---|
| Shared guard/application | Actual mocked guard probe proves PERM-01; tenant-isolation Vitest covers own-supplier filters and authoritative platform boolean | Real guard/actions with A high privilege/B lower privilege, reverse pair, cookie/explicit target mismatch, no membership, removed/inactive membership, paused company, unknown cookie and platform selection |
| Public table SELECT | Restrictive lifecycle definitions + static catalog gate | JWT actor A cannot read B row; B cannot read A; permitted own rows and mixed/shared rows distinct; exact role grants/policy combination |
| Public table INSERT/UPDATE/DELETE | Guard SQL fixture covers cross-company reference insert/update/reassignment | Actor A cannot insert B ownership, update/delete B existing rows, or update A owner to B; assert row counts and unchanged before/after, not only “no exception” |
| Customer graph | `scripts/sql/canonical-tenant-guard-behavior.sql` has 18 insert/update/reassignment cases and snapshot missing/unknown contract controls | Full effective-schema FK/trigger composition, null ownership, same-tenant wrong-customer references, retained/deleted child behavior and concurrent mutation |
| RPC | Company-scoped resolver and ACL forward sources; contract isolation SQL | Every exposed write RPC authenticates actual actor and target; denied/granted same fixture; SECDEF arbitrary actor inputs; exact SQLSTATE versus unrelated error |
| Storage | Validated customer/site path policy source | Two-tenant CRUD, rename/upsert checks, paused writes, revoked session, anonymous denial, signed/direct API paths |
| Service role | Wrapper/source probes + ratchet | Real action reaches no service mutation after denial; graph FKs block cross-tenant writes under bypass role |

`scripts/gridex-contract-multitenant-isolation-test.sql` is a bounded contract RPC/feed test using a service-role claim and supplied company/actor IDs. It is not authenticated-user RLS CRUD coverage. Its negative publish/delete blocks catch any exception except the sentinel, so an unrelated fixture error can satisfy the negative: retain positive controls and assert specific errors/state. Do not run its package script against ambient DATABASE_URL here.

## Verification commands and outcomes

| Command / probe | Fresh result | Exact coverage |
|---|---|---|
| `node scripts/security-audit-rbac.mjs` | PASS, 24 reported checks, 0 warnings | Presence/absence text checks and reviewed service-client file list; not RBAC semantics |
| `node scripts/check-service-role-tenant-ratchet.cjs` | PASS, 2399 sites versus baseline 2402 | Aggregate source-call count; baseline deliberately not updated |
| `node scripts/gridex-tenant-integrity-regression.cjs` | PASS | Four immutable hashes and source assertions for auditor/ACL/views/index/UI; does not execute auditor or database |
| Node actual `guards.ts` probe below | PASS (defect reproduced) | Selected A/B permission decision and target B membership with mocked I/O; no React request-cache or RPC runtime |
| Node actual `tenantDb.ts` probe | PASS (wrapper limitation reproduced) | Forwarded new owner and old-row filter inspected; no SQL, RLS, PostgREST or FK execution |
| Existing Vitest targeted set | NOT RUN, deps unavailable after root ENOSPC | Candidate command below |
| Native PostgreSQL/RLS/storage | NOT RUN | Requires exact owned isolated PG17 effective schema, synthetic fixtures and independent review |

First guard-probe attempt stopped on `assert.deepStrictEqual` because VM objects have a distinct prototype; this was a harness assertion issue, not a guard rejection. Replacing that assertion with a scalar field comparison allowed the complete probe to pass. No application code changed between attempts.

Safe targeted command once root's hosted dependency environment is available:

```sh
npx vitest run __tests__/tenant-context.test.ts __tests__/tenant-isolation-remediation.test.ts __tests__/tenant-rls-lifecycle-hardening.test.ts __tests__/tenant-scope-request-cache.test.ts
```

These files are local/mock/source tests. `tenant-context` tests frozen identity and matching/mismatched claims. `tenant-isolation-remediation` has seven own-supplier/platform checks plus one literal guard-object check; that last check does not call the canonical resolver. `tenant-rls-lifecycle-hardening` checks migration substrings. `tenant-scope-request-cache` checks source strings, not real request isolation. Passing them cannot close PERM-01/02/03 or point 77.

Existing owned SQL fixture candidate: `scripts/canonical-tenant-guard-selftest.mjs`, which explicitly needs pinned PGlite via `GRIDEX_PGLITE_MODULE`; inspect/retain its red/green controls, two migration passes, authenticated/service_role cases and newer snapshot preservation. Not run because no disposable dependency was installed and no native DB was available. PGlite fixture success is not canonical PG17 full-schema acceptance. Parent's existing hosted native lane is the appropriate final runtime gate.

## Reviewable remediation batches

1. Bound-company authorization: fix PERM-01 with failing real-function/action tests, independent review, targeted hosted quality tests. Include any API variants proved by root; avoid broad guard replacement without consumer review.
2. Canonical permission semantics: add explicit override/direct-role semantics and forward SQL helpers, compare page/API/RLS/storage decisions over the same synthetic actor/company matrix. Separately verify RPC ACLs and shared masterdata behavior so earlier F-18 regression is not reintroduced.
3. Storage lifecycle: preserve private path helper and add read/write lifecycle/session gates with two-tenant native/storage negatives. Do not weaken row ownership to make paused data writable.
4. Database integrity: finish exact replay/types/parity prerequisites, then the explicit FK/nullability/lifecycle matrix and protected customer-deletion graph. Treat existing historical catalog tensions as open until synthetic final behavior is demonstrated. Wrapper immutability can be a small independently reviewed change, but is not a substitute for database constraints.

## Persisted executable reproduction and safest target-context boundary

Root requested that the reproduction be retained. It is saved as `permissions-guard-repro.mjs` beside this report. Fresh command:

```sh
node .superpowers/sdd/2026-09-12-current-and-plan77-85/permissions-guard-repro.mjs
```

PASS on Node 24.19.0: reproduces PERM-01 using the actual complete `guards.ts` and `markWebhookDeliveryIgnoredAction` bodies, and the actual `accessModel.ts`, `roleKeys.ts` and `lifecycle.ts` pure helpers. Only auth/RPC/membership/framework/DB I/O is replaced. The fake DB records B's `webhook_deliveries` update using A permissions, then proves B-selected rejection adds no mutation. The same script preserves the actual `tenantDb.ts` ownership-forwarding probe. It is deliberately a vulnerable-behavior reproduction, not a permanent green acceptance test: invert the assertions when creating the remediation regression. No application/source migration change or real DB query occurs.

The smallest fail-closed remediation is to require the ordinary actor's returned `GuardResult.companyId` to equal the explicit target before checking/using its permissions, and check writability for that selected company, not any membership. A more flexible API can resolve `canonical_authenticated_tenant_context({ p_selected_company_id: targetCompanyId })` directly for the authenticated actor and verify its returned company ID exactly; do not use a service-role arbitrary-user context or the company-blind legacy permission fallback. Cache that resolver only per request and by target company. Keep explicit platform authority separate. Canonical context currently returns `authorized=true` even when no selected company is resolved, so the returned-company check is required. Native override/storage work remains a separate forward-migration gate.

No point is marked complete. No production acceptance, live schema equivalence or full two-tenant CRUD matrix is asserted.
