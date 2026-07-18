-- V5 legal evidence and supplier-switch hardening.
-- Additive by design: legacy legal_text_version_id remains readable for
-- historical agreements, while all new V5 agreements bind every exact bundle
-- document through legal_bundle_version_document_id.

begin;

create extension if not exists pgcrypto with schema extensions;

alter table public.customer_legal_acceptances
  add column if not exists legal_bundle_version_document_id uuid null
    references public.legal_bundle_version_documents(id) on delete restrict,
  add column if not exists legal_module_key text null,
  add column if not exists legal_document_version text null,
  add column if not exists legal_document_sha256 text null,
  add column if not exists request_id text null,
  add column if not exists trace_id text null;

create index if not exists customer_legal_acceptances_exact_document_idx
  on public.customer_legal_acceptances(
    company_id,contract_id,contract_application_id,
    legal_bundle_version_document_id,accepted_at
  ) where legal_bundle_version_document_id is not null;

create unique index if not exists customer_legal_acceptances_exact_evidence_uidx
  on public.customer_legal_acceptances(
    contract_id,contract_application_id,legal_bundle_version_document_id,accepted_at
  ) where contract_id is not null and legal_bundle_version_document_id is not null;

alter table public.customer_legal_acceptances
  drop constraint if exists customer_legal_acceptances_exact_document_check;
alter table public.customer_legal_acceptances
  add constraint customer_legal_acceptances_exact_document_check check (
    legal_bundle_version_document_id is null
    or (
      legal_text_version_id is null
      and nullif(btrim(legal_module_key),'') is not null
      and nullif(btrim(legal_document_version),'') is not null
      and legal_document_sha256 ~ '^[0-9a-f]{64}$'
    )
  ) not valid;
alter table public.customer_legal_acceptances
  validate constraint customer_legal_acceptances_exact_document_check;

comment on column public.customer_legal_acceptances.legal_text_version_id is
  'Historical evidence reference only. New V5 agreements use legal_bundle_version_document_id.';
comment on column public.customer_legal_acceptances.legal_bundle_version_document_id is
  'Exact immutable document accepted by the customer; never a category alias.';

alter table public.customer_contracts
  add column if not exists lifecycle_stage text not null default 'agreement_ready';

alter table public.customer_contracts
  drop constraint if exists customer_contracts_status_check;
alter table public.customer_contracts
  add constraint customer_contracts_status_check check (
    status in (
      'draft','pending_signature','signature_failed','signed','active',
      'terminated','cancelled','expired'
    )
  );

alter table public.customer_contracts
  drop constraint if exists customer_contracts_lifecycle_stage_check;
alter table public.customer_contracts
  add constraint customer_contracts_lifecycle_stage_check check (
    lifecycle_stage in (
      'agreement_ready','agreement_signed','facility_data_ready',
      'switch_data_ready','switch_ready','billing_ready','active'
    )
  );

