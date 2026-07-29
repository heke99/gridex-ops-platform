-- Canonical contract price options, component selection and immutable quote
-- resolution. This is intentionally forward-only; no historical migration is
-- rewritten.

create table if not exists public.contract_price_options (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  contract_product_version_id uuid not null
    references public.contract_product_versions(id) on delete cascade,
  price_plan_version_id uuid not null
    references public.price_plan_versions(id) on delete cascade,
  option_reference text not null,
  option_code text not null,
  customer_name text not null,
  internal_description text,
  contract_type text not null check (contract_type in (
    'fixed','variable_monthly','variable_hourly','variable_quarterly',
    'portfolio','mixed'
  )),
  binding_months integer not null check (binding_months between 0 and 240),
  notice_months integer not null check (notice_months between 0 and 36),
  auto_renew_enabled boolean not null,
  renewal_term_months integer,
  valid_from date,
  valid_to date,
  earliest_start_date date,
  latest_start_date date,
  status text not null check (status in ('draft','active','paused','archived')),
  sort_order integer not null default 0,
  version_number integer not null default 1 check (version_number > 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid,
  constraint contract_price_options_reference_format check (
    option_reference ~ '^[a-z0-9][a-z0-9_-]{2,99}$'
    and option_code ~ '^[a-z0-9][a-z0-9_-]{2,99}$'
  ),
  constraint contract_price_options_dates check (
    (valid_from is null or valid_to is null or valid_to >= valid_from)
    and (
      earliest_start_date is null
      or latest_start_date is null
      or latest_start_date >= earliest_start_date
    )
  ),
  constraint contract_price_options_renewal check (
    (auto_renew_enabled and renewal_term_months between 1 and 120)
    or (not auto_renew_enabled and renewal_term_months is null)
  ),
  unique(price_plan_version_id,option_reference),
  unique(price_plan_version_id,option_code)
);

create table if not exists public.contract_price_option_area_prices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  contract_price_option_id uuid not null
    references public.contract_price_options(id) on delete cascade,
  price_plan_version_id uuid not null
    references public.price_plan_versions(id) on delete cascade,
  price_row_reference text not null,
  price_area text not null check (price_area in ('SE1','SE2','SE3','SE4')),
  amount numeric(18,6) not null check (amount > 0),
  unit text not null check (unit in ('ore_per_kwh','sek_per_kwh')),
  vat_treatment text not null default 'standard'
    check (vat_treatment in ('standard','exempt')),
  valid_from date,
  valid_to date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid,
  constraint contract_price_option_area_reference_format check (
    price_row_reference ~ '^[a-z0-9][a-z0-9_-]{2,99}$'
  ),
  constraint contract_price_option_area_dates check (
    valid_from is null or valid_to is null or valid_to >= valid_from
  ),
  unique(contract_price_option_id,price_area),
  unique(price_plan_version_id,price_row_reference)
);

create table if not exists public.contract_pricing_migration_reviews (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  price_plan_version_id uuid
    references public.price_plan_versions(id) on delete cascade,
  source_table text not null,
  source_id uuid,
  reason_code text not null,
  details jsonb not null default '{}'::jsonb,
  status text not null default 'open'
    check (status in ('open','resolved','dismissed')),
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz not null default now(),
  unique(price_plan_version_id,source_table,source_id,reason_code)
);

alter table public.price_components
  add column if not exists component_reference text,
  add column if not exists component_code text,
  add column if not exists customer_name text,
  add column if not exists internal_name text,
  add column if not exists selection_policy text,
  add column if not exists default_selected boolean,
  add column if not exists customer_can_deselect boolean,
  add column if not exists admin_must_select boolean,
  add column if not exists informational_only boolean not null default false,
  add column if not exists lifecycle text,
  add column if not exists periodization_rule text,
  add column if not exists invoice_line_name text,
  add column if not exists accounting_classification text,
  add column if not exists vat_treatment text,
  add column if not exists website_published boolean not null default true,
  add column if not exists conditions jsonb not null default '{}'::jsonb;

alter table public.price_components
  drop constraint if exists price_components_selection_policy_check,
  add constraint price_components_selection_policy_check check (
    selection_policy is null or selection_policy in (
      'mandatory','customer_optional','admin_optional','conditional'
    )
  ),
  drop constraint if exists price_components_lifecycle_check,
  add constraint price_components_lifecycle_check check (
    lifecycle is null or lifecycle in (
      'recurring','per_invoice','per_site','once_per_contract',
      'once_per_site','annual','consumption_based','event_only'
    )
  ),
  drop constraint if exists price_components_selection_invariants_check,
  add constraint price_components_selection_invariants_check check (
    selection_policy is null
    or (
      selection_policy <> 'mandatory'
      or (default_selected is true and customer_can_deselect is false)
    )
  ),
  drop constraint if exists price_components_reference_format_check,
  add constraint price_components_reference_format_check check (
    component_reference is null
    or (
      component_reference ~ '^[a-z0-9][a-z0-9_-]{2,99}$'
      and component_code ~ '^[a-z0-9][a-z0-9_-]{2,99}$'
    )
  );

create unique index if not exists price_components_version_reference_uidx
  on public.price_components(price_plan_version_id,component_reference)
  where component_reference is not null;
create unique index if not exists price_components_version_code_uidx
  on public.price_components(price_plan_version_id,component_code)
  where component_code is not null;
create index if not exists contract_price_options_lookup_idx
  on public.contract_price_options(
    company_id,contract_product_version_id,price_plan_version_id,status,sort_order
  );
