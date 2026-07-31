-- GRIDEX public contract publication graph repair.
-- Forward-only. The historical 20260730220000 migration is intentionally not
-- modified; its applied bytes must be recovered from the trusted release
-- artifact before production migration integrity can be declared green.

begin;
set local lock_timeout='15s';
set local statement_timeout='10min';
select pg_advisory_xact_lock(
  hashtextextended('gridex:public-contract-publication-graph:20260731152000',0)
);

-- Fail explicitly on a schema that predates the canonical graph.
do $$
begin
  if to_regclass('public.contract_publication_versions') is null
     or to_regclass('public.contract_price_options') is null
     or to_regclass('public.contract_price_option_area_prices') is null then
    raise exception using
      errcode='55000',
      message='PUBLIC_CONTRACT_SCHEMA_OUTDATED';
  end if;
  if to_regprocedure('extensions.digest(text,text)') is null then
    raise exception using
      errcode='55000',
      message='PUBLIC_CONTRACT_SCHEMA_OUTDATED',
      detail='pgcrypto digest(text,text) is required in extensions';
  end if;
end $$;

-- Complete the canonical columns defensively. The checksum-mismatched
-- historical migration may have been applied fully, partially or not at all.
alter table public.contract_price_options
  add column if not exists contract_publication_version_id uuid,
  add column if not exists customer_type text,
  add column if not exists is_default boolean,
  add column if not exists selection_required boolean;

alter table public.contract_price_option_area_prices
  add column if not exists status text not null default 'active';

-- Zero is a valid explicit commercial amount. Negative area prices are not.
-- The original table-level check used amount > 0 and contradicted runtime
-- validation, which already treats a numeric zero as present.
alter table public.contract_price_option_area_prices
  drop constraint if exists contract_price_option_area_prices_amount_check;
alter table public.contract_price_option_area_prices
  add constraint contract_price_option_area_prices_amount_check
  check(amount>=0) not valid;
do $$
begin
  if not exists(
    select 1 from public.contract_price_option_area_prices where amount<0
  ) then
    alter table public.contract_price_option_area_prices validate constraint
      contract_price_option_area_prices_amount_check;
  end if;
end $$;

-- Add missing constraints without rewriting valid rows. Validation remains
-- fail-closed if pre-existing data violates a canonical invariant.
do $$
begin
  if not exists(
    select 1 from pg_constraint
    where conrelid='public.contract_price_options'::regclass
      and conname='contract_price_options_contract_publication_version_id_fkey'
  ) then
    alter table public.contract_price_options
      add constraint contract_price_options_contract_publication_version_id_fkey
      foreign key(contract_publication_version_id)
      references public.contract_publication_versions(id)
      on delete restrict not valid;
  end if;
  if not exists(
    select 1
    from public.contract_price_options option_row
    left join public.contract_publication_versions publication_version
      on publication_version.id=option_row.contract_publication_version_id
    where option_row.contract_publication_version_id is not null
      and publication_version.id is null
  ) then
    alter table public.contract_price_options validate constraint
      contract_price_options_contract_publication_version_id_fkey;
  end if;
end $$;

alter table public.contract_price_options
  drop constraint if exists contract_price_options_customer_type_check;
alter table public.contract_price_options
  add constraint contract_price_options_customer_type_check
  check(customer_type is null or customer_type in ('private','business','both'))
  not valid;
do $$
begin
  if not exists(
    select 1 from public.contract_price_options
    where customer_type is not null
      and customer_type not in ('private','business','both')
  ) then
    alter table public.contract_price_options validate constraint
      contract_price_options_customer_type_check;
  end if;
end $$;

alter table public.contract_price_option_area_prices
  drop constraint if exists contract_price_option_area_prices_status_check;
alter table public.contract_price_option_area_prices
  add constraint contract_price_option_area_prices_status_check
  check(status in ('active','paused','archived')) not valid;
do $$
begin
  if not exists(
    select 1 from public.contract_price_option_area_prices
    where status not in ('active','paused','archived')
  ) then
    alter table public.contract_price_option_area_prices validate constraint
      contract_price_option_area_prices_status_check;
  end if;
end $$;

alter table public.contract_price_options
  drop constraint if exists
    contract_price_options_price_plan_version_id_option_reference_key,
  drop constraint if exists
    contract_price_options_price_plan_version_id_option_code_key;

create index if not exists contract_price_options_publication_lookup_idx
  on public.contract_price_options(
    company_id,contract_publication_version_id,status,sort_order
  );

-- Existing duplicate legacy rows must stay observable for the preview report.
-- Create each unique index only when its current data is already unambiguous.
do $$
begin
  if to_regclass('public.contract_price_options_template_reference_uidx') is null
     and not exists(
       select 1 from public.contract_price_options
       where contract_publication_version_id is null
       group by contract_product_version_id,price_plan_version_id,option_reference
       having count(*)>1
     ) then
    create unique index contract_price_options_template_reference_uidx
      on public.contract_price_options(
        contract_product_version_id,price_plan_version_id,option_reference
      ) where contract_publication_version_id is null;
  end if;
  if to_regclass('public.contract_price_options_template_code_uidx') is null
     and not exists(
       select 1 from public.contract_price_options
       where contract_publication_version_id is null
       group by contract_product_version_id,price_plan_version_id,option_code
       having count(*)>1
     ) then
    create unique index contract_price_options_template_code_uidx
      on public.contract_price_options(
        contract_product_version_id,price_plan_version_id,option_code
      ) where contract_publication_version_id is null;
  end if;
  if to_regclass('public.contract_price_options_publication_reference_uidx') is null
     and not exists(
       select 1 from public.contract_price_options
       where contract_publication_version_id is not null
       group by contract_publication_version_id,option_reference
       having count(*)>1
     ) then
    create unique index contract_price_options_publication_reference_uidx
      on public.contract_price_options(
        contract_publication_version_id,option_reference
      ) where contract_publication_version_id is not null;
  end if;
  if to_regclass('public.contract_price_options_publication_code_uidx') is null
     and not exists(
       select 1 from public.contract_price_options
       where contract_publication_version_id is not null
       group by contract_publication_version_id,option_code
       having count(*)>1
     ) then
    create unique index contract_price_options_publication_code_uidx
      on public.contract_price_options(
        contract_publication_version_id,option_code
      ) where contract_publication_version_id is not null;
  end if;
  if to_regclass('public.contract_price_options_publication_default_uidx') is null
     and not exists(
       select 1 from public.contract_price_options
       where contract_publication_version_id is not null
         and status='active' and is_default is true
       group by contract_publication_version_id
       having count(*)>1
     ) then
    create unique index contract_price_options_publication_default_uidx
      on public.contract_price_options(contract_publication_version_id)
      where contract_publication_version_id is not null
        and status='active' and is_default is true;
  end if;
end $$;

-- Preserve the commercial lock while allowing only relation-policy metadata
-- to be completed. Published amounts and terms are never updateable.
create or replace function public.gridex_lock_commercial_child()
returns trigger
language plpgsql
set search_path=public,pg_catalog,pg_temp
as $$
declare
  v_price_plan_version_id uuid:=old.price_plan_version_id;
  v_old_projection jsonb;
  v_new_projection jsonb;
  v_repair boolean:=coalesce(
    current_setting('gridex.publication_graph_repair',true),'')='on';
begin
  if not exists(
    select 1 from public.price_plan_versions version_row
    where version_row.id=v_price_plan_version_id
      and version_row.locked_at is not null
  ) then
    return case when tg_op='DELETE' then old else new end;
  end if;

  if tg_op='DELETE' or tg_table_name<>'contract_price_options' then
    raise exception using errcode='55000',
      message='locked_commercial_pricing_is_immutable';
  end if;

  v_old_projection:=to_jsonb(old)-array[
    'contract_publication_version_id','customer_type',
    'is_default','selection_required'
  ]::text[];
  v_new_projection:=to_jsonb(new)-array[
    'contract_publication_version_id','customer_type',
    'is_default','selection_required'
  ]::text[];

  if v_old_projection is distinct from v_new_projection then
    raise exception using errcode='55000',
      message='locked_commercial_pricing_is_immutable';
  end if;
  if not (
    old.contract_publication_version_id is not distinct from
      new.contract_publication_version_id
    or (
      v_repair
      and old.contract_publication_version_id is null
      and new.contract_publication_version_id is not null
      and (
        current_user in ('postgres','supabase_admin','service_role')
        or pg_has_role(current_user,'service_role','member')
      )
    )
  ) then
    raise exception using errcode='55000',
      message='locked_commercial_pricing_is_immutable';
  end if;
  if not (
    old.customer_type is not distinct from new.customer_type
    or (old.customer_type is null and new.customer_type is not null)
  ) or not (
    old.is_default is not distinct from new.is_default
    or (old.is_default is null and new.is_default is not null)
  ) or not (
    old.selection_required is not distinct from new.selection_required
    or (old.selection_required is null and new.selection_required is not null)
  ) then
    raise exception using errcode='55000',
      message='locked_commercial_pricing_is_immutable';
  end if;
  return new;
end $$;

create or replace function public.gridex_assert_price_option_snapshot_unique_v1()
returns trigger
language plpgsql
set search_path=public,pg_catalog,pg_temp
as $$
begin
  if new.contract_publication_version_id is null then
    if exists(
      select 1 from public.contract_price_options existing
      where existing.id is distinct from new.id
        and existing.contract_publication_version_id is null
        and existing.contract_product_version_id=new.contract_product_version_id
        and existing.price_plan_version_id=new.price_plan_version_id
        and (existing.option_reference=new.option_reference
          or existing.option_code=new.option_code)
    ) then
      raise exception using errcode='23505',
        message='PUBLICATION_PRICE_OPTION_TEMPLATE_DUPLICATE';
    end if;
  elsif exists(
    select 1 from public.contract_price_options existing
    where existing.id is distinct from new.id
      and existing.contract_publication_version_id=
        new.contract_publication_version_id
      and (existing.option_reference=new.option_reference
        or existing.option_code=new.option_code
        or (existing.status='active' and new.status='active'
          and existing.is_default is true and new.is_default is true))
  ) then
    raise exception using errcode='23505',
      message='PUBLICATION_PRICE_OPTION_DUPLICATE';
  end if;
  return new;
end $$;

drop trigger if exists contract_price_options_canonical_uniqueness
  on public.contract_price_options;
create trigger contract_price_options_canonical_uniqueness
before insert or update on public.contract_price_options
for each row execute function
  public.gridex_assert_price_option_snapshot_unique_v1();

-- Drop repair-owned dependants in dependency order so the migration can be
-- rehearsed repeatedly in disposable staging databases.
drop function if exists public.gridex_apply_public_contract_backfill_v1(
  uuid,uuid,uuid,text,uuid
);
drop function if exists public.gridex_preview_public_contract_backfill_v1(
  uuid,uuid,uuid,text
);
drop view if exists public.canonical_visible_public_contracts_v;
drop view if exists public.canonical_public_contract_diagnostics_v;

-- Remove the unsafe trigger that attempted to insert publication children from
-- a BEFORE INSERT trigger before the parent publication version existed.
drop trigger if exists contract_publication_price_options_ready
  on public.contract_publication_versions;
drop function if exists public.gridex_prepare_price_options_for_publication_v1();

-- Area-price references are stable business references scoped by a price
-- option. They must be reusable in immutable snapshots for separate channels
-- and publication versions.
alter table public.contract_price_option_area_prices
  drop constraint if exists
    contract_price_option_area_prices_price_plan_version_id_price_row_reference_key;
do $$
begin
  if to_regclass(
    'public.contract_price_option_area_option_reference_uidx'
  ) is null and not exists(
    select 1 from public.contract_price_option_area_prices
    group by contract_price_option_id,price_row_reference
    having count(*)>1
  ) then
    create unique index contract_price_option_area_option_reference_uidx
      on public.contract_price_option_area_prices(
        contract_price_option_id,price_row_reference
      );
  end if;
end $$;

create or replace function public.gridex_assert_area_price_snapshot_unique_v1()
returns trigger
language plpgsql
set search_path=public,pg_catalog,pg_temp
as $$
begin
  if exists(
    select 1 from public.contract_price_option_area_prices existing
    where existing.id is distinct from new.id
      and existing.contract_price_option_id=new.contract_price_option_id
      and existing.price_row_reference=new.price_row_reference
  ) then
    raise exception using errcode='23505',
      message='PUBLICATION_AREA_PRICE_REFERENCE_DUPLICATE';
  end if;
  return new;
end $$;

drop trigger if exists contract_price_option_area_canonical_uniqueness
  on public.contract_price_option_area_prices;
create trigger contract_price_option_area_canonical_uniqueness
before insert or update on public.contract_price_option_area_prices
for each row execute function
  public.gridex_assert_area_price_snapshot_unique_v1();

