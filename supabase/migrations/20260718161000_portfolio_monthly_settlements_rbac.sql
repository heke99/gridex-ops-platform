-- Canonical monthly portfolio settlement ledger and default-deny delegated RBAC.

begin;

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.portfolios (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  code text not null,
  name text not null,
  description text null,
  status text not null default 'active' check(status in('active','paused','archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_by uuid null,
  updated_at timestamptz not null default now(),
  unique(company_id,code),
  unique(company_id,id)
);

create table if not exists public.portfolio_monthly_settlements (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  portfolio_id uuid not null,
  price_area_code text not null check(price_area_code in('SE1','SE2','SE3','SE4')),
  delivery_month date not null check(delivery_month=date_trunc('month',delivery_month)::date),
  price_plan_version_id uuid not null references public.price_plan_versions(id) on delete restrict,
  revision_no integer not null check(revision_no>0),
  is_current boolean not null default true,
  status text not null default 'draft'
    check(status in('draft','calculated','reviewed','final','locked')),
  source text not null default 'manual'
    check(source in('manual','import','calculation','correction')),
  gross_energy_cost_sek numeric null,
  hedging_result_sek numeric not null default 0,
  balancing_cost_sek numeric not null default 0,
  other_allowed_cost_sek numeric not null default 0,
  energy_volume_kwh numeric null check(energy_volume_kwh is null or energy_volume_kwh>0),
  portfolio_price_ore_per_kwh numeric null,
  vat_included boolean not null default false check(not vat_included),
  management_fee_ore_per_kwh numeric not null default 0,
  calculation_base text not null default 'portfolio_cost'
    check(calculation_base in('portfolio_cost','energy_cost_ex_vat')),
  vat_rate numeric not null default 0.25 check(vat_rate>=0 and vat_rate<=1),
  currency text not null default 'SEK' check(currency='SEK'),
  settlement_timing text not null default 'after_month_close'
    check(settlement_timing in('after_month_close','preliminary_then_final')),
  calculation_snapshot jsonb not null default '{}'::jsonb,
  calculation_snapshot_sha256 text null,
  correction_reason text null,
  supersedes_settlement_id uuid null references public.portfolio_monthly_settlements(id) on delete restrict,
  superseded_by_settlement_id uuid null references public.portfolio_monthly_settlements(id) on delete restrict,
  idempotency_key text null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  calculated_by uuid null,
  calculated_at timestamptz null,
  reviewed_by uuid null,
  reviewed_at timestamptz null,
  approved_by uuid null,
  approved_at timestamptz null,
  locked_by uuid null,
  locked_at timestamptz null,
  constraint portfolio_monthly_settlements_portfolio_fk
    foreign key(company_id,portfolio_id) references public.portfolios(company_id,id) on delete restrict,
  unique(company_id,portfolio_id,price_area_code,delivery_month,price_plan_version_id,revision_no),
  unique(company_id,idempotency_key)
);

create unique index if not exists portfolio_monthly_settlements_current_uidx
  on public.portfolio_monthly_settlements(
    company_id,portfolio_id,price_area_code,delivery_month,price_plan_version_id
  ) where is_current;
create index if not exists portfolio_monthly_settlements_final_lookup_idx
  on public.portfolio_monthly_settlements(
    company_id,portfolio_id,price_plan_version_id,price_area_code,delivery_month,status
  ) where is_current;

create table if not exists public.portfolio_price_estimates (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  portfolio_id uuid not null,
  price_plan_version_id uuid not null references public.price_plan_versions(id) on delete restrict,
  price_area_code text not null check(price_area_code in('SE1','SE2','SE3','SE4')),
  estimate_month date not null check(estimate_month=date_trunc('month',estimate_month)::date),
  estimate_source text not null check(estimate_source in('latest_final','rolling_3','forecast','manual')),
  estimate_price_ore_per_kwh numeric not null,
  based_on_settlement_ids uuid[] not null default '{}',
  confidence text null check(confidence is null or confidence in('low','medium','high')),
  non_binding boolean not null default true check(non_binding),
  reason text not null,
  expires_at timestamptz null,
  is_current boolean not null default true,
  created_by uuid not null,
  estimate_generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint portfolio_price_estimates_portfolio_fk
    foreign key(company_id,portfolio_id) references public.portfolios(company_id,id) on delete restrict
);
create unique index if not exists portfolio_price_estimates_current_uidx
  on public.portfolio_price_estimates(
    company_id,portfolio_id,price_plan_version_id,price_area_code,estimate_month
  ) where is_current;

create table if not exists public.portfolio_settlement_permission_grants (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  permission text not null check(permission in(
    'portfolio_settlement.read','portfolio_settlement.create',
    'portfolio_settlement.import','portfolio_settlement.calculate',
    'portfolio_settlement.review','portfolio_settlement.approve',
    'portfolio_settlement.lock','portfolio_settlement.correct'
  )),
  company_id uuid not null references public.companies(id) on delete restrict,
  portfolio_id uuid null references public.portfolios(id) on delete restrict,
  granted_by uuid not null references auth.users(id) on delete restrict,
  granted_at timestamptz not null default now(),
  valid_from timestamptz not null default now(),
  expires_at timestamptz null,
  revoked_at timestamptz null,
  revoked_by uuid null references auth.users(id) on delete restrict,
  reason text not null,
  created_at timestamptz not null default now(),
  constraint portfolio_settlement_permission_scope_check check(
    expires_at is null or expires_at>valid_from
  )
);
create unique index if not exists portfolio_settlement_permission_grants_active_uidx
  on public.portfolio_settlement_permission_grants(user_id,permission,company_id,coalesce(portfolio_id,'00000000-0000-0000-0000-000000000000'::uuid))
  where revoked_at is null;

create table if not exists public.portfolio_settlement_role_templates (
  role_key text primary key check(role_key in(
    'portfolio_settlement_viewer','portfolio_settlement_operator',
    'portfolio_settlement_reviewer','portfolio_settlement_approver',
    'portfolio_settlement_locker','portfolio_settlement_corrector'
  )),
  permissions text[] not null check(cardinality(permissions)>0),
  description text not null,
  created_at timestamptz not null default now()
);
insert into public.portfolio_settlement_role_templates(role_key,permissions,description)
values
  ('portfolio_settlement_viewer',array['portfolio_settlement.read'],'Läsbehörighet.'),
  ('portfolio_settlement_operator',array['portfolio_settlement.read','portfolio_settlement.create','portfolio_settlement.import','portfolio_settlement.calculate'],'Skapa, importera och beräkna.'),
  ('portfolio_settlement_reviewer',array['portfolio_settlement.read','portfolio_settlement.review'],'Läs och granska.'),
  ('portfolio_settlement_approver',array['portfolio_settlement.read','portfolio_settlement.approve'],'Läs och godkänn final.'),
  ('portfolio_settlement_locker',array['portfolio_settlement.read','portfolio_settlement.lock'],'Läs och lås för fakturering.'),
  ('portfolio_settlement_corrector',array['portfolio_settlement.read','portfolio_settlement.correct'],'Läs och skapa rättelserevision.')
on conflict(role_key) do update set
  permissions=excluded.permissions,description=excluded.description;

create table if not exists public.portfolio_settlement_audit_log (
  id bigint generated always as identity primary key,
  company_id uuid not null,
  portfolio_id uuid null,
  settlement_id uuid null,
  actor_user_id uuid not null,
  permission text not null,
  action text not null,
  old_values jsonb null,
  new_values jsonb null,
  reason text null,
  request_id text not null default extensions.gen_random_uuid()::text,
  trace_id text not null default extensions.gen_random_uuid()::text,
  calculation_snapshot_sha256 text null,
  approval jsonb null,
  occurred_at timestamptz not null default clock_timestamp()
);
create index if not exists portfolio_settlement_audit_log_scope_idx
  on public.portfolio_settlement_audit_log(company_id,portfolio_id,occurred_at desc);

-- Historical Gridex databases use either name/category or label/area/risk on
-- public.permissions. Seed against the columns that actually exist so this
-- migration remains additive and does not create a second RBAC model.
do $$
declare
  v_permission record;
  v_columns text[];
  v_values text[];
  v_updates text[];
  v_has_name boolean;
  v_has_label boolean;
  v_has_description boolean;
  v_has_category boolean;
  v_has_area boolean;
  v_has_risk boolean;
  v_has_is_active boolean;
begin
  if to_regclass('public.permissions') is null then
    raise exception using
      errcode='42P01',message='permissions_table_missing';
  end if;

  if not exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='permissions' and column_name='key'
  ) then
    raise exception using
      errcode='42703',message='permissions_key_column_missing';
  end if;

  select exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='permissions' and column_name='name'
  ) into v_has_name;
  select exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='permissions' and column_name='label'
  ) into v_has_label;
  select exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='permissions' and column_name='description'
  ) into v_has_description;
  select exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='permissions' and column_name='category'
  ) into v_has_category;
  select exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='permissions' and column_name='area'
  ) into v_has_area;
  select exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='permissions' and column_name='risk'
  ) into v_has_risk;
  select exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='permissions' and column_name='is_active'
  ) into v_has_is_active;

  for v_permission in
    select * from (values
      ('portfolio_settlement.read','Läs portföljavräkning','Läs avräkningar inom uttryckligen delegerat scope.','medium'),
      ('portfolio_settlement.create','Skapa portföljavräkning','Skapa manuellt utkast.','high'),
      ('portfolio_settlement.import','Importera portföljavräkning','Importera ett utkast.','high'),
      ('portfolio_settlement.calculate','Beräkna portföljavräkning','Beräkna pris från kostnad och volym.','high'),
      ('portfolio_settlement.review','Granska portföljavräkning','Markera beräkning som granskad.','high'),
      ('portfolio_settlement.approve','Godkänn portföljavräkning','Gör avräkningen final.','high'),
      ('portfolio_settlement.lock','Lås portföljavräkning','Lås final avräkning för fakturering.','high'),
      ('portfolio_settlement.correct','Korrigera portföljavräkning','Skapa ny revision med orsak.','high'),
      ('portfolio_settlement.manage_access','Hantera portföljbehörighet','Endast plattformens superadmin.','high')
    ) as permission_seed(key,display_name,description,risk)
  loop
    v_columns := array['key'];
    v_values := array[quote_literal(v_permission.key)];
    v_updates := array[]::text[];

    if v_has_name then
      v_columns := array_append(v_columns,'name');
      v_values := array_append(v_values,quote_literal(v_permission.display_name));
      v_updates := array_append(v_updates,'name=excluded.name');
    end if;
    if v_has_label then
      v_columns := array_append(v_columns,'label');
      v_values := array_append(v_values,quote_literal(v_permission.display_name));
      v_updates := array_append(v_updates,'label=excluded.label');
    end if;
    if v_has_description then
      v_columns := array_append(v_columns,'description');
      v_values := array_append(v_values,quote_literal(v_permission.description));
      v_updates := array_append(v_updates,'description=excluded.description');
    end if;
    if v_has_category then
      v_columns := array_append(v_columns,'category');
      v_values := array_append(v_values,quote_literal('portfolio_settlements'));
      v_updates := array_append(v_updates,'category=excluded.category');
    end if;
    if v_has_area then
      v_columns := array_append(v_columns,'area');
      v_values := array_append(v_values,quote_literal('Portföljavräkning'));
      v_updates := array_append(v_updates,'area=excluded.area');
    end if;
    if v_has_risk then
      v_columns := array_append(v_columns,'risk');
      v_values := array_append(v_values,quote_literal(v_permission.risk));
      v_updates := array_append(v_updates,'risk=excluded.risk');
    end if;
    if v_has_is_active then
      v_columns := array_append(v_columns,'is_active');
      v_values := array_append(v_values,'true');
      v_updates := array_append(v_updates,'is_active=true');
    end if;

    if cardinality(v_updates)>0 then
      execute format(
        'insert into public.permissions(%s) values(%s) on conflict(key) do update set %s',
        array_to_string(v_columns,','),
        array_to_string(v_values,','),
        array_to_string(v_updates,',')
      );
    else
      execute format(
        'insert into public.permissions(%s) values(%s) on conflict(key) do nothing',
        array_to_string(v_columns,','),
        array_to_string(v_values,',')
      );
    end if;
  end loop;