-- The server-supplied hash is evidence, but the database-calculated hash is
-- authoritative. jsonb::text plus convert_to is deterministic on both create
-- and verification paths in PostgreSQL.
create or replace function public.gridex_finalize_website_contract_signature(
  p_company_id uuid,
  p_contract_id uuid,
  p_application_id uuid,
  p_public_contract_offer_id uuid,
  p_offer_reference text,
  p_accepted_at timestamptz,
  p_legal_versions jsonb,
  p_signature_snapshot jsonb,
  p_acceptance_evidence jsonb,
  p_signature_snapshot_sha256 text,
  p_signed_ip_hash text default null,
  p_signed_user_agent text default null
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_contract public.customer_contracts%rowtype;
  v_customer_type text;
  v_expected_count integer;
  v_submitted_count integer;
  v_withdrawal_required boolean;
  v_withdrawal_deadline timestamptz;
  v_signature_sha256 text;
begin
  if p_company_id is null or p_contract_id is null or p_application_id is null or p_accepted_at is null then
    raise exception using errcode='22023',message='company_contract_application_and_acceptance_time_required';
  end if;
  if jsonb_typeof(coalesce(p_legal_versions,'null'::jsonb))<>'array'
     or jsonb_typeof(coalesce(p_signature_snapshot,'null'::jsonb))<>'object'
     or jsonb_typeof(coalesce(p_acceptance_evidence,'null'::jsonb))<>'array' then
    raise exception using errcode='22023',message='signature_legal_versions_and_acceptances_must_be_structured_json';
  end if;

  select * into v_contract
  from public.customer_contracts
  where id=p_contract_id and company_id=p_company_id
  for update;
  if not found then
    raise exception using errcode='P0002',message='customer_contract_not_found_for_tenant';
  end if;

  if not exists(
    select 1 from public.website_customer_applications a
    where a.id=p_application_id and a.company_id=p_company_id
      and a.customer_id=v_contract.customer_id and a.contract_id=v_contract.id
      and a.public_contract_offer_id=p_public_contract_offer_id
      and a.offer_reference=p_offer_reference
  ) then
    raise exception using errcode='23514',message='website_application_contract_chain_mismatch';
  end if;

  if v_contract.public_contract_offer_id<>p_public_contract_offer_id
     or v_contract.offer_reference is distinct from p_offer_reference
     or v_contract.contract_publication_version_id is null
     or v_contract.contract_product_version_id is null
     or v_contract.price_plan_version_id is null
     or v_contract.legal_bundle_version_id is null
     or v_contract.contract_price_snapshot_id is null then
    raise exception using errcode='23514',message='contract_not_bound_to_exact_publication_chain';
  end if;

  if not exists(
    select 1
    from public.public_contract_offers o
    join public.contract_publication_versions cpv
      on cpv.id=v_contract.contract_publication_version_id
     and cpv.legacy_public_contract_offer_id=o.id
    join public.contract_product_versions ctv
      on ctv.id=cpv.contract_product_version_id
    join public.price_plan_versions ppv
      on ppv.id=cpv.price_plan_version_id
    join public.legal_bundle_versions lbv
      on lbv.id=cpv.legal_bundle_version_id
    join public.contract_price_snapshots cps
      on cps.id=v_contract.contract_price_snapshot_id
     and cps.contract_id=v_contract.id
     and cps.company_id=v_contract.company_id
    where o.id=p_public_contract_offer_id
      and o.company_id=p_company_id
      and cpv.offer_reference=p_offer_reference
      and cpv.status='published' and cpv.locked_at is not null
      and cpv.contract_product_version_id=v_contract.contract_product_version_id
      and cpv.price_plan_version_id=v_contract.price_plan_version_id
      and cpv.legal_bundle_version_id=v_contract.legal_bundle_version_id
      and ctv.status='approved' and ctv.locked_at is not null
      and ppv.status in('published','approved','active') and ppv.locked_at is not null
      and lbv.status='published' and lbv.locked_at is not null
      and cardinality(lbv.unresolved_variables)=0
      and cps.price_plan_version_id=v_contract.price_plan_version_id
      and nullif(cps.snapshot_hash,'') is not null
  ) then
    raise exception using errcode='23514',message='exact_locked_contract_chain_invalid';
  end if;

  select count(*) into v_expected_count
  from public.legal_bundle_version_documents d
  where d.legal_bundle_version_id=v_contract.legal_bundle_version_id;
  if v_expected_count=0 then
    raise exception using errcode='23514',message='exact_legal_document_set_missing';
  end if;

  with submitted as (
    select distinct
      coalesce(nullif(item->>'legal_bundle_version_document_id',''),nullif(item->>'id',''))::uuid document_id,
      coalesce(nullif(item->>'module_key',''),nullif(item->>'type','')) module_key,
      coalesce(nullif(item->>'document_sha256',''),nullif(item->>'body_sha256','')) document_sha256
    from jsonb_array_elements(p_legal_versions) item
  )
  select count(*) into v_submitted_count from submitted;

  if v_submitted_count<>v_expected_count or exists(
    with expected as (
    select d.id document_id,d.module_key,d.content_sha256 document_sha256
      from public.legal_bundle_version_documents d
      where d.legal_bundle_version_id=v_contract.legal_bundle_version_id
    ), submitted as (
      select distinct
        coalesce(nullif(item->>'legal_bundle_version_document_id',''),nullif(item->>'id',''))::uuid document_id,
        coalesce(nullif(item->>'module_key',''),nullif(item->>'type','')) module_key,
        coalesce(nullif(item->>'document_sha256',''),nullif(item->>'body_sha256','')) document_sha256
      from jsonb_array_elements(p_legal_versions) item
    )
    select 1
    from expected e full join submitted s
      on s.document_id=e.document_id
     and s.module_key=e.module_key
     and s.document_sha256=e.document_sha256
    where e.document_id is null or s.document_id is null
  ) then
    raise exception using errcode='23514',message='submitted_legal_versions_do_not_match_exact_publication';
  end if;

  if (select count(distinct nullif(item->>'legal_bundle_version_document_id','')::uuid)
      from jsonb_array_elements(p_acceptance_evidence) item)<>v_expected_count then
    raise exception using errcode='23514',message='acceptance_evidence_document_set_mismatch';
  end if;

  insert into public.customer_legal_acceptances(
    company_id,customer_id,contract_id,contract_application_id,acceptance_type,
    legal_text_version_id,legal_bundle_version_document_id,legal_module_key,
    legal_document_version,legal_document_sha256,request_id,trace_id,accepted_at,
    accepted_ip,accepted_ip_hash,accepted_user_agent,source,snapshot,metadata
  )
  select
    p_company_id,v_contract.customer_id,p_contract_id,p_application_id,
    case public.gridex_legacy_legal_type_for_module(d.module_key)
      when 'privacy_policy' then 'privacy_policy'
      when 'withdrawal' then 'withdrawal_info'
      when 'power_of_attorney' then 'power_of_attorney'
      when 'price_terms' then 'price_snapshot'
      else 'terms'
    end,
    null,d.id,d.module_key,nullif(item->>'legal_document_version',''),d.content_sha256,
    nullif(item->>'request_id',''),nullif(item->>'trace_id',''),p_accepted_at,
    nullif(item->>'accepted_ip',''),nullif(item->>'accepted_ip_hash',''),
    left(nullif(item->>'accepted_user_agent',''),1000),'website',
    coalesce(item->'snapshot','{}'::jsonb),coalesce(item->'metadata','{}'::jsonb)
  from jsonb_array_elements(p_acceptance_evidence) item
  join public.legal_bundle_version_documents d
    on d.id=nullif(item->>'legal_bundle_version_document_id','')::uuid
   and d.legal_bundle_version_id=v_contract.legal_bundle_version_id
   and d.module_key=nullif(item->>'legal_module_key','')
   and d.content_sha256=nullif(item->>'legal_document_sha256','')
  where nullif(item->>'legal_document_version','') is not null
  on conflict do nothing;

  if exists(
    select 1
    from public.legal_bundle_version_documents d
    where d.legal_bundle_version_id=v_contract.legal_bundle_version_id
      and not exists(
        select 1
        from public.customer_legal_acceptances a
        where a.company_id=p_company_id
          and a.customer_id=v_contract.customer_id
          and a.contract_id=p_contract_id
          and a.contract_application_id=p_application_id
          and a.legal_bundle_version_document_id=d.id
          and a.legal_module_key=d.module_key
          and a.legal_document_sha256=d.content_sha256
          and a.accepted_at=p_accepted_at
      )
  ) then
    raise exception using errcode='23514',message='exact_legal_acceptance_evidence_incomplete';
  end if;

  if coalesce(p_signature_snapshot->>'company_id','')<>p_company_id::text
     or coalesce(p_signature_snapshot->>'customer_id','')<>v_contract.customer_id::text
     or coalesce(p_signature_snapshot->>'contract_id','')<>p_contract_id::text
     or coalesce(p_signature_snapshot->>'application_id','')<>p_application_id::text
     or coalesce(p_signature_snapshot->>'public_contract_offer_id','')<>p_public_contract_offer_id::text
     or p_signature_snapshot->'legal_versions' is distinct from p_legal_versions
     or coalesce(p_signature_snapshot->>'contract_publication_version_id','')<>v_contract.contract_publication_version_id::text
     or coalesce(p_signature_snapshot->>'contract_product_version_id','')<>v_contract.contract_product_version_id::text
     or coalesce(p_signature_snapshot->>'price_plan_version_id','')<>v_contract.price_plan_version_id::text
     or coalesce(p_signature_snapshot->>'legal_bundle_version_id','')<>v_contract.legal_bundle_version_id::text
     or coalesce(p_signature_snapshot->>'contract_price_snapshot_id','')<>v_contract.contract_price_snapshot_id::text
     or coalesce(p_signature_snapshot->>'offer_reference','')<>p_offer_reference then
    raise exception using errcode='23514',message='signature_snapshot_chain_mismatch';
  end if;

  v_signature_sha256:=encode(
    extensions.digest(convert_to(p_signature_snapshot::text,'UTF8'),'sha256'),
    'hex'
  );

  select coalesce(c.customer_type,'private') into v_customer_type
  from public.customers c
  where c.id=v_contract.customer_id and c.company_id=p_company_id;
  select exists(
    select 1 from public.legal_bundle_version_documents d
    where d.legal_bundle_version_id=v_contract.legal_bundle_version_id
      and d.module_key in(
        'withdrawal','withdrawal_right','withdrawal_form',
        'distance_contract_information','pre_contract_information'
      )
  ) into v_withdrawal_required;
  v_withdrawal_deadline:=case
    when coalesce(v_customer_type,'private')='private' and v_withdrawal_required
      then p_accepted_at+interval '14 days'
    else null
  end;

  update public.customer_contracts set
    status='signed',signed_at=p_accepted_at,is_distance_agreement=true,
    withdrawal_deadline_at=v_withdrawal_deadline,
    legal_versions_snapshot=p_legal_versions,
    signature_snapshot=p_signature_snapshot,
    signature_snapshot_sha256=v_signature_sha256,
    signed_ip_hash=p_signed_ip_hash,
    signed_user_agent=left(p_signed_user_agent,1000),
    locked_at=p_accepted_at,
    lifecycle_stage='agreement_signed',
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'signature_status','signed',
      'signature_finalized_at',now(),
      'signature_snapshot_sha256',v_signature_sha256,
      'caller_signature_snapshot_sha256',p_signature_snapshot_sha256,
      'contract_publication_version_id',v_contract.contract_publication_version_id,
      'contract_product_version_id',v_contract.contract_product_version_id,
      'legal_bundle_version_id',v_contract.legal_bundle_version_id,
      'request_id',p_signature_snapshot#>>'{request_evidence,request_id}',
      'trace_id',p_signature_snapshot#>>'{request_evidence,trace_id}'
    ),updated_at=now()
  where id=p_contract_id and company_id=p_company_id;

  return jsonb_build_object(
    'contract_id',p_contract_id,
    'status','signed',
    'lifecycle_stage','agreement_signed',
    'signed_at',p_accepted_at,
    'withdrawal_deadline_at',v_withdrawal_deadline,
    'public_contract_offer_id',p_public_contract_offer_id,
    'offer_reference',p_offer_reference,
    'signature_snapshot_sha256',v_signature_sha256,
    'exact_legal_document_count',v_expected_count,
    'acceptance_ids',coalesce((
      select jsonb_object_agg(a.legal_bundle_version_document_id::text,a.id::text)
      from public.customer_legal_acceptances a
      where a.company_id=p_company_id and a.contract_id=p_contract_id
        and a.contract_application_id=p_application_id
        and a.accepted_at=p_accepted_at
        and a.legal_bundle_version_document_id is not null
    ),'{}'::jsonb)
  );
