# GRIDEX-OPS-BL-002 — staging verification, 2026-08-06

## Environment

- Supabase project: `gridex-ops-dev`
- Project reference: `piidsfebjqjmnepdpnas`
- Region: `eu-north-1`
- Repository branch: `remediation/gridex-ops-bl-002-global-read-isolation`
- Pull request: `#84`
- Environment classification: non-production development/staging

## Persistent migration apply

The BL-002 migration was persistently applied to the non-production project.

Supabase registered the migration as:

- version: `20260806122255`
- name: `gridex_ops_bl_002_global_read_isolation`

The repository migration was renamed to match that recorded version:

`supabase/migrations/20260806122255_gridex_ops_bl_002_global_read_isolation.sql`

The migration checksum remains:

`ccbc18dbb7232841758830235be3e808d55b0512c72a409c6125981a5103d2d6`

The old proposed filename `20260806133000_gridex_ops_bl_002_global_read_isolation.sql` was removed before merge so deployment tooling will not treat the already-applied staging migration as a different migration.

## Effective policy verification

Post-apply inspection returned exactly eight explicit read policies across the four target tables:

- one `authenticated` platform-admin policy per table using `gridex_user_is_platform_admin()`;
- one `service_role` policy per table using `true`;
- no remaining target-table read policy containing the former broad `auth.uid() is not null` predicate.

Target tables:

- `actor_registry_conflicts`
- `actor_registry_import_items`
- `actor_registry_import_runs`
- `ediel_certificate_refresh_jobs`

## Two-company role regression

The committed regression logic was executed after the persistent migration apply. The psql-only wrapper commands were omitted when executed through the Supabase SQL connector; the SQL assertions and rollback behavior were unchanged.

Exact result:

```text
GRIDEX-OPS-BL-002 two-tenant rollback regression passed.
```

Verified behavior:

| Principal | Result |
|---|---|
| Ordinary authenticated user | denied |
| Active tenant member | denied for own and other tenant fixture |
| Active company admin | denied for own and other tenant fixture |
| Active platform admin | allowed for both tenant-tagged fixtures |
| Service role | allowed for both worker fixtures |

All temporary Auth users, profiles, memberships and operational rows were rolled back.

## Existing-role smoke verification

A real active non-platform company-admin identity and a real active platform-admin identity from the non-production environment were used for a read smoke test.

Exact result:

```text
role smoke passed
```

Assertions:

- the company admin saw zero rows across the four platform-global operational tables;
- the platform-admin helper returned true;
- the platform admin could read existing actor-registry import history;
- the platform admin could read existing certificate-refresh jobs.

This verifies the database authorization path used by the guarded `/admin/network-owners` server page. It is not a replacement for a browser/session smoke test of the rendered page.

## Service-role worker CRUD smoke verification

A rollback-only service-role transaction created and read:

- one actor-registry import run;
- one actor-registry import item;
- one actor-registry conflict;
- one certificate-refresh job.

The certificate-refresh job was also updated from `running` to `completed` and read back under service role.

Exact result:

```text
service-role actor-registry and certificate-job CRUD smoke passed
```

The transaction was rolled back, so no smoke-test operational rows remain.

## Remaining merge gates

Before merge:

1. exact-head CI must pass after migration-version reconciliation;
2. the PR must receive human database/security review or an explicitly accepted maintainer self-review;
3. a browser smoke test should confirm `/admin/network-owners` renders for a platform admin and remains inaccessible to a company admin;
4. logs should be inspected after a controlled application-level import/certificate action to confirm no sensitive row payloads are emitted.

The database migration, negative/positive role matrix, existing-role read path and service-role table operations are verified in non-production. Application-level browser and external LDAP/XML execution remain distinct controls.

## Status

`GRIDEX-OPS-BL-002` remains `CODE_REMEDIATED` until the remaining review and application-level smoke gates are complete. It must not be marked `VERIFIED_CLOSED` solely from this database verification.
