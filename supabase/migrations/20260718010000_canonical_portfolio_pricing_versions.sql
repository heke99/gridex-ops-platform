-- Canonical portfolio pricing completion: exact price-plan version rows, percentage bases and immutable monthly evidence.

begin;

-- Self-heal environments where the earlier website-visibility migration was
-- recorded but the physical column is missing. This migration failed before
-- creating any objects when that drift existed, so the repair must happen
-- before trigger definitions and materialization functions reference the field.
alter table public.price_components
  add column if not exists website_card_visible boolean not null default true;

comment on column public.price_components.website_card_visible is
  'Whether this immutable price component may be rendered on the tenant website contract card. Does not affect quote, checkout, contract document or invoice calculation.';

alter table public.price_components
  add column if not exists calculation_base text null;

alter table public.price_components
  drop constraint if exists price_components_calculation_base_check;
alter table public.price_components
  add constraint price_components_calculation_base_check check (
    calculation_base is null or calculation_base in (
      'energy_cost_ex_vat','energy_cost_inc_vat','spot_cost','portfolio_cost',
      'total_variable_cost','invoice_subtotal','monthly_fixed_amount'
    )
  );

comment on column public.price_components.calculation_base is
  'Explicit base for percentage components. Percentage values use the documented 0..100 representation.';

create or replace function public.gridex_sync_price_component_visibility()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_metadata_visible boolean;
  v_metadata_base text;
