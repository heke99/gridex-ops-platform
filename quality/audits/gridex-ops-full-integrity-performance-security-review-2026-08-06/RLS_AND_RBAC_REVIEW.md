# RLS and RBAC review

## Catalog result

| Check | Result |
|---|---:|
| Public tables | 489 |
| Public tables with RLS enabled | 489 |
| Public tables without RLS | 0 |
| Tenant-bearing (`company_id`/`tenant_id`) tables | 358 |
| Tenant-bearing tables without RLS | 0 |
| Tables granted to `anon`/`authenticated` without RLS | 0 |
| Policies in `public`/`staging` | 3,866 |
| Tenant-bearing policies with unscoped `auth.uid() IS NOT NULL` pattern | 0 |

RLS enablement is comprehensive. Correctness still depends on policy predicates and helper semantics.

## Authorization helpers reviewed

- `gridex_user_is_platform_admin()` requires an authenticated, non-deleted/non-banned, email-confirmed user, active profile and active global admin role.
- `gridex_user_company_ids()` requires active membership, active membership flag and a company not archived/suspended/deleted.
- `gridex_can_read_company(company_id)` accepts platform admin or an active company returned by the helper.
- `gridex_can_write_company(company_id)` restricts writes to explicitly allowed operational/admin roles and active/onboarding company state.
- `gridex_is_current_session_allowed()` rejects disabled, locked, removed and revoked user states.
- `gridex_portfolio_actor_has_permission()` binds actor, company and optional portfolio.

No direct authenticated privilege escalation was found in the 11 authenticated-executable `SECURITY DEFINER` functions. All have pinned `search_path`; none are executable by `anon`.

## Confirmed boundary failure

Policies for bucket `customer-documents` allow read/insert/update based on:

- bucket match; and
- global `gridex_has_permission(auth.uid(), 'masterdata.read' or 'switching.read')`.

`gridex_has_permission` resolves global role/direct permissions and has no company argument. All current bucket objects use nested paths containing a company UUID, but the policy never compares that UUID with `gridex_user_company_ids()` or a customer/application owner. A user with the permission in one company can therefore operate on another company's object. See `GRIDEX-AUD-001`.

## Platform-global isolation remediation

Current `main` and dev include `20260806122255_gridex_ops_bl_002_global_read_isolation.sql`, replacing broad reads on:

- `actor_registry_conflicts`
- `actor_registry_import_items`
- `actor_registry_import_runs`
- `ediel_certificate_refresh_jobs`

with explicit platform-admin and service-role policies. Dev role/two-company tests are documented in PR #84. Production status remains `NOT_VERIFIED`; inherited finding remains `CODE_REMEDIATED`, not `VERIFIED_CLOSED`.

## Global reference reads

Remaining authenticated `USING (true)` policies are concentrated in EDIEL rule/reference data and RBAC metadata (`roles`, `permissions`, `role_permissions`). These are not automatically vulnerabilities. They are accepted only if column-level review confirms no tenant-private or operational secrets and writes remain restricted.

## Required policy tests

Every critical table/bucket must test ordinary user, customer, read-only role, operational role, company admin, inactive membership, suspended company, platform admin, service role and cross-tenant object/reference. `SELECT`, `INSERT`, `UPDATE` and `DELETE` must be asserted separately.