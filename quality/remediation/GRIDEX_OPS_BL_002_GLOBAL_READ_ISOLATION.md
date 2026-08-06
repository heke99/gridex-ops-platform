# GRIDEX-OPS-BL-002 — platform-global read isolation remediation

## Finding

- ID: `GRIDEX-OPS-BL-002`
- Source: baseline BL-002, reconciliation, live non-production verification
- Severity: High
- Confidence: Confirmed
- Status: `CODE_REMEDIATED`
- Branch: `remediation/gridex-ops-bl-002-global-read-isolation`
- Pull request: `#84`
- Base main SHA: `ffe4d0b022d82108d902336755d26d5c5d3924ed`

## Root cause

The four platform-global operational tables used `SELECT` policies equivalent to:

```sql
auth.role() = 'service_role' or auth.uid() is not null
```

That expression treated every authenticated principal as a platform operator. The affected data is global or platform-operational, so tenant membership is not a valid authorization boundary.

Affected tables:

- `actor_registry_conflicts`
- `actor_registry_import_items`
- `actor_registry_import_runs`
- `ediel_certificate_refresh_jobs`

## Implemented boundary

For each table the forward migration:

1. keeps RLS enabled;
2. revokes anonymous `SELECT`;
3. removes the broad authenticated read policy;
4. allows authenticated reads only through `gridex_user_is_platform_admin()`;
5. preserves explicit service-role reads for the actor-registry and certificate workers;
6. leaves historical migrations and write policies unchanged.

Migration:

`supabase/migrations/20260806122255_gridex_ops_bl_002_global_read_isolation.sql`

SHA-256:

`ccbc18dbb7232841758830235be3e808d55b0512c72a409c6125981a5103d2d6`

The version matches the migration recorded by the non-production Supabase project. The previously proposed filename with version `20260806133000` was removed before merge to prevent migration-history drift.

## Consumer inventory

- `app/admin/network-owners/page.tsx` is guarded by `requirePlatformAdminAccess()` and reads import history with the authenticated server session.
- `lib/actor-registry/importActorRegistry.ts` uses `supabaseService` for import staging and conflict processing.
- `lib/ediel/certificates/actorCertificateRefresh.ts` uses `supabaseService` for certificate-refresh jobs.
- No legitimate tenant UI consumer was found for direct reads of these four tables.

## Verification

### Policy inspection

Post-apply inspection returned exactly eight target-table read policies:

- four platform-admin policies for `authenticated`;
- four service-role policies;
- zero remaining target-table read policies containing the former broad `auth.uid() is not null` predicate.

### Two-company regression

The committed rollback regression was executed after persistent non-production migration apply.

Exact result:

```text
GRIDEX-OPS-BL-002 two-tenant rollback regression passed.
```

Verified matrix:

| Principal | Expected and observed result |
|---|---|
| Ordinary authenticated | denied |
| Active tenant member | denied for own and other tenant fixture |
| Active company admin | denied for own and other tenant fixture |
| Active platform admin | allowed for both fixtures |
| Service role | allowed for both worker fixtures |

All generated users, profiles, memberships and operational rows were rolled back.

### Existing-role read smoke

A real active non-platform company admin and a real active platform admin from the non-production environment were used.

Exact result:

```text
role smoke passed
```

Assertions passed:

- company admin saw zero rows across all four platform-global tables;
- platform-admin helper returned true;
- platform admin could read existing import history and certificate-refresh jobs.

### Service-role CRUD smoke

A rollback-only transaction created and read an import run, import item, conflict and certificate-refresh job under service role. The certificate job was updated from `running` to `completed` and read back.

Exact result:

```text
service-role actor-registry and certificate-job CRUD smoke passed
```

No smoke-test rows remain.

### CI history

- OPS hardening `#331` failed correctly when the migration checksum was missing.
- OPS hardening `#332` passed after checksum registration.
- OPS hardening `#333` passed on head `15e59f028e68bb6e065a2c9c0786aedf65f09ef2`.
- A new exact-head run is required after staging evidence and migration-version reconciliation.

## Staging evidence

Detailed evidence is recorded in:

`quality/remediation/GRIDEX_OPS_BL_002_STAGING_VERIFICATION_2026_08_06.md`

Environment:

- project: `gridex-ops-dev`
- project reference: `piidsfebjqjmnepdpnas`
- region: `eu-north-1`
- classification: non-production development/staging

The migration was persistently applied and registered as version `20260806122255` with name `gridex_ops_bl_002_global_read_isolation`.

## Remaining merge gates

Before merge:

1. exact-head CI must pass after the migration-version reconciliation;
2. a maintainer must complete or explicitly accept the database/security review;
3. a browser/session smoke should verify `/admin/network-owners` renders for platform admin and remains inaccessible to company admin;
4. a controlled application-level actor-registry or certificate action should be followed by log inspection to confirm no sensitive row payloads are emitted.

Database authorization, two-tenant isolation, existing-role reads and worker table CRUD are verified. Browser rendering and external XML/LDAP execution are distinct application-level controls and are not claimed as completed.

## Rollback and forward-fix

The migration changes policies and grants only and performs no data rewrite. Recreating the former broad policies would reopen the confirmed exposure. The preferred recovery for a broken legitimate consumer is a narrow forward-fix behind the existing platform-admin or service-role boundary.

## Status

`GRIDEX-OPS-BL-002` is `CODE_REMEDIATED`, not `VERIFIED_CLOSED`.
