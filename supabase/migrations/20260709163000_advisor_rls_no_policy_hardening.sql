-- Supabase advisor hardening D: tables with RLS enabled but no policies.
--
-- Advisor: rls_enabled_no_policy (INFO).
--
-- Classification (see docs/security/supabase-advisors-hardening.md):
--   G1. SERVICE-ONLY tables (21): job/queue/sequence/parse/telemetry/platform
--       internals plus backend-managed legal/pricing catalogs. Accessed
--       exclusively through the backend service role in this repository.
--       RLS-enabled-with-no-policies is the INTENDED deny-by-default state;
--       we additionally revoke the default anon/authenticated table grants so
--       the posture is explicit and survives any accidental RLS toggle.
--       NO permissive policies are added.
--   G2. TENANT-READABLE (1): customer_operation_jobs is read by the tenant
--       admin work queue (app/admin/work-queue/page.tsx) with the user-context
--       client. With RLS enabled and no policy that page silently saw zero
--       rows. It gets ONE narrow company-scoped SELECT policy using the
--       canonical RBAC helpers. Writes remain service-role only (no
--       insert/update/delete policies).
--
-- Service role bypasses RLS and keeps its grants: intake, workers, cron,
-- EDIEL, outbox and email dispatch are unaffected.

set lock_timeout = '5s';
set statement_timeout = '120s';

-- G1: service-only tables -----------------------------------------------------
do $$
declare
  t text;
  existing_comment text;
  hardening_note constant text :=
    'Service-only table: accessed via backend service role. RLS enabled with no policies by design (deny-by-default for anon/authenticated); direct API-role grants revoked by advisor hardening 20260709163000.';
begin
  foreach t in array array[
    'public.company_number_sequences',
    'public.customer_application_intakes',
    'public.customer_external_auth_links',
    'public.customer_site_address_conflicts',
    'public.customer_site_address_history',
    'public.document_parse_jobs',
    'public.ediel_production_send_approvals',
    'public.gridex_performance_hardening_events',
    'public.integration_api_client_profiles',
    'public.integration_api_permission_groups',
    'public.legal_bundle_items',
    'public.legal_bundles',
    'public.onboarding_choices',
    'public.onboarding_sessions',
    'public.onboarding_steps',
    'public.platform_go_live_route_simulations',
    'public.platform_usage_events',
    'public.price_book_lines',
    'public.price_books',
    'public.tenant_email_outbox_runs',
    'public.tenant_launch_states'
  ]
  loop
    if to_regclass(t) is not null then
      execute format('revoke all on %s from public', t);
      execute format('revoke all on %s from anon', t);
      execute format('revoke all on %s from authenticated', t);
      execute format('grant all on %s to service_role', t);
      -- Preserve any existing business comment; append the hardening note once.
      existing_comment := obj_description(to_regclass(t));
      if existing_comment is null then
        execute format('comment on table %s is %L', t, hardening_note);
      elsif position('advisor hardening 20260709163000' in existing_comment) = 0 then
        execute format('comment on table %s is %L', t, existing_comment || ' ' || hardening_note);
      end if;
    else
      raise notice 'gridex advisor hardening: table % not found, skipping service-only hardening', t;
    end if;
  end loop;
end $$;

-- G2: customer_operation_jobs tenant read policy -------------------------------
do $$
begin
  if to_regclass('public.customer_operation_jobs') is null then
    return;
  end if;

  -- anon must never touch the job queue; authenticated keeps SELECT only
  -- (needed for the RLS-scoped tenant work queue), never insert/update/delete.
  revoke all on public.customer_operation_jobs from public;
  revoke all on public.customer_operation_jobs from anon;
  revoke insert, update, delete, truncate, references, trigger on public.customer_operation_jobs from authenticated;
  grant select on public.customer_operation_jobs to authenticated;
  grant all on public.customer_operation_jobs to service_role;

  if not exists (
    select 1 from pg_policy
    where polrelid = 'public.customer_operation_jobs'::regclass
      and polname = 'customer_operation_jobs_tenant_read'
  ) then
    create policy customer_operation_jobs_tenant_read
      on public.customer_operation_jobs
      for select
      to authenticated
      using (
        public.gridex_user_is_platform_admin()
        or public.gridex_can_read_company(company_id)
      );
  end if;
end $$;
