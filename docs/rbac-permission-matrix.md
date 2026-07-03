# RBAC Permission Matrix

Roles and permissions as implemented (`lib/admin/accessModel.ts`,
`lib/rbac/getUserPermissions.ts`, `lib/admin/guards.ts`,
`lib/tenant/entityGuards.ts`, RLS helpers). Verified 2026-07-03.
`npm run security:rbac` enforces guard coverage in CI (24 checks green).

## Actors

| Actor | Authentication | Authorization source |
| --- | --- | --- |
| Superadmin (`super_admin`) / platform admin (`platform_admin`) | Supabase session | `gridex_get_user_roles` / `admin_users`; `requirePlatformAdmin*` guards; RLS `gridex_user_is_platform_admin()` |
| White-label platform admin | session | `white_label_platform_memberships` (owner/admin), scoped to platform companies |
| Tenant admin (`company_admin` / membership `owner`, `tenant_admin`) | session | `company_memberships` + RBAC permissions; `requireCompanyScoped*Access` |
| Tenant user (support `customer_service_agent`, `finance_readonly`, `executive_readonly`, …) | session | permission strings per page (`requireAdminPageKeyAccess`) |
| Customer portal user | session | `customer_portal_accounts` links user→customer; `assertPortalAccessToCustomer` |
| External API client (website/portal) | Bearer/`x-api-key` (hashed) | `integration_api_clients` scopes; tenant = client.company_id (server-side only) |
| Cron/internal service | shared secret headers (`timingSafeEqual`) | per-route secret or `CRON_SECRET` |
| Service role | `SUPABASE_SERVICE_ROLE_KEY` (server env only) | bypasses RLS; only used after app-layer guards |

## Access matrix

Legend: ✔ full, R read, s scoped to own tenant/customer, — none.

| Resource | Superadmin | Tenant admin | Tenant user | Portal user | API client | Cron |
| --- | --- | --- | --- | --- | --- | --- |
| Tenants/companies | ✔ | R(s) own | R(s) | — | — | — |
| Customers/sites/metering points | ✔ | ✔(s) | per permission (s) | R own customer | R/W own tenant + scope | processing only |
| Contracts | ✔ | ✔(s) | per permission (s) | R own | R own tenant | processing |
| Invoices | ✔ | ✔(s) | finance perms (s) | R own | R own | billing crons |
| Legal templates (platform master) | ✔ | — (copies only) | — | — | — | — |
| Legal versions (tenant) | ✔ | ✔(s) | R(s) | R published (accepted versions) | R legal-bundle scope | — |
| Powers of attorney | ✔ | ✔(s) | per permission | R own | R/W own via sync | — |
| Events (domain/customer) | ✔ | R(s) | R(s) | customer-safe subset only | R events scope | emit |
| Inbound messages / raw email | ✔ (platform RLS) | — (resolved artifacts only) | — | — | — | processing |
| Outbound Ediel messages | ✔ | R(s) | R(s) | — | — | dispatch |
| Ediel routes / actor settings | ✔ | R(s) | — | — | — | readiness cron |
| Go-live actions (make live/pause/resume) | ✔ only (`requirePlatformAdminActionAccess`) | — | — | — | — | — |
| API keys (create/rotate/revoke) | ✔ | — | — | — | — | — |
| Email sender settings | ✔ | ✔(s) per permission | — | — | — | — |
| AGT/actor testing | ✔ (+ white-label admin for own platform) | R | — | — | — | — |
| Raw payloads (EDIFACT/email) | ✔ | EDIFACT of own tenant | — | never | never | processing |
| Audit logs | ✔ | R(s) where surfaced | — | — | — | write |
| Kill switches (pause tenant/sending) | ✔ | email settings only | — | — | — | — |

## Enforcement points (verified)

- Every `/admin` page renders inside `app/admin/layout.tsx` →
  `requireAdminAccess()`; pages add `requireAdminPageKeyAccess('<permission>')`
  and server actions use `requireAdminActionAccess` /
  `requirePlatformAdminActionAccess` **before** any `supabaseService` call
  (audited across all 100+ admin action/page files using the service client —
  `scripts/security-audit-rbac.mjs` allowlist).
- Object-level checks: `lib/tenant/entityGuards.ts` verifies customer/site/
  metering point/contract/POA belong to the caller's company before mutations.
- Portal: layout resolves `getCustomerPortalContext()`; every query filters by
  the linked `customerIds`.
- Integration API: tenant from API key; identifiers resolve within
  `client.company_id` only; first portal-user link requires strong match
  (`customer_portal_link_requires_sync` 403).
- `proxy.ts` (Next 16 middleware) refreshes sessions, blocks platform paths for
  non-platform admins, enforces session allowlist + password-change.
- RLS is the second layer under user-session reads; service-role paths rely on
  the app-layer guards above (audit finding M10 — accepted, requires review
  discipline for every new `.eq('company_id', …)`).

## Sensitive-permission verification steps (manual, per release)

1. Log in as tenant admin of tenant A: `/admin/companies/[B-id]` → denied;
   customer of tenant B by URL → denied.
2. Tenant support user: go-live page → denied; make-live action absent.
3. Portal user: another customer's invoice id in URL/API → 403/404.
4. API key of tenant A with `x-gridex-customer-number` of tenant B customer →
   `customer_not_found`.
5. Cron endpoint without secret → 401/503.
6. `npm run security:rbac` green; `npm run gridex:launch-security-regression`
   green.

## Audit log integrity (verified)

- `audit_logs` written for admin mutations (webhooks actions, company actions,
  role changes) with actor, company_id, action, timestamp.
- Go-live: `company_go_live_reviews` + go-live events store approver,
  before/after status, reason, readiness check id.
- POA: `power_of_attorney_events` (created/snapshot_created/…).
- Sender/route/API-key changes: audit rows via respective admin actions.
- Kill-switch transitions (pause/resume production) create go-live events with
  actor + reason.
- Logs avoid secrets; auth-email bodies masked after send
  (`sensitiveStorageMask`).
