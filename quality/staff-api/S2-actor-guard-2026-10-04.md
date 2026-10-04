# S2 actor eligibility lock repair — 2026-10-04

Scope: a forward replacement of the private `gridex_assert_staff_command_v1(jsonb,boolean)` guard, from S2 prefix `52277b5fc`. No existing migration or shared role profile helper is rewritten.

The previous guard accepted an active-status company with `is_active=false`. It also only read actor membership/profile/Auth eligibility; the client repair held the API client row but left actor profile eligibility changeable before canonical write completion. Actual canonical access and invitation tests reproduced three failing cases on the prior guard, then passed with this forward repair.

For `staff_api`, the guard now locks the company, the exact-company actor membership plus profile/Auth rows, then the exact-company API client. It rechecks accepted active membership, active profile, nondeleted/nonbanned Auth account, operational active company and explicit active/nondeleted/nonrevoked/nonexpired `staff_users.write` client after every potentially blocking row lock and before a cached replay returns. Shared native role profiles and own-company allow/deny overrides remain authoritative. The OPS platform-administrator path remains compatible.

The guard stays private to the canonical SECURITY DEFINER commands. Canonical entrypoints remain service-only. The repair adds no Auth table grant and preserves the guard signature and fixed search path.

Verification executed locally:

- Prior guard: 3 RED / 10 PASS actual canonical-chain tests (inactive company accepted; access/invitation missing eligibility lock relations).
- Forward repair: 14 new tests PASS; with existing client guard and native policy, 38 tests PASS.
- New rollback native SQL script executes in embedded PostgreSQL using the actual mapping/v2/unchecked access chain, real request hash trigger and invitation command. It tests first-write and cached replay denials, roles, Auth bans, inactive company, mandatory audit/receipt counts, lock relation retention and ACLs. A backup administrator preserves authentic last-admin constraints in lifecycle fixtures.
- Scoped ESLint and `git diff --check` PASS.

Limit: embedded PostgreSQL exposes NULL backend PIDs, so its test adapter normalizes only the lock observer predicate. The native script itself filters the actual backend PID. Authentic Supabase schema replay/RLS/grants and independent native sessions remain mandatory parent-owned CI checks; they were not executed by this repair agent. The relation lock observer plus reviewed exact-row SQL establishes lock acquisition, not an independent multi-session interleaving proof.
