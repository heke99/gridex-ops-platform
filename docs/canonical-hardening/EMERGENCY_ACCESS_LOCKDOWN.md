# Emergency access lockdown

Date: 2026-08-02
Target inspected: `gridex-ops-dev` (`piidsfebjqjmnepdpnas`)
Release decision: **NO-GO**

## Verified pre-migration exposure

| Requirement | Result | Remote evidence |
|---|---|---|
| Internal readiness views are not anonymous | **FAIL** | Three of four named views allow `anon SELECT`; all four lack `security_invoker=true` |
| Internal mutating definer RPCs are private | **FAIL** | All four named functions allow `PUBLIC`, `anon` and `authenticated EXECUTE` |
| Canonical manifest/preflight tables are internal | **FAIL** | RLS disabled; `anon` and `authenticated` have full DML/TRUNCATE |
| Migration-owner default ACL is least privilege | **FAIL** | `postgres` grants new public-schema tables/functions/sequences to API roles |
| Managed-role default ACL is least privilege | **FAIL** | `supabase_admin` has the same broad default ACL; project `postgres` is not a member of that managed role |
| Global platform helper requires global scope | **FAIL** | `gridex_user_is_platform_admin()` does not require `user_roles.company_id IS NULL` |
| Tenant-bound global role rows absent | **PASS** | Active count is `0` in the inspected database |

Read-only commands were executed through the connected Supabase project with
exit status reported as successful by the connector. No customer row payloads
or credentials were extracted.

## Forward repair prepared locally

Migration `20260802190000_canonical_emergency_access_lockdown.sql`:

- revokes migration-owner default grants to `PUBLIC`, `anon` and `authenticated`;
- attempts the equivalent managed `supabase_admin` repair and reports a notice
  if hosted-role permissions prohibit it;
- makes the four internal readiness views `security_invoker` and service-only;
- revokes anonymous/authenticated execution of the four mutating definer RPCs;
- enables and forces RLS on the manifest/preflight tables and limits writes to
  `service_role`;
- repairs the global helper with functioning Auth/profile checks and
  `company_id IS NULL`;
- rejects future tenant-bound `super_admin`/`platform_admin` role rows.

## Apply status

**NOT APPLIED.** The remote migration operation was blocked by the environment's
safety review because this access-control change has a broad persistent blast
radius. The connected database remains unchanged. Explicit approval for this
exact migration is required before retrying.

Postflight: `scripts/sql/05_emergency_access_lockdown_verification.sql`.

## Remaining verification

- Anonymous REST calls to all four views and four RPCs: **NOT VERIFIED**.
- Real tenant-A/tenant-B JWT access: **NOT VERIFIED**.
- Managed `supabase_admin` default ACL repair: **NOT VERIFIED** and likely
  requires a Supabase-managed-role/platform operation.
- Security Advisor rerun after apply: **NOT VERIFIED**.
