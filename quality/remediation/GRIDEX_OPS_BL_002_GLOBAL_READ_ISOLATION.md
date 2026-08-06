# GRIDEX-OPS-BL-002 — platform-global read isolation remediation

## Finding

- ID: `GRIDEX-OPS-BL-002`
- Source: baseline BL-002, reconciliation, live non-production verification
- Severity: High
- Confidence: Confirmed
- Recommended status after this branch: `CODE_REMEDIATED`
- Branch: `remediation/gridex-ops-bl-002-global-read-isolation`
- Base main SHA: `ffe4d0b022d82108d902336755d26d5c5d3924ed`

## Activated skills

Directly activated: acquire-codebase-knowledge, code-review, code-security, differential-review, executing-plans, find-bugs, finishing-a-development-branch, fp-check, quality-playbook, requesting-code-review, security-threat-model, sharp-edges, spec-to-code-compliance, supabase, supabase-postgres-best-practices, systematic-debugging, test-driven-development, threat-model-analyst, using-superpowers, variant-analysis, verification-before-completion, writing-plans and writing-skills.

## Root cause

The four platform-global operational tables were created with `SELECT` policies equivalent to:

```sql
auth.role() = 'service_role' or auth.uid() is not null
```

That expression treats every authenticated principal as a platform operator. `company_id` is nullable and current rows are predominantly or entirely global, so tenant membership is not a valid authorization boundary. The canonical active-platform-admin helper already exists and is executable by `authenticated`, but the policies did not use it.

## Affected tables and policies

| Table | Old read policy | Intended interactive reader | Intended privileged worker |
|---|---|---|---|
| `actor_registry_conflicts` | `actor_registry_conflicts_read` | Active platform admin | Actor-registry service-role worker |
| `actor_registry_import_items` | `actor_registry_import_items_read` | Active platform admin | Actor-registry service-role worker |
| `actor_registry_import_runs` | `actor_registry_import_runs_read` | Active platform admin | Actor-registry service-role worker |
| `ediel_certificate_refresh_jobs` | `ediel_certificate_refresh_jobs_read` | Active platform admin | Certificate refresh service-role worker |

## Consumer inventory

- `app/admin/network-owners/page.tsx` is a server component, calls `requirePlatformAdminAccess()` before data loading and reads recent `actor_registry_import_runs` with the authenticated server session. The new platform-admin RLS policy matches this boundary; no service-role promotion or client-side bypass is needed.
- `lib/actor-registry/importActorRegistry.ts` uses `supabaseService` for registry staging/conflict processing.
- `lib/ediel/certificates/actorCertificateRefresh.ts` is the certificate-job consumer and is part of the service-role worker path.
- Repository search found no legitimate tenant UI requiring direct reads of these four tables.

## Before behavior

Live policy catalog on non-production project `piidsfebjqjmnepdpnas` showed the same broad predicate on all four tables. Baseline direct reproduction proved ordinary authenticated sessions could read platform-global records. Current aggregate inspection found:

- `actor_registry_import_items`: 679 rows, all with `company_id is null`;
- `actor_registry_import_runs`: 1 current row, global;
- `ediel_certificate_refresh_jobs`: 1,287 rows, all global;
- `actor_registry_conflicts`: no current rows at inspection time, but the policy was equally broad and the regression creates explicit fixtures.

The baseline audit observed a different import-run count at its earlier snapshot; counts are reported as time-specific evidence, not reconciled by assumption.

## After behavior

For each table the migration:

1. keeps RLS enabled;
2. revokes anonymous SELECT;
3. preserves SELECT grants for `authenticated` and `service_role`;
4. drops the broad read policy;
5. creates one `authenticated` policy using `(select public.gridex_user_is_platform_admin())`;
6. creates one explicit `service_role` policy for the background worker path;
7. leaves existing write policies and all historical migrations unchanged.

Expected matrix:

| Principal | Tenant A tagged fixture | Tenant B tagged fixture | Global operational rows |
|---|---:|---:|---:|
| anon | deny | deny | deny |
| ordinary authenticated | deny | deny | deny |
| active tenant member | deny | deny | deny |
| company admin | deny | deny | deny |
| active platform admin | allow | allow | allow |
| service role | allow | allow | allow only for the inventoried worker paths |

## Migration

`supabase/migrations/20260806133000_gridex_ops_bl_002_global_read_isolation.sql`

The migration is additive/forward-only and has precondition checks for the canonical helper and all four tables. It does not edit `20260615130000_batch_o3_o6_actor_registry_certificate_hardening.sql` or any other applied migration.

## Regression

`scripts/gridex-ops-bl-002-global-read-isolation-regression.sql`

The test is self-contained and rollback-only. It:

