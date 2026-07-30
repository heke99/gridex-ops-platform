-- Canonical publication-bound price options and complete website commercial
-- assertions. Forward-only: historical migration bytes are intentionally
-- untouched.

begin;

alter table public.contract_price_options
  add column if not exists contract_publication_version_id uuid
    references public.contract_publication_versions(id) on delete restrict,
  add column if not exists customer_type text,
  add column if not exists is_default boolean,
  add column if not exists selection_required boolean;

alter table public.contract_price_options
  drop constraint if exists contract_price_options_customer_type_check,
  add constraint contract_price_options_customer_type_check check (
    customer_type is null or customer_type in ('private','business','both')
  );

alter table public.contract_price_option_area_prices
  add column if not exists status text not null default 'active';

alter table public.contract_price_option_area_prices
  drop constraint if exists contract_price_option_area_prices_status_check,
  add constraint contract_price_option_area_prices_status_check check (
    status in ('active','paused','archived')
  );

alter table public.website_contract_quotes
  add column if not exists site_count integer not null default 1;

alter table public.website_contract_quotes
  drop constraint if exists website_contract_quotes_site_count_check,
  add constraint website_contract_quotes_site_count_check check (site_count > 0);

alter table public.contract_price_options
  drop constraint if exists contract_price_options_price_plan_version_id_option_reference_key,
  drop constraint if exists contract_price_options_price_plan_version_id_option_code_key;

create unique index if not exists contract_price_options_template_reference_uidx
  on public.contract_price_options(
    contract_product_version_id,price_plan_version_id,option_reference
  )
  where contract_publication_version_id is null;
create unique index if not exists contract_price_options_template_code_uidx
  on public.contract_price_options(
    contract_product_version_id,price_plan_version_id,option_code
  )
  where contract_publication_version_id is null;
create unique index if not exists contract_price_options_publication_reference_uidx
  on public.contract_price_options(
    contract_publication_version_id,option_reference
  )
  where contract_publication_version_id is not null;
create unique index if not exists contract_price_options_publication_code_uidx
  on public.contract_price_options(
    contract_publication_version_id,option_code
  )
  where contract_publication_version_id is not null;
create unique index if not exists contract_price_options_publication_default_uidx
  on public.contract_price_options(contract_publication_version_id)
  where contract_publication_version_id is not null
    and status='active'
    and is_default is true;
create index if not exists contract_price_options_publication_lookup_idx
  on public.contract_price_options(
    company_id,contract_publication_version_id,status,sort_order
  );

-- Locked price-plan content remains immutable. A one-time binding/default
-- projection may only populate the four new publication policy columns.
create or replace function public.gridex_lock_commercial_child()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_price_plan_version_id uuid;
  v_old_projection jsonb;
  v_new_projection jsonb;
begin
  v_price_plan_version_id:=old.price_plan_version_id;
  if exists(
    select 1 from public.price_plan_versions version_row
    where version_row.id=v_price_plan_version_id
      and version_row.locked_at is not null
  ) then
    if tg_op='UPDATE' and tg_table_name='contract_price_options' then
      v_old_projection:=to_jsonb(old)
        -array[
          'contract_publication_version_id','customer_type',
          'is_default','selection_required'
        ]::text[];
      v_new_projection:=to_jsonb(new)
        -array[
          'contract_publication_version_id','customer_type',
          'is_default','selection_required'
        ]::text[];
      if v_old_projection=v_new_projection
        and (
          old.contract_publication_version_id is not distinct from
            new.contract_publication_version_id
          or (
            old.contract_publication_version_id is null
            and new.contract_publication_version_id is not null
          )
        )
        and (
          old.customer_type is not distinct from new.customer_type
          or (old.customer_type is null and new.customer_type is not null)
        )
        and (
          old.is_default is not distinct from new.is_default
          or (old.is_default is null and new.is_default is not null)
        )
        and (
          old.selection_required is not distinct from new.selection_required
          or (
            old.selection_required is null
            and new.selection_required is not null
          )
        )
        and to_jsonb(old) is distinct from to_jsonb(new) then
        return new;
      end if;
    end if;
    raise exception using
      errcode='55000',
      message='locked_commercial_pricing_is_immutable';
  end if;
  return case when tg_op='DELETE' then old else new end;
end
$$;

