# Read-only database catalog snapshot — 2026-09-28

Only PostgreSQL metadata was queried. No customer rows, credentials, settings or business data were read or changed. This is **not** an authorization test with a user token.

| Project | Observed schema | Interpretation |
| --- | --- | --- |
| `gridex-ops-dev` | Latest recorded migration `20260904222450`; both portal account and identity tables exist with RLS enabled. | Older than this branch and the September 27 migrations in `main`. A useful catalog sample, not current deployment proof. |
| `gridex-ops-staging` | No `supabase_migrations.schema_migrations` relation or portal tables. | Cannot validate the current portal schema or policies here. |

In dev, `authenticated` has table-level `SELECT`, `INSERT`, `UPDATE` and `DELETE` grants on both `customer_portal_accounts` and `customer_portal_identities` (along with other table privileges). Grants alone do not bypass RLS:

- Both tables have a permissive authenticated SELECT policy `using (true)`, **and** a restrictive `tenant_lifecycle_select_guard` requiring an allowed session and platform administration or membership in the row's company. Treating the `true` policy alone as global read permission would be incorrect.
- Accounts have permissive authenticated INSERT and UPDATE policies plus restrictive `gridex_can_write_company(company_id)` lifecycle guards. In this snapshot, that helper permits active `owner`, `admin`, `company_admin` and `operations` memberships for an active/onboarding company, or platform administration, subject to an allowed session. There is no observed column-level restriction on role/status in the grant output. This is a candidate direct Data API write path around HTTP action rules **within the caller's tenant**, pending an actual synthetic role/token and schema-current test.
- Identity INSERT/UPDATE/DELETE show restrictive authenticated lifecycle policies, but no permissive authenticated policy for those commands in the snapshot. Their broad table grants alone therefore do not establish effective direct writes. Account DELETE similarly has a permissive policy only for platform administrators.

Before changing grants or policies, replay the current migrations in an isolated database; trace any existing authenticated SQL/RPC writers; test owner/admin/operations/read-only/disabled identities with synthetic rows and direct Data API calls; then verify the live intended deployment catalog. No migration, RLS policy or project data was changed during this review.
