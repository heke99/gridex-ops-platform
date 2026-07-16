begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Production and consumption are separate economic flows. Quantities remain
-- positive; settlement_type determines invoice versus credit/self-billing.
alter table public.billing_underlays
  add column if not exists energy_direction text not null default 'consumption',
  add column if not exists settlement_type text not null default 'invoice';
alter table public.billing_underlay_items
  add column if not exists energy_direction text not null default 'consumption',
  add column if not exists settlement_type text not null default 'invoice';
alter table public.pricing_runs
  add column if not exists energy_direction text not null default 'consumption',
  add column if not exists settlement_type text not null default 'invoice';
alter table public.pricing_interval_evidence
  add column if not exists energy_direction text not null default 'consumption';
alter table public.billing_export_run_items
  add column if not exists energy_direction text not null default 'consumption',
  add column if not exists settlement_type text not null default 'invoice',
  add column if not exists partner_result_type text not null default 'none';
alter table public.billing_export_runs
  add column if not exists rows_queued integer not null default 0,
  add column if not exists rows_sent integer not null default 0,
  add column if not exists rows_acknowledged integer not null default 0,
  add column if not exists rows_failed integer not null default 0,
  add column if not exists rows_rejected integer not null default 0;

do $$ begin
  if not exists(select 1 from pg_constraint where conname='billing_underlays_energy_direction_check' and conrelid='public.billing_underlays'::regclass) then
    alter table public.billing_underlays add constraint billing_underlays_energy_direction_check check(energy_direction in ('consumption','production','consumption_correction'));
  end if;
  if not exists(select 1 from pg_constraint where conname='billing_underlays_settlement_type_check' and conrelid='public.billing_underlays'::regclass) then
    alter table public.billing_underlays add constraint billing_underlays_settlement_type_check check(settlement_type in ('invoice','credit_invoice','self_billing'));
  end if;
  if not exists(select 1 from pg_constraint where conname='billing_underlay_items_energy_direction_check' and conrelid='public.billing_underlay_items'::regclass) then
    alter table public.billing_underlay_items add constraint billing_underlay_items_energy_direction_check check(energy_direction in ('consumption','production','consumption_correction'));
  end if;
  if not exists(select 1 from pg_constraint where conname='billing_underlay_items_settlement_type_check' and conrelid='public.billing_underlay_items'::regclass) then
    alter table public.billing_underlay_items add constraint billing_underlay_items_settlement_type_check check(settlement_type in ('invoice','credit_invoice','self_billing'));
  end if;
  if not exists(select 1 from pg_constraint where conname='pricing_runs_energy_direction_check' and conrelid='public.pricing_runs'::regclass) then
    alter table public.pricing_runs add constraint pricing_runs_energy_direction_check check(energy_direction in ('consumption','production','consumption_correction'));
  end if;
  if not exists(select 1 from pg_constraint where conname='pricing_runs_settlement_type_check' and conrelid='public.pricing_runs'::regclass) then
    alter table public.pricing_runs add constraint pricing_runs_settlement_type_check check(settlement_type in ('invoice','credit_invoice','self_billing'));
  end if;
  if not exists(select 1 from pg_constraint where conname='pricing_interval_evidence_energy_direction_check' and conrelid='public.pricing_interval_evidence'::regclass) then
    alter table public.pricing_interval_evidence add constraint pricing_interval_evidence_energy_direction_check check(energy_direction in ('consumption','production','consumption_correction'));
  end if;
  if not exists(select 1 from pg_constraint where conname='billing_export_items_energy_direction_check' and conrelid='public.billing_export_run_items'::regclass) then
    alter table public.billing_export_run_items add constraint billing_export_items_energy_direction_check check(energy_direction in ('consumption','production','consumption_correction'));
  end if;
  if not exists(select 1 from pg_constraint where conname='billing_export_items_settlement_type_check' and conrelid='public.billing_export_run_items'::regclass) then
    alter table public.billing_export_run_items add constraint billing_export_items_settlement_type_check check(settlement_type in ('invoice','credit_invoice','self_billing'));
  end if;
  if not exists(select 1 from pg_constraint where conname='billing_export_items_partner_result_type_check' and conrelid='public.billing_export_run_items'::regclass) then
    alter table public.billing_export_run_items add constraint billing_export_items_partner_result_type_check check(partner_result_type in ('none','accepted','rejected','transport_failed'));
  end if;
end $$;

alter table public.billing_export_runs drop constraint if exists billing_export_runs_status_check;
alter table public.billing_export_runs add constraint billing_export_runs_status_check
  check(status in ('draft','ready','ready_with_flags','blocked','queued','sent','acknowledged','partial_failed','failed','cancelled'));

