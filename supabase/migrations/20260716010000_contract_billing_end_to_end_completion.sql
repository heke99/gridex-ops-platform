-- Gridex contract, pricing, legal, metering and invoice end-to-end completion.
-- The migration makes the canonical publication version the immutable source of truth.

begin;
create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Version identity and tenant isolation
-- -----------------------------------------------------------------------------
alter table public.contract_products add column if not exists company_id uuid references public.companies(id) on delete cascade;
alter table public.contract_products drop constraint if exists contract_products_product_code_key;
create unique index if not exists contract_products_company_code_uidx
  on public.contract_products(company_id, product_code) where company_id is not null;

alter table public.public_contract_offers
  add column if not exists version_series_id uuid,
  add column if not exists version_number integer,
  add column if not exists supersedes_offer_id uuid references public.public_contract_offers(id) on delete restrict,
  add column if not exists contract_product_id uuid references public.contract_products(id) on delete restrict,
  add column if not exists contract_product_version_id uuid references public.contract_product_versions(id) on delete restrict,
  add column if not exists legal_bundle_version_id uuid references public.legal_bundle_versions(id) on delete restrict,
  add column if not exists contract_publication_version_id uuid references public.contract_publication_versions(id) on delete restrict;

update public.public_contract_offers
set version_series_id=coalesce(version_series_id,id), version_number=coalesce(version_number,1)
where version_series_id is null or version_number is null;

alter table public.public_contract_offers alter column version_series_id set default gen_random_uuid();
alter table public.public_contract_offers alter column version_series_id set not null;
alter table public.public_contract_offers alter column version_number set default 1;
alter table public.public_contract_offers alter column version_number set not null;
create unique index if not exists public_contract_offers_series_version_uidx
  on public.public_contract_offers(company_id,version_series_id,version_number);
create unique index if not exists public_contract_offers_active_series_uidx
  on public.public_contract_offers(company_id,version_series_id)
  where publication_status='published' and is_archived=false;

alter table public.public_contract_offers drop constraint if exists public_contract_offers_publication_status_check;
alter table public.public_contract_offers add constraint public_contract_offers_publication_status_check
  check (publication_status in ('draft','review','published','unpublished','superseded','archived','expired'));
alter table public.public_contract_offers drop constraint if exists public_contract_offers_contract_type_check;
alter table public.public_contract_offers add constraint public_contract_offers_contract_type_check
  check (contract_type in ('spot','variable','variable_spot','variable_monthly','variable_hourly','variable_quarterly','hourly_spot','fixed','portfolio','mixed','manual_override'));

-- Published rows never change through normal writes. Controlled transition functions
-- set a transaction-local flag and may only move lifecycle fields forward.
create or replace function public.gridex_protect_published_legacy_offer()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if old.publication_status='published'
     and coalesce(current_setting('gridex.public_offer_write',true),'')<>'on' then
    raise exception using errcode='55000',message='published_offer_is_immutable_create_new_version';
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;

drop trigger if exists public_contract_offers_protect_published on public.public_contract_offers;
create trigger public_contract_offers_protect_published before update or delete on public.public_contract_offers
for each row execute function public.gridex_protect_published_legacy_offer();

create or replace function public.gridex_reject_locked_row_mutation()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if (nullif(to_jsonb(old)->>'locked_at','') is not null or nullif(to_jsonb(old)->>'published_at','') is not null)
     and coalesce(current_setting('gridex.version_transition',true),'')<>'on' then
    raise exception using errcode='55000',message='immutable_version_locked';
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;

-- Canonical synchronization is explicit and transaction-bound through the RPC below.
drop trigger if exists public_contract_offers_canonical_sync on public.public_contract_offers;

-- -----------------------------------------------------------------------------
-- Pricing normalization and immutable versioning
-- -----------------------------------------------------------------------------
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
language plpgsql security definer set search_path=public,pg_temp as $$
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
      if (v_component->>'unit') not in ('sek_month','sek_invoice','sek_once','sek_contract','sek_event','ore_per_kwh','sek_per_kwh') then
        raise exception 'Ogiltig priskomponentenhet: %',v_component->>'unit';
      end if;
      insert into public.price_components(company_id,price_plan_version_id,component_type,name,description,calculation_type,amount,unit,vat_applicable,invoice_line_visible,periodization_mode,priority,valid_from,valid_to,status,metadata,created_by)
      values(p_company_id,v_version_id,coalesce(v_component->>'component_type','fee'),coalesce(v_component->>'name',v_component->>'component_code','Avgift'),v_component->>'description',
        coalesce(v_component->>'calculation_type','fixed_once'),(v_component->>'amount')::numeric,v_component->>'unit',coalesce((v_component->>'vat_applicable')::boolean,true),
        coalesce((v_component->>'invoice_line_visible')::boolean,true),coalesce(v_component->>'periodization_mode','none'),coalesce((v_component->>'priority')::integer,100),
        p_valid_from,p_valid_to,case when p_publish then 'active' else 'draft' end,coalesce(v_component->'metadata','{}'::jsonb)||jsonb_build_object('component_code',v_component->>'component_code'),p_actor_user_id);
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

-- -----------------------------------------------------------------------------
-- Legal materialization
-- -----------------------------------------------------------------------------
create or replace function public.gridex_legacy_legal_type_for_module(p_module text)
returns text language sql immutable set search_path=public,pg_temp as $$
select case
  when p_module in ('privacy_policy') then 'privacy_policy'
  when p_module in ('withdrawal_right','withdrawal_form','pre_contract_information') then 'withdrawal'
  when p_module in ('power_of_attorney') then 'power_of_attorney'
  when p_module in ('price_terms','variable_price_terms','hourly_price_terms','quarterly_price_terms','fixed_price_terms','portfolio_terms','mixed_price_terms') then 'price_terms'
  else 'terms' end
$$;

