-- Converge the canonical schema with the tenant isolation invariant gate.
--
-- The gate in scripts/sql/tenant-isolation-invariants.sql passes against the
-- live schema but fails against a database replayed from this repository. A
-- system rebuilt from the migration chain was therefore missing hardening that
-- live already carries, which is exactly the drift the migration chain is
-- supposed to make impossible: the chain, not a live database, is the schema
-- authority.
--
-- Every change below is defence in depth with no behavioural change. It was
-- checked against a full clean replay before being written:
--
--   * none of the tables gaining row level security grants any privilege to
--     anon or authenticated, so no client can reach them either way, and
--     service_role bypasses RLS;
--   * the policies dropped target service_role alone, which bypasses RLS, so
--     they never had any effect;
--   * the functions leaving the anonymous surface are revoked from both PUBLIC
--     and anon. PUBLIC alone is not enough: Supabase's default privileges give
--     anon an explicit EXECUTE grant when a function is created, which a
--     revoke from PUBLIC does not touch. Their two application callers both use
--     the service-role client, and policies reach SECURITY DEFINER predicates
--     without the caller holding EXECUTE.

-- 1. Classify the inbound parser relations.
--    They match their siblings exactly: company-owned rows, closed by grants.
insert into public.platform_table_classification (table_name, kind, rationale, classified_by)
values
  (
    'inbound_ediel_match_attempts',
    'system',
    'Service-role only: no client role holds any privilege, so the table is closed by grants rather than by policy.',
    'migration'
  ),
  (
    'inbound_ediel_parse_results',
    'system',
    'Service-role only: no client role holds any privilege, so the table is closed by grants rather than by policy.',
    'migration'
  ),
  (
    'inbound_email_attachments',
    'system',
    'Service-role only: no client role holds any privilege, so the table is closed by grants rather than by policy.',
    'migration'
  )
on conflict (table_name) do nothing;

-- 2. Row level security on service-role-only tables.
--    Closed by grants today; this makes them closed by default as well, so a
--    later grant cannot silently open them.
alter table public.price_areas enable row level security;
alter table public.price_area_localities enable row level security;
alter table public.gridex_performance_hardening_events enable row level security;
alter table public.integration_api_permission_groups enable row level security;
alter table public.integration_api_client_profiles enable row level security;
alter table public.legal_bundle_items enable row level security;
alter table public.price_book_lines enable row level security;
alter table public.platform_schema_state enable row level security;

-- 3. Views must run as the invoker, or they hand out the definer's reach.
alter view public.gridex_automation_control_center_v set (security_invoker = true);
alter view public.gridex_batch_2b_live_control_tower_v set (security_invoker = true);
alter view public.gridex_batch_2c_control_tower_summary_v set (security_invoker = true);

-- 4. Drop policies that target service_role alone. service_role bypasses RLS,
--    so these never applied and only made the policy set harder to read.
drop policy if exists inbound_ediel_match_attempts_service_role_all
  on public.inbound_ediel_match_attempts;
drop policy if exists inbound_ediel_parse_results_service_role_all
  on public.inbound_ediel_parse_results;
drop policy if exists inbound_email_attachments_service_role_all
  on public.inbound_email_attachments;

-- 5. Take the SECURITY DEFINER helpers off the anonymous RPC surface.
revoke execute on function public.gridex_default_customer_number_prefix(uuid) from public;
revoke execute on function public.gridex_default_customer_number_prefix(uuid) from anon;
grant execute on function public.gridex_default_customer_number_prefix(uuid) to service_role;

revoke execute on function public.gridex_next_customer_number(uuid) from public;
revoke execute on function public.gridex_next_customer_number(uuid) from anon;
grant execute on function public.gridex_next_customer_number(uuid) to service_role;

revoke execute on function public.gridex_db4b_archive_customer_registry_row(text, text, boolean, text) from public;
revoke execute on function public.gridex_db4b_archive_customer_registry_row(text, text, boolean, text) from anon;
grant execute on function public.gridex_db4b_archive_customer_registry_row(text, text, boolean, text) to service_role;

revoke execute on function public.gridex_company_go_live_readiness(uuid) from public;
revoke execute on function public.gridex_company_go_live_readiness(uuid) from anon;
grant execute on function public.gridex_company_go_live_readiness(uuid) to service_role;

revoke execute on function public.canonical_onboard_customer_graph(jsonb) from public;
revoke execute on function public.canonical_onboard_customer_graph(jsonb) from anon;
grant execute on function public.canonical_onboard_customer_graph(jsonb) to service_role;

revoke execute on function public.gridex_gate_inbound_z02_snapshot_freshness() from public;
revoke execute on function public.gridex_gate_inbound_z02_snapshot_freshness() from anon;
grant execute on function public.gridex_gate_inbound_z02_snapshot_freshness() to service_role;
