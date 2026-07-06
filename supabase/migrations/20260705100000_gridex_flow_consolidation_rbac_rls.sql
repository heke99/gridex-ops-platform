-- Flow consolidation hardening (Workstream A):
--  1) RLS for company_onboarding_tasks (created without row level security).
--     All application access is server-side via the service role today, so this
--     changes no behavior — it closes accidental PostgREST/anon exposure.
--  2) Seed the integrations.read / integrations.write permissions that the
--     tenant webhook administration actions already require
--     (app/admin/webhooks/actions.ts) but that never existed in the permission
--     registry, and grant them to the standard admin roles.
--  3) Align the inbound e-mail dedupe unique indexes with the application's
--     tenant + environment scoped dedupe (lib/inbound-mail/edielMailboxPoller.ts):
--     the old global indexes on (sender_ediel_id, interchange_reference) could
--     block a legitimate message for tenant B (or environment 'production')
--     because tenant A (or 'test') already stored the same sender/reference.
--
-- Forward-only, idempotent. Rollback: drop the policies / created indexes and
-- delete the seeded permission rows.

-- ---------------------------------------------------------------------------
-- 1) company_onboarding_tasks RLS
-- ---------------------------------------------------------------------------
do $$
declare
  has_service_role boolean;
  has_platform_admin_fn boolean;
  has_can_read_fn boolean;
begin
  if to_regclass('public.company_onboarding_tasks') is null then
    return;
  end if;

  select exists (select 1 from pg_roles where rolname = 'service_role') into has_service_role;
  select to_regprocedure('public.gridex_user_is_platform_admin()') is not null into has_platform_admin_fn;
  select to_regprocedure('public.gridex_can_read_company(uuid)') is not null into has_can_read_fn;

  execute 'alter table public.company_onboarding_tasks enable row level security';

  if has_service_role and not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'company_onboarding_tasks'
      and policyname = 'company_onboarding_tasks_service_role_all'
  ) then
    execute 'create policy company_onboarding_tasks_service_role_all on public.company_onboarding_tasks for all to service_role using (true) with check (true)';
  end if;

  if has_platform_admin_fn and has_can_read_fn and not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'company_onboarding_tasks'
      and policyname = 'company_onboarding_tasks_tenant_read'
  ) then
    execute 'create policy company_onboarding_tasks_tenant_read on public.company_onboarding_tasks for select to authenticated using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id))';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) integrations.read / integrations.write permissions
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.permissions') is null then
    return;
  end if;

  begin
    insert into public.permissions (key, label, description, area, risk)
    values
      ('integrations.read', 'Läsa integrationer', 'Kan läsa webhookar och integrationsinställningar för bolaget.', 'Integrationer', 'medium'),
      ('integrations.write', 'Ändra integrationer', 'Kan hantera webhookar och integrationsinställningar för bolaget.', 'Integrationer', 'high')
    on conflict (key) do nothing;
  exception when undefined_column then
    insert into public.permissions (key, name, description, category)
    values
      ('integrations.read', 'Läsa integrationer', 'Kan läsa webhookar och integrationsinställningar för bolaget.', 'Integrationer'),
      ('integrations.write', 'Ändra integrationer', 'Kan hantera webhookar och integrationsinställningar för bolaget.', 'Integrationer')
    on conflict (key) do nothing;
  end;
end $$;

do $$
declare
  v_role record;
begin
  if to_regclass('public.roles') is null
     or to_regclass('public.permissions') is null
     or to_regclass('public.role_permissions') is null
  then
    return;
  end if;

  for v_role in
    select id from public.roles where key in ('super_admin', 'admin', 'company_admin', 'partner_manager')
  loop
    insert into public.role_permissions (role_id, permission_id)
    select v_role.id, p.id
    from public.permissions p
    where p.key in ('integrations.read', 'integrations.write')
      and not exists (
        select 1
        from public.role_permissions rp
        where rp.role_id = v_role.id
          and rp.permission_id = p.id
      );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3) Tenant + environment scoped inbound dedupe indexes
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.inbound_email_messages') is null then
    return;
  end if;

  -- Replace the tenant-blind unique indexes with company + environment scoped
  -- ones, matching the phase-2 dedupe queries in the poller. The old indexes
  -- are only dropped after the scoped replacements exist.
  if not exists (
    select 1
    from public.inbound_email_messages
    where sender_ediel_id is not null and interchange_reference is not null and company_id is not null
    group by company_id, environment, sender_ediel_id, interchange_reference
    having count(*) > 1
  ) then
    create unique index if not exists ux_inbound_email_messages_company_sender_interchange
      on public.inbound_email_messages(company_id, environment, sender_ediel_id, interchange_reference)
      where sender_ediel_id is not null and interchange_reference is not null and company_id is not null;

    drop index if exists public.ux_inbound_email_messages_sender_interchange;
  else
    raise notice 'Skipped ux_inbound_email_messages_company_sender_interchange: duplicate (company_id, environment, sender_ediel_id, interchange_reference) rows exist. Clean up and create the index manually.';
  end if;

  if not exists (
    select 1
    from public.inbound_email_messages
    where sender_ediel_id is not null and transaction_reference is not null and external_reference is not null and company_id is not null
    group by company_id, environment, sender_ediel_id, transaction_reference, external_reference
    having count(*) > 1
  ) then
    create unique index if not exists ux_inbound_email_messages_company_sender_tx_external
      on public.inbound_email_messages(company_id, environment, sender_ediel_id, transaction_reference, external_reference)
      where sender_ediel_id is not null and transaction_reference is not null and external_reference is not null and company_id is not null;

    drop index if exists public.ux_inbound_email_messages_sender_tx_external;
  else
    raise notice 'Skipped ux_inbound_email_messages_company_sender_tx_external: duplicate rows exist. Clean up and create the index manually.';
  end if;
end $$;
