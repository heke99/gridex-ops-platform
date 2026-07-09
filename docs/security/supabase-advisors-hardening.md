# Supabase Advisors — Database Security Hardening

Status: implemented 2026-07-09 against project `gridex-ops-dev`
(`piidsfebjqjmnepdpnas`, Postgres 17). Baseline: 136 security findings
(24 ERROR `security_definer_view`, 25 WARN `function_search_path_mutable`,
30 WARN `anon_security_definer_function_executable`, 34 WARN
`authenticated_security_definer_function_executable`, 22 INFO
`rls_enabled_no_policy`, 1 WARN `auth_leaked_password_protection`).

Regression: `npm run gridex:supabase-advisors-hardening-regression`.

## Architecture facts the remediation relies on

Verified in this repository before any SQL was changed:

1. The anon-key **browser client (`lib/supabase/client.ts`) is imported
   nowhere**. All Supabase access is server-side.
2. Two server clients exist: the user-context client
   (`lib/supabase/server.ts`, `authenticated` role, RLS applies — used by
   admin UI pages/actions) and the service-role client
   (`lib/supabase/service.ts` — bypasses RLS).
3. **None of the flagged views and none of the flagged RPC functions are
   accessed through the user-context client.** Every `.from('<view>')` /
   `.rpc('<fn>')` call site for the flagged objects uses `supabaseService`.
4. Exception: `app/admin/work-queue/page.tsx` reads `customer_operation_jobs`
   with the user-context client (see G2 below).

## Migrations

| Migration | Advisor | Change |
|---|---|---|
| `20260709160000_advisor_function_search_path.sql` | `function_search_path_mutable` | `ALTER FUNCTION ... SET search_path` on all 25 flagged functions (exact identity signatures; bodies/owners/modes/grants untouched) |
| `20260709161000_advisor_function_execute_revokes.sql` | `anon_/authenticated_security_definer_function_executable` | Revoke EXECUTE from PUBLIC/anon/authenticated on 29 privileged definer functions (+ explicit grant to service_role); revoke anon on the 5 RLS-helper exceptions |
| `20260709162000_advisor_security_invoker_views.sql` | `security_definer_view` | `ALTER VIEW ... SET (security_invoker = true)` on all 24 flagged views + revoke anon/authenticated SELECT (service-only) |
| `20260709163000_advisor_rls_no_policy_hardening.sql` | `rls_enabled_no_policy` | Revoke anon/authenticated grants on 21 service-only tables (RLS deny-by-default kept, **no permissive policies added**); one narrow tenant SELECT policy on `customer_operation_jobs` |

All migrations use `lock_timeout='5s'` / `statement_timeout='120s'`, contain no
destructive DDL, never drop/recreate functions or views, and guard every
statement with `to_regprocedure`/`to_regclass` so they replay safely on
environments where an object is missing.

## A. `function_search_path_mutable` (25 functions — fixed)

All pinned to `search_path = public, pg_temp`, except:

- `gridex_lonlat_to_grid_area(numeric, numeric)` → `public, extensions,
  pg_temp` (PostGIS: `extensions.ST_*` calls plus geometry type/operator
  resolution).
- `gridex_validate_outbound_payload(text, text, jsonb, uuid)` already had
  `search_path = public, auth, extensions` (only the zero-arg trigger overload
  was flagged and is now pinned).

Fixed inventory (owner `postgres`, all SECURITY INVOKER, modes preserved):
`gridex_normalize_customer_number_prefix(text, text)`,
`gridex_legal_text_versions_set_updated_at()`,
`gridex_prevent_published_legal_text_mutation()`,
`gridex_customer_legal_acceptances_immutable()`,
`gridex_assert_same_company(uuid, uuid, text, text)`,
`gridex_customer_sites_company_guard()`,
`gridex_metering_points_company_guard()`,
`gridex_customer_contracts_company_guard()`,
`gridex_contract_price_snapshots_company_guard()`,
`gridex_customer_legal_acceptances_company_guard()`,
`gridex_powers_of_attorney_company_guard()`,
`gridex_billing_underlays_company_guard()`,
`claim_inbound_processing_jobs(text, integer, text, interval)`,
`claim_ediel_outbox_items(text, uuid, integer, text, interval)`,
`gridex_normalize_actor_text(text)`,
`gridex_normalize_actor_identifier(text, text)`,
`gridex_normalize_public_offer_code(text)`,
`gridex_assign_public_offer_code()`,
`gridex_lonlat_to_grid_area(numeric, numeric)`,
`gridex_customer_operation_jobs_run_after_guard()`,
`gridex_platform_default_legal_templates_set_updated_at()`,
`gridex_block_contract_price_snapshot_mutation()`,
`gridex_protect_locked_pricing_runs()`,
`gridex_protect_sent_invoice_export_items()`,
`gridex_validate_outbound_payload()`.