create or replace function public.gridex_normalize_billing_energy_flow()
returns trigger language plpgsql set search_path=public,extensions,pg_temp as $$
begin
  new.energy_direction:=case
    when coalesce(nullif(new.payload->>'energy_direction',''),new.energy_direction)='production' then 'production'
    when coalesce(nullif(new.payload->>'energy_direction',''),new.energy_direction)='consumption_correction' then 'consumption_correction'
    else 'consumption' end;
  new.settlement_type:=case
    when new.energy_direction='production' and coalesce(nullif(new.payload->>'settlement_type',''),new.settlement_type)='self_billing' then 'self_billing'
    when new.energy_direction='production' then 'credit_invoice'
    when new.energy_direction='consumption_correction' then 'credit_invoice'
    else 'invoice' end;
  if new.total_kwh is not null and new.total_kwh<0 then
    raise exception using errcode='23514',message='billing_underlay_quantity_must_be_positive_direction_is_separate';
  end if;
  return new;
end $$;
drop trigger if exists billing_underlays_energy_flow_normalize on public.billing_underlays;
create trigger billing_underlays_energy_flow_normalize
before insert or update of payload,energy_direction,settlement_type,total_kwh on public.billing_underlays
for each row execute function public.gridex_normalize_billing_energy_flow();

update public.billing_underlays
set payload=coalesce(payload,'{}'::jsonb)||jsonb_build_object(
      'energy_direction',case
        when payload->>'energy_direction'='production' then 'production'
        when payload->>'energy_direction'='consumption_correction' or total_kwh<0 then 'consumption_correction'
        else 'consumption' end,
      'settlement_type',case
        when payload->>'energy_direction'='production' and payload->>'settlement_type'='self_billing' then 'self_billing'
        when payload->>'energy_direction'='production' then 'credit_invoice'
        when payload->>'energy_direction'='consumption_correction' or total_kwh<0 then 'credit_invoice'
        else 'invoice' end
    ),
    total_kwh=abs(total_kwh),
    energy_direction=case
      when payload->>'energy_direction'='production' then 'production'
      when payload->>'energy_direction'='consumption_correction' or total_kwh<0 then 'consumption_correction'
      else 'consumption' end,
    settlement_type=case
      when payload->>'energy_direction'='production' and payload->>'settlement_type'='self_billing' then 'self_billing'
      when payload->>'energy_direction'='production' then 'credit_invoice'
      when payload->>'energy_direction'='consumption_correction' or total_kwh<0 then 'credit_invoice'
      else 'invoice' end;

update public.billing_underlay_items i
set energy_direction=b.energy_direction,settlement_type=b.settlement_type,
    quantity=abs(i.quantity),quantity_kwh=abs(i.quantity_kwh)
from public.billing_underlays b
where b.id=i.billing_underlay_id and b.company_id=i.company_id;

update public.pricing_runs p
set energy_direction=b.energy_direction,settlement_type=b.settlement_type
from public.billing_underlays b
where b.id=p.billing_underlay_id and b.company_id=p.company_id;

update public.pricing_interval_evidence e
set energy_direction=p.energy_direction
from public.pricing_runs p
where p.id=e.pricing_run_id and p.company_id=e.company_id;

update public.billing_export_run_items i
set energy_direction=b.energy_direction,settlement_type=b.settlement_type
from public.billing_underlays b
where b.id=i.billing_underlay_id and b.company_id=i.company_id;

drop index if exists public.billing_underlays_company_segment_uidx;
create unique index billing_underlays_company_segment_uidx
  on public.billing_underlays(company_id,customer_id,metering_point_id,underlay_year,underlay_month,billing_period_start,billing_period_end,energy_direction);

create or replace function public.gridex_inherit_pricing_run_energy_flow()
returns trigger language plpgsql set search_path=public,extensions,pg_temp as $$
begin
  select b.energy_direction,b.settlement_type into new.energy_direction,new.settlement_type
  from public.billing_underlays b
  where b.id=new.billing_underlay_id and b.company_id=new.company_id;
  if not found then raise exception using errcode='23503',message='pricing_run_underlay_not_found_for_energy_flow'; end if;
  return new;
end $$;
drop trigger if exists pricing_runs_energy_flow_inherit on public.pricing_runs;
create trigger pricing_runs_energy_flow_inherit before insert or update of billing_underlay_id on public.pricing_runs
for each row execute function public.gridex_inherit_pricing_run_energy_flow();

create or replace function public.gridex_inherit_export_item_energy_flow()
returns trigger language plpgsql set search_path=public,extensions,pg_temp as $$
begin
  select b.energy_direction,b.settlement_type into new.energy_direction,new.settlement_type
  from public.billing_underlays b
  where b.id=new.billing_underlay_id and b.company_id=new.company_id;
  if not found then raise exception using errcode='23503',message='export_item_underlay_not_found_for_energy_flow'; end if;
  return new;
