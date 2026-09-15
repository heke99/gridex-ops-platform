# RBAC surviving-effect obligations

Scope: static source review against published baseline d32a3457. This document
records dependencies for full replay; it is not runtime, authorization or parity
approval. The reduced three-source characterization passed in OPS 34227210022;
actual canonical-prefix restoration is separate.

| Effect | Reviewed source evidence | Required surviving-effect proof |
| --- | --- | --- |
| Role-key helper | core01 filters both status and is_active; Batch6E predecessor omits those checks. No definition occurs in current bootstraps. The other two historical definition files are unresolved. | Preserve the exact currently selected core01 definition after the historical chain, then verify expected secure role behavior and final definition/order. |
| Company writability helper | Batch6E predecessor is the only direct historical CREATE OR REPLACE definition candidate found for gridex_company_is_writable. | Full replay must create and retain the expected definition and its dependency behavior. Absence from the previous selection is not proof about live. |
| Platform administrator helper | Latest directly selected replacement candidate: 20260802190000_canonical_emergency_access_lockdown.sql. Its body checks auth/profile lifecycle and active unscoped role assignment. | Full replay must retain this later boundary; the early hard-platform source is not final modern authorization proof. |
| Company membership/read/manage/write helpers | Later selected replacements: 20260814162500_tenant_rls_lifecycle_hardening.sql. | Full replay must retain the later helper definitions and tenant lifecycle behavior after restoring earlier source files. |
| Billing and audit views | Both view shapes were observed in the earlier catalog-only read. The early predecessor sets billing invoker; the fix does not set audit invoker. 20260611190000_launch_linter_hardening_security_definer_rls.sql later alters all public views but catches failures. | Assert actual later view definitions, options and grants after full replay; successful source exit alone is insufficient. |
| Dynamic policies | First two foundation files define 25 of the 29 target-table candidates; reduced fixture exercised eight. | Actual-prefix test must inventory runtime table presence and inspect every applicable policy/index/RLS effect. Full replay must then inspect later policy replacements. |

The three historical sources perform company/member/role backfills and permission
cleanup. Their observed early effects are not instructions to replay those data
changes against production. Forward production reconciliation requires its own
reviewed migration path and parity evidence.

A fresh catalog-only read of gridex_user_has_role_key on 2026-09-08 was denied.
Supabase project listing succeeds but excludes piidsfebjqjmnepdpnas, so current
live helper definition cannot be established through the connected project scope.
Earlier live observations are dated evidence only. Internal replay work continues.

## Verified final helper options — supersedes early core-option preservation

Fresh authorized catalog reads now succeed for Gridex. The previous connection
blocker is resolved. Live function body MD5 d76c8c4ae10c4f36b772b86255f728ba exactly
matches the core01 body. Its final properties are SECURITY INVOKER and
search_path=public,auth,extensions, with EXECUTE granted to authenticated and
service_role and denied to anon. The selected source
20260611190000_launch_linter_hardening_security_definer_rls.sql lines154 and202-204
establishes those exact later properties and grants through ALTER/REVOKE/GRANT.

The user's no-weakening invariant governs: after copying the exact core function
statement/body into the forward migration, narrowly reapply the verified later
helper-specific search_path, SECURITY INVOKER, PUBLIC/anon revocation and
authenticated/service_role EXECUTE grants. Retain unrelated custom grants.
Assert these final catalog properties as well as secure role-status behavior.
The earlier instruction to retain the core SECURITY DEFINER option as final state
is superseded by this observed later selected hardening. This changes no original
migration and performs no production mutation. Full replay/parity remains open.

## Managed auth prerequisite observed 2026-09-09

A catalog-only read of auth.users on piidsfebjqjmnepdpnas established:

| Column | Type | Generated expression |
| --- | --- | --- |
| confirmed_at | timestamp with time zone | LEAST(email_confirmed_at, phone_confirmed_at), STORED |
| email_confirmed_at | timestamp with time zone | Ordinary nullable column |
| phone_confirmed_at | timestamp with time zone | Ordinary nullable column |

The actual selected auth callback reads confirmed_at, but the isolated managed
bootstrap omitted it. The test bootstrap must represent this dependency with
the observed generated semantics. This is catalog evidence for a compatibility
prerequisite only, not full managed-schema parity. No live DDL or customer data
reads were performed. The separate review also requires preserved auth-source
adjacency, constraint-valid synthetic company status and audit counts derived
from the authentic prefix baseline. Hosted PG17 must verify the combined fixes.