Policy going forward: new `CREATE FUNCTION public.*` statements in migrations
`>= 20260709` must include an explicit `set search_path` (checked by the
regression script).

## B. `security_definer_view` (24 views — fixed, ERROR-level)

All 24 views converted with `ALTER VIEW ... SET (security_invoker = true)`
(no recreation: columns, comments, dependencies and owner preserved) and
classified **service-only**: SELECT revoked from `anon` and `authenticated`,
kept for `service_role`.

Consumers verified per view: every application read goes through
`supabaseService` (service role, bypasses RLS), so the conversion is
behavior-neutral for the app while removing the definer/RLS-bypass exposure
through PostgREST for both API roles.

`company_actor_testing_status_v`, `tenant_customer_intake_tracking_v`,
`tenant_event_mail_readiness_v`, `gridex_ops_hardening_health_v`,
`tenant_contract_offer_readiness_v`,
`gridex_public_contract_offer_api_diagnostics_v`,
`gridex_multiple_permissive_policy_candidates_v`,
`gridex_duplicate_index_candidates_v`,
`gridex_data_cleanup_customer_candidates_v`, `gridex_tenant_usage_monthly_v`,
`gridex_actor_import_preview_v`, `gridex_grid_owner_verification_status_v`,
`gridex_public_contract_offer_admin_v`,
`gridex_api_client_permission_summary_v`,
`gridex_tenant_email_dispatch_readiness_v`, `gridex_company_route_readiness_v`,
`customer_ops_master_readiness_v`, `customer_ops_timeline_v`,
`tenant_website_readiness_v`, `gridex_energy_geodata_health_v`,
`platform_grid_owner_readiness_v` (live-only object, guarded),
`gridex_operational_route_repair_v`, `gridex_grid_owner_business_readiness_v`,
`platform_go_live_readiness_v`.

## C. Definer functions executable by anon/authenticated

### C1. Revoked (service-role only, 29 functions)

None of these have any user-context `.rpc()` caller in the repository; all are
invoked by backend/service-role code, other SECURITY DEFINER SQL, triggers
(EXECUTE is not checked for the DML user at trigger fire time), or migrations:

`anonymize_user_account(uuid)`, `check_email_exists(text)`,
`complete_core_onboarding(uuid)`, `select_onboarding_start_path(uuid, text)`,
`gridex_actor_readiness_backfill(text)`,
`gridex_apply_actor_auto_send_readiness(uuid)`,
`gridex_approve_first_production_send(uuid, uuid, uuid, text)`,
`gridex_backfill_grid_owner_verification(text)`,
`gridex_complete_grid_owner_readiness(text)`,
`gridex_confirm_grid_owner_empty_subaddress(uuid, text, uuid, text)`,
`gridex_confirm_registry_empty_subaddresses(text)`,
`gridex_confirm_safe_blank_route_subaddresses(text, uuid, boolean)`,
`gridex_create_actor_registry_conflict(uuid, uuid, uuid, uuid, uuid, uuid,
text, text, text, text, jsonb, jsonb, jsonb)`,
`gridex_customer_cleanup_external_ref(uuid)`,
`gridex_default_document_prefix(uuid, text)`,
`gridex_invalidate_site_operations_on_address_change()` (trigger),
`gridex_match_actor_registry_item(uuid)`,
`gridex_materialize_company_operational_routes(uuid, text, text, uuid, uuid,
text, boolean)`, `gridex_next_application_number(uuid)`,
`gridex_next_contract_number(uuid, text)`,
`gridex_next_document_number(uuid, text, text)`,
`gridex_optimize_rls_auth_initplans()`,
`gridex_recalculate_actor_readiness(uuid)`,
`gridex_refresh_actor_certificate_statuses(text)`,
`gridex_resolve_ediel_route_for_process(uuid, text, text, text, text)`,
`gridex_seed_default_legal_package_after_company_insert()` (trigger),
`gridex_seed_default_legal_package_for_company(uuid, uuid)`,
`gridex_unlock_pricing_runs_for_month(uuid, text, uuid, text)`,
`gridex_upsert_customer_action_task(uuid, uuid, text, text, text, text, jsonb)`.

Note on the number generators (`gridex_next_*`, `gridex_default_document_prefix`):
their only SQL callers are themselves SECURITY DEFINER wrappers owned by
`postgres`, so inner-call EXECUTE checks run as the owner and are unaffected.

