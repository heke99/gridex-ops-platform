-- Debug Step 1+2C: schema/code alignment hardening.
-- Additive and idempotent. No customer data is deleted.

-- Backfill tenant/customer references used by the customer card, portal and Ediel inbound flows.
do $$
begin
  if to_regclass('public.metering_points') is not null and to_regclass('public.customer_sites') is not null then
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='metering_points' and column_name='customer_id') then
      update public.metering_points mp
      set customer_id = cs.customer_id,
          company_id = coalesce(mp.company_id, cs.company_id),
          updated_at = coalesce(mp.updated_at, now())
      from public.customer_sites cs
      where mp.site_id = cs.id
        and (mp.customer_id is null or mp.company_id is null);
    end if;
  end if;

  if to_regclass('public.ediel_inbound_cases') is not null and to_regclass('public.ediel_messages') is not null then
    update public.ediel_inbound_cases c
    set company_id = m.company_id,
        updated_at = coalesce(c.updated_at, now())
    from public.ediel_messages m
    where c.ediel_message_id = m.id
      and c.company_id is null
      and m.company_id is not null;
  end if;

  if to_regclass('public.customer_portal_accounts') is not null and to_regclass('public.customers') is not null then
    update public.customer_portal_accounts a
    set company_id = c.company_id,
        updated_at = coalesce(a.updated_at, now())
    from public.customers c
    where a.customer_id = c.id
      and a.company_id is null
      and c.company_id is not null;
  end if;

  if to_regclass('public.customer_portal_claims') is not null and to_regclass('public.customers') is not null then
    update public.customer_portal_claims cl
    set company_id = c.company_id,
        updated_at = coalesce(cl.updated_at, now())
    from public.customers c
    where cl.customer_id = c.id
      and cl.company_id is null
      and c.company_id is not null;
  end if;

  if to_regclass('public.customer_portal_events') is not null and to_regclass('public.customers') is not null then
    update public.customer_portal_events e
    set company_id = c.company_id
    from public.customers c
    where e.customer_id = c.id
      and e.company_id is null
      and c.company_id is not null;
  end if;
end $$;

-- Critical indexes used by customer card, imports, metering, billing export and Ediel inbound review.
do $$
begin
  if to_regclass('public.customers') is not null then
    execute 'create index if not exists idx_customers_company_status_created on public.customers(company_id, status, created_at desc)';
    execute 'create index if not exists idx_customers_company_normalized_email on public.customers(company_id, normalized_email)';
    execute 'create index if not exists idx_customers_company_normalized_personal on public.customers(company_id, normalized_personal_number)';
    execute 'create index if not exists idx_customers_company_normalized_org on public.customers(company_id, normalized_org_number)';
  end if;

  if to_regclass('public.customer_sites') is not null then
    execute 'create index if not exists idx_customer_sites_company_customer_created on public.customer_sites(company_id, customer_id, created_at desc)';
    execute 'create index if not exists idx_customer_sites_company_facility on public.customer_sites(company_id, facility_id)';
  end if;

  if to_regclass('public.metering_points') is not null then
    execute 'create index if not exists idx_metering_points_company_customer on public.metering_points(company_id, customer_id)';
    execute 'create index if not exists idx_metering_points_company_site on public.metering_points(company_id, site_id)';
    execute 'create index if not exists idx_metering_points_company_meter_point on public.metering_points(company_id, meter_point_id)';
    execute 'create index if not exists idx_metering_points_company_normalized on public.metering_points(company_id, normalized_metering_point_id)';
  end if;

  if to_regclass('public.customer_contracts') is not null then
    execute 'create index if not exists idx_customer_contracts_company_customer on public.customer_contracts(company_id, customer_id, created_at desc)';
    execute 'create index if not exists idx_customer_contracts_company_site on public.customer_contracts(company_id, site_id)';
    execute 'create index if not exists idx_customer_contracts_company_customer_site on public.customer_contracts(company_id, customer_id, coalesce(customer_site_id, site_id))';
    execute 'create index if not exists idx_customer_contracts_company_metering_point on public.customer_contracts(company_id, metering_point_id)';
  end if;

  if to_regclass('public.customer_import_rows') is not null then
    execute 'create index if not exists idx_customer_import_rows_company_status_created on public.customer_import_rows(company_id, status, created_at desc)';
    execute 'create index if not exists idx_customer_import_rows_company_batch on public.customer_import_rows(company_id, import_batch_id, row_number)';
  end if;

  if to_regclass('public.billing_export_runs') is not null then
    execute 'create index if not exists idx_billing_export_runs_company_status_created on public.billing_export_runs(company_id, status, created_at desc)';
  end if;

  if to_regclass('public.billing_export_run_items') is not null then
    execute 'create index if not exists idx_billing_export_items_company_run_status on public.billing_export_run_items(company_id, billing_export_run_id, status)';
    execute 'create index if not exists idx_billing_export_items_company_customer on public.billing_export_run_items(company_id, customer_id)';
    execute 'create index if not exists idx_billing_export_items_company_site on public.billing_export_run_items(company_id, site_id)';
    execute 'create index if not exists idx_billing_export_items_company_metering_point on public.billing_export_run_items(company_id, metering_point_id)';
    execute 'create index if not exists idx_billing_export_items_company_contract on public.billing_export_run_items(company_id, contract_id)';
  end if;

  if to_regclass('public.ediel_inbound_cases') is not null then
    execute 'create index if not exists idx_ediel_inbound_cases_company_status_created on public.ediel_inbound_cases(company_id, status, created_at desc)';
    execute 'create index if not exists idx_ediel_inbound_cases_company_customer on public.ediel_inbound_cases(company_id, customer_id)';
    execute 'create index if not exists idx_ediel_inbound_cases_company_site on public.ediel_inbound_cases(company_id, site_id)';
    execute 'create index if not exists idx_ediel_inbound_cases_company_metering_point on public.ediel_inbound_cases(company_id, metering_point_id)';
  end if;

  if to_regclass('public.customer_portal_accounts') is not null then
    execute 'create index if not exists idx_customer_portal_accounts_company_customer on public.customer_portal_accounts(company_id, customer_id)';
    execute 'create index if not exists idx_customer_portal_accounts_user_customer on public.customer_portal_accounts(user_id, customer_id)';
  end if;

  if to_regclass('public.customer_portal_claims') is not null then
    execute 'create index if not exists idx_customer_portal_claims_company_customer on public.customer_portal_claims(company_id, customer_id)';
    execute 'create index if not exists idx_customer_portal_claims_company_status_created on public.customer_portal_claims(company_id, status, created_at desc)';
  end if;

  if to_regclass('public.customer_portal_events') is not null then
    execute 'create index if not exists idx_customer_portal_events_company_customer_created on public.customer_portal_events(company_id, customer_id, created_at desc)';
  end if;
