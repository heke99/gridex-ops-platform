# V2 canonical hardening status matrix

Date: 2026-08-02
Inspected database: `gridex-ops-dev` (`piidsfebjqjmnepdpnas`)
Release decision: **NO-GO**

This matrix uses only `PASS`, `FAIL` and `NOT VERIFIED` for release claims.
`PASS (local)` is not a database or production pass.

| Phase | Status | Evidence and remaining work |
|---|---|---|
| 0. Emergency access lockdown | **FAIL** remotely; repair **PASS (local)** | Four unsafe views, four broadly executable mutating definer functions, two internal tables without RLS and unsafe defaults are present. `20260802190000...` is registered and locally regressed but not applied pending explicit approval. |
| 1. Inventory | **PASS (read-only subset)** | Remote ledger, privileges, RLS, policies, advisors and focused data counts were inspected. A complete endpoint/worker/cron/call-graph inventory for every V2 flow is **NOT VERIFIED**. |
| 2. Target architecture | **NOT VERIFIED** | Existing canonical tables/RPCs exist, but one reviewed access RPC still accepts independently client-selected membership/system roles and the complete V2 event/command architecture has not been proven end-to-end. |
| 3. Canonical DB APIs | **FAIL** | Direct membership/role write paths remain in runtime code. Client-controlled dual role inputs and compensating deletes remain. These were not mutated before Phase 0 verification. |
| 4. Data migration/quarantine | **FAIL** | 153/232 test runs lack a tenant; 11 passed actor results lack canonical run/snapshot proof; three active owner memberships lack an active role; 96 constraints are NOT VALID. No ownership/evidence was guessed. |
| 5. Permissions/RLS/RPC isolation | **FAIL** | 3,139 policies reference the legacy platform-admin helper across 425 tables. Phase-0 helper/trigger repair is local only; real tenant-A/tenant-B/service-role tests are **NOT VERIFIED**. |
| 6. Test engine/evidence | **FAIL** | Active canonical test configuration has zero rows. Eleven legacy `passed` actor results lack canonical run/snapshot evidence and no canonical attempts exist. |
| 7. UI/access alignment | **FAIL** | `CompanyUserInviteForm.tsx` still renders a required temporary-password field even though the server action ignores it. Membership/system-role selections are separately user-controllable. |
| 8. Remaining security | **FAIL** | Security Advisor reports 124 findings, including 4 definer views, 63 anon/authenticated definer-function execution findings, 2 public tables without RLS and leaked-password protection disabled. |
| 9. Real DB testing | **NOT VERIFIED** | No post-lockdown JWT, service-role, REST, RPC, concurrency, idempotency or worker/cron regression has run because the migration is unapplied. |
| 10. Local gates | **PASS (local)** | Clean install; app/script/test TypeScript; 62 files/417 tests; lint 0 errors/125 warnings; production audit 0 vulnerabilities; full Next.js build on Node 24.14.0. Node 22 CI and PostgreSQL migration compile are **NOT VERIFIED**. |
| 11. Hygiene/consolidation | **FAIL** | 125 lint warnings remain; duplicate/permissive policy and index advisor findings remain inventory items; dead paths and all temporary compatibility bridges are not fully classified. |
| 12. Final verification/release | **FAIL / NO-GO** | Emergency apply/postflight, data reconciliation, canonical write-path migration, real DB security/concurrency tests, Node 22 parity and external-system verification are incomplete. |

## Exact approval boundary

The pending migration persistently:

- revokes broad default and object privileges from `PUBLIC`, `anon` and
  `authenticated`;
- changes four readiness views to `security_invoker` and service-only access;
- revokes anon/authenticated execution of four mutating SECURITY DEFINER
  functions;
- enables and forces RLS on two internal system tables;
- replaces `gridex_user_is_platform_admin()` with a global-role-only check;
- adds a trigger rejecting tenant-bound `super_admin` and `platform_admin`
  assignments.

The connected database remains unchanged until this exact blast radius is
explicitly approved. After approval, apply only `20260802190000`, run
`scripts/sql/05_emergency_access_lockdown_verification.sql`, rerun advisors and
exercise real anonymous/authenticated/tenant/service-role runtime smoke tests.