create or replace function public.gridex_materialize_legal_bundle_version(
  p_company_id uuid,p_contract_product_version_id uuid,p_legacy_legal_bundle_id uuid,p_actor_user_id uuid default null
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_required text[]; v_module text; v_legacy_type text; v_text record;
  v_bundle_id uuid; v_number integer; v_hash text; v_docs jsonb:='[]'::jsonb; v_unresolved text[]:='{}';
begin
  select required_legal_modules into v_required from public.contract_product_versions where id=p_contract_product_version_id;
  if p_legacy_legal_bundle_id is null then raise exception 'Juridiskt paket saknas.'; end if;
  if not exists(select 1 from public.legal_bundles where id=p_legacy_legal_bundle_id and company_id=p_company_id and status in ('published','active')) then
    raise exception 'Juridiskt paket är inte publicerat för bolaget.';
  end if;

  foreach v_module in array coalesce(v_required,'{}') loop
    v_legacy_type:=public.gridex_legacy_legal_type_for_module(v_module);
    select ltv.* into v_text
    from public.legal_bundle_items lbi join public.legal_text_versions ltv on ltv.id=lbi.legal_text_version_id
    where lbi.legal_bundle_id=p_legacy_legal_bundle_id and lbi.type=v_legacy_type and ltv.company_id=p_company_id and ltv.status='published'
    order by lbi.sort_order,ltv.published_at desc limit 1;
    if not found then
      v_unresolved:=array_append(v_unresolved,'missing_document:'||v_module);
    else
      v_docs:=v_docs||jsonb_build_array(jsonb_build_object('module_key',v_module,'legacy_id',v_text.id,'type',v_legacy_type,'title',v_text.title,'body_sha256',encode(digest(v_text.body,'sha256'),'hex')));
    end if;
  end loop;
  v_hash:=encode(digest(jsonb_build_object('company_id',p_company_id,'contract_product_version_id',p_contract_product_version_id,'legacy_bundle_id',p_legacy_legal_bundle_id,'documents',v_docs)::text,'sha256'),'hex');
  select id into v_bundle_id from public.legal_bundle_versions where company_id=p_company_id and contract_product_version_id=p_contract_product_version_id and content_sha256=v_hash limit 1;
  if v_bundle_id is not null then return v_bundle_id; end if;

  select coalesce(max(version_number),0)+1 into v_number from public.legal_bundle_versions where company_id=p_company_id and contract_product_version_id=p_contract_product_version_id;
  insert into public.legal_bundle_versions(company_id,contract_product_version_id,legacy_legal_bundle_id,version_number,legal_mode,rendered_snapshot,unresolved_variables,content_sha256,status,created_by)
  values(p_company_id,p_contract_product_version_id,p_legacy_legal_bundle_id,v_number,'ops_standard',jsonb_build_object('documents',v_docs),v_unresolved,v_hash,'draft',p_actor_user_id)
  returning id into v_bundle_id;

  foreach v_module in array coalesce(v_required,'{}') loop
    v_legacy_type:=public.gridex_legacy_legal_type_for_module(v_module);
    select ltv.* into v_text
    from public.legal_bundle_items lbi join public.legal_text_versions ltv on ltv.id=lbi.legal_text_version_id
    where lbi.legal_bundle_id=p_legacy_legal_bundle_id and lbi.type=v_legacy_type and ltv.company_id=p_company_id and ltv.status='published'
    order by lbi.sort_order,ltv.published_at desc limit 1;
    if found then
      insert into public.legal_bundle_version_documents(legal_bundle_version_id,module_key,legacy_legal_text_version_id,title,rendered_body,content_sha256,sort_order)
      values(v_bundle_id,v_module,v_text.id,v_text.title,v_text.body,encode(digest(v_text.body,'sha256'),'hex'),array_position(v_required,v_module)*10);
    end if;
  end loop;
  return v_bundle_id;
end $$;

-- -----------------------------------------------------------------------------
-- Canonical readiness and strict publishing
-- -----------------------------------------------------------------------------
create or replace view public.contract_publication_readiness_v as
select cpv.id contract_publication_version_id,a.company_id,a.id assignment_id,cpv.status,cpv.locked_at,cpv.valid_from,cpv.valid_to,
  cpv.price_plan_id,cpv.price_plan_version_id,cpv.price_book_id,cpv.legal_bundle_version_id,
  lbv.status legal_bundle_status,lbv.locked_at legal_bundle_locked_at,lbv.unresolved_variables,
  tlp.completeness_status legal_profile_status,pv.status contract_version_status,pv.required_legal_modules,
  coalesce(array(select d.module_key from public.legal_bundle_version_documents d where d.legal_bundle_version_id=lbv.id order by d.sort_order),'{}') included_legal_modules,
  array_remove(array[
    case when coalesce(tlp.completeness_status,'incomplete') not in ('complete','verified') then 'tenant_legal_profile_incomplete' end,
    case when pv.status<>'approved' or pv.locked_at is null then 'contract_version_not_approved' end,
    case when coalesce(array_length(pv.price_areas,1),0)=0 then 'price_areas_missing' end,
    case when exists(select 1 from unnest(pv.price_areas) a2 where a2 not in ('SE1','SE2','SE3','SE4')) then 'price_area_invalid' end,
    case when pp.id is null or pp.company_id<>a.company_id or pp.status not in ('active','published','approved') then 'price_plan_not_active' end,
    case when ppv.id is null or ppv.company_id<>a.company_id or ppv.price_plan_id<>cpv.price_plan_id or ppv.status not in ('active','published','approved') or ppv.locked_at is null then 'price_plan_version_not_locked' end,
    case when pb.id is null or pb.company_id<>a.company_id or pb.price_plan_version_id<>cpv.price_plan_version_id or pb.status not in ('active','published') or pb.locked_at is null then 'price_book_not_locked' end,
    case when lbv.id is null or lbv.company_id<>a.company_id or lbv.status<>'published' or lbv.locked_at is null then 'legal_bundle_not_locked' end,
    case when coalesce(array_length(lbv.unresolved_variables,1),0)>0 then 'unresolved_legal_variables' end,
    case when cpv.valid_to is not null and cpv.valid_from is not null and cpv.valid_to<cpv.valid_from then 'invalid_validity_period' end,
    case when pv.contract_type in ('portfolio','mixed') and exists(
      select 1
      from unnest(pv.price_areas) required_area
      where not exists(
        select 1
        from public.portfolio_monthly_prices pmp
        where pmp.company_id=a.company_id
          and pmp.status='locked'
          and pmp.locked_at is not null
          and pmp.superseded_at is null
          and pmp.price_area=required_area
          and pmp.billing_month=to_char(coalesce(cpv.valid_from,now()) at time zone 'Europe/Stockholm','YYYY-MM')
      )
    ) then 'portfolio_price_source_missing_or_unlocked' end,
    case when cp.channel in ('website','api') and not exists(
      select 1 from public.integration_api_clients i where i.company_id=a.company_id and i.status='active' and i.scopes @> array['website_contracts.read','website_applications.write']::text[]
    ) then 'website_api_client_scopes_missing' end
  ],null)
  ||coalesce(array(select 'missing_legal_module:'||m from unnest(coalesce(pv.required_legal_modules,'{}')) m where not exists(select 1 from public.legal_bundle_version_documents d where d.legal_bundle_version_id=cpv.legal_bundle_version_id and d.module_key=m)),'{}') blockers
from public.contract_publication_versions cpv
join public.contract_publications cp on cp.id=cpv.contract_publication_id
join public.tenant_contract_assignments a on a.id=cp.assignment_id
join public.contract_product_versions pv on pv.id=cpv.contract_product_version_id
left join public.legal_bundle_versions lbv on lbv.id=cpv.legal_bundle_version_id
left join public.tenant_legal_profiles tlp on tlp.company_id=a.company_id
left join public.price_plans pp on pp.id=cpv.price_plan_id
left join public.price_plan_versions ppv on ppv.id=cpv.price_plan_version_id
left join public.price_books pb on pb.id=cpv.price_book_id;

create or replace function public.gridex_publish_contract_publication_version(p_publication_version_id uuid,p_actor_user_id uuid default null)
returns public.contract_publication_versions language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.contract_publication_versions; v_blockers text[]; v_company uuid; v_product uuid;
begin
  select r.blockers,r.company_id,pv.contract_product_id into v_blockers,v_company,v_product
  from public.contract_publication_readiness_v r
  join public.contract_publication_versions x on x.id=r.contract_publication_version_id
  join public.contract_product_versions pv on pv.id=x.contract_product_version_id
  where r.contract_publication_version_id=p_publication_version_id;
  if not found then raise exception 'publication_version_not_found'; end if;
  if coalesce(array_length(v_blockers,1),0)>0 then raise exception 'publication_not_ready:%',array_to_string(v_blockers,','); end if;
  perform set_config('gridex.version_transition','on',true);
  update public.contract_publication_versions oldv set status='ended'
  from public.contract_product_versions oldpv
  where oldv.contract_product_version_id=oldpv.id and oldpv.contract_product_id=v_product and oldv.id<>p_publication_version_id and oldv.status='published';
  update public.tenant_contract_channels ch set status='ended',updated_at=now()
  from public.tenant_contract_assignments ta join public.contract_product_versions oldpv on oldpv.id=ta.contract_product_version_id
  where ch.assignment_id=ta.id and ta.company_id=v_company and oldpv.contract_product_id=v_product and ch.channel='website' and ch.status='active';
  update public.contract_publications p set status='ended',updated_at=now()
  from public.tenant_contract_assignments ta join public.contract_product_versions oldpv on oldpv.id=ta.contract_product_version_id
  where p.assignment_id=ta.id and ta.company_id=v_company and oldpv.contract_product_id=v_product and p.channel='website' and p.status='published';
  update public.contract_publication_versions cpv set status='published',published_at=coalesce(cpv.published_at,now()),locked_at=coalesce(cpv.locked_at,now()),offer_reference=coalesce(cpv.offer_reference,'offer_'||encode(gen_random_bytes(20),'hex'))
  where cpv.id=p_publication_version_id returning * into v_row;
  update public.contract_publications set status='published',updated_at=now() where id=v_row.contract_publication_id;
  update public.tenant_contract_channels ch set status='active',updated_at=now() from public.contract_publications p where p.id=v_row.contract_publication_id and ch.assignment_id=p.assignment_id and ch.channel='website';
  return v_row;
end $$;

-- -----------------------------------------------------------------------------
-- Canonical synchronization of one legacy compatibility row
-- -----------------------------------------------------------------------------
create or replace function public.gridex_sync_public_offer_to_canonical(p_offer_id uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
  o public.public_contract_offers%rowtype; v_product_id uuid; v_contract_version_id uuid; v_assignment_id uuid;
  v_publication_id uuid; v_legal_version_id uuid; v_publication_version_id uuid; v_price_snapshot jsonb;
  v_commercial jsonb; v_publication jsonb; v_hash text; v_number integer; v_required text[]; v_published public.contract_publication_versions;
begin
  select * into o from public.public_contract_offers where id=p_offer_id for update;
  if not found then return null; end if;
  select snapshot_json into v_price_snapshot from public.price_plan_versions where id=o.price_plan_version_id and company_id=o.company_id and price_plan_id=o.price_plan_id;
  if v_price_snapshot is null then raise exception 'Exakt prisversion saknas för avtalet.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(o.company_id::text||':'||o.version_series_id::text,0));
  perform set_config('gridex.public_offer_write','on',true);

  insert into public.contract_products(company_id,product_code,name,product_category,description,status,created_by)
  values(o.company_id,'website:'||o.version_series_id::text,o.public_name,coalesce(o.contract_type,'unknown'),o.public_description,case when o.is_archived then 'archived' else 'active' end,o.created_by)
  on conflict(company_id,product_code) where company_id is not null do update set name=excluded.name,description=excluded.description,status=excluded.status,updated_at=now()
  returning id into v_product_id;

  v_required:=public.gridex_required_legal_modules(o.customer_type,o.contract_type,'website',o.automatic_renewal,o.power_of_attorney_required);
  v_commercial:=jsonb_build_object('schema','gridex_contract_commercial_v3','company_id',o.company_id,'version_series_id',o.version_series_id,'legacy_public_contract_offer_id',o.id,
    'contract_type',o.contract_type,'billing_model',o.billing_model,'customer_type',o.customer_type,'price_plan_id',o.price_plan_id,'price_plan_version_id',o.price_plan_version_id,'price_book_id',o.price_book_id,
    'pricing_snapshot',v_price_snapshot,'price_areas',o.price_areas,'binding_months',o.binding_months,'notice_months',o.notice_months,'automatic_renewal',o.automatic_renewal,'power_of_attorney_required',o.power_of_attorney_required);
  v_hash:=encode(digest(v_commercial::text,'sha256'),'hex');
  select id into v_contract_version_id from public.contract_product_versions where contract_product_id=v_product_id and content_sha256=v_hash limit 1;
  if v_contract_version_id is null then
    select coalesce(max(version_number),0)+1 into v_number from public.contract_product_versions where contract_product_id=v_product_id;
    insert into public.contract_product_versions(contract_product_id,version_number,customer_type,contract_type,pricing_model,price_plan_id,price_plan_version_id,binding_months,notice_months,price_areas,automatic_renewal,power_of_attorney_required,required_legal_modules,commercial_snapshot,content_sha256,status,approved_at,approved_by,locked_at,created_by)
    values(v_product_id,v_number,o.customer_type,o.contract_type,coalesce(v_price_snapshot->>'pricing_model',o.billing_model,o.contract_type),o.price_plan_id,o.price_plan_version_id,o.binding_months,o.notice_months,o.price_areas,o.automatic_renewal,o.power_of_attorney_required,v_required,v_commercial,v_hash,
      case when o.publication_status='published' then 'approved' else 'draft' end,case when o.publication_status='published' then now() end,case when o.publication_status='published' then o.updated_by end,case when o.publication_status='published' then now() end,o.created_by)
    returning id into v_contract_version_id;
  end if;
  if o.publication_status='published' then
    perform set_config('gridex.version_transition','on',true);
    update public.contract_product_versions
    set status='approved',approved_at=coalesce(approved_at,now()),approved_by=coalesce(approved_by,o.updated_by),locked_at=coalesce(locked_at,now())
    where id=v_contract_version_id and (status<>'approved' or locked_at is null);
  end if;

  if o.publication_status='published' then
    perform set_config('gridex.version_transition','on',true);
    update public.tenant_contract_assignments ta set status='ended',valid_to=coalesce(valid_to,current_date),updated_at=now()
    from public.contract_product_versions pv where pv.id=ta.contract_product_version_id and ta.company_id=o.company_id and pv.contract_product_id=v_product_id and ta.contract_product_version_id<>v_contract_version_id and ta.status='active';
  end if;

  insert into public.tenant_contract_assignments(company_id,contract_product_version_id,internal_sales_allowed,website_publication_allowed,status,legal_mode,valid_from,valid_to,assigned_by)
  values(o.company_id,v_contract_version_id,true,true,case when o.publication_status='published' then 'active' when o.is_archived then 'ended' else 'paused' end,'ops_standard',o.valid_from,o.valid_to,o.updated_by)
  on conflict(company_id,contract_product_version_id) do update set website_publication_allowed=true,status=excluded.status,valid_from=excluded.valid_from,valid_to=excluded.valid_to,updated_at=now()
  returning id into v_assignment_id;
  insert into public.tenant_contract_channels(assignment_id,channel,status,valid_from,valid_to,marketing_content,updated_by)
  values(v_assignment_id,'website',case when o.publication_status='published' and o.website_enabled then 'active' when o.is_archived then 'ended' else 'paused' end,o.valid_from::timestamptz,o.valid_to::timestamptz,jsonb_build_object('name',o.public_name,'description',o.public_description,'sort_order',o.sort_order),o.updated_by)
  on conflict(assignment_id,channel) do update set status=excluded.status,valid_from=excluded.valid_from,valid_to=excluded.valid_to,marketing_content=excluded.marketing_content,updated_by=excluded.updated_by,updated_at=now();

  v_legal_version_id:=public.gridex_materialize_legal_bundle_version(o.company_id,v_contract_version_id,o.legal_bundle_id,o.updated_by);
  if o.publication_status='published' then
    update public.legal_bundle_versions set status='published',published_at=coalesce(published_at,now()),locked_at=coalesce(locked_at,now()) where id=v_legal_version_id and locked_at is null;
  end if;

  insert into public.contract_publications(assignment_id,channel,status,created_by)
  values(v_assignment_id,'website',case when o.publication_status='published' then 'review' when o.is_archived then 'archived' else 'draft' end,o.created_by)
  on conflict(assignment_id,channel) do update set status=excluded.status,updated_at=now()
  returning id into v_publication_id;

  v_publication:=jsonb_build_object('schema','gridex_contract_publication_v3','legacy_public_contract_offer_id',o.id,'version_series_id',o.version_series_id,'version_number',o.version_number,
    'company_id',o.company_id,'contract_product_id',v_product_id,'contract_product_version_id',v_contract_version_id,'legal_bundle_version_id',v_legal_version_id,
    'price_plan_id',o.price_plan_id,'price_plan_version_id',o.price_plan_version_id,'price_book_id',o.price_book_id,'customer_type',o.customer_type,'channel','website','valid_from',o.valid_from,'valid_to',o.valid_to,
    'website_cta_enabled',o.website_cta_enabled,'public_name',o.public_name,'public_description',o.public_description,'public_price_text',o.public_price_text,'pricing_snapshot',v_price_snapshot);
  v_hash:=encode(digest(v_publication::text,'sha256'),'hex');
  select id into v_publication_version_id from public.contract_publication_versions where contract_publication_id=v_publication_id and content_sha256=v_hash limit 1;
  if v_publication_version_id is null then
    select coalesce(max(version_number),0)+1 into v_number from public.contract_publication_versions where contract_publication_id=v_publication_id;
    insert into public.contract_publication_versions(contract_publication_id,version_number,contract_product_version_id,price_plan_id,price_plan_version_id,price_book_id,legal_bundle_version_id,legacy_public_contract_offer_id,customer_type,channel,valid_from,valid_to,publication_snapshot,content_sha256,status,created_by)
    values(v_publication_id,v_number,v_contract_version_id,o.price_plan_id,o.price_plan_version_id,o.price_book_id,v_legal_version_id,o.id,o.customer_type,'website',o.valid_from::timestamptz,o.valid_to::timestamptz,v_publication,v_hash,case when o.publication_status='published' then 'review' when o.is_archived then 'archived' else 'draft' end,o.created_by)
    returning id into v_publication_version_id;
  end if;

  update public.public_contract_offers set contract_product_id=v_product_id,contract_product_version_id=v_contract_version_id,legal_bundle_version_id=v_legal_version_id,contract_publication_version_id=v_publication_version_id,
    metadata=coalesce(metadata,'{}')||jsonb_build_object('contract_product_id',v_product_id,'contract_product_version_id',v_contract_version_id,'tenant_contract_assignment_id',v_assignment_id,'legal_bundle_version_id',v_legal_version_id,'contract_publication_id',v_publication_id,'contract_publication_version_id',v_publication_version_id,'canonical_publication_sha256',v_hash,'source_of_truth','contract_publication_versions')
  where id=o.id;

  if o.publication_status='published' then
    v_published:=public.gridex_publish_contract_publication_version(v_publication_version_id,o.updated_by);
    update public.public_contract_offers set metadata=metadata||jsonb_build_object('canonical_offer_reference',v_published.offer_reference),is_public=true,published_at=coalesce(published_at,v_published.published_at),readiness_status='ready',readiness_blockers='[]'::jsonb where id=o.id;
  end if;
  return v_publication_version_id;
end $$;

-- -----------------------------------------------------------------------------
-- Single atomic public contract command
-- -----------------------------------------------------------------------------
create or replace function public.gridex_upsert_public_contract_offer(
  p_company_id uuid,p_offer_id uuid,p_offer_code text,p_payload jsonb,p_pricing_snapshot jsonb,p_actor_user_id uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_old public.public_contract_offers%rowtype; v_saved public.public_contract_offers%rowtype; v_pricing jsonb;
  v_series uuid; v_version integer; v_actual_code text; v_publish boolean; v_publication_id uuid; v_cpv public.contract_publication_versions;
begin
  if p_company_id is null or p_actor_user_id is null then raise exception 'Bolag och aktör krävs.'; end if;
  v_publish:=coalesce(p_payload->>'publication_status','draft')='published';
  if p_offer_id is not null then select * into v_old from public.public_contract_offers where id=p_offer_id and company_id=p_company_id for update; end if;
  if p_offer_id is not null and not found then raise exception 'Avtalet hittades inte för bolaget.'; end if;
  v_series:=coalesce(v_old.version_series_id,gen_random_uuid());
  if v_old.id is not null and v_old.publication_status='published' then
    select coalesce(max(version_number),0)+1 into v_version from public.public_contract_offers where company_id=p_company_id and version_series_id=v_series;
  else v_version:=coalesce(v_old.version_number,1); end if;
  v_actual_code:=case when v_version=1 then p_offer_code else left(regexp_replace(p_offer_code,'-v[0-9]+$','','i'),100)||'-v'||v_version end;
  p_pricing_snapshot:=p_pricing_snapshot||jsonb_build_object('plan_code','contract-'||v_series::text,'product_key',v_series::text);
  v_pricing:=public.gridex_create_or_version_contract_pricing(p_company_id,p_payload->>'public_name',p_payload->>'contract_type',coalesce(p_payload->>'pricing_model','spot'),p_payload->>'customer_type',p_pricing_snapshot,
    nullif(p_payload->>'valid_from','')::date,nullif(p_payload->>'valid_to','')::date,v_publish,p_actor_user_id);
  perform set_config('gridex.public_offer_write','on',true);

  if v_old.id is not null and v_old.publication_status<>'published' then
    update public.public_contract_offers set
      offer_code=v_actual_code,public_name=p_payload->>'public_name',public_description=nullif(p_payload->>'public_description',''),product_code=coalesce(nullif(p_payload->>'product_code',''),'electricity'),
      contract_type=p_payload->>'contract_type',billing_model=p_payload->>'billing_model',customer_type=p_payload->>'customer_type',price_plan_id=(v_pricing->>'price_plan_id')::uuid,price_plan_version_id=(v_pricing->>'price_plan_version_id')::uuid,price_book_id=(v_pricing->>'price_book_id')::uuid,
      campaign_version_id=nullif(p_payload->>'campaign_version_id','')::uuid,legal_bundle_id=nullif(p_payload->>'legal_bundle_id','')::uuid,
      monthly_fee_sek=nullif(p_payload->>'monthly_fee_sek','')::numeric,invoice_fee_sek=nullif(p_payload->>'invoice_fee_sek','')::numeric,markup_ore_per_kwh=nullif(p_payload->>'markup_ore_per_kwh','')::numeric,spot_markup_ore_per_kwh=nullif(p_payload->>'spot_markup_ore_per_kwh','')::numeric,
      variable_fee_ore_per_kwh=nullif(p_payload->>'variable_fee_ore_per_kwh','')::numeric,fixed_price_ore_per_kwh=nullif(p_payload->>'fixed_price_ore_per_kwh','')::numeric,green_fee_mode=nullif(p_payload->>'green_fee_mode',''),green_fee_value=nullif(p_payload->>'green_fee_value','')::numeric,
      electricity_certificate_ore_per_kwh=nullif(p_payload->>'electricity_certificate_ore_per_kwh','')::numeric,start_fee_sek=nullif(p_payload->>'start_fee_sek','')::numeric,administration_fee_sek=nullif(p_payload->>'administration_fee_sek','')::numeric,break_fee_sek=nullif(p_payload->>'break_fee_sek','')::numeric,portfolio_management_fee_ore_per_kwh=nullif(p_payload->>'portfolio_management_fee_ore_per_kwh','')::numeric,
      discount_value=nullif(p_payload->>'discount_value','')::numeric,discount_unit=nullif(p_payload->>'discount_unit',''),discount_months=nullif(p_payload->>'discount_months','')::integer,vat_rate=coalesce(nullif(p_payload->>'vat_rate','')::numeric,25),
      terms_version=nullif(p_payload->>'terms_version',''),terms_url=nullif(p_payload->>'terms_url',''),public_price_text=p_payload->>'public_price_text',binding_months=nullif(p_payload->>'binding_months','')::integer,notice_months=nullif(p_payload->>'notice_months','')::integer,
      automatic_renewal=coalesce((p_payload->>'automatic_renewal')::boolean,false),power_of_attorney_required=coalesce((p_payload->>'power_of_attorney_required')::boolean,true),
      spot_weight_percent=coalesce(nullif(p_payload->>'spot_weight_percent','')::numeric,100),portfolio_weight_percent=coalesce(nullif(p_payload->>'portfolio_weight_percent','')::numeric,0),fixed_weight_percent=coalesce(nullif(p_payload->>'fixed_weight_percent','')::numeric,0),
      price_area=nullif(p_payload->>'price_area',''),price_areas=coalesce(array(select jsonb_array_elements_text(coalesce(p_pricing_snapshot->'price_areas','[]'::jsonb))),'{}'::text[]),valid_from=nullif(p_payload->>'valid_from','')::date,valid_to=nullif(p_payload->>'valid_to','')::date,
      publication_status=p_payload->>'publication_status',website_enabled=coalesce((p_payload->>'website_enabled')::boolean,false),website_cta_enabled=coalesce((p_payload->>'website_cta_enabled')::boolean,true),is_public=v_publish,is_archived=coalesce((p_payload->>'is_archived')::boolean,false),
      sort_order=coalesce(nullif(p_payload->>'sort_order','')::integer,100),readiness_issues=coalesce(p_payload->'readiness_issues','[]'),publication_notes=nullif(p_payload->>'publication_notes',''),published_at=case when v_publish then now() end,archived_at=case when coalesce((p_payload->>'is_archived')::boolean,false) then now() end,
      metadata=coalesce(v_old.metadata,'{}')||coalesce(p_payload->'metadata','{}')||jsonb_build_object('pricing_snapshot',p_pricing_snapshot),updated_by=p_actor_user_id,updated_at=now()
    where id=v_old.id returning * into v_saved;
  else
    if v_old.id is not null and v_old.publication_status='published' then
      update public.public_contract_offers
      set publication_status='superseded',is_public=false,is_archived=true,website_enabled=false,website_cta_enabled=false,archived_at=now(),updated_by=p_actor_user_id,updated_at=now()
      where id=v_old.id;
    end if;
    insert into public.public_contract_offers(company_id,version_series_id,version_number,supersedes_offer_id,offer_code,public_name,public_description,product_code,contract_type,billing_model,customer_type,price_plan_id,price_plan_version_id,price_book_id,campaign_version_id,legal_bundle_id,
      monthly_fee_sek,invoice_fee_sek,markup_ore_per_kwh,spot_markup_ore_per_kwh,variable_fee_ore_per_kwh,fixed_price_ore_per_kwh,green_fee_mode,green_fee_value,electricity_certificate_ore_per_kwh,start_fee_sek,administration_fee_sek,break_fee_sek,portfolio_management_fee_ore_per_kwh,discount_value,discount_unit,discount_months,vat_rate,terms_version,terms_url,public_price_text,binding_months,notice_months,automatic_renewal,power_of_attorney_required,spot_weight_percent,portfolio_weight_percent,fixed_weight_percent,price_area,price_areas,valid_from,valid_to,publication_status,website_enabled,website_cta_enabled,is_public,is_archived,sort_order,readiness_issues,publication_notes,published_at,archived_at,metadata,created_by,updated_by)
    values(p_company_id,v_series,v_version,v_old.id,v_actual_code,p_payload->>'public_name',nullif(p_payload->>'public_description',''),coalesce(nullif(p_payload->>'product_code',''),'electricity'),p_payload->>'contract_type',p_payload->>'billing_model',p_payload->>'customer_type',(v_pricing->>'price_plan_id')::uuid,(v_pricing->>'price_plan_version_id')::uuid,(v_pricing->>'price_book_id')::uuid,nullif(p_payload->>'campaign_version_id','')::uuid,nullif(p_payload->>'legal_bundle_id','')::uuid,
      nullif(p_payload->>'monthly_fee_sek','')::numeric,nullif(p_payload->>'invoice_fee_sek','')::numeric,nullif(p_payload->>'markup_ore_per_kwh','')::numeric,nullif(p_payload->>'spot_markup_ore_per_kwh','')::numeric,nullif(p_payload->>'variable_fee_ore_per_kwh','')::numeric,nullif(p_payload->>'fixed_price_ore_per_kwh','')::numeric,nullif(p_payload->>'green_fee_mode',''),nullif(p_payload->>'green_fee_value','')::numeric,nullif(p_payload->>'electricity_certificate_ore_per_kwh','')::numeric,nullif(p_payload->>'start_fee_sek','')::numeric,nullif(p_payload->>'administration_fee_sek','')::numeric,nullif(p_payload->>'break_fee_sek','')::numeric,nullif(p_payload->>'portfolio_management_fee_ore_per_kwh','')::numeric,nullif(p_payload->>'discount_value','')::numeric,nullif(p_payload->>'discount_unit',''),nullif(p_payload->>'discount_months','')::integer,coalesce(nullif(p_payload->>'vat_rate','')::numeric,25),nullif(p_payload->>'terms_version',''),nullif(p_payload->>'terms_url',''),p_payload->>'public_price_text',nullif(p_payload->>'binding_months','')::integer,nullif(p_payload->>'notice_months','')::integer,coalesce((p_payload->>'automatic_renewal')::boolean,false),coalesce((p_payload->>'power_of_attorney_required')::boolean,true),coalesce(nullif(p_payload->>'spot_weight_percent','')::numeric,100),coalesce(nullif(p_payload->>'portfolio_weight_percent','')::numeric,0),coalesce(nullif(p_payload->>'fixed_weight_percent','')::numeric,0),nullif(p_payload->>'price_area',''),coalesce(array(select jsonb_array_elements_text(coalesce(p_pricing_snapshot->'price_areas','[]'::jsonb))),'{}'::text[]),nullif(p_payload->>'valid_from','')::date,nullif(p_payload->>'valid_to','')::date,p_payload->>'publication_status',coalesce((p_payload->>'website_enabled')::boolean,false),coalesce((p_payload->>'website_cta_enabled')::boolean,true),v_publish,coalesce((p_payload->>'is_archived')::boolean,false),coalesce(nullif(p_payload->>'sort_order','')::integer,100),coalesce(p_payload->'readiness_issues','[]'),nullif(p_payload->>'publication_notes',''),case when v_publish then now() end,case when coalesce((p_payload->>'is_archived')::boolean,false) then now() end,coalesce(p_payload->'metadata','{}')||jsonb_build_object('pricing_snapshot',p_pricing_snapshot),p_actor_user_id,p_actor_user_id)
    returning * into v_saved;
  end if;

  v_publication_id:=public.gridex_sync_public_offer_to_canonical(v_saved.id);
  select * into v_cpv from public.contract_publication_versions where id=v_publication_id;
  select * into v_saved from public.public_contract_offers where id=v_saved.id;
  return jsonb_build_object('offer',to_jsonb(v_saved),'pricing',v_pricing,'contract_publication_version_id',v_publication_id,'offer_reference',v_cpv.offer_reference,'created_new_version',v_old.id is not null and v_old.publication_status='published');
end $$;

create or replace function public.gridex_archive_public_contract_offer(p_company_id uuid,p_offer_id uuid,p_actor_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare o public.public_contract_offers%rowtype;
begin
  select * into o from public.public_contract_offers where id=p_offer_id and company_id=p_company_id for update;
  if not found then raise exception 'Avtalet hittades inte.'; end if;
  perform set_config('gridex.public_offer_write','on',true); perform set_config('gridex.version_transition','on',true);
  update public.public_contract_offers set publication_status='archived',is_public=false,is_archived=true,website_enabled=false,website_cta_enabled=false,archived_at=coalesce(archived_at,now()),updated_by=p_actor_user_id,updated_at=now() where id=p_offer_id returning * into o;
  update public.contract_publication_versions set status='archived' where id=o.contract_publication_version_id;
  update public.contract_publications p set status='archived',updated_at=now() from public.contract_publication_versions v where v.id=o.contract_publication_version_id and p.id=v.contract_publication_id;
  update public.tenant_contract_channels ch set status='ended',updated_at=now() from public.contract_publications p,public.contract_publication_versions v where v.id=o.contract_publication_version_id and p.id=v.contract_publication_id and ch.assignment_id=p.assignment_id and ch.channel='website';
  return to_jsonb(o);
end $$;

-- -----------------------------------------------------------------------------
-- Internal contract command and canonical internal channel
-- -----------------------------------------------------------------------------
alter table public.contract_offers
  add column if not exists customer_type text not null default 'both',
  add column if not exists automatic_renewal boolean not null default false,
  add column if not exists power_of_attorney_required boolean not null default true,
  add column if not exists legal_bundle_id uuid references public.legal_bundles(id) on delete restrict,
  add column if not exists contract_product_id uuid references public.contract_products(id) on delete restrict,
  add column if not exists contract_product_version_id uuid references public.contract_product_versions(id) on delete restrict,
  add column if not exists legal_bundle_version_id uuid references public.legal_bundle_versions(id) on delete restrict;

do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.contract_offers'::regclass and conname='contract_offers_customer_type_check') then
    alter table public.contract_offers add constraint contract_offers_customer_type_check check(customer_type in ('private','business','both'));
  end if;
end $$;

drop trigger if exists contract_offers_canonical_sync on public.contract_offers;

create or replace function public.gridex_sync_internal_offer_to_canonical(p_offer_id uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
  o public.contract_offers%rowtype; v_product_id uuid; v_version_id uuid; v_assignment_id uuid;
  v_snapshot jsonb; v_hash text; v_number integer; v_required text[]; v_legal_version_id uuid;
begin
  select * into o from public.contract_offers where id=p_offer_id for update;
  if not found or o.company_id is null then return null; end if;

  insert into public.contract_products(company_id,product_code,name,product_category,description,status,created_by)
  values(o.company_id,'internal:'||o.id::text,o.name,coalesce(o.contract_type,'electricity'),o.description,
    case when coalesce(o.is_active,false) and o.status='active' then 'active' else 'paused' end,o.created_by)
  on conflict(company_id,product_code) where company_id is not null do update
    set name=excluded.name,description=excluded.description,status=excluded.status,updated_at=now()
  returning id into v_product_id;

  v_required:=public.gridex_required_legal_modules(o.customer_type,o.contract_type,'internal',o.automatic_renewal,o.power_of_attorney_required);
  v_snapshot:=coalesce(o.commercial_snapshot,'{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object(
    'schema','gridex_internal_contract_v3','legacy_contract_offer_id',o.id,'company_id',o.company_id,'name',o.name,
    'customer_type',o.customer_type,'contract_type',o.contract_type,'price_plan_id',o.price_plan_id,
    'price_plan_version_id',o.price_plan_version_id,'price_book_id',o.price_book_id,'price_version',o.price_version,
    'terms_version',o.terms_version,'valid_from',o.valid_from,'valid_to',o.valid_to,'automatic_renewal',o.automatic_renewal,
    'power_of_attorney_required',o.power_of_attorney_required));
  v_hash:=encode(digest(v_snapshot::text,'sha256'),'hex');

  select id into v_version_id from public.contract_product_versions where contract_product_id=v_product_id and content_sha256=v_hash limit 1;
  if v_version_id is null then
    select coalesce(max(version_number),0)+1 into v_number from public.contract_product_versions where contract_product_id=v_product_id;
    insert into public.contract_product_versions(contract_product_id,version_number,customer_type,contract_type,pricing_model,price_plan_id,price_plan_version_id,binding_months,notice_months,price_areas,automatic_renewal,power_of_attorney_required,required_legal_modules,commercial_snapshot,content_sha256,status,approved_at,approved_by,locked_at,created_by)
    values(v_product_id,v_number,o.customer_type,o.contract_type,coalesce(v_snapshot->>'pricing_model',o.contract_type),o.price_plan_id,o.price_plan_version_id,o.default_binding_months,o.default_notice_months,
      coalesce(array(select jsonb_array_elements_text(coalesce(v_snapshot->'price_areas','[]'::jsonb))),'{}'::text[]),o.automatic_renewal,o.power_of_attorney_required,v_required,v_snapshot,v_hash,
      case when o.is_active and o.status='active' then 'approved' else 'draft' end,case when o.is_active and o.status='active' then now() end,case when o.is_active and o.status='active' then o.updated_by end,case when o.is_active and o.status='active' then now() end,o.created_by)
    returning id into v_version_id;
  end if;
  if o.is_active and o.status='active' then
    perform set_config('gridex.version_transition','on',true);
    update public.contract_product_versions set status='approved',approved_at=coalesce(approved_at,now()),approved_by=coalesce(approved_by,o.updated_by),locked_at=coalesce(locked_at,now()) where id=v_version_id and (status<>'approved' or locked_at is null);
    update public.tenant_contract_assignments ta set status='ended',valid_to=coalesce(valid_to,current_date),updated_at=now()
      from public.contract_product_versions pv where pv.id=ta.contract_product_version_id and ta.company_id=o.company_id and pv.contract_product_id=v_product_id and ta.contract_product_version_id<>v_version_id and ta.status='active';
  end if;

  if o.legal_bundle_id is not null then
    v_legal_version_id:=public.gridex_materialize_legal_bundle_version(o.company_id,v_version_id,o.legal_bundle_id,o.updated_by);
    if o.is_active and o.status='active' then
      update public.legal_bundle_versions set status='published',published_at=coalesce(published_at,now()),locked_at=coalesce(locked_at,now()) where id=v_legal_version_id and locked_at is null;
    end if;
  elsif o.is_active and o.status='active' then
    raise exception 'Aktivt internt avtal kräver ett publicerat juridiskt paket.';
  end if;

  insert into public.tenant_contract_assignments(company_id,contract_product_version_id,internal_sales_allowed,website_publication_allowed,status,legal_mode,valid_from,valid_to,assigned_by)
  values(o.company_id,v_version_id,true,false,case when o.is_active and o.status='active' then 'active' else 'paused' end,'ops_standard',o.valid_from,o.valid_to,o.updated_by)
  on conflict(company_id,contract_product_version_id) do update set internal_sales_allowed=true,status=excluded.status,valid_from=excluded.valid_from,valid_to=excluded.valid_to,updated_at=now()
  returning id into v_assignment_id;
  insert into public.tenant_contract_channels(assignment_id,channel,status,valid_from,valid_to,marketing_content,updated_by)
  values(v_assignment_id,'internal',case when o.is_active and o.status='active' then 'active' else 'paused' end,o.valid_from::timestamptz,o.valid_to::timestamptz,jsonb_build_object('name',o.name),o.updated_by)
  on conflict(assignment_id,channel) do update set status=excluded.status,valid_from=excluded.valid_from,valid_to=excluded.valid_to,marketing_content=excluded.marketing_content,updated_by=excluded.updated_by,updated_at=now();

  update public.contract_offers set contract_product_id=v_product_id,contract_product_version_id=v_version_id,legal_bundle_version_id=v_legal_version_id where id=o.id;
  return v_version_id;
end $$;

create or replace function public.gridex_upsert_internal_contract_offer(
  p_company_id uuid,p_offer_id uuid,p_payload jsonb,p_pricing_snapshot jsonb,p_actor_user_id uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_old public.contract_offers%rowtype; v_saved public.contract_offers%rowtype; v_pricing jsonb; v_new_id uuid;
  v_legal_bundle_id uuid; v_active boolean; v_status text; v_customer_type text; v_slug text; v_version integer; v_canonical uuid; v_identity uuid;
begin
  if p_company_id is null or p_actor_user_id is null then raise exception 'Bolag och aktör krävs.'; end if;
  if p_offer_id is not null then select * into v_old from public.contract_offers where id=p_offer_id and company_id=p_company_id for update; end if;
  if p_offer_id is not null and not found then raise exception 'Avtalet hittades inte för bolaget.'; end if;
  v_status:=coalesce(nullif(p_payload->>'status',''),'draft');
  v_active:=coalesce((p_payload->>'is_active')::boolean,false) and v_status='active';
  v_customer_type:=coalesce(nullif(p_payload->>'customer_type',''),'both');
  if v_status not in ('draft','active','inactive') then raise exception 'Ogiltig avtalsstatus.'; end if;
  if v_customer_type not in ('private','business','both') then raise exception 'Ogiltig kundtyp.'; end if;

  v_legal_bundle_id:=nullif(p_payload->>'legal_bundle_id','')::uuid;
  if v_legal_bundle_id is null then
    select id into v_legal_bundle_id from public.legal_bundles where company_id=p_company_id and status in ('published','active') order by updated_at desc limit 1;
  end if;
  if v_active and v_legal_bundle_id is null then raise exception 'Aktivt internt avtal kräver publicerat juridiskt paket.'; end if;

  v_identity:=coalesce(v_old.id,gen_random_uuid());
  p_pricing_snapshot:=p_pricing_snapshot||jsonb_build_object('plan_code','internal-'||v_identity::text,'product_key','internal-'||v_identity::text);
  v_pricing:=public.gridex_create_or_version_contract_pricing(p_company_id,p_payload->>'name',p_payload->>'contract_type',coalesce(p_payload->>'pricing_model','spot'),v_customer_type,p_pricing_snapshot,
    nullif(p_payload->>'valid_from','')::date,nullif(p_payload->>'valid_to','')::date,v_active,p_actor_user_id);
  v_slug:=coalesce(nullif(p_payload->>'slug',''),lower(trim(both '-' from regexp_replace(p_payload->>'name','[^a-zA-Z0-9]+','-','g'))));

  if v_old.id is not null and (v_old.status='active' or exists(select 1 from public.customer_contracts where company_id=p_company_id and contract_offer_id=v_old.id)) then
    update public.contract_offers set status='inactive',is_active=false,archived_at=coalesce(archived_at,now()),updated_by=p_actor_user_id,updated_at=now() where id=v_old.id;
    v_new_id:=gen_random_uuid(); v_version:=coalesce(v_old.version_number,1)+1; v_slug:=left(v_slug,105)||'-v'||v_version;
  else
    v_new_id:=coalesce(v_old.id,gen_random_uuid()); v_version:=coalesce(v_old.version_number,1);
  end if;

  insert into public.contract_offers(id,company_id,name,slug,status,contract_type,customer_type,campaign_name,campaign_code,campaign_version,price_version,terms_version,offer_version,version_number,version_snapshot,max_customers,discount_value,discount_unit,start_fee_sek,admin_fee_sek,break_fee_sek,vat_rate,description,fixed_price_ore_per_kwh,spot_markup_ore_per_kwh,variable_fee_ore_per_kwh,monthly_fee_sek,green_fee_mode,green_fee_value,default_binding_months,default_notice_months,optional_fee_lines,is_active,valid_from,valid_to,price_plan_id,price_plan_version_id,price_book_id,commercial_snapshot,automatic_renewal,power_of_attorney_required,legal_bundle_id,last_price_change_at,created_by,updated_by)
  values(v_new_id,p_company_id,p_payload->>'name',v_slug,v_status,p_payload->>'contract_type',v_customer_type,nullif(p_payload->>'campaign_name',''),nullif(p_payload->>'campaign_code',''),nullif(p_payload->>'campaign_version',''),v_pricing->>'version_label',nullif(p_payload->>'terms_version',''),coalesce(nullif(p_payload->>'terms_version',''),v_pricing->>'version_label','v1'),v_version,
    jsonb_build_object('model','canonical_price_plan_version','price_plan_id',v_pricing->>'price_plan_id','price_plan_version_id',v_pricing->>'price_plan_version_id','price_book_id',v_pricing->>'price_book_id','pricing_snapshot',p_pricing_snapshot),
    nullif(p_payload->>'max_customers','')::integer,nullif(p_payload->>'discount_value','')::numeric,nullif(p_payload->>'discount_unit',''),nullif(p_payload->>'start_fee_sek','')::numeric,nullif(p_payload->>'admin_fee_sek','')::numeric,nullif(p_payload->>'break_fee_sek','')::numeric,coalesce(nullif(p_payload->>'vat_rate','')::numeric,25),nullif(p_payload->>'description',''),nullif(p_payload->>'fixed_price_ore_per_kwh','')::numeric,nullif(p_payload->>'spot_markup_ore_per_kwh','')::numeric,nullif(p_payload->>'variable_fee_ore_per_kwh','')::numeric,nullif(p_payload->>'monthly_fee_sek','')::numeric,coalesce(nullif(p_payload->>'green_fee_mode',''),'none'),nullif(p_payload->>'green_fee_value','')::numeric,nullif(p_payload->>'default_binding_months','')::integer,nullif(p_payload->>'default_notice_months','')::integer,coalesce(p_payload->'optional_fee_lines','[]'::jsonb),v_active,nullif(p_payload->>'valid_from','')::date,nullif(p_payload->>'valid_to','')::date,(v_pricing->>'price_plan_id')::uuid,(v_pricing->>'price_plan_version_id')::uuid,(v_pricing->>'price_book_id')::uuid,p_pricing_snapshot,coalesce((p_payload->>'automatic_renewal')::boolean,false),coalesce((p_payload->>'power_of_attorney_required')::boolean,true),v_legal_bundle_id,case when coalesce((v_pricing->>'reused')::boolean,false) then coalesce(v_old.last_price_change_at,now()) else now() end,p_actor_user_id,p_actor_user_id)
  on conflict(id) do update set name=excluded.name,slug=excluded.slug,status=excluded.status,contract_type=excluded.contract_type,customer_type=excluded.customer_type,campaign_name=excluded.campaign_name,campaign_code=excluded.campaign_code,campaign_version=excluded.campaign_version,price_version=excluded.price_version,terms_version=excluded.terms_version,offer_version=excluded.offer_version,version_snapshot=excluded.version_snapshot,max_customers=excluded.max_customers,discount_value=excluded.discount_value,discount_unit=excluded.discount_unit,start_fee_sek=excluded.start_fee_sek,admin_fee_sek=excluded.admin_fee_sek,break_fee_sek=excluded.break_fee_sek,vat_rate=excluded.vat_rate,description=excluded.description,fixed_price_ore_per_kwh=excluded.fixed_price_ore_per_kwh,spot_markup_ore_per_kwh=excluded.spot_markup_ore_per_kwh,variable_fee_ore_per_kwh=excluded.variable_fee_ore_per_kwh,monthly_fee_sek=excluded.monthly_fee_sek,green_fee_mode=excluded.green_fee_mode,green_fee_value=excluded.green_fee_value,default_binding_months=excluded.default_binding_months,default_notice_months=excluded.default_notice_months,optional_fee_lines=excluded.optional_fee_lines,is_active=excluded.is_active,valid_from=excluded.valid_from,valid_to=excluded.valid_to,price_plan_id=excluded.price_plan_id,price_plan_version_id=excluded.price_plan_version_id,price_book_id=excluded.price_book_id,commercial_snapshot=excluded.commercial_snapshot,automatic_renewal=excluded.automatic_renewal,power_of_attorney_required=excluded.power_of_attorney_required,legal_bundle_id=excluded.legal_bundle_id,last_price_change_at=excluded.last_price_change_at,updated_by=excluded.updated_by,updated_at=now()
  returning * into v_saved;
  v_canonical:=public.gridex_sync_internal_offer_to_canonical(v_saved.id);
  select * into v_saved from public.contract_offers where id=v_saved.id;
  return jsonb_build_object('offer',to_jsonb(v_saved),'pricing',v_pricing,'contract_product_version_id',v_canonical,'created_new_version',v_old.id is not null and v_saved.id<>v_old.id);
end $$;

-- -----------------------------------------------------------------------------
-- Exact public API view and exact customer binding
-- -----------------------------------------------------------------------------
-- public_contract_offers receives new columns earlier in this migration. The
-- previous view used pco.*, so CREATE OR REPLACE VIEW would interpret those new
-- table columns as renames of the existing canonical columns (PostgreSQL 42P16).
-- Recreating the view inside this transaction is atomic and preserves the
-- intended expanded column layout without using CASCADE.
drop view if exists public.canonical_public_contract_offers_v;
create view public.canonical_public_contract_offers_v as
select pco.*,cpv.offer_reference canonical_offer_reference,cpv.locked_at publication_locked_at,cpv.content_sha256 publication_content_sha256,
  ppv.snapshot_json canonical_pricing_snapshot,
  (coalesce(pco.metadata,'{}')||jsonb_build_object('contract_publication_version_id',cpv.id,'contract_product_version_id',cpv.contract_product_version_id,'contract_product_id',pco.contract_product_id,'legal_bundle_version_id',cpv.legal_bundle_version_id,'canonical_offer_reference',cpv.offer_reference,'publication_content_sha256',cpv.content_sha256,'pricing_snapshot',ppv.snapshot_json,'source_of_truth','contract_publication_versions')) canonical_metadata
from public.public_contract_offers pco
join public.contract_publication_versions cpv on cpv.id=pco.contract_publication_version_id and cpv.status='published' and cpv.locked_at is not null
join public.price_plan_versions ppv on ppv.id=cpv.price_plan_version_id and ppv.locked_at is not null
where pco.publication_status='published' and pco.website_enabled=true and pco.is_archived=false;

create or replace function public.gridex_bind_customer_contract_to_exact_publication()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.contract_publication_versions; pv public.contract_product_versions;
begin
  if new.public_contract_offer_id is null and new.offer_reference is null then return new; end if;
  select cpv.* into v from public.contract_publication_versions cpv
  where cpv.offer_reference=new.offer_reference and cpv.legacy_public_contract_offer_id=new.public_contract_offer_id and cpv.status='published' and cpv.locked_at is not null
    and exists(select 1 from public.public_contract_offers o where o.id=cpv.legacy_public_contract_offer_id and o.company_id=new.company_id);
  if not found then raise exception using errcode='23514',message='exact_published_contract_version_required'; end if;
  select * into pv from public.contract_product_versions where id=v.contract_product_version_id and locked_at is not null and status='approved';
  if not found then raise exception using errcode='23514',message='exact_approved_contract_product_version_required'; end if;
  new.contract_publication_version_id:=v.id; new.contract_product_version_id:=pv.id; new.contract_product_id:=pv.contract_product_id; new.legal_bundle_version_id:=v.legal_bundle_version_id;
  new.price_plan_id:=v.price_plan_id; new.price_plan_version_id:=v.price_plan_version_id;
  new.commercial_snapshot:=pv.commercial_snapshot; new.legal_snapshot:=(select rendered_snapshot from public.legal_bundle_versions where id=v.legal_bundle_version_id);
  return new;
end $$;

drop trigger if exists customer_contracts_bind_exact_publication on public.customer_contracts;
create trigger customer_contracts_bind_exact_publication before insert or update of public_contract_offer_id,offer_reference on public.customer_contracts
for each row execute function public.gridex_bind_customer_contract_to_exact_publication();

-- Creates the website customer contract and its immutable price snapshot in one
-- transaction. The exact publication/version is resolved inside the database;
-- callers cannot substitute a current or reconstructed legacy price.
create or replace function public.gridex_create_website_customer_contract(
  p_company_id uuid,
  p_contract_payload jsonb,
  p_customer_number text default null
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_offer public.public_contract_offers%rowtype;
  v_publication public.contract_publication_versions%rowtype;
  v_contract_version public.contract_product_versions%rowtype;
  v_price_snapshot jsonb;
  v_contract public.customer_contracts%rowtype;
  v_snapshot_id uuid;
  v_contract_id uuid:=gen_random_uuid();
begin
  if p_company_id is null or jsonb_typeof(coalesce(p_contract_payload,'null'::jsonb))<>'object' then
    raise exception using errcode='22023',message='company_and_contract_payload_required';
  end if;
  if nullif(p_contract_payload->>'public_contract_offer_id','') is null
     or nullif(p_contract_payload->>'offer_reference','') is null then
    raise exception using errcode='22023',message='exact_public_offer_identity_required';
  end if;

  select * into v_offer
  from public.public_contract_offers
  where id=(p_contract_payload->>'public_contract_offer_id')::uuid
    and company_id=p_company_id
    and publication_status='published'
    and website_enabled=true
    and is_archived=false
  for share;
  if not found then raise exception using errcode='P0002',message='published_public_offer_not_found_for_tenant'; end if;

  select * into v_publication
  from public.contract_publication_versions
  where id=v_offer.contract_publication_version_id
    and legacy_public_contract_offer_id=v_offer.id
    and offer_reference=p_contract_payload->>'offer_reference'
    and status='published'
    and locked_at is not null
  for share;
  if not found then raise exception using errcode='23514',message='exact_locked_publication_version_required'; end if;

  select * into v_contract_version
  from public.contract_product_versions
  where id=v_publication.contract_product_version_id
    and status='approved'
    and locked_at is not null
  for share;
  if not found then raise exception using errcode='23514',message='exact_locked_contract_version_required'; end if;

  select snapshot_json into v_price_snapshot
  from public.price_plan_versions
  where id=v_publication.price_plan_version_id
    and company_id=p_company_id
    and status in ('published','active')
    and locked_at is not null;
  if not found or coalesce(v_price_snapshot,'{}'::jsonb)='{}'::jsonb then
    raise exception using errcode='23514',message='exact_locked_price_snapshot_required';
  end if;

  insert into public.customer_contracts(
    id,company_id,customer_id,site_id,customer_site_id,metering_point_id,
    source_type,status,contract_number,contract_name,contract_type,
    price_plan_id,price_plan_version_id,contract_offer_id,public_contract_offer_id,offer_reference,
    legal_versions_snapshot,signature_snapshot,signature_snapshot_sha256,signed_ip_hash,signed_user_agent,
    is_distance_agreement,starts_at,expected_start_at,requested_start_date,requested_start_mode,
    calculated_earliest_start_date,price_area_used,grid_area_code_used,resolution_status,
    confirmed_start_date,actual_start_date,signed_at,
    monthly_fee_sek,invoice_fee_sek,markup_ore_per_kwh,spot_markup_ore_per_kwh,
    variable_fee_ore_per_kwh,fixed_price_ore_per_kwh,green_fee_mode,green_fee_value,
    binding_months,notice_months,campaign_code,price_version,terms_version,
    optional_fee_lines,agreement_channel,metadata,price_snapshot,
    contract_product_id,contract_product_version_id,contract_publication_version_id,
    legal_bundle_version_id,commercial_snapshot,legal_snapshot,created_at,updated_at
  ) values (
    v_contract_id,p_company_id,(p_contract_payload->>'customer_id')::uuid,
    nullif(p_contract_payload->>'site_id','')::uuid,nullif(p_contract_payload->>'customer_site_id','')::uuid,
    nullif(p_contract_payload->>'metering_point_id','')::uuid,
    coalesce(nullif(p_contract_payload->>'source_type',''),'website_application'),
    coalesce(nullif(p_contract_payload->>'status',''),'pending_signature'),
    nullif(p_contract_payload->>'contract_number',''),coalesce(nullif(p_contract_payload->>'contract_name',''),v_offer.public_name),
    v_contract_version.contract_type,v_publication.price_plan_id,v_publication.price_plan_version_id,
    nullif(p_contract_payload->>'contract_offer_id','')::uuid,v_offer.id,v_publication.offer_reference,
    coalesce(p_contract_payload->'legal_versions_snapshot','[]'::jsonb),'{}'::jsonb,null,null,null,
    true,nullif(p_contract_payload->>'starts_at','')::date,nullif(p_contract_payload->>'expected_start_at','')::date,
    nullif(p_contract_payload->>'requested_start_date','')::date,
    coalesce(nullif(p_contract_payload->>'requested_start_mode',''),'earliest_possible'),
    nullif(p_contract_payload->>'calculated_earliest_start_date','')::date,
    nullif(p_contract_payload->>'price_area_used',''),nullif(p_contract_payload->>'grid_area_code_used',''),
    nullif(p_contract_payload->>'resolution_status',''),nullif(p_contract_payload->>'confirmed_start_date','')::date,
    nullif(p_contract_payload->>'actual_start_date','')::date,null,
    nullif(p_contract_payload->>'monthly_fee_sek','')::numeric,nullif(p_contract_payload->>'invoice_fee_sek','')::numeric,
    nullif(p_contract_payload->>'markup_ore_per_kwh','')::numeric,nullif(p_contract_payload->>'spot_markup_ore_per_kwh','')::numeric,
    nullif(p_contract_payload->>'variable_fee_ore_per_kwh','')::numeric,nullif(p_contract_payload->>'fixed_price_ore_per_kwh','')::numeric,
    coalesce(nullif(p_contract_payload->>'green_fee_mode',''),'none'),nullif(p_contract_payload->>'green_fee_value','')::numeric,
    nullif(p_contract_payload->>'binding_months','')::integer,nullif(p_contract_payload->>'notice_months','')::integer,
    nullif(p_contract_payload->>'campaign_code',''),coalesce(nullif(p_contract_payload->>'price_version',''),v_publication.price_plan_version_id::text),
    nullif(p_contract_payload->>'terms_version',''),coalesce(v_price_snapshot->'price_components','[]'::jsonb),
    coalesce(nullif(p_contract_payload->>'agreement_channel',''),'website'),
    coalesce(p_contract_payload->'metadata','{}'::jsonb)||jsonb_build_object(
      'source_of_truth','contract_publication_versions',
      'contract_publication_version_id',v_publication.id,
      'contract_product_version_id',v_contract_version.id,
      'legal_bundle_version_id',v_publication.legal_bundle_version_id,
      'price_plan_version_id',v_publication.price_plan_version_id
    ),
    v_price_snapshot,v_contract_version.contract_product_id,v_contract_version.id,v_publication.id,
    v_publication.legal_bundle_version_id,v_contract_version.commercial_snapshot,
    (select rendered_snapshot from public.legal_bundle_versions where id=v_publication.legal_bundle_version_id),now(),now()
  ) returning * into v_contract;

  insert into public.contract_price_snapshots(
    company_id,contract_id,customer_id,contract_number,customer_number,source,
    price_plan_id,price_plan_version_id,price_book_id,public_contract_offer_id,
    public_price_text,terms_url,spot_weight_percent,portfolio_weight_percent,fixed_weight_percent,
    pricing_model,base_price_components_snapshot,price_components_snapshot,snapshot_json,
    valid_from,valid_to,snapshot_hash,snapshot_quality
  ) values (
    p_company_id,v_contract.id,v_contract.customer_id,v_contract.contract_number,p_customer_number,'website_customer_applications',
    v_publication.price_plan_id,v_publication.price_plan_version_id,v_publication.price_book_id,v_offer.id,
    v_offer.public_price_text,v_offer.terms_url,v_offer.spot_weight_percent,v_offer.portfolio_weight_percent,v_offer.fixed_weight_percent,
    v_contract_version.pricing_model,coalesce(v_price_snapshot->'base_components','[]'::jsonb),
    coalesce(v_price_snapshot->'price_components','[]'::jsonb),
    jsonb_build_object(
      'schema','gridex_contract_acceptance_v3','source_of_truth','contract_publication_versions',
      'offer_reference',v_publication.offer_reference,'public_contract_offer_id',v_offer.id,
      'contract_publication_version_id',v_publication.id,'contract_product_version_id',v_contract_version.id,
      'legal_bundle_version_id',v_publication.legal_bundle_version_id,
      'price_plan_id',v_publication.price_plan_id,'price_plan_version_id',v_publication.price_plan_version_id,
      'price_book_id',v_publication.price_book_id,'pricing',v_price_snapshot,
      'commercial',v_contract_version.commercial_snapshot
    ),
    coalesce(nullif(p_contract_payload->>'requested_start_date','')::date,v_publication.valid_from::date),
    v_publication.valid_to::date,
    encode(digest(jsonb_build_object('publication',v_publication.id,'pricing',v_price_snapshot,'commercial',v_contract_version.commercial_snapshot)::text,'sha256'),'hex'),
    'exact_locked_publication'
  ) returning id into v_snapshot_id;

  update public.customer_contracts
  set contract_price_snapshot_id=v_snapshot_id,updated_at=now()
  where id=v_contract.id and company_id=p_company_id
  returning * into v_contract;

  return jsonb_build_object('contract',to_jsonb(v_contract),'contract_price_snapshot_id',v_snapshot_id);
end
$$;

-- Replaces the legacy fixed-five finalizer. The required evidence set is
-- derived from the exact locked legal bundle, so business contracts do not get
-- consumer withdrawal rights and POA is not required when the publication did
-- not include that module.
create or replace function public.gridex_finalize_website_contract_signature(
  p_company_id uuid,
  p_contract_id uuid,
  p_application_id uuid,
  p_public_contract_offer_id uuid,
  p_offer_reference text,
  p_accepted_at timestamptz,
  p_legal_versions jsonb,
  p_signature_snapshot jsonb,
  p_signature_snapshot_sha256 text,
  p_signed_ip_hash text default null,
  p_signed_user_agent text default null
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_contract public.customer_contracts%rowtype;
  v_customer_type text;
  v_expected_count integer;
  v_submitted_count integer;
  v_withdrawal_required boolean;
  v_withdrawal_deadline timestamptz;
begin
  if p_company_id is null or p_contract_id is null or p_application_id is null or p_accepted_at is null then
    raise exception using errcode='22023',message='company_contract_application_and_acceptance_time_required';
  end if;
  if jsonb_typeof(coalesce(p_legal_versions,'null'::jsonb))<>'array' then
    raise exception using errcode='22023',message='legal_versions_must_be_array';
  end if;

  select * into v_contract from public.customer_contracts
  where id=p_contract_id and company_id=p_company_id for update;
  if not found then raise exception using errcode='P0002',message='customer_contract_not_found_for_tenant'; end if;
  if v_contract.public_contract_offer_id<>p_public_contract_offer_id
     or v_contract.offer_reference is distinct from p_offer_reference
     or v_contract.contract_publication_version_id is null then
    raise exception using errcode='23514',message='contract_not_bound_to_exact_publication';
  end if;

  select coalesce(c.customer_type,'private') into v_customer_type
  from public.customers c where c.id=v_contract.customer_id and c.company_id=p_company_id;
  v_customer_type:=coalesce(v_customer_type,'private');

  with expected as (
    select distinct public.gridex_legacy_legal_type_for_module(d.module_key) legal_type,
           d.legacy_legal_text_version_id legal_id
    from public.legal_bundle_version_documents d
    where d.legal_bundle_version_id=v_contract.legal_bundle_version_id
      and d.legacy_legal_text_version_id is not null
  ) select count(*) into v_expected_count from expected;
  if v_expected_count=0 then raise exception using errcode='23514',message='exact_legal_document_set_missing'; end if;

  with submitted as (
    select distinct item->>'type' legal_type,(item->>'id')::uuid legal_id
    from jsonb_array_elements(p_legal_versions) item
    where nullif(item->>'type','') is not null and nullif(item->>'id','') is not null
  ) select count(*) into v_submitted_count from submitted;
  if v_submitted_count<>v_expected_count or exists (
    with expected as (
      select distinct public.gridex_legacy_legal_type_for_module(d.module_key) legal_type,
             d.legacy_legal_text_version_id legal_id
      from public.legal_bundle_version_documents d
      where d.legal_bundle_version_id=v_contract.legal_bundle_version_id
        and d.legacy_legal_text_version_id is not null
    ), submitted as (
      select distinct item->>'type' legal_type,(item->>'id')::uuid legal_id
      from jsonb_array_elements(p_legal_versions) item
      where nullif(item->>'type','') is not null and nullif(item->>'id','') is not null
    )
    select 1 from expected e full join submitted s using(legal_type,legal_id)
    where e.legal_id is null or s.legal_id is null
  ) then
    raise exception using errcode='23514',message='submitted_legal_versions_do_not_match_exact_publication';
  end if;

  if exists (
    with expected as (
      select distinct public.gridex_legacy_legal_type_for_module(d.module_key) legal_type,
             d.legacy_legal_text_version_id legal_id
      from public.legal_bundle_version_documents d
      where d.legal_bundle_version_id=v_contract.legal_bundle_version_id
        and d.legacy_legal_text_version_id is not null
    )
    select 1 from expected e
    where not exists (
      select 1 from public.customer_legal_acceptances a
      where a.company_id=p_company_id and a.contract_id=p_contract_id
        and a.contract_application_id=p_application_id and a.legal_text_version_id=e.legal_id
        and a.accepted_at=p_accepted_at
        and a.acceptance_type=case e.legal_type
          when 'terms' then 'terms' when 'privacy_policy' then 'privacy_policy'
          when 'withdrawal' then 'withdrawal_info' when 'power_of_attorney' then 'power_of_attorney'
          when 'price_terms' then 'price_snapshot' end
    )
  ) then raise exception using errcode='23514',message='exact_legal_acceptance_evidence_incomplete'; end if;

  select exists(
    select 1 from public.legal_bundle_version_documents d
    where d.legal_bundle_version_id=v_contract.legal_bundle_version_id
      and public.gridex_legacy_legal_type_for_module(d.module_key)='withdrawal'
  ) into v_withdrawal_required;
  v_withdrawal_deadline:=case when v_customer_type='private' and v_withdrawal_required then p_accepted_at+interval '14 days' else null end;

  update public.customer_contracts set
    status='signed',signed_at=p_accepted_at,is_distance_agreement=true,
    withdrawal_deadline_at=v_withdrawal_deadline,legal_versions_snapshot=p_legal_versions,
    signature_snapshot=coalesce(p_signature_snapshot,'{}'::jsonb),
    signature_snapshot_sha256=p_signature_snapshot_sha256,signed_ip_hash=p_signed_ip_hash,
    signed_user_agent=left(p_signed_user_agent,1000),locked_at=p_accepted_at,
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'signature_status','signed','signature_finalized_at',now(),
      'signature_snapshot_sha256',p_signature_snapshot_sha256,
      'contract_publication_version_id',v_contract.contract_publication_version_id
    ),updated_at=now()
  where id=p_contract_id and company_id=p_company_id;

  return jsonb_build_object('contract_id',p_contract_id,'status','signed','signed_at',p_accepted_at,
    'withdrawal_deadline_at',v_withdrawal_deadline,'public_contract_offer_id',p_public_contract_offer_id,
    'offer_reference',p_offer_reference,'signature_snapshot_sha256',p_signature_snapshot_sha256);
end
$$;

-- -----------------------------------------------------------------------------
-- Billing lifecycle evidence and atomicity guards
-- -----------------------------------------------------------------------------
create table if not exists public.contract_charge_ledger(
  id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id) on delete cascade,
  customer_contract_id uuid not null references public.customer_contracts(id) on delete restrict,component_key text not null,event_key text not null,
  pricing_run_id uuid,invoice_id uuid,amount_ex_vat numeric not null,charged_at timestamptz not null default now(),metadata jsonb not null default '{}',
  unique(customer_contract_id,component_key,event_key)
);
create index if not exists contract_charge_ledger_company_contract_idx on public.contract_charge_ledger(company_id,customer_contract_id,charged_at desc);

create table if not exists public.pricing_interval_evidence(
  id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id) on delete cascade,
  pricing_run_id uuid not null references public.pricing_runs(id) on delete cascade,billing_underlay_id uuid not null references public.billing_underlays(id) on delete restrict,
  billing_underlay_item_id uuid references public.billing_underlay_items(id) on delete restrict,
  customer_contract_id uuid not null references public.customer_contracts(id) on delete restrict,metering_interval_start timestamptz not null,metering_interval_end timestamptz not null,
  resolution text not null check(resolution in ('hour','quarter')),consumption_kwh numeric not null,price_sek_per_kwh numeric not null,amount_ex_vat numeric not null,
  price_source_id uuid,price_area text not null check(price_area in ('SE1','SE2','SE3','SE4')),evidence_sha256 text not null,created_at timestamptz not null default now(),
  unique(pricing_run_id,metering_interval_start,metering_interval_end,price_area)
);

do $$
begin
  if not exists(
    select 1 from pg_constraint
    where conrelid='public.contract_charge_ledger'::regclass
      and conname='contract_charge_ledger_pricing_run_fk'
  ) then
    alter table public.contract_charge_ledger
      add constraint contract_charge_ledger_pricing_run_fk
      foreign key(pricing_run_id) references public.pricing_runs(id) on delete restrict;
  end if;
end $$;

alter table public.contract_charge_ledger enable row level security;
alter table public.pricing_interval_evidence enable row level security;
drop policy if exists contract_charge_ledger_tenant_select on public.contract_charge_ledger;
create policy contract_charge_ledger_tenant_select on public.contract_charge_ledger
for select using(public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id));
drop policy if exists pricing_interval_evidence_tenant_select on public.pricing_interval_evidence;
create policy pricing_interval_evidence_tenant_select on public.pricing_interval_evidence
for select using(public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id));
revoke all on public.contract_charge_ledger,public.pricing_interval_evidence from anon,authenticated;
grant select on public.contract_charge_ledger,public.pricing_interval_evidence to authenticated;
grant all on public.contract_charge_ledger,public.pricing_interval_evidence to service_role;

create or replace function public.gridex_guard_billing_underlay_exact_refs()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.status in ('ready','priced','approved','exported','invoiced') and (new.contract_id is null or new.pricing_snapshot_id is null) then
    raise exception using errcode='23514',message='billing_underlay_requires_exact_contract_and_snapshot';
  end if;
  return new;
end $$;
drop trigger if exists billing_underlays_exact_refs_guard on public.billing_underlays;
create trigger billing_underlays_exact_refs_guard before insert or update of status,contract_id,pricing_snapshot_id on public.billing_underlays
for each row execute function public.gridex_guard_billing_underlay_exact_refs();

-- Prevent duplicate active snapshots for the same contract and overlapping effective start.
create unique index if not exists contract_price_snapshots_contract_valid_from_uidx
  on public.contract_price_snapshots(company_id,contract_id,valid_from) where contract_id is not null;

-- Persists the pricing run, lines, interval evidence and underlay status as one
-- transaction. A new successful run is fully written before the previous active
-- run is superseded, and an advisory lock serializes concurrent workers.
create or replace function public.gridex_persist_pricing_run(
  p_company_id uuid,
  p_billing_underlay_id uuid,
  p_result jsonb,
  p_pricing_snapshot jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_underlay public.billing_underlays%rowtype;
  v_run_id uuid;
  v_final_status text:=coalesce(nullif(p_result->>'status',''),'failed');
  v_rows integer;
begin
  if p_company_id is null or p_billing_underlay_id is null then
    raise exception using errcode='22023',message='company_and_billing_underlay_required';
  end if;
  if v_final_status not in ('success','failed','needs_review') then
    raise exception using errcode='22023',message='invalid_pricing_result_status';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_billing_underlay_id::text,0));
  select * into v_underlay from public.billing_underlays
  where id=p_billing_underlay_id and company_id=p_company_id for update;
  if not found then raise exception using errcode='P0002',message='billing_underlay_not_found_for_tenant'; end if;
  if v_underlay.contract_id is null or coalesce(v_underlay.contract_price_snapshot_id,v_underlay.pricing_snapshot_id) is null then
    raise exception using errcode='23514',message='exact_contract_and_price_snapshot_required';
  end if;
  if exists(select 1 from public.pricing_runs where company_id=p_company_id and billing_underlay_id=p_billing_underlay_id and status='locked') then
    raise exception using errcode='55000',message='pricing_run_locked';
  end if;

  insert into public.pricing_runs(
    company_id,billing_underlay_id,customer_id,billing_period_start,billing_period_end,status,
    total_ex_vat,vat_amount,total_inc_vat,warnings,errors,metadata
  ) values (
    p_company_id,p_billing_underlay_id,v_underlay.customer_id,v_underlay.billing_period_start,v_underlay.billing_period_end,
    case when v_final_status='success' then 'needs_review' else v_final_status end,
    coalesce((p_result->>'total_ex_vat')::numeric,0),coalesce((p_result->>'vat_amount')::numeric,0),
    coalesce((p_result->>'total_inc_vat')::numeric,0),coalesce(p_result->'warnings','[]'::jsonb),
    coalesce(p_result->'errors','[]'::jsonb),jsonb_build_object('source','pricing_core','atomic',true)
  ) returning id into v_run_id;

  insert into public.pricing_preview_lines(
    company_id,pricing_run_id,billing_underlay_id,line_type,description,quantity,unit,
    unit_price_ex_vat,amount_ex_vat,vat_rate,vat_amount,amount_inc_vat,sort_order,metadata
  )
  select p_company_id,v_run_id,p_billing_underlay_id,
    coalesce(nullif(x->>'line_type',''),'unknown'),coalesce(nullif(x->>'description',''),'Prisrad'),
    nullif(x->>'quantity','')::numeric,coalesce(nullif(x->>'unit',''),'st'),nullif(x->>'unit_price_ex_vat','')::numeric,
    coalesce(nullif(x->>'amount_ex_vat','')::numeric,0),coalesce(nullif(x->>'vat_rate','')::numeric,0),
    coalesce(nullif(x->>'vat_amount','')::numeric,0),coalesce(nullif(x->>'amount_inc_vat','')::numeric,0),
    coalesce(nullif(x->>'sort_order','')::integer,100),coalesce(x->'metadata','{}'::jsonb)
  from jsonb_array_elements(coalesce(p_result->'lines','[]'::jsonb)) x;

  insert into public.pricing_interval_evidence(
    company_id,pricing_run_id,billing_underlay_id,billing_underlay_item_id,customer_contract_id,
    metering_interval_start,metering_interval_end,resolution,consumption_kwh,price_sek_per_kwh,
    amount_ex_vat,price_source_id,price_area,evidence_sha256
  )
  select p_company_id,v_run_id,p_billing_underlay_id,nullif(x->>'billing_underlay_item_id','')::uuid,
    v_underlay.contract_id,(x->>'metering_interval_start')::timestamptz,(x->>'metering_interval_end')::timestamptz,
    x->>'resolution',(x->>'consumption_kwh')::numeric,(x->>'price_sek_per_kwh')::numeric,
    (x->>'amount_ex_vat')::numeric,nullif(x->>'price_source_id','')::uuid,x->>'price_area',
    encode(digest((x||jsonb_build_object('pricing_run_id',v_run_id))::text,'sha256'),'hex')
  from jsonb_array_elements(coalesce(p_result->'interval_evidence','[]'::jsonb)) x;

  if v_final_status='success' then
    update public.pricing_runs set status='superseded'
    where company_id=p_company_id and billing_underlay_id=p_billing_underlay_id and id<>v_run_id and status='success';
    update public.pricing_runs set status='success' where id=v_run_id;
    update public.billing_underlays set
      status='validated',readiness_status='ready',readiness_issues='[]'::jsonb,
      invoice_readiness_status='ready_for_invoice',invoice_readiness_issues='[]'::jsonb,
      calculated_total_sek_ex_vat=coalesce((p_result->>'total_ex_vat')::numeric,0),
      calculated_vat_sek=coalesce((p_result->>'vat_amount')::numeric,0),
      calculated_total_sek_inc_vat=coalesce((p_result->>'total_inc_vat')::numeric,0),
      pricing_snapshot=coalesce(p_pricing_snapshot,'{}'::jsonb)||jsonb_build_object(
        'latest_pricing_run_id',v_run_id,'latest_pricing_warnings',coalesce(p_result->'warnings','[]'::jsonb),
        'latest_pricing_errors',coalesce(p_result->'errors','[]'::jsonb)
      ),updated_at=now()
    where id=p_billing_underlay_id and company_id=p_company_id;
    get diagnostics v_rows=row_count;
    if v_rows<>1 then raise exception using errcode='P0002',message='billing_underlay_atomic_update_failed'; end if;
  else
    update public.billing_underlays set
      pricing_snapshot=coalesce(pricing_snapshot,'{}'::jsonb)||jsonb_build_object(
        'latest_failed_pricing_run_id',v_run_id,'latest_pricing_errors',coalesce(p_result->'errors','[]'::jsonb)
      ),updated_at=now()
    where id=p_billing_underlay_id and company_id=p_company_id;
  end if;
  return v_run_id;
end
$$;

create or replace function public.gridex_lock_pricing_run(
  p_company_id uuid,p_pricing_run_id uuid,p_actor_user_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_run public.pricing_runs%rowtype;
  v_underlay public.billing_underlays%rowtype;
  v_month text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_pricing_run_id::text,0));
  select * into v_run from public.pricing_runs where id=p_pricing_run_id and company_id=p_company_id for update;
  if not found then raise exception using errcode='P0002',message='pricing_run_not_found_for_tenant'; end if;
  if v_run.status not in ('success','locked') then raise exception using errcode='23514',message='only_successful_pricing_run_can_be_locked'; end if;
  select * into v_underlay from public.billing_underlays where id=v_run.billing_underlay_id and company_id=p_company_id for update;
  if not found then raise exception using errcode='P0002',message='pricing_underlay_not_found'; end if;
  v_month:=to_char(v_run.billing_period_start at time zone 'Europe/Stockholm','YYYY-MM');
  if v_run.status='locked' then
    return jsonb_build_object('pricing_run_id',v_run.id,'billing_underlay_id',v_underlay.id,'billing_month',v_month,'status','locked');
  end if;

  insert into public.price_period_locks(company_id,billing_month,lock_scope,status,locked_by,locked_at)
  values(p_company_id,v_month,'pricing_preview','locked',p_actor_user_id,now())
  on conflict(company_id,billing_month,lock_scope) do update set status='locked',locked_by=excluded.locked_by,locked_at=excluded.locked_at;

  insert into public.contract_charge_ledger(
    company_id,customer_contract_id,component_key,event_key,pricing_run_id,amount_ex_vat,metadata
  )
  select p_company_id,v_underlay.contract_id,
    coalesce(nullif(l.metadata->>'component_key',''),l.line_type||':'||encode(digest(lower(l.description),'sha256'),'hex')),
    case
      when coalesce(l.metadata->>'lifecycle','')='event_only' then coalesce(nullif(l.metadata->>'billing_event_id',''),nullif(l.metadata->>'event',''),'event')
      else 'contract'
    end,v_run.id,l.amount_ex_vat,l.metadata
  from public.pricing_preview_lines l
  where l.pricing_run_id=v_run.id
    and coalesce(l.metadata->>'lifecycle','') in ('once_per_contract','one_time','event_only')
  on conflict(customer_contract_id,component_key,event_key) do nothing;

  update public.pricing_runs set status='locked',locked_at=now() where id=v_run.id;
  update public.billing_underlays set readiness_status='ready',updated_at=now()
  where id=v_underlay.id and company_id=p_company_id;
  return jsonb_build_object('pricing_run_id',v_run.id,'billing_underlay_id',v_underlay.id,'billing_month',v_month,'status','locked');