end $$;

-- Lightweight runtime report for step 1+2 verification.
create or replace view public.gridex_debug_step1_2_schema_alignment_v as
with required_tables(table_name) as (
  values
    ('companies'),
    ('company_memberships'),
    ('user_roles'),
    ('customers'),
    ('customer_sites'),
    ('metering_points'),
    ('customer_contracts'),
    ('customer_import_rows'),
    ('billing_export_runs'),
    ('billing_export_run_items'),
    ('ediel_messages'),
    ('ediel_inbound_cases'),
    ('customer_portal_accounts'),
    ('customer_portal_claims')
), table_status as (
  select
    rt.table_name,
    to_regclass('public.' || rt.table_name) is not null as exists_in_db,
    coalesce(pc.relrowsecurity, false) as rls_enabled
  from required_tables rt
  left join pg_class pc on pc.oid = to_regclass('public.' || rt.table_name)
)
select
  table_name,
  exists_in_db,
  rls_enabled,
  case
    when not exists_in_db then 'missing_table'
    when not rls_enabled and table_name not in ('billing_export_runs') then 'review_rls'
    else 'ok'
  end as check_status
from table_status
order by table_name;

-- Runtime RPCs referenced by the app. Kept simple and defensive so code/database contracts stay aligned.
-- PostgreSQL cannot change an existing function return type with CREATE OR REPLACE.
-- A previous debug view can depend on gridex_get_user_roles(uuid), so drop only that view first,
-- recreate the function, then recreate the view with the new function row shape.
drop view if exists public.gridex_debug_batch2_rbac_v;
drop function if exists public.gridex_get_user_roles(uuid);

create or replace function public.gridex_get_user_roles(p_user_id uuid)
returns table(role_key text, key text, code text, name text)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(nullif(r.key, ''), nullif(ur.role, ''), nullif(r.name, '')) as role_key,
    coalesce(nullif(r.key, ''), nullif(ur.role, ''), nullif(r.name, '')) as key,
    coalesce(nullif(r.key, ''), nullif(ur.role, ''), nullif(r.name, '')) as code,
    coalesce(nullif(r.name, ''), nullif(r.key, ''), nullif(ur.role, '')) as name
  from public.user_roles ur
  left join public.roles r on r.id = ur.role_id
  where ur.user_id = p_user_id
    and coalesce(ur.is_active, true) = true
    and coalesce(ur.status, 'active') = 'active'

  union

  select
    coalesce(nullif(cm.role_key, ''), nullif(cm.membership_role::text, ''), nullif(cm.role, '')) as role_key,
    coalesce(nullif(cm.role_key, ''), nullif(cm.membership_role::text, ''), nullif(cm.role, '')) as key,
    coalesce(nullif(cm.role_key, ''), nullif(cm.membership_role::text, ''), nullif(cm.role, '')) as code,
    coalesce(nullif(cm.role_key, ''), nullif(cm.membership_role::text, ''), nullif(cm.role, '')) as name
  from public.company_memberships cm
  where cm.user_id = p_user_id
    and coalesce(cm.is_active, true) = true
    and coalesce(cm.status, 'active') = 'active';
$$;

grant execute on function public.gridex_get_user_roles(uuid) to anon, authenticated, service_role;


