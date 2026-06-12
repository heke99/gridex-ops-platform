-- Gridex Launch RLS Suggestion Policy Completion
-- Purpose:
--   Remove Supabase Security Advisor INFO suggestions for "RLS Enabled No Policy"
--   without opening tenant, Ediel, pricing, auth or internal operational data.
--
-- Production principle:
--   - Tables that previously had RLS enabled with no policies were inaccessible to anon/auth.
--   - This migration keeps that secure default for internal/service-owned tables by adding explicit
--     platform-admin-only or tenant-scoped read policies instead of broad USING (true) policies.
--   - anon receives no direct table access.
--   - service_role continues to operate through Supabase's normal RLS bypass for backend jobs.
--   - tenant-scoped read access is only added for operational tables where direct admin UI reads are reasonable.
--   - writes remain platform/service controlled unless explicitly safe.

-- -----------------------------------------------------------------------------
-- 0) Table classification helpers
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
  company_read_tables text[] := array[
    'company_email_dns_records',
    'company_market_party_routes',
    'ediel_ai_list_discrepancies',
    'ediel_ai_list_imports',
    'ediel_ai_list_jobs',
    'ediel_ai_list_runs',
    'ediel_brp_settings',
    'ediel_engine_runs',
    'ediel_file_exchange_runs',
    'ediel_inbound_poll_runs',
    'ediel_masterdata_reconciliation_items',
    'ediel_message_splits',
    'ediel_permission_cases',
    'ediel_permission_events',
    'ediel_test_artifacts',
    'ediel_test_customers',
    'ediel_test_facilities',
    'ediel_test_metering_points',
    'meter_reading_series',
    'metering_requirements',
    'pricing_automation_runs'
  ];
  reference_read_tables text[] := array[
    'consumption_profile_month_weights',
    'spot_price_daily_summaries',
    'spot_price_sources'
  ];
  platform_only_tables text[] := array[
    'auth_provisioning_events',
    'ediel_ack_rules',
    'ediel_business_deadline_rules',
    'ediel_canonical_error_mappings',
    'ediel_certificate_directory_cache',
    'ediel_certification_golden_results',
    'ediel_certification_test_runs',
    'ediel_code_lists',
    'ediel_code_rules',
    'ediel_error_rules',
    'ediel_field_matrix_imports',
    'ediel_field_rules',
    'ediel_high_risk_approvals',
    'ediel_market_calendar_entries',
    'ediel_message_build_rules',
    'ediel_message_rules_cleanup_audit',
    'ediel_parties',
    'ediel_party_addresses',
    'ediel_rule_activation_log',
    'ediel_rule_change_logs',
    'ediel_rule_compile_results',
    'ediel_rule_sources',
    'ediel_rulebooks',
    'ediel_test_cases',
    'ediel_test_data_sets',
    'ediel_test_expected_acks',
    'ediel_test_expected_values',
    'ediel_test_field_values',
    'ediel_test_run_messages',
    'ediel_test_run_snapshots',
    'ediel_test_run_steps',
    'ediel_test_steps',
    'ediel_test_suites',
    'ediel_version_rules',
    'email_event_rules',
    'gridex_archived_customer_registry_rows',
    'gridex_schema_repair_findings',
    'gridex_schema_repair_runs',
    'gridex_wrong_project_cleanup_backup',
    'platform_session_revocations',
    'spot_price_import_runs'
  ];
  all_tables text[] := company_read_tables || reference_read_tables || platform_only_tables || array[
    'meter_reading_values',
    'user_profiles'
  ];