end $$;

create or replace function public.gridex_portfolio_actor_is_superadmin(p_actor_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public,auth,pg_temp
as $$
  select p_actor_user_id is not null
  and (coalesce(auth.role(),'')='service_role' or p_actor_user_id=auth.uid())
  and (
    exists(
      select 1 from public.admin_users au
      where au.user_id=p_actor_user_id and coalesce(au.is_active,true)
        and lower(coalesce(au.role,''))='platform_superadmin'
    ) or exists(
      select 1 from public.user_roles ur
      left join public.roles r on r.id=ur.role_id
      where ur.user_id=p_actor_user_id
        and coalesce(ur.status,'active')='active' and coalesce(ur.is_active,true)
        and lower(coalesce(ur.role,r.key,r.name,''))='platform_superadmin'
    )
  )
$$;

create or replace function public.gridex_portfolio_actor_has_permission(
  p_actor_user_id uuid,
  p_permission text,
  p_company_id uuid,
  p_portfolio_id uuid default null
) returns boolean
language sql
stable
security definer
set search_path=public,auth,pg_temp
as $$
  select (coalesce(auth.role(),'')='service_role' or p_actor_user_id=auth.uid())
  and (public.gridex_portfolio_actor_is_superadmin(p_actor_user_id)
  or (
    p_permission<>'portfolio_settlement.manage_access'
    and exists(
      select 1 from public.portfolio_settlement_permission_grants g
      where g.user_id=p_actor_user_id
        and g.permission=p_permission
        and g.company_id=p_company_id
        and (g.portfolio_id is null or g.portfolio_id=p_portfolio_id)
        and g.revoked_at is null
        and g.valid_from<=now()
        and (g.expires_at is null or g.expires_at>now())
    )
  ))
$$;

create or replace function public.gridex_assert_portfolio_permission(
  p_actor_user_id uuid,p_permission text,p_company_id uuid,p_portfolio_id uuid default null
) returns void
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
begin
  if not public.gridex_portfolio_actor_has_permission(
    p_actor_user_id,p_permission,p_company_id,p_portfolio_id
  ) then
    raise exception using errcode='42501',message='portfolio_settlement_permission_denied',
      detail=p_permission;
  end if;
end $$;

create or replace function public.gridex_grant_portfolio_settlement_permission(
  p_actor_user_id uuid,p_user_id uuid,p_permission text,p_company_id uuid,
  p_portfolio_id uuid default null,p_expires_at timestamptz default null,
  p_reason text default null
) returns uuid
language plpgsql
security definer
set search_path=public,auth,pg_temp
as $$
declare v_id uuid;
begin
  if not public.gridex_portfolio_actor_is_superadmin(p_actor_user_id) then
    raise exception using errcode='42501',message='portfolio_manage_access_superadmin_only';
  end if;
  if p_permission='portfolio_settlement.manage_access'
     or p_permission not like 'portfolio_settlement.%' then
    raise exception using errcode='22023',message='portfolio_permission_not_delegable';
  end if;
  if nullif(btrim(p_reason),'') is null then
    raise exception using errcode='22023',message='portfolio_permission_reason_required';
  end if;
  if p_portfolio_id is not null and not exists(
    select 1 from public.portfolios p where p.id=p_portfolio_id and p.company_id=p_company_id
  ) then
    raise exception using errcode='23514',message='portfolio_permission_scope_mismatch';
  end if;
  insert into public.portfolio_settlement_permission_grants(
    user_id,permission,company_id,portfolio_id,granted_by,expires_at,reason
  ) values(
    p_user_id,p_permission,p_company_id,p_portfolio_id,p_actor_user_id,p_expires_at,btrim(p_reason)
  ) returning id into v_id;
  insert into public.portfolio_settlement_audit_log(
    company_id,portfolio_id,actor_user_id,permission,action,new_values,reason
  ) values(
    p_company_id,p_portfolio_id,p_actor_user_id,'portfolio_settlement.manage_access','access.granted',
    jsonb_build_object('grant_id',v_id,'user_id',p_user_id,'permission',p_permission,'expires_at',p_expires_at),
    btrim(p_reason)
  );
  return v_id;
end $$;

create or replace function public.gridex_revoke_portfolio_settlement_permission(
  p_actor_user_id uuid,p_grant_id uuid,p_reason text
) returns void
language plpgsql
security definer
set search_path=public,auth,pg_temp
as $$
declare v_grant public.portfolio_settlement_permission_grants%rowtype;
begin
  if not public.gridex_portfolio_actor_is_superadmin(p_actor_user_id) then
    raise exception using errcode='42501',message='portfolio_manage_access_superadmin_only';
  end if;
  if nullif(btrim(p_reason),'') is null then
    raise exception using errcode='22023',message='portfolio_permission_reason_required';
  end if;
  update public.portfolio_settlement_permission_grants
  set revoked_at=now(),revoked_by=p_actor_user_id,reason=reason||E'\nRevoked: '||btrim(p_reason)
  where id=p_grant_id and revoked_at is null returning * into v_grant;
  if not found then raise exception using errcode='P0002',message='active_portfolio_grant_not_found'; end if;
  insert into public.portfolio_settlement_audit_log(
    company_id,portfolio_id,actor_user_id,permission,action,old_values,reason
  ) values(v_grant.company_id,v_grant.portfolio_id,p_actor_user_id,'portfolio_settlement.manage_access','access.revoked',to_jsonb(v_grant),btrim(p_reason));
end $$;

create or replace function public.gridex_grant_portfolio_settlement_role(
  p_actor_user_id uuid,p_user_id uuid,p_role_key text,p_company_id uuid,
  p_portfolio_id uuid default null,p_expires_at timestamptz default null,
  p_reason text default null
) returns uuid[]
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_permissions text[]; v_permission text; v_ids uuid[]:='{}'; v_id uuid;
begin
  if not public.gridex_portfolio_actor_is_superadmin(p_actor_user_id) then
    raise exception using errcode='42501',message='portfolio_manage_access_superadmin_only';
  end if;
  if nullif(btrim(p_reason),'') is null then
    raise exception using errcode='22023',message='portfolio_permission_reason_required';
  end if;
  select t.permissions into v_permissions
  from public.portfolio_settlement_role_templates t where t.role_key=p_role_key;
  if v_permissions is null then
    raise exception using errcode='22023',message='portfolio_settlement_role_unknown';
  end if;
  foreach v_permission in array v_permissions loop
    v_id:=public.gridex_grant_portfolio_settlement_permission(
      p_actor_user_id,p_user_id,v_permission,p_company_id,p_portfolio_id,
      p_expires_at,concat('[',p_role_key,'] ',btrim(p_reason))
    );
    v_ids:=array_append(v_ids,v_id);
  end loop;
  return v_ids;
end $$;

create or replace function public.gridex_create_portfolio(
  p_actor_user_id uuid,p_company_id uuid,p_code text,p_name text,p_description text default null
) returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_id uuid;
begin
  perform public.gridex_assert_portfolio_permission(
    p_actor_user_id,'portfolio_settlement.create',p_company_id,null
  );
  if nullif(btrim(p_code),'') is null or nullif(btrim(p_name),'') is null then
    raise exception using errcode='22023',message='portfolio_code_and_name_required';
  end if;
  insert into public.portfolios(company_id,code,name,description,created_by,updated_by)
  values(p_company_id,lower(btrim(p_code)),btrim(p_name),nullif(btrim(p_description),''),p_actor_user_id,p_actor_user_id)
  returning id into v_id;
  insert into public.portfolio_settlement_audit_log(
    company_id,portfolio_id,actor_user_id,permission,action,new_values
  ) values(p_company_id,v_id,p_actor_user_id,'portfolio_settlement.create','portfolio.created',jsonb_build_object('code',lower(btrim(p_code)),'name',btrim(p_name)));
  return v_id;
end $$;

create or replace function public.gridex_save_portfolio_settlement_draft(
  p_actor_user_id uuid,p_company_id uuid,p_portfolio_id uuid,
  p_price_area_code text,p_delivery_month date,p_price_plan_version_id uuid,
  p_gross_energy_cost_sek numeric default null,
  p_hedging_result_sek numeric default 0,
  p_balancing_cost_sek numeric default 0,
  p_other_allowed_cost_sek numeric default 0,
  p_energy_volume_kwh numeric default null,
  p_portfolio_price_ore_per_kwh numeric default null,
  p_management_fee_ore_per_kwh numeric default 0,
  p_source text default 'manual',p_idempotency_key text default null
) returns uuid
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare v_id uuid; v_revision integer; v_permission text;
begin
  v_permission:=case when p_source='import' then 'portfolio_settlement.import' else 'portfolio_settlement.create' end;
  perform public.gridex_assert_portfolio_permission(p_actor_user_id,v_permission,p_company_id,p_portfolio_id);
  if upper(p_price_area_code) not in('SE1','SE2','SE3','SE4')
     or p_delivery_month<>date_trunc('month',p_delivery_month)::date then
    raise exception using errcode='22023',message='invalid_portfolio_settlement_scope';
  end if;
  if not exists(
    select 1 from public.portfolios p where p.id=p_portfolio_id and p.company_id=p_company_id and p.status='active'
  ) or not exists(
    select 1 from public.price_plan_versions v
    join public.price_plans p on p.id=v.price_plan_id and p.company_id=v.company_id
    where v.id=p_price_plan_version_id and v.company_id=p_company_id
      and p.pricing_model in('portfolio','mixed')
  ) then
    raise exception using errcode='23514',message='portfolio_or_price_plan_version_scope_mismatch';
  end if;
  if p_idempotency_key is not null then
    select id into v_id from public.portfolio_monthly_settlements
    where company_id=p_company_id and idempotency_key=p_idempotency_key;
    if v_id is not null then return v_id; end if;
  end if;
  if exists(
    select 1 from public.portfolio_monthly_settlements
    where company_id=p_company_id and portfolio_id=p_portfolio_id
      and price_area_code=upper(p_price_area_code) and delivery_month=p_delivery_month
      and price_plan_version_id=p_price_plan_version_id and is_current
  ) then
    raise exception using errcode='23505',message='portfolio_settlement_current_revision_exists';
  end if;
  select coalesce(max(revision_no),0)+1 into v_revision
  from public.portfolio_monthly_settlements
  where company_id=p_company_id and portfolio_id=p_portfolio_id
    and price_area_code=upper(p_price_area_code) and delivery_month=p_delivery_month
    and price_plan_version_id=p_price_plan_version_id;
  insert into public.portfolio_monthly_settlements(
    company_id,portfolio_id,price_area_code,delivery_month,price_plan_version_id,
    revision_no,status,source,gross_energy_cost_sek,hedging_result_sek,
    balancing_cost_sek,other_allowed_cost_sek,energy_volume_kwh,
    portfolio_price_ore_per_kwh,management_fee_ore_per_kwh,idempotency_key,created_by
  ) values(
    p_company_id,p_portfolio_id,upper(p_price_area_code),p_delivery_month,p_price_plan_version_id,
    v_revision,'draft',p_source,p_gross_energy_cost_sek,p_hedging_result_sek,
    p_balancing_cost_sek,p_other_allowed_cost_sek,p_energy_volume_kwh,
    p_portfolio_price_ore_per_kwh,p_management_fee_ore_per_kwh,p_idempotency_key,p_actor_user_id
  ) returning id into v_id;
  return v_id;
end $$;

create or replace function public.gridex_transition_portfolio_settlement(
  p_actor_user_id uuid,p_settlement_id uuid,p_action text,p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare v_row public.portfolio_monthly_settlements%rowtype; v_price numeric; v_hash text; v_now timestamptz:=now();
begin
  select * into v_row from public.portfolio_monthly_settlements where id=p_settlement_id for update;
  if not found then raise exception using errcode='P0002',message='portfolio_settlement_not_found'; end if;
  perform set_config('gridex.portfolio_actor_user_id',p_actor_user_id::text,true);
  perform set_config('gridex.portfolio_audit_reason',coalesce(p_reason,''),true);
  if p_action='calculate' then
    perform public.gridex_assert_portfolio_permission(p_actor_user_id,'portfolio_settlement.calculate',v_row.company_id,v_row.portfolio_id);
    if v_row.status not in('draft','calculated') or v_row.gross_energy_cost_sek is null
       or coalesce(v_row.energy_volume_kwh,0)<=0 then
      raise exception using errcode='23514',message='portfolio_settlement_calculation_inputs_missing';
    end if;
    v_price:=((v_row.gross_energy_cost_sek+v_row.hedging_result_sek+
      v_row.balancing_cost_sek+v_row.other_allowed_cost_sek)/v_row.energy_volume_kwh)*100;
    v_hash:=encode(extensions.digest(convert_to(jsonb_build_object(
      'company_id',v_row.company_id,'portfolio_id',v_row.portfolio_id,'price_area_code',v_row.price_area_code,
      'delivery_month',v_row.delivery_month,'price_plan_version_id',v_row.price_plan_version_id,
      'revision_no',v_row.revision_no,'gross_energy_cost_sek',v_row.gross_energy_cost_sek,
      'hedging_result_sek',v_row.hedging_result_sek,
      'balancing_cost_sek',v_row.balancing_cost_sek,
      'other_allowed_cost_sek',v_row.other_allowed_cost_sek,
      'energy_volume_kwh',v_row.energy_volume_kwh,'management_fee_ore_per_kwh',v_row.management_fee_ore_per_kwh,
      'portfolio_price_ore_per_kwh',v_price,'vat_rate',v_row.vat_rate
    )::text,'UTF8'),'sha256'),'hex');
    update public.portfolio_monthly_settlements set
      status='calculated',portfolio_price_ore_per_kwh=v_price,
      calculation_snapshot=jsonb_build_object(
        'formula','((gross_energy_cost_sek + hedging_result_sek + balancing_cost_sek + other_allowed_cost_sek) / energy_volume_kwh) * 100',
        'gross_energy_cost_sek',v_row.gross_energy_cost_sek,
        'hedging_result_sek',v_row.hedging_result_sek,
        'balancing_cost_sek',v_row.balancing_cost_sek,
        'other_allowed_cost_sek',v_row.other_allowed_cost_sek,
        'energy_volume_kwh',v_row.energy_volume_kwh,
        'management_fee_ore_per_kwh',v_row.management_fee_ore_per_kwh,
        'portfolio_price_ore_per_kwh',v_price
      ),calculation_snapshot_sha256=v_hash,calculated_by=p_actor_user_id,
      calculated_at=v_now,updated_at=v_now
    where id=v_row.id;
  elsif p_action='review' then
    perform public.gridex_assert_portfolio_permission(p_actor_user_id,'portfolio_settlement.review',v_row.company_id,v_row.portfolio_id);
    if v_row.status<>'calculated' then raise exception using errcode='23514',message='portfolio_settlement_must_be_calculated'; end if;
    update public.portfolio_monthly_settlements set status='reviewed',reviewed_by=p_actor_user_id,reviewed_at=v_now,updated_at=v_now where id=v_row.id;
  elsif p_action='approve' then
    perform public.gridex_assert_portfolio_permission(p_actor_user_id,'portfolio_settlement.approve',v_row.company_id,v_row.portfolio_id);
    if v_row.status<>'reviewed' or v_row.calculation_snapshot_sha256 is null or v_row.portfolio_price_ore_per_kwh is null then
      raise exception using errcode='23514',message='portfolio_settlement_must_be_reviewed_and_calculated';
    end if;
    update public.portfolio_monthly_settlements set status='final',approved_by=p_actor_user_id,approved_at=v_now,updated_at=v_now where id=v_row.id;
  elsif p_action='lock' then
    perform public.gridex_assert_portfolio_permission(p_actor_user_id,'portfolio_settlement.lock',v_row.company_id,v_row.portfolio_id);
    if v_row.status<>'final' then raise exception using errcode='23514',message='portfolio_settlement_must_be_final'; end if;
    update public.portfolio_monthly_settlements set status='locked',locked_by=p_actor_user_id,locked_at=v_now where id=v_row.id;
  else
    raise exception using errcode='22023',message='unknown_portfolio_settlement_action';
  end if;
  return (select to_jsonb(s) from public.portfolio_monthly_settlements s where s.id=v_row.id);
end $$;

create or replace function public.gridex_create_portfolio_settlement_correction(
  p_actor_user_id uuid,p_settlement_id uuid,p_reason text,p_idempotency_key text default null
) returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_old public.portfolio_monthly_settlements%rowtype; v_new_id uuid; v_revision integer;
begin
  select * into v_old from public.portfolio_monthly_settlements where id=p_settlement_id for update;
  if not found then raise exception using errcode='P0002',message='portfolio_settlement_not_found'; end if;
  perform public.gridex_assert_portfolio_permission(p_actor_user_id,'portfolio_settlement.correct',v_old.company_id,v_old.portfolio_id);
  if v_old.status not in('final','locked') or not v_old.is_current then
    raise exception using errcode='23514',message='only_current_final_settlement_can_be_corrected';
  end if;
  if nullif(btrim(p_reason),'') is null then raise exception using errcode='22023',message='portfolio_correction_reason_required'; end if;
  if p_idempotency_key is not null then
    select id into v_new_id from public.portfolio_monthly_settlements
    where company_id=v_old.company_id and idempotency_key=p_idempotency_key;
    if v_new_id is not null then return v_new_id; end if;
  end if;
  select coalesce(max(revision_no),0)+1 into v_revision
  from public.portfolio_monthly_settlements
  where company_id=v_old.company_id and portfolio_id=v_old.portfolio_id
    and price_area_code=v_old.price_area_code and delivery_month=v_old.delivery_month
    and price_plan_version_id=v_old.price_plan_version_id;
  v_new_id:=extensions.gen_random_uuid();
  perform set_config('gridex.portfolio_actor_user_id',p_actor_user_id::text,true);
  perform set_config('gridex.portfolio_audit_reason',btrim(p_reason),true);
  perform set_config('gridex.portfolio_correction_write','on',true);
  update public.portfolio_monthly_settlements
  set is_current=false,superseded_by_settlement_id=v_new_id
  where id=v_old.id;
  insert into public.portfolio_monthly_settlements(
    id,company_id,portfolio_id,price_area_code,delivery_month,price_plan_version_id,revision_no,is_current,status,source,
    gross_energy_cost_sek,hedging_result_sek,balancing_cost_sek,
    other_allowed_cost_sek,energy_volume_kwh,portfolio_price_ore_per_kwh,
    management_fee_ore_per_kwh,calculation_base,vat_rate,currency,settlement_timing,
    correction_reason,supersedes_settlement_id,idempotency_key,created_by
  ) values(
    v_new_id,v_old.company_id,v_old.portfolio_id,v_old.price_area_code,v_old.delivery_month,v_old.price_plan_version_id,v_revision,true,'draft','correction',
    v_old.gross_energy_cost_sek,v_old.hedging_result_sek,v_old.balancing_cost_sek,
    v_old.other_allowed_cost_sek,v_old.energy_volume_kwh,v_old.portfolio_price_ore_per_kwh,
    v_old.management_fee_ore_per_kwh,v_old.calculation_base,v_old.vat_rate,v_old.currency,v_old.settlement_timing,
    btrim(p_reason),v_old.id,p_idempotency_key,p_actor_user_id
  );
  return v_new_id;
end $$;

create or replace function public.gridex_guard_portfolio_settlement_immutability()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if tg_op='DELETE' then raise exception using errcode='55000',message='portfolio_settlement_append_only'; end if;
  if old.status<>new.status and not (
    (old.status='draft' and new.status='calculated')
    or (old.status='calculated' and new.status='reviewed')
    or (old.status='reviewed' and new.status='final')
    or (old.status='final' and new.status='locked')
  ) then
    raise exception using errcode='23514',message='invalid_portfolio_settlement_transition';
  end if;
  if new.status in('final','locked') and (
    new.portfolio_price_ore_per_kwh is null
    or new.calculation_snapshot_sha256 is null
    or new.calculated_at is null or new.reviewed_at is null or new.approved_at is null
  ) then
    raise exception using errcode='23514',message='portfolio_settlement_final_evidence_incomplete';
  end if;
  if old.status='locked' and not (
    coalesce(current_setting('gridex.portfolio_correction_write',true),'')='on'
    and new.is_current=false and new.superseded_by_settlement_id is not null
    and (to_jsonb(new)-'is_current'-'superseded_by_settlement_id')=(to_jsonb(old)-'is_current'-'superseded_by_settlement_id')
  ) then
    raise exception using errcode='55000',message='locked_portfolio_settlement_immutable';
  end if;
  if old.status='final' and not (
    (
      new.status='locked'
      and (to_jsonb(new)-'status'-'locked_by'-'locked_at')
        =(to_jsonb(old)-'status'-'locked_by'-'locked_at')
    ) or (
      coalesce(current_setting('gridex.portfolio_correction_write',true),'')='on'
      and new.status='final' and new.is_current=false
      and new.superseded_by_settlement_id is not null
      and (to_jsonb(new)-'is_current'-'superseded_by_settlement_id')
        =(to_jsonb(old)-'is_current'-'superseded_by_settlement_id')
    )
  ) then
    raise exception using errcode='55000',message='final_portfolio_settlement_immutable_create_correction_revision';
  end if;
  return new;
end $$;
drop trigger if exists portfolio_monthly_settlements_immutable on public.portfolio_monthly_settlements;
create trigger portfolio_monthly_settlements_immutable
before update or delete on public.portfolio_monthly_settlements
for each row execute function public.gridex_guard_portfolio_settlement_immutability();

create or replace function public.gridex_audit_portfolio_settlement_write()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  insert into public.portfolio_settlement_audit_log(
    company_id,portfolio_id,settlement_id,actor_user_id,permission,action,
    old_values,new_values,reason,calculation_snapshot_sha256,approval
  ) values(
    case when tg_op='INSERT' then new.company_id else old.company_id end,
    case when tg_op='INSERT' then new.portfolio_id else old.portfolio_id end,
    case when tg_op='INSERT' then new.id else old.id end,
    case
      when tg_op='INSERT' then new.created_by
      when new.locked_by is distinct from old.locked_by then new.locked_by
      when new.approved_by is distinct from old.approved_by then new.approved_by
      when new.reviewed_by is distinct from old.reviewed_by then new.reviewed_by
      when new.calculated_by is distinct from old.calculated_by then new.calculated_by
      else coalesce(
        nullif(current_setting('gridex.portfolio_actor_user_id',true), '')::uuid,
        new.created_by
      )
    end,
    case
      when tg_op='INSERT' then case when new.source='import' then 'portfolio_settlement.import' else 'portfolio_settlement.create' end
      when new.is_current=false and old.is_current then 'portfolio_settlement.correct'
      when new.status='calculated' and old.status is distinct from new.status then 'portfolio_settlement.calculate'
      when new.status='reviewed' and old.status is distinct from new.status then 'portfolio_settlement.review'
      when new.status='final' and old.status is distinct from new.status then 'portfolio_settlement.approve'
      when new.status='locked' and old.status is distinct from new.status then 'portfolio_settlement.lock'
      else 'portfolio_settlement.correct'
    end,
    case
      when tg_op='INSERT' then 'settlement.created'
      when new.is_current=false and old.is_current then 'settlement.superseded'
      when new.status is distinct from old.status then 'settlement.'||new.status
      else 'settlement.updated'
    end,
    case when tg_op='INSERT' then null else to_jsonb(old) end,
    case when tg_op='DELETE' then null else to_jsonb(new) end,
    coalesce(
      nullif(current_setting('gridex.portfolio_audit_reason',true),''),
      case when tg_op='INSERT' then new.correction_reason else coalesce(new.correction_reason,old.correction_reason) end
    ),
    new.calculation_snapshot_sha256,
    case
      when new.approved_by is not null then jsonb_build_object('approved_by',new.approved_by,'approved_at',new.approved_at)
      else null
    end
  );
  return new;
end $$;
drop trigger if exists portfolio_monthly_settlements_audit on public.portfolio_monthly_settlements;
create trigger portfolio_monthly_settlements_audit
after insert or update on public.portfolio_monthly_settlements
for each row execute function public.gridex_audit_portfolio_settlement_write();

create or replace function public.gridex_portfolio_audit_immutable()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin raise exception using errcode='55000',message='portfolio_settlement_audit_append_only'; end $$;
drop trigger if exists portfolio_settlement_audit_immutable on public.portfolio_settlement_audit_log;
create trigger portfolio_settlement_audit_immutable
before update or delete on public.portfolio_settlement_audit_log
for each row execute function public.gridex_portfolio_audit_immutable();

alter table public.portfolios enable row level security;
alter table public.portfolio_monthly_settlements enable row level security;
alter table public.portfolio_price_estimates enable row level security;
alter table public.portfolio_settlement_permission_grants enable row level security;
alter table public.portfolio_settlement_role_templates enable row level security;
alter table public.portfolio_settlement_audit_log enable row level security;

drop policy if exists portfolios_delegated_read on public.portfolios;
create policy portfolios_delegated_read on public.portfolios for select using(
  public.gridex_portfolio_actor_has_permission(auth.uid(),'portfolio_settlement.read',company_id,id)
);
drop policy if exists portfolio_monthly_settlements_delegated_read on public.portfolio_monthly_settlements;
create policy portfolio_monthly_settlements_delegated_read on public.portfolio_monthly_settlements for select using(
  public.gridex_portfolio_actor_has_permission(auth.uid(),'portfolio_settlement.read',company_id,portfolio_id)
);
drop policy if exists portfolio_price_estimates_delegated_read on public.portfolio_price_estimates;
create policy portfolio_price_estimates_delegated_read on public.portfolio_price_estimates for select using(
  public.gridex_portfolio_actor_has_permission(auth.uid(),'portfolio_settlement.read',company_id,portfolio_id)
);
drop policy if exists portfolio_settlement_grants_superadmin_read on public.portfolio_settlement_permission_grants;
create policy portfolio_settlement_grants_superadmin_read on public.portfolio_settlement_permission_grants for select using(
  public.gridex_portfolio_actor_is_superadmin(auth.uid())
);
drop policy if exists portfolio_settlement_roles_superadmin_read on public.portfolio_settlement_role_templates;
create policy portfolio_settlement_roles_superadmin_read on public.portfolio_settlement_role_templates for select using(
  public.gridex_portfolio_actor_is_superadmin(auth.uid())
);
drop policy if exists portfolio_settlement_audit_delegated_read on public.portfolio_settlement_audit_log;
create policy portfolio_settlement_audit_delegated_read on public.portfolio_settlement_audit_log for select using(
  public.gridex_portfolio_actor_has_permission(auth.uid(),'portfolio_settlement.read',company_id,portfolio_id)
);

revoke all on public.portfolios,public.portfolio_monthly_settlements,public.portfolio_price_estimates,
  public.portfolio_settlement_permission_grants,public.portfolio_settlement_role_templates,
  public.portfolio_settlement_audit_log
  from public,anon,authenticated;
grant select on public.portfolios,public.portfolio_monthly_settlements,public.portfolio_price_estimates,
  public.portfolio_settlement_permission_grants,public.portfolio_settlement_role_templates,
  public.portfolio_settlement_audit_log
  to authenticated;
grant select on public.portfolios,public.portfolio_monthly_settlements,public.portfolio_price_estimates,
  public.portfolio_settlement_permission_grants,public.portfolio_settlement_role_templates,
  public.portfolio_settlement_audit_log
  to service_role;

revoke all on function public.gridex_portfolio_actor_is_superadmin(uuid) from public,anon;
revoke all on function public.gridex_portfolio_actor_has_permission(uuid,text,uuid,uuid) from public,anon;
revoke all on function public.gridex_assert_portfolio_permission(uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.gridex_portfolio_actor_is_superadmin(uuid) to authenticated,service_role;
grant execute on function public.gridex_portfolio_actor_has_permission(uuid,text,uuid,uuid) to authenticated,service_role;
grant execute on function public.gridex_assert_portfolio_permission(uuid,text,uuid,uuid) to service_role;

do $$ declare fn regprocedure; begin
  foreach fn in array array[
    'public.gridex_grant_portfolio_settlement_permission(uuid,uuid,text,uuid,uuid,timestamptz,text)'::regprocedure,
    'public.gridex_revoke_portfolio_settlement_permission(uuid,uuid,text)'::regprocedure,
    'public.gridex_grant_portfolio_settlement_role(uuid,uuid,text,uuid,uuid,timestamptz,text)'::regprocedure,
    'public.gridex_create_portfolio(uuid,uuid,text,text,text)'::regprocedure,
    'public.gridex_save_portfolio_settlement_draft(uuid,uuid,uuid,text,date,uuid,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text)'::regprocedure,
    'public.gridex_transition_portfolio_settlement(uuid,uuid,text,text)'::regprocedure,
    'public.gridex_create_portfolio_settlement_correction(uuid,uuid,text,text)'::regprocedure
  ] loop
    execute format('revoke all on function %s from public,anon,authenticated',fn);
    execute format('grant execute on function %s to service_role',fn);
  end loop;
end $$;

do $$
begin
  if to_regclass('public.portfolio_monthly_settlements') is null
     or to_regclass('public.portfolio_settlement_permission_grants') is null then
    raise exception 'canonical_portfolio_settlement_schema_missing';
  end if;
end $$;

commit;