-- Extend the existing tenant/product/plan scope guard with the publication
-- chain. This is the definitive write-time identity check.
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
    if new.contract_publication_version_id is not null and not exists(
      select 1
      from public.contract_publication_versions publication
      join public.contract_publications publication_root
        on publication_root.id=publication.contract_publication_id
      join public.tenant_contract_assignments assignment
        on assignment.id=publication_root.assignment_id
      where publication.id=new.contract_publication_version_id
        and assignment.company_id=new.company_id
        and publication.contract_product_version_id=
          new.contract_product_version_id
        and publication.price_plan_version_id=new.price_plan_version_id
        and (
          new.customer_type='both'
          or publication.customer_type='both'
          or new.customer_type=publication.customer_type
        )
    ) then
      raise exception using
        errcode='23514',
        message='commercial_option_publication_chain_mismatch';
    end if;
  end if;
  return new;
end
$$;

-- Deterministic backfill: bind only when the product/plan pair has exactly one
-- publication version. Preserve every ambiguous row and create an explicit
-- review item.
with candidates as (
  select
    option_row.id option_id,
    (array_agg(publication.id order by publication.id))[1] publication_id,
    count(*) publication_count
  from public.contract_price_options option_row
  join public.contract_publication_versions publication
    on publication.contract_product_version_id=
      option_row.contract_product_version_id
   and publication.price_plan_version_id=option_row.price_plan_version_id
  join public.contract_publications publication_root
    on publication_root.id=publication.contract_publication_id
  join public.tenant_contract_assignments assignment
    on assignment.id=publication_root.assignment_id
   and assignment.company_id=option_row.company_id
  where option_row.contract_publication_version_id is null
  group by option_row.id
)
update public.contract_price_options option_row
set
  contract_publication_version_id=candidates.publication_id,
  customer_type=coalesce(
    nullif(option_row.metadata->>'customer_type',''),
    publication.customer_type
  ),
  is_default=case
    when option_row.metadata ? 'is_default'
      then (option_row.metadata->>'is_default')::boolean
    when option_row.metadata ? 'default'
      then (option_row.metadata->>'default')::boolean
    else null
  end,
  selection_required=case
    when option_row.metadata ? 'selection_required'
      then (option_row.metadata->>'selection_required')::boolean
    else null
  end
from candidates
join public.contract_publication_versions publication
  on publication.id=candidates.publication_id
where option_row.id=candidates.option_id
  and candidates.publication_count=1;

with single_option_publications as (
  select contract_publication_version_id
  from public.contract_price_options
  where contract_publication_version_id is not null
    and status='active'
  group by contract_publication_version_id
  having count(*)=1
)
update public.contract_price_options option_row
set
  is_default=coalesce(option_row.is_default,true),
  selection_required=coalesce(option_row.selection_required,false)
from single_option_publications single_row
where option_row.contract_publication_version_id=
  single_row.contract_publication_version_id
  and (
    option_row.is_default is null
    or option_row.selection_required is null
  );

insert into public.contract_pricing_migration_reviews(
  company_id,price_plan_version_id,source_table,source_id,reason_code,details
)
select
  option_row.company_id,
  option_row.price_plan_version_id,
  'contract_price_options',
  option_row.id,
  case
    when option_row.contract_publication_version_id is null
      then 'price_option_publication_ambiguous'
    when option_row.customer_type is null
      then 'price_option_customer_type_missing'
    when option_row.is_default is null
      then 'price_option_default_missing'
    else 'price_option_selection_policy_missing'
  end,
  jsonb_build_object(
    'option_reference',option_row.option_reference,
    'contract_product_version_id',option_row.contract_product_version_id
  )
from public.contract_price_options option_row
where option_row.contract_publication_version_id is null
   or option_row.customer_type is null
   or option_row.is_default is null
   or option_row.selection_required is null
on conflict do nothing;

