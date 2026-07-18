-- Align contract publication and billing with method-based portfolio pricing.

begin;

-- Future actual portfolio prices are outcomes, never publication inputs.
drop trigger if exists price_plan_versions_sync_portfolio_monthly_prices on public.price_plan_versions;

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
    pp.pricing_model,
    ppv.id as version_found,
    ppv.status as version_status,
    ppv.locked_at as price_version_locked_at,
    ppv.snapshot_json as price_version_snapshot,
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
      case when b.contract_type in('portfolio','mixed') and
        coalesce(b.price_version_snapshot#>>'{portfolio_method,pricing_model}','')<>'portfolio_monthly_settlement'
        then 'portfolio_settlement_method_missing' end,
      case when b.contract_type in('portfolio','mixed') and not exists(
        select 1 from public.portfolios p
        where p.company_id=b.company_id and p.status='active'
          and p.id::text=coalesce(b.price_version_snapshot#>>'{portfolio_method,portfolio_id}','')
      ) then 'portfolio_scope_missing_or_invalid' end,
      case when b.contract_type in('portfolio','mixed') and
        nullif(b.price_version_snapshot#>>'{portfolio_method,settlement_timing}','') is null
        then 'portfolio_settlement_timing_missing' end,
      case when b.contract_type in('portfolio','mixed') and
        nullif(b.price_version_snapshot#>>'{portfolio_method,estimate_rule}','') is null
        then 'portfolio_estimate_rule_missing' end,
      case when b.contract_type='mixed' and coalesce((
        select sum(coalesce((component->>'weight_percent')::numeric,0))
        from jsonb_array_elements(coalesce(b.price_version_snapshot->'base_components','[]'::jsonb)) component
      ),0)<>100 then 'mixed_price_shares_must_equal_100' end
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

comment on view public.contract_publication_readiness_v is
  'Publication readiness validates the locked portfolio settlement method. Future actual monthly prices are never publication inputs.';

alter table public.billing_underlays
  add column if not exists portfolio_id uuid null references public.portfolios(id) on delete restrict,
  add column if not exists portfolio_monthly_settlement_id uuid null references public.portfolio_monthly_settlements(id) on delete restrict,
  add column if not exists portfolio_settlement_revision integer null,
  add column if not exists portfolio_settlement_sha256 text null;

alter table public.pricing_runs
  add column if not exists portfolio_id uuid null references public.portfolios(id) on delete restrict,
  add column if not exists portfolio_monthly_settlement_id uuid null references public.portfolio_monthly_settlements(id) on delete restrict,
  add column if not exists portfolio_settlement_revision integer null,
  add column if not exists portfolio_settlement_sha256 text null;

alter table public.customer_invoices
  add column if not exists contract_id uuid null references public.customer_contracts(id) on delete restrict,
  add column if not exists customer_contract_id uuid null references public.customer_contracts(id) on delete restrict,
  add column if not exists price_plan_version_id uuid null references public.price_plan_versions(id) on delete restrict,
  add column if not exists portfolio_id uuid null references public.portfolios(id) on delete restrict,
  add column if not exists portfolio_monthly_settlement_id uuid null references public.portfolio_monthly_settlements(id) on delete restrict,
  add column if not exists portfolio_price_area_code text null,
  add column if not exists portfolio_delivery_month date null,
  add column if not exists portfolio_settlement_revision integer null,
  add column if not exists portfolio_settlement_status text null,
  add column if not exists portfolio_price_ore_per_kwh numeric null,
  add column if not exists portfolio_management_fee_ore_per_kwh numeric null,
  add column if not exists portfolio_gross_energy_cost_sek numeric null,
  add column if not exists portfolio_energy_volume_kwh numeric null,
  add column if not exists portfolio_settlement_sha256 text null,
  add column if not exists portfolio_settlement_source text null,
  add column if not exists portfolio_settlement_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists delivery_month date null,
  add column if not exists price_area_code text null,
  add column if not exists consumption_kwh numeric null,
  add column if not exists portfolio_share_percent numeric null,
  add column if not exists spot_share_percent numeric null,
  add column if not exists portfolio_energy_cost_sek numeric null,
  add column if not exists spot_energy_cost_sek numeric null,
  add column if not exists management_fee_sek numeric null,
  add column if not exists other_fees_sek numeric null,
  add column if not exists vat_rate numeric null,
  add column if not exists calculation_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists calculation_snapshot_sha256 text null;

alter table public.customer_invoices drop constraint if exists customer_invoices_portfolio_price_area_check;
alter table public.customer_invoices add constraint customer_invoices_portfolio_price_area_check
  check(portfolio_price_area_code is null or portfolio_price_area_code in('SE1','SE2','SE3','SE4'));
alter table public.customer_invoices drop constraint if exists customer_invoices_price_area_code_check;
alter table public.customer_invoices add constraint customer_invoices_price_area_code_check
  check(price_area_code is null or price_area_code in('SE1','SE2','SE3','SE4'));
alter table public.customer_invoices drop constraint if exists customer_invoices_portfolio_shares_check;
alter table public.customer_invoices add constraint customer_invoices_portfolio_shares_check check(
  (portfolio_share_percent is null and spot_share_percent is null)
  or (
    portfolio_share_percent between 0 and 100
    and spot_share_percent between 0 and 100
    and portfolio_share_percent+spot_share_percent<=100
  )
);

create table if not exists public.portfolio_settlement_invoice_bindings(
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  billing_underlay_id uuid not null references public.billing_underlays(id) on delete restrict,
  pricing_run_id uuid null references public.pricing_runs(id) on delete restrict,
  customer_invoice_id uuid null references public.customer_invoices(id) on delete restrict,
  portfolio_monthly_settlement_id uuid not null references public.portfolio_monthly_settlements(id) on delete restrict,
  settlement_snapshot jsonb not null,
  settlement_sha256 text not null,
  idempotency_key text not null,
  invoice_idempotency_key text null,
  bound_by uuid not null references auth.users(id) on delete restrict,
  bound_at timestamptz not null default now(),
  unique(company_id,idempotency_key),
  unique(company_id,invoice_idempotency_key),
  unique(company_id,billing_underlay_id),
  unique(company_id,billing_underlay_id,portfolio_monthly_settlement_id)
);

create or replace function public.gridex_generate_portfolio_price_estimate(
  p_actor_user_id uuid,p_company_id uuid,p_portfolio_id uuid,
  p_price_plan_version_id uuid,p_price_area_code text,p_estimate_month date,
  p_estimate_source text,p_manual_or_forecast_price_ore_per_kwh numeric default null,
  p_confidence text default null,p_reason text default null
) returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_price numeric; v_ids uuid[]:='{}'; v_id uuid;
begin
  perform public.gridex_assert_portfolio_permission(
    p_actor_user_id,'portfolio_settlement.calculate',p_company_id,p_portfolio_id
  );
  if not exists(
    select 1 from public.portfolios p
    join public.price_plan_versions v on v.id=p_price_plan_version_id
    where p.id=p_portfolio_id and p.company_id=p_company_id and p.status='active'
      and v.company_id=p_company_id
      and v.snapshot_json#>>'{portfolio_method,portfolio_id}'=p_portfolio_id::text
  ) then
    raise exception using errcode='23514',message='portfolio_estimate_scope_mismatch';
  end if;
  if upper(p_price_area_code) not in('SE1','SE2','SE3','SE4')
     or p_estimate_month<>date_trunc('month',p_estimate_month)::date
     or p_estimate_source not in('latest_final','rolling_3','forecast','manual') then
    raise exception using errcode='22023',message='invalid_portfolio_estimate_input';
  end if;
  if p_estimate_source in('manual','forecast') then
    v_price:=p_manual_or_forecast_price_ore_per_kwh;
  elsif p_estimate_source='latest_final' then
    select s.portfolio_price_ore_per_kwh,array[s.id]
      into v_price,v_ids
    from public.portfolio_monthly_settlements s
    where s.company_id=p_company_id and s.portfolio_id=p_portfolio_id
      and s.price_plan_version_id=p_price_plan_version_id
      and s.price_area_code=upper(p_price_area_code)
      and s.delivery_month<p_estimate_month and s.is_current and s.status in('final','locked')
    order by s.delivery_month desc limit 1;
  else
    select avg(x.portfolio_price_ore_per_kwh),array_agg(x.id order by x.delivery_month)
      into v_price,v_ids
    from (
      select s.id,s.delivery_month,s.portfolio_price_ore_per_kwh
      from public.portfolio_monthly_settlements s
      where s.company_id=p_company_id and s.portfolio_id=p_portfolio_id
        and s.price_plan_version_id=p_price_plan_version_id
        and s.price_area_code=upper(p_price_area_code)
        and s.delivery_month<p_estimate_month and s.is_current and s.status in('final','locked')
      order by s.delivery_month desc limit 3
    ) x;
  end if;
  if v_price is null then
    raise exception using errcode='23514',message='portfolio_estimate_source_unavailable';
  end if;
  if nullif(btrim(p_reason),'') is null then
    raise exception using errcode='22023',message='portfolio_estimate_reason_required';
  end if;
  update public.portfolio_price_estimates set is_current=false
  where company_id=p_company_id and portfolio_id=p_portfolio_id
    and price_plan_version_id=p_price_plan_version_id
    and price_area_code=upper(p_price_area_code) and estimate_month=p_estimate_month and is_current;
  insert into public.portfolio_price_estimates(
    company_id,portfolio_id,price_plan_version_id,price_area_code,estimate_month,
    estimate_source,estimate_price_ore_per_kwh,based_on_settlement_ids,
    confidence,non_binding,reason,created_by
  ) values(
    p_company_id,p_portfolio_id,p_price_plan_version_id,upper(p_price_area_code),p_estimate_month,
    p_estimate_source,v_price,coalesce(v_ids,'{}'),p_confidence,true,btrim(p_reason),p_actor_user_id
  ) returning id into v_id;
  insert into public.portfolio_settlement_audit_log(
    company_id,portfolio_id,actor_user_id,permission,action,new_values,reason
  ) values(
    p_company_id,p_portfolio_id,p_actor_user_id,'portfolio_settlement.calculate','estimate.created',
    jsonb_build_object('estimate_id',v_id,'estimate_month',p_estimate_month,'source',p_estimate_source,'non_binding',true),
    btrim(p_reason)
  );
  return v_id;
end $$;

create or replace function public.gridex_bind_locked_portfolio_settlement_to_underlay(
  p_actor_user_id uuid,p_company_id uuid,p_billing_underlay_id uuid,
  p_portfolio_monthly_settlement_id uuid,p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare v_underlay public.billing_underlays%rowtype; v_settlement public.portfolio_monthly_settlements%rowtype;
  v_snapshot jsonb; v_sha text; v_existing record;
begin
  if p_actor_user_id is null or not exists(select 1 from auth.users u where u.id=p_actor_user_id) then
    raise exception using errcode='42501',message='real_billing_actor_required';
  end if;
  if nullif(btrim(p_idempotency_key),'') is null then
    raise exception using errcode='22023',message='billing_settlement_idempotency_key_required';
  end if;
  select * into v_existing from public.portfolio_settlement_invoice_bindings
  where company_id=p_company_id and idempotency_key=p_idempotency_key;
  if found then return to_jsonb(v_existing); end if;
  select * into v_underlay from public.billing_underlays
  where id=p_billing_underlay_id and company_id=p_company_id for update;
  if not found then raise exception using errcode='P0002',message='billing_underlay_not_found'; end if;
  select * into v_settlement from public.portfolio_monthly_settlements
  where id=p_portfolio_monthly_settlement_id and company_id=p_company_id
    and is_current and status in('final','locked') for update;
  if not found then raise exception using errcode='23514',message='final_or_locked_portfolio_settlement_required_for_billing'; end if;
  if v_settlement.price_area_code<>v_underlay.price_area
     or extract(year from v_settlement.delivery_month)::integer<>v_underlay.underlay_year
     or extract(month from v_settlement.delivery_month)::integer<>v_underlay.underlay_month
     or v_settlement.price_plan_version_id is distinct from v_underlay.price_plan_version_id then
    raise exception using errcode='23514',message='portfolio_settlement_underlay_scope_mismatch';
  end if;
  if not exists(
    select 1 from public.price_plan_versions v
    where v.id=v_settlement.price_plan_version_id and v.company_id=p_company_id
      and v.snapshot_json#>>'{portfolio_method,portfolio_id}'=v_settlement.portfolio_id::text
  ) then
    raise exception using errcode='23514',message='portfolio_settlement_contract_method_mismatch';
  end if;
  if v_underlay.contract_id is null or not exists(
    select 1 from public.customer_contracts c
    where c.id=v_underlay.contract_id and c.company_id=p_company_id
      and c.status in('signed','active')
      and c.price_plan_version_id=v_settlement.price_plan_version_id
  ) then
    raise exception using errcode='23514',message='portfolio_settlement_underlay_contract_mismatch';
  end if;
  if v_settlement.status='final' then
    perform set_config('gridex.portfolio_actor_user_id',p_actor_user_id::text,true);
    perform set_config('gridex.portfolio_audit_reason','locked by exact billing binding',true);
    update public.portfolio_monthly_settlements
    set status='locked',locked_by=p_actor_user_id,locked_at=now()
    where id=v_settlement.id;
    select * into v_settlement from public.portfolio_monthly_settlements
    where id=p_portfolio_monthly_settlement_id;
  end if;
  v_snapshot:=jsonb_build_object(
    'settlement_id',v_settlement.id,'company_id',v_settlement.company_id,
    'portfolio_id',v_settlement.portfolio_id,'price_plan_version_id',v_settlement.price_plan_version_id,
    'price_area_code',v_settlement.price_area_code,'delivery_month',v_settlement.delivery_month,
    'revision_no',v_settlement.revision_no,'status',v_settlement.status,
    'portfolio_price_ore_per_kwh',v_settlement.portfolio_price_ore_per_kwh,
    'management_fee_ore_per_kwh',v_settlement.management_fee_ore_per_kwh,
    'gross_energy_cost_sek',v_settlement.gross_energy_cost_sek,
    'hedging_result_sek',v_settlement.hedging_result_sek,
    'balancing_cost_sek',v_settlement.balancing_cost_sek,
    'other_allowed_cost_sek',v_settlement.other_allowed_cost_sek,
    'energy_volume_kwh',v_settlement.energy_volume_kwh,
    'calculation_snapshot_sha256',v_settlement.calculation_snapshot_sha256,'vat_rate',v_settlement.vat_rate,
    'vat_included',v_settlement.vat_included,
    'source',v_settlement.source,'locked_at',v_settlement.locked_at
  );
  v_sha:=encode(extensions.digest(convert_to(v_snapshot::text,'UTF8'),'sha256'),'hex');
  update public.billing_underlays set
    portfolio_id=v_settlement.portfolio_id,
    portfolio_monthly_settlement_id=v_settlement.id,
    portfolio_settlement_revision=v_settlement.revision_no,
    portfolio_settlement_sha256=v_sha,
    pricing_snapshot=coalesce(pricing_snapshot,'{}'::jsonb)||jsonb_build_object('portfolio_settlement',v_snapshot),
    updated_at=now()
  where id=v_underlay.id;
  insert into public.portfolio_settlement_invoice_bindings(
    company_id,billing_underlay_id,portfolio_monthly_settlement_id,
    settlement_snapshot,settlement_sha256,idempotency_key,bound_by
  ) values(
    p_company_id,v_underlay.id,v_settlement.id,v_snapshot,v_sha,btrim(p_idempotency_key),p_actor_user_id
  ) returning * into v_existing;
  return to_jsonb(v_existing);
end $$;

create or replace function public.gridex_attach_portfolio_settlement_to_invoice(
  p_actor_user_id uuid,p_company_id uuid,p_customer_invoice_id uuid,
  p_billing_underlay_id uuid,p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_binding public.portfolio_settlement_invoice_bindings%rowtype;
  v_settlement public.portfolio_monthly_settlements%rowtype;
  v_underlay public.billing_underlays%rowtype;
  v_method jsonb;
  v_consumption numeric;
  v_portfolio_share numeric;
  v_spot_share numeric;
  v_portfolio_cost numeric;
  v_spot_cost numeric;
  v_management_fee numeric;
  v_other_fees numeric;
  v_calculation_snapshot jsonb;
  v_calculation_sha256 text;
begin
  if p_actor_user_id is null or not exists(select 1 from auth.users where id=p_actor_user_id) then
    raise exception using errcode='42501',message='real_billing_actor_required';
  end if;
  if nullif(btrim(p_idempotency_key),'') is null then
    raise exception using errcode='22023',message='invoice_settlement_idempotency_key_required';
  end if;
  select * into v_binding from public.portfolio_settlement_invoice_bindings
  where company_id=p_company_id and invoice_idempotency_key=btrim(p_idempotency_key);
  if found then
    if v_binding.customer_invoice_id is distinct from p_customer_invoice_id
       or v_binding.billing_underlay_id is distinct from p_billing_underlay_id then
      raise exception using errcode='23505',message='invoice_settlement_idempotency_scope_mismatch';
    end if;
    return (select to_jsonb(i) from public.customer_invoices i where i.id=p_customer_invoice_id);
  end if;
  select * into v_binding from public.portfolio_settlement_invoice_bindings
  where company_id=p_company_id and billing_underlay_id=p_billing_underlay_id;
  if not found then raise exception using errcode='23514',message='portfolio_settlement_binding_required'; end if;
  select * into v_settlement from public.portfolio_monthly_settlements
  where id=v_binding.portfolio_monthly_settlement_id and company_id=p_company_id
    and status='locked' and is_current;
  if not found then raise exception using errcode='23514',message='locked_current_portfolio_settlement_required'; end if;
  select * into v_underlay from public.billing_underlays
  where id=p_billing_underlay_id and company_id=p_company_id;
  if not found or v_underlay.contract_id is null then
    raise exception using errcode='23514',message='exact_contract_billing_underlay_required';
  end if;
  select coalesce(v.snapshot_json->'portfolio_method','{}'::jsonb)
    into v_method
  from public.price_plan_versions v
  where v.id=v_settlement.price_plan_version_id and v.company_id=p_company_id;
  v_consumption:=v_underlay.total_kwh;
  v_portfolio_share:=coalesce(nullif(v_method#>>'{mix_shares,portfolio_weight_percent}','')::numeric,100);
  v_spot_share:=coalesce(nullif(v_method#>>'{mix_shares,spot_weight_percent}','')::numeric,0);
  if coalesce(v_consumption,0)<=0 or v_portfolio_share<0 or v_spot_share<0
     or v_portfolio_share+v_spot_share>100 then
    raise exception using errcode='23514',message='portfolio_invoice_calculation_scope_invalid';
  end if;
  v_portfolio_cost:=v_consumption*(v_portfolio_share/100)*(v_settlement.portfolio_price_ore_per_kwh/100);
  if v_spot_share>0 then
    v_spot_cost:=nullif(v_underlay.pricing_snapshot#>>'{portfolio_billing,spot_energy_cost_sek}','')::numeric;
    if v_spot_cost is null then
      raise exception using errcode='23514',message='final_spot_energy_cost_required_for_mixed_invoice';
    end if;
  else
    v_spot_cost:=0;
  end if;
  v_management_fee:=v_consumption*(v_portfolio_share/100)*(v_settlement.management_fee_ore_per_kwh/100);
  v_other_fees:=coalesce(nullif(v_underlay.pricing_snapshot#>>'{portfolio_billing,other_fees_sek}','')::numeric,0);
  v_calculation_snapshot:=jsonb_build_object(
    'customer_contract_id',v_underlay.contract_id,
    'price_plan_version_id',v_settlement.price_plan_version_id,
    'portfolio_monthly_settlement_id',v_settlement.id,
    'delivery_month',v_settlement.delivery_month,
    'price_area_code',v_settlement.price_area_code,
    'consumption_kwh',v_consumption,
    'portfolio_share_percent',v_portfolio_share,
    'spot_share_percent',v_spot_share,
    'portfolio_price_ore_per_kwh',v_settlement.portfolio_price_ore_per_kwh,
    'portfolio_energy_cost_sek',v_portfolio_cost,
    'spot_energy_cost_sek',v_spot_cost,
    'management_fee_sek',v_management_fee,
    'other_fees_sek',v_other_fees,
    'vat_rate',v_settlement.vat_rate,
    'settlement_snapshot_sha256',v_binding.settlement_sha256
  );
  v_calculation_sha256:=encode(extensions.digest(
    convert_to(v_calculation_snapshot::text,'UTF8'),'sha256'
  ),'hex');
  update public.customer_invoices set
    billing_underlay_id=p_billing_underlay_id,
    contract_id=v_underlay.contract_id,
    customer_contract_id=v_underlay.contract_id,
    portfolio_id=v_settlement.portfolio_id,
    portfolio_monthly_settlement_id=v_settlement.id,
    price_plan_version_id=v_settlement.price_plan_version_id,
    portfolio_price_area_code=v_settlement.price_area_code,
    portfolio_delivery_month=v_settlement.delivery_month,
    portfolio_settlement_revision=v_settlement.revision_no,
    portfolio_settlement_status=v_settlement.status,
    portfolio_price_ore_per_kwh=v_settlement.portfolio_price_ore_per_kwh,
    portfolio_management_fee_ore_per_kwh=v_settlement.management_fee_ore_per_kwh,
    portfolio_gross_energy_cost_sek=v_settlement.gross_energy_cost_sek,
    portfolio_energy_volume_kwh=v_settlement.energy_volume_kwh,
    portfolio_settlement_sha256=v_binding.settlement_sha256,
    portfolio_settlement_source=v_settlement.source,
    portfolio_settlement_snapshot=v_binding.settlement_snapshot,
    delivery_month=v_settlement.delivery_month,
    price_area_code=v_settlement.price_area_code,
    consumption_kwh=v_consumption,
    portfolio_share_percent=v_portfolio_share,
    spot_share_percent=v_spot_share,
    portfolio_energy_cost_sek=v_portfolio_cost,
    spot_energy_cost_sek=v_spot_cost,
    management_fee_sek=v_management_fee,
    other_fees_sek=v_other_fees,
    vat_rate=v_settlement.vat_rate,
    calculation_snapshot=v_calculation_snapshot,
    calculation_snapshot_sha256=v_calculation_sha256,
    updated_at=now()
  where id=p_customer_invoice_id and company_id=p_company_id;
  if not found then raise exception using errcode='P0002',message='customer_invoice_not_found'; end if;
  update public.portfolio_settlement_invoice_bindings
  set customer_invoice_id=p_customer_invoice_id,
      invoice_idempotency_key=btrim(p_idempotency_key)
  where id=v_binding.id and customer_invoice_id is null;
  if not found and (
    v_binding.customer_invoice_id is distinct from p_customer_invoice_id
    or v_binding.invoice_idempotency_key is distinct from btrim(p_idempotency_key)
  ) then
    raise exception using errcode='23505',message='portfolio_settlement_binding_already_attached';
  end if;
  return (select to_jsonb(i) from public.customer_invoices i where i.id=p_customer_invoice_id);
end $$;

create or replace function public.gridex_guard_portfolio_invoice_evidence()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='UPDATE' and old.status in('issued','sent','exported','paid') and (
    new.portfolio_id is distinct from old.portfolio_id
    or new.customer_contract_id is distinct from old.customer_contract_id
    or new.price_plan_version_id is distinct from old.price_plan_version_id
    or new.portfolio_monthly_settlement_id is distinct from old.portfolio_monthly_settlement_id
    or new.portfolio_settlement_revision is distinct from old.portfolio_settlement_revision
    or new.portfolio_settlement_sha256 is distinct from old.portfolio_settlement_sha256
    or new.portfolio_settlement_snapshot is distinct from old.portfolio_settlement_snapshot
    or new.portfolio_price_area_code is distinct from old.portfolio_price_area_code
    or new.portfolio_delivery_month is distinct from old.portfolio_delivery_month
    or new.portfolio_price_ore_per_kwh is distinct from old.portfolio_price_ore_per_kwh
    or new.portfolio_management_fee_ore_per_kwh is distinct from old.portfolio_management_fee_ore_per_kwh
    or new.portfolio_gross_energy_cost_sek is distinct from old.portfolio_gross_energy_cost_sek
    or new.portfolio_energy_volume_kwh is distinct from old.portfolio_energy_volume_kwh
    or new.delivery_month is distinct from old.delivery_month
    or new.price_area_code is distinct from old.price_area_code
    or new.consumption_kwh is distinct from old.consumption_kwh
    or new.portfolio_share_percent is distinct from old.portfolio_share_percent
    or new.spot_share_percent is distinct from old.spot_share_percent
    or new.portfolio_energy_cost_sek is distinct from old.portfolio_energy_cost_sek
    or new.spot_energy_cost_sek is distinct from old.spot_energy_cost_sek
    or new.management_fee_sek is distinct from old.management_fee_sek
    or new.other_fees_sek is distinct from old.other_fees_sek
    or new.vat_rate is distinct from old.vat_rate
    or new.calculation_snapshot is distinct from old.calculation_snapshot
    or new.calculation_snapshot_sha256 is distinct from old.calculation_snapshot_sha256
  ) then
    raise exception using errcode='55000',message='issued_invoice_portfolio_evidence_immutable';
  end if;
  if new.status in('issued','sent','exported','paid') and new.portfolio_id is not null and (
    new.portfolio_monthly_settlement_id is null
    or new.portfolio_settlement_status<>'locked'
    or nullif(new.portfolio_settlement_sha256,'') is null
    or coalesce(new.portfolio_settlement_snapshot,'{}'::jsonb)='{}'::jsonb
    or new.customer_contract_id is null
    or new.price_plan_version_id is null
    or new.delivery_month is null
    or new.price_area_code is null
    or new.consumption_kwh is null
    or new.portfolio_share_percent is null
    or new.spot_share_percent is null
    or new.portfolio_energy_cost_sek is null
    or new.spot_energy_cost_sek is null
    or new.management_fee_sek is null
    or new.other_fees_sek is null
    or new.vat_rate is null
    or nullif(new.calculation_snapshot_sha256,'') is null
    or coalesce(new.calculation_snapshot,'{}'::jsonb)='{}'::jsonb
  ) then
    raise exception using errcode='23514',message='final_invoice_requires_locked_portfolio_settlement_evidence';
  end if;
  return new;
end $$;
drop trigger if exists customer_invoices_portfolio_evidence_guard on public.customer_invoices;
create trigger customer_invoices_portfolio_evidence_guard
before insert or update of status,portfolio_id,portfolio_monthly_settlement_id,
  customer_contract_id,price_plan_version_id,
  portfolio_settlement_revision,portfolio_settlement_status,
  portfolio_settlement_sha256,portfolio_settlement_snapshot,
  portfolio_price_area_code,portfolio_delivery_month,
  portfolio_price_ore_per_kwh,portfolio_management_fee_ore_per_kwh,
  portfolio_gross_energy_cost_sek,portfolio_energy_volume_kwh,
  delivery_month,price_area_code,consumption_kwh,
  portfolio_share_percent,spot_share_percent,portfolio_energy_cost_sek,
  spot_energy_cost_sek,management_fee_sek,other_fees_sek,vat_rate,
  calculation_snapshot,calculation_snapshot_sha256
on public.customer_invoices for each row execute function public.gridex_guard_portfolio_invoice_evidence();

create or replace function public.gridex_guard_portfolio_estimate_history()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' or old.is_current=false or new.is_current<>false
     or (to_jsonb(new)-'is_current')<>(to_jsonb(old)-'is_current') then
    raise exception using errcode='55000',message='portfolio_estimate_append_only';
  end if;
  return new;
end $$;
drop trigger if exists portfolio_price_estimates_history_guard on public.portfolio_price_estimates;
create trigger portfolio_price_estimates_history_guard
before update or delete on public.portfolio_price_estimates
for each row execute function public.gridex_guard_portfolio_estimate_history();

create or replace function public.gridex_guard_portfolio_invoice_binding()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' or old.customer_invoice_id is not null
     or new.customer_invoice_id is null
     or new.invoice_idempotency_key is null
     or (to_jsonb(new)-'customer_invoice_id'-'invoice_idempotency_key')
       <>(to_jsonb(old)-'customer_invoice_id'-'invoice_idempotency_key') then
    raise exception using errcode='55000',message='portfolio_invoice_binding_immutable';
  end if;
  return new;
end $$;
drop trigger if exists portfolio_settlement_invoice_bindings_guard on public.portfolio_settlement_invoice_bindings;
create trigger portfolio_settlement_invoice_bindings_guard
before update or delete on public.portfolio_settlement_invoice_bindings
for each row execute function public.gridex_guard_portfolio_invoice_binding();

alter table public.portfolio_settlement_invoice_bindings enable row level security;
revoke all on public.portfolio_settlement_invoice_bindings from public,anon,authenticated;
grant select on public.portfolio_settlement_invoice_bindings to service_role;

revoke all on function public.gridex_generate_portfolio_price_estimate(uuid,uuid,uuid,uuid,text,date,text,numeric,text,text) from public,anon,authenticated;
revoke all on function public.gridex_bind_locked_portfolio_settlement_to_underlay(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.gridex_attach_portfolio_settlement_to_invoice(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.gridex_generate_portfolio_price_estimate(uuid,uuid,uuid,uuid,text,date,text,numeric,text,text) to service_role;
grant execute on function public.gridex_bind_locked_portfolio_settlement_to_underlay(uuid,uuid,uuid,uuid,text) to service_role;
grant execute on function public.gridex_attach_portfolio_settlement_to_invoice(uuid,uuid,uuid,uuid,text) to service_role;

do $$
begin
  if position('portfolio_price_source_missing_or_unlocked' in pg_get_viewdef('public.contract_publication_readiness_v'::regclass,true))>0 then
    raise exception 'future_portfolio_price_publication_blocker_still_installed';
  end if;
end $$;

commit;