create index if not exists contract_price_option_area_lookup_idx
  on public.contract_price_option_area_prices(
    company_id,contract_price_option_id,price_area
  );

alter table public.website_contract_quotes
  add column if not exists price_option_reference text,
  add column if not exists area_price_reference text,
  add column if not exists invoice_delivery_method text,
  add column if not exists selected_component_references text[] not null
    default '{}'::text[],
  add column if not exists mandatory_component_references text[] not null
    default '{}'::text[],
  add column if not exists conditional_component_references text[] not null
    default '{}'::text[],
  add column if not exists resolved_base_components jsonb not null
    default '[]'::jsonb,
  add column if not exists resolved_price_components jsonb not null
    default '[]'::jsonb;

alter table public.website_contract_quotes
  drop constraint if exists website_contract_quotes_invoice_delivery_check,
  add constraint website_contract_quotes_invoice_delivery_check check (
    invoice_delivery_method is null or invoice_delivery_method in (
      'email','e_invoice','paper','direct_debit'
    )
  ),
  drop constraint if exists website_contract_quotes_hash_version_check,
  add constraint website_contract_quotes_hash_version_check check (
    quote_hash_version in (
      'v1_snapshot_only','v2_full_quote','v3_commercial_selection'
    )
  ),
  drop constraint if exists website_contract_quotes_v3_selection_check,
  add constraint website_contract_quotes_v3_selection_check check (
    quote_hash_version <> 'v3_commercial_selection'
    or (
      pricing_snapshot_schema_version='gridex_contract_pricing_v6_selection'
      and price_option_reference is not null
      and invoice_delivery_method is not null
      and jsonb_typeof(resolved_base_components)='array'
      and jsonb_typeof(resolved_price_components)='array'
    )
  );

create or replace function public.gridex_reject_quote_snapshot_mutation()
returns trigger
language plpgsql
set search_path=public,extensions,pg_catalog,pg_temp
as $$
begin
  if tg_op='INSERT' then
    if new.quote_hash_version not in (
        'v2_full_quote','v3_commercial_selection'
      )
      or coalesce(new.quote_hash,'') !~ '^[0-9a-f]{64}$'
      or new.valid_until is null
      or new.valid_until<=new.created_at
      or (
        new.quote_hash_version='v3_commercial_selection'
        and (
          new.price_option_reference is null
          or new.invoice_delivery_method is null
          or new.pricing_snapshot_schema_version
            <>'gridex_contract_pricing_v6_selection'
          or jsonb_typeof(new.resolved_base_components)<>'array'
          or jsonb_typeof(new.resolved_price_components)<>'array'
        )
      ) then
      raise exception using
        errcode='23514',
        message='website_quote_commercial_integrity_required';
    end if;
    return new;
  end if;

  if new.company_id is distinct from old.company_id
    or new.quote_reference is distinct from old.quote_reference
    or new.offer_reference is distinct from old.offer_reference
    or new.contract_product_id is distinct from old.contract_product_id
    or new.contract_product_version_id
      is distinct from old.contract_product_version_id
    or new.contract_publication_version_id
      is distinct from old.contract_publication_version_id
    or new.price_plan_id is distinct from old.price_plan_id
    or new.price_plan_version_id is distinct from old.price_plan_version_id
    or new.price_book_id is distinct from old.price_book_id
    or new.legal_bundle_version_id is distinct from old.legal_bundle_version_id
    or new.customer_type is distinct from old.customer_type
    or new.energy_direction is distinct from old.energy_direction
    or new.price_area is distinct from old.price_area
    or new.grid_area_code is distinct from old.grid_area_code
    or new.annual_consumption_kwh is distinct from old.annual_consumption_kwh
    or new.start_date is distinct from old.start_date
    or new.energy_resolution_id is distinct from old.energy_resolution_id
    or new.resolution_snapshot is distinct from old.resolution_snapshot
    or new.resolver_version is distinct from old.resolver_version
    or new.geodata_version is distinct from old.geodata_version
    or new.resolution_binding_status is distinct from old.resolution_binding_status
    or new.market_reference is distinct from old.market_reference
    or new.market_data_timestamp is distinct from old.market_data_timestamp
    or new.market_sources is distinct from old.market_sources
    or new.assumptions is distinct from old.assumptions
    or new.pricing_snapshot_schema_version
      is distinct from old.pricing_snapshot_schema_version
    or new.postal_code is distinct from old.postal_code
    or new.quote_snapshot is distinct from old.quote_snapshot
    or new.valid_until is distinct from old.valid_until
    or new.quote_hash is distinct from old.quote_hash
    or new.quote_hash_version is distinct from old.quote_hash_version
    or new.price_option_reference is distinct from old.price_option_reference
    or new.area_price_reference is distinct from old.area_price_reference
    or new.invoice_delivery_method is distinct from old.invoice_delivery_method
    or new.selected_component_references
      is distinct from old.selected_component_references
    or new.mandatory_component_references
      is distinct from old.mandatory_component_references
    or new.conditional_component_references
      is distinct from old.conditional_component_references
    or new.resolved_base_components is distinct from old.resolved_base_components
    or new.resolved_price_components
      is distinct from old.resolved_price_components then
    raise exception using
      errcode='55000',
      message='website_quote_snapshot_immutable';
  end if;
  return new;
end
$$;

alter table public.contract_price_snapshots
  add column if not exists snapshot_schema_version text,
  add column if not exists quote_reference text,
  add column if not exists quote_hash text,
  add column if not exists price_option_reference text,
  add column if not exists area_price_reference text,
  add column if not exists invoice_delivery_method text,
  add column if not exists selected_component_references text[] not null
    default '{}'::text[];

