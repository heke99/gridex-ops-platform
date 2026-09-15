# Permission diagnostic canonical contract

Date: 2026-09-12
Scope: bounded read-only point-78 follow-up; no application, SQL, workflow, memory, index, dependency, production, or repository-history mutation.

## Conclusion and classification

`lib/rbac/getUserPermissions.ts` should be retired rather than repaired. It is a second permission engine whose company-blind coded-role fallback and best-effort error handling cannot represent the settled Task11 algebra. The current sole caller is already admitted as a platform administrator, so this is a confirmed **platform diagnostic-integrity mismatch**, not a demonstrated ordinary-user authorization bypass or ordinary-user disclosure path.

After Task11a settles the canonical company and shared array functions, the smallest source-backed replacement is a service-only target-diagnostic wrapper that delegates to the canonical **shared** array for the target. The page has no target-company selector, so a company-specific result would invent a scope. The count must be labelled as “held in at least one eligible active company / canonical shared scope,” not as permission in every company.

## Current complete path

| Boundary | Current signature / behavior | Evidence and consequence |
|---|---|---|
| Page admission | `requirePlatformAdminAccess(): Promise<GuardResult>` | `app/admin/users/[id]/page.tsx:43` admits the request before loading the target. `lib/admin/guards.ts:122–180,200–205` authenticates the current session through `canonical_authenticated_tenant_context(uuid)`, requires the returned user ID, and uses its authoritative `is_platform_admin`; canonical-context errors are surfaced rather than converted to permissions. |
| Target detail loader | `getAdminUserById(userId: string)` | `lib/rbac/getAdminUserById.ts:58–130` uses `supabaseService` for auth-admin lookup and raw active role/override display. Query errors throw. It does not calculate effective permissions. |
| Parallel display resolver | `getUserPermissions(userId: string): Promise<string[]>` | `app/admin/users/[id]/page.tsx:46–55` runs it beside the target loader and converts its result to the count displayed at lines 215–216. `lib/rbac/getUserPermissions.ts:152–186` uses the request-session client, not the service client. |
| Shared permission RPC | `gridex_get_user_permissions(uuid) returns text[]` | `20260902100000_rpc_surface_and_permission_scope_corrections.sql:40–97` defines “held anywhere in an active membership” shared-masterdata semantics. Lines 189–190 revoke it from `anon`, `authenticated`, and `PUBLIC`. No migration grants this function directly to `service_role`; its execution must not be assumed. Task11a is expected to make this shared array use the settled per-company algebra before union. |
| Override and role RPCs | `gridex_get_user_permission_overrides(uuid) returns table(permission_key text,effect text)` and `gridex_get_user_roles(uuid)` | The override body applies active and inclusive validity filtering (`20260526_debug_step1_2c_full_schema_code_alignment.sql:223–240`). The latest boundary loops over every non-owner role and revokes all privileges on both functions (`20260911114443_canonical_user_rbac_customer_alignment_boundary.sql:31–40`). They therefore are not viable request-session arbitrary-target diagnostics. |
| Silent divergence | Best-effort empty RPC results plus coded profiles | `getUserPermissions.ts:155–174` converts base and override errors to empty arrays, ignores role-RPC errors, queries memberships, and adds hard-coded profiles. Because the override error becomes “no denies,” lines 176–184 cannot subtract a real deny. Errors are indistinguishable from a valid empty canonical set. |

The raw role and override rows displayed by `getAdminUserById` are assignment detail and may remain separate. They must not be recombined in TypeScript to synthesize authority.

## Minimum replacement contract after Task11a

The names below are an exact proposed public seam; its internal callee must be bound to Task11a's final reviewed name rather than guessed before that task settles.

### SQL wrapper

```sql
public.canonical_get_platform_user_permission_diagnostic(
  p_actor_user_id uuid,
  p_target_user_id uuid
) returns jsonb
```

Required behavior:

1. `SECURITY DEFINER`, `STABLE`, fixed `search_path = public, auth, pg_temp`.
2. Reject null actor/target. Check canonical platform admission for `p_actor_user_id` before checking whether the target exists, so a non-platform caller cannot probe target existence. Preserve the current application admission by passing only `current.userId` returned by `requirePlatformAdminAccess`, never a form field.
3. Reject a deleted/missing target. Do not turn it into an empty set.
4. Call the final Task11a canonical shared-array resolver for `p_target_user_id`. That shared resolver must union independently evaluated effective company sets, after company-local/global override precedence, and retain its distinct authoritative-platform branch. Do not call raw role, membership, direct-grant, or override relations from this wrapper and do not reproduce their algebra.
5. Return a shape such as `{ target_user_id, scope: 'shared_active_companies', permissions, evaluated_at }`. `permissions` is a sorted string array. The scope means “effective in at least one eligible active company, or through the canonical platform branch”; it does not authorize the target in every tenant.
6. Propagate canonical calculation errors. Empty permissions are valid only when the canonical resolver successfully returned an empty array.

