-- Customer flow access repair v2.
-- Backward-compatible with older RBAC schemas where permissions/roles used
-- permission_key/role_key instead of key.

-- 1) Normalize RBAC catalog columns expected by the app.
do $$
begin
  if to_regclass('public.permissions') is not null then
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'permissions' and column_name = 'key'
    ) then
      alter table public.permissions add column key text;
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'permissions' and column_name = 'permission_key'
    ) then
      update public.permissions
      set key = permission_key
      where key is null and permission_key is not null;
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'permissions' and column_name = 'code'
    ) then
      update public.permissions
      set key = code
      where key is null and code is not null;
    end if;

    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'permissions' and column_name = 'name'
    ) then
      alter table public.permissions add column name text;
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'permissions' and column_name = 'label'
    ) then
      update public.permissions
      set name = label
      where name is null and label is not null;
    end if;

    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'permissions' and column_name = 'description'
    ) then
      alter table public.permissions add column description text;
    end if;

    create unique index if not exists permissions_key_unique_idx
      on public.permissions (key)
      where key is not null;
  end if;

  if to_regclass('public.roles') is not null then
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'roles' and column_name = 'key'
    ) then
      alter table public.roles add column key text;
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'roles' and column_name = 'role_key'
    ) then
      update public.roles
      set key = role_key
      where key is null and role_key is not null;
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'roles' and column_name = 'code'
    ) then
      update public.roles
      set key = code
      where key is null and code is not null;
    end if;

    create unique index if not exists roles_key_unique_idx
      on public.roles (key)
      where key is not null;
  end if;
end $$;

-- 2) Seed/update customer-flow permissions without assuming old columns.
do $$
declare
  item record;
begin
  if to_regclass('public.permissions') is null then
    return;
  end if;

  for item in
    select * from (values
      ('customers.read', 'Läsa kunder', 'Kan se kundregister och kundkort.'),
      ('customers.write', 'Ändra kunder', 'Kan skapa, importera och ändra kunddata.'),
      ('masterdata.read', 'Läsa masterdata', 'Kan se anläggningar, mätpunkter, nätägare och elområden.'),
      ('masterdata.write', 'Ändra masterdata', 'Kan skapa och ändra anläggningar, mätpunkter och masterdata.'),
      ('contracts.read', 'Läsa avtal', 'Kan se avtal, kampanjer och prisplaner.'),
      ('contracts.write', 'Ändra avtal', 'Kan skapa och ändra avtal, kampanjer och prisplaner.'),
      ('poa.read', 'Läsa fullmakter', 'Kan se fullmakter och behörighetsunderlag.'),
      ('poa.write', 'Ändra fullmakter', 'Kan skapa och ändra fullmakter.'),
      ('cases.read', 'Läsa kundärenden', 'Kan se kundärenden och blockerare.'),
      ('cases.write', 'Ändra kundärenden', 'Kan skapa och ändra kundärenden.'),
      ('switching.read', 'Läsa switchärenden', 'Kan se leverantörsbyten.'),
      ('switching.write', 'Ändra switchärenden', 'Kan skapa och ändra leverantörsbyten.'),
      ('metering.read', 'Läsa mätdata', 'Kan se mätvärden och mätpunktsdata.'),
      ('metering.write', 'Ändra mätdata', 'Kan skapa och ändra mätvärdesflöden.'),
      ('billing_underlay.read', 'Läsa faktureringsunderlag', 'Kan se faktureringsunderlag och exportstatus.'),
      ('reports.read', 'Läsa rapporter', 'Kan se drift- och kvalitetsrapporter.'),
      ('audit.read', 'Läsa revisionslogg', 'Kan se audit och historik.')
    ) as v(permission_key, permission_name, permission_description)
  loop
    update public.permissions
    set name = item.permission_name,
        description = item.permission_description
    where key = item.permission_key;

    if not found then
      insert into public.permissions (key, name, description)
      values (item.permission_key, item.permission_name, item.permission_description);
    end if;
  end loop;
end $$;

-- 3) Backfill role_permissions for customer flow.
do $$
declare
  role_key_value text;
  read_permissions text[] := array[
    'customers.read',
    'contracts.read',
    'masterdata.read',
    'poa.read',
    'cases.read',
    'switching.read',
    'metering.read',
    'billing_underlay.read',
    'reports.read',
    'audit.read'
  ];
  write_permissions text[] := array[
    'customers.write',
    'contracts.write',
    'masterdata.write',
    'poa.write',
    'cases.write',
    'switching.write',
    'metering.write'
  ];
begin
  if to_regclass('public.roles') is null
     or to_regclass('public.permissions') is null
     or to_regclass('public.role_permissions') is null then
    return;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'roles' and column_name = 'id'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'permissions' and column_name = 'id'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'role_permissions' and column_name = 'role_id'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'role_permissions' and column_name = 'permission_id'
  ) then
    return;
  end if;

  foreach role_key_value in array array[
    'super_admin',
    'superadmin',
    'platform_admin',
    'company_admin',
    'admin',
    'operations_manager',
    'customer_service_manager',
    'customer_service_agent',
    'sales_manager',
    'compliance_manager'
  ] loop
    insert into public.role_permissions (role_id, permission_id)
    select r.id, p.id
    from public.roles r
    join public.permissions p on p.key = any(read_permissions)
    where r.key = role_key_value
      and not exists (
        select 1
        from public.role_permissions rp
        where rp.role_id = r.id and rp.permission_id = p.id
      );
  end loop;

  insert into public.role_permissions (role_id, permission_id)
  select r.id, p.id
  from public.roles r
  join public.permissions p on p.key = any(write_permissions)
  where r.key in (
    'super_admin',
    'superadmin',
    'platform_admin',
    'company_admin',
    'admin',
    'operations_manager',
    'customer_service_manager',
    'sales_manager'
  )
  and not exists (
    select 1
    from public.role_permissions rp
    where rp.role_id = r.id and rp.permission_id = p.id
  );
end $$;