create or replace function public.gridex_validate_price_option_publication_v1(
  p_company_id uuid,
  p_publication_version_id uuid
) returns jsonb
language sql
stable
set search_path=public,pg_temp
as $$
with publication as (
  select
    version_row.*,
    assignment.company_id
  from public.contract_publication_versions version_row
  join public.contract_publications publication_root
    on publication_root.id=version_row.contract_publication_id
  join public.tenant_contract_assignments assignment
    on assignment.id=publication_root.assignment_id
  where version_row.id=p_publication_version_id
    and assignment.company_id=p_company_id
),
options as (
  select option_row.*
  from public.contract_price_options option_row
  join publication
    on publication.id=option_row.contract_publication_version_id
  where option_row.company_id=p_company_id
),
diagnostics as (
  select 'price_option_reference_missing' code,
    null::text price_option_reference,null::text price_area
  where not exists(select 1 from options where status='active')
  union all
  select 'price_option_default_missing',null,null
  where (select count(*) from options
    where status='active' and is_default is true)=0
  union all
  select 'price_option_default_duplicate',null,null
  where (select count(*) from options
    where status='active' and is_default is true)>1
  union all
  select 'price_option_selection_policy_inconsistent',null,null
  where (select count(*) from options
    where status='active' and selection_required is null)>0
     or (select count(distinct selection_required) from options
       where status='active')>1
  union all
  select 'price_option_customer_type_invalid',
    option_row.option_reference,null
  from options option_row
  join publication on true
  where option_row.customer_type is null
     or not (
       option_row.customer_type='both'
       or publication.customer_type='both'
       or option_row.customer_type=publication.customer_type
     )
  union all
  select 'price_option_product_plan_mismatch',
    option_row.option_reference,null
  from options option_row
  join publication on true
  where option_row.contract_product_version_id
      <>publication.contract_product_version_id
     or option_row.price_plan_version_id
      is distinct from publication.price_plan_version_id
  union all
  select case
      when option_row.status='paused' then 'price_option_paused'
      when option_row.status<>'active' then 'price_option_inactive'
      when option_row.valid_from is not null
        and option_row.valid_from>
          (now() at time zone 'Europe/Stockholm')::date
        then 'price_option_not_yet_valid'
      else 'price_option_expired'
    end,
    option_row.option_reference,null
  from options option_row
  where option_row.status<>'active'
     or (
       option_row.valid_from is not null
       and option_row.valid_from>
         (now() at time zone 'Europe/Stockholm')::date
     )
     or (
       option_row.valid_to is not null
       and option_row.valid_to<
         (now() at time zone 'Europe/Stockholm')::date
     )
  union all
  select 'fixed_price_area_missing',
    option_row.option_reference,required_area.price_area
  from options option_row
  cross join (
    values ('SE1'::text),('SE2'),('SE3'),('SE4')
  ) required_area(price_area)
  where option_row.status='active'
    and option_row.contract_type='fixed'
    and not exists(
      select 1
      from public.contract_price_option_area_prices area_row
      where area_row.company_id=p_company_id
        and area_row.contract_price_option_id=option_row.id
        and area_row.price_area=required_area.price_area
        and area_row.status='active'
        and (
          area_row.valid_from is null
          or area_row.valid_from<=
            (now() at time zone 'Europe/Stockholm')::date
        )
        and (
          area_row.valid_to is null
          or area_row.valid_to>=
            (now() at time zone 'Europe/Stockholm')::date
        )
        and area_row.unit in ('ore_per_kwh','sek_per_kwh')
    )
)
select coalesce(
  jsonb_agg(
    jsonb_strip_nulls(jsonb_build_object(
      'code',code,
      'offer_reference',(select offer_reference from publication),
      'price_option_reference',price_option_reference,
      'price_area',price_area
    ))
    order by code,price_option_reference,price_area
  ),
  '[]'::jsonb
)
from diagnostics
$$;

revoke all on function public.gridex_validate_price_option_publication_v1(
  uuid,uuid
) from public,anon,authenticated;
grant execute on function public.gridex_validate_price_option_publication_v1(
  uuid,uuid
) to service_role;

-- New publication versions receive immutable copies of the matching unbound
-- templates. Publishing fails closed when no complete canonical option graph
-- can be built.
create or replace function public.gridex_prepare_price_options_for_publication_v1()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_company_id uuid;
  v_diagnostics jsonb;