- selects two existing companies and one real active platform admin;
- creates temporary ordinary, tenant-member and company-admin Auth/profile fixtures;
- creates two rows per affected table, one tagged to each company;
- verifies all three non-platform authenticated contexts see zero target rows;
- verifies the platform admin sees both rows in all four tables;
- verifies service role sees both rows in all four tables;
- verifies the broad `auth.uid() is not null` read predicate is absent;
- verifies exactly eight explicit platform-admin/service-role read policies;
- rolls back all users, memberships and operational fixtures.

## Variant analysis

A live `pg_policy` scan searched every public `SELECT`/`ALL` policy containing `auth.uid() IS NOT NULL` while excluding platform-admin, tenant, permission and membership-aware predicates. Result: exactly the four policies in this finding. No additional same-root-cause table was identified.

Related but different classes remain separate:

- raw tenant-membership write bypasses are `GRIDEX-OPS-BL-001`;
- duplicate permissive/per-row policy performance is `GRIDEX-OPS-BL-004`;
- broad table grants without an allowing policy are not automatically an exposure and require separate effective-access analysis.

## False-positive control

This is not a false positive because:

- the predicate is directly visible in `pg_policy`;
- `authenticated` has SELECT grants on all four tables;
- RLS is enabled but the broad policy authorizes every non-null JWT subject;
- baseline executed an authenticated role/JWT reproduction;
- intended UI and worker consumers are platform-admin/service-role, not tenant users;
- a rollback transaction with the proposed policy produced the required deny/allow matrix.

## Verification executed

### Repository and evidence

- Verified main SHA `ffe4d0b022d82108d902336755d26d5c5d3924ed`.
- Verified PR #74 is open draft and unmerged; it was not modified or merged.
- Read `AGENTS.md`, `skills-lock.json`, required project memory, baseline/V3/reconciliation evidence and the original policy migration.
- Verified 38 locked skills and created complete routing.

### Supabase read-only inspection

- Project: `gridex-ops-dev` / `piidsfebjqjmnepdpnas` / `eu-north-1`.
- Inspected `pg_policy`, table ACLs, RLS flags, function definitions, current migrations, columns and aggregate row counts.
- Confirmed `public.gridex_user_is_platform_admin()` is stable, security-definer, fail-closed on missing/inactive/unconfirmed users and executable by `authenticated`.

### Rollback execution

Executed the proposed migration plus complete two-company/role regression inside one transaction on the non-production project. Exact final result:

```text
GRIDEX-OPS-BL-002 rollback verification passed
```

The transaction ended with `ROLLBACK`; no migration, user, membership, policy or fixture was persisted.

## Verification commands for a clean checkout/staging database

```bash
git status --short --branch
git diff --check origin/main...HEAD
npm ci
npm run db:migrations:check
psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260806133000_gridex_ops_bl_002_global_read_isolation.sql
psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f scripts/gridex-ops-bl-002-global-read-isolation-regression.sql
npm run typecheck
npm run typecheck:scripts
npm run typecheck:tests
npm run lint
npm test
npm run security:rbac
npm run build
```

Use only isolated staging/ephemeral credentials. Do not run the fixture regression against production. The migration itself requires normal migration review and deployment approval.

## Blocked checks

- No authenticated local checkout or dependency runtime was available through the connector, so `npm ci`, typecheck, lint, full tests and build were not executed in this run.
- No paid Supabase ephemeral branch was created because branch creation requires explicit cost confirmation.
- The migration was not persistently applied to staging or production.
- Admin UI and background worker smoke tests remain required after staging apply.
- CI status can only be evaluated after the draft PR exists on its exact head SHA.

## Staging requirements

1. Apply only this migration to an isolated staging/ephemeral database.
2. Run the committed rollback regression.
3. Sign in as a non-platform company admin and verify the four PostgREST reads return no rows.
4. Sign in as an active platform admin and verify `/admin/network-owners` loads import history.
5. Execute a controlled actor registry import and certificate refresh worker run using service role.
6. Inspect logs for request/correlation IDs and ensure no sensitive row contents are emitted.
7. Run exact-head CI and retain redacted evidence in this report/PR.

## Rollback and forward-fix

Emergency rollback would drop the eight new read policies and recreate the former four broad policies, but that reopens the confirmed exposure and should be used only to restore a critical unavailable platform operation. The preferred response to a broken legitimate consumer is a forward-fix that routes that specific consumer through the existing platform-admin or service-role boundary without broadening tenant access.

No data rewrite or backfill is required, so rollback affects policy/grant definitions only.

## New findings

No new same-root-cause variant was found. The variant scan returned exactly the four known tables. Existing assurance gaps and distinct bug classes are recorded in `GRIDEX_OPS_REMEDIATION_REGISTER.md` and remain outside this branch.

## Remaining risk and status

The source migration and regression are implemented and the proposed behavior is proven in rollback execution. Because persistent staging apply, smoke tests, exact-head CI and human review are pending, the correct status is:

`CODE_REMEDIATED`

It is not `VERIFIED_CLOSED`.