begin
  if jsonb_typeof(coalesce(new.metadata,'{}'::jsonb)->'visibility')='object'
     and (coalesce(new.metadata,'{}'::jsonb)->'visibility') ? 'website_card' then
    v_metadata_visible:=(new.metadata#>>'{visibility,website_card}')::boolean;
    new.website_card_visible:=v_metadata_visible;
  end if;
  v_metadata_base:=nullif(new.metadata->>'calculation_base','');
  if new.calculation_base is null and v_metadata_base is not null then
    new.calculation_base:=v_metadata_base;
  end if;
  if coalesce(new.unit,'') in ('percent','percentage') and new.calculation_base is null then
    raise exception 'percentage_component_calculation_base_missing';
  end if;
  if coalesce(new.unit,'') in ('percent','percentage') and (new.amount<0 or new.amount>100) then
    raise exception 'percentage_component_out_of_range';
  end if;
  new.metadata:=jsonb_set(
    coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object('calculation_base',new.calculation_base),
    '{visibility}',
    coalesce(coalesce(new.metadata,'{}'::jsonb)->'visibility','{}'::jsonb)||jsonb_build_object(
      'website_card',new.website_card_visible,
      'quote_breakdown',true,
      'checkout',true,
      'contract_document',true,
      'invoice',new.invoice_line_visible
    ),true
  );
  return new;
end $$;

drop trigger if exists price_components_sync_website_visibility on public.price_components;
create trigger price_components_sync_website_visibility
before insert or update of metadata,website_card_visible,invoice_line_visible,calculation_base,unit,amount
on public.price_components
for each row execute function public.gridex_sync_price_component_visibility();

alter table public.portfolio_monthly_prices
  add column if not exists price_plan_id uuid null references public.price_plans(id) on delete restrict,
  add column if not exists price_plan_version_id uuid null references public.price_plan_versions(id) on delete restrict,
  add column if not exists published_at timestamptz null,
  add column if not exists calculation_snapshot jsonb not null default '{}'::jsonb;

alter table public.portfolio_monthly_prices drop constraint if exists portfolio_monthly_prices_status_check;
alter table public.portfolio_monthly_prices add constraint portfolio_monthly_prices_status_check
  check(status in ('draft','confirmed','locked','published','corrected','archived','superseded'));
alter table public.portfolio_monthly_prices drop constraint if exists portfolio_monthly_prices_source_check;
alter table public.portfolio_monthly_prices add constraint portfolio_monthly_prices_source_check
  check(source in ('manual','api','import','contract_price_version'));
alter table public.portfolio_monthly_prices
  drop constraint if exists portfolio_monthly_prices_positive_price_check;

drop index if exists public.ux_portfolio_monthly_prices_active_company_area_month;
create unique index if not exists ux_portfolio_monthly_prices_legacy_active
  on public.portfolio_monthly_prices(company_id,price_area,billing_month)
  where price_plan_version_id is null and superseded_at is null and status<>'superseded';
create unique index if not exists ux_portfolio_monthly_prices_version_area_month
  on public.portfolio_monthly_prices(price_plan_version_id,price_area,billing_month)
  where price_plan_version_id is not null and superseded_at is null and status<>'superseded';
create index if not exists idx_portfolio_monthly_prices_exact_lookup
  on public.portfolio_monthly_prices(company_id,price_plan_version_id,price_area,billing_month,status)
  where superseded_at is null;

create or replace function public.gridex_validate_portfolio_monthly_price_tenant()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_company uuid; v_plan uuid;
begin
  if new.price_plan_version_id is null then return new; end if;
  select company_id,price_plan_id into v_company,v_plan
  from public.price_plan_versions where id=new.price_plan_version_id;
  if v_company is null then raise exception 'portfolio_price_plan_version_missing'; end if;
  if new.company_id<>v_company then raise exception 'portfolio_price_tenant_mismatch'; end if;
  if new.price_plan_id is null then new.price_plan_id:=v_plan; end if;
  if new.price_plan_id<>v_plan then raise exception 'portfolio_price_plan_mismatch'; end if;
  return new;
end $$;

drop trigger if exists portfolio_monthly_prices_validate_tenant on public.portfolio_monthly_prices;
create trigger portfolio_monthly_prices_validate_tenant
before insert or update of company_id,price_plan_id,price_plan_version_id
on public.portfolio_monthly_prices for each row
execute function public.gridex_validate_portfolio_monthly_price_tenant();

create or replace function public.gridex_prevent_locked_portfolio_price_mutation()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if old.price_plan_version_id is not null and old.locked_at is not null then
    raise exception 'locked_portfolio_monthly_price_immutable';
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;

drop trigger if exists portfolio_monthly_prices_locked_immutable on public.portfolio_monthly_prices;
create trigger portfolio_monthly_prices_locked_immutable
before update or delete on public.portfolio_monthly_prices
for each row execute function public.gridex_prevent_locked_portfolio_price_mutation();

create or replace function public.gridex_sync_portfolio_monthly_prices_for_version(p_price_plan_version_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_version record; v_row jsonb; v_month text; v_area text; v_amount numeric; v_existing_id uuid; v_existing_price numeric; v_existing_locked timestamptz; v_status text;
begin
  select * into v_version from public.price_plan_versions where id=p_price_plan_version_id;
  if v_version.id is null then raise exception 'price_plan_version_missing'; end if;
  if jsonb_typeof(coalesce(v_version.snapshot_json,'{}'::jsonb)->'portfolio_monthly_prices') is distinct from 'array' then return; end if;
  v_status:=case when v_version.status in ('published','active','approved') and v_version.locked_at is not null then 'published' else 'draft' end;
  for v_row in select value from jsonb_array_elements(v_version.snapshot_json->'portfolio_monthly_prices') loop
    v_month:=left(coalesce(v_row->>'period_month',v_row->>'billing_month',''),7);
    v_area:=upper(coalesce(v_row->>'price_area_code',v_row->>'price_area',''));
    v_amount:=nullif(coalesce(v_row->>'amount_ore_per_kwh',v_row->>'amount'),'')::numeric;
    if v_month !~ '^\d{4}-\d{2}$' or v_area not in ('SE1','SE2','SE3','SE4') or v_amount is null then
      raise exception 'invalid_portfolio_monthly_price_snapshot';
    end if;
    v_existing_id:=null; v_existing_price:=null; v_existing_locked:=null;
    select id,price_ex_vat_sek_per_kwh,locked_at into v_existing_id,v_existing_price,v_existing_locked
    from public.portfolio_monthly_prices
      where price_plan_version_id=v_version.id and price_area=v_area and billing_month=v_month
        and superseded_at is null and status<>'superseded' limit 1;
    if v_existing_id is not null then
      if v_existing_locked is not null then
        if abs(v_existing_price-(v_amount/100))>0.00000001 then
          raise exception 'locked_portfolio_monthly_price_snapshot_mismatch';
        end if;
      else
        update public.portfolio_monthly_prices set
          price_plan_id=v_version.price_plan_id,price_ex_vat_sek_per_kwh=v_amount/100,
          status=v_status,source='contract_price_version',approved_at=case when v_status='published' then coalesce(v_version.approved_at,now()) end,
          confirmed_at=case when v_status='published' then coalesce(v_version.approved_at,now()) end,
          published_at=case when v_status='published' then coalesce(v_version.published_at,now()) end,
          locked_at=case when v_status='published' then coalesce(v_version.locked_at,now()) end,
          calculation_snapshot=jsonb_build_object('amount_ore_per_kwh',v_amount,'unit','ore_per_kwh','vat_included',false,'price_plan_version_id',v_version.id),updated_at=now()
        where id=v_existing_id;
      end if;
    else
      insert into public.portfolio_monthly_prices(
        company_id,price_plan_id,price_plan_version_id,price_area,billing_month,price_ex_vat_sek_per_kwh,currency,status,source,notes,version_number,
        approved_at,confirmed_at,published_at,locked_at,calculation_snapshot,created_by,updated_by
      ) values(
        v_version.company_id,v_version.price_plan_id,v_version.id,v_area,v_month,v_amount/100,'SEK',v_status,'contract_price_version',
        'Materialiserad från låst price_plan_version.snapshot_json',coalesce(v_version.version_number,1),
        case when v_status='published' then coalesce(v_version.approved_at,now()) end,case when v_status='published' then coalesce(v_version.approved_at,now()) end,
        case when v_status='published' then coalesce(v_version.published_at,now()) end,case when v_status='published' then coalesce(v_version.locked_at,now()) end,
        jsonb_build_object('amount_ore_per_kwh',v_amount,'unit','ore_per_kwh','vat_included',false,'price_plan_version_id',v_version.id),v_version.created_by,v_version.created_by
      );
    end if;
  end loop;
end $$;

create or replace function public.gridex_sync_portfolio_monthly_prices_from_version_trigger()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.gridex_sync_portfolio_monthly_prices_for_version(new.id);
  return new;
end $$;

drop trigger if exists price_plan_versions_sync_portfolio_monthly_prices on public.price_plan_versions;
create trigger price_plan_versions_sync_portfolio_monthly_prices
after insert or update of status,locked_at,published_at on public.price_plan_versions
for each row execute function public.gridex_sync_portfolio_monthly_prices_from_version_trigger();

create or replace function public.gridex_create_or_version_contract_pricing(
  p_company_id uuid,
  p_plan_name text,
  p_contract_type text,
  p_pricing_model text,
  p_customer_type text,
  p_snapshot jsonb,
  p_valid_from date default null,
  p_valid_to date default null,
  p_publish boolean default false,
  p_actor_user_id uuid default null
) returns jsonb
language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare
  v_plan_id uuid; v_version_id uuid; v_book_id uuid; v_previous_version_id uuid;
  v_plan_code text; v_hash text; v_version_number integer; v_version_label text;
  v_now timestamptz:=now(); v_component jsonb; v_reused boolean:=false;
  v_snapshot jsonb; v_areas text[];
begin
  if p_company_id is null or not exists(select 1 from public.companies where id=p_company_id) then
    raise exception 'Bolaget hittades inte.' using errcode='23503';
  end if;
  if nullif(btrim(p_plan_name),'') is null then raise exception 'Avtalsnamn krävs.'; end if;
  if jsonb_typeof(p_snapshot)<>'object' then raise exception 'Prissnapshot måste vara ett JSON-objekt.'; end if;
  if p_valid_from is not null and p_valid_to is not null and p_valid_to<p_valid_from then raise exception 'Slutdatum får inte ligga före startdatum.'; end if;
  if p_customer_type not in ('private','business','both') then raise exception 'Ogiltig kundtyp.'; end if;
  if p_pricing_model not in ('spot','fixed','portfolio','mixed','manual_override') then raise exception 'Ogiltig prismodell.'; end if;

  v_snapshot:=p_snapshot;
  if coalesce((v_snapshot->>'vat_rate')::numeric,0)>1 then
    v_snapshot:=jsonb_set(v_snapshot,'{vat_rate}',to_jsonb(((v_snapshot->>'vat_rate')::numeric/100)),true);
  end if;
  if not (v_snapshot ? 'vat_rate') then v_snapshot:=jsonb_set(v_snapshot,'{vat_rate}','0.25'::jsonb,true); end if;
  select coalesce(array_agg(value order by value),'{}') into v_areas
  from jsonb_array_elements_text(coalesce(v_snapshot->'price_areas','[]'::jsonb));
  if exists(select 1 from unnest(v_areas) a where a not in ('SE1','SE2','SE3','SE4')) then raise exception 'Ogiltigt prisområde.'; end if;
  if p_publish and coalesce(array_length(v_areas,1),0)=0 then raise exception 'Minst ett prisområde krävs för publicering.'; end if;

  v_plan_code:=lower(trim(both '-' from regexp_replace(
    coalesce(nullif(v_snapshot->>'plan_code',''),nullif(v_snapshot->>'product_key',''),p_plan_name),
    '[^a-zA-Z0-9]+','-','g')));
  v_plan_code:=left(v_plan_code,80);
  v_hash:=encode(digest(v_snapshot::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||v_plan_code,0));
  perform set_config('gridex.pricing_version_write','on',true);

  insert into public.price_plans(company_id,plan_code,name,pricing_model,customer_type,status,created_by,updated_by)
  values(p_company_id,v_plan_code,btrim(p_plan_name),p_pricing_model,p_customer_type,case when p_publish then 'active' else 'draft' end,p_actor_user_id,p_actor_user_id)
  on conflict(company_id,plan_code) do update set
    name=excluded.name,pricing_model=excluded.pricing_model,customer_type=excluded.customer_type,
    status=case when p_publish then 'active' else public.price_plans.status end,
    updated_by=excluded.updated_by,updated_at=now()
  returning id into v_plan_id;

  select id,version_number,version_label into v_version_id,v_version_number,v_version_label
  from public.price_plan_versions
  where company_id=p_company_id and price_plan_id=v_plan_id and content_sha256=v_hash
  order by created_at limit 1;
  v_reused:=v_version_id is not null;

  if v_version_id is null then
    select id into v_previous_version_id from public.price_plan_versions where price_plan_id=v_plan_id order by version_number desc limit 1;
    select coalesce(max(version_number),0)+1 into v_version_number from public.price_plan_versions where price_plan_id=v_plan_id;
    v_version_label:='v'||v_version_number::text;
    insert into public.price_plan_versions(company_id,price_plan_id,version_number,version_label,status,valid_from,valid_to,snapshot_json,content_sha256,approved_at,approved_by,published_at,locked_at,supersedes_version_id,created_by,updated_at)
    values(p_company_id,v_plan_id,v_version_number,v_version_label,case when p_publish then 'published' else 'draft' end,p_valid_from,p_valid_to,v_snapshot,v_hash,
      case when p_publish then v_now end,case when p_publish then p_actor_user_id end,case when p_publish then v_now end,case when p_publish then v_now end,v_previous_version_id,p_actor_user_id,v_now)
    returning id into v_version_id;

    for v_component in select value from jsonb_array_elements(coalesce(v_snapshot->'base_components','[]'::jsonb)) loop
      if p_publish and nullif(v_component->>'price_area','') is null then raise exception 'Alla baspriskomponenter måste ha prisområde.'; end if;
      insert into public.base_price_components(company_id,price_plan_version_id,source_type,label,weight_percent,fixed_price_sek_per_kwh,price_area,valid_from,valid_to,status,metadata,created_by)
      values(p_company_id,v_version_id,coalesce(v_component->>'source_type','manual'),v_component->>'label',coalesce((v_component->>'weight_percent')::numeric,100),
        nullif(v_component->>'fixed_price_sek_per_kwh','')::numeric,nullif(v_component->>'price_area',''),p_valid_from,p_valid_to,
        case when p_publish then 'active' else 'draft' end,coalesce(v_component->'metadata','{}'::jsonb),p_actor_user_id);
    end loop;

    for v_component in select value from jsonb_array_elements(coalesce(v_snapshot->'price_components','[]'::jsonb)) loop
      if (v_component->>'unit') not in ('sek_month','sek_invoice','sek_once','sek_contract','sek_event','ore_per_kwh','sek_per_kwh','percent','percentage') then
        raise exception 'Ogiltig priskomponentenhet: %',v_component->>'unit';
      end if;
      insert into public.price_components(company_id,price_plan_version_id,component_type,name,description,calculation_type,calculation_base,amount,unit,vat_applicable,invoice_line_visible,website_card_visible,periodization_mode,priority,valid_from,valid_to,status,metadata,created_by)
      values(p_company_id,v_version_id,coalesce(v_component->>'component_type','fee'),coalesce(v_component->>'name',v_component->>'component_code','Avgift'),v_component->>'description',
        coalesce(v_component->>'calculation_type','fixed_once'),nullif(v_component->>'calculation_base',''),(v_component->>'amount')::numeric,v_component->>'unit',coalesce((v_component->>'vat_applicable')::boolean,true),
        coalesce((v_component->>'invoice_line_visible')::boolean,true),coalesce((v_component->>'website_card_visible')::boolean,(v_component#>>'{metadata,visibility,website_card}')::boolean,true),
        coalesce(v_component->>'periodization_mode','none'),coalesce((v_component->>'priority')::integer,100),
        p_valid_from,p_valid_to,case when p_publish then 'active' else 'draft' end,
        coalesce(v_component->'metadata','{}'::jsonb)||jsonb_build_object('component_code',v_component->>'component_code','calculation_base',nullif(v_component->>'calculation_base','')),p_actor_user_id);
    end loop;
  elsif p_publish then
    update public.price_plan_versions set status='published',approved_at=coalesce(approved_at,v_now),approved_by=coalesce(approved_by,p_actor_user_id),published_at=coalesce(published_at,v_now),locked_at=coalesce(locked_at,v_now),updated_at=v_now where id=v_version_id;
    update public.base_price_components set status='active' where price_plan_version_id=v_version_id and status='draft';
    update public.price_components set status='active' where price_plan_version_id=v_version_id and status='draft';
  end if;

  select id into v_book_id from public.price_books where company_id=p_company_id and price_plan_version_id=v_version_id and content_sha256=v_hash order by created_at limit 1;
  if v_book_id is null then
    insert into public.price_books(company_id,name,status,valid_from,valid_to,price_plan_id,price_plan_version_id,content_sha256,published_at,locked_at)
    values(p_company_id,'Prislista · '||btrim(p_plan_name)||' · '||v_version_label,case when p_publish then 'published' else 'draft' end,p_valid_from,p_valid_to,v_plan_id,v_version_id,v_hash,case when p_publish then v_now end,case when p_publish then v_now end)
    returning id into v_book_id;
    insert into public.price_book_lines(price_book_id,sort_order,component_key,value,unit,metadata)
    values(v_book_id,10,'price_plan_version',null,'reference',jsonb_build_object('price_plan_id',v_plan_id,'price_plan_version_id',v_version_id,'version_number',v_version_number,'version_label',v_version_label,'content_sha256',v_hash,'snapshot',v_snapshot));
    for v_component in select value from jsonb_array_elements(coalesce(v_snapshot->'price_components','[]'::jsonb)) loop
      insert into public.price_book_lines(price_book_id,sort_order,component_key,value,unit,metadata)
      values(v_book_id,100+coalesce((v_component->>'priority')::integer,100),coalesce(v_component->>'component_code',v_component->>'component_type','fee'),(v_component->>'amount')::numeric,v_component->>'unit',v_component);
    end loop;
  elsif p_publish then
    update public.price_books set status='published',published_at=coalesce(published_at,v_now),locked_at=coalesce(locked_at,v_now),updated_at=v_now where id=v_book_id;
  end if;

  return jsonb_build_object('price_plan_id',v_plan_id,'price_plan_version_id',v_version_id,'price_book_id',v_book_id,'version_number',v_version_number,'version_label',v_version_label,'content_sha256',v_hash,'reused',v_reused,'snapshot',v_snapshot);
end $$;


-- Materialize existing schema-v4 snapshots without mutating the locked version itself.
do $$ declare r record; begin
  for r in select id from public.price_plan_versions where jsonb_typeof(coalesce(snapshot_json,'{}'::jsonb)->'portfolio_monthly_prices')='array' loop
    perform public.gridex_sync_portfolio_monthly_prices_for_version(r.id);
  end loop;
end $$;

create or replace view public.portfolio_monthly_price_versions_v
with (security_invoker=true) as
select id,company_id,price_plan_id,price_plan_version_id,(billing_month||'-01')::date as period_month,
  price_area as price_area_code,price_ex_vat_sek_per_kwh*100 as amount,'ore_per_kwh'::text as unit,false as vat_included,
  status,source,version_number,supersedes_id,superseded_at,confirmed_at,published_at,locked_at,created_at,updated_at
from public.portfolio_monthly_prices;

comment on view public.portfolio_monthly_price_versions_v is
  'Canonical monthly portfolio prices. Amount is represented in ore/kWh excluding VAT and rows are tenant- and price-plan-version scoped.';

create or replace view public.contract_publication_readiness_v as
with base as (
  select
    cpv.id as contract_publication_version_id,
    a.company_id,
    a.id as assignment_id,
    cpv.status,
    cpv.locked_at,
    cpv.valid_from,
    cpv.valid_to,
    cpv.price_plan_id,
    cpv.price_plan_version_id,
    cpv.price_book_id,
    cpv.legal_bundle_version_id,
    lbv.status as legal_bundle_status,
    lbv.locked_at as legal_bundle_locked_at,
    lbv.unresolved_variables,
    tlp.completeness_status as legal_profile_status,
    coalesce(tlp.review_required,false) as legal_profile_review_required,
    pv.status as contract_version_status,
    pv.required_legal_modules,
    coalesce((
      select array_agg(distinct d.module_key order by d.module_key)
      from public.legal_bundle_version_documents d
      where d.legal_bundle_version_id=lbv.id
    ),'{}') as included_legal_modules,
    cp.channel,
    coalesce(tlp.missing_fields,array['tenant_legal_profile']) as legal_profile_missing_fields,
    pv.price_areas,
    pv.contract_type,
    pp.id as plan_found,
    pp.status as plan_status,
    ppv.id as version_found,
    ppv.status as version_status,
    ppv.locked_at as price_version_locked_at,
    pb.id as book_found,
    pb.status as book_status,
    pb.locked_at as price_book_locked_at,
    exists(
      select 1 from public.integration_api_clients i
      where i.company_id=a.company_id and i.status='active'
        and i.scopes @> array['website_contracts.read']::text[]
    ) as has_website_read_scope,
    exists(
      select 1 from public.integration_api_clients i
      where i.company_id=a.company_id and i.status='active'
        and i.scopes @> array['website_applications.write']::text[]
    ) as has_website_write_scope
  from public.contract_publication_versions cpv
  join public.contract_publications cp on cp.id=cpv.contract_publication_id
  join public.tenant_contract_assignments a on a.id=cp.assignment_id
  join public.contract_product_versions pv on pv.id=cpv.contract_product_version_id
  left join public.legal_bundle_versions lbv on lbv.id=cpv.legal_bundle_version_id and lbv.company_id=a.company_id
  left join public.tenant_legal_profiles tlp on tlp.company_id=a.company_id
  left join public.price_plans pp on pp.id=cpv.price_plan_id and pp.company_id=a.company_id
  left join public.price_plan_versions ppv on ppv.id=cpv.price_plan_version_id and ppv.company_id=a.company_id and ppv.price_plan_id=cpv.price_plan_id
  left join public.price_books pb on pb.id=cpv.price_book_id and pb.company_id=a.company_id and pb.price_plan_version_id=cpv.price_plan_version_id
), calculated as (
  select b.*,
    array_remove(array[
      case when b.legal_profile_status is null then 'tenant_legal_profile_missing'
           when b.legal_profile_status not in('complete','verified') then 'tenant_legal_profile_incomplete' end,
      case when b.legal_profile_review_required then 'tenant_legal_profile_review_required' end,
      case when b.contract_version_status<>'approved' then 'contract_version_not_approved' end,
      case when coalesce(array_length(b.price_areas,1),0)=0 then 'price_areas_missing' end,
      case when exists(select 1 from unnest(coalesce(b.price_areas,'{}')) area where area not in('SE1','SE2','SE3','SE4')) then 'price_area_invalid' end,
      case when b.plan_found is null or b.plan_status not in('active','published','approved') then 'price_plan_not_active' end,
      case when b.version_found is null or b.version_status not in('active','published','approved') or b.price_version_locked_at is null then 'price_plan_version_not_locked' end,
      case when b.book_found is null or b.book_status not in('active','published') or b.price_book_locked_at is null then 'price_book_not_locked' end,
      case when b.legal_bundle_version_id is null or b.legal_bundle_status<>'published' or b.legal_bundle_locked_at is null then 'legal_bundle_not_locked' end,
      case when coalesce(array_length(b.unresolved_variables,1),0)>0 then 'unresolved_legal_variables' end,
      case when b.valid_from is not null and b.valid_to is not null and b.valid_to<b.valid_from then 'invalid_validity_period' end,
      case when b.contract_type in('portfolio','mixed') and exists(
        select 1 from unnest(coalesce(b.price_areas,'{}')) required_area
        where not exists(
          select 1 from public.portfolio_monthly_prices pmp
          where pmp.company_id=b.company_id
            and pmp.price_plan_version_id=b.price_plan_version_id
            and pmp.status in ('locked','published')
            and coalesce(pmp.locked_at,pmp.published_at) is not null
            and pmp.superseded_at is null and pmp.price_area=required_area
            and pmp.billing_month=to_char(
              greatest(
                coalesce(b.valid_from,(now() at time zone 'Europe/Stockholm')::date),
                (now() at time zone 'Europe/Stockholm')::date
              ),
              'YYYY-MM'
            )
        )
      ) then 'portfolio_price_source_missing_or_unlocked' end
    ],null)
    ||coalesce(array(
      select 'missing_legal_module:'||module_key
      from unnest(coalesce(b.required_legal_modules,'{}')) module_key
      where not(module_key=any(b.included_legal_modules))
    ),'{}') as core_blockers
  from base b
), readiness as (
  select c.*,
    c.core_blockers
      ||case when c.channel in('website','api') and not c.has_website_read_scope
        then array['website_contracts_read_scope_missing'] else '{}'::text[] end as display_blockers,
    c.core_blockers
      ||case when c.channel in('website','api') and not c.has_website_read_scope
        then array['website_contracts_read_scope_missing'] else '{}'::text[] end
      ||case when c.channel in('website','api') and not c.has_website_write_scope
        then array['website_applications_write_scope_missing'] else '{}'::text[] end as application_blockers
  from calculated c
)
select
  -- Preserve the historical column order so dependent functions/views remain valid.
  r.contract_publication_version_id,
  r.company_id,
  r.assignment_id,
  r.status,
  r.locked_at,
  r.valid_from,
  r.valid_to,
  r.price_plan_id,
  r.price_plan_version_id,
  r.price_book_id,
  r.legal_bundle_version_id,
  r.legal_bundle_status,
  r.legal_bundle_locked_at,
  r.unresolved_variables,
  r.legal_profile_status,
  r.contract_version_status,
  r.required_legal_modules,
  r.included_legal_modules,
  r.core_blockers as blockers,
  r.channel,
  r.legal_profile_missing_fields,
  r.legal_profile_review_required,
  r.display_blockers,
  r.application_blockers,
  case when r.legal_profile_status is null then 'unknown'
       when coalesce(array_length(r.core_blockers,1),0)>0 then 'blocked'
       else 'ready' end as readiness_status,
  coalesce(array_length(r.display_blockers,1),0)=0 as can_display,
  coalesce(array_length(r.application_blockers,1),0)=0 as can_accept_applications,
  r.has_website_read_scope,
  r.has_website_write_scope
from readiness r;


alter table public.portfolio_monthly_prices enable row level security;
revoke all on public.portfolio_monthly_prices from anon,authenticated;
grant select,insert,update,delete on public.portfolio_monthly_prices to service_role;

revoke all on function public.gridex_sync_portfolio_monthly_prices_for_version(uuid) from public,anon,authenticated;
revoke all on function public.gridex_sync_portfolio_monthly_prices_from_version_trigger() from public,anon,authenticated;
grant execute on function public.gridex_sync_portfolio_monthly_prices_for_version(uuid) to service_role;
revoke all on public.portfolio_monthly_price_versions_v from public,anon,authenticated;
grant select on public.portfolio_monthly_price_versions_v to service_role;

do $$
begin
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='price_components' and column_name='calculation_base') then
    raise exception 'price_component_calculation_base_missing';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='portfolio_monthly_prices' and column_name='price_plan_version_id') then
    raise exception 'portfolio_price_version_reference_missing';
  end if;
  if to_regclass('public.portfolio_monthly_price_versions_v') is null then
    raise exception 'portfolio_monthly_price_versions_view_missing';
  end if;
end $$;

commit;