end $$;
drop trigger if exists billing_export_items_energy_flow_inherit on public.billing_export_run_items;
create trigger billing_export_items_energy_flow_inherit before insert or update of billing_underlay_id on public.billing_export_run_items
for each row execute function public.gridex_inherit_export_item_energy_flow();

-- SECURITY DEFINER routines using digest() must resolve pgcrypto from extensions.
alter function public.gridex_create_or_version_contract_pricing(uuid,text,text,text,text,jsonb,date,date,boolean,uuid) set search_path=public,extensions,pg_temp;
alter function public.gridex_materialize_legal_bundle_version(uuid,uuid,uuid,uuid) set search_path=public,extensions,pg_temp;
alter function public.gridex_sync_public_offer_to_canonical(uuid) set search_path=public,extensions,pg_temp;
alter function public.gridex_sync_internal_offer_to_canonical(uuid) set search_path=public,extensions,pg_temp;
alter function public.gridex_create_website_customer_contract(uuid,jsonb,text) set search_path=public,extensions,pg_temp;
alter function public.gridex_persist_pricing_run(uuid,uuid,jsonb,jsonb) set search_path=public,extensions,pg_temp;
alter function public.gridex_lock_pricing_run(uuid,uuid,uuid) set search_path=public,extensions,pg_temp;
alter function public.gridex_store_billing_underlay(uuid,jsonb,jsonb,uuid) set search_path=public,extensions,pg_temp;
alter function public.gridex_store_billing_underlay_batch(uuid,jsonb,uuid) set search_path=public,extensions,pg_temp;
alter function public.gridex_create_billing_export_run(jsonb,jsonb) set search_path=public,extensions,pg_temp;

