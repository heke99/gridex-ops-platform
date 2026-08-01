# Canonical multi-tenant rollout runbook

## Safety rules

1. Take a database backup and record the deployed migration ledger.
2. Never edit an already-deployed migration. Apply the forward hardening migration only.
3. Never infer a default company. A null or ambiguous tenant is a blocker.
4. Run dry-run reports for every company before applying repair SQL.
5. Automatic remediation may fill a null tenant only from one verified parent. It never changes a conflicting non-null tenant.
6. Apply production changes through the normal reviewed deployment path, not from a developer laptop without evidence capture.

## Order of operations

```bash
npm ci
npm run tenant:multitenant:static
npm run typecheck
npm run typecheck:tests
npm test -- --run __tests__/tenant-context.test.ts __tests__/canonical-onboarding.test.ts
npm run build
```

Database preflight:

```bash
npm run tenant:preflight | tee test-runs/canonical-multitenant-preflight.txt
npm run tenant:backfill:dry-run | tee test-runs/canonical-multitenant-backfill-dry-run.txt
```

Review every `ambiguous_cross_tenant_conflict`. Resolve ownership from authoritative business evidence. Do not copy rows between companies as a shortcut.

Apply migration through Supabase/CI in migration order:

```text
... existing verified migrations
20260801143000_canonical_multitenant_platform_hardening.sql
```

Then run deterministic repair and verification:

```bash
npm run tenant:backfill:apply | tee test-runs/canonical-multitenant-backfill-apply.txt
npm run tenant:post-verify | tee test-runs/canonical-multitenant-post-verify.txt
```

Validate each generated `mt_*` constraint only after its corresponding mismatch count is zero. Keep evidence of the validation command and result.

## Tenant onboarding

A tenant may activate a capability only after its configuration is complete and verified. At minimum, record:

- company identity and operational status;
- domains and branding;
- users and roles;
- customer-number format;
- products and price areas;
- legal versions and POA requirements;
- sender identities and templates;
- API clients/scopes and origin/IP restrictions;
- provider credentials by secret reference;
- market/Ediel identities and routes;
- enabled capabilities and readiness evidence.

No code deployment should be required for a normal new tenant.

## Required isolation test matrix

Use at least tenant A, B and C with different products, legal versions, prefixes, senders, capabilities and provider routes.

| Test | Expected result |
|---|---|
| Same person in A and B | separate customer IDs/numbers and isolated aggregates |
| Same external reference in A and B | accepted because uniqueness is tenant-qualified |
| A child linked to B parent | runtime rejects; database rejects; no B data disclosed |
| A API key sends B company ID | mismatch rejected or matching claim stripped; A remains authoritative |
| Worker claims A job | only A data read/changed |
| A/B legal and sender configuration | each receives its own version; no fallback |
| Website/admin/partner/import | same canonical onboarding operation and constraints |
| Parallel duplicate intake | exactly one tenant operation/result |
| Retry after partial failure | same operation resumes; no duplicate customer graph |

## Operational diagnosis

For any incident capture:

```text
correlation_id
company_id
actor type/id
source channel
aggregate IDs
idempotency key
state/blocker/next action
provider/job references
migration version
```

A missing `company_id`, ambiguous provider match or cross-tenant relation is a security incident, not a recoverable fallback case.

## Rollback

The migration is additive and intentionally leaves the legacy onboarding implementation available. Application rollback can call the old RPC only as a temporary compatibility measure. Do not drop tenant constraints, re-enable client-controlled tenant hints or restore hard-coded senders. Data repair is forward-only and must be reversed from audit evidence with an explicit reviewed remediation script.

## Production decision

Production approval requires all repository tests, a fresh database migration, upgrade migration, RLS/RBAC checks, three-tenant isolation tests, concurrency/idempotency tests, backfill verification and staging E2E. Missing evidence is a blocker, not an assumed pass.