create or replace function public.gridex_bind_contract_snapshot_to_quote_v1()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_snapshot jsonb:=coalesce(new.snapshot_json,'{}'::jsonb);
  v_quote public.website_contract_quotes%rowtype;
  v_requires_quote boolean;
begin
  new.snapshot_schema_version:=coalesce(
    new.snapshot_schema_version,
    v_snapshot->>'snapshot_schema',
    v_snapshot->>'schema_version'
  );
  if new.snapshot_schema_version<>'gridex_contract_pricing_v6_selection' then
    return new;
  end if;
  new.quote_reference:=coalesce(
    new.quote_reference,v_snapshot->>'quote_reference'
  );
  new.quote_hash:=coalesce(new.quote_hash,v_snapshot->>'quote_hash');
  new.price_option_reference:=coalesce(
    new.price_option_reference,v_snapshot->>'price_option_reference'
  );
  new.area_price_reference:=coalesce(
    new.area_price_reference,v_snapshot->>'area_price_reference'
  );
  new.invoice_delivery_method:=coalesce(
    new.invoice_delivery_method,v_snapshot->>'invoice_delivery_method'
  );
  if new.selected_component_references='{}'::text[] then
    new.selected_component_references:=array(
      select value
      from jsonb_array_elements_text(
        coalesce(v_snapshot->'selected_component_references','[]'::jsonb)
      )
    );
  end if;
  v_requires_quote:=coalesce(new.source,'') in (
    'website_customer_applications',
    'external_website',
    'website_application'
  );
  if (v_requires_quote and new.quote_reference is null)
    or (v_requires_quote and new.quote_hash is null)
    or new.price_option_reference is null
    or new.invoice_delivery_method is null
    or (
      v_snapshot->>'contract_type'='fixed'
      and new.area_price_reference is null
    )
    or jsonb_typeof(new.base_price_components_snapshot)<>'array'
    or jsonb_typeof(new.price_components_snapshot)<>'array' then
    raise exception using
      errcode='23514',
      message='contract_commercial_snapshot_identity_incomplete';
  end if;

  if v_requires_quote then
    select quote.*
      into v_quote
    from public.website_contract_quotes quote
    where quote.company_id=new.company_id
      and quote.quote_reference=new.quote_reference;
    if not found
      or v_quote.quote_hash is distinct from new.quote_hash
      or v_quote.price_option_reference
        is distinct from new.price_option_reference
      or v_quote.area_price_reference is distinct from new.area_price_reference
      or v_quote.invoice_delivery_method
        is distinct from new.invoice_delivery_method
      or v_quote.selected_component_references
        is distinct from new.selected_component_references
      or v_quote.resolved_base_components
        is distinct from new.base_price_components_snapshot
      or v_quote.resolved_price_components
        is distinct from new.price_components_snapshot then
      raise exception using
        errcode='23514',
        message='contract_snapshot_quote_selection_mismatch';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists contract_price_snapshots_quote_binding
  on public.contract_price_snapshots;
create trigger contract_price_snapshots_quote_binding
before insert on public.contract_price_snapshots
for each row execute function public.gridex_bind_contract_snapshot_to_quote_v1();

alter table public.customer_invoice_lines
  add column if not exists contract_price_snapshot_id uuid
    references public.contract_price_snapshots(id) on delete restrict,
  add column if not exists price_plan_version_id uuid
    references public.price_plan_versions(id) on delete restrict,
  add column if not exists price_option_reference text,
  add column if not exists area_price_reference text,
  add column if not exists component_reference text,
  add column if not exists source_invoice_line_id uuid
    references public.customer_invoice_lines(id) on delete restrict;

create or replace function public.gridex_assert_commercial_child_scope()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_company_id uuid;
  v_plan_version_id uuid;
begin
  if tg_table_name='contract_price_option_area_prices' then
    select option_row.company_id,option_row.price_plan_version_id
      into v_company_id,v_plan_version_id
    from public.contract_price_options option_row
    where option_row.id=new.contract_price_option_id;
    if v_company_id is null
      or v_company_id<>new.company_id
      or v_plan_version_id<>new.price_plan_version_id then
      raise exception using
        errcode='23514',
        message='commercial_area_price_tenant_or_version_mismatch';
    end if;
  else
    select plan_version.company_id
      into v_company_id
    from public.price_plan_versions plan_version
    where plan_version.id=new.price_plan_version_id;
    if v_company_id is null or v_company_id<>new.company_id then
      raise exception using
        errcode='23514',
        message='commercial_option_tenant_or_version_mismatch';
    end if;
    if not exists(
      select 1
      from public.contract_product_versions product_version
      join public.contract_products product
        on product.id=product_version.contract_product_id
      where product_version.id=new.contract_product_version_id
        and product_version.price_plan_version_id=new.price_plan_version_id
        and product.company_id=new.company_id
    ) then
      raise exception using
        errcode='23514',
        message='commercial_option_product_version_mismatch';
    end if;
  end if;
  return new;
end
$$;

create or replace function public.gridex_lock_commercial_child()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_price_plan_version_id uuid;
begin
  v_price_plan_version_id:=old.price_plan_version_id;
  if exists(
    select 1 from public.price_plan_versions version_row
    where version_row.id=v_price_plan_version_id
      and version_row.locked_at is not null
  ) then
    raise exception using
      errcode='55000',
      message='locked_commercial_pricing_is_immutable';
  end if;
  return case when tg_op='DELETE' then old else new end;
end
$$;

drop trigger if exists contract_price_options_scope
  on public.contract_price_options;
