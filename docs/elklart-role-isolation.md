# Actual local role and tenant isolation

`scripts/demo/elklart-role-isolation.mjs` verifies the existing backend authorization boundaries with actual Supabase Auth sessions, real PostgREST RLS queries and canonical tenant-context RPCs. This is separate from the customer-portal journey, which remains blocked while `organization_onboarding` rejects customer API access before its tenant checks.

The runtime owner must finish any restore/restart and explicitly signal readiness before execution:

```sh
ELKLART_ROLE_ISOLATION_ACK=local-role-isolation-only \
  node --experimental-strip-types scripts/demo/elklart-role-isolation.mjs
```

Use the project's Node22 runtime. The script requires private local runtime files, the exact `elklart-ops-demo` container/project label, loopback PostgreSQL bindings, a database project marker and the actual local OPS development configuration. Remote Supabase endpoints, portal ports and non-fictional tenant metadata are refused. Credentials stay in private files or process memory and are never emitted.

## Ordinary control fixtures

The original Karin customer must already exist through the support scenario. A distinct control company is provisioned through the same `canonical_provision_company` command used by the bootstrap, with its own deterministic fictional organization number and stable idempotency key. Its lifecycle remains **onboarding**. No activation, status SQL, grants, role weakening or policy changes are performed.

The control customer is created through the ordinary platform-admin customer intake browser form after the actual selected-company preference is set and the target company is opened. A service-role read verifies the returned customer ID belongs to that precise control company. The service-role client is used only for canonical fixture provisioning and integrity reads; it is never used for the permission probes. An existing exact control email is reconciled before another create action.

## Matrix

For each existing scoped `handler`, `portfolio`, `support` and `administrator` account, the script signs in through actual Auth and verifies:

- The canonical context identifies that exact user and selected original company, without platform-admin elevation.
- Karin is readable through the user session.
- For handler/portfolio/administrator, a harmless same-value UPDATE of Karin must return her exact own-tenant row and unchanged email through that same session before any foreign write probe. If this legitimate positive control fails, direct-write isolation is unqualified and the run stops.
- The second company's exact customer is unreadable.
- A same-value UPDATE against that foreign customer returns no rows or an actual authorization denial.
- Selecting the foreign company in the canonical context does not yield foreign-company authority.
- The actual `gridex_can_write_company` result and selected permission flags match the existing membership/role rules.

The support account additionally attempts a same-value UPDATE of Karin and must be denied. Current company membership rules allow operations/company administrators to write within their company and deny the `support` membership that customer-table write. Support replies still run through the guarded service-backed support action; the test does not confuse that command boundary with direct customer-table writes.

Existing permission differences are preserved: handler/portfolio have `customers.write` and lack `cases.write`; support has `cases.write` and lacks `customers.write`; the administrator has both plus `users.write`. Positive own-customer reads and same-session own-customer write controls precede the cross-tenant negatives for writable roles; a permission-check RPC alone is not accepted as proof that the UPDATE path works. Missing relations or unrelated database errors are not accepted as proof of denial. Anonymous customer read is checked separately. Final integrity reads require both fictional customer emails unchanged.

## Evidence and reset

The only new private state file owned by this runner is `/workspace/elklart-runtime/ops/isolation-scenario.json`, mode0600. It stores source/control IDs, stage, observed check booleans and the real role matrix. The snapshot owner must include it with the databases. It contains no passwords, access tokens or session cookies. Browser/Auth sessions are closed or locally signed out after execution. Stop the runner before snapshot or restore.

The unit tests verify target guards and that any leaked row, unexpected write, privileged actor, wrong selected company or missing own-customer control fails the matrix:

```sh
node node_modules/vitest/vitest.mjs run __tests__/elklart-role-isolation.test.ts
```

At preparation time those tests pass, but no actual matrix success is claimed before the root's restore-ready signal and a completed real execution receipt. Portal API isolation remains explicitly unverified rather than being inferred from an onboarding denial.

## First actual execution

After the runtime owner's qualified restore/start signal, canonical provisioning created the distinct fictional control tenant in onboarding. The ordinary platform-admin intake then returned success, but the required canonical read-back found the new control customer in the original tenant rather than the explicitly selected control tenant. The runner stopped before any role/RLS probe and recorded `BLOCKED` at `ordinary_control_customer`; returned observations are retained only in the private receipt.

The source mismatch is concrete: the intake page renders its company from the canonical selected-company context, while `createCustomerAction` separately calls `requireOperationalCompanyId`. That helper accepts the preference only among membership rows and otherwise falls back to the actor's preferred original membership. A platform actor selecting a newly provisioned company without a membership can therefore create under a different company from the displayed context. No customer was moved/deleted, no lifecycle was activated, and this failed attempt is not tenant-isolation PASS evidence. Root owns the existing-action remediation decision; this runner owns only new files and will not bypass the finding silently.

## Qualified retry after the intake fix

The intake page now supplies the rendered company to both manual and bulk forms. A shared server-only guard requires that form company, the canonical action context and the resolved operational company all match before manual ledger creation, bulk parsing/creation or preview extraction. The initial six manual and three bulk/preview/commit mismatch regressions failed before the fix and pass afterward; committed-customer recovery remains covered.

The actual browser retry first required the fixed form to reject the original platform-selection/membership mismatch visibly, before any new control-customer write. Only then did the runner configure the explicitly authorized canonical `company_admin` membership for the platform actor in its own new control tenant, verify that membership and retry ordinary intake. The returned customer was verified under the exact second tenant. The original wrongly attributed fixture was retained, with its observations kept in the private receipt; it was neither moved nor deleted.

The completed actual Auth/RLS run passed for all four scoped roles, including own-customer read, same-session own-customer write controls for writable roles, foreign-customer read/write denial, foreign selected-context refusal, expected permission differences and support's own-customer write denial. Anonymous read denial and final unchanged-email integrity controls also passed. These are backend role/tenant results, not a customer-portal result. The control company remains onboarding and portal API isolation remains unqualified behind `organization_onboarding`.