create or replace function public.gridex_supported_price_areas_v1(
  p_contract_product_version_id uuid
) returns text[]
language sql
stable
set search_path=public,pg_catalog,pg_temp
as $$
  select case
    when cardinality(coalesce(v.price_areas,'{}'::text[]))>0 then (
      select coalesce(array_agg(distinct upper(btrim(area))
        order by upper(btrim(area))),'{}'::text[])
      from unnest(v.price_areas) area
      where upper(btrim(area)) in ('SE1','SE2','SE3','SE4')
    )
    when v.contract_type='fixed' then array['SE1','SE2','SE3','SE4']::text[]
    else '{}'::text[]
  end
  from public.contract_product_versions v
  where v.id=p_contract_product_version_id
$$;

create or replace function public.gridex_invoice_fee_ready_v1(
  p_row_amount numeric,
  p_snapshot jsonb
) returns boolean
language sql
stable
set search_path=public,pg_catalog,pg_temp
as $$
  with components as (
    select component.value
    from jsonb_array_elements(
      case
        when jsonb_typeof(p_snapshot->'price_components')='array'
          then p_snapshot->'price_components'
        when jsonb_typeof(p_snapshot->'price_components_snapshot')='array'
          then p_snapshot->'price_components_snapshot'
        else '[]'::jsonb
      end
    ) component(value)
    where coalesce(nullif(component.value->>'component_code',''),
      nullif(component.value->>'component_type',''),
      nullif(component.value->'metadata'->>'component_code',''))='invoice_fee'
      and coalesce(nullif(component.value->>'status',''),'active')='active'
  ), canonical as (
    select (value->>'amount')::numeric amount
    from components
    where value->>'unit'='sek_invoice'
      and value->>'calculation_type'='per_invoice'
      and coalesce(value->>'amount','') ~ '^-?[0-9]+([.][0-9]+)?$'
      and (value->>'amount')::numeric>=0
  )
  select p_row_amount is not null
    and (select count(*) from components)=1
    and (select count(*) from canonical)=1
    and abs(p_row_amount-(select amount from canonical))<=0.000000001
$$;

create or replace function public.gridex_publication_price_options_json_v1(
  p_publication_version_id uuid
) returns jsonb
language sql
stable
set search_path=public,pg_catalog,pg_temp
as $$
  select coalesce(jsonb_agg(
    jsonb_strip_nulls(jsonb_build_object(
      'price_option_reference',o.option_reference,
      'option_code',o.option_code,
      'customer_name',o.customer_name,
      'price_type',o.contract_type,
      'contract_type',o.contract_type,
      'customer_type',o.customer_type,
      'resolution',coalesce(nullif(o.metadata->>'resolution',''),
        case o.contract_type
          when 'variable_hourly' then 'hourly'
          when 'variable_quarterly' then 'quarterly'
          else 'monthly'
        end),
      'is_default',o.is_default,
      'default',o.is_default,
      'selection_required',o.selection_required,
      'currency',coalesce(nullif(o.metadata->>'currency',''),'SEK'),
      'unit',coalesce(nullif(o.metadata->>'unit',''),'ore_per_kwh'),
      'fixed_price',case when coalesce(o.metadata->>'fixed_price','')
        ~ '^-?[0-9]+([.][0-9]+)?$'
        then (o.metadata->>'fixed_price')::numeric else null end,
      'markup',case when coalesce(o.metadata->>'markup','')
        ~ '^-?[0-9]+([.][0-9]+)?$'
        then (o.metadata->>'markup')::numeric else null end,
      'monthly_fee',case when coalesce(o.metadata->>'monthly_fee','')
        ~ '^-?[0-9]+([.][0-9]+)?$'
        then (o.metadata->>'monthly_fee')::numeric else null end,
      'binding_months',o.binding_months,
      'notice_months',o.notice_months,
      'auto_renew_enabled',o.auto_renew_enabled,
      'renewal_term_months',o.renewal_term_months,
      'valid_from',o.valid_from,
      'valid_to',o.valid_to,
      'earliest_start_date',o.earliest_start_date,
      'latest_start_date',o.latest_start_date,
      'area_prices',coalesce((
        select jsonb_agg(jsonb_build_object(
          'area_price_reference',a.price_row_reference,
          'price_area',a.price_area,
          'energy_price_ore_per_kwh',case when a.unit='sek_per_kwh'
            then a.amount*100 else a.amount end,
          'unit','ore_per_kwh',
          'valid_from',a.valid_from,
          'valid_to',a.valid_to
        ) order by a.price_area)
        from public.contract_price_option_area_prices a
        where a.contract_price_option_id=o.id and a.status='active'
      ),'[]'::jsonb)
    )) order by o.sort_order,o.option_reference
  ),'[]'::jsonb)
  from public.contract_price_options o
  where o.contract_publication_version_id=p_publication_version_id
    and o.status='active'
$$;

-- Locked publication versions remain immutable. A narrowly scoped repair
-- mode may only replace derived relation snapshots and their checksum; the
-- commercial snapshot itself and all child prices must remain unchanged.
create or replace function public.gridex_reject_locked_row_mutation()
returns trigger
language plpgsql
set search_path=public,extensions,pg_catalog,pg_temp
as $$
declare
  v_transition boolean:=coalesce(
    current_setting('gridex.version_transition',true),'')='on';
  v_publication_repair boolean:=coalesce(
    current_setting('gridex.publication_graph_repair',true),'')='on';
  v_old jsonb;
  v_new jsonb;
  v_allowed text[];
  v_expected_price_options jsonb;
begin
  if nullif(to_jsonb(old)->>'locked_at','') is null
     and nullif(to_jsonb(old)->>'published_at','') is null then
    return case when tg_op='DELETE' then old else new end;
  end if;
  if not v_transition then
    raise exception using errcode='55000',message='immutable_version_locked';
  end if;
  if tg_op='DELETE' then return old; end if;

  v_allowed:=case tg_table_name
    when 'contract_product_versions'
      then array['status','approved_at','approved_by','locked_at']
    when 'legal_template_versions'
      then array['status','reviewed_by','reviewed_at','published_at','locked_at']
    when 'legal_bundle_versions'
      then array['status','published_at','locked_at']
    when 'contract_publication_versions'
      then array['status','valid_from','valid_to','published_at','locked_at',
        'legacy_public_contract_offer_id']
    when 'tenant_legal_overrides'
      then array['status','submitted_at','reviewed_at','reviewed_by',
        'review_notes','locked_at']
    else array[]::text[]
  end;

  if tg_table_name='contract_publication_versions'
     and v_publication_repair then
    if current_user not in ('postgres','supabase_admin','service_role')
       and not pg_has_role(current_user,'service_role','member') then
      raise exception using errcode='42501',
        message='PUBLICATION_REPAIR_ROLE_REQUIRED';
    end if;
    if old.publication_snapshot->'commercial_snapshot'
       is distinct from new.publication_snapshot->'commercial_snapshot' then
      raise exception using errcode='55000',
        message='locked_publication_commercial_snapshot_is_immutable';
    end if;
    v_expected_price_options:=
      public.gridex_publication_price_options_json_v1(new.id);
    if coalesce(new.publication_snapshot->'price_options','[]'::jsonb)
       is distinct from v_expected_price_options then
      raise exception using errcode='23514',
        message='PUBLICATION_PRICE_OPTION_SNAPSHOT_MISMATCH';
    end if;
    if new.content_sha256 is distinct from encode(
      extensions.digest(new.publication_snapshot::text,'sha256'),'hex') then
      raise exception using errcode='23514',
        message='PUBLICATION_SNAPSHOT_INVALID';
    end if;
    v_allowed:=v_allowed||array['publication_snapshot','content_sha256'];
  end if;

  v_old:=to_jsonb(old)-v_allowed;
  v_new:=to_jsonb(new)-v_allowed;
  if v_old is distinct from v_new then
    raise exception using errcode='55000',
      message='immutable_version_content_changed';
  end if;
  return new;
end $$;

create or replace function public.gridex_validate_publication_graph_v1(
  p_publication_version_id uuid
) returns text[]
language sql
stable
set search_path=public,pg_catalog,pg_temp
as $$
with publication as (
  select pv.*,p.status publication_status,p.channel publication_channel,
    a.company_id,a.status assignment_status,a.website_publication_allowed,
    a.api_publication_allowed,c.status channel_status,
    public.gridex_supported_price_areas_v1(
      pv.contract_product_version_id
    ) supported_areas,
    (
      cardinality(coalesce(product_version.price_areas,'{}'::text[]))=0
      or (
        not exists(
          select 1
          from unnest(coalesce(product_version.price_areas,'{}'::text[])) area
          where upper(btrim(area)) not in ('SE1','SE2','SE3','SE4')
        )
        and cardinality(coalesce(product_version.price_areas,'{}'::text[]))=(
          select count(distinct upper(btrim(area)))
          from unnest(coalesce(product_version.price_areas,'{}'::text[])) area
        )
      )
    ) supported_areas_valid,
    product_version.contract_type,
    public.gridex_invoice_fee_ready_v1(
      case when coalesce(
        pv.publication_snapshot->'commercial_snapshot'->>'invoice_fee_sek','')
        ~ '^-?[0-9]+([.][0-9]+)?$'
        then (pv.publication_snapshot->'commercial_snapshot'->>'invoice_fee_sek')::numeric
        else null end,
      coalesce(pv.publication_snapshot->'commercial_snapshot','{}'::jsonb)
    ) invoice_fee_ready,
    exists(
      select 1 from public.contract_offers source_offer
      where source_offer.company_id=a.company_id
        and source_offer.id::text=
          pv.publication_snapshot->>'source_contract_offer_id'
        and source_offer.contract_product_version_id=
          pv.contract_product_version_id
        and source_offer.price_plan_version_id=pv.price_plan_version_id
    ) source_offer_consistent
  from public.contract_publication_versions pv
  join public.contract_publications p on p.id=pv.contract_publication_id
  join public.tenant_contract_assignments a on a.id=p.assignment_id
  left join public.tenant_contract_channels c
    on c.assignment_id=a.id and c.channel=p.channel
  join public.contract_product_versions product_version
    on product_version.id=pv.contract_product_version_id
  where pv.id=p_publication_version_id
), option_stats as (
  select count(*) filter(where o.status='active') option_count,
    count(*) filter(where o.status='active' and o.is_default) default_count,
    count(*) filter(where o.status='active' and o.selection_required) required_count,
    count(*) filter(where o.status='active' and o.selection_required is null)
      missing_selection_policy_count,
    count(*) filter(where o.status='active' and (
      nullif(btrim(o.option_reference),'') is null
      or nullif(btrim(o.option_code),'') is null
    )) missing_identifier_count,
    count(*) filter(where o.status='active' and (
      o.customer_type is null or not exists(
        select 1 from publication p
        where o.customer_type='both' or p.customer_type='both'
          or o.customer_type=p.customer_type
      )
    )) invalid_customer_type_count,
    count(*) filter(where o.status='active' and not exists(
      select 1 from publication p where o.contract_type=p.contract_type
    )) invalid_contract_type_count
  from public.contract_price_options o
  where o.contract_publication_version_id=p_publication_version_id
), duplicate_options as (
  select count(*) duplicate_count
  from (
    select o.option_reference stable_value
    from public.contract_price_options o
    where o.contract_publication_version_id=p_publication_version_id
      and o.status='active'
    group by o.option_reference having count(*)>1
    union all
    select o.option_code stable_value
    from public.contract_price_options o
    where o.contract_publication_version_id=p_publication_version_id
      and o.status='active'
    group by o.option_code having count(*)>1
  ) duplicated
), missing_areas as (
  select count(*) missing_count
  from publication p
  join public.contract_price_options o
    on o.contract_publication_version_id=p.id and o.status='active'
  cross join unnest(p.supported_areas) required_area
  where p.contract_type='fixed'
    and not exists(
      select 1 from public.contract_price_option_area_prices a
      where a.contract_price_option_id=o.id
        and a.price_area=required_area
        and a.status='active'
        and a.amount is not null and a.amount>=0
        and a.unit in ('ore_per_kwh','sek_per_kwh')
    )
), legal as (
  select exists(
    select 1
    from publication p
    join public.legal_bundle_versions b
      on b.id=p.legal_bundle_version_id and b.company_id=p.company_id
    where b.status in ('published','replaced','archived')
      and b.locked_at is not null
      and cardinality(coalesce(b.unresolved_variables,'{}'::text[]))=0
      and exists(
        select 1 from public.legal_bundle_version_documents d
        where d.legal_bundle_version_id=b.id
      )
  ) ready
)
select array_remove(array[
  case when not exists(select 1 from publication)
    then 'PUBLICATION_VERSION_NOT_FOUND' end,
  case when not coalesce((select source_offer_consistent from publication),false)
    then 'PUBLICATION_SOURCE_OFFER_MISMATCH' end,
  case when (select option_count from option_stats)=0
    then 'PUBLICATION_PRICE_OPTIONS_MISSING' end,
  case when (select missing_identifier_count from option_stats)>0
    then 'PUBLICATION_PRICE_OPTION_IDENTIFIER_MISSING' end,
  case when (select duplicate_count from duplicate_options)>0
    then 'PUBLICATION_PRICE_OPTION_DUPLICATE' end,
  case when (select default_count from option_stats)<>1
    then 'PUBLICATION_PRICE_OPTION_DEFAULT_INVALID' end,
  case when (select missing_selection_policy_count from option_stats)>0
    then 'PUBLICATION_PRICE_OPTION_SELECTION_POLICY_MISSING' end,
  case when (select option_count from option_stats)=1
      and (select required_count from option_stats)<>0
    then 'PUBLICATION_PRICE_OPTION_SELECTION_POLICY_INVALID' end,
  case when (select option_count from option_stats)>1
      and (select required_count from option_stats)<>(select option_count from option_stats)
    then 'PUBLICATION_PRICE_OPTION_SELECTION_POLICY_INVALID' end,
  case when (select invalid_customer_type_count from option_stats)>0
    then 'PUBLICATION_PRICE_OPTION_CUSTOMER_TYPE_INVALID' end,
  case when (select invalid_contract_type_count from option_stats)>0
    then 'PUBLICATION_PRICE_OPTION_CONTRACT_TYPE_INVALID' end,
  case when not coalesce((select supported_areas_valid from publication),false)
    then 'PUBLICATION_SUPPORTED_PRICE_AREA_INVALID' end,
  case when (select missing_count from missing_areas)>0
    then 'PUBLICATION_AREA_PRICES_MISSING' end,
  case when not (select ready from legal)
    then 'PUBLICATION_LEGAL_BUNDLE_MISSING' end,
  case when not coalesce((select invoice_fee_ready from publication),false)
    then 'INVOICE_FEE_CONFIGURATION_MISSING' end,
  case when coalesce((select assignment_status from publication),'missing')<>'active'
    then 'PUBLICATION_TENANT_NOT_READY' end,
  case when coalesce((select channel_status from publication),'missing')<>'active'
    then 'PUBLICATION_CHANNEL_NOT_ACTIVE' end,
  case when (select publication_channel from publication)='website'
      and not coalesce((select website_publication_allowed from publication),false)
    then 'PUBLICATION_WEBSITE_PERMISSION_MISSING' end,
  case when (select publication_channel from publication)='api'
      and not coalesce((select api_publication_allowed from publication),false)
    then 'PUBLICATION_API_PERMISSION_MISSING' end
]::text[],null)
$$;