-- Canonical export readiness: all UI, queueing and partner delivery use this view.
drop view if exists public.billing_export_readiness_v;
create view public.billing_export_readiness_v as
with facts as (
  select
    b.company_id,
    b.id as billing_underlay_id,
    b.contract_id,
    b.energy_direction,
    b.settlement_type,
    b.readiness_status as underlay_readiness_status,
    b.status as underlay_status,
    coalesce(b.contract_price_snapshot_id,b.pricing_snapshot_id) as contract_price_snapshot_id,
    coalesce(nullif(b.pricing_snapshot->>'interval_resolution',''),nullif(b.pricing_snapshot#>>'{pricing,interval_resolution}',''),'monthly') as interval_resolution,
    c.id as exact_contract_id,
    s.id as exact_snapshot_id,
    pr.id as pricing_run_id,
    pr.status as pricing_run_status,
    (select count(*) from public.billing_underlay_items bi where bi.company_id=b.company_id and bi.billing_underlay_id=b.id) as underlay_item_count,
    (select count(*) from public.pricing_interval_evidence pie where pie.company_id=b.company_id and pie.pricing_run_id=pr.id) as interval_evidence_count,
    exists(
      select 1 from public.pricing_preview_lines ppl
      where ppl.company_id=b.company_id and ppl.pricing_run_id=pr.id
        and ppl.line_type='production_compensation_credit' and ppl.amount_ex_vat<0
    ) as has_production_credit_line,
    exists(
      select 1 from public.pricing_preview_lines ppl
      where ppl.company_id=b.company_id and ppl.pricing_run_id=pr.id
        and ppl.amount_ex_vat<0
    ) as has_negative_credit_line
  from public.billing_underlays b
  left join public.customer_contracts c
    on c.id=b.contract_id and c.company_id=b.company_id and c.status in ('signed','active')
  left join public.contract_price_snapshots s
    on s.id=coalesce(b.contract_price_snapshot_id,b.pricing_snapshot_id)
   and s.company_id=b.company_id and s.contract_id=b.contract_id
  left join lateral (
    select p.id,p.status from public.pricing_runs p
    where p.company_id=b.company_id and p.billing_underlay_id=b.id and p.status='locked'
    order by p.locked_at desc nulls last,p.created_at desc limit 1
  ) pr on true
), evaluated as (
  select f.*,
    array_remove(array[
      case when f.underlay_readiness_status<>'ready' then 'underlay_not_ready' end,
      case when f.exact_contract_id is null then 'exact_signed_contract_missing' end,
      case when f.exact_snapshot_id is null then 'exact_contract_price_snapshot_missing' end,
      case when f.pricing_run_id is null or f.pricing_run_status<>'locked' then 'locked_pricing_run_missing' end,
      case when f.energy_direction='production' and f.settlement_type not in ('credit_invoice','self_billing') then 'production_settlement_type_invalid' end,
      case when f.energy_direction='production' and not f.has_production_credit_line then 'production_credit_line_missing' end,
      case when f.energy_direction='consumption_correction' and f.settlement_type<>'credit_invoice' then 'consumption_correction_settlement_invalid' end,
      case when f.energy_direction='consumption_correction' and not f.has_negative_credit_line then 'consumption_correction_credit_line_missing' end,
      case when f.energy_direction='consumption' and f.interval_resolution in ('hourly','quarterly','quarter_hour') and f.interval_evidence_count<>f.underlay_item_count then 'interval_evidence_incomplete' end
    ]::text[],null) as blockers_array
  from facts f
)
select
  company_id,billing_underlay_id,contract_id,contract_price_snapshot_id,pricing_run_id,
  energy_direction,settlement_type,interval_resolution,underlay_item_count,interval_evidence_count,
  case when cardinality(blockers_array)=0 then 'ready' else 'blocked' end as status,
  cardinality(blockers_array)=0 as is_exportable,
  to_jsonb(blockers_array) as blockers
from evaluated;

create or replace function public.gridex_refresh_billing_export_run(
  p_company_id uuid,p_export_run_id uuid
) returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_run public.billing_export_runs%rowtype; v_total integer; v_ready integer; v_blocked integer;
v_queued integer; v_sent integer; v_ack integer; v_failed integer; v_rejected integer; v_status text;
begin
  select * into v_run from public.billing_export_runs where id=p_export_run_id and company_id=p_company_id for update;
  if not found then raise exception using errcode='P0002',message='billing_export_run_not_found'; end if;
  select count(*),count(*) filter(where status in ('ready','ready_for_retry')),count(*) filter(where status='blocked'),
    count(*) filter(where export_status='queued'),count(*) filter(where export_status='sent'),
    count(*) filter(where export_status='acknowledged'),count(*) filter(where export_status='failed'),
    count(*) filter(where partner_result_type='rejected')
  into v_total,v_ready,v_blocked,v_queued,v_sent,v_ack,v_failed,v_rejected
  from public.billing_export_run_items where company_id=p_company_id and billing_export_run_id=p_export_run_id;
  v_status:=case
    when (v_failed>0 or v_blocked>0) and v_sent+v_ack>0 then 'partial_failed'
    when v_failed>0 then 'failed'
    when v_blocked>0 then 'blocked'
    when v_total>0 and v_ack=v_total then 'acknowledged'
    when v_total>0 and v_sent+v_ack=v_total then 'sent'
    when v_queued>0 then 'queued'
    when v_ready>0 then 'ready_with_flags'
    else 'blocked' end;
  update public.billing_export_runs set status=v_status,rows_total=v_total,rows_ready=v_ready,rows_blocked=v_blocked,
    rows_queued=v_queued,rows_sent=v_sent,rows_acknowledged=v_ack,rows_failed=v_failed,rows_rejected=v_rejected,
    rows_exported=v_sent+v_ack,updated_at=now()
  where id=p_export_run_id and company_id=p_company_id returning * into v_run;
  return to_jsonb(v_run);
end $$;

-- Queue all ready rows and create partner outbox rows in one transaction.
create or replace function public.gridex_queue_billing_export_run(
  p_company_id uuid,p_export_run_id uuid,p_actor_user_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_run public.billing_export_runs%rowtype; v_item public.billing_export_run_items%rowtype;
v_partner public.partner_exports%rowtype; v_key text; v_queued integer:=0; v_skipped integer:=0; v_blocked integer:=0;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_export_run_id::text||':queue',0));
  select * into v_run from public.billing_export_runs where id=p_export_run_id and company_id=p_company_id for update;
  if not found then raise exception using errcode='P0002',message='billing_export_run_not_found'; end if;
  for v_item in select * from public.billing_export_run_items
    where company_id=p_company_id and billing_export_run_id=p_export_run_id order by created_at,id for update
  loop
    if v_item.status not in ('ready','ready_for_retry') then v_blocked:=v_blocked+1; continue; end if;
    if not exists(select 1 from public.billing_export_readiness_v r where r.company_id=p_company_id and r.billing_underlay_id=v_item.billing_underlay_id and r.is_exportable) then
      update public.billing_export_run_items set status='blocked',readiness_status='blocked',export_status='blocked',
        blocker_reasons=coalesce(blocker_reasons,'[]'::jsonb)||jsonb_build_array(jsonb_build_object('code','canonical_export_readiness_failed','severity','blocked')),
        last_error='Canonical exportreadiness blockerar raden.',failed_at=now(),updated_at=now() where id=v_item.id;
      v_blocked:=v_blocked+1; continue;
    end if;
    if v_item.customer_id is null then raise exception using errcode='23514',message='export_item_customer_required'; end if;
    if v_item.export_status in ('queued','sent','acknowledged') then v_skipped:=v_skipped+1; continue; end if;
    v_key:=coalesce(nullif(v_item.idempotency_key,''),'billing-export-run-item:'||v_item.id::text);
    if v_item.partner_export_id is not null then
      select * into v_partner from public.partner_exports
       where id=v_item.partner_export_id and company_id=p_company_id for update;
      if not found then
        select * into v_partner from public.partner_exports
         where company_id=p_company_id and idempotency_key=v_key for update;
      end if;
    else
      select * into v_partner from public.partner_exports
       where company_id=p_company_id and idempotency_key=v_key for update;
    end if;
    if not found then
      insert into public.partner_exports(company_id,customer_id,site_id,metering_point_id,billing_underlay_id,export_kind,target_system,status,
        payload,external_reference,export_batch_key,idempotency_key,adapter_key,payload_version,queued_at,created_by,updated_by)
      values(p_company_id,v_item.customer_id,v_item.site_id,v_item.metering_point_id,v_item.billing_underlay_id,'billing_underlay',v_run.target_system,'queued',
        jsonb_build_object('adapterPayload',v_item.adapter_payload_snapshot,'exportRunId',p_export_run_id,'exportRunItemId',v_item.id)||coalesce(v_item.payload_snapshot,'{}'::jsonb),
        coalesce(v_item.external_reference,'BILLING-'||upper(left(v_item.id::text,8))),p_export_run_id::text,v_key,
        coalesce(v_item.adapter_key,'gridex_billing_partner_v1'),coalesce(v_item.payload_version,'partner_export_v4c'),now(),p_actor_user_id,p_actor_user_id)
      returning * into v_partner;
    else
      update public.partner_exports set status='queued',
        payload=jsonb_build_object('adapterPayload',v_item.adapter_payload_snapshot,'exportRunId',p_export_run_id,'exportRunItemId',v_item.id)||coalesce(v_item.payload_snapshot,'{}'::jsonb),
        queued_at=now(),sent_at=null,failed_at=null,failure_reason=null,response_payload=null,
        updated_at=now(),updated_by=p_actor_user_id where id=v_partner.id returning * into v_partner;
    end if;
    update public.billing_export_run_items set export_status='queued',partner_result_type='none',partner_export_id=v_partner.id,idempotency_key=v_key,
      queued_at=now(),sent_at=null,failed_at=null,last_error=null,updated_at=now() where id=v_item.id;
    v_queued:=v_queued+1;
  end loop;
  perform public.gridex_refresh_billing_export_run(p_company_id,p_export_run_id);
  return jsonb_build_object('queued',v_queued,'skipped',v_skipped,'blocked',v_blocked);
end $$;

-- Apply a complete partner row acknowledgement atomically.
create or replace function public.gridex_apply_billing_export_partner_result(
  p_company_id uuid,p_export_run_id uuid,p_accepted_ids uuid[] default '{}',p_rejected jsonb default '[]'::jsonb,
  p_response jsonb default '{}'::jsonb,p_actor_user_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_target_count integer; v_accounted_count integer; v_unknown_count integer; v_rejected_count integer;
begin
  if jsonb_typeof(coalesce(p_rejected,'[]'::jsonb))<>'array' then raise exception using errcode='22023',message='rejected_rows_must_be_array'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_export_run_id::text||':partner-result',0));
  perform 1 from public.billing_export_runs where id=p_export_run_id and company_id=p_company_id for update;
  if not found then raise exception using errcode='P0002',message='billing_export_run_not_found'; end if;
  select count(*) into v_target_count from public.billing_export_run_items
   where company_id=p_company_id and billing_export_run_id=p_export_run_id and status in ('ready','ready_for_retry') and export_status='queued';
  select count(distinct id) into v_accounted_count from (
    select unnest(coalesce(p_accepted_ids,'{}'::uuid[])) id
    union all
    select nullif(x->>'id','')::uuid from jsonb_array_elements(coalesce(p_rejected,'[]'::jsonb)) x
  ) q;
  select count(*) into v_unknown_count from (
    select unnest(coalesce(p_accepted_ids,'{}'::uuid[])) id
    union all select nullif(x->>'id','')::uuid from jsonb_array_elements(coalesce(p_rejected,'[]'::jsonb)) x
  ) q where q.id is null or not exists(select 1 from public.billing_export_run_items i where i.id=q.id and i.company_id=p_company_id and i.billing_export_run_id=p_export_run_id and i.status in ('ready','ready_for_retry') and i.export_status='queued');
  if v_unknown_count>0 or v_accounted_count<>v_target_count then raise exception using errcode='23514',message='partner_row_acknowledgement_incomplete_or_unknown'; end if;
  if exists(select 1 from unnest(coalesce(p_accepted_ids,'{}'::uuid[])) a join jsonb_array_elements(coalesce(p_rejected,'[]'::jsonb)) x on nullif(x->>'id','')::uuid=a) then
    raise exception using errcode='23514',message='partner_row_both_accepted_and_rejected';
  end if;
  update public.billing_export_run_items set export_status='sent',partner_result_type='accepted',sent_at=now(),failed_at=null,last_error=null,sent_by=p_actor_user_id,
    partner_response_log=coalesce(partner_response_log,'[]'::jsonb)||jsonb_build_array(p_response),last_partner_response_at=now(),updated_at=now()
  where company_id=p_company_id and billing_export_run_id=p_export_run_id and export_status='queued' and id=any(coalesce(p_accepted_ids,'{}'::uuid[]));
  update public.partner_exports p set status='sent',sent_at=now(),failure_reason=null,response_payload=p_response,
    partner_response_log=coalesce(p.partner_response_log,'[]'::jsonb)||jsonb_build_array(p_response),last_partner_response_at=now(),updated_at=now(),updated_by=p_actor_user_id
  from public.billing_export_run_items i where i.partner_export_id=p.id and i.company_id=p_company_id and i.billing_export_run_id=p_export_run_id and i.id=any(coalesce(p_accepted_ids,'{}'::uuid[]));
  with rejected as (select nullif(x->>'id','')::uuid id,coalesce(nullif(x->>'error',''),'Fakturapartnern avvisade raden.') error from jsonb_array_elements(coalesce(p_rejected,'[]'::jsonb)) x)
  update public.billing_export_run_items i set export_status='failed',status='ready_for_retry',
    partner_result_type=case when nullif(p_response->>'error','') is null then 'rejected' else 'transport_failed' end,
    failed_at=now(),last_error=r.error,
    partner_response_log=coalesce(i.partner_response_log,'[]'::jsonb)||jsonb_build_array(p_response),last_partner_response_at=now(),updated_at=now()
  from rejected r where i.id=r.id and i.company_id=p_company_id and i.billing_export_run_id=p_export_run_id and i.export_status='queued';
  with rejected as (select nullif(x->>'id','')::uuid id,coalesce(nullif(x->>'error',''),'Fakturapartnern avvisade raden.') error from jsonb_array_elements(coalesce(p_rejected,'[]'::jsonb)) x)
  update public.partner_exports p set status='failed',failed_at=now(),failure_reason=r.error,response_payload=p_response,
    partner_response_log=coalesce(p.partner_response_log,'[]'::jsonb)||jsonb_build_array(p_response),last_partner_response_at=now(),retry_count=p.retry_count+1,updated_at=now(),updated_by=p_actor_user_id
  from rejected r, public.billing_export_run_items i
  where i.id=r.id and i.partner_export_id=p.id
    and i.company_id=p_company_id and i.billing_export_run_id=p_export_run_id;
  select jsonb_array_length(coalesce(p_rejected,'[]'::jsonb)) into v_rejected_count;
  update public.billing_export_runs set partner_response_log=coalesce(partner_response_log,'[]'::jsonb)||jsonb_build_array(p_response),last_partner_response_at=now(),updated_at=now() where id=p_export_run_id and company_id=p_company_id;
  perform public.gridex_refresh_billing_export_run(p_company_id,p_export_run_id);
  return jsonb_build_object('accepted',coalesce(cardinality(p_accepted_ids),0),'rejected',v_rejected_count);
