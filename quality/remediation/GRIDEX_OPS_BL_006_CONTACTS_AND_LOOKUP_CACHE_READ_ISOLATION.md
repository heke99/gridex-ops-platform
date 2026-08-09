# GRIDEX-OPS-BL-006 — contacts and lookup-cache read isolation

## Finding

- ID: `GRIDEX-OPS-BL-006`
- Source: residual variant hunt after GRIDEX-OPS-BL-002 / PHASE-45 findings O-005 and O-006
- Severity: High
- Confidence: Confirmed
- Status: `CODE_REMEDIATED`
- Branch: `cursor/codebase-health-and-stability-8f9d`
- Related: O-005 (`platform_actor_contacts`), O-006 (address/energy lookup caches), O-007 (admin import-history silent empty)
- History: closed unmerged PR `#89` used version `20260807154500`; this reimplementation lands after the 2026-08-09 main remediation tree as `20260809123000`.

## Root cause

The same broad authenticated read pattern remediated by BL-002 remained on three
platform-global tables:

```sql
auth.role() = 'service_role' or auth.uid() is not null
```

Affected tables:

- `platform_actor_contacts` — email/phone and contact metadata for market actors
- `platform_address_lookup_cache` — street/raw_payload geocode cache
- `platform_energy_lookup_cache` — input/result jsonb resolution cache

## Implemented boundary

Forward migration
`supabase/migrations/20260809123000_gridex_ops_bl_006_contacts_and_lookup_cache_read_isolation.sql`:

1. keeps RLS enabled;
2. revokes anonymous SELECT;
3. removes the broad authenticated read policies;
4. allows authenticated reads only through `gridex_user_is_platform_admin()`;
5. preserves explicit service-role reads for energy resolver and admin contact paths;
6. leaves historical migrations and existing FOR ALL write policies unchanged.

## Consumer inventory

- `app/admin/ediel/route-readiness/page.tsx` and `actions.ts` use `supabaseService` for contacts.
- `app/api/admin/ediel/supplier-contacts/export/route.ts` uses `supabaseService` after `requirePlatformAdminAccess()`.
- `lib/energy/resolver.ts` uses `supabaseService` for address lookup cache.
- No legitimate tenant UI consumer was found for direct authenticated reads of these three tables.

## Related app hardening (O-007)

`/admin/network-owners` previously read `actor_registry_import_runs` with the
authenticated session client after `requirePlatformAdminAccess()`. That app gate
uses `gridex_get_user_roles`, while BL-002 RLS uses
`gridex_user_is_platform_admin()` (requires `email_confirmed_at`). Divergence
could silently return an empty import history. The page now reads import history
via `supabaseService` after the platform-admin gate.

## Verification

### Static

```text
npm run gridex:ops-bl-006-contacts-lookup-cache-isolation-regression
npm run db:migrations:integrity
```

### Staging / database (pending environment)

```text
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/gridex-ops-bl-006-contacts-and-lookup-cache-read-isolation-regression.sql
```

Expected:

```text
GRIDEX-OPS-BL-006 two-tenant rollback regression passed.
```

## Status note

`GRIDEX-OPS-BL-006` is `CODE_REMEDIATED`, not `VERIFIED_CLOSED`, until the SQL
rollback regression is executed against a non-production database and exact-head
CI / admin smoke are confirmed.

O-008 (`actor_readiness_status` authenticated SELECT under-count risk) remains
open and is intentionally out of scope for this PR.
