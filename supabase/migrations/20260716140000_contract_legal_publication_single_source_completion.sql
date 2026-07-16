-- Gridex canonical contract/legal/publication single-source completion.
-- Keeps legacy offer tables as compatibility inputs, while all publication decisions,
-- immutable legal/pricing snapshots and readiness are resolved in one DB transaction.

begin;
create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Strict tenant legal profile, backfill and company-change review tracking
-- -----------------------------------------------------------------------------
alter table public.tenant_legal_profiles
  add column if not exists missing_fields text[] not null default '{}',
  add column if not exists review_required boolean not null default false,
  add column if not exists source_company_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists source_company_snapshot_sha256 text,
  add column if not exists source_company_updated_at timestamptz;

create or replace function public.gridex_jsonb_nonblank(p_value jsonb, p_keys text[] default array['text'])
returns boolean
language plpgsql
immutable
set search_path=public,pg_temp
as $$
declare v_key text; v_text text;
begin
  if p_value is null or p_value='{}'::jsonb or p_value='null'::jsonb then return false; end if;
  if jsonb_typeof(p_value)='string' then return nullif(btrim(p_value#>>'{}'),'') is not null; end if;
  foreach v_key in array coalesce(p_keys,'{}') loop
    v_text:=nullif(btrim(coalesce(p_value->>v_key,'')),'');
    if v_text is not null then return true; end if;
  end loop;
  return false;
end $$;

create or replace function public.gridex_tenant_legal_profile_missing_fields(p_profile public.tenant_legal_profiles)
returns text[]
language plpgsql
immutable
set search_path=public,pg_temp
as $$
declare v_missing text[]:='{}';
begin
  if nullif(btrim(coalesce(p_profile.legal_name,'')),'') is null then v_missing:=array_append(v_missing,'legal_name'); end if;
  if nullif(btrim(coalesce(p_profile.organization_number,'')),'') is null then v_missing:=array_append(v_missing,'organization_number'); end if;
  if not public.gridex_jsonb_nonblank(p_profile.postal_address,array['text','street','address','city','postal_code']) then v_missing:=array_append(v_missing,'postal_address'); end if;
  if nullif(btrim(coalesce(p_profile.customer_service_email,'')),'') is null
     or p_profile.customer_service_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    then v_missing:=array_append(v_missing,'customer_service_email'); end if;
  if length(regexp_replace(coalesce(p_profile.phone,''),'[^0-9]','','g'))<7 then v_missing:=array_append(v_missing,'phone'); end if;
  if nullif(btrim(coalesce(p_profile.website,'')),'') is null then v_missing:=array_append(v_missing,'website'); end if;
  if not public.gridex_jsonb_nonblank(p_profile.complaints_contact,array['text','email','address']) then v_missing:=array_append(v_missing,'complaints_contact'); end if;
  if not public.gridex_jsonb_nonblank(p_profile.data_protection_contact,array['text','email','address']) then v_missing:=array_append(v_missing,'data_protection_contact'); end if;
  if not public.gridex_jsonb_nonblank(p_profile.billing_information,array['text','email','address','bankgiro']) then v_missing:=array_append(v_missing,'billing_information'); end if;
  if not public.gridex_jsonb_nonblank(p_profile.dispute_resolution_information,array['text','url','authority']) then v_missing:=array_append(v_missing,'dispute_resolution_information'); end if;
  return v_missing;
end $$;

create or replace function public.gridex_refresh_legal_profile_completeness()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  new.missing_fields:=public.gridex_tenant_legal_profile_missing_fields(new);
  new.completeness_status:=case
    when coalesce(array_length(new.missing_fields,1),0)>0 then 'incomplete'
    when new.verified_at is not null and not new.review_required then 'verified'
    else 'complete'
  end;
  new.updated_at:=now();
  return new;
end $$;

drop trigger if exists tenant_legal_profiles_completeness on public.tenant_legal_profiles;
create trigger tenant_legal_profiles_completeness
before insert or update on public.tenant_legal_profiles
for each row execute function public.gridex_refresh_legal_profile_completeness();

-- Backfill only known company values. Unknown legal facts are never fabricated.
with company_source as (
  select c.id, to_jsonb(c) j
  from public.companies c
), normalized as (
  select
    id,
    coalesce(nullif(j->>'legal_name',''),nullif(j->>'name','')) legal_name,
    coalesce(nullif(j->>'organization_number',''),nullif(j->>'org_number','')) organization_number,
    coalesce(nullif(j->>'support_email',''),nullif(j->>'primary_contact_email',''),nullif(j->>'email','')) service_email,
    coalesce(nullif(j->>'phone',''),nullif(j->>'primary_contact_phone','')) phone,
    nullif(j->>'website','') website,
    concat_ws(', ',nullif(j->>'address',''),nullif(j->>'postal_code',''),nullif(j->>'city','')) postal_text,
    jsonb_strip_nulls(jsonb_build_object(
      'name',coalesce(nullif(j->>'legal_name',''),nullif(j->>'name','')),
      'organization_number',coalesce(nullif(j->>'organization_number',''),nullif(j->>'org_number','')),
      'address',nullif(j->>'address',''),'postal_code',nullif(j->>'postal_code',''),'city',nullif(j->>'city',''),
      'support_email',coalesce(nullif(j->>'support_email',''),nullif(j->>'primary_contact_email',''),nullif(j->>'email','')),
      'phone',coalesce(nullif(j->>'phone',''),nullif(j->>'primary_contact_phone','')),
      'website',nullif(j->>'website','')
    )) source_snapshot
  from company_source
)
insert into public.tenant_legal_profiles(
  company_id,legal_name,organization_number,postal_address,customer_service_address,
  customer_service_email,phone,website,complaints_contact,source_company_snapshot,
  source_company_snapshot_sha256,source_company_updated_at
)
select
  n.id,n.legal_name,n.organization_number,
  case when nullif(btrim(n.postal_text),'') is null then '{}'::jsonb else jsonb_build_object('text',n.postal_text) end,
  case when nullif(btrim(n.postal_text),'') is null then '{}'::jsonb else jsonb_build_object('text',n.postal_text) end,
  n.service_email,n.phone,n.website,
  case when n.service_email is null then '{}'::jsonb else jsonb_build_object('email',n.service_email,'text',n.service_email) end,
  n.source_snapshot,encode(digest(n.source_snapshot::text,'sha256'),'hex'),now()
from normalized n
on conflict(company_id) do update set
  legal_name=coalesce(nullif(public.tenant_legal_profiles.legal_name,''),excluded.legal_name),
  organization_number=coalesce(nullif(public.tenant_legal_profiles.organization_number,''),excluded.organization_number),
  postal_address=case when public.tenant_legal_profiles.postal_address='{}'::jsonb then excluded.postal_address else public.tenant_legal_profiles.postal_address end,
  customer_service_address=case when public.tenant_legal_profiles.customer_service_address='{}'::jsonb then excluded.customer_service_address else public.tenant_legal_profiles.customer_service_address end,
  customer_service_email=coalesce(nullif(public.tenant_legal_profiles.customer_service_email,''),excluded.customer_service_email),
  phone=coalesce(nullif(public.tenant_legal_profiles.phone,''),excluded.phone),
  website=coalesce(nullif(public.tenant_legal_profiles.website,''),excluded.website),
  complaints_contact=case when public.tenant_legal_profiles.complaints_contact='{}'::jsonb then excluded.complaints_contact else public.tenant_legal_profiles.complaints_contact end,
  source_company_snapshot=excluded.source_company_snapshot,
  source_company_snapshot_sha256=excluded.source_company_snapshot_sha256,
  source_company_updated_at=now();

create or replace function public.gridex_sync_company_legal_profile_review()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  j jsonb:=to_jsonb(new); v_snapshot jsonb; v_hash text;
  v_name text; v_org text; v_email text; v_phone text; v_website text; v_postal text;
begin
  v_name:=coalesce(nullif(j->>'legal_name',''),nullif(j->>'name',''));
  v_org:=coalesce(nullif(j->>'organization_number',''),nullif(j->>'org_number',''));
  v_email:=coalesce(nullif(j->>'support_email',''),nullif(j->>'primary_contact_email',''),nullif(j->>'email',''));
  v_phone:=coalesce(nullif(j->>'phone',''),nullif(j->>'primary_contact_phone',''));
  v_website:=nullif(j->>'website','');
  v_postal:=concat_ws(', ',nullif(j->>'address',''),nullif(j->>'postal_code',''),nullif(j->>'city',''));
  v_snapshot:=jsonb_strip_nulls(jsonb_build_object('name',v_name,'organization_number',v_org,'address',nullif(j->>'address',''),'postal_code',nullif(j->>'postal_code',''),'city',nullif(j->>'city',''),'support_email',v_email,'phone',v_phone,'website',v_website));
  v_hash:=encode(digest(v_snapshot::text,'sha256'),'hex');
  insert into public.tenant_legal_profiles(company_id,legal_name,organization_number,postal_address,customer_service_address,customer_service_email,phone,website,complaints_contact,source_company_snapshot,source_company_snapshot_sha256,source_company_updated_at,review_required)
  values(new.id,v_name,v_org,case when nullif(btrim(v_postal),'') is null then '{}'::jsonb else jsonb_build_object('text',v_postal) end,case when nullif(btrim(v_postal),'') is null then '{}'::jsonb else jsonb_build_object('text',v_postal) end,v_email,v_phone,v_website,case when v_email is null then '{}'::jsonb else jsonb_build_object('email',v_email,'text',v_email) end,v_snapshot,v_hash,now(),false)
  on conflict(company_id) do update set
    legal_name=coalesce(nullif(public.tenant_legal_profiles.legal_name,''),excluded.legal_name),
    organization_number=coalesce(nullif(public.tenant_legal_profiles.organization_number,''),excluded.organization_number),
    postal_address=case when public.tenant_legal_profiles.postal_address='{}'::jsonb then excluded.postal_address else public.tenant_legal_profiles.postal_address end,
    customer_service_address=case when public.tenant_legal_profiles.customer_service_address='{}'::jsonb then excluded.customer_service_address else public.tenant_legal_profiles.customer_service_address end,
    customer_service_email=coalesce(nullif(public.tenant_legal_profiles.customer_service_email,''),excluded.customer_service_email),
    phone=coalesce(nullif(public.tenant_legal_profiles.phone,''),excluded.phone),
    website=coalesce(nullif(public.tenant_legal_profiles.website,''),excluded.website),
    complaints_contact=case when public.tenant_legal_profiles.complaints_contact='{}'::jsonb then excluded.complaints_contact else public.tenant_legal_profiles.complaints_contact end,
    review_required=public.tenant_legal_profiles.review_required or (public.tenant_legal_profiles.source_company_snapshot_sha256 is distinct from excluded.source_company_snapshot_sha256),
    verified_at=case when public.tenant_legal_profiles.source_company_snapshot_sha256 is distinct from excluded.source_company_snapshot_sha256 then null else public.tenant_legal_profiles.verified_at end,
    verified_by=case when public.tenant_legal_profiles.source_company_snapshot_sha256 is distinct from excluded.source_company_snapshot_sha256 then null else public.tenant_legal_profiles.verified_by end,
    source_company_snapshot=excluded.source_company_snapshot,
    source_company_snapshot_sha256=excluded.source_company_snapshot_sha256,
    source_company_updated_at=now();
  return new;
end $$;

drop trigger if exists companies_sync_legal_profile_review on public.companies;
create trigger companies_sync_legal_profile_review
after insert or update on public.companies
for each row execute function public.gridex_sync_company_legal_profile_review();

-- Re-run trigger calculation after added strict fields/backfill.
update public.tenant_legal_profiles set updated_at=updated_at;

-- -----------------------------------------------------------------------------
-- Dynamic legal requirement rules (private/business + contract model + options)
-- -----------------------------------------------------------------------------
insert into public.legal_templates(module_key,name,description,mandatory,status)
values
 ('quarterly_price_terms','Särskilda villkor för kvartspris','Mätvärden och spotpris per kvart samt datakvalitet.',false,'active'),
 ('production_terms','Villkor för mikroproduktion','Ersättning, avräkning, moms, mätvärden och negativa priser.',false,'active'),
 ('authorized_signatory','Behörig firmatecknare','Behörighet att ingå företagsavtal.',false,'active'),
 ('credit_and_late_payment','Kredit-, dröjsmåls- och avstängningsvillkor','Betalningsrisk och åtgärder vid dröjsmål.',false,'active'),
 ('liability_limitation','Ansvar och ansvarsbegränsning','Ansvarsregler för företagsavtal.',false,'active'),
 ('distance_contract_information','Information om distansavtal','Förköpsinformation för distansavtal.',false,'active'),
 ('agreement_confirmation','Avtalsbekräftelse','Hur och när kunden får avtalsbekräftelse.',true,'active'),
 ('terms_change_notice','Ändring av villkor','Regler för villkorsändringar och informationstidpunkt.',true,'active')
on conflict(module_key) do update set name=excluded.name,description=excluded.description,status='active';

insert into public.legal_requirement_rules(customer_type,contract_type,channel,condition_json,required_module_keys,priority,status)
values
 ('private','variable_quarterly','all','{}',array['general_consumer_terms','quarterly_price_terms','price_terms','pre_contract_information','distance_contract_information','withdrawal_right','withdrawal_form','privacy_policy','power_of_attorney','supplier_switch_terms','billing_terms','complaints_and_disputes','company_information','agreement_confirmation','terms_change_notice'],10,'active'),
 ('business','variable_quarterly','all','{}',array['general_business_terms','quarterly_price_terms','price_terms','power_of_attorney','billing_terms','termination_and_breach','privacy_policy','complaints_and_disputes','company_information','authorized_signatory','credit_and_late_payment','liability_limitation','agreement_confirmation','terms_change_notice'],10,'active'),
 ('business','portfolio','all','{}',array['general_business_terms','portfolio_terms','price_terms','volume_forecast_responsibility','power_of_attorney','billing_terms','termination_and_breach','privacy_policy','complaints_and_disputes','company_information','authorized_signatory','credit_and_late_payment','liability_limitation','agreement_confirmation','terms_change_notice'],10,'active'),
 ('business','mixed','all','{}',array['general_business_terms','mixed_price_terms','price_terms','power_of_attorney','billing_terms','termination_and_breach','privacy_policy','complaints_and_disputes','company_information','authorized_signatory','credit_and_late_payment','liability_limitation','agreement_confirmation','terms_change_notice'],10,'active')
on conflict(customer_type,contract_type,channel,priority) do update set required_module_keys=excluded.required_module_keys,condition_json=excluded.condition_json,status='active',updated_at=now();

-- Extend every existing active rule without replacing contract-specific modules.
update public.legal_requirement_rules r
set required_module_keys=(
  select array_agg(distinct module_key order by module_key)
  from unnest(
    coalesce(r.required_module_keys,'{}') ||
    array['agreement_confirmation','terms_change_notice'] ||
    case when r.customer_type='private' then array['distance_contract_information'] else '{}'::text[] end ||
    case when r.customer_type='business' then array['authorized_signatory','credit_and_late_payment','liability_limitation'] else '{}'::text[] end
  ) module_key
), updated_at=now()
where r.status='active';

create or replace function public.gridex_required_legal_modules(
  p_customer_type text,p_contract_type text,p_channel text,
  p_automatic_renewal boolean,p_requires_power_of_attorney boolean,p_production_enabled boolean
) returns text[]
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  v_customer text:=coalesce(nullif(btrim(p_customer_type),''),'private');
  v_contract text:=case coalesce(nullif(btrim(p_contract_type),''),'variable_monthly')
    when 'spot' then 'variable_monthly' when 'variable' then 'variable_monthly'
    when 'variable_spot' then 'variable_monthly' when 'hourly_spot' then 'variable_hourly'
    else coalesce(nullif(btrim(p_contract_type),''),'variable_monthly') end;
  v_channel text:=coalesce(nullif(btrim(p_channel),''),'website');
  v_modules text[]:='{}';
begin
  select coalesce(array_agg(distinct m order by m),'{}') into v_modules
  from public.legal_requirement_rules r cross join lateral unnest(r.required_module_keys) m
  where r.status='active'
    and ((v_customer='both' and r.customer_type in ('private','business','both')) or (v_customer<>'both' and r.customer_type in (v_customer,'both')))
    and r.contract_type=v_contract and r.channel in(v_channel,'all');
  if coalesce(array_length(v_modules,1),0)=0 then
    raise exception using errcode='23514',message='legal_requirement_rule_missing:'||v_customer||':'||v_contract||':'||v_channel;
  end if;
  if p_automatic_renewal then v_modules:=array_append(v_modules,'automatic_renewal'); end if;
  if not p_requires_power_of_attorney then v_modules:=array_remove(v_modules,'power_of_attorney'); end if;
  if p_production_enabled then v_modules:=array_append(v_modules,'production_terms'); end if;
  select array_agg(distinct x order by x) into v_modules from unnest(v_modules) x;
  return coalesce(v_modules,'{}');
end $$;

create or replace function public.gridex_required_legal_modules(
  p_customer_type text,p_contract_type text,p_channel text default 'website',
  p_automatic_renewal boolean default false,p_requires_power_of_attorney boolean default true
) returns text[]
language sql
stable
security definer
set search_path=public,pg_temp
as $$ select public.gridex_required_legal_modules($1,$2,$3,$4,$5,false) $$;

create or replace function public.gridex_set_contract_version_legal_modules()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare v_required text[]; v_production boolean:=false;
begin
  v_production:=coalesce((new.commercial_snapshot#>>'{pricing_snapshot,production,enabled}')::boolean,false)
    or coalesce((new.commercial_snapshot#>>'{production,enabled}')::boolean,false)
    or coalesce((new.commercial_snapshot#>>'{pricing_snapshot,production_enabled}')::boolean,false)
    or coalesce((new.commercial_snapshot->>'production_enabled')::boolean,false);
  v_required:=public.gridex_required_legal_modules(new.customer_type,new.contract_type,'website',coalesce(new.automatic_renewal,false),coalesce(new.power_of_attorney_required,true),v_production);
  select coalesce(array_agg(distinct m order by m),'{}') into new.required_legal_modules
  from unnest(coalesce(new.required_legal_modules,'{}')||v_required) m;
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- Immutable legal snapshot rendering and provenance
-- -----------------------------------------------------------------------------
alter table public.legal_bundle_versions
  add column if not exists tenant_legal_profile_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists tenant_legal_profile_sha256 text;
alter table public.legal_bundle_version_documents
  add column if not exists origin text not null default 'legacy_tenant_document',
  add column if not exists template_key text,
  add column if not exists template_version text,
  add column if not exists tenant_customized boolean not null default false,
  add column if not exists unresolved_variables text[] not null default '{}';

create or replace function public.gridex_render_legal_document(p_body text,p_profile jsonb,p_company jsonb)
returns text
language plpgsql
immutable
set search_path=public,pg_temp
as $$
declare v text:=coalesce(p_body,'');
begin
  v:=replace(v,'{{company_name}}',coalesce(p_profile->>'legal_name',p_company->>'name',''));
  v:=replace(v,'{{legal_name}}',coalesce(p_profile->>'legal_name',p_company->>'name',''));
  v:=replace(v,'{{brand_name}}',coalesce(p_company#>>'{branding,brand_name}',p_company#>>'{branding,display_name}',p_company->>'name',''));
  v:=replace(v,'{{organization_number}}',coalesce(p_profile->>'organization_number',''));
  v:=replace(v,'{{company_address}}',coalesce(p_profile#>>'{postal_address,text}',p_profile#>>'{postal_address,address}',''));
  v:=replace(v,'{{customer_service_email}}',coalesce(p_profile->>'customer_service_email',''));
  v:=replace(v,'{{phone}}',coalesce(p_profile->>'phone',''));
  v:=replace(v,'{{website}}',coalesce(p_profile->>'website',''));
  v:=replace(v,'{{complaints_email}}',coalesce(p_profile#>>'{complaints_contact,email}',p_profile#>>'{complaints_contact,text}',''));
  v:=replace(v,'{{data_protection_email}}',coalesce(p_profile#>>'{data_protection_contact,email}',p_profile#>>'{data_protection_contact,text}',''));
  v:=replace(v,'{{billing_information}}',coalesce(p_profile#>>'{billing_information,text}',''));
  v:=replace(v,'{{dispute_resolution_information}}',coalesce(p_profile#>>'{dispute_resolution_information,text}',''));
  return v;
end $$;

create or replace function public.gridex_materialize_legal_bundle_version(
  p_company_id uuid,p_contract_product_version_id uuid,p_legacy_legal_bundle_id uuid,p_actor_user_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_required text[]; v_module text; v_legacy_type text; v_text record; v_profile record; v_company jsonb;
  v_profile_snapshot jsonb; v_profile_hash text; v_rendered text; v_doc_unresolved text[];
  v_bundle_id uuid; v_number integer; v_hash text; v_docs jsonb:='[]'::jsonb; v_unresolved text[]:='{}';
begin
  select required_legal_modules into v_required from public.contract_product_versions where id=p_contract_product_version_id;
  if not found then raise exception 'contract_product_version_not_found'; end if;
  select * into v_profile from public.tenant_legal_profiles where company_id=p_company_id;
  if not found then raise exception 'tenant_legal_profile_missing'; end if;
  select to_jsonb(c) into v_company from public.companies c where c.id=p_company_id;
  v_profile_snapshot:=to_jsonb(v_profile)-'verified_by';
  v_profile_hash:=encode(digest(v_profile_snapshot::text,'sha256'),'hex');
  if p_legacy_legal_bundle_id is null then
    if exists(
      select 1 from public.contract_product_versions
      where id=p_contract_product_version_id and status='draft' and locked_at is null
    ) then
      return null;
    end if;
    raise exception 'Juridiskt paket saknas.';
  end if;
  if not exists(select 1 from public.legal_bundles where id=p_legacy_legal_bundle_id and company_id=p_company_id and status in('published','active')) then
    raise exception 'Juridiskt paket är inte publicerat för bolaget.';
  end if;

  foreach v_module in array coalesce(v_required,'{}') loop
    v_legacy_type:=public.gridex_legacy_legal_type_for_module(v_module);
    select ltv.* into v_text from public.legal_bundle_items lbi join public.legal_text_versions ltv on ltv.id=lbi.legal_text_version_id
    where lbi.legal_bundle_id=p_legacy_legal_bundle_id and lbi.type=v_legacy_type and ltv.company_id=p_company_id and ltv.status='published'
    order by lbi.sort_order,ltv.published_at desc limit 1;
    if not found then
      v_unresolved:=array_append(v_unresolved,'missing_document:'||v_module);
    else
      v_rendered:=public.gridex_render_legal_document(v_text.body,v_profile_snapshot,v_company);
      select coalesce(array_agg(distinct match_value[1] order by match_value[1]),'{}') into v_doc_unresolved
      from regexp_matches(v_rendered,'\{\{[[:space:]]*([a-zA-Z0-9_.-]+)[[:space:]]*\}\}','g') as matches(match_value);
      if coalesce(array_length(v_doc_unresolved,1),0)>0 then
        v_unresolved:=v_unresolved||array(select 'unresolved_placeholder:'||v_module||':'||x from unnest(v_doc_unresolved) x);
      end if;
      v_docs:=v_docs||jsonb_build_array(jsonb_build_object('module_key',v_module,'legacy_id',v_text.id,'legacy_type',v_legacy_type,'title',v_text.title,'origin',coalesce(v_text.metadata->>'origin','legacy_tenant_document'),'template_key',coalesce(v_text.metadata->>'template_key',v_legacy_type),'template_version',coalesce(v_text.metadata->>'template_version',v_text.version),'tenant_customized',case lower(coalesce(v_text.metadata->>'tenant_customized','false')) when 'true' then true else false end,'rendered_sha256',encode(digest(v_rendered,'sha256'),'hex')));
    end if;
  end loop;
  select coalesce(array_agg(distinct x order by x),'{}') into v_unresolved from unnest(v_unresolved) x;
  v_hash:=encode(digest(jsonb_build_object('company_id',p_company_id,'contract_product_version_id',p_contract_product_version_id,'legacy_bundle_id',p_legacy_legal_bundle_id,'profile_sha256',v_profile_hash,'documents',v_docs)::text,'sha256'),'hex');
  select id into v_bundle_id from public.legal_bundle_versions where company_id=p_company_id and contract_product_version_id=p_contract_product_version_id and content_sha256=v_hash limit 1;
  if v_bundle_id is not null then return v_bundle_id; end if;

  select coalesce(max(version_number),0)+1 into v_number from public.legal_bundle_versions where company_id=p_company_id and contract_product_version_id=p_contract_product_version_id;
  insert into public.legal_bundle_versions(company_id,contract_product_version_id,legacy_legal_bundle_id,version_number,legal_mode,rendered_snapshot,unresolved_variables,content_sha256,status,created_by,tenant_legal_profile_snapshot,tenant_legal_profile_sha256)
  values(p_company_id,p_contract_product_version_id,p_legacy_legal_bundle_id,v_number,'ops_standard',jsonb_build_object('schema','gridex_legal_bundle_v4','required_modules',v_required,'tenant_legal_profile',v_profile_snapshot,'tenant_legal_profile_sha256',v_profile_hash,'documents',v_docs),v_unresolved,v_hash,'draft',p_actor_user_id,v_profile_snapshot,v_profile_hash)
  returning id into v_bundle_id;

  foreach v_module in array coalesce(v_required,'{}') loop
    v_legacy_type:=public.gridex_legacy_legal_type_for_module(v_module);
    select ltv.* into v_text from public.legal_bundle_items lbi join public.legal_text_versions ltv on ltv.id=lbi.legal_text_version_id
    where lbi.legal_bundle_id=p_legacy_legal_bundle_id and lbi.type=v_legacy_type and ltv.company_id=p_company_id and ltv.status='published'
    order by lbi.sort_order,ltv.published_at desc limit 1;
    if found then
      v_rendered:=public.gridex_render_legal_document(v_text.body,v_profile_snapshot,v_company);
      select coalesce(array_agg(distinct match_value[1] order by match_value[1]),'{}') into v_doc_unresolved
      from regexp_matches(v_rendered,'\{\{[[:space:]]*([a-zA-Z0-9_.-]+)[[:space:]]*\}\}','g') as matches(match_value);
      insert into public.legal_bundle_version_documents(legal_bundle_version_id,module_key,legacy_legal_text_version_id,title,rendered_body,content_sha256,sort_order,origin,template_key,template_version,tenant_customized,unresolved_variables)
      values(v_bundle_id,v_module,v_text.id,v_text.title,v_rendered,encode(digest(v_rendered,'sha256'),'hex'),coalesce(array_position(v_required,v_module),100)*10,coalesce(v_text.metadata->>'origin','legacy_tenant_document'),coalesce(v_text.metadata->>'template_key',v_legacy_type),coalesce(v_text.metadata->>'template_version',v_text.version),case lower(coalesce(v_text.metadata->>'tenant_customized','false')) when 'true' then true else false end,v_doc_unresolved);
    end if;
  end loop;
  return v_bundle_id;
end $$;

-- -----------------------------------------------------------------------------
-- Canonical readiness: ready / blocked / unknown + display / acceptance split
-- -----------------------------------------------------------------------------
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
          where pmp.company_id=b.company_id and pmp.status='locked' and pmp.locked_at is not null
            and pmp.superseded_at is null and pmp.price_area=required_area
            and pmp.billing_month=to_char(coalesce(b.valid_from,now()) at time zone 'Europe/Stockholm','YYYY-MM')
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

create or replace view public.gridex_tenant_contract_readiness_v as
with publications as (
  select
    r.company_id,
    count(*) as total_publication_versions,
    count(*) filter(where r.status='published') as published_publication_versions,
    count(*) filter(where r.status='published' and r.can_display) as display_ready_publications,
    count(*) filter(where r.status='published' and r.can_accept_applications) as application_ready_publications,
    coalesce(array_agg(distinct blocker.code) filter(where blocker.code is not null),'{}') as publication_blockers
  from public.contract_publication_readiness_v r
  left join lateral unnest(r.application_blockers) as blocker(code) on true
  group by r.company_id
)
select
  c.id as company_id,
  c.name as company_name,
  case when tlp.id is null then 'unknown'
       when tlp.completeness_status in('complete','verified') and not coalesce(tlp.review_required,false) then 'ready'
       else 'blocked' end as legal_profile_status,
  coalesce(tlp.missing_fields,array['tenant_legal_profile']) as legal_profile_missing_fields,
  coalesce(tlp.review_required,false) as legal_profile_review_required,
  tlp.verified_at as legal_profile_verified_at,
  tlp.updated_at as legal_profile_updated_at,
  coalesce(p.total_publication_versions,0) as total_publication_versions,
  coalesce(p.published_publication_versions,0) as published_publication_versions,
  coalesce(p.display_ready_publications,0)>0 as can_display,
  coalesce(p.application_ready_publications,0)>0 as can_accept_applications,
  coalesce(p.publication_blockers,'{}') as publication_blockers,
  case when tlp.id is null then 'unknown'
       when tlp.completeness_status not in('complete','verified') or coalesce(tlp.review_required,false) then 'blocked'
       when coalesce(p.published_publication_versions,0)=0 then 'ready'
       when coalesce(p.display_ready_publications,0)>0 then 'ready'
       else 'blocked' end as overall_status,
  coalesce(p.published_publication_versions,0)=0 as no_published_contracts,
  now() as evaluated_at
from public.companies c
left join public.tenant_legal_profiles tlp on tlp.company_id=c.id
left join publications p on p.company_id=c.id;

-- -----------------------------------------------------------------------------
-- Resolve the compatibility source bundle inside the publication transaction.
-- The source bundle is not a second legal truth: it is only the render input for
-- the immutable legal_bundle_version created for this exact contract version.
-- -----------------------------------------------------------------------------
create or replace function public.gridex_resolve_or_create_legal_source_bundle(
  p_company_id uuid,p_payload jsonb,p_pricing_snapshot jsonb,p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_required_modules text[]; v_required_sources text[]; v_missing_sources text[];
  v_source text; v_text_version_id uuid; v_bundle_id uuid; v_created boolean:=false;
  v_requested_bundle_id uuid; v_public_name text;
  v_production_enabled boolean:=false;
begin
  if p_company_id is null then raise exception 'company_id_required'; end if;
  v_public_name:=coalesce(nullif(btrim(p_payload->>'public_name'),''),'Avtal');
  v_production_enabled:=lower(coalesce(p_pricing_snapshot#>>'{production,enabled}','false'))='true';
  v_required_modules:=public.gridex_required_legal_modules(
    coalesce(nullif(p_payload->>'customer_type',''),'private'),
    coalesce(nullif(p_payload->>'contract_type',''),'variable_monthly'),
    'website',
    lower(coalesce(p_payload->>'automatic_renewal','false'))='true',
    lower(coalesce(p_payload->>'power_of_attorney_required','true'))='true',
    v_production_enabled
  );
  select coalesce(array_agg(distinct public.gridex_legacy_legal_type_for_module(m) order by public.gridex_legacy_legal_type_for_module(m)),'{}')
  into v_required_sources from unnest(v_required_modules) m;

  v_requested_bundle_id:=nullif(p_payload->>'legal_bundle_id','')::uuid;
  if v_requested_bundle_id is not null then
    if not exists(
      select 1 from public.legal_bundles b
      where b.id=v_requested_bundle_id and b.company_id=p_company_id and b.status in('published','active')
    ) then
      raise exception using errcode='23514',message='legal_source_bundle_invalid:not_published_or_wrong_tenant';
    end if;
    select coalesce(array_agg(source order by source),'{}') into v_missing_sources
    from unnest(v_required_sources) source
    where not exists(
      select 1
      from public.legal_bundle_items i
      join public.legal_text_versions t on t.id=i.legal_text_version_id
      where i.legal_bundle_id=v_requested_bundle_id
        and i.type=source and t.company_id=p_company_id and t.status='published'
    );
    if coalesce(array_length(v_missing_sources,1),0)>0 then
      raise exception using errcode='23514',message='legal_source_bundle_invalid:missing_sources:'||array_to_string(v_missing_sources,',');
    end if;
    return jsonb_build_object(
      'legal_bundle_id',v_requested_bundle_id,'created',false,
      'required_modules',v_required_modules,'required_source_types',v_required_sources
    );
  end if;

  select b.id into v_bundle_id
  from public.legal_bundles b
  where b.company_id=p_company_id and b.status in('published','active')
    and not exists(
      select 1 from unnest(v_required_sources) source
      where not exists(
        select 1
        from public.legal_bundle_items i
        join public.legal_text_versions t on t.id=i.legal_text_version_id
        where i.legal_bundle_id=b.id and i.type=source
          and t.company_id=p_company_id and t.status='published'
      )
    )
  order by b.updated_at desc,b.created_at desc
  limit 1;

  if v_bundle_id is null then
    select coalesce(array_agg(source order by source),'{}') into v_missing_sources
    from unnest(v_required_sources) source
    where not exists(
      select 1 from public.legal_text_versions t
      where t.company_id=p_company_id and t.type=source and t.status='published'
    );
    if coalesce(array_length(v_missing_sources,1),0)>0 then
      raise exception using errcode='23514',message='legal_source_document_missing:'||array_to_string(v_missing_sources,',');
    end if;

    insert into public.legal_bundles(company_id,name,status)
    values(p_company_id,left('Dynamiskt juridikpaket · '||v_public_name,180),'published')
    returning id into v_bundle_id;

    foreach v_source in array v_required_sources loop
      select t.id into v_text_version_id
      from public.legal_text_versions t
      where t.company_id=p_company_id and t.type=v_source and t.status='published'
      order by t.published_at desc nulls last,t.created_at desc,t.id desc
      limit 1;
      insert into public.legal_bundle_items(legal_bundle_id,legal_text_version_id,type,sort_order)
      values(v_bundle_id,v_text_version_id,v_source,coalesce(array_position(v_required_sources,v_source),100)*10);
    end loop;
    v_created:=true;
  end if;

  return jsonb_build_object(
    'legal_bundle_id',v_bundle_id,'created',v_created,
    'required_modules',v_required_modules,'required_source_types',v_required_sources,
    'actor_user_id',p_actor_user_id
  );
end $$;

-- -----------------------------------------------------------------------------
-- One public entry point. The inner exception block is a DB subtransaction: any
-- failed source-bundle/pricing/legal/product/publication write is rolled back
-- before a structured blocker response is returned.
-- -----------------------------------------------------------------------------
create or replace function public.gridex_publish_contract_version(
  p_company_id uuid,p_draft_contract_id uuid,p_offer_code text,p_payload jsonb,p_pricing_snapshot jsonb,p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_result jsonb; v_publication_id uuid; v_readiness jsonb; v_message text; v_codes text[];
  v_payload jsonb:=coalesce(p_payload,'{}'::jsonb); v_bundle_result jsonb:='{}'::jsonb;
  v_publish boolean; v_correlation_id text; v_audit_metadata jsonb;
  v_profile_status text; v_profile_missing_fields text[]; v_profile_review_required boolean;
  v_error_code text; v_user_message text;
begin
  begin
    if p_company_id is null or p_actor_user_id is null then raise exception 'company_and_actor_required'; end if;
    v_publish:=coalesce(v_payload->>'publication_status','draft')='published';
    v_correlation_id:=coalesce(nullif(v_payload#>>'{metadata,correlation_id}',''),gen_random_uuid()::text);
    if v_publish then
      select completeness_status,missing_fields,coalesce(review_required,false)
      into v_profile_status,v_profile_missing_fields,v_profile_review_required
      from public.tenant_legal_profiles where company_id=p_company_id;
      if not found then
        raise exception using errcode='23514',message='publication_not_ready:tenant_legal_profile_missing';
      end if;
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
      v_payload,'{metadata}',
      coalesce(v_payload->'metadata','{}'::jsonb)||jsonb_build_object(
        'correlation_id',v_correlation_id,
        'publication_command','gridex_publish_contract_version',
        'publication_command_version','2026-07-16'
      ),true
    );

    if v_publish then
      v_bundle_result:=public.gridex_resolve_or_create_legal_source_bundle(
        p_company_id,v_payload,coalesce(p_pricing_snapshot,'{}'::jsonb),p_actor_user_id
      );
      v_payload:=jsonb_set(v_payload,'{legal_bundle_id}',to_jsonb(v_bundle_result->>'legal_bundle_id'),true);
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

    v_audit_metadata:=jsonb_strip_nulls(jsonb_build_object(
      'correlation_id',v_correlation_id,
      'offer_reference',v_result->>'offer_reference',
      'contract_publication_version_id',v_publication_id,
      'price_plan_id',v_result#>>'{pricing,price_plan_id}',
      'price_plan_version_id',v_result#>>'{pricing,price_plan_version_id}',
      'price_book_id',v_result#>>'{pricing,price_book_id}',
      'pricing_snapshot_sha256',v_result#>>'{pricing,content_sha256}',
      'legal_bundle_id',coalesce(v_bundle_result->>'legal_bundle_id',v_payload->>'legal_bundle_id'),
      'legal_bundle_created',coalesce((v_bundle_result->>'created')::boolean,false),
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
      'correlation_id',v_correlation_id,
      'legal_bundle_id',coalesce(v_bundle_result->>'legal_bundle_id',v_payload->>'legal_bundle_id'),
      'legal_bundle_created',coalesce((v_bundle_result->>'created')::boolean,false)
    );
  exception when others then
    v_message:=sqlerrm;
    v_correlation_id:=coalesce(v_correlation_id,gen_random_uuid()::text);
    if v_message like 'publication_not_ready:%' then
      v_error_code:='publication_not_ready';
      v_user_message:='Avtalet kan inte publiceras ännu.';
      v_codes:=string_to_array(substring(v_message from length('publication_not_ready:')+1),',');
    elsif v_message like 'legal_requirement_rule_missing:%' then
      v_error_code:='legal_requirement_rule_missing';
      v_user_message:='Juridikregler saknas för vald kund- eller avtalstyp.';
      v_codes:=array[v_message];
    elsif v_message like 'legal_source_document_missing:%' then
      v_error_code:='legal_source_document_missing';
      v_user_message:='Publicerade juridiska källdokument saknas.';
      select coalesce(array_agg('missing_document:'||source order by source),'{}') into v_codes
      from unnest(string_to_array(substring(v_message from length('legal_source_document_missing:')+1),',')) source;
    elsif v_message like 'legal_source_bundle_invalid:%' then
      v_error_code:='legal_source_bundle_invalid';
      v_user_message:='Valt juridiskt paket är inte giltigt för avtalet.';
      v_codes:=array[v_message];
    else
      raise;
    end if;

    insert into public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata)
    values(
      p_company_id,p_actor_user_id,'contract_publication_version',coalesce(p_draft_contract_id::text,'blocked'),
      'contract.publication.atomic_blocked',null,null,
      jsonb_build_object('correlation_id',v_correlation_id,'error_code',v_error_code,'blockers',v_codes,'database_message',v_message)
    );
    return jsonb_build_object(
      'ok',false,'error_code',v_error_code,'message',v_user_message,'blockers',v_codes,'correlation_id',v_correlation_id
    );
  end;
end $$;

-- Compatibility RPC remains callable, but the admin UI and all new code use the
-- canonical gridex_publish_contract_version entry point above.

-- -----------------------------------------------------------------------------
-- Canonical removal command. The UI never deletes a legacy compatibility row
-- directly; the database locks the offer and chooses archive versus safe delete.
-- -----------------------------------------------------------------------------
create or replace function public.gridex_remove_contract_offer(
  p_company_id uuid,p_offer_id uuid,p_mode text,p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_offer public.public_contract_offers%rowtype;
  v_snapshot_count bigint:=0;
  v_archived jsonb;
  v_mode text:=coalesce(nullif(btrim(p_mode),''),'safe_delete');
begin
  if p_company_id is null or p_offer_id is null or p_actor_user_id is null then
    raise exception using errcode='22023',message='company_offer_actor_required';
  end if;
  select * into v_offer
  from public.public_contract_offers
  where id=p_offer_id and company_id=p_company_id
  for update;
  if not found then raise exception using errcode='P0002',message='contract_offer_not_found'; end if;

  select count(*) into v_snapshot_count
  from public.contract_price_snapshots s
  where s.company_id=p_company_id and s.public_contract_offer_id=p_offer_id;

  if v_mode='archive' or v_snapshot_count>0 or v_offer.publication_status='published'
     or coalesce(v_offer.is_public,false) then
    v_archived:=public.gridex_archive_public_contract_offer(p_company_id,p_offer_id,p_actor_user_id);
    insert into public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata)
    values(p_company_id,p_actor_user_id,'public_contract_offer',p_offer_id::text,'contract.offer.canonical_archived',to_jsonb(v_offer),v_archived,jsonb_build_object('requested_mode',v_mode,'snapshot_count',v_snapshot_count));
    return jsonb_build_object('ok',true,'mode','archived','snapshot_count',v_snapshot_count,'offer',v_archived);
  end if;

  perform set_config('gridex.public_offer_write','on',true);
  delete from public.public_contract_offers
  where id=p_offer_id and company_id=p_company_id;
  insert into public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata)
  values(p_company_id,p_actor_user_id,'public_contract_offer',p_offer_id::text,'contract.offer.canonical_deleted_unused',to_jsonb(v_offer),null,jsonb_build_object('requested_mode',v_mode,'snapshot_count',v_snapshot_count));
  return jsonb_build_object('ok',true,'mode','deleted','snapshot_count',v_snapshot_count,'offer',to_jsonb(v_offer));
end $$;

-- Internal offer removal follows the same rule: legacy compatibility rows are
-- never mutated directly by application code. Any canonical or customer history
-- turns a delete request into an archive, preventing orphaned version evidence.
create or replace function public.gridex_remove_internal_contract_offer(
  p_company_id uuid,p_offer_id uuid,p_mode text,p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_offer public.contract_offers%rowtype;
  v_saved public.contract_offers%rowtype;
  v_customer_contract_count bigint:=0;
  v_offer_version_count bigint:=0;
  v_mode text:=coalesce(nullif(btrim(p_mode),''),'safe_delete');
begin
  if p_company_id is null or p_offer_id is null or p_actor_user_id is null then
    raise exception using errcode='22023',message='company_offer_actor_required';
  end if;
  if v_mode not in ('archive','safe_delete') then
    raise exception using errcode='22023',message='invalid_remove_mode';
  end if;

  select * into v_offer
  from public.contract_offers
  where id=p_offer_id and company_id=p_company_id
  for update;
  if not found then raise exception using errcode='P0002',message='contract_offer_not_found'; end if;

  select count(*) into v_customer_contract_count
  from public.customer_contracts c
  where c.company_id=p_company_id and c.contract_offer_id=p_offer_id;

  select count(*) into v_offer_version_count
  from public.contract_offer_versions v
  where v.company_id=p_company_id and v.contract_offer_id=p_offer_id;

  if v_mode='archive' or v_customer_contract_count>0 or v_offer_version_count>0
     or v_offer.status='active' or coalesce(v_offer.is_active,false)
     or v_offer.contract_product_version_id is not null
     or v_offer.price_plan_version_id is not null
     or v_offer.price_book_id is not null then
    update public.contract_offers
    set status='inactive',is_active=false,archived_at=coalesce(archived_at,now()),
        updated_by=p_actor_user_id,updated_at=now()
    where id=p_offer_id and company_id=p_company_id
    returning * into v_saved;
    insert into public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata)
    values(p_company_id,p_actor_user_id,'contract_offer',p_offer_id::text,'contract.internal_offer.canonical_archived',to_jsonb(v_offer),to_jsonb(v_saved),
      jsonb_build_object('requested_mode',v_mode,'customer_contract_count',v_customer_contract_count,'offer_version_count',v_offer_version_count));
    return jsonb_build_object('ok',true,'mode','archived','customer_contract_count',v_customer_contract_count,'offer_version_count',v_offer_version_count,'offer',to_jsonb(v_saved));
  end if;

  delete from public.contract_offers
  where id=p_offer_id and company_id=p_company_id;
  insert into public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata)
  values(p_company_id,p_actor_user_id,'contract_offer',p_offer_id::text,'contract.internal_offer.canonical_deleted_unused',to_jsonb(v_offer),null,
    jsonb_build_object('requested_mode',v_mode,'customer_contract_count',v_customer_contract_count,'offer_version_count',v_offer_version_count));
  return jsonb_build_object('ok',true,'mode','deleted','customer_contract_count',v_customer_contract_count,'offer_version_count',v_offer_version_count,'offer',to_jsonb(v_offer));
end $$;

-- -----------------------------------------------------------------------------
-- Version-locked tenant communication evidence for email and PDF
-- -----------------------------------------------------------------------------
alter table public.customer_contracts
  add column if not exists tenant_communication_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists tenant_communication_snapshot_sha256 text,
  add column if not exists tenant_legal_party_snapshot jsonb not null default '{}'::jsonb;

create or replace function public.gridex_lock_customer_contract_tenant_snapshot()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_profile jsonb; v_company jsonb; v_email jsonb; v_snapshot jsonb;
begin
  if tg_op='UPDATE' and (old.signed_at is not null or old.locked_at is not null or old.status in('signed','active','terminated','cancelled','expired'))
     and old.tenant_communication_snapshot<>'{}'::jsonb then
    new.tenant_communication_snapshot:=old.tenant_communication_snapshot;
    new.tenant_communication_snapshot_sha256:=old.tenant_communication_snapshot_sha256;
    new.tenant_legal_party_snapshot:=old.tenant_legal_party_snapshot;
    return new;
  end if;
  if new.company_id is null then return new; end if;
  select to_jsonb(t) into v_profile from public.tenant_legal_profiles t where t.company_id=new.company_id;
  select to_jsonb(c) into v_company from public.companies c where c.id=new.company_id;
  select to_jsonb(e) into v_email from public.company_email_settings e where e.company_id=new.company_id;
  new.tenant_legal_party_snapshot:=jsonb_strip_nulls(jsonb_build_object(
    'company_id',new.company_id,'legal_name',coalesce(v_profile->>'legal_name',v_company->>'name'),
    'organization_number',coalesce(v_profile->>'organization_number',v_company->>'org_number'),
    'postal_address',v_profile->'postal_address','customer_service_email',v_profile->>'customer_service_email',
    'phone',v_profile->>'phone','website',v_profile->>'website','tenant_legal_profile_sha256',encode(digest(coalesce(v_profile,'{}')::text,'sha256'),'hex')
  ));
  v_snapshot:=jsonb_strip_nulls(jsonb_build_object(
    'snapshot_version','gridex_tenant_communication_v1',
    'company_id',new.company_id,'legal_name',coalesce(v_profile->>'legal_name',v_company->>'name'),
    'organization_number',coalesce(v_profile->>'organization_number',v_company->>'org_number'),
    'brand_name',coalesce(v_company#>>'{branding,brand_name}',v_company#>>'{branding,display_name}',v_company->>'name'),
    'sender_name',coalesce(v_email->>'sender_name',v_company#>>'{branding,display_name}',v_company->>'name'),
    'sender_email',v_email->>'sender_email','reply_to',coalesce(v_email->>'reply_to_email',v_email->>'support_email',v_profile->>'customer_service_email'),
    'support_email',coalesce(v_email->>'support_email',v_profile->>'customer_service_email'),
    'logo_url',coalesce(v_company#>>'{branding,logo_url}',v_company->>'logo_url'),
    'brand_colors',coalesce(v_company#>'{branding,colors}','{}'::jsonb),
    'legal_footer',coalesce(v_company#>>'{branding,legal_footer}',v_email->>'legal_footer'),
    'phone',coalesce(v_profile->>'phone',v_company->>'phone'),
    'website',coalesce(v_profile->>'website',v_company->>'website'),
    'contract_publication_version_id',new.contract_publication_version_id,
    'price_plan_version_id',new.price_plan_version_id,'legal_bundle_version_id',new.legal_bundle_version_id,
    'locked_at',coalesce(new.signed_at,new.created_at,now())
  ));
  new.tenant_communication_snapshot:=v_snapshot;
  new.tenant_communication_snapshot_sha256:=encode(digest(v_snapshot::text,'sha256'),'hex');
  return new;
end $$;

drop trigger if exists customer_contracts_lock_tenant_snapshot on public.customer_contracts;
create trigger customer_contracts_lock_tenant_snapshot
before insert or update of company_id,contract_publication_version_id,price_plan_version_id,legal_bundle_version_id,signed_at
on public.customer_contracts for each row
execute function public.gridex_lock_customer_contract_tenant_snapshot();

create or replace function public.gridex_lock_signed_customer_contract()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if old.status in ('signed','active','terminated','cancelled','expired')
     or old.signed_at is not null or old.locked_at is not null then
    if new.company_id is distinct from old.company_id
       or new.customer_id is distinct from old.customer_id
       or new.contract_product_id is distinct from old.contract_product_id
       or new.contract_product_version_id is distinct from old.contract_product_version_id
       or new.contract_publication_version_id is distinct from old.contract_publication_version_id
       or new.price_plan_id is distinct from old.price_plan_id
       or new.price_plan_version_id is distinct from old.price_plan_version_id
       or new.price_book_id is distinct from old.price_book_id
       or new.legal_bundle_version_id is distinct from old.legal_bundle_version_id
       or new.offer_reference is distinct from old.offer_reference
       or new.commercial_snapshot is distinct from old.commercial_snapshot
       or new.legal_snapshot is distinct from old.legal_snapshot
       or new.tenant_communication_snapshot is distinct from old.tenant_communication_snapshot
       or new.tenant_communication_snapshot_sha256 is distinct from old.tenant_communication_snapshot_sha256
       or new.tenant_legal_party_snapshot is distinct from old.tenant_legal_party_snapshot
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

-- Immutable/version protections for canonical evidence.
drop trigger if exists legal_bundle_versions_immutable on public.legal_bundle_versions;
create trigger legal_bundle_versions_immutable before update or delete on public.legal_bundle_versions
for each row when (old.locked_at is not null) execute function public.gridex_reject_locked_row_mutation();
create or replace function public.gridex_reject_locked_legal_document_mutation()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if exists(
    select 1 from public.legal_bundle_versions b
    where b.id=old.legal_bundle_version_id
      and (b.locked_at is not null or b.published_at is not null)
  ) and coalesce(current_setting('gridex.version_transition',true),'')<>'on' then
    raise exception using errcode='55000',message='immutable_legal_document_locked';
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;

drop trigger if exists legal_bundle_version_documents_immutable on public.legal_bundle_version_documents;
create trigger legal_bundle_version_documents_immutable before update or delete on public.legal_bundle_version_documents
for each row execute function public.gridex_reject_locked_legal_document_mutation();

revoke all on function public.gridex_resolve_or_create_legal_source_bundle(uuid,jsonb,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.gridex_publish_contract_version(uuid,uuid,text,jsonb,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.gridex_remove_contract_offer(uuid,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.gridex_remove_internal_contract_offer(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.gridex_publish_contract_version(uuid,uuid,text,jsonb,jsonb,uuid) to service_role;
grant execute on function public.gridex_remove_contract_offer(uuid,uuid,text,uuid) to service_role;
grant execute on function public.gridex_remove_internal_contract_offer(uuid,uuid,text,uuid) to service_role;
grant select on public.contract_publication_readiness_v,public.gridex_tenant_contract_readiness_v to authenticated,service_role;
grant execute on function public.gridex_required_legal_modules(text,text,text,boolean,boolean,boolean) to authenticated,service_role;

comment on function public.gridex_publish_contract_version(uuid,uuid,text,jsonb,jsonb,uuid) is
  'Canonical atomic contract publication command. Pricing, legal, contract version and publication either commit together or roll back together.';
comment on view public.gridex_tenant_contract_readiness_v is
  'Single tenant-level readiness source. No published contract is informational, not a legal blocker. Display and application acceptance are separate.';

commit;