create trigger contract_price_options_scope
before insert or update on public.contract_price_options
for each row execute function public.gridex_assert_commercial_child_scope();

drop trigger if exists contract_price_option_area_scope
  on public.contract_price_option_area_prices;
create trigger contract_price_option_area_scope
before insert or update on public.contract_price_option_area_prices
for each row execute function public.gridex_assert_commercial_child_scope();

drop trigger if exists contract_price_options_locked
  on public.contract_price_options;
create trigger contract_price_options_locked
before update or delete on public.contract_price_options
for each row execute function public.gridex_lock_commercial_child();

drop trigger if exists contract_price_option_area_locked
  on public.contract_price_option_area_prices;
create trigger contract_price_option_area_locked
before update or delete on public.contract_price_option_area_prices
for each row execute function public.gridex_lock_commercial_child();

alter table public.contract_price_options enable row level security;
alter table public.contract_price_option_area_prices enable row level security;
alter table public.contract_pricing_migration_reviews enable row level security;

drop policy if exists contract_price_options_tenant_read
  on public.contract_price_options;
create policy contract_price_options_tenant_read
on public.contract_price_options for select to authenticated
using(public.gridex_can_read_company(company_id));
drop policy if exists contract_price_options_tenant_write
  on public.contract_price_options;
create policy contract_price_options_tenant_write
on public.contract_price_options for all to authenticated
using(public.gridex_can_write_company(company_id))
with check(public.gridex_can_write_company(company_id));
drop policy if exists contract_price_options_service
  on public.contract_price_options;
create policy contract_price_options_service
on public.contract_price_options for all to service_role
using(true) with check(true);

drop policy if exists contract_price_option_area_tenant_read
  on public.contract_price_option_area_prices;
create policy contract_price_option_area_tenant_read
on public.contract_price_option_area_prices for select to authenticated
using(public.gridex_can_read_company(company_id));
drop policy if exists contract_price_option_area_tenant_write
  on public.contract_price_option_area_prices;
create policy contract_price_option_area_tenant_write
on public.contract_price_option_area_prices for all to authenticated
using(public.gridex_can_write_company(company_id))
with check(public.gridex_can_write_company(company_id));
drop policy if exists contract_price_option_area_service
  on public.contract_price_option_area_prices;
create policy contract_price_option_area_service
on public.contract_price_option_area_prices for all to service_role
using(true) with check(true);

drop policy if exists contract_pricing_reviews_tenant_read
  on public.contract_pricing_migration_reviews;
create policy contract_pricing_reviews_tenant_read
on public.contract_pricing_migration_reviews for select to authenticated
using(public.gridex_can_read_company(company_id));
drop policy if exists contract_pricing_reviews_service
  on public.contract_pricing_migration_reviews;
create policy contract_pricing_reviews_service
on public.contract_pricing_migration_reviews for all to service_role
using(true) with check(true);

grant select on public.contract_price_options,
  public.contract_price_option_area_prices,
  public.contract_pricing_migration_reviews to authenticated,service_role;
grant insert,update,delete on public.contract_price_options,
  public.contract_price_option_area_prices,
  public.contract_pricing_migration_reviews to service_role;