### ACL

The canonical internal company resolver and shared arbitrary-user array remain owner-private: no `PUBLIC`, `anon`, `authenticated`, or implicit `service_role` execution. The new diagnostic wrapper must likewise revoke `PUBLIC`, `anon`, and `authenticated`, then **explicitly** grant only `service_role` execution. Because `CREATE OR REPLACE FUNCTION` preserves ACL, a correction of an existing signature must clear every non-owner direct/inherited grant before the one explicit service grant, following the all-non-owner revocation pattern in `20260911114443...:31–40`.

Native ACL evidence must establish:

- `anon` and `authenticated` cannot execute the target wrapper or either internal arbitrary-user array, including through inherited roles;
- `service_role` can execute only the target wrapper by an explicit grant, not by `PUBLIC` inheritance;
- `service_role` cannot execute the internal effective-company/shared functions directly;
- the function owner can call the internal resolver from the `SECURITY DEFINER` wrapper.

This is narrower than granting an arbitrary-user array to every authenticated caller and does not assume that the present `service_role` can execute `gridex_get_user_permissions(uuid)`.

### TypeScript caller

Make the actor binding visible in the existing server-only data boundary:

```ts
getAdminUserById(actorUserId: string, targetUserId: string)
```

The page calls `getAdminUserById(current.userId, id)` after `requirePlatformAdminAccess()`. The loader invokes the new wrapper with `supabaseService`, validates `target_user_id`, `scope`, and every permission element, and returns `effectivePermissions` alongside the existing raw roles/overrides. On RPC error or invalid result it throws a generic diagnostic-unavailable error (logging only bounded code/message server-side); it must not return `[]` or invoke `ROLE_PERMISSION_PROFILES`. The page removes the `getUserPermissions` import/call, uses `user.effectivePermissions`, and changes the count label to state the shared/any-eligible-company meaning. With no remaining callers, delete `lib/rbac/getUserPermissions.ts`.

Calling the diagnostic wrapper before service-role target-detail reads gives the loader a fail-closed actor gate even if it is reused outside the current page. The existing page gate remains necessary for routing and UI permissions; the SQL actor check is independent defense at the service-only seam.

## Focused proof of the current mismatch

A Node24 source probe stripped types from the actual `lib/rbac/getUserPermissions.ts` and supplied only I/O boundaries. `gridex_get_user_permissions`, `gridex_get_user_permission_overrides`, and `gridex_get_user_roles` each returned permission-denied, while the membership query returned one active `owner`. The actual module returned `['billing.write']` from the coded `company_admin` profile. Result: **PASS — canonical/override failures were suppressed and a positive effective permission was still displayed.** Node's type-stripping experimental warning was the only warning.

This proof demonstrates misleading availability/deny handling. It does not show an ordinary user reaching the platform-only page, bypassing a write guard, or directly executing the revoked RPCs.

## Minimum post-implementation verification

| Case | Required result |
|---|---|
| Ordinary authenticated direct RPC | Permission denied without target-existence distinction |
| Service wrapper with inactive/non-platform actor ID | `42501`; no target result |
| Valid platform actor, missing/deleted target | Explicit not-found failure, not `permissions: []` |
| Target A deny / B allow | Shared diagnostic contains the key via B; a company-A target resolver does not |
| Global deny / local allow | Shared diagnostic omits the key under the settled deny algebra |
| Canonical resolver failure or malformed TS result | Loader/page surfaces diagnostic unavailable; never count `0` and never coded fallback |
| Successful canonical empty set | Page displays `0` with the shared-scope label |
| Source inventory | No application caller/import of `getUserPermissions` or `ROLE_PERMISSION_PROFILES`-based effective fallback remains |

Task11a native proof and hosted application tests remain prerequisites to an implementation claim. This report proposes the follow-up seam only; it does not claim the canonical algebra, wrapper, ACL, or page retirement has been implemented or run against a database.