create or replace view public.gridex_debug_batch2_rbac_v as
select
  cm.company_id,
  c.name as company_name,
  c.status as company_status,
  cm.user_id,
  cm.invited_email,
  coalesce(cm.membership_role::text, cm.role::text, 'member') as membership_role,
  cm.status as membership_status,
  coalesce(cm.is_active, true) as membership_active,
  coalesce((
    select array_agg(distinct coalesce(gr.role_key, gr.key, gr.code, gr.name))
    from public.gridex_get_user_roles(cm.user_id) gr
  ), '{}'::text[]) as resolved_roles
from public.company_memberships cm
left join public.companies c on c.id = cm.company_id;

create or replace function public.gridex_get_user_permission_overrides(p_user_id uuid)
returns table(permission_key text, effect text)
language sql
stable
security definer
set search_path = public
as $$
  select
    upo.permission_key,
    upo.effect
  from public.user_permission_overrides upo
  where upo.user_id = p_user_id
    and coalesce(upo.is_active, true) = true
    and (upo.valid_from is null or upo.valid_from <= now())
    and (upo.valid_to is null or upo.valid_to >= now());
$$;

create or replace function public.admin_customer_latest_contract_counts(
  search_text text default null,
  customer_status text default null
)
returns table(bucket text, total bigint)
language sql
stable
security definer
set search_path = public
as $$
  with filtered_customers as (
    select c.*
    from public.customers c
    where (customer_status is null or customer_status = '' or c.status = customer_status)
      and (
        search_text is null or search_text = ''
        or c.full_name ilike '%' || search_text || '%'
        or c.company_name ilike '%' || search_text || '%'
        or c.email ilike '%' || search_text || '%'
        or c.customer_number ilike '%' || search_text || '%'
        or c.personal_number ilike '%' || search_text || '%'
        or c.org_number ilike '%' || search_text || '%'
      )
  ), latest_contract as (
    select distinct on (cc.customer_id)
      cc.customer_id,
      cc.status
    from public.customer_contracts cc
    join filtered_customers fc on fc.id = cc.customer_id
    order by cc.customer_id, cc.created_at desc nulls last, cc.id desc
  ), buckets as (
    select 'all'::text as bucket, count(*)::bigint as total from filtered_customers
    union all
    select 'none'::text, count(*)::bigint
    from filtered_customers fc
    left join latest_contract lc on lc.customer_id = fc.id
    where lc.customer_id is null
    union all
    select coalesce(lc.status, 'none')::text as bucket, count(*)::bigint as total
    from latest_contract lc
    group by coalesce(lc.status, 'none')
  )
  select buckets.bucket, buckets.total from buckets;
$$;

create or replace function public.ediel_resolve_message_rule(
  p_message_family text,
  p_message_code text,
  p_message_standard text default 'edifact',
  p_direction text default 'outbound',
  p_reference_date date default current_date
)
returns table(
  id uuid,
  message_family text,
  message_code text,
  message_standard text,
  version_code text,
  direction text,
  requires_contrl boolean,
  requires_aperak boolean,
  supports_negative_response boolean,
  is_active boolean,
  valid_from date,
  valid_to date,
  notes text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id,
    r.message_family,
    r.message_code,
    r.message_standard,
    r.version_code,
    r.direction,
    r.requires_contrl,
    r.requires_aperak,
    r.supports_negative_response,
    r.is_active,
    r.valid_from,
    r.valid_to,
    r.notes
  from public.ediel_message_rules r
  where lower(r.message_family) = lower(p_message_family)
    and (p_message_code is null or p_message_code = '' or lower(r.message_code) = lower(p_message_code))
    and lower(coalesce(r.message_standard, 'edifact')) = lower(coalesce(p_message_standard, 'edifact'))
    and coalesce(r.is_active, true) = true
    and (r.direction = p_direction or r.direction = 'both')
    and (r.valid_from is null or r.valid_from <= p_reference_date)
    and (r.valid_to is null or r.valid_to >= p_reference_date)
  order by r.valid_from desc nulls last, r.valid_to asc nulls last, r.created_at desc nulls last
  limit 1;
$$;

create or replace function public.ediel_resolve_inbound_message_rules(
  p_message_family text,
  p_message_code text,
  p_message_standard text default 'edifact',
  p_reference_date date default current_date
)
returns table(
  id uuid,
  version_code text,
  valid_from date,
  valid_to date,
  requires_contrl boolean,
  requires_aperak boolean,
  supports_negative_response boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id,
    r.version_code,
    r.valid_from,
    r.valid_to,
    r.requires_contrl,
    r.requires_aperak,
    r.supports_negative_response
  from public.ediel_message_rules r
  where lower(r.message_family) = lower(p_message_family)
    and (p_message_code is null or p_message_code = '' or lower(r.message_code) = lower(p_message_code))
    and lower(coalesce(r.message_standard, 'edifact')) = lower(coalesce(p_message_standard, 'edifact'))
    and coalesce(r.is_active, true) = true
    and (r.direction = 'inbound' or r.direction = 'both')
    and (r.valid_from is null or r.valid_from <= p_reference_date)
  order by r.valid_from desc nulls last, r.valid_to asc nulls last, r.created_at desc nulls last;
$$;