-- Persist the complete commercial model in the same transaction as the
-- existing canonical offer/product/price-plan graph.
create or replace function public.gridex_upsert_internal_contract_offer_v3(
  p_company_id uuid,
  p_offer_id uuid,
  p_payload jsonb,
  p_pricing_snapshot jsonb,
  p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_result jsonb;
  v_contract_product_version_id uuid;
  v_price_plan_version_id uuid;
  v_option jsonb;
  v_area jsonb;
  v_component jsonb;
  v_option_id uuid;
  v_option_references text[] := '{}'::text[];
  v_component_references text[] := '{}'::text[];
begin
  if p_pricing_snapshot->>'snapshot_schema'
      <> 'gridex_contract_pricing_v6_selection'
    or jsonb_typeof(p_pricing_snapshot->'price_options')<>'array'
    or jsonb_array_length(p_pricing_snapshot->'price_options')=0
    or jsonb_typeof(p_pricing_snapshot->'commercial_components')<>'array'
    or jsonb_typeof(p_pricing_snapshot->'invoice_delivery_methods')<>'array'
    or jsonb_array_length(p_pricing_snapshot->'invoice_delivery_methods')=0 then
    raise exception using
      errcode='22023',
      message='commercial_pricing_snapshot_incomplete';
  end if;

  v_result:=public.gridex_upsert_internal_contract_offer_v2(
    p_company_id,p_offer_id,p_payload,p_pricing_snapshot,p_actor_user_id
  );
  if coalesce((v_result->>'ok')::boolean,true)=false then
    return v_result;
  end if;
  v_contract_product_version_id :=
    nullif(v_result->>'contract_product_version_id','')::uuid;
  v_price_plan_version_id :=
    nullif(v_result#>>'{pricing,price_plan_version_id}','')::uuid;
  if v_contract_product_version_id is null
    or v_price_plan_version_id is null then
    raise exception using
      errcode='23502',
      message='commercial_pricing_canonical_version_missing';
  end if;

  for v_option in
    select value from jsonb_array_elements(
      p_pricing_snapshot->'price_options'
    )
  loop
    if coalesce(v_option->>'price_option_reference','')
        !~ '^[a-z0-9][a-z0-9_-]{2,99}$'
      or coalesce(v_option->>'option_code','')
        !~ '^[a-z0-9][a-z0-9_-]{2,99}$'
      or v_option->>'contract_type'<>p_payload->>'contract_type'
      or jsonb_typeof(v_option->'area_prices')<>'array' then
      raise exception using
        errcode='22023',
        message='commercial_price_option_invalid';
    end if;
    if v_option->>'contract_type'='fixed'
      and jsonb_array_length(v_option->'area_prices')=0 then
      raise exception using
        errcode='22023',
        message='fixed_price_option_area_price_missing';
    end if;

    insert into public.contract_price_options(
      company_id,contract_product_version_id,price_plan_version_id,
      option_reference,option_code,customer_name,internal_description,
      contract_type,binding_months,notice_months,auto_renew_enabled,
      renewal_term_months,valid_from,valid_to,earliest_start_date,
      latest_start_date,status,sort_order,version_number,metadata,created_by
    ) values(
      p_company_id,v_contract_product_version_id,v_price_plan_version_id,
      v_option->>'price_option_reference',v_option->>'option_code',
      v_option->>'customer_name',nullif(v_option->>'internal_description',''),
      v_option->>'contract_type',(v_option->>'binding_months')::integer,
      (v_option->>'notice_months')::integer,
      (v_option->>'auto_renew_enabled')::boolean,
      nullif(v_option->>'renewal_term_months','')::integer,
      nullif(v_option->>'valid_from','')::date,
      nullif(v_option->>'valid_to','')::date,
      nullif(v_option->>'earliest_start_date','')::date,
      nullif(v_option->>'latest_start_date','')::date,
      v_option->>'status',(v_option->>'sort_order')::integer,
      coalesce((v_option->>'version_number')::integer,1),
      coalesce(v_option->'metadata','{}'::jsonb),p_actor_user_id
    )
    returning id into v_option_id;

    v_option_references:=array_append(
      v_option_references,v_option->>'price_option_reference'
    );
    for v_area in
      select value from jsonb_array_elements(v_option->'area_prices')
    loop
      insert into public.contract_price_option_area_prices(
        company_id,contract_price_option_id,price_plan_version_id,
        price_row_reference,price_area,amount,unit,vat_treatment,
        valid_from,valid_to,metadata,created_by
      ) values(
        p_company_id,v_option_id,v_price_plan_version_id,
        v_area->>'price_row_reference',v_area->>'price_area',
        (v_area->>'amount')::numeric,v_area->>'unit',
        coalesce(v_area->>'vat_treatment','standard'),
        nullif(v_area->>'valid_from','')::date,
        nullif(v_area->>'valid_to','')::date,
        coalesce(v_area->'metadata','{}'::jsonb),p_actor_user_id
      );
    end loop;
  end loop;

  for v_component in
    select value from jsonb_array_elements(
      p_pricing_snapshot->'commercial_components'
    )
  loop
    if coalesce(v_component->>'component_reference','')
        !~ '^[a-z0-9][a-z0-9_-]{2,99}$'
      or coalesce(v_component->>'component_code','')
        !~ '^[a-z0-9][a-z0-9_-]{2,99}$'
      or v_component->>'selection_policy' not in (
        'mandatory','customer_optional','admin_optional','conditional'
      )
      or (
        v_component->>'unit'='percent'
        and nullif(v_component->>'calculation_base','') is null
      ) then
      raise exception using
        errcode='22023',
        message='commercial_price_component_invalid';
    end if;

    insert into public.price_components(
      company_id,price_plan_version_id,component_type,name,description,
      calculation_type,calculation_base,amount,unit,vat_applicable,
      invoice_line_visible,periodization_mode,priority,valid_from,valid_to,
      status,metadata,created_by,component_reference,component_code,
      customer_name,internal_name,selection_policy,default_selected,
      customer_can_deselect,admin_must_select,informational_only,lifecycle,
      periodization_rule,invoice_line_name,accounting_classification,
      vat_treatment,website_published,conditions
    ) values(
      p_company_id,v_price_plan_version_id,
      v_component->>'component_type',v_component->>'customer_name',
      nullif(v_component->>'customer_description',''),
      v_component->>'calculation_type',
      nullif(v_component->>'calculation_base',''),
      (v_component->>'amount')::numeric,v_component->>'unit',
      coalesce(v_component->>'vat_treatment','standard')<>'exempt',
      not coalesce((v_component->>'informational_only')::boolean,false),
      coalesce(v_component->>'periodization_rule','none'),
      (v_component->>'sort_order')::integer,
      nullif(v_component->>'valid_from','')::date,
      nullif(v_component->>'valid_to','')::date,'active',
      coalesce(v_component->'metadata','{}'::jsonb)
        || jsonb_build_object(
          'component_reference',v_component->>'component_reference',
          'component_code',v_component->>'component_code',
          'selection_policy',v_component->>'selection_policy',
          'lifecycle',v_component->>'lifecycle',
          'conditions',coalesce(v_component->'conditions','{}'::jsonb)
        ),
      p_actor_user_id,v_component->>'component_reference',
      v_component->>'component_code',v_component->>'customer_name',
      v_component->>'internal_name',v_component->>'selection_policy',
      (v_component->>'default_selected')::boolean,
      (v_component->>'customer_can_deselect')::boolean,
      (v_component->>'admin_must_select')::boolean,
      coalesce((v_component->>'informational_only')::boolean,false),
      v_component->>'lifecycle',v_component->>'periodization_rule',
      v_component->>'invoice_line_name',
      v_component->>'accounting_classification',
      v_component->>'vat_treatment',
      coalesce((v_component->>'website_published')::boolean,true),
      coalesce(v_component->'conditions','{}'::jsonb)
    );
    v_component_references:=array_append(
      v_component_references,v_component->>'component_reference'
    );
  end loop;

  return v_result||jsonb_build_object(
    'price_option_references',to_jsonb(v_option_references),
    'component_references',to_jsonb(v_component_references),
    'commercial_snapshot_schema','gridex_contract_pricing_v6_selection'
  );
exception
  when unique_violation then
    raise exception using
      errcode='23505',
      message='commercial_pricing_reference_duplicate';
end
$$;

revoke all on function public.gridex_upsert_internal_contract_offer_v3(
  uuid,uuid,jsonb,jsonb,uuid
) from public,anon,authenticated;
grant execute on function public.gridex_upsert_internal_contract_offer_v3(
  uuid,uuid,jsonb,jsonb,uuid
) to service_role;

create or replace function public.gridex_create_internal_customer_contract_v1(
  p_company_id uuid,
  p_customer_id uuid,
  p_contract_offer_id uuid,
  p_site_id uuid,
  p_metering_point_id uuid,
  p_selection jsonb,
  p_contract jsonb,
  p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_offer public.contract_offers%rowtype;
  v_option public.contract_price_options%rowtype;
  v_area public.contract_price_option_area_prices%rowtype;
  v_contract public.customer_contracts%rowtype;
  v_snapshot_id uuid;
  v_selected_refs text[];
  v_resolved_count integer;
  v_pricing_model text;
begin
  perform public.gridex_assert_contract_permission(
    p_actor_user_id,'contracts.create'
  );
  if p_selection->>'snapshot_schema'
      <>'gridex_contract_pricing_v6_selection'
    or jsonb_typeof(p_selection->'base_price_components_snapshot')<>'array'
    or jsonb_typeof(p_selection->'price_components_snapshot')<>'array'
    or nullif(p_selection->>'price_option_reference','') is null
    or nullif(p_selection->>'invoice_delivery_method','') is null then
    raise exception using
      errcode='22023',
      message='internal_contract_commercial_selection_incomplete';
  end if;

  select offer.*
    into v_offer
  from public.contract_offers offer
  where offer.id=p_contract_offer_id
    and offer.company_id=p_company_id
    and offer.lifecycle_status='published'
    and offer.is_active
  for share;
  if not found then
    raise exception using
      errcode='P0002',
      message='internal_contract_offer_not_sellable';
  end if;
  if not exists(
    select 1 from public.customers customer
    where customer.id=p_customer_id
      and customer.company_id=p_company_id
  ) then
    raise exception using
      errcode='23514',
      message='internal_contract_customer_tenant_mismatch';
  end if;
  if p_site_id is not null and not exists(
    select 1 from public.customer_sites site
    where site.id=p_site_id
      and site.company_id=p_company_id
      and site.customer_id=p_customer_id
  ) then
    raise exception using
      errcode='23514',
      message='internal_contract_site_tenant_mismatch';
  end if;
  if p_metering_point_id is not null and not exists(
    select 1 from public.metering_points point
    where point.id=p_metering_point_id
      and point.company_id=p_company_id
      and (p_site_id is null or point.site_id=p_site_id)
  ) then
    raise exception using
      errcode='23514',
      message='internal_contract_metering_point_tenant_mismatch';
  end if;

  select option_row.*
    into v_option
  from public.contract_price_options option_row
  where option_row.company_id=p_company_id
    and option_row.contract_product_version_id
      =v_offer.contract_product_version_id
    and option_row.price_plan_version_id=v_offer.price_plan_version_id
    and option_row.option_reference=p_selection->>'price_option_reference'
    and option_row.status='active';
  if not found then
    raise exception using
      errcode='23514',
      message='internal_contract_price_option_not_available';
  end if;
  if v_offer.contract_type='fixed' then
    select area_row.*
      into v_area
    from public.contract_price_option_area_prices area_row
    where area_row.company_id=p_company_id
      and area_row.contract_price_option_id=v_option.id
      and area_row.price_row_reference=p_selection->>'area_price_reference'
      and area_row.price_area=p_selection->>'price_area';
    if not found then
      raise exception using
        errcode='23514',
        message='internal_contract_area_price_not_available';
    end if;
  end if;

  v_selected_refs:=array(
    select value
    from jsonb_array_elements_text(
      coalesce(p_selection->'selected_component_references','[]'::jsonb)
    )
  );
  select count(*)
    into v_resolved_count
  from jsonb_array_elements(
    p_selection->'price_components_snapshot'
  ) component
  where coalesce(
    component->>'componentReference',
    component->>'component_reference',
    component#>>'{metadata,component_reference}'
  )=any(v_selected_refs);
  if v_resolved_count<>coalesce(array_length(v_selected_refs,1),0)
    or exists(
      select 1
      from unnest(v_selected_refs) reference
      where not exists(
        select 1
        from public.price_components component
        where component.company_id=p_company_id
          and component.price_plan_version_id=v_offer.price_plan_version_id
          and component.component_reference=reference
          and component.status='active'
      )
    ) then
    raise exception using
      errcode='23514',
      message='internal_contract_component_selection_mismatch';
  end if;

  select pricing_model
    into v_pricing_model
  from public.contract_product_versions
  where id=v_offer.contract_product_version_id;

  insert into public.customer_contracts(
    company_id,customer_id,site_id,customer_site_id,metering_point_id,
    contract_offer_id,contract_product_id,contract_product_version_id,
    price_plan_id,price_plan_version_id,price_book_id,
    legal_bundle_version_id,source_type,status,contract_name,contract_type,
    energy_direction,offer_reference,commercial_snapshot,price_snapshot,
    monthly_fee_sek,invoice_fee_sek,fixed_price_ore_per_kwh,
    binding_months,notice_months,optional_fee_lines,agreement_channel,
    starts_at,ends_at,signed_at,auto_renew_enabled,auto_renew_term_months,
    override_reason,metadata,created_by,updated_by
  ) values(
    p_company_id,p_customer_id,p_site_id,p_site_id,p_metering_point_id,
    v_offer.id,v_offer.contract_product_id,v_offer.contract_product_version_id,
    v_offer.price_plan_id,v_offer.price_plan_version_id,v_offer.price_book_id,
    v_offer.legal_bundle_version_id,'catalog',
    coalesce(nullif(p_contract->>'status',''),'pending_signature'),
    coalesce(nullif(p_contract->>'contract_name',''),v_offer.name),
    v_offer.contract_type,v_offer.energy_direction,
    coalesce(nullif(v_offer.slug,''),v_offer.id::text),
    p_selection,p_selection,
    (
      select (component->>'amount')::numeric
      from jsonb_array_elements(
        p_selection->'price_components_snapshot'
      ) component
      where coalesce(
        component->>'componentCode',
        component->>'component_code',
        component#>>'{metadata,component_code}'
      )='monthly_fee'
      limit 1
    ),
    (
      select (component->>'amount')::numeric
      from jsonb_array_elements(
        p_selection->'price_components_snapshot'
      ) component
      where coalesce(
        component->>'componentCode',
        component->>'component_code',
        component#>>'{metadata,component_code}'
      )='invoice_administration_fee'
      limit 1
    ),
    case when v_offer.contract_type='fixed'
      then case when v_area.unit='sek_per_kwh'
        then v_area.amount*100 else v_area.amount end
      else null end,
    v_option.binding_months,v_option.notice_months,
    p_selection->'price_components_snapshot','internal',
    nullif(p_contract->>'starts_at','')::date,
    nullif(p_contract->>'ends_at','')::date,
    nullif(p_contract->>'signed_at','')::timestamptz,
    v_option.auto_renew_enabled,v_option.renewal_term_months,
    nullif(p_contract->>'override_reason',''),
    jsonb_build_object(
      'source_of_truth','contract_price_options',
      'price_option_reference',v_option.option_reference,
      'area_price_reference',v_area.price_row_reference,
      'invoice_delivery_method',p_selection->>'invoice_delivery_method',
      'selected_component_references',to_jsonb(v_selected_refs)
    ),
    p_actor_user_id,p_actor_user_id
  )
  returning * into v_contract;

  insert into public.contract_price_snapshots(
    company_id,contract_id,customer_id,source,price_plan_version_id,pricing_model,
    base_price_components_snapshot,price_components_snapshot,snapshot_json,
    valid_from,valid_to,snapshot_schema_version,price_option_reference,
    area_price_reference,invoice_delivery_method,
    selected_component_references
  ) values(
    p_company_id,v_contract.id,p_customer_id,
    'internal_customer_contract_selection',v_offer.price_plan_version_id,
    coalesce(v_pricing_model,'spot'),
    p_selection->'base_price_components_snapshot',
    p_selection->'price_components_snapshot',p_selection,
    coalesce(nullif(p_contract->>'starts_at','')::date,current_date),
    nullif(p_contract->>'ends_at','')::date,
    'gridex_contract_pricing_v6_selection',v_option.option_reference,
    v_area.price_row_reference,p_selection->>'invoice_delivery_method',
    v_selected_refs
  )
  returning id into v_snapshot_id;

  update public.customer_contracts
  set contract_price_snapshot_id=v_snapshot_id,updated_at=now()
  where id=v_contract.id and company_id=p_company_id
  returning * into v_contract;

  return jsonb_build_object(
    'ok',true,'contract',to_jsonb(v_contract),
    'contract_price_snapshot_id',v_snapshot_id,
    'price_option_reference',v_option.option_reference,
    'area_price_reference',v_area.price_row_reference,
    'selected_component_references',to_jsonb(v_selected_refs)
  );
end
$$;

revoke all on function public.gridex_create_internal_customer_contract_v1(
  uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,uuid
) from public,anon,authenticated;
grant execute on function public.gridex_create_internal_customer_contract_v1(
  uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,uuid
) to service_role;

-- Published v6 products fail closed when the persistent option/component graph
-- is incomplete. Legacy products remain readable and billable from their
-- historical snapshots.
create or replace function public.gridex_validate_commercial_model_v1(
  p_company_id uuid,
  p_contract_product_version_id uuid
) returns jsonb
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  with version_row as (
    select version.id,version.contract_type,version.price_plan_version_id,
      version.commercial_snapshot
    from public.contract_product_versions version
    join public.contract_products product
      on product.id=version.contract_product_id
    where version.id=p_contract_product_version_id
      and product.company_id=p_company_id
  ), blockers as (
    select jsonb_build_object(
      'code','commercial_price_option_missing',
      'field','price_options',
      'message','Avtalsversionen saknar ett persistent prisalternativ.'
    ) blocker
    from version_row
    where commercial_snapshot->>'snapshot_schema'
        ='gridex_contract_pricing_v6_selection'
      and not exists(
        select 1 from public.contract_price_options option_row
        where option_row.company_id=p_company_id
          and option_row.contract_product_version_id=version_row.id
          and option_row.status='active'
      )
    union all
    select jsonb_build_object(
      'code','fixed_area_price_incomplete',
      'field','price_options',
      'message','Ett aktivt fastprisalternativ saknar en SE-områdesrad.'
    )
    from version_row
    where contract_type='fixed'
      and commercial_snapshot->>'snapshot_schema'
        ='gridex_contract_pricing_v6_selection'
      and exists(
        select 1
        from public.contract_price_options option_row
        where option_row.contract_product_version_id=version_row.id
          and option_row.status='active'
          and not exists(
            select 1
            from public.contract_price_option_area_prices area_row
            where area_row.contract_price_option_id=option_row.id
          )
      )
    union all
    select jsonb_build_object(
      'code','commercial_component_incomplete',
      'field','commercial_components',
      'message','En kommersiell komponent saknar stabil identitet eller fakturarad.'
    )
    from version_row
    where commercial_snapshot->>'snapshot_schema'
        ='gridex_contract_pricing_v6_selection'
      and exists(
        select 1 from public.price_components component
        where component.price_plan_version_id=version_row.price_plan_version_id
          and component.component_reference is not null
          and (
            component.component_code is null
            or component.selection_policy is null
            or nullif(component.invoice_line_name,'') is null
            or (
              component.unit='percent'
              and nullif(component.calculation_base,'') is null
            )
          )
      )
  )
  select jsonb_build_object(
    'ready',count(*)=0,
    'blockers',coalesce(jsonb_agg(blocker),'[]'::jsonb)
  )
  from blockers
$$;

create or replace function public.gridex_enforce_commercial_publication()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_readiness jsonb;
begin
  if new.lifecycle_status in ('published','paused')
    and (
      tg_op='INSERT'
      or old.lifecycle_status is distinct from new.lifecycle_status
    ) then
    v_readiness:=public.gridex_validate_commercial_model_v1(
      new.company_id,new.contract_product_version_id
    );
    if not coalesce((v_readiness->>'ready')::boolean,false) then
      raise exception using
        errcode='23514',
        message='commercial_model_not_ready',
        detail=v_readiness::text;
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists contract_offers_commercial_publication_guard
  on public.contract_offers;
create trigger contract_offers_commercial_publication_guard
before insert or update of lifecycle_status on public.contract_offers
for each row execute function public.gridex_enforce_commercial_publication();

-- Deterministic legacy backfill. Only values that can be proven from the
-- canonical fixed base rows are promoted; ambiguous rows enter the review
-- queue and historical snapshots are never mutated.
insert into public.contract_price_options(
  company_id,contract_product_version_id,price_plan_version_id,
  option_reference,option_code,customer_name,contract_type,binding_months,
  notice_months,auto_renew_enabled,renewal_term_months,status,sort_order,
  version_number,metadata
)
select
  product.company_id,version.id,version.price_plan_version_id,
  'legacy_option_'||replace(version.id::text,'-',''),
  'legacy_option_'||replace(version.id::text,'-',''),
  coalesce(product.name,'Migrerat prisalternativ'),
  version.contract_type,coalesce(version.binding_months,0),
  coalesce(version.notice_months,0),coalesce(version.automatic_renewal,false),
  case when coalesce(version.automatic_renewal,false) then 12 else null end,
  case when version.status in ('published','active','approved')
    then 'active' else 'draft' end,
  0,1,jsonb_build_object('migration','deterministic_fixed_base_v1')
from public.contract_product_versions version
join public.contract_products product
  on product.id=version.contract_product_id
where version.contract_type='fixed'
  and version.price_plan_version_id is not null
  and exists(
    select 1 from public.base_price_components base
    where base.price_plan_version_id=version.price_plan_version_id
      and base.source_type='fixed'
      and base.price_area is not null
      and base.fixed_price_sek_per_kwh is not null
  )
  and not exists(
    select 1 from public.contract_price_options option_row
    where option_row.contract_product_version_id=version.id
  )
on conflict do nothing;

insert into public.contract_price_option_area_prices(
  company_id,contract_price_option_id,price_plan_version_id,
  price_row_reference,price_area,amount,unit,vat_treatment,metadata
)
select
  option_row.company_id,option_row.id,option_row.price_plan_version_id,
  'legacy_area_'||lower(base.price_area)||'_'||
    replace(option_row.id::text,'-',''),
  base.price_area,base.fixed_price_sek_per_kwh*100,
  'ore_per_kwh','standard',
  jsonb_build_object('source_base_price_component_id',base.id)
from public.contract_price_options option_row
join public.base_price_components base
  on base.price_plan_version_id=option_row.price_plan_version_id
 and base.source_type='fixed'
 and base.price_area is not null
 and base.fixed_price_sek_per_kwh is not null
where option_row.metadata->>'migration'='deterministic_fixed_base_v1'
on conflict do nothing;

insert into public.contract_pricing_migration_reviews(
  company_id,price_plan_version_id,source_table,source_id,reason_code,details
)
select
  product.company_id,version.price_plan_version_id,
  'contract_product_versions',version.id,
  'fixed_price_area_not_deterministic',
  jsonb_build_object('contract_product_version_id',version.id)
from public.contract_product_versions version
join public.contract_products product
  on product.id=version.contract_product_id
where version.contract_type='fixed'
  and version.price_plan_version_id is not null
  and not exists(
    select 1 from public.contract_price_options option_row
    where option_row.contract_product_version_id=version.id
  )
on conflict do nothing;

comment on table public.contract_price_options is
  'Stable binding/notice price options belonging to one immutable canonical product and price-plan version.';
comment on table public.contract_price_option_area_prices is
  'Stable SE1-SE4 price rows selected and frozen by quotes and signed contracts.';
comment on column public.website_contract_quotes.resolved_price_components is
  'Exact eligible and selected components covered by the immutable v3 quote hash.';
