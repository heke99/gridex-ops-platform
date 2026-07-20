-- Canonical invoice-fee persistence, publication readiness, quote integrity and version-safe remediation.

begin;

alter table public.contract_offers
  add column if not exists invoice_fee_sek numeric;

alter table public.contract_offers drop constraint if exists contract_offers_invoice_fee_nonnegative;
alter table public.contract_offers add constraint contract_offers_invoice_fee_nonnegative
  check(invoice_fee_sek is null or invoice_fee_sek>=0) not valid;

alter table public.public_contract_offers drop constraint if exists public_contract_offers_invoice_fee_nonnegative;
alter table public.public_contract_offers add constraint public_contract_offers_invoice_fee_nonnegative
  check(invoice_fee_sek is null or invoice_fee_sek>=0) not valid;


create or replace function public.gridex_safe_nonnegative_numeric(p_value text)
returns numeric
language plpgsql
immutable
set search_path=public,pg_temp
as $$
declare v numeric;
begin
  if p_value is null or btrim(p_value)='' then return null; end if;
  begin
    v:=replace(btrim(p_value),',','.')::numeric;
  exception when others then
    return null;
  end;
  if lower(replace(btrim(p_value),',','.')) in ('nan','infinity','+infinity','-infinity') or v<0 then return null; end if;
  return v;
end $$;