begin
  if new.status<>'published' then return new; end if;

  select assignment.company_id
    into v_company_id
  from public.contract_publications publication_root
  join public.tenant_contract_assignments assignment
    on assignment.id=publication_root.assignment_id
  where publication_root.id=new.contract_publication_id;

  if not exists(
    select 1 from public.contract_price_options
    where contract_publication_version_id=new.id
  ) then
    with inserted as (
      insert into public.contract_price_options(
        company_id,contract_product_version_id,price_plan_version_id,
        contract_publication_version_id,option_reference,option_code,
        customer_name,internal_description,contract_type,binding_months,
        notice_months,auto_renew_enabled,renewal_term_months,valid_from,
        valid_to,earliest_start_date,latest_start_date,status,sort_order,
        version_number,metadata,created_by,customer_type,is_default,
        selection_required
      )
      select
        template.company_id,template.contract_product_version_id,
        template.price_plan_version_id,new.id,template.option_reference,
        template.option_code,template.customer_name,
        template.internal_description,template.contract_type,
        template.binding_months,template.notice_months,
        template.auto_renew_enabled,template.renewal_term_months,
        template.valid_from,template.valid_to,template.earliest_start_date,
        template.latest_start_date,template.status,template.sort_order,
        template.version_number,
        template.metadata||jsonb_build_object(
          'materialized_from_price_option_id',template.id
        ),
        template.created_by,
        coalesce(
          template.customer_type,
          nullif(template.metadata->>'customer_type',''),
          new.customer_type
        ),
        coalesce(
          template.is_default,
          case when template.metadata ? 'is_default'
            then (template.metadata->>'is_default')::boolean
            else null
          end,
          count(*) over()=1
        ),
        coalesce(
          template.selection_required,
          case when template.metadata ? 'selection_required'
            then (template.metadata->>'selection_required')::boolean
            else null
          end,
          count(*) over()>1
        )
      from public.contract_price_options template
      where template.company_id=v_company_id
        and template.contract_product_version_id=
          new.contract_product_version_id
        and template.price_plan_version_id=new.price_plan_version_id
        and template.contract_publication_version_id is null
      returning id,metadata
    )
    insert into public.contract_price_option_area_prices(
      company_id,contract_price_option_id,price_plan_version_id,
      price_row_reference,price_area,amount,unit,vat_treatment,
      valid_from,valid_to,metadata,created_by,status
    )
    select
      area_row.company_id,inserted.id,area_row.price_plan_version_id,
      area_row.price_row_reference,area_row.price_area,area_row.amount,
      area_row.unit,area_row.vat_treatment,area_row.valid_from,
      area_row.valid_to,area_row.metadata,area_row.created_by,
      area_row.status
    from inserted
    join public.contract_price_option_area_prices area_row
      on area_row.contract_price_option_id=
        (inserted.metadata->>'materialized_from_price_option_id')::uuid;
  end if;

  v_diagnostics:=public.gridex_validate_price_option_publication_v1(
    v_company_id,new.id
  );
  if jsonb_array_length(v_diagnostics)>0 then
    raise exception using
      errcode='23514',
      message='contract_publication_price_options_not_ready',
      detail=v_diagnostics::text;
  end if;
  return new;
end
$$;

drop trigger if exists contract_publication_price_options_ready
  on public.contract_publication_versions;
create trigger contract_publication_price_options_ready
before insert or update of status
on public.contract_publication_versions
for each row
when (new.status='published')
execute function public.gridex_prepare_price_options_for_publication_v1();

create or replace function public.gridex_reject_quote_site_count_mutation_v1()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if old.site_count is distinct from new.site_count then
    raise exception using
      errcode='55000',
      message='website_quote_commercial_snapshot_immutable';
  end if;
  return new;
end
$$;

drop trigger if exists website_contract_quotes_site_count_immutable
  on public.website_contract_quotes;
create trigger website_contract_quotes_site_count_immutable
before update of site_count on public.website_contract_quotes
for each row execute function
  public.gridex_reject_quote_site_count_mutation_v1();

-- Keep the previously completed atomic customer-graph implementation as a
-- named delegate, then make the canonical public entry point explicit. This
-- final definition validates every v3 commercial assertion against both the
-- immutable row and its snapshot before the existing lock/consume transaction
-- is entered.
alter function public.gridex_onboard_customer_graph(jsonb)
  rename to gridex_onboard_customer_graph_quote_commit_v2;