end $$;

create or replace function public.gridex_prepare_billing_export_retry(
  p_company_id uuid,p_export_run_id uuid,p_actor_user_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_rows integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_export_run_id::text||':retry',0));
  perform 1 from public.billing_export_runs where id=p_export_run_id and company_id=p_company_id for update;
  if not found then raise exception using errcode='P0002',message='billing_export_run_not_found'; end if;
  update public.billing_export_run_items set export_status='ready_for_retry',status='ready_for_retry',partner_result_type='none',failed_at=null,last_error=null,
    retry_count=retry_count+1,updated_at=now() where company_id=p_company_id and billing_export_run_id=p_export_run_id and export_status='failed';
  get diagnostics v_rows=row_count;
  update public.billing_export_runs set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('retryPreparedAt',now(),'retryPreparedBy',p_actor_user_id,'retryPreparedRows',v_rows),updated_at=now()
  where id=p_export_run_id and company_id=p_company_id;
  perform public.gridex_refresh_billing_export_run(p_company_id,p_export_run_id);
  return jsonb_build_object('reopened',v_rows);
end $$;

-- Tenant-scoped cleanup replaces the unsafe global cleanup entry point.
drop function if exists public.gridex_cleanup_orphan_contract_pricing(interval);
create or replace function public.gridex_cleanup_orphan_contract_pricing(
  p_company_id uuid,p_older_than interval default interval '24 hours'
) returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_books integer:=0; v_versions integer:=0;
begin
  if p_company_id is null then raise exception using errcode='22023',message='company_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':orphan-pricing-cleanup',0));
  perform set_config('gridex.pricing_version_write','on',true);
  delete from public.price_books b where b.company_id=p_company_id and b.locked_at is null and b.created_at<now()-p_older_than
    and not exists(select 1 from public.public_contract_offers o where o.price_book_id=b.id)
    and not exists(select 1 from public.contract_publication_versions v where v.price_book_id=b.id)
    and not exists(select 1 from public.contract_offers o where o.price_book_id=b.id)
    and not exists(select 1 from public.customer_contracts c where c.price_book_id=b.id)
    and not exists(select 1 from public.contract_price_snapshots s where s.price_book_id=b.id)
    and not exists(select 1 from public.billing_underlays u where u.price_book_id=b.id)
    and not exists(select 1 from public.billing_underlay_items i where i.price_book_id=b.id);
  get diagnostics v_books=row_count;
  delete from public.price_plan_versions v where v.company_id=p_company_id and v.locked_at is null and v.created_at<now()-p_older_than
    and not exists(select 1 from public.public_contract_offers o where o.price_plan_version_id=v.id)
    and not exists(select 1 from public.contract_publication_versions p where p.price_plan_version_id=v.id)
    and not exists(select 1 from public.contract_offers o where o.price_plan_version_id=v.id)
    and not exists(select 1 from public.customer_contracts c where c.price_plan_version_id=v.id)
    and not exists(select 1 from public.contract_price_snapshots s where s.price_plan_version_id=v.id)
    and not exists(select 1 from public.billing_underlays u where u.price_plan_version_id=v.id)
    and not exists(select 1 from public.billing_underlay_items i where i.price_plan_version_id=v.id);
  get diagnostics v_versions=row_count;
  return jsonb_build_object('company_id',p_company_id,'price_books_deleted',v_books,'price_versions_deleted',v_versions);