end
$$;

-- Raw and normalized billing readiness always move together.
create or replace function public.gridex_set_metering_billing_gate(
  p_company_id uuid,
  p_metering_value_id uuid,
  p_normalized_value_id uuid,
  p_gate jsonb
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_now timestamptz:=coalesce(nullif(p_gate->>'billing_gate_evaluated_at','')::timestamptz,now());
  v_rows integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_metering_value_id::text,0));
  if not exists(
    select 1 from public.normalized_metering_values n
    where n.id=p_normalized_value_id and n.company_id=p_company_id
      and n.source_metering_value_id=p_metering_value_id and n.revision_status='current'
  ) then
    raise exception using errcode='23514',message='normalized_metering_value_not_current_or_not_linked';
  end if;

  update public.metering_values set
    customer_id=coalesce(nullif(p_gate->>'customer_id','')::uuid,customer_id),
    billing_status=p_gate->>'billing_status',
    billing_gate_status=p_gate->>'billing_gate_status',
    billing_gate_reasons=coalesce(p_gate->'billing_gate_reasons','[]'::jsonb),
    billing_gate_snapshot=coalesce(p_gate->'billing_gate_snapshot','{}'::jsonb),
    billing_gate_evaluated_at=v_now
  where id=p_metering_value_id and company_id=p_company_id;
  get diagnostics v_rows=row_count;
  if v_rows<>1 then raise exception using errcode='P0002',message='metering_billing_status_update_missed'; end if;

  update public.normalized_metering_values set
    customer_id=coalesce(nullif(p_gate->>'customer_id','')::uuid,customer_id),
    supply_period_id=nullif(p_gate->>'supply_period_id','')::uuid,
    source_message_id=coalesce(nullif(p_gate->>'source_message_id','')::uuid,source_message_id),
    billing_status=p_gate->>'billing_status',
    billing_gate_status=p_gate->>'billing_gate_status',
    billing_gate_reasons=coalesce(p_gate->'billing_gate_reasons','[]'::jsonb),
    billing_gate_snapshot=coalesce(p_gate->'billing_gate_snapshot','{}'::jsonb),
    billing_gate_evaluated_at=v_now,
    updated_at=v_now
  where id=p_normalized_value_id and company_id=p_company_id and revision_status='current';
  get diagnostics v_rows=row_count;
  if v_rows<>1 then raise exception using errcode='P0002',message='normalized_metering_billing_status_update_missed'; end if;
  return jsonb_build_object('metering_value_id',p_metering_value_id,'normalized_value_id',p_normalized_value_id,'status',p_gate->>'billing_status');