begin
  -- Always remove direct anon access from these RLS-protected tables.
  foreach t in array all_tables loop
    if to_regclass(format('public.%I', t)) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('revoke all on table public.%I from anon', t);
    end if;
  end loop;

  -- Company-scoped operational data: tenant admins can read their own company data.
  -- Writes remain platform/service controlled so tenants cannot directly mutate routes,
  -- Ediel operational logs, meter readings or automation runs from the client.
  foreach t in array company_read_tables loop
    if to_regclass(format('public.%I', t)) is not null then
      if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = t
          and column_name = 'company_id'
      ) then
        if not exists (
          select 1 from pg_policies
          where schemaname = 'public'
            and tablename = t
            and policyname = 'gridex_launch_tenant_read'
        ) then
          execute format(
            'create policy gridex_launch_tenant_read on public.%I for select to authenticated using (public.gridex_can_read_company(company_id))',
            t
          );
        end if;
      else
        -- If a table was classified as company-scoped but the live schema has no company_id,
        -- do not guess joins. Keep it platform-only to preserve tenant isolation.
        if not exists (
          select 1 from pg_policies
          where schemaname = 'public'
            and tablename = t
            and policyname = 'gridex_launch_platform_only'
        ) then
          execute format(
            'create policy gridex_launch_platform_only on public.%I for all to authenticated using (public.gridex_user_is_platform_admin()) with check (public.gridex_user_is_platform_admin())',
            t
          );
        end if;
      end if;

      if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = t
          and policyname = 'gridex_launch_platform_write'
      ) then
        execute format(
          'create policy gridex_launch_platform_write on public.%I for all to authenticated using (public.gridex_user_is_platform_admin()) with check (public.gridex_user_is_platform_admin())',
          t
        );
      end if;
    end if;
  end loop;

  -- Global reference data: signed-in users may read; only platform/service may write.
  -- This is limited to non-sensitive reference data that supports pricing/planning UX.
  foreach t in array reference_read_tables loop
    if to_regclass(format('public.%I', t)) is not null then
      if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = t
          and policyname = 'gridex_launch_authenticated_reference_read'
      ) then
        execute format(
          'create policy gridex_launch_authenticated_reference_read on public.%I for select to authenticated using (true)',
          t
        );
      end if;

      if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = t
          and policyname = 'gridex_launch_platform_write'
      ) then
        execute format(
          'create policy gridex_launch_platform_write on public.%I for all to authenticated using (public.gridex_user_is_platform_admin()) with check (public.gridex_user_is_platform_admin())',
          t
        );
      end if;
    end if;
  end loop;

  -- Internal/service/platform tables: explicit platform-only policy.
  -- This removes the linter suggestion without giving tenants broad direct data access.
  foreach t in array platform_only_tables loop
    if to_regclass(format('public.%I', t)) is not null then
      if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = t
          and policyname = 'gridex_launch_platform_only'
      ) then
        execute format(
          'create policy gridex_launch_platform_only on public.%I for all to authenticated using (public.gridex_user_is_platform_admin()) with check (public.gridex_user_is_platform_admin())',
          t
        );
      end if;
    end if;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 1) meter_reading_values: tenant-readable through parent meter_reading_series.
-- -----------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.meter_reading_values') is not null then
    alter table public.meter_reading_values enable row level security;
    revoke all on table public.meter_reading_values from anon;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'meter_reading_values'
        and column_name = 'series_id'
    ) and to_regclass('public.meter_reading_series') is not null then
      if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'meter_reading_values'
          and policyname = 'gridex_launch_meter_values_tenant_read'
      ) then
        create policy gridex_launch_meter_values_tenant_read
          on public.meter_reading_values
          for select
          to authenticated
          using (
            exists (
              select 1
              from public.meter_reading_series s
              where s.id = meter_reading_values.series_id
                and public.gridex_can_read_company(s.company_id)
            )
          );
      end if;
    end if;

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'meter_reading_values'
        and policyname = 'gridex_launch_meter_values_platform_write'
    ) then
      create policy gridex_launch_meter_values_platform_write
        on public.meter_reading_values
        for all
        to authenticated
        using (public.gridex_user_is_platform_admin())
        with check (public.gridex_user_is_platform_admin());
    end if;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 2) user_profiles: user can read/update own profile; platform admin can manage.
-- -----------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.user_profiles') is not null then
    alter table public.user_profiles enable row level security;
    revoke all on table public.user_profiles from anon;

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'user_profiles'
        and policyname = 'gridex_launch_user_profiles_self_read'
    ) then
      create policy gridex_launch_user_profiles_self_read
        on public.user_profiles
        for select
        to authenticated
        using (id = auth.uid() or public.gridex_user_is_platform_admin());
    end if;

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'user_profiles'
        and policyname = 'gridex_launch_user_profiles_self_update'
    ) then
      create policy gridex_launch_user_profiles_self_update
        on public.user_profiles
        for update
        to authenticated
        using (id = auth.uid() or public.gridex_user_is_platform_admin())
        with check (id = auth.uid() or public.gridex_user_is_platform_admin());
    end if;

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'user_profiles'
        and policyname = 'gridex_launch_user_profiles_platform_insert_delete'
    ) then
      create policy gridex_launch_user_profiles_platform_insert_delete
        on public.user_profiles
        for all
        to authenticated
        using (public.gridex_user_is_platform_admin())
        with check (public.gridex_user_is_platform_admin());
    end if;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 3) Audit marker for launch hardening visibility.
-- -----------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.gridex_launch_retention_policies') is not null then
    insert into public.gridex_launch_retention_policies(policy_key, retention_days, action, is_active, notes)
    values (
      'launch_rls_suggestion_policy_completion',
      0,
      'audit_only',
      true,
      'Added explicit production RLS policies for Supabase RLS-enabled-no-policy suggestions without broad anon access.'
    )
    on conflict (policy_key) do update set
      is_active = excluded.is_active,
      notes = excluded.notes;
  else
    raise notice 'gridex_launch_retention_policies does not exist; audit marker skipped.';
  end if;
end $$;
