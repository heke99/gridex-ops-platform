begin;

create table if not exists public.legal_requirement_rules (
  id uuid primary key default gen_random_uuid(),
  customer_type text not null check (customer_type in ('private','business','both')),
  contract_type text not null,
  channel text not null check (channel in ('internal','website','phone','partner','api','all')),
  condition_json jsonb not null default '{}'::jsonb,
  required_module_keys text[] not null default '{}',
  priority integer not null default 100,
  status text not null default 'active' check (status in ('active','paused','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_type, contract_type, channel, priority)
);

insert into public.legal_templates(module_key,name,mandatory,status)
values
 ('general_consumer_terms','Allmänna konsumentvillkor',true,'active'),
 ('general_business_terms','Allmänna företagsvillkor',true,'active'),
 ('variable_price_terms','Särskilda villkor för rörligt pris',false,'active'),
 ('hourly_price_terms','Särskilda villkor för timpris',false,'active'),
 ('fixed_price_terms','Särskilda villkor för fastpris',false,'active'),
 ('mixed_price_terms','Villkor för mixavtal',false,'active'),
 ('portfolio_terms','Villkor för portföljavtal',false,'active'),
 ('price_terms','Prisvillkor',true,'active'),
 ('power_of_attorney','Fullmakt',false,'active'),
 ('withdrawal_right','Ångerrätt',false,'active'),
 ('withdrawal_form','Ångerblankett',false,'active'),
 ('privacy_policy','Integritetspolicy',true,'active'),
 ('pre_contract_information','Förhandsinformation före avtal',false,'active'),
 ('billing_terms','Fakturerings- och betalningsvillkor',true,'active'),
 ('supplier_switch_terms','Leverantörsbyte och avtalsstart',true,'active'),
 ('automatic_renewal','Automatisk förlängning',false,'active'),
 ('termination_and_breach','Uppsägning och avtalsbrott',true,'active'),
 ('complaints_and_disputes','Klagomål och tvistlösning',true,'active'),
 ('company_information','Kontakt- och bolagsinformation',true,'active'),
 ('volume_forecast_responsibility','Volym- och prognosansvar',false,'active')
on conflict (module_key) do update set name=excluded.name, mandatory=excluded.mandatory, status='active';

insert into public.legal_requirement_rules(customer_type,contract_type,channel,required_module_keys,priority)
values
 ('private','variable_monthly','all',array['general_consumer_terms','variable_price_terms','price_terms','pre_contract_information','withdrawal_right','withdrawal_form','privacy_policy','power_of_attorney','supplier_switch_terms','billing_terms','complaints_and_disputes','company_information'],10),
 ('private','variable_hourly','all',array['general_consumer_terms','hourly_price_terms','price_terms','pre_contract_information','withdrawal_right','withdrawal_form','privacy_policy','power_of_attorney','supplier_switch_terms','billing_terms','complaints_and_disputes','company_information'],10),
 ('private','fixed','all',array['general_consumer_terms','fixed_price_terms','price_terms','pre_contract_information','withdrawal_right','withdrawal_form','privacy_policy','power_of_attorney','supplier_switch_terms','billing_terms','termination_and_breach','complaints_and_disputes','company_information'],10),
 ('private','mixed','all',array['general_consumer_terms','mixed_price_terms','price_terms','pre_contract_information','withdrawal_right','withdrawal_form','privacy_policy','power_of_attorney','supplier_switch_terms','billing_terms','termination_and_breach','complaints_and_disputes','company_information'],10),
 ('private','portfolio','all',array['general_consumer_terms','portfolio_terms','price_terms','pre_contract_information','withdrawal_right','withdrawal_form','privacy_policy','power_of_attorney','supplier_switch_terms','billing_terms','termination_and_breach','complaints_and_disputes','company_information'],10),
 ('business','portfolio','all',array['general_business_terms','portfolio_terms','price_terms','volume_forecast_responsibility','power_of_attorney','billing_terms','termination_and_breach','privacy_policy','complaints_and_disputes','company_information'],10),
 ('business','fixed','all',array['general_business_terms','fixed_price_terms','price_terms','power_of_attorney','billing_terms','termination_and_breach','privacy_policy','complaints_and_disputes','company_information'],10),
 ('business','variable_monthly','all',array['general_business_terms','variable_price_terms','price_terms','power_of_attorney','billing_terms','termination_and_breach','privacy_policy','complaints_and_disputes','company_information'],10),
 ('business','variable_hourly','all',array['general_business_terms','hourly_price_terms','price_terms','power_of_attorney','billing_terms','termination_and_breach','privacy_policy','complaints_and_disputes','company_information'],10),
 ('business','mixed','all',array['general_business_terms','mixed_price_terms','price_terms','power_of_attorney','billing_terms','termination_and_breach','privacy_policy','complaints_and_disputes','company_information'],10)
on conflict (customer_type,contract_type,channel,priority) do update set required_module_keys=excluded.required_module_keys,status='active',updated_at=now();

create or replace function public.gridex_required_legal_modules(
  p_customer_type text,
  p_contract_type text,
  p_channel text default 'website',
  p_automatic_renewal boolean default false,
  p_requires_power_of_attorney boolean default true
) returns text[]
language plpgsql stable security definer set search_path=public
as $$
declare
  v_modules text[] := '{}';
begin
  select coalesce(array_agg(distinct m order by m), '{}') into v_modules
  from public.legal_requirement_rules r
  cross join lateral unnest(r.required_module_keys) m
  where r.status='active'
    and r.customer_type in (coalesce(nullif(p_customer_type,''),'private'),'both')
    and r.contract_type=coalesce(nullif(p_contract_type,''),'variable_monthly')
    and r.channel in (coalesce(nullif(p_channel,''),'website'),'all');

  if p_automatic_renewal and not ('automatic_renewal'=any(v_modules)) then v_modules:=array_append(v_modules,'automatic_renewal'); end if;
  if not p_requires_power_of_attorney then v_modules:=array_remove(v_modules,'power_of_attorney'); end if;
  return v_modules;
end $$;

create or replace function public.gridex_set_contract_version_legal_modules()
returns trigger language plpgsql set search_path=public as $$
begin
  if coalesce(array_length(new.required_legal_modules,1),0)=0 then
    new.required_legal_modules := public.gridex_required_legal_modules(
      new.customer_type,new.contract_type,'website',
      coalesce(new.automatic_renewal,false),
      coalesce(new.power_of_attorney_required,true)
    );
  end if;
  return new;
end $$;

drop trigger if exists contract_product_versions_set_legal_modules on public.contract_product_versions;
create trigger contract_product_versions_set_legal_modules before insert or update of customer_type,contract_type,automatic_renewal,power_of_attorney_required,required_legal_modules
on public.contract_product_versions for each row execute function public.gridex_set_contract_version_legal_modules();

create or replace function public.gridex_refresh_legal_profile_completeness()
returns trigger language plpgsql set search_path=public as $$
begin
  new.completeness_status := case when
    nullif(btrim(coalesce(new.legal_name,'')),'') is not null and
    nullif(btrim(coalesce(new.organization_number,'')),'') is not null and
    nullif(btrim(coalesce(new.customer_service_email,'')),'') is not null and
    nullif(btrim(coalesce(new.phone,'')),'') is not null and
    nullif(btrim(coalesce(new.website,'')),'') is not null and
    new.postal_address <> '{}'::jsonb and
    new.complaints_contact <> '{}'::jsonb and
    new.data_protection_contact <> '{}'::jsonb and
    new.billing_information <> '{}'::jsonb and
    new.dispute_resolution_information <> '{}'::jsonb
  then case when new.verified_at is not null then 'verified' else 'complete' end else 'incomplete' end;
  new.updated_at:=now();
  return new;
end $$;

drop trigger if exists tenant_legal_profiles_completeness on public.tenant_legal_profiles;
create trigger tenant_legal_profiles_completeness before insert or update on public.tenant_legal_profiles
for each row execute function public.gridex_refresh_legal_profile_completeness();

create or replace view public.contract_publication_readiness_v as
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
  pv.status as contract_version_status,
  pv.required_legal_modules,
  coalesce(array_agg(distinct lbd.module_key) filter (where lbd.module_key is not null),'{}') as included_legal_modules,
  array_remove(array[
    case when tlp.completeness_status not in ('complete','verified') then 'tenant_legal_profile_incomplete' end,
    case when pv.status not in ('approved','published','active') then 'contract_version_not_approved' end,
    case when cpv.price_plan_id is null then 'price_plan_missing' end,
    case when cpv.price_plan_version_id is null then 'price_plan_version_missing' end,
    case when cpv.price_book_id is null then 'price_book_missing' end,
    case when cpv.legal_bundle_version_id is null then 'legal_bundle_missing' end,
    case when lbv.status <> 'published' or lbv.locked_at is null then 'legal_bundle_not_locked' end,
    case when coalesce(array_length(lbv.unresolved_variables,1),0)>0 then 'unresolved_legal_variables' end,
    case when cpv.valid_to is not null and cpv.valid_from is not null and cpv.valid_to < cpv.valid_from then 'invalid_validity_period' end,
    case when cpv.status='published' and cpv.locked_at is null then 'publication_not_locked' end
  ],null) || coalesce(array(
    select 'missing_legal_module:'||m
    from unnest(pv.required_legal_modules) m
    where not exists (
      select 1 from public.legal_bundle_version_documents d
      where d.legal_bundle_version_id=cpv.legal_bundle_version_id and d.module_key=m
    )
  ),'{}') as blockers
from public.contract_publication_versions cpv
join public.contract_publications cp on cp.id=cpv.contract_publication_id
join public.tenant_contract_assignments a on a.id=cp.assignment_id
join public.contract_product_versions pv on pv.id=cpv.contract_product_version_id
left join public.legal_bundle_versions lbv on lbv.id=cpv.legal_bundle_version_id
left join public.legal_bundle_version_documents lbd on lbd.legal_bundle_version_id=lbv.id
left join public.tenant_legal_profiles tlp on tlp.company_id=a.company_id
group by cpv.id,a.company_id,a.id,lbv.id,tlp.completeness_status,pv.id;

create or replace function public.gridex_publish_contract_publication_version(p_publication_version_id uuid,p_actor_user_id uuid default null)
returns public.contract_publication_versions
language plpgsql security definer set search_path=public as $$
declare v_row public.contract_publication_versions; v_blockers text[];
begin
  select r.blockers into v_blockers from public.contract_publication_readiness_v r where r.contract_publication_version_id=p_publication_version_id;
  if v_blockers is null then raise exception 'publication_version_not_found'; end if;
  if coalesce(array_length(v_blockers,1),0)>0 then raise exception 'publication_not_ready:%',array_to_string(v_blockers,','); end if;
  update public.contract_publication_versions cpv set
    status='published', published_at=coalesce(cpv.published_at,now()), locked_at=coalesce(cpv.locked_at,now()),
    offer_reference=coalesce(cpv.offer_reference,'offer_'||encode(gen_random_bytes(24),'hex'))
  where cpv.id=p_publication_version_id returning * into v_row;
  update public.contract_publications cp set status='published',updated_at=now() where cp.id=v_row.contract_publication_id;
  return v_row;
end $$;

create or replace function public.gridex_protect_published_legacy_offer()
returns trigger language plpgsql set search_path=public as $$
begin
  if old.publication_status='published' and old.is_archived=false then
    if to_jsonb(new)-array['publication_status','website_enabled','is_public','is_archived','valid_from','valid_to','updated_at','updated_by']
       is distinct from to_jsonb(old)-array['publication_status','website_enabled','is_public','is_archived','valid_from','valid_to','updated_at','updated_by'] then
      raise exception 'published_offer_is_immutable_create_new_version';
    end if;
  end if;
  return new;
end $$;

do $$ begin
  if to_regclass('public.public_contract_offers') is not null then
    drop trigger if exists public_contract_offers_protect_published on public.public_contract_offers;
    create trigger public_contract_offers_protect_published before update on public.public_contract_offers
    for each row execute function public.gridex_protect_published_legacy_offer();
  end if;
end $$;

create or replace function public.gridex_capture_signed_contract_evidence()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_acceptance jsonb; v_sha text; v_pub uuid; v_product_version uuid; v_product uuid; v_bundle uuid;
begin
  if new.status not in ('signed','active') or new.signed_at is null then return new; end if;
  if tg_op='UPDATE' and old.status in ('signed','active') and old.signed_at is not null then return new; end if;

  if new.contract_publication_version_id is null and new.public_contract_offer_id is not null then
    select cpv.id,cpv.contract_product_version_id,pv.contract_product_id,cpv.legal_bundle_version_id
      into v_pub,v_product_version,v_product,v_bundle
    from public.contract_publication_versions cpv
    join public.contract_product_versions pv on pv.id=cpv.contract_product_version_id
    where cpv.legacy_public_contract_offer_id=new.public_contract_offer_id
    order by cpv.version_number desc limit 1;
    new.contract_publication_version_id:=v_pub;
    new.contract_product_version_id:=coalesce(new.contract_product_version_id,v_product_version);
    new.contract_product_id:=coalesce(new.contract_product_id,v_product);
    new.legal_bundle_version_id:=coalesce(new.legal_bundle_version_id,v_bundle);
  end if;

  new.locked_at:=coalesce(new.locked_at,now());
  new.commercial_snapshot:=coalesce(nullif(new.commercial_snapshot,'{}'::jsonb),jsonb_build_object(
    'contract_name',new.contract_name,'contract_type',new.contract_type,'price_plan_id',new.price_plan_id,
    'price_plan_version_id',new.price_plan_version_id,'price_snapshot',new.price_snapshot,'campaign_snapshot',new.campaign_snapshot));
  new.legal_snapshot:=coalesce(nullif(new.legal_snapshot,'{}'::jsonb),jsonb_build_object(
    'legal_bundle_version_id',new.legal_bundle_version_id,'legal_versions_snapshot',new.legal_versions_snapshot,
    'terms_version',new.terms_version,'terms_signed_version',new.terms_signed_version));
  v_acceptance:=jsonb_build_object('customer_contract_id',new.id,'company_id',new.company_id,'accepted_at',new.signed_at,
    'offer_reference',new.offer_reference,'publication_version_id',new.contract_publication_version_id,
    'commercial_snapshot',new.commercial_snapshot,'legal_snapshot',new.legal_snapshot,'signature_snapshot_sha256',new.signature_snapshot_sha256);
  v_sha:=encode(digest(v_acceptance::text,'sha256'),'hex');
  insert into public.customer_contract_acceptances(company_id,customer_contract_id,contract_publication_version_id,accepted_at,channel,signing_method,customer_identity_snapshot,power_of_attorney_snapshot,acceptance_snapshot,acceptance_sha256)
  values(new.company_id,new.id,new.contract_publication_version_id,new.signed_at,coalesce(new.source_type,'website'),'server_verified',jsonb_build_object('customer_id',new.customer_id), '{}'::jsonb,v_acceptance,v_sha)
  on conflict do nothing;
  insert into public.customer_contract_evidence(company_id,customer_contract_id,evidence_type,evidence_snapshot,evidence_sha256,captured_at)
  values(new.company_id,new.id,'contract_acceptance',v_acceptance,v_sha,new.signed_at) on conflict do nothing;
  return new;
end $$;

drop trigger if exists customer_contracts_capture_signed_evidence on public.customer_contracts;
create trigger customer_contracts_capture_signed_evidence before insert or update of status,signed_at on public.customer_contracts
for each row execute function public.gridex_capture_signed_contract_evidence();


create or replace function public.gridex_lock_signed_customer_contract()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if old.status in ('signed','active','terminated','cancelled','expired') or old.signed_at is not null or old.locked_at is not null then
    if new.company_id is distinct from old.company_id
       or new.customer_id is distinct from old.customer_id
       or new.contract_product_id is distinct from old.contract_product_id
       or new.contract_product_version_id is distinct from old.contract_product_version_id
       or new.contract_publication_version_id is distinct from old.contract_publication_version_id
       or new.legal_bundle_version_id is distinct from old.legal_bundle_version_id
       or new.offer_reference is distinct from old.offer_reference
       or new.commercial_snapshot is distinct from old.commercial_snapshot
       or new.legal_snapshot is distinct from old.legal_snapshot
       or new.signature_snapshot is distinct from old.signature_snapshot
       or new.signature_snapshot_sha256 is distinct from old.signature_snapshot_sha256
       or (old.document_sha256 is not null and new.document_sha256 is distinct from old.document_sha256)
       or new.signed_at is distinct from old.signed_at then
      raise exception using errcode='55000',message='signed_customer_contract_immutable';
    end if;
    new.locked_at:=coalesce(old.locked_at,old.signed_at,now());
  elsif new.signed_at is not null or new.status in ('signed','active') then
    new.locked_at:=coalesce(new.locked_at,new.signed_at,now());
  end if;
  return new;
end $$;

create or replace view public.canonical_public_contract_offers_v as
select
  pco.*,
  cpv.id as contract_publication_version_id,
  cpv.contract_product_version_id,
  pv.contract_product_id,
  cpv.legal_bundle_version_id,
  cpv.offer_reference as canonical_offer_reference,
  cpv.locked_at as publication_locked_at,
  cpv.content_sha256 as publication_content_sha256,
  (coalesce(pco.metadata,'{}'::jsonb) || jsonb_build_object(
    'contract_publication_version_id',cpv.id,
    'contract_product_version_id',cpv.contract_product_version_id,
    'contract_product_id',pv.contract_product_id,
    'legal_bundle_version_id',cpv.legal_bundle_version_id,
    'canonical_offer_reference',cpv.offer_reference,
    'publication_content_sha256',cpv.content_sha256,
    'source_of_truth','contract_publication_versions'
  )) as canonical_metadata
from public.public_contract_offers pco
join lateral (
  select x.* from public.contract_publication_versions x
  where x.legacy_public_contract_offer_id=pco.id and x.status='published' and x.locked_at is not null
  order by x.version_number desc limit 1
) cpv on true
join public.contract_product_versions pv on pv.id=cpv.contract_product_version_id;

alter table public.legal_requirement_rules enable row level security;
do $$ begin
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='legal_requirement_rules' and policyname='legal_requirement_rules_read') then
    create policy legal_requirement_rules_read on public.legal_requirement_rules for select using (public.gridex_user_is_platform_admin() or auth.role()='service_role');
  end if;
end $$;

grant select on public.contract_publication_readiness_v,public.canonical_public_contract_offers_v to authenticated,service_role;
grant execute on function public.gridex_required_legal_modules(text,text,text,boolean,boolean) to authenticated,service_role;
grant execute on function public.gridex_publish_contract_publication_version(uuid,uuid) to service_role;

commit;
