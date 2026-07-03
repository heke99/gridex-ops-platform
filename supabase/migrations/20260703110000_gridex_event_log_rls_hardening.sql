-- RLS hardening for tenant-scoped event/log infrastructure tables that were
-- created without row level security (audit finding C1/C2,
-- docs/production-readiness-audit.md).
--
-- All application access to these tables goes through the server-side service
-- role today, which bypasses RLS — so this migration does not change any
-- existing behavior. It closes the door on future accidental exposure through
-- PostgREST/anon/authenticated grants:
--   * domain_events        — tenant + customer-scoped event stream
--   * communication_logs   — tenant email log (recipients, subjects)
--   * event_outbox         — event fan-out queue (payload snapshots)
--   * webhook_deliveries   — webhook queue (payloads, response bodies)
--   * platform_customer_relationship_observations — RLS was enabled without
--     any policy (default deny); adds explicit service-role and platform-admin
--     policies so the intent is visible and platform-admin reads work.
--
-- Forward-only, idempotent, additive. No destructive operations, no data
-- mutation. Rollback: drop the created policies / disable RLS.

-- ---------------------------------------------------------------------------
-- Helpers: policies are created only when the table, the referenced roles and
-- the RLS helper functions exist.
-- ---------------------------------------------------------------------------

do $$
declare
  has_service_role boolean;
  has_platform_admin_fn boolean;
  has_can_read_fn boolean;
  t text;
begin
  select exists (select 1 from pg_roles where rolname = 'service_role') into has_service_role;
  select to_regprocedure('public.gridex_user_is_platform_admin()') is not null into has_platform_admin_fn;
  select to_regprocedure('public.gridex_can_read_company(uuid)') is not null into has_can_read_fn;

  -- 1) Tenant-facing event/log tables: enable RLS, allow service role
  --    everything, allow platform admins + members of the owning company to
  --    read. Writes remain server-side (service role) only.
  foreach t in array array['domain_events', 'communication_logs'] loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);

    if has_service_role and not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and policyname = t || '_service_role_all'
    ) then
      execute format(
        'create policy %I on public.%I for all to service_role using (true) with check (true)',
        t || '_service_role_all', t
      );
    end if;

    if has_platform_admin_fn and has_can_read_fn and not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and policyname = t || '_tenant_read'
    ) then
      execute format(
        'create policy %I on public.%I for select to authenticated using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id))',
        t || '_tenant_read', t
      );
    end if;
  end loop;

  -- 2) Internal queue tables: enable RLS, service role everything, platform
  --    admins read-only (troubleshooting). Tenant users never read these
  --    directly — payloads/response bodies may contain provider internals.
  foreach t in array array['event_outbox', 'webhook_deliveries'] loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);

    if has_service_role and not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and policyname = t || '_service_role_all'
    ) then
      execute format(
        'create policy %I on public.%I for all to service_role using (true) with check (true)',
        t || '_service_role_all', t
      );
    end if;

    if has_platform_admin_fn and not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and policyname = t || '_platform_admin_read'
    ) then
      execute format(
        'create policy %I on public.%I for select to authenticated using (public.gridex_user_is_platform_admin())',
        t || '_platform_admin_read', t
      );
    end if;
  end loop;

  -- 3) platform_customer_relationship_observations: RLS already enabled
  --    (20260629121000) but with zero policies. Make the access model explicit:
  --    service role everything, platform admins read.
  if to_regclass('public.platform_customer_relationship_observations') is not null then
    if has_service_role and not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'platform_customer_relationship_observations'
        and policyname = 'platform_customer_relationship_observations_service_role_all'
    ) then
      create policy platform_customer_relationship_observations_service_role_all
        on public.platform_customer_relationship_observations
        for all to service_role using (true) with check (true);
    end if;

    if has_platform_admin_fn and not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'platform_customer_relationship_observations'
        and policyname = 'platform_customer_relationship_observations_platform_admin_read'
    ) then
      create policy platform_customer_relationship_observations_platform_admin_read
        on public.platform_customer_relationship_observations
        for select to authenticated using (public.gridex_user_is_platform_admin());
    end if;
  end if;
end $$;