Note on `check_email_exists`: no anon consumer exists in this repository
(external websites integrate through the authenticated integration API, not
direct PostgREST RPC). If a public email-availability check is ever needed, it
must be exposed through a rate-limited backend endpoint, not an anon RPC
(enumeration risk).

### C2. Documented exceptions (kept executable by `authenticated`)

RLS/RBAC helpers referenced by hundreds of policies; policy evaluation runs
with the querying role's privileges, so `authenticated` needs EXECUTE. They
return only booleans/uuid arrays/the caller's own `auth.uid()`-scoped context,
expose no table data and mutate nothing. `anon` + PUBLIC EXECUTE revoked.

- `gridex_user_is_platform_admin()`
- `gridex_can_read_company(uuid)`
- `gridex_can_write_company(uuid)`
- `gridex_user_company_ids()`
- `gridex_current_user_context()`

The remaining `authenticated_security_definer_function_executable` WARN
findings for exactly these five functions are **accepted with this
justification**; everything else must stay revoked.

## D. `rls_enabled_no_policy` (22 tables — classified)

### G1. Service-only (21 tables — intentionally NO policies)

Job/queue/sequence/parse/telemetry/platform internals plus backend-managed
legal/pricing catalogs. All access in the repository goes through the service
role. RLS stays enabled with zero policies (deny-by-default is the intended
state — this is not "silencing", it is the documented classification the INFO
advisor asks for); direct anon/authenticated table grants are additionally
revoked so the posture is explicit:

`company_number_sequences`, `customer_application_intakes`,
`customer_external_auth_links`, `customer_site_address_conflicts`,
`customer_site_address_history`, `document_parse_jobs`,
`ediel_production_send_approvals`, `gridex_performance_hardening_events`,
`integration_api_client_profiles`, `integration_api_permission_groups`,
`legal_bundle_items`, `legal_bundles`, `onboarding_choices`,
`onboarding_sessions`, `onboarding_steps`,
`platform_go_live_route_simulations`, `platform_usage_events`,
`price_book_lines`, `price_books`, `tenant_email_outbox_runs`,
`tenant_launch_states`.

If a tenant UI later needs direct reads of any of these, add a narrow
company-scoped policy at that time — never `using (true)`.

### G2. Tenant-readable (1 table — narrow policy added)

`customer_operation_jobs`: the tenant work queue
(`app/admin/work-queue/page.tsx`) reads it with the user-context client and —
with RLS enabled and no policy — silently received zero rows (latent bug).
Added exactly one SELECT policy for `authenticated`:

```sql
using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id))
```

Writes remain service-role only (insert/update/delete/truncate grants revoked
for `authenticated`, no write policies).

## E. `auth_leaked_password_protection` (manual project setting)

Cannot be configured from SQL or repo code. Required production step
(tracked in `docs/env-production-checklist.md` and the go-live cutover plan):

> Supabase Dashboard → Authentication → Providers → Password → enable
> "Prevent use of leaked passwords" (HaveIBeenPwned).

Until enabled, treat this advisor WARN as a go-live blocker unless the
platform admin explicitly attests an exception.

## Verification SQL (run against the live database)

### K1. Functions without explicit search_path

```sql
select n.nspname as schema_name, p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as args, p.proconfig
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (p.proconfig is null
       or not exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%'))
order by 1, 2;
```

### K2. SECURITY DEFINER views (should return 0 rows)

```sql
select n.nspname, c.relname, c.reloptions
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'v'
  and n.nspname = 'public'
  and (c.reloptions is null or not (c.reloptions::text ilike '%security_invoker=%'));
```

### K3. SECURITY DEFINER functions executable by anon/authenticated

```sql
select n.nspname as schema_name, p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as args,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef = true
  and (has_function_privilege('anon', p.oid, 'execute')
       or has_function_privilege('authenticated', p.oid, 'execute'))
order by 1, 2;
-- Expected: only the five documented RLS helpers, authenticated only.
```

### K4. RLS enabled with no policies (expected: only the documented G1 set)

```sql
select n.nspname as schema_name, c.relname as table_name,
       c.relrowsecurity as rls_enabled, count(pol.*) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy pol on pol.polrelid = c.oid
where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = true
group by 1, 2, 3
having count(pol.*) = 0
order by 1, 2;
```

## Do-not-break verification

After applying the four migrations to the live project, the full static
regression battery (`scripts/gridex-*.cjs`, `scripts/ops-hardening*.cjs`,
`scripts/ediel-*.cjs`), `npm run typecheck`, `npm test` and `npm run build`
must pass with no NEW failures, and the Supabase security advisors must show
0 `security_definer_view` ERRORs, 0 `function_search_path_mutable` WARNs for
the listed functions, no privileged definer functions executable by anon, and
only the five documented helper exceptions for authenticated.
