-- Flow consolidation hardening (Workstream A)
--
-- 1) Enable RLS for company_onboarding_tasks.
-- 2) Seed integrations.read / integrations.write permissions safely.
-- 3) Align inbound e-mail dedupe indexes with tenant + environment scoped dedupe.
--
-- Forward-only, idempotent.

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

  select exists (
    select 1
    from pg_roles
    where rolname = 'service_role'
  ) into has_service_role;

  select to_regprocedure('public.gridex_user_is_platform_admin()') is not null
    into has_platform_admin_fn;

  select to_regprocedure('public.gridex_can_read_company(uuid)') is not null
    into has_can_read_fn;

  execute 'alter table public.company_onboarding_tasks enable row level security';

  if has_service_role and not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'company_onboarding_tasks'
      and policyname = 'company_onboarding_tasks_service_role_all'
  ) then
    execute '
      create policy company_onboarding_tasks_service_role_all
      on public.company_onboarding_tasks
      for all
      to service_role
      using (true)
      with check (true)
    ';
  end if;

  if has_platform_admin_fn and has_can_read_fn and not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'company_onboarding_tasks'
      and policyname = 'company_onboarding_tasks_tenant_read'
  ) then
    execute '
      create policy company_onboarding_tasks_tenant_read
      on public.company_onboarding_tasks
      for select
      to authenticated
      using (
        public.gridex_user_is_platform_admin()
        or public.gridex_can_read_company(company_id)
      )
    ';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 2) integrations.read / integrations.write permissions
-- Schema-safe. Does not assume category/area/risk/label/name exist.
-- ---------------------------------------------------------------------------
do $$
declare
  has_key boolean;
  has_label boolean;
  has_name boolean;
  has_description boolean;
  has_area boolean;
  has_category boolean;
  has_risk boolean;

  cols text[];
  vals_read text[];
  vals_write text[];
begin
  if to_regclass('public.permissions') is null then
    raise notice 'Skipped integrations permissions seed: public.permissions does not exist.';
    return;
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'permissions'
      and column_name = 'key'
  ) into has_key;

  if not has_key then
    raise notice 'Skipped integrations permissions seed: public.permissions.key does not exist.';
    return;
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'permissions' and column_name = 'label'
  ) into has_label;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'permissions' and column_name = 'name'
  ) into has_name;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'permissions' and column_name = 'description'
  ) into has_description;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'permissions' and column_name = 'area'
  ) into has_area;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'permissions' and column_name = 'category'
  ) into has_category;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'permissions' and column_name = 'risk'
  ) into has_risk;

  cols := array['key'];
  vals_read := array[quote_literal('integrations.read')];
  vals_write := array[quote_literal('integrations.write')];

  if has_label then
    cols := array_append(cols, 'label');
    vals_read := array_append(vals_read, quote_literal('Läsa integrationer'));
    vals_write := array_append(vals_write, quote_literal('Ändra integrationer'));
  elsif has_name then
    cols := array_append(cols, 'name');
    vals_read := array_append(vals_read, quote_literal('Läsa integrationer'));
    vals_write := array_append(vals_write, quote_literal('Ändra integrationer'));
  end if;

  if has_description then
    cols := array_append(cols, 'description');
    vals_read := array_append(vals_read, quote_literal('Kan läsa webhookar och integrationsinställningar för bolaget.'));
    vals_write := array_append(vals_write, quote_literal('Kan hantera webhookar och integrationsinställningar för bolaget.'));
  end if;

  if has_area then
    cols := array_append(cols, 'area');
    vals_read := array_append(vals_read, quote_literal('Integrationer'));
    vals_write := array_append(vals_write, quote_literal('Integrationer'));
  elsif has_category then
    cols := array_append(cols, 'category');
    vals_read := array_append(vals_read, quote_literal('Integrationer'));
    vals_write := array_append(vals_write, quote_literal('Integrationer'));
  end if;

  if has_risk then
    cols := array_append(cols, 'risk');
    vals_read := array_append(vals_read, quote_literal('medium'));
    vals_write := array_append(vals_write, quote_literal('high'));
  end if;

  execute format(
    'insert into public.permissions (%s) values (%s) on conflict (key) do nothing',
    array_to_string(cols, ', '),
    array_to_string(vals_read, ', ')
  );

  execute format(
    'insert into public.permissions (%s) values (%s) on conflict (key) do nothing',
    array_to_string(cols, ', '),
    array_to_string(vals_write, ', ')
  );