create or replace function public.gridex_invoice_fee_readiness(
  p_snapshot jsonb, p_row_amount numeric
) returns jsonb
language sql
immutable
set search_path=public,pg_temp
as $$
with raw_components as (
  select component
  from jsonb_array_elements(
    case
      when jsonb_typeof(coalesce(p_snapshot,'{}'::jsonb)->'price_components')='array'
        then coalesce(p_snapshot,'{}'::jsonb)->'price_components'
      when jsonb_typeof(coalesce(p_snapshot,'{}'::jsonb)->'price_components_snapshot')='array'
        then coalesce(p_snapshot,'{}'::jsonb)->'price_components_snapshot'
      else '[]'::jsonb
    end
  ) component
  where coalesce(
    nullif(component->>'component_code',''),
    nullif(component->>'component_type',''),
    nullif(component#>>'{metadata,component_code}','')
  )='invoice_fee'
  and coalesce(nullif(component->>'status',''),'active')='active'
), normalized as (
  select
    component,
    public.gridex_safe_nonnegative_numeric(component->>'amount') as amount,
    component->>'unit' as unit,
    component->>'calculation_type' as calculation_type,
    case
      when lower(coalesce(component->>'website_card_visible','')) in('true','false')
        then (component->>'website_card_visible')::boolean
      when lower(coalesce(component#>>'{metadata,visibility,website_card}','')) in('true','false')
        then (component#>>'{metadata,visibility,website_card}')::boolean
      else true
    end as website_card_visible
  from raw_components
), scored as (
  select
    count(*)::integer as component_count,
    count(*) filter(
      where unit='sek_invoice'
        and calculation_type='per_invoice'
        and amount is not null
    )::integer as valid_component_count,
    min(amount) filter(
      where unit='sek_invoice'
        and calculation_type='per_invoice'
        and amount is not null
    ) as amount,
    bool_or(website_card_visible) filter(
      where unit='sek_invoice'
        and calculation_type='per_invoice'
        and amount is not null
    ) as website_card_visible
  from normalized
)
select case
  when component_count>1 then jsonb_build_object('status','blocked','code','invoice_fee_ambiguous')
  when valid_component_count<>1 then jsonb_build_object('status','blocked','code','invoice_fee_missing')
  when p_row_amount is null or p_row_amount<0 or p_row_amount<>amount then
    jsonb_build_object(
      'status','blocked','code','invoice_fee_conflict','amount',amount,
      'unit','sek_invoice','calculation_type','per_invoice',
      'website_card_visible',coalesce(website_card_visible,true),
      'source','price_plan_version'
    )
  else jsonb_build_object(
    'status','ready','amount',amount,'unit','sek_invoice',
    'calculation_type','per_invoice',
    'website_card_visible',coalesce(website_card_visible,true),
    'source','price_plan_version'
  )
end
from scored;
$$;

comment on function public.gridex_invoice_fee_readiness(jsonb,numeric) is
  'Canonical invoice fee assertion. Zero is valid; null is missing. Presentation visibility never controls quote, contract or invoice calculation.';

create or replace function public.gridex_snapshot_with_invoice_fee(
  p_snapshot jsonb,p_amount numeric,p_website_card_visible boolean
) returns jsonb
language sql
immutable
set search_path=public,pg_temp
as $$
with retained as (
  select coalesce(jsonb_agg(component order by ordinal),'[]'::jsonb) as components
  from jsonb_array_elements(
    case when jsonb_typeof(coalesce(p_snapshot,'{}'::jsonb)->'price_components')='array'
      then coalesce(p_snapshot,'{}'::jsonb)->'price_components' else '[]'::jsonb end
  ) with ordinality rows(component,ordinal)
  where coalesce(
    nullif(component->>'component_code',''),
    nullif(component->>'component_type',''),
    nullif(component#>>'{metadata,component_code}','')
  )<>'invoice_fee'
), canonical as (
  select jsonb_build_object(
    'component_code','invoice_fee','component_type','invoice_fee','name','Fakturaavgift',
    'amount',p_amount,'calculation_type','per_invoice','unit','sek_invoice',
    'priority',110,'status','active','website_card_visible',coalesce(p_website_card_visible,false),
    'metadata',jsonb_build_object(
      'lifecycle','per_invoice',
      'visibility',jsonb_build_object(
        'website_card',coalesce(p_website_card_visible,false),
        'quote_breakdown',true,'checkout',true,'contract_document',true,'invoice',true
      )
    )
  ) as component
)
select jsonb_set(
  jsonb_set(
    coalesce(p_snapshot,'{}'::jsonb),
    '{website_visibility,invoice_fee}',to_jsonb(coalesce(p_website_card_visible,false)),true
  ),
  '{price_components}',retained.components||jsonb_build_array(canonical.component),true
)
from retained,canonical;
$$;

create or replace function public.gridex_upsert_internal_contract_offer(
  p_company_id uuid,p_offer_id uuid,p_payload jsonb,p_pricing_snapshot jsonb,p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_old public.contract_offers%rowtype;
  v_saved public.contract_offers%rowtype;
  v_pricing jsonb;
  v_new_id uuid;
  v_active boolean;
  v_status text;
  v_customer_type text;
  v_slug text;
  v_version integer;
  v_canonical uuid;
  v_identity uuid;
  v_invoice_fee numeric;
  v_invoice_fee_raw text;
  v_invoice_fee_readiness jsonb;
begin
  if p_company_id is null then
    raise exception using errcode='22023',message='company_required';
  end if;
  if p_offer_id is not null then
    select * into v_old
    from public.contract_offers
    where id=p_offer_id and company_id=p_company_id
    for update;
    if not found then
      raise exception using errcode='P0002',message='internal_contract_offer_not_found';
    end if;
  end if;

  v_status := coalesce(nullif(p_payload->>'status',''),'draft');
  v_active := coalesce((p_payload->>'is_active')::boolean,false) and v_status='active';
  v_customer_type := coalesce(nullif(p_payload->>'customer_type',''),'both');
  if v_status not in ('draft','active','inactive') then
    raise exception using errcode='22023',message='invalid_internal_contract_status';
  end if;
  if v_customer_type not in ('private','business','both') then
    raise exception using errcode='22023',message='invalid_customer_type';
  end if;

  v_invoice_fee_raw := nullif(btrim(coalesce(p_payload->>'invoice_fee_sek','')), '');
  if v_invoice_fee_raw is not null then
    if replace(v_invoice_fee_raw,',','.') !~ '^[0-9]+([.][0-9]+)?$' then
      raise exception using errcode='22023',message='invalid_invoice_fee';
    end if;
    v_invoice_fee := replace(v_invoice_fee_raw,',','.')::numeric;
    if v_invoice_fee < 0 then
      raise exception using errcode='22023',message='invalid_invoice_fee';
    end if;
  end if;
  if v_active and v_invoice_fee is null then
    raise exception using errcode='23514',message='invoice_fee_missing';
  end if;

  v_invoice_fee_readiness := public.gridex_invoice_fee_readiness(
    coalesce(p_pricing_snapshot,'{}'::jsonb), v_invoice_fee
  );
  if v_active and coalesce(v_invoice_fee_readiness->>'status','blocked') <> 'ready' then
    raise exception using errcode='23514',message=coalesce(v_invoice_fee_readiness->>'code','invoice_fee_missing');
  end if;

  v_identity := coalesce(v_old.id,gen_random_uuid());
  p_pricing_snapshot := coalesce(p_pricing_snapshot,'{}'::jsonb) || jsonb_build_object(
    'plan_code','internal-'||v_identity::text,
    'product_key','internal-'||v_identity::text
  );
  v_pricing := public.gridex_create_or_version_contract_pricing(
    p_company_id,
    p_payload->>'name',
    p_payload->>'contract_type',
    coalesce(p_payload->>'pricing_model','spot'),
    v_customer_type,
    p_pricing_snapshot,
    nullif(p_payload->>'valid_from','')::date,
    nullif(p_payload->>'valid_to','')::date,
    v_active,
    p_actor_user_id
  );
  v_slug := coalesce(
    nullif(p_payload->>'slug',''),
    lower(trim(both '-' from regexp_replace(p_payload->>'name','[^a-zA-Z0-9]+','-','g')))
  );

  if v_old.id is not null and (
    v_old.status='active'
    or exists(select 1 from public.customer_contracts where company_id=p_company_id and contract_offer_id=v_old.id)
  ) then
    update public.contract_offers
    set status='inactive',is_active=false,archived_at=coalesce(archived_at,now()),updated_by=p_actor_user_id,updated_at=now()
    where id=v_old.id;
    v_new_id:=gen_random_uuid();
    v_version:=coalesce(v_old.version_number,1)+1;
    v_slug:=left(v_slug,105)||'-v'||v_version;
  else
    v_new_id:=coalesce(v_old.id,gen_random_uuid());
    v_version:=coalesce(v_old.version_number,1);
  end if;

  insert into public.contract_offers(
    id,company_id,name,slug,status,contract_type,customer_type,campaign_name,campaign_code,campaign_version,
    price_version,terms_version,offer_version,version_number,version_snapshot,max_customers,discount_value,
    discount_unit,start_fee_sek,admin_fee_sek,break_fee_sek,vat_rate,description,fixed_price_ore_per_kwh,
    spot_markup_ore_per_kwh,variable_fee_ore_per_kwh,monthly_fee_sek,invoice_fee_sek,green_fee_mode,green_fee_value,
    default_binding_months,default_notice_months,optional_fee_lines,is_active,valid_from,valid_to,
    price_plan_id,price_plan_version_id,price_book_id,commercial_snapshot,automatic_renewal,
    power_of_attorney_required,legal_bundle_id,last_price_change_at,created_by,updated_by
  ) values(
    v_new_id,p_company_id,p_payload->>'name',v_slug,v_status,p_payload->>'contract_type',v_customer_type,
    nullif(p_payload->>'campaign_name',''),nullif(p_payload->>'campaign_code',''),nullif(p_payload->>'campaign_version',''),
    v_pricing->>'version_label',nullif(p_payload->>'terms_version',''),
    coalesce(nullif(p_payload->>'terms_version',''),v_pricing->>'version_label','v1'),v_version,
    jsonb_build_object(
      'model','canonical_price_plan_version',
      'price_plan_id',v_pricing->>'price_plan_id',
      'price_plan_version_id',v_pricing->>'price_plan_version_id',
      'price_book_id',v_pricing->>'price_book_id',
      'pricing_snapshot',p_pricing_snapshot,
      'legal_source','legal_template_versions'
    ),
    nullif(p_payload->>'max_customers','')::integer,
    nullif(p_payload->>'discount_value','')::numeric,
    nullif(p_payload->>'discount_unit',''),
    nullif(p_payload->>'start_fee_sek','')::numeric,
    nullif(p_payload->>'admin_fee_sek','')::numeric,
    nullif(p_payload->>'break_fee_sek','')::numeric,
    coalesce(nullif(p_payload->>'vat_rate','')::numeric,25),
    nullif(p_payload->>'description',''),
    nullif(p_payload->>'fixed_price_ore_per_kwh','')::numeric,
    nullif(p_payload->>'spot_markup_ore_per_kwh','')::numeric,
    nullif(p_payload->>'variable_fee_ore_per_kwh','')::numeric,
    nullif(p_payload->>'monthly_fee_sek','')::numeric,
    v_invoice_fee,
    coalesce(nullif(p_payload->>'green_fee_mode',''),'none'),
    nullif(p_payload->>'green_fee_value','')::numeric,
    nullif(p_payload->>'default_binding_months','')::integer,
    nullif(p_payload->>'default_notice_months','')::integer,
    coalesce(p_payload->'optional_fee_lines','[]'::jsonb),
    v_active,
    nullif(p_payload->>'valid_from','')::date,
    nullif(p_payload->>'valid_to','')::date,
    (v_pricing->>'price_plan_id')::uuid,
    (v_pricing->>'price_plan_version_id')::uuid,
    nullif(v_pricing->>'price_book_id','')::uuid,
    p_pricing_snapshot,
    coalesce((p_payload->>'automatic_renewal')::boolean,false),
    coalesce((p_payload->>'power_of_attorney_required')::boolean,true),
    null,
    case when coalesce((v_pricing->>'reused')::boolean,false)
      then coalesce(v_old.last_price_change_at,now()) else now() end,
    p_actor_user_id,p_actor_user_id
  )
  on conflict(id) do update set
    name=excluded.name,slug=excluded.slug,status=excluded.status,contract_type=excluded.contract_type,
    customer_type=excluded.customer_type,campaign_name=excluded.campaign_name,campaign_code=excluded.campaign_code,
    campaign_version=excluded.campaign_version,price_version=excluded.price_version,terms_version=excluded.terms_version,
    offer_version=excluded.offer_version,version_snapshot=excluded.version_snapshot,max_customers=excluded.max_customers,
    discount_value=excluded.discount_value,discount_unit=excluded.discount_unit,start_fee_sek=excluded.start_fee_sek,
    admin_fee_sek=excluded.admin_fee_sek,break_fee_sek=excluded.break_fee_sek,vat_rate=excluded.vat_rate,
    description=excluded.description,fixed_price_ore_per_kwh=excluded.fixed_price_ore_per_kwh,
    spot_markup_ore_per_kwh=excluded.spot_markup_ore_per_kwh,variable_fee_ore_per_kwh=excluded.variable_fee_ore_per_kwh,
    monthly_fee_sek=excluded.monthly_fee_sek,invoice_fee_sek=excluded.invoice_fee_sek,green_fee_mode=excluded.green_fee_mode,green_fee_value=excluded.green_fee_value,
    default_binding_months=excluded.default_binding_months,default_notice_months=excluded.default_notice_months,
    optional_fee_lines=excluded.optional_fee_lines,is_active=excluded.is_active,valid_from=excluded.valid_from,
    valid_to=excluded.valid_to,price_plan_id=excluded.price_plan_id,price_plan_version_id=excluded.price_plan_version_id,
    price_book_id=excluded.price_book_id,commercial_snapshot=excluded.commercial_snapshot,
    automatic_renewal=excluded.automatic_renewal,power_of_attorney_required=excluded.power_of_attorney_required,
    legal_bundle_id=null,last_price_change_at=excluded.last_price_change_at,updated_by=excluded.updated_by,updated_at=now()
  returning * into v_saved;

  v_canonical := public.gridex_sync_internal_offer_to_canonical(v_saved.id);
  select * into v_saved from public.contract_offers where id=v_saved.id;
  return jsonb_build_object(
    'offer',to_jsonb(v_saved),
    'pricing',v_pricing,
    'contract_product_version_id',v_canonical,
    'created_new_version',v_old.id is not null and v_saved.id<>v_old.id,
    'legal_source','legal_template_versions'
  );
end $$;

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
    pco.invoice_fee_sek as invoice_fee_row_amount,
    public.gridex_invoice_fee_readiness(ppv.snapshot_json,pco.invoice_fee_sek) as invoice_fee_readiness,
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
  left join public.public_contract_offers pco on pco.contract_publication_version_id=cpv.id and pco.company_id=a.company_id
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
      case when b.channel in('website','api') and coalesce(b.invoice_fee_readiness->>'status','blocked')<>'ready'
        then coalesce(b.invoice_fee_readiness->>'code','invoice_fee_missing') end,
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
  r.has_website_write_scope,
  r.invoice_fee_readiness
from readiness r;

comment on view public.contract_publication_readiness_v is
  'Publication readiness validates immutable legal, pricing and invoice-fee state. invoice_fee_missing/conflict/ambiguous block publication and applications; zero remains valid.';

create or replace function public.gridex_publish_contract_version(
  p_company_id uuid,p_draft_contract_id uuid,p_offer_code text,p_payload jsonb,p_pricing_snapshot jsonb,p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_result jsonb; v_publication_id uuid; v_readiness jsonb; v_message text; v_codes text[];
  v_payload jsonb:=coalesce(p_payload,'{}'::jsonb); v_legal_result jsonb:='{}'::jsonb;
  v_publish boolean; v_correlation_id text; v_audit_metadata jsonb;
  v_profile_status text; v_profile_missing_fields text[]; v_profile_review_required boolean;
  v_error_code text; v_user_message text;
  v_invoice_fee_raw text; v_invoice_fee numeric; v_invoice_fee_readiness jsonb;
begin
  begin
    if p_company_id is null or p_actor_user_id is null then raise exception using errcode='22023',message='company_and_actor_required'; end if;
    v_publish:=coalesce(v_payload->>'publication_status','draft')='published';
    v_correlation_id:=coalesce(nullif(v_payload#>>'{metadata,correlation_id}',''),gen_random_uuid()::text);

    v_invoice_fee_raw:=nullif(btrim(coalesce(v_payload->>'invoice_fee_sek','')),'');
    if v_invoice_fee_raw is not null then
      if replace(v_invoice_fee_raw,',','.') !~ '^[0-9]+([.][0-9]+)?$' then
        raise exception using errcode='23514',message='publication_not_ready:invoice_fee_missing';
      end if;
      v_invoice_fee:=replace(v_invoice_fee_raw,',','.')::numeric;
      if v_invoice_fee<0 then
        raise exception using errcode='23514',message='publication_not_ready:invoice_fee_missing';
      end if;
      v_payload:=jsonb_set(v_payload,'{invoice_fee_sek}',to_jsonb(v_invoice_fee),true);
    end if;
    if v_publish and v_invoice_fee is null then
      raise exception using errcode='23514',message='publication_not_ready:invoice_fee_missing';
    end if;
    v_invoice_fee_readiness:=public.gridex_invoice_fee_readiness(
      coalesce(p_pricing_snapshot,'{}'::jsonb),v_invoice_fee
    );
    if v_publish and coalesce(v_invoice_fee_readiness->>'status','blocked')<>'ready' then
      raise exception using errcode='23514',message='publication_not_ready:'||coalesce(v_invoice_fee_readiness->>'code','invoice_fee_missing');
    end if;

    if v_publish then
      select completeness_status,missing_fields,coalesce(review_required,false)
      into v_profile_status,v_profile_missing_fields,v_profile_review_required
      from public.tenant_legal_profiles where company_id=p_company_id;
      if not found then raise exception using errcode='23514',message='publication_not_ready:tenant_legal_profile_missing'; end if;
      if v_profile_status not in('complete','verified') or v_profile_review_required then
        v_codes:=array_remove(array[
          case when v_profile_status not in('complete','verified') then 'tenant_legal_profile_incomplete' end,
          case when v_profile_review_required then 'tenant_legal_profile_review_required' end
        ],null);
        select v_codes||coalesce(array_agg('missing_legal_profile_field:'||field order by field),'{}')
        into v_codes from unnest(coalesce(v_profile_missing_fields,'{}')) field;
        raise exception using errcode='23514',message='publication_not_ready:'||array_to_string(v_codes,',');
      end if;
    end if;

    v_payload:=jsonb_set(
      v_payload,'{metadata}',coalesce(v_payload->'metadata','{}'::jsonb)||jsonb_build_object(
        'correlation_id',v_correlation_id,
        'publication_command','gridex_publish_contract_version',
        'publication_command_version','2026-07-20.2',
        'legal_source','legal_template_versions'
      ),true
    )-'legal_bundle_id';

    if v_publish then
      v_legal_result:=public.gridex_resolve_or_create_legal_source_bundle(
        p_company_id,v_payload,coalesce(p_pricing_snapshot,'{}'::jsonb),p_actor_user_id
      );
    end if;

    v_result:=public.gridex_upsert_public_contract_offer(
      p_company_id,p_draft_contract_id,p_offer_code,v_payload,coalesce(p_pricing_snapshot,'{}'::jsonb),p_actor_user_id
    );
    v_publication_id:=nullif(v_result->>'contract_publication_version_id','')::uuid;

    if v_publication_id is not null then
      select jsonb_build_object(
        'status',readiness_status,'can_display',can_display,'can_accept_applications',can_accept_applications,
        'blockers',blockers,'display_blockers',display_blockers,'application_blockers',application_blockers,
        'legal_profile_missing_fields',legal_profile_missing_fields,'required_legal_modules',required_legal_modules,
        'included_legal_modules',included_legal_modules
      ) into v_readiness
      from public.contract_publication_readiness_v
      where contract_publication_version_id=v_publication_id;
    end if;

    if v_publish and exists(
      select 1
      from jsonb_array_elements_text(coalesce(v_readiness->'blockers','[]'::jsonb)) blocker
      where blocker in ('invoice_fee_missing','invoice_fee_conflict','invoice_fee_ambiguous')
    ) then
      select coalesce(array_agg(value order by value),'{}'::text[]) into v_codes
      from jsonb_array_elements_text(coalesce(v_readiness->'blockers','[]'::jsonb)) value
      where value in ('invoice_fee_missing','invoice_fee_conflict','invoice_fee_ambiguous');
      raise exception using errcode='23514',message='publication_not_ready:'||array_to_string(v_codes,',');
    end if;

    v_audit_metadata:=jsonb_strip_nulls(jsonb_build_object(
      'correlation_id',v_correlation_id,
      'offer_reference',v_result->>'offer_reference',
      'contract_publication_version_id',v_publication_id,
      'price_plan_id',v_result#>>'{pricing,price_plan_id}',
      'price_plan_version_id',v_result#>>'{pricing,price_plan_version_id}',
      'price_book_id',v_result#>>'{pricing,price_book_id}',
      'pricing_snapshot_sha256',v_result#>>'{pricing,content_sha256}',
      'legal_bundle_version_id',v_result#>>'{offer,legal_bundle_version_id}',
      'legal_source','legal_template_versions',
      'readiness',coalesce(v_readiness,'{}'::jsonb)
    ));

    insert into public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata)
    values(
      p_company_id,p_actor_user_id,'contract_publication_version',
      coalesce(v_publication_id::text,v_result#>>'{offer,id}',coalesce(p_draft_contract_id::text,'unknown')),
      case when v_publish then 'contract.publication.atomic_published' else 'contract.publication.atomic_draft_saved' end,
      null,v_result,v_audit_metadata
    );

    return coalesce(v_result,'{}'::jsonb)||jsonb_build_object(
      'ok',true,'readiness',coalesce(v_readiness,'{}'::jsonb),
      'correlation_id',v_correlation_id,'legal_source','legal_template_versions'
    );
  exception when others then
    v_message:=sqlerrm;
    v_correlation_id:=coalesce(v_correlation_id,gen_random_uuid()::text);
    if v_message like 'publication_not_ready:%' then
      v_error_code:='publication_not_ready'; v_user_message:='Avtalet kan inte publiceras ännu.';
      v_codes:=string_to_array(substring(v_message from length('publication_not_ready:')+1),',');
    elsif v_message like 'legal_requirement_rule_missing:%' then
      v_error_code:='legal_requirement_rule_missing'; v_user_message:='Juridikregler saknas för vald kund- eller avtalstyp.'; v_codes:=array[v_message];
    elsif v_message like 'canonical_legal_template_missing:%' then
      v_error_code:='canonical_legal_template_missing'; v_user_message:='Publicerade juridikmoduler saknas.';
      select coalesce(array_agg('missing_legal_module:'||module_key order by module_key),'{}') into v_codes
      from unnest(string_to_array(substring(v_message from length('canonical_legal_template_missing:')+1),',')) module_key;
    else
      raise;
    end if;

    insert into public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata)
    values(
      p_company_id,p_actor_user_id,'contract_publication_version',coalesce(p_draft_contract_id::text,'blocked'),
      'contract.publication.atomic_blocked',null,null,
      jsonb_build_object('correlation_id',v_correlation_id,'error_code',v_error_code,'blockers',v_codes,'database_message',v_message)
    );
    return jsonb_build_object('ok',false,'error_code',v_error_code,'message',v_user_message,'blockers',v_codes,'correlation_id',v_correlation_id);
  end;
end $$;

create or replace function public.gridex_invoice_fee_snapshot_candidate(p_snapshot jsonb)
returns jsonb
language sql
immutable
set search_path=public,pg_temp
as $$
with selected_snapshot as (
  select case
    when jsonb_typeof(coalesce(p_snapshot,'{}'::jsonb)->'price_components')='array'
      or jsonb_typeof(coalesce(p_snapshot,'{}'::jsonb)->'price_components_snapshot')='array'
      then coalesce(p_snapshot,'{}'::jsonb)
    when jsonb_typeof(coalesce(p_snapshot,'{}'::jsonb)->'pricing_snapshot')='object'
      then coalesce(p_snapshot,'{}'::jsonb)->'pricing_snapshot'
    else '{}'::jsonb
  end snapshot
), components as (
  select component
  from selected_snapshot,
  lateral jsonb_array_elements(
    case
      when jsonb_typeof(snapshot->'price_components')='array' then snapshot->'price_components'
      when jsonb_typeof(snapshot->'price_components_snapshot')='array' then snapshot->'price_components_snapshot'
      else '[]'::jsonb
    end
  ) component
  where coalesce(
    nullif(component->>'component_code',''),
    nullif(component->>'component_type',''),
    nullif(component#>>'{metadata,component_code}','')
  )='invoice_fee'
  and coalesce(nullif(component->>'status',''),'active')='active'
), normalized as (
  select
    public.gridex_safe_nonnegative_numeric(component->>'amount') amount,
    component->>'unit' unit,
    component->>'calculation_type' calculation_type,
    case
      when lower(coalesce(component->>'website_card_visible','')) in('true','false')
        then (component->>'website_card_visible')::boolean
      when lower(coalesce(component#>>'{metadata,visibility,website_card}','')) in('true','false')
        then (component#>>'{metadata,visibility,website_card}')::boolean
      else false
    end website_card_visible
  from components
), scored as (
  select
    count(*)::integer component_count,
    count(*) filter(where unit='sek_invoice' and calculation_type='per_invoice' and amount is not null)::integer valid_count,
    min(amount) filter(where unit='sek_invoice' and calculation_type='per_invoice' and amount is not null) amount,
    bool_or(website_card_visible) filter(where unit='sek_invoice' and calculation_type='per_invoice' and amount is not null) website_card_visible
  from normalized
)
select case
  when component_count>1 then jsonb_build_object('status','blocked','code','invoice_fee_ambiguous')
  when valid_count<>1 then jsonb_build_object('status','blocked','code','invoice_fee_missing')
  else jsonb_build_object(
    'status','ready','amount',amount,'unit','sek_invoice','calculation_type','per_invoice',
    'website_card_visible',coalesce(website_card_visible,false)
  )
end
from scored;
$$;

create table if not exists public.contract_invoice_fee_remediation_tasks (
  id uuid primary key default gen_random_uuid(),
  -- Legacy internal offers may predate tenant ownership. A null company_id is
  -- therefore reserved for platform-only remediation and is never exposed to a tenant.
  company_id uuid references public.companies(id) on delete cascade,
  source_table text not null check(source_table in('public_contract_offers','contract_offers')),
  offer_id uuid not null,
  status text not null default 'open' check(status in('open','resolved','failed')),
  blocker_code text,
  evidence jsonb not null default '{}'::jsonb,
  last_error text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_table,offer_id)
);

-- Keep reruns safe if an earlier manual attempt created the table before failing.
alter table public.contract_invoice_fee_remediation_tasks alter column company_id drop not null;
alter table public.contract_invoice_fee_remediation_tasks
  drop constraint if exists contract_invoice_fee_remediation_tasks_blocker_code_check;
alter table public.contract_invoice_fee_remediation_tasks
  add constraint contract_invoice_fee_remediation_tasks_blocker_code_check
  check(blocker_code is null or blocker_code in(
    'invoice_fee_missing','invoice_fee_conflict','invoice_fee_ambiguous',
    'tenant_context_missing','tenant_context_conflict'
  ));

create index if not exists contract_invoice_fee_remediation_company_status_idx
  on public.contract_invoice_fee_remediation_tasks(company_id,status,updated_at desc);
create index if not exists contract_invoice_fee_remediation_platform_status_idx
  on public.contract_invoice_fee_remediation_tasks(status,updated_at desc)
  where company_id is null;

alter table public.contract_invoice_fee_remediation_tasks enable row level security;
drop policy if exists contract_invoice_fee_remediation_service_role_all
  on public.contract_invoice_fee_remediation_tasks;
create policy contract_invoice_fee_remediation_service_role_all
  on public.contract_invoice_fee_remediation_tasks for all to service_role
  using(true) with check(true);

drop policy if exists contract_invoice_fee_remediation_tenant_read
  on public.contract_invoice_fee_remediation_tasks;
create policy contract_invoice_fee_remediation_tenant_read
  on public.contract_invoice_fee_remediation_tasks for select to authenticated
  using(
    public.gridex_user_is_platform_admin()
    or case
      when company_id is null then false
      else public.gridex_can_read_company(company_id)
    end
  );

create or replace function public.gridex_contract_offer_company_resolution(p_offer_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=public,pg_temp
as $$
with offer as (
  select o.* from public.contract_offers o where o.id=p_offer_id
), candidate_rows(company_id,source) as (
  select o.company_id,'contract_offers.company_id' from offer o
  union all
  select ppv.company_id,'price_plan_versions.company_id'
    from offer o join public.price_plan_versions ppv on ppv.id=o.price_plan_version_id
  union all
  select pp.company_id,'price_plans.company_id'
    from offer o join public.price_plans pp on pp.id=o.price_plan_id
  union all
  select cp.company_id,'contract_products.company_id'
    from offer o join public.contract_products cp on cp.id=o.contract_product_id
  union all
  select cp.company_id,'contract_product_versions.contract_product_id'
    from offer o
    join public.contract_product_versions cpv on cpv.id=o.contract_product_version_id
    join public.contract_products cp on cp.id=cpv.contract_product_id
  union all
  select tca.company_id,'tenant_contract_assignments.company_id'
    from offer o
    join public.tenant_contract_assignments tca
      on tca.contract_product_version_id=o.contract_product_version_id
  union all
  select cc.company_id,'customer_contracts.company_id'
    from public.customer_contracts cc
    where cc.contract_offer_id=p_offer_id
  union all
  select cov.company_id,'contract_offer_versions.company_id'
    from public.contract_offer_versions cov
    where cov.contract_offer_id=p_offer_id
), valid as (
  select company_id,source from candidate_rows where company_id is not null
), summary as (
  select
    count(distinct company_id)::integer company_count,
    coalesce(array_agg(distinct company_id order by company_id),'{}'::uuid[]) company_ids,
    coalesce(jsonb_agg(jsonb_build_object('company_id',company_id,'source',source)
      order by source,company_id),'[]'::jsonb) sources
  from valid
)
select case
  when company_count=1 then jsonb_build_object(
    'status','ready','company_id',company_ids[1],'sources',sources
  )
  when company_count=0 then jsonb_build_object(
    'status','blocked','code','tenant_context_missing','company_ids','[]'::jsonb,'sources',sources
  )
  else jsonb_build_object(
    'status','blocked','code','tenant_context_conflict','company_ids',to_jsonb(company_ids),'sources',sources
  )
end
from summary;
$$;

comment on function public.gridex_contract_offer_company_resolution(uuid) is
  'Resolves a legacy internal offer tenant only from deterministic relational evidence. Missing or conflicting ownership is platform-remediated and never guessed.';

create or replace function public.gridex_record_invoice_fee_remediation(
  p_company_id uuid,p_source_table text,p_offer_id uuid,p_status text,
  p_blocker_code text,p_evidence jsonb,p_error text default null
) returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if p_company_id is null
     and coalesce(p_blocker_code,'') not in('tenant_context_missing','tenant_context_conflict') then
    raise exception using errcode='23502',message='company_required_for_tenant_remediation';
  end if;

  insert into public.contract_invoice_fee_remediation_tasks(
    company_id,source_table,offer_id,status,blocker_code,evidence,last_error,resolved_at,updated_at
  ) values(
    p_company_id,p_source_table,p_offer_id,p_status,p_blocker_code,coalesce(p_evidence,'{}'::jsonb),p_error,
    case when p_status='resolved' then now() else null end,now()
  )
  on conflict(source_table,offer_id) do update set
    company_id=excluded.company_id,status=excluded.status,blocker_code=excluded.blocker_code,
    evidence=excluded.evidence,last_error=excluded.last_error,resolved_at=excluded.resolved_at,updated_at=now();
end $$;

create or replace function public.gridex_backfill_invoice_fees()
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_public public.public_contract_offers%rowtype;
  v_internal public.contract_offers%rowtype;
  v_ppv_snapshot jsonb;
  v_commercial_snapshot jsonb;
  v_materialized_snapshot jsonb;
  v_candidate jsonb;
  v_candidates numeric[];
  v_distinct numeric[];
  v_sources jsonb;
  v_amount numeric;
  v_visible boolean;
  v_ambiguous boolean;
  v_code text;
  v_actor uuid;
  v_pricing_model text;
  v_corrected jsonb;
  v_payload jsonb;
  v_result jsonb;
  v_processed integer:=0;
  v_resolved integer:=0;
  v_blocked integer:=0;
  v_failed integer:=0;
  v_error text;
  v_company_resolution jsonb;
  v_effective_company_id uuid;
  v_original_company_id uuid;
begin
  -- Public offers: exact locked price version, commercial snapshot,
  -- materialized components, then compatibility row. Different values conflict.
  for v_public in
    select o.* from public.public_contract_offers o
    left join public.price_plan_versions ppv on ppv.id=o.price_plan_version_id
    where o.publication_status in('draft','review','published')
      and coalesce(o.is_archived,false)=false
      and coalesce(public.gridex_invoice_fee_readiness(coalesce(ppv.snapshot_json,'{}'::jsonb),o.invoice_fee_sek)->>'status','blocked')<>'ready'
    order by o.created_at,o.id
  loop
    v_processed:=v_processed+1;
    v_candidates:='{}'::numeric[]; v_sources:='[]'::jsonb; v_ambiguous:=false; v_visible:=false;
    select ppv.snapshot_json,
           cpv.commercial_snapshot,
           coalesce(cpv.pricing_model,ppv.snapshot_json->>'pricing_model','spot')
      into v_ppv_snapshot,v_commercial_snapshot,v_pricing_model
    from public.public_contract_offers o
    left join public.price_plan_versions ppv on ppv.id=o.price_plan_version_id and ppv.company_id=o.company_id
    left join public.contract_publication_versions pubv on pubv.id=o.contract_publication_version_id
    left join public.contract_product_versions cpv on cpv.id=coalesce(o.contract_product_version_id,pubv.contract_product_version_id)
    where o.id=v_public.id and o.company_id=v_public.company_id;

    select jsonb_build_object('price_components',coalesce(jsonb_agg(jsonb_build_object(
      'component_type',pc.component_type,'component_code',coalesce(pc.metadata->>'component_code',pc.component_type),
      'amount',pc.amount,'unit',pc.unit,'calculation_type',pc.calculation_type,'status',pc.status,
      'website_card_visible',case when lower(coalesce(pc.metadata#>>'{visibility,website_card}','')) in('true','false') then (pc.metadata#>>'{visibility,website_card}')::boolean else false end,'metadata',pc.metadata
    ) order by pc.priority,pc.id),'[]'::jsonb))
    into v_materialized_snapshot
    from public.price_components pc
    where pc.company_id=v_public.company_id and pc.price_plan_version_id=v_public.price_plan_version_id
      and pc.status='active' and (pc.component_type='invoice_fee' or pc.metadata->>'component_code'='invoice_fee');

    foreach v_candidate in array array[
      public.gridex_invoice_fee_snapshot_candidate(v_ppv_snapshot),
      public.gridex_invoice_fee_snapshot_candidate(v_commercial_snapshot),
      public.gridex_invoice_fee_snapshot_candidate(v_materialized_snapshot)
    ] loop
      if v_candidate->>'status'='ready' then
        v_candidates:=array_append(v_candidates,(v_candidate->>'amount')::numeric);
        v_sources:=v_sources||jsonb_build_array(v_candidate);
        if jsonb_array_length(v_sources)=1 then v_visible:=coalesce((v_candidate->>'website_card_visible')::boolean,false); end if;
      elsif v_candidate->>'code'='invoice_fee_ambiguous' then
        v_ambiguous:=true;
      end if;
    end loop;
    if v_public.invoice_fee_sek is not null and v_public.invoice_fee_sek>=0 then
      v_candidates:=array_append(v_candidates,v_public.invoice_fee_sek);
      v_sources:=v_sources||jsonb_build_array(jsonb_build_object('status','ready','amount',v_public.invoice_fee_sek,'source','compatibility_row'));
    end if;
    select coalesce(array_agg(distinct value order by value),'{}'::numeric[]) into v_distinct from unnest(v_candidates) value;

    if v_ambiguous then v_code:='invoice_fee_ambiguous';
    elsif cardinality(v_distinct)=0 then v_code:='invoice_fee_missing';
    elsif cardinality(v_distinct)>1 then v_code:='invoice_fee_conflict';
    else v_code:=null; end if;

    if v_code is not null then
      perform public.gridex_record_invoice_fee_remediation(v_public.company_id,'public_contract_offers',v_public.id,'open',v_code,
        jsonb_build_object('candidate_values',to_jsonb(v_distinct),'sources',v_sources,'source_order',jsonb_build_array('price_plan_version','commercial_snapshot','materialized_price_components','compatibility_row')));
      v_blocked:=v_blocked+1; continue;
    end if;

    v_amount:=v_distinct[1]; v_actor:=coalesce(v_public.updated_by,v_public.created_by);
    if v_actor is null or nullif(v_public.offer_code,'') is null then
      perform public.gridex_record_invoice_fee_remediation(v_public.company_id,'public_contract_offers',v_public.id,'failed','invoice_fee_missing',
        jsonb_build_object('candidate_values',to_jsonb(v_distinct),'sources',v_sources),'Backfill saknar aktör eller avtalskod.');
      v_failed:=v_failed+1; continue;
    end if;

    v_corrected:=public.gridex_snapshot_with_invoice_fee(
      coalesce(v_ppv_snapshot,v_commercial_snapshot,v_public.metadata->'pricing_snapshot','{}'::jsonb),v_amount,v_visible
    );
    v_payload:=to_jsonb(v_public)||jsonb_build_object(
      'invoice_fee_sek',v_amount,'pricing_model',coalesce(v_pricing_model,'spot'),
      'metadata',coalesce(v_public.metadata,'{}'::jsonb)||jsonb_build_object('invoice_fee_backfill',true,'invoice_fee_backfill_sources',v_sources)
    );
    begin
      v_result:=public.gridex_publish_contract_version(
        v_public.company_id,v_public.id,v_public.offer_code,v_payload,v_corrected,v_actor
      );
      if coalesce((v_result->>'ok')::boolean,false)=false then
        raise exception '%',coalesce(v_result->>'message','invoice_fee_backfill_failed');
      end if;
      perform public.gridex_record_invoice_fee_remediation(v_public.company_id,'public_contract_offers',v_public.id,'resolved',null,
        jsonb_build_object('old_value',v_public.invoice_fee_sek,'new_value',v_amount,'sources',v_sources,'new_offer_id',v_result#>>'{offer,id}','new_publication_version_id',v_result->>'contract_publication_version_id'));
      insert into public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata)
      values(v_public.company_id,v_actor,'public_contract_offer',v_public.id::text,'contract.invoice_fee.backfilled',
        jsonb_build_object('invoice_fee_sek',v_public.invoice_fee_sek),jsonb_build_object('invoice_fee_sek',v_amount),
        jsonb_build_object('version_safe',true,'sources',v_sources,'result',v_result));
      v_resolved:=v_resolved+1;
    exception when others then
      v_error:=sqlerrm;
      perform public.gridex_record_invoice_fee_remediation(v_public.company_id,'public_contract_offers',v_public.id,'failed','invoice_fee_conflict',
        jsonb_build_object('candidate_values',to_jsonb(v_distinct),'sources',v_sources),v_error);
      v_failed:=v_failed+1;
    end;
  end loop;

  -- Internal offers use the same deterministic evidence order and canonical RPC.
  for v_internal in
    select o.* from public.contract_offers o
    left join public.price_plan_versions ppv on ppv.id=o.price_plan_version_id
    where o.status in('draft','active') and coalesce(o.archived_at is not null,false)=false
      and coalesce(public.gridex_invoice_fee_readiness(coalesce(ppv.snapshot_json,o.commercial_snapshot,'{}'::jsonb),o.invoice_fee_sek)->>'status','blocked')<>'ready'
    order by o.created_at,o.id
  loop
    v_processed:=v_processed+1;
    v_candidates:='{}'::numeric[]; v_sources:='[]'::jsonb; v_ambiguous:=false; v_visible:=false;

    -- Old internal offers were historically allowed to have company_id=null.
    -- Resolve ownership only from exact relational evidence; never select an arbitrary tenant.
    v_original_company_id:=v_internal.company_id;
    v_company_resolution:=public.gridex_contract_offer_company_resolution(v_internal.id);
    if coalesce(v_company_resolution->>'status','blocked')<>'ready' then
      v_code:=coalesce(v_company_resolution->>'code','tenant_context_missing');
      perform public.gridex_record_invoice_fee_remediation(
        null,'contract_offers',v_internal.id,'open',v_code,
        jsonb_build_object(
          'company_resolution',v_company_resolution,
          'source_order',jsonb_build_array(
            'contract_offers.company_id','price_plan_versions.company_id','price_plans.company_id',
            'contract_products.company_id','contract_product_versions.contract_product_id',
            'tenant_contract_assignments.company_id','customer_contracts.company_id','contract_offer_versions.company_id'
          )
        )
      );
      v_blocked:=v_blocked+1;
      continue;
    end if;

    v_effective_company_id:=(v_company_resolution->>'company_id')::uuid;
    if v_internal.company_id is null then
      update public.contract_offers
      set company_id=v_effective_company_id,updated_at=now()
      where id=v_internal.id and company_id is null;

      select * into v_internal
      from public.contract_offers
      where id=v_internal.id
      for update;

      if v_internal.company_id is distinct from v_effective_company_id then
        perform public.gridex_record_invoice_fee_remediation(
          null,'contract_offers',v_internal.id,'open','tenant_context_conflict',
          jsonb_build_object(
            'company_resolution',v_company_resolution,
            'current_company_id',v_internal.company_id,
            'expected_company_id',v_effective_company_id
          )
        );
        v_blocked:=v_blocked+1;
        continue;
      end if;

      insert into public.audit_logs(
        company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata
      ) values(
        v_effective_company_id,coalesce(v_internal.updated_by,v_internal.created_by),
        'contract_offer',v_internal.id::text,'contract.company_id.backfilled',
        jsonb_build_object('company_id',v_original_company_id),
        jsonb_build_object('company_id',v_effective_company_id),
        jsonb_build_object('deterministic',true,'company_resolution',v_company_resolution)
      );
    end if;

    select ppv.snapshot_json,cpv.commercial_snapshot,coalesce(cpv.pricing_model,ppv.snapshot_json->>'pricing_model',o.commercial_snapshot->>'pricing_model','spot')
      into v_ppv_snapshot,v_commercial_snapshot,v_pricing_model
    from public.contract_offers o
    left join public.price_plan_versions ppv on ppv.id=o.price_plan_version_id and ppv.company_id=o.company_id
    left join public.contract_product_versions cpv on cpv.id=o.contract_product_version_id
    where o.id=v_internal.id and o.company_id=v_internal.company_id;

    select jsonb_build_object('price_components',coalesce(jsonb_agg(jsonb_build_object(
      'component_type',pc.component_type,'component_code',coalesce(pc.metadata->>'component_code',pc.component_type),
      'amount',pc.amount,'unit',pc.unit,'calculation_type',pc.calculation_type,'status',pc.status,
      'website_card_visible',case when lower(coalesce(pc.metadata#>>'{visibility,website_card}','')) in('true','false') then (pc.metadata#>>'{visibility,website_card}')::boolean else false end,'metadata',pc.metadata
    ) order by pc.priority,pc.id),'[]'::jsonb))
    into v_materialized_snapshot
    from public.price_components pc
    where pc.company_id=v_internal.company_id and pc.price_plan_version_id=v_internal.price_plan_version_id
      and pc.status='active' and (pc.component_type='invoice_fee' or pc.metadata->>'component_code'='invoice_fee');

    foreach v_candidate in array array[
      public.gridex_invoice_fee_snapshot_candidate(v_ppv_snapshot),
      public.gridex_invoice_fee_snapshot_candidate(coalesce(v_commercial_snapshot,v_internal.commercial_snapshot)),
      public.gridex_invoice_fee_snapshot_candidate(v_materialized_snapshot)
    ] loop
      if v_candidate->>'status'='ready' then
        v_candidates:=array_append(v_candidates,(v_candidate->>'amount')::numeric);
        v_sources:=v_sources||jsonb_build_array(v_candidate);
        if jsonb_array_length(v_sources)=1 then v_visible:=coalesce((v_candidate->>'website_card_visible')::boolean,false); end if;
      elsif v_candidate->>'code'='invoice_fee_ambiguous' then v_ambiguous:=true; end if;
    end loop;
    if v_internal.invoice_fee_sek is not null and v_internal.invoice_fee_sek>=0 then
      v_candidates:=array_append(v_candidates,v_internal.invoice_fee_sek);
      v_sources:=v_sources||jsonb_build_array(jsonb_build_object('status','ready','amount',v_internal.invoice_fee_sek,'source','compatibility_row'));
    end if;
    select coalesce(array_agg(distinct value order by value),'{}'::numeric[]) into v_distinct from unnest(v_candidates) value;
    if v_ambiguous then v_code:='invoice_fee_ambiguous';
    elsif cardinality(v_distinct)=0 then v_code:='invoice_fee_missing';
    elsif cardinality(v_distinct)>1 then v_code:='invoice_fee_conflict';
    else v_code:=null; end if;

    if v_code is not null then
      perform public.gridex_record_invoice_fee_remediation(v_internal.company_id,'contract_offers',v_internal.id,'open',v_code,
        jsonb_build_object('candidate_values',to_jsonb(v_distinct),'sources',v_sources,'source_order',jsonb_build_array('price_plan_version','commercial_snapshot','materialized_price_components','compatibility_row')));
      v_blocked:=v_blocked+1; continue;
    end if;

    v_amount:=v_distinct[1]; v_actor:=coalesce(v_internal.updated_by,v_internal.created_by);
    if v_actor is null then
      perform public.gridex_record_invoice_fee_remediation(v_internal.company_id,'contract_offers',v_internal.id,'failed','invoice_fee_missing',
        jsonb_build_object('candidate_values',to_jsonb(v_distinct),'sources',v_sources),'Backfill saknar aktör.');
      v_failed:=v_failed+1; continue;
    end if;
    v_corrected:=public.gridex_snapshot_with_invoice_fee(
      coalesce(v_ppv_snapshot,v_commercial_snapshot,v_internal.commercial_snapshot,'{}'::jsonb),v_amount,v_visible
    );
    v_payload:=to_jsonb(v_internal)||jsonb_build_object('invoice_fee_sek',v_amount,'pricing_model',coalesce(v_pricing_model,'spot'));
    begin
      v_result:=public.gridex_upsert_internal_contract_offer(v_internal.company_id,v_internal.id,v_payload,v_corrected,v_actor);
      perform public.gridex_record_invoice_fee_remediation(v_internal.company_id,'contract_offers',v_internal.id,'resolved',null,
        jsonb_build_object('old_value',v_internal.invoice_fee_sek,'new_value',v_amount,'sources',v_sources,'new_offer_id',v_result#>>'{offer,id}'));
      insert into public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata)
      values(v_internal.company_id,v_actor,'contract_offer',v_internal.id::text,'contract.invoice_fee.backfilled',
        jsonb_build_object('invoice_fee_sek',v_internal.invoice_fee_sek),jsonb_build_object('invoice_fee_sek',v_amount),
        jsonb_build_object('version_safe',true,'sources',v_sources,'result',v_result));
      v_resolved:=v_resolved+1;
    exception when others then
      v_error:=sqlerrm;
      perform public.gridex_record_invoice_fee_remediation(v_internal.company_id,'contract_offers',v_internal.id,'failed','invoice_fee_conflict',
        jsonb_build_object('candidate_values',to_jsonb(v_distinct),'sources',v_sources),v_error);
      v_failed:=v_failed+1;
    end;
  end loop;

  return jsonb_build_object('processed',v_processed,'resolved',v_resolved,'blocked',v_blocked,'failed',v_failed);
end $$;

revoke all on function public.gridex_contract_offer_company_resolution(uuid) from public,anon,authenticated;
grant execute on function public.gridex_contract_offer_company_resolution(uuid) to service_role;
revoke all on function public.gridex_record_invoice_fee_remediation(uuid,text,uuid,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.gridex_record_invoice_fee_remediation(uuid,text,uuid,text,text,jsonb,text) to service_role;
revoke all on function public.gridex_backfill_invoice_fees() from public,anon,authenticated;
grant execute on function public.gridex_backfill_invoice_fees() to service_role;
grant select on public.contract_invoice_fee_remediation_tasks to authenticated,service_role;
grant insert,update,delete on public.contract_invoice_fee_remediation_tasks to service_role;

-- Migration-time run is idempotent. Unresolvable or conflicting rows are queued
-- and never coerced to zero.
select public.gridex_backfill_invoice_fees();

-- Contract assertions protect future migration replacements from silently
-- dropping invoice_fee_sek again.
do $$
declare v_definition text;
begin
  select pg_get_functiondef('public.gridex_upsert_internal_contract_offer(uuid,uuid,jsonb,jsonb,uuid)'::regprocedure)
    into v_definition;
  if position('invoice_fee_sek' in v_definition)=0 or position('invoice_fee_sek=excluded.invoice_fee_sek' in replace(v_definition,' ',''))=0 then
    raise exception 'invoice_fee_internal_rpc_contract_missing';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='contract_offers' and column_name='invoice_fee_sek') then
    raise exception 'contract_offers_invoice_fee_column_missing';
  end if;
end $$;

commit;