end
$$;

-- Every underlay segment for a monthly generation is committed or rolled back together.
create or replace function public.gridex_store_billing_underlay_batch(
  p_company_id uuid,
  p_commands jsonb,
  p_actor_user_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_command jsonb;
  v_ids jsonb:='[]'::jsonb;
  v_id uuid;
begin
  if jsonb_typeof(coalesce(p_commands,'[]'::jsonb))<>'array' then
    raise exception using errcode='22023',message='billing_underlay_commands_must_be_array';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':billing-underlay-batch',0));
  for v_command in select value from jsonb_array_elements(coalesce(p_commands,'[]'::jsonb)) loop
    v_id:=public.gridex_store_billing_underlay(
      p_company_id,
      coalesce(v_command->'underlay','{}'::jsonb),
      coalesce(v_command->'items','[]'::jsonb),
      p_actor_user_id
    );
    v_ids:=v_ids||jsonb_build_array(v_id::text);
  end loop;
  return v_ids;
end
$$;

-- Export run and all row payloads are created atomically. Ready rows must
-- reference the exact underlay contract and a locked pricing run for that underlay.
create or replace function public.gridex_create_billing_export_run(
  p_run jsonb,
  p_items jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_company_id uuid:=nullif(p_run->>'company_id','')::uuid;
  v_run_id uuid:=coalesce(nullif(p_run->>'id','')::uuid,gen_random_uuid());
  v_existing public.billing_export_runs%rowtype;
  v_run public.billing_export_runs%rowtype;
  v_item jsonb;
  v_underlay public.billing_underlays%rowtype;
  v_item_contract_id uuid;
  v_pricing_run_id uuid;
  v_rows integer:=0;
begin
  if v_company_id is null or nullif(p_run->>'period_month','') is null then
    raise exception using errcode='22023',message='export_company_and_period_required';
  end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array' then
    raise exception using errcode='22023',message='export_items_must_be_array';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_company_id::text||':'||coalesce(p_run->>'idempotency_key',v_run_id::text),0));

  if nullif(p_run->>'idempotency_key','') is not null then
    select * into v_existing from public.billing_export_runs
    where company_id=v_company_id and idempotency_key=p_run->>'idempotency_key'
    order by created_at limit 1;
    if found then return to_jsonb(v_existing); end if;
  end if;

  insert into public.billing_export_runs(
    id,company_id,period_month,target_system,export_format,status,rows_total,rows_ready,
    rows_blocked,rows_exported,blocker_summary,metadata,created_by,created_at,updated_at,
    adapter_key,payload_version,retry_policy,idempotency_key
  ) values (
    v_run_id,v_company_id,p_run->>'period_month',coalesce(nullif(p_run->>'target_system',''),'billing_partner'),
    coalesce(nullif(p_run->>'export_format',''),'json'),coalesce(nullif(p_run->>'status',''),'blocked'),
    coalesce((p_run->>'rows_total')::integer,0),coalesce((p_run->>'rows_ready')::integer,0),
    coalesce((p_run->>'rows_blocked')::integer,0),coalesce((p_run->>'rows_exported')::integer,0),
    coalesce(p_run->'blocker_summary','[]'::jsonb),coalesce(p_run->'metadata','{}'::jsonb),
    nullif(p_run->>'created_by','')::uuid,coalesce(nullif(p_run->>'created_at','')::timestamptz,now()),
    coalesce(nullif(p_run->>'updated_at','')::timestamptz,now()),
    coalesce(nullif(p_run->>'adapter_key',''),'gridex_billing_partner_v1'),
    coalesce(nullif(p_run->>'payload_version',''),'billing_export_v4c'),
    coalesce(p_run->'retry_policy','{"maxAttempts":3,"strategy":"manual_retry"}'::jsonb),
    nullif(p_run->>'idempotency_key','')
  ) returning * into v_run;

  for v_item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
    if nullif(v_item->>'billing_underlay_id','') is null then
      raise exception using errcode='23514',message='export_item_underlay_required';
    end if;
    select * into v_underlay from public.billing_underlays
    where id=(v_item->>'billing_underlay_id')::uuid and company_id=v_company_id for share;
    if not found then raise exception using errcode='23503',message='export_item_underlay_not_found_for_tenant'; end if;

    v_item_contract_id:=nullif(v_item->>'contract_id','')::uuid;
    if coalesce(v_item->>'status','blocked')='ready' then
      if v_item_contract_id is null or v_underlay.contract_id is distinct from v_item_contract_id then
        raise exception using errcode='23514',message='export_item_contract_must_match_underlay_exactly';
      end if;
      if coalesce(v_underlay.contract_price_snapshot_id,v_underlay.pricing_snapshot_id) is null then
        raise exception using errcode='23514',message='export_item_exact_price_snapshot_required';
      end if;
      v_pricing_run_id:=nullif(v_item#>>'{payload_snapshot,pricing,pricingRunId}','')::uuid;
      if v_pricing_run_id is null or not exists(
        select 1 from public.pricing_runs pr
        where pr.id=v_pricing_run_id and pr.company_id=v_company_id
          and pr.billing_underlay_id=v_underlay.id and pr.status='locked'
      ) then
        raise exception using errcode='23514',message='export_item_locked_pricing_run_required';
      end if;
    end if;

    insert into public.billing_export_run_items(
      id,company_id,billing_export_run_id,billing_underlay_id,contract_id,customer_id,site_id,metering_point_id,
      status,readiness_status,blocker_reasons,pricing_line_items,invoice_recipient,invoice_email,invoice_reference,
      billing_level,consolidated_invoice,invoice_address_snapshot,site_address_snapshot,consolidated_invoice_group_key,
      adapter_key,payload_version,adapter_payload_snapshot,external_reference,payload_snapshot,export_status,
      idempotency_key,created_at,updated_at
    ) values (
      coalesce(nullif(v_item->>'id','')::uuid,gen_random_uuid()),v_company_id,v_run.id,v_underlay.id,v_item_contract_id,
      nullif(v_item->>'customer_id','')::uuid,nullif(v_item->>'site_id','')::uuid,nullif(v_item->>'metering_point_id','')::uuid,
      coalesce(nullif(v_item->>'status',''),'blocked'),coalesce(nullif(v_item->>'readiness_status',''),'blocked'),
      coalesce(v_item->'blocker_reasons','[]'::jsonb),coalesce(v_item->'pricing_line_items','[]'::jsonb),
      nullif(v_item->>'invoice_recipient',''),nullif(v_item->>'invoice_email',''),nullif(v_item->>'invoice_reference',''),
      coalesce(nullif(v_item->>'billing_level',''),'customer'),coalesce((v_item->>'consolidated_invoice')::boolean,false),
      coalesce(v_item->'invoice_address_snapshot','{}'::jsonb),coalesce(v_item->'site_address_snapshot','{}'::jsonb),
      nullif(v_item->>'consolidated_invoice_group_key',''),coalesce(nullif(v_item->>'adapter_key',''),'gridex_billing_partner_v1'),
      coalesce(nullif(v_item->>'payload_version',''),'billing_export_item_v4c'),coalesce(v_item->'adapter_payload_snapshot','{}'::jsonb),
      nullif(v_item->>'external_reference',''),coalesce(v_item->'payload_snapshot','{}'::jsonb),
      coalesce(nullif(v_item->>'export_status',''),'not_queued'),nullif(v_item->>'idempotency_key',''),
      coalesce(nullif(v_item->>'created_at','')::timestamptz,now()),coalesce(nullif(v_item->>'updated_at','')::timestamptz,now())
    );
    v_rows:=v_rows+1;
  end loop;

  if v_rows<>coalesce((p_run->>'rows_total')::integer,0) then
    raise exception using errcode='23514',message='export_run_item_count_mismatch';
  end if;
  return to_jsonb(v_run);
end
$$;

-- One tenant-scoped diagnostic reports repository/runtime drift and broken
-- end-to-end invariants without mutating production data.
create or replace function public.gridex_contract_platform_integrity_report(
  p_company_id uuid
) returns jsonb
language sql
security definer
set search_path=public,pg_temp
as $$
  select jsonb_build_object(
    'company_id',p_company_id,
    'generated_at',now(),
    'published_offers_missing_canonical_binding',(
      select count(*) from public.public_contract_offers o
      where o.company_id=p_company_id and o.publication_status='published'
        and (o.contract_product_version_id is null or o.contract_publication_version_id is null
          or o.legal_bundle_version_id is null or o.price_plan_version_id is null or o.price_book_id is null)
    ),
    'published_versions_blocked',(
      select count(*) from public.contract_publication_readiness_v r
      where r.company_id=p_company_id and r.status='published'
        and coalesce(array_length(r.blockers,1),0)>0
    ),
    'signed_contracts_missing_exact_binding',(
      select count(*) from public.customer_contracts c
      where c.company_id=p_company_id and c.status in ('signed','active')
        and (c.contract_publication_version_id is null or c.contract_product_version_id is null
          or c.legal_bundle_version_id is null or c.contract_price_snapshot_id is null)
    ),
    'ready_underlays_missing_exact_binding',(
      select count(*) from public.billing_underlays b
      where b.company_id=p_company_id and b.status in ('ready','priced','approved','exported','invoiced')
        and (b.contract_id is null or coalesce(b.contract_price_snapshot_id,b.pricing_snapshot_id) is null)
    ),
    'ready_exports_with_contract_mismatch',(
      select count(*)
      from public.billing_export_run_items i
      join public.billing_underlays b on b.id=i.billing_underlay_id and b.company_id=i.company_id
      where i.company_id=p_company_id and i.status='ready' and i.contract_id is distinct from b.contract_id
    ),
    'orphan_unlocked_price_versions',(
      select count(*) from public.price_plan_versions v
      where v.company_id=p_company_id and v.locked_at is null
        and not exists(select 1 from public.public_contract_offers o where o.price_plan_version_id=v.id)
        and not exists(select 1 from public.contract_publication_versions cpv where cpv.price_plan_version_id=v.id)
    ),
    'orphan_unlocked_price_books',(
      select count(*) from public.price_books b
      where b.company_id=p_company_id and b.locked_at is null
        and not exists(select 1 from public.public_contract_offers o where o.price_book_id=b.id)
        and not exists(select 1 from public.contract_publication_versions cpv where cpv.price_book_id=b.id)
    ),
    'runtime_functions_present',jsonb_build_object(
      'public_offer_upsert',to_regprocedure('public.gridex_upsert_public_contract_offer(uuid,uuid,text,jsonb,jsonb,uuid)') is not null,
      'website_contract_create',to_regprocedure('public.gridex_create_website_customer_contract(uuid,jsonb,text)') is not null,
      'pricing_persist',to_regprocedure('public.gridex_persist_pricing_run(uuid,uuid,jsonb,jsonb)') is not null,
      'export_create',to_regprocedure('public.gridex_create_billing_export_run(jsonb,jsonb)') is not null
    )
  )
$$;

-- Clean orphaned unpublished pricing artifacts safely; published/locked records are never removed.
create or replace function public.gridex_cleanup_orphan_contract_pricing(p_older_than interval default interval '24 hours')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_components integer:=0; v_books integer:=0; v_versions integer:=0;
begin
  perform set_config('gridex.pricing_version_write','on',true);
  delete from public.price_books b where b.locked_at is null and b.created_at<now()-p_older_than and not exists(select 1 from public.public_contract_offers o where o.price_book_id=b.id) and not exists(select 1 from public.contract_publication_versions v where v.price_book_id=b.id); get diagnostics v_books=row_count;
  delete from public.price_plan_versions v where v.locked_at is null and v.created_at<now()-p_older_than and not exists(select 1 from public.public_contract_offers o where o.price_plan_version_id=v.id) and not exists(select 1 from public.contract_publication_versions p where p.price_plan_version_id=v.id); get diagnostics v_versions=row_count;
  return jsonb_build_object('price_books_deleted',v_books,'price_versions_deleted',v_versions,'components_deleted_by_cascade',v_components);
end $$;

revoke all on function public.gridex_set_metering_billing_gate(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.gridex_set_metering_billing_gate(uuid,uuid,uuid,jsonb) to service_role;
revoke all on function public.gridex_store_billing_underlay_batch(uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.gridex_store_billing_underlay_batch(uuid,jsonb,uuid) to service_role;

revoke all on function public.gridex_create_billing_export_run(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.gridex_create_billing_export_run(jsonb,jsonb) to service_role;

revoke all on function public.gridex_persist_pricing_run(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.gridex_persist_pricing_run(uuid,uuid,jsonb,jsonb) to service_role;
revoke all on function public.gridex_lock_pricing_run(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.gridex_lock_pricing_run(uuid,uuid,uuid) to service_role;

revoke all on function public.gridex_create_website_customer_contract(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.gridex_create_website_customer_contract(uuid,jsonb,text) to service_role;
revoke all on function public.gridex_finalize_website_contract_signature(uuid,uuid,uuid,uuid,text,timestamptz,jsonb,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.gridex_finalize_website_contract_signature(uuid,uuid,uuid,uuid,text,timestamptz,jsonb,jsonb,text,text,text) to service_role;

revoke all on function public.gridex_upsert_internal_contract_offer(uuid,uuid,jsonb,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.gridex_upsert_internal_contract_offer(uuid,uuid,jsonb,jsonb,uuid) to service_role;
revoke all on function public.gridex_upsert_public_contract_offer(uuid,uuid,text,jsonb,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.gridex_archive_public_contract_offer(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.gridex_cleanup_orphan_contract_pricing(interval) from public,anon,authenticated;
revoke all on function public.gridex_contract_platform_integrity_report(uuid) from public,anon,authenticated;
grant execute on function public.gridex_upsert_public_contract_offer(uuid,uuid,text,jsonb,jsonb,uuid) to service_role;
grant execute on function public.gridex_archive_public_contract_offer(uuid,uuid,uuid) to service_role;
grant execute on function public.gridex_cleanup_orphan_contract_pricing(interval) to service_role;
grant execute on function public.gridex_contract_platform_integrity_report(uuid) to service_role;
grant select on public.canonical_public_contract_offers_v,public.contract_publication_readiness_v to authenticated,service_role;

commit;