end $$;


do $$
declare
  v_role record;
  has_roles_key boolean;
  has_permissions_key boolean;
begin
  if to_regclass('public.roles') is null
     or to_regclass('public.permissions') is null
     or to_regclass('public.role_permissions') is null
  then
    raise notice 'Skipped integrations role grants: roles, permissions or role_permissions table missing.';
    return;
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'roles'
      and column_name = 'key'
  ) into has_roles_key;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'permissions'
      and column_name = 'key'
  ) into has_permissions_key;

  if not has_roles_key or not has_permissions_key then
    raise notice 'Skipped integrations role grants: roles.key or permissions.key missing.';
    return;
  end if;

  for v_role in
    select id
    from public.roles
    where key in ('super_admin', 'admin', 'company_admin', 'partner_manager')
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
declare
  has_company_id boolean;
  has_environment boolean;
  has_sender_ediel_id boolean;
  has_interchange_reference boolean;
  has_transaction_reference boolean;
  has_external_reference boolean;
begin
  if to_regclass('public.inbound_email_messages') is null then
    raise notice 'Skipped inbound e-mail dedupe indexes: public.inbound_email_messages does not exist.';
    return;
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inbound_email_messages'
      and column_name = 'company_id'
  ) into has_company_id;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inbound_email_messages'
      and column_name = 'environment'
  ) into has_environment;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inbound_email_messages'
      and column_name = 'sender_ediel_id'
  ) into has_sender_ediel_id;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inbound_email_messages'
      and column_name = 'interchange_reference'
  ) into has_interchange_reference;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inbound_email_messages'
      and column_name = 'transaction_reference'
  ) into has_transaction_reference;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inbound_email_messages'
      and column_name = 'external_reference'
  ) into has_external_reference;

  if not (
    has_company_id
    and has_environment
    and has_sender_ediel_id
  ) then
    raise notice 'Skipped inbound e-mail dedupe indexes: required columns company_id/environment/sender_ediel_id missing.';
    return;
  end if;

  if has_interchange_reference then
    if not exists (
      select 1
      from public.inbound_email_messages
      where sender_ediel_id is not null
        and interchange_reference is not null
        and company_id is not null
      group by company_id, environment, sender_ediel_id, interchange_reference
      having count(*) > 1
    ) then
      create unique index if not exists ux_inbound_email_messages_company_sender_interchange
        on public.inbound_email_messages(
          company_id,
          environment,
          sender_ediel_id,
          interchange_reference
        )
        where sender_ediel_id is not null
          and interchange_reference is not null
          and company_id is not null;

      drop index if exists public.ux_inbound_email_messages_sender_interchange;
    else
      raise notice 'Skipped ux_inbound_email_messages_company_sender_interchange: duplicate company/environment/sender/interchange rows exist. Clean up duplicates and create the index manually.';
    end if;
  else
    raise notice 'Skipped interchange dedupe index: inbound_email_messages.interchange_reference missing.';
  end if;

  if has_transaction_reference and has_external_reference then
    if not exists (
      select 1
      from public.inbound_email_messages
      where sender_ediel_id is not null
        and transaction_reference is not null
        and external_reference is not null
        and company_id is not null
      group by company_id, environment, sender_ediel_id, transaction_reference, external_reference
      having count(*) > 1
    ) then
      create unique index if not exists ux_inbound_email_messages_company_sender_tx_external
        on public.inbound_email_messages(
          company_id,
          environment,
          sender_ediel_id,
          transaction_reference,
          external_reference
        )
        where sender_ediel_id is not null
          and transaction_reference is not null
          and external_reference is not null
          and company_id is not null;

      drop index if exists public.ux_inbound_email_messages_sender_tx_external;
    else
      raise notice 'Skipped ux_inbound_email_messages_company_sender_tx_external: duplicate company/environment/sender/transaction/external rows exist. Clean up duplicates and create the index manually.';
    end if;
  else
    raise notice 'Skipped transaction/external dedupe index: transaction_reference or external_reference missing.';
  end if;
end $$;