end
$$;

revoke all on function public.gridex_finalize_website_contract_signature(
  uuid,uuid,uuid,uuid,text,timestamptz,jsonb,jsonb,jsonb,text,text,text
) from public,anon,authenticated;
grant execute on function public.gridex_finalize_website_contract_signature(
  uuid,uuid,uuid,uuid,text,timestamptz,jsonb,jsonb,jsonb,text,text,text
) to service_role;

-- The legacy overload cannot atomically create the exact acceptance rows and
-- must not remain callable after V5.
revoke all on function public.gridex_finalize_website_contract_signature(
  uuid,uuid,uuid,uuid,text,timestamptz,jsonb,jsonb,text,text,text
) from service_role,public,anon,authenticated;

create or replace function public.gridex_fail_website_contract_signature(
  p_company_id uuid,p_contract_id uuid,p_application_id uuid,
  p_error_code text,p_error_stage text
) returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  update public.customer_contracts set
    status='signature_failed',lifecycle_stage='agreement_ready',
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'signature_status','failed',
      'website_application_id',p_application_id,
      'signature_failure_code',nullif(p_error_code,''),
      'signature_failure_stage',nullif(p_error_stage,''),
      'signature_failed_at',now(),
      'recoverable_by_new_signature_attempt',true
    ),updated_at=now()
  where id=p_contract_id and company_id=p_company_id
    and status='pending_signature'
    and metadata->>'website_application_id'=p_application_id::text;
  if not found then
    raise exception using errcode='P0002',message='pending_signature_contract_not_found_for_application';
  end if;