end $$;

-- Delete the user-verified zero-reference legacy price book only if it is still safe.
do $$ declare v_id uuid:='a24aa71d-42c0-4241-9145-fd66aec054ab'; begin
  if exists(select 1 from public.price_books where id=v_id and company_id='b3ad1bf6-fa45-41a6-8054-2e0862e82aca'::uuid and locked_at is null) then
    if exists(select 1 from public.public_contract_offers where price_book_id=v_id)
      or exists(select 1 from public.contract_publication_versions where price_book_id=v_id)
      or exists(select 1 from public.contract_offers where price_book_id=v_id)
      or exists(select 1 from public.customer_contracts where price_book_id=v_id)
      or exists(select 1 from public.contract_price_snapshots where price_book_id=v_id)
      or exists(select 1 from public.billing_underlays where price_book_id=v_id)
      or exists(select 1 from public.billing_underlay_items where price_book_id=v_id) then
      raise exception using errcode='23514',message='verified_orphan_price_book_gained_reference';
    end if;
    delete from public.price_books where id=v_id;
  end if;
end $$;

-- Enhance operational evidence with runtime search_path and production/export checks.
create or replace function public.gridex_contract_platform_integrity_report(p_company_id uuid)
returns jsonb language sql security definer set search_path=public,extensions,pg_temp as $$
select jsonb_build_object(
  'company_id',p_company_id,'generated_at',now(),
  'published_offers_missing_canonical_binding',(select count(*) from public.public_contract_offers o where o.company_id=p_company_id and o.publication_status='published' and (o.contract_product_version_id is null or o.contract_publication_version_id is null or o.legal_bundle_version_id is null or o.price_plan_version_id is null or o.price_book_id is null)),
  'published_versions_blocked',(select count(*) from public.contract_publication_readiness_v r where r.company_id=p_company_id and r.status='published' and coalesce(array_length(r.blockers,1),0)>0),
  'signed_contracts_missing_exact_binding',(select count(*) from public.customer_contracts c where c.company_id=p_company_id and c.status in ('signed','active') and (c.contract_publication_version_id is null or c.contract_product_version_id is null or c.legal_bundle_version_id is null or c.contract_price_snapshot_id is null)),
  'ready_underlays_missing_exact_binding',(select count(*) from public.billing_underlays b where b.company_id=p_company_id and b.readiness_status='ready' and (b.contract_id is null or coalesce(b.contract_price_snapshot_id,b.pricing_snapshot_id) is null)),
  'ready_exports_with_contract_mismatch',(select count(*) from public.billing_export_run_items i join public.billing_underlays b on b.id=i.billing_underlay_id and b.company_id=i.company_id where i.company_id=p_company_id and i.status='ready' and i.contract_id is distinct from b.contract_id),
  'production_underlays_invalid',(select count(*) from public.billing_underlays b where b.company_id=p_company_id and b.energy_direction='production' and (b.settlement_type not in ('credit_invoice','self_billing') or b.total_kwh<=0)),
  'consumption_corrections_invalid',(select count(*) from public.billing_underlays b where b.company_id=p_company_id and b.energy_direction='consumption_correction' and (b.settlement_type<>'credit_invoice' or b.total_kwh<=0)),
  'export_readiness_blocked',(select count(*) from public.billing_export_readiness_v r where r.company_id=p_company_id and not r.is_exportable),
  'orphan_unlocked_price_versions',(select count(*) from public.price_plan_versions v where v.company_id=p_company_id and v.locked_at is null and not exists(select 1 from public.public_contract_offers o where o.price_plan_version_id=v.id) and not exists(select 1 from public.contract_publication_versions cpv where cpv.price_plan_version_id=v.id) and not exists(select 1 from public.contract_offers o where o.price_plan_version_id=v.id) and not exists(select 1 from public.customer_contracts c where c.price_plan_version_id=v.id) and not exists(select 1 from public.contract_price_snapshots s where s.price_plan_version_id=v.id) and not exists(select 1 from public.billing_underlays b where b.price_plan_version_id=v.id) and not exists(select 1 from public.billing_underlay_items i where i.price_plan_version_id=v.id)),
  'orphan_unlocked_price_books',(select count(*) from public.price_books b where b.company_id=p_company_id and b.locked_at is null and not exists(select 1 from public.public_contract_offers o where o.price_book_id=b.id) and not exists(select 1 from public.contract_publication_versions cpv where cpv.price_book_id=b.id) and not exists(select 1 from public.contract_offers o where o.price_book_id=b.id) and not exists(select 1 from public.customer_contracts c where c.price_book_id=b.id) and not exists(select 1 from public.contract_price_snapshots s where s.price_book_id=b.id) and not exists(select 1 from public.billing_underlays u where u.price_book_id=b.id) and not exists(select 1 from public.billing_underlay_items i where i.price_book_id=b.id)),
  'runtime_functions_present',jsonb_build_object(
    'public_offer_upsert',to_regprocedure('public.gridex_upsert_public_contract_offer(uuid,uuid,text,jsonb,jsonb,uuid)') is not null,
    'website_contract_create',to_regprocedure('public.gridex_create_website_customer_contract(uuid,jsonb,text)') is not null,
    'pricing_persist',to_regprocedure('public.gridex_persist_pricing_run(uuid,uuid,jsonb,jsonb)') is not null,
    'export_create',to_regprocedure('public.gridex_create_billing_export_run(jsonb,jsonb)') is not null,
    'export_queue',to_regprocedure('public.gridex_queue_billing_export_run(uuid,uuid,uuid)') is not null,
    'export_partner_result',to_regprocedure('public.gridex_apply_billing_export_partner_result(uuid,uuid,uuid[],jsonb,jsonb,uuid)') is not null
  ),
  'runtime_search_path_valid',not exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('gridex_create_or_version_contract_pricing','gridex_materialize_legal_bundle_version','gridex_sync_public_offer_to_canonical','gridex_sync_internal_offer_to_canonical','gridex_create_website_customer_contract','gridex_persist_pricing_run','gridex_lock_pricing_run')
      and not ('search_path=public, extensions, pg_temp'=any(coalesce(p.proconfig,'{}'::text[])) or 'search_path=public,extensions,pg_temp'=any(coalesce(p.proconfig,'{}'::text[])))
  )
) $$;

revoke all on function public.gridex_queue_billing_export_run(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.gridex_apply_billing_export_partner_result(uuid,uuid,uuid[],jsonb,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.gridex_prepare_billing_export_retry(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.gridex_cleanup_orphan_contract_pricing(uuid,interval) from public,anon,authenticated;
grant execute on function public.gridex_queue_billing_export_run(uuid,uuid,uuid) to service_role;
grant execute on function public.gridex_apply_billing_export_partner_result(uuid,uuid,uuid[],jsonb,jsonb,uuid) to service_role;
grant execute on function public.gridex_prepare_billing_export_retry(uuid,uuid,uuid) to service_role;
grant execute on function public.gridex_cleanup_orphan_contract_pricing(uuid,interval) to service_role;
grant select on public.billing_export_readiness_v to service_role,authenticated;

commit;