create or replace function public.gridex_onboard_customer_graph(
  p_command jsonb
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_catalog,pg_temp
as $$
declare
  v_channel text:=nullif(p_command->>'channel','');
  v_company_id uuid:=nullif(p_command->>'company_id','')::uuid;
  v_quote_command jsonb:=p_command->'quote';
  v_contract_command jsonb:=p_command->'contract';
  v_quote public.website_contract_quotes%rowtype;
  v_command_components text[];
  v_contract_components text[];
begin
  if v_channel<>'website' then
    return public.gridex_onboard_customer_graph_quote_commit_v2(p_command);
  end if;

  if v_company_id is null
    or jsonb_typeof(coalesce(v_quote_command,'null'::jsonb))<>'object'
    or jsonb_typeof(coalesce(v_contract_command,'null'::jsonb))<>'object'
    or nullif(v_quote_command->>'quote_reference','') is null then
    raise exception using
      errcode='22023',
      message='website_onboarding_quote_commit_payload_required';
  end if;

  select quote.*
    into v_quote
  from public.website_contract_quotes quote
  where quote.company_id=v_company_id
    and quote.quote_reference=v_quote_command->>'quote_reference'
  for share;
  if not found then
    raise exception using
      errcode='P0002',
      message='website_quote_not_found_for_tenant';
  end if;

  if v_quote.quote_hash_version='v3_commercial_selection' then
    if nullif(v_quote.price_option_reference,'') is null
      or nullif(v_quote.invoice_delivery_method,'') is null
      or v_quote.site_count<1
      or jsonb_typeof(
        coalesce(
          v_quote.quote_snapshot->'selected_component_references',
          'null'::jsonb
        )
      )<>'array' then
      raise exception using
        errcode='23514',
        message='website_quote_commercial_selection_incomplete';
    end if;

    v_command_components:=array(
      select value
      from jsonb_array_elements_text(
        coalesce(
          v_quote_command->'selected_component_references',
          '[]'::jsonb
        )
      )
      order by value
    );
    v_contract_components:=array(
      select value
      from jsonb_array_elements_text(
        coalesce(
          v_contract_command->'selected_component_references',
          '[]'::jsonb
        )
      )
      order by value
    );

    if v_quote.price_option_reference is distinct from
        v_quote_command->>'price_option_reference'
      or v_quote.price_option_reference is distinct from
        v_contract_command->>'price_option_reference'
      or v_quote.area_price_reference is distinct from
        nullif(v_quote_command->>'area_price_reference','')
      or v_quote.area_price_reference is distinct from
        nullif(v_contract_command->>'area_price_reference','')
      or v_quote.invoice_delivery_method is distinct from
        v_quote_command->>'invoice_delivery_method'
      or v_quote.invoice_delivery_method is distinct from
        v_contract_command->>'invoice_delivery_method'
      or v_quote.site_count is distinct from
        nullif(v_quote_command->>'site_count','')::integer
      or v_quote.site_count is distinct from
        nullif(v_contract_command->>'site_count','')::integer
      or array(
        select value
        from unnest(v_quote.selected_component_references) value
        order by value
      ) is distinct from v_command_components
      or array(
        select value
        from unnest(v_quote.selected_component_references) value
        order by value
      ) is distinct from v_contract_components then
      raise exception using
        errcode='23514',
        message='website_quote_commercial_assertion_mismatch';
    end if;

    if v_quote.price_option_reference is distinct from
        v_quote.quote_snapshot->>'price_option_reference'
      or v_quote.area_price_reference is distinct from
        nullif(v_quote.quote_snapshot->>'area_price_reference','')
      or v_quote.invoice_delivery_method is distinct from
        v_quote.quote_snapshot->>'invoice_delivery_method'
      or v_quote.site_count is distinct from
        nullif(v_quote.quote_snapshot->>'site_count','')::integer
      or array(
        select value
        from unnest(v_quote.selected_component_references) value
        order by value
      ) is distinct from array(
        select value
        from jsonb_array_elements_text(
          v_quote.quote_snapshot->'selected_component_references'
        )
        order by value
      ) then
      raise exception using
        errcode='23514',
        message='website_quote_commercial_snapshot_mismatch';
    end if;
  end if;

  return public.gridex_onboard_customer_graph_quote_commit_v2(p_command);
end
$$;

revoke all on function public.gridex_onboard_customer_graph(jsonb)
  from public,anon,authenticated;
grant execute on function public.gridex_onboard_customer_graph(jsonb)
  to service_role;
revoke all on function
  public.gridex_onboard_customer_graph_quote_commit_v2(jsonb)
  from public,anon,authenticated;
grant execute on function
  public.gridex_onboard_customer_graph_quote_commit_v2(jsonb)
  to service_role;

comment on function public.gridex_onboard_customer_graph(jsonb) is
  'Canonical website commit: validates v3 publication-bound price option, area row, invoice delivery, component selection and site count against the immutable quote snapshot before the atomic graph commit and quote consumption.';

comment on column
  public.contract_price_options.contract_publication_version_id is
  'Immutable publication-version binding. NULL rows are reusable draft templates only.';
comment on column public.contract_price_options.is_default is
  'Exactly one active default is required per published contract publication version.';
comment on column public.contract_price_options.selection_required is
  'When true, clients must explicitly choose price_option_reference; array position is never selection.';
comment on column public.website_contract_quotes.site_count is
  'Immutable v3 commercial assertion included in quote_hash.';

commit;