end $$;
revoke all on function public.gridex_fail_website_contract_signature(uuid,uuid,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.gridex_fail_website_contract_signature(uuid,uuid,uuid,text,text)
  to service_role;

alter table public.supplier_switch_requests
  add column if not exists contract_id uuid null,
  add column if not exists customer_contract_id uuid null,
  add column if not exists readiness_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists readiness_checked_at timestamptz null;

do $$
begin
  if not exists(
    select 1 from pg_constraint
    where conrelid='public.supplier_switch_requests'::regclass
      and conname='supplier_switch_requests_contract_fk'
  ) then
    alter table public.supplier_switch_requests
      add constraint supplier_switch_requests_contract_fk
      foreign key(contract_id) references public.customer_contracts(id) on delete restrict
      not valid;
  end if;
  if not exists(
    select 1 from pg_constraint
    where conrelid='public.supplier_switch_requests'::regclass
      and conname='supplier_switch_requests_customer_contract_fk'
  ) then
    alter table public.supplier_switch_requests
      add constraint supplier_switch_requests_customer_contract_fk
      foreign key(customer_contract_id) references public.customer_contracts(id) on delete restrict
      not valid;
  end if;
end $$;

-- One canonical readiness view is consumed by API, orchestration and the DB
-- trigger. It deliberately keeps agreement/facility/switch/billing/active as
-- separate facts instead of treating facility completeness as switch-ready.
create or replace view public.customer_contract_lifecycle_readiness_v
with (security_invoker=true) as
with evidence as (
  select
    c.*,
    (select count(*) from public.legal_bundle_version_documents d
      where d.legal_bundle_version_id=c.legal_bundle_version_id) legal_document_count,
    (select count(distinct a.legal_bundle_version_document_id)
      from public.customer_legal_acceptances a
      where a.company_id=c.company_id and a.customer_id=c.customer_id
        and a.contract_id=c.id
        and a.legal_bundle_version_document_id is not null) accepted_document_count,
    exists(
      select 1 from public.customer_contract_documents d
      where d.company_id=c.company_id and d.customer_contract_id=c.id
        and d.document_type='signed_contract_pdf'
        and d.storage_path is not null and d.archived_at is not null
        and d.verified_at is not null and d.document_sha256=c.document_sha256
    ) signed_pdf_archived,
    exists(
      select 1 from public.customer_sites s
      where s.id=coalesce(c.customer_site_id,c.site_id)
        and s.company_id=c.company_id and s.customer_id=c.customer_id
        and nullif(s.facility_id,'') is not null
        and s.grid_owner_id is not null
        and nullif(s.grid_area_code,'') is not null
        and s.price_area_code in('SE1','SE2','SE3','SE4')
        and s.status not in('inactive','closed')
    ) facility_data_ready,
    exists(
      select 1
      from public.metering_points m
      where m.id=coalesce(c.metering_point_id,m.id)
        and m.site_id=coalesce(c.customer_site_id,c.site_id)
        and m.company_id=c.company_id
        and m.customer_id=c.customer_id
        and nullif(coalesce(m.meter_point_id,m.metering_point_id),'') is not null
        and m.grid_owner_id is not null
        and m.price_area_code in('SE1','SE2','SE3','SE4')
        and m.status not in('inactive','closed')
    ) metering_data_ready,
    exists(
      select 1 from public.powers_of_attorney p
      where p.company_id=c.company_id and p.customer_id=c.customer_id
        and coalesce(p.contract_id,p.customer_contract_id)=c.id
        and coalesce(p.customer_site_id,p.site_id)=coalesce(c.customer_site_id,c.site_id)
        and p.status in('signed','active','accepted')
        and coalesce(p.accepted_at,p.signed_at) is not null
        and p.revoked_at is null
        and (coalesce(p.valid_until,p.valid_to) is null
          or coalesce(p.valid_until,p.valid_to)>=current_date)
    ) valid_power_of_attorney
    ,coalesce(c.requested_start_date,c.expected_start_at,c.starts_at) is not null
      as start_date_ready
  from public.customer_contracts c
), stages as (
  select e.*,
    (
      e.contract_publication_version_id is not null
      and e.contract_product_version_id is not null
      and e.price_plan_version_id is not null
      and e.legal_bundle_version_id is not null
      and e.contract_price_snapshot_id is not null
    ) agreement_ready,
    (
      e.status='signed' and e.signed_at is not null
      and nullif(e.signature_snapshot_sha256,'') is not null
      and e.legal_document_count>0
      and e.accepted_document_count=e.legal_document_count
    ) agreement_signed
  from evidence e
), readiness as (
  select s.*,
    (s.facility_data_ready and s.metering_data_ready) switch_data_ready,
    (
      s.agreement_ready and s.agreement_signed
      and s.facility_data_ready and s.metering_data_ready
      and s.signed_pdf_archived and s.valid_power_of_attorney
      and s.start_date_ready
      and coalesce(s.withdrawal_requested_at,'-infinity'::timestamptz)='-infinity'::timestamptz
      and coalesce(s.export_blocked,false)=false
    ) switch_ready
  from stages s
)
select
  r.id customer_contract_id,r.company_id,r.customer_id,
  coalesce(r.customer_site_id,r.site_id) customer_site_id,r.metering_point_id,
  r.agreement_ready,r.agreement_signed,r.facility_data_ready,
  r.switch_data_ready,r.switch_ready,
  (r.agreement_signed and r.contract_price_snapshot_id is not null) billing_ready,
  (r.status='active' and r.actual_start_at is not null) active,
  r.signed_pdf_archived,r.valid_power_of_attorney,
  r.start_date_ready,
  r.legal_document_count,r.accepted_document_count,
  case
    when r.status='active' and r.actual_start_at is not null then 'active'
    when r.agreement_signed and r.contract_price_snapshot_id is not null then
      case when r.switch_ready then 'switch_ready' else
        case when r.switch_data_ready then 'switch_data_ready' else
          case when r.facility_data_ready then 'facility_data_ready' else 'agreement_signed' end
        end
      end
    else 'agreement_ready'
  end lifecycle_stage,
  array_remove(array[
    case when not r.agreement_ready then 'agreement_not_canonically_bound' end,
    case when not r.agreement_signed then 'agreement_not_signed_with_exact_evidence' end,
    case when not r.facility_data_ready then 'facility_data_not_ready' end,
    case when not r.metering_data_ready then 'metering_data_not_ready' end,
    case when not r.signed_pdf_archived then 'signed_pdf_not_archived_or_hash_mismatch' end,
    case when not r.valid_power_of_attorney then 'valid_power_of_attorney_missing' end,
    case when not r.start_date_ready then 'contract_start_date_missing' end,
    case when r.withdrawal_requested_at is not null then 'withdrawal_requested' end,
    case when coalesce(r.export_blocked,false) then 'contract_export_blocked' end
  ],null) blockers
from readiness r;

revoke all on public.customer_contract_lifecycle_readiness_v from public,anon,authenticated;
grant select on public.customer_contract_lifecycle_readiness_v to service_role;

create or replace function public.gridex_assert_supplier_switch_ready(
  p_company_id uuid,
  p_contract_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_readiness record;
begin
  select * into v_readiness
  from public.customer_contract_lifecycle_readiness_v
  where company_id=p_company_id and customer_contract_id=p_contract_id;
  if not found then
    raise exception using errcode='P0002',message='supplier_switch_contract_readiness_missing';
  end if;
  if not v_readiness.switch_ready then
    raise exception using errcode='23514',message='supplier_switch_not_ready',
      detail=array_to_string(v_readiness.blockers,',');
  end if;
  return jsonb_build_object(
    'ready',true,'contract_id',p_contract_id,
    'lifecycle_stage',v_readiness.lifecycle_stage,
    'checked_at',clock_timestamp()
  );
end $$;

revoke all on function public.gridex_assert_supplier_switch_ready(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.gridex_assert_supplier_switch_ready(uuid,uuid)
  to service_role;

create or replace function public.gridex_guard_supplier_switch_dispatch()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare v_contract_id uuid; v_evidence jsonb;
begin
  if new.status not in('ready','queued','submitted','sent','processing') then
    return new;
  end if;
  v_contract_id:=coalesce(
    new.customer_contract_id,new.contract_id,
    nullif(new.metadata->>'contract_id','')::uuid
  );
  if v_contract_id is null then
    raise exception using errcode='23514',message='supplier_switch_exact_contract_required';
  end if;
  v_evidence:=public.gridex_assert_supplier_switch_ready(new.company_id,v_contract_id);
  new.contract_id:=v_contract_id;
  new.customer_contract_id:=v_contract_id;
  new.readiness_snapshot:=coalesce(new.readiness_snapshot,'{}'::jsonb)||v_evidence;
  new.readiness_checked_at:=now();
  return new;
end $$;

drop trigger if exists zz_supplier_switch_dispatch_readiness on public.supplier_switch_requests;
create trigger zz_supplier_switch_dispatch_readiness
before insert or update of status,contract_id,customer_contract_id,metadata
on public.supplier_switch_requests
for each row execute function public.gridex_guard_supplier_switch_dispatch();

do $$
begin
  if to_regclass('public.customer_contract_lifecycle_readiness_v') is null then
    raise exception 'customer_contract_lifecycle_readiness_view_missing';
  end if;
  if not exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='customer_legal_acceptances'
      and column_name='legal_bundle_version_document_id'
  ) then
    raise exception 'exact_legal_acceptance_column_missing';
  end if;
end $$;

commit;