create or replace function public.gridex_materialize_publication_price_options_v1(
  p_publication_version_id uuid,
  p_actor_user_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_catalog,pg_temp
as $$
declare
  v public.contract_publication_versions%rowtype;
  v_company_id uuid;
  v_source_publication_version_id uuid;
  v_source_kind text;
  v_prior_candidate_count integer:=0;
  v_prior_graph_count integer:=0;
  v_source_option_count integer:=0;
  v_source_default_count integer:=0;
  v_inserted integer:=0;
begin
  select pv.* into v
  from public.contract_publication_versions pv
  where pv.id=p_publication_version_id
  for update;
  select a.company_id into v_company_id
  from public.contract_publications p
  join public.tenant_contract_assignments a on a.id=p.assignment_id
  where p.id=v.contract_publication_id;
  if not found then
    raise exception using errcode='P0002',
      message='PUBLICATION_VERSION_NOT_FOUND';
  end if;

  if exists(
    select 1 from public.contract_price_options
    where contract_publication_version_id=v.id
  ) then
    v_source_kind:='existing_snapshot';
  elsif exists(
    select 1 from public.contract_price_options
    where company_id=v_company_id
      and contract_product_version_id=v.contract_product_version_id
      and price_plan_version_id=v.price_plan_version_id
      and contract_publication_version_id is null
  ) then
    v_source_kind:='template';
  else
    with candidate_versions as (
      select distinct source.contract_publication_version_id id
      from public.contract_price_options source
      join public.contract_publication_versions source_version
        on source_version.id=source.contract_publication_version_id
      join public.contract_publications source_publication
        on source_publication.id=source_version.contract_publication_id
      join public.tenant_contract_assignments source_assignment
        on source_assignment.id=source_publication.assignment_id
      where source_assignment.company_id=v_company_id
        and source.contract_product_version_id=v.contract_product_version_id
        and source.price_plan_version_id=v.price_plan_version_id
        and source.contract_publication_version_id<>v.id
        and source.status='active'
    )
    select count(*),count(distinct
      public.gridex_publication_price_options_json_v1(candidate.id)::text)
      into v_prior_candidate_count,v_prior_graph_count
    from candidate_versions candidate;

    if v_prior_candidate_count=0 then
      raise exception using errcode='23514',
        message='PUBLICATION_PRICE_OPTIONS_MISSING';
    elsif v_prior_graph_count<>1 then
      raise exception using errcode='23514',
        message='PUBLICATION_PRICE_SOURCE_AMBIGUOUS';
    end if;

    select source.contract_publication_version_id
      into v_source_publication_version_id
    from public.contract_price_options source
    join public.contract_publication_versions source_version
      on source_version.id=source.contract_publication_version_id
    join public.contract_publications source_publication
      on source_publication.id=source_version.contract_publication_id
    join public.tenant_contract_assignments source_assignment
      on source_assignment.id=source_publication.assignment_id
    where source_assignment.company_id=v_company_id
      and source.contract_product_version_id=v.contract_product_version_id
      and source.price_plan_version_id=v.price_plan_version_id
      and source.contract_publication_version_id<>v.id
      and source.status='active'
    group by source.contract_publication_version_id,
      source_version.version_number,source_version.created_at
    order by source_version.version_number desc,source_version.created_at desc
    limit 1;
    v_source_kind:='prior_snapshot';
  end if;

  if v_source_kind<>'existing_snapshot' then
    select count(*),count(*) filter(where source.is_default is true)
      into v_source_option_count,v_source_default_count
    from public.contract_price_options source
    where source.company_id=v_company_id
      and source.contract_product_version_id=v.contract_product_version_id
      and source.price_plan_version_id=v.price_plan_version_id
      and (
        (v_source_kind='template'
          and source.contract_publication_version_id is null)
        or (v_source_kind='prior_snapshot'
          and source.contract_publication_version_id=
            v_source_publication_version_id)
      );
    if v_source_option_count=0 then
      raise exception using errcode='23514',
        message='PUBLICATION_PRICE_OPTIONS_MISSING';
    elsif v_source_default_count>1 then
      raise exception using errcode='23514',
        message='PUBLICATION_PRICE_OPTION_DEFAULT_INVALID';
    end if;

    with source_options as (
      select source.*
      from public.contract_price_options source
      where source.company_id=v_company_id
        and source.contract_product_version_id=v.contract_product_version_id
        and source.price_plan_version_id=v.price_plan_version_id
        and (
          (v_source_kind='template'
            and source.contract_publication_version_id is null)
          or (v_source_kind='prior_snapshot'
            and source.contract_publication_version_id=
              v_source_publication_version_id)
        )
    ), inserted as (
      insert into public.contract_price_options(
        company_id,contract_product_version_id,price_plan_version_id,
        contract_publication_version_id,option_reference,option_code,
        customer_name,internal_description,contract_type,binding_months,
        notice_months,auto_renew_enabled,renewal_term_months,valid_from,
        valid_to,earliest_start_date,latest_start_date,status,sort_order,
        version_number,metadata,created_by,customer_type,is_default,
        selection_required
      )
      select source.company_id,source.contract_product_version_id,
        source.price_plan_version_id,v.id,source.option_reference,
        source.option_code,source.customer_name,source.internal_description,
        source.contract_type,source.binding_months,source.notice_months,
        source.auto_renew_enabled,source.renewal_term_months,
        source.valid_from,source.valid_to,source.earliest_start_date,
        source.latest_start_date,source.status,source.sort_order,
        source.version_number,
        coalesce(source.metadata,'{}'::jsonb)||jsonb_build_object(
          'materialized_from_price_option_id',source.id,
          'materialized_source_kind',v_source_kind
        ),coalesce(p_actor_user_id,source.created_by),
        coalesce(source.customer_type,v.customer_type),
        coalesce(source.is_default,
          count(*) over()=1),
        coalesce(source.selection_required,
          count(*) over()>1)
      from source_options source
      on conflict do nothing
      returning id
    ) select count(*) into v_inserted from inserted;
  end if;

  -- Complete area rows idempotently for both newly inserted and previously
  -- partial snapshots. Price values are copied byte-for-byte.
  insert into public.contract_price_option_area_prices(
    company_id,contract_price_option_id,price_plan_version_id,
    price_row_reference,price_area,amount,unit,vat_treatment,
    valid_from,valid_to,metadata,created_by,status
  )
  select target.company_id,target.id,target.price_plan_version_id,
    source_area.price_row_reference,source_area.price_area,
    source_area.amount,source_area.unit,source_area.vat_treatment,
    source_area.valid_from,source_area.valid_to,
    coalesce(source_area.metadata,'{}'::jsonb)||jsonb_build_object(
      'materialized_from_area_price_id',source_area.id
    ),coalesce(p_actor_user_id,source_area.created_by),source_area.status
  from public.contract_price_options target
  join public.contract_price_options source
    on source.id=(target.metadata->>'materialized_from_price_option_id')::uuid
  join public.contract_price_option_area_prices source_area
    on source_area.contract_price_option_id=source.id
  where target.contract_publication_version_id=v.id
  on conflict(contract_price_option_id,price_area) do nothing;

  -- Legacy partial snapshots may predate materialization metadata. Complete
  -- only from a same-version template with the same stable option reference;
  -- never infer a commercial amount from an unrelated publication version.
  insert into public.contract_price_option_area_prices(
    company_id,contract_price_option_id,price_plan_version_id,
    price_row_reference,price_area,amount,unit,vat_treatment,
    valid_from,valid_to,metadata,created_by,status
  )
  select target.company_id,target.id,target.price_plan_version_id,
    source_area.price_row_reference,source_area.price_area,
    source_area.amount,source_area.unit,source_area.vat_treatment,
    source_area.valid_from,source_area.valid_to,
    coalesce(source_area.metadata,'{}'::jsonb)||jsonb_build_object(
      'materialized_from_area_price_id',source_area.id,
      'materialized_source_kind','template_reference_match'
    ),coalesce(p_actor_user_id,source_area.created_by),source_area.status
  from public.contract_price_options target
  join public.contract_price_options source
    on source.company_id=target.company_id
   and source.contract_product_version_id=target.contract_product_version_id
   and source.price_plan_version_id=target.price_plan_version_id
   and source.contract_publication_version_id is null
   and source.option_reference=target.option_reference
   and source.option_code=target.option_code
   and source.contract_type=target.contract_type
   and source.binding_months is not distinct from target.binding_months
   and source.notice_months is not distinct from target.notice_months
   and source.auto_renew_enabled is not distinct from target.auto_renew_enabled
   and source.renewal_term_months is not distinct from target.renewal_term_months
   and source.valid_from is not distinct from target.valid_from
   and source.valid_to is not distinct from target.valid_to
   and source.earliest_start_date is not distinct from target.earliest_start_date
   and source.latest_start_date is not distinct from target.latest_start_date
   and coalesce(source.metadata->>'fixed_price','')=coalesce(target.metadata->>'fixed_price','')
   and coalesce(source.metadata->>'markup','')=coalesce(target.metadata->>'markup','')
   and coalesce(source.metadata->>'monthly_fee','')=coalesce(target.metadata->>'monthly_fee','')
  join public.contract_price_option_area_prices source_area
    on source_area.contract_price_option_id=source.id
  where target.contract_publication_version_id=v.id
  on conflict(contract_price_option_id,price_area) do nothing;

  -- A single option has an unambiguous selection policy. Multiple options are
  -- never guessed; validation will report them for manual review.
  update public.contract_price_options target
  set is_default=true,selection_required=false
  where target.contract_publication_version_id=v.id
    and (target.is_default is null or target.selection_required is null)
    and 1=(select count(*) from public.contract_price_options all_options
      where all_options.contract_publication_version_id=v.id
        and all_options.status='active');

  return jsonb_build_object(
    'publication_version_id',v.id,
    'source_kind',v_source_kind,
    'source_publication_version_id',v_source_publication_version_id,
    'inserted_price_options',v_inserted,
    'price_options',public.gridex_publication_price_options_json_v1(v.id)
  );
end $$;

create or replace function public.gridex_finalize_contract_publication_v1(
  p_publication_version_id uuid,
  p_actor_user_id uuid default null,
  p_allow_locked_metadata_repair boolean default false
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_catalog,pg_temp
as $$
declare
  v public.contract_publication_versions%rowtype;
  v_company_id uuid;
  v_channel text;
  v_blockers text[];
  v_price_options jsonb;
  v_legal_snapshot jsonb;
  v_snapshot jsonb;
  v_hash text;
  v_before jsonb;
begin
  select pv.* into v
  from public.contract_publication_versions pv
  where pv.id=p_publication_version_id
  for update;
  select a.company_id,p.channel into v_company_id,v_channel
  from public.contract_publications p
  join public.tenant_contract_assignments a on a.id=p.assignment_id
  where p.id=v.contract_publication_id;
  if not found then
    raise exception using errcode='P0002',
      message='PUBLICATION_VERSION_NOT_FOUND';
  end if;
  if v.locked_at is not null and not p_allow_locked_metadata_repair then
    raise exception using errcode='55000',
      message='PUBLICATION_VERSION_NOT_LOCKED_FOR_REPAIR';
  end if;
  v_before:=to_jsonb(v);

  perform public.gridex_materialize_publication_price_options_v1(
    v.id,p_actor_user_id
  );
  v_blockers:=public.gridex_validate_publication_graph_v1(v.id);
  if cardinality(v_blockers)>0 then
    raise exception using errcode='23514',
      message=coalesce(v_blockers[1],'PUBLICATION_SNAPSHOT_INVALID'),
      detail=to_jsonb(v_blockers)::text;
  end if;

  v_price_options:=public.gridex_publication_price_options_json_v1(v.id);
  select jsonb_build_object(
    'legal_bundle_version_id',b.id,
    'status',b.status,
    'content_sha256',b.content_sha256,
    'documents',coalesce((select jsonb_agg(jsonb_build_object(
      'module_key',d.module_key,'content_sha256',d.content_sha256
    ) order by d.sort_order,d.module_key)
      from public.legal_bundle_version_documents d
      where d.legal_bundle_version_id=b.id),'[]'::jsonb)
  ) into v_legal_snapshot
  from public.legal_bundle_versions b
  where b.id=v.legal_bundle_version_id;

  v_snapshot:=coalesce(v.publication_snapshot,'{}'::jsonb)
    ||jsonb_build_object(
      'schema','gridex_contract_publication_v6',
      'channel',v_channel,
      'offer_reference',v.offer_reference,
      'price_options',v_price_options,
      'supported_price_areas',to_jsonb(
        public.gridex_supported_price_areas_v1(
          v.contract_product_version_id
        )
      ),
      'legal_snapshot',coalesce(v_legal_snapshot,'{}'::jsonb)
    );
  v_hash:=encode(extensions.digest(v_snapshot::text,'sha256'),'hex');

  perform set_config('gridex.version_transition','on',true);
  if v.locked_at is not null then
    perform set_config('gridex.publication_graph_repair','on',true);
  end if;
  update public.contract_publication_versions
  set publication_snapshot=v_snapshot,content_sha256=v_hash,
      status='published',published_at=coalesce(published_at,now()),
      locked_at=coalesce(locked_at,now())
  where id=v.id;
  if v.locked_at is not null then
    perform set_config('gridex.publication_graph_repair','off',true);
  end if;
  update public.contract_publications
  set status='published',updated_at=now()
  where id=v.contract_publication_id;

  insert into public.audit_logs(
    company_id,actor_user_id,entity_type,entity_id,action,
    old_values,new_values,metadata
  ) values(
    v_company_id,p_actor_user_id,'contract_publication_version',v.id::text,
    case when v.locked_at is null then 'contract_publication_finalized'
      else 'contract_publication_graph_repaired' end,
    v_before,(select to_jsonb(current_row)
      from public.contract_publication_versions current_row
      where current_row.id=v.id),
    jsonb_build_object('channel',v_channel,'commercial_values_changed',false)
  );

  return jsonb_build_object('ok',true,'publication_version_id',v.id,
    'channel',v_channel,'content_sha256',v_hash,
    'price_options',v_price_options,'blockers','[]'::jsonb);
end $$;

create or replace function public.gridex_publish_contract_channel(
  p_company_id uuid,p_offer_id uuid,p_channel text,p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  o public.contract_offers%rowtype;
  v_readiness jsonb;
  v_assignment_id uuid;
  v_publication_id uuid;
  v_publication_version_id uuid;
  v_legal_version_id uuid;
  v_public_offer_id uuid;
  v_snapshot jsonb;
  v_hash text;
  v_offer_reference text;
  v_version integer;
  v_channel text;
  v_billing_model text;
  v_spot_weight numeric;
  v_portfolio_weight numeric;
  v_fixed_weight numeric;
  v_price_areas text[]:='{}'::text[];
begin
  v_channel:=lower(coalesce(p_channel,''));
  if v_channel not in ('internal','website','api','partner','phone') then
    return jsonb_build_object(
      'ok',false,'changed',false,'code','invalid_contract_channel','channel',v_channel,
      'blockers',jsonb_build_array(public.gridex_contract_readiness_blocker_v2(
        'invalid_contract_channel','channel',
        'Kanalen måste vara internal, website, api, partner eller phone.',to_jsonb(v_channel)
      ))
    );
  end if;
  perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.publish');
  perform public.gridex_assert_contract_permission(p_actor_user_id,'pricing.publish');

  select * into o from public.contract_offers
  where id=p_offer_id and company_id=p_company_id for update;
  if not found then
    return jsonb_build_object(
      'ok',false,'changed',false,'code','contract_offer_not_found',
      'blockers',jsonb_build_array(public.gridex_contract_readiness_blocker_v2(
        'contract_offer_not_found','contract_offer_id',
        'Avtalsversionen hittades inte för valt bolag.',to_jsonb(p_offer_id),
        'contract_offer',p_offer_id
      ))
    );
  end if;

  v_readiness:=public.gridex_validate_contract_readiness_v2(
    p_company_id,p_offer_id,
    case when o.lifecycle_status='paused' then 'resume_channel' else 'activate_channel' end,
    v_channel
  );
  if not coalesce((v_readiness->>'can_execute')::boolean,false) then
    return jsonb_build_object(
      'ok',false,'changed',false,'code','contract_channel_not_ready',
      'channel',v_channel,'lifecycle_status',o.lifecycle_status,
      'blockers',coalesce(v_readiness->'blockers','[]'::jsonb),
      'readiness',v_readiness
    );
  end if;
  if o.contract_product_version_id is null or not exists(
    select 1 from public.contract_product_versions pv
    where pv.id=o.contract_product_version_id and pv.status='approved' and pv.locked_at is not null
  ) then
    return jsonb_build_object(
      'ok',false,'changed',false,'code','contract_version_not_locked',
      'blockers',jsonb_build_array(public.gridex_contract_readiness_blocker_v2(
        'contract_version_not_locked','contract_product_version_id',
        'Canonical avtalsversion måste vara approved och låst före kanalaktivering.',
        to_jsonb(o.contract_product_version_id),'contract_product_version',o.contract_product_version_id
      ))
    );
  end if;

  if exists(
    select 1
    from public.tenant_contract_assignments ta
    join public.tenant_contract_channels ch on ch.assignment_id=ta.id
    join public.contract_publications cp on cp.assignment_id=ta.id and cp.channel=v_channel
    join public.contract_publication_versions cpv
      on cpv.contract_publication_id=cp.id
     and cpv.contract_product_version_id=o.contract_product_version_id
    where ta.company_id=p_company_id
      and ta.contract_product_version_id=o.contract_product_version_id
      and ta.status='active'
      and ch.channel=v_channel and ch.status='active'
      and cp.status='published' and cpv.status='published'
      and cardinality(public.gridex_validate_publication_graph_v1(cpv.id))=0
      and (ch.valid_from is null or ch.valid_from<=now())
      and (ch.valid_to is null or ch.valid_to>=now())
      and (
        v_channel<>'website'
        or exists(
          select 1 from public.public_contract_offers pco
          where pco.company_id=p_company_id
            and pco.contract_publication_version_id=cpv.id
            and pco.source_contract_offer_id=o.id
            and pco.lifecycle_status='published'
            and pco.publication_status='published'
            and pco.is_public and pco.website_enabled and pco.website_cta_enabled
        )
      )
  ) then
    return jsonb_build_object(
      'ok',true,'changed',false,'mode','published','code','contract_channel_already_active',
      'channel',v_channel,'contract_product_id',o.contract_product_id,
      'contract_product_version_id',o.contract_product_version_id,
      'blockers','[]'::jsonb
    );
  end if;

  perform public.gridex_sync_internal_offer_to_canonical(o.id);
  select * into o from public.contract_offers where id=o.id;

  -- The compatibility public-offer row is still consumed by parts of the
  -- website runtime. Derive its presentation fields from the same immutable
  -- commercial snapshot that is locked into the publication version.
  v_billing_model:=coalesce(nullif(o.commercial_snapshot->>'pricing_model',''),o.contract_type);
  v_spot_weight:=coalesce(
    case when coalesce(o.commercial_snapshot#>>'{portfolio_method,mix_shares,spot_weight_percent}','') ~ '^-?[0-9]+([.][0-9]+)?$'
      then (o.commercial_snapshot#>>'{portfolio_method,mix_shares,spot_weight_percent}')::numeric end,
    case when coalesce(o.commercial_snapshot->>'spot_weight_percent','') ~ '^-?[0-9]+([.][0-9]+)?$'
      then (o.commercial_snapshot->>'spot_weight_percent')::numeric end,
    100
  );
  v_portfolio_weight:=coalesce(
    case when coalesce(o.commercial_snapshot#>>'{portfolio_method,mix_shares,portfolio_weight_percent}','') ~ '^-?[0-9]+([.][0-9]+)?$'
      then (o.commercial_snapshot#>>'{portfolio_method,mix_shares,portfolio_weight_percent}')::numeric end,
    case when coalesce(o.commercial_snapshot->>'portfolio_weight_percent','') ~ '^-?[0-9]+([.][0-9]+)?$'
      then (o.commercial_snapshot->>'portfolio_weight_percent')::numeric end,
    0
  );
  v_fixed_weight:=coalesce(
    case when coalesce(o.commercial_snapshot#>>'{portfolio_method,mix_shares,fixed_weight_percent}','') ~ '^-?[0-9]+([.][0-9]+)?$'
      then (o.commercial_snapshot#>>'{portfolio_method,mix_shares,fixed_weight_percent}')::numeric end,
    case when coalesce(o.commercial_snapshot->>'fixed_weight_percent','') ~ '^-?[0-9]+([.][0-9]+)?$'
      then (o.commercial_snapshot->>'fixed_weight_percent')::numeric end,
    0
  );
  select coalesce(array_agg(distinct upper(btrim(area)) order by upper(btrim(area))),'{}'::text[])
  into v_price_areas
  from (
    select value as area
    from jsonb_array_elements_text(
      case when jsonb_typeof(o.commercial_snapshot->'price_areas')='array'
        then o.commercial_snapshot->'price_areas' else '[]'::jsonb end
    )
    where nullif(btrim(value),'') is not null
    union all
    select unnest(cpv.price_areas)
    from public.contract_product_versions cpv
    where cpv.id=o.contract_product_version_id
      and jsonb_array_length(
        case when jsonb_typeof(o.commercial_snapshot->'price_areas')='array'
          then o.commercial_snapshot->'price_areas' else '[]'::jsonb end
      )=0
  ) areas;

  -- Move only the selected channel from older versions in the same product
  -- series. Other channels stay active until separately switched.
  update public.tenant_contract_channels old_channel
  set status='ended',valid_to=coalesce(old_channel.valid_to,now()),updated_at=now()
  from public.tenant_contract_assignments old_assignment
  join public.contract_product_versions old_version on old_version.id=old_assignment.contract_product_version_id
  where old_channel.assignment_id=old_assignment.id
    and old_assignment.company_id=p_company_id
    and old_version.contract_product_id=o.contract_product_id
    and old_assignment.contract_product_version_id<>o.contract_product_version_id
    and old_channel.channel=v_channel
    and old_channel.status in ('active','paused');

  -- Locked publication versions may only move through an explicit lifecycle transition.
  perform set_config('gridex.version_transition','on',true);
  update public.contract_publication_versions old_publication_version
  set status='ended',valid_to=coalesce(old_publication_version.valid_to,now())
  from public.contract_publications old_publication
  join public.tenant_contract_assignments old_assignment on old_assignment.id=old_publication.assignment_id
  join public.contract_product_versions old_version on old_version.id=old_assignment.contract_product_version_id
  where old_publication_version.contract_publication_id=old_publication.id
    and old_assignment.company_id=p_company_id
    and old_version.contract_product_id=o.contract_product_id
    and old_assignment.contract_product_version_id<>o.contract_product_version_id
    and old_publication.channel=v_channel
    and old_publication_version.status='published';

  update public.contract_publications old_publication
  set status='ended',updated_at=now()
  from public.tenant_contract_assignments old_assignment
  join public.contract_product_versions old_version on old_version.id=old_assignment.contract_product_version_id
  where old_publication.assignment_id=old_assignment.id
    and old_assignment.company_id=p_company_id
    and old_version.contract_product_id=o.contract_product_id
    and old_assignment.contract_product_version_id<>o.contract_product_version_id
    and old_publication.channel=v_channel
    and old_publication.status not in ('ended','archived');

  update public.tenant_contract_assignments old_assignment
  set status=case when exists(
        select 1 from public.tenant_contract_channels remaining
        where remaining.assignment_id=old_assignment.id and remaining.status='active'
          and (remaining.valid_from is null or remaining.valid_from<=now())
          and (remaining.valid_to is null or remaining.valid_to>=now())
      ) then 'active' else 'ended' end,
      valid_to=case when exists(
        select 1 from public.tenant_contract_channels remaining
        where remaining.assignment_id=old_assignment.id and remaining.status='active'
          and (remaining.valid_from is null or remaining.valid_from<=now())
          and (remaining.valid_to is null or remaining.valid_to>=now())
      ) then old_assignment.valid_to else coalesce(old_assignment.valid_to,current_date) end,
      updated_at=now()
  from public.contract_product_versions old_version
  where old_version.id=old_assignment.contract_product_version_id
    and old_assignment.company_id=p_company_id
    and old_version.contract_product_id=o.contract_product_id
    and old_assignment.contract_product_version_id<>o.contract_product_version_id;

  update public.contract_offers old_offer
  set lifecycle_status=case when exists(
        select 1 from public.tenant_contract_assignments ta
        join public.tenant_contract_channels ch on ch.assignment_id=ta.id
        where ta.company_id=p_company_id
          and ta.contract_product_version_id=old_offer.contract_product_version_id
          and ta.status='active' and ch.status='active'
          and (ch.valid_from is null or ch.valid_from<=now())
          and (ch.valid_to is null or ch.valid_to>=now())
      ) then 'published' else 'superseded' end,
      status=case when exists(
        select 1 from public.tenant_contract_assignments ta
        join public.tenant_contract_channels ch on ch.assignment_id=ta.id
        where ta.company_id=p_company_id
          and ta.contract_product_version_id=old_offer.contract_product_version_id
          and ta.status='active' and ch.status='active'
      ) then 'active' else 'inactive' end,
      is_active=exists(
        select 1 from public.tenant_contract_assignments ta
        join public.tenant_contract_channels ch on ch.assignment_id=ta.id
        where ta.company_id=p_company_id
          and ta.contract_product_version_id=old_offer.contract_product_version_id
          and ta.status='active' and ch.status='active'
      ),
      superseded_at=case when exists(
        select 1 from public.tenant_contract_assignments ta
        join public.tenant_contract_channels ch on ch.assignment_id=ta.id
        where ta.company_id=p_company_id
          and ta.contract_product_version_id=old_offer.contract_product_version_id
          and ta.status='active' and ch.status='active'
      ) then old_offer.superseded_at else coalesce(old_offer.superseded_at,now()) end,
      updated_by=p_actor_user_id,updated_at=now()
  where old_offer.company_id=p_company_id
    and old_offer.contract_product_id=o.contract_product_id
    and old_offer.id<>o.id
    and old_offer.lifecycle_status not in ('archived','expired','closed');

  update public.contract_offers
  set lifecycle_status='published',status='active',is_active=true,
      superseded_at=null,updated_by=p_actor_user_id,updated_at=now()
  where id=o.id;
  update public.contract_products set status='active',updated_at=now()
  where id=o.contract_product_id and company_id=p_company_id;

  select id into v_assignment_id
  from public.tenant_contract_assignments
  where company_id=p_company_id and contract_product_version_id=o.contract_product_version_id
  for update;
  if v_assignment_id is null then
    raise exception using errcode='23514',
      message='PUBLICATION_TENANT_NOT_READY';
  end if;

  update public.tenant_contract_assignments
  set website_publication_allowed=website_publication_allowed or v_channel='website',
      internal_sales_allowed=internal_sales_allowed or v_channel='internal',
      status='active',valid_from=o.valid_from,valid_to=o.valid_to,updated_at=now()
  where id=v_assignment_id;

  insert into public.tenant_contract_channels(
    assignment_id,channel,status,valid_from,valid_to,marketing_content,updated_by
  ) values(
    v_assignment_id,v_channel,'active',o.valid_from::timestamptz,o.valid_to::timestamptz,
    jsonb_build_object('name',o.name,'source_contract_offer_id',o.id,'source_of_truth','contract_product_versions'),
    p_actor_user_id
  ) on conflict(assignment_id,channel) do update set
    status='active',valid_from=excluded.valid_from,valid_to=excluded.valid_to,
    marketing_content=excluded.marketing_content,updated_by=excluded.updated_by,updated_at=now();

  select legal_bundle_version_id into v_legal_version_id
  from public.contract_offers where id=o.id;
  if v_legal_version_id is null then
    raise exception using errcode='23514',
      message='PUBLICATION_LEGAL_BUNDLE_MISSING';
  end if;

  -- A publication root and version remain non-visible while the immutable
  -- child graph is materialized. The surrounding RPC transaction guarantees
  -- that no observer can see an intermediate state.
  insert into public.contract_publications(assignment_id,channel,status,created_by)
  values(v_assignment_id,v_channel,'draft',p_actor_user_id)
  on conflict(assignment_id,channel) do update set status='draft',updated_at=now()
  returning id into v_publication_id;

  select id,offer_reference
    into v_publication_version_id,v_offer_reference
  from public.contract_publication_versions
  where contract_publication_id=v_publication_id
    and contract_product_version_id=o.contract_product_version_id
    and channel=v_channel
    and publication_snapshot->>'source_contract_offer_id'=o.id::text
  order by version_number desc
  limit 1
  for update;

  if v_publication_version_id is null then
    select coalesce(max(version_number),0)+1 into v_version
    from public.contract_publication_versions
    where contract_publication_id=v_publication_id;
    v_offer_reference:=public.gridex_new_offer_reference(
      concat_ws('|',p_company_id::text,o.version_series_id::text,
        o.version_number::text,v_channel)
    );
    v_snapshot:=jsonb_build_object(
      'schema','gridex_contract_publication_v6',
      'company_id',p_company_id,
      'contract_product_id',o.contract_product_id,
      'contract_product_version_id',o.contract_product_version_id,
      'source_contract_offer_id',o.id,
      'channel',v_channel,
      'offer_reference',v_offer_reference,
      'commercial_snapshot',o.commercial_snapshot,
      'legal_bundle_version_id',v_legal_version_id,
      'price_options','[]'::jsonb,
      'valid_from',o.valid_from,
      'valid_to',o.valid_to
    );
    v_hash:=encode(extensions.digest(v_snapshot::text,'sha256'),'hex');
    insert into public.contract_publication_versions(
      contract_publication_id,version_number,contract_product_version_id,
      price_plan_id,price_plan_version_id,price_book_id,legal_bundle_version_id,
      customer_type,channel,valid_from,valid_to,publication_snapshot,
      offer_reference,content_sha256,status,published_at,locked_at,created_by
    ) values(
      v_publication_id,v_version,o.contract_product_version_id,
      o.price_plan_id,o.price_plan_version_id,o.price_book_id,v_legal_version_id,
      o.customer_type,v_channel,o.valid_from::timestamptz,o.valid_to::timestamptz,
      v_snapshot,v_offer_reference,v_hash,'draft',null,null,p_actor_user_id
    ) returning id into v_publication_version_id;
  else
    perform set_config('gridex.version_transition','on',true);
    update public.contract_publication_versions
    set status='draft',valid_from=o.valid_from::timestamptz,
        valid_to=o.valid_to::timestamptz
    where id=v_publication_version_id;
  end if;

  perform public.gridex_finalize_contract_publication_v1(
    v_publication_version_id,p_actor_user_id,true
  );
  select publication_snapshot,content_sha256,offer_reference
    into v_snapshot,v_hash,v_offer_reference
  from public.contract_publication_versions
  where id=v_publication_version_id;

  update public.contract_publications
  set status='published',updated_at=now()
  where id=v_publication_id;

  if v_channel='website' then
    perform set_config('gridex.public_offer_write','on',true);

    -- Only one website offer in a product series may be public. Older public
    -- compatibility rows remain for historic references but are immediately
    -- removed from all public/CTA surfaces.
    update public.public_contract_offers old_public
    set lifecycle_status='superseded',publication_status='unpublished',
        is_public=false,website_enabled=false,website_cta_enabled=false,
        updated_by=p_actor_user_id,updated_at=now()
    where old_public.company_id=p_company_id
      and old_public.contract_product_id=o.contract_product_id
      and old_public.source_contract_offer_id is distinct from o.id
      and (old_public.is_public or old_public.website_enabled or old_public.website_cta_enabled
           or old_public.publication_status='published');

    select id into v_public_offer_id
    from public.public_contract_offers
    where company_id=p_company_id and source_contract_offer_id=o.id
    order by created_at desc limit 1 for update;

    if v_public_offer_id is null then
      insert into public.public_contract_offers(
        company_id,source_contract_offer_id,version_series_id,version_number,
        contract_product_id,contract_product_version_id,contract_publication_version_id,
        legal_bundle_version_id,price_plan_id,price_plan_version_id,price_book_id,
        product_code,offer_code,public_name,public_description,contract_type,billing_model,
        customer_type,monthly_fee_sek,invoice_fee_sek,spot_markup_ore_per_kwh,
        variable_fee_ore_per_kwh,fixed_price_ore_per_kwh,green_fee_mode,green_fee_value,
        start_fee_sek,administration_fee_sek,break_fee_sek,discount_value,discount_unit,
        discount_months,vat_rate,terms_version,binding_months,notice_months,
        spot_weight_percent,portfolio_weight_percent,fixed_weight_percent,price_areas,
        automatic_renewal,power_of_attorney_required,valid_from,valid_to,
        is_public,is_archived,publication_status,lifecycle_status,website_enabled,
        website_cta_enabled,published_at,metadata,created_by,updated_by
      ) values(
        p_company_id,o.id,o.version_series_id,o.version_number,
        o.contract_product_id,o.contract_product_version_id,v_publication_version_id,
        v_legal_version_id,o.price_plan_id,o.price_plan_version_id,o.price_book_id,
        'electricity','contract-'||o.version_series_id::text,o.name,o.description,o.contract_type,
        v_billing_model,o.customer_type,
        o.monthly_fee_sek,o.invoice_fee_sek,o.spot_markup_ore_per_kwh,o.variable_fee_ore_per_kwh,
        o.fixed_price_ore_per_kwh,o.green_fee_mode,o.green_fee_value,o.start_fee_sek,o.admin_fee_sek,
        o.break_fee_sek,o.discount_value,o.discount_unit,o.discount_months,o.vat_rate,o.terms_version,
        o.default_binding_months,o.default_notice_months,
        v_spot_weight,v_portfolio_weight,v_fixed_weight,v_price_areas,
        o.automatic_renewal,o.power_of_attorney_required,o.valid_from,o.valid_to,
        true,false,'published','published',true,true,now(),
        jsonb_build_object('source_of_truth','contract_product_versions','offer_reference',v_offer_reference),
        p_actor_user_id,p_actor_user_id
      ) returning id into v_public_offer_id;
    else
      update public.public_contract_offers set
        contract_product_id=o.contract_product_id,
        contract_product_version_id=o.contract_product_version_id,
        contract_publication_version_id=v_publication_version_id,
        legal_bundle_version_id=v_legal_version_id,
        price_plan_id=o.price_plan_id,price_plan_version_id=o.price_plan_version_id,price_book_id=o.price_book_id,
        public_name=o.name,public_description=o.description,contract_type=o.contract_type,
        billing_model=v_billing_model,customer_type=o.customer_type,
        monthly_fee_sek=o.monthly_fee_sek,invoice_fee_sek=o.invoice_fee_sek,
        spot_markup_ore_per_kwh=o.spot_markup_ore_per_kwh,variable_fee_ore_per_kwh=o.variable_fee_ore_per_kwh,
        fixed_price_ore_per_kwh=o.fixed_price_ore_per_kwh,green_fee_mode=o.green_fee_mode,green_fee_value=o.green_fee_value,
        start_fee_sek=o.start_fee_sek,administration_fee_sek=o.admin_fee_sek,break_fee_sek=o.break_fee_sek,
        discount_value=o.discount_value,discount_unit=o.discount_unit,discount_months=o.discount_months,
        vat_rate=o.vat_rate,terms_version=o.terms_version,binding_months=o.default_binding_months,
        notice_months=o.default_notice_months,
        spot_weight_percent=v_spot_weight,portfolio_weight_percent=v_portfolio_weight,
        fixed_weight_percent=v_fixed_weight,price_areas=v_price_areas,
        automatic_renewal=o.automatic_renewal,
        power_of_attorney_required=o.power_of_attorney_required,valid_from=o.valid_from,valid_to=o.valid_to,
        is_public=true,is_archived=false,publication_status='published',lifecycle_status='published',
        website_enabled=true,website_cta_enabled=true,published_at=coalesce(published_at,now()),archived_at=null,
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('source_of_truth','contract_product_versions','offer_reference',v_offer_reference),
        updated_by=p_actor_user_id,updated_at=now()
      where id=v_public_offer_id;
    end if;
    update public.contract_publication_versions
    set legacy_public_contract_offer_id=v_public_offer_id
    where id=v_publication_version_id and legacy_public_contract_offer_id is null;
  end if;

  insert into public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata)
  values(
    p_company_id,p_actor_user_id,'contract_publication_version',v_publication_version_id::text,
    'contract.channel.published',null,v_snapshot,
    jsonb_build_object('offer_id',o.id,'channel',v_channel,'offer_reference',v_offer_reference)
  );

  return jsonb_build_object(
    'ok',true,'changed',true,'mode','published','channel',v_channel,
    'contract_product_id',o.contract_product_id,
    'contract_product_version_id',o.contract_product_version_id,
    'contract_publication_version_id',v_publication_version_id,
    'public_contract_offer_id',v_public_offer_id,
    'offer_reference',v_offer_reference,
    'affected_channels',1,
    'affected_publication_versions',1,
    'affected_public_offers',case when v_channel='website' then 1 else 0 end
  );
end $$;

-- Price-option and area-price mutations now participate in publication
-- revision/ETag invalidation.
create or replace function public.gridex_contract_publication_revision_trigger()
returns trigger
language plpgsql
security definer
set search_path=public,pg_catalog,pg_temp
as $$
declare
  v_company_id uuid;
  v_channel text;
  v_entity_id text;
  v_assignment_id uuid;
  v_publication_id uuid;
  v_publication_version_id uuid;
  v_option_id uuid;
  v_row jsonb;
begin
  v_row:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_entity_id:=v_row->>'id';
  if tg_table_name='public_contract_offers' then
    v_company_id:=(v_row->>'company_id')::uuid;
    v_channel:='website';
  elsif tg_table_name='tenant_contract_channels' then
    v_assignment_id:=(v_row->>'assignment_id')::uuid;
    v_channel:=v_row->>'channel';
    select company_id into v_company_id
    from public.tenant_contract_assignments where id=v_assignment_id;
  elsif tg_table_name='contract_publications' then
    v_assignment_id:=(v_row->>'assignment_id')::uuid;
    v_channel:=v_row->>'channel';
    select company_id into v_company_id
    from public.tenant_contract_assignments where id=v_assignment_id;
  elsif tg_table_name='contract_publication_versions' then
    v_publication_id:=(v_row->>'contract_publication_id')::uuid;
    select a.company_id,p.channel into v_company_id,v_channel
    from public.contract_publications p
    join public.tenant_contract_assignments a on a.id=p.assignment_id
    where p.id=v_publication_id;
  elsif tg_table_name='contract_price_options' then
    v_company_id:=(v_row->>'company_id')::uuid;
    v_publication_version_id:=nullif(
      v_row->>'contract_publication_version_id',''
    )::uuid;
    if v_publication_version_id is not null then
      select p.channel into v_channel
      from public.contract_publication_versions pv
      join public.contract_publications p on p.id=pv.contract_publication_id
      where pv.id=v_publication_version_id;
    end if;
  elsif tg_table_name='contract_price_option_area_prices' then
    v_option_id:=(v_row->>'contract_price_option_id')::uuid;
    select o.company_id,o.contract_publication_version_id
      into v_company_id,v_publication_version_id
    from public.contract_price_options o where o.id=v_option_id;
    if v_publication_version_id is not null then
      select p.channel into v_channel
      from public.contract_publication_versions pv
      join public.contract_publications p on p.id=pv.contract_publication_id
      where pv.id=v_publication_version_id;
    end if;
  end if;
  if v_company_id is not null and v_channel in ('website','api') then
    perform public.gridex_bump_contract_publication_revision(
      v_company_id,v_channel,tg_table_name||'.'||lower(tg_op),v_entity_id
    );
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists trg_contract_price_options_publication_revision
  on public.contract_price_options;
create trigger trg_contract_price_options_publication_revision
after insert or update or delete on public.contract_price_options
for each row execute function public.gridex_contract_publication_revision_trigger();
drop trigger if exists trg_contract_price_option_area_publication_revision
  on public.contract_price_option_area_prices;
create trigger trg_contract_price_option_area_publication_revision
after insert or update or delete on public.contract_price_option_area_prices
for each row execute function public.gridex_contract_publication_revision_trigger();

-- Broad diagnostics starts from the internal offer and uses LEFT JOINs so a
-- broken graph remains observable.
create view public.canonical_public_contract_diagnostics_v
with (security_invoker=true)
as
with channels(channel) as (values('website'::text),('api'::text)), graph as (
  select offer.company_id,offer.id source_contract_offer_id,
    offer.name,coalesce(product.product_code,'electricity') product_code,
    offer.customer_type,offer.contract_type,requested.channel,
    (
      cardinality(coalesce(product_version.price_areas,'{}'::text[]))=0
      or (
        not exists(
          select 1
          from unnest(coalesce(product_version.price_areas,'{}'::text[])) area
          where upper(btrim(area)) not in ('SE1','SE2','SE3','SE4')
        )
        and cardinality(coalesce(product_version.price_areas,'{}'::text[]))=(
          select count(distinct upper(btrim(area)))
          from unnest(coalesce(product_version.price_areas,'{}'::text[])) area
        )
      )
    ) supported_areas_valid,
    case when coalesce(
      publication_version.publication_snapshot->'commercial_snapshot'->>'invoice_fee_sek','')
      ~ '^-?[0-9]+([.][0-9]+)?$'
      then (publication_version.publication_snapshot->'commercial_snapshot'->>'invoice_fee_sek')::numeric
      else null end invoice_fee_sek,
    coalesce(publication_version.publication_snapshot->'commercial_snapshot','{}'::jsonb)
      pricing_snapshot,
    company.external_tenant_reference,company.status company_status,
    assignment.id assignment_id,assignment.status assignment_status,
    assignment.website_publication_allowed,assignment.api_publication_allowed,
    channel.id channel_id,channel.status channel_status,
    publication.id publication_id,publication.status publication_status,
    publication_version.id publication_version_id,
    publication_version.offer_reference,
    publication_version.status publication_version_status,
    publication_version.locked_at,publication_version.valid_from,
    publication_version.valid_to,publication_version.content_sha256,
    publication_version.publication_snapshot,
    publication_version.publication_snapshot->>'source_contract_offer_id'
      snapshot_source_contract_offer_id,
    public_offer.id public_offer_id,public_offer.website_enabled,
    public_offer.website_cta_enabled,public_offer.is_public,
    public_offer.publication_status website_publication_status,
    coalesce(invoice_fee.component_count,0) invoice_fee_component_count,
    coalesce(invoice_fee.canonical_count,0) invoice_fee_canonical_count,
    invoice_fee.canonical_amount invoice_fee_component_amount,
    (case when coalesce(
        publication_version.publication_snapshot->'commercial_snapshot'->>'invoice_fee_sek','')
        ~ '^-?[0-9]+([.][0-9]+)?$'
        then (publication_version.publication_snapshot->'commercial_snapshot'->>'invoice_fee_sek')::numeric
        else null end is not null
      and coalesce(invoice_fee.component_count,0)=1
      and coalesce(invoice_fee.canonical_count,0)=1
      and abs((case when coalesce(
          publication_version.publication_snapshot->'commercial_snapshot'->>'invoice_fee_sek','')
          ~ '^-?[0-9]+([.][0-9]+)?$'
          then (publication_version.publication_snapshot->'commercial_snapshot'->>'invoice_fee_sek')::numeric
          else null end)-invoice_fee.canonical_amount)<=0.000000001
    ) invoice_fee_ready,
    (select count(*) from public.contract_price_options option_row
      where option_row.contract_publication_version_id=publication_version.id
        and option_row.status='active') price_option_count,
    (select count(*) from public.contract_price_options option_row
      where option_row.contract_publication_version_id=publication_version.id
        and option_row.status='active' and option_row.is_default) default_count,
    (select count(*) from public.contract_price_options option_row
      where option_row.contract_publication_version_id=publication_version.id
        and option_row.status='active' and option_row.selection_required)
      required_selection_count,
    (select count(*) from public.contract_price_options option_row
      where option_row.contract_publication_version_id=publication_version.id
        and option_row.status='active' and (
          option_row.customer_type is null
          or not (option_row.customer_type='both' or offer.customer_type='both'
            or option_row.customer_type=offer.customer_type)
          or option_row.contract_type<>offer.contract_type
          or option_row.selection_required is null
          or nullif(btrim(option_row.option_reference),'') is null
          or nullif(btrim(option_row.option_code),'') is null
        )) invalid_option_count,
    (select count(*) from (
      select option_row.option_reference stable_value
      from public.contract_price_options option_row
      where option_row.contract_publication_version_id=publication_version.id
        and option_row.status='active'
      group by option_row.option_reference having count(*)>1
      union all
      select option_row.option_code stable_value
      from public.contract_price_options option_row
      where option_row.contract_publication_version_id=publication_version.id
        and option_row.status='active'
      group by option_row.option_code having count(*)>1
    ) duplicated) duplicate_option_count,
    exists(select 1 from public.legal_bundle_versions bundle
      where bundle.id=publication_version.legal_bundle_version_id
        and bundle.company_id=offer.company_id
        and bundle.status in ('published','replaced','archived')
        and bundle.locked_at is not null
        and cardinality(coalesce(bundle.unresolved_variables,'{}'::text[]))=0
        and exists(select 1 from public.legal_bundle_version_documents document
          where document.legal_bundle_version_id=bundle.id)) legal_ready,
    coalesce((select count(*) from unnest(
      public.gridex_supported_price_areas_v1(
        publication_version.contract_product_version_id
      )) required_area
      where offer.contract_type='fixed' and exists(
        select 1 from public.contract_price_options option_row
        where option_row.contract_publication_version_id=publication_version.id
          and option_row.status='active'
          and not exists(select 1
            from public.contract_price_option_area_prices area_row
            where area_row.contract_price_option_id=option_row.id
              and area_row.price_area=required_area
              and area_row.status='active' and area_row.amount is not null
              and area_row.amount>=0
              and area_row.unit in ('ore_per_kwh','sek_per_kwh'))
      )),0) missing_area_count
  from public.contract_offers offer
  left join public.contract_products product on product.id=offer.contract_product_id
  left join public.contract_product_versions product_version
    on product_version.id=offer.contract_product_version_id
  join public.companies company on company.id=offer.company_id
  cross join channels requested
  left join public.tenant_contract_assignments assignment
    on assignment.company_id=offer.company_id
    and assignment.contract_product_version_id=offer.contract_product_version_id
  left join public.tenant_contract_channels channel
    on channel.assignment_id=assignment.id and channel.channel=requested.channel
  left join public.contract_publications publication
    on publication.assignment_id=assignment.id
    and publication.channel=requested.channel
  left join lateral(
    select version_row.*
    from public.contract_publication_versions version_row
    where version_row.contract_publication_id=publication.id
      and version_row.contract_product_version_id=offer.contract_product_version_id
    order by version_row.version_number desc
    limit 1
  ) publication_version on true
  left join lateral(
    select count(*) component_count,
      count(*) filter(where component.value->>'unit'='sek_invoice'
        and component.value->>'calculation_type'='per_invoice'
        and coalesce(component.value->>'amount','') ~ '^-?[0-9]+([.][0-9]+)?$'
        and (component.value->>'amount')::numeric>=0) canonical_count,
      max(case when component.value->>'unit'='sek_invoice'
        and component.value->>'calculation_type'='per_invoice'
        and coalesce(component.value->>'amount','') ~ '^-?[0-9]+([.][0-9]+)?$'
        and (component.value->>'amount')::numeric>=0
        then (component.value->>'amount')::numeric end) canonical_amount
    from jsonb_array_elements(
      case
        when jsonb_typeof(publication_version.publication_snapshot
          ->'commercial_snapshot'->'price_components')='array'
          then publication_version.publication_snapshot
            ->'commercial_snapshot'->'price_components'
        when jsonb_typeof(publication_version.publication_snapshot
          ->'commercial_snapshot'->'price_components_snapshot')='array'
          then publication_version.publication_snapshot
            ->'commercial_snapshot'->'price_components_snapshot'
        else '[]'::jsonb
      end
    ) component(value)
    where coalesce(nullif(component.value->>'component_code',''),
      nullif(component.value->>'component_type',''),
      nullif(component.value->'metadata'->>'component_code',''))='invoice_fee'
      and coalesce(nullif(component.value->>'status',''),'active')='active'
  ) invoice_fee on true
  left join public.public_contract_offers public_offer
    on requested.channel='website'
    and public_offer.company_id=offer.company_id
    and public_offer.source_contract_offer_id=offer.id
    and public_offer.contract_publication_version_id=publication_version.id
)
select graph.*,
  case
    when channel_id is null then 'missing'
    when coalesce(channel_status,'missing')<>'active' then 'inactive'
    when publication_version_id is null then 'missing'
    when valid_to is not null and valid_to<=now() then 'expired'
    when coalesce(publication_version_status,'missing')='draft' then 'draft'
    when coalesce(publication_version_status,'missing')='review' then 'preparing'
    when coalesce(publication_version_status,'missing')='published' and (
      company_status<>'active'
      or nullif(btrim(external_tenant_reference),'') is null
      or assignment_id is null
      or coalesce(assignment_status,'missing')<>'active'
      or channel_id is null
      or coalesce(channel_status,'missing')<>'active'
      or (channel='website' and not coalesce(website_publication_allowed,false))
      or (channel='api' and not coalesce(api_publication_allowed,false))
      or publication_id is null
      or coalesce(publication_status,'missing')<>'published'
      or snapshot_source_contract_offer_id is distinct from
        source_contract_offer_id::text
      or locked_at is null
      or content_sha256 is distinct from
        encode(extensions.digest(publication_snapshot::text,'sha256'),'hex')
      or price_option_count=0 or default_count<>1
      or (price_option_count=1 and required_selection_count<>0)
      or (price_option_count>1 and required_selection_count<>price_option_count)
      or invalid_option_count>0 or duplicate_option_count>0
      or not supported_areas_valid or missing_area_count>0
      or not legal_ready or not invoice_fee_ready
      or (valid_from is not null and valid_from>now())
      or (channel='website' and (
        public_offer_id is null or not coalesce(website_enabled,false)
        or not coalesce(website_cta_enabled,false)
        or not coalesce(is_public,false)
        or coalesce(website_publication_status,'missing')<>'published'
      ))
    ) then 'blocked'
    when coalesce(publication_version_status,'missing')='published' then 'published'
    when publication_version_id is not null then 'blocked'
    else 'error'
  end channel_state,
  array_remove(array[
    case when company_status<>'active' then 'TENANT_NOT_OPERATIONALLY_READY' end,
    case when nullif(btrim(external_tenant_reference),'') is null
      then 'EXTERNAL_TENANT_REFERENCE_MISSING' end,
    case when assignment_id is null then 'TENANT_ASSIGNMENT_MISSING' end,
    case when coalesce(assignment_status,'missing')<>'active'
      then 'TENANT_ASSIGNMENT_INACTIVE' end,
    case when channel_id is null then upper(channel)||'_CHANNEL_MISSING' end,
    case when coalesce(channel_status,'missing')<>'active'
      then 'PUBLICATION_CHANNEL_NOT_ACTIVE' end,
    case when channel='website' and not coalesce(website_publication_allowed,false)
      then 'WEBSITE_PUBLICATION_NOT_ALLOWED' end,
    case when channel='api' and not coalesce(api_publication_allowed,false)
      then 'API_PUBLICATION_NOT_ALLOWED' end,
    case when publication_id is null then 'PUBLICATION_MISSING' end,
    case when coalesce(publication_status,'missing')<>'published'
      then 'PUBLICATION_NOT_PUBLISHED' end,
    case when publication_version_id is null
      then 'PUBLICATION_VERSION_MISSING' end,
    case when publication_version_id is not null
      and snapshot_source_contract_offer_id is distinct from
        source_contract_offer_id::text
      then 'PUBLICATION_SOURCE_OFFER_MISMATCH' end,
    case when coalesce(publication_version_status,'missing')<>'published'
      then 'PUBLICATION_VERSION_NOT_PUBLISHED' end,
    case when locked_at is null then 'PUBLICATION_VERSION_NOT_LOCKED' end,
    case when publication_version_id is not null and content_sha256 is distinct from
      encode(extensions.digest(publication_snapshot::text,'sha256'),'hex')
      then 'PUBLICATION_SNAPSHOT_INVALID' end,
    case when price_option_count=0 then 'PUBLICATION_PRICE_OPTIONS_MISSING' end,
    case when duplicate_option_count>0 then 'PUBLICATION_PRICE_OPTION_DUPLICATE' end,
    case when default_count<>1 then 'PUBLICATION_PRICE_OPTION_DEFAULT_INVALID' end,
    case when (price_option_count=1 and required_selection_count<>0)
        or (price_option_count>1 and required_selection_count<>price_option_count)
      then 'PUBLICATION_PRICE_OPTION_SELECTION_POLICY_INVALID' end,
    case when invalid_option_count>0 then 'PUBLICATION_PRICE_OPTION_POLICY_INVALID' end,
    case when not supported_areas_valid
      then 'PUBLICATION_SUPPORTED_PRICE_AREA_INVALID' end,
    case when missing_area_count>0 then 'PUBLICATION_AREA_PRICES_MISSING' end,
    case when not legal_ready then 'PUBLICATION_LEGAL_BUNDLE_MISSING' end,
    case when not invoice_fee_ready then 'INVOICE_FEE_CONFIGURATION_MISSING' end,
    case when valid_from is not null and valid_from>now()
      then 'PUBLICATION_NOT_YET_VALID' end,
    case when valid_to is not null and valid_to<=now()
      then 'PUBLICATION_EXPIRED' end,
    case when channel='website' and public_offer_id is null
      then 'WEBSITE_PUBLIC_OFFER_MISSING' end,
    case when channel='website' and not coalesce(website_enabled,false)
      then 'WEBSITE_DISABLED' end,
    case when channel='website' and not coalesce(website_cta_enabled,false)
      then 'WEBSITE_CTA_DISABLED' end,
    case when channel='website' and not coalesce(is_public,false)
      then 'WEBSITE_NOT_PUBLIC' end,
    case when channel='website'
      and coalesce(website_publication_status,'missing')<>'published'
      then 'WEBSITE_PUBLICATION_NOT_PUBLISHED' end
  ]::text[],null) blockers,
  cardinality(array_remove(array[
    case when company_status<>'active' then 'x' end,
    case when nullif(btrim(external_tenant_reference),'') is null then 'x' end,
    case when assignment_id is null or coalesce(assignment_status,'missing')<>'active' then 'x' end,
    case when channel_id is null or coalesce(channel_status,'missing')<>'active' then 'x' end,
    case when channel='website' and not coalesce(website_publication_allowed,false) then 'x' end,
    case when channel='api' and not coalesce(api_publication_allowed,false) then 'x' end,
    case when publication_id is null or coalesce(publication_status,'missing')<>'published' then 'x' end,
    case when publication_version_id is null or coalesce(publication_version_status,'missing')<>'published' then 'x' end,
    case when publication_version_id is not null
      and snapshot_source_contract_offer_id is distinct from
        source_contract_offer_id::text then 'x' end,
    case when locked_at is null then 'x' end,
    case when publication_version_id is not null and content_sha256 is distinct from
      encode(extensions.digest(publication_snapshot::text,'sha256'),'hex') then 'x' end,
    case when price_option_count=0 or default_count<>1
      or (price_option_count=1 and required_selection_count<>0)
      or (price_option_count>1 and required_selection_count<>price_option_count)
      or invalid_option_count>0 or duplicate_option_count>0
      or not supported_areas_valid or missing_area_count>0 then 'x' end,
    case when not legal_ready or not invoice_fee_ready then 'x' end,
    case when valid_from is not null and valid_from>now() then 'x' end,
    case when valid_to is not null and valid_to<=now() then 'x' end,
    case when channel='website' and (
      public_offer_id is null or not coalesce(website_enabled,false)
      or not coalesce(website_cta_enabled,false)
      or not coalesce(is_public,false)
      or coalesce(website_publication_status,'missing')<>'published'
    ) then 'x' end
  ]::text[],null))=0 visible
from graph;

-- Strict exposure model remains fail-closed and is now explicitly separated
-- from diagnostics.
create view public.canonical_visible_public_contracts_v
with (security_invoker=true)
as
select visible.*
from public.canonical_public_contract_offers_v visible
where exists(
  select 1 from public.canonical_public_contract_diagnostics_v diagnostic
  where diagnostic.company_id=visible.company_id
    and diagnostic.source_contract_offer_id=visible.source_contract_offer_id
    and diagnostic.channel='website'
    and diagnostic.visible
);

-- API channel feed uses the same immutable top-level price_options snapshot.
create or replace function public.gridex_list_external_api_contracts(
  p_company_id uuid,p_customer_type text default null
) returns table(data jsonb)
language sql
stable
security definer
set search_path=public,extensions,pg_catalog,pg_temp
as $$
  select jsonb_build_object(
    'offer_reference',pv.offer_reference,
    'name',coalesce(pv.publication_snapshot->'commercial_snapshot'->>'name',
      pv.publication_snapshot->'commercial_snapshot'->>'public_name','Elavtal'),
    'description',coalesce(
      pv.publication_snapshot->'commercial_snapshot'->>'description',
      pv.publication_snapshot->'commercial_snapshot'->>'public_description'),
    'contract_type',coalesce(
      pv.publication_snapshot->'commercial_snapshot'->>'contract_type',
      product_version.contract_type),
    'energy_direction',coalesce(nullif(pv.energy_direction,''),
      nullif(product_version.energy_direction,''),'consumption'),
    'customer_type',pv.customer_type,
    'price_options',coalesce(pv.publication_snapshot->'price_options','[]'::jsonb),
    'pricing',coalesce(
      pv.publication_snapshot->'commercial_snapshot'->'pricing',
      pv.publication_snapshot->'commercial_snapshot','{}'::jsonb),
    'valid_from',pv.valid_from,'valid_to',pv.valid_to,'channel','api'
  )
  from public.contract_publication_versions pv
  join public.contract_publications publication
    on publication.id=pv.contract_publication_id
  join public.tenant_contract_assignments assignment
    on assignment.id=publication.assignment_id
  join public.tenant_contract_channels channel_row
    on channel_row.assignment_id=assignment.id and channel_row.channel='api'
  join public.contract_product_versions product_version
    on product_version.id=pv.contract_product_version_id
  join public.companies company on company.id=assignment.company_id
  where assignment.company_id=p_company_id and company.status='active'
    and nullif(btrim(company.external_tenant_reference),'') is not null
    and assignment.status='active' and assignment.api_publication_allowed
    and publication.channel='api' and publication.status='published'
    and pv.channel='api' and pv.status='published' and pv.locked_at is not null
    and pv.content_sha256=encode(
      extensions.digest(pv.publication_snapshot::text,'sha256'),'hex')
    and jsonb_array_length(coalesce(
      pv.publication_snapshot->'price_options','[]'::jsonb))>0
    and channel_row.status='active'
    and (assignment.valid_from is null or assignment.valid_from<=
      (now() at time zone 'Europe/Stockholm')::date)
    and (assignment.valid_to is null or assignment.valid_to>=
      (now() at time zone 'Europe/Stockholm')::date)
    and (channel_row.valid_from is null or channel_row.valid_from<=now())
    and (channel_row.valid_to is null or channel_row.valid_to>now())
    and (pv.valid_from is null or pv.valid_from<=now())
    and (pv.valid_to is null or pv.valid_to>now())
    and (p_customer_type is null or pv.customer_type='both'
      or pv.customer_type=p_customer_type)
    and exists(
      select 1 from public.canonical_public_contract_diagnostics_v diagnostic
      where diagnostic.publication_version_id=pv.id
        and diagnostic.channel='api' and diagnostic.visible
        and diagnostic.snapshot_source_contract_offer_id=
          diagnostic.source_contract_offer_id::text
    )
  order by pv.published_at desc nulls last,pv.created_at desc
$$;

-- Dry-run report. It never mutates data and intentionally classifies ambiguity
-- as manual review.
create or replace function public.gridex_preview_public_contract_backfill_v1(
  p_company_id uuid default null,p_offer_id uuid default null,
  p_publication_version_id uuid default null,p_channel text default null
) returns table(
  company_id uuid,external_tenant_reference text,offer_id uuid,
  offer_reference text,publication_id uuid,publication_version_id uuid,
  channel text,current_status text,detected_problem text,
  proposed_action text,safe_to_apply boolean,manual_review_reason text
)
language sql
stable
security definer
set search_path=public,pg_catalog,pg_temp
as $$
with candidates as (
  select diagnostic.*,
    exists(select 1 from public.contract_price_options template
      where template.company_id=diagnostic.company_id
        and template.contract_product_version_id=(select pv.contract_product_version_id
          from public.contract_publication_versions pv
          where pv.id=diagnostic.publication_version_id)
        and template.price_plan_version_id=(select pv.price_plan_version_id
          from public.contract_publication_versions pv
          where pv.id=diagnostic.publication_version_id)
        and template.contract_publication_version_id is null) template_exists,
    exists(select 1 from public.contract_price_options snapshot_option
      where snapshot_option.contract_publication_version_id=
        diagnostic.publication_version_id) snapshot_exists,
    (select count(*)
      from public.contract_price_options snapshot_option
      where snapshot_option.contract_publication_version_id=
        diagnostic.publication_version_id) snapshot_option_count,
    (select count(*)
      from public.contract_price_options snapshot_option
      where snapshot_option.contract_publication_version_id=
          diagnostic.publication_version_id
        and not exists(
          select 1 from public.contract_price_options template
          where template.company_id=snapshot_option.company_id
            and template.contract_product_version_id=
              snapshot_option.contract_product_version_id
            and template.price_plan_version_id=
              snapshot_option.price_plan_version_id
            and template.contract_publication_version_id is null
            and template.option_reference=snapshot_option.option_reference
            and template.option_code=snapshot_option.option_code
        )) template_missing_count,
    (select count(distinct prior.contract_publication_version_id)
      from public.contract_price_options prior
      join public.contract_publication_versions current_version
        on current_version.id=diagnostic.publication_version_id
      where prior.company_id=diagnostic.company_id
        and prior.contract_product_version_id=current_version.contract_product_version_id
        and prior.price_plan_version_id=current_version.price_plan_version_id
        and prior.contract_publication_version_id is not null
        and prior.contract_publication_version_id<>diagnostic.publication_version_id
    ) prior_snapshot_source_count
  from public.canonical_public_contract_diagnostics_v diagnostic
  where (diagnostic.publication_version_id is null
      or diagnostic.publication_version_status in (
        'published','paused','ended','draft','review'))
    and (p_company_id is null or diagnostic.company_id=p_company_id)
    and (p_offer_id is null or diagnostic.source_contract_offer_id=p_offer_id)
    and (p_publication_version_id is null
      or diagnostic.publication_version_id=p_publication_version_id)
    and (p_channel is null or diagnostic.channel=lower(p_channel))
)
select c.company_id,c.external_tenant_reference,
  c.source_contract_offer_id,c.offer_reference,c.publication_id,
  c.publication_version_id,c.channel,
  coalesce(c.publication_version_status,c.channel_state),
  array_to_string(c.blockers,','),
  case
    when c.publication_version_id is null then 'MANUAL_CHANNEL_OR_PUBLICATION_REVIEW'
    when c.price_option_count=0 then 'MATERIALIZE_PRICE_OPTION_SNAPSHOT'
    when c.missing_area_count>0 then 'COMPLETE_AREA_PRICE_RELATIONS'
    when c.template_missing_count>0 and c.snapshot_exists
      then 'RESTORE_TEMPLATE_COPY'
    else 'REFINALIZE_SNAPSHOT_AND_REVISION'
  end,
  (
    c.publication_version_id is not null
    and (c.price_option_count>0 or c.template_exists
      or c.snapshot_exists or c.prior_snapshot_source_count=1)
    and c.legal_ready
    and c.invoice_fee_ready
    and c.assignment_id is not null
    and c.channel_id is not null
    and c.snapshot_source_contract_offer_id=
      c.source_contract_offer_id::text
    and c.duplicate_option_count=0
    and c.supported_areas_valid
    and (c.missing_area_count=0 or c.template_exists)
  ),
  case
    when c.publication_version_id is null then 'PUBLICATION_VERSION_MISSING'
    when c.snapshot_source_contract_offer_id is distinct from
      c.source_contract_offer_id::text
      then 'SOURCE_OFFER_NOT_DETERMINISTIC'
    when c.duplicate_option_count>0
      then 'PRICE_OPTION_DUPLICATES_REQUIRE_REVIEW'
    when not c.supported_areas_valid
      then 'SUPPORTED_PRICE_AREAS_INVALID'
    when not c.legal_ready then 'LEGAL_BUNDLE_NOT_DETERMINISTIC'
    when not c.invoice_fee_ready then 'INVOICE_FEE_CONFIGURATION_MISSING'
    when c.assignment_id is null then 'TENANT_ASSIGNMENT_MISSING'
    when c.channel_id is null then 'CHANNEL_INTENT_NOT_PROVEN'
    when c.missing_area_count>0 and not c.template_exists
      then 'SUPPORTED_AREA_PRICE_SOURCE_MISSING'
    when not (c.price_option_count>0 or c.template_exists
      or c.snapshot_exists or c.prior_snapshot_source_count=1)
      then case when c.prior_snapshot_source_count>1
        then 'PRICE_SOURCE_AMBIGUOUS'
        else 'PRICE_SOURCE_NOT_DETERMINISTIC' end
    else null
  end
from candidates c
where cardinality(c.blockers)>0
   or c.template_missing_count>0
order by c.company_id,c.source_contract_offer_id,c.channel
$$;

create or replace function public.gridex_apply_public_contract_backfill_v1(
  p_company_id uuid default null,p_offer_id uuid default null,
  p_publication_version_id uuid default null,p_channel text default null,
  p_actor_user_id uuid default null
) returns table(
  company_id uuid,offer_id uuid,publication_version_id uuid,channel text,
  action text,applied boolean,details jsonb
)
language plpgsql
security definer
set search_path=public,extensions,pg_catalog,pg_temp
as $$
declare
  candidate record;
  result jsonb;
begin
  if p_actor_user_id is null then
    raise exception using errcode='22023',
      message='PUBLICATION_BACKFILL_ACTOR_REQUIRED';
  end if;
  for candidate in
    select * from public.gridex_preview_public_contract_backfill_v1(
      p_company_id,p_offer_id,p_publication_version_id,p_channel
    )
  loop
    if not candidate.safe_to_apply then
      with review as (
        select candidate.company_id company_id,
          coalesce(
            (select pv.price_plan_version_id
              from public.contract_publication_versions pv
              where pv.id=candidate.publication_version_id),
            (select offer.price_plan_version_id
              from public.contract_offers offer
              where offer.id=candidate.offer_id)
          ) price_plan_version_id,
          case when candidate.publication_version_id is null
            then 'contract_offers' else 'contract_publication_versions' end
            source_table,
          coalesce(candidate.publication_version_id,candidate.offer_id)
            source_id,
          coalesce(candidate.manual_review_reason,
            'PUBLICATION_BACKFILL_UNSAFE') reason_code,
          jsonb_build_object('channel',candidate.channel,
            'detected_problem',candidate.detected_problem) details
      )
      insert into public.contract_pricing_migration_reviews(
        company_id,price_plan_version_id,source_table,source_id,
        reason_code,details
      )
      select review.company_id,review.price_plan_version_id,
        review.source_table,review.source_id,review.reason_code,review.details
      from review
      where not exists(
        select 1 from public.contract_pricing_migration_reviews existing
        where existing.company_id=review.company_id
          and existing.price_plan_version_id is not distinct from
            review.price_plan_version_id
          and existing.source_table=review.source_table
          and existing.source_id is not distinct from review.source_id
          and existing.reason_code=review.reason_code
      );
      company_id:=candidate.company_id;offer_id:=candidate.offer_id;
      publication_version_id:=candidate.publication_version_id;
      channel:=candidate.channel;action:='MANUAL_REVIEW';applied:=false;
      details:=jsonb_build_object('reason',candidate.manual_review_reason);
      return next;
      continue;
    end if;

    begin
      -- Restore a reusable template copy only when the published snapshot is
      -- the deterministic source. Commercial values are copied unchanged.
      with version_row as (
        select * from public.contract_publication_versions
        where id=candidate.publication_version_id
      ), inserted as (
        insert into public.contract_price_options(
          company_id,contract_product_version_id,price_plan_version_id,
          contract_publication_version_id,option_reference,option_code,
          customer_name,internal_description,contract_type,binding_months,
          notice_months,auto_renew_enabled,renewal_term_months,valid_from,
          valid_to,earliest_start_date,latest_start_date,status,sort_order,
          version_number,metadata,created_by,customer_type,is_default,
          selection_required
        )
        select source.company_id,source.contract_product_version_id,
          source.price_plan_version_id,null,source.option_reference,
          source.option_code,source.customer_name,source.internal_description,
          source.contract_type,source.binding_months,source.notice_months,
          source.auto_renew_enabled,source.renewal_term_months,
          source.valid_from,source.valid_to,source.earliest_start_date,
          source.latest_start_date,source.status,source.sort_order,
          source.version_number,coalesce(source.metadata,'{}'::jsonb)
            ||jsonb_build_object(
              'restored_from_publication_price_option_id',source.id),
          coalesce(p_actor_user_id,source.created_by),source.customer_type,
          source.is_default,source.selection_required
        from public.contract_price_options source
        join version_row v on v.id=source.contract_publication_version_id
        where not exists(select 1 from public.contract_price_options template
          where template.company_id=source.company_id
            and template.contract_product_version_id=
              source.contract_product_version_id
            and template.price_plan_version_id=source.price_plan_version_id
            and template.contract_publication_version_id is null
            and template.option_reference=source.option_reference
            and template.option_code=source.option_code)
        on conflict do nothing
        returning id,metadata
      )
      insert into public.contract_price_option_area_prices(
        company_id,contract_price_option_id,price_plan_version_id,
        price_row_reference,price_area,amount,unit,vat_treatment,
        valid_from,valid_to,metadata,created_by,status
      )
      select template.company_id,template.id,template.price_plan_version_id,
        area.price_row_reference,area.price_area,area.amount,area.unit,
        area.vat_treatment,area.valid_from,area.valid_to,
        coalesce(area.metadata,'{}'::jsonb)||jsonb_build_object(
          'restored_from_area_price_id',area.id),
        coalesce(p_actor_user_id,area.created_by),area.status
      from inserted template
      join public.contract_price_option_area_prices area
        on area.contract_price_option_id=
          (template.metadata->>'restored_from_publication_price_option_id')::uuid
      on conflict(contract_price_option_id,price_area) do nothing;

      result:=public.gridex_finalize_contract_publication_v1(
        candidate.publication_version_id,p_actor_user_id,true
      );
      company_id:=candidate.company_id;offer_id:=candidate.offer_id;
      publication_version_id:=candidate.publication_version_id;
      channel:=candidate.channel;action:=candidate.proposed_action;
      applied:=true;details:=result;
    exception
      when sqlstate '23503' or sqlstate '23505' or sqlstate '23514'
        or sqlstate '55000' or sqlstate 'P0001' or sqlstate 'P0002' then
        insert into public.contract_pricing_migration_reviews(
          company_id,price_plan_version_id,source_table,source_id,
          reason_code,details
        )
        select candidate.company_id,pv.price_plan_version_id,
          'contract_publication_versions',candidate.publication_version_id,
          'PUBLICATION_BACKFILL_APPLY_BLOCKED',
          jsonb_build_object('channel',candidate.channel,
            'sqlstate',sqlstate,'message',sqlerrm)
        from public.contract_publication_versions pv
        where pv.id=candidate.publication_version_id
        on conflict do nothing;
        company_id:=candidate.company_id;offer_id:=candidate.offer_id;
        publication_version_id:=candidate.publication_version_id;
        channel:=candidate.channel;action:='MANUAL_REVIEW';applied:=false;
        details:=jsonb_build_object('reason','APPLY_VALIDATION_FAILED',
          'sqlstate',sqlstate,'message',sqlerrm);
    end;
    return next;
  end loop;
end $$;

revoke all on function public.gridex_lock_commercial_child()
  from public,anon,authenticated;
revoke all on function public.gridex_reject_locked_row_mutation()
  from public,anon,authenticated;
revoke all on function public.gridex_contract_publication_revision_trigger()
  from public,anon,authenticated;
revoke all on function public.gridex_assert_price_option_snapshot_unique_v1()
  from public,anon,authenticated;
revoke all on function public.gridex_assert_area_price_snapshot_unique_v1()
  from public,anon,authenticated;
revoke all on function public.gridex_supported_price_areas_v1(uuid)
  from public,anon,authenticated;
revoke all on function public.gridex_invoice_fee_ready_v1(numeric,jsonb)
  from public,anon,authenticated;
revoke all on function public.gridex_publication_price_options_json_v1(uuid)
  from public,anon,authenticated;
revoke all on function public.gridex_validate_publication_graph_v1(uuid)
  from public,anon,authenticated;
revoke all on function public.gridex_materialize_publication_price_options_v1(uuid,uuid)
  from public,anon,authenticated;
revoke all on function public.gridex_finalize_contract_publication_v1(uuid,uuid,boolean)
  from public,anon,authenticated;
revoke all on function public.gridex_preview_public_contract_backfill_v1(uuid,uuid,uuid,text)
  from public,anon,authenticated;
revoke all on function public.gridex_apply_public_contract_backfill_v1(uuid,uuid,uuid,text,uuid)
  from public,anon,authenticated;
revoke all on function public.gridex_list_external_api_contracts(uuid,text)
  from public,anon,authenticated;
grant select on public.canonical_visible_public_contracts_v,
  public.canonical_public_contract_diagnostics_v
  to authenticated,service_role;
grant execute on function public.gridex_preview_public_contract_backfill_v1(uuid,uuid,uuid,text)
  to service_role;
grant execute on function public.gridex_apply_public_contract_backfill_v1(uuid,uuid,uuid,text,uuid)
  to service_role;
grant execute on function public.gridex_finalize_contract_publication_v1(uuid,uuid,boolean)
  to service_role;
grant execute on function public.gridex_list_external_api_contracts(uuid,text)
  to service_role;

commit;
